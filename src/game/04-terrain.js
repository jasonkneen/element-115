// @module src/game/04-terrain.js
// =============================================================
//  TERRAIN CHUNKS
// =============================================================
const CHUNK_SIZE = 600;
const CHUNK_RES = 60;
const RENDER_RADIUS = 3;          // 7×7 high-detail chunks
const FAR_CHUNK_SIZE = 1800;      // 3× high-detail size
const FAR_CHUNK_RES = 36;         // low-res
let FAR_RADIUS = 4;               // 9×9 far chunks → covers ~16.2 km (driven by gfx.renderDistance)
const ROCKS_PER_CHUNK = 160;
// HORIZON ring — a 3rd, ultra-coarse, clutter-free LOD tier for dramatic distance.
// 3× the far-chunk size at half its resolution. HORIZON_RADIUS is 0 by default (no
// horizon ring, identical to the original world) and only grows when gfx.renderDistance
// exceeds 1.0 — so the feature is fully opt-in via the slider and costs nothing at default.
const HORIZON_CHUNK_SIZE = 5400;
const HORIZON_CHUNK_RES = 24;
let HORIZON_RADIUS = 0;
const chunks = new Map();
const farChunks = new Map();
const horizonChunks = new Map();
const pendingChunkBuilds = [];
const pendingChunkKeys = new Set();
const pendingFarChunkBuilds = [];
const pendingFarChunkKeys = new Set();
const pendingHorizonBuilds = [];
const pendingHorizonKeys = new Set();
const chunkKey = (cx, cz) => `${cx},${cz}`;

function queueChunkBuild(list, set, map, cx, cz, priority = 0, tier) {
  const key = chunkKey(cx, cz);
  if (map.has(key)) return;
  if (set.has(key)) {
    const existing = list.find(job => job.key === key);
    if (existing) existing.priority = Math.min(existing.priority, priority);
    // Re-request on touch: dedupe in request() makes this free, and it
    // recovers a job whose earlier worker request was lost.
    if (tier) heightPrefetch.request(tier, cx, cz);
    return;
  }
  set.add(key);
  list.push({ key, cx, cz, priority });
  if (tier) heightPrefetch.request(tier, cx, cz);
}

function trimPendingChunkBuilds(list, set, wanted) {
  for (let i = list.length - 1; i >= 0; i--) {
    if (wanted.has(list[i].key)) continue;
    set.delete(list[i].key);
    list.splice(i, 1);
  }
}

// =============================================================
//  HEIGHT PREFETCH — a Web Worker computes chunk height grids off-thread.
//  Pure latency hiding: queued jobs whose grids have arrived skip the
//  per-vertex getHeight pass (the bulk of a chunk build); jobs without
//  grids build synchronously exactly as before, so worker failure or a
//  blocked blob: CSP degrades to current behavior. getHeight's entire
//  closure is immutable consts (SEED + noise helpers — no biome inputs),
//  so cached grids never go stale; biome switches reuse them as-is.
//  ONE worker: a 61×61 grid is ~45k noise evals (~1-3 ms in-worker), so the
//  worst burst (~7 near + a few far jobs on a cell crossing) clears in a
//  couple of frames — faster than the build budget drains the queue anyway.
const heightPrefetch = (() => {
  const TIERS = {
    near: { size: CHUNK_SIZE, res: CHUNK_RES },
    far:  { size: FAR_CHUNK_SIZE, res: FAR_CHUNK_RES },
    hor:  { size: HORIZON_CHUNK_SIZE, res: HORIZON_CHUNK_RES },
  };
  const results = new Map();   // 'tier:cx,cz' -> Float32Array (grid, row-major, x fastest)
  const inFlight = new Map();  // 'tier:cx,cz' -> request time (performance.now ms)
  const MAX_RESULTS = 160;     // worst case ~1.2 MB; FIFO eviction
  const DEFER_MS = 250;        // head job falls back to sync compute past this age
  let worker = null;
  try {
    // Worker source is assembled from the live functions so the terrain math
    // has exactly one definition. If getHeight ever grows a mutable input,
    // this closure list must be revisited.
    const src = [
      `const SEED=${SEED},SEED_OX=${SEED_OX},SEED_OY=${SEED_OY};`,
      `const hash2=${hash2.toString()};`,
      `const smoothstep=${smoothstep.toString()};`,
      `const clamp01=${clamp01.toString()};`,
      `const smoothstepRange=${smoothstepRange.toString()};`,
      vnoise.toString(),
      fbm.toString(),
      getHeight.toString(),
      // Grid order matches PlaneGeometry(size,size,res,res).rotateX(-PI/2):
      // i = iz*(res+1)+ix, local x/z = idx*(size/res) - size/2 (all steps are
      // exact binary floats, fround keeps parity with the f32 position buffer).
      'onmessage = (e) => {',
      '  const { key, cx, cz, size, res } = e.data;',
      '  const gw = res + 1, step = size / res, half = size / 2;',
      '  const cxW = (cx + 0.5) * size, czW = (cz + 0.5) * size;',
      '  const heights = new Float32Array(gw * gw);',
      '  for (let iz = 0; iz < gw; iz++) {',
      '    const lz = Math.fround(iz * step - half);',
      '    for (let ix = 0; ix < gw; ix++) {',
      '      heights[iz * gw + ix] = getHeight(cxW + Math.fround(ix * step - half), czW + lz);',
      '    }',
      '  }',
      '  postMessage({ key, heights }, [heights.buffer]);',
      '};',
    ].join('\n');
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    worker.onmessage = (e) => {
      const { key, heights } = e.data;
      inFlight.delete(key);
      // Results never trigger builds — only the pending queues do — so a grid
      // arriving for a trimmed/evicted chunk just sits here until FIFO eviction.
      if (results.size >= MAX_RESULTS) results.delete(results.keys().next().value);
      results.set(key, heights);
    };
    worker.onerror = () => { worker = null; inFlight.clear(); }; // permanent sync fallback
  } catch (e) { worker = null; }
  return {
    has(tier, key) { return results.has(tier + ':' + key); },
    request(tier, cx, cz) {
      if (!worker) return;
      const key = tier + ':' + cx + ',' + cz;
      if (results.has(key) || inFlight.has(key)) return;
      inFlight.set(key, performance.now());
      worker.postMessage({ key, cx, cz, size: TIERS[tier].size, res: TIERS[tier].res });
    },
    take(tier, key) {
      const k = tier + ':' + key;
      const h = results.get(k);
      if (h) results.delete(k);
      return h;
    },
    canDefer(tier, key) {
      if (!worker) return false;
      const t = inFlight.get(tier + ':' + key);
      return t !== undefined && performance.now() - t < DEFER_MS;
    },
  };
})();

// Time-budgeted chunk builder. Builds at least one near + one far chunk per call
// (so the world always makes progress), then keeps going only while under the ms
// budget and below the hard cap. A weak CPU naturally builds fewer chunks/frame
// (smoother) and a fast CPU more (faster fill) — replaces the old fixed counts
// that handed slow machines the exact same multi-ms makeChunk hitch as the M3.
function processChunkBuildQueues(maxMs = 2.5, hardCap = 6, allowDefer = false) {
  const start = performance.now();
  // One guaranteed build per CALL (not per tier): the old per-tier `built === 0`
  // escape could stack a near + far + horizon build in one frame — three multi-ms
  // synchronous hitches back to back. The shared budget below still guarantees
  // forward progress (first build always runs) while spreading the rest out.
  let built = 0;
  const overBudget = () => built >= hardCap || (built > 0 && performance.now() - start >= maxMs);
  const drain = (list, set, map, tier, makeFn) => {
    if (list.length > 1) list.sort((a, b) => a.priority - b.priority);
    while (list.length && !overBudget()) {
      // Prefer the best-priority job whose worker grid has already arrived —
      // that build skips the per-vertex getHeight pass entirely.
      let idx = -1;
      for (let i = 0; i < list.length; i++) {
        if (heightPrefetch.has(tier, list[i].key)) { idx = i; break; }
      }
      if (idx === -1) {
        // Nothing prefetched. In the live animate loop we can wait a frame or
        // two for the worker instead of paying the sync height cost — but only
        // while the head's request is in flight and young (DEFER_MS cap), so a
        // stalled/dead worker degrades to today's synchronous builds.
        if (allowDefer && heightPrefetch.canDefer(tier, list[0].key)) break;
        idx = 0;
      }
      const job = list.splice(idx, 1)[0];
      set.delete(job.key);
      if (!map.has(job.key)) map.set(job.key, makeFn(job.cx, job.cz, heightPrefetch.take(tier, job.key)));
      built++;
    }
  };
  drain(pendingChunkBuilds, pendingChunkKeys, chunks, 'near', makeChunk);
  drain(pendingFarChunkBuilds, pendingFarChunkKeys, farChunks, 'far', makeFarChunk);
  drain(pendingHorizonBuilds, pendingHorizonKeys, horizonChunks, 'hor', makeHorizonChunk);
}

// Sedimentary strata — bands of color at fixed elevations. Mutable so the
// biome switcher can swap the palette in-place without touching chunk code.
const STRATA = currentBiome.strata.map(s => ({ h: s.h, c: new THREE.Color(s.c) }));
const CLIFF_TINT = new THREE.Color(currentBiome.cliffTint);

function strataColor(h, out) {
  for (let i = 0; i < STRATA.length - 1; i++) {
    if (h <= STRATA[i + 1].h) {
      const t = (h - STRATA[i].h) / (STRATA[i + 1].h - STRATA[i].h);
      out.copy(STRATA[i].c).lerp(STRATA[i + 1].c, Math.max(0, Math.min(1, t)));
      return out;
    }
  }
  out.copy(STRATA[STRATA.length - 1].c);
  return out;
}

// Shared rock asset (one geo + one mat reused across all chunks via instancing)
const rockGeo = (() => {
  const g = new THREE.DodecahedronGeometry(1, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = Math.sin(x * 4.7 + SEED) * Math.cos(y * 3.1) * Math.sin(z * 5.3);
    p.setXYZ(i, x * (1 + n * 0.28), y * (1 + n * 0.18), z * (1 + n * 0.22));
  }
  g.computeVertexNormals();
  return g;
})();

function applyDistanceCulling(material, defaultCullDistance = 450.0) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCameraPosition = {
      get value() { return camera ? camera.position : new THREE.Vector3(); }
    };
    shader.uniforms.uCullDistance = {
      get value() {
        if (typeof window !== 'undefined' && window.gfx && window.gfx.floraCullDistance != null) {
          return window.gfx.floraCullDistance * (defaultCullDistance / 450.0);
        }
        return defaultCullDistance;
      }
    };

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       uniform vec3 uCameraPosition;
       uniform float uCullDistance;
      `
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 instanceWorldPos = (modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 )).xyz;
        float distToCam = distance(instanceWorldPos, uCameraPosition);
        if (distToCam > uCullDistance) {
          transformed = vec3(0.0);
        } else {
          float fadeStart = uCullDistance * 0.85;
          if (distToCam > fadeStart) {
            float fadeFactor = 1.0 - ((distToCam - fadeStart) / (uCullDistance - fadeStart));
            transformed *= fadeFactor;
          }
        }
      #endif
      `
    );
  };
}

const rockMat = new THREE.MeshLambertMaterial({ color: 0x9c6840 });
applyDistanceCulling(rockMat, 350.0);


// =============================================================
//  PROCEDURAL FLORA & BOULDERS — stylised low-poly, instanced,
//  seed-deterministic, biome-gated by elevation + slope
// =============================================================

// --- Shared stylised geometries (tiny & merged) ---
function buildPineGeo() {
  const geos = [];
  const trunk = new THREE.CylinderGeometry(0.22, 0.32, 2.2, 6);
  trunk.translate(0, 1.1, 0);
  geos.push({ geo: trunk, col: new THREE.Color(0x5d3a1a) });
  for (let i = 0; i < 4; i++) {
    const c = new THREE.ConeGeometry(1.5 - i * 0.22, 1.8, 6);
    c.translate(0, 2.5 + i * 0.85, 0);
    // Alternate darker / lighter green for readability in both style modes
    geos.push({ geo: c, col: new THREE.Color(i % 2 === 0 ? 0x2d6a2a : 0x3a8a38) });
  }
  return mergeColored(geos);
}

function buildCactusGeo() {
  const geos = [];
  const col = new THREE.Color(0x4a7a3a);
  const body = new THREE.CylinderGeometry(0.35, 0.42, 2.4, 8);
  body.translate(0, 1.2, 0);
  geos.push({ geo: body, col });
  // Two arms
  const armL = new THREE.CylinderGeometry(0.18, 0.22, 0.9, 7);
  armL.rotateZ(Math.PI / 2);
  armL.translate(-0.6, 1.5, 0);
  geos.push({ geo: armL, col });
  const armLUp = new THREE.CylinderGeometry(0.18, 0.18, 0.7, 7);
  armLUp.translate(-1.0, 1.9, 0);
  geos.push({ geo: armLUp, col });
  const armR = new THREE.CylinderGeometry(0.16, 0.2, 0.7, 7);
  armR.rotateZ(Math.PI / 2);
  armR.translate(0.5, 1.9, 0);
  geos.push({ geo: armR, col });
  const armRUp = new THREE.CylinderGeometry(0.16, 0.16, 0.55, 7);
  armRUp.translate(0.82, 2.22, 0);
  geos.push({ geo: armRUp, col });
  // Top cap
  const cap = new THREE.SphereGeometry(0.38, 7, 5);
  cap.translate(0, 2.38, 0);
  geos.push({ geo: cap, col });
  return mergeColored(geos);
}

function buildShrubGeo() {
  const geos = [];
  const col = new THREE.Color(0x7a5a2a);
  for (let i = 0; i < 5; i++) {
    const r = 0.35 + (i % 3) * 0.1;
    const d = new THREE.DodecahedronGeometry(r, 0);
    const ang = (i / 5) * Math.PI * 2;
    d.translate(Math.cos(ang) * 0.3, r * 0.7, Math.sin(ang) * 0.3);
    geos.push({ geo: d, col });
  }
  return mergeColored(geos);
}

function buildBoulderGeo() {
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = Math.sin(x * 5.3 + SEED) * Math.cos(y * 3.7) * Math.sin(z * 4.1);
    p.setXYZ(i, x * (1 + n * 0.25), y * (1 + n * 0.20), z * (1 + n * 0.22));
  }
  geo.computeVertexNormals();
  // Attach vertex colors for style consistency
  const cols = new Float32Array(p.count * 3);
  const c = new THREE.Color(0xa07450);
  for (let i = 0; i < p.count; i++) {
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return geo;
}

function mergeColored(entries) {
  // Merge several geometries into one with per-vertex colors
  let total = 0;
  for (const e of entries) total += e.geo.attributes.position.count;
  const positions = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  const indices = [];
  let vOff = 0;
  for (const e of entries) {
    const pg = e.geo;
    const pn = pg.attributes.position;
    pg.computeVertexNormals();
    const nr = pg.attributes.normal;
    for (let i = 0; i < pn.count; i++) {
      positions[(vOff + i) * 3]     = pn.getX(i);
      positions[(vOff + i) * 3 + 1] = pn.getY(i);
      positions[(vOff + i) * 3 + 2] = pn.getZ(i);
      normals[(vOff + i) * 3]     = nr.getX(i);
      normals[(vOff + i) * 3 + 1] = nr.getY(i);
      normals[(vOff + i) * 3 + 2] = nr.getZ(i);
      colors[(vOff + i) * 3]     = e.col.r;
      colors[(vOff + i) * 3 + 1] = e.col.g;
      colors[(vOff + i) * 3 + 2] = e.col.b;
    }
    const idx = pg.index;
    if (idx) {
      for (let i = 0; i < idx.count; i++) indices.push(idx.getX(i) + vOff);
    } else {
      for (let i = 0; i < pn.count; i++) indices.push(i + vOff);
    }
    vOff += pn.count;
    pg.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  out.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  out.setIndex(indices);
  return out;
}

const pineGeo    = buildPineGeo();
const cactusGeo  = buildCactusGeo();
const shrubGeo   = buildShrubGeo();
const boulderGeo = buildBoulderGeo();

// Shared material — vertex colors, lighter response so pines read green
const floraMat = new THREE.MeshLambertMaterial({ vertexColors: true });
applyDistanceCulling(floraMat, 500.0);
const floraMatLow = new THREE.MeshPhongMaterial({
  vertexColors: true, flatShading: true, shininess: 0
});
applyDistanceCulling(floraMatLow, 500.0);


function makeChunk(cx, cz, preHeights) {
  const group = new THREE.Group();

  // Pick the material variant matching the current style mode so newly
  // streamed chunks immediately match the rest of the world
  const lowPoly = (typeof styleMode !== 'undefined') && styleMode.current === 'lowpoly';
  const sandM = lowPoly ? sandMatLowPoly : sandMat;
  const rockM = lowPoly ? rockMatLowPoly : rockMat;

  const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_RES, CHUNK_RES);
  geo.rotateX(-Math.PI / 2);

  const cxW = (cx + 0.5) * CHUNK_SIZE;
  const czW = (cz + 0.5) * CHUNK_SIZE;

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const tmp = new THREE.Color();

  // Height grid first, then colors from grid neighbors. getHeight is ~12 noise
  // evaluations, so deriving slope from already-computed neighbors instead of two
  // extra probes per vertex cuts the build's noise cost to a third.
  const GRID_W = CHUNK_RES + 1;
  let heights = preHeights;
  if (!heights || heights.length !== pos.count) {
    heights = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      heights[i] = getHeight(cxW + pos.getX(i), czW + pos.getZ(i));
    }
  }

  for (let i = 0; i < pos.count; i++) {
    const wx = cxW + pos.getX(i);
    const wz = czW + pos.getZ(i);
    const h = heights[i];
    pos.setY(i, h);

    // Sedimentary strata
    strataColor(h, tmp);

    // Cliff face tint — steep slopes turn warmer / darker.
    // Neighbor spacing is 10 m vs the old 5 m probes, so halve the scale factor.
    const col = i % GRID_W;
    const row = (i / GRID_W) | 0;
    const hN = heights[col < GRID_W - 1 ? i + 1 : i - 1];
    const hE = heights[row < GRID_W - 1 ? i + GRID_W : i - GRID_W];
    const slope = Math.min(1, (Math.abs(hN - h) + Math.abs(hE - h)) * 0.0225);
    if (slope > 0.25) {
      tmp.lerp(CLIFF_TINT, (slope - 0.25) * 0.55);
    }

    // Two-octave noise variation for natural mottling
    const n1 = vnoise(wx * 0.045, wz * 0.045);
    const n2 = vnoise(wx * 0.011, wz * 0.011);
    tmp.multiplyScalar(0.78 + n1 * 0.22 + (n2 - 0.5) * 0.18);

    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }

  // Bilinear height sample from the precomputed grid (local chunk coords).
  // Scatter placement reads this instead of exact getHeight — cheaper, and the
  // result sits exactly on the rendered terrain mesh rather than the ideal field.
  const sampleH = (lx, lz) => {
    const gx = Math.max(0, Math.min(CHUNK_RES - 1e-4, (lx / CHUNK_SIZE + 0.5) * CHUNK_RES));
    const gz = Math.max(0, Math.min(CHUNK_RES - 1e-4, (lz / CHUNK_SIZE + 0.5) * CHUNK_RES));
    const x0 = gx | 0, z0 = gz | 0;
    const fx = gx - x0, fz = gz - z0;
    const i00 = z0 * GRID_W + x0;
    const h0 = heights[i00] + (heights[i00 + 1] - heights[i00]) * fx;
    const h1 = heights[i00 + GRID_W] + (heights[i00 + GRID_W + 1] - heights[i00 + GRID_W]) * fx;
    return h0 + (h1 - h0) * fz;
  };

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, sandM);
  mesh.position.set(cxW, 0, czW);
  group.add(mesh);

  // ---- Instanced rocks ----
  const rocks = new THREE.InstancedMesh(rockGeo, rockM, ROCKS_PER_CHUNK);
  const dummy = new THREE.Object3D();
  let added = 0;
  for (let i = 0; i < ROCKS_PER_CHUNK * 2 && added < ROCKS_PER_CHUNK; i++) {
    const r1 = srand(cx, cz, i * 2);
    const r2 = srand(cx, cz, i * 2 + 1);
    const lxr = (r1 - 0.5) * CHUNK_SIZE;
    const lzr = (r2 - 0.5) * CHUNK_SIZE;
    const wx = cxW + lxr;
    const wz = czW + lzr;
    const dist = Math.sqrt(wx * wx + wz * wz);
    if (dist < 280) continue;                 // keep airfield clear
    const h = sampleH(lxr, lzr);
    if (h < 4) continue;                       // skip valley floors
    const scl = 0.6 + srand(cx, cz, i + 100) * 3.2;
    dummy.position.set(wx, h - scl * 0.3, wz);
    dummy.rotation.set(
      srand(cx, cz, i + 200) * Math.PI,
      srand(cx, cz, i + 300) * Math.PI * 2,
      srand(cx, cz, i + 400) * Math.PI
    );
    dummy.scale.set(scl, scl * (0.7 + srand(cx, cz, i + 500) * 0.6), scl);
    dummy.updateMatrix();
    rocks.setMatrixAt(added, dummy.matrix);
    added++;
  }
  const clutterDensity = (typeof window !== 'undefined' && window.gfx && window.gfx.floraDensity != null)
    ? Math.max(0.2, Math.min(1.6, window.gfx.floraDensity))
    : 0.78;
  rocks.count = Math.max(0, Math.min(added, Math.round(added * clutterDensity)));
  rocks.instanceMatrix.needsUpdate = true;
  rocks.userData.__densityGroup = 'terrain-clutter';
  rocks.userData.__baseCount = added;
  group.add(rocks);

  // ---- Procedural flora + boulders (biome-gated) ----
  // Caps per chunk — we build 4 instanced meshes and only use what we fill
  const floraMaterial = lowPoly ? floraMatLow : floraMat;
  // Per-chunk caps. The GROUND DETAIL slider scales these via clutterDensity
  // (0.2x..1.6x), so the visible counts span roughly 35..280 pines etc.
  const CAP_PINE = 180, CAP_CACTUS = 100, CAP_SHRUB = 220, CAP_BOULDER = 60;

  const pines    = new THREE.InstancedMesh(pineGeo,    floraMaterial, CAP_PINE);
  const cacti    = new THREE.InstancedMesh(cactusGeo,  floraMaterial, CAP_CACTUS);
  const shrubs   = new THREE.InstancedMesh(shrubGeo,   floraMaterial, CAP_SHRUB);
  const boulders = new THREE.InstancedMesh(boulderGeo, floraMaterial, CAP_BOULDER);

  let nPine = 0, nCactus = 0, nShrub = 0, nBoulder = 0;
  const d = new THREE.Object3D();

  // Single deterministic scatter loop, biome-gated by elevation + slope.
  // More samples ⇒ more chances for plants/boulders to fill the new caps.
  const samples = 600;
  for (let i = 0; i < samples; i++) {
    const r1 = srand(cx, cz, i * 7 + 1000);
    const r2 = srand(cx, cz, i * 7 + 1001);
    const lxr = (r1 - 0.5) * CHUNK_SIZE;
    const lzr = (r2 - 0.5) * CHUNK_SIZE;
    const wx = cxW + lxr;
    const wz = czW + lzr;

    const dist = Math.sqrt(wx * wx + wz * wz);
    if (dist < 280) continue;                       // keep airfield clear

    const h = sampleH(lxr, lzr);
    if (h < 1) continue;                            // skip valley floors

    // Approximate slope
    const hN = sampleH(lxr + 6, lzr);
    const hE = sampleH(lxr, lzr + 6);
    const slope = (Math.abs(hN - h) + Math.abs(hE - h)) * 0.08;

    const pick = srand(cx, cz, i * 7 + 1002);

    // Boulders love slopes — higher chance on steep terrain
    if (slope > 0.45 && nBoulder < CAP_BOULDER && pick < 0.35) {
      const scl = 1.2 + srand(cx, cz, i + 3000) * 2.4;
      d.position.set(wx, h - scl * 0.15, wz);
      d.rotation.set(
        srand(cx, cz, i + 3100) * Math.PI,
        srand(cx, cz, i + 3200) * Math.PI * 2,
        srand(cx, cz, i + 3300) * Math.PI
      );
      d.scale.set(scl, scl * (0.7 + srand(cx, cz, i + 3400) * 0.5), scl);
      d.updateMatrix();
      boulders.setMatrixAt(nBoulder++, d.matrix);
      continue;
    }

    if (slope > 0.65) continue;                     // too steep for plants

    // Biome zones by elevation
    // h 1..40   = low zone    → cacti (desert only) + shrubs
    // h 40..140 = mid zone    → pines + shrubs
    // h > 140   = high zone   → sparse shrubs only
    if (h < 40) {
      if (currentBiome.hasCactus && pick < 0.35 && nCactus < CAP_CACTUS) {
        const scl = 0.9 + srand(cx, cz, i + 4100) * 0.8;
        d.position.set(wx, h, wz);
        d.rotation.set(0, srand(cx, cz, i + 4200) * Math.PI * 2, 0);
        d.scale.set(scl, scl * (0.9 + srand(cx, cz, i + 4300) * 0.3), scl);
        d.updateMatrix();
        cacti.setMatrixAt(nCactus++, d.matrix);
      } else if (pick < currentBiome.shrubChance && nShrub < CAP_SHRUB) {
        const scl = 0.6 + srand(cx, cz, i + 5100) * 0.8;
        d.position.set(wx, h, wz);
        d.rotation.set(0, srand(cx, cz, i + 5200) * Math.PI * 2, 0);
        d.scale.set(scl, scl, scl);
        d.updateMatrix();
        shrubs.setMatrixAt(nShrub++, d.matrix);
      }
    } else if (h < 140) {
      if (pick < currentBiome.pineChance && nPine < CAP_PINE) {
        const scl = 0.7 + srand(cx, cz, i + 6100) * 0.9;
        d.position.set(wx, h, wz);
        d.rotation.set(0, srand(cx, cz, i + 6200) * Math.PI * 2, 0);
        d.scale.set(scl, scl * (0.85 + srand(cx, cz, i + 6300) * 0.4), scl);
        d.updateMatrix();
        pines.setMatrixAt(nPine++, d.matrix);
      } else if (pick < 0.95 && nShrub < CAP_SHRUB) {
        const scl = 0.6 + srand(cx, cz, i + 7100) * 0.6;
        d.position.set(wx, h, wz);
        d.rotation.set(0, srand(cx, cz, i + 7200) * Math.PI * 2, 0);
        d.scale.set(scl, scl, scl);
        d.updateMatrix();
        shrubs.setMatrixAt(nShrub++, d.matrix);
      }
    } else {
      if (pick < 0.15 && nShrub < CAP_SHRUB) {
        const scl = 0.5 + srand(cx, cz, i + 8100) * 0.5;
        d.position.set(wx, h, wz);
        d.rotation.set(0, srand(cx, cz, i + 8200) * Math.PI * 2, 0);
        d.scale.set(scl, scl, scl);
        d.updateMatrix();
        shrubs.setMatrixAt(nShrub++, d.matrix);
      }
    }
  }

  pines.count    = Math.max(0, Math.min(nPine, Math.round(nPine * clutterDensity)));       pines.instanceMatrix.needsUpdate = true;    pines.userData.__densityGroup = 'terrain-clutter'; pines.userData.__baseCount = nPine; if (nPine) group.add(pines);
  cacti.count    = Math.max(0, Math.min(nCactus, Math.round(nCactus * clutterDensity)));   cacti.instanceMatrix.needsUpdate = true;    cacti.userData.__densityGroup = 'terrain-clutter'; cacti.userData.__baseCount = nCactus; if (nCactus) group.add(cacti);
  shrubs.count   = Math.max(0, Math.min(nShrub, Math.round(nShrub * clutterDensity)));     shrubs.instanceMatrix.needsUpdate = true;   shrubs.userData.__densityGroup = 'terrain-clutter'; shrubs.userData.__baseCount = nShrub; if (nShrub) group.add(shrubs);
  boulders.count = Math.max(0, Math.min(nBoulder, Math.round(nBoulder * clutterDensity))); boulders.instanceMatrix.needsUpdate = true; boulders.userData.__densityGroup = 'terrain-clutter'; boulders.userData.__baseCount = nBoulder; if (nBoulder) group.add(boulders);

  scene.add(group);
  return { group, geo, terrainMesh: mesh, clutter: [rocks, pines, cacti, shrubs, boulders], cxW, czW };
}

let _lastChunkCellX = null, _lastChunkCellZ = null;
function updateChunks(px, pz) {
  const pcx = Math.floor(px / CHUNK_SIZE);
  const pcz = Math.floor(pz / CHUNK_SIZE);

  // Queue/evict bookkeeping (Set + Map churn) only needs to run when the plane
  // crosses a 600 m cell boundary — not every frame.
  if (pcx !== _lastChunkCellX || pcz !== _lastChunkCellZ) {
    _lastChunkCellX = pcx; _lastChunkCellZ = pcz;
    const wanted = new Set();

    for (let dz = -RENDER_RADIUS; dz <= RENDER_RADIUS; dz++) {
      for (let dx = -RENDER_RADIUS; dx <= RENDER_RADIUS; dx++) {
        const cx = pcx + dx, cz = pcz + dz;
        const key = chunkKey(cx, cz);
        wanted.add(key);
        if (!chunks.has(key)) queueChunkBuild(pendingChunkBuilds, pendingChunkKeys, chunks, cx, cz, Math.abs(dx) + Math.abs(dz), 'near');
      }
    }

    trimPendingChunkBuilds(pendingChunkBuilds, pendingChunkKeys, wanted);

    for (const [key, c] of chunks) {
      if (!wanted.has(key)) {
        scene.remove(c.group);
        c.geo.dispose();
        // sandMat + rockGeo + rockMat are shared across chunks — don't dispose them.
        // But each InstancedMesh (rocks + up to 4 flora) owns a per-chunk instanceMatrix
        // GPU buffer; dispose() frees that buffer (shared geometry/material untouched).
        c.group.traverse(o => { if (o.isInstancedMesh) o.dispose(); });
        chunks.delete(key);
      }
    }
  }

  // CPU-side clutter culling. The vertex-shader fade collapses out-of-range
  // instances to vec3(0), but every triangle of every instance in all 49 chunks
  // is still submitted and vertex-shaded. Hiding whole chunks' clutter meshes
  // once they're beyond the cull distance skips that submission entirely.
  // Margin = chunk half-diagonal so the shader fade ring is never clipped.
  const cullBase = (window.gfx && window.gfx.floraCullDistance != null) ? window.gfx.floraCullDistance : 450;
  const clutterVisRange = cullBase * (500 / 450) + CHUNK_SIZE * 0.71 + 60;
  const visRangeSq = clutterVisRange * clutterVisRange;
  for (const c of chunks.values()) {
    if (!c.clutter) continue;
    const dx = c.cxW - px, dz = c.czW - pz;
    const vis = (dx * dx + dz * dz) < visRangeSq;
    for (let i = 0; i < c.clutter.length; i++) {
      if (c.clutter[i].visible !== vis) c.clutter[i].visible = vis;
    }
  }
}

// =============================================================
//  FAR CHUNKS — LOD tier: 3× size, half res, no rocks, cheap
// =============================================================
// LOD-tier material clones must keep FOLLOWING the day/night driver: r128
// clone() deep-copies uniforms, which froze sun/fog colors at build time —
// horizon tiles built at night stayed pitch black at noon (the "floating
// black pyramids"). Re-point the driven uniforms at the shared material's
// live value objects so one TOD update drives every clone.
const SHARED_TERRAIN_UNIFORM_KEYS = ['sunDir', 'sunColor', 'ambientColor', 'skyTint', 'groundTint', 'fogColor', 'fogNear', 'hazeStrength', 'hazeExponent', 'time', 'waterLevel'];
function shareTerrainUniforms(cloneMat, sourceMat, opts = {}) {
  for (const k of SHARED_TERRAIN_UNIFORM_KEYS) {
    if (sourceMat.uniforms[k]) cloneMat.uniforms[k] = sourceMat.uniforms[k];
  }
  if (opts.shareFogFar && sourceMat.uniforms.fogFar) cloneMat.uniforms.fogFar = sourceMat.uniforms.fogFar;
}

function makeFarChunk(cx, cz, preHeights) {
  const lowPoly = (typeof styleMode !== 'undefined') && styleMode.current === 'lowpoly';
  const sandM = lowPoly ? sandMatLowPoly : sandMat;

  const geo = new THREE.PlaneGeometry(FAR_CHUNK_SIZE, FAR_CHUNK_SIZE, FAR_CHUNK_RES, FAR_CHUNK_RES);
  geo.rotateX(-Math.PI / 2);

  const cxW = (cx + 0.5) * FAR_CHUNK_SIZE;
  const czW = (cz + 0.5) * FAR_CHUNK_SIZE;

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const tmp = new THREE.Color();

  // Height grid first, slope from grid neighbors — same trick as makeChunk,
  // cuts the build's getHeight count to a third.
  const GRID_W = FAR_CHUNK_RES + 1;
  let heights = preHeights;
  if (!heights || heights.length !== pos.count) {
    heights = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      heights[i] = getHeight(cxW + pos.getX(i), czW + pos.getZ(i));
    }
  }

  for (let i = 0; i < pos.count; i++) {
    const h = heights[i];
    pos.setY(i, h);

    strataColor(h, tmp);
    // Slope tint from 50 m grid neighbors (was 12 m probes → rescale factor)
    const col = i % GRID_W;
    const row = (i / GRID_W) | 0;
    const hN = heights[col < GRID_W - 1 ? i + 1 : i - 1];
    const hE = heights[row < GRID_W - 1 ? i + GRID_W : i - GRID_W];
    const slope = Math.min(1, (Math.abs(hN - h) + Math.abs(hE - h)) * 0.0043);
    if (slope > 0.25) tmp.lerp(CLIFF_TINT, (slope - 0.25) * 0.55);

    // Subtle atmospheric desaturation for far chunks — they're already
    // fog-tinted but this makes the blend even smoother
    tmp.lerp(scene.fog.color, 0.08);

    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, sandM);
  // Drop far chunks well below the surface so near-chunk valleys (which,
  // at 10 m sampling, dig deeper than the 50 m far grid can ever reach)
  // don't let the coarser mesh poke through and Z-fight. 8 m covers the
  // worst-case valley aliasing for this heightfield. The fog tint hides
  // the seam at distance.
  mesh.position.set(cxW, -8.0, czW);
  // Belt-and-braces: push far-chunk fragments slightly back in depth so
  // any residual coplanar fight at the LOD seam resolves in favour of
  // the high-detail near tile.
  mesh.material = mesh.material.clone();
  shareTerrainUniforms(mesh.material, sandM, { shareFogFar: true });
  mesh.material.polygonOffset = true;
  mesh.material.polygonOffsetFactor = 1;
  mesh.material.polygonOffsetUnits = 4;
  mesh.renderOrder = -1;
  scene.add(mesh);
  return { mesh, geo, cxW, czW };
}

let _lastFarCellX = null, _lastFarCellZ = null;
function updateFarChunks(px, pz) {
  const pcx = Math.floor(px / FAR_CHUNK_SIZE);
  const pcz = Math.floor(pz / FAR_CHUNK_SIZE);

  if (pcx !== _lastFarCellX || pcz !== _lastFarCellZ) {
    _lastFarCellX = pcx; _lastFarCellZ = pcz;
    const wanted = new Set();

    // Skip far chunks that are fully inside the high-detail ring to avoid
    // Z-fighting between LOD tiers. The near-chunk grid is an axis-aligned
    // square of half-extent ≈ (RENDER_RADIUS + 0.5) * CHUNK_SIZE centred on
    // the plane's chunk — NOT a circle — so the cull test must also be
    // axis-aligned. A far chunk is fully redundant only when ALL its corners
    // (half-extent = FAR_CHUNK_SIZE/2) sit inside that square, with a small
    // safety margin so the LOD seam stays near chunk boundaries.
    const nearHalfExtent = (RENDER_RADIUS + 0.5) * CHUNK_SIZE;  // 2100
    const farHalf        = FAR_CHUNK_SIZE / 2;                   // 900
    const safety         = 60;                                    // 1 near-vertex spacing

    for (let dz = -FAR_RADIUS; dz <= FAR_RADIUS; dz++) {
      for (let dx = -FAR_RADIUS; dx <= FAR_RADIUS; dx++) {
        const cx = pcx + dx, cz = pcz + dz;
        const cxW = (cx + 0.5) * FAR_CHUNK_SIZE;
        const czW = (cz + 0.5) * FAR_CHUNK_SIZE;
        const dxp = cxW - px, dzp = czW - pz;
        // Fully inside the near-chunk square (with safety margin) → skip.
        if (Math.abs(dxp) + farHalf + safety < nearHalfExtent &&
            Math.abs(dzp) + farHalf + safety < nearHalfExtent) continue;

        const key = chunkKey(cx, cz);
        wanted.add(key);
        if (!farChunks.has(key)) queueChunkBuild(pendingFarChunkBuilds, pendingFarChunkKeys, farChunks, cx, cz, Math.abs(dx) + Math.abs(dz), 'far');
      }
    }

    trimPendingChunkBuilds(pendingFarChunkBuilds, pendingFarChunkKeys, wanted);

    for (const [key, c] of farChunks) {
      if (!wanted.has(key)) {
        scene.remove(c.mesh);
        c.geo.dispose();
        // makeFarChunk clones the shared sand material per chunk (for polygonOffset),
        // so this clone is unique to this chunk — dispose it to free its program ref.
        if (c.mesh.material && c.mesh.material.dispose) c.mesh.material.dispose();
        farChunks.delete(key);
      }
    }
  }

  // Fog-distance culling: a far chunk whose nearest point is past the fog-opaque
  // distance renders as pure fog color — wasted vertex + fill work. Hide it.
  // Half-diagonal of an 1800 m tile ≈ 1273 m; small extra margin for safety.
  const fogActive = scene.fog && !scene.userData.__fogDisabled;
  const fogVisLimit = fogActive ? scene.fog.far + 1273 + 200 : Infinity;
  const fogVisLimitSq = fogVisLimit * fogVisLimit;
  for (const c of farChunks.values()) {
    const dx = c.cxW - px, dz = c.czW - pz;
    const vis = !fogActive || (dx * dx + dz * dz) < fogVisLimitSq;
    if (c.mesh.visible !== vis) c.mesh.visible = vis;
  }
}

// =============================================================
//  HORIZON CHUNKS — 3rd LOD tier: 3× far size, half res, clutter-free,
//  heavy fog tint. Only active when gfx.renderDistance > 1.0 pushes
//  HORIZON_RADIUS above 0; at default render distance this is a no-op.
// =============================================================
function makeHorizonChunk(cx, cz, preHeights) {
  const lowPoly = (typeof styleMode !== 'undefined') && styleMode.current === 'lowpoly';
  const sandM = lowPoly ? sandMatLowPoly : sandMat;

  const geo = new THREE.PlaneGeometry(HORIZON_CHUNK_SIZE, HORIZON_CHUNK_SIZE, HORIZON_CHUNK_RES, HORIZON_CHUNK_RES);
  geo.rotateX(-Math.PI / 2);

  const cxW = (cx + 0.5) * HORIZON_CHUNK_SIZE;
  const czW = (cz + 0.5) * HORIZON_CHUNK_SIZE;

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const tmp = new THREE.Color();

  const hasPre = !!(preHeights && preHeights.length === pos.count);
  for (let i = 0; i < pos.count; i++) {
    const h = hasPre ? preHeights[i] : getHeight(cxW + pos.getX(i), czW + pos.getZ(i));
    pos.setY(i, h);
    strataColor(h, tmp);
    // Heavy atmospheric desaturation — these tiles sit 15-24 km out, deep in fog.
    tmp.lerp(scene.fog.color, 0.20);
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, sandM);
  // Sit below the far tier (which sits below near) so the coarsest grid never pokes
  // through finer LOD; heavy fog hides the offset at this range.
  mesh.position.set(cxW, -16.0, czW);
  mesh.material = mesh.material.clone();
  shareTerrainUniforms(mesh.material, sandM); // fogFar stays per-clone: pinned to horizon extent below
  mesh.material.polygonOffset = true;
  mesh.material.polygonOffsetFactor = 2;
  mesh.material.polygonOffsetUnits = 8;
  // Pin this clone's fog ceiling to the horizon extent so the tile stays visible to
  // its own range regardless of the shared material's current fog (which tracks the
  // far ring). Guards against the clone being fogged to invisible at 15-24 km.
  if (mesh.material.uniforms && mesh.material.uniforms.fogFar) {
    mesh.material.uniforms.fogFar.value = Math.max(mesh.material.uniforms.fogFar.value || 0, (HORIZON_RADIUS + 0.5) * HORIZON_CHUNK_SIZE);
  }
  mesh.renderOrder = -2;
  scene.add(mesh);
  return { mesh, geo };
}

function disposeAllHorizonChunks() {
  for (const [, c] of horizonChunks) {
    scene.remove(c.mesh); c.geo.dispose();
    if (c.mesh.material && c.mesh.material.dispose) c.mesh.material.dispose();
  }
  horizonChunks.clear();
  pendingHorizonBuilds.length = 0; pendingHorizonKeys.clear();
}

function updateHorizonChunks(px, pz) {
  if (HORIZON_RADIUS <= 0) { if (horizonChunks.size || pendingHorizonBuilds.length) disposeAllHorizonChunks(); return; }
  const pcx = Math.floor(px / HORIZON_CHUNK_SIZE);
  const pcz = Math.floor(pz / HORIZON_CHUNK_SIZE);
  const wanted = new Set();

  // Skip horizon chunks fully inside the FAR ring (same axis-aligned cull as far↔near).
  const farHalfExtent = (FAR_RADIUS + 0.5) * FAR_CHUNK_SIZE;
  const horHalf = HORIZON_CHUNK_SIZE / 2;
  const safety = 180;

  for (let dz = -HORIZON_RADIUS; dz <= HORIZON_RADIUS; dz++) {
    for (let dx = -HORIZON_RADIUS; dx <= HORIZON_RADIUS; dx++) {
      const cx = pcx + dx, cz = pcz + dz;
      const cxW = (cx + 0.5) * HORIZON_CHUNK_SIZE;
      const czW = (cz + 0.5) * HORIZON_CHUNK_SIZE;
      if (Math.abs(cxW - px) + horHalf + safety < farHalfExtent &&
          Math.abs(czW - pz) + horHalf + safety < farHalfExtent) continue;
      const key = chunkKey(cx, cz);
      wanted.add(key);
      if (!horizonChunks.has(key)) queueChunkBuild(pendingHorizonBuilds, pendingHorizonKeys, horizonChunks, cx, cz, Math.abs(dx) + Math.abs(dz), 'hor');
    }
  }
  trimPendingChunkBuilds(pendingHorizonBuilds, pendingHorizonKeys, wanted);
  for (const [key, c] of horizonChunks) {
    if (!wanted.has(key)) {
      scene.remove(c.mesh); c.geo.dispose();
      if (c.mesh.material && c.mesh.material.dispose) c.mesh.material.dispose();
      horizonChunks.delete(key);
    }
  }
}

