// Dev-only: lengthen the reveal hold, make my move if it is my turn (a legal non-wild card,
// through the app's normal action), then wait for a computer player's real play to be held up.
export default async function run({ frame }) {
  return frame.evaluate(async () => {
    const app = window.chaos;
    app.table.revealHold = 4;
    const prev = app.table.onReveal;
    const seen = new Promise((resolve) => {
      const stop = setTimeout(() => resolve(null), 25000);
      app.table.onReveal = (seat, card, at) => {
        prev?.(seat, card, at);
        clearTimeout(stop);
        resolve({ seat, card });
      };
    });
    const v = app.view;
    if (v && v.phase === 'play' && v.current === v.seat) {
      const card = v.hand.find((c) => v.playable.includes(c.id) && c.kind !== 'wild' && c.kind !== 'wild4');
      if (card) app.send({ t: 'act', action: { type: 'play', cardId: card.id } });
      else app.send({ t: 'act', action: { type: 'draw' } });
    }
    const result = await seen;
    app.table.onReveal = prev;
    setTimeout(() => (app.table.revealHold = 0.8), 6000);
    return { seen: result };
  });
}
