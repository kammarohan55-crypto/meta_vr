// Dev-only: every draw call of one frame, in order: which pass (shadow or view), which part of
// the game it belongs to, the object, its material and triangle count. For finding what to
// merge, instance or stop drawing. DETAIL=1 lists each call; otherwise totals per part.
export default async function run({ frame }) {
  return frame.evaluate(async (detail) => {
    const app = window.chaos;
    const renderer = app.warmup.renderer;
    let scene = app.root;
    while (scene.parent) scene = scene.parent;
    const label = (o) => {
      const names = [];
      for (let p = o; p && p !== scene; p = p.parent) if (p.name) names.unshift(p.name);
      return names.slice(0, 4).join('/') || o.type;
    };
    const top = (o) => {
      let p = o;
      while (p.parent && p.parent !== app.root && p.parent !== scene) p = p.parent;
      return p.parent === app.root ? p.name || p.type : `scene:${p.name || p.type}`;
    };
    const calls = [];
    const orig = renderer.renderBufferDirect;
    renderer.renderBufferDirect = function (camera, sc, geometry, material, object, group) {
      const count = group ? group.count : geometry.index ? geometry.index.count : geometry.attributes.position?.count ?? 0;
      calls.push({
        pass: material.isMeshDepthMaterial || material.isMeshDistanceMaterial ? 'shadow' : 'view',
        part: top(object),
        obj: label(object),
        mat: `${material.type}${material.name ? ':' + material.name : ''}${material.transparent ? ' T' : ''}`,
        tris: Math.round((count / 3) * (object.isInstancedMesh ? object.count : 1)),
        skinned: !!object.isSkinnedMesh,
        inst: object.isInstancedMesh ? object.count : 0,
      });
      return orig.apply(this, arguments);
    };
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const one = calls.length;
    calls.length = 0;
    await new Promise((r) => requestAnimationFrame(r));
    renderer.renderBufferDirect = orig;
    void one;
    const parts = {};
    for (const c of calls) {
      const p = (parts[c.part] ??= { view: 0, shadow: 0, tris: 0 });
      p[c.pass]++;
      if (c.pass === 'view') p.tris += c.tris;
    }
    const out = { screen: app.screen, total: calls.length, view: calls.filter((c) => c.pass === 'view').length, shadow: calls.filter((c) => c.pass === 'shadow').length, parts };
    if (detail) {
      // collapse runs of the same object/material
      const lines = [];
      const seen = new Map();
      for (const c of calls) {
        const k = `${c.pass} | ${c.obj} | ${c.mat}${c.skinned ? ' skinned' : ''}${c.inst ? ' x' + c.inst : ''}`;
        const e = seen.get(k);
        if (e) {
          e.n++;
          e.tris += c.tris;
        } else seen.set(k, { n: 1, tris: c.tris });
      }
      for (const [k, e] of seen) lines.push(`${e.n}x ${k} | ${e.tris} tris`);
      out.lines = lines;
    }
    return out;
  }, process.env.DETAIL === '1');
}
