/**
 * AFTERHOURS on Cloudflare (Workers + Durable Objects, free plan). One deployment serves the
 * built game and runs online play, always on, with no machine to keep running:
 *
 *   /chaos/health   "a game server is here" (the client checks before going online)
 *   /chaos-ws       a player's connection, routed to its table by ?op= and ?code=
 *   everything else the built game (dist/), served as static assets (free, not metered)
 *
 * Each table is a TableRoom Durable Object running the same Room and TableHost as the Node
 * server (shared/room.ts), so rules, hidden hands, reconnects and computer fill-ins are
 * identical. Quick match asks the Matchmaker object for a public table that is still filling.
 */
import { DurableObject } from 'cloudflare:workers';
import { RECONNECT_SECONDS } from '../shared/protocol.ts';
import type { WireOut } from '../shared/protocol.ts';
import { QUICK_WAIT_MS, Room, routeConnection } from '../shared/room.ts';
import type { Link } from '../shared/room.ts';
import { isCode, makeCode } from '../shared/table-host.ts';

// Env (ASSETS, ROOMS, MATCH) comes from worker-configuration.d.ts, generated from wrangler.jsonc.

/** Answer a WebSocket with a protocol error, so the game shows the reason (not a bare socket error). */
function refuse(error: string, reason: Extract<WireOut, { t: 'error' }>['reason']): Response {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();
  server.send(JSON.stringify({ t: 'error', error, reason } satisfies WireOut));
  server.close(4000, reason);
  return new Response(null, { status: 101, webSocket: client });
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/chaos/health') return json({ ok: true, rooms: -1, players: -1, host: 'cloudflare' });
    if (url.pathname === '/chaos-ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'Expected a WebSocket.' }, 426);
      const op = url.searchParams.get('op');
      let code = (url.searchParams.get('code') ?? '').toUpperCase();
      if (op === 'create') {
        // a fresh private table: find an unused code and reserve it
        code = '';
        for (let i = 0; i < 8 && !code; i++) {
          const c = makeCode(Math.random);
          if (await env.ROOMS.getByName(c).claim(false)) code = c;
        }
      } else if (op === 'quick') {
        code = await env.MATCH.getByName('quick').pick();
      } else if (op !== 'join' && op !== 'resume') {
        return refuse('Say hello first.', 'bad-request');
      } else if (!isCode(code)) {
        return refuse(`Room ${code || '?'} was not found.`, 'not-found');
      }
      if (!code) return refuse('The server is busy. Try again in a minute.', 'server-full');
      const forward = new URL(request.url);
      forward.searchParams.set('code', code);
      return env.ROOMS.getByName(code).fetch(new Request(forward.toString(), request));
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

/**
 * One table, addressed by its 5-letter code. It holds the room in memory while anyone is
 * connected (accepted WebSockets keep the object alive); an empty table is simply forgotten.
 */
export class TableRoom extends DurableObject<Env> {
  private room: Room | null = null;
  /** Reserved by the Worker before the first player arrives: a private or a public table. */
  private claimed: '' | 'private' | 'public' = '';

  /** Reserve this table (false when it is already in use). */
  async claim(quick: boolean): Promise<boolean> {
    if (this.claimed || this.room) return false;
    this.claimed = quick ? 'public' : 'private';
    return true;
  }

  /** Can a stranger still sit down here? */
  async joinable(): Promise<boolean> {
    if (this.claimed !== 'public') return false;
    return this.room ? this.room.joinable() : true;
  }

  private open(code: string): Room {
    if (!this.room) {
      this.room = new Room(code, {
        reconnectSeconds: RECONNECT_SECONDS,
        quick: this.claimed === 'public',
        onEmpty: (r) => {
          r.dispose();
          this.room = null;
          this.claimed = '';
        },
      });
    }
    return this.room;
  }

  async fetch(request: Request): Promise<Response> {
    const code = (new URL(request.url).searchParams.get('code') ?? '').toUpperCase();
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    const link: Link = {
      get open() {
        return server.readyState === WebSocket.READY_STATE_OPEN;
      },
      send: (text) => {
        try {
          server.send(text);
        } catch {
          /* closing */
        }
      },
      close: (closeCode) => {
        try {
          server.close(closeCode ?? 1000);
        } catch {
          /* already closed */
        }
      },
    };
    const conn = routeConnection(
      link,
      {
        create: () => (this.claimed === 'private' && !this.room ? this.open(code) : null),
        find: (c) => (this.room && c === code ? this.room : undefined),
        quick: () => {
          if (this.claimed !== 'public') return null;
          if (!this.room) return this.open(code);
          return this.room.joinable() ? this.room : null;
        },
        fail: (l, error, reason) => {
          l.send(JSON.stringify({ t: 'error', error, reason } satisfies WireOut));
          l.close(4000);
        },
      },
      isCode,
    );
    // the first message must say what this connection is for
    const hello = setTimeout(() => link.close(4002), 10_000);
    server.addEventListener('message', (e) => {
      clearTimeout(hello);
      if (typeof e.data === 'string') conn.message(e.data);
    });
    const gone = () => {
      clearTimeout(hello);
      conn.closed();
    };
    server.addEventListener('close', gone);
    server.addEventListener('error', gone);
    return new Response(null, { status: 101, webSocket: client });
  }
}

/** Hands out public tables for Quick match: the one still filling, or a new one. */
export class Matchmaker extends DurableObject<Env> {
  private current: { code: string; until: number } | null = null;

  async pick(): Promise<string> {
    const now = Date.now();
    const c = this.current;
    // the table filling now, while it takes people and is not about to deal
    if (c && now < c.until - 3500 && (await this.env.ROOMS.getByName(c.code).joinable())) return c.code;
    for (let i = 0; i < 8; i++) {
      const code = makeCode(Math.random);
      if (await this.env.ROOMS.getByName(code).claim(true)) {
        this.current = { code, until: now + QUICK_WAIT_MS };
        return code;
      }
    }
    return '';
  }
}
