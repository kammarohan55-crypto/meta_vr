# Start here: taking AFTERHOURS to submission

For the teammate who submits from a Mac, and for their coding agent. Written 17 November 2026 by Rohan's session; everything below is true of the commit this file arrived in.

**Deadline: 18 November 2026, 12:00 PT (19 November, 01:30 IST).** Nothing can change after it, and the link must stay up through judging. Competition: Meta VR Start Developer Competition 2026, <https://start-developer-competition-26.devpost.com/>.

## Where things stand

- **The game is finished for submission and is live:** <https://afterhours.chaos-table.workers.dev>. That address serves exactly this commit. It runs on Rohan's Cloudflare account (free plan).
- **`npm run check` passes:** 44 tests, 17 hand-interaction checks, typecheck, build.
- **Checked in the IWSDK emulator** (not on a headset): a full game with hands only on the Quest 3 profile; two full games by gaze and pinch on the Meta VR Glasses profile; every world; two players online; pause and resume; a typed name; the reaction and toy trays.
- **Checked on the live address:** server smoke test, a two-player Quick match in two browsers, and a cold start (title up in 1.9 s after 0.86 MB).
- **Never run on a real Quest or real glasses.** This is the one large unknown.

`STATUS.md` holds the evidence for each of these (read its last four sections). `HANDOFF.md` holds the design and the rules that must stay true.

## What is left, in order

1. **Open the live link on a real Quest** (Quest Browser, then Enter VR). Play one solo round with hands only, no controllers: pinch a card and push it forward, point and pinch, draw from the deck, open React and Toys, pause and resume, take the headset off and put it back on. Write down anything that fails. If you can attach Chrome remote debugging, `chaos.fpsLog` in the console lists the frame rate every three seconds, `chaos.quality` is 1 normally and 2 if the game had to drop shadows, and `chaos.displayRate` is 72 if it asked the headset for a lower rate. The rules want 60 fps or better.
2. **Record the video**, under 3 minutes, real gameplay. The rules allow footage from a headset or from an emulator. Shot list: `docs/SUBMISSION.md`.
3. **Fill in the Devpost form.** Draft answers are in `docs/SUBMISSION.md`; rewrite the inspiration paragraph in your own words and fill in the bracketed facts (team, division, dates).
4. **Confirm whoever submits is a Meta VR Start member**, and choose the division (New Experience needs work begun on or after 24 September 2026).
5. **Submit**, then open the submitted link once more in a private window.

Do not add features before the deadline. Fix only what the Quest test finds.

## Run it on a Mac

Needs Git, Git LFS and Node.js 22.18 or later in the 22 line, or 24 or later (`node -v`). With Homebrew: `brew install git-lfs node`.

```bash
git lfs install
git clone https://github.com/kammarohan55-crypto/meta_vr.git
cd meta_vr
git lfs pull
npm run setup
npm run dev:all
```

`setup` installs the locked dependencies and checks the project. `dev:all` starts the multiplayer server and the game preview at <https://localhost:8081/> (accept the local certificate warning). `npm run check` runs everything that must pass before you call a change done. The two large `.blend` files (270 MB, Git LFS) are editable art sources; the game does not need Blender.

`WINDOWS_SETUP.md` and `TOOLS_AND_PLUGINS.md` were written for the Windows PC; the npm commands are the same on a Mac.

## The live link, and changing it

You can submit the link above as it is: no deploy is needed.

If the Quest test forces a code change, the fix has to reach a public address:

- **Simplest:** push the fix to this repository and ask Rohan to run `npm run deploy` on his PC. The address stays the same.
- **Or deploy to your own Cloudflare account (free):** `npx wrangler login`, then `npm run deploy`. Your address will be `https://afterhours.<your-subdomain>.workers.dev`, which is a different link: put that one in the form, and check it with `node scripts/cloud-smoke.mjs <address>`.
- A static host (GitHub Pages, Vercel) can serve the built `dist/` folder, but then Quick match stops working: it needs the Cloudflare Worker. Solo play and private tables still work there.

## For a coding agent

Read in this order: this file; `HANDOFF.md` (architecture, and the section "Competition build" for what must not be undone); `STATUS.md` (what was and was not verified); `AGENTS.md` (the IWSDK rules for this project); `docs/SUBMISSION.md`. Claude Code loads `CLAUDE.md`, which imports the first, second and fourth. Project skills are in `.claude/skills/` and `.agents/skills/`.

Things that look like improvements and are not:

- **Do not turn the Penthouse back on** (`VITE_PENTHOUSE`). It shows 3D scans of real people, which the competition rules forbid.
- **Do not turn the Mixed reality button back on** (`VITE_MIXED_REALITY`). It plays the same game over passthrough, which the judging marks down.
- **Do not restore the old card faces** or put emoji on panels. The cards and the reaction and toy icons are drawn in code so that they are the game's own art and look the same on every device.
- **Do not make the whole table one `RayInteractable`.** The player's hand and the deck are separate pointer targets; one big target made gaze lose the cards.
- **Do not pass a table-space point to `lookAt`.** Use `faceTablePoint` / `tableToWorld` in `src/game/util.ts`.
- **Do not list model URLs in `src/assets.ts`** (everything there is downloaded before the title) and do not import from `three` directly (use `@iwsdk/core`).
- **Do not start a raw Vite server.** Use `npm run dev` or `npx @iwsdk/cli dev up`.

Before claiming something works: run `npm run check`, then try it in the emulator with real input (`npx @iwsdk/cli xr ...`; `scripts/dev/` has helpers: `xr-targets.mjs` lists where each button is, `panel-shot.mjs` saves a flat picture of a menu, and `python scripts/dev/hands-game.py 20` plays a solo game by emulated pinch once a session is in VR, or by gaze with `20 gaze`). Say plainly what you could not check without a headset.

## Known gaps

- No run on a real Quest or real Meta VR Glasses: frame rate, hand-tracking feel and audio after resume are unproven on hardware.
- Gaze and pinch on the new tray tiles and name keys were not re-run on the glasses profile (they are ordinary buttons on panels that gaze already drives).
- Voice chat between two real devices was never tested.
- The core rules are a familiar shedding card game; originality is a quarter of the score, and no code change fixes that before the deadline. The submission text should lead with what is the game's own: hands-only play from any seat, gaze play, five-minute rounds with friends.
