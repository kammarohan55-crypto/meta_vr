// Dev-only: switch world (WORLD=<name>, or WORLD=press:<button>) and time every WebGL call by swap phase, to see what a
// slow frame is waiting on (shader compile/link, texture upload, buffer upload, a sync query).
export default async function run({ frame }) {
  return frame.evaluate(async (world) => {
    const app = window.chaos;
    const gl = app.warmup.renderer.getContext();
    const stats = {};
    const orig = {};
    const proto = Object.getPrototypeOf(gl);
    for (const k of Object.getOwnPropertyNames(proto)) {
      let d;
      try {
        d = Object.getOwnPropertyDescriptor(proto, k);
      } catch {
        continue;
      }
      if (!d || typeof d.value !== 'function') continue;
      orig[k] = d.value;
      gl[k] = function (...a) {
        const t0 = performance.now();
        const r = orig[k].apply(gl, a);
        const ms = performance.now() - t0;
        if (ms > 0.05 || k === 'linkProgram' || k === 'createProgram' || k === 'getProgramInfoLog' || k === 'getProgramParameter') {
          const key = `${app.swap?.phase ?? '-'}:${k}`;
          const e = stats[key] ?? (stats[key] = { n: 0, ms: 0, max: 0 });
          e.n++;
          e.ms += ms;
          e.max = Math.max(e.max, ms);
        }
        return r;
      };
    }
    const frames = [];
    const start = performance.now();
    let last = start;
    await new Promise((resolve) => {
      const tick = (now) => {
        frames.push({ at: Math.round(now - start), ms: +(now - last).toFixed(0), p: app.swap?.phase ?? '-' });
        last = now;
        if (now - start < 2500) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
      if (world.startsWith('press:')) app.press(world.slice(6));
      else app.switchWorld(world);
    });
    for (const k of Object.keys(orig)) delete gl[k];
    const top = Object.entries(stats)
      .map(([k, v]) => [k, +v.ms.toFixed(1), v.n, +v.max.toFixed(1)])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 14);
    const compiles = Object.entries(stats)
      .filter(([k]) => /linkProgram|createProgram|getProgramInfoLog|getProgramParameter/.test(k))
      .map(([k, v]) => [k, v.n, +v.ms.toFixed(1)]);
    const r = app.warmup.renderer;
    return { top, compiles, slow: frames.filter((f) => f.ms > 40), toneMapping: r.toneMapping, target: !!r.getRenderTarget(), checkShaderErrors: r.debug.checkShaderErrors };
  }, process.env.WORLD ?? 'shrine');
}
