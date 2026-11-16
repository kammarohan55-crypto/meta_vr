// Dev-only: toys in the air right now, and the cooldown (to verify a real throw happened).
export default async function run({ frame }) {
  return frame.evaluate(() => {
    const p = window.chaos.pranks;
    return { recent: p.recent.join(","), flying: p.flights.map((f) => `${f.kind}@${f.t.toFixed(2)}/${f.dur}`), cool: +p.cool.toFixed(2), hint: window.chaos.hintText ?? '' };
  });
}
