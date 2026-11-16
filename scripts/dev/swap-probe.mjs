// Dev-only: switch world (WORLD=shrine) and time each step of the covered swap: building the
// world, the shader compile call, the texture upload, and every frame with the swap phase.
export default async function run({ frame }) {
  return frame.evaluate(async (world) => {
    const app = window.chaos;
    const w = app.warmup;
    const steps = [];
    const wrap = (obj, name, label) => {
      const orig = obj[name];
      obj[name] = function (...a) {
        const t0 = performance.now();
        const r = orig.apply(this, a);
        steps.push({ step: label, ms: +(performance.now() - t0).toFixed(1), at: Math.round(t0 - start) });
        return r;
      };
      return () => (obj[name] = orig);
    };
    const start = performance.now();
    const undo = [wrap(app, 'buildWorld', 'build'), wrap(w, 'compile', 'compile(sync)'), wrap(w, 'flush', 'flush'), wrap(w, 'textures', 'collect')];
    const renderer = w.renderer;
    const gl = renderer.getContext();
    const ext = gl.getExtension('KHR_parallel_shader_compile');
    const frames = [];
    let last = performance.now();
    const programsBefore = renderer.info.programs.length;
    await new Promise((resolve) => {
      const tick = (now) => {
        frames.push({ at: Math.round(now - start), ms: +(now - last).toFixed(1), phase: app.swap?.phase ?? '-' });
        last = now;
        if (now - start < 3500) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
      app.switchWorld(world);
    });
    undo.forEach((f) => f());
    return {
      parallelCompile: !!ext,
      programs: [programsBefore, renderer.info.programs.length],
      steps,
      slow: frames.filter((f) => f.ms > 25),
      phases: frames.reduce((m, f) => ((m[f.phase] = (m[f.phase] ?? 0) + 1), m), {}),
    };
  }, process.env.WORLD ?? 'shrine');
}
