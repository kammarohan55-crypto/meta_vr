/**
 * The client's connection to a table. Two implementations share one interface:
 *
 *  - LocalTable runs the authoritative TableHost inside the browser for solo
 *    play against computer players (works offline once loaded).
 *  - OnlineTable talks to an authoritative room over a Pipe: a WebSocket to the
 *    game server (server/game-server.ts), or, with no server, a direct WebRTC
 *    link to a friend's browser that hosts the table (p2p.ts). Both run the same
 *    Room and TableHost, so the client code is identical.
 *
 * The game code never knows which one it has.
 */
import { TableHost } from '../../shared/table-host.ts';
import type { ClientMsg, EmoteMsg, EventsMsg, LobbyMsg, PoseMsg, PrankMsg, Profile, RtcMsg, ViewMsg, WireIn, WireOut } from '../../shared/protocol.ts';
import { nextRandom } from '../../shared/rules.ts';

export interface TableListener {
  lobby(m: LobbyMsg): void;
  view(m: ViewMsg): void;
  events(m: EventsMsg): void;
  reject(m: { error: string; view: ViewMsg | null }): void;
  pose(m: PoseMsg): void;
  emote(m: EmoteMsg): void;
  prank(m: PrankMsg): void;
  rtc(m: RtcMsg): void;
  status(s: 'connected' | 'reconnecting' | 'lost', detail?: string): void;
}

export interface TableConn {
  readonly online: boolean;
  readonly id: string;
  readonly code: string;
  send(m: ClientMsg): void;
  pose(p: PoseMsg): void;
  emote(e: EmoteMsg): void;
  prank(p: PrankMsg): void;
  rtc(to: string, data: unknown): void;
  leave(): void;
}

// ------------------------------------------------------------------ solo

export class LocalTable implements TableConn {
  readonly online = false;
  readonly id = 'me';
  readonly code = 'SOLO';
  readonly host: TableHost;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private paused = false;
  private queue: (() => void)[] = [];

  constructor(private readonly listener: TableListener, profile: Profile) {
    let rng = (Date.now() ^ 0x5bd1e995) >>> 0;
    this.host = new TableHost(this.code, {
      send: (id, type, msg) => {
        if (id !== this.id) return;
        // deliver asynchronously, like a network would, so the UI never re-enters itself
        const deliver = () => this.dispatch(type, msg);
        const t = setTimeout(() => {
          this.timers.delete(t);
          deliver();
        }, 0);
        this.timers.add(t);
      },
      schedule: (fn, ms) => {
        // AI turns and timers wait while the game is paused
        const run = () => (this.paused ? this.queue.push(fn) : fn());
        const t = setTimeout(() => {
          this.timers.delete(t);
          run();
        }, ms);
        this.timers.add(t);
        return () => {
          clearTimeout(t);
          this.timers.delete(t);
        };
      },
      now: () => performance.now(),
      seed: () => {
        const [r, n] = nextRandom(rng);
        rng = n;
        return Math.floor(r * 2 ** 31);
      },
    });
    this.host.join(this.id, profile);
    this.listener.status('connected');
  }

  private dispatch(type: string, msg: unknown): void {
    const l = this.listener as unknown as Record<string, (m: unknown) => void>;
    l[type]?.(msg);
  }

  setPaused(p: boolean): void {
    this.paused = p;
    if (!p) {
      const q = this.queue.splice(0);
      for (const fn of q) fn();
    }
  }

  send(m: ClientMsg): void {
    this.host.handle(this.id, m);
  }
  pose(): void {}
  emote(e: EmoteMsg): void {
    // computer players react to emotes in the avatar layer, nothing to relay
    void e;
  }
  prank(): void {}
  rtc(): void {}
  leave(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.host.dispose();
  }
}

// ------------------------------------------------------------------ online

/**
 * Where the game server lives. By default the same host as the page, on the
 * /chaos-ws path, which the Vite dev server proxies to the game server so the
 * headset only needs one URL. Override with ?server=wss://host:port or
 * VITE_CHAOS_SERVER at build time.
 */
export function serverUrl(): string {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q;
  const env = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_CHAOS_SERVER;
  if (env) return env;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/chaos-ws`;
}

/**
 * Is a game server answering? Rooms go through it when it is (it is the sturdiest route); with
 * no server, for example when the game is served as plain files, tables are hosted directly in
 * a player's browser. `?net=direct` or `?net=server` in the address forces one.
 */
export async function serverAvailable(timeoutMs = 2500): Promise<boolean> {
  const forced = new URLSearchParams(location.search).get('net');
  if (forced === 'direct' || forced === 'p2p') return false;
  if (forced === 'server') return true;
  try {
    const ws = new URL(serverUrl());
    const health = `${ws.protocol === 'wss:' ? 'https:' : 'http:'}//${ws.host}/chaos/health`;
    const r = await fetch(health, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return false;
    const j = (await r.json()) as { ok?: unknown };
    return j.ok === true;
  } catch {
    return false;
  }
}

/** A message pipe to a room: a WebSocket, a WebRTC data channel, or a same-tab loopback. */
export interface Pipe {
  readonly ready: boolean;
  /** Bytes queued and not yet sent (presence is dropped rather than queued behind a slow link). */
  readonly backlog: number;
  onopen: (() => void) | null;
  onmessage: ((text: string) => void) | null;
  /** `reason` comes from direct links: no-host, host-left, host-gone, closed. */
  onclose: ((reason?: string) => void) | null;
  send(text: string): void;
  close(code?: number): void;
}

/** The server address with this connection's intent, so a cloud backend can route it to its room. */
function socketUrl(base: string, hello: WireIn): string {
  const url = new URL(base, location.href);
  url.searchParams.set('op', hello.t);
  if ('code' in hello && hello.code) url.searchParams.set('code', String(hello.code).toUpperCase());
  return url.toString();
}

class WebSocketPipe implements Pipe {
  onopen: (() => void) | null = null;
  onmessage: ((text: string) => void) | null = null;
  onclose: ((reason?: string) => void) | null = null;
  private readonly ws: WebSocket;
  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onopen = () => this.onopen?.();
    this.ws.onmessage = (e) => this.onmessage?.(String(e.data));
    this.ws.onclose = () => this.onclose?.();
  }
  get ready(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }
  get backlog(): number {
    return this.ws.bufferedAmount;
  }
  send(text: string): void {
    if (this.ready) this.ws.send(text);
  }
  close(code?: number): void {
    this.ws.close(code);
  }
}

export class ServerError extends Error {
  readonly reason: string;
  constructor(message: string, reason: string) {
    super(message);
    this.reason = reason;
  }
}

export class OnlineTable implements TableConn {
  readonly online = true;
  id = '';
  code = '';
  private token = '';
  private pipe: Pipe | null = null;
  private left = false;
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listener: TableListener;
  private readonly dial: (hello: WireIn) => Pipe;
  /** How this table is reached: the game server, or directly (hosting it here, or a friend's). */
  readonly via: 'server' | 'direct-host' | 'direct';
  private readonly retryLimit: number;

  private constructor(listener: TableListener, dial: (hello: WireIn) => Pipe, via: OnlineTable['via']) {
    this.listener = listener;
    this.dial = dial;
    this.via = via;
    // a server holds seats for 90 s; a friend's browser is either back quickly or gone
    this.retryLimit = via === 'server' ? 12 : via === 'direct' ? 4 : 0;
  }

  static async host(listener: TableListener, profile: Profile, pranks: boolean): Promise<OnlineTable> {
    const url = serverUrl();
    const t = new OnlineTable(listener, (hello) => new WebSocketPipe(socketUrl(url, hello)), 'server');
    await t.connect({ t: 'create', profile, pranks });
    return t;
  }

  static async join(code: string, listener: TableListener, profile: Profile, pranks: boolean): Promise<OnlineTable> {
    const url = serverUrl();
    const t = new OnlineTable(listener, (hello) => new WebSocketPipe(socketUrl(url, hello)), 'server');
    await t.connect({ t: 'join', code: code.toUpperCase(), profile, pranks });
    return t;
  }

  /**
   * Quick match: sit at any public table that is filling (or open a new one). It starts by
   * itself when its countdown ends, with computer players in the empty seats. Needs the server.
   */
  static async quick(listener: TableListener, profile: Profile, pranks: boolean): Promise<OnlineTable> {
    const url = serverUrl();
    for (let attempt = 0; ; attempt++) {
      const t = new OnlineTable(listener, (hello) => new WebSocketPipe(socketUrl(url, hello)), 'server');
      try {
        await t.connect({ t: 'quick', profile, pranks });
        return t;
      } catch (e) {
        // a table can fill between being picked and being joined: try another
        if ((e as ServerError).reason !== 'full' || attempt >= 2) throw e;
      }
    }
  }

  /** Host a table in this browser for friends to join directly (no game server needed). */
  static async hostDirect(listener: TableListener, profile: Profile, pranks: boolean): Promise<OnlineTable> {
    // the direct-play code (and its WebRTC matchmaking) loads only when someone uses it
    const { PeerHost } = await import('./p2p.js');
    const host = new PeerHost();
    const t = new OnlineTable(listener, () => host.localPipe(), 'direct-host');
    await t.connect({ t: 'create', profile, pranks });
    return t;
  }

  /** Join a friend's table hosted in their browser. */
  static async joinDirect(code: string, listener: TableListener, profile: Profile, pranks: boolean): Promise<OnlineTable> {
    const c = code.toUpperCase();
    const { GuestPipe } = await import('./p2p.js');
    const t = new OnlineTable(listener, () => new GuestPipe(c), 'direct');
    t.code = c;
    await t.connect({ t: 'join', code: c, profile, pranks });
    return t;
  }

  /** Why a connection closed before it was welcomed, in words a player can act on. */
  private closeError(hello: WireIn, reason?: string): ServerError {
    if (this.via === 'server') return new ServerError('Could not reach the game server.', 'unreachable');
    const code = 'code' in hello ? String(hello.code) : this.code;
    if (hello.t === 'resume') return new ServerError('The host\u2019s table has closed.', 'not-found');
    if (reason === 'no-host') return new ServerError(`No open table has the code ${code}. Check the code with your host, and that they are still in their lobby.`, 'not-found');
    if (reason === 'host-left' || reason === 'host-gone') return new ServerError('The host closed the table.', 'not-found');
    return new ServerError('Could not connect to your friend\u2019s table.', 'unreachable');
  }

  private connect(hello: WireIn): Promise<void> {
    return new Promise((resolve, reject) => {
      let pipe: Pipe;
      try {
        pipe = this.dial(hello);
      } catch (e) {
        reject(new ServerError(`Bad server address ${serverUrl()}`, 'bad-url'));
        void e;
        return;
      }
      this.pipe = pipe;
      let welcomed = false;
      // a busy main thread (shader compiles on first load) can delay the open event, so judge
      // the deadline by the pipe's own state, not just the clock. A direct link spends up to
      // 20 s finding the host first.
      let timeout: ReturnType<typeof setTimeout>;
      let deadlines = 0;
      const arm = () => {
        timeout = setTimeout(() => {
          if (welcomed) return;
          if (pipe.ready && deadlines++ < 2) return arm();
          pipe.onclose = null;
          pipe.close();
          reject(this.via === 'server' ? new ServerError('The game server did not answer. Check the server address and that it is running.', 'timeout') : this.closeError(hello, 'no-host'));
        }, this.via === 'server' ? 10000 : 25000);
      };
      arm();
      pipe.onopen = () => pipe.send(JSON.stringify(hello));
      pipe.onmessage = (text) => {
        let m: WireOut;
        try {
          m = JSON.parse(text);
        } catch {
          return;
        }
        if (m.t === 'welcome') {
          welcomed = true;
          clearTimeout(timeout);
          this.id = m.id;
          this.code = m.code;
          this.token = m.token;
          this.retries = 0;
          this.listener.status('connected');
          resolve();
          return;
        }
        if (m.t === 'error') {
          clearTimeout(timeout);
          if (!welcomed) reject(new ServerError(m.error, m.reason));
          return;
        }
        const fn = (this.listener as unknown as Record<string, (x: unknown) => void>)[m.t];
        fn?.call(this.listener, m.m);
      };
      pipe.onclose = (reason) => {
        clearTimeout(timeout);
        if (!welcomed) {
          reject(this.closeError(hello, reason));
          return;
        }
        if (this.pipe !== pipe || this.left) return;
        // a host who leaves closes the table for everyone: no point trying to get back in
        if (reason === 'host-left') this.listener.status('lost', 'the host closed the table');
        else this.reconnect();
      };
    });
  }

  /** The connection dropped: keep trying to get our seat back (the server holds it for 90 s). */
  private reconnect(): void {
    if (this.left || this.retryTimer) return;
    if (this.retries >= this.retryLimit) {
      this.listener.status('lost', this.via === 'server' ? 'the server could not be reached' : 'the host\u2019s table could not be reached');
      return;
    }
    this.listener.status('reconnecting');
    const delay = Math.min(5000, 400 * 2 ** this.retries);
    this.retries++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect({ t: 'resume', code: this.code, token: this.token }).catch((e: ServerError) => {
        if (e.reason === 'expired' || e.reason === 'not-found') this.listener.status('lost', e.message);
        else this.reconnect();
      });
    }, delay);
  }

  private out(m: WireIn): void {
    if (this.pipe?.ready) this.pipe.send(JSON.stringify(m));
  }

  send(m: ClientMsg): void {
    this.out({ t: 'msg', m });
  }
  pose(p: PoseMsg): void {
    // presence is disposable: never queue it behind a slow link
    if (this.pipe && this.pipe.backlog < 16_000) this.out({ t: 'pose', p });
  }
  emote(e: EmoteMsg): void {
    this.out({ t: 'emote', e });
  }
  prank(p: PrankMsg): void {
    this.out({ t: 'prank', p });
  }
  rtc(to: string, data: unknown): void {
    this.out({ t: 'rtc', to, data });
  }
  leave(): void {
    this.left = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.out({ t: 'leave' });
    // a moment for the goodbye to reach the table before the pipe closes
    const pipe = this.pipe;
    setTimeout(() => pipe?.close(1000), 250);
  }
}

export type { EventsMsg, LobbyMsg, RtcMsg, ViewMsg };
