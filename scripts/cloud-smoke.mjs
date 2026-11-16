// Smoke test for an online-play backend (the Cloudflare Worker locally via `npm run cloud:dev`,
// a deployment, or the Node server): health, a private table with a friend, Quick match with two
// strangers, a public table dealing by itself, and a move seen by the other player.
// Usage: node scripts/cloud-smoke.mjs http://127.0.0.1:8787
const base = (process.argv[2] ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const wsBase = base.replace(/^http/, 'ws') + '/chaos-ws';
const log = (s) => console.log(`${(performance.now() / 1000).toFixed(2)}s  ${s}`);

class Player {
  constructor(name) {
    this.name = name;
    this.lobby = null;
    this.view = null;
    this.code = '';
    this.id = '';
    this.errors = [];
  }
  open(hello) {
    const url = new URL(wsBase);
    url.searchParams.set('op', hello.t);
    if (hello.code) url.searchParams.set('code', hello.code);
    this.ws = new WebSocket(url);
    this.ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      if (m.t === 'welcome') {
        this.code = m.code;
        this.id = m.id;
      } else if (m.t === 'lobby') this.lobby = m.m;
      else if (m.t === 'view') this.view = m.m;
      else if (m.t === 'error') this.errors.push(m.reason);
    };
    return new Promise((res, rej) => {
      this.ws.onopen = () => {
        this.ws.send(JSON.stringify(hello));
        res();
      };
      this.ws.onerror = () => rej(new Error(`${this.name}: socket error`));
    });
  }
  send(m) {
    this.ws.send(JSON.stringify(m));
  }
  async until(what, pred, ms = 8000) {
    const t0 = Date.now();
    while (!pred()) {
      if (Date.now() - t0 > ms) throw new Error(`${this.name}: timed out waiting for ${what} (errors: ${this.errors.join(',') || 'none'})`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  close() {
    this.ws.close(1000);
  }
}

const profile = (name) => ({ name, look: [1, 0, 1, 0] });
let ok = true;
const check = (label, cond) => {
  log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) ok = false;
};

try {
  const health = await (await fetch(`${base}/chaos/health`)).json();
  check(`health answers ${JSON.stringify(health)}`, health.ok === true);

  // a private table and a friend with the code
  const a = new Player('host');
  await a.open({ t: 'create', profile: profile('Asha'), pranks: true });
  await a.until('private lobby', () => !!a.lobby);
  const b = new Player('friend');
  await b.open({ t: 'join', code: a.code, profile: profile('Ben'), pranks: true });
  await b.until('joined', () => b.lobby?.seats.filter(Boolean).length === 2);
  check(`private table ${a.code}: friend joined with the code`, b.code === a.code);
  b.send({ t: 'msg', m: { t: 'ready', ready: true } });
  await a.until('friend ready', () => a.lobby?.seats.some((s) => s && s.id === b.id && s.ready));
  a.send({ t: 'msg', m: { t: 'start' } });
  await a.until('deal', () => !!a.view && !!b.view);
  check(`dealt: 7 cards each, hands differ`, a.view.hand.length === 7 && b.view.hand.length === 7 && a.view.hand[0].id !== b.view.hand[0].id);
  const mover = a.view.current === a.view.seat ? a : b;
  const other = mover === a ? b : a;
  const before = other.view.counts[mover.view.seat];
  mover.send({ t: 'msg', m: { t: 'act', action: { type: 'draw' } } });
  await other.until('sees the move', () => other.view.counts[mover.view.seat] !== before);
  check(`a draw was seen by the other player (${before} -> ${other.view.counts[mover.view.seat]})`, true);
  a.close();
  b.close();

  // Quick match: two strangers land at the same public table
  const s1 = new Player('stranger-1');
  await s1.open({ t: 'quick', profile: profile('Cal'), pranks: true });
  await s1.until('public lobby', () => !!s1.lobby?.quick);
  const s2 = new Player('stranger-2');
  await s2.open({ t: 'quick', profile: profile('Dee'), pranks: true });
  await s2.until('public lobby', () => !!s2.lobby?.quick);
  check(`quick match: both strangers at table ${s1.code} (${s2.code}), starts in ${s1.lobby.startsIn}s`, s1.code === s2.code);
  // both press Ready: the table deals at once with computers in the empty seats
  s1.send({ t: 'msg', m: { t: 'ready', ready: true } });
  s2.send({ t: 'msg', m: { t: 'ready', ready: true } });
  await s1.until('public deal', () => s1.lobby?.phase === 'game' && !!s1.view);
  check(`public table dealt with ${s1.lobby.seats.filter((x) => x?.ai).length} computer players`, s1.lobby.seats.filter((x) => x?.ai).length === 2);
  // a later stranger gets a new table (that one has started)
  const s3 = new Player('stranger-3');
  await s3.open({ t: 'quick', profile: profile('Eli'), pranks: true });
  await s3.until('public lobby', () => !!s3.lobby?.quick);
  check(`a later stranger gets a new public table (${s3.code})`, s3.code !== s1.code);
  for (const p of [s1, s2, s3]) p.close();

  // codes nobody hosts are refused with a reason: a well-formed one, and one with a letter codes never use
  for (const code of ['QQQQQ', 'ZZZZO']) {
    const lost = new Player(`lost-${code}`);
    await lost.open({ t: 'join', code, profile: profile('Zed'), pranks: true });
    await lost.until('refused', () => lost.errors.length > 0);
    check(`code ${code} that nobody hosts is refused (${lost.errors[0]})`, lost.errors[0] === 'not-found');
  }
} catch (e) {
  log(`FAIL  ${e.message}`);
  ok = false;
}
log(ok ? 'ALL PASSED' : 'SOME CHECKS FAILED');
process.exit(ok ? 0 : 1);
