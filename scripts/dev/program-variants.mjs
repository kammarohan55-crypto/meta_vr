// Dev-only: materials that own more than one compiled shader program (three switches between
// them, re-deriving program parameters, whenever objects needing different variants share it).
export default async function run({ frame }) {
  return frame.evaluate(() => {
    const app = window.chaos;
    const r = app.warmup.renderer;
    let scene = app.root;
    while (scene.parent) scene = scene.parent;
    const seen = new Set();
    const out = [];
    scene.traverse((o) => {
      if (!o.material) return;
      for (const m of [].concat(o.material)) {
        if (seen.has(m)) continue;
        seen.add(m);
        const n = r.properties.get(m).programs?.size ?? 0;
        if (n > 1) out.push(`${m.name || m.type} (${m.type}): ${n} programs, e.g. on ${o.name || o.type}`);
      }
    });
    return out;
  });
}
