// Dev-only: what the renderer walks every frame. Objects, meshes, shadow casters and objects
// whose matrices update every frame, grouped by the app's top-level groups; plus draw calls
// with and without the shadow pass.
export default async function run({ frame }) {
  return frame.evaluate(async () => {
    const app = window.chaos;
    const renderer = app.warmup.renderer;
    let scene = app.root;
    while (scene.parent) scene = scene.parent;
    const groups = {};
    const top = (o) => {
      let p = o;
      while (p.parent && p.parent !== app.root && p.parent !== scene) p = p.parent;
      return p.parent === app.root ? p.name || p.type : `scene:${p.name || p.type}`;
    };
    scene.traverse((o) => {
      const g = (groups[top(o)] ??= { objects: 0, auto: 0, meshes: 0, visibleMeshes: 0, casters: 0, skinned: 0, bones: 0 });
      g.objects++;
      if (o.matrixAutoUpdate) g.auto++;
      if (o.isBone) g.bones++;
      if (o.isMesh || o.isPoints || o.isLine || o.isSprite) {
        g.meshes++;
        let vis = true;
        for (let p = o; p; p = p.parent) if (!p.visible) vis = false;
        if (vis) g.visibleMeshes++;
        if (vis && o.castShadow) g.casters++;
        if (o.isSkinnedMesh) g.skinned++;
      }
    });
    const wait = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await wait();
    const withShadows = renderer.info.render.calls;
    const was = renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = false;
    await wait();
    const noShadows = renderer.info.render.calls;
    renderer.shadowMap.enabled = was;
    await wait();
    const total = Object.values(groups).reduce((a, g) => a + g.objects, 0);
    return { total, withShadows, noShadows, groups };
  });
}
