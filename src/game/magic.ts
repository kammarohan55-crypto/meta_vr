/**
 * Card magic: summoning circles, light pillars and the stack counter that layer over the
 * table's effects when special cards land (Draw Two / Draw Four and their stacks, Skip,
 * Reverse, Wild, the last card and the win). Everything is pooled; nothing allocates per frame.
 * Reduced effects shortens and softens it; reduced flashing removes the pulsing.
 */
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import { magicCircleTexture } from './arena-kit.js';
import { TABLE_Y } from './env.js';
import { faceTablePoint } from './util.js';

interface CircleFx {
  mesh: Mesh;
  mat: MeshBasicMaterial;
  t: number;
  dur: number;
  size: number;
  spin: number;
  facing: 'table' | 'viewer';
  at: Vector3;
}

interface PillarFx {
  mesh: Mesh;
  mat: MeshBasicMaterial;
  t: number;
  dur: number;
}


/** A soft vertical beam: bright core, fading up and at the edges. */
function beamTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const across = g.createLinearGradient(0, 0, 64, 0);
  across.addColorStop(0, 'rgba(255,255,255,0)');
  across.addColorStop(0.5, 'rgba(255,255,255,1)');
  across.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = across;
  g.fillRect(0, 0, 64, 256);
  g.globalCompositeOperation = 'destination-in';
  const up = g.createLinearGradient(0, 0, 0, 256);
  up.addColorStop(0, 'rgba(0,0,0,0)');
  up.addColorStop(0.7, 'rgba(0,0,0,0.8)');
  up.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = up;
  g.fillRect(0, 0, 64, 256);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export interface MagicSettings {
  reducedEffects: boolean;
  reducedFlashing: boolean;
}

export class Magic {
  readonly group = new Group();
  settings: MagicSettings = { reducedEffects: false, reducedFlashing: false };
  private circles: CircleFx[] = [];
  private pillars: PillarFx[] = [];
  /** The live stack: a circle under the pile that grows with every Draw card added. */
  private stackMesh: Mesh;
  private stackMat: MeshBasicMaterial;
  private stackTarget = 0;
  private stackShown = 0;
  private stackColor = new Color('#ff9a3c');
  private time = 0;
  private readonly pile = new Vector3();

  constructor() {
    this.group.name = 'CardMagic';
    const geo = new PlaneGeometry(1, 1);
    for (let i = 0; i < 10; i++) {
      const mat = new MeshBasicMaterial({ map: magicCircleTexture(0, 1024, 70), transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, toneMapped: false, side: DoubleSide, forceSinglePass: true });
      const mesh = new Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 36;
      mesh.raycast = () => {};
      this.group.add(mesh);
      this.circles.push({ mesh, mat, t: 0, dur: 0, size: 0, spin: 0, facing: 'table', at: new Vector3() });
    }
    const beam = beamTexture();
    const pGeo = new CylinderGeometry(0.11, 0.16, 1, 24, 1, true);
    pGeo.translate(0, 0.5, 0);
    for (let i = 0; i < 3; i++) {
      const mat = new MeshBasicMaterial({ map: beam, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, toneMapped: false, side: DoubleSide, forceSinglePass: true });
      const mesh = new Mesh(pGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 35;
      mesh.raycast = () => {};
      this.group.add(mesh);
      this.pillars.push({ mesh, mat, t: 0, dur: 0 });
    }
    this.stackMat = new MeshBasicMaterial({ map: magicCircleTexture(1, 1024, 71), transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, toneMapped: false, color: this.stackColor });
    this.stackMesh = new Mesh(geo, this.stackMat);
    this.stackMesh.rotation.x = -Math.PI / 2;
    this.stackMesh.visible = false;
    this.stackMesh.renderOrder = 34;
    this.stackMesh.raycast = () => {};
    this.group.add(this.stackMesh);
  }

  /**
   * Draw every circle style now (each is a large canvas) and hang one on each idle circle, so
   * the warm-up uploads them before the first special card instead of during it.
   */
  prewarm(): void {
    for (const style of [0, 1, 2] as const) this.circles[style].mat.map = magicCircleTexture(style, 1024, 70 + style);
  }

  /**
   * A summoning circle at `at` (table space): flat on the table, or upright facing the viewer.
   * `style`: 0 hexagram, 1 octagram, 2 seal (a slash through it, for Skip).
   */
  circle(at: Vector3, color: number | string, size: number, dur: number, style: 0 | 1 | 2 = 0, facing: 'table' | 'viewer' = 'table', spin = 1.2): void {
    const c = this.circles.find((x) => x.t >= x.dur) ?? this.circles[0];
    const reduced = this.settings.reducedEffects;
    c.t = 0;
    c.dur = reduced ? dur * 0.6 : dur;
    c.size = reduced ? size * 0.8 : size;
    c.spin = spin;
    c.facing = facing;
    c.at.copy(at);
    c.mat.map = magicCircleTexture(style, 1024, 70 + style);
    c.mat.color.set(color);
    c.mat.needsUpdate = true;
    c.mesh.visible = true;
  }

  /** A pillar of light rising from `at` (the chosen colour of a Wild, the winner). */
  pillar(at: Vector3, color: number | string, dur = 1.4): void {
    if (this.settings.reducedEffects) dur *= 0.6;
    const p = this.pillars.find((x) => x.t >= x.dur) ?? this.pillars[0];
    p.t = 0;
    p.dur = dur;
    p.mat.color.set(color);
    p.mesh.position.copy(at);
    p.mesh.visible = true;
  }

  /** The stack under the pile now owes `n` cards (0 clears it). */
  setStack(n: number, pile: Vector3): void {
    this.pile.copy(pile);
    this.stackTarget = n;
    // orange, then red, then violet as it grows
    this.stackColor.set(n >= 8 ? '#b26bff' : n >= 6 ? '#ff3b5c' : '#ff9a3c');
    if (n > 0) this.stackMesh.visible = true;
  }

  update(dt: number, viewer: Vector3): void {
    this.time += dt;
    const flash = this.settings.reducedFlashing ? 0 : 1;
    for (const c of this.circles) {
      if (c.t >= c.dur) {
        if (c.mesh.visible) c.mesh.visible = false;
        continue;
      }
      c.t += dt;
      const k = Math.min(1, c.t / c.dur);
      // bloom open quickly, hold, then fade while still turning
      const open = 1 - Math.pow(1 - Math.min(1, k / 0.22), 3);
      const fade = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      const s = c.size * (0.55 + 0.45 * open) * (1 + 0.06 * k);
      c.mesh.scale.set(s, s, s);
      c.mesh.position.copy(c.at);
      if (c.facing === 'table') {
        c.mesh.rotation.set(-Math.PI / 2, 0, c.spin * c.t);
      } else {
        faceTablePoint(c.mesh, viewer);
        c.mesh.rotateZ(c.spin * c.t);
      }
      c.mat.opacity = Math.max(0, open * fade) * (0.85 + 0.15 * flash * Math.sin(this.time * 18));
    }
    for (const p of this.pillars) {
      if (p.t >= p.dur) {
        if (p.mesh.visible) p.mesh.visible = false;
        continue;
      }
      p.t += dt;
      const k = Math.min(1, p.t / p.dur);
      const rise = 1 - Math.pow(1 - Math.min(1, k / 0.25), 3);
      p.mesh.scale.set(1 - 0.4 * k, 0.2 + 1.3 * rise, 1 - 0.4 * k);
      p.mat.opacity = (k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4) * 0.9;
    }
    // the stack circle eases towards its size; it pulses harder the bigger the stack
    this.stackShown += (this.stackTarget - this.stackShown) * (1 - Math.exp(-dt * 5));
    if (this.stackMesh.visible) {
      const n = this.stackShown;
      const size = 0.26 + 0.045 * n;
      const pulse = 1 + flash * 0.05 * Math.sin(this.time * (5 + n));
      this.stackMesh.scale.set(size * pulse, size * pulse, size * pulse);
      this.stackMesh.position.set(this.pile.x, TABLE_Y + 0.004, this.pile.z);
      this.stackMesh.rotation.z += dt * (0.6 + n * 0.15);
      this.stackMat.opacity = Math.min(0.95, n * 0.16);
      if (this.stackTarget === 0 && n < 0.05) this.stackMesh.visible = false;
    }
  }
}
