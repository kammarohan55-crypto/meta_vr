// Dev-only: catch geometries whose bounding sphere comes out NaN during a world switch
// (WORLD=...), and name the objects that use them.
export default async function run({ frame }) {
  return frame.evaluate(async (world) => {
    const app = window.chaos;
    let scene = app.root;
    while (scene.parent) scene = scene.parent;
    let proto = null;
    scene.traverse((o) => {
      if (!proto && o.geometry) proto = Object.getPrototypeOf(o.geometry);
    });
    while (proto && !Object.prototype.hasOwnProperty.call(proto, 'computeBoundingSphere')) proto = Object.getPrototypeOf(proto);
    const orig = proto.computeBoundingSphere;
    const bad = new Set();
    proto.computeBoundingSphere = function () {
      orig.call(this);
      if (this.boundingSphere && Number.isNaN(this.boundingSphere.radius)) bad.add(this);
    };
    app.switchWorld(world);
    await new Promise((r) => setTimeout(r, 2500));
    proto.computeBoundingSphere = orig;
    const out = [];
    scene.traverse((o) => {
      if (!o.geometry || !bad.has(o.geometry)) return;
      const path = [];
      for (let p = o; p && path.length < 6; p = p.parent) path.push(p.name || p.type);
      const pos = o.geometry.attributes.position;
      let nan = 0;
      for (let i = 0; i < pos.array.length; i++) if (Number.isNaN(pos.array[i])) nan++;
      out.push({ path: path.join(' < '), type: o.type, count: pos.count, nanNow: nan, attrs: Object.keys(o.geometry.attributes) });
    });
    return { caught: bad.size, objects: out };
  }, process.env.WORLD ?? 'celestial');
}
