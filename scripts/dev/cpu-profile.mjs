// Dev-only: a sampling CPU profile of the running game (SECONDS, default 4) through the
// DevTools protocol; returns the hottest functions by self time and totals per source file.
export default async function run({ cdp }) {
  const seconds = Number(process.env.SECONDS ?? 4);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  await new Promise((r) => setTimeout(r, seconds * 1000));
  const { profile } = await cdp.send('Profiler.stop');
  await cdp.send('Profiler.disable');
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const total = profile.endTime - profile.startTime;
  for (let i = 0; i < profile.samples.length; i++) {
    const n = byId.get(profile.samples[i]);
    const dt = profile.timeDeltas[i] ?? 0;
    const f = n.callFrame;
    const file = (f.url || '').split('/').pop().split('?')[0] || '(native)';
    const key = `${f.functionName || '(anon)'} @ ${file}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + dt);
  }
  const files = new Map();
  for (const [k, v] of self) {
    const file = k.split(' @ ')[1].split(':')[0];
    files.set(file, (files.get(file) ?? 0) + v);
  }
  const ms = (us) => +(us / 1000).toFixed(1);
  // FOCUS=<functionName>: where its time comes from (three callers up)
  const focus = process.env.FOCUS;
  const callers = {};
  if (focus) {
    const parent = new Map();
    for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    const selfById = new Map();
    for (let i = 0; i < profile.samples.length; i++) selfById.set(profile.samples[i], (selfById.get(profile.samples[i]) ?? 0) + (profile.timeDeltas[i] ?? 0));
    for (const n of profile.nodes) {
      if (n.callFrame.functionName !== focus) continue;
      const chain = [];
      for (let id = parent.get(n.id), k = 0; id && k < 4; id = parent.get(id), k++) {
        const f = byId.get(id).callFrame;
        chain.push(`${f.functionName || '(anon)'}:${f.lineNumber + 1}`);
      }
      const key = chain.join(' < ');
      // include time spent in the focus function's children too
      let t = 0;
      const stack = [n.id];
      while (stack.length) {
        const id = stack.pop();
        t += selfById.get(id) ?? 0;
        for (const c of byId.get(id).children ?? []) stack.push(c);
      }
      callers[key] = (callers[key] ?? 0) + t;
    }
  }
  return {
    callers: Object.entries(callers).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${ms(v)} ms  ${k}`),
    seconds: ms(total) / 1000,
    top: [...self].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => `${ms(v)} ms  ${k}`),
    files: [...files].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${ms(v)} ms  ${k}`),
  };
}
