// @module src/game/09b-clouds-sky.js
// =============================================================
//  VOLUMETRIC CLOUDS — dodecahedron puffs, low-poly stylised,
//  world-space with wrap-around, biome-tinted
// =============================================================

// Weather state — public so other systems (graphics panel, future
// weather events) can modulate it. `clouds` in [0,1] scales density
// at build time (CLOUD_COUNT * clouds). Set before buildClouds().
const weather = { clouds: 0.42, storm: 0 };
const CLOUD_COUNT_MAX = 90;
const CLOUD_COUNT = Math.round(CLOUD_COUNT_MAX * weather.clouds);

// Build several cloud "template" geometries — each a merged cluster of
// dodecahedra in world-builder style. Picking a template deterministically
// per cloud gives variety without a unique geo per instance.
function buildCloudTemplate(seed) {
  const geos = [];
  const puffs = 8 + Math.floor(srand(seed, 0, 31) * 8);      // 8–15 puffs
  for (let i = 0; i < puffs; i++) {
    const r = 0.5 + srand(seed, i, 131) * 0.55;
    const g = new THREE.DodecahedronGeometry(r, 0);
    const dx = (srand(seed, i, 231) - 0.5) * 3.2;
    const dy = srand(seed, i, 331) * 0.9;
    const dz = (srand(seed, i, 431) - 0.5) * 2.2;
    g.translate(dx, dy, dz);
    geos.push({ geo: g, col: new THREE.Color(0xffffff) });
  }
  return mergeColored(geos);
}

const CLOUD_TEMPLATES = [
  buildCloudTemplate(1), buildCloudTemplate(2), buildCloudTemplate(3),
  buildCloudTemplate(4), buildCloudTemplate(5),
];

// Fluffy cloud templates (F9): denser two-tone puff clusters ported from
// tinyworld makeCloud() (23-particles-clouds.js:500). Merged to ONE geometry
// per template so a fluffy cloud costs the same 1 draw call as a chunky one
// (F9 budget guard). Bright/shade split is baked into vertex colours; needs
// vertexColors:true on cloudMat/cloudMatLow (P8). Chunky templates stay white,
// so enabling vertexColors is a no-op for them.
function buildFluffyTemplate(seed) {
  const geos = [];
  const puffs = 14 + Math.floor(srand(seed, 0, 41) * 6);   // 14–19 puffs
  const bright = new THREE.Color(0xffffff);
  const shade  = new THREE.Color(0xbcc6d2);
  for (let i = 0; i < puffs; i++) {
    const core = i < 5;
    const r  = core ? (0.42 + srand(seed, i, 141) * 0.34) : (0.22 + srand(seed, i, 151) * 0.36);
    const g  = new THREE.DodecahedronGeometry(r, 0);
    const dx = (srand(seed, i, 241) - 0.5) * (core ? 1.4 : 3.5);
    const dy = core ? (0.18 + srand(seed, i, 341) * 0.48) : srand(seed, i, 351) * 0.95;
    const dz = (srand(seed, i, 441) - 0.5) * (core ? 1.0 : 2.3);
    g.translate(dx, dy, dz);
    const isBright = core || srand(seed, i, 541) < 0.66;
    geos.push({ geo: g, col: isBright ? bright : shade });
  }
  return mergeColored(geos);
}
const FLUFFY_TEMPLATES = [
  buildFluffyTemplate(11), buildFluffyTemplate(12), buildFluffyTemplate(13),
  buildFluffyTemplate(14), buildFluffyTemplate(15),
];

// Shared cloud material — respects biome tint via .color
// Clouds use emissive so they don't go black at dusk/night when direct
// lighting drops. Emissive is modulated in updateTimeOfDay() to match
// sky color (warm at sunset, moonlit-blue at night). fog:true still
// lets distant clouds fade into haze naturally.
const cloudMat = new THREE.MeshLambertMaterial({
  color: currentBiome.cloudColor,
  vertexColors: true,
  emissive: currentBiome.cloudColor,
  emissiveIntensity: 0.35,
  transparent: true,
  opacity: currentBiome.cloudOpacity,
  depthWrite: false,
  fog: true,
});
const cloudMatLow = new THREE.MeshPhongMaterial({
  color: currentBiome.cloudColor,
  emissive: currentBiome.cloudColor,
  emissiveIntensity: 0.35,
  transparent: true,
  opacity: currentBiome.cloudOpacity,
  flatShading: true,
  vertexColors: true,
  shininess: 0,
  depthWrite: false,
  fog: true,
});
const cloudWispTex = makeSpriteTexture(128, 0.92);

function currentCloudMat() {
  return (typeof styleMode !== 'undefined' && styleMode.current === 'lowpoly')
    ? cloudMatLow : cloudMat;
}

function currentCloudStyle() {
  return (typeof window !== 'undefined' && window.gfx && window.gfx.cloudStyle) ? window.gfx.cloudStyle : 'chunky';
}

// One shared material for every cloud wisp sprite: syncCloudWisps always writes
// the same color/opacity to all of them, so per-sprite material clones only
// added ~76 unique materials' worth of state changes per frame.
const cloudWispSharedMat = new THREE.SpriteMaterial({
  map: cloudWispTex,
  color: currentBiome.cloudColor,
  transparent: true,
  opacity: 0.18,
  depthWrite: false,
  depthTest: true,
});
function buildClouds() {
  const group = new THREE.Group();
  const data = [];
  for (let i = 0; i < CLOUD_COUNT; i++) {
    const tpl = CLOUD_TEMPLATES[i % CLOUD_TEMPLATES.length];
    const holder = new THREE.Group();
    const mesh = new THREE.Mesh(tpl, currentCloudMat());
    const scale = 55 + srand(i, 9, 7) * 80;  // ~55–135 units across
    const yScale = 0.35 + srand(i, 10, 7) * 0.25;
    mesh.scale.set(scale, scale * yScale, scale);
    mesh.rotation.y = srand(i, 8, 7) * Math.PI * 2;
    mesh.renderOrder = -1;
    holder.add(mesh);

    const wisps = [];
    for (let w = 0; w < 2; w++) {
      const sprite = new THREE.Sprite(cloudWispSharedMat);
      const spread = (w === 0 ? 0.28 : -0.33) * scale;
      sprite.position.set(spread, scale * yScale * (0.12 + w * 0.18), (w === 0 ? -0.18 : 0.22) * scale);
      sprite.scale.set(scale * (1.45 + w * 0.2), scale * (0.68 + yScale * 0.55), 1);
      sprite.renderOrder = -2;
      holder.add(sprite);
      wisps.push(sprite);
    }
    group.add(holder);

    const angle = srand(i, 1, 777) * Math.PI * 2;
    const dist = 1200 + srand(i, 2, 777) * 4500;
    data.push({
      holder,
      mesh,
      wisps,
      ox: Math.cos(angle) * dist,
      oz: Math.sin(angle) * dist,
      y: 480 + srand(i, 5, 7) * 520,
      anchorX: 0, anchorZ: 0,
      vx: (srand(i, 6, 7) - 0.5) * 4,
      vz: (srand(i, 7, 7) - 0.5) * 4,
      spin: (srand(i, 12, 7) - 0.5) * 0.015,
      wispPhase: srand(i, 13, 7) * Math.PI * 2,
    });
  }
  scene.add(group);
  return { group, data };
}
const clouds = buildClouds();
bootLog.step('clouds', clouds && clouds.data && clouds.data.length > 0,
  `${clouds && clouds.data ? clouds.data.length : 0} puffs · density=${weather.clouds}`);

// =============================================================
//  HIGH CLOUD LAYER — a sparse set of huge soft sprites at 1200–1700 m,
//  far above the puff clouds. One shared material (no per-sprite/per-frame
//  allocation); drift + wrap rides updateClouds, and the TOD tint/opacity
//  rides the same per-frame cloud update in updateTimeOfDay.
// =============================================================
const HIGH_CLOUD_COUNT = 8;
const highCloudMat = new THREE.SpriteMaterial({
  map: cloudWispTex,
  color: currentBiome.cloudColor,
  transparent: true,
  opacity: 0.1,
  depthWrite: false,
  depthTest: true,
  fog: true,
});
const highClouds = (() => {
  const group = new THREE.Group();
  const data = [];
  for (let i = 0; i < HIGH_CLOUD_COUNT; i++) {
    const sprite = new THREE.Sprite(highCloudMat);
    const scale = 700 + srand(i, 21, 903) * 500;
    sprite.scale.set(scale, scale * (0.30 + srand(i, 22, 903) * 0.16), 1);
    sprite.renderOrder = -2;
    const angle = srand(i, 23, 903) * Math.PI * 2;
    const dist = 800 + srand(i, 24, 903) * 3200;
    data.push({
      sprite,
      ox: Math.cos(angle) * dist,
      oz: Math.sin(angle) * dist,
      y: 1200 + srand(i, 25, 903) * 500,
      anchorX: 0, anchorZ: 0,
      vx: 2.5 + srand(i, 26, 903) * 3,
      vz: (srand(i, 27, 903) - 0.5) * 2,
    });
    group.add(sprite);
  }
  scene.add(group);
  return { group, data };
})();

function updateClouds(dt, px, pz) {
  for (const c of clouds.data) {
    if (c.holder && c.holder.visible === false) continue;
    c.ox += c.vx * dt;
    c.oz += c.vz * dt;
    // Wrap — when the player has flown more than 5 km past this cloud, re-anchor
    const wx = c.anchorX + c.ox;
    const wz = c.anchorZ + c.oz;
    const dx = wx - px, dz = wz - pz;
    if (dx * dx + dz * dz > 5000 * 5000) {
      const newAng = Math.random() * Math.PI * 2;
      const newDist = 1500 + Math.random() * 3500;
      c.anchorX = px; c.anchorZ = pz;
      c.ox = Math.cos(newAng) * newDist;
      c.oz = Math.sin(newAng) * newDist;
    }
    c.holder.position.set(c.anchorX + c.ox, c.y, c.anchorZ + c.oz);
    c.holder.rotation.y += c.spin * dt;
    c.wispPhase += dt * 0.25;
    c.wisps.forEach((sprite, idx) => {
      sprite.position.y += Math.sin(c.wispPhase + idx * 1.7) * dt * 1.6;
    });
  }

  // High cloud layer — slow drift + the same wrap rule as the puff field.
  // weather.clouds scales the visible count (0 → none, 1 → full layer).
  const highActive = Math.min(HIGH_CLOUD_COUNT, Math.round(clamp01(weather.clouds) * HIGH_CLOUD_COUNT));
  for (let i = 0; i < highClouds.data.length; i++) {
    const hc = highClouds.data[i];
    const vis = i < highActive;
    if (hc.sprite.visible !== vis) hc.sprite.visible = vis;
    if (!vis) continue;
    hc.ox += hc.vx * dt;
    hc.oz += hc.vz * dt;
    const wx = hc.anchorX + hc.ox;
    const wz = hc.anchorZ + hc.oz;
    const dx = wx - px, dz = wz - pz;
    if (dx * dx + dz * dz > 4200 * 4200) {
      const newAng = Math.random() * Math.PI * 2;
      const newDist = 1200 + Math.random() * 2800;
      hc.anchorX = px; hc.anchorZ = pz;
      hc.ox = Math.cos(newAng) * newDist;
      hc.oz = Math.sin(newAng) * newDist;
    }
    hc.sprite.position.set(hc.anchorX + hc.ox, hc.y, hc.anchorZ + hc.oz);
  }
}

function swapCloudMaterials() {
  const m = currentCloudMat();
  for (const c of clouds.data) c.mesh.material = m;
}

let _appliedFluffy = false;
function syncCloudWisps() {
  const style = currentCloudStyle();
  const soft = style === 'soft';
  const fluffy = style === 'fluffy';
  const daylight = timeOfDay ? timeOfDay.daylight : 1;
  const stormMix = Math.max(0, Math.min(1, weather.storm || 0));
  // All wisps share one material — set it once, then just toggle visibility.
  // Wisps belong to 'soft' only; 'fluffy' reads its volume from the puff cluster.
  cloudWispSharedMat.color.copy(cloudMat.color);
  cloudWispSharedMat.opacity = soft ? (0.10 + daylight * 0.05 + (1 - stormMix) * 0.08) : 0;
  // Swap merged geometry between chunky and fluffy templates only on style
  // change (guarded — this fn runs every frame from updateTimeOfDay). Same ref
  // reassignment, no GPU re-upload, no per-frame allocation.
  if (_appliedFluffy !== fluffy) {
    const tpls = fluffy ? FLUFFY_TEMPLATES : CLOUD_TEMPLATES;
    clouds.data.forEach((c, i) => { c.mesh.geometry = tpls[i % tpls.length]; });
    _appliedFluffy = fluffy;
  }
  for (const c of clouds.data) {
    for (const sprite of c.wisps || []) {
      if (sprite.visible !== soft) sprite.visible = soft;
    }
  }
}

// =============================================================
//  SUN — bright billboard with corona (lens-flare-ish glow)
// =============================================================
function makeSunSprites() {
  const grp = new THREE.Group();
  const coreTex = makeSpriteTexture(128, 0.5);
  const haloTex = makeSpriteTexture(128, 0.85);
  const streakTex = makeStreakTexture();

  const core = new THREE.Sprite(new THREE.SpriteMaterial({
    map: coreTex, color: 0xffffe0,
    blending: THREE.AdditiveBlending, transparent: true,
    depthWrite: false, depthTest: false, fog: false,
  }));
  core.scale.set(180, 180, 1);
  core.renderOrder = 999;
  grp.add(core);

  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloTex, color: 0xffd680,
    blending: THREE.AdditiveBlending, transparent: true,
    opacity: 0.6, depthWrite: false, depthTest: false, fog: false,
  }));
  halo.scale.set(550, 550, 1);
  halo.renderOrder = 998;
  grp.add(halo);

  const outer = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloTex, color: 0xff9944,
    blending: THREE.AdditiveBlending, transparent: true,
    opacity: 0.25, depthWrite: false, depthTest: false, fog: false,
  }));
  outer.scale.set(1100, 1100, 1);
  outer.renderOrder = 997;
  grp.add(outer);

  const streak = new THREE.Sprite(new THREE.SpriteMaterial({
    map: streakTex,
    color: 0xffc98d,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    depthTest: false,
    fog: false,
  }));
  streak.scale.set(1800, 180, 1);
  streak.renderOrder = 996;
  grp.add(streak);

  const ghosts = [];
  const ghostDefs = [
    { scale: 120, color: 0xffe3b8 },
    { scale: 180, color: 0xffb870 },
    { scale: 90,  color: 0xc9d9ff },
  ];
  for (const def of ghostDefs) {
    const ghost = new THREE.Sprite(new THREE.SpriteMaterial({
      map: haloTex,
      color: def.color,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      depthTest: false,
      fog: false,
    }));
    ghost.scale.set(def.scale, def.scale, 1);
    ghost.renderOrder = 995;
    ghosts.push(ghost);
    grp.add(ghost);
  }

  grp.userData.core = core;
  grp.userData.halo = halo;
  grp.userData.outer = outer;
  grp.userData.streak = streak;
  grp.userData.ghosts = ghosts;
  scene.add(grp);
  return grp;
}
const sunGrp = makeSunSprites();

function makeMoonSprites() {
  const grp = new THREE.Group();
  const moonTex = makeSpriteTexture(128, 0.65);
  const haloTex = makeSpriteTexture(128, 0.88);
  const core = new THREE.Sprite(new THREE.SpriteMaterial({
    map: moonTex,
    color: 0xd8e7ff,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    depthTest: false,
    fog: false,
  }));
  core.scale.set(120, 120, 1);
  core.renderOrder = 996;
  grp.add(core);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloTex,
    color: 0x8eb8ff,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    depthTest: false,
    fog: false,
  }));
  halo.scale.set(260, 260, 1);
  halo.renderOrder = 995;
  grp.add(halo);
  grp.userData.core = core;
  grp.userData.halo = halo;
  scene.add(grp);
  return grp;
}
const moonGrp = makeMoonSprites();

function makeStarField() {
  const STAR_COUNT = 900;
  const radius = 10000;
  const pos = new Float32Array(STAR_COUNT * 3);
  const color = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i++) {
    const u = hash2(i * 17, 91);
    const v = hash2(i * 29, 37);
    const theta = u * Math.PI * 2;
    const phi = Math.acos(1 - 2 * v);
    const x = Math.sin(phi) * Math.cos(theta);
    const y = Math.cos(phi);
    const z = Math.sin(phi) * Math.sin(theta);
    pos[i * 3] = x * radius;
    pos[i * 3 + 1] = y * radius;
    pos[i * 3 + 2] = z * radius;
    const warm = 0.82 + hash2(i * 11, 4) * 0.18;
    color[i * 3] = 0.72 + warm * 0.28;
    color[i * 3 + 1] = 0.76 + warm * 0.24;
    color[i * 3 + 2] = 0.88 + warm * 0.12;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
  const mat = new THREE.PointsMaterial({
    size: 26,
    map: makeSpriteTexture(64, 0.55),
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    depthTest: false,
    fog: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 994;
  scene.add(points);
  return points;
}
const starField = makeStarField();

const TOD_NIGHT_TOP = new THREE.Color(0x07111f);
const TOD_NIGHT_BOTTOM = new THREE.Color(0x16263d);
const TOD_NIGHT_FOG = new THREE.Color(0x0b1526);
const TOD_NIGHT_GROUND = new THREE.Color(0x182028);
const TOD_WARM = new THREE.Color(0xff9b5b);
const TOD_MOON = new THREE.Color(0xa9c8ff);
const todSkyTop = new THREE.Color();
const todSkyBottom = new THREE.Color();
const todFog = new THREE.Color();
const todSun = new THREE.Color();
const todGround = new THREE.Color();
const todAmbient = new THREE.Color();
const todLowPolyAmbient = new THREE.Color();

// Scratch colors for updateTimeOfDay (runs every frame, must not allocate).
// Declared with var-free hoist-safety: these sit above the function so any
// init-time call (e.g. setBiome → updateTimeOfDay(0)) finds them initialized.
const _todCloudTarget = new THREE.Color();
const _todCloudEmissive = new THREE.Color();
const _TOD_CLOUD_WHITE = new THREE.Color(0xffffff);
const _TOD_CLOUD_STORM = new THREE.Color(0x5a6070);
const _TOD_CLOUD_MOONLIGHT = new THREE.Color(0x9abaf8);
const _TOD_CLOUD_DUSK = new THREE.Color(0x8a5030);
let _todIndLastMinutes = -1;
let _todIndLastLabel = '';
function updateTimeOfDay(dt = 0) {
  timeOfDay.phase = (timeOfDay.phase + dt / timeOfDay.cycleSeconds) % 1;
  const angle = timeOfDay.phase * Math.PI * 2;
  const solarElev = Math.sin(angle);
  const solarAz = angle - Math.PI * 0.18;
  const solarX = Math.cos(solarAz);
  const solarZ = Math.sin(solarAz) * 0.62;
  const daylight = smoothstepRange(-0.18, 0.14, solarElev);
  const twilight = Math.max(0, 1 - Math.abs(solarElev) * 4.2);
  const rising = Math.cos(angle) > 0;

  timeOfDay.daylight = daylight;
  if (daylight < 0.14) timeOfDay.label = 'NIGHT';
  else if (twilight > 0.55) timeOfDay.label = rising ? 'DAWN' : 'DUSK';
  else if (solarElev > 0.82) timeOfDay.label = 'NOON';
  else timeOfDay.label = rising ? 'MORNING' : 'AFTERNOON';

  if (solarElev >= -0.04) {
    sunDir.set(solarX * 0.82, Math.max(0.08, solarElev * 0.95 + 0.08), solarZ);
  } else {
    sunDir.set(-solarX * 0.55, 0.16 + (-solarElev) * 0.1, -solarZ * 0.55);
  }
  sunDir.normalize();

  const warmth = twilight * (0.78 + daylight * 0.18);
  todSkyTop.setHex(currentBiome.skyTop).lerp(TOD_NIGHT_TOP, 1 - daylight).lerp(TOD_WARM, warmth * 0.22);
  todSkyBottom.setHex(currentBiome.skyBottom).lerp(TOD_NIGHT_BOTTOM, 1 - daylight).lerp(TOD_WARM, warmth * 0.9);
  todFog.setHex(currentBiome.fogColor).lerp(TOD_NIGHT_FOG, 1 - daylight).lerp(TOD_WARM, warmth * 0.38);
  todSun.setHex(currentBiome.sunColor).lerp(TOD_MOON, 1 - daylight).lerp(TOD_WARM, warmth * 0.82);
  todGround.setHex(currentBiome.groundTint).lerp(TOD_NIGHT_GROUND, 1 - daylight).lerp(TOD_WARM, warmth * 0.1);
  todAmbient.setHex(currentBiome.ambient).lerp(TOD_NIGHT_GROUND, (1 - daylight) * 0.7).lerp(TOD_WARM, warmth * 0.08);
  todLowPolyAmbient.copy(todAmbient).lerp(todGround, 0.18).lerp(todSkyTop, (1 - daylight) * 0.14);

  const terrainFade = clamp01(scene.userData.__terrainFade != null ? scene.userData.__terrainFade : 0.58);
  const nightLift = Math.max(0, Math.min(0.9, scene.userData.__nightLift != null ? scene.userData.__nightLift : 0.35));
  const atmosphereDepth = Math.max(0.7, Math.min(1.25, scene.userData.__atmosphereDepth != null ? scene.userData.__atmosphereDepth : 1.0));
  const fogEnabled = !scene.userData.__fogDisabled;
  const fogMul = 1 - (atmosphereDepth - 1) * 0.22;
  const farMul = 1 - (atmosphereDepth - 1) * 0.16;
  // Render distance pushes the fog ceiling out in lockstep with FAR_RADIUS so the
  // far-chunk ring edge stays hidden in fog (no hard pop-in). near is unchanged.
  const renderDistance = Math.max(0.6, Math.min(2.0, scene.userData.__renderDistance != null ? scene.userData.__renderDistance : 1.0));
  const realFogNear = (280 + (1 - terrainFade) * 260) * fogMul;
  let realFogFar = (4300 + terrainFade * 3200) * farMul * renderDistance;
  const lowFogNear = (420 + (1 - terrainFade) * 320) * fogMul;
  let lowFogFar = (4000 + terrainFade * 2800) * farMul * renderDistance;
  // When the horizon ring is active (renderDistance > 1.0), push the fog ceiling out
  // to ~0.9 of the horizon extent so the new far terrain is actually visible (and the
  // ring edge still saturates in fog just before camera.far clips it). No-op otherwise.
  const horizonExtent = scene.userData.__horizonExtent || 0;
  if (horizonExtent > 0) {
    const ringFog = horizonExtent * 0.9;
    if (ringFog > realFogFar) realFogFar = ringFog;
    if (ringFog > lowFogFar) lowFogFar = ringFog;
  }
  const lowPoly = styleMode.current === 'lowpoly';

  scene.background.copy(todFog);
  scene.fog.color.copy(todFog);
  scene.fog.near = lowFogNear;
  scene.fog.far = fogEnabled ? lowFogFar : 1e9;
  skyMat.uniforms.topColor.value.copy(todSkyTop);
  skyMat.uniforms.bottomColor.value.copy(todSkyBottom);
  skyMat.uniforms.exponent.value = (lowPoly ? 0.35 : 0.55) + (atmosphereDepth - 1) * 0.14 + twilight * 0.04;
  skyMat.uniforms.sunDirection.value.copy(sunDir);
  skyMat.uniforms.sunColor.value.copy(todSun);
  skyMat.uniforms.daylight.value = daylight;
  skyMat.uniforms.twilight.value = twilight;
  skyMat.uniforms.lowPoly.value = lowPoly ? 1.0 : 0.0;
  waterMat.uniforms.fogColor.value.copy(todFog);
  waterMat.uniforms.fogNear.value = lowFogNear;
  waterMat.uniforms.fogFar.value = fogEnabled ? lowFogFar : 1e9;
  waterMat.uniforms.sunDir.value.copy(sunDir);
  sandMat.uniforms.sunDir.value.copy(sunDir);
  sandMat.uniforms.sunColor.value.copy(todSun);
  sandMat.uniforms.fogColor.value.copy(todFog);
  sandMat.uniforms.fogNear.value = realFogNear;
  sandMat.uniforms.fogFar.value = fogEnabled ? realFogFar : 1e9;
  sandMat.uniforms.hazeStrength.value = ATMOS_REALISTIC.hazeStrength + terrainFade * 0.24 + (1 - daylight) * 0.06 + (atmosphereDepth - 1) * 0.34;
  sandMat.uniforms.hazeExponent.value = ATMOS_REALISTIC.hazeExponent + terrainFade * 0.12 + (atmosphereDepth - 1) * 0.08;
  sandMat.uniforms.skyTint.value.copy(todSkyTop);
  sandMat.uniforms.groundTint.value.copy(todGround);
  sandMat.uniforms.ambientColor.value.copy(todAmbient);
  sandMatLowPoly.uniforms.sunDir.value.copy(sunDir);
  sandMatLowPoly.uniforms.sunColor.value.copy(todSun);
  sandMatLowPoly.uniforms.fogColor.value.copy(todFog);
  sandMatLowPoly.uniforms.fogNear.value = lowFogNear;
  sandMatLowPoly.uniforms.fogFar.value = fogEnabled ? lowFogFar : 1e9;
  sandMatLowPoly.uniforms.hazeStrength.value = ATMOS_LOWPOLY.hazeStrength + terrainFade * 0.18 + (1 - daylight) * 0.05 + (atmosphereDepth - 1) * 0.24;
  sandMatLowPoly.uniforms.hazeExponent.value = ATMOS_LOWPOLY.hazeExponent + terrainFade * 0.04 + (atmosphereDepth - 1) * 0.03;
  sandMatLowPoly.uniforms.skyTint.value.copy(todSkyTop);
  sandMatLowPoly.uniforms.groundTint.value.copy(todGround);
  sandMatLowPoly.uniforms.ambientColor.value.copy(todLowPolyAmbient);

  sun.color.copy(todSun);
  const nightFloor = 1 - daylight;
  const liftBoost = nightFloor * nightLift;
  sun.intensity = 0.08 + daylight * 1.55 + twilight * 0.18 + liftBoost * 0.04;
  hemiLight.color.copy(todSkyTop);
  hemiLight.groundColor.copy(todGround);
  // Moonlight — at night (daylight=0) the hemisphere light is tinted cool
  // blue and gets a baseline intensity so surfaces aren't pitch black.
  // Previously 0.08 floor left the plane as pure silhouette.
  hemiLight.intensity = 0.18 + daylight * 0.36 + twilight * 0.05 + nightFloor * 0.22 + liftBoost * 0.42;
  ambientLight.color.copy(todAmbient);
  ambientLight.intensity = 0.10 + daylight * 0.12 + twilight * 0.02 + nightFloor * 0.10 + liftBoost * 0.24;
  renderer.toneMappingExposure = 0.68 + daylight * 0.38 + twilight * 0.08 + liftBoost * 0.18 - (atmosphereDepth - 1) * 0.03;
  updateRunwayLights(1 - daylight, twilight);

  // Clouds: bright + wispy at midday, fuller + darker at dusk/night.
  // Opacity drops with daylight (less overcast look); color trends toward
  // pure white at midday regardless of biome tint. Storm weather overrides
  // back toward dense + grey.
  const stormMix = Math.max(0, Math.min(1, weather.storm || 0));
  const baseCloudOp = currentBiome.cloudOpacity * (0.55 + daylight * 0.15);
  const dayCloudOpacity = baseCloudOp * (1 - stormMix * 0.1) + stormMix * 0.35;
  cloudMat.opacity = dayCloudOpacity;
  cloudMatLow.opacity = dayCloudOpacity;

  const brightenMix = daylight * 0.75 * (1 - stormMix);
  const cloudTarget = _todCloudTarget.setHex(currentBiome.cloudColor).lerp(_TOD_CLOUD_WHITE, brightenMix).lerp(_TOD_CLOUD_STORM, stormMix * 0.8);
  cloudMat.color.copy(cloudTarget);
  cloudMatLow.color.copy(cloudTarget);
  // Emissive tint keeps clouds from turning black when the sun is low.
  // At midday (daylight=1) emissive is 0.15 (dim self-glow overridden by sun);
  // at midnight (daylight=0) emissive is 0.55 so clouds read as moonlit.
  const cloudEmissive = _todCloudEmissive.setHex(currentBiome.cloudColor)
    .lerp(_TOD_CLOUD_MOONLIGHT, 1 - daylight)   // cool moonlight at night
    .lerp(_TOD_CLOUD_DUSK, stormMix * 0.4); // dusky if storming
  cloudMat.emissive.copy(cloudEmissive);
  cloudMatLow.emissive.copy(cloudEmissive);
  const nightGlow = 0.15 + (1 - daylight) * 0.40;
  cloudMat.emissiveIntensity = nightGlow;
  cloudMatLow.emissiveIntensity = nightGlow;
  // High cloud layer shares the puff field's tint, thinned way down and
  // dimmed toward night so it reads as high haze rather than low overcast.
  highCloudMat.color.copy(cloudTarget);
  highCloudMat.opacity = dayCloudOpacity * 0.16 * (0.35 + daylight * 0.65);
  syncCloudWisps();

  sunGrp.userData.core.material.color.copy(todSun);
  sunGrp.userData.halo.material.color.copy(todSun).lerp(TOD_WARM, 0.18);
  sunGrp.userData.outer.material.color.copy(TOD_WARM).lerp(TOD_MOON, 1 - daylight);
  sunGrp.userData.core.material.opacity = 0.35 + daylight * 0.65;
  sunGrp.userData.halo.material.opacity = 0.15 + daylight * 0.45 + twilight * 0.1;
  sunGrp.userData.outer.material.opacity = 0.08 + daylight * 0.18 + twilight * 0.08;
  sunGrp.userData.core.scale.setScalar(110 + daylight * 70 + twilight * 20);
  sunGrp.userData.halo.scale.setScalar(360 + daylight * 190 + twilight * 90);
  sunGrp.userData.outer.scale.setScalar(760 + daylight * 320 + twilight * 140);

  const moonOpacity = clamp01((0.42 - daylight) / 0.42) * (0.55 + twilight * 0.25);
  moonGrp.userData.core.material.opacity = moonOpacity;
  moonGrp.userData.halo.material.opacity = moonOpacity * 0.42;
  moonGrp.userData.core.scale.setScalar(95 + moonOpacity * 55);
  moonGrp.userData.halo.scale.setScalar(210 + moonOpacity * 120);
  const starOpacity = clamp01((0.3 - daylight) / 0.3) * 0.95;
  starField.material.opacity = starOpacity;

  if (typeof $todInd !== 'undefined' && $todInd) {
    // Only touch the DOM when the displayed minute actually changes.
    const totalMinutes = Math.floor(((timeOfDay.phase + 0.25) % 1) * 24 * 60) % (24 * 60);
    if (totalMinutes !== _todIndLastMinutes || timeOfDay.label !== _todIndLastLabel) {
      _todIndLastMinutes = totalMinutes;
      _todIndLastLabel = timeOfDay.label;
      const hh = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
      const mm = String(totalMinutes % 60).padStart(2, '0');
      $todInd.textContent = `${hh}:${mm} ${timeOfDay.label}`;
      $todInd.className = `hud-chip ${daylight < 0.2 ? 'warn' : twilight > 0.55 ? '' : 'ok'}`.trim();
    }
  }
}

const _lfForward = new THREE.Vector3();
const _lfSunScreen = new THREE.Vector3();
const _lfSunScreenOut = { x: 0, y: 0, z: 0 };
const _lfGhostColors = [new THREE.Color(), new THREE.Color(), new THREE.Color()];
function updateLensFlare() {
  if (!sunGrp.userData || !sunGrp.userData.streak || !sunGrp.userData.ghosts) return;
  const streak = sunGrp.userData.streak;
  const ghosts = sunGrp.userData.ghosts;
  const forward = _lfForward.set(0, 0, -1).applyQuaternion(camera.quaternion);
  const facing = clamp01(forward.dot(sunDir));
  const sunScreen = _lfSunScreen.copy(sunGrp.position).project(camera);
  const onScreen = sunScreen.z > -1 && sunScreen.z < 1 && Math.abs(sunScreen.x) < 1.4 && Math.abs(sunScreen.y) < 1.4;
  const daylight = timeOfDay.daylight || 0;
  const flareStrength = onScreen ? Math.pow(facing, 6) * clamp01(0.1 + daylight * 1.15) : 0;
  const edgeFade = clamp01(1 - (Math.abs(sunScreen.x) * 0.45 + Math.abs(sunScreen.y) * 0.35));
  const centerPullX = -sunScreen.x;
  const centerPullY = -sunScreen.y;
  sunGrp.userData.flareStrength = flareStrength * edgeFade;
  _lfSunScreenOut.x = sunScreen.x; _lfSunScreenOut.y = sunScreen.y; _lfSunScreenOut.z = sunScreen.z;
  sunGrp.userData.sunScreen = _lfSunScreenOut;

  streak.position.set(centerPullX * 260, centerPullY * 75, 0);
  streak.material.color.copy(todSun).lerp(TOD_WARM, 0.28);
  streak.material.opacity = flareStrength * edgeFade * 0.26;
  streak.scale.set(1200 + flareStrength * 900, 110 + flareStrength * 90, 1);

  const ghostColors = _lfGhostColors;
  ghostColors[0].copy(todSun).lerp(TOD_WARM, 0.12);
  ghostColors[1].copy(TOD_WARM);
  ghostColors[2].copy(TOD_MOON);
  const ghostFactors = [0.38, 0.9, 1.45];
  ghosts.forEach((ghost, idx) => {
    const factor = ghostFactors[idx] || (idx + 1) * 0.5;
    ghost.position.set(centerPullX * factor * 560, centerPullY * factor * 320, 0);
    ghost.material.color.copy(ghostColors[idx] || todSun);
    ghost.material.opacity = flareStrength * edgeFade * (0.12 - idx * 0.02);
    const base = 90 + idx * 45;
    ghost.scale.setScalar(base + flareStrength * (140 + idx * 40));
  });
}

