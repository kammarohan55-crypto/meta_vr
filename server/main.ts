/**
 * CHAOS TABLE game server. Node 22.18+ runs this TypeScript directly:
 *
 *   node server/main.ts                 # ws://0.0.0.0:2567
 *   PORT=8080 STATIC=dist node server/main.ts   # also serve the built client
 */
import { startServer } from './game-server.ts';

const s = await startServer({ port: Number(process.env.PORT ?? 2567), staticDir: process.env.STATIC });
console.log(`[chaos] game server listening on :${s.port}${process.env.STATIC ? ` (serving ${process.env.STATIC})` : ''}`);
const stop = async () => {
  await s.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
