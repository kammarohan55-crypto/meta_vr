// Dev-only: in a running game, make a computer player's last card count as a hit on you, so the
// "Get even!" offer appears (as after a real +2 or skip). Reports the dock's buttons.
export default async function run({ frame }) {
  return frame.evaluate(() => {
    const app = window.chaos;
    const seat = app.lobby?.seats.findIndex((s, i) => s && s.ai && i !== app.mySeat()) ?? -1;
    if (seat < 0) return { error: 'no computer player' };
    app.offerRevenge(seat);
    return { seat, tray: app.tray, buttons: app.dock.buttons.map((b) => `${b.id}:${b.label}${b.kind ? `(${b.kind})` : ''}`) };
  });
}
