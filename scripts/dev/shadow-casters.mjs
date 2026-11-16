// Dev-only: every visible shadow-casting mesh, counted by name (what the shadow pass draws).
export default async function run({ frame }) {
  return frame.evaluate(() => {
    const app = window.chaos;
    let scene = app.root;
    while (scene.parent) scene = scene.parent;
    const counts = {};
    scene.traverse((o) => {
      if (!(o.isMesh || o.isSkinnedMesh) || !o.castShadow) return;
      for (let p = o; p; p = p.parent) if (!p.visible) return;
      const key = `${o.isSkinnedMesh ? 'skinned ' : ''}${o.name || o.geometry?.type || o.type}`;
      counts[key] = (counts[key] ?? 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  });
}
