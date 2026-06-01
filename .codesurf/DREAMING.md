# CodeSurf Workspace Memory — ships (Element-115)

*Generated: 2026-05-31*

---

## Overview

Primary workspace at `/Users/jkneen/Downloads/ships` contains **Element-115**, a browser-based 3D arcade flight simulator built with Three.js. The entire game client is a single self-contained HTML file (`flight-sim3.html`). Optional Bun/Node backends handle live tweaks and WebSocket multiplayer. Netlify-ready build pipeline.

---

## Durable Facts

### Project Identity

- Canonical name: **Element-115** (rebranded 2026-05-23, commit `d9d2d09`)
- Package: `element-115-flight-sim` v0.1.0
- Main game file: `flight-sim3.html` — self-contained, no framework dependency; Three.js r128
- Runtime / package manager: **bun** (≥ 1.1.0)
- Deploy target: **Netlify** via `netlify.toml`; build output → `dist/`
- License: MIT

### Key File Map

- `flight-sim3.html` — entire game client; dirty (uncommitted distance-culling pass)
- `flight-sim3.html.bak` — backup of pre-dirty state
- `tweaks-server.mjs` — live plane-tweaks HTTP backend on `:8765`
- `multiplayer-server.mjs` — WebSocket room / race server on `:3000`
- `autopilot.mjs` — autopilot tooling
- `self-evolve.mjs` — experimental evolution tooling
- `world-designer.mjs` — world design tooling
- `HERMES_HANDOFF_RETICLE_TARGETING.md` — cross-session handoff for reticle/targeting work
- `progress.md` — running improvement log since 2026-04-25
- `plane-tweaks.json` — active tuning state
- `world-state.json` — world state persistence
- `feature-requests.json`, `latest-features.json` — feature tracking
- `models/` — GLB plane meshes including `stunt_plane.glb`
- `.mcp.json` — contex MCP config; port changed to `60768` (dirty, uncommitted)

### npm Scripts

- `bun run start` — tweaks-server + multiplayer-server concurrently
- `bun run build` — builds via `tools/build-game.mjs` → `dist/`
- `bun run autopilot`, `bun run designer`, `bun run evolve` — experimental tooling

### Settings Persistence

- Key: `gfx-settings-v5`; legacy v2/v3/v4 cleared on load/reset
- Defaults: `flight_profile: trainer`, `control_preset: casual`, `flight_accel: 0.96`
- Fog density per GFX preset: ultra=0.0006, high=0.0008, medium=0.0012, low=0.002
- `floraCullDistance` per preset: low=250, medium=350, high=450, ultra=600, default=450

---

## Uncommitted Changes (as of 2026-05-31)

### `flight-sim3.html` — Distance Culling Pass

- Adds `applyDistanceCulling(material, defaultCullDistance)` injecting GLSL via `onBeforeCompile`
- Culls instanced vertices beyond threshold with soft fade over last 15% of range
- Applied to: `rockMat` (350), `floraMat` (500), `floraMatLow` (500), `rockMatLowPoly` (350)
- New `floraCullDistance` GFX setting in DEFAULTS (450) and all four presets
- `window.gfx.floraCullDistance` is the live runtime knob; shader reads it via getter uniform
- Plumbed into `applyTerrainClutter()` via `scene.userData.__floraCullDistance`
- **Status: browser-unverified; not committed. Blocking action: smoke-test in browser for pop-in and JS errors, then commit.**

### `.mcp.json` — contex MCP port changed to `60768` (uncommitted)

---

## Recent Commit History

- `27c98b2` — Optimize flight-sim performance and HUD *(most recent committed state)*
- `f8d3e4d` — Replace flight simulator image with a new URL
- `d9d2d09` — Rebrand project to Element-115
- `5d54386` — Add README, CONTRIBUTING, LICENSE; update files

The 2026-05-28 feature bundle (engine sound, fog toggle, screen shake, audio management, stall/spin animation, cloud fly-through, building collision detection) is committed in `27c98b2`.

---

## Open Threads

### High Priority

- **Distance culling smoke-test + commit** — `applyDistanceCulling()` and `floraCullDistance` implemented but browser-unverified. Open `flight-sim3.html`, verify no pop-in and no JS errors, then commit all three dirty files together.

### Active Feature Work

- **Reticle / targeting HUD** — scaffolding present but not functional. Full spec in `HERMES_HANDOFF_RETICLE_TARGETING.md`. Needs: gun-line projection, target boxes, distance/speed/altitude readouts, telemetry keys. Gated behind `INPUT_FLAGS.mouseFlight`.
  - Existing scaffold: `#target-overlay` CSS/markup, `reticleState`, `targetHudState`, `inferTargetTypeLabel()`, `ensureTargetHudPool()`, `$crosshair`/`$targetOverlay` refs
- **Blast door concept** — low-poly dark reinforced metal with battle damage; deploys from island sides as rolling side armor, forming barriers around engines and land edges. Concept accepted 2026-05-31; no geometry implemented yet.

### Known Bugs

- **Free traffic kill at startup** — collision fires before player input; runway traffic path intersects parked player
- **Mouse-aim resize corruption** — clamps normalized values as pixels after viewport/fullscreen changes

---

## Cross-Repo Activity (2026-05-31)

### tinyworld (`/Users/jkneen/Documents/GitHub/tinyworld`)

Active development session on 2026-05-31:

- Room builder feature in progress: toggling individual wall segments of a box-frame room to support L/T/custom shapes; session exploring current room system in `index.html`
- Wall material fix requested: walls should have repeating tiles matching the floor (not a flat panel); brightness reduction requested while keeping metallic look
- Floor material animated transition: cold grey metallic → warm worn wood, animated over a few seconds
- Save/load system: floating top-center Save/Load buttons; JSON world-state file; session implementing this
- AI generation subsystem (`engine/world/26-ai-generation.js`) overhauled in prior session: bespoke natural-language requests via `customParts`, selected-object enhancement no longer hard-preserves seed type, startup race fixed
- **Voxel seam shader fix** (committed): `engine/world/03-geometry-materials.js` and `engine/world/04-textures.js`; island side-backing clone carries seam shader hook; seam grid scale tightened to fine masonry tiles; browser-verified clean

### Element-115 / ships (tinyworld lamp lighting fix, 2026-05-31)

- Lamp placement + fake haze working; Three r128 light predicate too narrow for local light toggle
- Fix: switched `updateSkyAndLighting` to check `light.isPointLight || light.isSpotLight` instead of broad `isLight`
- Not yet verified whether placed-light root is correctly added to `placedLights[]`

### Muxy (`/Users/jkneen/Documents/GitHub/muxy`)

- **Codex chat path fix** (committed 2026-05-31): `codex exec` was running in human transcript mode; fix changes invocation to `codex exec --json --color never`; added JSONL event parser rendering only assistant deltas and tool events
- Files: `Muxy/Models/ChatTabState.swift` (~line 87), `ChatProviderArgumentsTests.swift`
- `npm test` focused passing; full iOS simulator build blocked in sandbox (CoreSimulator unavailable); Swift macOS build passes

### OpenClicky (`/Users/jkneen/Documents/GitHub/openclicky`)

- Wake-word audio ducking implemented (prior session): `cursor-buddy/CompanionManager.swift` (~line 192); on "Hey Clicky" activation captures current macOS output volume, drops to 8%, restores before reply audio plays
- Smart natural-language agent-mode trigger added

### Atomic-Chat (`/Users/jkneen/Documents/GitHub/Atomic-Chat`)

- Codex sessions checking in (gpt-5.5); no substantive work observed in session evidence — only greetings and AGENTS.md bootstrap
- AGENTS.md rules: never use emoji unless asked; verify model names from codebase before claiming invalid

---

## Agent Ecosystem

### Healthy

- **OpenClaw Lead (Ava)** — heartbeating normally 2026-05-31; board ID `c3f78d0c-abf3-45d5-898e-27cd1d95c0d1`; base URL `localhost:19789`, agent ID `9f5f3df9-2ed7-4efe-9d97-2114fe460a35`; no board task work last cycle

### Failing — Persistent, Root Cause Uninvestigated

- **MC Gateway `894a3d5b-7faa-4c0a-a40f-69fbdee7b78d`** — "connection refused" on every heartbeat; 5+ consecutive failures; assistant turns failing before producing content
- **VibeClaw Wallpaper Generator** (`cron:85fa55d9`) — every cron turn fails before producing content; multiple consecutive failures 2026-05-31
- **VibeClaw Skills Scout** (`cron:ebfe1571`) — every cron turn fails before producing content; at least 3 consecutive failures 2026-05-31
- **VibeClaw Article Generator** (`cron:8b79f6d2`) — every cron turn fails before producing content

All four silent failures likely share a common dependency or auth issue. No investigation done.

### Degraded

- **Tom Doerr Tweet Tracker** (`cron:cebd05e0`) — assistant turn fails before producing content in recent cycles; previously blocked by X login wall; Nitter alternatives down; `wacli` delivery sink broken (unauthenticated). No tweets delivered in multiple cycles.

---

## Memory References

- `memory/project_ships_layout.md` — post-restructure path reference; why HTML stays at root; how to run via bun

---

*Auto-generated by CodeSurf daemon dreaming. Edit `.claude/CLAUDE.md` for authoritative instructions.*
