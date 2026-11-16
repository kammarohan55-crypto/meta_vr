// Dev-only: screen position of a colour-picker petal (COLOR=0..3) so a test can click it.
export default async function run({ frame }) {
  return frame.evaluate((color) => {
    const app = window.chaos;
    const petal = app.picker.petals.find((p) => p.userData.color === color);
    if (!petal || !app.picker.open) return { error: 'picker closed' };
    let scene = app.root;
    while (scene.parent) scene = scene.parent;
    const camera = scene.getObjectByProperty('isPerspectiveCamera', true);
    const p = petal.getWorldPosition(petal.position.clone()).project(camera);
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { x: Math.round(((p.x + 1) / 2) * r.width), y: Math.round(((1 - p.y) / 2) * r.height) };
  }, Number(process.env.COLOR ?? 3));
}
