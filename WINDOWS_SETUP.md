# Windows setup and continuation with Claude

Use **native Windows PowerShell** (or VS Code's terminal). WSL is not required for this workflow; keeping Blender and the game tools on the same Windows installation makes the local connections simpler.

## 1. Install the basics

- [Git for Windows](https://gitforwindows.org/), including Git LFS. If `git lfs version` is unavailable, install [Git LFS](https://git-lfs.com/).
- [Node.js](https://nodejs.org/en/download): the project's tested baseline is **22.23.2**, pinned in `.nvmrc`. Node 22 must be at least 22.18; the package also supports Node 24 or newer. Use an official Windows installer; avoid Node 20 for this project's server.
- [VS Code](https://code.visualstudio.com/) is convenient but optional.
- [Claude Code](https://code.claude.com/docs/en/setup), using the official Windows installer or:

```powershell
winget install Anthropic.ClaudeCode
```

Open a new terminal after installations, then check:

```powershell
git --version
git lfs version
node --version
npm --version
claude --version
```

If PowerShell blocks `npm.ps1` or `npx.ps1`, use **`npm.cmd`** in place of `npm` and **`npx.cmd`** in place of `npx` below. A global execution-policy change is not needed.

## 2. Clone the complete project

```powershell
git lfs install
git clone https://github.com/Siddhanthkjain2005/VR.git
cd VR
git lfs pull
npm run setup
```

`setup` installs exactly the lockfile dependencies, checks required assets and runs the TypeScript checks. No Mac paths, paid accounts or Blender installation are required to run the saved game.

Runtime `.glb` models and textures are ordinary Git files. Large editable `.blend` sources use Git LFS. Clone with Git rather than downloading GitHub's ZIP if you want to edit the Blender scenes. If only playing/coding, the runtime exports remain usable even without downloading the Blender source objects.

## 3. Connect Claude to this project

From the **VR repository root**, generate this PC's local IWSDK tool configuration:

```powershell
npx @iwsdk/cli adapter sync --tools claude
npx @iwsdk/cli reference warmup
claude doctor
```

The reference warmup can take time and download documentation/model data; the game itself does not depend on it. Restart Claude after configuring MCP. Generated `.mcp.json` paths are local to this PC and intentionally ignored by Git. The checked-in `.claude/skills/`, `CLAUDE.md` and `HANDOFF.md` supply the project guidance/context.

Open the repository in VS Code with Claude's official extension, or start `claude` in another terminal in this folder. Ask Claude to read `HANDOFF.md`, `STATUS.md` and the applicable IWSDK guidance before changing the existing game. [Official IWSDK Claude setup](https://iwsdk.dev/ai/getting-started.html), [Claude in VS Code](https://code.claude.com/docs/en/vs-code).

## 4. Run the game

In a project terminal:

```powershell
npm run dev:all
```

Keep this terminal open. It starts/reuses a healthy multiplayer backend on **2567**, then opens the SDK-managed HTTPS preview, normally **https://localhost:8081/**. Ctrl+C stops the launcher and the backend it started; an already-running backend is preserved. The SDK preview is also stopped during cleanup.

- Solo play runs locally against bots.
- To play together during development, one player hosts (**Play with friends**) and the others join with the room code. With the backend running, rooms go through it; with `npm run dev` alone, the host's browser runs the table and friends connect to it directly (see README, *Online play*).
- Everyone needs to open the same game: on one Wi-Fi, the network HTTPS URL below; across the Internet, a public HTTPS copy of the game. The simplest is the free Cloudflare deployment (`npx wrangler login`, then `npm run deploy`; see README, *Free, always-on server*), which also gives Quick match with anyone online.
- On the same Wi-Fi, use the network HTTPS URL printed by IWSDK. Allow Node on the **private network** if Windows Firewall asks. The local development certificate may need acceptance on a separate browser/headset.
- For friends on different networks, use an HTTPS deployment with a reachable WebSocket backend. Do not assume localhost or your private LAN address works remotely.

You can run the pieces in two terminals instead:

```powershell
npm run server
```

```powershell
npm run dev
```

Do not start a competing raw Vite process. Use `npm run dev:status` and `npm run dev:down` to inspect/stop the managed preview.

## 5. Check and save changes

```powershell
npm run check
git status
git add .
git commit -m "Describe the change"
git push
```

GitHub runs checks on Windows and Ubuntu after pushes and pull requests. `npm run check` includes diagnostics, both TypeScript projects, rules/server tests, hand-interaction assertions and production build. These are software checks, not proof of physical headset performance.

Use your own GitHub account. The repository is public for cloning, but pushing to it requires write access from the owner. If your account has no write access, use your own fork and open a pull request; do not copy someone else's saved credentials.

For a local production smoke test:

```powershell
npm run build
npm start
```

This serves the built client and backend at **http://localhost:8080/** without shell-specific environment syntax. A real headset deployment needs HTTPS. Optional PowerShell port override:

```powershell
$env:PORT = "8088"
npm start
```

## 6. Optional art and preview tools

Read **[TOOLS_AND_PLUGINS.md](TOOLS_AND_PLUGINS.md)**. Blender is only needed to edit/regenerate authored scenes. Some source files were saved with Blender 5.3; use that version or a newer compatible release when opening them. All external images in the two large lounge sources were packed for handoff. Generated table/backdrop assets and their source images are included.

Blender scripts derive the project folder from their own location. For scripts which optimize exported textures, install ordinary Python with Pillow, and put `python`/`python3` on PATH or set `BLENDER_ASSET_PYTHON` to that Python executable. Run Blender from its Windows executable path; for example, substituting your actual installed version:

```powershell
& "C:\Program Files\Blender Foundation\Blender 5.3\blender.exe" --background --python blender/build_premium_marble_table.py
```

Python plus Pillow and FFmpeg are optional for recording export. `scripts/encode-preview.py` now locates `ffmpeg` on PATH or uses the `FFMPEG` environment variable. `scripts/record-preview.mjs` uses the existing SDK-managed browser; automation requires an explicit SDK dev-session opt-in and is not necessary for normal play.

## Troubleshooting

| Symptom | What to check |
|---|---|
| Node complains about `.ts` files | Check `node --version`; use the supported version above, then rerun setup. |
| `npm.ps1` cannot run | Use `npm.cmd run setup` / `npm.cmd run dev:all`. |
| A `.blend` file contains a short text pointer | Run `git lfs install` then `git lfs pull`. |
| Missing models | Run `npm run doctor`; check that the complete repository was cloned. |
| Claude tools contain someone else's path | Regenerate adapters on this PC and restart Claude. |
| Preview unavailable | Read the launcher output; check `npm run dev:status` and port 8081 conflicts. |
| Online rooms fail | With a backend: keep it running and check `/chaos/health`. Without one: the host must keep the game open, and both players need Internet access to the public relays; on strict networks configure a TURN relay (`VITE_TURN_*`). |
| Voice fails across networks | Test mic permissions and WebRTC connectivity; a configured TURN service may be needed. |
| Blender material missing | Fetch LFS sources first; use the included packed sources and textures, not old local backups. |
