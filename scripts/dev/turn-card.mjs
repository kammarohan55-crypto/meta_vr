// Dev-only: wait (fast computer players) until it is your turn with a playable non-wild card,
// then return that card's screen position and your hand size, so a real click can play it.
export default async function run({ frame }) {
  return frame.evaluate(async () => {
    const app = window.chaos;
    if (app.conn?.host) app.conn.host.aiPace = 0.1;
    const t0 = performance.now();
    for (;;) {
      const v = app.view;
      const ready = v && v.phase === 'play' && v.current === v.seat && !app.queue.length && !app.pendingView;
      const id = ready ? v.playable.find((pid) => { const c = v.hand.find((h) => h.id === pid); return c && c.kind !== 'wild' && c.kind !== 'wild4'; }) : undefined;
      const hc = id !== undefined ? app.table.hand.get(id) : null;
      if (hc) {
        await new Promise((r) => setTimeout(r, 700)); // let the fan settle
        let scene = app.root;
        while (scene.parent) scene = scene.parent;
        const camera = scene.getObjectByProperty('isPerspectiveCamera', true);
        // the left part of a fanned card is the part not covered by its neighbour
        const g = hc.hit.geometry.parameters;
        const p = hc.hit.localToWorld(hc.hit.position.clone().set(-g.width * 0.36, g.height * 0.15, 0));
        p.project(camera);
        const r = document.querySelector('canvas').getBoundingClientRect();
        return { x: Math.round(((p.x + 1) / 2) * r.width), y: Math.round(((1 - p.y) / 2) * r.height), hand: v.hand.length, id };
      }
      if (performance.now() - t0 > 45000) return { error: 'no playable turn in 45 s', phase: v?.phase };
      if (ready && !v.playable.length && !v.hasDrawn) app.conn.send({ t: 'act', action: { type: 'draw' } });
      await new Promise((r) => setTimeout(r, 200));
    }
  });
}
