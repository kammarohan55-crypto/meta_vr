// Dev-only: which materials have their shader program re-derived during play. three calls a
// material's customProgramCacheKey() each time it re-derives the program parameters, so
// counting those calls over FRAMES frames shows who churns (and how often per frame).
export default async function run({ frame }) {
  return frame.evaluate(async (frames) => {
    const app = window.chaos;
    let scene = app.root;
    while (scene.parent) scene = scene.parent;
    const counts = new Map();
    const undo = [];
    const seen = new Set();
    scene.traverse((o) => {
      for (const m of [].concat(o.material ?? [])) {
        if (seen.has(m)) continue;
        seen.add(m);
        const orig = m.customProgramCacheKey;
        m.customProgramCacheKey = function () {
          const e = counts.get(m) ?? { n: 0, on: o.name || o.type, type: m.type, name: m.name };
          e.n++;
          counts.set(m, e);
          return orig.call(this);
        };
        undo.push(() => {
          if (Object.prototype.hasOwnProperty.call(m, 'customProgramCacheKey')) delete m.customProgramCacheKey;
        });
      }
    });
    let n = 0;
    await new Promise((resolve) => {
      const tick = () => (++n < frames ? requestAnimationFrame(tick) : resolve());
      requestAnimationFrame(tick);
    });
    undo.forEach((f) => f());
    return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 15).map((e) => `${(e.n / frames).toFixed(2)}/frame  ${e.name || e.type} on ${e.on}`);
  }, Number(process.env.FRAMES ?? 120));
}
