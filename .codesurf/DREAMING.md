The file is clean and correct. Here is the full replacement content for `.codesurf/DREAMING.md`:

---

# CodeSurf Workspace Memory — ships

*Generated 2026-05-20. Consolidates sessions and memory layers. Do not edit by hand — overwritten by next dreaming run.*

---

## Overview

`ships` is a Bun-based browser flight simulator (`element-115-flight-sim v0.1.0`) at `/Users/jkneen/Downloads/ships/`. It runs in a CodeSurf canvas workspace where multiple OpenClaw agents collaborate via `mcp__contex__*` tools. The sim itself is a single-file game (`flight-sim3.html`) served by two local servers; a separate OpenClaw Lead agent ("Ava") and a VibeClaw content pipeline also operate within this workspace context.

---

## Durable Project Facts

### Repository Layout
- Root holds all runnable files: `flight-sim3.html`, `plane-select.html`, `index.html` (redirect), `tweaks-server.mjs`, `multiplayer-server.mjs`, `autopilot.mjs`, `world-designer.mjs`, `self-evolve.mjs`
- `models/` — 120 `.glb` plane/asset files (gitignored); all HTML references must use `models/<file>.glb` prefix
- `archive/html/` — old prototypes; `archive/screenshots/` — PNGs; `archive/backups/` — `.bak` files
- Runtime JSON state at root: `world-state.json` (world revision log), `latest-features.json` (version changelog), `feature-requests.json` (pending queue), `plane-tweaks.json`, `autopilot-skills.json`, `build-log.json`

### Run Commands (Bun required ≥ 1.1.0)
- `bun web` — static file server + tweaks endpoint on `:8765`
- `bun mp` — multiplayer WebSocket server on `:8787`
- `bun start` — both servers concurrently (via `concurrently`)
- `bun autopilot` — `autopilot.mjs` tool
- `bun designer` — `world-designer.mjs` tool
- `bun evolve` — `self-evolve.mjs` tool

### Critical Constraints
- `flight-sim3.html` **must remain at repo root** — `autopilot.mjs`, `world-designer.mjs`, and `self-evolve.mjs` all hardcode `path.resolve(process.cwd(), 'flight-sim3.html')`
- `tweaks-server.mjs` serves from `process.cwd()` with path-traversal guard; subfolders like `models/` work without extra config
- GLB model references inside HTML must use `models/<name>.glb` — no bare filenames

### Game State
- `world-state.json` currently at **revision 121** (last written 2026-04-18)
- `latest-features.json` version **2026.05.05**; last feature set: target upgrade gates with reward callouts, real missile drop launch (motor lights after rail separation), damaged UFO visual feedback (flicker/sparks/smoke), player shields from course gates

### Gameplay / Physics Primitives (added 2026-04-19)
- Damage model: `plane.health` (0–100), `plane.damage.{airframe, engine, leftWing, rightWing}` (0–1 each), `plane.engineEvent` (0–1 transient) — replaced old binary `plane.crashed`
- `damagePlane(amount, kind, opts)` applies graduated damage; `healPlane()` resets
- `damageDestructible()` routes bullet hits through health; traffic planes spawn with `health: 3`
- Smoke pools (`greyTurnSmokeL/R`, `dirtyExhaustCore`) are damage-driven, not maneuver-driven
- Weather: `weather = { clouds: 0..1, storm: 0..1 }` — `clouds` scales `CLOUD_COUNT` at build time
- Graphics panel: `P` key toggles; presets low/medium/high/ultra; persists in `localStorage.gfx-settings-v6`
- HUD: `#hull-pct`, `#hull-bar`, `#shield-pct`, `#ammo-val`, `#ammo-max`, `#ammo-bar`, `#missile-val`, `#supply-val` elements
- Damage decals: sprite pool of 6 attached to `jet`; `spawnDamageDecal(worldPos, intensity)` places scorch at random hull anchor

---

## Active Subsystems (OpenClaw)

### Lead Agent — "Ava"
- ID: `9f5f3df9-2ed7-4efe-9d97-2114fe460a35`
- Board ID: `c3f78d0c-abf3-45d5-898e-27cd1d95c0d1`
- Status as of 2026-05-20: **healthy** — responding `HEARTBEAT_OK` on all polls
- Reads config from `TOOLS.md` (BASE_URL localhost:19789, AUTH_TOKEN, BOARD_ID, AGENT_NAME, AGENT_ID)

### MC Gateway Agent
- Provider: `mc-gateway-894a3d5b-7faa-4c0a-a40f-69fbdee7b78d`
- Status as of 2026-05-20: **FAILING** — connection refused on heartbeat polls; assistant turns failing before producing content
- Not producing output; needs investigation

### VibeClaw Article Generator Cron (`8b79f6d2`)
- Runs on a recurring schedule (~every 2 hours observed)
- Publishes 2 AI news articles per run via API (**NO GIT PUSH**)
- Zero-fabrication rule: every factual claim requires ≥ 3 independent sources; skips publishing if sources insufficient
- Fetches from The Verge AI section as primary seed, then searches for verification
- Recent articles published (2026-05-19 to 2026-05-20): Nvidia Computex GB300/Vera Rubin chips, SSI $2B raise (Ilya Sutskever), AI inference cost trends, Physical Intelligence $400M robotics, synthetic data risks, OpenAI operator upgrades, Google I/O Gemini real-time, AI benchmark critique, Amazon Nova price-performance, slow AI case, OpenAI o3/o4-mini release, AI-native browsers (Arc/Dia)

### Urgent Email Alert Cron (`4e55bac5`)
- Runs periodically; executes `bash /Users/jkneen/clawd/scripts/email-alert-check.sh`
- Reports only on script errors; if clean, replies `HEARTBEAT_OK`
- Status: healthy as of 2026-05-20

### Digest Cron (`f4ec2601`)
- Daily; processes Gmail + Calendar summary
- Last seen: 2026-05-19 09:45 UTC

---

## CodeSurf / Contex Protocol

Every agent session must open with:
1. `mcp__contex__peer_set_state(tile_id=$CARD_ID, tile_type="terminal", status="idle", task="Ready")`
2. `mcp__contex__peer_get_state(tile_id=$CARD_ID)`

File conflict rule: **never edit a file that a linked peer lists in their `files` array** — send `peer_send_message` first and wait.

Key tool prefixes: `mcp__contex__peer_set_state`, `peer_get_state`, `peer_send_message`, `peer_read_messages`, `peer_add_todo`, `peer_complete_todo`, `canvas_create_tile`, `terminal_send_input`, `chat_send_message`.

---

## Open Threads

- **MC Gateway is down** — `mc-gateway-894a3d5b` has been connection-refused across multiple polls as of 2026-05-20. Worth determining whether it's a stopped process, broken config, or decommissioned provider before spawning tasks that depend on it.
- **world-state.json last at revision 121 (2026-04-18)** — last recorded world-revision activity was mid-April; `feature-requests.json` pending queue is empty.
