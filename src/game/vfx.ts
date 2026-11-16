/**
 * Event-driven effects. Every effect is triggered by a real game event from
 * the host, is brief, never moves the player's view and never flashes the
 * whole screen. "Reduced effects" trims particles and room dimming; "reduced
 * flashing" removes strobing and fast pulses.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  Quaternion,
  RingGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  SphereGeometry,
  Vector2,
  Vector3,
} from '@iwsdk/core';
import { CARD_H, CARD_W, COLOR_HEX, PRINT, makeCardMesh } from './cards.js';
import { TABLE_Y, TABLE_R } from './env.js';
import { QuadField, SHAPE_DOT, SHAPE_HALO, SHAPE_RING, SHAPE_SPARK } from './fx.js';
import { Particles } from './particles.js';
import { FONT_UI } from './ui.js';
import { TAU, clamp, easeOutBack, easeOutCubic, faceTablePoint, lerp } from './util.js';

const _v = new Vector3();
const _v2 = new Vector3();
const _m = new Matrix4();
const _q = new Quaternion();
const _col = new Color();
const RAINBOW = [0xff2d55, 0xff7a1a, 0xffd21a, 0x2bdc6b, 0x2d9bff, 0x8b5cf6, 0xff4fd8];
const _eul = new Euler();
const _s = new Vector3();
const X_AXIS = new Vector3(1, 0, 0);
const RIBBON_SEGMENTS = 48;
const GOLD_CONFETTI = [0xf4c968, 0xd8a747, 0xffe8aa, 0xfff3d6, 0xc8933b];

const RIBBON_VERTEX = /* glsl */ `
attribute vec3 color;
varying vec2 vUv;
varying vec3 vColor;
void main() {
  vUv = uv;
  vColor = color;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const RIBBON_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uMotion;
varying vec2 vUv;
varying vec3 vColor;
void main() {
  float edge = pow(max(0.0, 1.0 - abs(vUv.x * 2.0 - 1.0)), 1.2);
  float taper = pow(sin(vUv.y * 3.14159), 0.45);
  float flow = 0.7 + 0.3 * pow(0.5 + 0.5 * sin(vUv.y * 22.0 - uTime * 5.0 * uMotion), 2.0);
  float alpha = edge * taper * flow * uAlpha;
  if (alpha < 0.005) discard;
  gl_FragColor = vec4(vColor * (1.2 + edge * 0.7), alpha);
  #include <colorspace_fragment>
}`;

export interface VfxSettings {
  reducedEffects: boolean;
  reducedFlashing: boolean;
}

/** A floating hologram word, drawn into a canvas. */
class Holo {
  readonly mesh: Mesh;
  t = 0;
  dur = 0;
  pos = new Vector3();
  scale = 1;
  rise = 0.05;
  /** What is drawn now (text, colours and plate), so a reused hologram is redrawn only when it changes. */
  sig = '';
  private readonly canvas: HTMLCanvasElement;
  private readonly tex: CanvasTexture;
  private readonly laurels: boolean;
  constructor(text: string, colors: string[], size = 0.32, glow = '#fff', laurels = false, plate = false) {
    const c = document.createElement('canvas');
    c.width = laurels ? 1536 : 1024;
    c.height = 320;
    this.canvas = c;
    this.laurels = laurels;
    this.tex = new CanvasTexture(c);
    this.tex.colorSpace = SRGBColorSpace;
    this.draw(text, colors, glow, plate);
    const w = laurels ? size * 1.5 : size;
    this.mesh = new Mesh(
      new PlaneGeometry(w, (w * 320) / c.width),
      new MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, toneMapped: false, side: DoubleSide, forceSinglePass: true }),
    );
    this.mesh.renderOrder = 40;
    this.mesh.raycast = () => {};
    this.mesh.visible = false;
  }

  /**
   * Draw the lettering. The canvas keeps its size, so the texture is updated in place.
   * `plate` adds a dark rounded backing, for captions that must read against any background.
   */
  draw(text: string, colors: string[], glow: string, plate = false): void {
    this.sig = `${text}|${colors.join(',')}|${glow}|${plate ? 1 : 0}`;
    const c = this.canvas;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    if (this.laurels) {
      // golden laurel branches either side of the title
      for (const side of [-1, 1]) laurel(ctx, 768 + side * 600, 175, side, glow);
      ctx.translate(256, 0);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let fontSize = text.length > 7 ? 170 : 220;
    ctx.font = `800 ${fontSize}px ${FONT_UI}`;
    const room = plate ? 840 : 920;
    const measured = ctx.measureText(text).width;
    if (measured > room) {
      fontSize = Math.floor((fontSize * room) / measured);
      ctx.font = `800 ${fontSize}px ${FONT_UI}`;
    }
    if (plate) {
      const pw = Math.min(1010, ctx.measureText(text).width + fontSize * 1.1);
      const ph = Math.min(300, fontSize * 1.5);
      ctx.beginPath();
      ctx.roundRect(512 - pw / 2, 168 - ph / 2, pw, ph, ph / 2);
      ctx.fillStyle = 'rgba(14, 16, 30, 0.82)';
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = colors[1] ?? colors[0];
      ctx.stroke();
    }
    const g = ctx.createLinearGradient(0, 40, 0, 280);
    colors.forEach((col, i) => g.addColorStop(i / Math.max(1, colors.length - 1), col));
    // A dark bevel holds the lettering against bright faces and city lights.
    ctx.fillStyle = 'rgba(18, 13, 10, 0.85)';
    ctx.fillText(text, 514, 171);
    // A luminous projection, with a crisp readable core and restrained bloom.
    ctx.shadowColor = glow;
    ctx.shadowBlur = 18;
    ctx.lineWidth = 5;
    ctx.strokeStyle = colors[0];
    ctx.strokeText(text, 512, 165);
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeText(text, 512, 165);
    ctx.fillStyle = g;
    ctx.fillText(text, 512, 165);
    this.tex.needsUpdate = true;
  }
}

/** One laurel branch: a curved stem with paired gold leaves, opening upwards. */
function laurel(ctx: CanvasRenderingContext2D, x: number, y: number, side: number, glow: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(-side, 1);
  const gold = ctx.createLinearGradient(0, -140, 0, 140);
  gold.addColorStop(0, '#fff3c4');
  gold.addColorStop(0.5, '#ffcb47');
  gold.addColorStop(1, '#b7791f');
  ctx.shadowColor = glow;
  ctx.shadowBlur = 26;
  ctx.strokeStyle = gold;
  ctx.fillStyle = gold;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  // the stem: an arc from the bottom centre curving up and outwards
  const R = 150;
  ctx.beginPath();
  ctx.arc(R, 0, R, Math.PI * 0.6, Math.PI * 1.36);
  ctx.stroke();
  // pairs of pointed leaves along it, shrinking towards the tip
  for (let i = 0; i < 10; i++) {
    const a = Math.PI * (0.64 + i * 0.074);
    const px = R + Math.cos(a) * R;
    const py = Math.sin(a) * R;
    const tang = a + Math.PI / 2;
    const len = 40 - i * 1.6;
    for (const k of [-1, 1]) {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(tang + k * 0.62 + Math.PI);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(len * 0.42, -len * 0.5, 0, -len);
      ctx.quadraticCurveTo(-len * 0.42, -len * 0.5, 0, 0);
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
}

/** Outline of a card, for the orbiting holographic silhouettes. */
function cardOutlineTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 192;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = '#fff';
  ctx.shadowColor = '#fff';
  ctx.shadowBlur = 12;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.roundRect(10, 10, 108, 172, 12);
  ctx.stroke();
  ctx.font = `900 64px ${FONT_UI}`;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('+1', 64, 100);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function stopTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.translate(128, 128);
  ctx.shadowColor = '#ff3b3b';
  ctx.shadowBlur = 30;
  ctx.strokeStyle = '#ff5a5a';
  ctx.lineWidth = 16;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * TAU) / 8;
    ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * 100, Math.sin(a) * 100);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,60,60,0.25)';
  ctx.fill();
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.arc(0, 0, 52, 0, TAU);
  ctx.moveTo(-36, 36);
  ctx.lineTo(36, -36);
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function arrowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.shadowColor = '#7dd3fc';
  ctx.shadowBlur = 24;
  ctx.fillStyle = '#e0f2fe';
  ctx.beginPath();
  ctx.moveTo(240, 64);
  ctx.lineTo(150, 14);
  ctx.lineTo(150, 44);
  ctx.lineTo(20, 44);
  ctx.lineTo(20, 84);
  ctx.lineTo(150, 84);
  ctx.lineTo(150, 114);
  ctx.closePath();
  ctx.fill();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export class Effects {
  readonly group = new Group();
  readonly glow = new QuadField(1400, 'glow');
  private parts = new Particles(500);
  settings: VfxSettings = { reducedEffects: false, reducedFlashing: false };
  private holos = new Map<string, Holo>();
  private active: Holo[] = [];
  private orbit: Mesh[] = [];
  private orbitT = -1;
  private orbitCenter = new Vector3();
  private orbitColor = new Color();
  private heroCard!: Mesh;
  private energyLight = new PointLight(0xae72ff, 0, 3, 2);
  private ribbonPositions = new Float32Array((RIBBON_SEGMENTS + 1) * 8 * 3);
  private ribbonAttribute = new BufferAttribute(this.ribbonPositions, 3).setUsage(DynamicDrawUsage);
  private ribbons!: Mesh;
  private ribbonMaterial!: ShaderMaterial;
  private ribbonBlastT = -1;
  private chargeRings = new Group();
  private chargeRingMaterial = new MeshBasicMaterial({ color: 0x9edcff, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide, forceSinglePass: true, blending: AdditiveBlending, toneMapped: false });
  private stop: Mesh;
  private stopT = -1;
  private arrow: Mesh;
  private arrowT = -1;
  private arrowDir = 1;
  private crown: Group;
  private crownT = -1;
  private crownAt = new Vector3();
  /** Smaller when it floats over your own YOU WIN! title, close to your eyes. */
  private crownScale = 1;
  private confetti: InstancedMesh;
  private conf: { p: Vector3; v: Vector3; r: Vector3; w: Vector3; c: Color; life: number }[] = [];
  private beam: Mesh;
  private beamT = -1;
  private beamAt = new Vector3();
  private pulses: { from: Vector3; to: Vector3; t: number; color: Color }[] = [];
  private rings: { at: Vector3; t: number; dur: number; size: number; color: Color }[] = [];
  private time = 0;
  /** The risen Draw Four card, which the app animates. */
  readonly drawFourLift = new Vector3();

  constructor() {
    this.group.name = 'Effects';
    this.group.add(this.glow.mesh);
    this.heroCard = makeCardMesh({ color: -1, kind: 'wild4', value: -1 });
    this.heroCard.name = 'Draw Four floating card';
    this.heroCard.material = (this.heroCard.material as MeshStandardMaterial).clone();
    (this.heroCard.material as MeshStandardMaterial).transparent = true;
    (this.heroCard.material as MeshStandardMaterial).depthWrite = false;
    this.heroCard.castShadow = false;
    this.heroCard.visible = false;
    this.heroCard.raycast = () => {};
    this.group.add(this.heroCard);
    this.energyLight.position.set(0.07, TABLE_Y + 0.22, 0.02);
    this.group.add(this.energyLight);
    this.buildEnergyRibbons();
    const outline = cardOutlineTexture();
    for (let i = 0; i < 4; i++) {
      const m = new Mesh(
        new PlaneGeometry(CARD_W * 1.2, CARD_H * 1.2),
        new MeshBasicMaterial({ map: outline, transparent: true, depthWrite: false, blending: AdditiveBlending, color: COLOR_HEX[i], toneMapped: false, side: DoubleSide, forceSinglePass: true }),
      );
      m.visible = false;
      m.renderOrder = 38;
      m.raycast = () => {};
      this.orbit.push(m);
      this.group.add(m);
    }
    this.stop = new Mesh(new PlaneGeometry(0.2, 0.2), new MeshBasicMaterial({ map: stopTexture(), transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false, side: DoubleSide, forceSinglePass: true }));
    this.stop.visible = false;
    this.arrow = new Mesh(new PlaneGeometry(0.16, 0.08), new MeshBasicMaterial({ map: arrowTexture(), transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false, side: DoubleSide, forceSinglePass: true }));
    this.arrow.visible = false;
    // a crown with real metal and gems
    this.crown = new Group();
    const prof: Vector2[] = [];
    for (let i = 0; i <= 24; i++) {
      const a = i / 24;
      prof.push(new Vector2(0.075 + 0.006 * Math.sin(a * Math.PI), a * 0.06));
    }
    const band = new Mesh(new LatheGeometry(prof, 40), new MeshStandardMaterial({ color: 0xd7b265, metalness: 1, roughness: 0.27, side: DoubleSide, emissive: 0x6b4500, emissiveIntensity: 0.08 }));
    this.crown.add(band);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const spike = new Mesh(new ConeGeometry(0.016, 0.05, 8), band.material);
      spike.position.set(Math.cos(a) * 0.078, 0.082, Math.sin(a) * 0.078);
      const gem = new Mesh(new SphereGeometry(0.009, 10, 8), new MeshStandardMaterial({ color: COLOR_HEX[i % 4], emissive: COLOR_HEX[i % 4], emissiveIntensity: 0.2, roughness: 0.1 }));
      gem.position.set(Math.cos(a) * 0.08, 0.03, Math.sin(a) * 0.08);
      this.crown.add(spike, gem);
    }
    this.crown.visible = false;
    // confetti: one instanced mesh of paper squares
    this.confetti = new InstancedMesh(new PlaneGeometry(0.014, 0.022), new MeshStandardMaterial({ side: DoubleSide, roughness: 0.6, metalness: 0.3 }), 360);
    this.confetti.count = 0;
    this.confetti.frustumCulled = false;
    // a soft spotlight cone (last card)
    this.beam = new Mesh(
      new ConeGeometry(0.28, 1.6, 32, 1, true),
      new MeshBasicMaterial({ color: 0xfff2c8, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, forceSinglePass: true }),
    );
    this.beam.visible = false;
    this.group.add(this.stop, this.arrow, this.crown, this.confetti, this.beam);
    for (const o of [this.confetti, this.beam, this.crown]) o.traverse((c) => ((c as Mesh).raycast = () => {}));
  }

  /** Four continuous coloured strands share one mesh and fixed vertex storage. */
  private buildEnergyRibbons(): void {
    const geometry = new BufferGeometry();
    const vertices = (RIBBON_SEGMENTS + 1) * 8;
    const colors = new Float32Array(vertices * 3);
    const uvs = new Float32Array(vertices * 2);
    const indices = new Uint16Array(RIBBON_SEGMENTS * 4 * 6);
    for (let strand = 0; strand < 4; strand++) {
      _col.setHex(COLOR_HEX[strand]);
      for (let step = 0; step <= RIBBON_SEGMENTS; step++) {
        for (let side = 0; side < 2; side++) {
          const v = (strand * (RIBBON_SEGMENTS + 1) + step) * 2 + side;
          colors.set([_col.r, _col.g, _col.b], v * 3);
          uvs.set([side, step / RIBBON_SEGMENTS], v * 2);
        }
        if (step < RIBBON_SEGMENTS) {
          const v = (strand * (RIBBON_SEGMENTS + 1) + step) * 2;
          indices.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], (strand * RIBBON_SEGMENTS + step) * 6);
        }
      }
    }
    geometry.setAttribute('position', this.ribbonAttribute);
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
    geometry.setIndex(new BufferAttribute(indices, 1));
    this.ribbonMaterial = new ShaderMaterial({ vertexShader: RIBBON_VERTEX, fragmentShader: RIBBON_FRAGMENT,
      uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 }, uMotion: { value: 1 } },
      transparent: true, depthWrite: false, side: DoubleSide, forceSinglePass: true, blending: AdditiveBlending, toneMapped: false });
    this.ribbons = new Mesh(geometry, this.ribbonMaterial);
    this.ribbons.name = 'Draw Four rainbow energy ribbons';
    this.ribbons.visible = false;
    this.ribbons.frustumCulled = false;
    this.ribbons.raycast = () => {};
    const ringGeometry = new RingGeometry(0.23, 0.234, 96, 1, 0, TAU * 0.86);
    for (let i = 0; i < 2; i++) {
      const ring = new Mesh(ringGeometry, this.chargeRingMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.scale.setScalar(i === 0 ? 1 : 1.45);
      ring.raycast = () => {};
      this.chargeRings.add(ring);
    }
    this.chargeRings.name = 'Tabletop charging inlay';
    this.chargeRings.visible = false;
    this.group.add(this.ribbons, this.chargeRings);
  }

  private holo(key: string, text: string, colors: string[], size: number, glow: string, plate = false): Holo {
    let h = this.holos.get(key);
    if (!h) {
      h = new Holo(text, colors, size, glow, key === 'youwin', plate);
      this.holos.set(key, h);
      this.group.add(h.mesh);
    } else if (h.sig !== `${text}|${colors.join(',')}|${glow}|${plate ? 1 : 0}`) {
      // one hologram per key: a new caption (e.g. who played what) redraws it in place
      h.draw(text, colors, glow, plate);
    }
    return h;
  }

  /** Show a hologram word at `at`, rising slightly, for `dur` seconds. `plate` backs it for legibility. */
  word(key: string, text: string, colors: string[], at: Vector3, dur = 1.6, size = 0.34, glow = '#fff', plate = false): void {
    const h = this.holo(key, text, colors, size, glow, plate);
    h.pos.copy(at);
    h.t = 0;
    h.dur = dur;
    h.mesh.visible = true;
    if (!this.active.includes(h)) this.active.push(h);
  }

  ring(at: Vector3, size: number, dur: number, color: Color | number): void {
    this.rings.push({ at: at.clone(), t: 0, dur, size, color: new Color(color as number) });
  }

  burst(at: Vector3, count: number, speed: number, colors: number[], up = 0.4): void {
    const n = this.settings.reducedEffects ? Math.ceil(count * 0.35) : count;
    const c = new Color();
    for (let i = 0; i < n; i++) {
      c.setHex(colors[i % colors.length]);
      this.parts.burst(at.x, at.y, at.z, 1, speed, 0.9, 0.022, c.r * 1.6, c.g * 1.6, c.b * 1.6, i % 3 ? SHAPE_SPARK : SHAPE_DOT, 0.6, up);
    }
  }

  // ---------------------------------------------------------------- signature moments

  /** Draw Four, part one: the card rises, four silhouettes orbit, energy builds. */
  drawFourCharge(pileTop: Vector3, color: number): void {
    this.orbitT = 0;
    this.ribbonBlastT = -1;
    this.chargeRingMaterial.color.setHex(0x9cd6ff);
    this.orbitCenter.copy(pileTop).add(_v.set(0, 0.24, 0));
    this.drawFourLift.copy(this.orbitCenter);
    this.orbitColor.setHex(color);
    this.energyLight.color.setHex(0xae72ff);
    this.energyLight.position.copy(this.orbitCenter);
    for (const m of this.orbit) m.visible = true;
    this.word('draw4', '+4', ['#fff1f4', '#ff3b5c', '#c0102c'], _v.copy(pileTop).add(new Vector3(0, 0.55, 0.05)), 2.4, 0.75, '#ff2d55');
  }

  /** Draw Four, part two: the explosion. */
  drawFourBlast(): void {
    const at = this.orbitCenter;
    this.burst(at, 90, 0.9, COLOR_HEX, 0.3);
    this.ring(_v.set(at.x, TABLE_Y + 0.003, at.z), 1.5, 1.0, 0xff5ab0);
    this.ring(_v.set(at.x, TABLE_Y + 0.004, at.z), 1.0, 0.8, 0x7dd3fc);
    this.orbitT = -1;
    this.ribbonBlastT = 0;
    for (const m of this.orbit) m.visible = false;
  }

  /** Draw Two: two glowing cards launch, a pulse runs across the table. */
  drawTwo(from: Vector3, to: Vector3): void {
    this.pulses.push({ from: new Vector3(from.x, TABLE_Y + 0.004, from.z), to: new Vector3(to.x, TABLE_Y + 0.004, to.z), t: 0, color: new Color(0xffd166) });
    this.word('draw2', '+2', ['#fff5cc', '#ffbf3c', '#c46a00'], _v.copy(from).add(new Vector3(0, 0.36, 0)), 1.4, 0.3, '#ffae00');
  }

  skip(head: Vector3): void {
    this.stop.position.copy(head).add(_v.set(0, 0.28, 0));
    this.stopT = 0;
    this.stop.visible = true;
  }

  reverse(direction: 1 | -1): void {
    this.arrowT = 0;
    this.arrowDir = direction;
    this.arrow.visible = true;
  }

  colorChange(color: number): void {
    const c = new Color(COLOR_HEX[color]);
    this.ring(_v.set(0, TABLE_Y + 0.003, 0), 1.6, 1.2, c);
    this.burst(_v.set(0.07, TABLE_Y + 0.05, 0.02), 30, 0.4, [COLOR_HEX[color]], 0.5);
  }

  lastCard(head: Vector3): void {
    this.beamAt.copy(head);
    this.beamT = 0;
    this.beam.visible = true;
    this.word('last', 'LAST CARD!', ['#fef3c7', '#fbbf24', '#b45309'], _v.copy(head).add(new Vector3(0, 0.42, 0)), 1.8, 0.4, '#f59e0b');
  }

  win(head: Vector3, mine: boolean, viewer: Vector3): void {
    this.energyLight.color.setHex(0xffc967);
    this.energyLight.position.set(0, TABLE_Y + 0.22, 0);
    this.crownAt.copy(head).add(_v.set(0, 0.2, 0));
    this.crownScale = mine ? 0.42 : 1;
    this.crownT = 0;
    this.crown.visible = true;
    const n = this.settings.reducedEffects ? 120 : 360;
    this.conf = [];
    const c = new Color();
    for (let i = 0; i < n; i++) {
      c.setHex(GOLD_CONFETTI[i % GOLD_CONFETTI.length]);
      this.conf.push({
        p: new Vector3((Math.random() - 0.5) * 0.4, TABLE_Y + 0.05, (Math.random() - 0.5) * 0.4),
        v: new Vector3((Math.random() - 0.5) * 2.2, 2.4 + Math.random() * 1.6, (Math.random() - 0.5) * 2.2),
        r: new Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        w: new Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14),
        c: c.clone(),
        life: 5 + Math.random() * 2,
      });
    }
    this.ring(_v.set(0, TABLE_Y + 0.003, 0), 2.2, 1.8, 0xffc94a);
    this.chargeRingMaterial.color.setHex(0xffd484);
    const at = _v.copy(viewer).lerp(new Vector3(0, TABLE_Y + 0.4, 0), 0.62);
    if (mine) {
      this.word('youwin', 'YOU WIN!', ['#fff7d6', '#ffd166', '#c98a12'], at, 4.5, 0.62, '#ffb703');
      // your crown floats over the title (you can't see one on your own head)
      this.crownAt.copy(at).add(_v2.set(0, 0.11, 0));
    }
  }

  lose(viewer: Vector3): void {
    const at = _v.copy(viewer).lerp(new Vector3(0, TABLE_Y + 0.4, 0), 0.62);
    this.word('youlose', 'YOU LOSE', ['#ffe5de', '#ed9185', '#974f5c'], at, 3.5, 0.58, '#ef8d77');
    this.word('rematchPrompt', 'NEXT ROUND?', ['#fff0d9', '#d7bf9b'], _v2.copy(at).add(new Vector3(0, -0.17, 0)), 3.5, 0.32, '#bd9970');
  }

  // ---------------------------------------------------------------- frame

  update(dt: number, viewer: Vector3): void {
    this.time += dt;
    const t = this.time;
    const flash = this.settings.reducedFlashing ? 0 : 1;
    const g = this.glow;
    g.begin();

    for (let i = this.active.length - 1; i >= 0; i--) {
      const h = this.active[i];
      h.t += dt;
      const k = h.t / h.dur;
      if (k >= 1) {
        h.mesh.visible = false;
        this.active.splice(i, 1);
        continue;
      }
      const intro = easeOutCubic(clamp(h.t / 0.42));
      const fade = clamp((1 - k) * 4) * clamp(h.t / 0.18);
      h.mesh.position.copy(h.pos);
      h.mesh.position.y += k * h.rise - 0.025 * (1 - intro);
      h.mesh.scale.setScalar(0.94 + 0.06 * intro);
      (h.mesh.material as MeshBasicMaterial).opacity = fade;
      faceTablePoint(h.mesh, viewer);
    }

    // Draw Four orbit
    if (this.orbitT >= 0) {
      this.orbitT += dt;
      const c = this.orbitCenter;
      const spin = this.orbitT * 5;
      const r = 0.12 + 0.05 * Math.sin(this.orbitT * 3);
      this.orbit.forEach((m, i) => {
        const a = spin + (i * TAU) / 4;
        m.position.set(c.x + Math.cos(a) * r, c.y + Math.sin(a * 2) * 0.03, c.z + Math.sin(a) * r);
        faceTablePoint(m, viewer);
        (m.material as MeshBasicMaterial).opacity = clamp(this.orbitT * 3) * 0.95;
        g.add(m.position.x, m.position.y, m.position.z, 0.09, 1, 1, 1, 0.25, SHAPE_HALO);
      });
      // energy gathering
      if (!this.settings.reducedEffects && Math.random() < 0.7) {
        const a = Math.random() * TAU;
        _col.setHex(COLOR_HEX[Math.floor(Math.random() * 4)]);
        this.parts.spawn(c.x + Math.cos(a) * 0.35, c.y - 0.1, c.z + Math.sin(a) * 0.35, -Math.cos(a) * 0.9, 0.3, -Math.sin(a) * 0.9, 0.4, 0.015, _col.r * 1.6, _col.g * 1.6, _col.b * 1.6, SHAPE_SPARK);
      }
      g.add(c.x, c.y, c.z, 0.5, this.orbitColor.r, this.orbitColor.g, this.orbitColor.b, 0.12 + 0.04 * Math.sin(t * 5) * flash);
      // a rainbow fountain of energy streaks rising out of the pile
      if (!this.settings.reducedEffects) {
        const n = Math.min(14, Math.ceil(dt * 360));
        for (let i = 0; i < n; i++) {
          const a = Math.random() * TAU;
          const out = 0.25 + Math.random() * 0.55;
          const hue = RAINBOW[Math.floor(Math.random() * RAINBOW.length)];
          _col.setHex(hue);
          this.parts.spawn(c.x + Math.cos(a) * 0.03, TABLE_Y + 0.03, c.z + Math.sin(a) * 0.03, Math.cos(a) * out, 1.5 + Math.random() * 1.1, Math.sin(a) * out, 0.6 + Math.random() * 0.35, 0.034, _col.r * 2.2, _col.g * 2.2, _col.b * 2.2, SHAPE_SPARK, -1.2);
        }
        g.add(c.x, TABLE_Y + 0.02, c.z, 0.8, 1, 0.45, 0.85, 0.3 * flash + 0.15);
      }
    }

    this.updateEnergyRibbons(dt, viewer);

    // skip
    if (this.stopT >= 0) {
      this.stopT += dt;
      const k = this.stopT / 1.4;
      this.stop.scale.setScalar(easeOutBack(clamp(this.stopT / 0.3)) * (1 + Math.sin(this.stopT * 18) * 0.04 * flash));
      (this.stop.material as MeshBasicMaterial).opacity = clamp((1 - k) * 3);
      faceTablePoint(this.stop, viewer);
      if (k >= 1) {
        this.stopT = -1;
        this.stop.visible = false;
      }
    }

    // reverse: an arrow races around the rim leaving a trail
    if (this.arrowT >= 0) {
      this.arrowT += dt;
      const k = this.arrowT / 1.2;
      const a = -this.arrowDir * easeOutCubic(clamp(k)) * TAU * 1.0 + Math.PI / 2;
      const r = TABLE_R - 0.06;
      this.arrow.position.set(Math.cos(a) * r, TABLE_Y + 0.02, Math.sin(a) * r);
      const tangent = _v.set(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(-this.arrowDir);
      this.arrow.quaternion.setFromUnitVectors(X_AXIS, tangent);
      this.arrow.rotateX(-Math.PI / 2);
      for (let i = 1; i < 26; i++) {
        const b = a + this.arrowDir * i * 0.07;
        g.add(Math.cos(b) * r, TABLE_Y + 0.01, Math.sin(b) * r, 0.04 * (1 - i / 26), 0.5, 0.85, 1.4, (1 - i / 26) * 0.9 * clamp((1 - k) * 3), SHAPE_DOT);
      }
      if (k >= 1) {
        this.arrowT = -1;
        this.arrow.visible = false;
      }
    }

    // table pulses (Draw Two)
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.t += dt / 0.7;
      const at = _v.copy(p.from).lerp(p.to, easeOutCubic(clamp(p.t)));
      g.add(at.x, at.y, at.z, 0.18, p.color.r, p.color.g, p.color.b, 0.6 * clamp((1 - p.t) * 3), SHAPE_RING);
      g.add(at.x, at.y, at.z, 0.12, p.color.r, p.color.g, p.color.b, 0.5, SHAPE_HALO);
      if (p.t >= 1) this.pulses.splice(i, 1);
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) {
        this.rings.splice(i, 1);
        continue;
      }
      g.add(r.at.x, r.at.y, r.at.z, r.size * easeOutCubic(k), r.color.r * 1.4, r.color.g * 1.4, r.color.b * 1.4, (1 - k) * 0.8, SHAPE_RING);
    }

    // last-card spotlight
    if (this.beamT >= 0) {
      this.beamT += dt;
      const k = this.beamT / 2.2;
      this.beam.position.copy(this.beamAt).add(_v.set(0, 0.55, 0));
      (this.beam.material as MeshBasicMaterial).opacity = 0.16 * Math.sin(Math.PI * clamp(k));
      if (k >= 1) {
        this.beamT = -1;
        this.beam.visible = false;
      }
    }

    // crown
    if (this.crownT >= 0) {
      this.crownT += dt;
      const k = clamp(this.crownT / 0.8);
      this.crown.visible = true;
      this.crown.position.copy(this.crownAt);
      this.crown.position.y += lerp(0.5, 0, easeOutBack(k)) * this.crownScale + Math.sin(this.crownT * 2) * 0.01;
      this.crown.scale.setScalar(this.crownScale);
      this.crown.rotation.y = this.crownT * 0.8;
      g.add(this.crown.position.x, this.crown.position.y + 0.05, this.crown.position.z, 0.35, 1.0, 0.75, 0.3, 0.35);
      for (let i = 0; i < 6; i++) {
        const a = this.crownT * 1.5 + (i * TAU) / 6;
        g.add(this.crown.position.x + Math.cos(a) * 0.14, this.crown.position.y + 0.04 + Math.sin(a * 2) * 0.02, this.crown.position.z + Math.sin(a) * 0.14, 0.03, 1.8, 1.4, 0.6, 0.8, SHAPE_SPARK);
      }
    }

    // confetti
    let n = 0;
    for (const c of this.conf) {
      c.life -= dt;
      if (c.life <= 0) continue;
      c.v.y -= 3.2 * dt;
      c.v.multiplyScalar(1 - dt * 1.6);
      const insideTable = c.p.x * c.p.x + c.p.z * c.p.z < (TABLE_R - 0.025) ** 2;
      const landingY = insideTable ? TABLE_Y + 0.002 : 0.01;
      if (c.p.y < landingY && c.v.y < 0) {
        c.p.y = landingY;
        c.v.set(0, 0, 0);
        c.w.multiplyScalar(0.8);
      }
      c.p.addScaledVector(c.v, dt);
      c.r.addScaledVector(c.w, dt);
      _q.setFromEuler(_eul.set(c.r.x, c.r.y, c.r.z));
      _m.compose(c.p, _q, _s.set(1, 1, 1));
      this.confetti.setMatrixAt(n, _m);
      this.confetti.setColorAt(n, c.c);
      n++;
    }
    this.confetti.count = n;
    this.confetti.instanceMatrix.needsUpdate = true;
    if (this.confetti.instanceColor) this.confetti.instanceColor.needsUpdate = true;

    this.parts.update(dt);
    this.parts.draw(g);
    g.end();
  }

  private updateEnergyRibbons(dt: number, viewer: Vector3): void {
    const charge = this.orbitT >= 0;
    if (this.ribbonBlastT >= 0) this.ribbonBlastT += dt;
    const blast = this.ribbonBlastT >= 0 && this.ribbonBlastT < 0.7;
    if (this.ribbonBlastT >= 0.7) this.ribbonBlastT = -1;
    const victory = this.crownT >= 0 && this.crownT < 4.8;
    const lightPower = charge ? 2.8 * clamp(this.orbitT / 0.6) : blast ? 4 * (1 - this.ribbonBlastT / 0.7) ** 2 : victory ? 1.6 * clamp((4.8 - this.crownT) / 0.8) : 0;
    this.energyLight.intensity = lightPower * (this.settings.reducedEffects ? 0.3 : 1);
    this.heroCard.visible = charge || blast;
    if (this.heroCard.visible) {
      const rise = this.settings.reducedEffects ? 1 : easeOutCubic(clamp(this.orbitT / 0.55));
      const burst = blast ? clamp(this.ribbonBlastT / 0.7) : 0;
      this.heroCard.position.copy(this.orbitCenter);
      this.heroCard.position.y = TABLE_Y + 0.08 + 0.2 * (blast ? 1 : rise) + burst * 0.06;
      faceTablePoint(this.heroCard, viewer);
      this.heroCard.scale.setScalar(1.7 * (1 - burst * 0.3));
      (this.heroCard.material as MeshStandardMaterial).opacity = 1 - burst;
    }
    this.ribbons.visible = (charge || blast) && !this.settings.reducedEffects;
    this.chargeRings.visible = charge || blast || victory;
    if (!this.chargeRings.visible) return;
    const burst = blast ? clamp(this.ribbonBlastT / 0.7) : 0;
    const build = charge ? clamp(this.orbitT / 0.75) : 1;
    const alpha = blast ? (1 - burst) ** 1.7 : charge ? 0.3 + 0.7 * build : 0;
    const spin = this.settings.reducedFlashing ? 0.7 : 2.2;
    this.ribbonMaterial.uniforms.uTime.value = this.time;
    this.ribbonMaterial.uniforms.uAlpha.value = alpha * 0.88;
    this.ribbonMaterial.uniforms.uMotion.value = this.settings.reducedFlashing ? 0 : 1;
    if (this.ribbons.visible) {
      for (let strand = 0; strand < 4; strand++) {
        for (let step = 0; step <= RIBBON_SEGMENTS; step++) {
          const s = step / RIBBON_SEGMENTS;
          const a = this.time * spin + strand * TAU / 4 + s * TAU * 0.78;
          const r = 0.1 + Math.sin(s * Math.PI * 0.72) * 0.21 + burst * 0.5;
          const half = 0.003 + Math.sin(s * Math.PI) * 0.012;
          for (let side = 0; side < 2; side++) {
            const offset = r + (side === 0 ? -half : half);
            const p = ((strand * (RIBBON_SEGMENTS + 1) + step) * 2 + side) * 3;
            this.ribbonPositions[p] = this.orbitCenter.x + Math.cos(a) * offset;
            this.ribbonPositions[p + 1] = TABLE_Y + 0.018 + s * (0.39 + build * 0.1) + Math.sin(a) * 0.018;
            this.ribbonPositions[p + 2] = this.orbitCenter.z + Math.sin(a) * offset;
          }
        }
      }
      this.ribbonAttribute.needsUpdate = true;
    }
    this.chargeRings.position.set(charge || blast ? this.orbitCenter.x : 0,
      TABLE_Y + 0.006, charge || blast ? this.orbitCenter.z : 0);
    const ringAlpha = victory ? clamp((4.8 - this.crownT) / 0.8) * 0.6 : alpha * 0.72;
    this.chargeRingMaterial.opacity = ringAlpha * (this.settings.reducedEffects ? 0.5 : 1);
    this.chargeRings.scale.setScalar(victory ? 1.5 + Math.min(this.crownT, 3) * 0.08 : 1 + burst * 1.8);
    for (let i = 0; i < this.chargeRings.children.length; i++) {
      this.chargeRings.children[i].rotation.z = this.time * (i === 0 ? 0.55 : -0.4);
    }
  }

  clearWin(): void {
    this.crownT = -1;
    this.crown.visible = false;
    this.conf = [];
    this.orbitT = this.ribbonBlastT = -1;
    this.ribbons.visible = this.chargeRings.visible = false;
    this.heroCard.visible = false;
    this.energyLight.intensity = 0;
    for (const orbit of this.orbit) orbit.visible = false;
    for (const h of this.active) h.mesh.visible = false;
    this.active = [];
  }
}

/**
 * The four-colour selector projected above the table when you play a wild.
 * Pinch, poke or click a petal.
 */
export class ColorPicker {
  readonly group = new Group();
  readonly petals: Mesh[] = [];
  private t = -1;
  constructor() {
    this.group.name = 'ColorPicker';
    for (let i = 0; i < 4; i++) {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const ctx = c.getContext('2d')!;
      ctx.shadowColor = PRINT[i];
      ctx.shadowBlur = 40;
      ctx.fillStyle = PRINT[i];
      ctx.beginPath();
      ctx.arc(128, 128, 82, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 8;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.stroke();
      const tex = new CanvasTexture(c);
      tex.colorSpace = SRGBColorSpace;
      const m = new Mesh(new PlaneGeometry(0.1, 0.1), new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, side: DoubleSide, forceSinglePass: true }));
      m.name = `color-${i}`;
      m.userData.color = i;
      m.renderOrder = 41;
      this.petals.push(m);
      this.group.add(m);
    }
    this.group.visible = false;
  }
  show(at: Vector3): void {
    this.group.position.copy(at);
    this.group.visible = true;
    this.t = 0;
    for (const petal of this.petals) petal.scale.setScalar(0.01);
  }
  hide(): void {
    this.group.visible = false;
    this.t = -1;
  }
  get open(): boolean {
    return this.group.visible;
  }
  update(dt: number, viewer: Vector3, hover: number): void {
    if (!this.group.visible) return;
    this.t += dt;
    const k = easeOutCubic(clamp(this.t / 0.4));
    faceTablePoint(this.group, viewer);
    this.petals.forEach((m, i) => {
      const a = Math.PI / 4 + (i * TAU) / 4;
      m.position.set(Math.cos(a) * 0.085 * k, Math.sin(a) * 0.085 * k, 0);
      const targetScale = (hover === i ? 1.12 : 1) * Math.max(0.01, k);
      m.scale.setScalar(lerp(m.scale.x, targetScale, 1 - Math.exp(-dt * 18)));
    });
  }
  /** The petal nearest a fingertip (table space, like the hands), within reach. */
  near(p: Vector3): number {
    let best = -1;
    let bd = 0.05;
    for (const m of this.petals) {
      // group and petal are plain offsets under the table root, so this is the petal in table space
      const d = _v.copy(m.position).applyQuaternion(this.group.quaternion).add(this.group.position).distanceTo(p);
      if (d < bd) {
        bd = d;
        best = m.userData.color as number;
      }
    }
    return best;
  }
}

export { Object3D, SHAPE_DOT };
