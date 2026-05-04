# CodeSurf Workspace Memory — ships

_Generated: 2026-05-04_

---

## Overview

Single-file Three.js arcade flight sim served by Bun. The canonical game file is `flight-sim3.html` at the project root. Physics, HUD, combat, touch controls, multiplayer, and settings all live in that one file. Multiple AI agents (Claude, Codex/GPT-5.5) collaborate on this workspace through the CodeSurf canvas peer protocol. A static build pipeline targets Netlify deployment.

---

## Durable Facts

### Project layout

- `flight-sim3.html` — main game (~12 500+ lines, Three.js, all logic inline; currently dirty/uncommitted)
- `flight-sim3.html.bak` — manual snapshot at root
- `plane-select.html` / `index.html` — plane selection / landing/redirect page
- `plane-tweaks.json` — per-model tuning overrides; loaded at runtime; copied into `dist/` by build
- `multiplayer-server.mjs` — WebSocket room server
- `tweaks-server.mjs` — static web server (Bun)
- `autopilot.mjs` — autopilot / headless test-driver helper (`bun autopilot`)
- `world-designer.mjs` / `self-evolve.mjs` — world-designer and self-evolve helpers
- `tools/build-game.mjs` — build script (outputs to `dist/`)
- `tools/serve-dist.mjs` — local preview of dist build
- `netlify.toml` — Netlify deploy config (`bun run build` → `dist/`)
- `dist/` — static build output: `game.html`, `index.html`, `models/`, `audio/`, `plane-tweaks.json`
- `models/` — 120+ `.glb` files, gitignored; `models/stunt_plane.glb` is the real stunt asset
- `HERMES_HANDOFF_RETICLE_TARGETING.md` — active handoff for incomplete reticle/targeting work
- `progress.md` — dated log of all passes and verification results
- `.contex/` — 14 CodeSurf tile peer metadata dirs
- `.mcp.json` — contex MCP server URL (updated 2026-05-04 to port 49569)

### Running the project

- `bun start` — launches web server + multiplayer server concurrently
- `bun web` — static server only (tweaks-server.mjs, port :8765)
- Active listener snapshot (HERMES handoff, 2026-05-04): `bun` on `:8765`, `node` on `:3000`
- Do not restart the live server between agent sessions unless explicitly asked

### Build & deploy

- `bun run build` → `dist/` via `tools/build-game.mjs`; Netlify target (Node 22 / Bun 1.3.13)
- `game.html` = must-revalidate; `models/*` / `audio/*` = 1-year immutable cache
- Tweak loading: `/api/tweaks` in dev, `plane-tweaks.json` (cache: no-cache) in static builds

### Settings persistence

- Active localStorage key: `gfx-settings-v5`; legacy v2/v3/v4 auto-cleared
- Default profile: `trainer` flight + `casual` control preset
- `window.__toggleOptionsPanel` toggles the Options/Graphics panel

---

## Active Subsystem Behaviour

### Touch controls (added 2026-05-04)

- Full touchscreen UI: virtual joystick (left), throttle slider (right), action buttons
- ARIA-labelled markup; CSS covers responsive/landscape, safe-area insets
- `window.__touchControls` — live touch state; `window.__syncTouchControls` — force-sync
- `syncTouchVirtualGamepad()` called from `pollGamepad()` — maps touch to virtual gamepad
- Touch input resets when options panel opens; HUD adapts for coarse-pointer/landscape

### Camera (fixed 2026-05-03)

- FOV narrowed to 60–68° raw range; aspect-corrected vertical FOV; blur UV reads clamped

### Physics & controls

- Fixed-step physics, arcade rate-command pitch/roll/yaw, angular velocity caps
- Gamepad: Xbox/PlayStation/generic, trigger-axis fallback, double-deadzone fix
- `window.__ap.setGamepad()` / `clearGamepad()` for automated tests

### Multiplayer race mode

- `N` key or HUD button starts shared countdown; left-side HUD: timer, gates, leaderboard

### Telemetry bridge

- `window.__ap.telemetry()` returns multiplayer/traffic/combat/flight data (~line 11970+)
- `render_game_to_text` for headless state snapshots

---

## Known Bugs (unfixed as of 2026-05-04)

- **Startup free kill** — `combat_kills: 1` fires before player input (runway traffic collision at zero speed)
- **Reticle gated behind `mouseFlight`** — defaults `false`; keyboard players get no gunsight
- **Reticle follows mouse NDC, not gun-line** — no spring/lag; not from actual muzzle trajectory
- **Resize/fullscreen corrupts mouse-flight target** — clamps normalised values as pixels

---

## Open Thread — Reticle + Targeting (incomplete)

Handoff: `HERMES_HANDOFF_RETICLE_TARGETING.md`

**Scaffolded**: `#crosshair`/`.locked`/`#target-overlay` CSS+markup (~lines 350, 665, 792); `$crosshair`/`$targetOverlay` DOM refs (~9292); `reticleState`, `targetHudState`, `TARGET_BOX_LIMIT`, `inferTargetTypeLabel()`, `ensureTargetHudPool()`

**Still needed**: reticle from `jet.userData.gunL/gunR` muzzle + upward bias + spring/lag; target boxes for `traffic[]` (~10828) and `remotePlayers` (~4051) with data cards; telemetry fields `target_boxes`, `target_lock`, `target_lock_distance_m`, `reticle_x/y`

Key locations: `attemptInstantHit()` ~5953, `fireProjectileBurst()` ~5977, `updateCombat()` ~6013, `updateHUD()` ~9921

---

## Verification Constraints

Inside sandboxes: Playwright not installed, MCP browser/loopback blocked. Syntax parse checks and `git diff --check` work. Real browser verification at dev URL (bun :8765) or Netlify deploy.

---

## Agent Notes (confirmed 2026-05-04)

- Codex (gpt-5.5) can edit files directly in this repo
- 14 active CodeSurf tile peers in `.contex/`; most recent: `tile-1777854846426`
- `.mcp.json` contex MCP server now at port 49569

---

## Workflow Notes

- Read `flight-sim3.html` before every patch; currently dirty (~32 uncommitted lines)
- `flight-sim3.html.bak` — manual snapshot for diffing
- Log verification results in `progress.md` under a dated heading
- For static deploy check: `bun run build` then `bun run preview:dist`
- CodeSurf session start: `peer_set_state(status="idle")` → `peer_get_state` — mandatory

_This file is auto-generated by the codesurf-dreaming agent. Do not hand-edit._
