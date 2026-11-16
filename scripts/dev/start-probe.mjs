// Dev-only: press Start (from the solo screen) and time the main steps of a game starting:
// seating the cast, lobby and view handling, the deal, menus and the event queue.
export default async function run({ frame }) {
  return frame.evaluate(async () => {
    const app = window.chaos;
    const times = {};
    const undo = [];
    const wrap = (obj, name, label) => {
      const orig = obj[name];
      if (typeof orig !== 'function') return;
      obj[name] = function (...a) {
        const t0 = performance.now();
        try {
          return orig.apply(this, a);
        } finally {
          const e = times[label] ?? (times[label] = { n: 0, ms: 0, max: 0 });
          const d = performance.now() - t0;
          e.n++;
          e.ms = +(e.ms + d).toFixed(1);
          e.max = +Math.max(e.max, d).toFixed(1);
        }
      };
      undo.push(() => (obj[name] = orig));
    };
    wrap(app.cast, 'sync', 'cast.sync');
    wrap(app, 'onLobby', 'onLobby');
    wrap(app, 'applyView', 'applyView');
    wrap(app.table, 'deal', 'table.deal');
    wrap(app.table, 'syncHand', 'table.syncHand');
    wrap(app.table, 'syncFans', 'table.syncFans');
    wrap(app, 'show', 'show');
    wrap(app, 'renderDock', 'renderDock');
    wrap(app, 'run', 'run(event)');
    wrap(app, 'update', 'app.update');
    wrap(app.cast, 'update', 'cast.update');
    wrap(app.table, 'update', 'table.update');
    wrap(app.lounge, 'update', 'world.update');
    wrap(app.panel, 'update', 'panel.update');
    wrap(app.dock, 'update', 'dock.update');
    // every effect and magic method, and every sound
    for (const [obj, tag] of [[app.fx, 'fx'], [app.magic, 'magic'], [app.sound, 'sound'], [app.cast, 'cast']]) {
      for (const k of Object.getOwnPropertyNames(Object.getPrototypeOf(obj))) {
        if (k === 'constructor' || k === 'update' || k === 'sync' || typeof obj[k] !== 'function') continue;
        wrap(obj, k, `${tag}.${k}`);
      }
    }
    const frames = [];
    const start = performance.now();
    let last = start;
    await new Promise((resolve) => {
      const tick = (now) => {
        frames.push({ at: Math.round(now - start), ms: +(now - last).toFixed(0) });
        last = now;
        if (now - start < Number(window.__probeMs ?? 9000)) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
      app.press('start');
    });
    undo.forEach((f) => f());
    const heavy = Object.fromEntries(Object.entries(times).filter(([, v]) => v.max >= 3));
    return { heavy, slow: frames.filter((f) => f.ms > 30) };
  });
}
