/**
 * One table: lobby, seats, computer players, turns, timers, disconnects and
 * rematches. It is transport-agnostic: the Colyseus room wires it to sockets,
 * and solo play runs the very same class inside the browser.
 *
 * The host is the only place cards are dealt or legality is decided. Clients
 * send intentions ("play card 42 as blue"); the host checks them against the
 * rules engine and tells each client only what that seat may know.
 */
import { cleanName } from './names.ts';
import { AiBrain } from './ai.ts';
import type { Difficulty } from './ai.ts';
import { DEFAULT_RULES, apply, eventsFor, newGame, timeout, viewFor } from './rules.ts';
import type { Action, GameEvent, GameState, HouseRules } from './rules.ts';
import type { ClientMsg, LobbyMsg, Profile, SeatInfo, TablePhase, ViewMsg } from './protocol.ts';

export interface HostIO {
  /** Send to one participant (ignored for computer players). */
  send(id: string, type: string, msg: unknown): void;
  /** Schedule a callback; returns a cancel function. */
  schedule(fn: () => void, ms: number): () => void;
  /** Milliseconds, monotonic. */
  now(): number;
  /** Random 32-bit seed for a new round. */
  seed(): number;
}

/** What a client may ask for on its turn. */
export type PlayIntent = { type: 'play'; cardId: number; color?: number } | { type: 'draw' } | { type: 'pass' };

/** Computer players are named after the scanned people the client shows for them. */
const AI_NAMES = ['Nathan', 'Sophia', 'Carla', 'Arjun', 'Meera', 'Kabir'];
/** How long a disconnected player's seat waits before the computer plays for them. */
export const AUTOPILOT_AFTER_MS = 20000;

export class TableHost {
  readonly code: string;
  hostId = '';
  phase: TablePhase = 'lobby';
  seats: (SeatInfo | null)[] = [null, null, null, null];
  rules: HouseRules = { ...DEFAULT_RULES };
  round = 0;
  game: GameState | null = null;
  /** Seat index (in the full 4-seat ring) of each player in the current game, in turn order. */
  order: number[] = [];
  rematch = new Set<string>();
  private brains = new Map<number, AiBrain>();
  private io: HostIO;
  private aiTimer: (() => void) | null = null;
  private turnTimer: (() => void) | null = null;
  private turnDeadline = 0;
  private autopilotTimers = new Map<string, () => void>();
  private dealer = 0;
  /** Multiplies computer think time (tests use a small value). */
  aiPace = 1;
  /** A public (Quick match) table, and when it starts by itself (io.now() time; 0 = not counting). */
  quick = false;
  quickDeadline = 0;
  /** How long a dropped player's turns wait before the computer plays them. */
  autopilotAfterMs = AUTOPILOT_AFTER_MS;

  constructor(code: string, io: HostIO) {
    this.code = code;
    this.io = io;
  }

  // ------------------------------------------------------------ membership

  seatOf(id: string): number {
    return this.seats.findIndex((s) => s !== null && s.id === id);
  }

  humans(): SeatInfo[] {
    return this.seats.filter((s): s is SeatInfo => s !== null && !s.ai);
  }

  /** A participant arrives. Returns their seat, or -1 if the table is full or playing. */
  join(id: string, profile: Profile, pranks = true): number {
    const existing = this.seatOf(id);
    if (existing >= 0) return existing;
    let seat = this.seats.findIndex((s) => s === null);
    if (seat < 0 && this.phase === 'lobby') {
      // a computer player gives up its seat to a person
      seat = this.seats.findIndex((s) => s !== null && s.ai);
    }
    if (seat < 0 || this.phase !== 'lobby') return -1;
    this.seats[seat] = {
      id,
      name: clean(profile.name) || `Player ${seat + 1}`,
      look: sanitizeLook(profile.look),
      ai: false,
      difficulty: 'normal',
      ready: false,
      connected: true,
      autopilot: false,
      pranks,
      wins: 0,
    };
    if (!this.hostId) this.hostId = id;
    this.publishLobby();
    return seat;
  }

  /** The connection dropped unexpectedly; the seat is held for them. */
  drop(id: string): void {
    const seat = this.seatOf(id);
    if (seat < 0) return;
    const s = this.seats[seat]!;
    s.connected = false;
    if (this.phase === 'game') {
      const cancel = this.io.schedule(() => {
        s.autopilot = true;
        this.publishLobby();
        this.maybeRunAi();
      }, this.autopilotAfterMs);
      this.autopilotTimers.set(id, cancel);
    }
    this.publishLobby();
  }

  /** They came back within the reconnection window. */
  reconnect(id: string): void {
    const seat = this.seatOf(id);
    if (seat < 0) return;
    const s = this.seats[seat]!;
    s.connected = true;
    s.autopilot = false;
    this.autopilotTimers.get(id)?.();
    this.autopilotTimers.delete(id);
    this.publishLobby();
    this.publishViews();
  }

  /** Left for good (or never came back). */
  leave(id: string): void {
    const seat = this.seatOf(id);
    if (seat < 0) return;
    this.autopilotTimers.get(id)?.();
    this.autopilotTimers.delete(id);
    if (this.phase === 'lobby' || this.phase === 'results') {
      this.seats[seat] = null;
    } else {
      // mid-game: a computer player takes over so nobody else's game is ruined
      const s = this.seats[seat]!;
      s.connected = false;
      s.autopilot = true;
      s.id = `gone:${s.id}`;
      s.name = `${s.name} (bot)`;
    }
    this.rematch.delete(id);
    if (this.hostId === id) this.hostId = this.humans().find((h) => h.connected)?.id ?? '';
    this.publishLobby();
    this.maybeRunAi();
  }

  isEmpty(): boolean {
    return !this.humans().some((h) => h.connected);
  }

  // ------------------------------------------------------------ messages

  handle(id: string, m: ClientMsg): void {
    const seat = this.seatOf(id);
    if (seat < 0) return;
    const me = this.seats[seat]!;
    switch (m.t) {
      case 'profile':
        me.name = clean(m.profile.name) || me.name;
        me.look = sanitizeLook(m.profile.look);
        me.pranks = !!m.pranks;
        this.publishLobby();
        break;
      case 'ready':
        if (this.phase === 'lobby') {
          me.ready = !!m.ready;
          this.publishLobby();
        }
        break;
      case 'seatAi':
        if (id === this.hostId && this.phase === 'lobby') this.setAi(m.seat, m.on, m.difficulty);
        break;
      case 'rules':
        if (id === this.hostId && this.phase === 'lobby') {
          this.rules = {
            drawUntilPlayable: !!m.rules.drawUntilPlayable,
            turnSeconds: [0, 15, 30, 45].includes(m.rules.turnSeconds) ? m.rules.turnSeconds : 0,
            stacking: !!m.rules.stacking,
          };
          this.publishLobby();
        }
        break;
      case 'start':
        if (id === this.hostId) this.start();
        break;
      case 'act':
        this.act(seat, m.action);
        break;
      case 'rematch':
        if (this.phase === 'results') {
          this.rematch.add(id);
          const voters = this.humans().filter((h) => h.connected);
          if (id === this.hostId || voters.every((h) => this.rematch.has(h.id))) this.start();
          else this.publishLobby();
        }
        break;
      case 'menu':
        if (id === this.hostId && this.phase === 'results') {
          this.phase = 'lobby';
          this.game = null;
          for (const s of this.seats) if (s && !s.ai) s.ready = false;
          this.publishLobby();
        }
        break;
    }
  }

  setAi(seat: number, on: boolean, difficulty: Difficulty = 'normal'): void {
    if (seat < 0 || seat > 3) return;
    const s = this.seats[seat];
    if (on) {
      if (s && !s.ai) return; // never replace a person
      const used = new Set(this.seats.filter((x) => x?.ai).map((x) => x!.name));
      const name = s?.name ?? AI_NAMES.find((n) => !used.has(n)) ?? `Bot ${seat}`;
      this.seats[seat] = {
        id: `ai:${seat}`,
        name,
        look: [AI_NAMES.indexOf(name) % 3],
        ai: true,
        difficulty,
        ready: true,
        connected: true,
        autopilot: false,
        pranks: true,
        wins: s?.wins ?? 0,
      };
    } else if (s?.ai) {
      this.seats[seat] = null;
    }
    this.publishLobby();
  }

  canStart(): boolean {
    const filled = this.seats.filter((s) => s !== null);
    if (filled.length < 2) return false;
    return this.humans().every((h) => h.ready || h.id === this.hostId || !h.connected);
  }

  start(): boolean {
    if (this.phase === 'lobby' && !this.canStart()) return false;
    if (this.seats.filter((s) => s !== null).length < 2) return false;
    this.order = [];
    for (let i = 0; i < 4; i++) if (this.seats[i]) this.order.push(i);
    // the deal moves round the table each round
    const n = this.order.length;
    this.dealer = this.round === 0 ? 0 : (this.dealer + 1) % n;
    const rotated = this.order.slice(this.dealer).concat(this.order.slice(0, this.dealer));
    this.order = rotated;
    this.round++;
    this.game = newGame(n, this.io.seed(), this.rules);
    this.brains.clear();
    this.order.forEach((seat, i) => {
      const s = this.seats[seat]!;
      this.brains.set(i, new AiBrain(s.ai ? s.difficulty : 'normal', this.io.seed()));
    });
    this.phase = 'game';
    this.rematch.clear();
    this.publishLobby();
    this.publishEvents([{ e: 'turn', seat: this.game.current }]);
    this.publishViews();
    this.armTurn();
    return true;
  }

  // ------------------------------------------------------------ play

  /** Map a table seat (0..3) to its index in the game, and back. */
  gameIndex(seat: number): number {
    return this.order.indexOf(seat);
  }

  private act(seat: number, a: PlayIntent): void {
    const g = this.game;
    if (!g || this.phase !== 'game') return;
    const gi = this.gameIndex(seat);
    if (gi < 0) return;
    let action: Action;
    if (a.type === 'play') action = { type: 'play', seat: gi, cardId: a.cardId | 0, color: a.color as 0 };
    else if (a.type === 'draw') action = { type: 'draw', seat: gi };
    else action = { type: 'pass', seat: gi };
    const r = apply(g, action);
    const s = this.seats[seat]!;
    if (!r.ok) {
      this.io.send(s.id, 'reject', { error: r.error, view: this.view(seat) });
      return;
    }
    this.after(r.events);
  }

  private after(events: GameEvent[]): void {
    const g = this.game!;
    this.publishEvents(events);
    if (g.phase === 'over') {
      this.cancelTimers();
      this.phase = 'results';
      const w = this.seats[this.order[g.winner]];
      if (w) w.wins++;
      this.publishViews();
      this.publishLobby();
      return;
    }
    this.publishViews();
    this.armTurn();
  }

  private cancelTimers(): void {
    this.aiTimer?.();
    this.aiTimer = null;
    this.turnTimer?.();
    this.turnTimer = null;
    this.turnDeadline = 0;
  }

  private armTurn(): void {
    this.cancelTimers();
    const g = this.game;
    if (!g || g.phase !== 'play') return;
    if (this.rules.turnSeconds > 0) {
      this.turnDeadline = this.io.now() + this.rules.turnSeconds * 1000;
      this.turnTimer = this.io.schedule(() => {
        if (!this.game || this.game.phase !== 'play') return;
        this.after(timeout(this.game).events);
      }, this.rules.turnSeconds * 1000);
    }
    this.maybeRunAi();
  }

  private maybeRunAi(): void {
    const g = this.game;
    if (!g || g.phase !== 'play' || this.phase !== 'game') return;
    const seat = this.order[g.current];
    const s = this.seats[seat];
    if (!s) return;
    const bot = s.ai || s.autopilot;
    if (!bot || this.aiTimer) return;
    const brain = this.brains.get(g.current)!;
    const turnAtSchedule = g.turn;
    const hasDrawnAtSchedule = g.hasDrawn;
    this.aiTimer = this.io.schedule(() => {
      this.aiTimer = null;
      const gg = this.game;
      if (!gg || gg.phase !== 'play' || gg.turn !== turnAtSchedule || gg.hasDrawn !== hasDrawnAtSchedule) return;
      const r = apply(gg, brain.decide(gg, gg.current));
      if (r.ok) this.after(r.events);
    }, brain.thinkTime() * 1000 * this.aiPace * (hasDrawnAtSchedule ? 0.6 : 1));
  }

  // ------------------------------------------------------------ publishing

  view(seat: number): ViewMsg | null {
    const g = this.game;
    if (!g) return null;
    const gi = this.gameIndex(seat);
    const v = viewFor(g, gi);
    // translate game indices back to table seats so clients only think in seats
    const counts = [0, 0, 0, 0];
    this.order.forEach((s, i) => (counts[s] = v.counts[i]));
    return {
      ...v,
      seat,
      counts,
      current: this.order[v.current],
      winner: v.winner >= 0 ? this.order[v.winner] : -1,
      round: this.round,
      timer: this.turnDeadline ? Math.max(0, Math.round((this.turnDeadline - this.io.now()) / 1000)) : 0,
    };
  }

  /** Clockwise seat order in the current game, for clients. */
  private publishViews(): void {
    for (let seat = 0; seat < 4; seat++) {
      const s = this.seats[seat];
      if (!s || s.ai || !s.connected) continue;
      const v = this.view(seat);
      if (v) this.io.send(s.id, 'view', v);
    }
  }

  private publishEvents(events: GameEvent[]): void {
    const toSeat = (gi: number) => this.order[gi];
    // events speak in game indices; convert to table seats
    const mapped: GameEvent[] = events.map((ev) => {
      switch (ev.e) {
        case 'play':
        case 'skip':
        case 'lastCard':
        case 'pass':
        case 'turn':
        case 'win':
          return { ...ev, seat: toSeat(ev.seat) };
        case 'draw':
          return { ...ev, seat: toSeat(ev.seat) };
        case 'draw2':
        case 'draw4':
          return { ...ev, from: toSeat(ev.from), target: toSeat(ev.target) };
        default:
          return ev;
      }
    });
    for (let seat = 0; seat < 4; seat++) {
      const s = this.seats[seat];
      if (!s || s.ai || !s.connected) continue;
      this.io.send(s.id, 'events', { round: this.round, events: eventsFor(mapped, seat) });
    }
  }

  lobby(): LobbyMsg {
    return {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      seats: this.seats.map((s) => (s ? { ...s, id: s.id.startsWith('gone:') ? 'gone' : s.id } : null)),
      rules: { ...this.rules },
      rematch: [...this.rematch],
      round: this.round,
      quick: this.quick || undefined,
      startsIn: this.quick && this.phase === 'lobby' && this.quickDeadline ? Math.max(0, Math.ceil((this.quickDeadline - this.io.now()) / 1000)) : undefined,
    };
  }

  publishLobby(): void {
    const msg = this.lobby();
    for (const s of this.seats) if (s && !s.ai && s.connected) this.io.send(s.id, 'lobby', msg);
  }

  /** Full state for someone (re)joining: lobby, their view, and nothing else. */
  sync(id: string): void {
    const seat = this.seatOf(id);
    this.io.send(id, 'lobby', this.lobby());
    if (seat >= 0 && this.game) {
      const v = this.view(seat);
      if (v) this.io.send(id, 'view', v);
    }
  }

  dispose(): void {
    this.cancelTimers();
    for (const c of this.autopilotTimers.values()) c();
    this.autopilotTimers.clear();
  }
}

/** A player's name as the table shows it ('' if it has nothing fit to show). */
function clean(name: string): string {
  return cleanName(name);
}

function sanitizeLook(look: unknown): number[] {
  if (!Array.isArray(look)) return [0, 0, 0, 0];
  return look.slice(0, 6).map((n) => Math.max(0, Math.min(15, Number(n) | 0)));
}

/** Short, readable room codes: no 0/O, 1/I/L, 5/S, 2/Z confusion. */
const CODE_CHARS = 'ACDEFGHJKMNPQRTUVWXY346789';
export function makeCode(rand: () => number, length = 5): string {
  let s = '';
  for (let i = 0; i < length; i++) s += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)];
  return s;
}
export function isCode(s: string): boolean {
  return new RegExp(`^[${CODE_CHARS}]{5}$`).test(s);
}
export { CODE_CHARS };
