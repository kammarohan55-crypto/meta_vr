/**
 * The authoritative CHAOS TABLE server: many private rooms (shared/room.ts), each running the
 * shared TableHost, reached over WebSockets. Rooms are addressed by their 5-character code.
 * A browser can also host a single room for friends without this server (src/game/p2p.ts);
 * both speak the same protocol.
 */
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { isCode, makeCode } from '../shared/table-host.ts';
import { RECONNECT_SECONDS } from '../shared/protocol.ts';
import type { WireOut } from '../shared/protocol.ts';
import { Room, routeConnection } from '../shared/room.ts';
import { acceptUpgrade } from './ws.ts';
import type { WsSocket } from './ws.ts';

export { Room } from '../shared/room.ts';

const MAX_ROOMS = 500;
const HEARTBEAT_MS = 10_000;

export interface ServerOptions {
  port?: number;
  host?: string;
  /** Serve the built client from this folder (same origin as the game). */
  staticDir?: string;
  reconnectSeconds?: number;
  /** Computer think-time multiplier (tests use a small value). */
  aiPace?: number;
  autopilotMs?: number;
  /** Quick match countdown, ms (tests shorten it). */
  quickWaitMs?: number;
  log?: (s: string) => void;
}

export interface RunningServer {
  port: number;
  rooms: Map<string, Room>;
  http: Server;
  close(): Promise<void>;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.hdr': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ktx2': 'image/ktx2',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
};

export function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const log = opts.log ?? ((s: string) => console.log(s));
  const rooms = new Map<string, Room>();
  const reconnect = opts.reconnectSeconds ?? RECONNECT_SECONDS;
  const sockets = new Set<WsSocket>();

  const http = createServer(async (req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    if (url === '/health' || url === '/chaos/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.size, players: sockets.size }));
      return;
    }
    if (!opts.staticDir) {
      res.writeHead(404);
      res.end();
      return;
    }
    const rel = normalize(decodeURIComponent(url === '/' ? '/index.html' : url)).replace(/^(\.\.[/\\])+/, '');
    try {
      const body = await readFile(join(opts.staticDir, rel));
      res.writeHead(200, { 'content-type': TYPES[extname(rel)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });

  const newRoom = (quick: boolean): Room | null => {
    if (rooms.size >= MAX_ROOMS) return null;
    let code = makeCode(Math.random);
    while (rooms.has(code)) code = makeCode(Math.random);
    const room = new Room(code, {
      reconnectSeconds: reconnect,
      quick,
      quickWaitMs: opts.quickWaitMs,
      onEmpty: (r) => {
        r.dispose();
        rooms.delete(r.code);
        log(`[chaos] room ${r.code} closed (${rooms.size} open)`);
      },
    });
    if (opts.aiPace) room.table.aiPace = opts.aiPace;
    if (opts.autopilotMs) room.table.autopilotAfterMs = opts.autopilotMs;
    rooms.set(code, room);
    log(`[chaos] ${quick ? 'public' : 'private'} room ${code} opened (${rooms.size} open)`);
    return room;
  };

  http.on('upgrade', (req, sock, head) => {
    const ws = acceptUpgrade(req, sock, head);
    if (!ws) return;
    sockets.add(ws);
    // the first message must say what this connection is for
    const hello = setTimeout(() => ws.close(4002), 10_000);
    const conn = routeConnection(
      ws,
      {
        create: () => newRoom(false),
        find: (code) => rooms.get(code),
        // Quick match: the first public table still filling, or a new one
        quick: () => {
          for (const r of rooms.values()) if (r.joinable()) return r;
          return newRoom(true);
        },
        fail: (link, error, reason) => {
          link.send(JSON.stringify({ t: 'error', error, reason } satisfies WireOut));
          link.close(4000);
        },
      },
      isCode,
    );
    ws.onMessage = (text) => {
      clearTimeout(hello);
      conn.message(text);
    };
    ws.onClose = () => {
      clearTimeout(hello);
      sockets.delete(ws);
      conn.closed();
    };
  });

  const beat = setInterval(() => {
    for (const s of sockets) {
      if (!s.alive) {
        s.terminate();
        continue;
      }
      s.alive = false;
      s.ping();
    }
  }, HEARTBEAT_MS);

  return new Promise((resolve) => {
    http.listen(opts.port ?? 2567, opts.host ?? '0.0.0.0', () => {
      const addr = http.address();
      const port = typeof addr === 'object' && addr ? addr.port : (opts.port ?? 2567);
      resolve({
        port,
        rooms,
        http,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(beat);
            for (const s of sockets) s.terminate();
            for (const r of rooms.values()) r.dispose();
            rooms.clear();
            http.close(() => done());
          }),
      });
    });
  });
}
