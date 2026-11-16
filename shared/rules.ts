/**
 * CHAOS TABLE: the card-game rules engine.
 *
 * One deterministic implementation shared by the authoritative server, the
 * offline single-player mode and the automated tests. Given the same seed and
 * the same actions it always produces the same game. The full rules are in
 * RULES.md; this file is the source of truth.
 *
 * Only erasable TypeScript is used (no enums or decorators) so Node can run it
 * directly with type stripping.
 */

export const RED = 0;
export const YELLOW = 1;
export const GREEN = 2;
export const BLUE = 3;
/** A colour index 0..3, or -1 for a wild card that has not been played yet. */
export type Color = 0 | 1 | 2 | 3;
export const COLOR_NAMES = ['Red', 'Yellow', 'Green', 'Blue'] as const;

export type Kind = 'num' | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4';

export interface Card {
  /** Unique within one deck, 0..107. */
  id: number;
  /** -1 for wild cards. */
  color: Color | -1;
  kind: Kind;
  /** 0..9 for number cards, -1 otherwise. */
  value: number;
}

export interface HouseRules {
  /** When you draw on your turn, keep drawing until you get a playable card. Default off. */
  drawUntilPlayable: boolean;
  /** Seconds per turn before the server draws and passes for you. 0 disables. */
  turnSeconds: number;
  /**
   * Draw Two and Draw Four stack: instead of drawing, the target may answer a Draw Two with
   * another Draw Two, or anything with a Draw Four, passing the growing total on. Whoever
   * cannot (or will not) answer draws the whole stack and loses their turn. Default off.
   */
  stacking?: boolean;
}

export const DEFAULT_RULES: HouseRules = { drawUntilPlayable: false, turnSeconds: 0, stacking: false };

export interface PlayerState {
  hand: Card[];
}

export type Phase = 'play' | 'over';

export interface GameState {
  rules: HouseRules;
  /** PRNG state (mulberry32). */
  rng: number;
  players: PlayerState[];
  drawPile: Card[];
  /** Last element is the top card. */
  discard: Card[];
  /** Seat whose turn it is. */
  current: number;
  /** +1 clockwise (seat order), -1 counter-clockwise. */
  direction: 1 | -1;
  /** The colour that must be matched (a wild's chosen colour). */
  color: Color;
  phase: Phase;
  /** Id of the card drawn this turn that may still be played, or -1. */
  drawnId: number;
  /** True once the current player has drawn this turn (they may then only play the drawn card or pass). */
  hasDrawn: boolean;
  winner: number;
  /** Increments on every turn change. */
  turn: number;
  /** Cards the current player owes from a Draw Two / Draw Four stack (stacking rule only). */
  pending: number;
}

export type Action =
  | { type: 'play'; seat: number; cardId: number; color?: Color }
  | { type: 'draw'; seat: number }
  | { type: 'pass'; seat: number };

/** Everything that happened as the result of one action, in order. These drive effects and sound. */
export type GameEvent =
  | { e: 'play'; seat: number; card: Card; color: Color }
  | { e: 'draw'; seat: number; count: number; cards: Card[]; penalty: boolean }
  | { e: 'skip'; seat: number }
  | { e: 'reverse'; direction: 1 | -1 }
  | { e: 'draw2'; from: number; target: number; stack?: number }
  | { e: 'draw4'; from: number; target: number; stack?: number }
  | { e: 'color'; color: Color }
  | { e: 'lastCard'; seat: number }
  | { e: 'reshuffle'; count: number }
  | { e: 'pass'; seat: number }
  | { e: 'turn'; seat: number }
  | { e: 'win'; seat: number };

export interface Result {
  ok: boolean;
  error?: string;
  events: GameEvent[];
}

// ------------------------------------------------------------------ randomness

/** mulberry32: returns [value in 0..1, next state]. */
export function nextRandom(state: number): [number, number] {
  let a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}

function shuffle<T>(g: GameState, arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const [r, n] = nextRandom(g.rng);
    g.rng = n;
    const j = Math.floor(r * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
}

// ------------------------------------------------------------------ deck

/**
 * 108 cards: per colour one 0, two each of 1-9, two Skip, two Reverse and two
 * Draw Two; plus four Wild and four Wild Draw Four.
 */
export function makeDeck(): Card[] {
  const deck: Card[] = [];
  let id = 0;
  for (let c = 0; c < 4; c++) {
    const color = c as Color;
    deck.push({ id: id++, color, kind: 'num', value: 0 });
    for (let v = 1; v <= 9; v++) {
      deck.push({ id: id++, color, kind: 'num', value: v });
      deck.push({ id: id++, color, kind: 'num', value: v });
    }
    for (const kind of ['skip', 'reverse', 'draw2'] as Kind[]) {
      deck.push({ id: id++, color, kind, value: -1 });
      deck.push({ id: id++, color, kind, value: -1 });
    }
  }
  for (let i = 0; i < 4; i++) deck.push({ id: id++, color: -1, kind: 'wild', value: -1 });
  for (let i = 0; i < 4; i++) deck.push({ id: id++, color: -1, kind: 'wild4', value: -1 });
  return deck;
}

export const DECK_SIZE = 108;
export const HAND_SIZE = 7;

export function cardLabel(c: Card): string {
  const col = c.color >= 0 ? COLOR_NAMES[c.color as Color] + ' ' : '';
  switch (c.kind) {
    case 'num':
      return `${col}${c.value}`;
    case 'skip':
      return `${col}Skip`;
    case 'reverse':
      return `${col}Reverse`;
    case 'draw2':
      return `${col}Draw Two`;
    case 'wild':
      return 'Wild';
    default:
      return 'Wild Draw Four';
  }
}

// ------------------------------------------------------------------ setup

/**
 * Start a game for 2-4 seats. Seat 0 is the dealer; the seat to the dealer's
 * left (seat 1) plays first.
 */
export function newGame(seats: number, seed: number, rules: HouseRules = DEFAULT_RULES): GameState {
  if (seats < 2 || seats > 4) throw new Error('2 to 4 players');
  const g: GameState = {
    rules: { ...rules },
    rng: seed >>> 0,
    players: [],
    drawPile: makeDeck(),
    discard: [],
    current: 1 % seats,
    direction: 1,
    color: RED,
    phase: 'play',
    drawnId: -1,
    hasDrawn: false,
    winner: -1,
    turn: 0,
    pending: 0,
  };
  shuffle(g, g.drawPile);
  for (let s = 0; s < seats; s++) g.players.push({ hand: [] });
  for (let i = 0; i < HAND_SIZE; i++) {
    for (let s = 0; s < seats; s++) g.players[s].hand.push(g.drawPile.pop()!);
  }
  // The start card is always a number card: anything else goes back into the
  // middle of the draw pile and the next card is turned over.
  for (;;) {
    const c = g.drawPile.pop()!;
    if (c.kind === 'num') {
      g.discard.push(c);
      g.color = c.color as Color;
      break;
    }
    const [r, n] = nextRandom(g.rng);
    g.rng = n;
    g.drawPile.splice(Math.floor(r * g.drawPile.length), 0, c);
  }
  return g;
}

// ------------------------------------------------------------------ queries

export function topCard(g: GameState): Card {
  return g.discard[g.discard.length - 1];
}

export function nextSeat(g: GameState, from: number, steps = 1): number {
  const n = g.players.length;
  return (((from + g.direction * steps) % n) + n) % n;
}

/** Does the card match the current colour or symbol (ignoring the Draw Four restriction)? */
export function matches(g: GameState, c: Card): boolean {
  if (c.kind === 'wild' || c.kind === 'wild4') return true;
  const top = topCard(g);
  if (c.color === g.color) return true;
  if (c.kind === 'num') return top.kind === 'num' && top.value === c.value;
  return c.kind === top.kind;
}

/** Wild Draw Four may only be played when you hold no card of the current colour. */
export function canPlayWild4(g: GameState, seat: number): boolean {
  return !g.players[seat].hand.some((c) => c.color === g.color);
}

/** While a stack is owed, only a Draw Two on a Draw Two, or a Draw Four, may answer it. */
export function canStack(g: GameState, c: Card): boolean {
  return c.kind === 'wild4' || (c.kind === 'draw2' && topCard(g).kind === 'draw2');
}

export function isLegal(g: GameState, seat: number, c: Card): boolean {
  if (g.phase !== 'play' || seat !== g.current) return false;
  if (!g.players[seat].hand.some((h) => h.id === c.id)) return false;
  if (g.pending > 0) return canStack(g, c);
  if (g.hasDrawn && c.id !== g.drawnId) return false;
  if (!matches(g, c)) return false;
  if (c.kind === 'wild4' && !canPlayWild4(g, seat)) return false;
  return true;
}

export function legalCards(g: GameState, seat: number): Card[] {
  return g.players[seat].hand.filter((c) => isLegal(g, seat, c));
}

// ------------------------------------------------------------------ actions

/** Take `count` cards for `seat`, reshuffling the discard pile into the draw pile when needed. */
function deal(g: GameState, seat: number, count: number, events: GameEvent[], penalty: boolean): Card[] {
  const got: Card[] = [];
  for (let i = 0; i < count; i++) {
    if (g.drawPile.length === 0) {
      if (g.discard.length <= 1) break; // every card is in someone's hand
      const top = g.discard.pop()!;
      const rest = g.discard.splice(0);
      g.discard.push(top);
      shuffle(g, rest);
      g.drawPile.push(...rest);
      events.push({ e: 'reshuffle', count: rest.length });
    }
    const c = g.drawPile.pop()!;
    g.players[seat].hand.push(c);
    got.push(c);
  }
  events.push({ e: 'draw', seat, count: got.length, cards: got, penalty });
  return got;
}

function endTurn(g: GameState, next: number, events: GameEvent[]): void {
  g.current = next;
  g.hasDrawn = false;
  g.drawnId = -1;
  g.turn++;
  events.push({ e: 'turn', seat: next });
}

/**
 * Apply one action. Invalid actions change nothing and return ok: false with a
 * reason. The state is mutated in place.
 */
export function apply(g: GameState, a: Action): Result {
  const events: GameEvent[] = [];
  const fail = (error: string): Result => ({ ok: false, error, events: [] });
  if (g.phase !== 'play') return fail('The game is over.');
  if (a.seat !== g.current) return fail('It is not your turn.');
  const me = g.players[a.seat];

  if (a.type === 'draw') {
    if (g.pending > 0) {
      // nothing to answer the stack with (or no wish to): take all of it and lose the turn
      const owed = g.pending;
      g.pending = 0;
      deal(g, a.seat, owed, events, true);
      events.push({ e: 'skip', seat: a.seat });
      endTurn(g, nextSeat(g, a.seat), events);
      return { ok: true, events };
    }
    if (g.hasDrawn) return fail('You have already drawn this turn.');
    let got = deal(g, a.seat, 1, events, false);
    if (g.rules.drawUntilPlayable) {
      while (got.length === 1 && !isLegalIgnoringDraw(g, a.seat, got[0])) {
        got = deal(g, a.seat, 1, events, false);
      }
    }
    g.hasDrawn = true;
    const last = got[got.length - 1];
    if (last && isLegalIgnoringDraw(g, a.seat, last)) {
      g.drawnId = last.id;
    } else {
      // nothing playable came out: the turn passes automatically
      events.push({ e: 'pass', seat: a.seat });
      endTurn(g, nextSeat(g, a.seat), events);
    }
    return { ok: true, events };
  }

  if (a.type === 'pass') {
    if (g.pending > 0) return fail(`Stack a Draw card or take ${g.pending}.`);
    if (!g.hasDrawn) return fail('Draw a card before passing.');
    events.push({ e: 'pass', seat: a.seat });
    endTurn(g, nextSeat(g, a.seat), events);
    return { ok: true, events };
  }

  // play
  const idx = me.hand.findIndex((c) => c.id === a.cardId);
  if (idx < 0) return fail('That card is not in your hand.');
  const card = me.hand[idx];
  const answering = g.pending > 0;
  if (answering) {
    if (!canStack(g, card)) return fail(`Stack a Draw card or take ${g.pending}.`);
  } else {
    if (g.hasDrawn && card.id !== g.drawnId) return fail('After drawing you may only play the card you drew.');
    if (!matches(g, card)) return fail('That card does not match the colour or symbol.');
    if (card.kind === 'wild4' && !canPlayWild4(g, a.seat)) {
      return fail('Wild Draw Four can only be played when you have no card of the current colour.');
    }
  }
  const wild = card.kind === 'wild' || card.kind === 'wild4';
  if (wild && (a.color === undefined || a.color < 0 || a.color > 3)) return fail('Choose a colour.');

  me.hand.splice(idx, 1);
  g.discard.push(card);
  g.color = wild ? (a.color as Color) : (card.color as Color);
  events.push({ e: 'play', seat: a.seat, card, color: g.color });
  if (wild) events.push({ e: 'color', color: g.color });

  const adds = card.kind === 'draw2' ? 2 : card.kind === 'wild4' ? 4 : 0;
  const stacking = !!g.rules.stacking && adds > 0;
  if (me.hand.length === 0) {
    g.phase = 'over';
    g.winner = a.seat;
    // the last card's effect still lands, so a finishing Draw Four still deals four (plus any stack)
    const owed = adds + (stacking ? g.pending : 0);
    g.pending = 0;
    if (owed > 0) deal(g, nextSeat(g, a.seat), owed, events, true);
    events.push({ e: 'win', seat: a.seat });
    return { ok: true, events };
  }
  if (me.hand.length === 1) events.push({ e: 'lastCard', seat: a.seat });

  const n = g.players.length;
  let next = nextSeat(g, a.seat);
  switch (card.kind) {
    case 'skip':
      events.push({ e: 'skip', seat: next });
      next = nextSeat(g, a.seat, 2);
      break;
    case 'reverse':
      g.direction = g.direction === 1 ? -1 : 1;
      events.push({ e: 'reverse', direction: g.direction });
      if (n === 2) {
        // with two players Reverse works like Skip
        events.push({ e: 'skip', seat: nextSeat(g, a.seat) });
        next = a.seat;
      } else {
        next = nextSeat(g, a.seat);
      }
      break;
    case 'draw2':
    case 'wild4': {
      const e = card.kind === 'draw2' ? 'draw2' : 'draw4';
      if (stacking) {
        // the total passes on: the next player must answer it or take it
        g.pending += adds;
        events.push({ e, from: a.seat, target: next, stack: g.pending });
        break;
      }
      events.push({ e, from: a.seat, target: next });
      deal(g, next, adds, events, true);
      events.push({ e: 'skip', seat: next });
      next = nextSeat(g, a.seat, 2);
      break;
    }
    default:
      break;
  }
  endTurn(g, next, events);
  return { ok: true, events };
}

/** Legality of a just-drawn card (hasDrawn is not yet set when this is asked). */
function isLegalIgnoringDraw(g: GameState, seat: number, c: Card): boolean {
  if (!matches(g, c)) return false;
  if (c.kind === 'wild4' && !canPlayWild4(g, seat)) return false;
  return true;
}

/** Turn timer expired: draw (if not yet drawn) and pass. */
export function timeout(g: GameState): Result {
  const seat = g.current;
  const events: GameEvent[] = [];
  if (!g.hasDrawn) {
    const r = apply(g, { type: 'draw', seat });
    events.push(...r.events);
    if (g.current !== seat || g.phase !== 'play') return { ok: true, events };
  }
  const r = apply(g, { type: 'pass', seat });
  events.push(...r.events);
  return { ok: true, events };
}

// ------------------------------------------------------------------ views

/** What one seat is allowed to know. Other hands are reduced to counts. */
export interface SeatView {
  seat: number;
  hand: Card[];
  counts: number[];
  top: Card;
  color: Color;
  current: number;
  direction: 1 | -1;
  drawPile: number;
  phase: Phase;
  winner: number;
  hasDrawn: boolean;
  drawnId: number;
  playable: number[];
  turn: number;
  /** Cards owed by the current player from a Draw stack (0 when none). */
  pending: number;
}

export function viewFor(g: GameState, seat: number): SeatView {
  return {
    seat,
    hand: seat >= 0 ? g.players[seat].hand.map((c) => ({ ...c })) : [],
    counts: g.players.map((p) => p.hand.length),
    top: { ...topCard(g) },
    color: g.color,
    current: g.current,
    direction: g.direction,
    drawPile: g.drawPile.length,
    phase: g.phase,
    winner: g.winner,
    hasDrawn: g.hasDrawn,
    drawnId: g.drawnId,
    playable: seat >= 0 && seat === g.current ? legalCards(g, seat).map((c) => c.id) : [],
    turn: g.turn,
    pending: g.pending,
  };
}

/**
 * Strip other players' card faces from events before sending them to `seat`:
 * everyone sees that cards were drawn, only the drawer sees which.
 */
export function eventsFor(events: GameEvent[], seat: number): GameEvent[] {
  return events.map((ev) => {
    if (ev.e === 'draw' && ev.seat !== seat) return { ...ev, cards: [] };
    return ev;
  });
}

/** Total cards across all piles and hands (108 in a valid game). */
export function cardTotal(g: GameState): number {
  return g.drawPile.length + g.discard.length + g.players.reduce((s, p) => s + p.hand.length, 0);
}
