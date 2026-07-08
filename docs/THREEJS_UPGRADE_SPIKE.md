# Three.js upgrade spike (r128 → modern)

**Status:** research only — do **not** upgrade in-tree without a dedicated branch and visual QA.

## Current state

- Client loads **Three r128** from CDN (`cdnjs` + `cdn.jsdelivr.net/npm/three@0.128.0/examples/js/...`).
- Uses the **legacy `examples/js` global scripts** pattern:
  - `THREE.GLTFLoader`
  - `THREE.EffectComposer` / `RenderPass` / `ShaderPass` / `UnrealBloomPass` / `BokehPass` / `FXAAShader` / …
- Game code is a single shared IIFE assembled from `src/game/*` (no ES modules, no bundler).

## Why upgrading is hard

| Area | Risk |
|------|------|
| `examples/js` → `examples/jsm` | Globals disappear; need import maps or a bundler |
| WebGLRenderer defaults | color space / outputEncoding (`sRGB`) changed post-r15x |
| Materials | `MeshStandardMaterial` lights + encoding assumptions |
| Postprocessing | EffectComposer package path and pass constructors drift |
| Geometry | BufferGeometry is already used; older helpers may still differ |
| Lights | physically correct lights / intensity scale |
| GLTFLoader | API mostly stable; Draco/KTX2 optional |
| Shadows | map size / bias / type defaults |

r128 → current is **multiple major jumps**. A single big-bang is high risk for a visual flight sim.

## Recommended path (when you choose to do it)

1. **Pin a target** — e.g. `three@0.160.0` or latest LTS-ish, not “whatever is newest today”.
2. **Introduce a bundler or import map** only for Three + addons:
   - Option A: Vite + `import * as THREE from 'three'` + `three/addons/...`
   - Option B: keep vanilla HTML with import map pointing at esm.sh/skypack (CDN ES modules)
3. **Adapter layer** in one module (`src/game/00-three-bridge.js`) that re-exports loaders/passes so the rest of the game does not import paths everywhere.
4. **Port post-FX first** in isolation (composer + bloom + FXAA), screenshot-diff against `baseline-spawn-day.png`.
5. **Then materials/color space**, then lights, then GLTF edge cases.
6. **Do not** mix r128 examples/js with modern modules.

## Explicit non-goals for this spike

- No CDN URL bump “just to be current” without the jsm migration.
- No runtime feature work during the port.
- No forced migration of the whole 20k-line game to TypeScript in the same PR.

## Estimate

| Slice | Effort | Notes |
|-------|--------|-------|
| Import-map / Vite scaffold + load empty scene | S | Prove boot |
| Composer/postFX parity | M | Highest visual risk |
| Materials + color management | M | Day/night will look “off” until tuned |
| Full game pass + screenshot QA | L | Multi-day |

## Decision

**Defer full upgrade.** Prefer continuing modularization + allocation/perf work on r128 until there is a product need (WebGPU, security, missing loader features). When ready, open a long-lived `three-upgrade` branch and treat visual regression as the release gate.
