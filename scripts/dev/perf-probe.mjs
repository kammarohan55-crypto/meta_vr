// Dev-only: where a frame's time goes. Optionally throttles the CPU (THROTTLE=4 approximates a
// Quest-class CPU against this laptop), then for FRAMES frames times app.update and its parts,
// the renderer's CPU submit time, and reads draw calls and triangles.
export default async function run({ frame, cdp }) {
  const rate = Number(process.env.THROTTLE ?? 1);
  if (cdp && rate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  try {
    return await frame.evaluate(async (frames) => {
      const app = window.chaos;
      const renderer = app.warmup.renderer;
      const parts = {};
      const undo = [];
      const wrap = (obj, name, label) => {
        if (!obj || typeof obj[name] !== 'function') return;
        const orig = obj[name];
        obj[name] = function (...a) {
          const t0 = performance.now();
          try {
            return orig.apply(this, a);
          } finally {
            (parts[label] ??= []).push(performance.now() - t0);
          }
        };
        undo.push(() => (obj[name] = orig));
      };
      wrap(app, 'update', 'app.update');
      wrap(app.cast, 'update', 'cast.update');
      wrap(app.cast, 'plates', 'cast.plates');
      wrap(app.table, 'update', 'table.update');
      wrap(app.lounge, 'update', 'world.update');
      wrap(app.fx, 'update', 'fx.update');
      wrap(app.magic, 'update', 'magic.update');
      wrap(app.panel, 'update', 'panel.update');
      wrap(app.dock, 'update', 'dock.update');
      wrap(app.hint, 'update', 'hint.update');
      wrap(app.pranks, 'update', 'pranks.update');
      wrap(app.mascot, 'update', 'mascot.update');
      wrap(app, 'updateSelf', 'updateSelf');
      wrap(app, 'placeFan', 'placeFan');
      wrap(renderer, 'render', 'renderer.render');
      const times = [];
      let calls = 0;
      let tris = 0;
      let last = performance.now();
      await new Promise((resolve) => {
        const tick = (now) => {
          times.push(now - last);
          last = now;
          calls = Math.max(calls, renderer.info.render.calls);
          tris = Math.max(tris, renderer.info.render.triangles);
          if (times.length < frames) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
      undo.forEach((f) => f());
      const stat = (a) => {
        const s = [...a].sort((x, y) => x - y);
        const avg = s.reduce((x, y) => x + y, 0) / s.length;
        return { avg: +avg.toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), n: s.length };
      };
      const out = {};
      for (const [k, v] of Object.entries(parts)) out[k] = stat(v);
      times.shift();
      return {
        screen: app.screen,
        frame: stat(times),
        fps: +(1000 / stat(times).avg).toFixed(1),
        drawCalls: calls,
        triangles: tris,
        programs: renderer.info.programs.length,
        textures: renderer.info.memory.textures,
        geometries: renderer.info.memory.geometries,
        shadowAuto: renderer.shadowMap.autoUpdate,
        parts: out,
      };
    }, Number(process.env.FRAMES ?? 240));
  } finally {
    if (cdp && rate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
}
