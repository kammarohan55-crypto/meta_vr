// Dev-only: does everything a turn needs fit the Meta VR Glasses' view (37 deg left and right,
// 25 up, 43 down) from where the head is looking right now? Angles are measured against the view
// axis in the head's own frame, as the glasses' projection is: atan2(dx, -dz) and atan2(dy, -dz).
export default async function run({ frame }) {
  return frame.evaluate(() => {
    const app = window.chaos;
    const renderer = app.warmup.renderer;
    const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : app.warmup.camera;
    cam.updateMatrixWorld(true);
    const V = app.root.position.constructor;
    const deg = (r) => +((r * 180) / Math.PI).toFixed(1);
    const at = (w) => {
      const p = cam.worldToLocal(w.clone());
      return { h: deg(Math.atan2(p.x, -p.z)), v: deg(Math.atan2(p.y, -p.z)) };
    };
    const span = (pts) => {
      const a = pts.map(at);
      const h = [Math.min(...a.map((x) => x.h)), Math.max(...a.map((x) => x.h))];
      const v = [Math.min(...a.map((x) => x.v)), Math.max(...a.map((x) => x.v))];
      return { h, v, inView: h[0] >= -37 && h[1] <= 37 && v[0] >= -43 && v[1] <= 25 };
    };
    const corners = (panel) => {
      const geo = panel.mesh.geometry.parameters;
      panel.mesh.updateWorldMatrix(true, false);
      return [[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([sx, sy]) => panel.mesh.localToWorld(new V((sx * geo.width) / 2, (sy * geo.height) / 2, 0)));
    };
    const wp = (o) => o.getWorldPosition(new V());
    const out = { screen: app.screen, narrow: app.narrow };
    if (app.panel.visible) out.menu = span(corners(app.panel));
    if (app.dock.visible) out.actionBar = span(corners(app.dock));
    if (app.hint.visible) out.hint = span(corners(app.hint));
    const cards = [...app.table.hand.values()].map((hc) => wp(hc.root));
    if (cards.length) out.yourCards = span(cards);
    const pile = app.table.pileTop(new V());
    app.table.group.localToWorld(pile);
    out.pile = span([pile]);
    out.deck = span([wp(app.table.drawHit)]);
    if (app.picker.group.visible) out.colours = span(app.picker.petals.map(wp));
    const heads = [];
    for (const [seat] of app.cast.all()) {
      const w = app.seatHead(seat, new V());
      app.root.localToWorld(w);
      heads.push(w);
    }
    if (heads.length) out.opponents = span(heads);
    return out;
  });
}
