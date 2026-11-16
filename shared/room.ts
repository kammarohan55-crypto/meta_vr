/**
 * One private table, independent of how players are connected. The Node game server runs
 * these over WebSockets (server/game-server.ts); a browser hosting a table for friends over
 * the internet runs one over WebRTC data channels (src/game/p2p.ts). Each player reaches the
 * room through a Link, and the room speaks the same WireIn/WireOut protocol either way.
 *
 * The room runs the shared TableHost: clients only ever send intentions, the host checks them
 * against the rules and tells each player only what that player may see. A player who drops
 * keeps their seat for the reconnect window (a computer plays for them after a while) and can
 * resume with the secret token they were given on joining.
 */
import { EMOTE_KINDS, PRANK_KINDS } from './protocol.ts';
import type { ClientMsg, Profile, WireIn, WireOut } from './protocol.ts';
import { TableHost } from './table-host.ts';

const POSE_MIN_MS = 30;
/** How long a public table waits for strangers before computer players fill it. */
export const QUICK_WAIT_MS = 20_000;
/** One emote and one toy per player at most this often (ms). */
const EMOTE_MIN_MS = 400;
const PRANK_MIN_MS = 900;

/** How a room reaches one player: a WebSocket on the server, a data channel or a loopback in a browser. */
export interface Link {
  readonly open: boolean;
  send(text: string): void;
  close(code?: number): void;
}

export interface Member {
  id: string;
  token: string;
  link: Link | null;
  lastPose: number;
  /** Anti-spam: last emote and toy, in ms. */
  lastEmote: number;
  lastPrank: number;
  dropTimer: ReturnType<typeof setTimeout> | null;
}

interface WebCrypto {
  getRandomValues<T extends ArrayBufferView>(a: T): T;
}
const webCrypto = (): WebCrypto => (globalThis as unknown as { crypto: WebCrypto }).crypto;

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** A random URL-safe id (player ids, resume tokens). Works in Node and in browsers. */
export function randomId(n: number): string {
  const bytes = webCrypto().getRandomValues(new Uint8Array(n));
  let s = '';
  for (const b of bytes) s += ID_CHARS[b & 63];
  return s;
}

/** A random 31-bit seed (deck shuffles). */
export function randomSeed(): number {
  return webCrypto().getRandomValues(new Uint32Array(1))[0] >>> 1;
}

export interface RoomOptions {
  /** How long a dropped player's seat is held, in seconds. */
  reconnectSeconds: number;
  /** Called when the last member has gone. */
  onEmpty: (r: Room) => void;
  now?: () => number;
  /** A public Quick match table. */
  quick?: boolean;
  /** Quick match countdown (tests shorten it). */
  quickWaitMs?: number;
}

export class Room {
  readonly table: TableHost;
  readonly members = new Map<string, Member>();
  readonly code: string;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly onEmpty: (r: Room) => void;
  private readonly reconnectMs: number;
  private readonly now: () => number;
  readonly quick: boolean;
  private readonly quickWaitMs: number;
  private quickTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(code: string, opts: RoomOptions) {
    this.code = code;
    this.onEmpty = opts.onEmpty;
    this.reconnectMs = opts.reconnectSeconds * 1000;
    this.now = opts.now ?? (() => Date.now());
    this.quick = !!opts.quick;
    this.quickWaitMs = opts.quickWaitMs ?? QUICK_WAIT_MS;
    this.table = new TableHost(code, {
      send: (id, type, msg) => this.out(id, { t: type, m: msg } as WireOut),
      schedule: (fn, ms) => {
        const t = setTimeout(() => {
          this.timers.delete(t);
          fn();
        }, ms);
        this.timers.add(t);
        return () => {
          clearTimeout(t);
          this.timers.delete(t);
        };
      },
      now: this.now,
      seed: randomSeed,
    });
    if (this.quick) {
      this.table.quick = true;
      // public tables play with stacking on: it makes for livelier games with strangers
      this.table.rules = { ...this.table.rules, stacking: true };
    }
  }

  /** Can a stranger still sit down here? (Quick match: filling, and not about to start.) */
  joinable(): boolean {
    const t = this.table;
    if (!this.quick || t.phase !== 'lobby' || t.humans().length >= 4) return false;
    // not when it is about to deal (a newcomer would arrive mid-deal)
    return !t.quickDeadline || t.quickDeadline - this.now() > Math.min(3000, this.quickWaitMs * 0.2);
  }

  /** A public table starts: computer players take the empty seats, everyone counts as ready. */
  private startQuick(): void {
    const t = this.table;
    if (this.quickTimer) clearTimeout(this.quickTimer);
    this.quickTimer = null;
    t.quickDeadline = 0;
    if (t.phase !== 'lobby' || t.humans().length === 0) return;
    for (let seat = 0; seat < 4; seat++) if (!t.seats[seat]) t.setAi(seat, true, 'normal');
    for (const h of t.humans()) h.ready = true;
    t.start();
  }

  /** After someone joins or readies up at a public table: start now if it is time. */
  private checkQuick(): void {
    const t = this.table;
    if (!this.quick || t.phase !== 'lobby') return;
    const people = t.humans().filter((h) => h.connected);
    if (people.length >= 4 || (people.length > 0 && people.every((h) => h.ready))) this.startQuick();
  }

  out(id: string, msg: WireOut): void {
    const m = this.members.get(id);
    if (m?.link?.open) m.link.send(JSON.stringify(msg));
  }

  private others(id: string, msg: WireOut): void {
    const s = JSON.stringify(msg);
    for (const m of this.members.values()) if (m.id !== id && m.link?.open) m.link.send(s);
  }

  private all(msg: WireOut): void {
    this.others('', msg);
  }

  /** A new person asks for a seat. Returns their member record, or null if there is none. */
  admit(link: Link, profile: Profile, pranks: boolean): Member | null {
    // the first stranger at a public table starts its countdown (before the lobby goes out)
    if (this.quick && this.table.phase === 'lobby' && !this.table.quickDeadline) {
      this.table.quickDeadline = this.now() + this.quickWaitMs;
      this.quickTimer = setTimeout(() => this.startQuick(), this.quickWaitMs);
    }
    const id = randomId(10);
    const m: Member = { id, token: randomId(24), link, lastPose: 0, lastEmote: 0, lastPrank: 0, dropTimer: null };
    this.members.set(id, m);
    // welcome first so the client knows who it is before the lobby arrives
    link.send(JSON.stringify({ t: 'welcome', code: this.code, id, token: m.token, resumed: false } satisfies WireOut));
    const seat = this.table.join(id, profile, pranks);
    if (seat < 0) {
      this.members.delete(id);
      return null;
    }
    this.table.sync(id);
    this.checkQuick();
    return m;
  }

  /** A player who dropped comes back with their token: same seat, same hand. */
  resume(link: Link, token: string): Member | null {
    const m = [...this.members.values()].find((x) => x.token === token);
    if (!m) return null;
    if (m.link && m.link !== link) {
      const old = m.link;
      m.link = null;
      old.close(4001);
    }
    if (m.dropTimer) clearTimeout(m.dropTimer);
    m.dropTimer = null;
    m.link = link;
    link.send(JSON.stringify({ t: 'welcome', code: this.code, id: m.id, token: m.token, resumed: true } satisfies WireOut));
    this.table.reconnect(m.id);
    this.table.sync(m.id);
    return m;
  }

  handle(m: Member, msg: WireIn): void {
    const seat = this.table.seatOf(m.id);
    switch (msg.t) {
      case 'msg':
        if (msg.m && typeof msg.m === 'object') this.table.handle(m.id, msg.m as ClientMsg);
        this.checkQuick();
        return;
      case 'sync':
        return this.table.sync(m.id);
      case 'pose': {
        if (seat < 0 || !msg.p) return;
        const now = this.now();
        if (now - m.lastPose < POSE_MIN_MS) return;
        m.lastPose = now;
        const p = msg.p;
        const nums = (a: unknown, max: number) => (Array.isArray(a) ? a.slice(0, max).map(Number).filter(Number.isFinite) : []);
        this.others(m.id, { t: 'pose', m: { seat, h: nums(p.h, 7), l: nums(p.l, 22), r: nums(p.r, 22), v: Math.max(0, Math.min(1, Number(p.v) || 0)) } });
        return;
      }
      case 'emote': {
        if (seat < 0 || !msg.e || !EMOTE_KINDS.includes(msg.e.kind)) return;
        const now = this.now();
        if (now - m.lastEmote < EMOTE_MIN_MS) return;
        m.lastEmote = now;
        this.all({ t: 'emote', m: { seat, kind: msg.e.kind } });
        return;
      }
      case 'prank': {
        if (seat < 0 || !msg.p || !PRANK_KINDS.includes(msg.p.kind)) return;
        const now = this.now();
        if (now - m.lastPrank < PRANK_MIN_MS) return;
        m.lastPrank = now;
        const target = Number(msg.p.target);
        const victim = this.table.seats[target];
        // a player who switched pranks off is never targeted
        if (!victim || !victim.pranks || target === seat) return;
        this.all({ t: 'prank', m: { seat, kind: msg.p.kind, target, p: [], vel: [] } });
        return;
      }
      case 'rtc': {
        const to = this.members.get(String(msg.to));
        if (to && to.id !== m.id) this.out(to.id, { t: 'rtc', m: { from: m.id, to: to.id, data: msg.data } });
        return;
      }
      case 'leave':
        this.remove(m);
        m.link?.close(1000);
        return;
      default:
        return;
    }
  }

  /** The connection went away without saying goodbye. */
  dropped(m: Member, link: Link): void {
    if (m.link !== link) return; // already replaced by a resumed connection
    m.link = null;
    if (!this.members.has(m.id)) return;
    this.table.drop(m.id);
    m.dropTimer = setTimeout(() => this.remove(m), this.reconnectMs);
  }

  remove(m: Member): void {
    if (!this.members.has(m.id)) return;
    if (m.dropTimer) clearTimeout(m.dropTimer);
    this.members.delete(m.id);
    this.table.leave(m.id);
    if (this.members.size === 0) this.onEmpty(this);
  }

  dispose(): void {
    if (this.quickTimer) clearTimeout(this.quickTimer);
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    for (const m of this.members.values()) if (m.dropTimer) clearTimeout(m.dropTimer);
    this.table.dispose();
  }
}

/** Keep only a well-formed name and look from a client's profile. */
export function safeProfile(p: unknown): Profile {
  const o = (p ?? {}) as { name?: unknown; look?: unknown };
  return { name: typeof o.name === 'string' ? o.name.slice(0, 24) : 'Player', look: Array.isArray(o.look) ? o.look.slice(0, 8).map(Number) : [] };
}

/**
 * Route one connection's messages: its first message says what it is for (create, join or
 * resume); after that everything goes to its room. `rooms` resolves a code (the server has
 * many; a browser host has one). Returns a handler for incoming text and one for a close.
 */
export function routeConnection(
  link: Link,
  rooms: {
    create(): Room | null;
    find(code: string): Room | undefined;
    /** Quick match: a public table with room, or a new one (absent where there is no matchmaking). */
    quick?(): Room | null;
    fail(link: Link, error: string, reason: Extract<WireOut, { t: 'error' }>['reason']): void;
  },
  isCode: (s: string) => boolean,
): { message(text: string): void; closed(): void } {
  let room: Room | null = null;
  let member: Member | null = null;
  return {
    message(text: string): void {
      let msg: WireIn;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
      if (member && room) return room.handle(member, msg);
      if (msg.t === 'create') {
        room = rooms.create();
        if (!room) return rooms.fail(link, 'The server is busy. Try again in a minute.', 'server-full');
        member = room.admit(link, safeProfile(msg.profile), msg.pranks !== false);
        return;
      }
      if (msg.t === 'quick') {
        room = rooms.quick?.() ?? null;
        if (!room) return rooms.fail(link, 'Quick match is not available here.', 'not-found');
        member = room.admit(link, safeProfile(msg.profile), msg.pranks !== false);
        if (!member) return rooms.fail(link, 'That table just filled up. Try again.', 'full');
        return;
      }
      if (msg.t === 'join' || msg.t === 'resume') {
        const code = String(msg.code ?? '').toUpperCase();
        const r = isCode(code) ? rooms.find(code) : undefined;
        if (!r) return rooms.fail(link, `Room ${code} was not found.`, 'not-found');
        room = r;
        if (msg.t === 'join') {
          member = r.admit(link, safeProfile(msg.profile), msg.pranks !== false);
          if (!member) return rooms.fail(link, `Room ${code} is full or already playing.`, 'full');
        } else {
          member = r.resume(link, String(msg.token ?? ''));
          if (!member) return rooms.fail(link, 'Your seat was given away. Join again with the code.', 'expired');
        }
        return;
      }
      rooms.fail(link, 'Say hello first.', 'bad-request');
    },
    closed(): void {
      if (room && member) room.dropped(member, link);
    },
  };
}
