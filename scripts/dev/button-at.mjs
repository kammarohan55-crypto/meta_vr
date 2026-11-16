// Dev-only: screen position (1280x720 capture space) of a menu or dock button by id, so test
// scripts can click it for real. BUTTON=<id> [PANEL=panel|dock]
export default async function run({ frame }) {
  return frame.evaluate(([id, which]) => {
    const app = window.chaos;
    const p = which === 'dock' ? app.dock : app.panel;
    const b = p.buttons.find((x) => x.id === id);
    if (!b) return { error: `no button ${id}`, buttons: p.buttons.map((x) => x.id) };
    const geo = p.mesh.geometry.parameters;
    let scene = app.root;
    while (scene.parent) scene = scene.parent;
    const camera = scene.getObjectByProperty('isPerspectiveCamera', true);
    const u = (b.x + b.w / 2) / p.W;
    const v = (b.y + b.h / 2) / p.H;
    const pt = p.mesh.position.clone().set((u - 0.5) * geo.width, (0.5 - v) * geo.height, 0);
    p.mesh.updateWorldMatrix(true, false);
    p.mesh.localToWorld(pt);
    pt.project(camera);
    const canvas = document.querySelector('canvas');
    const r = canvas.getBoundingClientRect();
    return { x: Math.round(((pt.x + 1) / 2) * r.width), y: Math.round(((1 - pt.y) / 2) * r.height), screen: app.screen };
  }, [process.env.BUTTON ?? '', process.env.PANEL ?? 'panel']);
}
