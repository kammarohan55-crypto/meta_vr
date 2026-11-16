/**
 * Game audio. One AudioContext is made while the game loads (it stays suspended until the
 * first click, per autoplay rules), so every recording is decoded and every designed sound is
 * rendered before play starts: nothing heavy happens on a click, at the deal or on a big moment.
 *
 * Sources: Kenney (CC0) card, interface and impact sounds and music jingles in public/audio/sfx;
 * whooshes, the +4 riser and boom, sparkles, the victory chord and the toy sounds are designed
 * in sound-design.ts. Table sounds are placed in 3D (a card lands where it lands, a sting comes
 * from the player it hits); menu sounds and stingers play straight.
 *
 * Mix: effects → fx bus; soundtrack and ambience → music bus → duck (dips under big moments);
 * voice chat → voice bus; all → master → glue compressor → limiter. Sliders are squared, so the
 * whole travel of a slider is useful, and they glide instead of stepping.
 */
import { Vector3 } from '@iwsdk/core';
import { renderDesignedSounds } from './sound-design.js';
import { useHeroes } from './world-choice.js';

const base = (p: string) => `${(import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './'}${p}`;

/** How loud the soundtrack sits in the music bus (the Music slider scales it). */
const TRACK_LEVEL = 0.5;

/** Recorded sounds; each set holds variations so repeats differ. All CC0 (public/audio/sfx/LICENSE-kenney-CC0.txt). */
const SAMPLE_SETS: Record<string, string[]> = {
  // cards (Kenney Casino Audio)
  place: ['card-place-1', 'card-place-2', 'card-place-3', 'card-place-4'],
  slide: ['card-slide-1', 'card-slide-2', 'card-slide-3', 'card-slide-5'],
  shove: ['card-shove-1', 'card-shove-2', 'card-shove-3'],
  fan: ['card-fan-1', 'card-fan-2'],
  shuffle: ['card-shuffle'],
  knock: ['impactWood_light_000', 'impactWood_light_002', 'impactWood_light_003'],
  // menus (Kenney Interface Sounds): soft, rounded, nothing above the voice range
  press: ['drop_002', 'drop_003'],
  confirm: ['confirmation_001'],
  toggle: ['pluck_001', 'pluck_002'],
  nope: ['bong_001'],
  // impacts (Kenney Impact Sounds)
  thud: ['impactSoft_heavy_000', 'impactSoft_heavy_002'],
  thudSmall: ['impactSoft_medium_001', 'impactSoft_medium_003'],
  punch: ['impactPunch_medium_000', 'impactPunch_medium_001'],
  bell: ['impactBell_heavy_001'],
  glass: ['impactGlass_light_000', 'impactGlass_light_002', 'impactGlass_light_004'],
  wood: ['impactWood_medium_000', 'impactWood_medium_003'],
  // stingers (Kenney Music Jingles: pizzicato strings and steel drums)
  'j-turn': ['jingles_PIZZI08'],
  'j-skip': ['jingles_PIZZI09'],
  'j-draw2': ['jingles_PIZZI16'],
  'j-wild': ['jingles_PIZZI02'],
  'j-last': ['jingles_PIZZI03'],
  'j-take': ['jingles_PIZZI01'],
  'j-lose': ['jingles_PIZZI11'],
  'j-sad': ['jingles_PIZZI05'],
  'j-win': ['jingles_STEEL10'],
  'j-cheer': ['jingles_STEEL04'],
};

/** Slider position that gives today's default loudness, and that loudness (gain). */
const SLIDER_REF = { master: [0.9, 0.9], fx: [0.9, 0.9], music: [0.55, 0.44], voice: [1, 1] } as const;

interface PlayOpts {
  /** Seconds from now. */
  when?: number;
  /** Playback rate (pitch). Each play also varies it by a few percent unless `exact`. */
  rate?: number;
  exact?: boolean;
  /** Stop after this many seconds, with a short fade. */
  dur?: number;
  /** Start this far into the sound. */
  offset?: number;
  bus?: GainNode;
}

export class Sound {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private fx!: GainNode;
  private music!: GainNode;
  /** Between the music bus and the master: dips the soundtrack under big moments. */
  private duckGain!: GainNode;
  voice!: GainNode;
  private reverb!: ConvolverNode;
  private wet!: GainNode;
  private ambience: GainNode | null = null;
  private noiseBuf!: AudioBuffer;
  private samples = new Map<string, AudioBuffer[]>();
  private designed = new Map<string, AudioBuffer>();
  private lastPick = new Map<string, number>();
  private lastHover = 0;
  volumes = { master: 0.9, fx: 0.9, music: 0.6, voice: 1.0 };

  /**
   * Make the audio graph and start decoding everything. Safe before any click: the context
   * waits, suspended, and `unlock()` (on the first press) only has to resume it.
   */
  boot(): void {
    if (this.ctx) return;
    try {
      this.build();
    } catch {
      this.ctx = null;
    }
  }

  unlock(): void {
    try {
      if (!this.ctx) this.build();
      if (this.away) return;
      if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
      // a track asked for before the first click starts now
      if (this.wantTrack && (!this.track || this.track.url !== this.wantTrack)) this.startTrack(this.wantTrack);
      else if (this.track?.el.paused) void this.track.el.play().catch(() => {});
    } catch {
      this.ctx = null;
    }
  }

  /**
   * Nobody is listening (the headset is off or the tab is hidden): stop the clock on the whole
   * mix and pause the soundtrack, and pick both up where they were on return. Only audio that
   * was already playing is resumed, so this never starts sound before the first press.
   */
  setAway(away: boolean): void {
    if (away === this.away) return;
    this.away = away;
    const ctx = this.ctx;
    if (!ctx) return;
    if (away) {
      this.wasRunning = ctx.state === 'running';
      if (this.wasRunning) void ctx.suspend();
      this.track?.el.pause();
    } else if (this.wasRunning) {
      void ctx.resume();
      if (this.track?.el.paused) void this.track.el.play().catch(() => {});
    }
  }
  private away = false;
  private wasRunning = false;

  /** True once the recordings and designed sounds are ready. */
  get ready(): boolean {
    return this.loaded;
  }
  private loaded = false;

  // ---------------------------------------------------------------- soundtrack
  /** The world's music: streamed (never fully decoded), looping, through the music bus. */
  private track: { url: string; el: HTMLAudioElement; gain: GainNode } | null = null;
  private wantTrack = '';

  /** Play a world's track (crossfading from the last one). Safe to call before the first click. */
  playTrack(url: string): void {
    this.wantTrack = url;
    if (this.ctx && this.ctx.state === 'running') this.startTrack(url);
  }

  private startTrack(url: string): void {
    const ctx = this.ctx;
    if (!ctx || (this.track && this.track.url === url)) return;
    const old = this.track;
    const now = ctx.currentTime;
    if (old) {
      // fade out, then let it go
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + 1.2);
      setTimeout(() => {
        old.el.pause();
        old.el.removeAttribute('src');
        old.el.load();
        old.gain.disconnect();
      }, 1500);
    }
    const el = new Audio(base(url));
    el.loop = true;
    el.preload = 'auto';
    const gain = ctx.createGain();
    gain.gain.value = 0;
    ctx.createMediaElementSource(el).connect(gain);
    gain.connect(this.music);
    this.track = { url, el, gain };
    // fade in from when it actually starts playing (a slow connection never cuts in loud)
    const fadeIn = () => {
      // switched away before it started: it stays silent while it fades out
      if (this.track?.el !== el) return;
      const t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(TRACK_LEVEL, t + (old ? 1.6 : 2.5));
    };
    el.addEventListener('playing', fadeIn, { once: true });
    void el.play().catch(() => {
      /* it starts on the next click (autoplay rules) */
    });
    // the generated ambience sits under the music, not over it
    if (this.ambience) this.ambience.gain.linearRampToValueAtTime(0.55, now + 2);
  }

  /** Dip the soundtrack by `db` for `hold` seconds (a win, a +4). */
  duck(db: number, hold: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const g = this.duckGain.gain;
    const t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(Math.pow(10, db / 20), t + 0.12);
    g.setValueAtTime(Math.pow(10, db / 20), t + 0.12 + hold);
    g.linearRampToValueAtTime(1, t + 0.12 + hold + 1.2);
  }

  private build(): void {
    const AC = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    // glue: gently holds the mix together; then a limiter so nothing ever clips
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -20;
    glue.knee.value = 12;
    glue.ratio.value = 2.5;
    glue.attack.value = 0.008;
    glue.release.value = 0.25;
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -3;
    limit.knee.value = 0;
    limit.ratio.value = 20;
    limit.attack.value = 0.002;
    limit.release.value = 0.12;
    glue.connect(limit);
    limit.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(glue);
    this.fx = ctx.createGain();
    this.music = ctx.createGain();
    this.duckGain = ctx.createGain();
    this.voice = ctx.createGain();
    this.fx.connect(this.master);
    this.music.connect(this.duckGain);
    this.duckGain.connect(this.master);
    this.voice.connect(this.master);
    // a short, warm room for the few sounds still made live
    const len = Math.floor(ctx.sampleRate * 1.2);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.2;
    this.wet.connect(this.reverb);
    this.reverb.connect(this.master);
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.applyVolumes(true);
    void this.loadAll();
    if (useHeroes()) this.startMountainAmbience();
    else this.startAmbience();
  }

  /** Decode the recordings and render the designed sounds, in the background. */
  private async loadAll(): Promise<void> {
    const ctx = this.ctx!;
    const jobs: Promise<void>[] = [];
    for (const [set, files] of Object.entries(SAMPLE_SETS)) {
      for (const name of files) {
        jobs.push(
          fetch(base(`audio/sfx/${name}.ogg`))
            .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
            .then((data) => ctx.decodeAudioData(data))
            .then((buffer) => {
              const list = this.samples.get(set) ?? [];
              list.push(buffer);
              this.samples.set(set, list);
            })
            .catch(() => {
              /* that set keeps its fallback */
            }),
        );
      }
    }
    jobs.push(
      renderDesignedSounds()
        .then((m) => {
          for (const [k, v] of m) this.designed.set(k, v);
        })
        .catch(() => {}),
    );
    await Promise.all(jobs);
    this.loaded = true;
  }

  /**
   * Play one variation of a recorded set (or a designed sound) at `at` (table space; null plays
   * it straight). Never the same variation twice in a row. False if it isn't loaded.
   */
  private play(set: string, at: Vector3 | null, vol: number, o: PlayOpts = {}): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    let buffer = this.designed.get(set);
    if (!buffer) {
      const list = this.samples.get(set);
      if (!list || !list.length) return false;
      let i = Math.floor(Math.random() * list.length);
      if (list.length > 1 && i === this.lastPick.get(set)) i = (i + 1) % list.length;
      this.lastPick.set(set, i);
      buffer = list[i];
    }
    const t = ctx.currentTime + (o.when ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = (o.rate ?? 1) * (o.exact ? 1 : 0.97 + Math.random() * 0.06);
    const g = ctx.createGain();
    // a tiny volume variation too, so repeats breathe
    const v = o.exact ? vol : vol * (0.92 + Math.random() * 0.16);
    g.gain.setValueAtTime(v, t);
    if (o.dur) {
      g.gain.setValueAtTime(v, t + Math.max(0, o.dur - 0.06));
      g.gain.linearRampToValueAtTime(0, t + o.dur);
    }
    src.connect(g);
    g.connect(this.out(at, o.bus));
    src.start(t, o.offset ?? 0);
    if (o.dur) src.stop(t + o.dur + 0.02);
    return true;
  }

  /** Map a 0..1 slider to gain: squared (an even feel), scaled so the default sounds as before. */
  private static gainFor(k: keyof typeof SLIDER_REF, v: number): number {
    const [ref, g] = SLIDER_REF[k];
    return v <= 0 ? 0 : g * Math.pow(v / ref, 2);
  }

  applyVolumes(instant = false): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const set = (p: AudioParam, v: number) => {
      if (instant) p.value = v;
      else p.setTargetAtTime(v, t, 0.04);
    };
    set(this.master.gain, Sound.gainFor('master', this.volumes.master));
    set(this.fx.gain, Sound.gainFor('fx', this.volumes.fx));
    set(this.music.gain, Sound.gainFor('music', this.volumes.music));
    set(this.voice.gain, Sound.gainFor('voice', this.volumes.voice));
  }

  /** Keep the listener on the player's head (table space). */
  listener(pos: Vector3, fwd: Vector3): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.value = pos.x;
      l.positionY.value = pos.y;
      l.positionZ.value = pos.z;
      l.forwardX.value = fwd.x;
      l.forwardY.value = fwd.y;
      l.forwardZ.value = fwd.z;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    }
  }

  /**
   * Spatial outputs are shared: sounds from the same spot (a seat, the pile) reuse one HRTF
   * panner instead of each making its own, which keeps the audio thread light in busy moments.
   */
  private panners = new Map<string, { p: PannerNode; used: number }>();
  private out(at: Vector3 | null, bus: GainNode = this.fx): AudioNode {
    const ctx = this.ctx!;
    if (!at) return bus;
    const key = `${Math.round(at.x * 6)},${Math.round(at.y * 6)},${Math.round(at.z * 6)}${bus === this.fx ? '' : 'm'}`;
    const now = ctx.currentTime;
    const hit = this.panners.get(key);
    if (hit) {
      hit.used = now;
      return hit.p;
    }
    if (this.panners.size >= 16) {
      // retire the longest-idle one, if it has been quiet long enough for any sound on it to end
      let oldKey = '';
      let oldUsed = Infinity;
      for (const [k, v] of this.panners) {
        if (v.used < oldUsed) {
          oldUsed = v.used;
          oldKey = k;
        }
      }
      if (now - oldUsed > 4) {
        this.panners.get(oldKey)!.p.disconnect();
        this.panners.delete(oldKey);
      }
    }
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 0.6;
    p.rolloffFactor = 0.8;
    p.positionX.value = at.x;
    p.positionY.value = at.y;
    p.positionZ.value = at.z;
    p.connect(bus);
    if (this.panners.size < 16) this.panners.set(key, { p, used: now });
    else setTimeout(() => p.disconnect(), 5000);
    return p;
  }

  /** Panner for a remote voice, kept at that player's head. */
  voicePanner(): PannerNode | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 0.8;
    p.rolloffFactor = 0.6;
    p.connect(this.voice);
    return p;
  }

  /** A soft sine note, for the rare moment a recording hasn't loaded yet. */
  private tone(f: number, dur: number, vol: number, at: Vector3 | null, when = 0, glide = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.out(at));
    const w = ctx.createGain();
    w.gain.value = 0.3;
    g.connect(w);
    w.connect(this.wet);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dur: number, vol: number, freq: number, q: number, at: Vector3 | null, when = 0, sweep = 0, type: BiquadFilterType = 'bandpass'): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(this.out(at));
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.02);
  }

  // ---------------------------------------------------------------- menus

  /** A menu press: a soft drop; back is lower, confirm rises, toggles pluck. */
  ui(kind: 'press' | 'back' | 'confirm' | 'toggle' = 'press'): void {
    if (kind === 'confirm' && this.play('confirm', null, 0.16)) return;
    if (kind === 'toggle' && this.play('toggle', null, 0.13, { rate: 1.12 })) return;
    if (this.play('press', null, kind === 'back' ? 0.13 : 0.15, { rate: kind === 'back' ? 0.8 : 1 })) return;
    this.tone(kind === 'back' ? 520 : 660, 0.07, 0.03, null, 0, kind === 'back' ? 420 : 560);
  }

  /** Something you can't do right now: a low, rounded bong. */
  nope(): void {
    if (this.play('nope', null, 0.24, { rate: 0.9 })) return;
    this.tone(220, 0.18, 0.05, null, 0, 180);
  }

  /** The turn clock in its last seconds: a wooden tock, a touch higher at the very end. */
  tick(urgent: boolean): void {
    if (this.play('knock', null, urgent ? 0.3 : 0.2, { rate: urgent ? 1.5 : 1.3, dur: 0.18 })) return;
    this.tone(urgent ? 900 : 760, 0.05, 0.03, null);
  }

  // ---------------------------------------------------------------- cards

  /** A card lifted from your hand. */
  cardPick(at: Vector3 | null): void {
    if (this.play('fan', at, 0.32, { rate: 1.2, dur: 0.35 })) return;
    this.noise(0.05, 0.08, 3200, 1.2, at);
  }
  cardSlide(at: Vector3 | null): void {
    if (this.play('slide', at, 0.65)) return;
    this.noise(0.16, 0.1, 2200, 0.8, at, 0, 900);
  }
  cardPlace(at: Vector3 | null): void {
    if (this.play('place', at, 0.85)) {
      this.play('knock', at, 0.16, { rate: 1.25 });
      return;
    }
    this.noise(0.035, 0.25, 1500, 0.9, at);
  }
  cardFlick(at: Vector3 | null): void {
    if (this.play('shove', at, 0.55)) return;
    this.noise(0.1, 0.14, 4200, 2, at, 0, 2200);
  }
  /** Your finger passing over a card: a quiet paper touch, never a beep, and never a burst. */
  hover(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.currentTime - this.lastHover < 0.09) return;
    this.lastHover = ctx.currentTime;
    this.play('slide', null, 0.09, { rate: 1.45, dur: 0.12 });
  }
  /** The opening riffle: two passes of a shuffle, faded, before the deal. */
  shuffle(at: Vector3 | null): void {
    if (this.play('shuffle', at, 0.8, { dur: 1.25, exact: true })) return;
    for (let i = 0; i < 14; i++) this.noise(0.03, 0.1, 2800 + Math.random() * 1500, 1.2, at, i * 0.04);
  }
  /** The deal: one soft flick per card, `gap` seconds apart, starting `delay` from now. */
  deal(count: number, gap: number, delay: number, at: Vector3 | null): void {
    for (let i = 0; i < count; i++) {
      this.play(i % 3 === 2 ? 'shove' : 'slide', at, i % 3 === 2 ? 0.28 : 0.3, { when: delay + i * gap, rate: 1.15 + Math.random() * 0.15, dur: 0.22 });
    }
  }

  // ---------------------------------------------------------------- stingers

  /** Your turn: two pizzicato notes, up. */
  turn(): void {
    if (this.play('j-turn', null, 0.22)) return;
    this.tone(587, 0.25, 0.04, null);
    this.tone(659, 0.35, 0.04, null, 0.12);
  }
  skip(at: Vector3 | null): void {
    this.play('thudSmall', at, 0.4);
    if (this.play('j-skip', null, 0.26, { when: 0.04 })) return;
    this.tone(330, 0.18, 0.05, at, 0, 247);
  }
  reverse(at: Vector3 | null): void {
    if (this.play('reverse', at, 0.55, { exact: true })) return;
    this.play('whoosh', at, 0.4);
  }
  draw2(at: Vector3 | null): void {
    this.play('whoosh', at, 0.32, { rate: 1.2 });
    this.play('glass', at, 0.18, { when: 0.05 });
    if (this.play('j-draw2', null, 0.26, { when: 0.02 })) return;
    this.tone(622, 0.2, 0.04, null);
    this.tone(932, 0.3, 0.04, null, 0.12);
  }
  /** The big one: a riser, then a deep boom with a bell, and the music ducks for it. */
  draw4(at: Vector3 | null): void {
    this.duck(-7, 1.4);
    this.play('riser', null, 0.4, { exact: true });
    this.play('boom', at, 0.75, { when: 0.95, exact: true });
    this.play('thud', at, 0.45, { when: 0.95 });
    this.play('bell', at, 0.3, { when: 0.97, rate: 0.84 });
  }
  /** The stack grew: a bell that climbs with every Draw card on it. */
  stack(n: number): void {
    const steps = Math.min(12, Math.max(0, n - 2));
    this.play('bell', null, 0.26, { rate: Math.pow(2, steps / 12), exact: true });
    this.play('glass', null, 0.14, { when: 0.04, rate: 1 + steps / 24 });
  }
  /** Someone has to take the cards: a soft thud and a falling run (quieter when it isn't you). */
  take(n: number, at: Vector3 | null, mine: boolean): void {
    this.play('thud', at, mine ? 0.42 : 0.28);
    if (n >= 4) this.play('j-take', null, mine ? 0.2 : 0.12, { when: 0.06 });
  }
  /** A Wild's colour chosen: a rising pizzicato run and a sparkle. */
  color(i: number): void {
    const rate = [1, 1.06, 0.94, 1.12][i] ?? 1;
    this.play('sparkle', null, 0.32, { rate, exact: true });
    if (this.play('j-wild', null, 0.22, { rate: 1 })) return;
    this.tone(523, 0.4, 0.04, null);
  }
  lastCard(at: Vector3 | null): void {
    this.play('heartbeat', at, 0.55, { exact: true });
    if (this.play('j-last', null, 0.16, { when: 0.1 })) return;
    this.tone(1175, 0.4, 0.03, at, 0.05);
  }
  emote(kind: string, at: Vector3 | null): void {
    switch (kind) {
      case 'clap':
        if (this.play('clap', at, 0.42)) return;
        break;
      case 'laugh':
        // a little giggle of plucks, falling
        [1.5, 1.34, 1.2, 1.12].forEach((r, i) => this.play('toggle', at, 0.13, { when: i * 0.085, rate: r, exact: true }));
        return;
      case 'cheer':
        if (this.play('j-cheer', at, 0.26)) {
          this.play('sparkle', at, 0.18, { when: 0.2 });
          return;
        }
        break;
      case 'cry':
        if (this.play('j-sad', at, 0.2)) return;
        break;
      case 'facepalm':
        if (this.play('thudSmall', at, 0.4, { rate: 0.85 })) return;
        break;
      case 'angry':
        if (this.play('nope', at, 0.26, { rate: 0.75 })) return;
        break;
      case 'cool':
        this.play('glass', at, 0.16);
        if (this.play('toggle', at, 0.13, { when: 0.05, rate: 1.5 })) return;
        break;
      default:
        if (this.play('toggle', at, 0.13, { rate: 1.25 })) return;
    }
    this.tone(784, 0.15, 0.03, at);
  }

  // ---------------------------------------------------------------- toys

  pop(at: Vector3 | null): void {
    if (this.play('pop', at, 0.45)) return;
    this.tone(500, 0.12, 0.05, at, 0, 900);
  }
  squeak(at: Vector3 | null): void {
    if (this.play('squeak', at, 0.36)) return;
    this.tone(1000, 0.2, 0.04, at, 0, 1400);
  }
  boing(at: Vector3 | null): void {
    if (this.play('boing', at, 0.42)) return;
    this.tone(170, 0.45, 0.06, at, 0, 240);
  }
  /** The toy hammer landing: a hollow wooden bonk and a squeak. */
  bonk(at: Vector3 | null): void {
    this.play('wood', at, 0.45, { rate: 1.1 });
    this.squeak(at);
  }
  /** Confetti: a pop and a shower of little bells. */
  confetti(at: Vector3 | null): void {
    this.pop(at);
    this.play('sparkle', at, 0.3, { when: 0.05, rate: 1.12 });
  }
  /** Something thrown through the air. */
  whoosh(at: Vector3 | null): void {
    if (this.play('whoosh', at, 0.36)) return;
    this.noise(0.32, 0.08, 700, 0.8, at, 0, 2600);
  }
  /** A wet hit (pie, snowball). */
  splat(at: Vector3 | null, size = 1): void {
    this.play('thudSmall', at, 0.35 * size);
    if (this.play('splat', at, 0.42 * size)) return;
    this.noise(0.2, 0.2 * size, 1200, 1.4, at, 0, 300, 'lowpass');
  }

  // ---------------------------------------------------------------- results

  /** You won: the steel-drum run lands on a full G-major bloom with sparkles; the music steps back. */
  win(): void {
    this.duck(-9, 2.6);
    const jingle = this.play('j-win', null, 0.34, { exact: true });
    this.play('victory', null, 0.5, { when: jingle ? 0.62 : 0, exact: true });
    if (!jingle && !this.designed.has('victory')) [392, 494, 587, 784].forEach((f, i) => this.tone(f, 0.8, 0.04, null, i * 0.1));
  }
  /** You lost: a gentle falling pizzicato line, no mockery. */
  lose(): void {
    this.duck(-5, 1.2);
    if (this.play('j-lose', null, 0.26, { exact: true })) {
      this.play('bell', null, 0.12, { when: 0.7, rate: 0.75 });
      return;
    }
    [392, 370, 349, 330].forEach((f, i) => this.tone(f, 0.4, 0.035, null, i * 0.3));
  }

  // ---------------------------------------------------------------- ambience

  /**
   * Frostpeak: wind across the peaks with slow gusts, a thin high whistle, the lantern
   * crackling and a quiet open chord underneath. All generated; nothing recorded or licensed.
   */
  private startMountainAmbience(): void {
    const ctx = this.ctx!;
    const bed = ctx.createGain();
    bed.gain.value = 0;
    bed.connect(this.music);
    this.ambience = bed;
    const wind = (type: BiquadFilterType, freq: number, q: number, vol: number, gustRate: number, sweep: number) => {
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBuf;
      n.loop = true;
      n.playbackRate.value = 0.8 + Math.random() * 0.4;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = vol;
      // gusts: the level and the pitch of the wind rise and fall slowly
      const lfo = ctx.createOscillator();
      lfo.frequency.value = gustRate;
      const lg = ctx.createGain();
      lg.gain.value = vol * 0.85;
      lfo.connect(lg);
      lg.connect(g.gain);
      const lf = ctx.createGain();
      lf.gain.value = sweep;
      lfo.connect(lf);
      lf.connect(f.frequency);
      n.connect(f);
      f.connect(g);
      g.connect(bed);
      n.start(0, Math.random() * 1.5);
      lfo.start();
    };
    wind('lowpass', 420, 0.7, 0.07, 0.06, 180);
    wind('bandpass', 900, 1.4, 0.022, 0.11, 380);
    wind('bandpass', 2100, 9, 0.006, 0.045, 600);
    // the lantern: sparse, soft crackles
    const crackle = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const d = crackle.getChannelData(0);
    for (let i = 0; i < 70; i++) {
      const at = Math.floor(Math.random() * (d.length - 400));
      const amp = 0.25 + Math.random() * 0.75;
      for (let k = 0; k < 220; k++) d[at + k] += (Math.random() * 2 - 1) * amp * Math.exp(-k / 35);
    }
    const c = ctx.createBufferSource();
    c.buffer = crackle;
    c.loop = true;
    const cf = ctx.createBiquadFilter();
    cf.type = 'highpass';
    cf.frequency.value = 1400;
    const cg = ctx.createGain();
    cg.gain.value = 0.03;
    c.connect(cf);
    cf.connect(cg);
    cg.connect(bed);
    c.start();
    // an open D chord, breathing slowly
    for (const [freq, vol] of [[73.42, 0.035], [110.0, 0.024], [146.83, 0.018], [220.0, 0.008]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq;
      o.detune.value = (Math.random() - 0.5) * 8;
      const g = ctx.createGain();
      g.gain.value = vol;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + Math.random() * 0.04;
      const lg = ctx.createGain();
      lg.gain.value = vol * 0.4;
      lfo.connect(lg);
      lg.connect(g.gain);
      o.connect(g);
      g.connect(bed);
      o.start();
      lfo.start();
    }
    bed.gain.linearRampToValueAtTime(1, ctx.currentTime + 5);
  }

  private startAmbience(): void {
    const ctx = this.ctx!;
    // a soft, low lounge pad plus city air through the glass
    this.ambience = ctx.createGain();
    this.ambience.gain.value = 0.0;
    this.ambience.connect(this.music);
    for (const f of [65.41, 98.0, 130.81, 164.81]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = f < 100 ? 0.05 : 0.025;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07 + Math.random() * 0.05;
      const lg = ctx.createGain();
      lg.gain.value = 0.015;
      lfo.connect(lg);
      lg.connect(g.gain);
      o.connect(g);
      g.connect(this.ambience);
      o.start();
      lfo.start();
    }
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    n.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.value = 0.04;
    n.connect(f);
    f.connect(g);
    g.connect(this.ambience);
    n.start();
    this.ambience.gain.linearRampToValueAtTime(1, ctx.currentTime + 4);
  }
}
