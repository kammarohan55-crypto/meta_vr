import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, requireSupportedNode, sdkEntry } from './project.mjs';

const failures = [];
try { requireSupportedNode(); } catch (error) { failures.push(error.message); }
const requiredAssets = [
  'public/models/people.glb',
  'public/models/lounge-premium.glb',
  'public/models/table-premium-marble.glb',
  'public/models/penthouse-backdrop-v1.glb',
  'public/textures/room_lightmap.jpg',
  'public/textures/room_env-neutral.hdr',
  'public/textures/penthouse-night-v1.jpg',
];
for (const name of requiredAssets) {
  const filename = resolve(root, name);
  if (!existsSync(filename)) { failures.push(`Missing asset: ${name}. Pull the complete repository.`); continue; }
  if (statSync(filename).size < 300 && readFileSync(filename, 'utf8').startsWith('version https://git-lfs.github.com/spec')) {
    failures.push(`${name} is a Git LFS pointer. Install Git LFS and run git lfs pull.`);
  }
}
try { sdkEntry(); } catch (error) { failures.push(error.message); }
console.log(`Node ${process.versions.node} · ${process.platform}/${process.arch}`);
if (failures.length) {
  for (const error of failures) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('Runtime assets and IWSDK are ready.');
  console.log('npm run dev:all starts the browser preview and multiplayer server.');
  console.log('Blender, Python, FFmpeg and API keys are optional; they are not required to run or edit the game.');
}
