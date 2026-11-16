// Dev-only: where the Frostpeak birds and mist sit on screen, and whether the recorded sounds loaded.
export default async function run({ frame }) {
  return frame.evaluate(() => {
    const app = window.chaos;
    let scene = null;
    let cam = null;
    // find the scene root and the camera from a known object
    const any = app.table?.root ?? app.lounge?.root;
    for (let o = any; o; o = o.parent) scene = o;
    scene.traverse((o) => { if (o.isCamera && !cam) cam = o; });
    const out = { camera: cam ? cam.getWorldPosition(cam.position.clone()).toArray().map((v) => +v.toFixed(2)) : null };
    const proj = (v) => { const p = v.clone().project(cam); return [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(3)]; };
    scene.traverse((o) => {
      if (o.name === 'Frostpeak_Birds') {
        const m = new o.matrixWorld.constructor();
        const v = cam.position.clone();
        const list = [];
        for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); v.setFromMatrixPosition(m).applyMatrix4(o.matrixWorld); list.push(proj(v)); }
        out.birds = { visible: o.visible, parentVisible: o.parent?.visible, ndc: list };
      }
      if (o.name?.startsWith('Frostpeak_Mist_')) {
        (out.mist ??= []).push({ ndc: proj(o.getWorldPosition(cam.position.clone())), opacity: +o.material.opacity.toFixed(2) });
      }
    });
    const audio = app.audio ?? app.sound ?? null;
    out.samples = audio?.samples ? Object.fromEntries([...audio.samples].map(([k, v]) => [k, v.length])) : 'no audio handle';
    return out;
  });
}
