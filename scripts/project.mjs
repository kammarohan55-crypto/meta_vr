import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export const root = fileURLToPath(new URL('../', import.meta.url));

export function requireSupportedNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (!((major === 22 && minor >= 18) || major >= 24)) {
    throw new Error(`Node ${process.versions.node} is unsupported. Install Node 22.23.2 or a current Node 24 LTS release, then reopen your terminal.`);
  }
}

export function sdkEntry() {
  const manifestPath = resolve(root, 'node_modules/@iwsdk/cli/package.json');
  if (!existsSync(manifestPath)) throw new Error('Dependencies are missing. Run npm run setup first.');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  return resolve(dirname(manifestPath), typeof manifest.bin === 'string' ? manifest.bin : manifest.bin.iwsdk);
}

// Calling npm's JavaScript entry avoids Windows .cmd quoting and shell differences.
export function npmCommand(args) {
  if (!process.env.npm_execpath) throw new Error('Run this helper through npm, for example npm run setup.');
  return [process.execPath, [process.env.npm_execpath, ...args]];
}

export function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', shell: false, ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} exited ${signal ?? code}`));
    });
  });
}
