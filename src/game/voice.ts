/**
 * Voice chat: a small WebRTC mesh (each of up to 4 players connects directly
 * to every other), with signalling carried by the game server. Each friend's
 * voice is played through a 3D panner at their avatar's head, so voices come
 * from where people sit. No extra service, account or package is needed.
 *
 * Players behind strict NATs may need a TURN server; set VITE_TURN_URL,
 * VITE_TURN_USER and VITE_TURN_PASS to add one.
 */
import type { Sound } from './audio.js';

interface Peer {
  pc: RTCPeerConnection;
  panner: PannerNode | null;
  analyser: AnalyserNode | null;
  level: number;
  audioEl: HTMLAudioElement | null;
}

export class Voice {
  private local: MediaStream | null = null;
  private peers = new Map<string, Peer>();
  private send: (to: string, data: unknown) => void;
  private sound: Sound;
  private myId = '';
  private localAnalyser: AnalyserNode | null = null;
  private buf = new Float32Array(512);
  muted = false;
  /** Why the microphone is unavailable, if it is. */
  problem = '';

  constructor(sound: Sound, send: (to: string, data: unknown) => void) {
    this.sound = sound;
    this.send = send;
  }

  private ice(): RTCIceServer[] {
    const env = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};
    const list: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
    if (env.VITE_TURN_URL) list.push({ urls: env.VITE_TURN_URL, username: env.VITE_TURN_USER, credential: env.VITE_TURN_PASS });
    return list;
  }

  /** Ask for the microphone. Must be called from a user gesture. */
  async start(myId: string): Promise<boolean> {
    this.myId = myId;
    if (this.local) return true;
    try {
      this.local = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const ctx = this.sound.ctx;
      if (ctx) {
        const src = ctx.createMediaStreamSource(this.local);
        this.localAnalyser = ctx.createAnalyser();
        this.localAnalyser.fftSize = 512;
        src.connect(this.localAnalyser);
      }
      this.problem = '';
      return true;
    } catch (e) {
      this.problem = (e as Error).name === 'NotAllowedError' ? 'Microphone permission was declined.' : 'No microphone available.';
      return false;
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    for (const t of this.local?.getAudioTracks() ?? []) t.enabled = !m;
  }

  /** Keep one connection per other person in the room. The lower id makes the offer. */
  syncPeers(ids: string[]): void {
    const want = new Set(ids.filter((id) => id !== this.myId));
    for (const id of [...this.peers.keys()]) if (!want.has(id)) this.drop(id);
    for (const id of want) {
      if (!this.peers.has(id) && this.myId < id) void this.call(id);
    }
  }

  private peer(id: string): Peer {
    let p = this.peers.get(id);
    if (p) return p;
    const pc = new RTCPeerConnection({ iceServers: this.ice() });
    p = { pc, panner: null, analyser: null, level: 0, audioEl: null };
    this.peers.set(id, p);
    for (const t of this.local?.getTracks() ?? []) pc.addTrack(t, this.local!);
    pc.onicecandidate = (e) => {
      if (e.candidate) this.send(id, { ice: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      const peer = this.peers.get(id);
      if (!peer) return;
      // Chromium only starts pulling remote audio into Web Audio once an element plays it
      const el = new Audio();
      el.srcObject = stream;
      el.muted = true;
      void el.play().catch(() => {});
      peer.audioEl = el;
      const ctx = this.sound.ctx;
      if (ctx) {
        const src = ctx.createMediaStreamSource(stream);
        peer.panner = this.sound.voicePanner();
        peer.analyser = ctx.createAnalyser();
        peer.analyser.fftSize = 512;
        src.connect(peer.analyser);
        if (peer.panner) src.connect(peer.panner);
      } else {
        el.muted = false;
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        this.drop(id);
        if (this.myId < id) setTimeout(() => void this.call(id), 1500);
      }
    };
    return p;
  }

  private async call(id: string): Promise<void> {
    const { pc } = this.peer(id);
    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);
    this.send(id, { sdp: pc.localDescription });
  }

  /** A signalling message from another player. */
  async signal(from: string, data: { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit }): Promise<void> {
    const { pc } = this.peer(from);
    try {
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        if (data.sdp.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.send(from, { sdp: pc.localDescription });
        }
      } else if (data.ice) {
        await pc.addIceCandidate(data.ice);
      }
    } catch (e) {
      console.warn('[voice] signalling', e);
    }
  }

  private drop(id: string): void {
    const p = this.peers.get(id);
    if (!p) return;
    p.pc.close();
    p.panner?.disconnect();
    if (p.audioEl) p.audioEl.srcObject = null;
    this.peers.delete(id);
  }

  private rms(a: AnalyserNode | null): number {
    if (!a) return 0;
    a.getFloatTimeDomainData(this.buf);
    let s = 0;
    for (let i = 0; i < this.buf.length; i++) s += this.buf[i] * this.buf[i];
    return Math.min(1, Math.sqrt(s / this.buf.length) * 6);
  }

  /** My own speaking level (sent with my pose, drives my avatar's mouth for others). */
  myLevel(): number {
    return this.muted ? 0 : this.rms(this.localAnalyser);
  }

  /** Place a friend's voice at their head (table space) and read how loud they are. */
  place(id: string, x: number, y: number, z: number): number {
    const p = this.peers.get(id);
    if (!p) return 0;
    if (p.panner) {
      p.panner.positionX.value = x;
      p.panner.positionY.value = y;
      p.panner.positionZ.value = z;
    }
    p.level = p.level * 0.6 + this.rms(p.analyser) * 0.4;
    return p.level;
  }

  connectedCount(): number {
    let n = 0;
    for (const p of this.peers.values()) if (p.pc.connectionState === 'connected') n++;
    return n;
  }

  stop(): void {
    for (const id of [...this.peers.keys()]) this.drop(id);
    for (const t of this.local?.getTracks() ?? []) t.stop();
    this.local = null;
    this.localAnalyser = null;
  }
}
