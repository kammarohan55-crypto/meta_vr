// Dev-only: save a panel's own canvas (PANEL=panel|dock|hint) flat, as the texture is drawn,
// to OUT (default .cache/panel-<name>.png). For reviewing menu and action-bar art without perspective.
import { writeFileSync } from 'node:fs';

export default async function run({ frame, workspaceRoot }) {
  const name = process.env.PANEL ?? 'dock';
  const hover = process.env.HOVER ?? '';
  const out = process.env.OUT ?? `${workspaceRoot}/.cache/panel-${name}.png`;
  const r = await frame.evaluate(({ name, hover }) => {
    const p = window.chaos[name];
    if (hover) p.hover = hover;
    p.redraw();
    return { url: p.canvas.toDataURL('image/png'), w: p.W, h: p.H, buttons: p.buttons.map((b) => b.id), screen: window.chaos.screen };
  }, { name, hover });
  writeFileSync(out, Buffer.from(r.url.split(',')[1], 'base64'));
  return { out, w: r.w, h: r.h, buttons: r.buttons, screen: r.screen };
}
