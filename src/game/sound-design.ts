/**
 * Designed sounds: whooshes, the +4 riser and boom, sparkles, the victory chord, the reverse
 * swell, a heartbeat, claps and the toy sounds. Each is built once from oscillators, filtered
 * noise and a small room, rendered offline (OfflineAudioContext) while the game loads, and
 * normalised. At play time each is a single buffer, so a busy moment costs no extra nodes.
 *
 * Musical sounds are in G major / D major, the keys of the jingles they sit next to.
 */

type Ctx = OfflineAudioContext;

const SR = 48000;

/** Note name to frequency (A4 = 440). */
function hz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** A seeded random so the designed sounds are identical on every load. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noiseBuffer(ctx: Ctx, seconds: number, seed: number): AudioBuffer {
  const b = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  const d = b.getChannelData(0);
  const r = rng(seed);
  // gently pinked: a one-pole low-pass takes the hiss off white noise
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    last = last * 0.55 + (r() * 2 - 1) * 0.45;
    d[i] = last * 1.6;
  }
  return b;
}

/** A soft stereo room: decorrelated noise with a smooth exponential decay. */
function roomIR(ctx: Ctx, seconds: number, seed: number): AudioBuffer {
  const len = Math.ceil(seconds * ctx.sampleRate);
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    const r = rng(seed + ch * 101);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const k = i / len;
      // darker as it decays, like a real room
      const a = 0.35 + 0.5 * (1 - k);
      lp = lp * (1 - a) + (r() * 2 - 1) * a;
      d[i] = lp * Math.pow(1 - k, 2.6) * (i < 96 ? i / 96 : 1);
    }
  }
  return b;
}

interface Bus {
  ctx: Ctx;
  /** Dry output. */
  dry: GainNode;
  /** Into the room. */
  wet: GainNode;
  noise: AudioBuffer;
  r: () => number;
}

function makeBus(ctx: Ctx, wet: number, roomSeconds: number, seed: number): Bus {
  const dry = ctx.createGain();
  dry.connect(ctx.destination);
  const send = ctx.createGain();
  send.gain.value = wet;
  if (wet > 0) {
    const conv = ctx.createConvolver();
    conv.buffer = roomIR(ctx, roomSeconds, seed);
    send.connect(conv);
    conv.connect(ctx.destination);
  }
  return { ctx, dry, wet: send, noise: noiseBuffer(ctx, 2, seed + 7), r: rng(seed) };
}

/** Route a voice to the dry bus and the room, optionally panned. */
function route(b: Bus, node: AudioNode, pan = 0): void {
  let out: AudioNode = node;
  if (pan) {
    const p = b.ctx.createStereoPanner();
    p.pan.value = pan;
    node.connect(p);
    out = p;
  }
  out.connect(b.dry);
  out.connect(b.wet);
}

/** A struck bell or glockenspiel note (additive, slightly inharmonic). */
function bell(b: Bus, f: number, t: number, dur: number, vol: number, pan = 0, bright = 1): void {
  const ctx = b.ctx;
  const out = ctx.createGain();
  out.gain.value = vol;
  const partials: [number, number, number][] = [
    [1, 1, 1],
    [2.0, 0.22, 0.55],
    [2.76, 0.32 * bright, 0.38],
    [5.4, 0.12 * bright, 0.2],
    [8.93, 0.05 * bright, 0.1],
  ];
  for (const [ratio, amp, decay] of partials) {
    if (f * ratio > 16000) continue;
    const o = ctx.createOscillator();
    o.frequency.value = f * ratio;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.003);
    g.gain.setTargetAtTime(0, t + 0.003, (dur * decay) / 4);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + dur + 0.1);
  }
  route(b, out, pan);
}

/** A soft mallet note (marimba-like): a round fundamental and a quick woody overtone. */
function mallet(b: Bus, f: number, t: number, dur: number, vol: number, pan = 0): void {
  const ctx = b.ctx;
  const out = ctx.createGain();
  out.gain.value = vol;
  for (const [ratio, amp, decay] of [
    [1, 1, 1],
    [3.99, 0.28, 0.12],
    [9.8, 0.06, 0.04],
  ] as const) {
    const o = ctx.createOscillator();
    o.frequency.value = f * ratio;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.004);
    g.gain.setTargetAtTime(0, t + 0.004, (dur * decay) / 4);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + dur + 0.1);
  }
  route(b, out, pan);
}

/** A warm pad voice: two detuned triangles through a low-pass that opens and settles. */
function pad(b: Bus, f: number, t: number, attack: number, hold: number, release: number, vol: number, pan = 0): void {
  const ctx = b.ctx;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.5;
  lp.frequency.setValueAtTime(700, t);
  lp.frequency.linearRampToValueAtTime(3200, t + attack + 0.15);
  lp.frequency.setTargetAtTime(1600, t + attack + 0.15, 0.5);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.setTargetAtTime(vol * 0.7, t + attack, 0.4);
  g.gain.setTargetAtTime(0, t + attack + hold, release / 4);
  for (const cents of [-7, 6]) {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    o.detune.value = cents;
    o.connect(lp);
    o.start(t);
    o.stop(t + attack + hold + release + 0.2);
  }
  lp.connect(g);
  route(b, g, pan);
}

/** Filtered noise with a gain envelope given as [time, level] points. */
function noise(b: Bus, t: number, env: [number, number][], filter: BiquadFilterType, freq: [number, number][], q: number, pan = 0): BiquadFilterNode {
  const ctx = b.ctx;
  const s = ctx.createBufferSource();
  s.buffer = b.noise;
  s.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq[0][1], t + freq[0][0]);
  for (let i = 1; i < freq.length; i++) f.frequency.exponentialRampToValueAtTime(freq[i][1], t + freq[i][0]);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  for (const [at, v] of env) g.gain.linearRampToValueAtTime(v, t + at);
  s.connect(f);
  f.connect(g);
  route(b, g, pan);
  s.start(t, b.r() * 1.5);
  s.stop(t + env[env.length - 1][0] + 0.05);
  return f;
}

/** A pitched thump: a sine falling in pitch, gently saturated so small speakers still hear it. */
function thump(b: Bus, t: number, from: number, to: number, dur: number, vol: number): void {
  const ctx = b.ctx;
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + dur * 0.6);
  const sh = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 1.8) / Math.tanh(1.8);
  }
  sh.curve = curve;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.004);
  g.gain.setTargetAtTime(0, t + 0.004, dur / 4);
  o.connect(sh);
  sh.connect(g);
  route(b, g);
  o.start(t);
  o.stop(t + dur + 0.1);
}

/** Scale a buffer so its loudest sample sits at `peak`, and fade the tail to silence. */
function finish(buf: AudioBuffer, peak: number): AudioBuffer {
  let max = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) max = Math.max(max, Math.abs(d[i]));
  }
  const k = max > 0 ? peak / max : 1;
  const fade = Math.min(buf.length, Math.floor(0.03 * buf.sampleRate));
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] *= k;
    for (let i = 0; i < fade; i++) d[d.length - 1 - i] *= i / fade;
  }
  return buf;
}

interface Recipe {
  seconds: number;
  wet: number;
  room: number;
  peak: number;
  build: (b: Bus) => void;
}

// D major pentatonic and G major pentatonic, high, for sparkles
const D_PENTA = [86, 88, 90, 93, 95, 98, 100, 102];
const G_PENTA = [91, 93, 95, 98, 100, 103, 105, 107];

const RECIPES: Record<string, Recipe> = {
  /** Something thrown: air moving past, left to right. */
  whoosh: {
    seconds: 0.6,
    wet: 0.12,
    room: 0.6,
    peak: 0.5,
    build: (b) => {
      noise(b, 0, [[0.2, 1], [0.56, 0]], 'bandpass', [[0, 380], [0.22, 2400], [0.56, 800]], 0.9, -0.2);
      noise(b, 0, [[0.22, 0.18], [0.5, 0]], 'highpass', [[0, 3500], [0.5, 6500]], 0.7, 0.3);
    },
  },
  /** The +4 charging up: rising air and a rising fifth, cut off just before the hit. */
  riser: {
    seconds: 1.0,
    wet: 0.18,
    room: 0.9,
    peak: 0.5,
    build: (b) => {
      noise(b, 0, [[0.05, 0.05], [0.9, 1], [0.97, 0]], 'bandpass', [[0, 260], [0.95, 5200]], 1.6);
      const ctx = b.ctx;
      for (const [from, to, vol] of [
        [hz(43), hz(67), 0.5],
        [hz(50), hz(74), 0.35],
      ] as const) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.setValueAtTime(from, 0);
        o.frequency.exponentialRampToValueAtTime(to, 0.95);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(500, 0);
        lp.frequency.exponentialRampToValueAtTime(3000, 0.95);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, 0);
        g.gain.linearRampToValueAtTime(vol * 0.15, 0.1);
        g.gain.exponentialRampToValueAtTime(vol, 0.92);
        g.gain.linearRampToValueAtTime(0, 0.97);
        o.connect(lp);
        lp.connect(g);
        route(b, g);
        o.start(0);
        o.stop(1);
      }
    },
  },
  /** The +4 landing: a deep, round boom with a puff of air and a little room. */
  boom: {
    seconds: 1.4,
    wet: 0.22,
    room: 1.2,
    peak: 0.85,
    build: (b) => {
      thump(b, 0, 78, 38, 1.1, 1);
      // a body in the range small speakers (laptops, headsets) actually play
      thump(b, 0, 190, 100, 0.38, 0.5);
      noise(b, 0, [[0.005, 0.7], [0.32, 0]], 'lowpass', [[0, 1400], [0.3, 160]], 0.6);
      noise(b, 0, [[0.004, 0.4], [0.14, 0]], 'bandpass', [[0, 460], [0.14, 260]], 1.0);
      bell(b, hz(50), 0.0, 1.3, 0.25, 0, 0.6);
    },
  },
  /** A cascade of small bells, mostly rising (wild colour, last card, confetti). */
  sparkle: {
    seconds: 1.9,
    wet: 0.45,
    room: 1.6,
    peak: 0.45,
    build: (b) => {
      for (let i = 0; i < 9; i++) {
        const n = D_PENTA[Math.min(D_PENTA.length - 1, Math.floor(i * 0.8 + b.r() * 2))];
        bell(b, hz(n), 0.02 + i * 0.065, 0.9, 0.16 + 0.04 * b.r(), i % 2 ? 0.45 : -0.45);
      }
    },
  },
  /** The victory chord in G: a bloom of mallets and bells over a warm pad, with sparkles. */
  victory: {
    seconds: 3.4,
    wet: 0.35,
    room: 1.8,
    peak: 0.7,
    build: (b) => {
      // G3 D4 G4 B4 D5
      [55, 62, 67, 71, 74].forEach((n, i) => pad(b, hz(n), 0, 0.09, 1.7, 1.4, 0.13, (i - 2) * 0.25));
      [67, 71, 74, 79].forEach((n, i) => mallet(b, hz(n), 0.0 + i * 0.012, 1.2, 0.3, (i - 1.5) * 0.3));
      [79, 83, 86].forEach((n, i) => bell(b, hz(n), 0.0, 1.6, 0.12, (i - 1) * 0.4));
      thump(b, 0, 110, 92, 0.9, 0.35);
      for (let i = 0; i < 12; i++) {
        const n = G_PENTA[Math.floor(b.r() * G_PENTA.length)];
        bell(b, hz(n), 0.35 + i * 0.11 + b.r() * 0.04, 0.8, 0.07, b.r() * 1.4 - 0.7);
      }
    },
  },
  /** Reverse: a bell chord played backwards swells up, then a small forward chime. */
  reverse: {
    seconds: 1.25,
    wet: 0.3,
    room: 1.0,
    peak: 0.5,
    build: (b) => {
      // the swell (rendered into a buffer and reversed by `renderAll`)
      noise(b, 0.0, [[0.6, 0.0], [0.95, 0.25], [1.02, 0]], 'bandpass', [[0.6, 600], [1.0, 3200]], 1.2);
      mallet(b, hz(86), 1.0, 0.25, 0.35, 0.3);
      bell(b, hz(93), 1.03, 0.25, 0.12, -0.3);
    },
  },
  /** The bell chord used reversed inside `reverse`. */
  reverseBell: {
    seconds: 1.0,
    wet: 0.4,
    room: 1.0,
    peak: 0.5,
    build: (b) => {
      [74, 81, 86, 90].forEach((n, i) => bell(b, hz(n), 0, 0.95, 0.25, (i - 1.5) * 0.35));
    },
  },
  /** Last card: a soft double heartbeat. */
  heartbeat: {
    seconds: 1.15,
    wet: 0.1,
    room: 0.5,
    peak: 0.6,
    build: (b) => {
      for (const [t, v] of [
        [0, 1],
        [0.17, 0.65],
        [0.62, 0.9],
        [0.79, 0.55],
      ] as const) {
        thump(b, t, 92, 56, 0.22, v);
        thump(b, t, 185, 120, 0.1, v * 0.35);
        noise(b, t, [[0.004, 0.25 * v], [0.06, 0]], 'lowpass', [[0, 380], [0.06, 200]], 0.7);
      }
    },
  },
  /** One person clapping four times (an emote). */
  clap: {
    seconds: 1.3,
    wet: 0.22,
    room: 0.6,
    peak: 0.5,
    build: (b) => {
      for (let k = 0; k < 4; k++) {
        const t = k * 0.27 + b.r() * 0.02;
        const f = 1150 + b.r() * 350;
        for (const [dt, v] of [
          [0, 0.8],
          [0.008, 0.6],
          [0.017, 1],
        ] as const) {
          noise(b, t + dt, [[0.001, v], [dt === 0.017 ? 0.09 : 0.007, 0]], 'bandpass', [[0, f], [0.05, f * 0.92]], 1.1, (b.r() - 0.5) * 0.3);
        }
      }
    },
  },
  /** A cork pop: a quick upward bloop with a tiny click. */
  pop: {
    seconds: 0.3,
    wet: 0.12,
    room: 0.4,
    peak: 0.5,
    build: (b) => {
      const ctx = b.ctx;
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(240, 0);
      o.frequency.exponentialRampToValueAtTime(1100, 0.028);
      o.frequency.exponentialRampToValueAtTime(820, 0.11);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, 0);
      g.gain.linearRampToValueAtTime(1, 0.003);
      g.gain.setTargetAtTime(0, 0.02, 0.035);
      o.connect(g);
      route(b, g);
      o.start(0);
      o.stop(0.3);
      noise(b, 0, [[0.001, 0.5], [0.01, 0]], 'lowpass', [[0, 2600], [0.01, 1800]], 0.7);
    },
  },
  /** A rubber chicken: a squeeze in and a squeeze out. */
  squeak: {
    seconds: 0.6,
    wet: 0.1,
    room: 0.4,
    peak: 0.42,
    build: (b) => {
      const ctx = b.ctx;
      for (const [t, dur, from, to] of [
        [0, 0.2, 820, 1700],
        [0.26, 0.26, 1650, 760],
      ] as const) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.setValueAtTime(from, t);
        o.frequency.exponentialRampToValueAtTime(to, t + dur);
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 27;
        const depth = ctx.createGain();
        depth.gain.value = 45;
        lfo.connect(depth);
        depth.connect(o.frequency);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1500;
        bp.Q.value = 0.8;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(1, t + 0.018);
        g.gain.setValueAtTime(1, t + dur - 0.035);
        g.gain.linearRampToValueAtTime(0, t + dur);
        o.connect(bp);
        bp.connect(g);
        route(b, g);
        o.start(t);
        lfo.start(t);
        o.stop(t + dur + 0.02);
        lfo.stop(t + dur + 0.02);
      }
    },
  },
  /** A spring: a wobble that settles. */
  boing: {
    seconds: 0.75,
    wet: 0.12,
    room: 0.5,
    peak: 0.5,
    build: (b) => {
      const ctx = b.ctx;
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(170, 0);
      o.frequency.linearRampToValueAtTime(235, 0.6);
      const lfo = ctx.createOscillator();
      lfo.frequency.setValueAtTime(13, 0);
      lfo.frequency.linearRampToValueAtTime(9, 0.6);
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(95, 0);
      depth.gain.setTargetAtTime(0, 0, 0.18);
      lfo.connect(depth);
      depth.connect(o.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, 0);
      g.gain.linearRampToValueAtTime(1, 0.006);
      g.gain.setTargetAtTime(0, 0.05, 0.17);
      o.connect(g);
      route(b, g);
      o.start(0);
      lfo.start(0);
      o.stop(0.75);
      lfo.stop(0.75);
    },
  },
  /** A wet splat (pie, snowball): soft grains of noise over a low thud. */
  splat: {
    seconds: 0.55,
    wet: 0.12,
    room: 0.5,
    peak: 0.55,
    build: (b) => {
      thump(b, 0, 150, 70, 0.16, 0.8);
      for (let i = 0; i < 14; i++) {
        const t = b.r() * 0.18 * (i / 14) + i * 0.006;
        const len = 0.012 + b.r() * 0.02;
        const f = 700 + b.r() * 1500;
        noise(b, t, [[0.002, 0.9 * (1 - i / 16)], [len, 0]], 'lowpass', [[0, f], [len, f * 0.6]], 1.4, (b.r() - 0.5) * 0.5);
      }
    },
  },
};

/** Render every designed sound. Resolves with whatever rendered (a failure only skips that one). */
export async function renderDesignedSounds(): Promise<Map<string, AudioBuffer>> {
  const out = new Map<string, AudioBuffer>();
  const OAC = (globalThis as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
  if (!OAC) return out;
  let seed = 11;
  for (const [name, r] of Object.entries(RECIPES)) {
    try {
      const ctx = new OAC(2, Math.ceil(r.seconds * SR), SR);
      const bus = makeBus(ctx, r.wet, r.room, seed++);
      r.build(bus);
      out.set(name, finish(await ctx.startRendering(), r.peak));
    } catch {
      /* the caller falls back to something simpler */
    }
  }
  // Reverse: the bell chord backwards, then the swell's own tail and chime on top
  const bellBuf = out.get('reverseBell');
  const swell = out.get('reverse');
  if (bellBuf && swell) {
    const mixed = new AudioBuffer({ numberOfChannels: 2, length: swell.length, sampleRate: SR });
    for (let ch = 0; ch < 2; ch++) {
      const dst = mixed.getChannelData(ch);
      const src = bellBuf.getChannelData(Math.min(ch, bellBuf.numberOfChannels - 1));
      const sw = swell.getChannelData(ch);
      for (let i = 0; i < src.length && i < dst.length; i++) dst[i] = src[src.length - 1 - i] * 0.9;
      for (let i = 0; i < dst.length; i++) dst[i] += sw[i];
    }
    out.set('reverse', finish(mixed, 0.5));
    out.delete('reverseBell');
  }
  return out;
}
