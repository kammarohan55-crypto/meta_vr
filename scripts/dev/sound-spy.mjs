// Dev-only: MODE=start records which sounds play (set name, volume, rate) until MODE=read
// returns and clears the list. Lets real clicks be checked for the right sound.
export default async function run({ frame }) {
  return frame.evaluate((mode) => {
    const s = window.chaos.sound;
    if (mode === 'start') {
      window.__played = [];
      if (!s.__spied) {
        const orig = s.play;
        s.play = function (set, at, vol, o = {}) {
          const ok = orig.call(this, set, at, vol, o);
          window.__played?.push(`${set}${ok ? '' : '(missing)'}@${vol}${o.rate ? ` x${o.rate}` : ''}${o.when ? ` +${o.when.toFixed?.(2) ?? o.when}s` : ''}`);
          return ok;
        };
        s.__spied = true;
      }
      return 'recording';
    }
    const out = window.__played ?? [];
    window.__played = [];
    return out;
  }, process.env.MODE ?? 'read');
}
