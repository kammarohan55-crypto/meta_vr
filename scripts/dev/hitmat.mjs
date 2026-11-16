// Dev-only: read or set the hand cards' invisible hit material's `visible` (VIS=1|0).
export default async function run({ frame }) {
  return frame.evaluate((vis) => {
    const m = window.chaos.table.hitMat;
    if (vis !== '') m.visible = vis === '1';
    return { visible: m.visible };
  }, process.env.VIS ?? '');
}
