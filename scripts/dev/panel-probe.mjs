// Dev-only: reports the menu panel's canvas, mesh size and button layout, and where a
// screen point lands on it, to debug pointer hit mapping.
export default async function run({ frame }) {
  return frame.evaluate(() => {
    const app = window.chaos;
    const p = app.panel;
    const geo = p.mesh.geometry.parameters;
    let scene = app.root;
    while (scene.parent) scene = scene.parent;
    const camera = scene.getObjectByProperty('isPerspectiveCamera', true);
    const corner = (u, v) => {
      const pt = p.mesh.position.clone().set((u - 0.5) * geo.width, (0.5 - v) * geo.height, 0);
      p.mesh.updateWorldMatrix(true, false);
      p.mesh.localToWorld(pt);
      pt.project(camera);
      return [Math.round((pt.x + 1) / 2 * 1280), Math.round((1 - pt.y) / 2 * 720)];
    };
    return JSON.stringify({
      screen: app.screen, W: p.W, H: p.H, canvas: [p.canvas.width, p.canvas.height],
      mesh: [geo.width, geo.height], topLeft: corner(0, 0), bottomRight: corner(1, 1),
      buttons: p.buttons.map((b) => `${b.id}@${b.x},${b.y},${b.w}x${b.h}`),
      cinematic: p.cinematicTitle, visible: p.group.visible,
    });
  });
}
