// @module src/game/13-main-loop.js
// =============================================================
//  MAIN LOOP
// =============================================================
let lastTime = 0;
// dt smoothing: at fluctuating frame rates the raw frame delta alternates
// (e.g. 16.7/33.3ms straddling the vsync boundary), so physics step sizes
// alternate 2:1 and the plane visibly lurches fore/aft ("juddering forward
// and backward"). A tight EMA filters the alternation while still tracking
// genuine rate changes within ~150ms; its mean equals the true mean, so
// game time does not drift.
let _dtEma = 0;
let running = false;
const FIXED_PHYSICS_STEP = 1 / 120; // 120Hz physics update rate
let physicsAccumulator = 0;
let physicsAlpha = 1.0;
// Let the browser paint the branded menu before the first terrain mesh build.
// Chunk jobs are queued during bootstrap, worker prefetch may run in parallel,
// and normal time-budgeted streaming begins after two animation frames.
const TERRAIN_STARTUP_DEFER_FRAMES = 2;
let terrainStartupFrames = 0;
// Frame counter for staggered secondary systems. PERF_BASELINE showed
// animate() JS (~25–30ms) dominates; full-rate physics/render stay every
// frame while cosmetic/low-priority systems run at 1/2 or 1/3 rate.
let _frameIndex = 0;

function updateLivePhysicsSmooth(dt) {
  // Cap dt to prevent the "spiral of death" if frame rate drops significantly
  const dtCapped = Math.min(0.08, dt);
  physicsAccumulator += dtCapped;
  
  while (physicsAccumulator >= FIXED_PHYSICS_STEP) {
    plane.prevPos.copy(plane.pos);
    plane.prevQuat.copy(plane.quat);
    
    updatePhysics(FIXED_PHYSICS_STEP);
    
    physicsAccumulator -= FIXED_PHYSICS_STEP;
  }
  
  physicsAlpha = physicsAccumulator / FIXED_PHYSICS_STEP;
}

function animate(now) {
  requestAnimationFrame(animate);
  const rawDt = Math.min(0.05, (now - lastTime) / 1000 || 0);
  lastTime = now;
  _dtEma = _dtEma > 0 ? _dtEma + (rawDt - _dtEma) * 0.25 : rawDt;
  const dt = Math.min(0.05, _dtEma);
  _frameIndex = (_frameIndex + 1) | 0;
  const oddFrame = (_frameIndex & 1) === 1;
  const every3 = (_frameIndex % 3) === 0;
  updateTimeOfDay(dt);
  updateMultiplayer(dt);
  pollGamepadInput();
  if (!running) {
    updateSunShadowRig();
    sky.position.copy(camera.position);
    sunGrp.position.copy(camera.position).addScaledVector(sunDir, 4500);
    moonGrp.position.copy(camera.position).addScaledVector(sunDir, -4300);
    starField.position.copy(camera.position);
    updateLensFlare();
    updateDepthOfField();
    updateMotionBlurPostFX();
    renderScene();
    return;
  }

  updateMatchState();
  updateInputLatches(dt);
  // Flight-review replay freezes live physics and writes the recorded
  // frame into plane.pos/quat so the rest of the pipeline (visual jet,
  // chase camera, world streaming) naturally follows the playback. The
  // second phase after updateCamera handles alternate viewpoints.
  if (replay.playing) {
    replayPreStep(dt);
  } else {
    updateLivePhysicsSmooth(dt);
    replayRecord();
  }
  updateJetVisual();
  updateChunks(plane.pos.x, plane.pos.z);
  updateFarChunks(plane.pos.x, plane.pos.z);
  updateHorizonChunks(plane.pos.x, plane.pos.z);
  if (terrainStartupFrames >= TERRAIN_STARTUP_DEFER_FRAMES) {
    processChunkBuildQueues(2.5, 6, true); // real-time: allow brief deferral for worker grids
  }
  terrainStartupFrames++;
  updateCamera(dt);
  updateAtmospheric(dt);
  updateShadow();
  updateSunShadowRig();
  // Secondary / cosmetic systems — half or third rate. dt is still the
  // real frame delta so any internal exp-smoothing stays time-correct;
  // systems that only sample `now` (birds/dust) simply move less often.
  if (oddFrame) {
    updateHeat(dt * 2);
    updateRunwayPropWash(dt * 2);
    updateBirds(now);
    updateDustDevils(now, plane.pos.x, plane.pos.z);
    updateGenerativeInstallations(dt * 2);
  }
  updateTraffic(dt);
  updateFloatingTarget(dt);
  updatePracticeRingCourse(dt);
  updateWater(dt, plane.pos.x, plane.pos.z);
  updateAirfieldAmbient(dt);
  updateAudio(dt);
  // Mission/UI flow can lag a frame without affecting feel
  if (every3) {
    const speedKts = plane.vel.length() * 1.94;
    updateMissionDebrief(dt * 3, speedKts);
    updateLandingCompleteFlow(speedKts);
  }
  updateHUD(dt);
  updateCombat(dt);
  if (typeof updateGateScoring === 'function') updateGateScoring(dt);
  if (window.__damageDecalUpdate) window.__damageDecalUpdate(dt);
  if (window.__gfxTick) window.__gfxTick();
  // Replay phase 2 — override camera to cockpit/wing/movie viewpoints
  // (chase mode leaves the live chase cam alone).
  if (replay.playing) {
    replayPostStep();
    updateReplayHeroLightAfterCamera();
  }

  // Sky + celestial bodies stay at apparent infinity by following the camera
  sky.position.copy(camera.position);
  sunGrp.position.copy(camera.position).addScaledVector(sunDir, 4500);
  moonGrp.position.copy(camera.position).addScaledVector(sunDir, -4300);
  starField.position.copy(camera.position);
  updateLensFlare();
  // Clouds live in world space and wrap when the player flies far past them
  updateClouds(dt, plane.pos.x, plane.pos.z);

  updateDepthOfField();
  updateMotionBlurPostFX();
  renderScene();
}

// Queue initial terrain before the first frame, but do not synchronously build
// the whole ring here.  Module 14 reveals the menu after this module executes;
// a 49-near/large-far bulk build previously delayed that first paint badly on
// production and mobile devices.  The normal RAF budget drains these queues
// once the menu has had two frames to render.
updateChunks(plane.pos.x, plane.pos.z);
updateFarChunks(plane.pos.x, plane.pos.z);
updateHorizonChunks(plane.pos.x, plane.pos.z);
updateTimeOfDay(0);
updateJetVisual();
updateSunShadowRig();
updateCamera(0.016);
sky.position.copy(camera.position);
sunGrp.position.copy(camera.position).addScaledVector(sunDir, 4500);
moonGrp.position.copy(camera.position).addScaledVector(sunDir, -4300);
starField.position.copy(camera.position);
updateLensFlare();
updateDepthOfField();
updateMotionBlurPostFX();
// Pre-warm: compile shader programs for everything already in the scene during the
// load screen, so the first interactive frame doesn't hitch on lazy compilation.
// prewarmLightStatePrograms runs one compile pass per reachable aux-light state
// (visible point/spot counts are baked into the program hash), so later toggles —
// landing lights, dusk apron floods, dusk/replay hero light — don't recompile
// mid-flight. (Content created later — multiplayer planes, tracers, alternate
// clouds — still compiles on first use; this flattens only the initial batch.)
prewarmLightStatePrograms();
try { renderer.compile(scene, camera); } catch (e) {}  // safety net for any state outside the prewarm enum
renderScene();
