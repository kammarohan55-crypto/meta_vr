import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

// The game server (node server/main.ts) listens on :2567. The dev server
// forwards /chaos-ws to it (and answers /chaos/health below) so the headset needs only the one dev
// URL. Without the server running, online tables are hosted directly in a player's browser.
const GAME_SERVER = process.env.CHAOS_SERVER ?? 'http://localhost:2567';

/**
 * /chaos/health in development: the game server's health when it runs, otherwise a quiet
 * {"ok":false} (a proxied request to a stopped server logs an error in the browser console).
 * The client hosts tables directly in the browser when the answer is not ok.
 */
const chaosHealth: Plugin = {
  name: 'chaos-health',
  configureServer(server) {
    server.middlewares.use('/chaos/health', async (_req, res) => {
      let body = '{"ok":false}';
      try {
        const r = await fetch(`${GAME_SERVER}/health`, { signal: AbortSignal.timeout(1500) });
        if (r.ok) body = await r.text();
      } catch {
        /* no game server running */
      }
      res.setHeader('content-type', 'application/json');
      res.setHeader('cache-control', 'no-store');
      res.end(body);
    });
  },
};

/**
 * What the built site ships from public/models and public/textures: only what the hero worlds
 * (Frostpeak and the three arenas) load. The rest belongs to the Penthouse, which is off in the
 * competition build because it seats 3D scans of real people (see src/game/world-choice.ts);
 * leaving its 60 MB out also keeps those scans off the public address. VITE_PENTHOUSE=1 keeps
 * everything. Nothing in public/ is touched: files are only removed from the build output.
 */
const HERO_WORLD_FILES = new Set([
  'models/heroes.glb',
  'models/hero-anims.glb',
  'textures/frostpeak-title.jpg',
  'textures/arena-shrine.jpg',
  'textures/arena-domain.jpg',
  'textures/arena-celestial.jpg',
  'textures/room_env-small.hdr',
]);
const PENTHOUSE_ONLY = ['audio/music/lounge.ogg'];

const leaveOutPenthouse: Plugin = {
  name: 'leave-out-penthouse',
  apply: 'build',
  closeBundle() {
    if (process.env.VITE_PENTHOUSE === '1') return;
    const out = join(process.cwd(), 'dist');
    let removed = 0;
    let bytes = 0;
    const drop = (rel: string) => {
      const file = join(out, rel);
      if (!existsSync(file)) return;
      bytes += statSync(file).size;
      rmSync(file);
      removed++;
    };
    for (const dir of ['models', 'textures']) {
      if (!existsSync(join(out, dir))) continue;
      for (const name of readdirSync(join(out, dir))) if (!HERO_WORLD_FILES.has(`${dir}/${name}`)) drop(`${dir}/${name}`);
    }
    PENTHOUSE_ONLY.forEach(drop);
    console.log(`\nLeft the Penthouse out of the build: ${removed} files, ${(bytes / 1048576).toFixed(1)} MB (VITE_PENTHOUSE=1 keeps them).`);
  },
};

export default defineConfig({
  plugins: [iwsdkDev(), chaosHealth, leaveOutPenthouse],
  server: {
    host: '0.0.0.0',
    port: 8081,
    open: false,
    proxy: {
      '/chaos-ws': { target: GAME_SERVER, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  resolve: { dedupe: ['three'] },
  optimizeDeps: { exclude: ['@babylonjs/havok'], include: ['three'], esbuildOptions: { target: 'esnext' } },
  publicDir: 'public',
  base: './',
});
