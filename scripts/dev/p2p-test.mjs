// Dev-only: two real players over the direct (serverless) online mode. The managed tab hosts a
// table through the app's own menu actions; a second tab joins with the room code; they ready
// up, start, play a move, trade an emote and a toy, then the host closes the table.
// Run: npx @iwsdk/cli browser run scripts/dev/p2p-test.mjs --timeout 180000
export default async function run({ context, frame }) {
  const log = [];
  const step = (s) => log.push(`${new Date().toISOString().slice(14, 23)} ${s}`);
  const until = async (target, label, fn, ms = 30000, arg = null) => {
    const t0 = Date.now();
    for (;;) {
      const v = await target.evaluate(fn, arg).catch(() => null);
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error(`timed out: ${label}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  };
  const host = frame;
  const url = frame.url().replace(/[?&]__iwsdk_preview_reload=[^&]*/, '').replace(/\?$/, '');
  let guestPage = null;
  try {
    // 1. host opens a table (no game server is running, so it is hosted in this tab)
    await host.evaluate(() => window.chaos.hostOnline());
    const code = await until(host, 'host lobby', () => window.chaos.lobby?.code && window.chaos.conn?.via ? `${window.chaos.lobby.code}` : null);
    const via = await host.evaluate(() => window.chaos.conn.via);
    step(`host table ${code} via ${via}`);

    // 2. a second player joins from another tab with the code
    guestPage = await context.newPage();
    await guestPage.goto(url, { waitUntil: 'load' });
    await until(guestPage, 'guest app', () => !!window.chaos);
    const t0 = Date.now();
    await guestPage.evaluate((c) => {
      window.__joinError = '';
      window.chaos.joinOnline(c).catch((e) => (window.__joinError = String(e)));
    }, code);
    await until(guestPage, 'guest in lobby', () => (window.chaos.lobby && window.chaos.conn?.id) || window.chaos.error || window.__joinError, 40000);
    const gstate = await guestPage.evaluate(() => ({ via: window.chaos.conn?.via, error: window.chaos.error, seated: window.chaos.lobby?.seats.filter(Boolean).length }));
    step(`guest joined in ${Date.now() - t0} ms: ${JSON.stringify(gstate)}`);
    if (!gstate.via) throw new Error(`guest could not join: ${gstate.error}`);
    await until(host, 'host sees guest', () => window.chaos.lobby?.seats.filter(Boolean).length === 2);
    step('host sees 2 seated');

    // 3. guest readies, host starts
    await guestPage.evaluate(() => window.chaos.press('ready'));
    await until(host, 'guest ready', () => window.chaos.lobby?.seats.some((s) => s && s.id !== window.chaos.lobby.hostId && s.ready));
    await host.evaluate(() => window.chaos.press('start'));
    const hv = await until(host, 'host deal', () => (window.chaos.view || window.chaos.pendingView) ? (window.chaos.view ?? window.chaos.pendingView) : null);
    const gv = await until(guestPage, 'guest deal', () => (window.chaos.view || window.chaos.pendingView) ? (window.chaos.view ?? window.chaos.pendingView) : null);
    step(`dealt: host ${hv.hand.length} cards (seat ${hv.seat}), guest ${gv.hand.length} cards (seat ${gv.seat}), hands differ: ${hv.hand.map((c) => c.id).join() !== gv.hand.map((c) => c.id).join()}, guest sees host count ${gv.counts[hv.seat]}`);

    // 4. whoever's turn it is draws a card; the other side sees the count change
    const turn = hv.current;
    const mover = turn === hv.seat ? host : guestPage;
    const watcher = turn === hv.seat ? guestPage : host;
    const before = (turn === hv.seat ? gv : hv).counts[turn];
    await mover.evaluate(() => window.chaos.conn.send({ t: 'act', action: { type: 'draw' } }));
    const seen = await until(watcher, 'count change', (a) => {
      const v = window.chaos.pendingView ?? window.chaos.view;
      return v && v.counts[a.turn] !== a.before ? v.counts[a.turn] : null;
    }, 20000, { turn, before }).catch(() => 'no change seen');
    step(`seat ${turn} drew: the other player saw their count go ${before} -> ${seen}`);

    // 5. a toy crosses the table (the host's toy log records the launch it receives)
    const hostPranksBefore = await host.evaluate(() => window.chaos.pranks.recent.length);
    await guestPage.evaluate((target) => window.chaos.prank('snowball', target), hv.seat);
    await until(host, 'toy arrives at host', (n) => window.chaos.pranks.recent.length > n, 8000, hostPranksBefore).catch(() => null);
    const hostPranks = await host.evaluate(() => window.chaos.pranks.recent.slice(-2));
    step(`toy from guest seen by host: ${JSON.stringify(hostPranks)} (before ${hostPranksBefore})`);

    // 6. the host closes the table; the guest is told
    await host.evaluate(() => window.chaos.leaveTable());
    const end = await until(guestPage, 'guest told', () => (window.chaos.screen === 'error' ? window.chaos.error : null), 30000).catch(() => 'not told within 30 s');
    step(`guest after host left: ${end}`);
  } catch (e) {
    step(`FAILED: ${e.message}`);
  } finally {
    if (guestPage) await guestPage.close().catch(() => {});
  }
  return log;
}
