Now I have sufficient context to write the updated DREAMING.md. Key new facts from this session cycle:

- `git status` shows only `.codesurf/DREAMING.md` and `.mcp.json` as dirty — `flight-sim3.html` is no longer dirty (reticle scaffolding state needs updating)
- Session evidence from 2026-06-07 shows continued OpenClaw heartbeat polls (Ava), mc-gateway failures, and Tom Doerr tweet tracker cron failures
- New muxy repo sessions (entirely unrelated to ships)
- MCP contex URL confirmed at `http://127.0.0.1:53961/mcp`

# ships — Generated Workspace Memory

*Last updated: 2026-06-07. Grounded in disk inspection, git log, and verified session evidence.*

---

## Overview

**element-115-flight-sim** is a browser-based arcade flight sim at `/Users/jkneen/Downloads/ships`. The entire game is a single monolithic file: `flight-sim3.html`. There is no `engine/`, `hud/`, `player/`, or `tests/` directory structure on disk — every subsystem is inline. Several past agents described a modular layout that does not exist; disregard any such descriptions.

---

## Durable Architecture Facts

- **Primary game file**: `flight-sim3.html` (~19,141 lines; all physics, AI, HUD, camera, combat inline)
- **Entry HTML**: `index.html` at repo root (512 bytes; never move it — Bun resolves relative to root)
- **Dev server**: `bun run dev` → `tweaks-server.mjs`, served at `http://localhost:8766`
- **Both servers**: `bun run start` → web + multiplayer via `concurrently`
- **Multiplayer relay**: `multiplayer-server.mjs`
- **Build**: `bun run build` → `tools/build-game.mjs` → `dist/`
- **Preview built dist**: `bun run preview:dist` → `tools/serve-dist.mjs`
- **Package name**: `element-115-flight-sim`, ESM, Bun ≥ 1.1.0, no Vite
- **GLB models**: `models/` — key asset `stunt_plane.glb` (was misplaced at `../stunt_plane.glb`, corrected previously)
- **Settings key**: `gfx-settings-v5` in localStorage; v2–v4 are cleared on load/reset
- **Plane selection page**: `plane-select.html` at repo root
- **MCP contex server**: `http://127.0.0.1:53961/mcp` (confirmed in `.mcp.json`; uncommitted update pending)
- **Last commit**: `b491d0f` — "Add distance culling, horizon LOD, and instancing" (2026-06-01)

---

## Verified Working Features (as of 2026-06-01)

- Arcade flight physics, chase camera (60–68° FOV), HUD, combat, multiplayer, gamepad
- Settings baseline: `flight_accel: 0.96`, `control_preset: casual`, `flight_profile: trainer`

### Performance work (shipped 2026-06-01, commit `b491d0f`)

- Adaptive resolution, pre-warm shaders, time-budgeted chunk queue, airfield lights → 2 draw calls, 3rd horizon ring LOD (15–24 km), low preset bypasses EffectComposer entirely, device-tier autodetect on first run, `fireHeld` gamepad fix

---

## Known Bugs (2026-04-27 audit, unresolved)

- **Free traffic kill on spawn**: runway AI intersects parked player at t=0
- **Reticle hidden for keyboard players**: gated behind `INPUT_FLAGS.mouseFlight` (default `false`)
- **Mouse aim corrupts after resize**: resize handler clamps normalised values as pixels
- **Reticle uses NDC, not gun-line**: follows mouse position rather than forward weapon vector

---

## Test Hooks

- `window.__sim.spawnPlayer({ x: 0, y: 500, z: 0 })` — safe altitude spawn (minimum y: 500; runway spawn crashes)
- `window.render_game_to_text()` — telemetry snapshot: speed, altitude, score, combat state
- `window.advanceTime()` — step game clock; also polls gamepad input
- `window.__ap.setGamepad()` / `.clearGamepad()` — inject virtual controller
- `window.__ap.telemetry()` — richer block including multiplayer/traffic/combat data (around line 11970+)
- Playwright smoke outputs to `output/`; WebGL ReadPixels and AudioContext autoplay warnings are expected noise

---

## Non-Game Runtime Scripts

- `autopilot.mjs` — `bun autopilot`; AI autopilot harness
- `world-designer.mjs` — `bun designer`; world layout tool
- `self-evolve.mjs` — `bun evolve`; experimental self-modification
- `tweaks-server.mjs` — dev server
- `multiplayer-server.mjs` — WebSocket relay

---

## Open Threads

### Reticle + Targeting — STATUS UNCERTAIN

`HERMES_HANDOFF_RETICLE_TARGETING.md` at repo root documents an interrupted feature pass. Read it before touching `flight-sim3.html`.

Previous sessions reported partial CSS/markup scaffolding inserted into `flight-sim3.html` (dirty). As of 2026-06-07, `git status` shows `flight-sim3.html` is **clean** — no uncommitted changes. The scaffolding was either reverted or never persisted. No reticle-related commit appears in git log after `b491d0f`. Verify the handoff doc before assuming any scaffolding is present.

Remaining work (per handoff doc):
- Reticle: derive aim from `jet.userData.gunL`/`gunR`, project lookahead from muzzle trajectory, bias slightly upward, add spring/lag
- Target bounds: 2D projected boxes for `traffic` and `multiplayerState.remotePlayers`; label/type/distance/speed/altitude cards; cap visible count; nearest-to-reticle = active lock
- Telemetry: add `target_boxes`, `target_lock`, `target_lock_label`, `target_lock_distance_m`, `reticle_x`, `reticle_y` to `window.__ap.telemetry()`
- Check live ports before server ops: `bun` on :8765, `node` on :3000

### Space Combat Pivot — requested, not started

Jason requested space combat direction: player ship, third-person camera, terrain collision, lives, enemy fighters, spacebar bullets, scrolling star field, dark background (`0x000010`), score system. Nothing applied. Changes would go in `flight-sim3.html`.

### animate() JS profiling — not done

Dominant bottleneck reported as ~30 ms/frame with ~204 Vector3 allocs per frame. No profiling pass yet.

### Flight feel tuning

Deliberately untouched; needs Jason's direction.

### .mcp.json uncommitted update

`.mcp.json` has an uncommitted change (contex server port update to 53961). Confirmed correct. Commit when convenient.

---

## Recent Session Activity (2026-06-07)

No ships project work occurred. `flight-sim3.html` has not been touched since commit `b491d0f` (2026-06-01).

Background system activity (all unrelated to ships):
- **OpenClaw heartbeat polls** (Ava / lead board agent, gateway at `localhost:19789`) — repeated HEARTBEAT_OK responses, no task work; BOARD_ID `c3f78d0c-abf3-45d5-898e-27cd1d95c0d1`, AGENT_ID `9f5f3df9-2ed7-4efe-9d97-2114fe460a35`
- **OpenClaw mc-gateway** (`894a3d5b-7faa-4c0a-a40f-69fbdee7b78d`) — connection refused on one cycle; multiple assistant-turn failures before producing content
- **VibeClaw cron: Tom Doerr Tweet Tracker** — failed with `assistant-turn failed before producing content` on all three runs this cycle; state file at `/Users/jkneen/clawd/memory/tom-doerr-seen.json`
- **VibeClaw cron jobs** (wallpaper, articles, skills scout) — continuing systemic assistant-turn failures; pattern is consistent with OpenClaw provider instability, not job-specific
- **muxy repo** (Codex, GPT-5.5) — Swift project at `/Users/jkneen/Documents/GitHub/muxy`; `swift test` passes 733 tests; blocker is swiftformat version mismatch (Homebrew 0.61.0 vs pinned 0.60.1); fix is `mise exec -- swiftformat`; entirely unrelated to ships

### Infrastructure note

OpenClaw provider is exhibiting persistent assistant-turn failures across mc-gateway and multiple VibeClaw cron jobs. Pattern is systemic, not ships-related. No ships work has been blocked by this.

---

## Important Caution

Modular `engine/` directories described by past agents do not exist on disk. The stale user memory file (`~/.claude/projects/.../project_ships_layout.md`) predates a refactor that was never executed. Verify all paths with `ls`/`Glob` before referencing. New features go inline in `flight-sim3.html`. Single writer only — no parallel worktree edits.
