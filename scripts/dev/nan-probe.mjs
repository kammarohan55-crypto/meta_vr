// Dev-only: list meshes, points and lines whose position attribute holds NaN (they spam
// "computeBoundingSphere(): Computed radius is NaN" and are never drawn correctly).
export default async function run({ frame }) {
  return frame.evaluate(() => {
    const out = [];
    const app = window.chaos;
    let scene = app.root;
    while (scene.parent) scene = scene.parent;
    scene.traverse((o) => {
      const pos = o.geometry?.attributes?.position;
      if (!pos) return;
      let bad = 0;
      for (let i = 0; i < pos.array.length; i++) if (Number.isNaN(pos.array[i])) bad++;
      if (!bad) return;
      const path = [];
      for (let p = o; p && path.length < 6; p = p.parent) path.push(p.name || p.type);
      out.push({ path: path.join(' < '), type: o.type, visible: o.visible, nan: bad, count: pos.count });
    });
    return out;
  });
}
