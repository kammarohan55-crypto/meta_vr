// Dev-only: materials shared by meshes that need different shader variants (skinned and not,
// instanced and not, with and without vertex colours). three switches programs for every such
// draw, re-deriving the program parameters each time.
export default async function run({ frame }) {
  return frame.evaluate(() => {
    const app = window.chaos;
    let scene = app.root;
    while (scene.parent) scene = scene.parent;
    const uses = new Map();
    scene.traverse((o) => {
      if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite) || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const variant = `${o.isSkinnedMesh ? 'skin' : ''}${o.isInstancedMesh ? 'inst' : ''}${o.geometry?.attributes?.color ? 'vc' : ''}${o.morphTargetInfluences ? 'morph' : ''}` || 'plain';
      for (const m of mats) {
        const e = uses.get(m) ?? { name: m.name || m.type, type: m.type, variants: new Set(), meshes: [] };
        e.variants.add(variant);
        if (e.meshes.length < 4) e.meshes.push(o.name || o.type);
        uses.set(m, e);
      }
    });
    const mixed = [...uses.values()].filter((e) => e.variants.size > 1).map((e) => ({ name: e.name, type: e.type, variants: [...e.variants], meshes: e.meshes }));
    return { materials: uses.size, mixed };
  });
}
