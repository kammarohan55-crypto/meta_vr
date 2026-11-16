# Context for continuing AFTERHOURS

This is the active **VR/social card game**, branded **AFTERHOURS — The Card Lounge**. Continue this implementation; it is not a fresh scaffold. `CLAUDE.md` imports this file and the repository's IWSDK guidance. Start with `WINDOWS_SETUP.md` and use the commands in `package.json`.

## User intent and project history

The team has three people and originally discussed the Meta Start Developer Competition2026: <https://start-developer-competition-26.devpost.com/>. Earlier F1/pit-stop ideas and a separate island prototype were considered before the team chose this social card game. Those prototypes are separate and are not the active game in this repository. Do not switch back merely because older files exist elsewhere.

The chosen experience is a colour/symbol-matching shedding card game: solo against bots or multiplayer via a shared room code, with friends seated together, natural card handling, sound, reactions and dramatic special-card/win/loss moments. The original references used UNO-like cards and a luxurious lounge with realistic people, city windows, warm lamps and colourful event effects. The current visible product branding is AFTERHOURS. Internal `chaos` identifiers remain for compatibility; they are not the intended product name.

The user's strongest priority is a **large visible improvement in graphics, UI and animation**. Several small lighting/prop changes were rejected as too subtle. They asked for cinematic, realistic visuals and used GTA 6/Cyberpunk as aspirational comparisons. Do not promise equivalent AAA production quality or a hackathon win. Prefer changes that can be seen in the actual running game, supported by real previews, rather than presenting generated reference art as gameplay.

The user specifically asked to remove the headsets from people's faces and the floating neon controller decoration. Keep those removed. They also disliked the old “CHAOS TABLE” wording. Preserve readable faces, clear hand/card placement and all existing game functions while improving presentation.

The last reported issue was cropping on the left and right. The desktop camera now keeps a wider horizontal composition as the window narrows; the main-menu image is contained without zoom/crop. The menu was checked at 1200×704, 900×720 and 720×820, including a real click into Solo from the narrow layout. Do not restore the old fixed framing.

## Direction change: Frostpeak (2026-11-14)

The team asked for a stylized, painterly look (snowy mountains, lake, chunky timber bridge, soft lilac haze) and cool game characters instead of the photoreal penthouse. **Frostpeak** (`src/game/frostpeak.ts`) is now the default world and **stylized KayKit heroes** (`src/game/heroes.ts`) sit at the table. Both keep the old interfaces (`Lounge` surface; `PersonRig` surface), so rules, cards, input and networking are unchanged. The penthouse lounge and scanned people are kept in the repository but are **off in normal builds** (see *Competition build* below); `src/game/world-choice.ts` decides which cast and world load. Bots appear as heroes (Sir Bram, Mira the Mage, Wren...) in Frostpeak. See STATUS.md for evidence.

## What is implemented

- Deterministic 108-card rules engine and an authoritative `TableHost`, shared by browser solo play and the multiplayer server.
- Local bots, room creation/join by code, lobby readiness, hidden hands, reconnect/autopilot, rematch and event/pose signalling.
- Rooms run one shared implementation (`shared/room.ts`): on the Node server over WebSockets, on Cloudflare Workers + Durable Objects (`cloud/worker.ts`, free plan; `npm run deploy` after `npx wrangler login`), or, when no server answers, hosted in the player's browser with friends connected directly over WebRTC (Trystero/Nostr matchmaking, `src/game/p2p.ts`). Quick match (public tables with a countdown and computer fill-ins) needs a server. Verified with two real browser players on each route (`scripts/dev/p2p-test.mjs`, `scripts/dev/cloud-browser-test.mjs`) and `scripts/cloud-smoke.mjs` against both servers.
- Desktop clicks plus SDK ray/poke targets and hand/controller input. Pinch-card handling preserves the contact offset, filters motion, cancels tracking loss/pose jumps, bounds deck pulls and validates discard placement.
- Seated scanned Nathan, Sophia and Carla characters. Headsets are hidden. Existing skeleton/IK attaches fans to palms; added blinks, eye lead, brow reactions, breathing, shoulder motion and turn nods use rest poses to avoid drift.
- A wide 1680×945 cinematic title canvas on a 1.20×0.675m spatial panel; other menus retain 1204×840 on 0.86×0.60m panels. Large typography, photographic cover, Solo/Friends/Join actions, pill utilities and animated real 3D title cards.
- A generated photographic penthouse architectural backdrop replaces the visible old room shell/shelves. The live foreground retains a real 3D marble table, chairs, floor, avatars, cards, props and event effects.
- Brass pendant, planters/foliage, coasters, linen, candle flame and coffee steam; rain/mist/traffic-light layers animate separately. The added interior-detail asset uses 13 draw calls and no extra shadow lights.
- +4 floating card, four energy ribbons, charging rings and a short expanding blast; a transient light colours nearby surfaces. Win uses gold confetti, crown and laurels. Lose uses rose lettering and a rematch prompt. No camera shake was added.
- Reduced effects/flashing controls reach the menu, environment and scanned-character decorative motion. Gameplay reaches and tracking remain responsive.
- Existing spatial audio, voice/WebRTC signalling, emotes, toy pranks and mixed-reality switches remain.

## Important visual implementation details

**The far room is a photographic matte, not fully modelled architecture.** Its plane has limited parallax and cannot support walking around arbitrary furnishings. It was chosen for a visible quality jump without replacing the existing game. Do not describe it as fully reconstructed photoreal 3D or ray tracing.

`public/models/penthouse-backdrop-v1.glb` embeds `public/textures/penthouse-night-v1.jpg`. `Lounge.usePenthouse()` positions it and hides the old architecture while keeping floor/rug/chairs. The old room/city assets remain as fallbacks. The backdrop and close 3D detail are hidden in mixed reality through the existing decor group.

`public/models/table-premium-marble.glb` has the same physical footprint and top height as the earlier walnut table: radius approximately 0.72m, top at 0.74m. The surface node still has the legacy name `Table_Walnut_Surface`; its material is polished Nero marble with planar UVs. Preserve these anchors unless all interaction code is updated together. Previous walnut sources are preserved.

The new penthouse and marble images were generated with Codex's built-in image tool. The prompt/provenance is in `blender/penthouse-art-provenance.md`. Rendering the saved assets requires no AI account. Claude does not automatically inherit Codex's image-generation tool.

## Code map

| File/area | Responsibility |
|---|---|
| `src/game/app.ts` | Screens, actions, local/online session, event queue, colour choice, settings |
| `src/game/ui.ts` | Canvas panels, current geometry-aware hit mapping, title cover/cards/animation |
| `src/game/tabletop.ts` | Card fans, picking, pinch contact, deck pull, discard guide and release |
| `src/game/people.ts`, `avatars.ts` | Loaded rigs, scans, IK, gaze, expressions, reactions, remote poses |
| `src/game/env.ts` | Asset loading, close furniture, lighting, photographic far-room/fallbacks |
| `src/scene-assets/` | Deterministic procedural atmosphere/interior prototypes; manifest registered |
| `src/game/vfx.ts` | Card-event energy, labels, confetti, projection/light and colour picker |
| `src/game/net.ts`, `voice.ts`, `audio.ts` | Local/online transport, resume, voice/signalling and sound |
| `src/chaos-system.ts` | IWSDK entities, seat placement, tracked hands, XR sessions, desktop framing |
| `shared/` | Rules, bots, messages, authoritative table host and tests |
| `server/main.ts`, `game-server.ts`, `ws.ts` | Active Node server and WebSocket implementation |
| `server/colyseus/` | Inactive alternative; not the active server and not validated |
| `iwsdk.config.json` | SDK/world/scene authority; `vite.config.ts` only wires the plugin/proxy |

## Development constraints that prevent regressions

Read `AGENTS.md` and applicable `.claude/skills/`/scoped rules. Import Three.js runtime classes from `@iwsdk/core`, not a second standalone `three` instance. Keep the SDK-managed preview lifecycle; do not start a competing raw Vite server.

`src/assets.ts` runs independently in editor/runtime. Registered procedural prototypes must be parentless, deterministic and free of browser/World side effects. Keep geometry/material creation in asset modules and scene composition in the supported scene format.

Retain card/rules/network behaviour during visual work. Run the typecheck before browser testing. Test changed actions through real clicks or supported immersive input; state injection may prepare rare effect scenarios but is not proof that interaction works. Read `STATUS.md` before claiming hardware or multiplayer coverage.

The title panel changes canvas and geometry dimensions; hit mapping must use the current geometry, not the old constructor width. Floating title cards are decorative and must not intercept menu input. The projected +4 card disables depth writing and cast shadows during its transparent fade.

## Verified and unfinished work

See `STATUS.md` for the authoritative evidence and limitations. Local rules/server tests, hand-geometry checks, typecheck/build and managed-browser menu/card/effect flows have passed. Windows portability is supplied through portable scripts and a Windows/Ubuntu CI workflow; record the actual CI result rather than claiming a physical Windows/Quest test that did not happen.

There was no physical Quest available during the graphics work. Headset frame rate, thermal behaviour, multi-headset poses, real inter-device voice, MR passthrough and cross-network TURN remain to verify. The visual references do not prove those features.

Good next work: inspect the current preview, test on a real Quest, profile the existing scene, validate two Windows/browser clients and voice on separate networks, then choose a meaningful visual/interaction improvement with the team. A fully 3D room or better character asset set would be a separate scope decision, not something already complete.

Hackathon membership/eligibility, deadline, category and submission status must be checked in the team's actual accounts against current official rules. This repository does not establish acceptance or submission. No guarantee of winning has been made.

## Handoff contents

Runtime exports, textures, source, portable helpers, Claude/IWSDK skills and editable Blender scenes are included. `.blend` files use Git LFS. Dependencies, credentials, machine-local MCP configurations, temporary recordings/bakes and automatic Blender backups are excluded. Current actual-game screenshots are in `docs/previews/`. The original pasted reference sheets lived in temporary Mac paths and were unavailable during this export; their visual direction is described above.

## Competition build (2026-11-16)

The game was checked against the Meta VR Start Developer Competition 2026 rules and judging criteria. What that changed, and what must stay true:

- **The Penthouse is off unless a build sets `VITE_PENTHOUSE=1`.** It seats Renderpeople scans of real people, and the rules forbid depicting identifiable people other than the entrants. `world-choice.ts` drops it from the world list and `vite.config.ts` leaves its files (56 MB) out of `dist`. Nothing was deleted from `public/` or the code. Do not turn it on for the submitted build.
- **Table space is not world space in a headset.** The table is placed where the player sits, turned to face them and raised to their head height (`ChaosSystem.place`). Heads, hands, cards and effects are kept in table space; `Object3D.lookAt`, `getWorldPosition` and friends work in world space. Use `faceTablePoint` / `tableToWorld` (`src/game/util.ts`) to turn things toward the viewer. Passing a table-space point to `lookAt` made every menu face away, mirrored, for a player not sitting at the tracking origin; the desktop emulator's default pose hides that, so test with the headset moved and turned (`xr set-transform`).
- **The table follows the player's head height** (40 cm from eyes to table top), on a sofa, a bed or standing; it glides to a new height two seconds after the player stands up or sits down. Mixed reality keeps the table on the real floor.
- **Narrow views (Meta VR Glasses, 37° to each side):** `ChaosApp.setNarrowView` moves the action bar to the table edge under the player's cards, puts hints just past the pile and shrinks the title. It is chosen from the headset's projection, or from a gaze input source in the emulator. `gazeTracking` is requested (optional) in `iwsdk.config.json`; gaze and pinch drive every menu, card, pile and colour.
- **Pointing shows what a pinch will pick:** a card, the deck or a colour rises under a hand ray, a gaze or the mouse (the glasses draw no cursor).
- **A card pushed 11 cm out of the fan toward the pile plays on release**, so nobody has to reach the middle of the table (the rules' two-foot "airplane seat" test). Reaching the pile and flicking still work.
- **Quality levels** (`ChaosApp.setQuality`, `ChaosSystem.govern`): 0 on a monitor; 1 in a headset (shadow map every other frame, the player's own cards cast no shadow); 2 (no shadows, thinner mist and snow) if the headset keeps missing frames. The watch takes two steps, nine slow seconds each: first it asks a display running above 72 Hz for 72 (`XRSession.updateTargetFrameRate`; Quest 2 and 3 open WebXR at 90), and only if that is still slow does it drop to quality 2. Slow means under nine tenths of the rate the headset reports. It never steps back up in a session.
- **Do not list model URLs in `src/assets.ts`.** IWSDK preloads the whole manifest before the app starts; four unused penthouse models there cost every start 14.6 MB.
- **The card faces are the game's own design** (`src/game/cards.ts`): colour to the edge, a sunburst, a dark diamond medallion with cream serif values, an index tab, and a suit per colour (heart, sun, leaf, drop). The earlier faces resembled a commercial card game's; do not restore that look.
- **The Mixed reality button is off unless a build sets `VITE_MIXED_REALITY=1`** (`world-choice.ts`). The mode plays the same game over passthrough and reads nothing from the room; the judging criteria mark that down and ask for scene understanding and anchoring to real surfaces. The mode's code is untouched. Turn it on only once the real room changes the game and it has run on a headset.
- **Your hand and the deck are each their own pointer target** (`Tabletop.handGroup`, `Tabletop.drawHit`; entities made in `ChaosSystem.init`). Do not make the whole table group `RayInteractable` again: the SDK's gaze cone picks among targets by their bounding boxes, and with one box round the entire table, gaze stopped finding the player's cards part-way through a game on the glasses profile. Hand rays and the mouse were never affected.
- **One move at a time.** While a card of yours is on its way to the pile, or a Wild waits for its colour, picking another card does nothing (`Tabletop.tryPlay`). The table shows the turn the host has already moved past until its animations finish; a second card sent then only came back refused.
- **Players type their own name** (the Your hero screen opens `renderName` in `app.ts`): on-panel keys for a pinch, a gaze or a fingertip, and a desk keyboard types straight in (it also types table codes). Twelve characters. `cleanName` in `shared/names.ts` runs both in the browser and on the table host, strips markup and blocks a short list of words; keep both sides on it. Until a player types one, a stand-in from `NAMES` is shown.
- **Reactions, toys and the pause symbol are drawn in code** (`src/game/icons.ts`), as round picture tiles with captions (`iconTile`). Do not put emoji characters back on panels: each device draws them differently, and some control symbols come out as coloured stickers on a Quest. An open tray makes the action bar taller (`Panel.resize`), and wider only in the wide layout: beside the player it is a metre away, under the cards in the narrow layout it is 40 cm away.
