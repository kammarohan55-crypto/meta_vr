/** Table host tests: lobby, AI fill, hidden hands, a full game, disconnects, rematch. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TableHost, AUTOPILOT_AFTER_MS, isCode, makeCode } from './table-host.ts';
import type { HostIO } from './table-host.ts';
import type { LobbyMsg, ViewMsg } from './protocol.ts';
import { nextRandom } from './rules.ts';

/** Fake transport with a manual clock. */
function harness() {
  let now = 0;
  let rng = 12345;
  const timers: { at: number; fn: () => void; live: boolean }[] = [];
  const inbox = new Map<string, { type: string; msg: any }[]>();
  const io: HostIO = {
    send(id, type, msg) {
      if (!inbox.has(id)) inbox.set(id, []);
      inbox.get(id)!.push({ type, msg: JSON.parse(JSON.stringify(msg)) });
    },
    schedule(fn, ms) {
      const t = { at: now + ms, fn, live: true };
      timers.push(t);
      return () => (t.live = false);
    },
    now: () => now,
    seed() {
      const [r, n] = nextRandom(rng);
      rng = n;
      return Math.floor(r * 2 ** 31);
    },
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = timers.filter((t) => t.live && t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = due.at;
      due.live = false;
      due.fn();
    }
    now = end;
  };
  const last = (id: string, type: string) => [...(inbox.get(id) ?? [])].reverse().find((m) => m.type === type)?.msg;
  const all = (id: string, type: string) => (inbox.get(id) ?? []).filter((m) => m.type === type).map((m) => m.msg);
  return { io, advance, last, all, inbox };
}

test('room codes are short and unambiguous', () => {
  let r = 1;
  const rand = () => {
    const [v, n] = nextRandom(r);
    r = n;
    return v;
  };
  for (let i = 0; i < 200; i++) {
    const c = makeCode(rand);
    assert.ok(isCode(c), c);
    assert.doesNotMatch(c, /[01OILSZB25]/);
  }
});

test('lobby: host, join, ready, AI fill, start rules', () => {
  const h = harness();
  const t = new TableHost('ABCDE', h.io);
  assert.equal(t.join('alice', { name: 'Alice', look: [1, 2] }), 0);
  assert.equal(t.hostId, 'alice');
  assert.equal(t.join('bob', { name: 'Bob<script>', look: [3] }), 1);
  const lobby: LobbyMsg = h.last('bob', 'lobby');
  assert.equal(lobby.seats[1]!.name, 'Bobscript');
  // only the host can add computer players or start
  t.handle('bob', { t: 'seatAi', seat: 2, on: true, difficulty: 'hard' });
  assert.equal(t.seats[2], null);
  t.handle('alice', { t: 'seatAi', seat: 2, on: true, difficulty: 'hard' });
  assert.equal(t.seats[2]!.ai, true);
  // bob is not ready, so the host cannot start yet
  t.handle('alice', { t: 'start' });
  assert.equal(t.phase, 'lobby');
  t.handle('bob', { t: 'ready', ready: true });
  t.handle('bob', { t: 'start' });
  assert.equal(t.phase, 'lobby');
  t.handle('alice', { t: 'start' });
  assert.equal(t.phase, 'game');
});

test('each player sees only their own hand', () => {
  const h = harness();
  const t = new TableHost('ABCDE', h.io);
  t.join('alice', { name: 'Alice', look: [] });
  t.join('bob', { name: 'Bob', look: [] });
  t.handle('bob', { t: 'ready', ready: true });
  t.handle('alice', { t: 'start' });
  const va: ViewMsg = h.last('alice', 'view');
  const vb: ViewMsg = h.last('bob', 'view');
  assert.equal(va.hand.length, 7);
  assert.equal(vb.hand.length, 7);
  const ids = new Set(va.hand.map((c) => c.id));
  assert.ok(vb.hand.every((c) => !ids.has(c.id)));
  // nothing alice received ever contains bob's card ids
  const bobIds = vb.hand.map((c) => c.id);
  for (const m of h.inbox.get('alice')!) {
    const text = JSON.stringify(m.msg);
    if (m.type === 'view') {
      const v = m.msg as ViewMsg;
      assert.ok(v.hand.every((c) => !bobIds.includes(c.id)));
    }
    assert.ok(!/"hand":\[\{[^\]]*\}\].*"hand"/.test(text));
  }
});

test('illegal moves are rejected and change nothing', () => {
  const h = harness();
  const t = new TableHost('ABCDE', h.io);
  t.join('alice', { name: 'Alice', look: [] });
  t.join('bob', { name: 'Bob', look: [] });
  t.handle('bob', { t: 'ready', ready: true });
  t.handle('alice', { t: 'start' });
  const v: ViewMsg = h.last('alice', 'view');
  const notMine = v.current === 0 ? 'bob' : 'alice';
  const mine = notMine === 'bob' ? 'alice' : 'bob';
  t.handle(notMine, { t: 'act', action: { type: 'draw' } });
  assert.match(h.last(notMine, 'reject').error, /not your turn/);
  // play a card the current player does not hold
  const other: ViewMsg = h.last(notMine, 'view');
  t.handle(mine, { t: 'act', action: { type: 'play', cardId: other.hand[0].id } });
  assert.match(h.last(mine, 'reject').error, /not in your hand/);
});

test('two people and two computers play a whole game, then rematch', () => {
  const h = harness();
  const t = new TableHost('ABCDE', h.io);
  t.join('alice', { name: 'Alice', look: [] });
  t.join('bob', { name: 'Bob', look: [] });
  t.handle('alice', { t: 'seatAi', seat: 2, on: true, difficulty: 'normal' });
  t.handle('alice', { t: 'seatAi', seat: 3, on: true, difficulty: 'easy' });
  t.handle('bob', { t: 'ready', ready: true });
  t.handle('alice', { t: 'start' });
  // the people play the first legal card, or draw, or pass
  let guard = 0;
  while (t.phase === 'game' && guard++ < 4000) {
    for (const id of ['alice', 'bob']) {
      const v: ViewMsg = h.last(id, 'view');
      if (v.phase !== 'play' || v.current !== v.seat) continue;
      if (v.playable.length) {
        const c = v.hand.find((x) => x.id === v.playable[0])!;
        t.handle(id, { t: 'act', action: { type: 'play', cardId: c.id, color: c.color < 0 ? 2 : undefined } });
      } else if (!v.hasDrawn) t.handle(id, { t: 'act', action: { type: 'draw' } });
      else t.handle(id, { t: 'act', action: { type: 'pass' } });
    }
    h.advance(3000);
  }
  assert.equal(t.phase, 'results');
  const lobby: LobbyMsg = h.last('alice', 'lobby');
  assert.equal(lobby.seats.reduce((s, x) => s + (x?.wins ?? 0), 0), 1);
  const ev = h.all('bob', 'events').flatMap((m: any) => m.events);
  assert.ok(ev.some((e: any) => e.e === 'win'));
  // rematch: everyone votes
  t.handle('bob', { t: 'rematch' });
  assert.equal(t.phase, 'results');
  t.handle('alice', { t: 'rematch' });
  assert.equal(t.phase, 'game');
  assert.equal(t.round, 2);
});

test('a dropped player keeps their seat, the computer covers after a while, and they can return', () => {
  const h = harness();
  const t = new TableHost('ABCDE', h.io);
  t.join('alice', { name: 'Alice', look: [] });
  t.join('bob', { name: 'Bob', look: [] });
  t.handle('bob', { t: 'ready', ready: true });
  t.handle('alice', { t: 'start' });
  t.drop('bob');
  assert.equal(t.seats[1]!.connected, false);
  assert.equal(t.seats[1]!.autopilot, false);
  h.advance(AUTOPILOT_AFTER_MS + 10);
  assert.equal(t.seats[1]!.autopilot, true);
  t.reconnect('bob');
  assert.equal(t.seats[1]!.autopilot, false);
  assert.equal(t.seats[1]!.connected, true);
  const v: ViewMsg = h.last('bob', 'view');
  assert.equal(v.seat, 1);
  // leaving for good mid-game hands the seat to a bot; the game goes on
  t.leave('bob');
  assert.equal(t.seats[1]!.autopilot, true);
  let guard = 0;
  while (t.phase === 'game' && guard++ < 4000) {
    const va: ViewMsg = h.last('alice', 'view');
    if (va.current === 0 && va.phase === 'play') {
      if (va.playable.length) {
        const c = va.hand.find((x) => x.id === va.playable[0])!;
        t.handle('alice', { t: 'act', action: { type: 'play', cardId: c.id, color: c.color < 0 ? 1 : undefined } });
      } else if (!va.hasDrawn) t.handle('alice', { t: 'act', action: { type: 'draw' } });
      else t.handle('alice', { t: 'act', action: { type: 'pass' } });
    }
    h.advance(3000);
  }
  assert.equal(t.phase, 'results');
});

test('turn timer draws and passes for an idle player', () => {
  const h = harness();
  const t = new TableHost('ABCDE', h.io);
  t.join('alice', { name: 'Alice', look: [] });
  t.join('bob', { name: 'Bob', look: [] });
  t.handle('alice', { t: 'rules', rules: { drawUntilPlayable: false, turnSeconds: 15 } });
  t.handle('bob', { t: 'ready', ready: true });
  t.handle('alice', { t: 'start' });
  const v0: ViewMsg = h.last('alice', 'view');
  const who = v0.current;
  h.advance(15100);
  const v1: ViewMsg = h.last('alice', 'view');
  assert.notEqual(v1.current, who);
  assert.equal(v1.counts[who], 8);
});
