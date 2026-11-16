/**
 * Small fixed pools for sparks, bubbles, droplets and ground ripples.
 * Nothing here allocates after construction.
 */
import { QuadField, SHAPE_RING } from './fx.js';

export class Particles {
  private max: number;
  private head = 0;
  private x: Float32Array;
  private y: Float32Array;
  private z: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private vz: Float32Array;
  private life: Float32Array;
  private dur: Float32Array;
  private size: Float32Array;
  private r: Float32Array;
  private g: Float32Array;
  private b: Float32Array;
  private shape: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;

  constructor(max: number) {
    this.max = max;
    const f = () => new Float32Array(max);
    this.x = f();
    this.y = f();
    this.z = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.life = f();
    this.dur = f();
    this.size = f();
    this.r = f();
    this.g = f();
    this.b = f();
    this.shape = f();
    this.grav = f();
    this.drag = f();
  }

  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    dur: number,
    size: number,
    r: number,
    g: number,
    b: number,
    shape = 0,
    grav = 0,
    drag = 0,
  ): void {
    const i = this.head;
    this.head = (i + 1) % this.max;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.life[i] = dur;
    this.dur[i] = dur;
    this.size[i] = size;
    this.r[i] = r;
    this.g[i] = g;
    this.b[i] = b;
    this.shape[i] = shape;
    this.grav[i] = grav;
    this.drag[i] = drag;
  }

  /** A burst in all directions. */
  burst(
    x: number,
    y: number,
    z: number,
    count: number,
    speed: number,
    dur: number,
    size: number,
    r: number,
    g: number,
    b: number,
    shape = 0,
    grav = 0,
    up = 0,
  ): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.acos(Math.random() * 2 - 1);
      const s = speed * (0.45 + Math.random() * 0.55);
      this.spawn(
        x,
        y,
        z,
        Math.cos(a) * Math.sin(e) * s,
        Math.cos(e) * s + up,
        Math.sin(a) * Math.sin(e) * s,
        dur * (0.6 + Math.random() * 0.4),
        size * (0.6 + Math.random() * 0.6),
        r,
        g,
        b,
        shape,
        grav,
        2.2,
      );
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vx[i] *= d;
      this.vy[i] = this.vy[i] * d - this.grav[i] * dt;
      this.vz[i] *= d;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.z[i] += this.vz[i] * dt;
    }
  }

  draw(f: QuadField): void {
    for (let i = 0; i < this.max; i++) {
      const l = this.life[i];
      if (l <= 0) continue;
      const k = l / this.dur[i];
      const a = Math.min(1, k * 2.2) * Math.min(1, (1 - k) * 8 + 0.2);
      f.add(this.x[i], this.y[i], this.z[i], this.size[i] * (0.6 + 0.4 * k), this.r[i], this.g[i], this.b[i], a, this.shape[i]);
    }
  }
}

/** Expanding rings that lie flat on the ground or water. */
export class Ripples {
  private max: number;
  private head = 0;
  private x: Float32Array;
  private y: Float32Array;
  private z: Float32Array;
  private t: Float32Array;
  private dur: Float32Array;
  private size: Float32Array;
  private r: Float32Array;
  private g: Float32Array;
  private b: Float32Array;

  constructor(max: number) {
    this.max = max;
    const f = () => new Float32Array(max);
    this.x = f();
    this.y = f();
    this.z = f();
    this.t = f();
    this.dur = f();
    this.size = f();
    this.r = f();
    this.g = f();
    this.b = f();
  }

  spawn(x: number, y: number, z: number, size: number, dur: number, r: number, g: number, b: number): void {
    const i = this.head;
    this.head = (i + 1) % this.max;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.t[i] = 0.0001;
    this.dur[i] = dur;
    this.size[i] = size;
    this.r[i] = r;
    this.g[i] = g;
    this.b[i] = b;
  }

  draw(f: QuadField, dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.t[i] <= 0) continue;
      this.t[i] += dt;
      const k = this.t[i] / this.dur[i];
      if (k >= 1) {
        this.t[i] = 0;
        continue;
      }
      const e = 1 - Math.pow(1 - k, 2.4);
      f.add(this.x[i], this.y[i], this.z[i], this.size[i] * (0.15 + 0.85 * e), this.r[i], this.g[i], this.b[i], (1 - k) * 0.85, SHAPE_RING);
    }
  }
}
