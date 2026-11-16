// Dev-only: press Start and sample the table every 250 ms: cards in flight, cards in your hand,
// cards in each opponent's fan, and how long the event queue is held for the deal.
export default async function run({ frame }) {
  return frame.evaluate(async () => {
    const app = window.chaos;
    const t = app.table;
    const samples = [];
    let dealt = null;
    const orig = t.deal;
    t.deal = function (...a) {
      const r = orig.apply(this, a);
      dealt = { seconds: +r.toFixed(2), turn: a[0].turn, counts: a[0].counts };
      return r;
    };
    app.press('start');
    for (let i = 0; i < 14; i++) {
      await new Promise((r) => setTimeout(r, 250));
      samples.push({
        ms: (i + 1) * 250,
        flying: t.flights.length,
        hand: t.hand.size,
        fans: [...t.fans.values()].map((f) => f.length).join('/'),
        wait: +app.wait.toFixed(2),
      });
    }
    t.deal = orig;
    return { dealt, firstView: app.view ? { turn: app.view.turn, phase: app.view.phase } : null, samples };
  });
}
