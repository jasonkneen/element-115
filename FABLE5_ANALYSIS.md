# Fable-5 Project Analysis: Element-115

Date: 2026-07-02  
Project path: `/Users/jkneen/Downloads/ships`  
Mode: read-only analysis; this document was created after the analysis at the user's request.

## Executive Summary

`ships` appears to be **Element-115**, a browser-based 3D flight simulator with arcade flight physics, GLB aircraft, HUD/combat systems, weather, replay tooling, and optional multiplayer.

The project is currently shaped as a mostly self-contained browser game: almost all client/gameplay logic lives in one very large HTML file, `flight-sim3.html`, supported by Bun-based local servers, build scripts, static assets, and agent-oriented development notes.

The largest engineering risks are:

1. No automated regression test suite or CI.
2. A 19k+ line monolithic client file.
3. Old Three.js r128 scripts loaded from external CDNs.
4. Duplicated and client-trusting multiplayer server logic.
5. Fragile regex-based asset discovery in the production build.
6. Large binary assets and screenshots committed into git history.

The best next step is to add a minimal automated browser smoke test around the existing `window.__sim` hook before making more gameplay changes.

## Evidence Snapshot

Key files identified during the analysis:

- `index.html` — redirect entry point.
- `flight-sim3.html` — main game/client implementation.
- `package.json` — Bun scripts and dependencies.
- `tweaks-server.mjs` — Bun dev server, tweak API, and integrated multiplayer WebSocket host.
- `multiplayer-server.mjs` — standalone multiplayer WebSocket server.
- `tools/build-game.mjs` — static build/asset-copy pipeline.
- `tools/serve-dist.mjs` — dist preview server.
- `netlify.toml` — static deployment config.
- `.codesurf/PERF_BASELINE.md` — performance and regression notes.
- `progress.md` — prior issue/progress notes.
- `HERMES_HANDOFF_RETICLE_TARGETING.md` — reticle targeting handoff notes.

## What the Project Is

Element-115 is a browser-playable 3D flight simulator/game.

Observed capabilities from repository structure and documented files:

- Aircraft selection and GLB model loading.
- Arcade flight simulation.
- HUD and reticle systems.
- Combat/damage behavior.
- Weather/visual effects.
- Replay/dev automation hooks.
- Optional multiplayer via WebSockets.
- Static Netlify deployment.
- Agent-assisted development scripts.

## Tech Stack

### Client

- Vanilla HTML/CSS/JavaScript.
- Main client file: `flight-sim3.html`.
- Three.js r128 from CDN scripts.
- No React, Vite, TypeScript, or module bundler detected.

### Runtime and Tooling

- Bun runtime.
- `package.json` declares Bun engine usage.
- `concurrently` appears to be the main development dependency.

### Server

- Bun HTTP server in `tweaks-server.mjs`.
- Bun/WebSocket multiplayer server in `multiplayer-server.mjs`.
- A second multiplayer host is embedded in `tweaks-server.mjs`.

### Deployment

- Static Netlify deployment through `netlify.toml`.
- Build output goes to `dist/`.
- Production build creates `dist/game.html` and copies assets.

### Testing

No formal test suite, lint command, or CI was identified during the analysis.

Existing validation appears to be mostly manual/browser-based, with screenshot-diffing described in `.codesurf/PERF_BASELINE.md`.

## Entry Points and Architecture

### `index.html`

`index.html` is a redirect shim into the game.

It points users toward `flight-sim3.html`.

### `flight-sim3.html`

`flight-sim3.html` is the main application and game runtime.

It contains:

- Game loop.
- Physics.
- HUD.
- Combat/damage systems.
- Graphics and visual effects.
- Input handling.
- Multiplayer client behavior.
- Debug/test handle: `window.__sim`.

The analysis found `window.__sim` around `flight-sim3.html:11260`. This is important because it can support automated smoke tests without relying on manual takeoff flows.

### `tweaks-server.mjs`

`tweaks-server.mjs` provides:

- Local static serving.
- Plane tweak REST APIs.
- Localhost-only write endpoints for tweak files.
- Integrated multiplayer WebSocket behavior.

The server includes path traversal protection around static serving, reported around `tweaks-server.mjs:177-181`.

### `multiplayer-server.mjs`

`multiplayer-server.mjs` is a standalone WebSocket multiplayer server.

It appears to duplicate room/player/state logic that also exists inside `tweaks-server.mjs`.

### `tools/build-game.mjs`

`tools/build-game.mjs` builds the distributable game.

Reported behavior:

- Regex-scans `flight-sim3.html` for asset references.
- Copies assets into `dist/`.
- Wraps the source in a base64 encoded DOM bootstrap for `game.html`.
- Notes that the obfuscation is not security.

The build script reportedly has a manifest/security caveat around `tools/build-game.mjs:147`.

### `tools/serve-dist.mjs`

`tools/serve-dist.mjs` serves the built static output for preview.

## How to Run, Build, and Preview

Discovered commands:

```bash
bun install
bun run start
```

Likely starts:

- `tweaks-server.mjs` on port `8765`.
- `multiplayer-server.mjs` on port `8787`.

Other discovered commands:

```bash
bun run web
bun run mp
bun run build
bun run preview:dist
```

Expected build output:

- `dist/game.html`
- copied static assets

## Verification Status

No formal automated verification was found.

The current practical verification approach appears to be:

1. Run the dev or preview server.
2. Open the browser game.
3. Use visual inspection or screenshot-diffing.
4. Use `window.__sim` where possible for controlled simulation state.

Project memory from the Fable-5 analysis indicates browser testing should spawn at altitude through `window.__sim`, because runway takeoff may crash immediately and create noisy test failures.

## Notable Risks and Technical Debt

### 1. Monolithic Client File

Most game/client logic lives in `flight-sim3.html`, reported as roughly 19,606 lines and ~835KB.

Risk:

- Hard to reason about isolated changes.
- High chance of accidental coupling.
- Difficult parallel development.
- Hard to test without full browser execution.

Recommended mitigation:

- Add automated smoke tests first.
- Extract only stable seams after tests exist.
- Avoid broad refactors without a browser regression harness.

### 2. No Automated Test Suite

No test suite, linting setup, or CI was found.

Risk:

- Behavioral regressions can ship silently.
- Manual browser checks become the only defense.
- Performance or spawn-state bugs can reappear.

Recommended mitigation:

- Add a Playwright smoke test that loads the game, spawns via `window.__sim`, and checks for console/page errors.

### 3. CDN Dependency on Old Three.js r128

`flight-sim3.html` loads Three.js r128 and non-module `examples/js` scripts from third-party CDNs, reported around `flight-sim3.html:2078-2089`.

Risk:

- CDN outage breaks production.
- No SRI means external script integrity is not pinned.
- Three.js r128 is old.
- Later Three.js versions removed the old non-module `examples/js` pattern, so upgrading will require real migration work.

Recommended mitigation:

- Vendor the exact r128 scripts into the repo.
- Or add SRI hashes as a short-term fallback.
- Plan a separate Three.js upgrade only after tests exist.

### 4. Multiplayer Trusts Client State

The multiplayer servers reportedly accept client-supplied `msg.id` and overwrite player state:

- `multiplayer-server.mjs:88-96`
- `tweaks-server.mjs:222-231`

Risk:

- Client impersonation is trivial.
- No reliable server-side identity.
- No origin check, auth, rate limit, or room cap was identified.
- Unsafe to expose beyond trusted local/LAN use.

Recommended mitigation:

- Server assigns player IDs on join.
- Ignore client-supplied player IDs for authoritative state updates.
- Add origin checks/rate limits before public exposure.

### 5. Duplicated Multiplayer Logic

WebSocket room/player/state logic appears duplicated between:

- `tweaks-server.mjs`
- `multiplayer-server.mjs`

Risk:

- Bug fixes can land in one server and miss the other.
- Behavior can drift.
- Security fixes are easy to apply incompletely.

Recommended mitigation:

- Extract shared room/session logic into one module.
- Have both servers import it.

### 6. Fragile Asset Discovery in Build

`tools/build-game.mjs` uses regex-based asset discovery, reportedly around `tools/build-game.mjs:41`, with hardcoded special cases around `tools/build-game.mjs:50-52`.

Risk:

- Dynamically referenced assets may not be copied to `dist/`.
- Build can succeed while runtime assets are missing.
- Future contributors can add asset paths that the build never sees.

Recommended mitigation:

- Move to an explicit asset manifest.
- Or expose a central asset registry consumed by both game code and build script.

### 7. Git Repository Bloat

Fable-5 reported large tracked binaries and many screenshots in git history, including examples such as:

- `final.wav` around 45MB.
- `crash-tune.mp3` around 11MB.
- `final.mp3` around 5.8MB.
- Root-level session screenshots.
- `.git` around 242MB.

Risk:

- Slow clone/fetch operations.
- Large diffs from binary churn.
- More expensive collaboration.

Recommended mitigation:

- Move screenshots to a gitignored archive path.
- Stop committing generated session artifacts.
- Consider `git filter-repo` for large historical binaries if acceptable for collaborators.

### 8. Entry-Point Inconsistency

The dev server default route reportedly points to `plane-select.html`, while `index.html` and the dist build point directly at the main game.

Risk:

- Dev and production launch flows differ.
- A fix verified through one front door may not cover another.

Recommended mitigation:

- Pick one canonical entry point.
- Make dev, preview, and production routes match.

### 9. Possibly Stale Known-Bug Docs

The analysis found possible unresolved notes in:

- `progress.md`
- `HERMES_HANDOFF_RETICLE_TARGETING.md`

Mentioned issues:

- Free traffic kill awarded at spawn.
- Gunsight/reticle gated behind `INPUT_FLAGS.mouseFlight`, affecting keyboard players.
- Resize handler clamping normalized mouse values as pixels.

The analysis did not confirm whether these still reproduce.

Recommended mitigation:

- Reproduce each issue in browser.
- Fix any real bug.
- Strike or update stale notes.

## Top 5 Next Actions

### 1. Add a Minimal Automated Browser Smoke Test

Create a Playwright smoke test that:

1. Starts the local server.
2. Opens `flight-sim3.html`.
3. Uses `window.__sim` to spawn at altitude.
4. Asserts no page errors.
5. Asserts no serious console errors.
6. Asserts score starts at `0`.
7. Optionally captures a screenshot for visual diffing.

This should be the first next action because it makes every later change safer.

### 2. Vendor Three.js r128 Scripts

Bring the exact currently-used Three.js r128 files into the repository or static asset tree.

Short-term goal:

- Stop production from depending on external CDNs.

Do not start a Three.js upgrade until tests exist.

### 3. Deduplicate and Harden Multiplayer

Extract shared multiplayer logic from:

- `tweaks-server.mjs`
- `multiplayer-server.mjs`

Then change identity handling so:

- Server assigns player IDs.
- Client cannot overwrite another player's ID.
- Server validates message shape.
- Optional public exposure requires origin/rate-limit/room cap controls.

### 4. Replace Regex Asset Discovery

Replace build-time regex asset scanning in `tools/build-game.mjs` with one of:

- explicit asset manifest,
- shared asset registry,
- build-generated asset graph.

Acceptance criterion:

- If a game asset is referenced by gameplay code, the build cannot silently omit it from `dist/`.

### 5. Triage Existing Bug/Handoff Notes

Review:

- `progress.md`
- `HERMES_HANDOFF_RETICLE_TARGETING.md`

For each recorded issue:

1. Reproduce in browser.
2. Mark as still real or stale.
3. Fix real issues.
4. Update docs to match current code.

## Suggested First Smoke Test Contract

A useful initial test should prove this exact claim:

> The game can load in a browser, initialize simulation state at altitude through `window.__sim`, avoid page/console errors during a short run, and start without awarding score/kills before user action.

Minimum assertions:

- Page loads.
- `window.__sim` exists.
- Altitude spawn succeeds.
- No uncaught page errors.
- Score is `0` after spawn.
- Kill count is `0` after spawn.
- One screenshot can be captured for visual comparison.

This test directly targets the riskiest known areas: boot, simulation control, browser runtime errors, and the previously documented free-kill-at-spawn bug.

## Recommended Order of Work

1. Add browser smoke test.
2. Run it against the current app to establish baseline.
3. Fix any baseline failure or document it explicitly.
4. Vendor Three.js scripts.
5. Re-run smoke test.
6. Deduplicate multiplayer logic.
7. Re-run smoke test and any multiplayer-specific manual check.
8. Replace asset discovery with manifest/registry.
9. Run build and preview output.
10. Triage stale bug docs.

## Final Assessment

Element-115 has a strong amount of implemented gameplay packed into a simple deployable shape. The main issue is not missing ambition; it is missing safety rails.

The project should not start with a large refactor. It should start with a small, targeted browser smoke test around `window.__sim`, then use that test as the guardrail for infrastructure fixes: vendored dependencies, multiplayer cleanup, asset manifesting, and documentation triage.
