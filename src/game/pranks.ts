/**
 * Harmless toys for sore losers: a foam dart, a rubber chicken, a confetti
 * popper and a squeaky hammer. Each one is short (under 1.2 s), small, never
 * covers anyone's cards or face for long, and is only aimed at players who
 * left "Pranks on me" switched on. There is a cooldown so nobody can spam.
 */
import {
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import type { PrankKind } from '../../shared/protocol.ts';
import type { Sound } from './audio.js';
import type { Effects } from './vfx.js';
import { faceTablePoint } from './util.js';

const COOLDOWN = 1.0;

interface Flight {
  kind: PrankKind;
  obj: Object3D;
  from: Vector3;
  to: Vector3;
  t: number;
  dur: number;
  hit: boolean;
  onHit: () => void;
}

const _v = new Vector3();
const _q = new Quaternion();
const UP = new Vector3(0, 1, 0);

function mat(color: number, rough = 0.6): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
}

function makeDart(): Object3D {
  const g = new Group();
  const body = new Mesh(new CylinderGeometry(0.009, 0.009, 0.07, 14), mat(0xff7a1a, 0.85));
  body.rotation.x = Math.PI / 2;
  const tip = new Mesh(new SphereGeometry(0.012, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x2b6cff, 0.4));
  tip.rotation.x = -Math.PI / 2;
  tip.position.z = -0.035;
  const fins = new Mesh(new ConeGeometry(0.016, 0.02, 3), mat(0x2b6cff, 0.7));
  fins.rotation.x = Math.PI / 2;
  fins.position.z = 0.04;
  g.add(body, tip, fins);
  return g;
}

function makeChicken(): Object3D {
  const g = new Group();
  const yellow = mat(0xffd23a, 0.45);
  const body = new Mesh(new CapsuleGeometry(0.018, 0.09, 6, 14), yellow);
  body.rotation.x = Math.PI / 2;
  const neck = new Mesh(new CapsuleGeometry(0.009, 0.05, 4, 10), yellow);
  neck.position.set(0, 0.03, -0.06);
  neck.rotation.x = 0.5;
  const head = new Mesh(new SphereGeometry(0.016, 14, 10), yellow);
  head.position.set(0, 0.058, -0.075);
  const comb = new Mesh(new SphereGeometry(0.008, 10, 8), mat(0xe2262c, 0.5));
  comb.scale.set(0.5, 1.2, 1.4);
  comb.position.set(0, 0.075, -0.075);
  const beak = new Mesh(new ConeGeometry(0.006, 0.018, 8), mat(0xff8a1f, 0.5));
  beak.rotation.x = -Math.PI / 2;
  beak.position.set(0, 0.056, -0.094);
  const eyeM = mat(0x111111, 0.3);
  for (const s of [-1, 1]) {
    const eye = new Mesh(new SphereGeometry(0.0028, 8, 6), eyeM);
    eye.position.set(0.012 * s, 0.063, -0.085);
    g.add(eye);
    const leg = new Mesh(new CylinderGeometry(0.002, 0.002, 0.04, 6), mat(0xff8a1f));
    leg.position.set(0.008 * s, -0.026, 0.02);
    g.add(leg);
  }
  g.add(body, neck, head, comb, beak);
  return g;
}

function makeHammer(): Object3D {
  const g = new Group();
  const head = new Mesh(new CylinderGeometry(0.035, 0.035, 0.11, 20), mat(0xe8323c, 0.35));
  head.rotation.z = Math.PI / 2;
  head.position.y = 0.22;
  for (const s of [-1, 1]) {
    const cap = new Mesh(new CylinderGeometry(0.037, 0.037, 0.012, 20), mat(0xffd23a, 0.4));
    cap.rotation.z = Math.PI / 2;
    cap.position.set(0.058 * s, 0.22, 0);
    g.add(cap);
  }
  const handle = new Mesh(new CylinderGeometry(0.009, 0.011, 0.22, 10), mat(0xffd23a, 0.4));
  handle.position.y = 0.11;
  g.add(head, handle);
  return g;
}

function makePopper(): Object3D {
  const g = new Group();
  const cone = new Mesh(new ConeGeometry(0.025, 0.08, 18, 1, true), mat(0x8b5cf6, 0.35));
  cone.rotation.x = Math.PI;
  const band = new Mesh(new CylinderGeometry(0.026, 0.026, 0.01, 18, 1, true), mat(0xffd23a, 0.3));
  band.position.y = 0.03;
  g.add(cone, band);
  return g;
}

function makeSnowball(): Object3D {
  const g = new Group();
  const ball = new Mesh(new SphereGeometry(0.032, 14, 10), new MeshStandardMaterial({ color: 0xf4f7ff, roughness: 0.95, metalness: 0, emissive: 0x9fb4ff, emissiveIntensity: 0.12 }));
  // a lumpy, hand-packed shape
  const pos = ball.geometry.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const k = 1 + 0.12 * Math.sin(pos.getX(i) * 140) * Math.cos(pos.getZ(i) * 120);
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
  }
  ball.geometry.computeVertexNormals();
  g.add(ball);
  return g;
}

function makePie(): Object3D {
  const g = new Group();
  const tin = new Mesh(new CylinderGeometry(0.06, 0.045, 0.022, 22), mat(0xc9ccd6, 0.35));
  const crust = new Mesh(new CylinderGeometry(0.058, 0.058, 0.012, 22), mat(0xd9a35b, 0.8));
  crust.position.y = 0.012;
  const cream = new Mesh(new SphereGeometry(0.056, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xfffaf0, 0.7));
  cream.scale.y = 0.45;
  cream.position.y = 0.016;
  const cherry = new Mesh(new SphereGeometry(0.011, 10, 8), mat(0xe2262c, 0.25));
  cherry.position.y = 0.045;
  g.add(tin, crust, cream, cherry);
  return g;
}

export class Pranks {
  readonly group = new Group();
  private flights: Flight[] = [];
  private cool = 0;
  /** The last few toys thrown (for diagnostics and tests). */
  readonly recent: PrankKind[] = [];
  private pool: Record<PrankKind, Object3D[]> = { dart: [], chicken: [], hammer: [], confetti: [], snowball: [], pie: [] };

  constructor(
    private readonly sound: Sound,
    private readonly fx: Effects,
  ) {
    this.group.name = 'Pranks';
  }

  /** Can you fire again yet? */
  ready(): boolean {
    return this.cool <= 0;
  }

  private static make(kind: PrankKind): Object3D {
    return kind === 'dart' ? makeDart() : kind === 'chicken' ? makeChicken() : kind === 'hammer' ? makeHammer() : kind === 'snowball' ? makeSnowball() : kind === 'pie' ? makePie() : makePopper();
  }

  /** Build one of each toy now, hidden in the scene, so the first throw builds and compiles nothing. */
  prewarm(): void {
    for (const kind of Object.keys(this.pool) as PrankKind[]) {
      if (this.pool[kind].length) continue;
      const o = Pranks.make(kind);
      o.visible = false;
      this.group.add(o);
      this.pool[kind].push(o);
    }
  }

  private take(kind: PrankKind): Object3D {
    const o = this.pool[kind].pop() ?? Pranks.make(kind);
    o.visible = true;
    this.group.add(o);
    return o;
  }

  /** Throw a toy from a to b (table space). onHit runs when it lands. */
  launch(kind: PrankKind, a: Vector3, b: Vector3, onHit: () => void): void {
    this.cool = COOLDOWN;
    this.recent.push(kind);
    if (this.recent.length > 8) this.recent.shift();
    const obj = this.take(kind);
    // aim a little above the head so nothing ever covers the face for long
    const to = b.clone().add(new Vector3(0, kind === 'hammer' ? 0.08 : 0.06, 0));
    const from = kind === 'hammer' ? to.clone().add(new Vector3(0, 0.05, 0)) : kind === 'confetti' ? to.clone().add(new Vector3(0, 0.35, 0)) : a.clone();
    const dur = kind === 'hammer' ? 0.55 : kind === 'confetti' ? 0.45 : 0.75;
    this.flights.push({ kind, obj, from, to, t: 0, dur, hit: false, onHit });
    if (kind === 'dart') this.sound.pop(a);
    if (kind === 'chicken') this.sound.squeak(a);
    if (kind === 'snowball' || kind === 'pie') this.sound.whoosh(a);
  }

  update(dt: number): void {
    this.cool -= dt;
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      const o = f.obj;
      if (f.kind === 'dart' || f.kind === 'chicken' || f.kind === 'snowball' || f.kind === 'pie') {
        // a lob that arcs over the table
        o.position.lerpVectors(f.from, f.to, k);
        o.position.y += Math.sin(Math.PI * k) * 0.28;
        _v.subVectors(f.to, f.from).normalize();
        if (f.kind === 'dart') {
          faceTablePoint(o, _v.multiplyScalar(-1).add(o.position));
          o.rotateX(-0.6 * (k - 0.5));
        } else if (f.kind === 'pie') {
          // the pie flies cream first, wobbling
          o.rotation.set(-Math.PI / 2 + Math.sin(k * 12) * 0.15, 0, k * 2);
        } else {
          o.rotation.set(k * 9, k * 5, k * 3);
        }
      } else if (f.kind === 'hammer') {
        // rise, then a quick bonk on top of the head
        o.position.copy(f.from);
        const swing = k < 0.55 ? -1.1 * (k / 0.55) : -1.1 + 2.0 * Math.min(1, (k - 0.55) / 0.2);
        _q.setFromAxisAngle(_v.set(1, 0, 0), swing);
        o.quaternion.copy(_q);
        o.position.y += 0.06 - (k > 0.75 ? 0.02 : 0);
        o.position.z += 0.18;
      } else {
        o.position.copy(f.from);
        o.quaternion.setFromAxisAngle(UP, k * 2);
      }
      const hitAt = f.kind === 'hammer' ? 0.75 : f.kind === 'confetti' ? 0.5 : 1;
      if (!f.hit && k >= hitAt) {
        f.hit = true;
        if (f.kind === 'hammer') this.sound.bonk(f.to);
        else if (f.kind === 'confetti') {
          this.sound.confetti(f.to);
          this.fx.burst(f.to.clone().add(new Vector3(0, 0.25, 0)), 60, 0.9, [0xff4fd8, 0xffd23a, 0x58c4ff, 0x7dff9a], -0.2);
        } else if (f.kind === 'snowball') {
          this.sound.splat(f.to, 0.6);
          this.fx.burst(f.to, 40, 0.7, [0xffffff, 0xeaf2ff, 0xcfe0ff], 0.1);
        } else if (f.kind === 'pie') {
          this.sound.splat(f.to, 1);
          this.fx.burst(f.to, 46, 0.6, [0xfffaf0, 0xfff1d6, 0xe2262c], 0.05);
          this.fx.word('splat', 'SPLAT!', ['#fffaf0', '#ffd6e0', '#e2262c'], f.to.clone().add(new Vector3(0, 0.16, 0)), 1.0, 0.2, '#ff8fb0', true);
        } else this.sound.boing(f.to);
        if (f.kind !== 'confetti' && f.kind !== 'snowball' && f.kind !== 'pie') this.fx.burst(f.to, 12, 0.5, [0xffffff, 0xffd23a]);
        f.onHit();
      }
      if (k >= 1 && f.t > f.dur + (f.kind === 'hammer' ? 0.15 : 0.05)) {
        o.visible = false;
        o.removeFromParent();
        this.pool[f.kind].push(o);
        this.flights.splice(i, 1);
      }
    }
  }
}
