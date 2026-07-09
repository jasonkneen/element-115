// @module src/game/16-gfx-panel-ap.js
// =============================================================
//  GRAPHICS PANEL (F17/F18/F19) — live-toggleable render settings
// =============================================================
(function setupGraphicsPanel() {
  const LEGACY_LS_KEYS = ['gfx-settings-v2', 'gfx-settings-v3', 'gfx-settings-v4', 'gfx-settings-v5', 'gfx-settings-v6'];
  const LS_KEY = 'gfx-settings-v7';
  // Defaults track the ultra preset for visual quality, but with bloom and
  // motion-blur dialed down — full ultra blew them out by default.
  const DEFAULTS = {
    fxaa: true, shadowsOn: true, shadowQuality: 'high', shadowDistance: 320,
    // dof defaults OFF: r128 BokehPass re-renders the whole scene for its depth
    // pass (~2x geometry cost per frame) for a barely-visible blur at our apertures.
    // Bloom starts soft so airfield lights/sky don't wash out on first load.
    dof: false, bloom: true, bloomStrength: 0.12, fog: true, cloudDensity: 0.95, cloudStyle: 'soft', terrainFade: 0.84, nightLift: 0.55, atmosphereDepth: 1.14, airframeFill: 0.75, replayHeroLight: true, particleScale: 1.2, floraDensity: 1.15, floraCullDistance: 450, ambientFxDensity: 1.12,
    waterReflectivity: 1.56, waterFresnel: 1.30, waterGlint: 1.42, waterOpacity: 0.94, enhancedWater: true,
    practiceRingPreset: 'training', practiceRingEnabled: true, practiceRingCount: 8, practiceRingScale: 1.0, practiceRingGlow: 1.0, practiceRingColor: 'cyan', practiceRingDensity: 1.0, practiceRingOpacity: 1.0, practiceRingBob: 0.85, practiceRingSpin: 0.9,
    flightProfile: 'trainer',
    controlPreset: 'casual',
    flightAccel: 1.28, topSpeedKts: 720, liftAssist: 1.06, idlePower: 1.0, pitchAuthority: 0.92, rollAuthority: 0.88, rudderAuthority: 0.86, autoRudder: 1.28,
    brakeStrength: 1.10, pitchDamping: 1.14, rollDamping: 1.18, rudderDamping: 1.10, stallSoftness: 1.24, maneuverAssist: 1.18, selfLevel: 1.36, weathervaneYaw: 1.18, gearDrag: 1.02, groundEffectStrength: 1.08,
    cameraClimbReveal: 0.95, cameraDiveReveal: 1.0, cameraLag: 0.78,
    fps: false, renderScale: 1.0, resolutionScale: 1.0, adaptiveRes: true, renderDistance: 1.0, motionBlur: false, motionBlurAmount: 0.30,
  };
  const PRESETS = {
    low:    { fxaa: false, shadowsOn: false, shadowQuality: 'low',  shadowDistance: 140, dof: false, bloom: false, bloomStrength: 0.10, fog: true, cloudDensity: 0.16, cloudStyle: 'chunky', terrainFade: 0.34, nightLift: 0.12, atmosphereDepth: 0.78, airframeFill: 0.52, replayHeroLight: false, particleScale: 0.30, floraDensity: 0.30, floraCullDistance: 250, ambientFxDensity: 0.22, waterReflectivity: 1.28, waterFresnel: 1.10, waterGlint: 1.08, waterOpacity: 0.92, enhancedWater: false, renderScale: 0.60, resolutionScale: 0.78, motionBlur: false, motionBlurAmount: 0.52, renderDistance: 0.7 },
    medium: { fxaa: true,  shadowsOn: true,  shadowQuality: 'med',  shadowDistance: 210, dof: false, bloom: true,  bloomStrength: 0.16, fog: true, cloudDensity: 0.52, cloudStyle: 'chunky', terrainFade: 0.46, nightLift: 0.22, atmosphereDepth: 0.88, airframeFill: 0.42, replayHeroLight: true,  particleScale: 0.82, floraDensity: 0.75, floraCullDistance: 350, ambientFxDensity: 0.65, waterReflectivity: 1.34, waterFresnel: 1.16, waterGlint: 1.18, waterOpacity: 0.92, enhancedWater: false, renderScale: 0.85, resolutionScale: 0.95, motionBlur: false, motionBlurAmount: 0.30, renderDistance: 1.0 },
    high:   { fxaa: true,  shadowsOn: true,  shadowQuality: 'high', shadowDistance: 260, dof: false, bloom: true,  bloomStrength: 0.22, fog: true, cloudDensity: 0.78, cloudStyle: 'soft',   terrainFade: 0.66, nightLift: 0.38, atmosphereDepth: 1.0, airframeFill: 0.58, replayHeroLight: true,  particleScale: 1.0,  floraDensity: 1.0,  floraCullDistance: 450, ambientFxDensity: 1.0, waterReflectivity: 1.42, waterFresnel: 1.22, waterGlint: 1.28, waterOpacity: 0.93, enhancedWater: true, renderScale: 1.0,  resolutionScale: 1.0, motionBlur: false, motionBlurAmount: 0.40, renderDistance: 1.3 },
    ultra:  { fxaa: true,  shadowsOn: true,  shadowQuality: 'ultra', shadowDistance: 320, dof: false, bloom: true,  bloomStrength: 0.28, fog: true, cloudDensity: 0.95, cloudStyle: 'fluffy', terrainFade: 0.84, nightLift: 0.55, atmosphereDepth: 1.14, airframeFill: 0.75, replayHeroLight: true,  particleScale: 1.2,  floraDensity: 1.15, floraCullDistance: 600, ambientFxDensity: 1.12, waterReflectivity: 1.56, waterFresnel: 1.30, waterGlint: 1.42, waterOpacity: 0.94, enhancedWater: true, renderScale: 1.0,  resolutionScale: 1.18, motionBlur: false, motionBlurAmount: 0.50, renderDistance: 1.6 },
  };

  const gfx = Object.assign({}, DEFAULTS);
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      Object.assign(gfx, saved);
    } else {
      // First run (no saved settings): pick a coarse starting tier so a phone or
      // weak laptop doesn't open on detuned-ultra. GPU-string tiering is unreliable
      // (masked in Safari; "Apple GPU" spans phones to M3 Max), so use coarse signals.
      // Adaptive resolution is the real per-frame safety net; this just sets a sane
      // starting point for the geometry/flora/shadow load (which adaptive res can't lower).
      const mobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ||
        (navigator.maxTouchPoints > 1 && window.matchMedia('(pointer:coarse)').matches);
      const cores = navigator.hardwareConcurrency || 4;
      if (mobile || cores <= 4) Object.assign(gfx, PRESETS.low);
      else if (cores <= 8) Object.assign(gfx, PRESETS.medium);
      // else: clearly capable desktop (>8 cores) → keep DEFAULTS (detuned ultra).
    }
  } catch {}
  // One-time migration for previously saved settings: DoF's BokehPass doubles the
  // per-frame geometry cost for a near-invisible blur, so force it off once.
  // Users can still re-enable it in the graphics panel afterwards.
  if (gfx.__dofPerfMigration == null) { gfx.dof = false; gfx.__dofPerfMigration = 1; }
  // __mbShakeMigration__ — the radial motion blur at high strength smears the
  // whole lower screen and re-aims with every micro camera move; users read it
  // as violent shaking ("everything shaking"). Off by default, amount clamped.
  if (gfx.__mbShakeMigration == null) {
    gfx.motionBlur = false;
    if (gfx.motionBlurAmount == null || gfx.motionBlurAmount > 0.5) gfx.motionBlurAmount = 0.30;
    gfx.__mbShakeMigration = 1;
  }
  // Soften stock bloom so first-load / preset picks don't blow out the sky.
  if (gfx.__bloomSoftMigration == null) {
    if (gfx.bloomStrength == null || gfx.bloomStrength > 0.18) gfx.bloomStrength = DEFAULTS.bloomStrength;
    gfx.__bloomSoftMigration = 1;
  }
  if (gfx.motionBlurAmount == null) {
    gfx.motionBlur = true;
    gfx.motionBlurAmount = DEFAULTS.motionBlurAmount;
  }
  if (gfx.waterReflectivity == null) gfx.waterReflectivity = DEFAULTS.waterReflectivity;
  if (gfx.waterFresnel == null) gfx.waterFresnel = DEFAULTS.waterFresnel;
  if (gfx.waterGlint == null) gfx.waterGlint = DEFAULTS.waterGlint;
  if (gfx.waterOpacity == null) gfx.waterOpacity = DEFAULTS.waterOpacity;
  if (gfx.practiceRingEnabled == null) gfx.practiceRingEnabled = DEFAULTS.practiceRingEnabled;
  if (gfx.practiceRingCount == null) gfx.practiceRingCount = DEFAULTS.practiceRingCount;
  if (gfx.practiceRingScale == null) gfx.practiceRingScale = DEFAULTS.practiceRingScale;
  if (gfx.practiceRingGlow == null) gfx.practiceRingGlow = DEFAULTS.practiceRingGlow;
  if (gfx.practiceRingColor == null || !isPracticeRingThemeKey(gfx.practiceRingColor)) gfx.practiceRingColor = DEFAULTS.practiceRingColor;
  if (gfx.practiceRingDensity == null) gfx.practiceRingDensity = DEFAULTS.practiceRingDensity;
  if (gfx.practiceRingOpacity == null) gfx.practiceRingOpacity = DEFAULTS.practiceRingOpacity;
  if (gfx.practiceRingBob == null) gfx.practiceRingBob = DEFAULTS.practiceRingBob;
  if (gfx.practiceRingSpin == null) gfx.practiceRingSpin = DEFAULTS.practiceRingSpin;
  if (gfx.cameraLag == null) gfx.cameraLag = DEFAULTS.cameraLag;
  if (gfx.floraCullDistance == null) gfx.floraCullDistance = DEFAULTS.floraCullDistance;
  if (gfx.adaptiveRes == null) gfx.adaptiveRes = DEFAULTS.adaptiveRes;
  if (gfx.renderDistance == null) gfx.renderDistance = DEFAULTS.renderDistance;
  window.gfx = gfx;

  window.__gfxParticleScale = () => gfx.particleScale;

  const save = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(gfx)); } catch {} };
  const clearLegacySettings = () => {
    try {
      for (const key of LEGACY_LS_KEYS) localStorage.removeItem(key);
    } catch {}
  };

  const FLIGHT_PROFILE_FIELDS = new Set([
    'flightAccel', 'topSpeedKts', 'liftAssist', 'idlePower',
    'pitchAuthority', 'rollAuthority', 'rudderAuthority', 'autoRudder',
    'maneuverAssist', 'stallSoftness', 'groundEffectStrength', 'brakeStrength',
    'selfLevel', 'weathervaneYaw', 'gearDrag',
    'pitchDamping', 'rollDamping', 'rudderDamping',
    'cameraClimbReveal', 'cameraDiveReveal'
  ]);
  const CONTROL_PRESET_FIELDS = new Set([
    'pitchAuthority', 'rollAuthority', 'rudderAuthority', 'autoRudder',
    'maneuverAssist', 'stallSoftness', 'selfLevel', 'weathervaneYaw',
    'pitchDamping', 'rollDamping', 'rudderDamping'
  ]);
  const PRACTICE_RING_FIELDS = new Set([
    'practiceRingEnabled', 'practiceRingCount', 'practiceRingScale', 'practiceRingGlow',
    'practiceRingColor', 'practiceRingDensity', 'practiceRingOpacity', 'practiceRingBob', 'practiceRingSpin'
  ]);
  const PRACTICE_RING_PRESETS = {
    training: {
      title: 'TRAINING',
      note: 'clean / forgiving',
      practiceRingEnabled: true,
      practiceRingCount: 8,
      practiceRingScale: 1.0,
      practiceRingGlow: 1.0,
      practiceRingColor: 'cyan',
      practiceRingDensity: 1.0,
      practiceRingOpacity: 1.0,
      practiceRingBob: 0.85,
      practiceRingSpin: 0.9,
    },
    sport: {
      title: 'SPORT',
      note: 'snappy / bright',
      practiceRingEnabled: true,
      practiceRingCount: 5,
      practiceRingScale: 1.08,
      practiceRingGlow: 1.15,
      practiceRingColor: 'amber',
      practiceRingDensity: 0.92,
      practiceRingOpacity: 0.94,
      practiceRingBob: 1.05,
      practiceRingSpin: 1.15,
    },
    dense: {
      title: 'DENSE',
      note: 'tight / compact',
      practiceRingEnabled: true,
      practiceRingCount: 6,
      practiceRingScale: 0.9,
      practiceRingGlow: 1.05,
      practiceRingColor: 'lime',
      practiceRingDensity: 0.76,
      practiceRingOpacity: 0.9,
      practiceRingBob: 0.7,
      practiceRingSpin: 1.0,
    },
    showcase: {
      title: 'SHOWCASE',
      note: 'big / dramatic',
      practiceRingEnabled: true,
      practiceRingCount: 6,
      practiceRingScale: 1.32,
      practiceRingGlow: 1.45,
      practiceRingColor: 'magenta',
      practiceRingDensity: 1.18,
      practiceRingOpacity: 0.98,
      practiceRingBob: 1.28,
      practiceRingSpin: 1.4,
    },
  };
  function isPracticeRingPresetKey(key) {
    return Object.prototype.hasOwnProperty.call(PRACTICE_RING_PRESETS, key);
  }
  function practiceRingPresetMatches(state, key) {
    const preset = PRACTICE_RING_PRESETS[key];
    if (!preset) return false;
    return Array.from(PRACTICE_RING_FIELDS).every((field) => state[field] === preset[field]);
  }
  function resolvePracticeRingPreset(state) {
    const matched = Object.keys(PRACTICE_RING_PRESETS).find((key) => practiceRingPresetMatches(state, key));
    return matched || 'custom';
  }
  gfx.practiceRingPreset = resolvePracticeRingPreset(gfx);
  const CONTROL_PRESETS = {
    casual: {
      title: 'CASUAL',
      note: 'easy / forgiving',
      pitchAuthority: 0.92, rollAuthority: 0.88, rudderAuthority: 0.86, autoRudder: 1.28,
      maneuverAssist: 1.18, stallSoftness: 1.24, selfLevel: 1.36, weathervaneYaw: 1.18,
      pitchDamping: 1.14, rollDamping: 1.18, rudderDamping: 1.10,
    },
    balanced: {
      title: 'BALANCED',
      note: 'default / neutral',
      pitchAuthority: 1.0, rollAuthority: 1.0, rudderAuthority: 1.0, autoRudder: 1.0,
      maneuverAssist: 1.0, stallSoftness: 1.0, selfLevel: 1.0, weathervaneYaw: 1.0,
      pitchDamping: 1.0, rollDamping: 1.0, rudderDamping: 1.0,
    },
    responsive: {
      title: 'RESPONSIVE',
      note: 'crisper / lively',
      pitchAuthority: 1.18, rollAuthority: 1.24, rudderAuthority: 1.12, autoRudder: 0.82,
      maneuverAssist: 1.22, stallSoftness: 1.08, selfLevel: 0.78, weathervaneYaw: 0.86,
      pitchDamping: 0.92, rollDamping: 0.88, rudderDamping: 0.92,
    },
    direct: {
      title: 'DIRECT',
      note: 'fast / aggressive',
      pitchAuthority: 1.34, rollAuthority: 1.42, rudderAuthority: 1.22, autoRudder: 0.58,
      maneuverAssist: 1.42, stallSoftness: 0.94, selfLevel: 0.48, weathervaneYaw: 0.66,
      pitchDamping: 0.82, rollDamping: 0.76, rudderDamping: 0.84,
    },
  };
  const FLIGHT_PROFILES = {
    trainer: {
      title: 'TRAINER',
      note: 'stable / forgiving',
      flightAccel: 0.96, topSpeedKts: 540, liftAssist: 1.06, idlePower: 1.0,
      pitchAuthority: 0.94, rollAuthority: 0.90, rudderAuthority: 0.92, autoRudder: 1.30,
      maneuverAssist: 1.16, stallSoftness: 1.22, groundEffectStrength: 1.08, brakeStrength: 1.10,
      selfLevel: 1.34, weathervaneYaw: 1.24, gearDrag: 1.02,
      pitchDamping: 1.12, rollDamping: 1.16, rudderDamping: 1.08,
      cameraClimbReveal: 0.95, cameraDiveReveal: 1.0,
    },
    stunt: {
      title: 'STUNT',
      note: 'snappy / loose',
      flightAccel: 1.08, topSpeedKts: 540, liftAssist: 1.12, idlePower: 0.90,
      pitchAuthority: 1.58, rollAuthority: 1.72, rudderAuthority: 1.46, autoRudder: 0.55,
      maneuverAssist: 1.46, stallSoftness: 1.18, groundEffectStrength: 0.95, brakeStrength: 0.94,
      selfLevel: 0.44, weathervaneYaw: 0.55, gearDrag: 1.0,
      pitchDamping: 0.82, rollDamping: 0.72, rudderDamping: 0.82,
      cameraClimbReveal: 1.34, cameraDiveReveal: 1.24,
    },
    bush: {
      title: 'BUSH',
      note: 'lift / short-field',
      flightAccel: 0.94, topSpeedKts: 420, liftAssist: 1.28, idlePower: 1.08,
      pitchAuthority: 1.10, rollAuthority: 0.92, rudderAuthority: 1.20, autoRudder: 1.14,
      maneuverAssist: 1.30, stallSoftness: 1.30, groundEffectStrength: 1.46, brakeStrength: 1.46,
      selfLevel: 1.08, weathervaneYaw: 1.18, gearDrag: 1.32,
      pitchDamping: 1.00, rollDamping: 1.08, rudderDamping: 0.96,
      cameraClimbReveal: 1.08, cameraDiveReveal: 0.95,
    },
    racer: {
      title: 'RACER',
      note: 'fast / committed',
      flightAccel: 1.34, topSpeedKts: 620, liftAssist: 0.92, idlePower: 0.88,
      pitchAuthority: 1.08, rollAuthority: 1.28, rudderAuthority: 0.95, autoRudder: 0.86,
      maneuverAssist: 1.00, stallSoftness: 0.88, groundEffectStrength: 0.80, brakeStrength: 0.86,
      selfLevel: 0.72, weathervaneYaw: 0.84, gearDrag: 0.72,
      pitchDamping: 0.90, rollDamping: 0.86, rudderDamping: 0.92,
      cameraClimbReveal: 1.22, cameraDiveReveal: 1.36,
    },
  };
  const recommendedFlightProfileForPlane = (preset) => {
    if (!preset) return 'trainer';
    if (preset.jet || (preset.type || '').includes('Jet') || (preset.type || '').includes('Attack')) return 'racer';
    if ((preset.type || '').includes('Stunt') || /^stunt/.test(preset.key)) return 'stunt';
    if ((preset.type || '').includes('Utility') || preset.key === 'bush') return 'bush';
    if ((preset.type || '').includes('Racing') || ['scruggs', 'ripslinger'].includes(preset.key)) return 'racer';
    return 'trainer';
  };

  let fpsDiv = null, fpsFrames = 0, fpsLast = performance.now(), fpsSmoothed = 60;
  // Runtime-only adaptive-resolution state. NEVER persisted to gfx/localStorage —
  // it only scales DOWN from the user's chosen renderScale/resolutionScale so the
  // user's sliders stay the ceiling. Folded into applyRenderScale's setPixelRatio.
  let adaptiveScale = 1.0, adaptiveCooldown = 0, adaptiveWarmup = 0, wasAdaptRunning = false;
  // FPS_LOW 57 (was 55): the 55-58 zone previously sat in the dead band —
  // full resolution with 3-6% missed vsyncs = sustained judder that reads
  // as "everything shaking". Let adaptive res engage there instead.
  const ADAPT_MIN = 0.6, ADAPT_STEP = 0.1, FPS_LOW = 57, FPS_GOOD = 59;
  function tickFps() {
    fpsFrames++;
    const now = performance.now();
    if (now - fpsLast >= 500) {
      fpsSmoothed = fpsSmoothed * 0.6 + (fpsFrames * 1000 / (now - fpsLast)) * 0.4;
      fpsFrames = 0; fpsLast = now;
      if (fpsDiv && gfx.fps) fpsDiv.textContent = 'FPS ' + Math.round(fpsSmoothed);
      // Adaptive resolution: drop fast when starved, raise slowly once the frame
      // rate pins at the vsync cap. The [FPS_LOW, FPS_GOOD] gap is the hysteresis
      // dead band; asymmetric cooldown (2 vs 6 half-seconds) settles up gently.
      // On flight start, reset to full res and warm up (~6s) so the initial
      // shader-compile / chunk-load spike doesn't trigger a spurious downscale
      // on capable hardware that will hold 60fps once the load settles.
      if (running && !wasAdaptRunning) { adaptiveScale = 1.0; adaptiveWarmup = 12; }
      wasAdaptRunning = running;
      if (gfx.adaptiveRes !== false && running) {
        if (adaptiveWarmup > 0) { adaptiveWarmup--; }
        else if (adaptiveCooldown > 0) { adaptiveCooldown--; }
        else if (fpsSmoothed < FPS_LOW && adaptiveScale > ADAPT_MIN) {
          adaptiveScale = Math.max(ADAPT_MIN, adaptiveScale - ADAPT_STEP); applyRenderScale(); adaptiveCooldown = 2;
        } else if (fpsSmoothed >= FPS_GOOD && adaptiveScale < 1.0) {
          adaptiveScale = Math.min(1.0, adaptiveScale + ADAPT_STEP); applyRenderScale(); adaptiveCooldown = 6;
        }
      }
    }
  }

  function applyShadows() {
    renderer.shadowMap.enabled = !!gfx.shadowsOn;
    const sizeMap = { low: 512, med: 1024, high: 2048, ultra: 4096 };
    const size = sizeMap[gfx.shadowQuality] || 1024;
    scene.userData.__shadowDistance = gfx.shadowDistance;
    scene.traverse(obj => {
      if (obj.isDirectionalLight && obj.shadow) {
        if (obj.shadow.mapSize.x !== size) {
          obj.shadow.mapSize.set(size, size);
          if (obj.shadow.map) { obj.shadow.map.dispose(); obj.shadow.map = null; }
        }
      }
    });
  }
  function applyFog() {
    if (!scene.fog) return;
    scene.userData.__fogDisabled = !gfx.fog;
  }
  function applyDof() {
    if (postFX.bokehPass) postFX.bokehPass.enabled = !!gfx.dof;
    postFX.enabled = !!gfx.dof;
  }
  function applyBloom() {
    if (postFX.bloomPass) {
      postFX.bloomPass.enabled = !!gfx.bloom;
      postFX.bloomPass.strength = Math.max(0, Math.min(1.25, gfx.bloomStrength || 0.42));
      postFX.bloomPass.radius = 0.28 + (gfx.bloomStrength || 0.42) * 0.22;
      postFX.bloomPass.threshold = 0.88 - Math.min(0.26, (gfx.bloomStrength || 0.42) * 0.18);
    }
  }
  function applyMotionBlur() {
    scene.userData.__motionBlurAmount = Math.max(0, Math.min(1.2, gfx.motionBlurAmount != null ? gfx.motionBlurAmount : DEFAULTS.motionBlurAmount));
    if (postFX.motionBlurPass && postFX.motionBlurPass.uniforms) {
      if (gfx.motionBlur === false) {
        postFX.motionBlurPass.uniforms.strength.value = 0;
        postFX.motionBlurPass.enabled = false;
      }
      postFX.motionBlurPass.uniforms.aspect.value = window.innerWidth / Math.max(1, window.innerHeight);
    }
  }
  function applyFxaa() {
    if (postFX.fxaaPass) postFX.fxaaPass.enabled = !!gfx.fxaa;
  }
  function applyRenderScale() {
    const ratio = Math.max(0.5, Math.min(1.0, gfx.renderScale));
    const supersample = Math.max(0.75, Math.min(1.35, gfx.resolutionScale || 1.0));
    if (gfx.adaptiveRes === false) adaptiveScale = 1.0; // disabling restores the user's full chosen resolution
    // Cap the effective ratio at 1.6: with FXAA in the chain the sharpness gain
    // above ~1.6 is invisible at this scene's detail level, while fill cost grows
    // with the square (2.0 → 1.6 is a 36% pixel reduction across every pass).
    renderer.setPixelRatio(Math.min(window.devicePixelRatio * ratio * supersample * adaptiveScale, 1.6));
    renderer.setSize(window.innerWidth, window.innerHeight, true);
    if (postFX.composer) {
      // EffectComposer snapshots the renderer's pixel ratio at construction; without
      // this, render-scale changes (sliders AND adaptive resolution) never reach the
      // composer targets — i.e. they did nothing while any post pass was active.
      if (postFX.composer.setPixelRatio) postFX.composer.setPixelRatio(renderer.getPixelRatio());
      postFX.composer.setSize(window.innerWidth, window.innerHeight);
    }
    if (postFX.bloomPass && postFX.bloomPass.setSize) postFX.bloomPass.setSize(window.innerWidth / 2, window.innerHeight / 2);
    updateFxaaPassResolution();
  }
  function applyClouds() {
    weather.clouds = gfx.cloudDensity;
    if (typeof clouds !== 'undefined' && clouds && clouds.data) {
      const active = Math.floor(clouds.data.length * (gfx.cloudDensity / Math.max(0.01, DEFAULTS.cloudDensity)));
      clouds.data.forEach((c, i) => {
        c.mesh.visible = (i < active);
        if (c.holder) c.holder.visible = (i < active);
      });
      if (typeof syncCloudWisps === 'function') syncCloudWisps();
    }
  }
  function applyTerrainClutter() {
    const density = Math.max(0.2, Math.min(1.6, gfx.floraDensity || 1.0));
    scene.userData.__floraDensity = density;
    scene.userData.__floraCullDistance = gfx.floraCullDistance;
    for (const c of chunks.values()) {
      c.group.children.forEach(child => {
        if (!child.isInstancedMesh || child.userData.__densityGroup !== 'terrain-clutter') return;
        const base = child.userData.__baseCount || child.count || 0;
        // base = number actually placed during scatter (≤ per-chunk cap).
        // Math.min keeps us within the InstancedMesh's allocated capacity.
        child.count = Math.max(0, Math.min(base, Math.round(base * density)));
      });
    }
  }

  function applyAmbientFx() {
    scene.userData.__ambientFxDensity = Math.max(0, Math.min(1.2, gfx.ambientFxDensity || 1.0));
  }
  function applyFlightTuning() {
    scene.userData.__flightAccel = Math.max(0.7, Math.min(2.4, gfx.flightAccel || 1.0));
    scene.userData.__flightTopSpeedKts = Math.max(220, Math.min(780, gfx.topSpeedKts || 720));
    scene.userData.__flightLift = Math.max(0.7, Math.min(1.4, gfx.liftAssist || 1.0));
    scene.userData.__flightIdlePower = Math.max(0, Math.min(1.6, gfx.idlePower != null ? gfx.idlePower : 1.0));
    scene.userData.__flightPitchAuth = Math.max(0.6, Math.min(2.0, gfx.pitchAuthority || 1.0));
    scene.userData.__flightRollAuth = Math.max(0.6, Math.min(2.0, gfx.rollAuthority || 1.0));
    scene.userData.__flightRudderAuth = Math.max(0.6, Math.min(2.0, gfx.rudderAuthority || 1.0));
    scene.userData.__flightAutoRudder = Math.max(0, Math.min(2.0, gfx.autoRudder != null ? gfx.autoRudder : 1.0));
    scene.userData.__flightBrake = Math.max(0.5, Math.min(2.0, gfx.brakeStrength || 1.0));
    scene.userData.__flightPitchDamp = Math.max(0.6, Math.min(1.8, gfx.pitchDamping || 1.0));
    scene.userData.__flightRollDamp = Math.max(0.6, Math.min(1.8, gfx.rollDamping || 1.0));
    scene.userData.__flightRudderDamp = Math.max(0.6, Math.min(1.8, gfx.rudderDamping || 1.0));
    scene.userData.__flightStallSoft = Math.max(0.7, Math.min(1.5, gfx.stallSoftness || 1.0));
    scene.userData.__flightManeuverAssist = Math.max(0.5, Math.min(1.8, gfx.maneuverAssist || 1.0));
    scene.userData.__flightSelfLevel = Math.max(0, Math.min(2.0, gfx.selfLevel != null ? gfx.selfLevel : 1.0));
    scene.userData.__flightWeathervaneYaw = Math.max(0, Math.min(2.0, gfx.weathervaneYaw != null ? gfx.weathervaneYaw : 1.0));
    scene.userData.__flightGearDrag = Math.max(0, Math.min(2.5, gfx.gearDrag != null ? gfx.gearDrag : 1.0));
    scene.userData.__flightGroundEffect = Math.max(0, Math.min(2.0, gfx.groundEffectStrength != null ? gfx.groundEffectStrength : 1.0));
    scene.userData.__cameraClimbReveal = Math.max(0.4, Math.min(2.2, gfx.cameraClimbReveal != null ? gfx.cameraClimbReveal : 1.0));
    scene.userData.__cameraDiveReveal = Math.max(0.4, Math.min(2.2, gfx.cameraDiveReveal != null ? gfx.cameraDiveReveal : 1.0));
    scene.userData.__cameraLag = Math.max(0.32, Math.min(1.8, gfx.cameraLag != null ? gfx.cameraLag : 1.0));
  }
  function applyWorldTuning() {
    scene.userData.__terrainFade = gfx.terrainFade;
    // Render distance drives the far-chunk ring and the fog ceiling in lockstep
    // (fog formula in updateTimeOfDay reads __renderDistance). rd 1.0 == stock.
    const rd = Math.max(0.6, Math.min(2.0, gfx.renderDistance || 1.0));
    scene.userData.__renderDistance = rd;
    FAR_RADIUS = Math.round(4 * rd);
    // Horizon ring: off at rd<=1.0 (HORIZON_RADIUS 0), grows 0->4 as rd 1.0->2.0.
    // Drives the camera far-plane + fog ceiling (in updateTimeOfDay) so the extra
    // distance is actually visible. Far-plane has negligible depth-precision cost
    // here (near=0.8 dominates), so raising it for the horizon tier is safe.
    HORIZON_RADIUS = Math.max(0, Math.round((rd - 1.0) * 4));
    const horizonExtent = HORIZON_RADIUS > 0 ? (HORIZON_RADIUS + 0.5) * HORIZON_CHUNK_SIZE : 0;
    scene.userData.__horizonExtent = horizonExtent;
    camera.far = Math.max(14000, horizonExtent + 2400);
    camera.updateProjectionMatrix();
    scene.userData.__nightLift = gfx.nightLift;
    scene.userData.__atmosphereDepth = Math.max(0.7, Math.min(1.25, gfx.atmosphereDepth || 1.0));
    scene.userData.__airframeFill = Math.max(0, Math.min(1.4, gfx.airframeFill || 0));
    scene.userData.__replayHeroLight = gfx.replayHeroLight !== false;
    scene.userData.__shadowDistance = gfx.shadowDistance;
    scene.userData.__waterReflectivity = Math.max(0.6, Math.min(1.8, gfx.waterReflectivity != null ? gfx.waterReflectivity : DEFAULTS.waterReflectivity));
    scene.userData.__waterFresnel = Math.max(0.7, Math.min(1.8, gfx.waterFresnel != null ? gfx.waterFresnel : DEFAULTS.waterFresnel));
    scene.userData.__waterGlint = Math.max(0.4, Math.min(1.8, gfx.waterGlint != null ? gfx.waterGlint : DEFAULTS.waterGlint));
    scene.userData.__waterOpacity = Math.max(0.7, Math.min(0.98, gfx.waterOpacity != null ? gfx.waterOpacity : DEFAULTS.waterOpacity));
    scene.userData.__practiceRingEnabled = gfx.practiceRingEnabled !== false;
    const practiceRingMax = window.__practiceRingCourse ? window.__practiceRingCourse.length : DEFAULTS.practiceRingCount;
    scene.userData.__practiceRingCount = Math.max(0, Math.min(practiceRingMax, Math.round(gfx.practiceRingCount != null ? gfx.practiceRingCount : DEFAULTS.practiceRingCount)));
    scene.userData.__practiceRingScale = Math.max(0.55, Math.min(1.8, gfx.practiceRingScale != null ? gfx.practiceRingScale : DEFAULTS.practiceRingScale));
    scene.userData.__practiceRingGlow = Math.max(0, Math.min(1.8, gfx.practiceRingGlow != null ? gfx.practiceRingGlow : DEFAULTS.practiceRingGlow));
    scene.userData.__practiceRingColor = isPracticeRingThemeKey(gfx.practiceRingColor) ? gfx.practiceRingColor : DEFAULTS.practiceRingColor;
    scene.userData.__practiceRingDensity = Math.max(0.65, Math.min(1.45, gfx.practiceRingDensity != null ? gfx.practiceRingDensity : DEFAULTS.practiceRingDensity));
    scene.userData.__practiceRingOpacity = Math.max(0.15, Math.min(1.05, gfx.practiceRingOpacity != null ? gfx.practiceRingOpacity : DEFAULTS.practiceRingOpacity));
    scene.userData.__practiceRingBob = Math.max(0, Math.min(1.8, gfx.practiceRingBob != null ? gfx.practiceRingBob : DEFAULTS.practiceRingBob));
    scene.userData.__practiceRingSpin = Math.max(0, Math.min(1.8, gfx.practiceRingSpin != null ? gfx.practiceRingSpin : DEFAULTS.practiceRingSpin));
    waterMat.uniforms.reflectivity.value = scene.userData.__waterReflectivity;
    waterMat.uniforms.fresnelBoost.value = scene.userData.__waterFresnel;
    waterMat.uniforms.sunGlint.value = scene.userData.__waterGlint;
    waterMat.uniforms.waterOpacity.value = scene.userData.__waterOpacity;
    scene.userData.__enhancedWater = (gfx.enhancedWater !== false);
    waterMat.uniforms.uEnhance.value = scene.userData.__enhancedWater ? 1.0 : 0.0;
    applyPracticeRingCourseTuning();
    if (typeof syncCloudWisps === 'function') syncCloudWisps();
  }
  function applyAll() {
    applyShadows(); applyFog(); applyDof(); applyBloom(); applyMotionBlur(); applyFxaa(); applyRenderScale(); applyClouds(); applyTerrainClutter(); applyAmbientFx(); applyFlightTuning(); applyWorldTuning();
    if (fpsDiv) fpsDiv.style.display = gfx.fps ? 'block' : 'none';
  }

  // DOM helper (no innerHTML)
  const el = (tag, attrs, ...children) => {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'style') n.style.cssText = attrs[k];
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
      else if (k === 'class') n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    for (const c of children) {
      if (c == null) continue;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return n;
  };
  // Match HUD theme: amber on translucent dark, `.panel`-style border,
  // SF Mono typography, shared letter-spacing. Reuse the existing `.bar`
  // look for sliders so they blend with HULL/AMMO indicators.
  const AMBER = '#ffcc66', AMBER_HI = '#ffe0a0', AMBER_BORDER = 'rgba(255,204,102,0.35)';
  const btnStyle = (on) => `padding:4px 10px;background:${on?'rgba(255,204,102,0.18)':'rgba(255,255,255,0.04)'};color:${on?AMBER_HI:'rgba(255,226,170,0.72)'};border:1px solid ${AMBER_BORDER};border-radius:999px;font:inherit;letter-spacing:inherit;cursor:pointer;`;
  const segStyle = (on) => `padding:4px 9px;background:${on?'rgba(255,204,102,0.18)':'rgba(255,255,255,0.04)'};color:${on?AMBER_HI:'rgba(255,226,170,0.72)'};border:1px solid ${AMBER_BORDER};border-right:0;font:inherit;letter-spacing:inherit;cursor:pointer;`;
  const rowStyle = 'display:flex;justify-content:space-between;align-items:center;margin:4px 0;gap:12px;font-size:11px;';
  const headerStyle = 'border-top:1px solid rgba(255,204,102,0.12);padding-top:8px;margin-top:10px;opacity:0.66;font-size:10px;letter-spacing:0.16em;';

  const graphicsOverlay = el('div', {
    id: 'graphics-overlay',
    class: 'fullscreen-options-shell',
  });
  const panel = el('div', {
    id: 'graphics-panel',
    class: 'panel game-dialog-chrome game-options-panel fullscreen-options-shell-card',
    style: 'font-size:11px;display:block;pointer-events:auto;'
  });
  graphicsOverlay.appendChild(panel);

  const makeToggle = (id) => {
    const b = el('button', { type: 'button', style: btnStyle(gfx[id]) }, gfx[id] ? 'ON' : 'OFF');
    b.addEventListener('click', () => {
      gfx[id] = !gfx[id];
      markPresetDirty(id);
      b.style.cssText = btnStyle(gfx[id]);
      b.textContent = gfx[id] ? 'ON' : 'OFF';
      applyAll(); save();
    });
    return b;
  };
  const makeSegmented = (id, opts) => {
    const wrap = el('span');
    const refresh = () => {
      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
      opts.forEach(o => {
        const b = el('button', { type: 'button', style: segStyle(gfx[id] === o) }, o.toUpperCase());
        b.addEventListener('click', () => { gfx[id] = o; markPresetDirty(id); refresh(); applyAll(); save(); });
        wrap.appendChild(b);
      });
    };
    refresh();
    return wrap;
  };
  // Slider renders as a stacked row — label + inline value on top, full-width
  // bar below — matching the existing THROTTLE pattern.
  const makeSliderRow = (id, min, max, step, labelText, formatter) => {
    const fmt = formatter || ((v) => Math.round(v * 100) + '%');
    const wrap = el('div', { style: 'margin:4px 0 6px;' });
    const header = el('div', { style: 'display:flex;justify-content:space-between;align-items:baseline;' });
    header.appendChild(el('span', {}, labelText));
    const valSpan = el('span', { style: `color:${AMBER_HI};` }, fmt(gfx[id]));
    header.appendChild(valSpan);
    wrap.appendChild(header);
    const input = el('input', { type: 'range', min, max, step, value: gfx[id], style: 'width:100%;display:block;margin-top:3px;' });
    input.addEventListener('input', () => {
      gfx[id] = parseFloat(input.value);
      markPresetDirty(id);
      valSpan.textContent = fmt(gfx[id]);
      applyAll(); save();
    });
    wrap.appendChild(input);
    return wrap;
  };
  // Toggles stay inline (label | ON/OFF button) — the existing "LIGHTS [L] ON" pattern
  const row = (labelText, controlEl) => {
    const r = el('div', { style: rowStyle });
    r.appendChild(el('span', {}, labelText));
    r.appendChild(controlEl);
    return r;
  };
  const makeDetailsSection = (titleText, noteText, open = false) => {
    const wrap = el('details', {
      style: 'margin:10px 0 0;border:1px solid rgba(255,215,150,0.12);border-radius:14px;background:rgba(255,255,255,0.03);overflow:hidden;'
    });
    if (open) wrap.open = true;
    const summary = el('summary', {
      style: 'cursor:pointer;padding:11px 12px;display:grid;gap:4px;background:rgba(255,255,255,0.025);'
    });
    summary.appendChild(el('strong', { style: 'font-size:10px;letter-spacing:0.16em;color:#fff0c6;' }, titleText));
    if (noteText) summary.appendChild(el('span', { style: 'font-size:9px;line-height:1.45;opacity:0.6;' }, noteText));
    const body = el('div', { style: 'padding:8px 12px 10px;' });
    wrap.appendChild(summary);
    wrap.appendChild(body);
    return { wrap, body };
  };
  const flightCardStyle = (active, recommended) => [
    'display:grid',
    'gap:4px',
    'min-height:62px',
    'padding:10px 11px',
    'border-radius:14px',
    'text-align:left',
    'cursor:pointer',
    'background:' + (active ? 'linear-gradient(180deg, rgba(255,204,102,0.18), rgba(255,255,255,0.05))' : (recommended ? 'rgba(255,204,102,0.08)' : 'rgba(255,255,255,0.035)')),
    'border:1px solid ' + (active ? 'rgba(255,225,170,0.42)' : (recommended ? 'rgba(255,204,102,0.24)' : 'rgba(255,215,150,0.12)')),
    'color:#fff2cf',
    'box-shadow:' + (active ? 'inset 0 1px 0 rgba(255,255,255,0.08), 0 10px 24px rgba(0,0,0,0.18)' : 'none')
  ].join(';');
  const applyFlightProfilePreset = (key) => {
    const preset = FLIGHT_PROFILES[key];
    if (!preset) return;
    Object.entries(preset).forEach(([field, value]) => {
      if (field === 'title' || field === 'note') return;
      gfx[field] = value;
    });
    gfx.flightProfile = key;
    gfx.controlPreset = 'custom';
    rebuild(); applyAll(); save();
  };
  const applyControlPreset = (key) => {
    const preset = CONTROL_PRESETS[key];
    if (!preset) return;
    Object.entries(preset).forEach(([field, value]) => {
      if (field === 'title' || field === 'note') return;
      gfx[field] = value;
    });
    gfx.controlPreset = key;
    rebuild(); applyAll(); save();
  };
  const applyPracticeRingPreset = (key) => {
    const preset = PRACTICE_RING_PRESETS[key];
    if (!preset) return;
    Object.entries(preset).forEach(([field, value]) => {
      if (field === 'title' || field === 'note') return;
      gfx[field] = value;
    });
    gfx.practiceRingPreset = key;
    rebuild(); applyAll(); save();
  };
  const markPresetDirty = (id) => {
    if (FLIGHT_PROFILE_FIELDS.has(id) && gfx.flightProfile !== 'custom') gfx.flightProfile = 'custom';
    if (CONTROL_PRESET_FIELDS.has(id) && gfx.controlPreset !== 'custom') gfx.controlPreset = 'custom';
    if (PRACTICE_RING_FIELDS.has(id) && gfx.practiceRingPreset !== 'custom') gfx.practiceRingPreset = 'custom';
  };
  const resetGraphicsSettings = () => {
    for (const key of Object.keys(gfx)) delete gfx[key];
    Object.assign(gfx, DEFAULTS);
    gfx.practiceRingPreset = resolvePracticeRingPreset(gfx);
    clearLegacySettings();
    rebuild();
    applyAll();
    save();
    if (typeof flashStatus === 'function') {
      flashStatus('SETTINGS RESET - CALMER DEFAULTS LOADED', 'panel ok', 1.5);
    }
  };
  window.__gfxReset = resetGraphicsSettings;

  const rebuild = () => {
    while (panel.firstChild) panel.removeChild(panel.firstChild);

    panel.appendChild(el('div', { class: 'options-title' }, 'OPTIONS [P]'));
    panel.appendChild(el('div', { class: 'options-kicker' }, 'Release-first options // presets first, advanced sections collapsed by default // ESC or backdrop to return to flight'));

    const resetBtn = el('button', {
      type: 'button',
      class: 'preset-card',
      style: 'width:100%;text-align:left;cursor:pointer;margin:8px 0 10px;border-color:rgba(255,204,102,0.30);background:rgba(255,204,102,0.08);'
    }, el('strong', {}, 'RESET SETTINGS'), el('span', {}, 'clear saved tuning / calmer fresh-test defaults'));
    resetBtn.addEventListener('click', resetGraphicsSettings);
    panel.appendChild(resetBtn);

    panel.appendChild(el('div', { style: headerStyle + 'margin-top:0;border-top:0;padding-top:0;' }, 'QUICK PRESETS'));
    const presetRow = el('div', { class: 'orientation-grid quick-preset-grid', style: 'display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-bottom:8px;' });
    const presetMeta = {
      low: ['LOW', 'lean / cooler'],
      med: ['MED', 'balanced'],
      high: ['HIGH', 'full fidelity'],
      ultra: ['ULTRA', 'cinematic'],
    };
    ['low','med','high','ultra'].forEach(p => {
      const key = p === 'med' ? 'medium' : p;
      const meta = presetMeta[p];
      const b = el('button', {
        type: 'button',
        class: 'preset-card',
        style: `text-align:left;cursor:pointer;${gfx.shadowQuality === (PRESETS[key].shadowQuality || gfx.shadowQuality) && gfx.floraDensity === (PRESETS[key].floraDensity || gfx.floraDensity) ? 'border-color:rgba(255,225,170,0.42);background:rgba(255,204,102,0.12);' : ''}`
      }, el('strong', {}, meta[0]), el('span', {}, meta[1]));
      b.addEventListener('click', () => { Object.assign(gfx, PRESETS[key]); rebuild(); applyAll(); save(); });
      presetRow.appendChild(b);
    });
    panel.appendChild(presetRow);

    panel.appendChild(el('div', { style: headerStyle }, 'AIRFRAME'));
    panel.appendChild(el('div', { style: 'font-size:9px;opacity:0.58;margin:-2px 0 8px;line-height:1.45;' }, 'All airframes. Click a card to load it, or press M in flight to cycle.'));
    const activePreset = getActivePropPreset();
    const planeGrid = el('div', { class: 'orientation-grid airframe-grid', style: 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-bottom:10px;' });
    PROP_MODEL_PRESETS.forEach((preset) => {
      const active = preset.key === activePreset.key;
      const btn = el('button', {
        type: 'button',
        style: [
          'display:grid',
          'gap:4px',
          'min-height:66px',
          'padding:10px 11px',
          'border-radius:14px',
          'text-align:left',
          'cursor:pointer',
          'background:' + (active ? 'linear-gradient(180deg, rgba(255,204,102,0.16), rgba(255,255,255,0.05))' : 'rgba(255,255,255,0.035)'),
          'border:1px solid ' + (active ? 'rgba(255,225,170,0.42)' : 'rgba(255,215,150,0.12)'),
          'color:#fff2cf',
          'box-shadow:' + (active ? 'inset 0 1px 0 rgba(255,255,255,0.08), 0 10px 24px rgba(0,0,0,0.18)' : 'none')
        ].join(';')
      });
      btn.appendChild(el('strong', { style: 'font-size:12px;line-height:1.15;letter-spacing:0.03em;color:#fff3d8;' }, preset.name || preset.label));
      const meta = el('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:9px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,231,176,0.58);' });
      meta.appendChild(el('span', {}, preset.type || 'Prop'));
      meta.appendChild(el('span', {
        style: 'display:inline-flex;align-items:center;justify-content:center;padding:3px 7px;border-radius:999px;border:1px solid rgba(255,225,170,0.2);background:rgba(255,255,255,0.04);color:rgba(255,242,207,0.9);'
      }, active ? 'ACTIVE' : (preset.badge || 'READY')));
      btn.appendChild(meta);
      btn.addEventListener('click', () => {
        if (!active) {
          applyPropModelPreset(preset.key);
          rebuild();
        }
      });
      planeGrid.appendChild(btn);
    });
    panel.appendChild(planeGrid);

    panel.appendChild(el('div', { style: headerStyle }, 'FLIGHT'));
    panel.appendChild(el('div', { style: 'font-size:9px;opacity:0.58;margin:-2px 0 8px;line-height:1.45;' }, 'Start simple: pick a control feel, pick an airframe role, then only open advanced tuning if you need it.'));
    const activeControlMeta = CONTROL_PRESETS[gfx.controlPreset] || null;
    panel.appendChild(el('div', { style: 'font-size:9px;opacity:0.52;margin:-2px 0 8px;line-height:1.45;' }, activeControlMeta
      ? `Control feel: ${activeControlMeta.title} · ${activeControlMeta.note}`
      : 'Control feel: CUSTOM · advanced tuning is overriding the presets'));
    const controlPresetGrid = el('div', { class: 'orientation-grid control-preset-grid', style: 'display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-bottom:10px;' });
    ['casual','balanced','responsive','direct'].forEach((key) => {
      const preset = CONTROL_PRESETS[key];
      const active = gfx.controlPreset === key;
      const btn = el('button', {
        type: 'button',
        style: flightCardStyle(active, key === 'balanced') + ';min-height:58px;'
      });
      btn.appendChild(el('strong', { style: 'font-size:11px;line-height:1.15;letter-spacing:0.03em;color:#fff3d8;' }, preset.title));
      btn.appendChild(el('span', { style: 'font-size:8px;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,231,176,0.58);' }, preset.note));
      btn.addEventListener('click', () => applyControlPreset(key));
      controlPresetGrid.appendChild(btn);
    });
    panel.appendChild(controlPresetGrid);
    const recommendedFlightProfile = recommendedFlightProfileForPlane(activePreset);
    const recommendedMeta = FLIGHT_PROFILES[recommendedFlightProfile];
    panel.appendChild(el('div', { style: 'font-size:9px;opacity:0.52;margin:-2px 0 8px;line-height:1.45;' }, `Airframe role for ${activePreset.name || activePreset.label}: ${recommendedMeta.title} · ${recommendedMeta.note}`));
    const flightProfileGrid = el('div', { class: 'orientation-grid flight-profile-grid', style: 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-bottom:10px;' });
    ['trainer','stunt','bush','racer'].forEach((key) => {
      const preset = FLIGHT_PROFILES[key];
      const active = gfx.flightProfile === key;
      const recommended = recommendedFlightProfile === key;
      const btn = el('button', { type: 'button', style: flightCardStyle(active, recommended) });
      btn.appendChild(el('strong', { style: 'font-size:12px;line-height:1.15;letter-spacing:0.03em;color:#fff3d8;' }, preset.title));
      btn.appendChild(el('span', { style: 'font-size:9px;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,231,176,0.58);' }, recommended ? `${preset.note} · recommended` : preset.note));
      btn.addEventListener('click', () => applyFlightProfilePreset(key));
      flightProfileGrid.appendChild(btn);
    });
    panel.appendChild(flightProfileGrid);
    panel.appendChild(makeSliderRow('flightAccel', 0.7, 2.4, 0.05, 'ACCELERATION', (v) => `${Math.round(v * 100)}%`));
    panel.appendChild(makeSliderRow('liftAssist', 0.7, 1.4, 0.05, 'LIFT / PULL', (v) => `${Math.round(v * 100)}%`));
    panel.appendChild(makeSliderRow('topSpeedKts', 220, 780, 10, 'TOP SPEED', (v) => `${Math.round(v)} KTS`));

    const advancedFlight = makeDetailsSection('ADVANCED FLIGHT TUNING', 'Fine power, authority, stall, damping, and landing helpers stay here so release-facing settings stay clean.', false);
    advancedFlight.body.appendChild(makeSliderRow('idlePower', 0, 1.6, 0.05, 'IDLE POWER', (v) => `${Math.round(v * 100)}%`));
    advancedFlight.body.appendChild(makeSliderRow('pitchAuthority', 0.6, 2.0, 0.05, 'PITCH AUTHORITY', (v) => `${Math.round(v * 100)}%`));
    advancedFlight.body.appendChild(makeSliderRow('rollAuthority', 0.6, 2.0, 0.05, 'ROLL / TURN', (v) => `${Math.round(v * 100)}%`));
    advancedFlight.body.appendChild(makeSliderRow('rudderAuthority', 0.6, 2.0, 0.05, 'RUDDER', (v) => `${Math.round(v * 100)}%`));
    advancedFlight.body.appendChild(makeSliderRow('autoRudder', 0, 2.0, 0.05, 'AUTO-RUDDER', (v) => `${Math.round(v * 100)}%`));
    advancedFlight.body.appendChild(makeSliderRow('maneuverAssist', 0.5, 1.8, 0.05, 'MANEUVER ASSIST', (v) => `${Math.round(v * 100)}%`));
    advancedFlight.body.appendChild(makeSliderRow('stallSoftness', 0.7, 1.5, 0.05, 'STALL SOFTNESS', (v) => `${Math.round(v * 100)}%`));
    advancedFlight.body.appendChild(makeSliderRow('groundEffectStrength', 0, 2.0, 0.05, 'GROUND EFFECT', (v) => `${Math.round(v * 100)}%`));
    advancedFlight.body.appendChild(makeSliderRow('brakeStrength', 0.5, 2.0, 0.05, 'BRAKE STRENGTH', (v) => `${Math.round(v * 100)}%`));
    advancedFlight.body.appendChild(makeSliderRow('selfLevel', 0, 2.0, 0.05, 'SELF-LEVEL', (v) => `${Math.round(v * 100)}%`));
    advancedFlight.body.appendChild(makeSliderRow('weathervaneYaw', 0, 2.0, 0.05, 'WEATHERVANE YAW', (v) => `${Math.round(v * 100)}%`));
    advancedFlight.body.appendChild(makeSliderRow('gearDrag', 0, 2.5, 0.05, 'GEAR DRAG', (v) => `${Math.round(v * 100)}%`));
    advancedFlight.body.appendChild(makeSliderRow('pitchDamping', 0.6, 1.8, 0.05, 'PITCH DAMPING', (v) => `${Math.round(v * 100)}%`));
    advancedFlight.body.appendChild(makeSliderRow('rollDamping', 0.6, 1.8, 0.05, 'ROLL DAMPING', (v) => `${Math.round(v * 100)}%`));
    advancedFlight.body.appendChild(makeSliderRow('rudderDamping', 0.6, 1.8, 0.05, 'RUDDER DAMPING', (v) => `${Math.round(v * 100)}%`));
    panel.appendChild(advancedFlight.wrap);

    const advancedCamera = makeDetailsSection('ADVANCED CHASE CAMERA', 'Only needed if you want to tune climb/dive reveal or the amount of delayed chase lag.', false);
    advancedCamera.body.appendChild(makeSliderRow('cameraClimbReveal', 0.4, 2.2, 0.05, 'CAM CLIMB REVEAL', (v) => `${Math.round(v * 100)}%`));
    advancedCamera.body.appendChild(makeSliderRow('cameraDiveReveal', 0.4, 2.2, 0.05, 'CAM DIVE REVEAL', (v) => `${Math.round(v * 100)}%`));
    advancedCamera.body.appendChild(makeSliderRow('cameraLag', 0.32, 1.8, 0.05, 'CHASE LAG', (v) => `${v.toFixed(2)}×`));
    panel.appendChild(advancedCamera.wrap);

    const advancedVisuals = makeDetailsSection('ADVANCED VISUALS & PERFORMANCE', 'Release-facing control starts with the quick presets above. Open this only when you need detailed image, world, lighting, shadow, or perf tuning.', false);
    advancedVisuals.body.appendChild(el('div', { style: headerStyle + 'margin-top:0;border-top:0;padding-top:0;' }, 'IMAGE / POST'));
    advancedVisuals.body.appendChild(row('Edge smoothing', makeToggle('fxaa')));
    advancedVisuals.body.appendChild(row('Depth of field', makeToggle('dof')));
    advancedVisuals.body.appendChild(row('Bloom', makeToggle('bloom')));
    advancedVisuals.body.appendChild(row('Motion blur', makeToggle('motionBlur')));
    advancedVisuals.body.appendChild(row('Replay hero light', makeToggle('replayHeroLight')));
    advancedVisuals.body.appendChild(makeSliderRow('resolutionScale', 0.75, 1.35, 0.05, 'AA / SUPERSAMPLE', (v) => `${Math.round(v * 100)}%`));
    advancedVisuals.body.appendChild(makeSliderRow('bloomStrength', 0.1, 0.9, 0.05, 'BLOOM STRENGTH', (v) => `${v.toFixed(2)}`));
    advancedVisuals.body.appendChild(makeSliderRow('motionBlurAmount', 0, 1.2, 0.05, 'MOTION BLUR AMOUNT', (v) => `${Math.round(v * 100)}%`));
    advancedVisuals.body.appendChild(el('div', { style: headerStyle }, 'SHADOWS'));
    advancedVisuals.body.appendChild(row('Cast shadows', makeToggle('shadowsOn')));
    advancedVisuals.body.appendChild(row('Quality', makeSegmented('shadowQuality', ['low','med','high','ultra'])));
    advancedVisuals.body.appendChild(makeSliderRow('shadowDistance', 140, 340, 10, 'SHADOW RANGE', (v) => `${Math.round(v)}m`));
    advancedVisuals.body.appendChild(el('div', { style: headerStyle }, 'ENVIRONMENT'));
    advancedVisuals.body.appendChild(row('Fog', makeToggle('fog')));
    advancedVisuals.body.appendChild(row('Cloud style', makeSegmented('cloudStyle', ['chunky','soft','fluffy'])));
    advancedVisuals.body.appendChild(row('Enhanced water', makeToggle('enhancedWater')));
    advancedVisuals.body.appendChild(makeSliderRow('cloudDensity', 0, 1, 0.05, 'CLOUDS'));
    advancedVisuals.body.appendChild(makeSliderRow('terrainFade', 0.15, 1.0, 0.05, 'DISTANCE FADE', (v) => `${Math.round(v * 100)}%`));
    advancedVisuals.body.appendChild(makeSliderRow('atmosphereDepth', 0.7, 1.25, 0.05, 'ATMOSPHERE DEPTH', (v) => `${v.toFixed(2)}×`));
    advancedVisuals.body.appendChild(makeSliderRow('floraDensity', 0.2, 1.6, 0.05, 'GROUND DETAIL', (v) => `${Math.round(v * 100)}%`));
    advancedVisuals.body.appendChild(makeSliderRow('floraCullDistance', 150, 800, 25, 'CULL RANGE', (v) => `${Math.round(v)}m`));
    advancedVisuals.body.appendChild(makeSliderRow('ambientFxDensity', 0, 1.2, 0.05, 'AMBIENT FX', (v) => `${Math.round(v * 100)}%`));

    advancedVisuals.body.appendChild(makeSliderRow('particleScale', 0.25, 1.5, 0.05, 'FX / PARTICLES'));
    advancedVisuals.body.appendChild(el('div', { style: headerStyle }, 'PRACTICE RINGS'));
    const activePracticeRingMeta = isPracticeRingPresetKey(gfx.practiceRingPreset) ? PRACTICE_RING_PRESETS[gfx.practiceRingPreset] : null;
    advancedVisuals.body.appendChild(el('div', { style: 'font-size:9px;opacity:0.52;margin:-2px 0 8px;line-height:1.45;' }, activePracticeRingMeta
      ? `Course preset: ${activePracticeRingMeta.title} · ${activePracticeRingMeta.note}`
      : 'Course preset: CUSTOM · manual ring tuning is overriding the presets'));
    const practiceRingPresetGrid = el('div', { class: 'orientation-grid practice-ring-grid', style: 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-bottom:10px;' });
    ['training','sport','dense','showcase'].forEach((key) => {
      const preset = PRACTICE_RING_PRESETS[key];
      const active = gfx.practiceRingPreset === key;
      const btn = el('button', { type: 'button', style: flightCardStyle(active, key === 'training') + ';min-height:58px;' });
      btn.appendChild(el('strong', { style: 'font-size:11px;line-height:1.15;letter-spacing:0.03em;color:#fff3d8;' }, preset.title));
      btn.appendChild(el('span', { style: 'font-size:8px;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,231,176,0.58);' }, preset.note));
      btn.addEventListener('click', () => applyPracticeRingPreset(key));
      practiceRingPresetGrid.appendChild(btn);
    });
    advancedVisuals.body.appendChild(practiceRingPresetGrid);
    advancedVisuals.body.appendChild(row('Show course', makeToggle('practiceRingEnabled')));
    advancedVisuals.body.appendChild(row('Ring tint', makeSegmented('practiceRingColor', ['cyan','amber','magenta','lime'])));
    const practiceRingMax = window.__practiceRingCourse ? window.__practiceRingCourse.length : 6;
    advancedVisuals.body.appendChild(makeSliderRow('practiceRingCount', 0, practiceRingMax, 1, 'ACTIVE RINGS', (v) => `${Math.round(v)}`));
    advancedVisuals.body.appendChild(makeSliderRow('practiceRingScale', 0.55, 1.8, 0.05, 'RING SIZE', (v) => `${Math.round(v * 100)}%`));
    advancedVisuals.body.appendChild(makeSliderRow('practiceRingGlow', 0, 1.8, 0.05, 'RING GLOW', (v) => `${Math.round(v * 100)}%`));
    advancedVisuals.body.appendChild(makeSliderRow('practiceRingOpacity', 0.15, 1.05, 0.05, 'RING OPACITY', (v) => `${Math.round(v * 100)}%`));
    advancedVisuals.body.appendChild(makeSliderRow('practiceRingDensity', 0.65, 1.45, 0.05, 'PATH DENSITY', (v) => `${v.toFixed(2)}×`));
    advancedVisuals.body.appendChild(makeSliderRow('practiceRingBob', 0, 1.8, 0.05, 'BOB AMOUNT', (v) => `${Math.round(v * 100)}%`));
    advancedVisuals.body.appendChild(makeSliderRow('practiceRingSpin', 0, 1.8, 0.05, 'SPIN SPEED', (v) => `${Math.round(v * 100)}%`));
    advancedVisuals.body.appendChild(el('div', { style: headerStyle }, 'WATER'));
    advancedVisuals.body.appendChild(makeSliderRow('waterReflectivity', 0.6, 1.8, 0.05, 'WATER REFLECTION', (v) => `${v.toFixed(2)}×`));
    advancedVisuals.body.appendChild(makeSliderRow('waterFresnel', 0.7, 1.8, 0.05, 'WATER FRESNEL', (v) => `${v.toFixed(2)}×`));
    advancedVisuals.body.appendChild(makeSliderRow('waterGlint', 0.4, 1.8, 0.05, 'SUN GLINT', (v) => `${v.toFixed(2)}×`));
    advancedVisuals.body.appendChild(makeSliderRow('waterOpacity', 0.7, 0.98, 0.01, 'WATER OPACITY', (v) => `${Math.round(v * 100)}%`));
    advancedVisuals.body.appendChild(el('div', { style: headerStyle }, 'LIGHTING'));
    advancedVisuals.body.appendChild(makeSliderRow('nightLift', 0, 0.9, 0.05, 'MOON / NIGHT LIFT', (v) => `${Math.round(v * 100)}%`));
    advancedVisuals.body.appendChild(makeSliderRow('airframeFill', 0, 1.4, 0.05, 'AIRFRAME FILL', (v) => `${Math.round(v * 100)}%`));
    advancedVisuals.body.appendChild(el('div', { style: headerStyle }, 'PERFORMANCE'));
    advancedVisuals.body.appendChild(row('FPS meter', makeToggle('fps')));
    advancedVisuals.body.appendChild(row('Adaptive resolution', makeToggle('adaptiveRes')));
    advancedVisuals.body.appendChild(makeSliderRow('renderScale', 0.5, 1.0, 0.05, 'RENDER SCALE'));
    advancedVisuals.body.appendChild(makeSliderRow('renderDistance', 0.6, 2.0, 0.1, 'RENDER DISTANCE', (v) => `${Math.round(v * 100)}%`));
    advancedVisuals.body.appendChild(el('div', { style: 'font-size:9px;opacity:0.48;margin-top:9px;line-height:1.45;' }, 'Adaptive resolution auto-scales render resolution down to hold ~60fps on weaker hardware (your sliders stay the ceiling). Render distance extends the far terrain + fog horizon. Shadow range, clouds, and ground detail are the safest live levers when tuning performance.'));
    panel.appendChild(advancedVisuals.wrap);
  };
  rebuild();
  const hudEl = document.getElementById('hud');
  (hudEl || document.body).appendChild(graphicsOverlay);

  fpsDiv = el('div', { id: 'fps-overlay', class: 'panel',
    style: `top:18px;right:210px;padding:4px 10px;font-size:10px;color:${AMBER};display:none;pointer-events:none;`
  }, 'FPS —');
  (hudEl || document.body).appendChild(fpsDiv);

  const openOptions = () => {
    if (document.pointerLockElement === renderer.domElement && document.exitPointerLock) {
      try { document.exitPointerLock(); } catch {}
    }
    graphicsOverlay.style.display = 'block';
    document.body.classList.add('options-open');
    if (typeof clearTouchControlsInput === 'function') clearTouchControlsInput({ keepThrottle: true });
  };
  const closeOptions = () => {
    graphicsOverlay.style.display = 'none';
    document.body.classList.remove('options-open');
  };
  const toggleOptions = () => {
    if (graphicsOverlay.style.display === 'block') closeOptions();
    else openOptions();
  };
  window.__toggleOptionsPanel = toggleOptions;
  const optionsBtn = document.getElementById('options-btn');
  if (optionsBtn) {
    optionsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleOptions();
      if ($hudActionsTray) {
        $hudActionsTray.open = false;
        syncHudActionsTray();
      }
    });
  }

  graphicsOverlay.addEventListener('pointerdown', (e) => {
    if (e.target === graphicsOverlay) closeOptions();
  });

  window.addEventListener('keydown', (e) => {
    const tgt = e.target;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
    if (e.code === 'KeyP' && !e.ctrlKey && !e.metaKey) {
      toggleOptions();
      e.preventDefault();
    } else if (e.code === 'Escape' && graphicsOverlay.style.display === 'block') {
      closeOptions();
    }
  });

  applyAll();
  clearLegacySettings();
  save();
  window.__gfxTick = tickFps;
})();
bootLog.step('graphics panel', !!document.getElementById('graphics-panel'),
  'press P · presets+persistence wired');

bootLog.step('boot complete', true,
  `total ${((performance.now() - bootLog.t0) / 1000).toFixed(2)}s · press R to reset`);

requestAnimationFrame(animate);

// __popup_focus_recovery__ — detect when browser UI/popups steal focus
// and aggressively reclaim it for the game canvas so flight controls
// remain responsive during all flight stages. Also handles visibility
// changes to pause/resume gracefully when tab is backgrounded.
window.addEventListener('blur', () => {
  // Delay slightly to let popup finish opening, then reclaim focus —
  // unless the user is mid-typing in a form field.
  setTimeout(() => { if (!isTypingTarget(document.activeElement)) renderer.domElement.focus(); }, 50);
});
window.addEventListener('focus', () => {
  if (isTypingTarget(document.activeElement)) return;
  renderer.domElement.focus();
});

// __visibility_pause__ — pause physics when tab hidden to prevent runaway state
// __visibility_pause_end__
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Tab hidden — pause to prevent runaway physics
    if (running) window.__ap && window.__ap.pause();
  } else {
    // Tab visible — resume and reclaim focus immediately
    if (window.__ap && window.__ap.isPaused()) window.__ap.resume();
    renderer.domElement.focus();
  }
});

// __popup_blocker_workaround__ — aggressive focus reclamation for overlay dismissal
// Twitter/X and other OAuth popups steal focus; reclaim it on any user interaction.
// Guarded: never steal focus from form fields (leaderboard / multiplayer setup)
// or from clicks on interactive controls, or typing into them is impossible.
window.addEventListener('click', (e) => {
  if (isTypingTarget(e.target) || isPreflightInteractiveTarget(e.target)) return;
  if (running) renderer.domElement.focus();
}, { capture: true });
window.addEventListener('keydown', (e) => {
  if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
  if (running) renderer.domElement.focus();
}, { capture: true });

// =============================================================
//  AUTOPILOT BRIDGE
//  Exposes window.__ap helpers used by the external autopilot
//  script (autopilot.mjs). These are intentionally hidden from
//  the AI — the AI only sees screenshots. The bridge just gives
//  the script pause/resume/reset/key-dispatch capabilities.
// =============================================================
window.__ap = {
  pause() { running = false; },
  resume() {
    // Ensure title overlay is gone so animate() actually runs physics
    const t = document.getElementById('title');
    if (t) t.classList.add('hide');
    running = true;
  },
  isPaused() { return !running; },
  isCrashed() { return !!plane.crashed; },
  reset() { resetPlane(); },
  telemetry() {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(plane.quat);
    let hdg = Math.atan2(fwd.x, -fwd.z) * 180 / Math.PI;
    if (hdg < 0) hdg += 360;
    const euler = new THREE.Euler().setFromQuaternion(plane.quat, 'YXZ');
    // roll: positive = right wing down; pitch: positive = nose up
    const pitchDeg = euler.x * 180 / Math.PI;
    const rollDeg = euler.z * 180 / Math.PI;
    const terrH = (typeof getHeight === 'function') ? getHeight(plane.pos.x, plane.pos.z) : 0;
    const localVel = plane.vel.clone().applyQuaternion(plane.quat.clone().invert());
    const fwdSpd = -localVel.z;
    const aoa = fwdSpd > 1 ? Math.atan2(-localVel.y, fwdSpd) * 180 / Math.PI : 0;
    return {
      t: Date.now(),
      spd_kts: plane.vel.length() * 1.94,
      alt_ft: plane.pos.y * 3.28,
      vs_ft_min: plane.vel.y * 197,
      hdg_deg: hdg,
      pitch_deg: pitchDeg,
      roll_deg: rollDeg,
      aoa_deg: aoa,
      agl_ft: Math.max(0, (plane.pos.y - terrH)) * 3.28,
      terrain_ft: terrH * 3.28,
      throttle: plane.throttle,
      gear: plane.gear,
      landing_lights: !!plane.landingLights,
      tod_phase: timeOfDay.phase,
      tod_label: timeOfDay.label,
      terrain_fade: scene.userData.__terrainFade != null ? scene.userData.__terrainFade : 0.58,
      night_lift: scene.userData.__nightLift != null ? scene.userData.__nightLift : 0.35,
      atmosphere_depth: scene.userData.__atmosphereDepth != null ? scene.userData.__atmosphereDepth : 1.0,
      airframe_fill: scene.userData.__airframeFill != null ? scene.userData.__airframeFill : 0.55,
      water_reflectivity: scene.userData.__waterReflectivity != null ? scene.userData.__waterReflectivity : 1.28,
      water_fresnel: scene.userData.__waterFresnel != null ? scene.userData.__waterFresnel : 1.12,
      water_glint: scene.userData.__waterGlint != null ? scene.userData.__waterGlint : 1.18,
      water_opacity: scene.userData.__waterOpacity != null ? scene.userData.__waterOpacity : 0.92,
      flight_accel: scene.userData.__flightAccel != null ? scene.userData.__flightAccel : 1.0,
      flight_top_speed_kts: scene.userData.__flightTopSpeedKts != null ? scene.userData.__flightTopSpeedKts : 580,
      flight_lift: scene.userData.__flightLift != null ? scene.userData.__flightLift : 1.0,
      flight_idle_power: scene.userData.__flightIdlePower != null ? scene.userData.__flightIdlePower : 1.0,
      flight_profile: (window.gfx && window.gfx.flightProfile) ? window.gfx.flightProfile : 'custom',
      control_preset: (window.gfx && window.gfx.controlPreset) ? window.gfx.controlPreset : 'balanced',
      pitch_rate_deg_s: plane.angVel.x * 180 / Math.PI,
      yaw_rate_deg_s: plane.angVel.y * 180 / Math.PI,
      roll_rate_deg_s: plane.angVel.z * 180 / Math.PI,
      angular_rate_deg_s: plane.angVel.length() * 180 / Math.PI,
      flight_pitch_authority: scene.userData.__flightPitchAuth != null ? scene.userData.__flightPitchAuth : 1.0,
      flight_roll_authority: scene.userData.__flightRollAuth != null ? scene.userData.__flightRollAuth : 1.0,
      flight_rudder_authority: scene.userData.__flightRudderAuth != null ? scene.userData.__flightRudderAuth : 1.0,
      flight_auto_rudder: scene.userData.__flightAutoRudder != null ? scene.userData.__flightAutoRudder : 1.0,
      flight_brake_strength: scene.userData.__flightBrake != null ? scene.userData.__flightBrake : 1.0,
      flight_self_level: scene.userData.__flightSelfLevel != null ? scene.userData.__flightSelfLevel : 1.0,
      flight_weathervane_yaw: scene.userData.__flightWeathervaneYaw != null ? scene.userData.__flightWeathervaneYaw : 1.0,
      flight_gear_drag: scene.userData.__flightGearDrag != null ? scene.userData.__flightGearDrag : 1.0,
      flight_ground_effect: scene.userData.__flightGroundEffect != null ? scene.userData.__flightGroundEffect : 1.0,
      flight_pitch_damping: scene.userData.__flightPitchDamp != null ? scene.userData.__flightPitchDamp : 1.0,
      flight_roll_damping: scene.userData.__flightRollDamp != null ? scene.userData.__flightRollDamp : 1.0,
      flight_rudder_damping: scene.userData.__flightRudderDamp != null ? scene.userData.__flightRudderDamp : 1.0,
      flight_stall_softness: scene.userData.__flightStallSoft != null ? scene.userData.__flightStallSoft : 1.0,
      flight_maneuver_assist: scene.userData.__flightManeuverAssist != null ? scene.userData.__flightManeuverAssist : 1.0,
      shadow_distance: scene.userData.__shadowDistance != null ? scene.userData.__shadowDistance : 230,
      flora_density: scene.userData.__floraDensity != null ? scene.userData.__floraDensity : 1.0,
      flora_cull_distance: scene.userData.__floraCullDistance != null ? scene.userData.__floraCullDistance : 450,
      ambient_fx_density: scene.userData.__ambientFxDensity != null ? scene.userData.__ambientFxDensity : 1.0,

      cloud_style: typeof currentCloudStyle === 'function' ? currentCloudStyle() : 'soft',
      landing_training_count: window.__landingTraining ? window.__landingTraining.length : 0,
      practice_ring_count: window.__practiceRingCourse ? window.__practiceRingCourse.length : 0,
      practice_ring_active_count: window.__practiceRingCourse ? (window.__practiceRingCourse.activeCount || 0) : 0,
      practice_ring_preset: (window.gfx && window.gfx.practiceRingPreset) ? window.gfx.practiceRingPreset : 'training',
      practice_ring_enabled: scene.userData.__practiceRingEnabled !== false,
      practice_ring_scale: scene.userData.__practiceRingScale != null ? scene.userData.__practiceRingScale : 1.0,
      practice_ring_glow: scene.userData.__practiceRingGlow != null ? scene.userData.__practiceRingGlow : 1.0,
      practice_ring_opacity: scene.userData.__practiceRingOpacity != null ? scene.userData.__practiceRingOpacity : 1.0,
      practice_ring_density: scene.userData.__practiceRingDensity != null ? scene.userData.__practiceRingDensity : 1.0,
      practice_ring_bob: scene.userData.__practiceRingBob != null ? scene.userData.__practiceRingBob : 1.0,
      practice_ring_spin: scene.userData.__practiceRingSpin != null ? scene.userData.__practiceRingSpin : 1.0,
      practice_ring_color: scene.userData.__practiceRingColor != null ? scene.userData.__practiceRingColor : 'cyan',
      airfield_clutter_count: airfieldAmbientState.clutterCount,
      world_bridge_count: worldOpportunities.bridgeCandidates.length,
      world_portal_count: worldOpportunities.portalCandidates.length,
      engine_sample_ready: !!audio.propSampleReady,
      engine_sample_mode: audio.propSampleMode,
      engine_sample_label: audio.engineSampleLabel,
      engine_sample_active: !!(audio.enabled && audio.propSampleReady && isPropAirframe()),
      prop_texture_blend: audio.propTextureBlend || 0,
      prop_detail_beds: Object.fromEntries(Object.entries(audio.propDetailBeds || {}).map(([k, v]) => [k, !!(v && v.ready && v.node)])),
      fxaa_enabled: !!(postFX.fxaaPass && postFX.fxaaPass.enabled),
      bloom_enabled: !!(postFX.bloomPass && postFX.bloomPass.enabled),
      bloom_strength: postFX.bloomPass ? postFX.bloomPass.strength : 0,
      motion_blur_enabled: window.gfx ? window.gfx.motionBlur !== false : true,
      motion_blur_amount: scene.userData.__motionBlurAmount != null ? scene.userData.__motionBlurAmount : 0.42,
      motion_blur_strength: postFX.motionBlurPass && postFX.motionBlurPass.uniforms ? (postFX.motionBlurPass.uniforms.strength.value || 0) : 0,
      dof_enabled: !!(postFX.enabled && postFX.bokehPass),
      flare_strength: sunGrp.userData.flareStrength || 0,
      sun_screen: sunGrp.userData.sunScreen || null,
      replay_hero_light: replayHeroRig.spot.visible ? replayHeroRig.spot.intensity : 0,
      replay_playing: !!replay.playing,
      replay_mode: replay.mode,
      aero_flex: { wing: aeroFlexState.wingBend, aileron: aeroFlexState.aileron, elevator: aeroFlexState.elevator, rudder: aeroFlexState.rudder },
      multiplayer_connected: !!multiplayerState.connected,
      remote_players: multiplayerState.remotePlayers.size,
      multiplayer_race_status: multiplayerRaceState.status,
      multiplayer_race_gate: multiplayerRaceState.localGateIndex,
      multiplayer_race_gate_count: multiplayerRaceState.gateCount,
      multiplayer_race_lap_ms: buildLocalRaceState().lapMs,
      multiplayer_race_best_ms: multiplayerRaceState.bestMs,
      traffic_planes: trafficEnabled() ? traffic.length : 0,
      traffic_loaded: trafficEnabled() ? traffic.filter(t => t.loaded).length : 0,
      traffic_alive: trafficEnabled() ? destructibleTargets.filter(t => t.alive && t.kind === 'traffic').length : 0,
      traffic_target_types: trafficEnabled() ? traffic.map(t => t.targetKind || (t.child && t.child.userData.__isUfoTarget ? 'ufo-saucer' : 'aircraft')) : [],
      pending_chunk_builds: pendingChunkBuilds.length,
      pending_far_chunk_builds: pendingFarChunkBuilds.length,
      projectile_count: combatState.projectiles.filter(p => p.active).length,
      ammo_count: combatState.ammo,
      ammo_max: combatState.ammoMax,
      ammo_start: combatState.ammoStart,
      ammo_earn_rate: combatState.ammoEarnRate,
      ammo_earn_bank: combatState.ammoEarnBank,
      ammo_earned_total: combatState.ammoEarnedTotal,
      missile_count: combatState.missiles.filter(m => m.active).length,
      surface_damage_marks: bulletSurfaceDamageFX ? bulletSurfaceDamageFX.activeCount() : 0,
      missiles_ammo: combatState.missilesAmmo,
      missiles_start: combatState.missilesStart,
      missiles_max: combatState.missilesMax,
      missile_earn_progress: combatState.missilesAmmo >= combatState.missilesMax ? 1 : clamp01(combatState.missileEarnBank || 0),
      missile_earn_interval_s: combatState.missileEarnInterval,
      missiles_earned_total: combatState.missilesEarnedTotal,
      supply_earn_active: combatSupplyEarnActive(),
      supply_earn_seconds: combatState.supplyEarnSeconds,
      shots_fired: combatState.shotsFired,
      combat_hits: combatState.shotHits,
      missiles_fired: combatState.missilesFired,
      missiles_hits: combatState.missileHits,
      combat_kills: combatState.kills,
      alien_weapon_active: alienWeaponActive(),
      alien_weapon_remaining_s: Math.max(0, (combatState.alienWeaponUntil - performance.now()) / 1000),
      targets_alive: destructibleTargets.filter(t => t.alive && t.object && t.object.visible !== false).length,
      landing_medal: landingMedalState.lastMedal,
      landing_grade: landingMedalState.lastGrade,
      landing_score: landingMedalState.lastScore,
      best_landing_grade: landingMedalState.bestGrade,
      best_landing_medal: landingMedalState.bestMedal,
      landing_complete: !!landingCompleteState.active,
      landing_bonus_points: landingCompleteState.bonusPoints || 0,
      propwash_active: !!propWashState.active,
      engine_surge_phase: engineSurgeState.phase,
      engine_surge_power: engineSurgeState.powerMul,
      turn_smoke_mix: engineSurgeState.greyMix,
      throat_clear_smoke: engineSurgeState.throatClear,
      wing_trail_intensity: scene.userData.__wingTrailIntensity || 0,
      camera_reveal: camera.userData.maneuverReveal || 0,
      camera_pitch_reveal: camera.userData.pitchReveal || 0,
      camera_climb_reveal: scene.userData.__cameraClimbReveal != null ? scene.userData.__cameraClimbReveal : 1.0,
      camera_dive_reveal: scene.userData.__cameraDiveReveal != null ? scene.userData.__cameraDiveReveal : 1.0,
      camera_lag: scene.userData.__cameraLag != null ? scene.userData.__cameraLag : 1.0,
      camera_fov: camera.fov,
      camera_height_offset: camera.userData.cameraHeightOffset || 0,
      camera_focus_y_offset: camera.userData.cameraFocusYOffset || 0,
      mouse_flight_enabled: !!INPUT_FLAGS.mouseFlight,
      touch_controls_enabled: typeof touchControlsState !== 'undefined' ? !!touchControlsState.enabled : false,
      touch_controls_supported: typeof touchControlsState !== 'undefined' ? !!touchControlsState.supported : false,
      touch_stick_x: typeof touchControlsState !== 'undefined' ? touchControlsState.stickX : 0,
      touch_stick_y: typeof touchControlsState !== 'undefined' ? touchControlsState.stickY : 0,
      touch_throttle: typeof touchControlsState !== 'undefined' ? touchControlsState.throttle : 0,
      touch_fire: typeof touchControlsState !== 'undefined' ? touchButtonActive('fire') : false,
      touch_missile: typeof touchControlsState !== 'undefined' ? touchButtonActive('missile') : false,
      touch_brake: typeof touchControlsState !== 'undefined' ? touchButtonActive('brake') : false,
      reticle_x: reticleState.x,
      reticle_y: reticleState.y,
      mouse_flight_steer_x: mouseFlightState.steerX,
      mouse_flight_steer_y: mouseFlightState.steerY,
      gamepad_connected: !!gamepadState.connected,
      gamepad_count: gamepadState.padCount || 0,
      gamepad_id: gamepadState.id || '',
      gamepad_mapping: gamepadState.mapping || '',
      gamepad_source: gamepadState.source || 'none',
      gamepad_profile: gamepadState.profile || 'standard',
      gamepad_pitch: gamepadState.pitch,
      gamepad_roll: gamepadState.roll,
      gamepad_yaw: gamepadState.yaw,
      gamepad_axes: (gamepadState.axesRaw || []).slice(0, 8),
      gamepad_buttons: (gamepadState.buttonsRaw || []).slice(0, 16),
      gamepad_throttle_up: gamepadState.throttleUp,
      gamepad_throttle_down: gamepadState.throttleDown,
      gamepad_fire: !!gamepadState.fire,
      gamepad_brake: !!gamepadState.brake,
      gamepad_gear: !!gamepadState.gear,
      gamepad_missile: !!gamepadState.missile,
      gamepad_lights: !!gamepadState.lights,
      gamepad_model: !!gamepadState.model,
      gamepad_race: !!gamepadState.race,
      gamepad_reset: !!gamepadState.reset,
      gamepad_last_input_age_ms: gamepadState.lastInputAt ? Math.max(0, performance.now() - gamepadState.lastInputAt) : null,
      target_boxes: targetHudState.visibleCount || 0,
      target_selectable_count: targetHudState.selectableCount || 0,
      target_selected: targetHudState.selectedId || '',
      target_selected_label: targetHudState.selectedLabel || '',
      target_selected_visible: !!targetHudState.selectedVisible,
      target_selected_index: targetHudState.selectedIndex || 0,
      target_cycle_count: targetHudState.selectedCycleCount || 0,
      target_lock: targetHudState.activeId || '',
      target_lock_label: targetHudState.activeLabel || '',
      target_lock_type: targetHudState.activeType || '',
      target_lock_distance_m: targetHudState.activeDistanceM || 0,
      target_lock_amount: targetHudState.lockAmount || 0,
      target_lock_tone: targetHudState.lockTone || 'off',
      aim_assist: targetHudState.aimAssist || 0,
      crash_fx_active: !!combatState.crashFxTriggered,
      flight_phase: flightPhaseState.label,
      mission_grade: missionDebriefState.grade,
      player_callsign: playerProfileState.callsign,
      spawn_mode: playerProfileState.spawnMode,
      plane_key: getActivePropPreset().key,
      plane_label: getActivePropPreset().name || getActivePropPreset().label,
      crashed: !!plane.crashed,
      pos: { x: plane.pos.x, y: plane.pos.y, z: plane.pos.z },
      on_ground: (plane.pos.y - terrH) < 2.5,
      // Plane config flags — let the pilot AI notice when something's wrong
      fixed_gear: !!plane.fixedGear,
      prop_count: (plane.props && plane.props.length) || 0,
      // Sum of recent rotation.z increments as a sanity check that props
      // are actually spinning. Pilot can compare across iterations.
      prop_spin_phase: plane.props && plane.props[0]
        ? Math.round((plane.props[0].rotation.z * 180 / Math.PI) % 360)
        : null,
    };
  },
  setTimeOfDay(phase) {
    if (!Number.isFinite(phase)) return;
    timeOfDay.phase = ((phase % 1) + 1) % 1;
    updateTimeOfDay(0);
  },
  setLandingLights(on) {
    plane.landingLights = !!on;
    if (typeof syncLandingIndicator === 'function') syncLandingIndicator();
  },
  previewLanding(sample = {}) {
    return evaluateLandingTouchdown(sample);
  },
  recordLandingPreview(sample = {}) {
    const result = recordLandingTouchdown(sample);
    captureMissionDebrief('LANDING REVIEW');
    if (typeof syncReplayUI === 'function') syncReplayUI();
    return result;
  },
  completeLandingPreview(sample = {}) {
    const result = recordLandingTouchdown(sample);
    landingCompleteState.touchdownAt = landingCompleteState.touchdownAt || performance.now();
    landingCompleteState.armed = false;
    landingCompleteState.active = !!result.onRunway;
    missionDebriefState.reason = result.onRunway ? 'LANDING COMPLETE' : 'LANDING REVIEW';
    if (result.onRunway) setFlightPhase('TAXI COMPLETE', 'ok');
    captureMissionDebrief(missionDebriefState.reason);
    if (typeof syncReplayUI === 'function') syncReplayUI();
    return result;
  },
  setMultiplayerUrl(url) {
    applyMultiplayerUrl(url);
    syncMultiplayerSetupUI();
  },
  startRace() {
    startMultiplayerRaceCountdown();
    return buildLocalRaceState();
  },
  raceState() {
    return buildLocalRaceState();
  },
  setCallsign(name) {
    setPlayerCallsign(name);
    syncMultiplayerSetupUI();
    return playerProfileState.callsign;
  },
  setSpawnMode(mode) {
    setPlayerSpawnMode(mode);
    return playerProfileState.spawnMode;
  },
  setPlaneModel(key) {
    if (!PROP_MODEL_BY_KEY.has(key)) return null;
    applyPropModelPreset(key);
    return key;
  },
  fire() { fireProjectileBurst(); },
  surfaceDamage(distance = 22, count = 6) {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(plane.quat).normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(plane.quat).normalize();
    const marks = [];
    for (let i = 0; i < Math.max(1, count | 0); i++) {
      const pos = plane.pos.clone()
        .addScaledVector(forward, distance + i * 0.55)
        .addScaledVector(right, (Math.random() - 0.5) * 2.6);
      const groundH = (pos.x * pos.x + pos.z * pos.z < AIRFIELD_FLAT_R2)
        ? AIRFIELD_SURFACE_Y : getHeight(pos.x, pos.z);
      pos.y = groundH + 0.05;
      spawnGunSurfaceDamage(pos, { type: 'bullet', size: 0.34 });
      marks.push({ x: pos.x, y: pos.y, z: pos.z });
    }
    return { marks, active: bulletSurfaceDamageFX ? bulletSurfaceDamageFX.activeCount() : 0 };
  },
  groundBlast(intensity = 1.0, distance = 22) {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(plane.quat).normalize();
    const pos = plane.pos.clone().addScaledVector(forward, distance);
    const groundH = (pos.x * pos.x + pos.z * pos.z < AIRFIELD_FLAT_R2)
      ? AIRFIELD_SURFACE_Y : getHeight(pos.x, pos.z);
    pos.y = groundH + 0.05;
    spawnGroundImpactExplosion(pos, intensity);
    return { pos: { x: pos.x, y: pos.y, z: pos.z }, intensity };
  },
  previewCombatHit(kind = 'traffic', kill = false) {
    const target = destructibleTargets.find(t => t.alive && (!kind || t.kind === kind));
    if (!target) return null;
    const pos = getTargetWorldPosition(target, new THREE.Vector3()).clone();
    if (kill) destroyTarget(target, pos.clone(), target.kind === 'traffic' ? 1.45 : 1.1, 'debug');
    else damageDestructible(target, pos.clone(), 1.0, target.kind === 'traffic' ? 1.45 : 1.0, 'debug');
    return {
      kind: target.kind,
      alive: target.alive,
      health: target.health,
      pos: { x: pos.x, y: pos.y, z: pos.z },
      telemetry: window.__ap.telemetry(),
    };
  },
  crash() {
    plane.crashed = true;
    plane.vel.set(0, 0, 0);
    combatState.crashFxTriggered = false;
    setFlightPhase('IMPACT', 'warn');
    captureMissionDebrief('TERRAIN IMPACT');
    if (typeof syncReplayUI === 'function') syncReplayUI();
    statusMsg.textContent = 'TERRAIN IMPACT — PRESS R';
    statusMsg.className = 'panel warn';
  },
  // Dispatch a real KeyboardEvent so the sim's keys[e.code] handler picks it up
  keyDown(code) {
    keys[code] = true;
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  },
  keyUp(code) {
    keys[code] = false;
    window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
  },
  setGamepad(state) {
    return setVirtualGamepadInput(state);
  },
  clearGamepad() {
    return clearVirtualGamepadInput();
  },
};
window.__mpRace = {
  start: () => {
    startMultiplayerRaceCountdown();
    return buildLocalRaceState();
  },
  state: () => buildLocalRaceState(),
  entries: () => [getLocalRaceEntry(), ...getRemoteRaceEntries()]
    .sort((a, b) => raceSortValue(b) - raceSortValue(a) || (a.local ? -1 : 1)),
};

function getCourseDirectorSnapshot() {
  const next = getNextPracticeRing();
  if (!next) return null;
  const target = next.ring.getWorldPosition(new THREE.Vector3());
  return {
    next_index: next.index + 1,
    active_count: next.course.activeCount || next.course.length,
    distance_m: plane.pos.distanceTo(target),
    target: { x: target.x, y: target.y, z: target.z },
    completed_runs: next.course.completedRuns || 0,
  };
}

window.render_game_to_text = () => {
  const telemetry = window.__ap && typeof window.__ap.telemetry === 'function' ? window.__ap.telemetry() : {};
  return JSON.stringify({
    coordinate_system: 'Three.js world; +Y up, aircraft starts near origin, forward runway departure is mostly -Z',
    mode: running ? (plane.crashed ? 'crashed' : 'flying') : 'paused',
    flight_phase: flightPhaseState.label,
    player: {
      pos: { x: plane.pos.x, y: plane.pos.y, z: plane.pos.z },
      vel: { x: plane.vel.x, y: plane.vel.y, z: plane.vel.z },
      speed_kts: telemetry.spd_kts,
      altitude_ft: telemetry.alt_ft,
      agl_ft: telemetry.agl_ft,
      heading_deg: telemetry.hdg_deg,
      pitch_deg: telemetry.pitch_deg,
      roll_deg: telemetry.roll_deg,
      aoa_deg: telemetry.aoa_deg,
      throttle: plane.throttle,
      gear: plane.gear,
      health: plane.health,
      on_ground: plane.onGround,
    },
    controls: {
      pitch: controlState.pitch,
      roll: controlState.roll,
      yaw: controlState.yaw,
      throttle_target: plane.throttleTarget,
      angular_rate_deg_s: telemetry.angular_rate_deg_s,
      pitch_rate_deg_s: telemetry.pitch_rate_deg_s,
      roll_rate_deg_s: telemetry.roll_rate_deg_s,
      yaw_rate_deg_s: telemetry.yaw_rate_deg_s,
    },
    score: window.__gameScore ? {
      points: window.__gameScore.points,
      streak: window.__gameScore.streak,
      best_streak: window.__gameScore.bestStreak,
    } : null,
    course: getCourseDirectorSnapshot(),
    multiplayer_race: {
      local: buildLocalRaceState(),
      remote_count: multiplayerState.remotePlayers.size,
      leaderboard: [getLocalRaceEntry(), ...getRemoteRaceEntries()]
        .sort((a, b) => raceSortValue(b) - raceSortValue(a) || (a.local ? -1 : 1))
        .slice(0, 5)
        .map(entry => ({
          callsign: entry.callsign,
          local: entry.local,
          status: entry.status,
          gate: entry.gateIndex,
          gate_count: entry.gateCount,
          lap_ms: entry.lapMs,
        })),
    },
    combat: {
      ammo: combatState.ammo,
      targets_alive: destructibleTargets.filter(t => t.alive && t.object && t.object.visible !== false).length,
      lock: targetHudState.activeLabel || '',
      lock_amount: targetHudState.lockAmount || 0,
    },
  });
};

window.advanceTime = (ms = 16.7) => {
  const total = Math.max(0, Number(ms) || 0);
  const steps = Math.max(1, Math.ceil(total / (1000 / 60)));
  const stepDt = total > 0 ? (total / steps) / 1000 : 1 / 60;
  if (!running && typeof beginFlight === 'function') beginFlight({ enableAudio: false, focusCanvas: false });
  for (let i = 0; i < steps; i++) {
    pollGamepadInput();
    updateInputLatches(stepDt);
    if (!replay.playing) {
      updateLivePhysicsSmooth(stepDt);
      replayRecord();
    }
    updateJetVisual();
    updateChunks(plane.pos.x, plane.pos.z);
    updateFarChunks(plane.pos.x, plane.pos.z);
    updateHorizonChunks(plane.pos.x, plane.pos.z);
    processChunkBuildQueues(2.5, 6);
    updateCamera(stepDt);
    updateAtmospheric(stepDt);
    updateShadow();
    updateSunShadowRig();
    updateHeat(stepDt);
    updateTraffic(stepDt);
    if (typeof updateGenerativeInstallations === 'function') updateGenerativeInstallations(stepDt);
    updatePracticeRingCourse(stepDt);
    updateWater(stepDt, plane.pos.x, plane.pos.z);
    updateMissionDebrief(stepDt, plane.vel.length() * 1.94);
    updateLandingCompleteFlow(plane.vel.length() * 1.94);
    updateHUD(stepDt);
    updateCombat(stepDt);
    if (typeof updateGateScoring === 'function') updateGateScoring(stepDt);
    if (window.__damageDecalUpdate) window.__damageDecalUpdate(stepDt);
    // FX: particle pools, atmospheric, jet visuals
    if (typeof updateAtmospheric === 'function') updateAtmospheric(stepDt);
    if (typeof updateJetVisual === 'function') updateJetVisual(stepDt);
    if (typeof updateHeat === 'function') updateHeat(stepDt);
    if (typeof contrail !== 'undefined' && contrail) contrail.update(stepDt);
    if (typeof vaporL !== 'undefined' && vaporL) vaporL.update(stepDt);
    if (typeof vaporR !== 'undefined' && vaporR) vaporR.update(stepDt);
    if (typeof updateClouds === 'function') updateClouds(stepDt, plane.pos.x, plane.pos.z);
    if (typeof updateLensFlare === 'function') updateLensFlare();
    if (typeof updateDepthOfField === 'function') updateDepthOfField();
    if (typeof updateMotionBlurPostFX === 'function') updateMotionBlurPostFX();
    if (typeof renderScene === 'function') renderScene();
    if (window.__gfxTick) window.__gfxTick();
  }
  sky.position.copy(camera.position);
  sunGrp.position.copy(camera.position).addScaledVector(sunDir, 4500);
  moonGrp.position.copy(camera.position).addScaledVector(sunDir, -4300);
  starField.position.copy(camera.position);
  updateLensFlare();
  updateClouds(stepDt, plane.pos.x, plane.pos.z);
  updateDepthOfField();
  updateMotionBlurPostFX();
  renderScene();
};

// — Autopilot launcher button (visible to humans; the AI treats it as
//   just another UI element and can ignore it).
(function addAutopilotButton() {
  if (!AUTOPILOT_UI) return;
  const btn = document.createElement('button');
  btn.id = 'autopilot-btn';
  btn.textContent = '🤖 AUTOPILOT';
  btn.style.cssText = `
    position: fixed; top: 14px; right: 50%; transform: translateX(50%);
    background: rgba(20,30,50,0.85); color: #4ecbff;
    border: 1px solid #2a4060; border-radius: 6px;
    font: 12px/1.2 ui-monospace, Menlo, monospace; letter-spacing: 0.15em;
    padding: 8px 14px; cursor: pointer; z-index: 500;
    backdrop-filter: blur(4px);
  `;
  btn.onmouseenter = () => { btn.style.borderColor = '#4ecbff'; };
  btn.onmouseleave = () => { btn.style.borderColor = '#2a4060'; };
  btn.onclick = () => {
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed; inset: 0; background: rgba(5,8,15,0.9); z-index: 2000;
      display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(8px);
    `;
    modal.innerHTML = `
      <div style="background:#101828; color:#cfe3ff; border:1px solid #2a4060;
                   border-radius:10px; padding:24px; width:min(560px, 92vw);
                   font:13px/1.5 ui-monospace, Menlo, monospace;">
        <h3 style="margin:0 0 12px; color:#4ecbff; letter-spacing:0.2em; font-size:13px;">
          🤖 AUTOPILOT · LEARN-TO-FLY
        </h3>
        <p style="margin:0 0 10px; color:#a8bcd8;">
          An AI will take over this browser and try to learn to fly the Disney Dusty plane
          from scratch — only from screenshots, with no access to the game code.
          It reads the on-screen control legend, experiments, crashes, resets, and updates
          its own skill notebook between attempts.
        </p>
        <p style="margin:0 0 8px; color:#a8bcd8;">Run this in a terminal:</p>
        <pre id="ap-cmd" style="background:#050810; color:#5df09a; padding:10px 12px;
              border-radius:6px; margin:0 0 10px; overflow-x:auto; font-size:12px;
              border:1px solid #1f2a44;">cd /Users/jkneen/Downloads/ships &amp;&amp; node autopilot.mjs</pre>
        <div style="display:flex; gap:8px; justify-content:flex-end;">
          <button id="ap-copy" style="background:transparent; color:#4ecbff;
                border:1px solid #2a4060; border-radius:4px; padding:6px 14px;
                font:inherit; cursor:pointer;">Copy</button>
          <button id="ap-close" style="background:transparent; color:#a8bcd8;
                border:1px solid #2a4060; border-radius:4px; padding:6px 14px;
                font:inherit; cursor:pointer;">Close</button>
        </div>
        <p style="margin:12px 0 0; font-size:11px; color:#6a7fa0;">
          Requires FIREWORKS_API_KEY env var. Progress + learned skills written to
          <code>autopilot-skills.json</code>.
        </p>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    modal.querySelector('#ap-close').onclick = () => modal.remove();
    modal.querySelector('#ap-copy').onclick = () => {
      navigator.clipboard.writeText(modal.querySelector('#ap-cmd').textContent);
      modal.querySelector('#ap-copy').textContent = '✓ Copied';
    };
  };
  document.body.appendChild(btn);
})();

// Second prewarm pass at end of script evaluation: the boot pass ran before
// the saucer traffic, ring courses, and saved gfx settings existed, so those
// lit materials would still lazy-compile on the first mid-game aux-light
// toggle. Already-compiled states are program-cache hits, so this pass costs
// only the genuinely missing programs.
prewarmLightStatePrograms();
try { renderer.compile(scene, camera); } catch (e) {}  // current state, in case it's outside the prewarm enum
