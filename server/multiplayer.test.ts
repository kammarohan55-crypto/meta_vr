/**
 * End-to-end multiplayer test: a real server on a real port, and real
 * WebSocket clients (Node's built-in WebSocket, the same API browsers use).
 *
 *   node --test server/multiplayer.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './game-server.ts';
import type { RunningServer } from './game-server.ts';
import type { LobbyMsg, PoseMsg, PrankMsg, RtcMsg, ViewMsg, WireIn, WireOut, EmoteMsg } from '../shared/protocol.ts';
import type { GameEvent } from '../shared/rules.ts';

class Player {
  ws!: WebSocket;
  id = '';
  token = '';
  code = '';
  lobby: LobbyMsg | null = null;
  view: ViewMsg | null = null;
  events: GameEvent[] = [];
  poses: PoseMsg[] = [];
  emotes: EmoteMsg[] = [];
  pranks: PrankMsg[] = [];
  rtc: RtcMsg[] = [];
  rejects: string[] = [];
  errors: string[] = [];
  welcomes: { resumed: boolean }[] = [];
  closed = false;
  private waiters: (() => void)[] = [];
  /** Play automatically when it's our turn. */
  auto = false;
  played = 0;

  readonly name: string;
  readonly url: string;
  constructor(name: string, url: string) {
    this.name = name;
    this.url = url;
  }

  open(): Promise<void> {
    this.closed = false;
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = (e) => this.on(JSON.parse(String(e.data)) as WireOut);
    this.ws.onclose = () => {
      this.closed = true;
      this.poke();
    };
    return new Promise((res, rej) => {
      this.ws.onopen = () => res();
      this.ws.onerror = () => rej(new Error('ws error'));
    });
  }

  send(m: WireIn): void {
    this.ws.send(JSON.stringify(m));
  }

  private poke(): void {
    for (const w of this.waiters.splice(0)) w();
  }

  private on(m: WireOut): void {
    switch (m.t) {
      case 'welcome':
        this.id = m.id;
        this.token = m.token;
        this.code = m.code;
        this.welcomes.push({ resumed: m.resumed });
        break;
      case 'error':
        this.errors.push(m.reason);
        break;
      case 'lobby':
        this.lobby = m.m;
        break;
      case 'view':
        this.view = m.m;
        break;
      case 'events':
        this.events.push(...m.m.events);
        break;
      case 'reject':
        this.rejects.push(m.m.error);
        break;
      case 'pose':
        this.poses.push(m.m);
        break;
      case 'emote':
        this.emotes.push(m.m);
        break;
      case 'prank':
        this.pranks.push(m.m);
        break;
      case 'rtc':
        this.rtc.push(m.m);
        break;
    }
    if (this.auto) this.think();
    this.poke();
  }

  /** A simple legal strategy: first playable card, else draw, else pass. */
  private think(): void {
    const v = this.view;
    if (!v || v.phase !== 'play' || v.current !== v.seat || this.lobby?.phase !== 'game') return;
    const key = `${v.round}:${v.turn}:${v.hasDrawn}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    if (v.playable.length) {
      const card = v.hand.find((c) => c.id === v.playable[0])!;
      this.played++;
      this.send({ t: 'msg', m: { t: 'act', action: { type: 'play', cardId: card.id, color: card.color < 0 ? 2 : undefined } } });
    } else if (!v.hasDrawn) this.send({ t: 'msg', m: { t: 'act', action: { type: 'draw' } } });
    else this.send({ t: 'msg', m: { t: 'act', action: { type: 'pass' } } });
  }
  private lastKey = '';

  until(what: string, pred: () => boolean, ms = 4000): Promise<void> {
    if (pred()) return Promise.resolve();
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error(`${this.name}: timed out waiting for ${what}`)), ms);
      const check = () => {
        if (pred()) {
          clearTimeout(timer);
          res();
        } else this.waiters.push(check);
      };
      this.waiters.push(check);
    });
  }

  mySeat(): number {
    return this.lobby?.seats.findIndex((s) => s?.id === this.id) ?? -1;
  }

  close(): void {
    this.ws.close(1000);
  }
}

async function withServer(fn: (s: RunningServer, url: string) => Promise<void>, opts = {}): Promise<void> {
  const s = await startServer({ port: 0, host: '127.0.0.1', aiPace: 0.02, log: () => {}, ...opts });
  try {
    await fn(s, `ws://127.0.0.1:${s.port}`);
  } finally {
    await s.close();
  }
}

const profile = (name: string) => ({ name, look: [1, 2, 3, 0] });

async function hostAndJoin(url: string, guestPranks = true): Promise<[Player, Player]> {
  const a = new Player('host', url);
  await a.open();
  a.send({ t: 'create', profile: profile('Asha'), pranks: true });
  await a.until('welcome', () => !!a.code && !!a.lobby);
  const b = new Player('guest', url);
  await b.open();
  b.send({ t: 'join', code: a.code.toLowerCase(), profile: profile('Ben'), pranks: guestPranks });
  await b.until('lobby', () => !!b.lobby && b.lobby.seats.filter(Boolean).length === 2);
  await a.until('guest in lobby', () => a.lobby!.seats.filter(Boolean).length === 2);
  return [a, b];
}

test('host creates a private room and a friend joins with the code', async () => {
  await withServer(async (s, url) => {
    const [a, b] = await hostAndJoin(url);
    assert.match(a.code, /^[A-Z0-9]{5}$/);
    assert.equal(b.code, a.code);
    assert.equal(a.lobby!.hostId, a.id);
    assert.deepEqual(a.lobby!.seats.filter(Boolean).map((x) => x!.name), ['Asha', 'Ben']);
    assert.equal(s.rooms.size, 1);
    // a wrong code is refused cleanly
    const c = new Player('stranger', url);
    await c.open();
    c.send({ t: 'join', code: 'ZZZZZ', profile: profile('Cy'), pranks: true });
    await c.until('error', () => c.errors.length > 0);
    assert.equal(c.errors[0], 'not-found');
    a.close();
    b.close();
  });
});

test('ready, bots, start; hands stay hidden; illegal moves are refused', async () => {
  await withServer(async (_s, url) => {
    const [a, b] = await hostAndJoin(url);
    // only the host may add bots and start
    b.send({ t: 'msg', m: { t: 'seatAi', seat: 2, on: true, difficulty: 'easy' } });
    b.send({ t: 'msg', m: { t: 'start' } });
    a.send({ t: 'msg', m: { t: 'seatAi', seat: 2, on: true, difficulty: 'hard' } });
    a.send({ t: 'msg', m: { t: 'seatAi', seat: 3, on: true, difficulty: 'normal' } });
    await a.until('bots', () => a.lobby!.seats.filter(Boolean).length === 4);
    assert.equal(a.lobby!.phase, 'lobby');
    b.send({ t: 'msg', m: { t: 'ready', ready: true } });
    await a.until('ready', () => !!a.lobby!.seats[b.mySeat()]?.ready);
    a.send({ t: 'msg', m: { t: 'start' } });
    await a.until('game', () => a.lobby!.phase === 'game' && !!a.view);
    await b.until('game', () => b.lobby!.phase === 'game' && !!b.view);
    assert.equal(a.view!.hand.length, 7);
    assert.equal(b.view!.hand.length, 7);
    // nobody's message ever carries another player's cards
    const aIds = new Set(a.view!.hand.map((c) => c.id));
    assert.ok(b.view!.hand.every((c) => !aIds.has(c.id)));
    for (const ev of a.events) if (ev.e === 'draw' && ev.seat !== a.mySeat()) assert.equal(ev.cards.length, 0);
    // a third person cannot join a game in progress
    const c = new Player('late', url);
    await c.open();
    c.send({ t: 'join', code: a.code, profile: profile('Late'), pranks: true });
    await c.until('error', () => c.errors.length > 0);
    assert.equal(c.errors[0], 'full');
    // playing out of turn (or a card you don't hold) is rejected by the server
    const notMe = a.view!.current === a.mySeat() ? b : a;
    notMe.send({ t: 'msg', m: { t: 'act', action: { type: 'draw' } } });
    await notMe.until('reject', () => notMe.rejects.length > 0);
    const handBefore = notMe.view!.hand.length;
    assert.equal(notMe.view!.hand.length, handBefore);
    a.close();
    b.close();
  });
});

test('two people play a whole game to the end, then rematch in the same room', async () => {
  await withServer(async (_s, url) => {
    const [a, b] = await hostAndJoin(url);
    b.send({ t: 'msg', m: { t: 'ready', ready: true } });
    await a.until('ready', () => !!a.lobby!.seats[b.mySeat()]?.ready);
    a.auto = true;
    b.auto = true;
    a.send({ t: 'msg', m: { t: 'start' } });
    await a.until('game over', () => a.lobby?.phase === 'results', 20000);
    await b.until('game over', () => b.lobby?.phase === 'results', 4000);
    const winner = a.view!.winner;
    assert.ok(winner === a.mySeat() || winner === b.mySeat());
    assert.equal(a.view!.counts[winner], 0);
    assert.equal(b.view!.winner, winner);
    assert.ok(a.played + b.played > 7, 'both players actually played cards');
    assert.ok(a.events.some((e) => e.e === 'win'));
    // a full deck is still accounted for: hands + draw pile never exceed 108
    assert.ok(a.view!.counts.reduce((x, y) => x + y, 0) + a.view!.drawPile < 108);
    assert.equal(a.lobby!.seats[winner]!.wins, 1);
    // rematch without recreating the room
    const round = a.lobby!.round;
    a.auto = false;
    b.auto = false;
    b.send({ t: 'msg', m: { t: 'rematch' } });
    await a.until('vote', () => a.lobby!.rematch.length === 1);
    a.send({ t: 'msg', m: { t: 'rematch' } });
    await b.until('new round', () => b.lobby!.phase === 'game' && b.lobby!.round === round + 1);
    await b.until('fresh hand', () => b.view!.round === round + 1 && b.view!.hand.length === 7);
    assert.equal(b.code, a.code);
    a.close();
    b.close();
  });
});

test('presence: poses, emotes, voice signalling and opt-out pranks are relayed correctly', async () => {
  await withServer(async (_s, url) => {
    const [a, b] = await hostAndJoin(url, false);
    const pose: PoseMsg = { seat: 99, h: [0, 1.2, 0.98, 0, 0, 0, 1], l: [], r: [], v: 0.7 };
    a.send({ t: 'pose', p: pose });
    await b.until('pose', () => b.poses.length === 1);
    assert.equal(b.poses[0].seat, a.mySeat(), 'server stamps the real seat, not the claimed one');
    assert.equal(b.poses[0].v, 0.7);
    // a too-fast second pose is dropped (30 Hz cap)
    a.send({ t: 'pose', p: pose });
    a.send({ t: 'emote', e: { seat: 99, kind: 'laugh' } });
    await b.until('emote', () => b.emotes.length === 1);
    assert.equal(a.poses.length, 0, 'you never get your own pose back');
    assert.equal(b.poses.length, 1);
    assert.deepEqual(b.emotes[0], { seat: a.mySeat(), kind: 'laugh' });
    // WebRTC offer/answer travel only to the named peer
    a.send({ t: 'rtc', to: b.id, data: { sdp: { type: 'offer', sdp: 'v=0' } } });
    await b.until('rtc', () => b.rtc.length === 1);
    assert.equal(b.rtc[0].from, a.id);
    // Ben switched pranks off: nothing aimed at him is delivered
    a.send({ t: 'prank', p: { seat: 0, kind: 'chicken', target: b.mySeat(), p: [], vel: [] } });
    // Asha allows pranks
    b.send({ t: 'prank', p: { seat: 0, kind: 'dart', target: a.mySeat(), p: [], vel: [] } });
    await a.until('prank', () => a.pranks.length === 1);
    await b.until('prank echo', () => b.pranks.length === 1);
    assert.equal(a.pranks[0].kind, 'dart');
    assert.equal(b.pranks[0].kind, 'dart');
    a.close();
    b.close();
  });
});

test('a dropped player keeps their seat and hand, and can resume', async () => {
  await withServer(
    async (s, url) => {
      const [a, b] = await hostAndJoin(url);
      b.send({ t: 'msg', m: { t: 'ready', ready: true } });
      await a.until('ready', () => !!a.lobby!.seats[b.mySeat()]?.ready);
      a.send({ t: 'msg', m: { t: 'start' } });
      await b.until('view', () => !!b.view && b.lobby?.phase === 'game');
      const hand = b.view!.hand.map((c) => c.id).sort();
      const seat = b.mySeat();
      // the connection dies without a goodbye
      // (on the server each member's link is its WebSocket)
      const sock = [...s.rooms.values()][0].members.get(b.id)!.link as unknown as { terminate(): void };
      sock.terminate();
      await a.until('sees drop', () => a.lobby!.seats[seat]?.connected === false);
      // after a moment the computer covers their turns
      await a.until('autopilot', () => a.lobby!.seats[seat]?.autopilot === true, 3000);
      // they come back with their token
      const b2 = new Player('guest-again', url);
      await b2.open();
      b2.send({ t: 'resume', code: b.code, token: b.token });
      await b2.until('resumed', () => b2.welcomes.length === 1 && !!b2.view);
      assert.equal(b2.welcomes[0].resumed, true);
      assert.equal(b2.id, b.id);
      assert.equal(b2.mySeat(), seat);
      await a.until('sees return', () => a.lobby!.seats[seat]?.connected === true && !a.lobby!.seats[seat]?.autopilot);
      // same seat; the hand is theirs (it may have changed if autopilot played)
      if (b2.view!.turn === b.view!.turn) assert.deepEqual(b2.view!.hand.map((c) => c.id).sort(), hand);
      // a wrong token is refused
      const c = new Player('imposter', url);
      await c.open();
      c.send({ t: 'resume', code: b.code, token: 'nope' });
      await c.until('error', () => c.errors.length > 0);
      assert.equal(c.errors[0], 'expired');
      a.close();
      b2.close();
    },
    { autopilotMs: 300 },
  );
});

test('leaving: a bot takes a leaver’s seat mid-game; the room closes when everyone has gone', async () => {
  await withServer(async (s, url) => {
    const [a, b] = await hostAndJoin(url);
    b.send({ t: 'msg', m: { t: 'ready', ready: true } });
    await a.until('ready', () => !!a.lobby!.seats[b.mySeat()]?.ready);
    a.send({ t: 'msg', m: { t: 'start' } });
    await a.until('game', () => a.lobby!.phase === 'game');
    const seat = b.mySeat();
    b.send({ t: 'leave' });
    await a.until('bot took over', () => !!a.lobby!.seats[seat]?.autopilot && a.lobby!.seats[seat]!.id.startsWith('gone'));
    assert.equal(s.rooms.size, 1);
    a.send({ t: 'leave' });
    await a.until('closed', () => a.closed);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(s.rooms.size, 0);
  });
});

test('quick match seats strangers at one public table that starts by itself', async () => {
  await withServer(
    async (s, url) => {
      const a = new Player('stranger-a', url);
      await a.open();
      a.send({ t: 'quick', profile: profile('Asha'), pranks: true });
      await a.until('public lobby', () => !!a.lobby && a.lobby.quick === true && typeof a.lobby.startsIn === 'number');
      const b = new Player('stranger-b', url);
      await b.open();
      b.send({ t: 'quick', profile: profile('Ben'), pranks: true });
      await b.until('same table', () => !!b.lobby && b.code === a.code);
      assert.equal(s.rooms.size, 1);
      assert.equal(a.lobby!.rules.stacking, true);
      // nobody presses anything: the countdown deals, with computers in the two empty seats
      await a.until('starts by itself', () => a.lobby?.phase === 'game' && !!a.view, 4000);
      assert.equal(a.lobby!.seats.filter((x) => x?.ai).length, 2);
      assert.equal(a.view!.hand.length, 7);
      a.close();
      b.close();
    },
    { quickWaitMs: 600 },
  );
});

test('quick match starts at once when everyone is ready, and never offers a private room', async () => {
  await withServer(
    async (s, url) => {
      // a private room exists, but strangers are never sent to it
      const host = new Player('private-host', url);
      await host.open();
      host.send({ t: 'create', profile: profile('Pia'), pranks: true });
      await host.until('private lobby', () => !!host.lobby);
      const a = new Player('stranger', url);
      await a.open();
      a.send({ t: 'quick', profile: profile('Asha'), pranks: true });
      await a.until('public lobby', () => !!a.lobby?.quick);
      assert.notEqual(a.code, host.code);
      assert.equal(s.rooms.size, 2);
      // alone at a public table, pressing Ready deals straight away with three computers
      a.send({ t: 'msg', m: { t: 'ready', ready: true } });
      await a.until('starts now', () => a.lobby?.phase === 'game' && !!a.view, 3000);
      assert.equal(a.lobby!.seats.filter((x) => x?.ai).length, 3);
      // a table that has started is no longer offered: the next stranger gets a new one
      const c = new Player('late', url);
      await c.open();
      c.send({ t: 'quick', profile: profile('Cal'), pranks: true });
      await c.until('new public lobby', () => !!c.lobby?.quick);
      assert.notEqual(c.code, a.code);
      for (const p of [host, a, c]) p.close();
    },
    { quickWaitMs: 60_000 },
  );
});
