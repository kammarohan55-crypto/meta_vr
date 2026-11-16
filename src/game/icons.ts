/**
 * AFTERHOURS — the game's own reaction faces, toy pictures and control glyphs, drawn in code.
 *
 * They replace emoji characters on the action bar. An emoji is whatever the device's font
 * makes of it (a Quest, a phone and a PC each draw a different face), it cannot be tinted or
 * outlined to match the game, and a few control symbols come out as coloured stickers. These
 * are one set in one style on every device. Each icon draws round the origin in a 100-unit box.
 */
import type { Button, Ctx } from './ui.js';
import { roundRect, text } from './ui.js';

const TAU = Math.PI * 2;
const INK = '#1d2136';
const RIM = '#b07a22';
const SKIN = '#ffe2a0';

export type Icon = (c: Ctx) => void;

function stroke(c: Ctx, w: number, col = INK): void {
  c.lineWidth = w;
  c.strokeStyle = col;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.stroke();
}
function disc(c: Ctx, x: number, y: number, r: number, fill: string, edge?: string, w = 3): void {
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fillStyle = fill;
  c.fill();
  if (edge) stroke(c, w, edge);
}
function box(c: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string, edge?: string, lw = 3): void {
  roundRect(c, x, y, w, h, r);
  c.fillStyle = fill;
  c.fill();
  if (edge) stroke(c, lw, edge);
}
function line(c: Ctx, pts: number[], w: number, col = INK): void {
  c.beginPath();
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  stroke(c, w, col);
}
function curve(c: Ctx, x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, w: number, col = INK): void {
  c.beginPath();
  c.moveTo(x0, y0);
  c.quadraticCurveTo(cx, cy, x1, y1);
  stroke(c, w, col);
}
function head(c: Ctx, hi = '#fff1b5', lo = '#ffc94a', rim = RIM): void {
  const g = c.createRadialGradient(-14, -16, 4, 0, 0, 44);
  g.addColorStop(0, hi);
  g.addColorStop(1, lo);
  disc(c, 0, 0, 40, '#000', undefined);
  c.fillStyle = g;
  c.fill();
  stroke(c, 3.5, rim);
}
function eyes(c: Ctx, y = -8, dx = 14, r = 4.6): void {
  disc(c, -dx, y, r, INK);
  disc(c, dx, y, r, INK);
}
/** Closed eyes: arched (happy) or drooping (sad). */
function lids(c: Ctx, y: number, dx: number, happy: boolean): void {
  for (const s of [-1, 1]) {
    c.beginPath();
    if (happy) c.arc(s * dx, y + 4, 8, Math.PI * 1.15, Math.PI * 1.85);
    else c.arc(s * dx, y - 4, 8, Math.PI * 0.15, Math.PI * 0.85);
    stroke(c, 4);
  }
}
function grin(c: Ctx, y: number, w: number, h: number): void {
  c.beginPath();
  c.moveTo(-w, y);
  c.quadraticCurveTo(0, y + h * 2, w, y);
  c.closePath();
  c.fillStyle = INK;
  c.fill();
  c.save();
  c.clip();
  c.beginPath();
  c.ellipse(0, y + h * 1.3, w * 0.62, h * 0.6, 0, 0, TAU);
  c.fillStyle = '#ff6f7d';
  c.fill();
  c.restore();
}
function drop(c: Ctx, x: number, y: number, s: number): void {
  c.beginPath();
  c.moveTo(x, y - s);
  c.quadraticCurveTo(x + s, y + s * 0.4, x, y + s);
  c.quadraticCurveTo(x - s, y + s * 0.4, x, y - s);
  c.fillStyle = '#7fd0ff';
  c.fill();
  stroke(c, 1.6, '#2a7fc0');
}
/** A cartoon hand: palm and thumb. `flip` mirrors it. */
function mitt(c: Ctx, x: number, y: number, rot: number, s = 1, flip = false): void {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.scale(flip ? -s : s, s);
  box(c, -9, -13, 18, 26, 8, SKIN, RIM);
  c.beginPath();
  c.ellipse(-11, 3, 5, 8, -0.5, 0, TAU);
  c.fillStyle = SKIN;
  c.fill();
  stroke(c, 3, RIM);
  c.restore();
}
function spark(c: Ctx, x: number, y: number, s: number, col = '#fff3c4'): void {
  c.beginPath();
  c.moveTo(x, y - s);
  c.quadraticCurveTo(x, y, x + s, y);
  c.quadraticCurveTo(x, y, x, y + s);
  c.quadraticCurveTo(x, y, x - s, y);
  c.quadraticCurveTo(x, y, x, y - s);
  c.fillStyle = col;
  c.fill();
}

export const EMOTE_ICONS: Record<string, Icon> = {
  laugh(c) {
    head(c);
    lids(c, -10, 15, true);
    grin(c, 4, 21, 12);
    drop(c, -37, 0, 7);
    drop(c, 37, 0, 7);
  },
  clap(c) {
    head(c);
    eyes(c, -10);
    curve(c, -13, 5, 0, 15, 13, 5, 4);
    mitt(c, -8, 33, -0.3, 1.05);
    mitt(c, 8, 33, 0.3, 1.05, true);
    line(c, [-27, 26, -36, 21], 3.5, '#fff3c4');
    line(c, [-28, 36, -38, 38], 3.5, '#fff3c4');
    line(c, [27, 26, 36, 21], 3.5, '#fff3c4');
    line(c, [28, 36, 38, 38], 3.5, '#fff3c4');
  },
  point(c) {
    c.translate(-6, 0);
    head(c);
    c.beginPath();
    c.arc(-14, -6, 7, Math.PI * 1.15, Math.PI * 1.85);
    stroke(c, 4);
    disc(c, 14, -8, 4.6, INK);
    curve(c, -8, 10, 4, 18, 15, 8, 4);
    // a fist with one finger out, pointing away to the right
    box(c, 34, 14, 22, 8, 4, SKIN, RIM);
    box(c, 18, 12, 20, 20, 8, SKIN, RIM);
  },
  facepalm(c) {
    head(c);
    curve(c, -11, 22, 0, 18, 11, 22, 4);
    mitt(c, 2, -8, -1.15, 1.95);
    drop(c, 33, -26, 6);
  },
  cheer(c) {
    c.translate(0, 6);
    c.scale(0.86, 0.86);
    head(c);
    lids(c, -10, 15, true);
    grin(c, 4, 19, 11);
    mitt(c, -44, -30, -0.35, 1.1);
    mitt(c, 44, -30, 0.35, 1.1, true);
    spark(c, 0, -54, 9);
    spark(c, -24, -50, 5);
    spark(c, 24, -50, 5);
  },
  angry(c) {
    head(c, '#ffd0a8', '#ff7d4d', '#a03a1c');
    line(c, [-25, -21, -7, -12], 4.5);
    line(c, [25, -21, 7, -12], 4.5);
    eyes(c, -4, 14, 4.2);
    curve(c, -14, 22, 0, 10, 14, 22, 4);
    for (const s of [-1, 1]) {
      disc(c, s * 34, -34, 7, '#f4f6fb', '#9aa3b5', 2);
      disc(c, s * 42, -40, 5, '#f4f6fb', '#9aa3b5', 2);
    }
  },
  cool(c) {
    head(c);
    line(c, [-31, -10, -39, -13], 3.5);
    line(c, [31, -10, 39, -13], 3.5);
    line(c, [-5, -10, 5, -10], 3.5);
    box(c, -31, -17, 26, 18, 7, INK);
    box(c, 5, -17, 26, 18, 7, INK);
    line(c, [-25, -5, -17, -13], 2.5, '#8fa4d8');
    line(c, [11, -5, 19, -13], 2.5, '#8fa4d8');
    curve(c, -10, 16, 6, 25, 17, 10, 4);
  },
  cry(c) {
    head(c, '#fff1b5', '#ffd257');
    box(c, -18, -4, 8, 36, 4, '#7fd0ff', '#2a7fc0', 1.6);
    box(c, 10, -4, 8, 36, 4, '#7fd0ff', '#2a7fc0', 1.6);
    line(c, [-23, -18, -8, -23], 4);
    line(c, [23, -18, 8, -23], 4);
    lids(c, -6, 14, false);
    c.beginPath();
    c.ellipse(0, 21, 8, 6, 0, 0, TAU);
    c.fillStyle = INK;
    c.fill();
  },
};

const CONFETTI = ['#ff5a6e', '#ffd24a', '#4fd18b', '#5aa9ff'];

export const TOY_ICONS: Record<string, Icon> = {
  dart(c) {
    c.rotate(-0.6);
    line(c, [-44, -10, -56, -10], 3.5, '#fff3c4');
    line(c, [-42, 0, -58, 0], 3.5, '#fff3c4');
    line(c, [-44, 10, -56, 10], 3.5, '#fff3c4');
    box(c, -34, -9, 52, 18, 9, '#ff8a3c', '#9c4a12');
    line(c, [-24, -4, 8, -4], 3, '#ffc08a');
    box(c, 15, -6, 10, 12, 2, '#27408f', '#16255c', 2);
    c.beginPath();
    c.moveTo(24, -11);
    c.lineTo(40, -17);
    c.lineTo(40, 17);
    c.lineTo(24, 11);
    c.closePath();
    c.fillStyle = '#4f7df0';
    c.fill();
    stroke(c, 3, '#1f3f96');
  },
  chicken(c) {
    c.rotate(-0.3);
    line(c, [-7, 34, -11, 48, -17, 50], 3.5, '#ff9a2e');
    line(c, [7, 34, 9, 48, 15, 51], 3.5, '#ff9a2e');
    c.beginPath();
    c.ellipse(0, 8, 21, 29, 0, 0, TAU);
    c.fillStyle = '#ffd94f';
    c.fill();
    stroke(c, 3, '#b88a1a');
    curve(c, -10, 2, -16, 16, -6, 22, 3, '#b88a1a');
    disc(c, 0, -44, 5, '#ff5a4d', '#a02a22', 2);
    disc(c, 8, -46, 5, '#ff5a4d', '#a02a22', 2);
    disc(c, 15, -41, 4.5, '#ff5a4d', '#a02a22', 2);
    disc(c, 5, -30, 13, '#ffd94f', '#b88a1a');
    c.beginPath();
    c.moveTo(16, -34);
    c.lineTo(32, -29);
    c.lineTo(16, -24);
    c.closePath();
    c.fillStyle = '#ff9a2e';
    c.fill();
    stroke(c, 2.5, '#a8560e');
    disc(c, 15, -18, 4, '#ff5a4d', '#a02a22', 2);
    disc(c, 8, -33, 2.8, INK);
  },
  snowball(c) {
    const g = c.createRadialGradient(-10, -12, 3, 0, 0, 32);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#b7d6ff');
    disc(c, 0, 2, 30, '#fff');
    c.fillStyle = g;
    c.fill();
    stroke(c, 3, '#6f9ad6');
    curve(c, -14, 18, 2, 26, 18, 14, 3, '#8fb4e6');
    curve(c, 6, -12, 13, -10, 15, -3, 2.5, '#9cc0ee');
    spark(c, 34, -30, 10, '#eaf4ff');
    spark(c, -36, -22, 7, '#eaf4ff');
    spark(c, -30, 32, 5, '#eaf4ff');
  },
  pie(c) {
    c.beginPath();
    c.moveTo(-37, 12);
    c.lineTo(37, 12);
    c.lineTo(28, 33);
    c.lineTo(-28, 33);
    c.closePath();
    c.fillStyle = '#c9ced6';
    c.fill();
    stroke(c, 3, '#70798a');
    c.beginPath();
    c.ellipse(0, 12, 39, 9, 0, 0, TAU);
    c.fillStyle = '#e8b56b';
    c.fill();
    stroke(c, 3, '#9a6a26');
    disc(c, -17, 2, 13, '#fffaf0', '#c9b8a0', 2.5);
    disc(c, 16, 1, 14, '#fffaf0', '#c9b8a0', 2.5);
    disc(c, 0, -11, 15, '#fffaf0', '#c9b8a0', 2.5);
    curve(c, -6, -10, 0, -18, 7, -9, 2.5, '#d8c9b2');
    curve(c, 4, -30, 8, -40, 15, -42, 2.5, '#4f8a3c');
    disc(c, 3, -28, 7, '#ff4d5e', '#a01f2e', 2);
  },
  hammer(c) {
    c.rotate(-0.5);
    box(c, -5, -8, 10, 56, 5, '#ffd24a', '#a8811a');
    line(c, [-5, 30, 5, 30], 2.5, '#a8811a');
    line(c, [-5, 38, 5, 38], 2.5, '#a8811a');
    box(c, -33, -36, 66, 32, 11, '#ff5a4d', '#a02a22');
    line(c, [-12, -33, -12, -7], 2.5, '#a02a22');
    line(c, [0, -33, 0, -7], 2.5, '#a02a22');
    line(c, [12, -33, 12, -7], 2.5, '#a02a22');
    line(c, [-24, -29, 24, -29], 3, '#ff9c92');
    curve(c, 40, -32, 46, -22, 41, -12, 3, '#fff3c4');
    curve(c, 48, -36, 56, -22, 49, -8, 3, '#fff3c4');
  },
  confetti(c) {
    c.beginPath();
    c.moveTo(-36, 38);
    c.lineTo(-10, -6);
    c.lineTo(10, 16);
    c.closePath();
    c.fillStyle = '#8a5cf0';
    c.fill();
    stroke(c, 3, '#4a2aa8');
    line(c, [-22, 14, -4, 30], 3.5, '#ffd24a');
    line(c, [-29, 26, -18, 36], 3.5, '#ffd24a');
    curve(c, 2, -8, 4, -30, 22, -34, 3.5, '#ff7fa0');
    curve(c, 12, 4, 30, -2, 40, 12, 3.5, '#ffd24a');
    const bits = [10, -44, 0.4, 30, -22, 1.1, 40, -40, 0.2, -8, -34, 0.9, 24, -6, 0.6, 44, -12, 1.4, -24, -18, 0.3, 18, -52, 1.0];
    for (let i = 0; i < bits.length; i += 3) {
      c.save();
      c.translate(bits[i], bits[i + 1]);
      c.rotate(bits[i + 2]);
      c.fillStyle = CONFETTI[(i / 3) % 4];
      c.fillRect(-4, -2.5, 8, 5);
      c.restore();
    }
  },
};

export const GLYPHS = {
  pause(c: Ctx): void {
    box(c, -20, -26, 14, 52, 5, '#f0ebdf');
    box(c, 6, -26, 14, 52, 5, '#f0ebdf');
  },
  play(c: Ctx): void {
    c.beginPath();
    c.moveTo(-16, -28);
    c.lineTo(26, 0);
    c.lineTo(-16, 28);
    c.closePath();
    c.fillStyle = '#f0ebdf';
    c.fill();
    stroke(c, 6, '#f0ebdf');
  },
  back(c: Ctx): void {
    line(c, [10, -24, -14, 0, 10, 24], 9, '#f0ebdf');
  },
} satisfies Record<string, Icon>;

/** A seat to throw at: its player's initial on their own colour. */
export function initialIcon(letter: string, color: string): Icon {
  return (c) => {
    disc(c, 0, 0, 40, color, 'rgba(255,255,255,0.55)', 3);
    text(c, letter.toUpperCase(), 0, 3, 46, { weight: 700, align: 'center', color: '#ffffff' });
  };
}

/** Draw `icon` centred on (x, y), filling a circle of radius `r`. */
export function drawIcon(c: Ctx, icon: Icon, x: number, y: number, r: number): void {
  c.save();
  c.translate(x, y);
  c.scale(r / 50, r / 50);
  icon(c);
  c.restore();
}

/**
 * A button drawn as a round badge with its icon and a caption beneath: the look of a game's
 * emote or item tray. Pointing at it (ray, gaze, mouse or fingertip) swells and lights the badge.
 */
export function iconTile(icon: Icon, caption: string, plain = false): NonNullable<Button['paint']> {
  return (c, b, hover) => {
    const cx = b.x + b.w / 2;
    // the badge and its caption sit together in the middle of the tile
    const R = Math.min(b.w - 8, b.h - 34) / 2;
    const cy = b.y + (b.h - (2 * R + 30)) / 2 + R;
    c.save();
    c.translate(cx, cy);
    if (hover) c.scale(1.07, 1.07);
    c.shadowColor = 'rgba(0,0,0,0.5)';
    c.shadowBlur = hover ? 18 : 9;
    c.shadowOffsetY = 4;
    const g = c.createRadialGradient(0, -R * 0.45, R * 0.1, 0, 0, R);
    g.addColorStop(0, hover ? '#46587a' : '#2e3a50');
    g.addColorStop(1, hover ? '#1c2536' : '#141a26');
    c.beginPath();
    c.arc(0, 0, R, 0, TAU);
    c.fillStyle = g;
    c.fill();
    c.shadowColor = 'transparent';
    stroke(c, hover ? 3 : 2, hover ? '#ffe9b0' : 'rgba(232,211,166,0.5)');
    drawIcon(c, icon, 0, 0, R * (plain ? 0.5 : 0.84));
    c.restore();
    text(c, caption, cx, cy + R + 19, 17, { weight: 650, align: 'center', color: hover ? '#fff6dc' : '#c5ccd6', max: b.w + 6 });
  };
}
