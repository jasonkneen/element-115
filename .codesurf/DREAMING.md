# CodeSurf Workspace Memory — ships

_Generated: 2026-05-19. Grounded in session evidence and project memory. Verify current file state before acting on line-number references._

---

## Overview

`ships` is a browser-based arcade flight simulator (`flight-sim3.html`) built on Three.js/WebGL, served via Bun. It supports single-player target-gate courses, ambient traffic dogfighting, UFO/alien saucer enemies, a missile and countermeasures combat system with lock-on targeting, and a WebSocket multiplayer race mode. The primary HTML file (~18 500 lines) is the single source of truth for all game logic.

---

## Durable Facts

### Layout (post-2026-04-19 restructure)

- Root: `flight-sim3.html`, `plane-select.html`, `index.html` (redirect), `tweaks-server.mjs`, `multiplayer-server.mjs`, `autopilot.mjs`, `self-evolve.mjs`, `world-designer.mjs`, runtime JSON state files
- `models/` — GLB assets, gitignored; `stunt_plane.glb` and `Polygon_Plane_Texture_01/02/03.png` present (accidentally deleted in commit 39e1055 on 2026-05-18, immediately restored by revert b10fffe)
- `archive/html/` — old HTML prototypes; `archive/screenshots/` — PNG captures; `archive/backups/` — `.bak` files
- `dist/` — build output (`dist/game.html`, `dist/index.html`); `output/` — Playwright smoke screenshots

**Why HTML stays at root:** `autopilot.mjs`, `world-designer.mjs`, `self-evolve.mjs` hardcode `path.resolve(process.cwd(), 'flight-sim3.html')`.

### Run Commands

- `bun web` — static + tweaks server on `:8765`
- `bun mp` — multiplayer WebSocket server on `:8787`
- `bun start` — both via `concurrently`
- `bun autopilot` — headless autopilot test harness
- `bun designer` — world-designer curriculum builder
- `bun evolve` — self-evolve loop

### Key Runtime APIs (test hooks)

- `window.__ap.telemetry()` — structured game state snapshot
- `render_game_to_text()` — text state dump for smoke verification
- `advanceTime(ms)` — time-step the sim without real clock
- `window.__ap.setGamepad()` / `window.__ap.clearGamepad()` — virtual controller injection

### Settings Persistence

- Current key: `localStorage.gfx-settings-v5`
- Legacy keys `gfx-settings-v2/v3/v4` are cleared on load/reset
- Options panel includes a top-level RESET SETTINGS button

### Stunt Plane Asset

- Canonical location: `models/stunt_plane.glb`
- Variants `stunt1`–`stunt4` all reference the same `.glb`; textures: `Polygon_Plane_Texture_01/02/03.png`

### Damage Model

- `plane.health` (0–100); components: `plane.damage.{airframe,engine,leftWing,rightWing}` (0–1 each)
- `damagePlane(amount, kind, opts)` applies graduated damage; `healPlane()` resets
- Traffic planes spawn with `health: 3`; `damageDestructible()` routes bullet hits through health
- Smoke pools are damage-driven (not maneuver-driven); healthy cruise produces no smoke
- Damage decals: pool of 6 sprites attached to `jet`, placed via `spawnDamageDecal(worldPos, intensity)`

### Camera and Graphics

- Chase camera FOV range: 60–68 degrees (aspect-corrected on wide screens); slightly farther back to avoid fisheye
- Post-process radial motion blur: clamped UV reads, reduced edge sampling
- Graphics presets: low / medium / high / ultra; `P` key toggles panel

### Multiplayer

- WebSocket state sync on `ws://localhost:8787`
- Race mode: `N` key or HUD button starts shared countdown; clients auto-adopt; live leaderboard in left HUD
- Practice-course gate scoring feeds race progress and finish timing

### Gamepad

- Supports Xbox / PlayStation / generic pads with trigger-axis fallback
- Right-stick yaw double-deadzone fixed; D-pad-right cycles aircraft model

---

## Combat System (feature version 2026.05.05)

### Weapons

- **Guns:** ammo belt, starts 120 / max 300; earns passively at `7.5 rounds/s`; heat-tracked (`gunHeatPerBurst: 0.065`)
- **Missiles:** starts 3 / max 6; earned via course gates (`missileEarnInterval: 8 s`); heat-tracked (`missileHeatPerShot: 0.22`); fire from alternating wing rails (`missileL`/`missileR`); real drop-then-ignite launch sequence
- **Countermeasures:** flares (4 max) and smoke (2 max); disrupt missile lock
- **Alien weapon:** temporary unlock via course reward (`alienWeaponUntil`); fires `alien-pulse` projectiles

### UFO / Alien Saucers

- Traffic type: `ufo-saucer`; enemy projectile type: `ufo-pulse`
- Arena limit: one saucer is the designated active shooter at a time
- Saucer health includes shields (`shieldMax` on destructible); shields absorb hits first; damaged saucers show failing-shield flicker, sparks, and smoke trails
- On player hit: `damagePlane(0.9, 'airframe')` + `flashStatus` warning "UFO PULSE HIT"

### Player Shields

- `plane.shield` / `plane.shieldMax` tracked; course gates can award recharge
- HUD shows: `HULL % · SHD %` and `WEAP ammo/max · MSL n · EARN state`

### Target Upgrade Course

- Practice rings are sequential target gates; hitting them in order awards ammo, missiles, shields, and alien-pulse time
- `latest-features.json` version: `2026.05.05`

---

## Targeting and Reticle System

The targeting system is fully committed and functional in `flight-sim3.html`. Any handoff documents describing it as "partial scaffolding" reflect a pre-commit state and should be disregarded.

### Architecture (~lines 13200–13300)

- `RETICLE_SCREEN_Y_RATIO: 0.52`, `RETICLE_GUN_Y_OFFSET_PX: 54`
- `reticleState` — `{x, y, vx, vy, baseYOffset, visible}` with spring/lag position updates
- `targetHudState` — `{boxes[], lockAmount, lockSolid, lockTone, lockHoldUntil, lockCenterHoldPx, aimAssist, activeId/Label/Type/DistanceM/Target, selectedId/Index/Count, cyclePressed}`
- `TARGET_BOX_LIMIT: 8` — max simultaneously rendered target brackets
- `updateReticleHud(dt)` (~line 13589) — gun-line derived aiming with spring smoothing
- `updateTargetHud(dt)` (~line 13621) — 2D projected boxes for traffic and remote players
- `inferTargetTypeLabel(id)` — maps model ID to type string (F-14, A-10, PROP, STUNT, DRONE, etc.)
- `ensureTargetHudPool()` — allocates DOM bracket pool up to `TARGET_BOX_LIMIT`
- CSS: `#target-overlay`, `.target-bracket`, `.target-frame`, `.target-tag`, `.target-readout`, `.shield-hit` state

### Lock Mechanic

- `lockAmount` (0–1) drives missile homing, aim assist, and lock tone audio
- Missile `projectile.target` assigned only when `lockAmount > 0.24`
- Alien-pulse guidance and accuracy scale with `lockAmount`
- UFO `playerLock` capped to `0.22` / `0.10` outside engagement range

### Known Targeting Bugs

- **Keyboard reticle hidden:** `reticleState.visible` gated behind `INPUT_FLAGS.mouseFlight` (defaults false); keyboard-only players see no gunsight
- **Resize corrupts mouse aiming:** Resize handler clamps normalized mouse-flight values as pixels

---

## Pending Feature: Local Leaderboard / Review UI

**Status:** Attempted 2026-05-18 (commit 39e1055), reverted same day (b10fffe). Not shipped. Needs clean reimplementation.

**Planned design:**
- Post-flight review overlay with local leaderboard
- Name input with autocomplete + ARIA; Enter-to-submit; Save button with saved/unsaved visual transitions
- `localStorage` score persistence; `leaderboardSaved` / `reviewWasVisible` UI state flags

**Danger:** The reverted commit accidentally deleted `models/Polygon_Plane_Texture_01/02/03.png` and `models/stunt_plane.glb`. Any future leaderboard pass must not touch model assets.

---

## Known Bugs

- **Startup free-kill:** `score.points: 220`, `combat_kills: 1`, `traffic_alive: 4` before player input. Root cause: runway traffic path intersects parked player at spawn; collision fires at zero player speed.
- **Keyboard reticle hidden:** `reticleState.visible` gated on `INPUT_FLAGS.mouseFlight`; keyboard-only players see no gunsight.
- **Resize corrupts mouse aiming:** Resize handler treats normalized mouse values as pixel coordinates.

---

## Active Background Processes

- **Urgent Email Alert cron** (`4e55bac5-7d0f-4d3a-a023-4b0a1546c6bb`) — runs every 30 min via OpenClaw; all checks returning HEARTBEAT_OK through 2026-05-19.
- **Tom Doerr Tweet Tracker cron** — Twitter/X blocking unauthenticated browser access; 0 tweets extracted on last run (2026-05-19T13:21).
- **MC Gateway agent** (`894a3d5b-7faa-4c0a-a40f-69fbdee7b78d`) — multiple failed turns observed 2026-05-19; connection refused on heartbeat.

---

## Open Threads

- Leaderboard UI needs a clean reimplementation pass that does not modify `models/`
- Keyboard reticle visibility fix: remove `mouseFlight` gate from `reticleState.visible` or add separate keyboard-mode gunsight path
- Startup free-kill: add spawn exclusion zone or delay collision registration until player first moves
- Resize handler: convert mouse-flight normalization to use viewport dimensions consistently
- MC Gateway agent connection failures worth investigating if background automation is needed
