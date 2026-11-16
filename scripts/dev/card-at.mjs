// Dev-only: screen position of a card in your hand (the first playable one, or CARD=<id>),
// so a test can click it for real.
export default async function run({ frame }) {
  return frame.evaluate((want) => {
    const app = window.chaos;
    const v = app.view;
    if (!v) return { error: 'no game' };
    const id = want ? Number(want) : v.playable.find((pid) => { const c = v.hand.find((h) => h.id === pid); return c && c.kind !== 'wild' && c.kind !== 'wild4'; });
    const hc = app.table.hand.get(id);
    if (!hc) return { error: 'no playable card', myTurn: v.current === v.seat, playable: v.playable };
    let scene = app.root;
    while (scene.parent) scene = scene.parent;
    const camera = scene.getObjectByProperty('isPerspectiveCamera', true);
    const p = hc.hit.getWorldPosition(hc.root.position.clone());
    p.project(camera);
    const r = document.querySelector('canvas').getBoundingClientRect();
    return { id, x: Math.round(((p.x + 1) / 2) * r.width), y: Math.round(((1 - p.y) / 2) * r.height), top: v.top, hand: v.hand.length };
  }, process.env.CARD ?? '');
}
