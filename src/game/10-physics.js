// @module src/game/10-physics.js
// =============================================================
//  PLANE STATE + PHYSICS
// =============================================================
function getRequestedAircraftGroundSpec() {
  const preset = typeof getActivePropPreset === 'function' ? getActivePropPreset() : null;
  const spec = typeof getAircraftSpecByPreset === 'function' ? getAircraftSpecByPreset(preset) : null;
  return (spec && spec.ground) || { gearHeight: 2.3, fixedGear: false, taildragger: false, wheelbase: 5.8 };
}
function getSpawnSurfaceHeight(x, z) {
  return typeof getSurfaceHeight === 'function' ? getSurfaceHeight(x, z) : getHeight(x, z);
}
function getSpawnProfileState(mode = playerProfileState.spawnMode) {
  const key = normalizeSpawnMode(mode);
  const ground = getRequestedAircraftGroundSpec();
  const gearHeight = Number.isFinite(ground.gearHeight) ? ground.gearHeight : 2.3;
  if (key === 'sky') {
    // Face +Z, toward the airfield: all saucer circuits orbit the airfield at
    // the origin, so an air start facing -Z put every target BEHIND the player.
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.02, Math.PI, 0, 'YXZ'));
    return {
      mode: key,
      // Spawn well above the ~300-500m terrain peaks — 132m put the hands-off
      // auto-fly straight into a mountainside within seconds.
      pos: new THREE.Vector3(0, 640, -720),
      vel: new THREE.Vector3(0, -0.2, 62),
      quat: q,
      throttle: 0.50,
      onGround: false,
      status: 'AIR START READY',
    };
  }
  if (key === 'runway18') {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0, 'YXZ'));
    return {
      mode: key,
      // Symmetric with runway36 default — sit at the -Z threshold facing +Z
      // so the whole runway is ahead.
      pos: new THREE.Vector3(0, getSpawnSurfaceHeight(0, -180) + gearHeight, -180),
      vel: new THREE.Vector3(),
      quat: q,
      throttle: 0,
      onGround: true,
      status: 'HOLD SHORT · RWY 18',
    };
  }
  if (key === 'apron') {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI * 0.12, 0, 'YXZ'));
    return {
      mode: key,
      pos: new THREE.Vector3(34, getSpawnSurfaceHeight(34, 154) + gearHeight, 154),
      vel: new THREE.Vector3(),
      quat: q,
      throttle: 0,
      onGround: true,
      status: 'APRON START READY',
    };
  }
  return {
    mode: 'runway36',
    // Runway extends from z=-210 to z=+210; takeoff direction is -Z. Spawning
    // at z=180 (was 120) puts Dusty just inside the +Z threshold so the full
    // runway length is ahead of you for the takeoff roll.
    pos: new THREE.Vector3(0, getSpawnSurfaceHeight(0, 180) + gearHeight, 180),
    vel: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    throttle: 0,
    onGround: true,
    status: 'READY FOR DEPARTURE',
  };
}
const initialSpawnProfile = getSpawnProfileState(playerProfileState.spawnMode);
const initialAircraftSpec = typeof getActiveAircraftSpec === 'function' ? getActiveAircraftSpec() : null;
const plane = {
  pos: initialSpawnProfile.pos.clone(),
  vel: initialSpawnProfile.vel.clone(),
  quat: initialSpawnProfile.quat.clone(),
  prevPos: initialSpawnProfile.pos.clone(),
  prevQuat: initialSpawnProfile.quat.clone(),
  angVel: new THREE.Vector3(),       // local pitch/yaw/roll rates
  throttle: initialSpawnProfile.throttle,
  throttleTarget: initialSpawnProfile.throttle,
  gear: 1, gearTarget: 1,
  aircraftKey: (initialAircraftSpec && initialAircraftSpec.key) || DEFAULT_PROP_MODEL_KEY,
  aircraftSpec: initialAircraftSpec,
  fixedGear: !!(initialAircraftSpec && initialAircraftSpec.ground && initialAircraftSpec.ground.fixedGear),
  brake: 0,
  landingLights: false,
  onGround: initialSpawnProfile.onGround,
  crashed: false,
  // Graduated damage model. health is 0..100; crashed = (health <= 0).
  // Shields are upgrade-earned ablative protection before hull damage.
  // Damage buckets feed smoke state + flight-model instability.
  health: 100,
  shield: 150,
  shieldMax: 150,
  shieldPulse: 0,
  damage: {
    airframe: 0,    // 0..1, general hull integrity loss
    engine: 0,      // 0..1, engine efficiency loss (→ more dark smoke)
    leftWing: 0,    // 0..1, roll bias to left when damaged
    rightWing: 0,   // 0..1, roll bias to right
  },
  // Transient engine event mix that the smoke system reads. Set by
  // power-cut/restart, hard acceleration, stall events, etc.
  engineEvent: 0,   // 0..1, decays over ~1s
  stressDamageTimer: 0,
  engineBurnTimer: 0,
  lastStressWarnAt: 0,
  lastDamageAt: -Infinity,
  lastSurfaceImpactAt: -Infinity,
};
const controlState = {
  pitch: 0,
  roll: 0,
  yaw: 0,
  throttleUp: 0,
  throttleDown: 0,
};
function smoothSignedInput(current, target, dt, rise = 10, fall = 7) {
  const targetAbs = Math.abs(target);
  const currentAbs = Math.abs(current);
  const changingDirection = current * target < -0.001;
  const rate = (targetAbs > currentAbs || changingDirection) ? rise : fall;
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}
function shapeControlInput(value, expo = 0.32) {
  const v = Math.max(-1, Math.min(1, value));
  return v * (1 - expo) + v * Math.abs(v) * expo;
}

// Apply damage; returns whether this blow was fatal.
// `kind` is one of 'airframe', 'engine', 'leftWing', 'rightWing'; amount in 0..1.
function damagePlane(amount, kind = 'airframe', opts = {}) {
  if (plane.crashed) return false;
  let a = Math.max(0, Math.min(1, amount));
  if (a <= 0) return false;
  if (plane.shield > 0) {
    const shieldAbsorb = Math.min(plane.shield, a * 100);
    plane.shield = Math.max(0, plane.shield - shieldAbsorb);
    plane.shieldPulse = Math.min(1.8, (plane.shieldPulse || 0) + 1.0);
    a = Math.max(0, a - shieldAbsorb / 100);
    if (typeof flashStatus === 'function') flashStatus(`SHIELD HIT · ${Math.round(plane.shield)}%`, 'panel warn', 0.65);
    if (a <= 0.001) return false;
  }
  // Player survivability: keep combat tense but avoid sudden deaths.
  // Shields absorb first; remaining hull damage is softened globally.
  a *= 0.42;
  plane.health = Math.max(0, plane.health - a * 100);
  if (plane.damage[kind] != null) {
    plane.damage[kind] = Math.min(1, plane.damage[kind] + a);
  } else {
    plane.damage.airframe = Math.min(1, plane.damage.airframe + a);
  }
  plane.engineEvent = Math.min(1, plane.engineEvent + a * 0.6);
  plane.lastDamageAt = performance.now();
  if (typeof spawnDamageDecal === 'function' && opts.worldPos) {
    spawnDamageDecal(opts.worldPos, a);
  }
  // Keep damage feedback visual-only here; the user asked to keep the
  // engine audio as a steady hum without extra cough / damage stingers.
  if (plane.health <= 0) {
    plane.crashed = true;
    replay.eventT = performance.now();
    setFlightPhase('IMPACT', 'warn');
    captureMissionDebrief(opts.reason || 'AIRFRAME FAILURE');
    if (typeof syncReplayUI === 'function') syncReplayUI();
    if (typeof statusMsg !== 'undefined' && statusMsg) {
      statusMsg.textContent = (opts.reason || 'AIRFRAME FAILURE') + ' — PRESS R';
    }
    if (typeof playSfx === 'function') {
      playSfx('explosion', { volume: 0.9 });
    }
    return true;
  }
  return false;
}
function repairPlaneSystems(amount = 10, reason = 'REPAIR') {
  const pct = Math.max(0, amount) / 100;
  const before = plane.health;
  plane.health = Math.min(100, plane.health + amount);
  plane.damage.airframe = Math.max(0, plane.damage.airframe - pct * 1.25);
  plane.damage.engine = Math.max(0, plane.damage.engine - pct * 1.35);
  plane.damage.leftWing = Math.max(0, plane.damage.leftWing - pct * 0.9);
  plane.damage.rightWing = Math.max(0, plane.damage.rightWing - pct * 0.9);
  plane.engineEvent = Math.max(0, plane.engineEvent - pct);
  const gained = Math.max(0, plane.health - before);
  if (gained > 0 && typeof window.showScoreBurst === 'function') window.showScoreBurst(`+${Math.round(gained)}%`, reason, '#7fe6ff');
  return gained;
}

function healPlane(resetAll = true) {
  plane.health = 100;
  if (typeof deactivateShieldOverdrive === 'function') deactivateShieldOverdrive(true);
  plane.shieldMax = Math.max(150, plane.shieldMax || 150);
  plane.shield = plane.shieldMax;
  plane.shieldPulse = 0;
  plane.stressDamageTimer = 0;
  plane.engineBurnTimer = 0;
  plane.lastStressWarnAt = 0;
  plane.damage.airframe = 0;
  plane.damage.engine = 0;
  plane.damage.leftWing = 0;
  plane.damage.rightWing = 0;
  plane.engineEvent = 0;
  if (resetAll) damageDecalsClear();
}
bootLog.step('plane state + damage model', typeof damagePlane === 'function', `health=${plane.health}`);
// Dev handle — inspect state from devtools (`window.__sim.plane.health` etc).
// Not load-bearing; a regression that removes this just costs a bit of debug.
// Deliberately exposes reset + keys so automated tests can drive the sim.
window.__sim = { plane, jet, scene, camera, renderer, weather, THREE,
  get keys() { return keys; },
  get audio() { return audio; },
  get combat() { return combatState; },
  resetPlane: () => resetPlane(),
  damagePlane: (a, k, o) => damagePlane(a, k, o),
  playSfx: (e, o) => playSfx(e, o),
  // Deterministic dev/test hook. This intentionally advances only the fixed
  // flight model: browser smoke tests can validate terrain contact without
  // turning a physics assertion into a terrain-streaming/render benchmark.
  stepPhysics(steps = 1, dt = 1 / 120) {
    const count = Math.max(1, Math.min(2400, Math.floor(Number(steps) || 1)));
    const fixedDt = Math.max(1 / 480, Math.min(1 / 20, Number(dt) || 1 / 120));
    for (let i = 0; i < count; i++) {
      plane.prevPos.copy(plane.pos);
      plane.prevQuat.copy(plane.quat);
      updatePhysics(fixedDt);
      if (plane.crashed) break;
    }
    return plane;
  },
  getHeight, getSurfaceHeight, sampleSurface, heightPrefetch, // debug: terrain/contact parity checks from devtools
};

const GRAVITY = 9.81;
const MAX_THRUST = 52;         // m/s², arcade-snappy prop acceleration
// Flight-idle thrust floor. Tuned so steady-state trim at idle sits
// ≈ 150 kts (77 m/s) in level flight — just above cruise target so the
// plane lazily sheds speed toward cruise rather than either bleeding
// to stall OR rocketing to 290 kts with no input. Previously 0.45
// caused runaway acceleration.
const IDLE_THRUST_FRAC = 0.13;
// Wing loading — higher LIFT_K than stock (0.012) so the plane needs
// less AoA to stay up, but CL0 kept moderate so zero-AoA lift is LESS
// than gravity at cruise (otherwise plane auto-climbs, as we saw).
// Equilibrium cruise AoA is now ≈1° at 155 kts, 5° at 100 kts.
const LIFT_K = 0.017;
const CL0 = 0.07;              // was 0.10, causing uncommanded climb
const CL_ALPHA = 4.5;          // lift slope per radian of AoA
const DRAG_PARASITE = 0.00028; // gives terminal ≈ 580 kts at sea level
const DRAG_INDUCED = 0.018;    // multiplied by CL²
// Fixed-gear drag reduced — was 0.00050 (nearly 2× parasite) which is
// unrealistic for a small prop's fixed gear and was a major contributor
// to the "bleeds to 40 kts on idle" behaviour.
const GEAR_DRAG = 0.00020;
const DEFAULT_GEAR_HEIGHT = 2.3;
const STALL_AOA = 0.30;        // ~17°
const MAX_ANG_VEL = 3.2;       // rad/s clamp to prevent runaway spin
const MAX_PITCH_RATE = 1.55;   // rad/s, ~89 deg/s
const MAX_ROLL_RATE = 2.35;    // rad/s, ~135 deg/s
const MAX_YAW_RATE = 0.82;     // rad/s, ~47 deg/s

function getCurrentAircraftSpec() {
  return plane.aircraftSpec
    || (typeof getActiveAircraftSpec === 'function' ? getActiveAircraftSpec() : null)
    || { key: DEFAULT_PROP_MODEL_KEY, flight: {}, ground: {} };
}
function getCurrentFlightSpec() {
  return getCurrentAircraftSpec().flight || {};
}
function getCurrentGroundSpec() {
  return getCurrentAircraftSpec().ground || {};
}
function getCurrentGearHeight() {
  const height = Number(getCurrentGroundSpec().gearHeight);
  return Number.isFinite(height) && height > 0.4 ? height : DEFAULT_GEAR_HEIGHT;
}
function getAircraftFlightRatio(field, fallback = 1) {
  const active = Number(getCurrentFlightSpec()[field]);
  const baselineSpec = typeof getAircraftSpecByPreset === 'function' && typeof getDefaultPropPreset === 'function'
    ? getAircraftSpecByPreset(getDefaultPropPreset())
    : null;
  const baseline = Number(baselineSpec && baselineSpec.flight && baselineSpec.flight[field]);
  if (!Number.isFinite(active) || !Number.isFinite(baseline) || Math.abs(baseline) < 1e-6) return fallback;
  return active / baseline;
}

const keys = {};
// True when the user is typing into a form field — flight keys must not
// fire and the canvas must not steal focus while a field is active.
function isTypingTarget(el) {
  return !!(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable));
}
window.addEventListener('keydown', e => {
  if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
  if (e.code === 'Space' && !e.repeat && typeof combatState !== 'undefined') {
    const now = performance.now();
    const doubleTapWindow = 280;
    if ((now - (combatState.lastSpaceTapAt || 0)) <= doubleTapWindow) {
      combatState.spaceMissileQueued = true;
      combatState.suppressSpaceGunsUntil = now + 180;
      combatState.lastSpaceTapAt = 0;
    } else {
      combatState.lastSpaceTapAt = now;
    }
    combatState.spaceDown = true;
  }
  keys[e.code] = true;
  if (['Space', 'KeyF', 'KeyG', 'KeyH', 'KeyL', 'KeyM', 'KeyN', 'KeyR', 'KeyB', 'KeyT', 'KeyY', 'KeyP', 'KeyX', 'KeyV', 'KeyZ', 'KeyU', 'KeyO', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', e => {
  keys[e.code] = false;
  if (e.code === 'Space' && typeof combatState !== 'undefined') combatState.spaceDown = false;
});

let gearPressed = false;
let lightsPressed = false;
let modelPressed = false;
let resetPressed = false;
let stylePressed = false;
let biomePressed = false;
let helpPressed = false;
let fullscreenPressed = false;
let racePressed = false;

function toggleFullscreen() {
  const root = document.documentElement;
  if (!document.fullscreenElement) {
    if (root.requestFullscreen) root.requestFullscreen().catch(() => {});
  } else if (document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
}

function resetPlane() {
  const wasCrashed = !!plane.crashed;
  if (wasCrashed && typeof window !== 'undefined' && window.__gameMatch && window.__gameMatch.ended) {
    window.__gameMatch.startedAt = performance.now();
    window.__gameMatch.ended = false;
  } else if (wasCrashed && typeof canRespawnNow === 'function' && !canRespawnNow()) {
    if (typeof window.showComboBanner === 'function') window.showComboBanner('NO RESPAWNS', 'FINAL MINUTE · SURVIVE OR WATCH', '#ff8f5e');
    if (typeof flashStatus === 'function') flashStatus('RESPAWNS CLOSED IN FINAL MINUTE', 'panel warn', 1.4);
    return;
  }
  nhudFuel = 100;
  const aircraftSpec = getActiveAircraftSpec();
  plane.aircraftKey = aircraftSpec.key;
  plane.aircraftSpec = aircraftSpec;
  plane.fixedGear = !!(aircraftSpec.ground && aircraftSpec.ground.fixedGear);
  const spawn = getSpawnProfileState(playerProfileState.spawnMode);
  plane.pos.copy(spawn.pos);
  plane.vel.copy(spawn.vel);
  plane.quat.copy(spawn.quat);
  plane.prevPos.copy(spawn.pos);
  plane.prevQuat.copy(spawn.quat);
  physicsAccumulator = 0;
  plane.angVel.set(0, 0, 0);
  plane.throttle = spawn.throttle;
  plane.throttleTarget = spawn.throttle;
  plane.gear = 1;
  plane.gearTarget = 1;
  if (plane.glbGear) {
    plane.glbGear.deployed = true;
    plane.glbGear.anim = 1;
  }
  plane.brake = 0;
  plane.landingLights = false;
  plane.onGround = spawn.onGround;
  plane.crashed = false;
  controlState.pitch = 0;
  controlState.roll = 0;
  controlState.yaw = 0;
  controlState.throttleUp = 0;
  controlState.throttleDown = 0;
  if (typeof syncTouchThrottleFromPlane === 'function') syncTouchThrottleFromPlane();
  resetMissionDebrief();
  healPlane();
  resetCombatState();
  if (!trafficEnabled()) {
    for (const t of traffic) {
      if (!t.group) continue;
      t.group.visible = false;
      if (t.destructible && t.destructible.object) t.destructible.object.visible = false;
    }
  }
  // Fresh slate for flight-review.
  if (typeof replayStop === 'function') replayStop();
  if (typeof replayClear === 'function') replayClear();
  if (typeof syncReplayUI === 'function') syncReplayUI();
  if (typeof camOrbit !== 'undefined') { camOrbit.yaw = 0; camOrbit.pitch = 0; }
  if (camera) {
    camera.userData.maneuverReveal = 0;
    camera.userData.revealBlend = 0;
    camera.userData.followQuat = plane.quat.clone();
    camera.userData.pitchReveal = 0;
    camera.userData.cameraHeightOffset = 0;
    camera.userData.cameraFocusYOffset = 0;
    // Seed the camera smoothers with the values updateCamera would compute on
    // the first post-spawn frame (all reveals are 0 here) — null would take
    // the null-guard branch and pop the camera for one frame on respawn.
    camera.userData.verticalHeightState = Math.max(-2.0, (typeof camLocalOffset !== 'undefined' && camLocalOffset) ? camLocalOffset.y : 2.35);
    camera.userData.focusYOffsetState = 0;
    camera.userData.climbRevealState = 0;
    camera.userData.diveRevealState = 0;
    camera.userData.heroSide = 1;
    camera.userData.turnBias = 0;
    camera.userData.lensFov = CAMERA_BASE_FOV;
    camera.fov = aspectCorrectedCameraFov(CAMERA_BASE_FOV, camera.aspect);
    camera.updateProjectionMatrix();
  }
  if (typeof resetReticleHud === 'function') resetReticleHud();
  scene.userData.__wingTrailIntensity = 0;
  vaporTimer = 0;
  _prevFwdSpd = 0;
  if (typeof wingTrailStreamL !== 'undefined') wingTrailStreamL.clear();
  if (typeof wingTrailStreamR !== 'undefined') wingTrailStreamR.clear();
  if (typeof resetGateScoring === 'function') resetGateScoring(wasCrashed);
  resetEngineSurgeFx();
  setFlightPhase(spawn.onGround ? 'ON STAND' : 'AIR START', spawn.onGround ? '' : 'ok');
  helpStripState.autoCollapsed = true;
  setHelpStripCollapsed(true);
  if ($hudActionsTray) { $hudActionsTray.open = false; syncHudActionsTray(); }
  statusMsg.textContent = spawn.status;
  statusMsg.className = 'panel';
  if (typeof syncLandingIndicator === 'function') syncLandingIndicator();
}

// Latched-key inputs that must work regardless of crash state. Separated
// from updatePhysics() so R (reset) still fires even when plane.crashed
// bails physics out. Called unconditionally from animate().
function updateInputLatches(dt) {
  // R — reset. Must work during crash (that's the whole point).
  if (keys['KeyR'] || (INPUT_FLAGS.gamepad && gamepadState.reset)) {
    if (!resetPressed) { resetPlane(); resetPressed = true; }
  } else resetPressed = false;

  // The rest of the latches only make sense when alive.
  if (plane.crashed) return;

  if (keys['KeyG'] || (INPUT_FLAGS.gamepad && gamepadState.gear)) {
    if (!gearPressed) {
      // Physics retract (procedural jet + F-15 clip gear): toggles gearTarget.
      // Cosmetic GLB node gear (props with named wheels): toggles glbGear.deployed
      // while fixedGear stays true so gear-up crash path is not armed.
      if (!getCurrentGroundSpec().fixedGear) {
        plane.gearTarget = plane.gearTarget > 0.5 ? 0 : 1;
        if (plane.glbGear) plane.glbGear.deployed = plane.gearTarget > 0.5;
      } else if (plane.glbGear) {
        plane.glbGear.deployed = !plane.glbGear.deployed;
      }
      gearPressed = true;
    }
  } else gearPressed = false;

  if (keys['KeyL'] || (INPUT_FLAGS.gamepad && gamepadState.lights)) {
    if (!lightsPressed) {
      plane.landingLights = !plane.landingLights;
      if (typeof syncLandingIndicator === 'function') syncLandingIndicator();
      lightsPressed = true;
    }
  } else lightsPressed = false;

  if (keys['KeyM'] || (INPUT_FLAGS.gamepad && gamepadState.model)) {
    if (!modelPressed) { cyclePropModel(1); modelPressed = true; }
  } else modelPressed = false;

  if (keys['KeyT']) {
    if (!stylePressed) { toggleStyle(); stylePressed = true; }
  } else stylePressed = false;

  if (keys['KeyY']) {
    if (!biomePressed) { cycleBiome(); biomePressed = true; }
  } else biomePressed = false;

  if (keys['KeyH']) {
    if (!helpPressed) {
      setHelpStripCollapsed(!helpStripState.collapsed, true);
      helpPressed = true;
    }
  } else helpPressed = false;

  if (keys['KeyF']) {
    if (!fullscreenPressed) {
      toggleFullscreen();
      fullscreenPressed = true;
    }
  } else fullscreenPressed = false;

  if (keys['KeyN'] || (INPUT_FLAGS.gamepad && gamepadState.race)) {
    if (!racePressed) {
      toggleMultiplayerRace();
      racePressed = true;
    }
  } else racePressed = false;
}
// Pre-allocated static scratch objects for updatePhysics to avoid garbage collector pressure
const _physFwd = new THREE.Vector3();
const _physUp = new THREE.Vector3();
const _physRight = new THREE.Vector3();
const _physInvQ = new THREE.Quaternion();
const _physLocalVel = new THREE.Vector3();
const _physRightWorld = new THREE.Vector3();
const _physWorldUpLocal = new THREE.Vector3();
const _physEuler = new THREE.Euler();
const _physQuat = new THREE.Quaternion();
const _physLift = new THREE.Vector3();
const _physSlipDamping = new THREE.Vector3();
const _physDrag = new THREE.Vector3();
const _physThrust = new THREE.Vector3();
const _physGravity = new THREE.Vector3(0, -GRAVITY, 0);
const _physAccel = new THREE.Vector3();

// Pre-allocated static scratch objects for visual updates
const _visFwd = new THREE.Vector3();
const _visUp = new THREE.Vector3();
const _visRight = new THREE.Vector3();
const _visSplashCenter = new THREE.Vector3();
const _visCamFwd = new THREE.Vector3();
const _visCamUp = new THREE.Vector3();
const _visCamRight = new THREE.Vector3();
const _visHeroFwd = new THREE.Vector3();
const _visHeroUp = new THREE.Vector3();
const _visHeroRight = new THREE.Vector3();
const _visLocalVel = new THREE.Vector3();
const _visInvQ = new THREE.Quaternion();
const _physWorldPos = new THREE.Vector3();
const _physDustPos = new THREE.Vector3();
const _physGroundNormal = new THREE.Vector3();
const _physGroundForward = new THREE.Vector3();
const _physGroundRight = new THREE.Vector3();
const _physGroundUp = new THREE.Vector3();
const _physContactLocal = new THREE.Vector3();
const _physContactWorld = new THREE.Vector3();
const _physContactPrevious = new THREE.Vector3();
const _physGroundCorrection = new THREE.Quaternion();
const _physGroundTargetQuat = new THREE.Quaternion();
const _physSurfaceContacts = Array.from({ length: 6 }, () => ({
  sample: {},
  kind: 'gear',
  penetration: -Infinity,
  previousClearance: Infinity,
  x: 0,
  z: 0,
}));

function sampleAircraftSurfaceContact(index, x, y, z, kind) {
  const record = _physSurfaceContacts[index];
  record.kind = kind;
  _physContactLocal.set(x, y, z).applyQuaternion(plane.quat);
  _physContactWorld.copy(plane.pos).add(_physContactLocal);
  record.x = _physContactWorld.x;
  record.z = _physContactWorld.z;
  sampleSurface(record.x, record.z, record.sample, false);
  record.penetration = record.sample.height - _physContactWorld.y;

  // This is a swept test rather than a single-point clamp: a fast-moving
  // aircraft can cross the surface between fixed steps, so retain whether this
  // contact was above terrain at the previous integration position. The
  // collision response below uses that transition to make hard impacts clear
  // and to avoid the old "climb the mountain like a car" behavior.
  _physContactPrevious.set(x, y, z).applyQuaternion(plane.prevQuat).add(plane.prevPos);
  record.previousClearance = _physContactPrevious.y - getSurfaceHeight(_physContactPrevious.x, _physContactPrevious.z);
  return record;
}

function resolvePostStepSurfaceContact(dt, forward, speed) {
  const wasAirborne = !plane.onGround;
  const ground = getCurrentGroundSpec();
  const gearHeight = getCurrentGearHeight();
  const wheelbase = Math.max(2.8, Number(ground.wheelbase) || 5.4);
  const wheelTrack = Math.max(1.6, wheelbase * 0.46);
  const taildragger = !!ground.taildragger;
  const mainZ = taildragger ? -wheelbase * 0.18 : wheelbase * 0.28;
  const thirdZ = taildragger ? wheelbase * 0.58 : -wheelbase * 0.58;
  const gearY = -gearHeight * Math.max(0.18, plane.gear);
  const bellyY = -Math.max(0.42, gearHeight * 0.48);
  const wingHalfSpan = Math.max(2.25, wheelbase * 0.82);
  // Avoid six contact probes while well clear of every possible hull/wing
  // strike. This keeps the richer contact system cheap at cruise altitude.
  const centerSurface = getSurfaceHeight(plane.pos.x, plane.pos.z);
  if (plane.pos.y - centerSurface > Math.max(36, gearHeight + wheelbase)) {
    plane.onGround = false;
    return;
  }
  sampleAircraftSurfaceContact(0, -wheelTrack, gearY, mainZ, 'gear');
  sampleAircraftSurfaceContact(1, wheelTrack, gearY, mainZ, 'gear');
  sampleAircraftSurfaceContact(2, 0, gearY * 0.96, thirdZ, 'gear');
  sampleAircraftSurfaceContact(3, 0, bellyY, 0, 'belly');
  sampleAircraftSurfaceContact(4, -wingHalfSpan, -0.12, 0, 'wing');
  sampleAircraftSurfaceContact(5, wingHalfSpan, -0.12, 0, 'wing');

  let deepest = null;
  let bodyPenetration = -Infinity;
  let waterContact = false;
  let crossedSurface = false;
  for (let i = 0; i < _physSurfaceContacts.length; i++) {
    const contact = _physSurfaceContacts[i];
    if (!deepest || contact.penetration > deepest.penetration) deepest = contact;
    if (contact.kind !== 'gear') bodyPenetration = Math.max(bodyPenetration, contact.penetration);
    if (contact.penetration > -0.04 && contact.sample.water) waterContact = true;
    if (contact.penetration > 0 && contact.previousClearance > 0.04) crossedSurface = true;
  }
  if (!deepest || deepest.penetration < -0.08) {
    plane.onGround = false;
    return;
  }

  // Only the deepest active contact needs the expensive terrain gradient.
  // Every other probe uses height/kind only, which keeps a 120 Hz flight step
  // from turning into a terrain-normal benchmark.
  sampleSurface(deepest.x, deepest.z, deepest.sample, true);
  _physGroundNormal.set(deepest.sample.normalX, deepest.sample.normalY, deepest.sample.normalZ).normalize();
  const normal = _physGroundNormal;
  const normalSpeed = plane.vel.dot(normal);
  const tangentSpeedSq = Math.max(0, plane.vel.lengthSq() - normalSpeed * normalSpeed);
  const tangentSpeed = Math.sqrt(tangentSpeedSq);
  const slopeDeg = Math.acos(Math.max(-1, Math.min(1, normal.y))) * 180 / Math.PI;

  // Resolve from the deepest contact along the terrain normal. That means a
  // wheel rolls with the hill rather than snapping vertically through it, and
  // a wing/belly strike cannot tunnel through a rising ridge at fixed-step
  // speed.
  if (deepest.penetration > 0) plane.pos.addScaledVector(normal, deepest.penetration + 0.006);
  if (deepest.penetration >= -0.012 && normalSpeed < 0) {
    plane.vel.addScaledVector(normal, -normalSpeed * (waterContact ? 0.18 : 0.72));
  }

  const impactSpeed = Math.max(0, -normalSpeed);
  const bodyStrike = bodyPenetration > 0.035;
  const terrainStrike = slopeDeg > 20 && tangentSpeed > 18 && (bodyStrike || crossedSurface);
  const gearLanding = deepest.kind === 'gear' && plane.gear >= 0.4 && !bodyStrike;
  const hardLanding = gearLanding && crossedSurface && impactSpeed > 8;
  const now = performance.now();
  if (waterContact) {
    const severity = Math.min(1, impactSpeed / 15 + tangentSpeed / 115);
    if ((impactSpeed > 4 || tangentSpeed > 24) && now - plane.lastSurfaceImpactAt > 650) {
      plane.lastSurfaceImpactAt = now;
      damagePlane(0.28 + severity * 0.68, 'airframe', {
        reason: 'WATER IMPACT',
        worldPos: _physWorldPos.copy(plane.pos),
      });
      audioThud(0.42 + severity * 0.38);
    }
    plane.vel.multiplyScalar(Math.max(0.18, 0.68 - severity * 0.34));
    plane.vel.y = Math.max(0, plane.vel.y);
    plane.onGround = true;
    if (!plane.crashed) statusMsg.textContent = 'WATER CONTACT — POWER OFF AND RESET';
  } else {
    if ((bodyStrike || terrainStrike || hardLanding) && now - plane.lastSurfaceImpactAt > 500) {
      const severity = Math.min(1, impactSpeed / 18 + tangentSpeed / 125 + Math.max(0, slopeDeg - 18) / 55);
      plane.lastSurfaceImpactAt = now;
      const fatal = damagePlane(0.20 + severity * 0.75, 'airframe', {
        reason: plane.gear < 0.4 && bodyStrike
          ? 'BELLY LANDING'
          : hardLanding
            ? 'HARD LANDING'
            : bodyStrike
              ? 'AIRFRAME GROUND STRIKE'
              : 'TERRAIN IMPACT',
        worldPos: _physWorldPos.copy(plane.pos),
      });
      audioThud(0.40 + severity * 0.42);
      if (fatal) plane.vel.set(0, 0, 0);
    }

    if (gearLanding && crossedSurface && wasAirborne) {
      const runwayTouchdown = deepest.sample.kind === 'runway';
      let heading = Math.atan2(forward.x, -forward.z) * 180 / Math.PI;
      if (heading < 0) heading += 360;
      const headingErrorDeg = Math.min(Math.abs(heading), Math.abs(heading - 180), Math.abs(heading - 360));
      const centerlineFt = Math.abs(plane.pos.x) * 3.28;
      emitRunwayDustBurst(
        _physDustPos.copy(plane.pos).setY(deepest.sample.height + 0.14),
        hardLanding ? 1.05 + impactSpeed * 0.06 : 0.52 + impactSpeed * 0.07
      );
      recordLandingTouchdown({
        sinkRateMps: impactSpeed,
        speedKts: speed * 1.94,
        centerlineFt,
        headingErrorDeg,
        onRunway: runwayTouchdown,
        hard: hardLanding,
      });
      if (!hardLanding && impactSpeed > 2) audioThud(Math.min(0.6, impactSpeed * 0.06));
    }

    // Tire model: remove normal velocity, then independently damp forward
    // rolling and sideways scrub on the actual tangent plane. Runway pavement
    // has high lateral grip; rough terrain is looser but never a vertical rail.
    const remainingNormalSpeed = plane.vel.dot(normal);
    if (remainingNormalSpeed < 0) plane.vel.addScaledVector(normal, -remainingNormalSpeed);
    _physGroundForward.copy(forward).addScaledVector(normal, -forward.dot(normal));
    if (_physGroundForward.lengthSq() < 1e-5) _physGroundForward.set(0, 0, -1).addScaledVector(normal, normal.z);
    _physGroundForward.normalize();
    _physGroundRight.crossVectors(_physGroundForward, normal).normalize();
    const forwardSpeed = plane.vel.dot(_physGroundForward);
    const sideSpeed = plane.vel.dot(_physGroundRight);
    const paved = deepest.sample.kind === 'runway' || deepest.sample.kind === 'apron' || deepest.sample.kind === 'taxiway';
    const brakeTune = scene.userData.__flightBrake != null ? scene.userData.__flightBrake : 1.0;
    const rollingGrip = (paved ? 0.24 : 0.12) + plane.brake * 2.9 * brakeTune;
    const lateralGrip = paved ? 7.8 : 3.5;
    plane.vel.addScaledVector(_physGroundForward, -forwardSpeed * (1 - Math.exp(-rollingGrip * dt)));
    plane.vel.addScaledVector(_physGroundRight, -sideSpeed * (1 - Math.exp(-lateralGrip * dt)));

    // Align gently to a slope under the wheels. The existing taildragger
    // stance still supplies its parked nose-up pose; this correction only
    // removes impossible roll/hovering against the visual terrain.
    if (speed < 48) {
      _physGroundUp.set(0, 1, 0).applyQuaternion(plane.quat);
      _physGroundCorrection.setFromUnitVectors(_physGroundUp.normalize(), normal);
      _physGroundTargetQuat.copy(_physGroundCorrection).multiply(plane.quat);
      plane.quat.slerp(_physGroundTargetQuat, Math.min(1, dt * (paved ? 4.4 : 2.6)));
    }
    if (speed < 18) {
      const euler = _physEuler.setFromQuaternion(plane.quat, 'YXZ');
      const tailBlend = ground.taildragger ? Math.max(0, 1 - speed / 18) : 0;
      const targetPitch = 0.225 * tailBlend;
      euler.z *= Math.max(0, 1 - dt * 4);
      euler.x += (targetPitch - euler.x) * Math.min(1, dt * 3.5);
      plane.quat.setFromEuler(euler);
    }
    plane.onGround = true;
  }
}

function updatePhysics(dt) {
  if (plane.crashed) return;

  if (INPUT_FLAGS.mouseFlight) updateMouseFlightSteer(dt);

  // ----- Input -----
  const keyPitchIn = (keys['KeyS'] ? 1 : 0) - (keys['KeyW'] ? 1 : 0);
  const keyRollIn  = (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0);
  const keyYawIn   = ((keys['KeyE'] || keys['ArrowRight']) ? 1 : 0)
                  - ((keys['KeyQ'] || keys['ArrowLeft']) ? 1 : 0);
  const gamepadPitchIn = INPUT_FLAGS.gamepad && gamepadState.connected ? gamepadState.pitch : 0;
  const gamepadRollIn  = INPUT_FLAGS.gamepad && gamepadState.connected ? gamepadState.roll : 0;
  const gamepadYawIn   = INPUT_FLAGS.gamepad && gamepadState.connected ? gamepadState.yaw : 0;
  const pitchTarget = shapeControlInput(Math.max(-1, Math.min(1, keyPitchIn + gamepadPitchIn)), 0.04);
  const rollTarget  = shapeControlInput(Math.max(-1, Math.min(1, keyRollIn + gamepadRollIn)), 0.04);
  const yawTarget   = shapeControlInput(Math.max(-1, Math.min(1, keyYawIn + gamepadYawIn)), 0.08);
  controlState.pitch = smoothSignedInput(controlState.pitch, pitchTarget, dt, 70, 48);
  controlState.roll = smoothSignedInput(controlState.roll, rollTarget, dt, 82, 52);
  controlState.yaw = smoothSignedInput(controlState.yaw, yawTarget, dt, 58, 38);
  const pitchIn = controlState.pitch;
  const rollIn = controlState.roll;
  const yawIn = controlState.yaw;

  const touchThrottle = (typeof getTouchThrottleInput === 'function') ? getTouchThrottleInput() : { up: 0, down: 0 };
  const throttleUpIn = Math.max((keys['ShiftLeft'] || keys['ShiftRight'] || keys['ArrowUp']) ? 1 : 0, INPUT_FLAGS.gamepad ? gamepadState.throttleUp : 0, touchThrottle.up || 0);
  const throttleDownIn = Math.max((keys['ControlLeft'] || keys['ControlRight'] || keys['ArrowDown']) ? 1 : 0, INPUT_FLAGS.gamepad ? gamepadState.throttleDown : 0, touchThrottle.down || 0);
  controlState.throttleUp += (throttleUpIn - controlState.throttleUp) * (1 - Math.exp(-18 * dt));
  controlState.throttleDown += (throttleDownIn - controlState.throttleDown) * (1 - Math.exp(-18 * dt));
  if (controlState.throttleUp > 0.01) plane.throttleTarget = Math.min(1, plane.throttleTarget + dt * 2.75 * controlState.throttleUp);
  if (controlState.throttleDown > 0.01) plane.throttleTarget = Math.max(0, plane.throttleTarget - dt * 2.2 * controlState.throttleDown);
  plane.throttle += (plane.throttleTarget - plane.throttle) * (1 - Math.exp(-12.0 * dt));
  maybeTriggerEngineStart();

  plane.brake = (keys['KeyB'] || (INPUT_FLAGS.gamepad && gamepadState.brake)) ? 1 : 0;

  // Animate gear
  if (getCurrentGroundSpec().fixedGear) { plane.gear = 1; plane.gearTarget = 1; }
  else plane.gear += (plane.gearTarget - plane.gear) * Math.min(1, dt * 1.8);

  // ----- Forces & rotations -----
  const forward = _physFwd.set(0, 0, -1).applyQuaternion(plane.quat);
  const up = _physUp.set(0, 1, 0).applyQuaternion(plane.quat);
  const right = _physRight.set(1, 0, 0).applyQuaternion(plane.quat);

  const invQ = _physInvQ.copy(plane.quat).invert();
  const localVel = _physLocalVel.copy(plane.vel).applyQuaternion(invQ);
  const forwardSpeed = -localVel.z;        // m/s-ish along nose
  const speed = plane.vel.length();

  // Angle of attack: angle between nose and velocity in pitch plane
  let aoa = 0;
  if (Math.abs(forwardSpeed) > 0.5) {
    aoa = Math.atan2(-localVel.y, Math.max(1, forwardSpeed));
  }

  // Control authority scales with airspeed (surfaces need airflow),
  // then FALLS OFF at both ends so a prop-plane can't over-rotate at
  // high speed AND can't aggressively pitch itself into a deeper stall
  // once airspeed is already dangerously low. Curve:
  //   v < 18 m/s (≈35 kts):    authority 0 → 0.3  (pre-flying mush)
  //   18..50 m/s (35..97 kts):   authority 0.3 → 1.0 normal
  //   50..80 m/s:                authority ≈ 1.0 (control sweet spot)
  //   > 80 m/s:                  gentle taper toward 0.5
  // Combined with the softer post-stall CL curve above, this means a
  // stall no longer compounds into a spiral — the pilot (or AI) can
  // nose down and recover.
  const q = Math.max(0, forwardSpeed);
  const loSpeedFade = Math.max(0.22, Math.min(1, (q - 16) / 34)); // 0.22..1
  const hiSpeedDamp = 1 / (1 + Math.max(0, (q - 55)) * 0.020);    // stronger high-speed authority falloff
  const maneuverAssistTune = scene.userData.__flightManeuverAssist != null ? scene.userData.__flightManeuverAssist : 1.0;
  const autoRudderTune = scene.userData.__flightAutoRudder != null ? scene.userData.__flightAutoRudder : 1.0;
  const selfLevelTune = scene.userData.__flightSelfLevel != null ? scene.userData.__flightSelfLevel : 1.0;
  const weathervaneTune = scene.userData.__flightWeathervaneYaw != null ? scene.userData.__flightWeathervaneYaw : 1.0;
  // Slowing down into the manoeuvring-speed band should tighten the turn and
  // make control inputs feel more authoritative — up to a point. Real planes
  // can carve a tighter radius at lower speed/bank, but once you're too slow
  // the controls should still soften again. Peak assist lives in the mid-band,
  // not at the stall edge.
  const maneuverBand = smoothstepRange(24, 42, q) * (1 - smoothstepRange(58, 88, q));
  const maneuverRollBoost = 1 + maneuverBand * 0.18 * maneuverAssistTune;
  const maneuverPitchBoost = 1 + maneuverBand * 0.12 * maneuverAssistTune;
  const maneuverYawBoost = 1 + maneuverBand * 0.14 * maneuverAssistTune;
  // Roll + pitch get the lighter low-speed fade (sqrt) and a weaker
  // hi-speed damp — these are the primary manoeuvring inputs and need
  // to stay crisp. Pitch in particular should snap the nose up when S
  // is held. Stall protection is still active at very low speed +
  // high AoA (see below) so crisp pitch won't spiral the AI.
  const rollScale  = Math.sqrt(loSpeedFade) * Math.max(0.50, hiSpeedDamp) * maneuverRollBoost;
  const pitchScale = Math.sqrt(loSpeedFade) * Math.max(0.56, hiSpeedDamp) * maneuverPitchBoost;
  const yawScale   = loSpeedFade * hiSpeedDamp * maneuverYawBoost;
  const authPitch = Math.min(1.0, q / 34) * pitchScale;
  const authRoll  = Math.min(1.0, q / 30) * rollScale;
  const authYaw   = Math.min(0.72, q / 72) * yawScale;
  // Per-airframe authority ratios, resolved once per physics step. The E-115
  // baseline divides by itself → exactly 1.0 per axis, so default handling is
  // bit-identical; other airframes differentiate around it.
  const pitchAuthRatio = getAircraftFlightRatio('pitchAuthority');
  const rollAuthRatio = getAircraftFlightRatio('rollAuthority');
  const rudderAuthRatio = getAircraftFlightRatio('rudderAuthority');
  const pitchAuthorityTune = (scene.userData.__flightPitchAuth != null ? scene.userData.__flightPitchAuth : 1.0)
    * pitchAuthRatio;
  const rollAuthorityTune = (scene.userData.__flightRollAuth != null ? scene.userData.__flightRollAuth : 1.0)
    * rollAuthRatio;
  const rudderAuthorityTune = (scene.userData.__flightRudderAuth != null ? scene.userData.__flightRudderAuth : 1.0)
    * rudderAuthRatio;

  // Apply torque (pitch=X, yaw=Y, roll=Z in local frame). These are
  // intentionally conservative: a prop plane should enter a bank and let
  // aerodynamic forces carry the turn, not pivot like a camera rig.
  plane.angVel.x += pitchIn * 2.35 * authPitch * pitchAuthorityTune * dt;
  plane.angVel.z += -rollIn * 4.15 * authRoll * rollAuthorityTune * dt;
  plane.angVel.y += -yawIn * 1.20 * authYaw * rudderAuthorityTune * dt;

  // Arcade rate-command layer: keep controls readable, but cap the target
  // rates to values a light prop aircraft can plausibly approach.
  const rateAuthorityPitch = Math.max(plane.onGround ? 0.12 : 0.26, authPitch);
  const rateAuthorityRoll = Math.max(plane.onGround ? 0.08 : 0.30, authRoll);
  const rateAuthorityYaw = Math.max(plane.onGround ? 0.16 : 0.16, authYaw);
  if (Math.abs(pitchIn) > 0.015) {
    const pitchRateTarget = pitchIn * 1.65 * rateAuthorityPitch * pitchAuthorityTune;
    plane.angVel.x += (pitchRateTarget - plane.angVel.x) * (1 - Math.exp(-7.5 * dt));
  }
  if (Math.abs(rollIn) > 0.015) {
    const rollRateTarget = -rollIn * 2.35 * rateAuthorityRoll * rollAuthorityTune;
    plane.angVel.z += (rollRateTarget - plane.angVel.z) * (1 - Math.exp(-8.5 * dt));
  }
  if (Math.abs(yawIn) > 0.015) {
    const yawRateTarget = -yawIn * 0.82 * rateAuthorityYaw * rudderAuthorityTune;
    plane.angVel.y += (yawRateTarget - plane.angVel.y) * (1 - Math.exp(-6.0 * dt));
  }

  const mousePitchSteer = (INPUT_FLAGS.mouseFlight && !plane.onGround) ? mouseFlightState.steerY : 0;
  const mouseYawSteer = (INPUT_FLAGS.mouseFlight && !plane.onGround) ? mouseFlightState.steerX : 0;
  if (Math.abs(mousePitchSteer) > 0.008) {
    const mousePitchRateTarget = mousePitchSteer * 1.75 * Math.max(0.32, authPitch) * pitchAuthorityTune;
    plane.angVel.x += (mousePitchRateTarget - plane.angVel.x) * Math.min(1, dt * 3.4);
  }
  if (Math.abs(mouseYawSteer) > 0.008) {
    const mouseYawRateTarget = -mouseYawSteer * 0.95 * Math.max(0.20, authYaw) * rudderAuthorityTune;
    plane.angVel.y += (mouseYawRateTarget - plane.angVel.y) * Math.min(1, dt * 3.0);
  }

  // D13 — Airframe integrity: damaged wings introduce a roll bias and
  // general instability. Effect is subtle at full health, meaningful
  // below ~50%. Engine damage causes yaw drift (asymmetric thrust).
  const wingBias = plane.damage.rightWing - plane.damage.leftWing;
  if (Math.abs(wingBias) > 0.01) {
    plane.angVel.z += wingBias * 0.7 * dt;
  }
  if (plane.damage.airframe > 0.15) {
    const jitter = (plane.damage.airframe - 0.15) * 0.6;
    plane.angVel.x += (Math.random() - 0.5) * jitter * dt;
    plane.angVel.z += (Math.random() - 0.5) * jitter * dt;
  }
  if (plane.damage.engine > 0.25) {
    plane.angVel.y += (plane.damage.engine - 0.25) * 0.35 * dt;
  }

  // ----- AUTO-RUDDER (turn coordination) -----
  // A banked aircraft needs yaw input to keep the nose tracking the turn.
  // rightWorld.y is negative when banked right (right wing dropped).
  // In this sim, negative angVel.y yaws the nose right, so we want:
  //   banked right (rightWorld.y < 0) → angVel.y negative → nose right ✓
  // which means yaw contribution has the SAME sign as rightWorld.y.
  const rightWorld = _physRightWorld.set(1, 0, 0).applyQuaternion(plane.quat);
  const bankSign = rightWorld.y;            // negative when banked right
  const bankAmount = Math.abs(bankSign);    // 0..1
  if (bankAmount > 0.17 && q > 25) {
    const coordYaw = bankSign * bankAmount * 0.24 * autoRudderTune;
    plane.angVel.y += coordYaw * authYaw * dt;
  }
  // Input-proportional rudder: rolling right (rollIn > 0) → nose right → negative angVel.y
  if (Math.abs(rollIn) > 0.01 && q > 25) {
    plane.angVel.y += -rollIn * 0.08 * autoRudderTune * authYaw * dt;
  }

  // Self-correcting stability (dihedral, weathervane)
  // Level roll restore
  const worldUpLocal = _physWorldUpLocal.set(0, 1, 0).applyQuaternion(invQ);
  plane.angVel.z += -worldUpLocal.x * 0.6 * selfLevelTune * authRoll * dt;
  // Weathervane: yaw toward velocity
  plane.angVel.y += -localVel.x * 0.002 * weathervaneTune * authYaw * dt;

  // Axis damping — user-tunable in the flight options panel so the plane can
  // be made either more planted or more snappy.
  const pitchDampTune = scene.userData.__flightPitchDamp != null ? scene.userData.__flightPitchDamp : 1.0;
  const rollDampTune = scene.userData.__flightRollDamp != null ? scene.userData.__flightRollDamp : 1.0;
  const rudderDampTune = scene.userData.__flightRudderDamp != null ? scene.userData.__flightRudderDamp : 1.0;
  plane.angVel.x *= Math.pow(0.22, dt * pitchDampTune);
  plane.angVel.z *= Math.pow(0.05, dt * rollDampTune);
  plane.angVel.y *= Math.pow(0.08, dt * rudderDampTune);

  // Rate ceilings scale with the airframe's authority ratios (1.0 for the
  // E-115 baseline → unchanged default caps), so e.g. stunt airframes can
  // actually reach their higher commanded rates.
  const maxPitchRate = MAX_PITCH_RATE * pitchAuthRatio;
  const maxRollRate = MAX_ROLL_RATE * rollAuthRatio;
  const maxYawRate = MAX_YAW_RATE * rudderAuthRatio;
  plane.angVel.x = Math.max(-maxPitchRate, Math.min(maxPitchRate, plane.angVel.x));
  plane.angVel.z = Math.max(-maxRollRate, Math.min(maxRollRate, plane.angVel.z));
  plane.angVel.y = Math.max(-maxYawRate, Math.min(maxYawRate, plane.angVel.y));

  // Hard clamp on rotation rate
  if (plane.angVel.length() > MAX_ANG_VEL) {
    plane.angVel.setLength(MAX_ANG_VEL);
  }

  const fastTurnStress = (
    Math.max(0, bankAmount - 0.42) * 1.55 +
    Math.max(0, Math.abs(plane.angVel.z) - 0.58) * 0.52 +
    Math.max(0, Math.abs(plane.angVel.y) - 0.34) * 0.95 +
    Math.max(0, Math.abs(localVel.x) - 5.0) * 0.06 +
    Math.max(0, Math.abs(aoa) - 0.10) * 0.85
  ) * Math.min(1, q / 42) * (0.45 + plane.throttle * 0.8);
  updateEngineSurge(dt, fastTurnStress);
  const abuseStress = Math.max(0, fastTurnStress - 0.82);
  if (!plane.onGround && abuseStress > 0) {
    plane.stressDamageTimer += dt * abuseStress;
    if (plane.stressDamageTimer > 1.2) {
      plane.stressDamageTimer = 0;
      const wingKind = bankSign < 0 ? 'rightWing' : 'leftWing';
      damagePlane(0.012 + Math.min(0.018, abuseStress * 0.006), wingKind, { reason: 'AIRFRAME OVERSTRESS' });
      damagePlane(0.004 + Math.min(0.010, abuseStress * 0.003), 'airframe', { reason: 'AIRFRAME OVERSTRESS' });
      const nowWarn = performance.now();
      if (nowWarn - (plane.lastStressWarnAt || 0) > 2600 && typeof flashStatus === 'function') {
        plane.lastStressWarnAt = nowWarn;
        flashStatus('AIRFRAME OVERSTRESS · HIT TARGETS FOR REPAIRS', 'panel warn', 1.1);
      }
    }
  } else {
    plane.stressDamageTimer = Math.max(0, (plane.stressDamageTimer || 0) - dt * 0.7);
  }
  const engineBurn = Math.max(0, plane.throttle - 0.86) * smoothstepRange(86, 132, q) + Math.max(0, plane.throttle - 0.94) * 0.7;
  if (!plane.onGround && engineBurn > 0.08) {
    plane.engineBurnTimer += dt * engineBurn;
    if (plane.engineBurnTimer > 2.2) {
      plane.engineBurnTimer = 0;
      damagePlane(0.010 + Math.min(0.020, engineBurn * 0.012), 'engine', { reason: 'ENGINE OVERHEAT' });
      const nowWarn = performance.now();
      if (nowWarn - (plane.lastStressWarnAt || 0) > 2600 && typeof flashStatus === 'function') {
        plane.lastStressWarnAt = nowWarn;
        flashStatus('ENGINE HOT · FLY TARGETS TO REPAIR', 'panel warn', 1.1);
      }
    }
  } else {
    plane.engineBurnTimer = Math.max(0, (plane.engineBurnTimer || 0) - dt * 0.8);
  }

  // Integrate rotation
  const dQ = _physQuat.setFromEuler(_physEuler.set(
    plane.angVel.x * dt, plane.angVel.y * dt, plane.angVel.z * dt, 'XYZ'
  ));
  plane.quat.multiply(dQ).normalize();

  // ----- Aerodynamic forces -----
  // Lift coefficient. Below stall: linear CL vs AoA like a real wing.
  // Past stall: instead of snapping to 0.2 (which produced a sudden
  // "fall out of the sky" effect), degrade smoothly toward ~55% of
  // peak over the next 15°. Real wings are messy past stall but keep
  // producing meaningful lift until deep stall — this matches how a
  // student pilot is actually taught to recover.
  let cl;
  const aoaAbs = Math.abs(aoa);
  const stallSoftTune = (scene.userData.__flightStallSoft != null ? scene.userData.__flightStallSoft : 1.0)
    * getAircraftFlightRatio('stallSoftness');
  if (aoaAbs <= STALL_AOA) {
    cl = CL0 + CL_ALPHA * aoa;
  } else {
    const peak = CL_ALPHA * STALL_AOA;
    const excess = aoaAbs - STALL_AOA;
    // Fade from peak down to a tunable post-stall floor over a tunable range.
    const fadeSpan = 0.20 + (1.5 - stallSoftTune) * 0.10;
    const fade = Math.min(1, excess / Math.max(0.12, fadeSpan));
    const fadeLoss = 0.30 + (1 - stallSoftTune) * 0.15;
    const floorMul = 0.45 + stallSoftTune * 0.15;
    const degraded = peak * (1 - fade * fadeLoss);
    cl = CL0 + Math.sign(aoa) * Math.max(peak * floorMul, degraded);
  }
  // Lift only when moving forward through the air
  const v = Math.max(0, forwardSpeed);
  // --- Ground effect ---
  // Within ~1 wingspan of the ground, induced drag drops and effective
  // lift rises — the cushion that lets a stalled plane float to the
  // runway instead of face-planting. Scales from 0 (high AGL) to 1.35×
  // lift at 0 AGL, decaying exponentially over ~12 m.
  const aglForGE = Math.max(0, plane.pos.y - getSurfaceHeight(plane.pos.x, plane.pos.z));
  const groundEffectTune = scene.userData.__flightGroundEffect != null ? scene.userData.__flightGroundEffect : 1.0;
  const groundEffect = 1 + 0.35 * groundEffectTune * Math.exp(-aglForGE / 12);
  const liftTune = (scene.userData.__flightLift != null ? scene.userData.__flightLift : 1.0)
    * getAircraftFlightRatio('lift');
  const accelTune = (scene.userData.__flightAccel != null ? scene.userData.__flightAccel : 1.0)
    * getAircraftFlightRatio('accel');
  const topSpeedTuneKts = (scene.userData.__flightTopSpeedKts != null ? scene.userData.__flightTopSpeedKts : 720)
    * getAircraftFlightRatio('topSpeedKts');
  const liftMag = LIFT_K * liftTune * v * v * cl * groundEffect;
  const lift = _physLift.copy(up).multiplyScalar(liftMag);
  // Arcade-realistic sideslip: the aircraft can skid, but the fuselage
  // gradually weathervanes back into the airflow. This keeps rudder and
  // banked turns expressive without the plane feeling like it is sliding
  // sideways through the canyon.
  const slipSpeed = localVel.x;
  const slipDamping = _physSlipDamping.copy(right).multiplyScalar(-slipSpeed * Math.min(1.25, q / 42) * (0.68 + bankAmount * 0.32));
  const loadFactor = Math.max(0, liftMag / Math.max(0.001, GRAVITY));
  plane.loadFactor = loadFactor;   // read by the camera stress shake (11-jet-visual-cam.js)
  const turnRateStress = Math.max(0, Math.abs(plane.angVel.y) + Math.abs(plane.angVel.z) * 0.35 - 0.22);
  const turnEnergyBleed = Math.max(0, loadFactor - 1.05) * Math.max(0, bankAmount - 0.18) * 0.040
    + turnRateStress * turnRateStress * 0.010;

  // Drag: parasitic + induced (∝ CL²) + gear, plus a soft top-speed limiter
  // from the live flight tuning panel.
  const gearDragTune = scene.userData.__flightGearDrag != null ? scene.userData.__flightGearDrag : 1.0;
  const cd = DRAG_PARASITE + DRAG_INDUCED * cl * cl + GEAR_DRAG * gearDragTune * plane.gear;
  const speedKts = speed * 1.94;
  const topSpeedRatio = topSpeedTuneKts > 1 ? speedKts / topSpeedTuneKts : 0;
  const speedLimiterDrag = topSpeedRatio > 0.92
    ? 1 + Math.pow((topSpeedRatio - 0.92) / 0.08, 2) * 1.45
    : 1;
  const dragMag = cd * speed * speed * speedLimiterDrag;
  const drag = _physDrag.set(0, 0, 0);
  if (speed > 0.01) {
    drag.copy(plane.vel).normalize().multiplyScalar(-dragMag);
    if (turnEnergyBleed > 0) {
      drag.addScaledVector(plane.vel, -speed * turnEnergyBleed);
    }
  }

  // Thrust
  // Effective throttle includes the flight-idle floor whenever we're
  // airborne. On the ground we let it drop to 0 so brakes + closed
  // throttle actually stop the plane. Use the persistent onGround state
  // instead of a raw altitude threshold so the parked aircraft does not
  // creep forward at 0% throttle the instant the sim starts.
  const _thrGroundH = getSurfaceHeight(plane.pos.x, plane.pos.z);
  // Flight-idle floor only kicks in when throttle is actively engaged.
  // Holding CTRL all the way to 0% = genuine engine-off (glide-only).
  // Small hysteresis (0.03) so a slight breath on throttle doesn't jitter.
  const engineEngaged = plane.throttle > 0.03 || plane.throttleTarget > 0.03;
  const idlePowerTune = (scene.userData.__flightIdlePower != null ? scene.userData.__flightIdlePower : 1.0)
    * getAircraftFlightRatio('idlePower');
  const flightIdleFrac = IDLE_THRUST_FRAC * idlePowerTune;
  const effectiveThrottle = plane.onGround
    ? plane.throttle
    : (engineEngaged ? Math.max(flightIdleFrac, plane.throttle) : 0);
  // Engine damage directly reduces available thrust. At 100% damage
  // the engine produces only 25% of rated thrust (windmilling).
  const engineFactor = 1 - plane.damage.engine * 0.75;
  const effectiveThrottleWithSurge = effectiveThrottle * engineSurgeState.powerMul * engineFactor;
  const takeoffBoost = plane.onGround
    ? 1.78
    : (q < 76 && plane.throttle > 0.74 ? 1.22 : 1.0);
  const thrust = _physThrust.copy(forward).multiplyScalar(effectiveThrottleWithSurge * MAX_THRUST * 1.28 * accelTune * takeoffBoost);

  // Gravity
  const gravity = _physGravity;

  // --- STALL PROTECTION / AUTO-TRIM ---
  // When the plane is slow AND high-alpha AND falling, the pilot might
  // be panic-pulling. Apply an automatic pitch-down torque that nudges
  // the nose below the horizon so airspeed can recover. Real GA stall
  // protection does similar ("stick pusher"). Only active in the
  // danger zone — elsewhere the pilot has full authority.
  if (q < 35 && aoa > 0.22 && plane.vel.y < 0 && plane.pos.y > _thrGroundH + 3) {
    const urgency = Math.min(1, (0.32 - Math.min(aoa, 0.32)) / 0.10 + (35 - q) / 15);
    plane.angVel.x += -1.6 * Math.max(0.3, urgency) * dt;  // force nose down
  }

  const accel = _physAccel.set(0, 0, 0)
    .add(thrust)
    .add(lift)
    .add(slipDamping)
    .add(drag)
    .add(gravity);

  plane.vel.addScaledVector(accel, dt);

  // Integrate position
  plane.pos.addScaledVector(plane.vel, dt);
  resolvePostStepSurfaceContact(dt, forward, plane.vel.length());

  // Altitude ceiling — hard cap at 3000 ft (914 m). Above the cap we
  // clamp y and zero any remaining upward velocity so the plane "tops
  // out" cleanly rather than bumping against an invisible wall.
  const ALT_CEIL_M = 914;
  if (plane.pos.y > ALT_CEIL_M) {
    plane.pos.y = ALT_CEIL_M;
    if (plane.vel.y > 0) plane.vel.y = 0;
  }

  // World limits (shouldn't hit — infinite terrain)
  plane.pos.y = Math.max(plane.pos.y, -10);

  // __physics_nan_guard__ — extreme attitudes (near-vertical climb/dive) can
  // produce NaN in quaternion integration when angVel is large. Detect and
  // reset to prevent state corruption that crashes the render loop.
  if (!isFinite(plane.pos.x) || !isFinite(plane.pos.y) || !isFinite(plane.pos.z) ||
      !isFinite(plane.vel.x) || !isFinite(plane.vel.y) || !isFinite(plane.vel.z) ||
      !isFinite(plane.quat.x) || !isFinite(plane.quat.y) || !isFinite(plane.quat.z) || !isFinite(plane.quat.w)) {
    console.warn('[physics] NaN detected at extreme attitude — resetting to safe state');
    plane.vel.set(0, 0, Math.max(0, plane.vel.length() * 0.5)); // preserve some forward speed
    plane.angVel.set(0, 0, 0);
    plane.quat.setFromEuler(_physEuler.set(0, Math.atan2(plane.pos.x, plane.pos.z), 0));
    plane.pos.y = Math.max(50, plane.pos.y); // pop up slightly to avoid ground intersection
  }
}
