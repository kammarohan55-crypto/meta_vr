# AFTERHOURS — verification and limitations

Updated for the Windows/Claude handoff on 2026-11-14. Distinguish automated checks, desktop/emulator evidence and physical-device testing.

## Checks passed locally

| Check | Evidence |
|---|---|
| Client and server TypeScript | `npm run typecheck` checks both tsconfigs. |
| Rules, bots, authoritative host and live multiplayer transport | 34 existing tests pass; server tests start real HTTP/WebSocket endpoints. |
| Hand/card geometry | 13 assertions in `npm run test:interaction`: corners/overlap, separate hands, stable contact, tracking loss, pose jumps, deliberate deck pull and discard bounds. |
| Production build | `npm run build` passes with the pinned SDK and lockfile. A large-bundle advisory remains; this is not a failed build. |
| Production launcher | Started on an ephemeral port; `/health`, built HTML and marble-table GLB returned successfully; GLB magic checked and process stopped cleanly. |
| Dependency/image tool patch | Sharp override updated to 0.35.5. Native PNG decode/resize/pixel smoke passed; `npm audit` reported 0 vulnerabilities at handoff. |
| Windows-safe helpers | Portable setup, diagnostics, launch, production and explicit test enumeration. Interaction test uses file URLs for drive-letter imports; FFmpeg is found through PATH/override. |
| Blender sources | Both large lounge sources reopened with every file image packed and no external image dependencies; geometry, UVs, transforms, lights/world and material node graphs preserved. Other five source scenes already had packed images. |

## Current desktop/emulator evidence

- The actual IWSDK-managed browser rendered the updated main menu, photographic penthouse, marble table, close 3D detail, visible faces and animated effects.
- Real mouse input entered Solo, dealt cards, selected a Wild Draw Four and chose its colour. Victory/defeat rendered through the game event paths. Rare effects were demonstrated using legal prepared scenarios, not an uninterrupted naturally played round.
- The neon controller decoration and headsets on faces were absent in the inspected scene.
- The main menu and player heads stayed within the frame at 1200×704, 900×720 and 720×820; a real Solo click worked at the narrow size. Menu art no longer uses cover/zoom cropping.
- The atmosphere shader time advanced while on the menu; reduced effects/flashing settings are connected.
- Each of the three actual character skeletons passed 720-frame finite-pose/card-attachment checks, including blink reset and no accumulated head/jaw rotation.
- Earlier browser-based Quest 3 emulation verified a card grip/move/release. This is emulator evidence, not physical hand tracking or headset performance.
- Actual screenshots are in `docs/previews/`. Local recording/QA outputs are excluded from the repository; the recording/export scripts are included.

## Windows CI

`.github/workflows/verify.yml` runs clean dependency installation, diagnostics, both typechecks, 34  rules/server tests, 13  hand assertions, build and the combined-launcher dry-run on **windows-latest** and **ubuntu-latest**.

The result of the latest run is visible in the repository's **Actions** tab. This file records the checks supplied by the handoff; consult that run for actual native Windows runner success. The software has not been interactively tested on the friend's physical Windows PC.

## Remaining limitations

- **Physical Quest hardware:** no current on-device frame-rate, thermal or comfort measurements. The latest visual pass was checked on a desktop Mac, not a headset.
- **Photographic far room:** the penthouse uses a background plane and has limited parallax. Close objects are3D; the entire room is not a navigable photoreal reconstruction. The old room exports remain as fallbacks.
- **Real inter-device voice:** signalling/implementation exist, but audio across two real headsets/networks needs testing. Strict NATs may need a TURN service.
- **Remote tracked bodies:** head/wrist pose transport and IK exist; two real headsets have not been validated together in the latest visual pass.
- **Mixed-reality passthrough:** session/hiding behaviour is implemented, but real passthrough needs headset testing.
- **Full multiplayer client replay:** server transport tests pass. Earlier development recorded two-browser lobby/play/reconnect/rematch checks; the current graphics handoff did not repeat a full two-client UI round after every visual edit.
- **Archive code:** `server/colyseus/` is an inactive alternative and is not compiled by the active server; it is not a second required backend.
- **Art editing tools:** Blender/Python/FFmpeg and optional MCP services have their own Windows installations. Saved runtime assets do not require those tools or API keys.

There is no measured “percentage complete,” guarantee of winning, AAA graphics claim or claimed physical Windows/Quest validation beyond the evidence above.

## Frostpeak update (2026-11-14, Windows)

The default world is now **Frostpeak**, a stylized alpine setting requested by the team (painterly snowy mountains, lake, timber bridge, snowfall), with stylized seated heroes in place of the photo-scanned people. The penthouse lounge and scanned people remain available: Preferences → World (reloads).

| Check | Evidence |
|---|---|
| Rules, server, hand mechanics, build | `npm run check`: 34/34 tests, 13 interaction assertions, production build, on Windows 11 / Node 24.11. |
| Menu input | Real clicks in the IWSDK-managed browser: Play solo → Deal the cards → game. |
| Menu texture fix | Leaving the wide title screen used to keep the old GPU texture size, so menus drew shrunken over stale title art and clicks missed (Deal could not be pressed). Fixed in `Panel.setCinematicTitle`. |
| Heroes | Knight, Mage and Rogue seated with fans in hand, head look, reactions; no console errors. |
| Render budget, in game (scene walk, `scripts/dev/render-budget.mjs`) | Frostpeak: 134 draw items, ~72k triangles, 3 lights. Lounge for comparison: 128 draw items, ~200k triangles, 6 lights. |
| Download | Frostpeak models ~1.6 MB (heroes 1.0 MB + clips 0.36 MB + title art 0.2 MB) vs ~30 MB of lounge GLBs, which are no longer loaded by default. |

Not yet verified: frame rate and comfort on a physical Quest 3, hero poses with real tracked hands, and a fresh two-client multiplayer round in Frostpeak. Screenshots (retaken 2026-11-17 with the current cards and action bar): `docs/previews/menu.jpg`, `docs/previews/gameplay.jpg`.

### Game feel pass (2026-11-14)

- Idle heroes sit at the table on the title and setup screens (cards down, no nameplates); dealing a solo game keeps the same heroes in their chairs.
- A played card landing on the pile throws a snow puff and a ring in its colour, plays the place sound and flares the rune ring (reduced-effects settings shrink it and skip the flare).
- Verified with real clicks in the managed browser: title (heroes seated) → Play solo → Deal → game, hero nameplates (Sir Bram, Mira the Mage, Wren), no console errors. The landing effect was triggered directly for inspection (`scripts/dev/landing-fx.mjs`); a screenshot could not catch the moment reliably, so its on-device look still needs a headset check.

### Readable plays, sound, emotes and a living backdrop (2026-11-14)

- **Who played what:** an opponent's card now rises from their seat, turns to face you at 2.2× size for 0.8 s, then drops onto the pile. A caption in the card's colour on a dark plate names it ("Wren · Yellow 5"). Verified in real bot play (`scripts/dev/reveal-wait.mjs`, which lengthens the hold so a screenshot can catch it). That check also exposed and fixed a stale-caption bug: one-key holograms in `vfx.ts` kept their first text, and now redraw when it changes.
- **Sound:** recorded card place/slide/fan/shuffle/knock and UI sounds from Kenney (CC0), with random variation and synthesised fallbacks. Frostpeak gets a generated wind/lantern/chord soundscape. All 23 files decode in the running game (no 404s).
- **Emotes:** five selectable heroes. Reactions use distinct moves (cheer, spellcast for `cool`, hit reactions, procedural clap/point/facepalm), plus an icon badge that pops above the head. Emotes travel over the existing network message, so other players see the movement on your hero. Seen in natural solo play (😂 / 😖 badges); not yet verified between two real clients.
- **Background:** pines sway in a shader wind, cloud banks drift along the mountain flanks and a flock of gull silhouettes wheels over the valley. Reduced motion slows all of it. Screenshot: `docs/previews/gameplay.jpg`.

### Arenas, stacking, toys, card magic and music (2026-11-14)

- **Three new worlds** beside Frostpeak and the penthouse: Wisteria Shrine, Midnight Domain and Celestial Arena (procedural, cel-shaded, animated petals/rain/motes, waterfalls, a turning sky circle, golden lightning). Preferences or the title's *Arenas* button opens the picker; hero worlds switch in place (no reload, so a VR session carries on). Render walk, title view: 89–111 draw items, 3 lights, ≤ ~110k triangles.
- **Stack +2/+4** house rule (rules engine + table host + bots): answer a Draw Two with a Draw Two or anything with a Draw Four; whoever can't takes the whole stack and loses the turn. On by default in solo, a lobby toggle online. 5 new rules tests (39 total), including 60 full AI games with every card accounted for.
- **1v1 fix:** your own fan now stays under your line of sight to the pile and deck (it follows the head slowly), so a low seated head no longer loses the table behind its cards.
- **Event pacing fix:** the event timer used to run hundreds of seconds negative while idle, so a play, a Draw Four, its draws and the skip could all fire in one frame. It now rests at zero, so moments play in sequence.
- **Toys at anyone, any time:** a *Toys* button on the action bar (dart, rubber chicken, snowball, cream pie, squeaky hammer, confetti), then tap who. After someone hits you with a Draw card or a skip, the toy tray opens aimed at them for a few seconds. Computer players sometimes throw back. Server: toy and emote kinds validated, rate-limited (0.9 s / 0.4 s), opt-out respected. Verified with real clicks (`scripts/dev/toy-probe.mjs` records the launch).
- **Card magic:** summoning circles and light pillars for Draw Two/Four (+ the live "+N STACK" counter and circle), Skip seal, Reverse vortex, Wild colour pillar, "LAST CARD!" crown circle, and a golden win. Captured with `scripts/dev/magic-preview.mjs` (slow motion, injected events: shows the look, not interaction proof).
- **Music:** a looping track per world (Kevin MacLeod, CC BY 4.0), streamed and crossfaded on world change; verified playing after the first click and switching tracks.
- **Smoothness:** in a real 4-player game the desktop view holds 60 fps (16.7 ms avg, p95 17 ms) on the Intel Arc 140V. The title's idle shimmer was repainting a 1680×945 canvas 30×/s (32 fps); it now repaints 12×/s on desktop (51 fps) and not at all in VR.
- An anime edition (VRM characters, painted skies) was prototyped and removed at the team's request; a backup is kept outside the repo.

Not verified here: Quest frame rate and comfort, two-client online play with toys and stacking, voice.

### Sound, deal and smoothness pass (2026-11-15)

- **Harsh click fixed:** one of the two menu clicks (`click_004`) had 70% of its energy above 4 kHz in 20 ms. Menus now use soft Kenney drops (press), a lower drop (back), a rising confirm (start, ready, rematch, arena) and plucks (settings toggles). Card hover is a quiet paper touch (was an 1800 Hz beep), the turn clock ticks with a wooden tock, an illegal move is a low bong.
- **Professional stingers:** recorded pizzicato and steel-drum jingles (Kenney Music Jingles, CC0) for your turn, skip, +2, wild, last card, taking a stack, win and lose, layered with sounds designed in `src/game/sound-design.ts` and rendered offline at load: the +4 riser and boom (the music ducks for it), sparkles, a G-major victory bloom after the win jingle, a reversed-bell swell for Reverse, a heartbeat for the last card, claps and toy sounds. Mix: fx/music/voice buses, a duck stage for big moments, glue compressor and limiter; sliders are squared and glide.
- **Audio ready before play:** the AudioContext is made while the world loads; all 26 recorded sets decode and the 12 designed sounds render before the first click (`scripts/dev/audio-probe.mjs`). Table sounds share pooled HRTF panners instead of one per sound.
- **The deal:** a new round now riffles the deck (1.25 s, was a 3 s shuffle that played after the cards were already there), then deals one card at a time round the table to every seat, each with its own flick, and the first move waits for it (2.3 s for four players). Verified with real clicks (`scripts/dev/deal-probe.mjs`, `scripts/dev/sound-spy.mjs`) and a slow-motion capture.
- **World-switch freeze fixed:** a switch froze the picture for 250–300 ms (1.1 s for a world not yet seen). Causes found with per-step and per-WebGL-call timing (`scripts/dev/swap-probe.mjs`, `scripts/dev/gl-probe.mjs`): (1) disposing the old world also freed resources every world shares (card geometry/material/atlas, toon ramp, matcaps, magic circles), so they were rebuilt in one frame; they are now marked shared and kept; (2) the new world's shaders compiled on first draw; they now compile in the background (`src/game/warmup.ts`, KHR_parallel_shader_compile) after the world has attached its fog, under a short fade to dark. Result in a running game: the fade out and in hold 60 fps; the remaining 50–120 ms of work happens while the screen is fully dark. Music crossfades immediately.
- **First-use hitches:** at load, every material (hidden effects and pre-built toys included) is compiled in the background and textures upload a couple per frame, so the first +4, toy or circle doesn't compile mid-game.
- `npm run check`: 39/39 tests, 13 interaction assertions, build. Console clean on load, in a game and across a switch (apart from the browser's expected `ERR_ABORTED` when a music download is replaced).

Not verified here: listening tests on headphones and Quest speakers (the mix was checked by measurement: spectra, peak and loudness of every designed sound), Quest frame rate during a switch, cold-cache shader times on Quest.

### Menus, online play without a server (2026-11-15)

- **Avatar screen fixed:** the menu used to slide 0.46 m left and turn toward your head, which pushed half of it off a monitor. It is now a narrow card (0.52 × 0.62 m) about 27° to your left, so the card and the hero it describes across the table are both fully in view; hero rows show a one-line description and position dots, and the hero gives a small cheer when chosen. On a monitor, menus now stay square to the screen (a wide desktop lens skewed any panel off to one side); in a headset they still turn toward your head.
- **Action bar:** the "throw something back" offer no longer replaces the whole bar for 6 s (it hid Draw / Take +N and Pause); the Toys button lights up as **Get even!** instead, and any open tray closes when your turn starts.
- **Hints and names:** desktop hints say click instead of pinch; the lobby and results use the same names as the table (heroes, not the old penthouse cast); the results columns no longer overlap ("3 cards left" ran into "wins 0"). The floating title cards were nudged clear of the title.
- **Online play without a server:** "Play with friends" used to fail with *Could not reach the game server* unless the separate backend was running (`npm run dev` doesn't start it). It now checks for a server (`/chaos/health`) and, without one, hosts the table in the player's browser: friends join with the same code and connect directly over WebRTC, matched through public Nostr relays (Trystero 0.27, MIT; six relays pinned after a reachability test, `VITE_NOSTR_RELAYS` overrides). Rooms share one implementation with the server (`shared/room.ts`); the direct code loads only when used (163 KB chunk). A Cancel button covers the up-to-20 s search; a code with no host says so plainly; when a direct host leaves, guests are told the table closed.
- **Verified with two real browser players** (`scripts/dev/p2p-test.mjs`, a second tab in the managed browser): direct mode (no server) and server mode (`node server/main.ts`) both pass host → join (direct: 2–5 s, server: ~1 s) → ready → start → 7 cards each with hidden hands → a move seen by the other player → a toy across the table → host leaves. `npm run check`: 39/39 tests (including the server's two-player games, now on the shared room), 13 interaction assertions, build.

Not verified here: direct play between two different networks or on a Quest (both tabs ran on one PC, so WebRTC used local addresses; strict NATs may need a TURN relay), voice chat in direct mode, the Quest framing of the new avatar card.

### Smoother frames, Quick match and a free always-on server (2026-11-15)

- **Performance, measured first** (`scripts/dev/perf-probe.mjs`, `cpu-profile.mjs`, `scene-stats.mjs`; four-player game, Intel Arc 140V laptop): per frame, draw calls 250 → 141, game logic 2.56 → 1.4 ms, renderer CPU 5.78 → 3.5 ms (about 40% less CPU per frame overall). Fixes, each found in the profile: (1) the hero rigs read world transforms through three's getWorld*/localToWorld (each re-walks every parent to the root, ~30 calls per hero per frame) and refreshed their subtree twice; they now read the fresh matrices directly; (2) a second full matrix pass over the table each frame is now a root-only update; (3) heroes were six skinned pieces on six skeletons each (6 draws, 6 bone textures uploaded per frame); body, arms and legs are now one mesh and the head shares the one skeleton; (4) shared materials made three switch shader programs on nearly every draw (skinned vs plain hero props; one depth material re-fitted to every shadow caster; transparent double-sided panels drawn in two passes); (5) invisible click planes, hidden pile cards and shadow casters nobody can see (legs under the table, opponents' held cards, a dozen mascot primitives) no longer cost draws; (6) the title canvas's idle shimmer re-uploaded 1680×945 pixels 12× a second (title 50 fps, p95 33 ms → 60 fps, p95 17 ms).
- **Quick match:** a fourth title card. Strangers are seated at a public table that deals when its 20 s countdown ends (computer players fill empty seats), at four people, or when everyone presses Ready; tables that have started are never offered. Server tests: 41/41 (two new).
- **Free always-on server:** `cloud/worker.ts` + `wrangler.jsonc` deploy the game and online play to Cloudflare Workers + Durable Objects (free plan): static game files, one Durable Object per table running `shared/room.ts`, a Matchmaker object for Quick match. Verified locally on the real Workers runtime (`npm run cloud:dev`): `scripts/cloud-smoke.mjs` passes all checks against it and against the Node server, and two browser players did Quick match through the menus (same table, both ready, dealt with two computers, separate hands).
- **Lighter VR presence:** poses at 12 Hz instead of 20 and only when something moved (1 s keep-alive); remote hero hands ease toward each pose.

Not verified here: the deployment itself (it needs your Cloudflare login: `npx wrangler login`, then `npm run deploy`), frame rate on a Quest (the CPU savings are measured on this laptop), and VR presence between two headsets.

### Deployed (2026-11-15)

- **Live at <https://afterhours.chaos-table.workers.dev>** on Cloudflare's free plan (Workers + Durable Objects + static assets; 116 files). `scripts/cloud-smoke.mjs` against the live address: all checks pass (health, private table with a friend, deal, move, Quick match pairing, public table dealing with computers, refused codes). Two browser players did Quick match through the menus on the live site (same table, dealt with two computers, separate hands); a real click on the title's Quick match and on "Ready: start now" worked in a third browser, and "Leave room" at a live public table returns to the title with no game afterwards (`scripts/dev/live-leave-test.mjs`).
- Fixed on the way: the lobby's microphone button now says "No mic" when microphone access was declined (it said "Mic on").
- Redeploy after changes: `npm run deploy` (only changed files upload). The Wrangler login is stored on the PC that ran `npx wrangler login`.

Not verified here: play from a Quest on the live address, and two players on different networks (both of these tests ran from one PC, though over the internet to Cloudflare).

### Competition readiness pass (2026-11-16)

Checked against the Meta VR Start Developer Competition 2026 rules, in the IWSDK emulator (Quest 3 and Meta VR Glasses profiles). No headset was available: nothing below is a device measurement.

| Rule or criterion | Result |
|---|---|
| Hands-first, end to end | Done with emulated hands only, no controller: title → Play solo → Deal → play a card (point and pinch, and a direct pinch pushed forward) → Wild colour → draw from the deck → pass and pause on the action bar. |
| Meta VR Glasses: gaze and pinch | `gaze-tracking` granted; menus, cards, deck and colours picked by gaze and a pinch; a looked-at card or deck rises (no cursor on the glasses); with gaze disconnected the hand ray takes over. |
| FoV-aware design | With the glasses' view (74° × 68°) the title spans ±30.5° by ±18°; while looking at the cards, the opponents, hint, piles, own cards and action bar are all in view. Screenshots: `docs/previews/glasses-title.jpg`, `glasses-table.jpg`. |
| Seated, two-foot reach | The table now sits 40 cm below the player's eyes whatever their seat height (it was fixed to the floor: at standing height the cards were 63° below the view). A card pushed 11 cm forward plays. |
| Holds up in rooms never tested | **Bug fixed:** for a player away from the tracking origin or turned from its forward axis, menus, captions, name plates and the colour picker faced the wrong way (the title showed mirrored from behind at 1.4 m off-origin, turned 70°). Verified facing the player after the fix. |
| Fast cold start | The title needed 15.1 MB and 7.8 s (measured on the live site, cache off); the build now needs 0.8–1.0 MB before the title (1.6 s from a local server). Causes: four unused penthouse models preloaded by the asset manifest, a 5.8 MB lighting map (now a 0.5 MB exact downsample, `scripts/shrink-hdr.py`), an unused 0.6 MB menu image. |
| Clean pause and resume | Solo games already paused when the headset came off; the whole mix and the music now stop too and resume on return. |
| Frame rate on Quest (min 60 fps) | Draw calls in a four-player game 144 → 96 (opponents' hands instanced, deck stack one draw, mascot 21 → 7, chairs merged); CPU per frame on this laptop 3.76 → 2.4 ms. In a headset the shadow map is redrawn every other frame, and a frame-rate watch drops shadows and thins the weather if the rate stays under 57 fps (it held quality at a steady 60 fps and stepped down under a 6× CPU slowdown). |
| Original work, no third-party look | Card faces redrawn in the game's own style (see `docs/previews/afterhours-deck.jpg`). No brand names or controller-only wording in the game text. |
| No identifiable people | The Penthouse (Renderpeople scans) is off and its files are left out of the build. |

`npm run check`: 41/41 tests, 17 interaction assertions (4 new, for the forward push), build.

**Still to do by the team, outside the code:** confirm Meta VR Start membership for whoever submits; choose the division (the repository's first commit is 2026-11-14, but only the team knows whether work began before 24 September 2026); record a video under three minutes of real gameplay; fill in the Devpost form; test on a real Quest, and on the glasses if one is available. The title's Mixed reality button is now left out of normal builds (see the pre-submission pass below).

### Pre-submission test pass (2026-11-16, evening)

A full play-through by script in the IWSDK emulator, with no state injected for input: every move was an emulated hand ray and pinch (Quest 3 profile), or a gaze and pinch (Meta VR Glasses profile, seated 1.4 m off the tracking origin and turned 70 degrees). No headset was available.

| What was run | Result |
|---|---|
| Quest 3 profile, hands only | Title, Play solo, Deal, 10 moves in a row (cards and deck) without a miss; game to the results screen; Rematch; Pause; Preferences; Arenas menu. |
| Glasses profile, gaze and pinch | Two games, 7 and 21 moves (cards, deck, Wild Draw Four and colour, Draw Two, Skip) without a miss; Rematch by gaze with a left-hand pinch; with gaze disconnected a hand ray hovered and played a card. |
| Glasses view while looking between your cards and the pile | Cards, pile, deck and action bar all inside 37 degrees left and right, 25 up, 43 down (`scripts/dev/glasses-fit.mjs`). Opponents' faces sit 30 degrees up: a glance away, by design. |
| Every world, switched in a headset session | Eight switches, no console warnings, no broken geometry. |
| Desktop | Solo game started and a card played with real mouse clicks. |
| Two players online | Quick match on the built site served by a local Cloudflare worker: same table, both dealt, hands differ (`scripts/dev/cloud-browser-test.mjs`). |
| Frame-rate ladder | Steady 56 to 60 fps kept full headset quality; under a six-fold CPU slowdown it asked for 72 Hz, then dropped to quality 2. |

Bugs this pass found, all fixed:

- **Glasses: gaze stopped picking your cards after a few turns.** The whole table was one pointer target; the SDK's gaze cone misjudged a target that large at card distance. Your hand and the deck are now targets of their own. Before: a game failed at its seventh move. After: 28 gaze moves over two games, none missed.
- **Wisteria Shrine: the temple roofs' eaves were never drawn** (a rounding error made the outer row of each roof invalid, with a console error on every visit). Fixed in `templeRoof`.
- **A world switched in a headset could lose one frame of the table, cards and heroes** (a new light drawn before its shadow map existed; 12 WebGL errors). The shadow map is now refreshed every frame while a world is being swapped in.
- **A second card picked while the first was still flying came back refused**, with a confusing hint. Now one move at a time.
- **The frame-rate watch could wait for ever** if sound loading never finished on a device; it now gives up waiting after 30 seconds.

Also changed: a headset running above 72 Hz is asked for 72 Hz before any shadows are dropped; the Mixed reality button is off by default (`VITE_MIXED_REALITY=1` brings it back); two hints no longer say "tap" or "press".

`npm run check`: 41/41 tests, 17 interaction assertions, build.

### Names and trays (2026-11-16, late)

- **Type your own name.** Checked on desktop (real key presses and clicks on the keys) and in the emulator on the Quest 3 profile (a hand ray pinching the keys from the pause menu, mid-game): the name was saved, shown on the Your hero screen and sent as the player's profile. Three new tests cover the name rule (44 tests in all).
- **React and Toys trays redrawn** as picture tiles in the game's own style, replacing emoji. Checked with real clicks on desktop and hand-ray pinches in the emulator: a reaction sent, a toy picked, a player picked, the toy thrown; no console errors. With the narrow (glasses) layout held on, the open tray measured inside the glasses' view and clear of the cards.
- Not re-run: gaze and pinch on the new tray tiles and name keys on the Meta VR Glasses profile (they are ordinary buttons on the same panels gaze already drives), and a second online player seeing a typed name.

`npm run check`: 44/44 tests, 17 interaction assertions, build.

### Deployed (2026-11-17)

This build is live at <https://afterhours.chaos-table.workers.dev> (Cloudflare version `9e7b496d-5572-45ed-b585-68010255aeb5`), published from the working tree before it was committed. Checked against the live address:

- `node scripts/cloud-smoke.mjs`: all passed (private table, deal, a draw seen by the other player, Quick match, unknown codes refused).
- Two browser players through Quick match (`scripts/dev/cloud-browser-test.mjs`): same table, both dealt, hands differ.
- Cold start with the cache off (`scripts/dev/cold-start.mjs`): title up in 1.9 s after 0.86 MB in 5 files (the previous build: 7.8 s and 15.1 MB); 5.4 MB in all once music, heroes and sounds are in.
- The Penthouse files and the large lighting map answer 404; the title offers Enter VR and no Mixed reality.

Still not done: a run on a real Quest from this address.

