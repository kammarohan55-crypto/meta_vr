// Dev-only: in a solo game, has seat 2 play a Red 7 through the normal play animation so the
// reveal (card held up to the viewer, captioned) can be screenshotted mid-hold.
export default async function run({ frame }) {
  return frame.evaluate(async () => {
    const app = window.chaos;
    if (app.screen !== 'game') {
      app.startSolo();
      await new Promise((r) => setTimeout(r, 3500));
    }
    app.table.revealHold = 4;
    app.table.animatePlay(2, { id: 900 + Math.floor(Math.random() * 90), color: 0, kind: 'num', value: 7 }, false);
    await new Promise((r) => setTimeout(r, 900));
    setTimeout(() => (app.table.revealHold = 0.8), 6000);
    return 'revealing';
  });
}
