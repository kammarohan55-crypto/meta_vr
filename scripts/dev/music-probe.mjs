// Dev-only: what the soundtrack is doing (url, playing, position) and the audio context state.
export default async function run({ frame }) {
  return frame.evaluate(() => {
    const s = window.chaos.sound;
    const t = s.track;
    return { ctx: s.ctx?.state ?? 'none', url: t?.url ?? '', paused: t ? t.el.paused : null, time: t ? +t.el.currentTime.toFixed(1) : 0, ready: t?.el.readyState ?? -1, gain: t ? +t.gain.gain.value.toFixed(2) : 0 };
  });
}
