import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, requireSupportedNode } from './project.mjs';

requireSupportedNode();
const directory = resolve(process.env.STATIC ?? resolve(root, 'dist'));
if (!existsSync(resolve(directory, 'index.html'))) throw new Error('No production build found. Run npm run build first.');
process.env.PORT ??= '8080';
process.env.STATIC = directory;
await import(pathToFileURL(resolve(root, 'server/main.ts')).href);
