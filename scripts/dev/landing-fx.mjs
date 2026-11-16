// Dev-only: fires the card-landing effect on the pile (as a real play does on arrival)
// so its visuals can be screenshotted at the right moment.
export default async function run({ frame }) {
  return frame.evaluate(async () => {
    window.chaos.cardLanded({ id: 999, color: 1, kind: 'number', value: 5 });
    await new Promise((r) => setTimeout(r, 120));
    return 'landed';
  });
}
