// Dev-only: the built game served by the Cloudflare Worker (URL, default the local
// `npm run cloud:dev` on 127.0.0.1:8787), two browser players doing Quick match through the
// app's own menu actions: same public table, both ready, the deal, a move seen by the other.
// Run: URL=http://127.0.0.1:8787 npx @iwsdk/cli browser run scripts/dev/cloud-browser-test.mjs --timeout 105000
export default async function run({ context, workspaceRoot }) {
  const url = process.env.URL ?? 'http://127.0.0.1:8787/';
  const log = [];
  const step = (s) => log.push(s);
  const until = async (page, label, fn, ms = 30000, arg = null) => {
    const t0 = Date.now();
    for (;;) {
      const v = await page.evaluate(fn, arg).catch(() => null);
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error(`timed out: ${label}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  };
  const pages = [];
  try {
    for (let i = 0; i < 2; i++) {
      const p = await context.newPage();
      await p.goto(url, { waitUntil: 'load' });
      await until(p, 'game loaded', () => !!window.chaos);
      pages.push(p);
    }
    step(`two players loaded the game from ${url}`);
    const [a, b] = pages;
    await a.evaluate(() => void window.chaos.quickMatch());
    const codeA = await until(a, 'A at a public table', () => (window.chaos.lobby?.quick ? window.chaos.lobby.code : null));
    await b.evaluate(() => void window.chaos.quickMatch());
    const codeB = await until(b, 'B at a public table', () => (window.chaos.lobby?.quick ? window.chaos.lobby.code : null));
    const via = await a.evaluate(() => window.chaos.conn?.via);
    step(`quick match: A at ${codeA}, B at ${codeB} (same table: ${codeA === codeB}), connected via ${via}`);
    await a.screenshot({ path: `${workspaceRoot}/.cache/cloud-lobby.png` });
    await a.evaluate(() => window.chaos.press('ready'));
    await b.evaluate(() => window.chaos.press('ready'));
    const seats = await until(a, 'deal', () => (window.chaos.lobby?.phase === 'game' && (window.chaos.view || window.chaos.pendingView) ? window.chaos.lobby.seats.map((s) => (s ? (s.ai ? 'computer' : s.name) : '-')) : null));
    step(`both ready: dealt at once; seats ${JSON.stringify(seats)}`);
    const va = await a.evaluate(() => window.chaos.view ?? window.chaos.pendingView);
    const vb = await b.evaluate(() => window.chaos.view ?? window.chaos.pendingView);
    step(`A has ${va.hand.length} cards, B has ${vb.hand.length}; hands differ: ${va.hand[0].id !== vb.hand[0].id}`);
    await a.screenshot({ path: `${workspaceRoot}/.cache/cloud-game.png` });
  } catch (e) {
    step(`FAILED: ${e.message}`);
  } finally {
    for (const p of pages) {
      await p.evaluate(() => window.chaos?.leaveTable()).catch(() => {});
      await p.close().catch(() => {});
    }
  }
  return log;
}
