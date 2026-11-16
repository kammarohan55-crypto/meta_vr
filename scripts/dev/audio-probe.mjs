// Dev-only: is the audio ready? Context state, decoded recordings per set, designed sounds,
// shared spatial panners, and the current soundtrack.
export default async function run({ frame }) {
  return frame.evaluate(() => {
    const s = window.chaos.sound;
    const sets = {};
    for (const [k, v] of s.samples) sets[k] = v.length;
    return {
      ready: s.ready,
      state: s.ctx?.state ?? 'none',
      sampleRate: s.ctx?.sampleRate,
      sets,
      setCount: Object.keys(sets).length,
      designed: [...s.designed.keys()],
      panners: s.panners.size,
      track: s.track ? { url: s.track.url, paused: s.track.el.paused, gain: +s.track.gain.gain.value.toFixed(2) } : null,
    };
  });
}
