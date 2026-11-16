/**
 * Online play with no game server: one player's browser hosts the table and friends connect to
 * it directly over WebRTC data channels. Players find each other through public relays
 * (Trystero over Nostr): only the connection offers pass through them, encrypted; the game
 * itself flows browser to browser. The host runs the same Room and TableHost as the Node
 * server (shared/room.ts), so rules, hidden hands, reconnects and computer fill-ins behave the
 * same, and clients use the same OnlineTable code over a different pipe.
 *
 * Limits: the host's tab has to stay open (when the host leaves, the table closes for all);
 * a few strict networks block direct connections, which a TURN relay fixes (VITE_TURN_URLS,
 * VITE_TURN_USER, VITE_TURN_CREDENTIAL at build time).
 */
import { joinRoom } from 'trystero';
import type { JoinRoomConfig, MessageAction, Room as PeerRoom } from 'trystero';
import { RECONNECT_SECONDS } from '../../shared/protocol.ts';
import type { WireOut } from '../../shared/protocol.ts';
import { Room, routeConnection } from '../../shared/room.ts';
import type { Link } from '../../shared/room.ts';
import { isCode, makeCode } from '../../shared/table-host.ts';
import type { Pipe } from './net.js';

/** Everyone running this game meets under one name; each table is its own room inside it. */
const APP_ID = 'afterhours-card-lounge-v1';
const roomName = (code: string) => `table-${code}`;
/** How long a guest looks for the table's host before giving up. */
const HOST_WAIT_MS = 20_000;

/**
 * The relays players meet through: from Trystero's own list, the ones that answered reliably in
 * testing (2026-11-15). Every player must use the same set. VITE_NOSTR_RELAYS (comma-separated
 * wss:// URLs) replaces it at build time.
 */
const RELAYS = ['wss://relay.primal.net', 'wss://relay.nostr.net', 'wss://relay.snort.social', 'wss://relay.ditto.pub', 'wss://yabu.me', 'wss://relay.nostr.com'];

function peerConfig(): JoinRoomConfig {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const urls = env.VITE_NOSTR_RELAYS ? env.VITE_NOSTR_RELAYS.split(',').map((u) => u.trim()).filter(Boolean) : RELAYS;
  const config: JoinRoomConfig = { appId: APP_ID, relayConfig: { urls, warnOnRelayFailure: false } };
  if (env.VITE_TURN_URLS) {
    config.turnConfig = [{ urls: env.VITE_TURN_URLS.split(',').map((s) => s.trim()), username: env.VITE_TURN_USER, credential: env.VITE_TURN_CREDENTIAL }];
  }
  return config;
}

const failWith = (link: Link, error: string, reason: Extract<WireOut, { t: 'error' }>['reason']) => {
  link.send(JSON.stringify({ t: 'error', error, reason } satisfies WireOut));
  link.close(4000);
};

/** The three messages peers exchange: protocol text, "I host this table", and "the table is closed". */
interface Wires {
  wire: MessageAction<string>;
  host: MessageAction<string>;
  bye: MessageAction<string>;
}
const wires = (room: PeerRoom): Wires => ({
  wire: room.makeAction<string>('wire'),
  host: room.makeAction<string>('host'),
  bye: room.makeAction<string>('bye'),
});

/**
 * A table hosted in this browser. Friends' browsers connect to it; the host's own seat talks
 * to it through a loopback pipe (no network at all).
 */
export class PeerHost {
  readonly code: string;
  readonly table: Room;
  private readonly peers: PeerRoom;
  private readonly w: Wires;
  private readonly guests = new Map<string, { link: { open: boolean } & Link; conn: ReturnType<typeof routeConnection> }>();
  private hostSeated = false;
  private closed = false;

  constructor() {
    this.code = makeCode(Math.random);
    this.table = new Room(this.code, { reconnectSeconds: RECONNECT_SECONDS, onEmpty: () => {} });
    this.peers = joinRoom(peerConfig(), roomName(this.code));
    this.w = wires(this.peers);
    this.peers.onPeerJoin(({ peerId }) => {
      if (this.closed) return;
      // tell the newcomer who hosts this table, then treat them like a server connection
      void this.w.host.send(this.code, { target: peerId });
      const link = {
        open: true,
        send: (text: string) => void this.w.wire.send(text, { target: peerId }),
        close: () => {
          link.open = false;
        },
      };
      const conn = routeConnection(link, { create: () => null, find: (c) => (c === this.code ? this.table : undefined), fail: failWith }, isCode);
      this.guests.set(peerId, { link, conn });
    });
    this.w.wire.onMessage((text, { peerId }) => {
      if (typeof text === 'string') this.guests.get(peerId)?.conn.message(text);
    });
    this.peers.onPeerLeave(({ peerId }) => {
      const g = this.guests.get(peerId);
      if (!g) return;
      g.link.open = false;
      this.guests.delete(peerId);
      g.conn.closed();
    });
  }

  /** The host's own seat: a pipe straight into the room. */
  localPipe(): Pipe {
    return new LoopbackPipe(this);
  }

  /** The host's seat asks to create the table: it gets the one this browser already holds. */
  claim(): Room | null {
    if (this.hostSeated || this.closed) return null;
    this.hostSeated = true;
    return this.table;
  }

  find(code: string): Room | undefined {
    return code === this.code && !this.closed ? this.table : undefined;
  }

  /** The host left: tell everyone the table is closed, then stop. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    void this.w.bye.send(this.code).finally(() => {
      setTimeout(() => {
        void this.peers.leave();
        this.table.dispose();
      }, 300);
    });
  }
}

/** The host's own connection to its table: same protocol, delivered in the same tab. */
class LoopbackPipe implements Pipe {
  onopen: (() => void) | null = null;
  onmessage: ((text: string) => void) | null = null;
  onclose: ((reason?: string) => void) | null = null;
  readonly backlog = 0;
  private closed = false;
  private readonly conn: ReturnType<typeof routeConnection>;

  constructor(private readonly host: PeerHost) {
    const self = this;
    const link: Link = {
      get open() {
        return !self.closed;
      },
      // like a network, delivery never re-enters the caller
      send: (text: string) => void setTimeout(() => !self.closed && self.onmessage?.(text), 0),
      close: () => self.close(),
    };
    this.conn = routeConnection(link, { create: () => host.claim(), find: (c) => host.find(c), fail: failWith }, isCode);
    setTimeout(() => !this.closed && this.onopen?.(), 0);
  }

  get ready(): boolean {
    return !this.closed;
  }

  send(text: string): void {
    setTimeout(() => !this.closed && this.conn.message(text), 0);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.host.close();
    this.onclose?.('closed');
  }
}

/**
 * A guest's connection to a friend's table: joins the table's room on the relays, waits for
 * the host to announce itself, then carries protocol text to and from the host only.
 */
export class GuestPipe implements Pipe {
  onopen: (() => void) | null = null;
  onmessage: ((text: string) => void) | null = null;
  onclose: ((reason?: string) => void) | null = null;
  readonly backlog = 0;
  private host = '';
  private done = false;
  private readonly peers: PeerRoom;
  private readonly w: Wires;
  private readonly timer: ReturnType<typeof setTimeout>;

  constructor(code: string) {
    this.peers = joinRoom(peerConfig(), roomName(code));
    this.w = wires(this.peers);
    this.w.host.onMessage((c, { peerId }) => {
      if (this.host || this.done || c !== code) return;
      this.host = peerId;
      clearTimeout(this.timer);
      this.onopen?.();
    });
    this.w.wire.onMessage((text, { peerId }) => {
      if (peerId === this.host && typeof text === 'string' && !this.done) this.onmessage?.(text);
    });
    this.w.bye.onMessage((_c, { peerId }) => {
      if (peerId === this.host) this.finish('host-left');
    });
    this.peers.onPeerLeave(({ peerId }) => {
      if (peerId === this.host) this.finish('host-gone');
    });
    this.timer = setTimeout(() => {
      if (!this.host) this.finish('no-host');
    }, HOST_WAIT_MS);
  }

  get ready(): boolean {
    return !!this.host && !this.done;
  }

  send(text: string): void {
    if (this.host && !this.done) void this.w.wire.send(text, { target: this.host });
  }

  close(): void {
    this.finish('closed');
  }

  private finish(reason: string): void {
    if (this.done) return;
    this.done = true;
    clearTimeout(this.timer);
    void this.peers.leave();
    this.onclose?.(reason);
  }
}
