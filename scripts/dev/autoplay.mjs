// Dev-only: play your own turns automatically (first legal card, Wilds pick the colour you hold
// most of; draw and pass when stuck) through the app's normal action messages, with fast
// computer players, until the round ends or SECONDS runs out. For reaching the results screen.
export default async function run({ frame }) {
  return frame.evaluate(async (seconds) => {
    const app = window.chaos;
    if (app.conn?.host) app.conn.host.aiPace = 0.08;
    app.timeScale = 3;
    const t0 = performance.now();
    let moves = 0;
    let lastTurn = -1;
    while (performance.now() - t0 < seconds * 1000) {
      await new Promise((r) => setTimeout(r, 120));
      const v = app.view;
      if (!v) continue;
      if (v.phase !== 'play') break;
      if (v.current !== v.seat || app.queue.length || app.pendingView) continue;
      const key = `${v.turn}:${v.hasDrawn}`;
      if (key === lastTurn) continue;
      lastTurn = key;
      if (v.pending > 0 && !v.playable.length) {
        app.conn.send({ t: 'act', action: { type: 'draw' } });
      } else if (v.playable.length) {
        const card = v.hand.find((c) => c.id === v.playable[0]);
        const counts = [0, 0, 0, 0];
        for (const c of v.hand) if (c.color >= 0) counts[c.color]++;
        const color = counts.indexOf(Math.max(...counts));
        app.conn.send({ t: 'act', action: { type: 'play', cardId: card.id, color: card.color < 0 ? color : undefined } });
      } else if (!v.hasDrawn) app.conn.send({ t: 'act', action: { type: 'draw' } });
      else app.conn.send({ t: 'act', action: { type: 'pass' } });
      moves++;
    }
    app.timeScale = 1;
    const v = app.view;
    return { moves, phase: v?.phase, winner: v?.winner, mySeat: v?.seat, screen: app.screen, lobby: app.lobby?.phase };
  }, Number(process.env.SECONDS ?? 90));
}
