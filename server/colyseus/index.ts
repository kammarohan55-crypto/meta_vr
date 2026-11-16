/**
 * CHAOS TABLE game server.
 *
 *   node server/index.ts            (Node 22.18+ runs TypeScript directly)
 *   PORT=2567 node server/index.ts
 *
 * Serves the Colyseus matchmaker and rooms. In development the Vite dev server
 * proxies https://<dev-host>/colyseus to it, so the headset only needs one URL.
 * In production you can also point it at the built client: STATIC=dist.
 */
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { ChaosRoom } from './chaos-room.ts';

const port = Number(process.env.PORT ?? 2567);
const staticDir = process.env.STATIC;
const types: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.hdr': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
};

// A plain HTTP server so the built client can be served from the same origin.
const http = createServer(async (req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  if (url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (!staticDir) return; // Colyseus answers its own routes
  if (url.startsWith('/matchmake') || url.startsWith('/colyseus')) return;
  const rel = normalize(decodeURIComponent(url === '/' ? '/index.html' : url)).replace(/^(\.\.[/\\])+/, '');
  try {
    const body = await readFile(join(staticDir, rel));
    res.writeHead(200, { 'content-type': types[extname(rel)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    // unknown paths fall back to the app shell
    try {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(await readFile(join(staticDir, 'index.html')));
    } catch {
      res.writeHead(404);
      res.end();
    }
  }
});

const gameServer = new Server({ transport: new WebSocketTransport({ server: http }) });
gameServer.define('chaos', ChaosRoom);
await gameServer.listen(port);
console.log(`[chaos] game server on :${port}${staticDir ? ` serving ${staticDir}` : ''}`);
