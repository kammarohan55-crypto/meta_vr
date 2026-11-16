// Dev-only: MODE=start records pointer events reaching your hand cards' hit planes and the
// hint shown; MODE=read returns them (did a real click reach a card, and which one?).
export default async function run({ frame }) {
  return frame.evaluate((mode) => {
    const app = window.chaos;
    if (mode === 'start') {
      window.__cards = [];
      for (const [id, hc] of app.table.hand) {
        if (hc.hit.__spied) continue;
        hc.hit.__spied = true;
        for (const t of ['pointerdown', 'pointerup', 'click']) hc.hit.addEventListener(t, () => window.__cards?.push(`${t}:${id}`));
      }
      return 'recording';
    }
    return { events: window.__cards ?? [], hint: app.hintText, hand: app.view?.hand.length, myTurn: app.view?.current === app.view?.seat, playable: app.view?.playable };
  }, process.env.MODE ?? 'read');
}
