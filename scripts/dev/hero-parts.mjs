// Dev-only: one seated hero's parts: skinned meshes (skeleton shared? bind matrix identity?
// node transform identity?), plain props, materials. Decides whether parts can be merged.
export default async function run({ frame }) {
  return frame.evaluate(() => {
    const app = window.chaos;
    const out = [];
    let heroRoot = null;
    for (const [, av] of app.cast.all()) {
      if (av.rig?.model) {
        heroRoot = av.rig.model;
        break;
      }
    }
    if (!heroRoot) return 'no hero';
    const ident = (m) => m.elements.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-5);
    let skeleton = null;
    heroRoot.traverse((o) => {
      if (!o.isMesh) return;
      const sameSkel = o.isSkinnedMesh ? (skeleton ??= o.skeleton) === o.skeleton : null;
      out.push({
        name: o.name,
        skinned: !!o.isSkinnedMesh,
        parent: o.parent?.name,
        sameSkeleton: sameSkel,
        bindIdentity: o.isSkinnedMesh ? ident(o.bindMatrix) : null,
        localIdentity: ident(o.matrix),
        material: o.material?.name,
        verts: o.geometry.attributes.position.count,
        attrs: Object.keys(o.geometry.attributes).join(','),
        indexed: !!o.geometry.index,
      });
    });
    return out;
  });
}
