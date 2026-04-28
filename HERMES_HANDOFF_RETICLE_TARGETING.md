# Hermes handoff: reticle + targeting pass

Context: this request landed in the wrong Hermes session/window. This file is a handoff note for the other session to continue from.

## User request

The user wants the following in `flight-sim3.html`:

1. The reticle / gunsight target point needs to be higher on screen so sighting and shooting feel accurate.
2. The reticle should have some natural movement instead of feeling unnaturally dead/static.
3. Add targeting bounds around other planes.
4. The targeting UI should show information like:
   - distance
   - type
   - speed
   - altitude

## Important constraints

- Do **not** restart the live sim server.
- Current listeners when checked:
  - `bun` on `:8765`
  - `node` on `:3000`
- Main file for this work:
  - `/Users/jkneen/Downloads/ships/flight-sim3.html`

## Current repo state

At the time of handoff:

- `git status` showed:
  - `M flight-sim3.html`
  - `M plane-tweaks.json`
  - `?? .commandcode/`
- The accidental work from this wrong session only touched:
  - `flight-sim3.html`
- No commit was made from this wrong-session work.

## Important warning

The changes in `flight-sim3.html` are **partial scaffolding only**.
They are **not complete** and **not verified**.

The next Hermes session should either:

- continue from this dirty partial state, or
- revert the accidental `flight-sim3.html` edits first and implement cleanly.

## What was already changed accidentally

The wrong session added partial HUD/targeting scaffolding to `flight-sim3.html`:

### CSS / HUD overlay
- extended `#crosshair` styles
- added `.locked` crosshair state styling
- added `#target-overlay`
- added `.target-bracket`, `.target-frame`, `.target-tag`, `.target-readout`
- added preflight/review hiding for `#target-overlay`

### HUD markup
- inserted:
  - `<div id="target-overlay"></div>`
  under `#hud`

### HUD JS refs
- added:
  - `const $crosshair = document.getElementById('crosshair');`
  - `const $targetOverlay = document.getElementById('target-overlay');`

### Partial state scaffolding
- added:
  - `reticleState`
  - `targetHudState`
  - temporary vectors/quaternions for HUD math
  - `TARGET_BOX_LIMIT`
  - `inferTargetTypeLabel()`
  - `ensureTargetHudPool()`

### Fixup already needed
- `setFlightPhase()` was briefly malformed during patching and was corrected.
- The file still needs a real implementation of reticle + targeting logic.

## Relevant code locations

Approximate sections in `flight-sim3.html`:

### HUD / overlay markup and CSS
- `#crosshair` CSS: around line `350`
- HUD root markup: around line `792`
- preflight/review HUD hide rules: around line `665`

### HUD refs and status
- HUD DOM refs: around line `9292`
- transient status + `flashStatus()`: around line `9821`
- `updateStatusGuidance()`: around line `9868`
- `updateHUD()`: around line `9921`

### Combat / aiming
- destructible helpers: around line `5828`
- `attemptInstantHit(...)`: around line `5953`
- `fireProjectileBurst(...)`: around line `5977`
- `updateCombat(...)`: around line `6013`

### Multiplayer remote planes
- `buildLocalMultiplayerState()`: around line `3980`
- `makeRemotePlayerMesh(...)`: around line `3994`
- `ensureRemotePlayer(...)`: around line `4051`
- `handleMultiplayerMessage(...)`: around line `4077`
- `updateMultiplayer(...)`: around line `4177`

### Ambient traffic planes
- `const traffic = []`: around line `10826`
- `spawnTraffic(...)`: around line `10828`
- `trafficEnabled()`: around line `10936`
- `updateTraffic(...)`: around line `10940`

### Telemetry bridge
- `window.__ap.telemetry()` block includes multiplayer / traffic / combat data around line `11970+`

## Recommended implementation direction

### 1. Reticle aiming point
Do **not** keep it static at screen center.

Better direction:

- derive aim point from the **actual gun line**, not just the camera center
- use `jet.userData.gunL` and `jet.userData.gunR`
- compute an averaged muzzle origin / forward line
- project a lookahead point forward from the muzzle trajectory
- bias the reticle **slightly upward** for better practical sighting
- smooth it with a spring / lag so it feels natural rather than glued to a point

Suggested behavior:
- use camera projection of a forward point from gun origin(s)
- vertical offset should be slightly raised compared with exact camera center
- smoothing should avoid jitter but still respond when maneuvering

### 2. Targeting bounds
Add an HUD overlay for:

- ambient `traffic` aircraft
- `multiplayerState.remotePlayers`

Suggested target card contents:
- label / callsign
- aircraft type
- distance
- speed
- altitude

Suggested targeting behavior:
- build projected 2D boxes from target world position plus approximate half extents
- show only on-screen targets in front of the camera
- cap visible count
- optionally highlight the target nearest to the reticle as the active lock / candidate

### 3. Useful telemetry to add
If the other session wants strong verification hooks, add:

- `target_boxes`
- `target_lock`
- `target_lock_label`
- `target_lock_distance_m`
- `reticle_x`
- `reticle_y`

These can go into the existing `window.__ap.telemetry()` return object.

## Suggested verification plan

Without disturbing the live setup:

1. inspect and complete the partial scaffolding in `flight-sim3.html`
2. verify no JS errors
3. verify reticle moves above center and tracks more naturally than the old static crosshair
4. verify traffic / remote players get bounds and data cards
5. verify telemetry reports reticle and target-lock data
6. verify preflight/review still hide the overlay cleanly

## Helpful commands

Inspect dirty changes:

```bash
cd /Users/jkneen/Downloads/ships
git status --short
git diff -- flight-sim3.html
```

## Bottom line

The user’s requested feature work is **not done yet**.
This file is a handoff so the other Hermes session can continue cleanly.

The current `flight-sim3.html` has **partial targeting scaffolding already inserted**, but it still needs the real reticle positioning, target box generation, and target data readouts implemented and verified.
