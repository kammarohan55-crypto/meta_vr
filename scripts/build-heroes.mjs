// Builds the stylized player characters for the Frostpeak world.
//
//   node scripts/build-heroes.mjs
//
// Source: KayKit Adventurers Character Pack 1.0 by Kay Lousberg, CC0 1.0
// (https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0).
// Downloads the official GLBs into .cache/kaykit, then writes:
//   public/models/heroes.glb        every character mesh + skeleton, no weapons, no animations
//   public/models/hero-anims.glb    one rig carrying only the clips the card table uses
// All characters share the same rig and bone names, so one clip set drives them all.

import { mkdirSync, existsSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, mergeDocuments, unpartition } from '@gltf-transform/functions';
import { root } from './project.mjs';

const SOURCE =
  'https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/main/addons/kaykit_character_pack_adventures/Characters/gltf/';
const HEROES = ['Knight', 'Mage', 'Rogue_Hooded', 'Barbarian', 'Rogue'];
/** Clips used at the table. Everything else in the pack is combat/locomotion. */
const CLIPS = [
  'Sit_Chair_Idle',
  'Sit_Chair_Down',
  'Cheer',
  'Hit_A',
  'Hit_B',
  'Interact',
  'PickUp',
  'Throw',
  'Use_Item',
  'Spellcast_Raise',
  'Idle',
];
/** Props the pack attaches to every character; none belong at a card table. */
const PROP = /sword|shield|axe|crossbow|staff|wand|dagger|spellbook|quiver|arrow|mug|smokebomb|knife|throwable/i;

const cache = path.join(root, '.cache', 'kaykit');
const out = path.join(root, 'public', 'models');
mkdirSync(cache, { recursive: true });

async function fetchSource(name) {
  const file = path.join(cache, `${name}.glb`);
  if (!existsSync(file)) {
    const response = await fetch(`${SOURCE}${name}.glb`);
    if (!response.ok) throw new Error(`Download failed (${response.status}) for ${name}`);
    writeFileSync(file, new Uint8Array(await response.arrayBuffer()));
  }
  return file;
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/**
 * Removes an animation with its samplers and channels (dispose() alone leaves the samplers, which
 * keep their keyframe accessors alive). Accessors can be shared between clips, so they are left
 * for prune() to remove once nothing references them.
 */
function dropAnimation(animation) {
  for (const sampler of animation.listSamplers()) sampler.dispose();
  for (const channel of animation.listChannels()) channel.dispose();
  animation.dispose();
}
const size = (f) => `${(statSync(f).size / 1024).toFixed(0)} KB`;

const heroes = await io.read(await fetchSource(HEROES[0]));
for (const name of HEROES.slice(1)) mergeDocuments(heroes, await io.read(await fetchSource(name)));

// Animation file: one copy of the rig with the chosen clips.
const anims = await io.read(await fetchSource(HEROES[0]));
for (const a of anims.getRoot().listAnimations()) if (!CLIPS.includes(a.getName())) dropAnimation(a);
const missing = CLIPS.filter((c) => !anims.getRoot().listAnimations().some((a) => a.getName() === c));
if (missing.length) throw new Error(`Clips missing from the pack: ${missing.join(', ')}`);
for (const n of anims.getRoot().listNodes()) if (n.getMesh()) n.setMesh(null);
await anims.transform(prune(), resample({ tolerance: 1e-4 }), dedup(), unpartition());

// Character file: meshes and skeletons only. Each scene's top node is renamed Hero_<name>.
for (const a of heroes.getRoot().listAnimations()) dropAnimation(a);
for (const n of heroes.getRoot().listNodes()) if (PROP.test(n.getName())) n.dispose();
const scenes = heroes.getRoot().listScenes();
const main = scenes[0];
scenes.forEach((scene, i) => {
  for (const child of scene.listChildren()) {
    if (i === 0 && child.getName().startsWith('Hero_')) continue;
    if (child.getName() === 'Rig' || child.listChildren().length) child.setName(`Hero_${HEROES[i]}`);
    if (scene !== main) {
      scene.removeChild(child);
      main.addChild(child);
    }
  }
  if (scene !== main) scene.dispose();
});
await heroes.transform(prune(), dedup(), unpartition());

const heroesFile = path.join(out, 'heroes.glb');
const animsFile = path.join(out, 'hero-anims.glb');
await io.write(heroesFile, heroes);
await io.write(animsFile, anims);
console.log(`heroes.glb ${size(heroesFile)}: ${main.listChildren().map((c) => c.getName()).join(', ')}`);
console.log(`hero-anims.glb ${size(animsFile)}: ${anims.getRoot().listAnimations().map((a) => a.getName()).join(', ')}`);
