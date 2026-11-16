/**
 * Spatial panels: layered ink glass with a fine illuminated edge, drawn into a canvas and shown
 * on a plane. Each button is a rectangle on that canvas. Panels answer to
 * mouse clicks, controller and hand rays (point and pinch) and direct finger
 * touch, through the SDK's pointer events, so every screen works hands-only.
 */
import {
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import { makeCardMesh } from './cards.js';

export const PX_PER_M = 1400;
export const FONT_UI = '"SF Pro Display", "Avenir Next", "Segoe UI", Roboto, "Noto Sans", system-ui, sans-serif';

export interface Button {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  description?: string;
  labelSize?: number;
  descriptionSize?: number;
  icon?: 'cards' | 'people' | 'key';
  kind?: 'primary' | 'ghost' | 'key' | 'toggle' | 'danger' | 'color';
  on?: boolean;
  disabled?: boolean;
  /** Custom drawing instead of the default button look. */
  paint?: (ctx: CanvasRenderingContext2D, b: Button, hover: boolean) => void;
}

export type Ctx = CanvasRenderingContext2D;

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

const _v = new Vector3();

export class Panel {
  readonly group = new Group();
  readonly mesh: Mesh;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: Ctx;
  W: number;
  H: number;
  buttons: Button[] = [];
  hover = '';
  private tex: CanvasTexture;
  private mat: MeshBasicMaterial;
  private painter: ((p: Panel) => void) | null = null;
  private onPress: ((id: string) => void) | null = null;
  private lastPress = 0;
  private readonly previousCanvas: HTMLCanvasElement;
  private readonly previousCtx: CanvasRenderingContext2D;
  private readonly motions = new Map<string, { hover: number; press: number }>();
  private pressed = '';
  private structure = '';
  private hasPrevious = false;
  private paintClock = 0;
  private dirty = false;
  private readonly baseWidth: number;
  private readonly baseHeight: number;
  private cinematicTitle = false;
  private backdropImage: HTMLImageElement | null = null;
  private backdropRequest = 0;
  private readonly titleCards: Mesh[] = [];
  /** Suppress travel, stagger and shimmer for the user's comfort setting. */
  reducedMotion = false;
  /** Used only by the illustrated title; all other panels settle when idle. */
  ambientMotion = false;
  opacity = 1;
  /** Seconds since the panel was last shown (for intro animation). */
  age = 0;

  constructor(name: string, wM: number, hM: number) {
    this.baseWidth = wM;
    this.baseHeight = hM;
    this.W = Math.round(wM * PX_PER_M);
    this.H = Math.round(hM * PX_PER_M);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.ctx = this.canvas.getContext('2d')!;
    this.previousCanvas = document.createElement('canvas');
    this.previousCanvas.width = this.W;
    this.previousCanvas.height = this.H;
    this.previousCtx = this.previousCanvas.getContext('2d')!;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.mat = new MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, side: DoubleSide, forceSinglePass: true, toneMapped: false });
    this.mesh = new Mesh(new PlaneGeometry(wM, hM), this.mat);
    this.mesh.name = name;
    this.mesh.renderOrder = 30;
    this.group.name = name;
    this.group.add(this.mesh);
    if (name === 'menu') {
      for (const face of [{ color: 2, kind: 'num' as const, value: 7 }, { color: -1, kind: 'wild4' as const, value: -1 }, { color: 0, kind: 'num' as const, value: 2 }]) {
        const card = makeCardMesh(face);
        card.name = `Launch card ${this.titleCards.length + 1}`;
        const material = (card.material as MeshStandardMaterial).clone();
        material.roughness = 0.38;
        material.emissive.setHex(0xffffff);
        material.emissiveMap = material.map;
        material.emissiveIntensity = 0.22;
        card.material = material;
        card.castShadow = false;
        card.visible = false;
        card.renderOrder = 31;
        this.titleCards.push(card);
        this.group.add(card);
      }
      // (the app sets the backdrop for the world it starts in; no default image is fetched)
    }
    const pick = (e: unknown): string => {
      const ev = e as { point?: Vector3; uv?: { x: number; y: number } };
      let u: number;
      let v: number;
      if (ev.uv) {
        u = ev.uv.x;
        v = 1 - ev.uv.y;
      } else if (ev.point) {
        _v.copy(ev.point);
        this.mesh.worldToLocal(_v);
        const dimensions = (this.mesh.geometry as PlaneGeometry).parameters;
        u = _v.x / dimensions.width + 0.5;
        v = 0.5 - _v.y / dimensions.height;
      } else return '';
      const px = u * this.W;
      const py = v * this.H;
      const b = this.buttons.find((b) => !b.disabled && px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h);
      return b ? b.id : '';
    };
    const m = this.mesh as unknown as { addEventListener(t: string, f: (e: unknown) => void): void };
    m.addEventListener('pointermove', (e) => {
      const id = pick(e);
      if (id !== this.hover) {
        this.hover = id;
        this.dirty = true;
      }
    });
    m.addEventListener('pointerleave', () => {
      if (this.hover || this.pressed) {
        this.hover = '';
        this.pressed = '';
        this.dirty = true;
      }
    });
    m.addEventListener('pointerdown', (e) => {
      this.pressed = pick(e);
      this.dirty = true;
    });
    m.addEventListener('pointerup', () => {
      this.pressed = '';
      this.dirty = true;
    });
    m.addEventListener('pointercancel', () => {
      this.pressed = '';
      this.dirty = true;
    });
    m.addEventListener('click', (e) => {
      const id = pick(e);
      const now = performance.now();
      // a poke and a ray can both fire for one touch: take the first
      if (id && now - this.lastPress > 220) {
        this.lastPress = now;
        this.onPress?.(id);
      }
    });
  }

  /** The launch screen has its own wide canvas; every other menu keeps its authored dimensions. */
  setCinematicTitle(on: boolean): void {
    if (on) this.setShape('title');
    else if (this.shape === 'title') this.setShape('menu');
  }

  private shape: 'menu' | 'title' | 'card' = 'menu';

  /**
   * The panel's shape: the standard menu, the wide cinematic title, or a narrow side card
   * (the avatar screen, which stands beside the hero it shows).
   */
  setShape(shape: 'menu' | 'title' | 'card'): void {
    if (this.shape === shape) return;
    this.shape = shape;
    const on = shape === 'title';
    this.cinematicTitle = on;
    const width = on ? 1.20 : shape === 'card' ? 0.52 : this.baseWidth;
    const height = on ? 0.675 : shape === 'card' ? 0.62 : this.baseHeight;
    this.W = Math.round(width * PX_PER_M);
    this.H = Math.round(height * PX_PER_M);
    this.canvas.width = this.previousCanvas.width = this.W;
    this.canvas.height = this.previousCanvas.height = this.H;
    // WebGL2 allocates immutable texture storage at the first upload's size. Without
    // releasing it, a smaller canvas only overwrites the top-left of the old texture,
    // the menu draws shrunken beside stale title art, and hits land off the buttons.
    this.tex.dispose();
    this.tex.needsUpdate = true;
    this.mesh.geometry.dispose();
    this.mesh.geometry = new PlaneGeometry(width, height);
    this.hasPrevious = false;
    this.structure = '';
    this.dirty = true;
    for (const card of this.titleCards) card.visible = on;
  }

  /**
   * Change the panel's size in metres. It keeps its bottom edge where it was, so a bar can open
   * upward into a taller tray without moving off its spot. Sideways it stays centred (`side` 0)
   * or keeps its right (1) or left (-1) edge in place.
   */
  resize(wM: number, hM: number, side: -1 | 0 | 1 = 0): void {
    const W = Math.round(wM * PX_PER_M);
    const H = Math.round(hM * PX_PER_M);
    this.mesh.position.x = (-side * (wM - this.baseWidth)) / 2;
    if (W === this.W && H === this.H) return;
    this.W = W;
    this.H = H;
    this.canvas.width = this.previousCanvas.width = W;
    this.canvas.height = this.previousCanvas.height = H;
    // (a WebGL2 texture keeps the size of its first upload: see setShape)
    this.tex.dispose();
    this.tex.needsUpdate = true;
    this.mesh.geometry.dispose();
    this.mesh.geometry = new PlaneGeometry(wM, hM);
    this.mesh.position.y = (hM - this.baseHeight) / 2;
    this.hasPrevious = false;
    this.structure = '';
    this.dirty = true;
  }

  /** Local art is used by the actual spatial canvas, including inside an immersive session. */
  setBackdropImage(url: string): void {
    const request = ++this.backdropRequest;
    const load = (path: string, fallback: boolean): void => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        if (request !== this.backdropRequest) return;
        this.backdropImage = image;
        this.dirty = true;
        if (this.visible) this.redraw();
      };
      image.onerror = () => {
        if (request === this.backdropRequest && !fallback) load('textures/frostpeak-title.jpg', true);
      };
      image.src = /^(?:https?:|data:|\/)/.test(path) ? path : `${(import.meta as unknown as { env: { BASE_URL: string } }).env.BASE_URL}${path}`;
    };
    load(url, url.endsWith('city-blue-hour.jpg'));
  }

  drawCinematicBackdrop(): void {
    const ctx = this.ctx;
    const time = this.reducedMotion ? 0 : this.age;
    ctx.save();
    roundRect(ctx, 4, 4, this.W - 8, this.H - 8, 24);
    ctx.clip();
    ctx.fillStyle = '#071014'; ctx.fillRect(0, 0, this.W, this.H);
    const image = this.backdropImage;
    if (image) {
      const scale = Math.min(this.W / image.naturalWidth, this.H / image.naturalHeight);
      const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
      ctx.drawImage(image, (this.W - width) / 2, (this.H - height) / 2, width, height);
    }
    const shade = ctx.createLinearGradient(0, 0, this.W, this.H * 0.28);
    shade.addColorStop(0, 'rgba(3,10,15,0.9)');
    shade.addColorStop(0.42, 'rgba(4,11,16,0.58)');
    shade.addColorStop(0.75, 'rgba(4,11,16,0.13)');
    shade.addColorStop(1, 'rgba(4,11,16,0.10)');
    ctx.fillStyle = shade; ctx.fillRect(0, 0, this.W, this.H);
    const floor = ctx.createLinearGradient(0, this.H * 0.43, 0, this.H);
    floor.addColorStop(0, 'rgba(3,8,12,0)'); floor.addColorStop(0.57, 'rgba(3,8,12,0.66)'); floor.addColorStop(1, 'rgba(3,8,12,0.98)');
    ctx.fillStyle = floor; ctx.fillRect(0, 0, this.W, this.H);
    const lightX = this.W * (0.73 + Math.sin(time * 0.16) * 0.06);
    const light = ctx.createRadialGradient(lightX, this.H * 0.2, 5, lightX, this.H * 0.2, this.W * 0.46);
    light.addColorStop(0, 'rgba(255,192,112,0.13)'); light.addColorStop(1, 'rgba(255,192,112,0)');
    ctx.fillStyle = light; ctx.fillRect(0, 0, this.W, this.H);
    ctx.restore();
    ctx.save();
    roundRect(ctx, 5, 5, this.W - 10, this.H - 10, 24);
    ctx.strokeStyle = 'rgba(230,211,169,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
  }

  /** Replace what the panel shows. `paint` draws backgrounds and text; buttons are drawn after. */
  set(buttons: Button[], paint: (p: Panel) => void, onPress: (id: string) => void): void {
    const nextStructure = buttons.map((b) => b.id).join('|');
    const entering = nextStructure !== this.structure;
    if (entering && this.painter && this.visible && !this.reducedMotion) {
      this.previousCtx.clearRect(0, 0, this.W, this.H);
      this.previousCtx.drawImage(this.canvas, 0, 0);
      this.hasPrevious = true;
    }
    this.structure = nextStructure;
    this.buttons = buttons;
    this.painter = paint;
    this.onPress = onPress;
    this.hover = '';
    this.pressed = '';
    this.motions.clear();
    for (const b of buttons) this.motions.set(b.id, { hover: 0, press: 0 });
    if (entering) this.age = 0;
    this.redraw();
  }

  redraw(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    this.painter?.(this);
    for (let i = 0; i < this.buttons.length; i++) {
      const b = this.buttons[i];
      const motion = this.motions.get(b.id);
      const intro = this.reducedMotion ? 1 : easeOut(Math.min(1, Math.max(0, (this.age - 0.10 - i * 0.025) / 0.42)));
      drawButton(ctx, b, this.hover === b.id, motion?.hover ?? 0, motion?.press ?? 0, intro);
    }
    if (this.hasPrevious) {
      const fade = this.reducedMotion ? 1 : Math.min(1, this.age / 0.28);
      if (fade < 1) {
        ctx.save(); ctx.globalAlpha = 1 - fade; ctx.drawImage(this.previousCanvas, 0, 0); ctx.restore();
      } else this.hasPrevious = false;
    }
    // One travelling highlight during entry. Once it settles this texture stays static.
    if (!this.reducedMotion && this.H > 240 && this.age > 0.18 && this.age < 1.65) {
      const t = (this.age - 0.18) / 1.47;
      const cx = 30 + (this.W - 60) * t;
      const shine = ctx.createLinearGradient(cx - 95, 0, cx + 95, 0);
      shine.addColorStop(0, 'rgba(237,218,175,0)');
      shine.addColorStop(0.5, `rgba(248,236,205,${(Math.sin(t * Math.PI) * 0.8).toFixed(3)})`);
      shine.addColorStop(1, 'rgba(237,218,175,0)');
      ctx.strokeStyle = shine; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(40, 12); ctx.lineTo(this.W - 40, 12); ctx.stroke();
    }
    this.tex.needsUpdate = true;
    this.dirty = false;
  }

  get visible(): boolean {
    return this.group.visible;
  }
  set visible(v: boolean) {
    const entering = v && !this.group.visible;
    this.group.visible = v;
    if (entering) {
      this.age = 0;
      this.hasPrevious = false;
      this.dirty = true;
    }
  }

  update(dt: number): void {
    if (!this.visible) return;
    this.age += dt;
    if (this.age >= 1.7 && this.age - dt < 1.7) this.dirty = true;
    const e = this.reducedMotion ? 1 : easeOut(Math.min(1, this.age / 0.62));
    this.mesh.scale.setScalar(0.985 + 0.015 * e);
    this.mesh.position.y = -0.012 * (1 - e);
    this.mat.opacity = e * this.opacity;
    if (this.cinematicTitle) {
      const time = this.reducedMotion ? 0 : this.age;
      for (let i = 0; i < this.titleCards.length; i++) {
        const card = this.titleCards[i];
        const offset = i - 1;
        card.position.set(0.31 + offset * 0.07, 0.03 - Math.abs(offset) * 0.018 + Math.sin(time * 0.64 + i * 0.7) * (this.reducedMotion ? 0 : 0.009), 0.055 + i * 0.012);
        card.rotation.set(0.015 + Math.sin(time * 0.38 + i) * 0.035, offset * -0.1 + Math.sin(time * 0.31 + i) * 0.055, offset * 0.27 + Math.sin(time * 0.48 + i) * 0.025);
        card.scale.setScalar(1.86 * (0.94 + e * 0.06));
      }
    }
    const intro = !this.reducedMotion && this.age < 1.7;
    let moving = intro || (!this.reducedMotion && this.ambientMotion);
    let interacting = intro;
    const hoverK = this.reducedMotion ? 1 : 1 - Math.exp(-dt * 17);
    const pressK = this.reducedMotion ? 1 : 1 - Math.exp(-dt * 28);
    for (const b of this.buttons) {
      const motion = this.motions.get(b.id)!;
      const h = this.hover === b.id && !b.disabled ? 1 : 0;
      const p = this.pressed === b.id && !b.disabled ? 1 : 0;
      if (Math.abs(h - motion.hover) > 0.002 || Math.abs(p - motion.press) > 0.002) {
        motion.hover += (h - motion.hover) * hoverK;
        motion.press += (p - motion.press) * pressK;
        moving = true;
        interacting = true;
      } else { motion.hover = h; motion.press = p; }
    }
    this.paintClock += dt;
    // the title's idle shimmer repaints a large canvas: 12 times a second is plenty for it,
    // while hover, presses and the entry animation keep the full 30
    const interval = interacting || this.dirty ? 1 / 30 : 1 / 12;
    if ((moving || this.dirty) && this.paintClock >= interval) {
      this.paintClock = 0;
      this.redraw();
    }
  }
}

function easeOut(t: number): number { return 1 - Math.pow(1 - t, 4); }

/** High-contrast ink glass: a soft reflected edge, never a bright opaque billboard. */
export function glass(ctx: Ctx, x: number, y: number, w: number, h: number, r = 22, accent = '#b8a888'): void {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.38)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 4;
  roundRect(ctx, x, y, w, h, r);
  const g = ctx.createLinearGradient(x, y, x + w * 0.35, y + h);
  g.addColorStop(0, 'rgba(29, 37, 39, 0.94)');
  g.addColorStop(0.35, 'rgba(16, 26, 29, 0.93)');
  g.addColorStop(1, 'rgba(9, 17, 22, 0.96)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  // Directional sheen keeps the centre quiet enough for readable copy.
  ctx.clip();
  const s = ctx.createLinearGradient(x, y, x + w * 0.68, y + h * 0.75);
  s.addColorStop(0, 'rgba(225,217,196,0.09)');
  s.addColorStop(0.45, 'rgba(189,196,255,0.0)');
  ctx.fillStyle = s;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  ctx.save();
  ctx.lineWidth = 1.5;
  const rim = ctx.createLinearGradient(x, y, x + w, y + h);
  rim.addColorStop(0, 'rgba(221,203,166,0.75)');
  rim.addColorStop(0.42, 'rgba(149,158,199,0.24)');
  rim.addColorStop(1, 'rgba(183,184,215,0.48)');
  ctx.strokeStyle = rim;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 6;
  roundRect(ctx, x + 1.5, y + 1.5, w - 3, h - 3, r);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(215,204,178,0.10)';
  roundRect(ctx, x + 6, y + 6, w - 12, h - 12, Math.max(2, r - 5));
  ctx.stroke();
  if (h > 240) {
    ctx.strokeStyle = 'rgba(214,194,155,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 18, y + 54); ctx.lineTo(x + 18, y + 29); ctx.lineTo(x + 29, y + 18); ctx.lineTo(x + 62, y + 18);
    ctx.moveTo(x + w - 62, y + h - 18); ctx.lineTo(x + w - 29, y + h - 18); ctx.lineTo(x + w - 18, y + h - 29); ctx.lineTo(x + w - 18, y + h - 54);
    ctx.stroke();
  }
  ctx.restore();
}

export function text(
  ctx: Ctx,
  s: string,
  x: number,
  y: number,
  size: number,
  opts: { weight?: number; color?: string; align?: CanvasTextAlign; base?: CanvasTextBaseline; max?: number; glow?: string } = {},
): void {
  ctx.save();
  ctx.font = `${opts.weight ?? 600} ${size}px ${FONT_UI}`;
  ctx.fillStyle = opts.color ?? '#f0ebdf';
  ctx.textAlign = opts.align ?? 'left';
  ctx.textBaseline = opts.base ?? 'middle';
  if (opts.glow) {
    ctx.shadowColor = opts.glow;
    ctx.shadowBlur = size * 0.10;
  }
  ctx.fillText(s, x, y, opts.max);
  ctx.restore();
}

export function drawButton(ctx: Ctx, b: Button, hover: boolean, hoverAmount = hover ? 1 : 0, press = 0, intro = 1): void {
  ctx.save();
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  ctx.translate(cx, cy + (1 - intro) * 11 - hoverAmount * 2 * (1 - press));
  const scale = 1 - press * 0.018;
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);
  ctx.globalAlpha = intro;
  if (b.paint) {
    b.paint(ctx, b, hover);
    ctx.restore();
    return;
  }
  const kind = b.kind ?? 'ghost';
  if (b.disabled) ctx.globalAlpha *= 0.44;
  const r = kind === 'key' ? 9 : Math.min(12, b.h / 4);
  roundRect(ctx, b.x, b.y, b.w, b.h, r);
  if (kind === 'primary') {
    const g = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
    g.addColorStop(0, '#eadfc5');
    g.addColorStop(0.55, '#d1bfa0');
    g.addColorStop(1, '#bda783');
    ctx.fillStyle = g;
    ctx.shadowColor = 'rgba(219,192,139,0.18)';
    ctx.shadowBlur = 6 + hoverAmount * 10;
    ctx.fill();
  } else if (kind === 'toggle' && b.on) {
    const g = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
    g.addColorStop(0, '#41485e'); g.addColorStop(1, '#2c354d');
    ctx.fillStyle = g;
    ctx.fill();
  } else if (kind === 'danger') {
    ctx.fillStyle = '#5e3535';
    ctx.fill();
  } else {
    const g = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
    g.addColorStop(0, 'rgba(48,78,73,0.36)');
    g.addColorStop(1, 'rgba(26,45,45,0.30)');
    ctx.fillStyle = g;
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  if (hoverAmount > 0) {
    ctx.fillStyle = `rgba(221,221,242,${(hoverAmount * 0.10).toFixed(3)})`;
    ctx.fill();
  }
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = `rgba(211,201,177,${(0.22 + hoverAmount * 0.56 + (kind === 'primary' || b.on ? 0.13 : 0)).toFixed(3)})`;
  ctx.stroke();
  // A fine highlight gives the glass an edge without filling it with bloom.
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.beginPath();
  ctx.moveTo(b.x + r, b.y + 3);
  ctx.lineTo(b.x + b.w - r, b.y + 3);
  ctx.stroke();
  if (b.label) {
    const size = kind === 'key' ? Math.min(b.h * 0.48, 46) : Math.min(b.h * 0.39, 36);
    const selected = kind === 'primary' || (kind === 'toggle' && b.on);
    if (b.description) {
      const tx = b.x + (b.icon ? 80 : 26);
      if (b.icon) drawActionIcon(ctx, b.icon, b.x + 38, b.y + b.h / 2, hover, kind === 'primary');
      text(ctx, b.label, tx, b.y + b.h * 0.38, b.labelSize ?? Math.min(32, b.h * 0.33), { weight: 600, color: kind === 'primary' ? '#25262d' : '#ede7da', max: b.w - (b.icon ? 110 : 52) });
      text(ctx, b.description, tx, b.y + b.h * 0.70, b.descriptionSize ?? Math.min(21, b.h * 0.21), { weight: 450, color: kind === 'primary' ? '#4c4b50' : '#a9adc1', max: b.w - (b.icon ? 110 : 52) });
    } else {
      text(ctx, b.label, b.x + b.w / 2, b.y + b.h / 2 + 1, size, { weight: selected ? 600 : 450, color: kind === 'primary' ? '#26272f' : '#e9e6de', align: 'center', max: b.w - 24 });
    }
  }
  ctx.restore();
}

function drawActionIcon(ctx: Ctx, icon: NonNullable<Button['icon']>, x: number, y: number, hover: boolean, dark = false): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = dark ? '#44414c' : hover ? '#eadfc9' : '#b7b6c7';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (icon === 'cards') {
    ctx.rotate(-0.18);
    roundRect(ctx, -16, -20, 28, 38, 5); ctx.stroke();
    ctx.rotate(0.35);
    roundRect(ctx, -8, -18, 28, 38, 5); ctx.stroke();
    text(ctx, '7', 6, 2, 22, { align: 'center', weight: 700, color: '#dce5ff' });
  } else if (icon === 'people') {
    ctx.beginPath(); ctx.arc(-7, -9, 7, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(13, -5, 5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-22, 16); ctx.bezierCurveTo(-22, -2, 8, -2, 8, 16); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(12, 4); ctx.quadraticCurveTo(27, 4, 26, 17); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.arc(-7, -4, 10, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 3); ctx.lineTo(19, 20); ctx.lineTo(25, 14); ctx.moveTo(12, 14); ctx.lineTo(17, 9); ctx.stroke();
  }
  ctx.restore();
}

/** Lay out a row of equal buttons. */
export function row(ids: [string, string][], x: number, y: number, w: number, h: number, gap: number, kind: Button['kind'] = 'ghost'): Button[] {
  const bw = (w - gap * (ids.length - 1)) / ids.length;
  return ids.map(([id, label], i) => ({ id, label, x: x + i * (bw + gap), y, w: bw, h, kind }));
}
