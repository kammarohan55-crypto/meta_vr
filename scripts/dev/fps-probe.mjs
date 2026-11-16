// Dev-only: frame times over ~3 s in the current view (the managed window must be visible).
export default async function run({ frame }) {
  return frame.evaluate(async () => {
    const times = [];
    let last = performance.now();
    await new Promise((resolve) => {
      const tick = (now) => {
        times.push(now - last);
        last = now;
        if (times.length < 180) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    times.shift();
    times.sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    return { frames: times.length, avgMs: +avg.toFixed(2), p95Ms: +times[Math.floor(times.length * 0.95)].toFixed(2), fps: +(1000 / avg).toFixed(1), visibility: document.visibilityState };
  });
}
