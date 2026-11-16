// Dev-only: estimates the per-frame render budget of the running scene by walking it:
// visible draw items (one per mesh/material group, instanced meshes count once),
// triangles (instances multiplied) and lights that are on.
export default async function run({ frame }) {
  return frame.evaluate(() => {
    const app = window.chaos;
    let scene = app.root;
    while (scene.parent) scene = scene.parent;
    let draws = 0, tris = 0, lights = 0, shadowCasters = 0;
    const visible = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
    scene.traverse((o) => {
      if (o.isLight && o.visible && o.intensity > 0 && !o.isAmbientLight) lights++;
      if (!(o.isMesh || o.isPoints || o.isLine) || !visible(o)) return;
      const geo = o.geometry;
      const groups = Array.isArray(o.material) ? o.material.length : 1;
      draws += groups;
      if (o.castShadow) shadowCasters++;
      const count = geo.index ? geo.index.count : geo.attributes.position?.count ?? 0;
      const per = o.isPoints ? 0 : count / 3;
      tris += per * (o.isInstancedMesh ? o.count : 1);
    });
    return JSON.stringify({ screen: app.screen, drawItems: draws, triangles: Math.round(tris), lights, shadowCasters });
  });
}
