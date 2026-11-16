// Dev-only: the current table view (phase, whose turn, pile top, my hand) for test scripts.
export default async function run({ frame }) {
  return frame.evaluate(() => {
    const v = window.chaos.view;
    if (!v) return 'no view';
    const { hand, ...rest } = v;
    return { ...rest, hand: hand?.map((c) => `${c.color}:${c.kind}:${c.value ?? ''}`), seats: undefined };
  });
}
