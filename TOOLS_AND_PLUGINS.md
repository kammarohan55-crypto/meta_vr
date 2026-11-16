# Tools and plugins for Claude on Windows

These are **Claude Code-compatible integrations**, not Codex plugin names. Start with the first two; install optional tools when their purpose is needed. The saved game does not require any paid AI account to run.

In PowerShell, use `npx.cmd` instead of `npx` if execution policy blocks `npx.ps1`; use `npm.cmd` for the equivalent npm issue.

## Recommended minimum

| Tool | Why it helps | Official/maintainer source |
|---|---|---|
| **IWSDK runtime and reference MCP** | Inspect the actual game, screenshots, scene state, headset input and SDK documentation. The repository already includes matching Claude skills. | [IWSDK AI setup](https://iwsdk.dev/ai/getting-started.html) |
| **Blender + MCP for Blender** | Create/edit furniture, physically based materials, lighting, rigs and animation, then export reusable GLBs. The MCP is a community project, not a Blender Foundation plugin. | [Blender](https://www.blender.org/download/), [maintainer repository](https://github.com/ahujasid/mcp-for-blender) |

From the repository, after `npm run setup`:

```powershell
npx @iwsdk/cli adapter sync --tools claude
npx @iwsdk/cli reference warmup
```

Restart Claude after adding integrations. Use the existing SDK-managed browser for immersive scene/input checks; a separate ordinary browser cannot establish headset correctness.

For Blender's community integration, the current upstream/package is **`mcp-for-blender`**; older `blender-mcp` instructions may be stale:

```powershell
winget install --id=astral-sh.uv -e
```

Open a new terminal so `uvx` is on PATH, then follow the maintainer's setup:

```powershell
uvx mcp-for-blender setup
```

Open Blender and enable/start the installed add-on as its instructions describe. For manual Claude Code registration:

```powershell
claude mcp add blender -- uvx --python 3.11 mcp-for-blender
```

If Claude cannot find `uvx`, use its full Windows executable path from `where.exe uvx`. Local Blender control can execute Python: save the scene before a large change and keep the add-on's socket on localhost. Optional cloud model-generation features have separate accounts/credits; they are not required for ordinary Blender control.

## Optional integrations

| Tool | Use it when | Setup |
|---|---|---|
| **Official Figma plugin** | Designing menu layouts, typography, spacing and components from a real design file. | `claude plugin install figma@claude-plugins-official`; restart and authenticate via `/plugin`. [Figma's official guide](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/). A Figma account is needed; limits depend on its plan. |
| **Microsoft Playwright MCP** | Checking ordinary browser menus, multi-browser flows and screenshots. Use IWSDK for immersive-specific proof. | `claude mcp add playwright -- npx -y @playwright/mcp@latest`. [Microsoft repository](https://github.com/microsoft/playwright-mcp). |
| **Official GitHub MCP** | Reviewing issues/PRs and repository context inside Claude. Plain Git or GitHub CLI is sufficient for commits/pushes. | Follow [GitHub's Claude installation guide](https://github.com/github/github-mcp-server/blob/main/docs/installation-guides/install-claude.md). Use its supported authentication; keep credentials out of committed configuration. |

## Art resources and image generation

- **Poly Haven** provides the source materials used here: [walnut veneer](https://polyhaven.com/a/walnut_veneer), [brown leather](https://polyhaven.com/a/brown_leather), [diagonal parquet](https://polyhaven.com/a/diagonal_parquet). Preserve provenance when importing new assets.
- The existing penthouse/marble art was generated in Codex and is already included. **Claude does not automatically have Codex's image-generation tool.** New AI images/models need a separately selected provider or integration, with that provider's account/credit and licence terms. No image API key is needed just to use the included images.
- **Python + Pillow + FFmpeg** are optional for the project's art optimization and recording-export helpers. FFmpeg is found on PATH or through `FFMPEG`; the Python export helper accepts `BLENDER_ASSET_PYTHON` for Pillow-capable Python.

A strong workflow is: design a clear visual target, author a good close-range asset in Blender, export a measured GLB, integrate it through the manifest, inspect the actual running scene, and profile it on a real Quest. More connected plugins alone do not improve the result. Avoid replacing functioning game logic with visual mockups.

Installation instructions above were checked against the linked primary/maintainer documentation for this handoff. Install only trusted integrations that you intend to use; do not paste access tokens into project files.
