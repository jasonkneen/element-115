# Game source layout

`flight-sim3.html` is **assembled** from modular sources. Edit the modules, then assemble.

## Layout

```
src/
  shell/
    head.html          # DOCTYPE … <script> + (() => { 'use strict';
    tail.html          # })(); </script> </body> </html>
  game/
    MODULES.txt        # load order (one .js file per line)
    01-boot-config.js … 08-style-biome.js
    09a-fx-combat.js / 09b-clouds-sky.js / 09c-ambient.js / 09d-audio.js
    10-physics.js … 11-jet-visual-cam.js
    12a-targeting.js / 12b-mission.js / 12c-hud-panels.js
    13-main-loop.js … 16-gfx-panel-ap.js
```

Modules are plain sequential fragments concatenated into **one IIFE**. They share
the same lexical scope as the original monolith (no `import`/`export`, no bundler).

## Commands

```bash
bun run assemble         # write flight-sim3.html from src/
bun run assemble:check   # fail if flight-sim3.html is stale
bun run test:smoke       # Playwright headless __sim smoke
bun run test             # assemble:check + smoke
bun run build            # assemble + package dist/
```

## Editing rules

1. **Prefer editing `src/game/*.js`**, not the assembled `flight-sim3.html`.
2. After edits: `bun run assemble` (or just `bun run build`).
3. New file? Add it to `MODULES.txt` in the correct order (dependencies above).
4. Keep `// @module src/game/<name>` as the first line of each module.
5. Do not wrap modules in their own IIFE — they must share outer scope.
6. `getHeight` is stringified into a Web Worker — keep its closure const-only
   (see comment in `02-worldgen.js`).

## Why this shape

- One shared scope avoids rewriting 20k lines of globals into ES modules.
- `tools/build-game.mjs` still ships a single encoded `game.html`.
- Sections map to named files so physics, HUD, terrain, and combat can be
  refactored independently without merge wars on a 21k-line HTML file.

## Next extraction targets

| Module | Opportunity |
|--------|-------------|
| `09a-fx-combat.js` | Particle pools vs weapons/combat loop |
| `04-terrain.js` | Near / far / horizon chunk systems |
| `10-physics.js` | Fixed-step core vs input mapping |
| Three.js | See `docs/THREEJS_UPGRADE_SPIKE.md` (deferred) |
