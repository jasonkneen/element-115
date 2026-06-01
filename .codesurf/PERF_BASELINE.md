# flight-sim3.html — Performance Baseline (2026-06-01)

Captured via Playwright headless on **real GPU: ANGLE Apple M3 Max (Metal)** — FPS is trustworthy.
Viewport 1600×900, fresh context (no saved gfx settings → app defaults).

## Headline numbers (default gfx)
| Metric | Value | Notes |
|---|---|---|
| **FPS** | ~9–26 (settling) | frame-bound by work, not vsync |
| **Full frame time** | ~38 ms | |
| **Pure render (GPU+submit, gl.finish)** | ~3–6 ms | **NOT the bottleneck** |
| **Est. animate() JS time** | **~25–30 ms** | **THE bottleneck (CPU/main thread)** |
| Draw calls (main pass) | **1007** | high; ~6 ms CPU submission |
| Triangles (main pass) | 2.76 M | |
| Active pixelRatio | 1.18 (renderScale 1.0 × resolutionScale 1.18) | dpr=1 here; on Retina caps at 2.35 |
| GPU programs | 59 | (1225 material *objects* dedup to 59 shaders) |
| GPU geometries | 806 | |
| GPU textures | 36 | |

## Scene graph (traversed every frame for matrix updates)
- total objects: **2201** | meshes: 1477 | instancedMeshes: 226 (24,181 instances drawn) | groups: 332
- points: 17 | lines: 9 | lights: 11
- unique materials: 1225 | unique geometries: 1079 | unique textures: 18
- **frustumCulling disabled on 245 objects** (always drawn)
- approx visible verts: 6.38 M
- material types: MeshBasic 867, MeshStandard 442, MeshPhong 264, ShaderMaterial 145, Sprite 121

## Camera / fog (render distance)
- camera: fov 67.5, near 0.8, **far 14000** (already huge — NOT the limiter)
- fog: linear, near 456, **far 6209** ← real visibility limiter, color #e8b888
- Chunks: CHUNK_SIZE 600 × RENDER_RADIUS 3 (7×7 high-detail, ~4.2 km)
- Far chunks: FAR_CHUNK_SIZE 1800 × FAR_RADIUS 4 (9×9, ~16.2 km), FAR_CHUNK_RES 36
- ROCKS_PER_CHUNK 160; flora instanced (pines/cacti/shrubs/boulders)

## Diagnosis / priority order
1. **animate() JS (~30 ms)** — dominant. 30 update fns/frame + 204 Vector3 / 53 Color allocations (GC churn). PROFILE to find which fns.
2. **Draw calls (1007 → ~6 ms submit)** — batch/merge/instance opportunities; 245 frustum-cull-disabled.
3. **Fill-rate** — supersample default (resolutionScale 1.18; 2.35 cap on Retina) is wasteful; add FPS-adaptive res (none exists today).
4. **Render distance** — gated by fog-far + far-chunk ring (NOT camera.far). Move fog & chunks together; use LOD/instancing to see farther for equal cost.

## RESULTS — changes shipped (2026-06-01)

All verified on M3 Max via Playwright (0 console errors, no visual regression vs `baseline-spawn-day.png` → `after-spawn-day.png`). The M3 is vsync-locked with ~80% idle, so most perf wins are **reasoned for weak/integrated GPUs + Retina**, not observable as fps here — measured facts below.

| # | Change | Verified |
|---|---|---|
| 2 | DEFAULTS.resolutionScale 1.18→1.0 | new-user pixelRatio **2.35→2.0** on dpr=2 = **~28% fewer pixels** (5.5→4.0 MP). Ultra preset keeps 1.18; slider unchanged; returning users unaffected. |
| 3 | FPS-adaptive resolution (new) | downscaled to 0.6 floor under forced low-fps; recovered 1.2→1.8→2.0 when idle; **never persists** renderScale/resolutionScale (no localStorage corruption); panel toggle + disable-reset + 4s warmup. Runtime-only `adaptiveScale` folded into applyRenderScale. |
| 4 | renderer.compile() pre-warm | programs compiled at load instead of lazily mid-flight. |
| 5 | Render-distance slider (new) | fog.far 6210 → **12419 at 2.0** (≈2×, < camera.far 14000, **no near>far inversion** at 0.6/1.0/2.0); FAR_RADIUS + fog move in lockstep; default 1.0 == stock. Near-free (far terrain already drawn). |
| 6 | Time-budgeted chunk queue | `processChunkBuildQueues(2.5ms,6)` caps per-frame build cost (was fixed (2,1)); observed chunkBuild capping at ~2.35ms while clearing backlog instead of hitching. Init/regen build-all preserved. |
| 7 | Near-chunk InstancedMesh dispose | code-correct (dispose instanceMatrix on unload, shared geo/mat untouched); geometries bounded (~268). Long-run plateau not observed (couldn't sustain flight headless) — reasoned. |
| 8 | Far-chunk cloned-material dispose | code-correct; clone is per-chunk (line 3738), safe to dispose. |
| 9 | updateAtmospheric scratch temps | ~11 Vector3 + 1 Quaternion/frame eliminated; emit/emitCluster/addPoint all copy/clone internally (no aliasing); identical visuals. |
| 10 | Gamepad-clobbers-mouse-fire bug | **fireHeld now survives the gamepad poll** (was forced false every frame → hold-to-fire died after 1 frame). Separate `mouseFireHeld` flag; verified across frames. |

**DEMOTED after measurement:** shadow autoUpdate=false — shadow pass measured only **0.13 ms** (~4% of busy render) and the shadow cam follows the plane, so gating on movement saves ~0 in flight + risks shadow swim. Not worth it → menu.

## ROUND 2 — menu items (2026-06-01, after user approval "do it")

| Item | Status | Detail / verification |
|---|---|---|
| FXAA + motion-blur off on `low` preset | ✅ shipped | low now fully bypasses the EffectComposer → direct `renderer.render` (saves the full-screen post passes on weak GPUs). No AA on low; users re-enable via the panel. |
| `renderDistance` added to all presets | ✅ shipped | low 0.7 / medium 1.0 / high 1.3 / ultra 1.6 — selecting a preset now sets the far ring + fog distance coherently. |
| First-run device-tier autodetect | ✅ shipped | no-saved-settings only: mobile/≤4 cores → low, ≤8 → medium, else defaults. Verified M3 Max (16 cores) → defaults; gated on saved==null so returning users win. (Dropped the agent's `dpr>=2→medium` trigger — it misfired on Retina desktops; core-count is the reliable signal, and the supersample default is already fixed.) |
| `updateJetVisual` dt-correctness | ✅ shipped | control-surface/wing-flex smoothing now frame-rate-normalized via an internally-measured dt (`_jvBlend`), no call-site plumbing/NaN risk. Verified `aero_flex` all-finite. |
| Airfield lights → InstancedMesh | ✅ shipped | 42 edge (Sphere) + 16 approach (Box) meshes → **2 draw calls**. Approach width baked into per-instance matrix X-scale; night-FX pulse/sequence preserved via proximity-gated `setMatrixAt` (zero cost when away from the field). Verified at night: opacity 0.04→1.1, scale pulse 0.72→1.9, renders correctly. |
| 3rd "horizon" ring (15-24 km) | ✅ shipped (round 3) | Coarse clutter-free LOD tier (5400 m chunks, 24 res, y=-16, renderOrder -2, fog-pinned). `HORIZON_RADIUS` 0 at rd≤1.0 (true no-op: camera.far 14000, fog 6210, 0 horizon chunks — verified) → grows 0→4 as rd 1.0→2.0, driving `camera.far` (→26.7k) + fog ceiling (→21.9k) in lockstep. **Depth-precision concern was unfounded**: precision ∝ (1/near − 1/far), and with near=0.8 the 1/far term is negligible — doubling far 14k→28k changes precision ~0.003% (verified by experiment: no z-fighting). At rd 2.0: 61 horizon chunks, terrain visible to ~22 km, clean fog blend, no void/seam artifacts. Disposes cleanly when lowered. |
| Dynamic-content shader pre-warm | ⏭ deferred | Requires constructing multiplayer planes / weapons / cloud variants at boot — real risk of audio/network/gameplay side-effects (advisor-flagged). Payoff (rare mid-flight compile blip) doesn't justify the correctness risk. |
| Flight feel / balance knobs | ⏭ needs direction | Deliberately not changed — needs the user's taste (which dials, which way). All live in `gfx`/`scene.userData.__flight*`, tunable from the panel. |

## Guardrails
- Single monolithic 18,895-line file; edits must stay coherent (no parallel worktree writers).
- Preserve ALL features (gfx panel, presets, postFX, multiplayer, replay). Do not change flight feel/balance without asking — surface as options.
- Screenshot-diff after each change batch (only behavioral regression check). Baseline shot: `baseline-pose1.png`.
