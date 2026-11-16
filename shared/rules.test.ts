/**
 * Rules engine tests. Run with:  node --test shared/
 * (Node 22.18+ runs TypeScript directly.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Card, GameState } from './rules.ts';
import {
  DECK_SIZE,
  apply,
  cardTotal,
  eventsFor,
  isLegal,
  legalCards,
  makeDeck,
  newGame,
  timeout,
  topCard,
  viewFor,
} from './rules.ts';
import { AiBrain } from './ai.ts';

const C = (id: number, color: number, kind: Card['kind'], value = -1): Card => ({
  id,
  color: color as Card['color'],
  kind,
  value,
});

/** A hand-built state, so each rule can be tested in isolation. */
function fixture(hands: Card[][], top: Card, opts: Partial<GameState> = {}): GameState {
  const used = new Set<number>([top.id, ...hands.flat().map((c) => c.id)]);
  const pile = makeDeck().filter((c) => !used.has(c.id));
  return {
    rules: { drawUntilPlayable: false, turnSeconds: 0 },
    rng: 7,
    players: hands.map((h) => ({ hand: h.slice() })),
    drawPile: pile,
    discard: [top],
    current: 0,
    direction: 1,
    color: top.color as 0,
    phase: 'play',
    drawnId: -1,
    hasDrawn: false,
    winner: -1,
    turn: 0,
    pending: 0,
    ...opts,
  };
}

test('deck has 108 cards with the classic distribution', () => {
  const d = makeDeck();
  assert.equal(d.length, DECK_SIZE);
  assert.equal(new Set(d.map((c) => c.id)).size, 108);
  for (let col = 0; col < 4; col++) {
    const mine = d.filter((c) => c.color === col);
    assert.equal(mine.length, 25);
    assert.equal(mine.filter((c) => c.kind === 'num' && c.value === 0).length, 1);
    for (let v = 1; v <= 9; v++) assert.equal(mine.filter((c) => c.kind === 'num' && c.value === v).length, 2);
    for (const k of ['skip', 'reverse', 'draw2']) assert.equal(mine.filter((c) => c.kind === k).length, 2);
  }
  assert.equal(d.filter((c) => c.kind === 'wild').length, 4);
  assert.equal(d.filter((c) => c.kind === 'wild4').length, 4);
});

test('new game deals 7 each, starts on a number card, seat 1 first', () => {
  for (let seats = 2; seats <= 4; seats++) {
    for (let seed = 1; seed < 40; seed++) {
      const g = newGame(seats, seed);
      assert.equal(g.players.length, seats);
      for (const p of g.players) assert.equal(p.hand.length, 7);
      assert.equal(topCard(g).kind, 'num');
      assert.equal(g.color, topCard(g).color);
      assert.equal(g.current, 1);
      assert.equal(cardTotal(g), 108);
    }
  }
});

test('same seed, same game', () => {
  const a = newGame(4, 1234);
  const b = newGame(4, 1234);
  assert.deepEqual(a, b);
  assert.notDeepEqual(newGame(4, 1235).players[0].hand, a.players[0].hand);
});

test('matching colour or number is legal, anything else is not', () => {
  const g = fixture([[C(10, 0, 'num', 5), C(11, 1, 'num', 3), C(12, 2, 'num', 9), C(13, 3, 'num', 3)], [C(20, 1, 'num', 1)]], C(1, 1, 'num', 3));
  assert.equal(isLegal(g, 0, g.players[0].hand[0]), false); // red 5 on yellow 3
  assert.equal(isLegal(g, 0, g.players[0].hand[1]), true); // yellow 3, same colour and number
  assert.equal(isLegal(g, 0, g.players[0].hand[2]), false); // green 9
  assert.equal(isLegal(g, 0, g.players[0].hand[3]), true); // blue 3, same number
  const r = apply(g, { type: 'play', seat: 0, cardId: 12 });
  assert.equal(r.ok, false);
  assert.equal(g.players[0].hand.length, 4);
});

test('action cards match by symbol', () => {
  const g = fixture([[C(10, 3, 'skip'), C(11, 3, 'num', 4)], [C(20, 1, 'num', 1)]], C(1, 0, 'skip'));
  assert.equal(isLegal(g, 0, g.players[0].hand[0]), true);
  assert.equal(isLegal(g, 0, g.players[0].hand[1]), false);
});

test('only the current player may act', () => {
  const g = fixture([[C(10, 0, 'num', 5)], [C(20, 0, 'num', 6)]], C(1, 0, 'num', 1));
  const r = apply(g, { type: 'play', seat: 1, cardId: 20 });
  assert.equal(r.ok, false);
  assert.match(r.error!, /not your turn/);
});

test('skip jumps the next player', () => {
  const g = fixture([[C(10, 0, 'skip'), C(11, 0, 'num', 1)], [C(20, 1, 'num', 1)], [C(30, 1, 'num', 2)]], C(1, 0, 'num', 3));
  const r = apply(g, { type: 'play', seat: 0, cardId: 10 });
  assert.ok(r.ok);
  assert.equal(g.current, 2);
  assert.ok(r.events.some((e) => e.e === 'skip' && e.seat === 1));
});

test('reverse flips direction with 3+ players and acts as skip with 2', () => {
  const g = fixture([[C(10, 0, 'reverse'), C(11, 0, 'num', 1)], [C(20, 1, 'num', 1)], [C(30, 1, 'num', 2)]], C(1, 0, 'num', 3));
  apply(g, { type: 'play', seat: 0, cardId: 10 });
  assert.equal(g.direction, -1);
  assert.equal(g.current, 2);
  const h = fixture([[C(10, 0, 'reverse'), C(11, 0, 'num', 1)], [C(20, 1, 'num', 1)]], C(1, 0, 'num', 3));
  apply(h, { type: 'play', seat: 0, cardId: 10 });
  assert.equal(h.current, 0);
});

test('draw two makes the next player draw two and lose their turn', () => {
  const g = fixture([[C(10, 0, 'draw2'), C(11, 0, 'num', 1)], [C(20, 1, 'num', 1)], [C(30, 1, 'num', 2)]], C(1, 0, 'num', 3));
  const r = apply(g, { type: 'play', seat: 0, cardId: 10 });
  assert.ok(r.ok);
  assert.equal(g.players[1].hand.length, 3);
  assert.equal(g.current, 2);
  assert.ok(r.events.some((e) => e.e === 'draw2' && e.target === 1));
});

test('wild needs a colour and sets it', () => {
  const g = fixture([[C(100, -1, 'wild'), C(11, 0, 'num', 1)], [C(20, 1, 'num', 1)]], C(1, 0, 'num', 3));
  assert.equal(apply(g, { type: 'play', seat: 0, cardId: 100 }).ok, false);
  const r = apply(g, { type: 'play', seat: 0, cardId: 100, color: 3 });
  assert.ok(r.ok);
  assert.equal(g.color, 3);
  assert.equal(g.current, 1);
});

test('wild draw four is only legal without a card of the current colour', () => {
  const g = fixture([[C(104, -1, 'wild4'), C(11, 0, 'num', 1)], [C(20, 1, 'num', 1)]], C(1, 0, 'num', 3));
  assert.equal(isLegal(g, 0, g.players[0].hand[0]), false);
  assert.equal(apply(g, { type: 'play', seat: 0, cardId: 104, color: 2 }).ok, false);
  const h = fixture([[C(104, -1, 'wild4'), C(11, 1, 'num', 1)], [C(20, 1, 'num', 1)], [C(30, 2, 'num', 1)]], C(1, 0, 'num', 3));
  const r = apply(h, { type: 'play', seat: 0, cardId: 104, color: 2 });
  assert.ok(r.ok);
  assert.equal(h.players[1].hand.length, 5);
  assert.equal(h.current, 2);
  assert.equal(h.color, 2);
  assert.ok(r.events.some((e) => e.e === 'draw4' && e.target === 1));
});

test('after drawing you may play only the drawn card, or pass', () => {
  const g = fixture([[C(11, 2, 'num', 7), C(12, 3, 'num', 8)], [C(20, 1, 'num', 1)]], C(1, 0, 'num', 3));
  // force the next draw to be a red 3 (playable)
  const red3 = g.drawPile.findIndex((c) => c.color === 0 && c.kind === 'num' && c.value === 4);
  const [card] = g.drawPile.splice(red3, 1);
  g.drawPile.push(card);
  assert.equal(apply(g, { type: 'pass', seat: 0 }).ok, false); // must draw first
  const r = apply(g, { type: 'draw', seat: 0 });
  assert.ok(r.ok);
  assert.equal(g.hasDrawn, true);
  assert.equal(g.drawnId, card.id);
  assert.equal(apply(g, { type: 'draw', seat: 0 }).ok, false); // only one draw
  assert.equal(apply(g, { type: 'play', seat: 0, cardId: 11 }).ok, false);
  assert.deepEqual(legalCards(g, 0).map((c) => c.id), [card.id]);
  assert.ok(apply(g, { type: 'play', seat: 0, cardId: card.id }).ok);
  assert.equal(g.current, 1);
});

test('drawing an unplayable card passes the turn automatically', () => {
  const g = fixture([[C(11, 2, 'num', 7)], [C(20, 1, 'num', 1)]], C(1, 0, 'num', 3));
  const idx = g.drawPile.findIndex((c) => c.color === 3 && c.kind === 'num' && c.value === 8);
  const [card] = g.drawPile.splice(idx, 1);
  g.drawPile.push(card);
  const r = apply(g, { type: 'draw', seat: 0 });
  assert.ok(r.ok);
  assert.equal(g.current, 1);
  assert.equal(g.players[0].hand.length, 2);
});

test('draw until playable house rule', () => {
  const g = fixture([[C(11, 2, 'num', 7)], [C(20, 1, 'num', 1)]], C(1, 0, 'num', 3), {
    rules: { drawUntilPlayable: true, turnSeconds: 0 },
  });
  // top three are unplayable, the fourth is red
  const pick = (pred: (c: Card) => boolean) => g.drawPile.splice(g.drawPile.findIndex(pred), 1)[0];
  const red = pick((c) => c.color === 0 && c.kind === 'num' && c.value === 9);
  const a = pick((c) => c.color === 3 && c.kind === 'num' && c.value === 8);
  const b = pick((c) => c.color === 2 && c.kind === 'num' && c.value === 6);
  g.drawPile.push(red, a, b);
  const r = apply(g, { type: 'draw', seat: 0 });
  assert.ok(r.ok);
  assert.equal(g.players[0].hand.length, 4);
  assert.equal(g.drawnId, red.id);
  assert.equal(g.current, 0);
});

test('empty draw pile reshuffles the discard pile, keeping the top card', () => {
  const g = fixture([[C(11, 2, 'num', 7)], [C(20, 1, 'num', 1)]], C(1, 0, 'num', 3));
  const old = g.drawPile.splice(0);
  g.discard = [...old, C(1, 0, 'num', 3)];
  const top = topCard(g);
  const r = apply(g, { type: 'draw', seat: 0 });
  assert.ok(r.ok);
  assert.ok(r.events.some((e) => e.e === 'reshuffle'));
  assert.equal(topCard(g).id, top.id);
  assert.equal(g.discard.length, 1);
  assert.equal(cardTotal(g), old.length + 1 + 2);
});

test('playing your last card wins, and a final Draw Two still lands', () => {
  const g = fixture([[C(10, 0, 'draw2')], [C(20, 1, 'num', 1)]], C(1, 0, 'num', 3));
  const r = apply(g, { type: 'play', seat: 0, cardId: 10 });
  assert.ok(r.ok);
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, 0);
  assert.equal(g.players[1].hand.length, 3);
  assert.ok(r.events.some((e) => e.e === 'win'));
  assert.equal(apply(g, { type: 'draw', seat: 1 }).ok, false);
});

test('last card is announced when a player is down to one', () => {
  const g = fixture([[C(10, 0, 'num', 1), C(11, 0, 'num', 2)], [C(20, 1, 'num', 1)]], C(1, 0, 'num', 3));
  const r = apply(g, { type: 'play', seat: 0, cardId: 10 });
  assert.ok(r.events.some((e) => e.e === 'lastCard' && e.seat === 0));
});

test('turn timeout draws and passes', () => {
  const g = fixture([[C(11, 2, 'num', 7)], [C(20, 1, 'num', 1)]], C(1, 0, 'num', 3));
  const r = timeout(g);
  assert.ok(r.ok);
  assert.equal(g.current, 1);
  assert.equal(g.players[0].hand.length, 2);
});

test('views hide other hands and events hide other players\' drawn cards', () => {
  const g = newGame(3, 99);
  const v = viewFor(g, 0);
  assert.equal(v.hand.length, 7);
  assert.deepEqual(v.counts, [7, 7, 7]);
  assert.equal((v as unknown as { players?: unknown }).players, undefined);
  const r = apply(g, { type: 'draw', seat: 1 });
  const mine = eventsFor(r.events, 1).find((e) => e.e === 'draw');
  const theirs = eventsFor(r.events, 0).find((e) => e.e === 'draw');
  assert.equal(mine && mine.e === 'draw' && mine.cards.length, 1);
  assert.equal(theirs && theirs.e === 'draw' && theirs.cards.length, 0);
});

test('AI games always finish, stay legal and never lose a card', () => {
  for (const diff of ['easy', 'normal', 'hard'] as const) {
    for (let seed = 1; seed <= 60; seed++) {
      const seats = 2 + (seed % 3);
      const g = newGame(seats, seed * 7919, { drawUntilPlayable: seed % 2 === 0, turnSeconds: 0 });
      const brains = Array.from({ length: seats }, (_, i) => new AiBrain(diff, seed * 31 + i));
      let steps = 0;
      while (g.phase === 'play') {
        const a = brains[g.current].decide(g, g.current);
        const r = apply(g, a);
        assert.ok(r.ok, `${diff} seed ${seed}: ${r.error} for ${JSON.stringify(a)}`);
        assert.equal(cardTotal(g), 108);
        if (++steps > 5000) assert.fail(`game did not finish (${diff}, seed ${seed})`);
      }
      assert.ok(g.winner >= 0);
      assert.equal(g.players[g.winner].hand.length, 0);
    }
  }
});

test('harder AI wins more often against easy AI', () => {
  let hardWins = 0;
  const N = 300;
  for (let seed = 1; seed <= N; seed++) {
    const g = newGame(2, seed * 104729);
    const brains = [new AiBrain(seed % 2 ? 'hard' : 'easy', seed), new AiBrain(seed % 2 ? 'easy' : 'hard', seed + 1)];
    const hardSeat = seed % 2 ? 0 : 1;
    while (g.phase === 'play') apply(g, brains[g.current].decide(g, g.current));
    if (g.winner === hardSeat) hardWins++;
  }
  assert.ok(hardWins / N > 0.5, `hard won ${hardWins}/${N}`);
});

// ------------------------------------------------------------------ stacking house rule

const STACK = { drawUntilPlayable: false, turnSeconds: 0, stacking: true };

test('stacking: a Draw Two passes the total on instead of dealing it', () => {
  const g = fixture([[C(10, 0, 'draw2'), C(11, 0, 'num', 1)], [C(20, 1, 'draw2'), C(21, 1, 'num', 5)], [C(30, 1, 'num', 2)]], C(1, 0, 'num', 3), { rules: STACK });
  const r = apply(g, { type: 'play', seat: 0, cardId: 10 });
  assert.ok(r.ok);
  assert.equal(g.players[1].hand.length, 2, 'nothing dealt yet');
  assert.equal(g.current, 1, 'the target must answer');
  assert.equal(g.pending, 2);
  assert.ok(r.events.some((e) => e.e === 'draw2' && e.target === 1 && e.stack === 2));
  // only a stacking card is legal now, whatever its colour
  assert.deepEqual(legalCards(g, 1).map((c) => c.id), [20]);
  const r2 = apply(g, { type: 'play', seat: 1, cardId: 20 });
  assert.ok(r2.ok);
  assert.equal(g.pending, 4);
  assert.equal(g.current, 2);
  assert.equal(viewFor(g, 2).pending, 4);
});

test('stacking: whoever cannot answer takes the whole stack and loses the turn', () => {
  const g = fixture([[C(11, 0, 'num', 1)], [C(20, 1, 'num', 5)], [C(30, 1, 'num', 2), C(31, 2, 'num', 2)]], C(1, 0, 'draw2'), { rules: STACK, current: 2, pending: 6 });
  assert.deepEqual(legalCards(g, 2), []);
  assert.equal(apply(g, { type: 'pass', seat: 2 }).ok, false, 'no passing while a stack is owed');
  assert.equal(apply(g, { type: 'play', seat: 2, cardId: 30 }).ok, false, 'a matching number does not answer a stack');
  const r = apply(g, { type: 'draw', seat: 2 });
  assert.ok(r.ok);
  assert.equal(g.players[2].hand.length, 8);
  assert.equal(g.pending, 0);
  assert.equal(g.current, 0, 'turn skipped');
  assert.ok(r.events.some((e) => e.e === 'draw' && e.seat === 2 && e.count === 6 && e.penalty));
  assert.equal(cardTotal(g), DECK_SIZE);
});

test('stacking: Draw Four answers anything, Draw Two cannot answer a Draw Four', () => {
  const g = fixture([[C(11, 0, 'num', 1)], [C(20, 3, 'draw2'), C(104, -1, 'wild4'), C(21, 0, 'num', 9)]], C(100, -1, 'wild4'), { rules: STACK, current: 1, pending: 4, color: 0 });
  assert.equal(isLegal(g, 1, C(20, 3, 'draw2')), false);
  // the usual "no card of the current colour" limit does not stop a stacked Draw Four
  const r = apply(g, { type: 'play', seat: 1, cardId: 104, color: 2 });
  assert.ok(r.ok, r.error ?? "");
  assert.equal(g.pending, 8);
  assert.equal(g.current, 0);
});

test('stacking: finishing on a Draw card still deals the whole stack', () => {
  const g = fixture([[C(11, 0, 'num', 1)], [C(20, 1, 'draw2')], [C(30, 1, 'num', 2)]], C(1, 0, 'draw2'), { rules: STACK, current: 1, pending: 2 });
  const r = apply(g, { type: 'play', seat: 1, cardId: 20 });
  assert.ok(r.ok);
  assert.equal(g.winner, 1);
  assert.equal(g.players[2].hand.length, 5);
  assert.equal(g.pending, 0);
});

test('stacking: AI games always finish with every card accounted for', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const g = newGame(2 + (seed % 3), seed * 7919, STACK);
    const brains = g.players.map((_, i) => new AiBrain(i % 2 ? 'hard' : 'normal', seed + i));
    let steps = 0;
    while (g.phase === 'play') {
      const r = apply(g, brains[g.current].decide(g, g.current));
      assert.ok(r.ok, r.error ?? "");
      assert.equal(cardTotal(g), DECK_SIZE);
      if (++steps > 5000) assert.fail(`stacking game did not finish (seed ${seed})`);
    }
  }
});
