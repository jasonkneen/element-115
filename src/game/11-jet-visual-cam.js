// @module src/game/11-jet-visual-cam.js
// =============================================================
//  JET VISUAL UPDATE — gear animation, afterburner
// =============================================================
let _jetVisualLast = 0;
function updateJetVisual() {
  // Frame-rate-normalized blend factor for the cosmetic control-surface/wing-flex
  // smoothing below. updateJetVisual runs once per RENDER frame (variable rate), so
  // a bare per-frame constant would snap ~2.4x faster at 144fps than at 60fps. We
  // measure dt internally (no call-site plumbing) and scale so the feel matches 60fps.
  const _nowJV = performance.now();
  const _jvDt = _jetVisualLast ? Math.min(0.1, Math.max(0.001, (_nowJV - _jetVisualLast) / 1000)) : (1 / 60);
  _jetVisualLast = _nowJV;
  const _jvBlend = (f) => Math.min(1, f * _jvDt * 60);
  if (replay.playing) {
    jet.position.copy(plane.pos);
    jet.quaternion.copy(plane.quat);
  } else {
    jet.position.lerpVectors(plane.prevPos, plane.pos, physicsAlpha);
    jet.quaternion.copy(plane.prevQuat).slerp(plane.quat, physicsAlpha);
  }

  // Gear rotations (1 = down, 0 = up)
  const g = plane.gear;
  // Nose gear folds forward
  jet.userData.gearNose.rotation.x = (1 - g) * (Math.PI * 0.55);
  // Main gear folds inward
  jet.userData.gearL.rotation.z = (1 - g) * (Math.PI * 0.5);
  jet.userData.gearR.rotation.z = -(1 - g) * (Math.PI * 0.5);

  // Fixed gear stance — slightly wider/splayed under load, tucking in as lift unloads it.
  const gearGroundH = (plane.pos.x * plane.pos.x + plane.pos.z * plane.pos.z < AIRFIELD_FLAT_R2)
    ? AIRFIELD_SURFACE_Y : getHeight(plane.pos.x, plane.pos.z);
  const gearAltAGL = Math.max(0, plane.pos.y - gearGroundH);
  const groundSpeed = Math.hypot(plane.vel.x, plane.vel.z);
  const groundLoad = clamp01(1 - gearAltAGL / 8) * g;
  const wheelSpinStep = (plane.onGround ? groundSpeed : plane.vel.length() * 0.55) * 0.028;
  for (const gear of [jet.userData.gearL, jet.userData.gearR]) {
    if (!gear || !gear.userData) continue;
    const side = gear.userData.side || 0;
    const wheel = gear.userData.wheel;
    const strut = gear.userData.strut;
    if (!wheel || !strut || !side) continue;
    const wheelSplay = 0.05 + groundLoad * 0.16;
    const strutLean = side * (0.03 + groundLoad * 0.09);
    wheel.position.x = side * wheelSplay;
    wheel.position.y = gear.userData.baseWheelY + groundLoad * 0.02;
    wheel.rotation.x -= wheelSpinStep;
    strut.position.x = side * wheelSplay * 0.42;
    strut.position.y = gear.userData.baseStrutY + groundLoad * 0.01;
    strut.rotation.z = strutLean;
  }
  const noseWheel = jet.userData.gearNose && jet.userData.gearNose.userData ? jet.userData.gearNose.userData.wheel : null;
  if (noseWheel) noseWheel.rotation.x -= wheelSpinStep * 1.04;

  // Aero flex + control-surface motion.
  const invQ = _visInvQ.copy(plane.quat).invert();
  const flexLocalVel = _visLocalVel.copy(plane.vel).applyQuaternion(invQ);
  const wingLoad = clamp01(Math.abs(plane.angVel.z) * 0.34 + Math.abs(flexLocalVel.x) / 28 + Math.abs(flexLocalVel.y) / 38);

  const aileronTarget = Math.max(-0.45, Math.min(0.45, -plane.angVel.z * 0.18 - flexLocalVel.x * 0.012));
  const elevatorTarget = Math.max(-0.32, Math.min(0.32, plane.angVel.x * 0.22 - flexLocalVel.y * 0.006));
  const rudderTarget = Math.max(-0.38, Math.min(0.38, plane.angVel.y * 0.30 + flexLocalVel.x * 0.01));
  const shakeTarget = (!plane.crashed && plane.throttle > 0.15)
    ? (0.02 + plane.throttle * 0.03 + plane.damage.engine * 0.04)
    : 0;
  aeroFlexState.wingBend += (((plane.onGround ? 0.05 : 0.16) + wingLoad * (plane.onGround ? 0.05 : 0.28)) - aeroFlexState.wingBend) * _jvBlend(0.12);
  aeroFlexState.aileron += (aileronTarget - aeroFlexState.aileron) * _jvBlend(0.18);
  aeroFlexState.elevator += (elevatorTarget - aeroFlexState.elevator) * _jvBlend(0.16);
  aeroFlexState.rudder += (rudderTarget - aeroFlexState.rudder) * _jvBlend(0.16);
  aeroFlexState.shake += (shakeTarget - aeroFlexState.shake) * _jvBlend(0.14);

  for (const nav of [jet.userData.navRed, jet.userData.navGrn]) {
    if (!nav) continue;
    if (!nav.userData.__basePos) nav.userData.__basePos = nav.position.clone();
    const side = nav === jet.userData.navRed ? -1 : 1;
    const asym = aeroFlexState.aileron * side * 0.22;
    nav.position.copy(nav.userData.__basePos);
    nav.position.y += aeroFlexState.wingBend * (0.75 + asym);
    nav.position.z -= aeroFlexState.wingBend * 0.42;
  }

  const surfaces = jet.userData.controlSurfaces;
  if (surfaces) {
    for (const rec of surfaces.aileronL || []) rec.node.rotation.z = rec.rz + aeroFlexState.aileron;
    for (const rec of surfaces.aileronR || []) rec.node.rotation.z = rec.rz - aeroFlexState.aileron;
    for (const rec of surfaces.elevatorL || []) rec.node.rotation.x = rec.rx + aeroFlexState.elevator;
    for (const rec of surfaces.elevatorR || []) rec.node.rotation.x = rec.rx + aeroFlexState.elevator;
    for (const rec of surfaces.rudder || []) rec.node.rotation.y = rec.ry + aeroFlexState.rudder;
  }

  // Afterburner — only for jets; swapped-in GLB planes skip this
  if (!plane.suppressJetFX) {
    const ab = jet.userData.afterburner;
    const ab2 = jet.userData.ab2;
    const burn = Math.max(0, (plane.throttle - 0.55) / 0.45);
    ab.material.opacity = burn * 0.85;
    ab.scale.set(
      0.7 + burn * 0.7,
      0.7 + burn * 0.7,
      1.0 + burn * 2.4
    );
    ab2.material.opacity = burn * 1.0;
    ab2.scale.set(
      0.55 + burn * 0.5,
      0.55 + burn * 0.5,
      0.7 + burn * 1.7
    );
    // Flicker
    const fl = 0.92 + Math.sin(performance.now() * 0.08) * 0.04 + Math.random() * 0.05;
    ab.scale.z *= fl;
    ab2.scale.z *= fl;
  }

  // Propeller spin — real mesh OR procedural disc. Spin around the
  // plane's local Z axis (forward) with a small idle trickle + throttle
  // scaling. Procedural disc's motion-blur circle fades in with RPM.
  // Also emit a visible propeller disc trail — a thin white condensation
  // puff at the prop disc position, visible at high throttle for extra
  // realism on prop planes.
  if (plane.props && plane.props.length) {
    // Propeller angular speed (rad/s). Real props idle at ~600 RPM
    // (≈63 rad/s) and cruise at 2000–2700 RPM (≈210–280 rad/s). We
    // scale to that range so the blades look convincingly fast but
    // still individually visible at idle for a visual RPM cue.
    const propThrottle = Math.max(0, Math.min(1.15, plane.throttle * engineSurgeState.powerMul));
    // With throttle truly at zero, the prop is stopped (no idle windmill).
    // Above 2% throttle we interpolate from idle (60 rad/s) to full.
    // Engine damage also kills prop rotation proportionally so the
    // visuals match the audio cue.
    const engineRunning = plane.throttle > 0.02 && !plane.crashed;
    const engineHealth = 1 - plane.damage.engine;
    const omega = engineRunning ? (60 + propThrottle * 240) * engineHealth : 0;
    const dRot = omega * 0.016;                    // per-frame @ 60 fps

    // Motion-blur / strobe disc opacity. Stays invisible at low RPM so
    // you can see the individual blades spinning. Above ~40% throttle it
    // fades in, with a small flicker term (sin + noise) that mimics the
    // beat between the prop and the frame rate — this is what sells the
    // "real" strobe look alongside the still-visible blades.
    const t = performance.now() * 0.001;
    const rpmN = clamp01((propThrottle - 0.35) / 0.65); // 0 below 35%, 1 at full-ish
    const flicker = (Math.sin(t * 48) * 0.5 + Math.sin(t * 73 + 1.3) * 0.5) * 0.15
                  + (Math.random() - 0.5) * 0.08;
    const discOpacity = Math.max(0, Math.min(0.55, rpmN * 0.45 + flicker * rpmN));

    // Slight blade dimming at very high RPM so the strobe reads as
    // motion, not solid geometry. Only applied to the extracted blade
    // meshes so the procedural fallback keeps its own look.
    const bladeOpacity = 1 - rpmN * 0.25;

    for (const p of plane.props) {
      const axis = p.userData.__propAxis || 'z';
      if (axis === 'x') p.rotation.x += dRot;
      else if (axis === 'y') p.rotation.y += dRot;
      else p.rotation.z += dRot;
      const disc = p.userData.__disc;
      if (disc) disc.material.opacity = p.userData.__isProceduralProp
        ? 0.15 + Math.min(1, propThrottle) * 0.4    // older procedural curve
        : discOpacity;                              // extracted / named prop → Dusty-style flicker
      if (p.userData.__isExtractedProp || p.userData.__isNamedProp) {
        p.traverse(child => {
          if (!child.isMesh || child === p) return;
          // Skip the disc itself
          if (child.geometry && child.geometry.type === 'CircleGeometry') return;
          const mat = child.material;
          if (!mat) return;
          if (!mat.__apBladeTouched) {
            mat.transparent = true;
            mat.__apBladeTouched = true;
          }
          mat.opacity = bladeOpacity;
        });
      }
    }
  }

  // ——— GLB retractable-gear animation ———
  // Two modes:
  //   clip  — F-15 etc. bone clips (AnimationMixer); time scrubbed 0..duration
  //   nodes — named wheel nodes translate/squash (cosmetic, props)
  // When plane.fixedGear is false (jet clip gear), follow physics plane.gear.
  // When fixedGear is true, follow glbGear.deployed from the G-key toggle.
  if (plane.glbGear) {
    const gg = plane.glbGear;
    if (!plane.fixedGear) {
      gg.deployed = plane.gear > 0.5;
      gg.anim = plane.gear; // 1=down already lerped in physics
    } else {
      const target = gg.deployed ? 1 : 0;
      const step = _jvDt / 0.6;                    // full travel in 0.6s
      if (gg.anim < target) gg.anim = Math.min(target, gg.anim + step);
      else if (gg.anim > target) gg.anim = Math.max(target, gg.anim - step);
    }
    const a = gg.anim;                           // 1 = down, 0 = tucked

    if (gg.mode === 'clip' && gg.mixer && gg.action) {
      // invert=false: t=0 down, t=duration up  →  time = (1-a)*duration
      // invert=true:  t=0 up,   t=duration down →  time = a*duration
      const dur = gg.duration || 1;
      const time = gg.invert ? (a * dur) : ((1 - a) * dur);
      try {
        gg.action.paused = true;
        gg.action.enabled = true;
        gg.action.time = Math.max(0, Math.min(dur, time));
        gg.mixer.update(0);
      } catch (_) { /* ignore one-frame mixer glitches */ }
    } else if (gg.nodes && gg.nodes.length) {
      for (const rec of gg.nodes) {
        rec.node.position.y = rec.baseY + (1 - a) * rec.tuck;
        rec.node.scale.y = rec.baseScaleY * (0.15 + 0.85 * a);
        if (rec.spin && plane.onGround && a > 0.5) {
          rec.node.rotation.x -= (groundSpeed / Math.max(0.05, rec.radius)) * _jvDt;
        }
      }
    }
  }

  // Strobe blink (~1.2 Hz with short pulse)
  const tNow = performance.now() * 0.001;
  const blinkPhase = (tNow * 1.2) % 1;
  jet.userData.strobe.visible = blinkPhase < 0.08 || (blinkPhase > 0.18 && blinkPhase < 0.24);
  if (jet.userData.strobe.scale) jet.userData.strobe.scale.setScalar(1 + aeroFlexState.shake * 3.5);

  // Scanner pulse — subtle opacity breath via scale on Y
  const pulse = 0.8 + Math.sin(tNow * 3.5) * 0.2;
  jet.userData.scanner.scale.y = pulse + aeroFlexState.shake * 1.8;

  // Landing lights — brightest at night / dusk but still usable by day.
  const nightFactor = 1 - timeOfDay.daylight;
  const navScale = 1 + nightFactor * 0.65 + aeroFlexState.wingBend * 1.4;
  if (jet.userData.navRed) jet.userData.navRed.scale.setScalar(navScale);
  if (jet.userData.navGrn) jet.userData.navGrn.scale.setScalar(navScale);
  if (jet.userData.bellyLight) jet.userData.bellyLight.scale.setScalar(1 + nightFactor * 0.9 + aeroFlexState.shake * 2.2);
  // Landing light physical character: a narrow FORWARD cone. Previous
  // settings inflated the beam + glow into a near-spherical bloom that
  // read as "light sphere around plane". Tuned down so:
  //   • glow is a tiny point source at the bulb (max scale 1.2, not 1.8)
  //   • beam cone is narrow, low opacity — visible only in proper dark
  //   • splash on ground is wider (where the beam actually hits)
  const landingIntensity = plane.landingLights
    ? (0.65 + nightFactor * 3.0 + (plane.onGround ? 0.55 : 0))
    : 0;
  const beamOpacity = plane.landingLights
    ? Math.min(0.18, 0.02 + nightFactor * 0.16 + (plane.onGround ? 0.04 : 0))
    : 0;
  const glowOpacity = plane.landingLights
    ? Math.min(0.6, 0.10 + nightFactor * 0.45 + (plane.onGround ? 0.10 : 0))
    : 0;
  // Group-N hysteresis: ON edge is immediate (L jumps intensity to ≥0.65, far
  // above the threshold), OFF edge needs 3 s below it — key spam or dusk shimmer
  // can't flap the lights-hash into a shader recompile.
  auxLightGroupN.landingWant = landingIntensity;
  const auxNOn = updateAuxLightGroupN(performance.now());
  // Single application site for ALL group-N visibility: apron floods must flip
  // the same frame as the landing rigs, or intermediate frames render
  // mismatched point/spot counts — hashes outside the prewarmed states.
  for (const rig of airfieldAmbientState.apronFloods) rig.light.visible = auxNOn;
  if (jet.userData.landingRigs) {
    const forwardWorld = _visFwd.set(0, 0, -1).applyQuaternion(plane.quat);
    const rightWorld = _visRight.set(1, 0, 0).applyQuaternion(plane.quat);
    for (const rig of jet.userData.landingRigs) {
      rig.light.visible = auxNOn;
      rig.light.intensity = landingIntensity;
      rig.light.distance = 260 + nightFactor * 180;
      rig.glow.material.opacity = glowOpacity;
      rig.glow.scale.setScalar(1.0 + glowOpacity * 0.25);
      rig.beam.material.opacity = beamOpacity;
      rig.beam.scale.setScalar(0.8 + beamOpacity * 1.4);
      rig.beam.visible = beamOpacity > 0.01;

      const splashCenter = _visSplashCenter.copy(plane.pos)
        .addScaledVector(forwardWorld, 54)
        .addScaledVector(rightWorld, rig.side * 2.6);
      const splashGround = (splashCenter.x * splashCenter.x + splashCenter.z * splashCenter.z < AIRFIELD_FLAT_R2)
        ? AIRFIELD_SURFACE_Y + 0.08 : getHeight(splashCenter.x, splashCenter.z) + 0.18;
      rig.splash.position.set(splashCenter.x, splashGround, splashCenter.z);
      rig.splash.rotation.z = Math.atan2(forwardWorld.x, -forwardWorld.z);
      rig.splash.material.opacity = plane.landingLights
        ? Math.min(0.22, 0.05 + nightFactor * 0.12 + (plane.onGround ? 0.1 : 0))
        : 0;
      rig.splash.scale.set(1.0 + beamOpacity * 2.6, 1.0 + beamOpacity * 3.2, 1);
      rig.splash.visible = rig.splash.material.opacity > 0.01;
    }
  }

  const cockpitGlow = jet.userData.cockpitGlow;
  if (cockpitGlow) {
    const cockpitLevel = 0.14 + nightFactor * 1.15;
    cockpitGlow.panelMat.emissiveIntensity = cockpitLevel * 1.05;
    cockpitGlow.hudGlass.material.emissiveIntensity = 0.2 + cockpitLevel * 2.2;
    cockpitGlow.hudGlass.material.opacity = 0.12 + cockpitLevel * 0.36;
    cockpitGlow.canopyMat.emissive = cockpitGlow.canopyMat.emissive || new THREE.Color(0x000000);
    cockpitGlow.canopyMat.emissive.setRGB(0.03 * cockpitLevel, 0.09 * cockpitLevel, 0.12 * cockpitLevel);
    cockpitGlow.canopyMat.emissiveIntensity = cockpitLevel * 0.55;
    cockpitGlow.visorMat.emissive = cockpitGlow.visorMat.emissive || new THREE.Color(0x000000);
    cockpitGlow.visorMat.emissive.setRGB(0.03 * cockpitLevel, 0.07 * cockpitLevel, 0.1 * cockpitLevel);
    cockpitGlow.visorMat.emissiveIntensity = cockpitLevel * 0.7;
    cockpitGlow.parts.forEach((part, idx) => {
      if (!part.material) return;
      part.material.opacity = 0.08 + cockpitLevel * (idx === 0 ? 0.22 : 0.95);
    });
  }

  const airframeFill = Math.max(0, Math.min(1.4, scene.userData.__airframeFill != null ? scene.userData.__airframeFill : 0.55));
  const airframeFillActive = airframeFill > 0.01 && (running || replay.playing || nightFactor > 0.1);
  airframeFillRig.spot.visible = airframeFillActive;
  airframeFillRig.fill.visible = airframeFillActive;
  if (airframeFillActive) {
    const camForward = _visCamFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const camUp = _visCamUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const camRight = _visCamRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    airframeFillRig.spot.position.copy(camera.position)
      .addScaledVector(camForward, 6.5)
      .addScaledVector(camUp, 1.6)
      .addScaledVector(camRight, 0.8);
    airframeFillRig.fill.position.copy(plane.pos)
      .addScaledVector(camUp, 1.8)
      .addScaledVector(camRight, -1.2);
    airframeFillRig.target.position.copy(plane.pos)
      .addScaledVector(camUp, 0.7);
    airframeFillRig.target.updateMatrixWorld();
    airframeFillRig.spot.intensity = airframeFill * (0.12 + nightFactor * 1.15 + (replay.playing ? 0.24 : 0));
    airframeFillRig.fill.intensity = airframeFill * (0.05 + nightFactor * 0.45 + (replay.playing ? 0.08 : 0));
  }

  const heroEnabled = scene.userData.__replayHeroLight !== false;
  const heroActive = replay.playing || (heroEnabled && nightFactor > 0.45);
  replayHeroRig.spot.visible = heroActive;
  replayHeroRig.fill.visible = heroActive;
  if (heroActive) {
    const heroForward = _visHeroFwd.set(0, 0, -1).applyQuaternion(plane.quat);
    const heroUp = _visHeroUp.set(0, 1, 0).applyQuaternion(plane.quat);
    const heroRight = _visHeroRight.set(1, 0, 0).applyQuaternion(plane.quat);
    replayHeroRig.spot.position.copy(plane.pos)
      .addScaledVector(heroUp, replay.playing ? 7.2 : 4.8)
      .addScaledVector(heroRight, replay.playing ? 5.8 : 2.5)
      .addScaledVector(heroForward, replay.playing ? -3.0 : 1.0);
    replayHeroRig.fill.position.copy(plane.pos)
      .addScaledVector(heroUp, 2.8)
      .addScaledVector(heroRight, -2.2);
    replayHeroRig.target.position.copy(plane.pos)
      .addScaledVector(heroForward, -2.8)
      .addScaledVector(heroUp, 0.9);
    replayHeroRig.target.updateMatrixWorld();
    replayHeroRig.spot.intensity = (replay.playing ? 1.9 : 0.25) + nightFactor * 0.85;
    replayHeroRig.fill.intensity = (replay.playing ? 0.6 : 0.15) + nightFactor * 0.35;
  }
}

// =============================================================
//  CAMERA — chase that stays locked behind the plane
// =============================================================
const camLocalOffset = new THREE.Vector3(0, 2.35, 12.8);

// =============================================================
//  FLIGHT RECORDER / REPLAY
//  Ring buffer of recent flight states. When the plane crashes, the
//  user can replay the last ~30 seconds from multiple camera angles.
//  Recording stops during replay so the user doesn't erase what they
//  wanted to watch.
// =============================================================
const REPLAY_FPS = 60;
const REPLAY_SECONDS = 30;
const REPLAY_MAX = REPLAY_FPS * REPLAY_SECONDS;
const REVIEW_REPLAY_LEAD_MS = 7000;
const REVIEW_IMPACT_SLOWMO_MS = 2000;
const REVIEW_IMPACT_SLOWMO_RATE = 0.45;
const replay = {
  buffer: [],       // {pos:Vector3, quat:Quaternion, throttle, t} ring entries
  head: 0,          // next write index
  size: 0,          // number of valid entries (≤ REPLAY_MAX)
  startT: 0,        // perf.now() of first recorded sample in buffer
  eventT: 0,        // crash / landing event timestamp anchoring review lead-in
  playing: false,
  playIdx: 0,       // current frame being replayed (absolute into logical timeline)
  startIdx: 0,      // selected lead-in frame for the current review segment
  eventFrameIdx: 0, // event frame inside the review segment
  playT: 0,         // accumulated time since play started
  mode: 'movie',    // 'chase' | 'cockpit' | 'wingL' | 'wingR' | 'movie'
  movieAnchors: [], // {pos, lookAt, t0, t1}
  eventAnchor: null,
  ui: null,
};
const FLIGHT_LEARNING_KEY = 'flight_learning_patterns_v1';
const FLIGHT_LEARNING_MAX = 900;
const flightLearningState = {
  samples: (() => {
    try {
      const saved = JSON.parse(localStorage.getItem(FLIGHT_LEARNING_KEY) || '[]');
      return Array.isArray(saved) ? saved.slice(-FLIGHT_LEARNING_MAX) : [];
    } catch { return []; }
  })(),
  lastSampleAt: 0,
  lastPersistAt: 0,
  profile: null,
};
function persistFlightLearning(force = false) {
  const now = performance.now();
  // Stringify of up to 900 samples + synchronous localStorage write is a 2-10 ms
  // main-thread stall — do it rarely and off the frame path (idle callback),
  // with a pagehide flush below so nothing is lost on exit.
  if (!force && now - (flightLearningState.lastPersistAt || 0) < 30000) return;
  flightLearningState.lastPersistAt = now;
  const write = () => {
    try { localStorage.setItem(FLIGHT_LEARNING_KEY, JSON.stringify(flightLearningState.samples.slice(-FLIGHT_LEARNING_MAX))); } catch {}
  };
  if (!force && typeof requestIdleCallback === 'function') requestIdleCallback(write, { timeout: 4000 });
  else write();
}
window.addEventListener('pagehide', () => persistFlightLearning(true));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persistFlightLearning(true); });
function recordFlightLearningSample(slot) {
  if (!slot || replay.playing || plane.crashed) return;
  const now = slot.t || performance.now();
  if (now - (flightLearningState.lastSampleAt || 0) < 240) return;
  flightLearningState.lastSampleAt = now;
  flightLearningState.samples.push({
    x: Math.round(slot.pos.x * 10) / 10,
    y: Math.round(slot.pos.y * 10) / 10,
    z: Math.round(slot.pos.z * 10) / 10,
    vx: Math.round(plane.vel.x * 10) / 10,
    vy: Math.round(plane.vel.y * 10) / 10,
    vz: Math.round(plane.vel.z * 10) / 10,
    throttle: Math.round((plane.throttle || 0) * 100) / 100,
    t: Math.round(now),
  });
  while (flightLearningState.samples.length > FLIGHT_LEARNING_MAX) flightLearningState.samples.shift();
  flightLearningState.profile = null;
  persistFlightLearning(false);
}
function getFlightLearningProfile() {
  if (flightLearningState.profile) return flightLearningState.profile;
  const samples = flightLearningState.samples;
  if (samples.length < 8) return { aggression: 0.45, avgSpeed: 70, climbBias: 0, count: samples.length };
  let speedSum = 0, climbSum = 0, turnSum = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    const speed = Math.hypot(b.vx || 0, b.vy || 0, b.vz || 0);
    speedSum += speed;
    climbSum += b.vy || 0;
    const ax = b.x - a.x, az = b.z - a.z;
    const px = a.vx || ax, pz = a.vz || az;
    const al = Math.hypot(ax, az), pl = Math.hypot(px, pz);
    if (al > 0.1 && pl > 0.1) turnSum += Math.abs((px / pl) * (az / al) - (pz / pl) * (ax / al));
  }
  const n = Math.max(1, samples.length - 1);
  const avgSpeed = speedSum / n;
  const aggression = clamp01((avgSpeed - 36) / 145 + (turnSum / n) * 0.65 + Math.abs(climbSum / n) / 60);
  flightLearningState.profile = { aggression, avgSpeed, climbBias: climbSum / n, count: samples.length };
  return flightLearningState.profile;
}
function learnedFlightOffsetForTraffic(t, nowMs = performance.now()) {
  const samples = flightLearningState.samples;
  if (!t || samples.length < 16) return null;
  if (t.learnAngle == null) {
    let hash = 0;
    const label = String(t.callsign || t.file || Math.random());
    for (let i = 0; i < label.length; i++) hash = (hash * 33 + label.charCodeAt(i)) >>> 0;
    t.learnAngle = ((hash % 360) / 180) * Math.PI;
    t.learnReverse = (hash & 1) ? -1 : 1;
    t.learnLift = 34 + (hash % 47);
    t.learnStride = 0.55 + ((hash >> 4) % 70) / 100;
  }
  const idx = Math.floor((nowMs * 0.0035 * t.learnStride + (t.phase || 0) * 0.045)) % samples.length;
  const baseIdx = Math.max(0, (idx - 18 + samples.length) % samples.length);
  const a = samples[baseIdx], b = samples[idx];
  if (!a || !b) return null;
  const dx = (b.x - a.x) * t.learnReverse;
  const dz = (b.z - a.z) * t.learnReverse;
  const dy = (b.y - a.y) * 0.42 + t.learnLift;
  const ca = Math.cos(t.learnAngle), sa = Math.sin(t.learnAngle);
  const rx = dx * ca - dz * sa;
  const rz = dx * sa + dz * ca;
  const scale = 0.18;
  return _learnedOffsetScratch.set(
    Math.max(-155, Math.min(155, rx * scale)),
    Math.max(-54, Math.min(92, dy * scale)),
    Math.max(-155, Math.min(155, rz * scale))
  );
}
// Shared scratch for the per-UFO-per-frame learned offset (consumed immediately)
const _learnedOffsetScratch = new THREE.Vector3();
function applyLearnedFlightPatternToUfo(t, pos, dt) {
  const offset = learnedFlightOffsetForTraffic(t);
  if (!offset) return;
  const profile = getFlightLearningProfile();
  const targetBlend = clamp01(0.18 + profile.aggression * 0.34);
  t.learnBlend = (t.learnBlend || 0) + (targetBlend - (t.learnBlend || 0)) * Math.min(1, dt * 0.8);
  pos.addScaledVector(offset, t.learnBlend || 0);
}
function replayRecord() {
  if (replay.playing || plane.crashed) return;
  let slot;
  if (replay.size < REPLAY_MAX) {
    slot = {
      pos: plane.pos.clone(),
      quat: plane.quat.clone(),
      throttle: plane.throttle,
      t: performance.now(),
    };
    replay.buffer[replay.size++] = slot;
  } else {
    // Ring is full: recycle the slot being overwritten instead of allocating
    // a fresh Vector3 + Quaternion + object 60 times a second forever.
    slot = replay.buffer[replay.head];
    slot.pos.copy(plane.pos);
    slot.quat.copy(plane.quat);
    slot.throttle = plane.throttle;
    slot.t = performance.now();
    replay.head = (replay.head + 1) % REPLAY_MAX;
  }
  recordFlightLearningSample(slot);
}
function replayGetFrames() {
  // Return buffer entries in chronological order.
  if (replay.size < REPLAY_MAX) return replay.buffer.slice(0, replay.size);
  return replay.buffer.slice(replay.head).concat(replay.buffer.slice(0, replay.head));
}
function replayClear() {
  replay.buffer = [];
  replay.head = 0;
  replay.size = 0;
  replay.startIdx = 0;
  replay.eventT = 0;
  replay.eventFrameIdx = 0;
  replay.mode = 'movie';
  replay.eventAnchor = null;
  if (typeof crashFinalMusic !== 'undefined') crashFinalMusic.stop();
}

// Build 4–5 movie-cam anchors spaced along the recorded path so the
// camera cuts between dramatic angles as the plane flies past.
function replayBuildMovieAnchors(fromIdx = 0, eventIdx = null) {
  const frames = replayGetFrames();
  const startIdx = Math.max(0, Math.min(frames.length - 1, fromIdx | 0));
  const activeFrames = frames.slice(startIdx);
  if (activeFrames.length < 2) {
    replay.movieAnchors = [];
    replay.eventAnchor = null;
    return;
  }
  replay.movieAnchors = [];
  const anchors = activeFrames.length < 24
    ? 1
    : Math.min(5, Math.max(3, Math.floor(activeFrames.length / (REPLAY_FPS * 5))));
  for (let i = 0; i < anchors; i++) {
    const localStart = Math.floor((i / anchors) * activeFrames.length);
    const localEnd   = Math.floor(((i + 1) / anchors) * activeFrames.length);
    const localMid = Math.floor((localStart + localEnd) / 2);
    const f = activeFrames[localMid];
    const sideDir = new THREE.Vector3(i % 2 === 0 ? 1 : -1, 0, 0).applyQuaternion(f.quat);
    const upDir = new THREE.Vector3(0, 1, 0).applyQuaternion(f.quat);
    const forwardDir = new THREE.Vector3(0, 0, -1).applyQuaternion(f.quat);
    const pos = f.pos.clone()
      .addScaledVector(sideDir, 26 + i * 6)
      .addScaledVector(upDir, 8 + i * 3)
      .addScaledVector(forwardDir, -18 + ((i % 3) - 1) * 8);
    replay.movieAnchors.push({
      pos,
      lookAt: f.pos.clone().addScaledVector(forwardDir, 5),
      startFrame: startIdx + localStart,
      endFrame: startIdx + localEnd,
    });
  }
  const resolvedEventIdx = Math.max(startIdx, Math.min(frames.length - 1, eventIdx != null ? eventIdx : frames.length - 1));
  const eventFrame = frames[resolvedEventIdx];
  if (eventFrame) {
    const eventForward = new THREE.Vector3(0, 0, -1).applyQuaternion(eventFrame.quat);
    const eventUp = new THREE.Vector3(0, 1, 0).applyQuaternion(eventFrame.quat);
    const eventSide = new THREE.Vector3((resolvedEventIdx % 2 === 0) ? 1 : -1, 0, 0).applyQuaternion(eventFrame.quat);
    const landingEvent = landingCompleteState.active && !plane.crashed;
    const anchorPos = landingEvent
      ? eventFrame.pos.clone()
          .addScaledVector(eventSide, 28)
          .addScaledVector(eventUp, 8)
          .addScaledVector(eventForward, 14)
      : eventFrame.pos.clone()
          .addScaledVector(eventSide, 24)
          .addScaledVector(eventUp, 10)
          .addScaledVector(eventForward, -6);
    const anchorLook = landingEvent
      ? eventFrame.pos.clone().addScaledVector(eventForward, 10).addScaledVector(eventUp, 1.2)
      : eventFrame.pos.clone().addScaledVector(eventForward, 2).addScaledVector(eventUp, 1.0);
    replay.eventAnchor = {
      pos: anchorPos,
      lookAt: anchorLook,
      startFrame: Math.max(startIdx, resolvedEventIdx - Math.max(10, Math.floor(REPLAY_FPS * 1.6))),
      endFrame: Math.min(frames.length - 1, resolvedEventIdx + Math.max(8, Math.floor(REPLAY_FPS * 0.5))),
    };
  } else {
    replay.eventAnchor = null;
  }
}
function replayFindStartFrame(frames, eventT = null) {
  if (!frames || frames.length <= 1) return 0;
  const anchorT = eventT != null
    ? Math.max(frames[0].t, Math.min(eventT, frames[frames.length - 1].t))
    : frames[frames.length - 1].t;
  const targetT = Math.max(frames[0].t, anchorT - REVIEW_REPLAY_LEAD_MS);
  const idx = frames.findIndex(f => f.t >= targetT);
  return idx >= 0 ? idx : 0;
}
function replayFindEventFrame(frames, eventT = null) {
  if (!frames || frames.length === 0) return 0;
  if (eventT == null) return frames.length - 1;
  const anchorT = Math.max(frames[0].t, Math.min(eventT, frames[frames.length - 1].t));
  const idx = frames.findIndex(f => f.t >= anchorT);
  return idx >= 0 ? idx : frames.length - 1;
}

function replayStart() {
  if (replay.size < 1) {
    if (typeof flashStatus === 'function') flashStatus('NOT ENOUGH FLIGHT DATA', 'panel warn', 1.6);
    return;
  }
  const frames = replayGetFrames();
  const eventT = landingCompleteState.active && !plane.crashed
    ? landingCompleteState.touchdownAt
    : (plane.crashed ? (replay.eventT || performance.now()) : performance.now());
  const startIdx = replayFindStartFrame(frames, eventT);
  const eventFrameIdx = replayFindEventFrame(frames, eventT);
  replay.playing = true;
  replay.startIdx = startIdx;
  replay.eventFrameIdx = eventFrameIdx;
  replay.playIdx = startIdx;
  replayBuildMovieAnchors(startIdx, eventFrameIdx);
  replay.mode = replay.movieAnchors.length ? 'movie' : 'chase';
  replay.playT = performance.now();
  replaySyncState(frames, startIdx);
  jet.position.copy(plane.pos);
  jet.quaternion.copy(plane.quat);
  updateCamera(1 / REPLAY_FPS);
  replayApplyCamera(frames, startIdx);
  if (typeof updateReplayHeroLightAfterCamera === 'function') updateReplayHeroLightAfterCamera();
  // Hide the crashBlast so the replay isn't drowned in the explosion sprite
  if (typeof crashBlast !== 'undefined') crashBlast.visible = false;
  syncReplayUI();
}
function replayStop() {
  replay.playing = false;
  replay.startIdx = 0;
  replay.mode = 'movie';
  if (typeof crashFinalMusic !== 'undefined') crashFinalMusic.stop();
  syncReplayUI();
}
// Called from animate() when replay is active, BEFORE updateJetVisual +
// updateCamera. Writes the recorded frame into plane.pos/plane.quat so
// the rest of the pipeline (chase cam, chunks, visual jet position)
// follows naturally — avoiding the fight where live updateCamera
// overwrites the replay camera every frame.
function replaySyncState(frames, idx) {
  const f = frames[Math.min(idx, frames.length - 1)];
  plane.pos.copy(f.pos);
  plane.quat.copy(f.quat);
  plane.vel.set(0, 0, 0);
  plane.angVel.set(0, 0, 0);
  plane.throttle = f.throttle;
}

// Called AFTER updateCamera for non-chase modes, overriding the camera
// to a different viewpoint. Chase mode leaves the live updateCamera
// result alone.
function replayApplyCamera(frames, idx) {
  if (replay.mode === 'chase') return;  // updateCamera already did the right thing
  const f = frames[Math.min(idx, frames.length - 1)];
  const pos = f.pos;
  const q = f.quat;

  if (replay.mode === 'cockpit') {
    const local = new THREE.Vector3(0, 0.55, -1.0).applyQuaternion(q);
    camera.position.copy(pos).add(local);
    camera.up.set(0, 1, 0).applyQuaternion(q);
    const lookFwd = new THREE.Vector3(0, 0, -20).applyQuaternion(q);
    camera.lookAt(pos.clone().add(lookFwd));
  } else if (replay.mode === 'wingL' || replay.mode === 'wingR') {
    const sign = replay.mode === 'wingL' ? -1 : 1;
    const local = new THREE.Vector3(sign * 7.2, 0.9, 4.2).applyQuaternion(q);
    camera.position.copy(pos).add(local);
    camera.up.set(0, 1, 0).applyQuaternion(q);
    const look = new THREE.Vector3(-sign * 1.4, 0.4, -10).applyQuaternion(q);
    camera.lookAt(pos.clone().add(look));
  } else if (replay.mode === 'movie') {
    const eventAnchor = replay.eventAnchor && idx >= replay.eventAnchor.startFrame && idx <= replay.eventAnchor.endFrame
      ? replay.eventAnchor
      : null;
    const anchor = eventAnchor || replay.movieAnchors.find(a => idx >= a.startFrame && idx < a.endFrame)
                || replay.movieAnchors[replay.movieAnchors.length - 1];
    if (anchor) {
      camera.position.copy(anchor.pos);
      camera.up.set(0, 1, 0);
      camera.lookAt(anchor.lookAt || pos);
    }
  }
}
// Phase 1 (before updateJetVisual/updateCamera): sync plane state.
function replayPreStep(dt) {
  const frames = replayGetFrames();
  if (frames.length === 0) { replayStop(); return; }
  const startIdx = Math.max(0, Math.min(frames.length - 1, replay.startIdx || 0));
  if (frames.length === 1 || startIdx >= frames.length - 1) {
    replay.playIdx = startIdx;
    replaySyncState(frames, startIdx);
    return;
  }
  const elapsed = (performance.now() - replay.playT) / 1000;
  const segmentStartT = frames[startIdx].t;
  const totalDur = (frames[frames.length - 1].t - segmentStartT) / 1000;
  if (totalDur <= 0) {
    replay.playIdx = frames.length - 1;
    replaySyncState(frames, replay.playIdx);
    return;
  }
  const slowmoWindow = plane.crashed ? Math.min(totalDur, REVIEW_IMPACT_SLOWMO_MS / 1000) : 0;
  const normalDur = totalDur - slowmoWindow;
  const playbackDur = normalDur + (slowmoWindow > 0 ? slowmoWindow / REVIEW_IMPACT_SLOWMO_RATE : 0);
  const loop = elapsed % (playbackDur + 2.5);
  if (loop >= playbackDur) {
    replay.playIdx = frames.length - 1;
    replaySyncState(frames, replay.playIdx);
    return;
  }
  const sourceElapsed = slowmoWindow > 0 && loop > normalDur
    ? normalDur + (loop - normalDur) * REVIEW_IMPACT_SLOWMO_RATE
    : loop;
  const targetT = segmentStartT + sourceElapsed * 1000;
  let idx = frames.findIndex((f, i) => i >= startIdx && f.t >= targetT);
  if (idx < 0) idx = frames.length - 1;
  replay.playIdx = idx;
  replaySyncState(frames, idx);
  // Cue the crash theme just before the impact frame plays. Crash-only
  // (skip landings); the `triggered` flag ensures it fires once per replay
  // session, so loops don't re-start the song.
  if (replay.playing && plane.crashed && replay.eventFrameIdx > 0
      && typeof crashFinalMusic !== 'undefined' && !crashFinalMusic.triggered) {
    const lead = Math.floor(REPLAY_FPS * 0.5); // ~0.5s before impact
    const triggerIdx = Math.max(replay.startIdx, replay.eventFrameIdx - lead);
    if (idx >= triggerIdx) crashFinalMusic.play();
  }
}
// Phase 2 (after updateCamera): override camera for non-chase modes.
function replayPostStep() {
  const frames = replayGetFrames();
  if (frames.length === 0) return;
  replayApplyCamera(frames, replay.playIdx);
}
function updateReplayHeroLightAfterCamera() {
  if (!replay.playing) return;
  const nightFactor = timeOfDay ? (1 - timeOfDay.daylight) : 0;
  const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  replayHeroRig.spot.visible = true;
  replayHeroRig.fill.visible = true;
  replayHeroRig.spot.position.copy(camera.position)
    .addScaledVector(camUp, 1.6)
    .addScaledVector(camRight, 1.8)
    .addScaledVector(camForward, 6.5);
  replayHeroRig.fill.position.copy(plane.pos)
    .addScaledVector(camUp, 2.1)
    .addScaledVector(camRight, -2.8)
    .addScaledVector(camForward, 1.2);
  replayHeroRig.target.position.copy(plane.pos)
    .addScaledVector(camUp, 0.8);
  replayHeroRig.target.updateMatrixWorld();
  replayHeroRig.spot.distance = 420;
  replayHeroRig.spot.angle = Math.PI / 4.8;
  replayHeroRig.spot.penumbra = 0.72;
  replayHeroRig.spot.intensity = 2.55 + nightFactor * 0.75;
  replayHeroRig.fill.intensity = 0.85 + nightFactor * 0.25;
}
const LOCAL_LEADERBOARD_KEY = 'ships-local-leaderboard-v1';
function readLocalLeaderboard() {
  try {
    const rows = JSON.parse(localStorage.getItem(LOCAL_LEADERBOARD_KEY) || '[]');
    return Array.isArray(rows) ? rows.filter(r => r && Number.isFinite(Number(r.score))).slice(0, 10) : [];
  } catch { return []; }
}
function saveLocalLeaderboardEntry(name, summary) {
  if (!summary) return [];
  const cleanName = String(name || '').trim().toUpperCase().replace(/[^A-Z0-9 _-]/g, '').slice(0, 14) || 'PILOT';
  const rows = readLocalLeaderboard();
  rows.push({
    name: cleanName,
    score: Number(summary.score || 0),
    grade: summary.grade || 'C',
    kills: summary.kills || 0,
    streak: summary.bestStreak || 0,
    reason: summary.reason || '',
    at: new Date().toISOString(),
  });
  rows.sort((a, b) => (b.score || 0) - (a.score || 0) || (b.kills || 0) - (a.kills || 0));
  const top = rows.slice(0, 10);
  try { localStorage.setItem(LOCAL_LEADERBOARD_KEY, JSON.stringify(top)); } catch {}
  return top;
}
function renderLocalLeaderboard(listEl) {
  if (!listEl) return;
  const rows = readLocalLeaderboard();
  listEl.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.textContent = 'NO LOCAL SCORES YET';
    empty.style.cssText = 'opacity:.68;font-size:10px;letter-spacing:.14em;padding:6px 0;';
    listEl.appendChild(empty);
    return;
  }
  rows.slice(0, 5).forEach((row, i) => {
    const line = document.createElement('div');
    line.style.cssText = 'display:grid;grid-template-columns:28px 1fr auto;gap:8px;align-items:center;padding:5px 0;border-top:1px solid rgba(255,215,150,.08);font:800 11px/1.2 var(--game-font-ui);letter-spacing:.08em;';
    line.innerHTML = `<span style="color:#ffdf9d;">#${i + 1}</span><span>${row.name || 'PILOT'} <em style="opacity:.62;font-style:normal;">${row.grade || 'C'} · ${row.kills || 0}K</em></span><strong style="color:#fff4d6;">${row.score || 0}</strong>`;
    listEl.appendChild(line);
  });
}

function syncReplayUI() {
  if (!replay.ui) return;
  const reviewVisible = plane.crashed || landingCompleteState.active;
  document.body.classList.toggle('review-open', !!reviewVisible);
  replay.ui.panel.style.display = reviewVisible ? 'block' : 'none';
  const reviewReason = plane.crashed
    ? (missionDebriefState.reason || 'TERRAIN IMPACT')
    : 'LANDING COMPLETE';
  const summary = reviewVisible
    ? (missionDebriefState.summary || captureMissionDebrief(reviewReason))
    : null;
  replay.ui.modeButtons.forEach(b => {
    const isActive = b.dataset.mode === replay.mode;
    b.style.background = isActive ? 'rgba(255,204,102,0.18)' : 'rgba(255,255,255,0.04)';
    b.style.color = isActive ? '#fff0c8' : '#ffcc66';
    b.style.borderColor = isActive ? 'rgba(255,225,170,0.42)' : 'rgba(255,215,150,0.22)';
  });
  if (replay.ui.modeSummary) replay.ui.modeSummary.textContent = `CAMERA · ${replay.mode.toUpperCase()}`;
  if (replay.ui.modeDetails) replay.ui.modeDetails.open = replay.mode !== 'movie';
  replay.ui.playBtn.textContent = replay.playing ? '■ STOP' : '▶ REPLAY';
  if (replay.ui.resetBtn) replay.ui.resetBtn.textContent = landingCompleteState.active && !plane.crashed ? '↺ NEXT [R]' : '↺ RESET [R]';
  if (replay.ui.subline) replay.ui.subline.textContent = summary
    ? `${summary.reason}`
    : (replay.playing ? `CINEMA · ${replay.mode.toUpperCase()}` : 'cinematic replay');
  if (replay.ui.gradeValue) replay.ui.gradeValue.textContent = summary ? summary.grade : 'C';
  if (replay.ui.gradeLabel) replay.ui.gradeLabel.textContent = 'SORTIE';
  if (replay.ui.summaryGrid) {
    while (replay.ui.summaryGrid.firstChild) replay.ui.summaryGrid.removeChild(replay.ui.summaryGrid.firstChild);
    (summary ? summary.cards.slice(0, 4) : []).forEach(card => {
      const stat = document.createElement('div');
      stat.className = 'review-stat-card';
      const label = document.createElement('span');
      label.textContent = card.label;
      const value = document.createElement('strong');
      value.textContent = card.value;
      const detail = document.createElement('em');
      detail.textContent = card.detail;
      stat.appendChild(label);
      stat.appendChild(value);
      stat.appendChild(detail);
      replay.ui.summaryGrid.appendChild(stat);
    });
  }
  if (replay.ui.awardsWrap) {
    while (replay.ui.awardsWrap.firstChild) replay.ui.awardsWrap.removeChild(replay.ui.awardsWrap.firstChild);
    (summary ? summary.awards.slice(0, 2) : ['REPLAY']).forEach(text => {
      const pill = document.createElement('div');
      pill.className = 'review-award-pill';
      pill.textContent = text;
      replay.ui.awardsWrap.appendChild(pill);
    });
  }
  if (replay.ui.leaderboardList) renderLocalLeaderboard(replay.ui.leaderboardList);
  if (replay.ui.leaderboardScore) replay.ui.leaderboardScore.textContent = summary ? `SUBMIT ${summary.score || 0} PTS` : 'SUBMIT SCORE';
}
function replayBuildUI() {
  const hud = document.getElementById('hud');
  const panel = document.createElement('div');
  panel.className = 'panel game-dialog-chrome review-panel-shell';
  panel.id = 'replay-panel';
  panel.style.cssText = 'right:16px;left:auto;bottom:20px;transform:none;display:none;pointer-events:auto;';

  const title = document.createElement('div');
  title.className = 'review-heading';
  title.textContent = 'REVIEW';
  panel.appendChild(title);

  const subline = document.createElement('div');
  subline.className = 'review-subline';
  subline.textContent = 'cinematic replay';
  panel.appendChild(subline);

  const grade = document.createElement('div');
  grade.className = 'review-grade';
  const gradeValue = document.createElement('strong');
  gradeValue.textContent = 'C';
  const gradeLabel = document.createElement('span');
  gradeLabel.textContent = 'RUN GRADE';
  grade.appendChild(gradeValue);
  grade.appendChild(gradeLabel);
  panel.appendChild(grade);

  const summaryGrid = document.createElement('div');
  summaryGrid.className = 'review-summary-grid';
  panel.appendChild(summaryGrid);

  const awardsWrap = document.createElement('div');
  awardsWrap.className = 'review-awards';
  panel.appendChild(awardsWrap);

  const leaderboardWrap = document.createElement('div');
  leaderboardWrap.style.cssText = 'margin-top:10px;padding:10px;border-radius:14px;border:1px solid rgba(255,215,150,.14);background:rgba(255,255,255,.035);';
  const leaderboardHead = document.createElement('div');
  leaderboardHead.textContent = 'LOCAL LEADERBOARD';
  leaderboardHead.style.cssText = 'font:900 11px/1 var(--game-font-ui);letter-spacing:.18em;color:#fff0c8;margin-bottom:8px;';
  const leaderboardForm = document.createElement('div');
  leaderboardForm.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:6px;margin-bottom:8px;';
  const leaderboardInput = document.createElement('input');
  leaderboardInput.type = 'text';
  leaderboardInput.maxLength = 14;
  leaderboardInput.placeholder = 'YOUR NAME';
  leaderboardInput.style.cssText = 'min-width:0;border:1px solid rgba(255,215,150,.24);border-radius:10px;background:rgba(0,0,0,.24);color:#fff4d6;padding:8px 9px;font:800 11px var(--game-font-ui);letter-spacing:.12em;text-transform:uppercase;';
  try { leaderboardInput.value = localStorage.getItem('ships-last-leaderboard-name') || ''; } catch {}
  const leaderboardBtn = document.createElement('button');
  leaderboardBtn.type = 'button';
  leaderboardBtn.textContent = 'SAVE';
  const leaderboardScore = document.createElement('div');
  leaderboardScore.textContent = 'SUBMIT SCORE';
  leaderboardScore.style.cssText = 'font:800 10px var(--game-font-ui);letter-spacing:.14em;color:#ffdf9d;margin-bottom:6px;';
  const leaderboardList = document.createElement('div');
  leaderboardForm.append(leaderboardInput, leaderboardBtn);
  leaderboardWrap.append(leaderboardHead, leaderboardScore, leaderboardForm, leaderboardList);
  leaderboardBtn.addEventListener('click', () => {
    const summary = missionDebriefState.summary || captureMissionDebrief(plane.crashed ? (missionDebriefState.reason || 'TERRAIN IMPACT') : 'LANDING COMPLETE');
    saveLocalLeaderboardEntry(leaderboardInput.value, summary);
    try { localStorage.setItem('ships-last-leaderboard-name', leaderboardInput.value || 'PILOT'); } catch {}
    renderLocalLeaderboard(leaderboardList);
    if (typeof flashStatus === 'function') flashStatus('LEADERBOARD SAVED', 'panel ok', 1.0);
  });
  panel.appendChild(leaderboardWrap);

  const playRow = document.createElement('div');
  playRow.className = 'review-actions';
  panel.appendChild(playRow);

  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.textContent = '▶ REPLAY';
  playBtn.addEventListener('click', () => {
    if (replay.playing) replayStop();
    else replayStart();
  });
  playRow.appendChild(playBtn);

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.textContent = '↺ FLY AGAIN [R]';
  resetBtn.addEventListener('click', () => { if (typeof resetPlane === 'function') resetPlane(); });
  playRow.appendChild(resetBtn);

  const modeDetails = document.createElement('details');
  modeDetails.className = 'review-modes-shell';
  modeDetails.style.cssText = 'margin-top:10px;border:1px solid rgba(255,215,150,0.12);border-radius:12px;background:rgba(255,255,255,0.03);overflow:hidden;';
  const modeSummary = document.createElement('summary');
  modeSummary.textContent = 'CAMERA · MOVIE';
  modeSummary.style.cssText = 'cursor:pointer;padding:8px 10px;font-size:10px;letter-spacing:0.14em;color:#ffdf9d;background:rgba(255,255,255,0.025);';
  modeDetails.appendChild(modeSummary);
  const modeWrap = document.createElement('div');
  modeWrap.className = 'review-modes';
  modeWrap.style.cssText = 'margin-top:0;padding:8px 10px 10px;';
  const modes = [
    { k: 'chase',    label: 'CHASE' },
    { k: 'cockpit',  label: 'COCKPIT' },
    { k: 'wingL',    label: 'WING L' },
    { k: 'wingR',    label: 'WING R' },
    { k: 'movie',    label: 'MOVIE' },
  ];
  const modeButtons = [];
  modes.forEach(m => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.mode = m.k;
    b.textContent = m.label;
    b.addEventListener('click', () => { replay.mode = m.k; syncReplayUI(); });
    modeWrap.appendChild(b);
    modeButtons.push(b);
  });
  modeDetails.appendChild(modeWrap);
  panel.appendChild(modeDetails);
  hud.appendChild(panel);
  replay.ui = { panel, playBtn, resetBtn, modeButtons, modeDetails, modeSummary, subline, gradeValue, gradeLabel, summaryGrid, awardsWrap, leaderboardInput, leaderboardBtn, leaderboardScore, leaderboardList };
}
replayBuildUI();
bootLog.step('flight replay', true, `buffer ${REPLAY_MAX} frames (${REPLAY_SECONDS}s @ ${REPLAY_FPS}fps)`);

// Mouse-flight reticle state. The chase camera stays fixed behind the plane;
// mouse movement drives a virtual pipper on screen and the aircraft follows it.
// Right-click orbit is deliberately removed.
const camOrbit = { yaw: 0, pitch: 0 };
const INPUT_FLAGS = Object.freeze({
  mouseFlight: false,
  gamepad: true,
});
const gamepadState = {
  connected: false,
  index: -1,
  padCount: 0,
  id: '',
  mapping: '',
  pitch: 0,
  roll: 0,
  yaw: 0,
  throttleUp: 0,
  throttleDown: 0,
  fire: false,
  brake: false,
  gear: false,
  missile: false,
  lights: false,
  model: false,
  race: false,
  reset: false,
  source: 'none',
  profile: 'standard',
  lastInputAt: 0,
  axesRaw: [],
  buttonsRaw: [],
};
const virtualGamepadInput = {
  enabled: false,
  index: 0,
  id: 'Virtual Controller',
  mapping: 'standard',
  axes: [0, 0, 0, 0],
  buttons: [],
};
const gamepadAxisNeutral = new Map();

function gamepadAxisValue(value, deadzone = 0.16) {
  const v = Number(value) || 0;
  if (Math.abs(v) <= deadzone) return 0;
  const scaled = (Math.abs(v) - deadzone) / Math.max(0.001, 1 - deadzone);
  return Math.sign(v) * Math.max(0, Math.min(1, scaled));
}
function gamepadClamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}
function gamepadButtonValue(pad, index) {
  const button = pad && pad.buttons ? pad.buttons[index] : null;
  if (!button) return 0;
  return gamepadClamp01(Math.max(Number(button.value) || 0, button.pressed ? 1 : 0));
}
function gamepadButtonPressed(pad, index, threshold = 0.45) {
  return gamepadButtonValue(pad, index) >= threshold;
}
function gamepadRawAxis(pad, index) {
  const value = pad && pad.axes ? Number(pad.axes[index]) : NaN;
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}
function gamepadTriggerAxisValue(pad, axisIndex) {
  if (!pad || !pad.axes || axisIndex == null || axisIndex >= pad.axes.length) return 0;
  const raw = gamepadRawAxis(pad, axisIndex);
  const key = `${pad.index}:${axisIndex}`;
  if (!gamepadAxisNeutral.has(key)) gamepadAxisNeutral.set(key, raw);
  const neutral = gamepadAxisNeutral.get(key);
  let value = raw;
  if (neutral < -0.35) value = (raw - neutral) / Math.max(0.001, 1 - neutral);
  else if (neutral > 0.35) value = (neutral - raw) / Math.max(0.001, neutral + 1);
  return gamepadClamp01(value);
}
function makeVirtualGamepadButton(value) {
  const v = gamepadClamp01(value);
  return { pressed: v >= 0.45, touched: v > 0.02, value: v };
}
function virtualGamepadPad() {
  return {
    index: virtualGamepadInput.index,
    id: virtualGamepadInput.id,
    mapping: virtualGamepadInput.mapping,
    axes: virtualGamepadInput.axes.slice(),
    buttons: virtualGamepadInput.buttons.map(makeVirtualGamepadButton),
    timestamp: performance.now(),
  };
}
function setVirtualGamepadInput(state = {}) {
  virtualGamepadInput.enabled = state.enabled !== false;
  if (state.id) virtualGamepadInput.id = String(state.id);
  if (state.mapping != null) virtualGamepadInput.mapping = String(state.mapping);
  if (Array.isArray(state.axes)) virtualGamepadInput.axes = state.axes.map(v => Math.max(-1, Math.min(1, Number(v) || 0)));
  if (Array.isArray(state.buttons)) virtualGamepadInput.buttons = state.buttons.map(gamepadClamp01);
  return pollGamepadInput();
}
function clearVirtualGamepadInput() {
  virtualGamepadInput.enabled = false;
  virtualGamepadInput.axes = [0, 0, 0, 0];
  virtualGamepadInput.buttons = [];
  resetGamepadState();
  syncInputIndicator();
  return gamepadState;
}
window.__setVirtualGamepad = setVirtualGamepadInput;
window.__clearVirtualGamepad = clearVirtualGamepadInput;

function resetGamepadState() {
  gamepadState.connected = false;
  gamepadState.index = -1;
  gamepadState.padCount = 0;
  gamepadState.id = '';
  gamepadState.mapping = '';
  gamepadState.pitch = 0;
  gamepadState.roll = 0;
  gamepadState.yaw = 0;
  gamepadState.throttleUp = 0;
  gamepadState.throttleDown = 0;
  gamepadState.fire = false;
  gamepadState.brake = false;
  gamepadState.gear = false;
  gamepadState.missile = false;
  gamepadState.lights = false;
  gamepadState.model = false;
  gamepadState.race = false;
  gamepadState.reset = false;
  gamepadState.source = 'none';
  gamepadState.profile = 'standard';
  gamepadState.lastInputAt = 0;
  gamepadState.axesRaw = [];
  gamepadState.buttonsRaw = [];
}

function syncInputIndicator() {
  const inputInd = document.getElementById('input-ind');
  const ch1 = document.getElementById('ch-line1');
  const ch2 = document.getElementById('ch-line2');
  if (inputInd) {
    if (gamepadState.connected) {
      const touchInputActive = gamepadState.source === 'virtual' && /touch/i.test(gamepadState.id || '');
      const label = touchInputActive
        ? 'TOUCH'
        : (/xbox/i.test(gamepadState.id)
          ? 'XBOX PAD'
          : (/playstation|dualsense|dualshock|wireless controller/i.test(gamepadState.id) ? 'PS PAD' : 'PAD'));
      inputInd.textContent = label;
      inputInd.className = 'hud-chip ok';
    } else {
      inputInd.textContent = 'KBD';
      inputInd.className = 'hud-chip';
    }
  }
  if (gamepadState.connected) {
    const touchInputActive = gamepadState.source === 'virtual' && /touch/i.test(gamepadState.id || '');
    if (touchInputActive) {
      if (ch1) ch1.textContent = 'TOUCH STICK PITCH/BANK · RIGHT THROTTLE SLIDER';
      if (ch2) ch2.textContent = (plane.fixedGear && !plane.glbGear)
        ? 'FIRE · MSL · BRAKE · RESET · C TARGET ON KEYBOARD'
        : 'FIRE · MSL · BRAKE · GEAR · RESET · C TARGET ON KEYBOARD';
    } else {
      if (ch1) ch1.textContent = 'PAD LS PITCH/BANK · RS/LB/RB YAW · A FIRE · Y MSL';
      if (ch2) ch2.textContent = (plane.fixedGear && !plane.glbGear)
        ? 'C KEY TARGET · RT/LT THROTTLE · B BRAKE · DPAD-L LIGHTS · BACK RACE · START RESET'
        : 'C KEY TARGET · RT/LT THROTTLE · B BRAKE · X GEAR · DPAD-L LIGHTS · BACK RACE · START RESET';
    }
  } else {
    if (ch1) ch1.textContent = 'W/S PITCH · A/D BANK · Q/E RUDDER';
    if (ch2) ch2.textContent = (plane.fixedGear && !plane.glbGear)
      ? 'SHIFT/CTRL THROTTLE · SPACE GUNS · C TARGET · X MSL · M MODEL · F FULLSCREEN · R RESET'
      : 'SHIFT/CTRL THROTTLE · SPACE GUNS · C TARGET · X MSL · G GEAR · M MODEL · F FULLSCREEN · R RESET';
  }
}

const touchControlsState = {
  enabled: false,
  supported: false,
  stickPointerId: null,
  throttlePointerId: null,
  stickX: 0,
  stickY: 0,
  throttle: 0,
  lastInputAt: 0,
  buttons: { fire: false, missile: false, brake: false, gear: false, reset: false },
  buttonPulseUntil: { missile: 0, gear: 0, reset: 0 },
  buttonPointerMap: new Map(),
};

function getTouchControlElements() {
  return {
    root: document.getElementById('touch-controls'),
    stick: document.getElementById('touch-stick'),
    stickKnob: document.getElementById('touch-stick-knob'),
    throttle: document.getElementById('touch-throttle'),
    throttleFill: document.getElementById('touch-throttle-fill'),
    throttleKnob: document.getElementById('touch-throttle-knob'),
    throttleReadout: document.getElementById('touch-throttle-readout'),
    buttons: Array.from(document.querySelectorAll('[data-touch-button]')),
  };
}

function isTouchControlsLikelyUseful() {
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return coarse || window.innerWidth <= 920;
}

function touchButtonActive(name, now = performance.now()) {
  return !!touchControlsState.buttons[name] || ((touchControlsState.buttonPulseUntil[name] || 0) > now);
}

function syncTouchButtonClasses() {
  const now = performance.now();
  for (const btn of getTouchControlElements().buttons) {
    const name = btn.dataset.touchButton;
    btn.classList.toggle('is-active', touchButtonActive(name, now));
  }
  const els = getTouchControlElements();
  if (els.stick) els.stick.classList.toggle('is-active', touchControlsState.stickPointerId != null || Math.hypot(touchControlsState.stickX, touchControlsState.stickY) > 0.03);
  if (els.throttle) els.throttle.classList.toggle('is-active', touchControlsState.throttlePointerId != null);
}

function syncTouchThrottleVisual() {
  const els = getTouchControlElements();
  const pct = Math.round(Math.max(0, Math.min(1, touchControlsState.throttle)) * 100);
  if (els.throttleFill) els.throttleFill.style.height = `${pct}%`;
  if (els.throttleKnob) els.throttleKnob.style.bottom = `${pct}%`;
  if (els.throttleReadout) els.throttleReadout.textContent = `${pct}%`;
  if (els.throttle) els.throttle.setAttribute('aria-valuenow', String(pct));
}

function syncTouchStickVisual() {
  const els = getTouchControlElements();
  if (!els.stickKnob) return;
  els.stickKnob.style.left = `${50 + touchControlsState.stickX * 31}%`;
  els.stickKnob.style.top = `${50 + touchControlsState.stickY * 31}%`;
  syncTouchButtonClasses();
}

function syncTouchVirtualGamepad() {
  const now = performance.now();
  const enabled = !!touchControlsState.enabled;
  if (!enabled) return;
  const buttons = new Array(16).fill(0);
  buttons[0] = touchButtonActive('fire', now) ? 1 : 0;
  buttons[1] = touchButtonActive('brake', now) ? 1 : 0;
  buttons[2] = touchButtonActive('gear', now) ? 1 : 0;
  buttons[3] = touchButtonActive('missile', now) ? 1 : 0;
  buttons[9] = touchButtonActive('reset', now) ? 1 : 0;
  virtualGamepadInput.enabled = true;
  virtualGamepadInput.id = 'Touch Controls';
  virtualGamepadInput.mapping = 'standard';
  virtualGamepadInput.axes = [touchControlsState.stickX, touchControlsState.stickY, 0, 0];
  virtualGamepadInput.buttons = buttons;
  if (Math.hypot(touchControlsState.stickX, touchControlsState.stickY) > 0.02 || buttons.some(Boolean)) {
    touchControlsState.lastInputAt = now;
  }
}

function clearTouchControlsInput({ keepThrottle = true } = {}) {
  touchControlsState.stickPointerId = null;
  touchControlsState.throttlePointerId = null;
  touchControlsState.stickX = 0;
  touchControlsState.stickY = 0;
  for (const name of Object.keys(touchControlsState.buttons)) touchControlsState.buttons[name] = false;
  touchControlsState.buttonPointerMap.clear();
  if (!keepThrottle) touchControlsState.throttle = Math.max(0, Math.min(1, plane.throttleTarget || 0));
  syncTouchStickVisual();
  syncTouchThrottleVisual();
  syncTouchVirtualGamepad();
}

function syncTouchThrottleFromPlane() {
  if (!Number.isFinite(plane.throttleTarget)) return;
  touchControlsState.throttle = Math.max(0, Math.min(1, plane.throttleTarget));
  syncTouchThrottleVisual();
  syncTouchVirtualGamepad();
}

function getTouchThrottleInput() {
  if (!touchControlsState.enabled) return { up: 0, down: 0 };
  const delta = touchControlsState.throttle - plane.throttleTarget;
  if (Math.abs(delta) < 0.012) return { up: 0, down: 0 };
  const shaped = Math.min(1, Math.max(0.18, Math.abs(delta) * 3.4));
  return delta > 0 ? { up: shaped, down: 0 } : { up: 0, down: shaped };
}

function markTouchControlsActive(e) {
  touchControlsState.enabled = true;
  touchControlsState.supported = true;
  touchControlsState.lastInputAt = performance.now();
  if (typeof setAudioEnabled === 'function') {
    try {
      setAudioEnabled(true);
      if (typeof syncAudioIndicator === 'function') syncAudioIndicator();
    } catch {}
  }
  if (renderer && renderer.domElement && typeof renderer.domElement.focus === 'function') {
    try { renderer.domElement.focus(); } catch {}
  }
  if (e && typeof e.preventDefault === 'function') e.preventDefault();
}

function setTouchStickFromPointer(e) {
  const els = getTouchControlElements();
  if (!els.stick) return;
  const rect = els.stick.getBoundingClientRect();
  const cx = rect.left + rect.width * 0.5;
  const cy = rect.top + rect.height * 0.5;
  const radius = Math.max(24, Math.min(rect.width, rect.height) * 0.42);
  let x = (e.clientX - cx) / radius;
  let y = (e.clientY - cy) / radius;
  const mag = Math.hypot(x, y);
  if (mag > 1) { x /= mag; y /= mag; }
  touchControlsState.stickX = Math.max(-1, Math.min(1, x));
  touchControlsState.stickY = Math.max(-1, Math.min(1, y));
  syncTouchStickVisual();
  syncTouchVirtualGamepad();
}

function setTouchThrottleFromPointer(e) {
  const els = getTouchControlElements();
  if (!els.throttle) return;
  const track = els.throttle.querySelector('.touch-throttle-track') || els.throttle;
  const rect = track.getBoundingClientRect();
  const value = 1 - ((e.clientY - rect.top) / Math.max(1, rect.height));
  touchControlsState.throttle = Math.max(0, Math.min(1, value));
  syncTouchThrottleVisual();
  syncTouchVirtualGamepad();
}

function setTouchButton(name, down) {
  if (!Object.prototype.hasOwnProperty.call(touchControlsState.buttons, name)) return;
  touchControlsState.buttons[name] = !!down;
  if (down && (name === 'missile' || name === 'gear' || name === 'reset')) {
    touchControlsState.buttonPulseUntil[name] = performance.now() + 180;
  }
  syncTouchButtonClasses();
  syncTouchVirtualGamepad();
}

function configureTouchControlsAvailability() {
  const els = getTouchControlElements();
  if (!els.root) return false;
  const useful = isTouchControlsLikelyUseful();
  touchControlsState.supported = useful;
  if (useful && !touchControlsState.enabled) {
    touchControlsState.enabled = true;
    syncTouchThrottleFromPlane();
  }
  if (!useful && touchControlsState.stickPointerId == null && touchControlsState.throttlePointerId == null && touchControlsState.buttonPointerMap.size === 0) {
    touchControlsState.enabled = false;
    if (virtualGamepadInput.id === 'Touch Controls') clearVirtualGamepadInput();
  }
  return useful;
}

function initTouchControls() {
  const els = getTouchControlElements();
  if (!els.root || !els.stick || !els.throttle) return;
  syncTouchThrottleFromPlane();

  els.stick.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    markTouchControlsActive(e);
    touchControlsState.stickPointerId = e.pointerId;
    try { els.stick.setPointerCapture(e.pointerId); } catch {}
    setTouchStickFromPointer(e);
  });
  els.stick.addEventListener('pointermove', (e) => {
    if (touchControlsState.stickPointerId !== e.pointerId) return;
    markTouchControlsActive(e);
    setTouchStickFromPointer(e);
  });
  const releaseStick = (e) => {
    if (touchControlsState.stickPointerId !== e.pointerId) return;
    touchControlsState.stickPointerId = null;
    touchControlsState.stickX = 0;
    touchControlsState.stickY = 0;
    syncTouchStickVisual();
    syncTouchVirtualGamepad();
  };
  els.stick.addEventListener('pointerup', releaseStick);
  els.stick.addEventListener('pointercancel', releaseStick);

  els.throttle.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    markTouchControlsActive(e);
    touchControlsState.throttlePointerId = e.pointerId;
    try { els.throttle.setPointerCapture(e.pointerId); } catch {}
    setTouchThrottleFromPointer(e);
  });
  els.throttle.addEventListener('pointermove', (e) => {
    if (touchControlsState.throttlePointerId !== e.pointerId) return;
    markTouchControlsActive(e);
    setTouchThrottleFromPointer(e);
  });
  const releaseThrottle = (e) => {
    if (touchControlsState.throttlePointerId !== e.pointerId) return;
    touchControlsState.throttlePointerId = null;
    syncTouchButtonClasses();
    syncTouchVirtualGamepad();
  };
  els.throttle.addEventListener('pointerup', releaseThrottle);
  els.throttle.addEventListener('pointercancel', releaseThrottle);

  for (const btn of els.buttons) {
    const name = btn.dataset.touchButton;
    btn.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      markTouchControlsActive(e);
      touchControlsState.buttonPointerMap.set(e.pointerId, name);
      try { btn.setPointerCapture(e.pointerId); } catch {}
      setTouchButton(name, true);
    });
  }
  const releaseButtonPointer = (e) => {
    const name = touchControlsState.buttonPointerMap.get(e.pointerId);
    if (!name) return;
    touchControlsState.buttonPointerMap.delete(e.pointerId);
    setTouchButton(name, false);
  };
  window.addEventListener('pointerup', releaseButtonPointer, true);
  window.addEventListener('pointercancel', releaseButtonPointer, true);
  window.addEventListener('resize', configureTouchControlsAvailability);
  window.addEventListener('orientationchange', configureTouchControlsAvailability);
  window.addEventListener('blur', () => clearTouchControlsInput({ keepThrottle: true }));
  configureTouchControlsAvailability();
}

initTouchControls();
window.__touchControls = touchControlsState;
window.__syncTouchControls = syncTouchVirtualGamepad;

function pollGamepadInput() {
  if (typeof syncTouchVirtualGamepad === 'function') syncTouchVirtualGamepad();
  if (!INPUT_FLAGS.gamepad || (!virtualGamepadInput.enabled && typeof navigator.getGamepads !== 'function')) {
    resetGamepadState();
    combatState.fireHeld = combatState.mouseFireHeld;
    syncInputIndicator();
    return gamepadState;
  }
  const pads = virtualGamepadInput.enabled
    ? [virtualGamepadPad()]
    : Array.from(navigator.getGamepads() || []).filter(Boolean);
  gamepadState.padCount = pads.length;
  let pad = null;
  if (gamepadState.index >= 0) {
    pad = pads.find(p => p && p.index === gamepadState.index) || null;
  }
  if (!pad) pad = pads.find(p => p && p.mapping === 'standard') || pads[0] || null;
  if (!pad) {
    resetGamepadState();
    combatState.fireHeld = combatState.mouseFireHeld;
    syncInputIndicator();
    return gamepadState;
  }

  gamepadState.connected = true;
  gamepadState.index = pad.index;
  gamepadState.id = pad.id || `Gamepad ${pad.index}`;
  gamepadState.mapping = pad.mapping || '';
  gamepadState.source = virtualGamepadInput.enabled ? 'virtual' : 'native';
  gamepadState.profile = gamepadState.mapping === 'standard' ? 'standard' : 'generic';
  gamepadState.axesRaw = Array.from(pad.axes || []).map(v => Number(v || 0));
  gamepadState.buttonsRaw = Array.from(pad.buttons || []).map(b => Number((b?.value ?? 0) || 0));

  const lx = gamepadAxisValue(pad.axes[0] || 0);
  const ly = gamepadAxisValue(pad.axes[1] || 0);
  const rx = gamepadRawAxis(pad, 2);
  const hatX = gamepadAxisValue(gamepadRawAxis(pad, 6), 0.45);
  const hatY = gamepadAxisValue(gamepadRawAxis(pad, 7), 0.45);
  const dpadLeft = gamepadButtonPressed(pad, 14) || hatX < -0.5;
  const dpadRight = gamepadButtonPressed(pad, 15) || hatX > 0.5;
  const dpadUp = gamepadButtonPressed(pad, 12) || hatY < -0.5;
  const dpadDown = gamepadButtonPressed(pad, 13) || hatY > 0.5;
  const lt = Math.max(gamepadButtonValue(pad, 6), gamepadTriggerAxisValue(pad, 4));
  const rt = Math.max(gamepadButtonValue(pad, 7), gamepadTriggerAxisValue(pad, 5));
  const lb = gamepadButtonPressed(pad, 4);
  const rb = gamepadButtonPressed(pad, 5);

  gamepadState.pitch = ly;
  gamepadState.roll = lx;
  gamepadState.yaw = gamepadAxisValue(rx + ((rb ? 1 : 0) - (lb ? 1 : 0)) * 0.65, 0.18);
  gamepadState.throttleUp = Math.max(rt, dpadUp ? 1 : 0);
  gamepadState.throttleDown = Math.max(lt, dpadDown ? 1 : 0);
  gamepadState.fire = gamepadButtonPressed(pad, 0);
  gamepadState.brake = gamepadButtonPressed(pad, 1) || lt > 0.72;
  gamepadState.gear = gamepadButtonPressed(pad, 2);
  gamepadState.missile = gamepadButtonPressed(pad, 3);
  gamepadState.lights = dpadLeft;
  gamepadState.model = dpadRight;
  gamepadState.race = gamepadButtonPressed(pad, 8);
  gamepadState.reset = gamepadButtonPressed(pad, 9);
  if (Math.abs(gamepadState.pitch) > 0.01 || Math.abs(gamepadState.roll) > 0.01 || Math.abs(gamepadState.yaw) > 0.01 ||
      gamepadState.throttleUp > 0.01 || gamepadState.throttleDown > 0.01 ||
      gamepadState.fire || gamepadState.brake || gamepadState.gear || gamepadState.missile || gamepadState.lights || gamepadState.model || gamepadState.race || gamepadState.reset) {
    gamepadState.lastInputAt = performance.now();
  }
  combatState.fireHeld = gamepadState.fire || combatState.mouseFireHeld;
  syncInputIndicator();
  return gamepadState;
}

window.addEventListener('gamepadconnected', (e) => {
  if (!INPUT_FLAGS.gamepad) return;
  gamepadState.index = e.gamepad.index;
  gamepadState.connected = true;
  gamepadState.id = e.gamepad.id || `Gamepad ${e.gamepad.index}`;
  syncInputIndicator();
  if (typeof flashStatus === 'function') flashStatus(`CONTROLLER READY · ${gamepadState.id.split('(')[0].trim() || 'GAMEPAD'}`, 'panel ok', 1.8);
});

window.addEventListener('gamepaddisconnected', (e) => {
  if (e.gamepad && e.gamepad.index === gamepadState.index) {
    resetGamepadState();
    combatState.fireHeld = combatState.mouseFireHeld;
    syncInputIndicator();
    if (typeof flashStatus === 'function') flashStatus('CONTROLLER DISCONNECTED · KEYBOARD ACTIVE', 'panel warn', 1.6);
  }
});

window.addEventListener('focus', () => {
  if (!INPUT_FLAGS.gamepad) return;
  pollGamepadInput();
});

window.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault(), true);

window.addEventListener('pointerdown', (e) => {
  if (!INPUT_FLAGS.mouseFlight) return;
  const t = e.target;
  if (e.button === 0) {
    if (mouseFlightUiTarget(t)) return;
    if (renderer?.domElement?.requestPointerLock && document.pointerLockElement !== renderer.domElement) {
      try { renderer.domElement.requestPointerLock(); } catch {}
    }
    mouseFlightState.lastClientX = e.clientX;
    mouseFlightState.lastClientY = e.clientY;
    combatState.mouseFireHeld = true;
    return;
  }
  if (e.button === 2) {
    if (mouseFlightUiTarget(t)) return;
    if (renderer?.domElement?.requestPointerLock && document.pointerLockElement !== renderer.domElement) {
      try { renderer.domElement.requestPointerLock(); } catch {}
    }
    recenterMouseFlightReticle();
    mouseFlightState.lastClientX = e.clientX;
    mouseFlightState.lastClientY = e.clientY;
    e.preventDefault();
  }
}, true);

window.addEventListener('pointermove', (e) => {
  if (!INPUT_FLAGS.mouseFlight) return;
  if (!running || mouseFlightUiTarget(e.target)) return;
  let dx = 0;
  let dy = 0;
  if (document.pointerLockElement === renderer.domElement) {
    dx = e.movementX || 0;
    dy = e.movementY || 0;
  } else {
    if (mouseFlightState.lastClientX == null || mouseFlightState.lastClientY == null) {
      mouseFlightState.lastClientX = e.clientX;
      mouseFlightState.lastClientY = e.clientY;
      return;
    }
    dx = e.clientX - mouseFlightState.lastClientX;
    dy = e.clientY - mouseFlightState.lastClientY;
    mouseFlightState.lastClientX = e.clientX;
    mouseFlightState.lastClientY = e.clientY;
  }
  if (dx === 0 && dy === 0) return;
  const mag = Math.hypot(dx, dy);
  const accel = 0.08 + Math.min(0.42, Math.pow(mag / 54, 1.18) * 0.34);
  const { x: aimLimitX, y: aimLimitY } = getMouseFlightAimLimits();
  mouseFlightState.targetX = Math.max(-aimLimitX, Math.min(aimLimitX, mouseFlightState.targetX + dx * 0.00042 * (1 + accel)));
  mouseFlightState.targetY = Math.max(-aimLimitY, Math.min(aimLimitY, mouseFlightState.targetY - dy * 0.0006 * (1 + accel)));
}, true);

window.addEventListener('pointerup', (e) => {
  if (!INPUT_FLAGS.mouseFlight) return;
  if (e.button === 0) { combatState.mouseFireHeld = false; return; }
}, true);
window.addEventListener('pointercancel', () => {
  if (!INPUT_FLAGS.mouseFlight) return;
  combatState.mouseFireHeld = false;
}, true);

// Safety: if focus leaves the window, release fire and clear keys so no input
// stays latched after alt-tab / modal focus changes.
window.addEventListener('blur', () => {
  combatState.fireHeld = false;
  combatState.mouseFireHeld = false;
  mouseFlightState.lastClientX = null;
  mouseFlightState.lastClientY = null;
  for (const k of Object.keys(keys)) keys[k] = false;
});

document.addEventListener('pointerlockchange', () => {
  if (!INPUT_FLAGS.mouseFlight) return;
  if (document.pointerLockElement !== renderer.domElement) {
    mouseFlightState.lastClientX = null;
    mouseFlightState.lastClientY = null;
  }
});

// Scratch vectors for updateCamera (runs every frame; pattern matches _phys*/_hud*)
const _camOffset = new THREE.Vector3();
const _camPlaneUp = new THREE.Vector3();
const _camPlaneRight = new THREE.Vector3();
const _camPlaneForward = new THREE.Vector3();
const _camDelayedForward = new THREE.Vector3();
const _camWorldUp = new THREE.Vector3(0, 1, 0);
const _camDesired = new THREE.Vector3();
const _camLookForward = new THREE.Vector3();
const _camLookTarget = new THREE.Vector3();
function updateCamera(dt) {
  // Stable chase camera: keep the camera locked behind and above the plane.
  // Mouse now flies the aircraft via the reticle instead of orbiting the camera.
  const offsetRotated = _camOffset.copy(camLocalOffset);
  const planeUp = _camPlaneUp.set(0, 1, 0).applyQuaternion(jet.quaternion);
  const planeRight = _camPlaneRight.set(1, 0, 0).applyQuaternion(jet.quaternion);
  const planeForward = _camPlaneForward.set(0, 0, -1).applyQuaternion(jet.quaternion);
  let followQuat = camera.userData.followQuat;
  if (!(followQuat instanceof THREE.Quaternion)) {
    followQuat = jet.quaternion.clone();
    camera.userData.followQuat = followQuat;
  }
  const cameraLagTune = scene.userData.__cameraLag != null ? scene.userData.__cameraLag : 1.0;
  const quatCatchup = 1 - Math.exp(-((plane.onGround ? 18.0 : 10.8) / cameraLagTune) * dt);
  followQuat.slerp(jet.quaternion, quatCatchup);
  const delayedForward = _camDelayedForward.set(0, 0, -1).applyQuaternion(followQuat).normalize();
  const worldUp = _camWorldUp;

  const bankReveal = clamp01(Math.abs(planeRight.y) * 1.05);
  const pitchReveal = clamp01(Math.abs(plane.vel.y) / 22);
  const rateReveal = clamp01((Math.abs(plane.angVel.z) + Math.abs(plane.angVel.x) * 0.7 - 0.28) / 1.05);
  const rawReveal = Math.max(bankReveal, pitchReveal, rateReveal);
  const revealState = camera.userData.revealBlend || 0;
  const revealLerp = rawReveal > revealState ? Math.min(1, dt * 4.2) : Math.min(1, dt * 1.6);
  const maneuverReveal = revealState + (rawReveal - revealState) * revealLerp;
  camera.userData.revealBlend = maneuverReveal;
  camera.userData.maneuverReveal = maneuverReveal;

  // Signed pitch reveal: climb drops the chase camera lower to expose more
  // of the belly/underside silhouette; dives lift the camera higher to show
  // more of the wing tops. This stays purely vertical — no side drift.
  const signedPitchIntentRaw = Math.max(-1, Math.min(1,
    planeForward.y * 1.85 +
    plane.vel.y / 14
  ));
  const signedPitchIntent = plane.onGround
    ? 0
    : signedPitchIntentRaw * clamp01((maneuverReveal - 0.08) / 0.84);
  const pitchRevealState = camera.userData.pitchReveal || 0;
  const pitchSignFlip = signedPitchIntent * pitchRevealState < -0.02;
  const pitchRevealLerp = pitchSignFlip
    ? Math.min(1, dt * 1.35)
    : (Math.abs(signedPitchIntent) > Math.abs(pitchRevealState)
      ? Math.min(1, dt * 3.0)
      : Math.min(1, dt * 1.9));
  const signedPitchReveal = pitchRevealState + (signedPitchIntent - pitchRevealState) * pitchRevealLerp;
  camera.userData.pitchReveal = signedPitchReveal;

  const turnBias = 0;
  camera.userData.turnBias = 0;

  const climbRevealTune = scene.userData.__cameraClimbReveal != null ? scene.userData.__cameraClimbReveal : 1.0;
  const diveRevealTune = scene.userData.__cameraDiveReveal != null ? scene.userData.__cameraDiveReveal : 1.0;
  const rawClimbReveal = Math.max(0, signedPitchReveal) * maneuverReveal * climbRevealTune;
  const rawDiveReveal = Math.max(0, -signedPitchReveal) * maneuverReveal * diveRevealTune;
  const prevClimbReveal = camera.userData.climbRevealState || 0;
  const prevDiveReveal = camera.userData.diveRevealState || 0;
  const climbReveal = prevClimbReveal + (rawClimbReveal - prevClimbReveal) * Math.min(1, dt * 1.0);
  const diveReveal = prevDiveReveal + (rawDiveReveal - prevDiveReveal) * Math.min(1, dt * 1.0);
  camera.userData.climbRevealState = climbReveal;
  camera.userData.diveRevealState = diveReveal;
  const speedKtsForCamera = plane.vel.length() * 1.94;
  const speedDolly = clamp01((speedKtsForCamera - 58) / 230) * 1.7;
  const backDist = Math.abs(offsetRotated.z) + speedDolly + 2.8 * maneuverReveal + 1.55 * (climbReveal + diveReveal);
  const rawHeight = Math.max(-2.0,
    offsetRotated.y +
    3.2 * maneuverReveal -
    8.2 * climbReveal +
    2.8 * diveReveal
  );
  const prevHeightState = camera.userData.verticalHeightState;
  const heightBlend = prevHeightState == null
    ? 1
    : (rawHeight < prevHeightState ? Math.min(1, dt * 1.2) : Math.min(1, dt * 1.6));
  const height = prevHeightState == null
    ? rawHeight
    : prevHeightState + (rawHeight - prevHeightState) * heightBlend;
  camera.userData.verticalHeightState = height;
  const desired = _camDesired.copy(jet.position)
    .addScaledVector(delayedForward, -backDist)
    .addScaledVector(worldUp, height);

  const followK = 13.2 + maneuverReveal * 3.6;
  const t = 1 - Math.exp(-followK * dt);
  const verticalFollowK = 7.4 + maneuverReveal * 1.6;
  const verticalT = 1 - Math.exp(-verticalFollowK * dt);
  camera.position.x += (desired.x - camera.position.x) * t;
  camera.position.z += (desired.z - camera.position.z) * t;
  camera.position.y += (desired.y - camera.position.y) * verticalT;

  const gH = getHeight(camera.position.x, camera.position.z);
  if (camera.position.y < gH + 1.8) camera.position.y = gH + 1.8;

  const lookDist = 6.2 - maneuverReveal * 1.8;
  const rawFocusYOffset = 1.9 * climbReveal - 1.3 * diveReveal;
  const prevFocusState = camera.userData.focusYOffsetState;
  const focusBlend = prevFocusState == null ? 1 : Math.min(1, dt * 1.0);
  const focusYOffset = prevFocusState == null
    ? rawFocusYOffset
    : prevFocusState + (rawFocusYOffset - prevFocusState) * focusBlend;
  camera.userData.focusYOffsetState = focusYOffset;
  // was: .lerp(planeForward, 0.38 + maneuverReveal * 0.14) — a raw per-frame
  // constant with no dt term, unlike every other blend in this function.
  const lookBlendC = 0.38 + maneuverReveal * 0.14;
  const lookBlendK = -60 * Math.log(1 - lookBlendC);
  const lookForward = _camLookForward.copy(delayedForward).lerp(planeForward, 1 - Math.exp(-lookBlendK * dt)).normalize();
  const lookTarget = _camLookTarget.copy(jet.position)
    .addScaledVector(lookForward, lookDist)
    .addScaledVector(worldUp, focusYOffset);

  const blendedUp = worldUp;
  camera.up.copy(blendedUp);
  const cameraGroundH = getHeight(jet.position.x, jet.position.z);
  const lowFastFov = clamp01(1 - Math.max(0, jet.position.y - cameraGroundH) / 160) * clamp01((speedKtsForCamera - 34) / 100) * 1.2;
  const speedFov = clamp01((speedKtsForCamera - 42) / 190) * 4.5 + clamp01((speedKtsForCamera - 150) / 280) * 2.0;
  applyCameraLensFov(CAMERA_BASE_FOV + speedFov + lowFastFov + maneuverReveal * 1.3, Math.min(1, dt * 4.4));

  camera.lookAt(lookTarget);
  if (!camera.userData.focusTarget || !camera.userData.focusTarget.isVector3) {
    camera.userData.focusTarget = new THREE.Vector3();
  }
  camera.userData.focusTarget.copy(lookTarget);
  camera.userData.cameraHeightOffset = camera.position.y - jet.position.y;
  camera.userData.cameraFocusYOffset = lookTarget.y - jet.position.y;
}

