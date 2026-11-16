// Dev-only: export one designed sound (NAME=whoosh, victory, ...) or recorded set (SET=press)
// as 16-bit stereo PCM in base64, so it can be written to a WAV and measured offline.
export default async function run({ frame }) {
  return frame.evaluate(
    ({ name, set }) => {
      const s = window.chaos.sound;
      const buf = name ? s.designed.get(name) : s.samples.get(set)?.[0];
      if (!buf) return { error: `no sound ${name || set}` };
      const n = buf.length;
      const l = buf.getChannelData(0);
      const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;
      const pcm = new Int16Array(n * 2);
      for (let i = 0; i < n; i++) {
        pcm[i * 2] = Math.max(-1, Math.min(1, l[i])) * 32767;
        pcm[i * 2 + 1] = Math.max(-1, Math.min(1, r[i])) * 32767;
      }
      const bytes = new Uint8Array(pcm.buffer);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { sampleRate: buf.sampleRate, frames: n, b64: btoa(bin) };
    },
    { name: process.env.NAME ?? '', set: process.env.SET ?? '' },
  );
}
