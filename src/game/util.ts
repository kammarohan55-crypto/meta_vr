/**
 * UNRULED: The Borrowed Sky — small math helpers shared by the whole game.
 * Three.js classes always come from '@iwsdk/core' (it re-exports Three).
 */
import { Vector3 } from '@iwsdk/core';
import type { Object3D } from '@iwsdk/core';

export const TAU = Math.PI * 2;

/**
 * Table space is the local space of the table root: origin at the table centre on the floor,
 * your seat toward +Z. Heads, hands, cards and effects are all kept in it. On a monitor the
 * table stands at the world origin, so table space and world space are the same; in a headset
 * the table is placed wherever the player sits, turned to face them, so they are not.
 */
let tableRoot: Object3D | null = null;

/** Set once by the app: the object whose local space is table space. */
export function setTableRoot(root: Object3D): void {
  tableRoot = root;
}

/** Convert a table-space point to world space, in place. */
export function tableToWorld(p: Vector3): Vector3 {
  return tableRoot ? p.applyMatrix4(tableRoot.matrixWorld) : p;
}

const _facing = new Vector3();

/**
 * Turn `obj` to face a table-space point (the viewer's head, usually). Object3D.lookAt wants a
 * world-space point; handing it a table-space one faced things the wrong way, even backwards,
 * for any player not seated at the tracking origin.
 */
export function faceTablePoint(obj: Object3D, p: Vector3): void {
  obj.lookAt(tableToWorld(_facing.copy(p)));
}

export const clamp = (x: number, a = 0, b = 1): number =>
  x < a ? a : x > b ? b : x;

export const lerp = (a: number, b: number, t: number): number =>
  a + (b - a) * t;

export const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Frame-rate independent exponential approach. */
export const damp = (
  cur: number,
  target: number,
  lambda: number,
  dt: number,
): number => cur + (target - cur) * (1 - Math.exp(-lambda * dt));

export function dampV(
  cur: Vector3,
  target: Vector3,
  lambda: number,
  dt: number,
): Vector3 {
  const k = 1 - Math.exp(-lambda * dt);
  cur.x += (target.x - cur.x) * k;
  cur.y += (target.y - cur.y) * k;
  cur.z += (target.z - cur.z) * k;
  return cur;
}

/** Shortest-path angle approach. */
export function dampAngle(
  cur: number,
  target: number,
  lambda: number,
  dt: number,
): number {
  let d = (target - cur) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return cur + d * (1 - Math.exp(-lambda * dt));
}

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeInOut = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeOutElastic = (t: number): number => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1;
};

/** Deterministic PRNG so the diorama is identical every launch. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

export function vnoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

export function fbm(x: number, y: number, oct = 4): number {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += vnoise(x, y) * amp;
    norm += amp;
    x = x * 2.03 + 17.1;
    y = y * 2.03 + 9.7;
    amp *= 0.5;
  }
  return sum / norm;
}

/** Distance from point p to segment ab, all in the XZ plane. */
export function distToSeg(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1e-9;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / l2);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/**
 * Mark a cached GPU resource (geometry, material or texture) as shared between worlds, so a
 * world's `dispose()` leaves it alone. Freeing a shared resource forces a re-upload and a shader
 * rebuild the next time anything uses it, which stalls a frame.
 */
export function keep<T extends { userData: Record<string, unknown> }>(x: T): T {
  x.userData.shared = true;
  return x;
}

/** Whether `keep()` marked this resource. */
export function isKept(x: unknown): boolean {
  return !!(x as { userData?: { shared?: boolean } } | null)?.userData?.shared;
}
