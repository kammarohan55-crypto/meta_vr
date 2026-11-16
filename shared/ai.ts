/**
 * Computer opponents. They only ever see what a human in their seat would see
 * (their own hand, card counts, the discard pile) and they choose only from
 * moves the rules engine says are legal.
 */
import type { Action, Card, Color, GameState } from './rules.ts';
import { isLegal, nextRandom, nextSeat } from './rules.ts';

export type Difficulty = 'easy' | 'normal' | 'hard';

/** Colour the AI holds most of (ties broken by highest card value held). */
export function bestColor(hand: Card[]): Color {
  const score = [0, 0, 0, 0];
  for (const c of hand) {
    if (c.color >= 0) score[c.color] += 10 + Math.max(0, c.value);
  }
  let best = 0;
  for (let i = 1; i < 4; i++) if (score[i] > score[best]) best = i;
  return best as Color;
}

function value(c: Card): number {
  switch (c.kind) {
    case 'num':
      return c.value;
    case 'skip':
    case 'reverse':
    case 'draw2':
      return 20;
    default:
      return 50;
  }
}

/** A separate generator so AI choices never disturb the game's shuffles. */
export class AiBrain {
  private rng: number;
  readonly difficulty: Difficulty;
  constructor(difficulty: Difficulty, seed: number) {
    this.difficulty = difficulty;
    this.rng = seed >>> 0;
  }

  private rand(): number {
    const [r, n] = nextRandom(this.rng);
    this.rng = n;
    return r;
  }

  /** Decide the next action for `seat`. Always returns a legal action. */
  decide(g: GameState, seat: number): Action {
    const hand = g.players[seat].hand;
    const legal = hand.filter((c) => isLegal(g, seat, c));
    if (legal.length === 0) {
      return g.hasDrawn ? { type: 'pass', seat } : { type: 'draw', seat };
    }
    let pick: Card;
    if (this.difficulty === 'easy') {
      // plays something legal at random, and sometimes forgets it could play at all
      if (!g.hasDrawn && this.rand() < 0.15) return { type: 'draw', seat };
      pick = legal[Math.floor(this.rand() * legal.length)];
    } else {
      const next = nextSeat(g, seat);
      const nextCount = g.players[next].hand.length;
      const leaderThreat = nextCount <= 2;
      const scored = legal.map((c) => {
        let s = value(c);
        // keep wilds for when they are needed, unless an opponent is about to win
        if (c.kind === 'wild') s = leaderThreat ? 60 : 4;
        if (c.kind === 'wild4') s = leaderThreat ? 90 : this.difficulty === 'hard' ? 2 : 6;
        if (leaderThreat && (c.kind === 'draw2' || c.kind === 'skip')) s += 40;
        if (this.difficulty === 'hard') {
          // prefer to stay in the colour it holds most of, and to dump high cards early
          if (c.color >= 0 && c.color === bestColor(hand)) s += 6;
          // a card that keeps the current colour while changing number avoids handing a colour switch over
          if (c.color === g.color) s += 2;
          // with two cards left, keep the wild for the final play
          if (hand.length === 2 && (c.kind === 'wild' || c.kind === 'wild4')) s -= 30;
        }
        s += this.rand() * (this.difficulty === 'hard' ? 1 : 4);
        return { c, s };
      });
      scored.sort((a, b) => b.s - a.s);
      pick = scored[0].c;
    }
    const wild = pick.kind === 'wild' || pick.kind === 'wild4';
    let color: Color | undefined;
    if (wild) {
      const rest = hand.filter((c) => c.id !== pick.id);
      color = rest.some((c) => c.color >= 0) ? bestColor(rest) : (Math.floor(this.rand() * 4) as Color);
    }
    return { type: 'play', seat, cardId: pick.id, color };
  }

  /** How long the AI "thinks" before acting, in seconds (so turns read naturally). */
  thinkTime(): number {
    const base = this.difficulty === 'easy' ? 1.6 : this.difficulty === 'normal' ? 1.2 : 0.9;
    return base + this.rand() * 0.9;
  }
}
