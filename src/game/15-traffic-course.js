// @module src/game/15-traffic-course.js
// =============================================================
//  TRAFFIC — other aircraft on fixed procedural paths
// =============================================================
//  Each traffic plane loads a small GLB, scales it to roughly the same
//  visual size as the player, and follows a deterministic path function
//  that returns { pos, yaw, bank } for a given phase (advanced by speed
//  × dt each frame). Self-contained — no physics, no collision, no HUD
//  presence. Purely ambient.
const traffic = [];
const TRAFFIC_UFO_TARGET_FILE = 'procedural:ufo-saucer';

// Shared saucer materials — one set reused by every saucer. Hull/rim/canopy
// are never mutated; beacons pulse from the global clock with a per-rim-index
// phase (i/12), so beacon i of every saucer renders identically and can share
// one material. Per-saucer effects (e.g. a damage tint on the hull) would need
// a clone — sharing means any mutation hits ALL saucers. NEVER dispose these:
// saucer destruction is visibility-only (destroyTarget), models are never
// removed from the scene.
let saucerSharedMats = null;
function getSaucerSharedMats() {
  if (saucerSharedMats) return saucerSharedMats;
  const hull = new THREE.MeshStandardMaterial({
    color: 0x7f92a8,
    emissive: 0x10243d,
    emissiveIntensity: 0.18,
    roughness: 0.38,
    metalness: 0.74,
  });
  const rim = new THREE.MeshStandardMaterial({
    color: 0xb9cadb,
    emissive: 0x234d70,
    emissiveIntensity: 0.22,
    roughness: 0.32,
    metalness: 0.82,
  });
  const canopy = new THREE.MeshStandardMaterial({
    color: 0x9fe8ff,
    emissive: 0x256d8c,
    emissiveIntensity: 0.55,
    roughness: 0.18,
    metalness: 0.12,
    transparent: true,
    opacity: 0.78,
  });
  const beacons = [];
  for (let i = 0; i < 12; i++) {
    beacons.push(new THREE.MeshBasicMaterial({
      color: i % 2 === 0 ? 0x80f7ff : 0xffb86a,
      transparent: true,
      opacity: i % 2 === 0 ? 0.82 : 0.72,
      toneMapped: false,
    }));
  }
  saucerSharedMats = { hull, rim, canopy, beacons };
  for (const m of [hull, rim, canopy, ...beacons]) m.userData.__sharedSaucerMat = true;
  return saucerSharedMats;
}

function createSaucerTargetModel(opts = {}) {
  const root = new THREE.Group();
  root.name = 'orientation-safe UFO target';
  root.rotation.order = 'YXZ';
  root.userData.__isUfoTarget = true;
  root.userData.__trafficTargetType = 'ufo-saucer';
  root.userData.spinRate = opts.spinRate || 1.25;
  root.userData.beaconLights = [];
  root.userData.glowParts = [];
  root.userData.shieldMesh = null;
  root.userData.landingBeam = null;

  const shared = getSaucerSharedMats();
  // Per-saucer: glow opacity tracks this saucer's evasivePhase; shield/beam
  // track its damage state. Everything else uses the shared set above.
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0x60f6ff,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });

  const hull = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 5.8, 0.82, 56, 1), shared.hull);
  hull.name = 'ufo symmetric saucer hull';
  root.add(hull);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(5.25, 0.22, 10, 72), shared.rim);
  rim.name = 'ufo circular rim';
  rim.rotation.x = Math.PI / 2;
  rim.position.y = -0.02;
  root.add(rim);

  const topDome = new THREE.Mesh(new THREE.SphereGeometry(2.85, 36, 14), shared.canopy);
  topDome.name = 'ufo centered canopy dome';
  topDome.scale.set(1, 0.34, 1);
  topDome.position.y = 0.48;
  root.add(topDome);

  const lowerGlow = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 3.65, 0.08, 48, 1), glowMat);
  lowerGlow.name = 'ufo underside glow';
  lowerGlow.position.y = -0.48;
  root.add(lowerGlow);

  const ringGlow = new THREE.Mesh(new THREE.TorusGeometry(4.72, 0.08, 8, 72), glowMat);
  ringGlow.name = 'ufo equator glow';
  ringGlow.rotation.x = Math.PI / 2;
  ringGlow.position.y = 0.18;
  root.add(ringGlow);
  root.userData.glowParts.push(lowerGlow, ringGlow);

  const shield = new THREE.Mesh(
    new THREE.SphereGeometry(6.15, 36, 18),
    new THREE.MeshBasicMaterial({ color: 0x74efff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
  );
  shield.name = 'ufo reactive shield bubble';
  shield.scale.set(1.18, 0.48, 1.18);
  shield.renderOrder = 26;
  root.userData.shieldMesh = shield;
  root.add(shield);

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 4.4, 1, 32, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x9cf8ff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false })
  );
  beam.name = 'ufo vertical landing beam';
  beam.position.y = -8;
  beam.scale.set(1, 16, 1);
  beam.renderOrder = 24;
  root.userData.landingBeam = beam;
  root.add(beam);

  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const mat = shared.beacons[i];
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), mat);
    beacon.name = 'ufo symmetric rim beacon';
    beacon.position.set(Math.cos(a) * 5.15, 0.02, Math.sin(a) * 5.15);
    beacon.userData.phase = i / 12;
    root.userData.beaconLights.push(beacon);
    root.add(beacon);
  }

  root.traverse(o => {
    o.userData.__isUfoTarget = true;
    o.userData.__trafficTargetType = 'ufo-saucer';
  });
  return root;
}

function spawnTraffic(file, pathFn, opts) {
  opts = opts || {};
  const isProceduralUfo = file === TRAFFIC_UFO_TARGET_FILE;
  if (!isProceduralUfo && typeof THREE.GLTFLoader !== 'function') return;
  const group = new THREE.Group();
  group.name = 'traffic:' + file;
  group.rotation.order = 'YXZ';
  group.visible = false;
  scene.add(group);
  const rec = {
    group, pathFn, loaded: false,
    file,
    hudId: opts.hudId || `traffic-${traffic.length + 1}`,
    targetKind: isProceduralUfo ? 'ufo-saucer' : 'aircraft',
    phase: opts.phaseOffset || 0,
    speed: opts.speed || 60,          // metres/sec along path
    bankSmoothed: 0,
    pitchSmoothed: 0,
    callsign: opts.callsign || '',
    typeLabel: opts.typeLabel || '',
    aiMode: 'patrol',
    aiUntil: 0,
    aiBlend: 0,
    evasivePhase: opts.evasivePhase || 0,
    beamSmoothed: 0,
    damageSmokeTimer: 0,
    shieldFailTimer: 0,
    velocity: new THREE.Vector3(),
    prevPosition: new THREE.Vector3(),
    child: null,
  };
  traffic.push(rec);

  const attachTrafficModel = (model, sourceName = file) => {
    if (!model) return;
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const s = (opts.targetSize || 10) / maxDim;
    model.scale.setScalar(s);
    model.position.set(-center.x * s, -center.y * s, -center.z * s);
    // Most Sketchfab models face +Z; we want -Z (sim forward). The UFO is
    // rotationally symmetric, so leave its local yaw free for idle spin.
    if (!model.userData.__isUfoTarget) {
      model.rotation.y = (opts.modelRotY != null) ? opts.modelRotY : Math.PI;
    }
    // Ensure traffic targets don't get caught by the GLB-plane traversal that
    // was meant for the player plane — mark them distinctly.
    model.userData.__isTrafficPlane = !model.userData.__isUfoTarget;
    model.userData.__isTrafficTarget = true;
    model.traverse(o => {
      o.userData.__isTrafficPlane = !model.userData.__isUfoTarget;
      o.userData.__isTrafficTarget = true;
    });
    applyShadowFlags(model);
    group.add(model);
    rec.destructible = registerDestructible(group, {
      radius: Math.max(4, (opts.targetSize || 10) * (opts.radiusMul || 0.6)),
      kind: 'traffic',
      health: opts.health || 3,
      shield: opts.shield != null ? opts.shield : (isProceduralUfo ? Math.max(2, Math.round((opts.health || 3) * 0.9)) : 0),
    });
    rec.destructible.rewardPoints = opts.rewardPoints || 180;
    rec.destructible.rewardAmmo = opts.rewardAmmo || 18;
    rec.destructible.rewardHealth = opts.rewardHealth || 4;
    rec.destructible.rewardMissiles = opts.rewardMissiles || (isProceduralUfo ? 2 : 0);
    rec.destructible.trafficRef = rec;
    rec.child = model;
    rec.loaded = true;
    group.visible = trafficEnabled() && rec.destructible.alive;
    rec.prevPosition.copy(group.position);
    console.log('[traffic] loaded', String(sourceName).split('/').pop(), '×' + s.toFixed(3));
  };

  if (isProceduralUfo) {
    attachTrafficModel(createSaucerTargetModel(opts), 'UFO saucer target');
  } else {
    new THREE.GLTFLoader().load(file, (gltf) => {
      attachTrafficModel(gltf.scene || (gltf.scenes && gltf.scenes[0]));
    }, undefined, (err) => {
      console.warn('[traffic] failed to load', file, err && err.message);
    });
  }
  return rec;
}

// ---- Path generators. Each takes `phase` (metres along arc / imaginary
// curve parameter) and returns { pos, yaw, bank }. yaw uses the sim
// convention: yaw=0 → facing -Z.

// Level circular orbit around (cx,cy,cz) at radius r. clockwise flips
// the direction when viewed from above.
function pathOrbit(cx, cy, cz, r, clockwise) {
  const s = clockwise ? -1 : 1;
  return function(phase) {
    const a = (phase / Math.max(1, r)) * s;
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    // Tangent = d/da(pos): (-sin a, 0, cos a) × s
    const tx = -Math.sin(a) * s;
    const tz =  Math.cos(a) * s;
    const yaw = Math.atan2(tx, -tz);
    return { pos: new THREE.Vector3(x, cy, z), yaw, bank: s * 0.32 };
  };
}

// Lazy figure-8 in the XZ plane centred at (cx,cy,cz).
function pathFigure8(cx, cy, cz, r) {
  return function(phase) {
    const a = phase / Math.max(1, r);
    const x = cx + Math.sin(a) * r;
    const z = cz + Math.sin(a * 2) * r * 0.5;
    // Tangent ∝ (cos a, 0, cos 2a)
    const tx = Math.cos(a);
    const tz = Math.cos(a * 2);
    const yaw = Math.atan2(tx, -tz);
    // Bank follows the sign of the curvature change, which in a fig-8
    // tracks sin(2a). Dampened to feel subtle.
    const bank = -Math.sin(a * 2) * 0.35;
    return { pos: new THREE.Vector3(x, cy, z), yaw, bank };
  };
}

// Back-and-forth transit between p1 and p2. halfPeriod = metres along
// the line for one leg before turning around.
function pathTransit(p1, p2, halfPeriod) {
  const dir = new THREE.Vector3().subVectors(p2, p1).normalize();
  const yawFwd  = Math.atan2(dir.x, -dir.z);
  const yawBack = yawFwd + Math.PI;
  return function(phase) {
    const period = halfPeriod * 2;
    const t = ((phase / halfPeriod) % 2 + 2) % 2;
    const forward = t < 1;
    const u = forward ? t : (2 - t);
    return {
      pos: new THREE.Vector3().lerpVectors(p1, p2, u),
      yaw: forward ? yawFwd : yawBack,
      pitch: 0,
      bank: 0,
    };
  };
}
function wrapRadians(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function pathWaypointLoop(points, opts = {}) {
  const pts = points.map((p) => p.clone ? p.clone() : new THREE.Vector3(p.x, p.y, p.z));
  if (pts.length < 2) return () => ({ pos: new THREE.Vector3(), yaw: 0, pitch: 0, bank: 0 });
  const lookAhead = Math.max(8, opts.lookAhead || 18);
  const bankScale = opts.bankScale || 1.9;
  const segLens = [];
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = Math.max(0.001, a.distanceTo(b));
    segLens.push(len);
    total += len;
  }
  // Rotating scratch slots: this runs once per traffic record per frame, and the
  // old per-call allocations (~7 objects each) were a steady GC-pressure source.
  // 3 sample slots cover prev/cur/next within one call; 2 result slots keep
  // consecutive calls (e.g. estimateTrafficVelocity's pair) from aliasing.
  // Callers must treat returns as transient snapshots — copy what they keep.
  const _sampleSlots = [
    { pos: new THREE.Vector3(), segment: 0 },
    { pos: new THREE.Vector3(), segment: 0 },
    { pos: new THREE.Vector3(), segment: 0 },
  ];
  let _sampleIdx = 0;
  const _results = [
    { pos: new THREE.Vector3(), yaw: 0, pitch: 0, bank: 0, segment: 0 },
    { pos: new THREE.Vector3(), yaw: 0, pitch: 0, bank: 0, segment: 0 },
  ];
  let _resultIdx = 0;
  const _tangent = new THREE.Vector3();
  function sample(distance) {
    const out = _sampleSlots[_sampleIdx];
    _sampleIdx = (_sampleIdx + 1) % 3;
    let d = ((distance % total) + total) % total;
    for (let i = 0; i < segLens.length; i++) {
      const len = segLens[i];
      if (d <= len || i === segLens.length - 1) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const u = len > 0 ? d / len : 0;
        out.pos.lerpVectors(a, b, u);
        out.segment = i;
        return out;
      }
      d -= len;
    }
    out.pos.copy(pts[0]);
    out.segment = 0;
    return out;
  }
  return function(phase) {
    const prev = sample(phase - lookAhead);
    const cur = sample(phase);
    const next = sample(phase + lookAhead);
    _tangent.copy(next.pos).sub(prev.pos);
    const horiz = Math.max(0.001, Math.hypot(_tangent.x, _tangent.z));
    const yaw = Math.atan2(_tangent.x, -_tangent.z);
    const pitch = Math.atan2(_tangent.y, horiz);
    const prevYaw = Math.atan2(cur.pos.x - prev.pos.x, -(cur.pos.z - prev.pos.z));
    const bank = Math.max(-0.38, Math.min(0.38, -wrapRadians(yaw - prevYaw) * bankScale));
    const res = _results[_resultIdx];
    _resultIdx ^= 1;
    res.pos.copy(cur.pos);
    res.yaw = yaw; res.pitch = pitch; res.bank = bank; res.segment = cur.segment;
    return res;
  };
}
function pathAirfieldCircuit(runwayKey = 'runway36', opts = {}) {
  const departureSign = runwayKey === 'runway18' ? 1 : -1;
  const rightSide = departureSign < 0 ? 1 : -1;
  const patternSide = (opts.side != null ? opts.side : 1) * rightSide;
  const groundY = AIRFIELD_SURFACE_Y + 2.35;
  const circuitAlt = opts.circuitAlt || 230;
  const patternX = opts.patternX || 420;
  const point = (sideMeters, altitude, forwardMeters) => new THREE.Vector3(
    patternSide * sideMeters,
    altitude,
    departureSign * forwardMeters
  );
  return pathWaypointLoop([
    point(0, groundY, -150),
    point(0, groundY, -80),
    point(0, groundY, 20),
    point(60, groundY + 22, 120),
    point(180, groundY + 90, 320),
    point(patternX * 0.72, circuitAlt - 28, 620),
    point(patternX, circuitAlt, 860),
    point(patternX, circuitAlt, 180),
    point(patternX, circuitAlt - 24, -340),
    point(patternX * 0.62, circuitAlt - 92, -720),
    point(patternX * 0.18, groundY + 70, -760),
    point(0, groundY + 24, -520),
    point(0, groundY, -260),
  ], { lookAhead: opts.lookAhead || 22, bankScale: 2.05 });
}

function installationByLabel(label, fallback = new THREE.Vector3(0, AIRFIELD_SURFACE_Y, 0)) {
  if (label === 'AIRFIELD') return { label: 'AIRFIELD', pos: new THREE.Vector3(0, AIRFIELD_SURFACE_Y, 0), radius: 70 };
  const rec = worldInstallations.find(inst => inst.label === label) || worldInstallations[0];
  return rec || { label: 'AIRFIELD', pos: fallback.clone ? fallback.clone() : fallback, radius: 30 };
}
function pathUfoVerticalVisit(label, opts = {}) {
  const site = installationByLabel(label);
  const p = site.pos.clone();
  const groundY = p.y + 2.4;
  const hoverY = groundY + (opts.hoverY || 32);
  const cruiseY = groundY + (opts.cruiseY || 230);
  const r = opts.radius || (site.radius || 28) + 58;
  const loop = pathWaypointLoop([
    new THREE.Vector3(p.x - r, cruiseY, p.z - r * 1.4),
    new THREE.Vector3(p.x + r * 0.6, cruiseY + 34, p.z - r),
    new THREE.Vector3(p.x + r * 0.35, hoverY, p.z - r * 0.18),
    new THREE.Vector3(p.x, groundY + 4.6, p.z),
    new THREE.Vector3(p.x, groundY + 4.6, p.z),
    new THREE.Vector3(p.x, hoverY, p.z),
    new THREE.Vector3(p.x - r * 0.9, hoverY + 18, p.z + r * 0.55),
    new THREE.Vector3(p.x - r * 1.4, cruiseY, p.z + r * 1.2),
  ], { lookAhead: opts.lookAhead || 14, bankScale: 0.55 });
  return function(phase) {
    const sample = loop(phase);
    const agl = sample.pos.y - p.y;
    sample.bank *= 0.35;
    sample.beam = agl < 82 ? clamp01((82 - agl) / 70) : 0;
    sample.lowPass = agl < 48;
    sample.siteLabel = label;
    return sample;
  };
}
function pathUfoLowPass(labelA, labelB, opts = {}) {
  const a = installationByLabel(labelA, new THREE.Vector3(0, AIRFIELD_SURFACE_Y, -180));
  const b = installationByLabel(labelB, new THREE.Vector3(0, AIRFIELD_SURFACE_Y, 180));
  const lift = opts.lift || 46;
  return pathWaypointLoop([
    new THREE.Vector3(a.pos.x - 260, a.pos.y + 170, a.pos.z - 340),
    new THREE.Vector3(a.pos.x - 90, a.pos.y + lift, a.pos.z - 96),
    new THREE.Vector3(a.pos.x + 40, a.pos.y + Math.max(26, lift * 0.7), a.pos.z + 24),
    new THREE.Vector3(0, AIRFIELD_SURFACE_Y + 26, opts.runwayZ || -40),
    new THREE.Vector3(b.pos.x - 64, b.pos.y + lift, b.pos.z - 54),
    new THREE.Vector3(b.pos.x + 220, b.pos.y + 180, b.pos.z + 360),
  ], { lookAhead: opts.lookAhead || 26, bankScale: 2.8 });
}
function pathUfoWideRoam(opts = {}) {
  const y = opts.y || 280;
  const rx = opts.rx || 980;
  const rz = opts.rz || 780;
  return function(phase) {
    const a = phase / Math.max(1, opts.period || 560);
    const x = Math.sin(a * 0.91 + (opts.phase || 0)) * rx + Math.sin(a * 1.7) * 130;
    const z = Math.cos(a * 1.13 + (opts.phase || 0.3)) * rz + Math.sin(a * 0.43) * 220;
    const yy = y + Math.sin(a * 1.9) * 64 + Math.sin(a * 0.37) * 32;
    const tx = Math.cos(a * 0.91) * rx * 0.91 + Math.cos(a * 1.7) * 221;
    const tz = -Math.sin(a * 1.13) * rz * 1.13 + Math.cos(a * 0.43) * 95;
    return { pos: new THREE.Vector3(x, yy, z), yaw: Math.atan2(tx, -tz), pitch: Math.sin(a * 1.9) * 0.08, bank: Math.sin(a * 1.4) * 0.36, beam: 0 };
  };
}

function trafficEnabled() {
  // Traffic (UFOs etc.) is scenery/combat fodder, not networked. It used to be
  // gated behind `!MULTIPLAYER_URL`, but on live deploys MULTIPLAYER_URL
  // auto-fills to the current host, which silently hid all UFOs in production.
  // Decoupled: traffic now follows ambient FX density only. MP rooms still see
  // local UFOs, which is fine — they aren't synced and act as shared scenery.
  const ambientDensity = scene.userData.__ambientFxDensity != null ? scene.userData.__ambientFxDensity : 1.0;
  return ambientDensity > 0.05;
}

const _trafficPos = new THREE.Vector3();
const _trafficOrbit = new THREE.Vector3();
function updateTraffic(dt) {
  if (!trafficEnabled()) {
    for (const t of traffic) {
      if (!t.group) continue;
      t.group.visible = false;
      if (t.destructible && t.destructible.object) t.destructible.object.visible = false;
    }
    return;
  }
  const nowMs = performance.now();
  for (const t of traffic) {
    if (!t.loaded) continue;
    if (!t.group) continue; // __traffic_safety__ skip entries missing group (async load race)
    const alive = !!(t.destructible ? t.destructible.alive : true);
    t.group.visible = alive;
    if (!alive) continue;
    t.phase += dt * t.speed;
    const sample = t.pathFn(t.phase) || {};
    const isUfo = t.targetKind === 'ufo-saucer' || (t.child && t.child.userData.__isUfoTarget);
    // pos never escapes the iteration (it's copied into group.position /
    // prevPosition below) — reuse one scratch vector instead of a per-record clone
    const pos = sample.pos ? _trafficPos.copy(sample.pos) : _trafficPos.set(0, 0, 0);
    let yaw = sample.yaw || 0;
    let pitch = sample.pitch || 0;
    let bank = sample.bank || 0;

    if (isUfo) {
      applyLearnedFlightPatternToUfo(t, pos, dt);
      const aiActive = t.aiUntil && t.aiUntil > nowMs;
      const aiTarget = aiActive ? 1 : 0;
      t.aiBlend += (aiTarget - (t.aiBlend || 0)) * Math.min(1, dt * (aiTarget ? 2.6 : 1.2));
      if (!aiActive && (t.aiBlend || 0) <= 0.025) t.aiMode = 'patrol';
      const aiBlend = clamp01(t.aiBlend || 0);
      if (aiBlend > 0.01) {
        const phase = nowMs * 0.0013 + (t.evasivePhase || 0);
        if (t.aiMode === 'dogfight') {
          const orbitRadius = 170 + Math.sin(phase * 0.7) * 48;
          const desired = _combatTmpA.copy(plane.pos)
            .add(_trafficOrbit.set(Math.cos(phase) * orbitRadius, 0, Math.sin(phase) * orbitRadius));
          const terrain = desired.x * desired.x + desired.z * desired.z < AIRFIELD_FLAT_R2
            ? AIRFIELD_SURFACE_Y : getHeight(desired.x, desired.z);
          desired.y = Math.max(terrain + 72, plane.pos.y + 42 + Math.sin(phase * 1.6) * 38);
          pos.lerp(desired, aiBlend * 0.42);
          const face = _combatTmpB.copy(plane.pos).sub(pos);
          const faceLen = Math.max(1, face.length());
          yaw = Math.atan2(face.x, -face.z);
          pitch = Math.max(-0.42, Math.min(0.42, Math.asin(Math.max(-0.8, Math.min(0.8, face.y / faceLen)))));
          bank += Math.sin(phase * 2.4) * 0.62 * aiBlend;
        } else if (t.aiMode === 'flee') {
          const away = _combatTmpB.copy(pos).sub(plane.pos);
          if (away.lengthSq() < 1) away.set(Math.sin(phase), 0.22, Math.cos(phase));
          away.normalize();
          const dist = Math.max(1, pos.distanceTo(plane.pos));
          pos.addScaledVector(away, aiBlend * (115 + clamp01(1 - dist / 900) * 170));
          pos.y += aiBlend * (70 + Math.sin(phase * 2.2) * 34);
          yaw = Math.atan2(away.x, -away.z);
          pitch = 0.18 + Math.sin(phase * 1.8) * 0.12;
          bank += Math.sin(phase * 3.1) * 0.72 * aiBlend;
        }
      }
    }

    if (isUfo && t.destructible) {
      const terrainH = (pos.x * pos.x + pos.z * pos.z < AIRFIELD_FLAT_R2) ? AIRFIELD_SURFACE_Y : getHeight(pos.x, pos.z);
      const minClearance = terrainH + 8.5;
      const lowClearance = pos.y < minClearance;
      if (lowClearance) {
        const hitPos = pos.clone();
        hitPos.y = terrainH + 0.35;
        const bounceDepth = Math.max(0.2, minClearance - pos.y);
        pos.y = minClearance + Math.min(28, bounceDepth * 1.7);
        const away = _combatTmpB.set(pos.x, 0, pos.z);
        if (away.lengthSq() < 1) away.set(Math.sin(nowMs * 0.002 + (t.evasivePhase || 0)), 0, Math.cos(nowMs * 0.002 + (t.evasivePhase || 0)));
        away.normalize();
        pos.addScaledVector(away, 8 + Math.min(42, bounceDepth * 1.4));
        t.aiMode = 'flee';
        t.aiUntil = Math.max(t.aiUntil || 0, nowMs + 1500);
        t.aiBlend = Math.max(t.aiBlend || 0, 0.42);
        t.evasivePhase = (t.evasivePhase || 0) + 0.9;
        if (nowMs > (t.terrainBounceAt || 0) + 520) {
          t.terrainBounceAt = nowMs;
          const shieldHit = t.destructible.shield > 0;
          if (shieldHit) {
            t.destructible.shield = Math.max(0, t.destructible.shield - (0.45 + Math.min(1.2, bounceDepth * 0.055)));
            t.destructible.lastDamageText = `SHIELD ${Math.round((t.destructible.shield / Math.max(1, t.destructible.shieldMax || 1)) * 100)}%`;
          } else {
            const currentHull = Number.isFinite(t.destructible.health) ? t.destructible.health : (t.destructible.maxHealth || 1);
            t.destructible.health = Math.max(1, currentHull - 0.18);
            t.destructible.lastDamageText = `HULL ${Math.round((t.destructible.health / Math.max(1, t.destructible.maxHealth || 1)) * 100)}%`;
          }
          t.destructible.shieldPulse = Math.min(1.8, (t.destructible.shieldPulse || 0) + 1.05);
          impactBlastPool.emitCluster(hitPos, 8, 0.85, 0.08, 0.34, 0.86);
          impactSparkPool.emitCluster(hitPos, 12, 0.92, 0.12, 0.38, 0.92);
          explosionSmokePool.emitCluster(hitPos.clone().add(new THREE.Vector3(0, 1.1, 0)), 5, 0.9, 0.12, 0.82, 0.74);
          // Quiet terrain bounces: visual shield/spark feedback is enough.
          // Do not show a center-screen banner for routine saucer ground skips.
        }
      }
    }

    if (t.prevPosition && t.prevPosition.lengthSq() > 0) {
      t.velocity.copy(pos).sub(t.prevPosition).divideScalar(Math.max(dt, 1e-3));
    } else if (t.velocity) {
      t.velocity.set(0, 0, 0);
    }
    if (t.prevPosition) t.prevPosition.copy(pos);
    t.group.position.copy(pos);
    if (isUfo && t.destructible) {
      fireUfoPulse(t, pos, dt);
      const hullRatio = clamp01((t.destructible.health || 0) / Math.max(1, t.destructible.maxHealth || 1));
      const shieldRatio = clamp01((t.destructible.shield || 0) / Math.max(1, t.destructible.shieldMax || 1));
      const damaged = hullRatio < 0.82;
      const critical = hullRatio < 0.42 || (damaged && shieldRatio <= 0.02);
      if (damaged) {
        t.damageSmokeTimer -= dt;
        const cadence = critical ? 0.045 : 0.09;
        if (t.damageSmokeTimer <= 0) {
          t.damageSmokeTimer = cadence;
          const trailDir = (t.velocity && t.velocity.lengthSq() > 1)
            ? t.velocity.clone().normalize().multiplyScalar(-1)
            : new THREE.Vector3(Math.sin(nowMs * 0.001), -0.08, Math.cos(nowMs * 0.001)).normalize();
          const smokePos = pos.clone()
            .addScaledVector(trailDir, 4.8 + (critical ? 2.4 : 0))
            .add(new THREE.Vector3((Math.random() - 0.5) * 2.2, -0.35 + Math.random() * 0.9, (Math.random() - 0.5) * 2.2));
          explosionSmokePool.emitCluster(smokePos, critical ? 2 : 1, critical ? 1.25 : 0.78, 0.12, critical ? 1.45 : 1.05, critical ? 1.35 : 0.95);
        }
      }
      if (shieldRatio < 0.35 || (t.destructible.shieldPulse || 0) > 0.25) {
        t.shieldFailTimer -= dt;
        if (t.shieldFailTimer <= 0) {
          t.shieldFailTimer = shieldRatio > 0 ? 0.13 : 0.075;
          const sparkPos = pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8.8, (Math.random() - 0.5) * 2.4, (Math.random() - 0.5) * 8.8));
          impactSparkPool.emitCluster(sparkPos, shieldRatio > 0 ? 2 : 4, shieldRatio > 0 ? 0.55 : 0.82, 0.08, 0.28, shieldRatio > 0 ? 0.65 : 0.95);
        }
      }
    }
    t.pitchSmoothed += (pitch - t.pitchSmoothed) * Math.min(1, dt * 2.2);
    t.group.rotation.set(t.pitchSmoothed, yaw, 0);
    // Smooth bank so traffic follows curved legs with a readable roll. UFO
    // targets keep a circular, orientation-safe silhouette and add subtle
    // local spin/pulsing instead of relying on a forward-facing model.
    if (t.child) {
      t.bankSmoothed += (bank - t.bankSmoothed) * Math.min(1, dt * 2.6);
      if (t.child.userData.__isUfoTarget) {
        t.child.rotation.y += dt * (t.child.userData.spinRate || 1.25) * (1 + (t.aiBlend || 0) * 0.55);
        t.child.rotation.z = t.bankSmoothed * 0.55;
        const lights = t.child.userData.beaconLights || [];
        const pulseT = nowMs * 0.004;
        for (let i = 0; i < lights.length; i++) {
          const beacon = lights[i];
          const pulse = 0.62 + Math.max(0, Math.sin(pulseT + (beacon.userData.phase || 0) * Math.PI * 2)) * 0.45;
          beacon.material.opacity = Math.min(1, pulse);
          beacon.scale.setScalar(0.82 + pulse * 0.42 + (t.aiBlend || 0) * 0.18);
        }
        for (const glow of (t.child.userData.glowParts || [])) {
          if (glow.material) glow.material.opacity = 0.28 + Math.max(0, Math.sin(pulseT * 0.8 + (t.evasivePhase || 0))) * 0.24;
        }
        const destructible = t.destructible;
        if (destructible) {
          destructible.shieldPulse = Math.max(0, (destructible.shieldPulse || 0) - dt * 1.35);
          const shield = t.child.userData.shieldMesh;
          if (shield && shield.material) {
            const shieldRatio = clamp01((destructible.shield || 0) / Math.max(1, destructible.shieldMax || 1));
            const hullRatio = clamp01((destructible.health || 0) / Math.max(1, destructible.maxHealth || 1));
            const hitPulse = clamp01(destructible.shieldPulse || 0);
            const failing = shieldRatio < 0.34 || hullRatio < 0.66;
            const glitch = failing ? Math.max(0, Math.sin(pulseT * 6.4 + (t.evasivePhase || 0))) : 0;
            const opacity = Math.max(hitPulse * 0.42, shieldRatio > 0 ? 0.035 + shieldRatio * 0.045 : 0, failing ? glitch * 0.16 : 0);
            shield.visible = opacity > 0.012;
            shield.material.opacity = opacity;
            shield.material.color.setHex(destructible.shield > 0 ? (failing && glitch > 0.55 ? 0xffd36a : 0x74efff) : 0xff8c6a);
            const s = 1 + hitPulse * 0.16 + Math.sin(pulseT * (failing ? 3.4 : 1.4)) * (failing ? 0.035 : 0.015) + glitch * 0.05;
            shield.scale.set(1.18 * s, 0.48 * s, 1.18 * s);
          }
        }
        const beam = t.child.userData.landingBeam;
        if (beam && beam.material) {
          const groundH = pos.x * pos.x + pos.z * pos.z < AIRFIELD_FLAT_R2 ? AIRFIELD_SURFACE_Y : getHeight(pos.x, pos.z);
          const length = Math.max(7, pos.y - groundH - 1.5);
          const beamTarget = clamp01(sample.beam || 0);
          t.beamSmoothed += (beamTarget - (t.beamSmoothed || 0)) * Math.min(1, dt * 4.6);
          const beamOpacity = t.beamSmoothed * (0.18 + Math.max(0, Math.sin(pulseT * 0.9)) * 0.18);
          beam.visible = beamOpacity > 0.012;
          beam.position.y = -length * 0.5;
          beam.scale.set(0.75 + t.beamSmoothed * 0.35, length, 0.75 + t.beamSmoothed * 0.35);
          beam.material.opacity = beamOpacity;
        }
      } else {
        t.child.rotation.z = t.bankSmoothed;
      }
    }
  }
}

// ---- Populate: orientation-safe UFO drone traffic following runway circuits.
// These replace ambient shoot-down prop planes: the circular saucer silhouette
// stays readable even if yaw/bank/asset-facing assumptions are wrong.
spawnTraffic(
  TRAFFIC_UFO_TARGET_FILE,
  pathAirfieldCircuit('runway36', { circuitAlt: 240, patternX: 420 }),
  // phase 220 puts it just past the runway threshold in the climb-out segment
  // (waypoints p0-p2 = 0-170m are ground/runway; p2->p3 ~289m is rotation).
  // Avoids spawning parked on the runway.
  { speed: 72, targetSize: 11.5, radiusMul: 0.72, phaseOffset: 220, health: 3, rewardPoints: 220, rewardAmmo: 20, callsign: 'UFO 11', typeLabel: 'SAUCER DRONE' }
);
spawnTraffic(
  TRAFFIC_UFO_TARGET_FILE,
  pathAirfieldCircuit('runway18', { circuitAlt: 250, patternX: 440 }),
  { speed: 78, targetSize: 11.8, radiusMul: 0.72, phaseOffset: 320, health: 3, rewardPoints: 250, rewardAmmo: 22, callsign: 'UFO 21', typeLabel: 'SAUCER DRONE' }
);
spawnTraffic(
  TRAFFIC_UFO_TARGET_FILE,
  pathAirfieldCircuit('runway36', { circuitAlt: 270, patternX: 500, lookAhead: 26 }),
  { speed: 80, targetSize: 12.6, radiusMul: 0.72, phaseOffset: 860, health: 4, rewardPoints: 300, rewardAmmo: 28, callsign: 'UFO 31', typeLabel: 'HEAVY SAUCER' }
);
spawnTraffic(
  TRAFFIC_UFO_TARGET_FILE,
  pathAirfieldCircuit('runway18', { circuitAlt: 225, patternX: 390 }),
  { speed: 74, targetSize: 11.4, radiusMul: 0.72, phaseOffset: 1180, health: 3, rewardPoints: 240, callsign: 'UFO 41', typeLabel: 'SAUCER DRONE' }
);
spawnTraffic(
  TRAFFIC_UFO_TARGET_FILE,
  pathAirfieldCircuit('runway36', { circuitAlt: 210, patternX: 360 }),
  { speed: 64, targetSize: 11.9, radiusMul: 0.72, phaseOffset: 1640, health: 3, rewardPoints: 230, rewardAmmo: 20, callsign: 'UFO 51', typeLabel: 'SAUCER DRONE' }
);
// Second wave — wider/higher patterns, all phases land in the airborne
// portion of the circuit (>~290m past p3) so none spawn parked.
spawnTraffic(
  TRAFFIC_UFO_TARGET_FILE,
  pathAirfieldCircuit('runway36', { circuitAlt: 290, patternX: 540 }),
  { speed: 70, targetSize: 12.0, radiusMul: 0.72, phaseOffset: 1400, health: 3, rewardPoints: 240, rewardAmmo: 22, callsign: 'UFO 12', typeLabel: 'SAUCER DRONE' }
);
spawnTraffic(
  TRAFFIC_UFO_TARGET_FILE,
  pathAirfieldCircuit('runway18', { circuitAlt: 200, patternX: 380, side: -1 }),
  { speed: 76, targetSize: 11.6, radiusMul: 0.72, phaseOffset: 700, health: 3, rewardPoints: 230, rewardAmmo: 20, callsign: 'UFO 22', typeLabel: 'SAUCER DRONE' }
);
spawnTraffic(
  TRAFFIC_UFO_TARGET_FILE,
  pathAirfieldCircuit('runway36', { circuitAlt: 320, patternX: 600, lookAhead: 28 }),
  { speed: 84, targetSize: 13.0, radiusMul: 0.72, phaseOffset: 2200, health: 4, rewardPoints: 320, rewardAmmo: 30, callsign: 'UFO 32', typeLabel: 'HEAVY SAUCER' }
);
spawnTraffic(
  TRAFFIC_UFO_TARGET_FILE,
  pathAirfieldCircuit('runway18', { circuitAlt: 260, patternX: 460 }),
  { speed: 68, targetSize: 11.7, radiusMul: 0.72, phaseOffset: 2400, health: 3, rewardPoints: 240, rewardAmmo: 22, callsign: 'UFO 42', typeLabel: 'SAUCER DRONE' }
);
spawnTraffic(
  TRAFFIC_UFO_TARGET_FILE,
  pathAirfieldCircuit('runway36', { circuitAlt: 340, patternX: 660, side: -1 }),
  { speed: 88, targetSize: 13.4, radiusMul: 0.72, phaseOffset: 500, health: 4, rewardPoints: 340, rewardAmmo: 32, callsign: 'UFO 61', typeLabel: 'HEAVY SAUCER' }
);

// Encounter layer: landers, low passes, and wide-roaming interceptors around
// the airfield and generated installations. These deliberately use different
// path families so the sky stops feeling like one synchronized racetrack.
spawnTraffic(
  TRAFFIC_UFO_TARGET_FILE,
  pathUfoVerticalVisit('AIRFIELD', { hoverY: 36, cruiseY: 245, radius: 150 }),
  { speed: 38, targetSize: 13.8, radiusMul: 0.78, phaseOffset: 80, health: 5, shield: 5, rewardPoints: 420, rewardAmmo: 28, rewardMissiles: 2, callsign: 'UFO LZ', typeLabel: 'VERTICAL LANDER' }
);
spawnTraffic(
  TRAFFIC_UFO_TARGET_FILE,
  pathUfoVerticalVisit('RIDGE ARRAY', { hoverY: 42, cruiseY: 310, radius: 165 }),
  { speed: 44, targetSize: 12.8, radiusMul: 0.76, phaseOffset: 290, health: 4, shield: 4, rewardPoints: 360, rewardAmmo: 24, callsign: 'UFO RA', typeLabel: 'SITE LANDER' }
);
spawnTraffic(
  TRAFFIC_UFO_TARGET_FILE,
  pathUfoVerticalVisit('RESERVOIR LAB', { hoverY: 48, cruiseY: 285, radius: 175 }),
  { speed: 41, targetSize: 13.0, radiusMul: 0.76, phaseOffset: 520, health: 4, shield: 4, rewardPoints: 380, rewardAmmo: 24, callsign: 'UFO LAB', typeLabel: 'SITE LANDER' }
);
spawnTraffic(
  TRAFFIC_UFO_TARGET_FILE,
  pathUfoLowPass('RIDGE ARRAY', 'AIRFIELD', { lift: 34, runwayZ: -50 }),
  { speed: 118, targetSize: 11.7, radiusMul: 0.72, phaseOffset: 160, health: 3, shield: 3, rewardPoints: 330, rewardAmmo: 20, callsign: 'UFO FAST', typeLabel: 'LOW PASS' }
);
spawnTraffic(
  TRAFFIC_UFO_TARGET_FILE,
  pathUfoLowPass('CANYON RELAY', 'RESERVOIR LAB', { lift: 42, runwayZ: 80 }),
  { speed: 106, targetSize: 12.0, radiusMul: 0.72, phaseOffset: 430, health: 3, shield: 3, rewardPoints: 330, rewardAmmo: 20, callsign: 'UFO SWP', typeLabel: 'LOW PASS' }
);
spawnTraffic(
  TRAFFIC_UFO_TARGET_FILE,
  pathUfoWideRoam({ y: 340, rx: 1120, rz: 880, period: 520, phase: 1.6 }),
  { speed: 70, targetSize: 14.2, radiusMul: 0.78, phaseOffset: 0, health: 5, shield: 5, rewardPoints: 460, rewardAmmo: 30, rewardMissiles: 3, callsign: 'UFO ACE', typeLabel: 'DOGFIGHT ACE' }
);

// __world_feature_descend_rings__ — Descending yellow ring corridor for descend curriculum
(function addDescendRings() {
  const RING_COUNT = 5;
  const RING_RADIUS = 30;
  const TUBE_RADIUS = 1.8;
  
  // Start and end positions
  const START = { x: 0, y: 400, z: -1500 };
  const END = { x: 0, y: 60, z: -3000 };
  
  const yellowMat = new THREE.MeshStandardMaterial({
    color: 0xffcc00,
    emissive: 0xffaa00,
    emissiveIntensity: 0.9,
    roughness: 0.2,
    metalness: 0.1,
    transparent: true,
    opacity: 0.9
  });
  
  const ringGeo = new THREE.TorusGeometry(RING_RADIUS, TUBE_RADIUS, 16, 64);
  
  window.__descendRings = [];
  
  for (let i = 0; i < RING_COUNT; i++) {
    const t = i / (RING_COUNT - 1); // 0 to 1
    
    // Linear interpolation between start and end
    const x = START.x + t * (END.x - START.x);
    const y = START.y + t * (END.y - START.y);
    const z = START.z + t * (END.z - START.z);
    
    const ring = new THREE.Mesh(ringGeo, yellowMat.clone());
    ring.position.set(x, y, z);
    // Vertical gate (hole on Z) with a forward-tilt matching the descent
    // slope, so each ring is perpendicular to the ideal glide path.
    const descentAngle = Math.atan2(START.y - END.y, -(END.z - START.z));
    ring.rotation.x = descentAngle * (0.7 + t * 0.3);
    ring.userData.ringIndex = i;
    ring.userData.baseY = y;
    ring.userData.phase = i * 1.5;
    ring.userData.isDescendRing = true;
    ring.userData.__origEmissive = 0xffaa00;
    ring.userData.__origEmissiveInt = 0.9;
    ring.userData.__origOpacity = 0.9;
    scene.add(ring);
    window.__descendRings.push(ring);
    registerGate(ring, { radius: 32, points: 150, kind: 'descend' });
  }
  
  // Add helper arrow markers pointing down at each ring
  const arrowGeo = new THREE.ConeGeometry(4, 12, 8);
  const arrowMat = new THREE.MeshBasicMaterial({ 
    color: 0xffcc00, 
    transparent: true, 
    opacity: 0.6 
  });
  
  for (let i = 0; i < RING_COUNT; i++) {
    const t = i / (RING_COUNT - 1);
    const x = START.x + t * (END.x - START.x);
    const y = START.y + t * (END.y - START.y);
    const z = START.z + t * (END.z - START.z);
    
    // Arrow above ring pointing down
    const arrow = new THREE.Mesh(arrowGeo, arrowMat);
    arrow.position.set(x, y + 45, z);
    arrow.rotation.x = Math.PI; // point down
    arrow.userData.isDescendArrow = true;
    scene.add(arrow);
    window.__descendRings.push(arrow); // track for cleanup if needed
  }
})();

// __world_feature_landing_training__ — Dual-end landing approach trainers with flare/touchdown cues
(function addLandingTraining() {
  const RING_COUNT = 5;
  const ringGeo = new THREE.TorusGeometry(26, 1.5, 14, 56);
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0x66ff99,
    emissive: 0x44ff99,
    emissiveIntensity: 0.8,
    roughness: 0.28,
    metalness: 0.15,
    transparent: true,
    opacity: 0.9,
  });
  const flareMat = new THREE.MeshBasicMaterial({
    color: 0xfff6bf,
    transparent: true,
    opacity: 0.72,
    toneMapped: false,
  });
  const touchdownMat = new THREE.MeshBasicMaterial({
    color: 0x7dffd1,
    transparent: true,
    opacity: 0.4,
    toneMapped: false,
  });
  window.__landingTraining = [];

  function addApproach(thresholdZ, dir) {
    for (let i = 0; i < RING_COUNT; i++) {
      const t = i / (RING_COUNT - 1);
      const dist = 980 - t * 760;
      const y = 240 - t * 212;
      const z = thresholdZ - dir * dist;
      const ring = new THREE.Mesh(ringGeo, ringMat.clone());
      ring.position.set(0, y, z);
      // Vertical gate tilted forward to match the 3° glide slope at t=0,
      // flattening to near-vertical at t=1 (the threshold).
      ring.rotation.x = -(0.22 - t * 0.17) * dir;
      ring.userData.isLandingTraining = true;
      ring.userData.sequence = i;
      scene.add(ring);
      window.__landingTraining.push(ring);
    }

    // Flare chevrons just before touchdown
    for (let i = 0; i < 3; i++) {
      const width = 18 - i * 3.5;
      const offsetZ = dir * (22 - i * 8);
      const left = new THREE.Mesh(new THREE.PlaneGeometry(2.2, width), flareMat);
      left.rotation.x = -Math.PI / 2;
      left.rotation.z = dir * 0.48;
      left.position.set(-7.5 - i * 2.5, 0.07, thresholdZ + offsetZ);
      scene.add(left);
      window.__landingTraining.push(left);
      const right = left.clone();
      right.rotation.z = -dir * 0.48;
      right.position.x *= -1;
      scene.add(right);
      window.__landingTraining.push(right);
    }

    // Touchdown box on the runway
    const box = new THREE.Mesh(new THREE.PlaneGeometry(18, 34), touchdownMat);
    box.rotation.x = -Math.PI / 2;
    box.position.set(0, 0.06, thresholdZ + dir * 34);
    scene.add(box);
    window.__landingTraining.push(box);
  }

  addApproach(-150, 1);
  addApproach(150, -1);
})();

// __world_feature_space_target__ — Big floating practice target inspired by the space game.
(function addFloatingTarget() {
  if (!ENABLE_FLOATING_TARGET) {
    window.__floatingTarget = null;
    return;
  }
  const group = new THREE.Group();
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0x62d6ff,
    emissive: 0x2aa8ff,
    emissiveIntensity: 0.9,
    roughness: 0.18,
    metalness: 0.2,
    transparent: true,
    opacity: 0.92,
  });
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xff6b4a,
    emissive: 0xff3c1a,
    emissiveIntensity: 1.1,
    roughness: 0.25,
    metalness: 0.1,
  });
  const outerRing = new THREE.Mesh(new THREE.TorusGeometry(26, 2.1, 18, 84), ringMat);
  outerRing.rotation.x = Math.PI / 2;
  group.add(outerRing);
  const innerRing = new THREE.Mesh(new THREE.TorusGeometry(12.5, 0.95, 14, 56), ringMat.clone());
  innerRing.rotation.y = Math.PI / 2;
  group.add(innerRing);
  const core = new THREE.Mesh(new THREE.SphereGeometry(4.8, 20, 16), coreMat);
  group.add(core);
  const pointer = new THREE.Mesh(new THREE.ConeGeometry(3.2, 9, 12), new THREE.MeshBasicMaterial({ color: 0xfff3c0, toneMapped: false }));
  pointer.rotation.x = Math.PI / 2;
  pointer.position.z = -22;
  group.add(pointer);
  group.position.set(0, 18, -120);
  group.userData.baseY = 18;
  group.userData.spin = 0;
  group.userData.outerRing = outerRing;
  group.userData.innerRing = innerRing;
  group.userData.core = core;
  group.userData.pointer = pointer;
  scene.add(group);
  registerDestructible(group, { radius: 15, kind: 'floatingTarget' });
  window.__floatingTarget = group;
})();

function updateFloatingTarget(dt) {
  const target = window.__floatingTarget;
  if (!target || !target.visible) return;
  target.userData.spin += dt;
  target.position.y = target.userData.baseY + Math.sin(target.userData.spin * 1.7) * 2.2;
  if (target.userData.outerRing) target.userData.outerRing.rotation.z += dt * 0.85;
  if (target.userData.innerRing) target.userData.innerRing.rotation.x += dt * 1.35;
  if (target.userData.core) target.userData.core.scale.setScalar(1 + Math.sin(target.userData.spin * 4.0) * 0.08);
  if (target.userData.pointer) target.userData.pointer.rotation.z = Math.sin(target.userData.spin * 2.8) * 0.16;
}

// __world_feature_practice_ring_course__ — Lightweight free-fly practice ring chain
// inspired by the R3F takes-flight ring targets. Uses our gate/scoring system.
const PRACTICE_RING_THEMES = {
  cyan:    { color: 0x7fe6ff, emissive: 0x2aa7d4 },
  amber:   { color: 0xffd37f, emissive: 0xff9f1f },
  magenta: { color: 0xff9adb, emissive: 0xb83fd6 },
  lime:    { color: 0xcdfb8a, emissive: 0x62c542 },
};
function isPracticeRingThemeKey(key) {
  return Object.prototype.hasOwnProperty.call(PRACTICE_RING_THEMES, key);
}
function getPracticeRingTheme(key) {
  return isPracticeRingThemeKey(key) ? PRACTICE_RING_THEMES[key] : PRACTICE_RING_THEMES.cyan;
}
function updateCourseLineSegment(line, start, end, active, theme) {
  if (!line) return;
  line.visible = !!active;
  if (!active) return;
  const pos = line.geometry.attributes.position;
  pos.setXYZ(0, start.x, start.y, start.z);
  pos.setXYZ(1, end.x, end.y, end.z);
  pos.needsUpdate = true;
  line.geometry.computeBoundingSphere();
  if (line.material) {
    line.material.color.setHex(theme.emissive);
    line.material.opacity = 0.18 + Math.min(1, line.userData.__segmentIndex / 5) * 0.05;
  }
}
function applyPracticeRingCourseTuning() {
  const course = window.__practiceRingCourse;
  if (!course || !course.length || !course.basePoints || !course.anchorPoint) return;
  const enabled = scene.userData.__practiceRingEnabled !== false;
  const scale = Math.max(0.55, Math.min(1.8, scene.userData.__practiceRingScale != null ? scene.userData.__practiceRingScale : 1.0));
  const glow = Math.max(0, Math.min(1.8, scene.userData.__practiceRingGlow != null ? scene.userData.__practiceRingGlow : 1.0));
  const density = Math.max(0.65, Math.min(1.45, scene.userData.__practiceRingDensity != null ? scene.userData.__practiceRingDensity : 1.0));
  const opacityTune = Math.max(0.15, Math.min(1.05, scene.userData.__practiceRingOpacity != null ? scene.userData.__practiceRingOpacity : 1.0));
  const bob = Math.max(0, Math.min(1.8, scene.userData.__practiceRingBob != null ? scene.userData.__practiceRingBob : 1.0));
  const spin = Math.max(0, Math.min(1.8, scene.userData.__practiceRingSpin != null ? scene.userData.__practiceRingSpin : 1.0));
  const requestedCount = scene.userData.__practiceRingCount != null ? scene.userData.__practiceRingCount : course.length;
  const activeCount = enabled ? Math.max(0, Math.min(course.length, Math.round(requestedCount))) : 0;
  const themeKey = scene.userData.__practiceRingColor || 'cyan';
  const theme = getPracticeRingTheme(themeKey);
  const points = course.basePoints.map((basePos) => {
    const offset = basePos.clone().sub(course.anchorPoint);
    return course.anchorPoint.clone().add(new THREE.Vector3(
      offset.x * density,
      offset.y * (0.88 + density * 0.12),
      offset.z * density
    ));
  });
  const forwardFallback = new THREE.Vector3(0, 0, -1);
  for (let i = 0; i < course.length; i++) {
    const ring = course[i];
    const point = points[i];
    const prevPoint = points[Math.max(0, i - 1)] || point;
    const nextPoint = points[Math.min(points.length - 1, i + 1)] || point;
    let dir = nextPoint.clone().sub(point);
    if (dir.lengthSq() < 1e-6) dir = point.clone().sub(prevPoint);
    if (dir.lengthSq() < 1e-6) dir.copy(forwardFallback);
    const active = i < activeCount;
    ring.visible = active;
    ring.userData.baseY = point.y;
    ring.position.x = point.x;
    ring.position.z = point.z;
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
    ring.scale.setScalar(scale);
    ring.userData.gateRadius = active ? (ring.userData.__baseGateRadius || 26) * scale : 0;
    ring.userData.__active = active;
    if (ring.material) {
      ring.material.color.setHex(theme.color);
      ring.material.emissive.setHex(theme.emissive);
      ring.material.emissiveIntensity = active ? (ring.userData.__baseEmissiveInt || 0.65) * (0.35 + glow * 0.95) : 0;
      ring.material.opacity = active ? Math.max(0.12, Math.min(0.98, (ring.userData.__baseOpacity || 0.92) * opacityTune)) : 0;
    }
  }
  if (course.pathLines) {
    for (let i = 0; i < course.pathLines.length; i++) {
      updateCourseLineSegment(course.pathLines[i], points[i], points[i + 1], enabled && i < activeCount - 1, theme);
    }
  }
  course.activeCount = activeCount;
  course.theme = themeKey;
  course.scale = scale;
  course.glow = glow;
  course.density = density;
  course.opacity = opacityTune;
  course.bob = bob;
  course.spin = spin;
  course.enabled = enabled;
}
(function addPracticeRingCourse() {
  const ringGeo = new THREE.TorusGeometry(28, 1.35, 14, 64);
  const targetInnerGeo = new THREE.TorusGeometry(12, 0.45, 8, 48);
  const targetBarGeo = new THREE.BoxGeometry(46, 0.7, 0.7);
  const theme = getPracticeRingTheme('cyan');
  const ringMat = new THREE.MeshStandardMaterial({
    color: theme.color,
    emissive: theme.emissive,
    emissiveIntensity: 0.65,
    roughness: 0.28,
    metalness: 0.12,
    transparent: true,
    opacity: 0.92,
  });
  const targetMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const points = [
    new THREE.Vector3(240, 96, -430),
    new THREE.Vector3(520, 142, -900),
    new THREE.Vector3(260, 178, -1390),
    new THREE.Vector3(-140, 214, -1840),
    new THREE.Vector3(-520, 204, -2320),
    new THREE.Vector3(-210, 252, -2860),
    new THREE.Vector3(270, 284, -3380),
    new THREE.Vector3(650, 246, -3980),
  ];
  const rewards = [
    { type: 'ammo', amount: 45 },
    { type: 'shield', amount: 25 },
    { type: 'missile', amount: 1 },
    { type: 'repair', amount: 10 },
    { type: 'ammo', amount: 60 },
    { type: 'shield', amount: 35 },
    { type: 'alien', amount: 18 },
    { type: 'missile', amount: 1 },
  ];
  const course = [];
  course.basePoints = points.map(p => p.clone());
  course.anchorPoint = points[0].clone();
  course.baseGateRadius = 30;
  course.nextIndex = 0;
  course.completedRuns = 0;
  course.pathLines = [];
  window.__practiceRingCourse = course;
  const routeMat = new THREE.LineBasicMaterial({
    color: theme.emissive,
    transparent: true,
    opacity: 0.22,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  for (let i = 0; i < points.length; i++) {
    const ring = new THREE.Mesh(ringGeo, ringMat.clone());
    const pos = points[i];
    const next = points[Math.min(points.length - 1, i + 1)];
    const dir = next.clone().sub(pos);
    ring.position.copy(pos);
    ring.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      dir.lengthSq() > 1e-6 ? dir.normalize() : new THREE.Vector3(0, 0, -1)
    );
    ring.userData.baseY = pos.y;
    ring.userData.phase = i * 0.9;
    ring.userData.spinRate = 0.3 + i * 0.05;
    ring.userData.label = `UPGRADE TARGET ${i + 1}`;
    ring.userData.upgradeReward = rewards[i % rewards.length];
    ring.userData.__courseIndex = i;
    ring.userData.__baseGateRadius = 30;
    ring.userData.__baseEmissiveInt = 0.65;
    ring.userData.__baseOpacity = 0.92;
    const inner = new THREE.Mesh(targetInnerGeo, targetMat.clone());
    const barH = new THREE.Mesh(targetBarGeo, targetMat.clone());
    const barV = new THREE.Mesh(targetBarGeo, targetMat.clone());
    barV.rotation.z = Math.PI / 2;
    inner.renderOrder = 4;
    barH.renderOrder = 4;
    barV.renderOrder = 4;
    ring.add(inner, barH, barV);
    scene.add(ring);
    registerGate(ring, { radius: 30, points: 180, kind: 'practice', label: ring.userData.label });
    course.push(ring);
  }
  for (let i = 0; i < points.length - 1; i++) {
    const geo = new THREE.BufferGeometry().setFromPoints([points[i], points[i + 1]]);
    const line = new THREE.Line(geo, routeMat.clone());
    line.userData.__segmentIndex = i;
    line.renderOrder = 3;
    scene.add(line);
    course.pathLines.push(line);
  }
  applyPracticeRingCourseTuning();
})();

function updatePracticeRingCourse(dt) {
  const rings = window.__practiceRingCourse;
  if (!rings) return;
  const bob = Math.max(0, Math.min(1.8, rings.bob != null ? rings.bob : 1.0));
  const spin = Math.max(0, Math.min(1.8, rings.spin != null ? rings.spin : 1.0));
  const nextIndex = Math.max(0, Math.min(rings.activeCount || rings.length, rings.nextIndex || 0));
  for (const ring of rings) {
    ring.userData.phase += dt;
    ring.position.y = ring.userData.baseY + Math.sin(ring.userData.phase * 1.6) * 1.8 * bob;
    if (!ring.visible) continue;
    const isNext = ring.userData.__courseIndex === nextIndex;
    const targetPulse = isNext ? 1.0 : 0.0;
    ring.userData.__nextPulse = (ring.userData.__nextPulse || 0) + (targetPulse - (ring.userData.__nextPulse || 0)) * Math.min(1, dt * 5);
    if (ring.material) {
      const pulse = ring.userData.__nextPulse || 0;
      const baseIntensity = ring.userData.__baseEmissiveInt || 0.65;
      ring.material.emissiveIntensity = baseIntensity * (0.6 + (rings.glow || 1) * 0.55 + Math.sin(ring.userData.phase * 5.2) * 0.08 * pulse) + pulse * 0.9;
      ring.material.opacity = Math.min(0.98, (ring.userData.__baseOpacity || 0.92) * (rings.opacity || 1) + pulse * 0.05);
    }
    ring.rotation.z += dt * (ring.userData.spinRate || 0.35) * spin;
  }
}

// __world_feature_turn_left_rings__ — Two orange ring gates forcing left turn
(function addTurnLeftRings() {
  const RING_RADIUS = 30;
  const TUBE_RADIUS = 1.5;
  
  const orangeMat = new THREE.MeshStandardMaterial({
    color: 0xff6600,
    emissive: 0xff4400,
    emissiveIntensity: 0.85,
    roughness: 0.25,
    metalness: 0.15,
    transparent: true,
    opacity: 0.92
  });
  
  const ringGeo = new THREE.TorusGeometry(RING_RADIUS, TUBE_RADIUS, 16, 64);
  
  // Gate 1: ahead on centerline — vertical gate facing straight down -Z.
  const ring1 = new THREE.Mesh(ringGeo, orangeMat.clone());
  ring1.position.set(0, 180, -800);
  ring1.userData.ringIndex = 0;
  ring1.userData.baseY = 180;
  ring1.userData.phase = 0;
  ring1.userData.isTurnLeftRing = true;
  scene.add(ring1);

  // Gate 2: far left — vertical gate rotated to face the approach heading
  // from gate 1, with a left-bank tilt so it reads as "enter in a turn".
  const ring2 = new THREE.Mesh(ringGeo, orangeMat.clone());
  ring2.position.set(-900, 180, -1400);
  ring2.rotation.y = Math.atan2(900, 600);  // face back toward gate 1
  ring2.rotation.z = Math.PI / 8;            // bank-entry tilt
  ring2.userData.ringIndex = 1;
  ring2.userData.baseY = 180;
  ring2.userData.phase = 2.5;
  ring2.userData.isTurnLeftRing = true;
  scene.add(ring2);
  
  // Track for animation
  window.__turnLeftRings = [ring1, ring2];
  ring1.userData.__origEmissive = 0xff6600; ring1.userData.__origEmissiveInt = 0.8; ring1.userData.__origOpacity = 0.92;
  ring2.userData.__origEmissive = 0xff6600; ring2.userData.__origEmissiveInt = 0.8; ring2.userData.__origOpacity = 0.92;
  registerGate(ring1, { radius: 32, points: 200, kind: 'turn' });
  registerGate(ring2, { radius: 32, points: 200, kind: 'turn' });
  
  // Add small arrow markers pointing toward next gate
  const arrowMat = new THREE.MeshBasicMaterial({
    color: 0xff6600,
    transparent: true,
    opacity: 0.5
  });
  
  // Arrow from ring1 toward ring2 (left/down direction)
  const arrow1 = new THREE.Mesh(
    new THREE.ConeGeometry(8, 20, 8),
    arrowMat
  );
  arrow1.position.set(-80, 160, -1000);
  arrow1.rotation.z = Math.PI / 3; // bank left
  arrow1.rotation.x = Math.PI / 6; // point down slightly
  arrow1.userData.isTurnLeftArrow = true;
  scene.add(arrow1);
  
  if (window.__turnLeftRings) window.__turnLeftRings.push(arrow1);
})();

// __world_feature_slalom_poles__ — 8 vertical pylons for low_pass slalom curriculum
(function addSlalomPoles() {
  const POLE_COUNT = 8;
  const POLE_HEIGHT = 40;
  const POLE_RADIUS = 1.2;
  const START_Z = -800;
  const SPACING = 200;
  const X_OFFSET = 35; // lateral offset from centerline
  
  const poleMat = new THREE.MeshStandardMaterial({
    color: 0xff4400,
    emissive: 0xff2200,
    emissiveIntensity: 0.4,
    roughness: 0.3,
    metalness: 0.2
  });
  
  const stripeMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.9
  });
  
  const topMat = new THREE.MeshBasicMaterial({
    color: 0xffff00,
    transparent: true,
    opacity: 0.85
  });
  
  const poleGeo = new THREE.CylinderGeometry(POLE_RADIUS, POLE_RADIUS, POLE_HEIGHT, 16);
  const stripeGeo = new THREE.CylinderGeometry(POLE_RADIUS + 0.05, POLE_RADIUS + 0.05, 3, 16);
  const topGeo = new THREE.SphereGeometry(POLE_RADIUS * 1.3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  
  window.__slalomPoles = [];
  
  for (let i = 0; i < POLE_COUNT; i++) {
    const z = START_Z - i * SPACING;
    // Alternate left and right of centerline
    const x = (i % 2 === 0) ? -X_OFFSET : X_OFFSET;
    
    const poleGroup = new THREE.Group();
    
    // Main pole
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = POLE_HEIGHT / 2;
    poleGroup.add(pole);
    
    // White warning stripes at 10m and 30m
    const stripeLow = new THREE.Mesh(stripeGeo, stripeMat);
    stripeLow.position.y = 10;
    poleGroup.add(stripeLow);
    
    const stripeHigh = new THREE.Mesh(stripeGeo, stripeMat);
    stripeHigh.position.y = 30;
    poleGroup.add(stripeHigh);
    
    // Yellow top cap (glow marker)
    const topCap = new THREE.Mesh(topGeo, topMat);
    topCap.position.y = POLE_HEIGHT;
    poleGroup.add(topCap);
    
    // Position the entire group
    poleGroup.position.set(x, 0, z);
    
    // Store metadata for potential animation or curriculum tracking
    poleGroup.userData.poleIndex = i;
    poleGroup.userData.targetX = x;
    poleGroup.userData.targetZ = z;
    poleGroup.userData.side = (i % 2 === 0) ? 'left' : 'right';
    
    scene.add(poleGroup);
    window.__slalomPoles.push(poleGroup);
  }
  
  // Add connecting ground markers showing the weave path
  const pathMat = new THREE.MeshBasicMaterial({
    color: 0x00ff88,
    transparent: true,
    opacity: 0.6
  });
  
  for (let i = 0; i < POLE_COUNT - 1; i++) {
    const z1 = START_Z - i * SPACING;
    const z2 = START_Z - (i + 1) * SPACING;
    const x1 = (i % 2 === 0) ? -X_OFFSET : X_OFFSET;
    const x2 = ((i + 1) % 2 === 0) ? -X_OFFSET : X_OFFSET;
    
    // Diagonal path marker on ground
    const midX = (x1 + x2) / 2;
    const midZ = (z1 + z2) / 2;
    const dx = x2 - x1;
    const dz = z2 - z1;
    const angle = Math.atan2(dx, dz);
    const dist = Math.sqrt(dx * dx + dz * dz);
    
    const pathMarker = new THREE.Mesh(
      new THREE.PlaneGeometry(4, dist),
      pathMat
    );
    pathMarker.rotation.x = -Math.PI / 2;
    pathMarker.rotation.z = angle;
    pathMarker.position.set(midX, 0.05, midZ);
    scene.add(pathMarker);
  }
})();

