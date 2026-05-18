# CodeSurf Workspace Memory — Ships Flight Sim

_Generated: 2026-05-18_

---

## Overview

`ships` is a browser-based 3D arcade flight simulator built on Three.js. The primary deliverable is a single large HTML file (`flight-sim3.html`) served by bun-based dev servers. The project has multiplayer race mode, controller support, combat/targeting mechanics, a practice-course curriculum, and an autopilot training loop.

---

## Durable Facts

- **Primary file**: `flight-sim3.html` — all game logic, physics, HUD, combat, multiplayer, and rendering. Currently **dirty** (modified, uncommitted, contains partial targeting scaffolding from a wrong Hermes session).
- **Supporting data**: `plane-tweaks.json` — tunable flight/physics parameters, also dirty. `world-state.json` — autopilot curriculum state (revision 121).
- **HTML stays at project root** — not moved to `src/` or `dist/`.
- **Runtime**: bun ≥ 1.1.0.
  - `bun web` → tweaks-server on `:8765`
  - `bun mp` → WebSocket multiplayer server on `:3000`
  - `bun start` → both concurrently
  - `bun run build` → build to `dist/`
  - `bun run autopilot` → AI pilot training loop
  - `bun run evolve` → self-evolution loop
- **Settings persistence key**: `gfx-settings-v5`. Keys v2/v3/v4 cleared on load. `RESET SETTINGS` button in Options restores clean baseline (`trainer` + `casual`).
- **Test hooks**: `window.__ap.render_game_to_text()`, `advanceTime()`, `setGamepad()` / `clearGamepad()`, `telemetry()`.
- **93 GLB plane models** in `models/` directory.

---

## Recently Shipped Features (v2026.05.05)

- **Target upgrade course** — practice rings are sequenced reward gates (ammo, missiles, shields, alien pulse time).
- **Real missile drop-launch** — wing missiles fall clear before motor ignites.
- **Damaged UFO feedback** — shield flicker, sparks, smoke trails on hull degradation.
- **Player shields** — course targets can recharge shield before hull damage.

---

## Git State (as of 2026-05-18)

Last commit: `3d48a84` (2026-05-05). **Dirty/uncommitted**:

- `M flight-sim3.html` — partial reticle/targeting scaffolding from wrong Hermes session
- `M .mcp.json`
- `M .codesurf/DREAMING.md`
- `D models/Polygon_Plane_Texture_01.png` — deleted (staged)
- `D models/Polygon_Plane_Texture_02.png` — deleted (staged)
- `D models/Polygon_Plane_Texture_03.png` — deleted (staged)
- `D models/stunt_plane.glb` — deleted (staged); was previously manually copied from `/Users/jkneen/Downloads/stunt_plane.glb`

The deleted stunt_plane.glb / textures are uncommitted — if stunt plane variants need to render, the GLB must be reinstated.

---

## Active Open Thread: Reticle + Targeting (HERMES Handoff)

**Handoff document**: `HERMES_HANDOFF_RETICLE_TARGETING.md` (project root)

**Status**: incomplete scaffolding only — a wrong Hermes session inserted partial HUD/targeting stubs. The user-requested features are **not yet implemented**.

The partial work already in `flight-sim3.html`:
- Extended `#crosshair` CSS + `.locked` state
- `#target-overlay` DOM node + `.target-bracket`, `.target-frame`, `.target-tag`, `.target-readout` CSS
- JS refs: `$crosshair`, `$targetOverlay`
- State scaffolding: `reticleState`, `targetHudState`, `TARGET_BOX_LIMIT`, `inferTargetTypeLabel()`, `ensureTargetHudPool()`

**What still needs building**:
1. Reticle derived from gun-line projection (`jet.userData.gunL` / `gunR`), biased upward, spring-smoothed
2. Target bounding boxes for `traffic[]` and `multiplayerState.remotePlayers`, on-screen only, capped count
3. Per-target data cards: callsign/type, distance, speed, altitude
4. Telemetry fields: `reticle_x`, `reticle_y`, `target_lock`, `target_lock_label`, `target_lock_distance_m`, `target_boxes`

**Key code locations** (approximate lines in `flight-sim3.html`):
- `#crosshair` CSS ~350, HUD markup ~792, preflight hide rules ~665
- HUD DOM refs ~9292, `updateHUD()` ~9921
- `attemptInstantHit()` ~5953, `fireProjectileBurst()` ~5977, `updateCombat()` ~6013
- `traffic[]` array ~10826, `updateTraffic()` ~10940
- Remote players: `makeRemotePlayerMesh()` ~3994, `updateMultiplayer()` ~4177
- Telemetry block ~11970+

**Decision pending for next session**: continue from dirty partial state, or revert `flight-sim3.html` to the last commit and implement cleanly.

**Active servers** (do not restart): `bun` on `:8765`, `node` on `:3000`.

---

## Known Bugs

- **Startup free kill**: score/kills register before player input; runway traffic intersects parked player at zero speed. On review pass, state showed `score.points: 220`, `combat_kills: 1`, `traffic_alive: 4` before any input.
- **Reticle gated behind `mouseFlight`** (defaults `false`) — keyboard players receive no gunsight/target boxes despite combat being keyboard-first.
- **Resize handler corrupts mouse aim** — clamps normalized mouse-flight target values as pixels after viewport/fullscreen changes.

---

## Autopilot Training System

- **State file**: `world-state.json` (revision 121, note: "flight-sim3.html changed on disk")
- **Sessions**: 500 iterations, 49 crashes, 48 resets
- **Stages mastered**: `takeoff`, `climb`, `cruise` (cruise passed at iter 410)
- **Current stage**: `turn_left`
- **World gates**: cyan/magenta cruise rings, magenta climb rings, yellow descend rings, slalom pylons for low_pass, orange turn gates for turn_left
- `autopilot-skills.json` — persistent playbook per stage
- Autopilot is external loop (`bun run autopilot`) — does not affect file authoring

---

## Background Automation (OpenClaw, same machine)

- **MC Gateway `894a3d5b`**: persistently failing — connection refused on all recent heartbeats, including multiple failed assistant turns before fallback error. Needs investigation.
- **Tom Doerr Tweet Tracker** (`cebd05e0`): healthy — running on schedule, new tweets found and tracked, state file updated at `/Users/jkneen/clawd/memory/tom-doerr-seen.json`.
- **Urgent Email Alert** (`4e55bac5`): script itself running successfully (HEARTBEAT_OK at 17:00 UTC 2026-05-18), but had 4 consecutive failed assistant turns earlier in the same run before the successful one. Transient instability worth monitoring.
- **Lead C3f78d0c (Ava)**: gateway consistently OK, no board task work on recent cycles — idle but healthy.

---

## Workflow Notes

- The contex peer-collaboration system is active (`.contex/` tiles). Register peer state before editing shared files.
- Screenshots of design state saved in project root (`.png` files) — useful for visual regression reference.
- `dist/` contains a built copy: `dist/game.html`, `dist/index.html`, `dist/plane-tweaks.json`, `dist/latest-features.json`.
- `archive/html/` holds historical snapshots of the sim evolution.
- `research/` and `output/` directories exist for investigation artifacts.
