// Dev-only: runs one action (ACTION=world:<name> | solo | press:<buttonId>) and records every
// frame for SECONDS (default 6) afterwards, long main-thread tasks, and the main-thread time
// spent inside each Sound method, to find hitches.
export default async function run({ frame }) {
  return frame.evaluate(
    async ({ action, seconds }) => {
      const app = window.chaos;
      const long = [];
      let obs = null;
      try {
        obs = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) long.push(Math.round(e.duration));
        });
        obs.observe({ type: 'longtask', buffered: false });
      } catch {
        /* long tasks not supported */
      }
      // time every Sound method on the main thread
      const soundMs = {};
      const snd = app.sound;
      const orig = {};
      for (const k of Object.getOwnPropertyNames(Object.getPrototypeOf(snd))) {
        if (k === 'constructor' || typeof snd[k] !== 'function') continue;
        orig[k] = snd[k];
        snd[k] = function (...args) {
          const s0 = performance.now();
          try {
            return orig[k].apply(this, args);
          } finally {
            const e = soundMs[k] ?? (soundMs[k] = { calls: 0, ms: 0, max: 0 });
            const d = performance.now() - s0;
            e.calls++;
            e.ms += d;
            e.max = Math.max(e.max, d);
          }
        };
      }
      const times = [];
      let last = performance.now();
      const t0 = performance.now();
      const done = new Promise((resolve) => {
        const tick = (now) => {
          times.push({ at: Math.round(now - t0), ms: +(now - last).toFixed(1) });
          last = now;
          if (now - t0 < seconds * 1000) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
      const a0 = performance.now();
      if (action.startsWith('world:')) app.switchWorld(action.slice(6));
      else if (action === 'solo') app.startSolo();
      else if (action.startsWith('press:')) app.press(action.slice(6));
      const actionMs = +(performance.now() - a0).toFixed(1);
      await done;
      obs?.disconnect();
      for (const k of Object.keys(orig)) delete snd[k];
      for (const e of Object.values(soundMs)) {
        e.ms = +e.ms.toFixed(1);
        e.max = +e.max.toFixed(2);
      }
      const ms = times.slice(1).map((t) => t.ms).sort((a, b) => a - b);
      const avg = ms.reduce((a, b) => a + b, 0) / ms.length;
      const worst = [...times.slice(1)].sort((a, b) => b.ms - a.ms).slice(0, 8);
      return {
        action,
        actionMs,
        frames: ms.length,
        avgMs: +avg.toFixed(2),
        p95Ms: ms[Math.floor(ms.length * 0.95)],
        maxMs: ms[ms.length - 1],
        over33: ms.filter((x) => x > 33).length,
        over50: ms.filter((x) => x > 50).length,
        worst,
        longTasks: long,
        soundMs,
        audio: snd.ctx ? { state: snd.ctx.state, baseLatency: snd.ctx.baseLatency, outputLatency: snd.ctx.outputLatency } : null,
      };
    },
    { action: process.env.ACTION ?? 'solo', seconds: Number(process.env.SECONDS ?? 6) },
  );
}
