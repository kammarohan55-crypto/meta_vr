// Dev-only: switches the saved world (frostpeak | lounge) for comparison runs; reload afterwards.
export default async function run({ frame }) {
  return frame.evaluate((world) => {
    const key = 'chaos-table.settings.v1';
    const s = JSON.parse(localStorage.getItem(key) ?? '{}');
    s.world = world;
    localStorage.setItem(key, JSON.stringify(s));
    return `world=${world}`;
  }, process.env.WORLD ?? 'frostpeak');
}
