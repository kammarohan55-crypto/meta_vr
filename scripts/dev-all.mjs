import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { root, requireSupportedNode, sdkEntry, run } from './project.mjs';

requireSupportedNode();
const cli = sdkEntry();
if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify({ cwd: root, node: process.execPath, server: resolve(root, 'server/main.ts'),
    managedPreview: [cli, 'dev', 'restart', '--open', '--foreground'] }, null, 2));
  process.exit(0);
}
let server, preview, stopping = false;
const health = async () => {
  try {
    const response = await fetch('http://127.0.0.1:2567/health', { signal: AbortSignal.timeout(800) });
    const data = await response.json();
    return response.ok && data.ok === true && typeof data.rooms === 'number' && typeof data.players === 'number';
  } catch { return false; }
};
const stop = async (code = 0) => {
  if (stopping) return;
  stopping = true;
  // Only the CLI owns the Vite/browser process tree. Do not use taskkill or kill unrelated servers.
  if (preview) {
    try { await run(process.execPath, [cli, 'dev', 'down'], { signal: AbortSignal.timeout(15000) }); }
    catch (error) { console.error(`Preview shutdown: ${error.message}`); }
    if (preview.exitCode === null) preview.kill();
  }
  if (server && server.exitCode === null) server.kill();
  process.exit(code);
};
process.once('SIGINT', () => void stop(0));
process.once('SIGTERM', () => void stop(0));
try {
  if (await health()) console.log('Using the already-running multiplayer server on :2567.');
  else {
    const env = { ...process.env, PORT: '2567' };
    delete env.STATIC;
    server = spawn(process.execPath, [resolve(root, 'server/main.ts')], { cwd: root, stdio: 'inherit', shell: false, env });
    server.once('error', (error) => { console.error(error.message); void stop(1); });
    server.once('exit', (code) => { if (!stopping) { console.error('The multiplayer server stopped. Check whether port 2567 is already in use.'); void stop(code || 1); } });
    const deadline = Date.now() + 7000;
    while (!(await health())) {
      if (Date.now() > deadline) throw new Error('The multiplayer server did not become ready on port 2567.');
      await new Promise((done) => setTimeout(done, 200));
    }
  }
  console.log('\nOpening the managed IWSDK preview. Press Ctrl+C here to stop this session.');
  preview = spawn(process.execPath, [cli, 'dev', 'restart', '--open', '--foreground'], { cwd: root, stdio: 'inherit', shell: false });
  preview.once('error', (error) => { console.error(error.message); void stop(1); });
  preview.once('exit', (code) => { if (!stopping) void stop(code ?? 1); });
} catch (error) { console.error(error.message); await stop(1); }
