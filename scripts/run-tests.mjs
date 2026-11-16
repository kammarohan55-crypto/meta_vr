import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, requireSupportedNode, run } from './project.mjs';

requireSupportedNode();
// cmd.exe does not expand *.test.ts. Pass actual filenames on every platform.
const files = ['shared', 'server'].flatMap((directory) =>
  readdirSync(resolve(root, directory)).filter((name) => name.endsWith('.test.ts'))
    .sort().map((name) => resolve(root, directory, name)),
);
if (!files.length) throw new Error('No game test files were found.');
await run(process.execPath, ['--test', ...files]);
