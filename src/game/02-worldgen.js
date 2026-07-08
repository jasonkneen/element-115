// @module src/game/02-worldgen.js
// =============================================================
//  SEED + NOISE — deterministic worldgen
// =============================================================
const SEED = 8472;          // change this to roll a different canyon
const SEED_OX = (SEED * 17.31) % 1000;
const SEED_OY = (SEED * 23.79) % 1000;
const hash2 = (x, y) => {
  const s = Math.sin((x + SEED_OX) * 127.1 + (y + SEED_OY) * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
// Deterministic 0–1 PRNG for placement (rocks, vegetation, etc.)
function srand(a, b, salt = 0) {
  const s = Math.sin(a * 12.9898 + b * 78.233 + salt * 37.719 + SEED * 0.1417) * 43758.5453;
  return s - Math.floor(s);
}

// =============================================================
//  BIOMES — swappable palette + flora rules
// =============================================================
const BIOMES = {
  desert: {
    label: 'DESERT',
    strata: [
      { h: -10, c: 0x3a2218 }, { h:   6, c: 0x5a3220 },
      { h:  22, c: 0x8a4d2e }, { h:  42, c: 0xb16b40 },
      { h:  60, c: 0xc78854 }, { h:  92, c: 0xd49868 },
      { h: 130, c: 0xdfb486 }, { h: 180, c: 0xe2c79c },
      { h: 260, c: 0xdcc7a4 },
    ],
    cliffTint: 0x7a3c22,
    fogColor: 0xe8b888,
    skyTop: 0x4a7ca8, skyBottom: 0xffd4a0,
    groundTint: 0x6a4830, ambient: 0x2a2520,
    lowPolyAmbient: 0x3a3328,
    sunColor: 0xfff1d4,
    cloudColor: 0xfff5e8, cloudOpacity: 0.95,
    hasCactus: true, pineChance: 0.55, shrubChance: 0.85,
  },
  snow: {
    label: 'SNOW',
    strata: [
      { h: -10, c: 0x2a2a30 }, { h:   6, c: 0x404050 },
      { h:  22, c: 0x5a5f6a }, { h:  42, c: 0x8088a0 },
      { h:  60, c: 0xb4c0cf }, { h:  92, c: 0xd4dde6 },
      { h: 130, c: 0xe8edf2 }, { h: 180, c: 0xf6f8fb },
      { h: 260, c: 0xffffff },
    ],
    cliffTint: 0x3a3a4a,
    fogColor: 0xbfd0e0,
    skyTop: 0x5a7ca8, skyBottom: 0xdae4ec,
    groundTint: 0x5a6878, ambient: 0x2a303a,
    lowPolyAmbient: 0x3a4250,
    sunColor: 0xf4f2ec,
    cloudColor: 0xe8f0f8, cloudOpacity: 0.97,
    hasCactus: false, pineChance: 0.75, shrubChance: 0.25,
  },
  grassland: {
    label: 'GRASSLAND',
    strata: [
      { h: -10, c: 0x2a3818 }, { h:   6, c: 0x3e5e22 },
      { h:  22, c: 0x548030 }, { h:  42, c: 0x6a9040 },
      { h:  60, c: 0x7e9448 }, { h:  92, c: 0x8c9458 },
      { h: 130, c: 0x90886a }, { h: 180, c: 0xa09c88 },
      { h: 260, c: 0xb4b0a0 },
    ],
    cliffTint: 0x4a3820,
    fogColor: 0xc4d8c0,
    skyTop: 0x6090c0, skyBottom: 0xdee8c8,
    groundTint: 0x405030, ambient: 0x2a3820,
    lowPolyAmbient: 0x3a4828,
    sunColor: 0xfff4d0,
    cloudColor: 0xffffff, cloudOpacity: 0.9,
    hasCactus: false, pineChance: 0.7, shrubChance: 0.85,
  },
};
const currentBiome = { name: 'grassland', ...BIOMES.grassland };
const smoothstep = t => t * t * (3 - 2 * t);
const clamp01 = t => Math.max(0, Math.min(1, t));
const smoothstepRange = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return smoothstep(t);
};
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = smoothstep(fx), v = smoothstep(fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) +
         c * (1 - u) * v + d * u * v;
}
function fbm(x, y, oct) {
  let v = 0, a = 1, f = 1, tot = 0;
  for (let i = 0; i < oct; i++) {
    v += a * vnoise(x * f, y * f);
    tot += a;
    a *= 0.5; f *= 2;
  }
  return v / tot;
}

// =============================================================
//  TERRAIN HEIGHTMAP — canyon mesas with runway clearing
// =============================================================
const AIRFIELD_SURFACE_Y = 0.08;
const AIRFIELD_FLAT_RADIUS = 230;
const AIRFIELD_FLAT_R2 = AIRFIELD_FLAT_RADIUS * AIRFIELD_FLAT_RADIUS;

// NOTE: heightPrefetch clones this function (and its const-only closure) into a
// Web Worker via .toString() — if it ever reads a mutable global, update there.
function getHeight(x, z) {
  const dist = Math.sqrt(x * x + z * z);

  // Bigger airfield bowl + longer canyon approach so landing back into the
  // origin area is less punishing. The opening is intentionally stretched far
  // down the runway axis, not just a radial "hole".
  const runwayEllipse = Math.hypot(x * 1.45, z * 0.22);
  const runwayMask = smoothstepRange(220, 560, runwayEllipse);
  const corridorX = 1 - smoothstepRange(135, 360, Math.abs(x));
  const corridorZ = 1 - smoothstepRange(260, 1850, Math.abs(z));
  const approachCorridor = clamp01(corridorX * corridorZ);

  let h = 0, amp = 1, freq = 0.0018, tot = 0;
  for (let i = 0; i < 5; i++) {
    const n = vnoise(x * freq, z * freq);
    h += amp * (1 - Math.abs(n * 2 - 1)); // ridged
    tot += amp;
    amp *= 0.5; freq *= 2;
  }
  h = Math.pow(h / tot, 2.4) * 260;

  // Large-scale variation: wider valleys / higher plateaus
  h += (fbm(x * 0.0006, z * 0.0006, 3) - 0.4) * 120;
  h = Math.max(0, h);

  // Terracing for mesa tops
  const step = 28;
  const t = h / step;
  const base = Math.floor(t);
  const frac = t - base;
  const tr = frac < 0.72 ? 0 : smoothstep((frac - 0.72) / 0.28);
  h = (base + tr) * step;

  // Carve a longer runway canyon and soften the valley floor so the airport
  // feels more open and the immediate approach is readable from the air.
  h *= Math.max(runwayMask, 1 - approachCorridor * 0.96);
  h = Math.max(0, h - approachCorridor * 22);

  // Keep a little floor variation near the airport so it doesn't read as a
  // sterile flat disc.
  const basinRipple = (1 - runwayMask) * (fbm(x * 0.006, z * 0.006, 2) - 0.5) * 5.5;
  h = Math.max(0, h + basinRipple);

  // Airfield pavement footprint — explicitly flatten the runway/apron/taxiway
  // area so the new airport doesn't get swallowed by the regenerated grass.
  const runwayPad = (1 - smoothstepRange(18, 42, Math.abs(x)))
    * (1 - smoothstepRange(215, 285, Math.abs(z)));
  const apronPad = (1 - smoothstepRange(8, 74, Math.abs(x - 34)))
    * (1 - smoothstepRange(92, 210, Math.abs(z - 150)));
  const taxiPad = (1 - smoothstepRange(6, 18, Math.abs(x - 17)))
    * (1 - smoothstepRange(62, 168, Math.abs(z - 116)));
  const airfieldPad = clamp01(Math.max(runwayPad, apronPad, taxiPad));
  h *= 1 - airfieldPad * 0.998;
  h = Math.max(0, h - airfieldPad * 3.5);

  return h;
}

function buildWorldOpportunities() {
  const bridgeCandidates = [];
  const portalCandidates = [];
  const farEnough = (list, x, z, minDist) => !list.some(item => {
    const dx = item.x - x;
    const dz = item.z - z;
    return dx * dx + dz * dz < minDist * minDist;
  });

  for (let i = 0; i < 120; i++) {
    const radius = 900 + srand(i, 11, 401) * 5600;
    const ang = srand(i, 12, 401) * Math.PI * 2;
    const x = Math.cos(ang) * radius;
    const z = Math.sin(ang) * radius;
    const yaw = srand(i, 13, 401) * Math.PI;
    const span = 220 + srand(i, 14, 401) * 280;
    const dx = Math.cos(yaw), dz = Math.sin(yaw);
    const ax = x - dx * span * 0.5, az = z - dz * span * 0.5;
    const bx = x + dx * span * 0.5, bz = z + dz * span * 0.5;
    const hA = getHeight(ax, az);
    const hB = getHeight(bx, bz);
    const hMid = getHeight(x, z);
    const shoulder = Math.min(hA, hB);
    const relief = shoulder - hMid;
    const deckH = Math.max(hMid + 38, shoulder - 10);
    const clearance = deckH - hMid;
    const levelness = Math.abs(hA - hB);
    if (shoulder < 95 || relief < 42 || clearance < 38 || clearance > 170 || levelness > 78) continue;
    bridgeCandidates.push({
      x, z, yaw, span,
      h: deckH,
      score: relief * 1.4 + clearance - levelness * 0.35,
    });
  }

  bridgeCandidates.sort((a, b) => b.score - a.score);
  const chosenBridges = [];
  for (const cand of bridgeCandidates) {
    if (!farEnough(chosenBridges, cand.x, cand.z, 900)) continue;
    chosenBridges.push(cand);
    if (chosenBridges.length >= 6) break;
  }

  for (let i = 0; i < 180; i++) {
    const radius = 1100 + srand(i, 31, 777) * 6000;
    const ang = srand(i, 32, 777) * Math.PI * 2;
    const x = Math.cos(ang) * radius;
    const z = Math.sin(ang) * radius;
    const baseH = getHeight(x, z);
    if (baseH < 150) continue;
    const yaw = srand(i, 33, 777) * Math.PI;
    const dx = Math.cos(yaw), dz = Math.sin(yaw);
    const fore = getHeight(x + dx * 130, z + dz * 130);
    const aft = getHeight(x - dx * 130, z - dz * 130);
    const relief = baseH - Math.min(fore, aft);
    if (relief < 34) continue;
    portalCandidates.push({
      x, z,
      y: baseH + 34 + srand(i, 34, 777) * 20,
      yaw,
      radius: 24 + srand(i, 35, 777) * 10,
      depth: 44 + srand(i, 36, 777) * 28,
      score: baseH + relief * 1.8,
    });
  }

  portalCandidates.sort((a, b) => b.score - a.score);
  const chosenPortals = [];
  for (const cand of portalCandidates) {
    if (!farEnough(chosenPortals, cand.x, cand.z, 1150)) continue;
    chosenPortals.push(cand);
    if (chosenPortals.length >= 5) break;
  }

  return {
    bridgeCandidates: chosenBridges,
    portalCandidates: chosenPortals,
  };
}

