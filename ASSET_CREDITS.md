# Asset credits and provenance

This project includes third-party models/materials, modified authoring files and generated artwork. The original code has no project-wide open-source licence selected; public source visibility does not replace individual asset licences.

## Imported models

The inherited project identifies these models and licences. Attribution remains required for CC BY assets, including modified exports. The exact sofa upload URL was not stored in the source project and has not been recovered; retain its attribution and obtain the original download/licence record from the team before a separately licensed release.

| Asset | Creator | Source | Licence recorded in original project |
|---|---|---|---|
| Nathan Animated003 — Walking3D Man | Renderpeople | [Original upload](https://sketchfab.com/3d-models/nathan-animated-003-walking-3d-man-143a2b1ea5eb4385ae90a73657aca3bc) | CC Attribution; existing project records CC BY 4.0 |
| Sophia Animated003 — Animated3D Woman | Renderpeople | [Original model ID](https://sketchfab.com/3d-models/sophia-animated-003-animated-3d-woman-dc448c3be0e74f96a55fb475a13433cf) | Existing project records CC BY 4.0; page access was blocked during handoff verification |
| Carla Rigged001 — Rigged3D Business Women | Renderpeople | [Original model ID](https://sketchfab.com/3d-models/carla-rigged-001-rigged-3d-business-women-acf520f450d14dd799f98a6fede3edf5) | Existing project records CC BY 4.0; page access was blocked during handoff verification |
| Luxury Modern Couch — Black | nghihuutr | Sketchfab; original upload URL absent from inherited files | Existing project records CC BY 4.0; original evidence still to recover |
| Potted Plant01/02 and Pachira Aquatica01 | Rico Cilliers / Rob Tuytel | Poly Haven | CC0, as recorded in inherited credits |

[CC BY 4.0 licence](https://creativecommons.org/licenses/by/4.0/). Preserve source/creator attribution and identify modifications. The character meshes were seated/posed, combined into the game export and animated through project skeleton/IK code. Project-added headsets are hidden/removed from the visible faces. The sofa and room materials were adapted for the lounge.

Renderpeople's Nathan page currently carries a NoAI tag in addition to its displayed CC Attribution licence. Do not treat these imported scans as newly generated original art or as unrestricted training/model-generation inputs. Preserve upstream terms when adding new assets.

**Since 2026-11-16 these three scanned people and the lounge they sit in are not part of normal builds.** They are scans of real people, and the Meta VR Start competition rules forbid depicting identifiable people other than the entrants. The files stay in the repository; only a build made with `VITE_PENTHOUSE=1` includes them.

## Photographed material maps

| Material | Creator | Source | Licence |
|---|---|---|---|
| Brown Leather | Rob Tuytel | [Poly Haven](https://polyhaven.com/a/brown_leather) | CC0 |
| Walnut Veneer | Jenelle van Heerden | [Poly Haven](https://polyhaven.com/a/walnut_veneer) | CC0 |
| Diagonal Parquet | Sergej Majboroda / Jenelle van Heerden | [Poly Haven](https://polyhaven.com/a/diagonal_parquet) | CC0 |

The downloaded map files are in `blender/tex/`; the existing source notes `LEATHER_SOURCE.md`, `WALNUT_SOURCE.md` and `PARQUET_SOURCE.md` retain their provenance. Their use means the older claim that every non-model texture was made from scratch is inaccurate.

## Generated environment and marble imagery

- `public/textures/city-blue-hour.jpg`: generation prompt is in `blender/city-texture-provenance.txt`.
- `public/textures/penthouse-night-v1.jpg` and `nero-marble-v1.jpg`: generated with Codex's built-in image tool. Prompts/production usage are in [penthouse-art-provenance.md](blender/penthouse-art-provenance.md).
- The penthouse is distant photographic architecture, not a fully modelled scene. The marble is used as a base-colour texture on a real 3D table.

These files are already included and need no generation service merely to render. No claim is made that every visible item in the source scenes is original authorship.

## Authoring sources

Editable `.blend` files use Git LFS. All image data used by the two large lounge scenes is packed for portability. Runtime GLBs embed their image/buffer data. Automatic Blender backups, intermediate bakes and local recordings are not distributed.

## Music

Each world has its own looping soundtrack, streamed from `public/audio/music/` (re-encoded to Ogg Opus 96 kbps; otherwise unmodified).

| Track (file) | World | Composer | Source | Licence |
|---|---|---|---|---|
| "Frost Waltz" (`frostpeak.ogg`) | Frostpeak | Kevin MacLeod | [incompetech.com](https://incompetech.com) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| "Ishikari Lore" (`shrine.ogg`) | Wisteria Shrine | Kevin MacLeod | incompetech.com | CC BY 4.0 |
| "Late Night Radio" (`domain.ogg`) | Midnight Domain | Kevin MacLeod | incompetech.com | CC BY 4.0 |
| "Floating Cities" (`celestial.ogg`) | Celestial Arena | Kevin MacLeod | incompetech.com | CC BY 4.0 |
| "Bossa Antigua" (`lounge.ogg`) | Penthouse | Kevin MacLeod | incompetech.com | CC BY 4.0 |

Required credit, shown in game (Preferences) and here: "Music by Kevin MacLeod (incompetech.com), licensed under Creative Commons: By Attribution 4.0 License."

The arena title/card images (`public/textures/arena-*.jpg`) are captures of the game's own procedural scenes.

## Sound effects

| Asset | Creator | Source | Licence |
|---|---|---|---|
| Card place/slide/shove/fan/shuffle sounds (`public/audio/sfx/card-*.ogg`, `cards-pack-*.ogg`) | Kenney | [Casino Audio](https://kenney.nl/assets/casino-audio) | CC0 1.0 |
| Menu sounds: soft drops, confirm, plucks, bong (`drop_*`, `confirmation_001`, `pluck_*`, `bong_001`) | Kenney | [Interface Sounds](https://kenney.nl/assets/interface-sounds) | CC0 1.0 |
| Wood, soft, punch, bell and glass impacts (`impact*.ogg`) | Kenney | [Impact Sounds](https://kenney.nl/assets/impact-sounds) | CC0 1.0 |
| Stingers: your turn, skip, +2, wild, last card, take, win, lose, cheer, sad (`jingles_PIZZI*`, `jingles_STEEL*`) | Kenney | [Music Jingles](https://kenney.nl/assets/music-jingles) | CC0 1.0 |

The licence text is kept beside the files (`public/audio/sfx/LICENSE-kenney-CC0.txt`). Files were picked by measurement (spectral centroid, share of energy above 4 kHz, attack time and melody direction) rather than by name, so menus stay soft and stingers move in the right direction. The whooshes, +4 riser and boom, sparkles, victory chord, reverse swell, heartbeat, claps and toy sounds are designed in code (`src/game/sound-design.ts`) and rendered once while the game loads; the ambience is generated in `src/game/audio.ts`. Nothing recorded comes from outside the CC0 packs above.

## Frostpeak world (default since 2026-11-14)

| Asset | Creator | Source | Licence |
|---|---|---|---|
| Knight, Mage, Rogue (hooded and unhooded), Barbarian characters and their animation clips | Kay Lousberg (KayKit) | [KayKit Character Pack: Adventurers 1.0](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0) | CC0 1.0 |

- `public/models/heroes.glb` and `public/models/hero-anims.glb` are produced from the official pack by `scripts/build-heroes.mjs`: weapons, shields and unused clips are removed; nothing is repainted. Credit is not required by CC0 but is given here.
- Everything else in Frostpeak (mountains, ground, lake, stream, sky, rocks, pines, bridge, deck, table, chairs, lanterns, snowfall and the painted plank textures) is generated in code in `src/game/frostpeak.ts` and is original to this project.
- `public/textures/frostpeak-title.jpg` is a frame captured from the running game (`scripts/dev/capture-title.mjs`), not generated imagery.

## Card faces and lighting map (2026-11-16)

- The card faces and back are drawn in code (`src/game/cards.ts`) and are original to this project: no third-party artwork or fonts are embedded (values use the device's own serif face).
- `public/textures/room_env-small.hdr` is a 512×256 box-filtered copy of `room_env-neutral.hdr`, made by `scripts/shrink-hdr.py`; it lights the hero worlds in place of the 5.8 MB original.
