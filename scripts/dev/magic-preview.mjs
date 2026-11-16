// Dev-only: queue a special-card moment through the normal event timeline in slow motion, so
// its magic can be screenshotted (MAGIC=draw4|reverse|color|last|skip). Not interaction proof.
export default async function run({ frame }) {
  return frame.evaluate((which) => {
    const app = window.chaos;
    const ev = {
      draw4: [{ e: 'draw4', from: 1, target: 2, stack: 8 }],
      reverse: [{ e: 'reverse', direction: -1 }],
      color: [{ e: 'color', color: 3 }],
      last: [{ e: 'lastCard', seat: 2 }],
      skip: [{ e: 'skip', seat: 3 }],
    }[which];
    app.timeScale = 0.12;
    app.queue.push(...ev);
    setTimeout(() => (app.timeScale = 1), 6000);
    return which;
  }, process.env.MAGIC ?? 'draw4');
}
