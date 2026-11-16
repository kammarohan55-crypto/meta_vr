/**
 * Physical cards. Every face is printed once into a single texture atlas (one
 * material and one draw call per card). Cards are real 3D slabs with rounded
 * corners and a visible paper edge.
 *
 * Design: the Afterhours deck, drawn for this game in its own art-deco style. The colour runs
 * almost to the edge of the card over a sunburst; a dark diamond medallion holds the value in
 * cream serif figures; two corners carry a dark index tab (value over suit) and the other two
 * the colour's suit. Every colour has a suit of its own (heart, sun, leaf, drop), so colour is
 * never the only cue. Wild cards are midnight blue with a four-colour sunburst and all four
 * suits. No third-party marks or trade dress.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  ExtrudeGeometry,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Shape,
} from '@iwsdk/core';
import type { Card, Color, Kind } from '../../shared/rules.ts';
import { keep } from './util.js';
import { shareDepthMaterials } from './draw-tuning.js';

/** Card size in metres: 1.25 x a standard card, which stays readable in a headset. */
export const CARD_W = 0.07;
export const CARD_H = 0.105;
export const CARD_T = 0.00045;
const RADIUS = 0.0065;

/** Print colours (sRGB). Warm, saturated, and distinct for colour-blind players via symbols. */
export const PRINT = ['#e5262e', '#ffbf12', '#1fa85a', '#1673e6'] as const;
const PRINT_DEEP = ['#a3141b', '#e08600', '#0d7a3b', '#0b4db0'] as const;
export const COLOR_HEX = [0xe0453c, 0xf6bf2b, 0x2bb062, 0x2d7fe3];
export const COLOR_LABEL = ['Red', 'Yellow', 'Green', 'Blue'] as const;
/** Small shape in each corner so colour is never the only cue. */
const COLOR_MARK = ['heart', 'sun', 'leaf', 'drop'] as const;

const CW = 224;
const CH = 336;
const COLS = 8;
const ROWS = 7;
export const ATLAS_W = CW * COLS;
export const ATLAS_H = CH * ROWS;

/** Atlas slot of each face design. */
export function faceSlot(c: { color: number; kind: Kind; value: number }): number {
  if (c.kind === 'wild') return 52;
  if (c.kind === 'wild4') return 53;
  const base = c.color * 13;
  if (c.kind === 'num') return base + c.value;
  if (c.kind === 'skip') return base + 10;
  if (c.kind === 'reverse') return base + 11;
  return base + 12;
}
export const BACK_SLOT = 54;
/** A plain white patch used for the paper edge. */
const EDGE_SLOT = 55;
/** The slim paper margin round the card art (px). It also keeps neighbouring faces in the atlas from bleeding into each other when the texture is drawn small. */
const B = 6;
/** Ink for values, rules and suits, and the dark of the medallion and index tabs. */
const CREAM = '#fff4dc';
const NIGHT = '#151726';
/** Lining serif figures on Windows, macOS and Quest alike (Georgia's figures hang below the line). */
const SERIF = '"Times New Roman", "Noto Serif", Times, serif';

type Ctx = CanvasRenderingContext2D;

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

const FONT = '"Avenir Next Condensed", "Roboto Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';

function mark(ctx: Ctx, kind: (typeof COLOR_MARK)[number], x: number, y: number, s: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.beginPath();
  if (kind === 'heart') {
    ctx.moveTo(0, 0.35);
    ctx.bezierCurveTo(-0.9, -0.25, -0.45, -0.95, 0, -0.45);
    ctx.bezierCurveTo(0.45, -0.95, 0.9, -0.25, 0, 0.35);
  } else if (kind === 'sun') {
    ctx.arc(0, 0, 0.32, 0, Math.PI * 2);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.moveTo(Math.cos(a) * 0.46, Math.sin(a) * 0.46);
      ctx.arc(Math.cos(a) * 0.52, Math.sin(a) * 0.52, 0.09, 0, Math.PI * 2);
    }
  } else if (kind === 'leaf') {
    ctx.moveTo(0, -0.55);
    ctx.quadraticCurveTo(0.6, 0, 0, 0.55);
    ctx.quadraticCurveTo(-0.6, 0, 0, -0.55);
  } else {
    ctx.moveTo(0, -0.6);
    ctx.bezierCurveTo(0.15, -0.3, 0.45, 0, 0.45, 0.2);
    ctx.arc(0, 0.2, 0.45, 0, Math.PI);
    ctx.bezierCurveTo(-0.45, 0, -0.15, -0.3, 0, -0.6);
  }
  ctx.fill();
  ctx.restore();
}

/** Paint a colour's suit (heart, sun, leaf or drop) in the current fill style: for the colour picker and other UI. */
export function paintSuit(ctx: Ctx, color: number, x: number, y: number, size: number): void {
  mark(ctx, COLOR_MARK[color & 3], x, y, size);
}

/** Skip: two chevrons running into a bar (the next player is jumped). Uses the current fill style. */
function skipGlyph(ctx: Ctx, s: number): void {
  for (const x of [-0.36, -0.04]) {
    ctx.beginPath();
    ctx.moveTo(s * x, -s * 0.3);
    ctx.lineTo(s * (x + 0.3), 0);
    ctx.lineTo(s * x, s * 0.3);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillRect(s * 0.3, -s * 0.3, s * 0.1, s * 0.6);
}

/** Reverse: two arrows passing each other (the order of play turns round). Uses the current fill and stroke styles. */
function reverseGlyph(ctx: Ctx, s: number): void {
  ctx.lineWidth = s * 0.11;
  ctx.lineCap = 'round';
  for (const k of [1, -1]) {
    ctx.save();
    ctx.scale(k, k);
    const y = -s * 0.17;
    ctx.beginPath();
    ctx.moveTo(-s * 0.36, y);
    ctx.lineTo(s * 0.14, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s * 0.4, y);
    ctx.lineTo(s * 0.12, y - s * 0.17);
    ctx.lineTo(s * 0.12, y + s * 0.17);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

/** Four-petal pinwheel in the four colours: the emblem on the card back. */
function pinwheel(ctx: Ctx, s: number): void {
  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI) / 2 + Math.PI / 4);
    const g = ctx.createLinearGradient(0, 0, s * 0.5, 0);
    g.addColorStop(0, PRINT_DEEP[i]);
    g.addColorStop(1, PRINT[i]);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(s * 0.5, -s * 0.32, s * 0.52, s * 0.02);
    ctx.quadraticCurveTo(s * 0.3, s * 0.12, 0, 0);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.06, 0, Math.PI * 2);
  ctx.fill();
}

/** The four suits in their colours round a centre: any colour will do (the Wild cards). */
function fourSuits(ctx: Ctx, reach: number, size: number): void {
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 - Math.PI / 2;
    ctx.fillStyle = PRINT[i];
    mark(ctx, COLOR_MARK[i], Math.cos(a) * reach, Math.sin(a) * reach * 1.18, size);
  }
}

/** A diamond with softened points, centred on the origin. */
function diamond(ctx: Ctx, w: number, h: number): void {
  const k = 0.1;
  ctx.beginPath();
  ctx.moveTo(-w * k, -h * (1 - k));
  ctx.quadraticCurveTo(0, -h, w * k, -h * (1 - k));
  ctx.lineTo(w * (1 - k), -h * k);
  ctx.quadraticCurveTo(w, 0, w * (1 - k), h * k);
  ctx.lineTo(w * k, h * (1 - k));
  ctx.quadraticCurveTo(0, h, -w * k, h * (1 - k));
  ctx.lineTo(-w * (1 - k), h * k);
  ctx.quadraticCurveTo(-w, 0, -w * (1 - k), -h * k);
  ctx.closePath();
}

function drawFace(ctx: Ctx, color: number, kind: Kind, value: number): void {
  const wild = kind === 'wild' || kind === 'wild4';
  const ink = wild ? '#262a44' : PRINT[color];
  const deep = wild ? '#0b0c16' : PRINT_DEEP[color];
  const rule = wild ? '#e2c483' : CREAM;
  // card stock: a slim paper margin, then colour almost to the edge
  ctx.fillStyle = '#f4efe2';
  rr(ctx, 0, 0, CW, CH, 18);
  ctx.fill();
  const g = ctx.createLinearGradient(0, 0, 0, CH);
  g.addColorStop(0, ink);
  g.addColorStop(1, deep);
  ctx.fillStyle = g;
  rr(ctx, B, B, CW - 2 * B, CH - 2 * B, 15);
  ctx.fill();

  // an art-deco sunburst behind the medallion (the four colours on a Wild: any of them will do)
  ctx.save();
  rr(ctx, B, B, CW - 2 * B, CH - 2 * B, 15);
  ctx.clip();
  ctx.translate(CW / 2, CH / 2);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.131;
    ctx.fillStyle = wild ? PRINT[i % 4] : '#ffffff';
    ctx.globalAlpha = wild ? 0.34 : 0.075;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, CH, a, a + Math.PI / 12);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // two fine rules frame the face
  ctx.strokeStyle = rule;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 2;
  rr(ctx, B + 6, B + 6, CW - 2 * (B + 6), CH - 2 * (B + 6), 11);
  ctx.stroke();
  ctx.globalAlpha = 0.32;
  ctx.lineWidth = 1.2;
  rr(ctx, B + 11, B + 11, CW - 2 * (B + 11), CH - 2 * (B + 11), 8);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // the medallion: a dark diamond, so the cream value reads on every colour (yellow included)
  ctx.save();
  ctx.translate(CW / 2, CH / 2);
  const mw = 86;
  const mh = 124;
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = NIGHT;
  diamond(ctx, mw, mh);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = rule;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 2.2;
  diamond(ctx, mw - 8, mh - 11);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // the value
  ctx.fillStyle = CREAM;
  ctx.strokeStyle = CREAM;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (kind === 'num') {
    ctx.font = `700 132px ${SERIF}`;
    ctx.fillText(String(value), 0, 6);
    if (value === 6 || value === 9) ctx.fillRect(-17, 56, 34, 4);
  } else if (kind === 'skip') skipGlyph(ctx, 96);
  else if (kind === 'reverse') reverseGlyph(ctx, 104);
  else if (kind === 'draw2') {
    ctx.font = `700 84px ${SERIF}`;
    ctx.fillText('+2', -2, 4);
  } else if (kind === 'wild4') {
    ctx.font = `700 84px ${SERIF}`;
    ctx.fillText('+4', -2, 4);
  } else fourSuits(ctx, 40, 34);
  ctx.restore();

  // Two corners carry a dark index tab (value over suit): it is what shows of a card in a fan.
  const idx = kind === 'num' ? String(value) : kind === 'draw2' ? '+2' : kind === 'wild4' ? '+4' : '';
  for (const flip of [false, true]) {
    ctx.save();
    if (flip) {
      ctx.translate(CW, CH);
      ctx.rotate(Math.PI);
    }
    ctx.fillStyle = NIGHT;
    rr(ctx, B + 11, B + 11, 56, 92, 10);
    ctx.fill();
    ctx.strokeStyle = rule;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1.4;
    rr(ctx, B + 11, B + 11, 56, 92, 10);
    ctx.stroke();
    ctx.globalAlpha = 1;
    const cx = B + 39;
    ctx.fillStyle = CREAM;
    ctx.strokeStyle = CREAM;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (idx) {
      ctx.font = `700 ${idx.length > 1 ? 36 : 48}px ${SERIF}`;
      ctx.fillText(idx, cx, B + 42);
    } else {
      ctx.save();
      ctx.translate(cx, B + 40);
      if (kind === 'skip') skipGlyph(ctx, 38);
      else if (kind === 'reverse') reverseGlyph(ctx, 42);
      else fourSuits(ctx, 11, 11);
      ctx.restore();
    }
    // the suit under the value, in the card's own colour (all four on a Wild Draw Four)
    if (!wild) {
      ctx.fillStyle = PRINT[color];
      mark(ctx, COLOR_MARK[color], cx, B + 82, 17);
    } else if (kind === 'wild4') {
      ctx.save();
      ctx.translate(cx, B + 80);
      fourSuits(ctx, 8.5, 8.5);
      ctx.restore();
    }
    // the opposite corner pair: the suit alone, large
    if (!wild) {
      ctx.fillStyle = CREAM;
      ctx.globalAlpha = 0.88;
      mark(ctx, COLOR_MARK[color], CW - B - 36, B + 40, 30);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
}

function drawBack(ctx: Ctx): void {
  ctx.fillStyle = '#fbf8f1';
  rr(ctx, 0, 0, CW, CH, 18);
  ctx.fill();
  const g = ctx.createLinearGradient(0, 0, CW, CH);
  g.addColorStop(0, '#173d3c');
  g.addColorStop(1, '#0a2023');
  ctx.fillStyle = g;
  rr(ctx, B, B, CW - 2 * B, CH - 2 * B, 14);
  ctx.fill();
  // diamond lattice
  ctx.save();
  rr(ctx, B, B, CW - 2 * B, CH - 2 * B, 14);
  ctx.clip();
  ctx.strokeStyle = 'rgba(214,170,92,0.22)';
  ctx.lineWidth = 1.5;
  for (let i = -CH; i < CW + CH; i += 18) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + CH * 0.6, CH);
    ctx.moveTo(i, 0);
    ctx.lineTo(i - CH * 0.6, CH);
    ctx.stroke();
  }
  ctx.restore();
  // Two fine foil rules frame the woven repeat, like a premium printed deck.
  ctx.strokeStyle = '#c4aa72';
  ctx.lineWidth = 1.1;
  rr(ctx, B + 7, B + 7, CW - 2 * (B + 7), CH - 2 * (B + 7), 10);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(218,201,158,0.4)';
  rr(ctx, B + 11, B + 11, CW - 2 * (B + 11), CH - 2 * (B + 11), 8);
  ctx.stroke();
  // emblem
  ctx.save();
  ctx.translate(CW / 2, CH / 2);
  ctx.fillStyle = '#102b2c';
  ctx.strokeStyle = '#d4bd88';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, 0, CW * 0.36, CH * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.save();
  ctx.translate(0, -CH * 0.075);
  pinwheel(ctx, 62);
  ctx.restore();
  ctx.font = '600 21px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tg = ctx.createLinearGradient(-60, 0, 60, 0);
  tg.addColorStop(0, '#f6d58e');
  tg.addColorStop(0.5, '#fff1c9');
  tg.addColorStop(1, '#c9953f');
  ctx.fillStyle = tg;
  ctx.fillText('AFTERHOURS', 0, CH * 0.06);
  ctx.font = `600 10px ${FONT}`;
  ctx.fillStyle = '#d6aa5c';
  ctx.fillText('CARD LOUNGE', 0, CH * 0.12);
  ctx.restore();
}

let atlas: CanvasTexture | null = null;

/** Build (once) the texture holding every card face, the back and the edge colour. */
export function cardAtlas(): CanvasTexture {
  if (atlas) return atlas;
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W;
  canvas.height = ATLAS_H;
  const ctx = canvas.getContext('2d')!;
  const at = (slot: number, fn: () => void) => {
    ctx.save();
    ctx.translate((slot % COLS) * CW, Math.floor(slot / COLS) * CH);
    fn();
    ctx.restore();
  };
  for (let c = 0; c < 4; c++) {
    for (let v = 0; v <= 9; v++) at(c * 13 + v, () => drawFace(ctx, c, 'num', v));
    at(c * 13 + 10, () => drawFace(ctx, c, 'skip', -1));
    at(c * 13 + 11, () => drawFace(ctx, c, 'reverse', -1));
    at(c * 13 + 12, () => drawFace(ctx, c, 'draw2', -1));
  }
  at(52, () => drawFace(ctx, 0, 'wild', -1));
  at(53, () => drawFace(ctx, 0, 'wild4', -1));
  at(BACK_SLOT, () => drawBack(ctx));
  at(EDGE_SLOT, () => {
    ctx.fillStyle = '#efe9dd';
    ctx.fillRect(0, 0, CW, CH);
  });
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  // shared by every card in every world: never freed with a world
  atlas = keep(t);
  return t;
}

/** Paint one card (face, or the back when c is null) at the origin, at any scale: for posters and big UI art. */
export function paintCard(ctx: Ctx, c: { color: number; kind: Kind; value: number } | null, scale: number): void {
  ctx.save();
  ctx.scale(scale, scale);
  if (c) drawFace(ctx, c.color < 0 ? 0 : c.color, c.kind, c.value);
  else drawBack(ctx);
  ctx.restore();
}

/** Card faces drawn into a canvas for UI (results, color picker, tutorial). */
export function drawCardTo(ctx: Ctx, c: { color: number; kind: Kind; value: number } | null, x: number, y: number, w: number): void {
  const src = cardAtlas().image as HTMLCanvasElement;
  const slot = c ? faceSlot(c) : BACK_SLOT;
  ctx.drawImage(src, (slot % COLS) * CW, Math.floor(slot / COLS) * CH, CW, CH, x, y, w, (w * CH) / CW);
}

// ------------------------------------------------------------------ geometry

let base: ExtrudeGeometry | null = null;
const geoCache = new Map<number, BufferGeometry>();

function baseGeometry(): ExtrudeGeometry {
  if (base) return base;
  const w = CARD_W;
  const h = CARD_H;
  const r = RADIUS;
  const s = new Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  base = new ExtrudeGeometry(s, {
    depth: CARD_T - 0.00012,
    bevelEnabled: true,
    bevelThickness: 0.00006,
    bevelSize: 0.00006,
    bevelSegments: 1,
    curveSegments: 6,
    steps: 1,
  });
  base.translate(0, 0, -(CARD_T - 0.00012) / 2);
  base.computeVertexNormals();
  return keep(base);
}

/**
 * Geometry for one face design: the front (+Z) shows the face, the back (-Z)
 * shows the card back, the rim is paper. Cached per design.
 */
export function cardGeometry(slot: number): BufferGeometry {
  const hit = geoCache.get(slot);
  if (hit) return hit;
  const g = baseGeometry().clone();
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  const put = (i: number, s: number, u: number, v: number) => {
    const col = s % COLS;
    const row = Math.floor(s / COLS);
    uv[i * 2] = (col * CW + u * CW) / ATLAS_W;
    uv[i * 2 + 1] = 1 - (row * CH + (1 - v) * CH) / ATLAS_H;
  };
  for (let i = 0; i < pos.count; i++) {
    const nz = nor.getZ(i);
    const u = (pos.getX(i) + CARD_W / 2) / CARD_W;
    const v = (pos.getY(i) + CARD_H / 2) / CARD_H;
    if (nz > 0.5) put(i, slot, u, v);
    else if (nz < -0.5) put(i, BACK_SLOT, 1 - u, v);
    else put(i, EDGE_SLOT, 0.5, 0.5);
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  geoCache.set(slot, keep(g));
  return g;
}

let mat: MeshStandardMaterial | null = null;

/** Satin-printed card stock: soft highlights, no plastic shine. */
export function cardMaterial(): MeshStandardMaterial {
  if (mat) return mat;
  // Linen embossing catches the real table light without adding meshes.
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const data = ctx.createImageData(128, 128);
  let seed = 4719;
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const linen = Math.sin(x * Math.PI / 2) * Math.sin(y * Math.PI / 2);
      const v = 154 + linen * 13 + ((seed >>> 24) / 255 - 0.5) * 12;
      const i = (y * 128 + x) * 4;
      data.data[i] = data.data[i + 1] = data.data[i + 2] = v;
      data.data[i + 3] = 255;
    }
  }
  ctx.putImageData(data, 0, 0);
  const stock = new CanvasTexture(c);
  stock.wrapS = stock.wrapT = RepeatWrapping;
  stock.repeat.set(7, 10.5);
  stock.anisotropy = 8;
  mat = keep(
    new MeshStandardMaterial({
      map: cardAtlas(), roughness: 0.62, metalness: 0,
      bumpMap: keep(stock), bumpScale: 0.000025, envMapIntensity: 0.65,
    }),
  );
  return mat;
}

/** A card mesh showing `c` (or a face-down card when c is null). */
export function makeCardMesh(c: { color: number; kind: Kind; value: number } | null): Mesh {
  const m = new Mesh(cardGeometry(c ? faceSlot(c) : BACK_SLOT), cardMaterial());
  m.castShadow = true;
  shareDepthMaterials(m);
  m.receiveShadow = false;
  m.raycast = () => {};
  return m;
}

/** Change what an existing card mesh shows. */
export function setCardFace(m: Mesh, c: { color: number; kind: Kind; value: number } | null): void {
  m.geometry = cardGeometry(c ? faceSlot(c) : BACK_SLOT);
}

export function isWild(c: Card): boolean {
  return c.kind === 'wild' || c.kind === 'wild4';
}

export type { Card, Color };

/**
 * The framed CHAOS TABLE poster on the lounge wall: three cards fanned over a
 * deep violet ground with the logo. Drawn by the same code as the cards.
 */
export function makePosterCanvas(width = 1024): HTMLCanvasElement {
  const W = width;
  const H = Math.round(width * 1.4);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const bg = ctx.createRadialGradient(W * 0.5, H * 0.58, W * 0.05, W * 0.5, H * 0.58, W * 0.95);
  bg.addColorStop(0, '#28303f');
  bg.addColorStop(0.55, '#121e2b');
  bg.addColorStop(1, '#080e15');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#b69b65';
  ctx.lineWidth = W * 0.002;
  ctx.strokeRect(W * 0.035, H * 0.025, W * 0.93, H * 0.95);
  ctx.strokeStyle = 'rgba(182,155,101,0.32)';
  ctx.strokeRect(W * 0.048, H * 0.035, W * 0.904, H * 0.93);
  // light rays behind the cards
  ctx.save();
  ctx.translate(W / 2, H * 0.62);
  for (let i = 0; i < 18; i++) {
    ctx.rotate((Math.PI * 2) / 18);
    const g = ctx.createLinearGradient(0, 0, 0, -W);
    g.addColorStop(0, 'rgba(213,189,134,0.065)');
    g.addColorStop(1, 'rgba(255,190,90,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-W * 0.06, -W);
    ctx.lineTo(W * 0.06, -W);
    ctx.fill();
  }
  ctx.restore();
  const s = (W * 0.34) / CW;
  const cards: [{ color: number; kind: Kind; value: number }, number, number][] = [
    [{ color: 0, kind: 'num', value: 7 }, -0.32, -W * 0.2],
    [{ color: 3, kind: 'reverse', value: -1 }, 0.32, W * 0.2],
    [{ color: -1, kind: 'wild4', value: -1 }, 0, 0],
  ];
  for (const [card, rot, dx] of cards) {
    ctx.save();
    ctx.translate(W / 2 + dx, H * 0.64);
    ctx.rotate(rot);
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 18;
    ctx.translate((-CW * s) / 2, (-CH * s) / 2);
    ctx.fillStyle = '#000';
    rr(ctx, 4 * s, 4 * s, (CW - 8) * s, (CH - 8) * s, 16 * s);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    paintCard(ctx, card, s);
    ctx.restore();
  }
  const font = 'Georgia, "Times New Roman", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `500 ${W * 0.105}px ${font}`;
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#f0e6cd';
  ctx.fillText('AFTERHOURS', W / 2, H * 0.145, W * 0.85);
  ctx.font = `500 ${W * 0.029}px ${FONT}`;
  ctx.fillStyle = '#c5ad7b';
  ctx.fillText('T H E   C A R D   L O U N G E', W / 2, H * 0.225);
  ctx.shadowBlur = 0;
  ctx.font = `600 ${W * 0.034}px ${font}`;
  ctx.fillStyle = '#afbece';
  ctx.fillText('GOOD HANDS. GREAT COMPANY.', W / 2, H * 0.9, W * 0.8);
  return c;
}
