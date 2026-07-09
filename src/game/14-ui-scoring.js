// @module src/game/14-ui-scoring.js
// =============================================================
//  START SCREEN
// =============================================================
const title = document.getElementById('title');
document.getElementById('seed-display').textContent = SEED;
function isPreflightInteractiveTarget(target) {
  return !!(target && target.closest && target.closest('input, button, label, .multiplayer-setup-card, .menu-banner, #menu-panels'));
}
function beginFlight(opts = {}) {
  if (running) return;
  const enableAudio = opts.enableAudio !== false;
  const focusCanvas = opts.focusCanvas !== false;
  if (title) title.classList.add('hide');
  document.body.classList.remove('preflight');
  running = true;
  resetMissionDebrief();
  helpStripState.autoCollapsed = true;
  setHelpStripCollapsed(true);
  if ($hudActionsTray) { $hudActionsTray.open = false; syncHudActionsTray(); }
  if (enableAudio) {
    setAudioEnabled(true);
    syncAudioIndicator();
  }
  if (focusCanvas) renderer.domElement.focus();
}
function armFirstInteractionAudio() {
  let armed = true;
  const unlock = () => {
    if (!armed) return;
    armed = false;
    setAudioEnabled(true);
    syncAudioIndicator();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}
title.addEventListener('click', (e) => {
  if (isPreflightInteractiveTarget(e.target)) return;
  renderer.domElement.focus();
  beginFlight();
});
// Also allow any key to start
window.addEventListener('keydown', (e) => {
  if (isPreflightInteractiveTarget(e.target)) return;
  if (!running) {
    renderer.domElement.focus();
    beginFlight();
  }
}, { once: true });
armFirstInteractionAudio();
beginFlight({ enableAudio: false, focusCanvas: false });

// __branded_intro__ — beginFlight above hides the title instantly, so the
// branded intro was never seen. Keep the sim warm underneath but re-show
// the intro card + backdrop until the first real user input dismisses it.
document.body.classList.add('preflight');
if (title) title.classList.remove('hide');
let introDismissHandler = null;
function dismissIntro() {
  document.body.classList.remove('preflight');
  if (title) title.classList.add('hide');
  if (introDismissHandler) {
    window.removeEventListener('pointerdown', introDismissHandler, true);
    window.removeEventListener('keydown', introDismissHandler, true);
  }
  try { renderer.domElement.focus(); } catch {}
}
(function armIntroDismiss() {
  introDismissHandler = (e) => {
    if (document.body.classList.contains('options-open')) return;
    if (isTypingTarget(e.target) || isPreflightInteractiveTarget(e.target)) return;
    dismissIntro();
  };
  window.addEventListener('pointerdown', introDismissHandler, true);
  window.addEventListener('keydown', introDismissHandler, true);
})();

// __retro_menu__ — main menu nav: PLAY SOLO dismisses the intro directly;
// MULTIPLAYER/CONTROLS/ABOUT/PLANES toggle a sub-panel (one open at a time);
// SETTINGS opens the graphics panel OVER the menu (intro stays; guarded in armIntroDismiss).
(function wireMenuNav() {
  const panels = { mp: 'menu-panel-mp', controls: 'menu-panel-controls', about: 'menu-panel-about', planes: 'menu-panel-planes' };
  const buttons = { mp: 'menu-btn-mp', controls: 'menu-btn-controls', about: 'menu-btn-about', planes: 'menu-btn-planes' };
  let activePanel = null;
  function setActivePanel(name) {
    activePanel = name;
    for (const key of Object.keys(panels)) {
      const panelEl = document.getElementById(panels[key]);
      const btnEl = document.getElementById(buttons[key]);
      const show = key === name;
      if (panelEl) panelEl.hidden = !show;
      if (btnEl) btnEl.setAttribute('aria-expanded', String(show));
      // an opened panel (esp. the hangar grid) can sit below the fold on
      // short viewports — bring it into view
      if (panelEl && show) setTimeout(() => panelEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 60);
    }
  }
  function toggleMenuPanel(name) {
    setActivePanel(activePanel === name ? null : name);
  }
  function buildHangar() {
    const grid = document.getElementById('hangar-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const active = getActivePropPreset();
    PROP_MODEL_PRESETS.forEach((preset) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'hangar-card' + (preset.key === active.key ? ' active' : '');
      card.dataset.planeKey = preset.key;
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = preset.name || preset.label;
      img.src = `assets/ui/planes/${preset.key}.jpg`;
      img.addEventListener('error', () => card.classList.add('no-thumb'));
      card.appendChild(img);
      const body = document.createElement('div');
      body.className = 'hangar-card-body';
      const nameEl = document.createElement('span');
      nameEl.className = 'hangar-card-name';
      nameEl.textContent = preset.name || preset.label;
      body.appendChild(nameEl);
      const meta = document.createElement('div');
      meta.className = 'hangar-card-meta';
      const type = document.createElement('span');
      type.textContent = preset.type || 'Airframe';
      const badge = document.createElement('span');
      badge.className = 'hangar-card-badge';
      badge.textContent = preset.key === active.key ? 'ACTIVE' : (preset.badge || 'READY');
      meta.appendChild(type);
      meta.appendChild(badge);
      body.appendChild(meta);
      card.appendChild(body);
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (preset.key === active.key) return;
        try { sessionStorage.setItem('e115-loading-name', preset.name || preset.label); } catch {}
        try { localStorage.setItem('flight_prop_model_key', preset.key); } catch {}
        applyPropModelPreset(preset.key);
      });
      grid.appendChild(card);
    });
  }
  buildHangar();
  const soloBtn = document.getElementById('menu-btn-solo');
  if (soloBtn) soloBtn.addEventListener('click', (e) => { e.stopPropagation(); dismissIntro(); });
  const mpBtn = document.getElementById('menu-btn-mp');
  if (mpBtn) mpBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenuPanel('mp'); });
  const controlsBtn = document.getElementById('menu-btn-controls');
  if (controlsBtn) controlsBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenuPanel('controls'); });
  const aboutBtn = document.getElementById('menu-btn-about');
  if (aboutBtn) aboutBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenuPanel('about'); });
  const planesBtn = document.getElementById('menu-btn-planes');
  if (planesBtn) planesBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenuPanel('planes'); });
  const settingsBtn = document.getElementById('menu-btn-settings');
  if (settingsBtn) settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (typeof window.__toggleOptionsPanel === 'function') window.__toggleOptionsPanel();
  });
})();

// __plane_loading_flash__ — brief LOADING overlay after a reload-based hangar select
(function showPlaneLoadingFlash() {
  let name = null;
  try { name = sessionStorage.getItem('e115-loading-name'); sessionStorage.removeItem('e115-loading-name'); } catch {}
  if (!name) return;
  const o = document.createElement('div');
  o.id = 'plane-loading-flash';
  o.textContent = 'LOADING ' + name;
  o.style.cssText = 'position:fixed;inset:0;z-index:10030;display:flex;align-items:center;justify-content:center;background:rgba(6,8,12,0.92);color:#ffcc66;font:800 20px/1 var(--game-font-ui, sans-serif);letter-spacing:0.2em;text-transform:uppercase;transition:opacity 0.4s ease;';
  document.body.appendChild(o);
  setTimeout(() => { o.style.opacity = '0'; }, 700);
  setTimeout(() => { o.remove(); }, 1200);
})();

// __overlay_dismiss_focus__ — re-focus game canvas on any click/key
// so external popups (Twitter/X sign-in, etc.) don't block input
window.addEventListener('click', (e) => {
  if (isTypingTarget(e.target) || isPreflightInteractiveTarget(e.target)) return;
  renderer.domElement.focus();
});
window.addEventListener('keydown', (e) => {
  if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
  renderer.domElement.focus();
});

// __popup_focus_recovery__ — detect when browser UI/popups steal focus
// and aggressively reclaim it for the game canvas so flight controls
// remain responsive during all flight stages
window.addEventListener('blur', () => {
  // Delay slightly to let popup finish opening, then reclaim focus —
  // unless the user is mid-typing in a form field.
  setTimeout(() => { if (!isTypingTarget(document.activeElement)) renderer.domElement.focus(); }, 50);
});
window.addEventListener('focus', () => {
  if (isTypingTarget(document.activeElement)) return;
  renderer.domElement.focus();
});

// =============================================================
//  RESIZE
// =============================================================
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.fov = aspectCorrectedCameraFov(camera.userData.lensFov || CAMERA_BASE_FOV, camera.aspect);
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  updateFxaaPassResolution();
  if (postFX.bloomPass && postFX.bloomPass.setSize) postFX.bloomPass.setSize(window.innerWidth / 2, window.innerHeight / 2);
  if (postFX.composer) {
    if (postFX.composer.setPixelRatio) postFX.composer.setPixelRatio(renderer.getPixelRatio());
    postFX.composer.setSize(window.innerWidth, window.innerHeight);
    if (postFX.bokehPass && postFX.bokehPass.materialBokeh && postFX.bokehPass.materialBokeh.uniforms.aspect) {
      postFX.bokehPass.materialBokeh.uniforms.aspect.value = camera.aspect;
    }
    if (postFX.motionBlurPass && postFX.motionBlurPass.uniforms && postFX.motionBlurPass.uniforms.aspect) {
      postFX.motionBlurPass.uniforms.aspect.value = camera.aspect;
    }
  }
  if (typeof reticleState !== 'undefined') {
    reticleState.x = Math.max(24, Math.min(window.innerWidth - 24, reticleState.visible ? reticleState.x : window.innerWidth * 0.5));
    reticleState.y = Math.max(24, Math.min(window.innerHeight - 24, reticleState.visible ? reticleState.y : window.innerHeight * RETICLE_SCREEN_Y_RATIO));
    reticleState.vx = 0;
    reticleState.vy = 0;
    if (typeof mouseFlightState !== 'undefined') {
      mouseFlightState.targetX = Math.max(24, Math.min(window.innerWidth - 24, mouseFlightState.targetX || window.innerWidth * 0.5));
      mouseFlightState.targetY = Math.max(24, Math.min(window.innerHeight - 24, mouseFlightState.targetY || window.innerHeight * 0.43));
    }
    if ($crosshair) {
      $crosshair.style.left = `${reticleState.x}px`;
      $crosshair.style.top = `${reticleState.y}px`;
    }
  }
});
if (window.visualViewport) {
  let visualViewportResizeRaf = 0;
  const requestVisualViewportResize = () => {
    if (visualViewportResizeRaf) cancelAnimationFrame(visualViewportResizeRaf);
    visualViewportResizeRaf = requestAnimationFrame(() => {
      visualViewportResizeRaf = 0;
      window.dispatchEvent(new Event('resize'));
    });
  };
  window.visualViewport.addEventListener('resize', requestVisualViewportResize);
  window.visualViewport.addEventListener('scroll', requestVisualViewportResize);
}
document.addEventListener('fullscreenchange', () => {
  window.dispatchEvent(new Event('resize'));
});

// Apply default style (low-poly) once all HUD refs + scene state exist,
// so the sky / materials match the HUD indicator from frame one.
applyStyle();
// Default biome: desert. Reuses the same code path as the in-game [Y]
// switcher so sky, fog, lights, sand shader, clouds, dust devils, HUD
// label and chunks all align from frame one.
applyBiome('desert');

// __world_feature_runway_markers__ — Runway threshold markers and corner pylons
(function addRunwayEndMarkers() {
  const markerGroup = new THREE.Group();
  
  // Threshold stripe dimensions
  const stripeWidth = 2.0;
  const stripeLength = 9.0;
  const stripeGap = 2.4;
  const runwayHalfWidth = 17; // runway is 34 wide
  
  // Materials
  const whiteMat = new THREE.MeshBasicMaterial({ color: 0xfff0cc });
  const orangeMat = new THREE.MeshBasicMaterial({ color: 0xff6600 });
  const coneMat = new THREE.MeshStandardMaterial({ 
    color: 0xff4400, 
    emissive: 0x882200, 
    emissiveIntensity: 0.3,
    roughness: 0.4 
  });
  
  // Create threshold stripes (chevron pattern) at both ends
  const ends = [-200, 200];
  ends.forEach((zPos, endIdx) => {
    // Direction: stripes point inward toward runway center
    const dir = endIdx === 0 ? 1 : -1; // -150 end points +Z, +150 end points -Z
    
    // 5 stripes per side, angled in a V toward center
    for (let i = 0; i < 5; i++) {
      const xOffset = (i + 1) * stripeGap;
      
      // Left side stripe
      const leftStripe = new THREE.Mesh(
        new THREE.PlaneGeometry(stripeWidth, stripeLength),
        whiteMat
      );
      leftStripe.rotation.x = -Math.PI / 2;
      leftStripe.rotation.z = dir * 0.3; // angle inward
      leftStripe.position.set(-xOffset, AIRFIELD_SURFACE_Y + 0.01, zPos + dir * (i * 1.5));
      markerGroup.add(leftStripe);
      
      // Right side stripe
      const rightStripe = new THREE.Mesh(
        new THREE.PlaneGeometry(stripeWidth, stripeLength),
        whiteMat
      );
      rightStripe.rotation.x = -Math.PI / 2;
      rightStripe.rotation.z = -dir * 0.3; // angle inward
      rightStripe.position.set(xOffset, AIRFIELD_SURFACE_Y + 0.01, zPos + dir * (i * 1.5));
      markerGroup.add(rightStripe);
    }
    
    // Corner pylons (4 per end = 8 total)
    const cornerOffsets = [
      { x: -runwayHalfWidth - 3, z: zPos + (endIdx === 0 ? -8 : 8) },
      { x: runwayHalfWidth + 3, z: zPos + (endIdx === 0 ? -8 : 8) },
      { x: -runwayHalfWidth - 6, z: zPos + (endIdx === 0 ? 8 : -8) },
      { x: runwayHalfWidth + 6, z: zPos + (endIdx === 0 ? 8 : -8) }
    ];
    
    cornerOffsets.forEach((off, ci) => {
      // Pylon base
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(0.4, 0.6, 0.8, 8),
        new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8 })
      );
      base.position.set(off.x, 0.4, off.z);
      markerGroup.add(base);
      
      // Cone
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.5, 2.5, 8),
        coneMat
      );
      cone.position.set(off.x, 1.65, off.z);
      markerGroup.add(cone);
      
      // White reflective band
      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, 0.4, 8),
        whiteMat
      );
      band.position.set(off.x, 2.0, off.z);
      markerGroup.add(band);
    });
  });

  const runwayNumberBoards = [];
  const makeBoardTexture = (label) => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 160;
    const g2 = c.getContext('2d');
    g2.fillStyle = '#13161d';
    g2.fillRect(0, 0, c.width, c.height);
    g2.strokeStyle = '#fff4cf';
    g2.lineWidth = 10;
    g2.strokeRect(10, 10, c.width - 20, c.height - 20);
    g2.fillStyle = '#fff4cf';
    g2.font = '700 96px system-ui';
    g2.textAlign = 'center';
    g2.textBaseline = 'middle';
    g2.fillText(label, c.width / 2, c.height / 2 + 4);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace || tex.colorSpace;
    return tex;
  };
  [
    { label: '36', z: -214, dir: -1 },
    { label: '18', z: 214, dir: 1 },
  ].forEach((cfg) => {
    const tex = makeBoardTexture(cfg.label);
    [-1, 1].forEach((side) => {
      const sign = new THREE.Group();
      const postL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.8, 0.14), new THREE.MeshStandardMaterial({ color: 0x37363c, roughness: 0.8 }));
      postL.position.set(-1.2, 1.4, 0);
      sign.add(postL);
      const postR = postL.clone();
      postR.position.x = 1.2;
      sign.add(postR);
      const board = new THREE.Mesh(
        new THREE.PlaneGeometry(3.4, 2.1),
        new THREE.MeshStandardMaterial({ map: tex, color: 0xffffff, roughness: 0.78, metalness: 0.06, emissive: 0x17140f, emissiveIntensity: 0.08 })
      );
      board.position.y = 2.3;
      sign.add(board);
      sign.position.set(side * (runwayHalfWidth + 7.2), 0, cfg.z);
      sign.rotation.y = side < 0 ? Math.PI * 0.08 : -Math.PI * 0.08;
      markerGroup.add(sign);
      runwayNumberBoards.push(sign);
    });
  });
  window.__runwayNumberBoards = runwayNumberBoards;
  
  scene.add(markerGroup);
})();

// =============================================================
//  GATE SCORING — every ring registered via registerGate() gets
//  pass-through detection. First traversal awards points, plays a
//  chime, and flashes the ring white briefly.
// =============================================================
window.__allGates = [];
window.__gameScore = {
  points: 0,
  banked: 0,
  unbanked: 0,
  streak: 0,        // count of gates in the current chain
  lastHitAt: 0,
  lastKind: null,   // kind of the last gate hit (for same-color bonus)
  kindRun: 0,       // how many of the same kind in a row
  bestStreak: 0,
};
window.__gameMatch = {
  durationMs: 5 * 60 * 1000,
  noRespawnMs: 60 * 1000,
  startedAt: performance.now(),
  ended: false,
};
function matchRemainingMs() {
  const match = window.__gameMatch;
  return Math.max(0, (match.startedAt || 0) + match.durationMs - performance.now());
}
function canRespawnNow() {
  const match = window.__gameMatch;
  return !!match && !match.ended && matchRemainingMs() > match.noRespawnMs;
}
function formatMatchClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function updateMatchState() {
  const match = window.__gameMatch;
  if (!match || match.ended) return;
  const remaining = matchRemainingMs();
  if (remaining > 0) return;
  match.ended = true;
  bankScore('GAME END');
  captureMissionDebrief('GAME COMPLETE');
  plane.crashed = true;
  replay.eventT = performance.now();
  setFlightPhase('GAME OVER', 'warn');
  if (typeof window.showComboBanner === 'function') window.showComboBanner('GAME COMPLETE', `${window.__gameScore.banked || 0} BANKED · PRESS R NEW GAME`, '#72ff91');
  if (typeof syncReplayUI === 'function') syncReplayUI();
}

// Top-of-screen notification banner. Bigger, punchier feedback for streaks,
// stunts and world awards so the sim reads more like a game and less like a
// silent scoring counter.
(function setupComboBanner() {
  const hud = document.getElementById('hud');
  if (!hud) return;
  const banner = document.createElement('div');
  banner.id = 'combo-banner';
  banner.className = 'mission-banner-shell game-dialog-chrome';
  banner.style.cssText = [
    'position:absolute','top:calc(96px + var(--safe-top))','right:calc(16px + var(--safe-right))','left:auto','transform:translateX(120%)',
    'max-width:min(390px, calc(100vw - 32px))','padding:14px 18px 12px','pointer-events:none','opacity:0',
    'transition:opacity 0.24s ease, transform 0.28s cubic-bezier(.2,.9,.2,1), box-shadow 0.18s ease','z-index:32'
  ].join(';');
  const pulse = document.createElement('div');
  pulse.style.cssText = [
    'position:absolute','top:calc(132px + var(--safe-top))','right:calc(48px + var(--safe-right))','left:auto','width:220px','height:220px','transform:translate(40%, -50%) scale(0.7)',
    'border-radius:999px','pointer-events:none','opacity:0','transition:opacity 0.22s ease, transform 0.22s ease',
    'background:radial-gradient(circle, rgba(255,224,160,0.18), rgba(255,160,96,0.06) 40%, rgba(255,120,72,0) 70%)','z-index:31',
  ].join(';');
  hud.appendChild(pulse);
  hud.appendChild(banner);
  const bannerPulseFx = { banner, pulse };
  window.bannerPulseFx = bannerPulseFx;
  let hideTimer = null;
  window.showComboBanner = (text, sub, accent) => {
    const color = accent || '#ffe0a0';
    banner.style.color = color;
    banner.style.borderColor = color;
    banner.style.boxShadow = `0 14px 38px rgba(0,0,0,0.45), 0 0 30px ${color}33`;
    while (banner.firstChild) banner.removeChild(banner.firstChild);
    const big = document.createElement('div');
    big.textContent = text;
    big.style.cssText = 'font:900 24px/0.92 var(--game-font-ui);letter-spacing:-0.045em;color:#fff3d4;text-shadow:0 8px 24px rgba(0,0,0,0.55);';
    banner.appendChild(big);
    if (sub) {
      const s = document.createElement('div');
      s.textContent = sub;
      s.style.cssText = 'font:800 10px/1.32 var(--game-font-ui);opacity:0.92;margin-top:7px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,235,196,0.9);';
      banner.appendChild(s);
    }
    banner.style.opacity = '1';
    banner.style.transform = 'translateX(0)';
    pulse.style.opacity = '1';
    pulse.style.transform = 'translate(40%, -50%) scale(1.08)';
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      banner.style.opacity = '0';
      banner.style.transform = 'translateX(120%)';
      pulse.style.opacity = '0';
      pulse.style.transform = 'translate(40%, -50%) scale(1.45)';
    }, 2300);
  };
  window.showScoreBurst = (text, sub = '', accent = '#ffe0a0') => {
    const pop = document.createElement('div');
    pop.style.cssText = [
      'position:absolute','left:50%','top:42%','transform:translate(-50%, -50%) scale(0.82)',
      'z-index:34','pointer-events:none','text-align:center','font-family:var(--game-font-ui)',
      `color:${accent}`,'text-shadow:0 8px 34px rgba(0,0,0,0.72), 0 0 34px currentColor',
      'transition:opacity 0.75s ease, transform 0.75s cubic-bezier(.2,1.4,.25,1)','opacity:0'
    ].join(';');
    pop.innerHTML = `<div style="font-size:clamp(54px,9vw,104px);font-weight:950;line-height:.82;letter-spacing:-.08em;color:#fff6da;">${String(text).replace(/[<&]/g, c => c === '<' ? '&lt;' : '&amp;')}</div>${sub ? `<div style="margin-top:10px;font-size:18px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;">${String(sub).replace(/[<&]/g, c => c === '<' ? '&lt;' : '&amp;')}</div>` : ''}`;
    hud.appendChild(pop);
    requestAnimationFrame(() => {
      pop.style.opacity = '1';
      pop.style.transform = 'translate(-50%, -56%) scale(1.0)';
    });
    setTimeout(() => {
      pop.style.opacity = '0';
      pop.style.transform = 'translate(-50%, -72%) scale(1.16)';
    }, 820);
    setTimeout(() => pop.remove(), 1650);
  };
})();
function registerGate(ring, opts = {}) {
  ring.userData.isGate = true;
  ring.userData.scored = false;
  ring.userData.gateRadius = opts.radius || 30;
  ring.userData.gatePoints = opts.points || 100;
  ring.userData.gateKind = opts.kind || 'ring';
  ring.userData.gateLabel = opts.label || null;
  window.__allGates.push(ring);
  return ring;
}
function syncScoreTotals(score = window.__gameScore) {
  if (!score) return 0;
  score.banked = Math.max(0, Math.round(score.banked || 0));
  score.unbanked = Math.max(0, Math.round(score.unbanked || 0));
  score.points = score.banked + score.unbanked;
  return score.points;
}
function awardUnbankedPoints(amount = 0, label = 'POINTS', accent = '#ffe0a0') {
  const score = window.__gameScore;
  const pts = Math.max(0, Math.round(amount || 0));
  if (!score || pts <= 0) return 0;
  score.unbanked = (score.unbanked || 0) + pts;
  syncScoreTotals(score);
  if (typeof recordCombatScore === 'function') recordCombatScore(pts);
  if (typeof window.showScoreBurst === 'function') window.showScoreBurst(`+${pts}`, `${label} · UNBANKED ${score.unbanked}`, accent);
  return pts;
}
function bankScore(reason = 'BANK RING') {
  const score = window.__gameScore;
  if (!score) return 0;
  const deposit = Math.max(0, Math.round(score.unbanked || 0));
  if (deposit <= 0) {
    if (typeof flashStatus === 'function') flashStatus(`${reason} · NOTHING TO BANK`, 'panel warn', 0.9);
    return 0;
  }
  score.banked = (score.banked || 0) + deposit;
  score.unbanked = 0;
  syncScoreTotals(score);
  if (typeof window.showComboBanner === 'function') window.showComboBanner('POINTS BANKED', `+${deposit} SAFE · ${score.banked} BANK`, '#72ff91');
  if (typeof flashStatus === 'function') flashStatus(`${reason} · ${deposit} POINTS SAFE`, 'panel ok', 1.4);
  return deposit;
}
// Plays a short WebAudio chime (two-tone arpeggio) — no sample needed.
// Pitch shifts up with streak so back-to-back hits feel more rewarding.
function playGateChime(streak) {
  if (!audio.ctx || !audio.enabled) return;
  const ct = audio.ctx.currentTime;
  const baseFreq = 680 + Math.min(streak, 10) * 55;
  [0, 0.08].forEach((off, i) => {
    const osc = audio.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = baseFreq * (i === 0 ? 1 : 1.5);
    const g = audio.ctx.createGain();
    g.gain.setValueAtTime(0, ct + off);
    g.gain.linearRampToValueAtTime(0.22, ct + off + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, ct + off + 0.45);
    osc.connect(g).connect(audio.master);
    osc.start(ct + off);
    osc.stop(ct + off + 0.5);
  });
}
const _gateWorldPos = new THREE.Vector3();
function updateGateScoring(dt) {
  if (plane.crashed || replay.playing) return;
  const now = performance.now();
  const score = window.__gameScore;
  // Break the streak if more than 6s since last hit
  if (now - score.lastHitAt > 6000) score.streak = 0;
  for (const ring of window.__allGates) {
    if (!ring.userData.isGate || ring.userData.scored) continue;
    if (!ring.parent) continue;
    const ringWorldPos = ring.getWorldPosition(_gateWorldPos);
    // Squared-distance broad phase: skip the sqrt for the common far-away case
    const r = ring.userData.gateRadius;
    if (plane.pos.distanceToSquared(ringWorldPos) < r * r) {
      const kind = ring.userData.gateKind || 'ring';
      if (kind === 'bank') {
        if (now - (ring.userData.lastBankAt || 0) < 2200) continue;
        ring.userData.lastBankAt = now;
        bankScore(ring.userData.gateLabel || 'BANK RING');
        playGateChime(Math.max(1, score.streak || 1));
        if (ring.material && ring.material.emissive) {
          ring.material.emissive.setHex(0xffffff);
          ring.material.emissiveIntensity = 2.8;
          setTimeout(() => { if (ring.material) ring.material.emissiveIntensity = ring.userData.__baseEmissiveInt || 1.1; }, 360);
        }
        continue;
      }
      const practiceCourse = kind === 'practice' ? window.__practiceRingCourse : null;
      if (practiceCourse && practiceCourse.enabled !== false) {
        const activeCount = practiceCourse.activeCount || practiceCourse.length || 0;
        const nextIndex = Math.max(0, Math.min(activeCount - 1, practiceCourse.nextIndex || 0));
        if (ring.userData.__courseIndex !== nextIndex) continue;
      }
      ring.userData.scored = true;
      score.streak += 1;
      score.bestStreak = Math.max(score.bestStreak, score.streak);

      // Same-kind chain bonus: passing successive gates of the same
      // type (e.g. climb → climb → climb) multiplies the reward.
      if (score.lastKind === kind) {
        score.kindRun += 1;
      } else {
        score.kindRun = 1;
        score.lastKind = kind;
      }
      const kindBonus = Math.min(4, score.kindRun);

      // Stunt detection — reward unusual attitudes when threading a gate.
      // Reads attitude from the live plane state at the moment of pass.
      const euler = new THREE.Euler().setFromQuaternion(plane.quat, 'YXZ');
      const rollDeg = Math.abs(euler.z * 57.3);
      const pitchDeg = Math.abs(euler.x * 57.3);
      const rollRate = Math.abs(plane.angVel.z);
      const localVel = plane.vel.clone().applyQuaternion(plane.quat.clone().invert());
      const fwdSpd = Math.max(0, -localVel.z);
      const aoa = fwdSpd > 1 ? Math.abs(Math.atan2(-localVel.y, fwdSpd)) * 57.3 : 0;

      const stunts = [];
      let stuntMul = 1;
      const agl = Math.max(0, plane.pos.y - getHeight(plane.pos.x, plane.pos.z));
      const gateLabel = ring.userData.gateLabel || `${kind.toUpperCase()} GATE`;
      const accentByKind = {
        climb: '#ff7bff',
        cruise: '#66f6ff',
        arch: '#ffe69a',
        bridge: '#4ecbff',
        portal: '#7fdcff',
        practice: '#7fe6ff',
      };
      const gateAccent = accentByKind[kind] || '#ffe0a0';
      if (kind === 'bridge') { stunts.push('BRIDGE RUN'); stuntMul *= 1.8; }
      if (kind === 'portal') { stunts.push('PORTAL SHOT'); stuntMul *= 2.0; }
      if (kind === 'arch') { stunts.push('STONE THREAD'); stuntMul *= 1.6; }
      if (rollDeg > 150) { stunts.push('INVERTED'); stuntMul *= 3; }
      else if (rollDeg > 80) { stunts.push('KNIFE-EDGE'); stuntMul *= 2.5; }
      else if (rollDeg > 45) { stunts.push('BANKED'); stuntMul *= 1.5; }
      if (rollRate > 2.5) { stunts.push('BARREL-ROLL'); stuntMul *= 1.8; }
      if (pitchDeg > 60) { stunts.push('VERTICAL'); stuntMul *= 2; }
      if (aoa > 18) { stunts.push('HIGH-α'); stuntMul *= 1.4; }
      if (agl < 28 && fwdSpd > 35) { stunts.push('LOW RUN'); stuntMul *= 1.35; }

      // Final point calc: base × streak × kind × stunt — caps at 5×
      // streak so late-game points don't run away.
      const streakMul = Math.min(5, score.streak);
      const pts = Math.round(ring.userData.gatePoints * streakMul * kindBonus * stuntMul);
      awardUnbankedPoints(pts, `${gateLabel} · ${score.streak}× CHAIN`, gateAccent);
      score.lastHitAt = now;
      if (practiceCourse) {
        const activeCount = practiceCourse.activeCount || practiceCourse.length || 0;
        practiceCourse.nextIndex = Math.min(activeCount, (practiceCourse.nextIndex || 0) + 1);
        if (typeof recordMultiplayerRaceGate === 'function') {
          recordMultiplayerRaceGate(practiceCourse.nextIndex, activeCount);
        }
        if (practiceCourse.nextIndex >= activeCount && activeCount > 0) {
          practiceCourse.completedRuns = (practiceCourse.completedRuns || 0) + 1;
          practiceCourse.nextIndex = 0;
          const courseBonus = Math.round(360 + activeCount * 70 + Math.min(score.streak, 12) * 25);
          awardUnbankedPoints(courseBonus, 'COURSE CLEAR BONUS', gateAccent);
          for (const courseRing of practiceCourse) {
            courseRing.userData.scored = false;
          }
          if (typeof window.showComboBanner === 'function') {
            window.showComboBanner('COURSE CLEAR', `+${courseBonus} BONUS · RUN ${practiceCourse.completedRuns}`, gateAccent);
          }
          if (typeof flashStatus === 'function') {
            flashStatus(`PRACTICE COURSE CLEAR · +${courseBonus}`, 'panel ok', 1.6);
          }
        }
      }
      if (typeof recordMissionMoment === 'function') {
        recordMissionMoment({ kind, gateLabel, stunts, points: pts });
      }

      if (stunts.length > 0 && (plane.health < 100 || plane.damage.airframe > 0 || plane.damage.engine > 0)) {
        repairPlaneSystems(Math.min(8, 2 + stunts.length * 2), 'STUNT REPAIR');
      }

      playGateChime(score.streak);
      const upgradeMsg = practiceCourse
        ? grantPracticeReward(ring.userData.upgradeReward || { type: 'ammo', amount: 30 }, gateLabel)
        : '';
      if (practiceCourse) {
        window.__courseGateRewardCount = (window.__courseGateRewardCount || 0) + 1;
        if (window.__courseGateRewardCount % 3 === 0 && typeof addOverdriveCharge === 'function') {
          addOverdriveCharge(1);
          if (typeof flashStatus === 'function') flashStatus('OVERDRIVE CHARGE EARNED', 'panel ok', 1.1);
        }
      }
      if (!practiceCourse) {
        if (combatState) combatState.ammo = Math.min(combatState.ammoMax, combatState.ammo + 20);
        if (plane.health < 100 || plane.damage.airframe > 0 || plane.damage.engine > 0) repairPlaneSystems(2, 'STUNT REPAIR');
      }

      if (ring.material && ring.material.emissive) {
        const origCol = ring.material.emissive.clone();
        ring.material.emissive.setHex(0xffffff);
        ring.material.emissiveIntensity = 2.5;
        setTimeout(() => {
          if (ring.material) {
            ring.material.emissive.copy(origCol);
            ring.material.emissiveIntensity = 0.15;
            ring.material.opacity = 0.35;
          }
        }, 400);
      }

      // Top-banner notifications for milestones + stunts.
      if (typeof window.showComboBanner === 'function') {
        if (stunts.length > 0) {
          window.showComboBanner(
            stunts.join(' + '),
            `${gateLabel} · +${pts} · ${score.points} TOTAL · ×${(streakMul * kindBonus * stuntMul).toFixed(1)}`,
            gateAccent
          );
        } else if (ring.userData.gateLabel) {
          window.showComboBanner(gateLabel, `${upgradeMsg ? upgradeMsg + ' · ' : ''}+${pts} · ${score.points} TOTAL`, gateAccent);
        } else if (score.streak === 3) {
          window.showComboBanner('TRIPLE!', `+${pts}`, '#ffcc66');
        } else if (score.streak === 5) {
          window.showComboBanner('STREAK ×5', `${score.points} TOTAL`, '#ff9448');
        } else if (score.streak >= 10 && score.streak % 5 === 0) {
          window.showComboBanner(`STREAK ×${score.streak}`, `${score.points} TOTAL`, '#ff5533');
        } else if (score.kindRun >= 3) {
          window.showComboBanner(
            `${kind.toUpperCase()} CHAIN ×${score.kindRun}`,
            `+${pts}`, gateAccent
          );
        }
      }

      if (typeof flashStatus === 'function') {
        flashStatus(`${gateLabel} · +${pts} · ${score.streak}× · ${score.points}`, 'panel ok', 1.2);
      }
    }
  }
}
function resetGateScoring(respawn = false) {
  const score = window.__gameScore;
  if (respawn) {
    const lost = Math.max(0, Math.round(score.unbanked || 0));
    score.unbanked = 0;
    syncScoreTotals(score);
    if (lost > 0 && typeof window.showComboBanner === 'function') window.showComboBanner('RESPAWN', `${lost} UNBANKED POINTS LOST · ${score.banked || 0} BANKED`, '#ff8f5e');
  } else {
    score.points = 0;
    score.banked = 0;
    score.unbanked = 0;
  }
  score.streak = 0;
  score.lastHitAt = 0;
  score.lastKind = null;
  score.kindRun = 0;
  score.bestStreak = 0;
  if (window.__practiceRingCourse) {
    window.__practiceRingCourse.nextIndex = 0;
    window.__practiceRingCourse.completedRuns = 0;
  }
  for (const ring of window.__allGates) {
    ring.userData.scored = false;
    if (ring.material && ring.userData.__origEmissive != null) {
      if (ring.material.emissive) {
        ring.material.emissive.setHex(ring.userData.__origEmissive);
        ring.material.emissiveIntensity = ring.userData.__origEmissiveInt;
      }
      ring.material.opacity = ring.userData.__origOpacity;
    }
  }
}

// __world_feature_bank_rings__ — fly through these to secure unbanked points.
(function addBankRings() {
  const ringGeo = new THREE.TorusGeometry(34, 2.2, 16, 72);
  const innerGeo = new THREE.TorusGeometry(18, 0.7, 10, 56);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x72ff91,
    emissive: 0x20d86a,
    emissiveIntensity: 1.15,
    roughness: 0.22,
    metalness: 0.18,
    transparent: true,
    opacity: 0.94,
  });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xd8ffe0, transparent: true, opacity: 0.44, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const points = [
    new THREE.Vector3(0, 150, -520),
    new THREE.Vector3(-360, 210, -1840),
    new THREE.Vector3(410, 250, -3180),
  ];
  window.__bankRings = [];
  for (let i = 0; i < points.length; i++) {
    const ring = new THREE.Mesh(ringGeo, mat.clone());
    ring.position.copy(points[i]);
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(i % 2 ? 0.35 : -0.25, 0.02, -1).normalize());
    ring.userData.__baseEmissiveInt = 1.15;
    ring.userData.label = `BANK RING ${i + 1}`;
    const inner = new THREE.Mesh(innerGeo, glowMat.clone());
    inner.renderOrder = 5;
    ring.add(inner);
    scene.add(ring);
    registerGate(ring, { radius: 38, points: 0, kind: 'bank', label: ring.userData.label });
    window.__bankRings.push(ring);
  }
})();

// __world_feature_climb_rings__ — Magenta ring gates for climb practice.
// Spaced out along the corridor and topped up with a few alternates so
// the player always has a gate in sight. All registered for scoring.
(function addClimbRings() {
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0xff00ff, emissive: 0xff00ff, emissiveIntensity: 0.8,
    roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.9,
  });
  const ringGeo = new THREE.TorusGeometry(30, 1.5, 16, 64);
  const positions = [
    { x:    0, y:  80, z:  -400 },
    { x: -120, y: 150, z:  -900 },
    { x:  140, y: 220, z: -1500 },
    { x:    0, y: 300, z: -2200 },
    { x: -180, y: 380, z: -3000 },
    { x:  220, y: 460, z: -3900 },
    { x:    0, y: 540, z: -4900 },
    { x: -260, y: 620, z: -6000 },
    { x:  300, y: 700, z: -7200 },
  ];

  window.__climbRings = [];
  positions.forEach((pos, i) => {
    const ring = new THREE.Mesh(ringGeo, ringMat.clone());
    ring.position.set(pos.x, pos.y, pos.z);
    ring.userData.ringIndex = i;
    ring.userData.baseY = pos.y;
    ring.userData.phase = i * 2.1;
    ring.userData.__origEmissive = 0xff00ff;
    ring.userData.__origEmissiveInt = 0.8;
    ring.userData.__origOpacity = 0.9;
    scene.add(ring);
    window.__climbRings.push(ring);
    registerGate(ring, { radius: 32, points: 100, kind: 'climb' });
  });
  window._ringPulsePhase = 0;
})();

// __world_feature_cruise_rings__ — 6 floating ring gates for cruise curriculum
(function addCruiseRings() {
  const RING_COUNT = 6;
  const RING_RADIUS = 28;
  const TUBE_RADIUS = 1.2;
  const ALTITUDE = 180;
  const START_Z = -1200;
  const END_Z = -3000;
  
  const cyanMat = new THREE.MeshStandardMaterial({
    color: 0x00ffff,
    emissive: 0x00ffff,
    emissiveIntensity: 0.9,
    roughness: 0.2,
    metalness: 0.1,
    transparent: true,
    opacity: 0.85
  });
  
  const magentaMat = new THREE.MeshStandardMaterial({
    color: 0xff00ff,
    emissive: 0xff00ff,
    emissiveIntensity: 0.9,
    roughness: 0.2,
    metalness: 0.1,
    transparent: true,
    opacity: 0.85
  });
  
  const ringGeo = new THREE.TorusGeometry(RING_RADIUS, TUBE_RADIUS, 12, 48);
  
  // S-curve parameters: gentle horizontal snake
  const S_AMPLITUDE = 80; // max x offset from centerline
  
  for (let i = 0; i < RING_COUNT; i++) {
    const t = i / (RING_COUNT - 1); // 0 to 1
    const z = START_Z + t * (END_Z - START_Z);
    
    // S-curve: sine wave with half period over the full distance
    // starts at x=0, curves right, then back to x=0
    const x = Math.sin(t * Math.PI) * S_AMPLITUDE * (i % 2 === 0 ? 1 : -1);
    
    // Slight altitude variation for visual interest (±15m)
    const y = ALTITUDE + Math.sin(t * Math.PI * 2) * 15;
    
    const mat = i % 2 === 0 ? cyanMat : magentaMat;
    const ring = new THREE.Mesh(ringGeo, mat);
    ring.position.set(x, y, z);
    
    // Rings stand vertical (hole on Z, facing the player). A small yaw
    // rotation orients each gate to face the S-curve tangent so the hole
    // aligns with the approach heading, and a mild bank tilt sells the
    // "follow the line" feel.
    const tangentX = Math.cos(t * Math.PI) * S_AMPLITUDE * Math.PI / (END_Z - START_Z) * (END_Z - START_Z);
    const headingY = Math.atan2(tangentX, (END_Z - START_Z) / RING_COUNT) * 0.8;
    const bankTilt = headingY * 0.35 * (i % 2 === 0 ? 1 : -1);
    ring.rotation.y = headingY;
    ring.rotation.z = bankTilt;
    
    ring.userData.ringIndex = i;
    ring.userData.baseY = y;
    ring.userData.phase = i * 0.7;
    ring.userData.__origEmissive = i % 2 === 0 ? 0x00ffff : 0xff00ff;
    ring.userData.__origEmissiveInt = 0.9;
    ring.userData.__origOpacity = 0.85;
    scene.add(ring);
    registerGate(ring, { radius: 30, points: 120, kind: 'cruise' });
  }
  window._cruiseRingsAdded = true;
})();

// __world_feature_rock_arches__ — Natural-looking rock arches that
// the player can fly under. Built from a torus half (the arch) plus
// two tapered base columns seated on the terrain. Each arch doubles
// as a scoring gate that awards extra points for the "flew under"
// moment.
(function addRockArches() {
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x887a65, roughness: 0.95, metalness: 0.02,
    flatShading: true,
  });
  const archPositions = [
    { x:  -800, z: -1400, yaw:  0.3, scale: 1.2 },
    { x:  1600, z: -2600, yaw: -0.6, scale: 1.5 },
    { x: -1800, z: -3800, yaw:  1.1, scale: 1.0 },
    { x:   600, z: -5200, yaw: -0.2, scale: 1.8 },
    { x:  2400, z:  -400, yaw:  0.9, scale: 1.3 },
    { x: -2200, z:   600, yaw: -1.3, scale: 1.6 },
  ];
  window.__rockArches = [];
  archPositions.forEach((p, i) => {
    const arch = new THREE.Group();
    const baseH = Math.max(15, getHeight(p.x, p.z));
    const archR = 55 * p.scale;       // opening radius — big enough to fly through
    const tubeR = 10 * p.scale;       // thickness
    // Upper arch: half torus
    const torus = new THREE.Mesh(
      new THREE.TorusGeometry(archR, tubeR, 9, 24, Math.PI),
      rockMat.clone()
    );
    torus.rotation.z = Math.PI;        // flat side down
    torus.position.y = archR * 0.5;
    arch.add(torus);
    // Base columns: stone feet on either side of the opening
    for (const side of [-1, 1]) {
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(tubeR * 1.6, tubeR * 1.9, archR, 7),
        rockMat.clone()
      );
      col.position.set(side * archR, archR * 0.0, 0);
      arch.add(col);
    }
    arch.position.set(p.x, baseH, p.z);
    arch.rotation.y = p.yaw;
    applyShadowFlags(arch);
    scene.add(arch);
    window.__rockArches.push(arch);
    // Score gate sitting inside the opening. Radius slightly smaller
    // than the arch so the player has to actually fly through, not
    // just near it.
    const gate = new THREE.Mesh(
      new THREE.TorusGeometry(archR * 0.75, 0.6, 8, 24),
      new THREE.MeshBasicMaterial({
        color: 0xfff3a8, transparent: true, opacity: 0.18, toneMapped: false,
      })
    );
    gate.position.copy(arch.position);
    gate.position.y += archR * 0.45;
    gate.rotation.y = p.yaw + Math.PI / 2;
    scene.add(gate);
    gate.userData.__origEmissive = 0xfff3a8;
    gate.userData.__origEmissiveInt = 0;
    gate.userData.__origOpacity = 0.18;
    registerGate(gate, { radius: archR * 0.7, points: 400, kind: 'arch' });
  });
})();

// __world_feature_sky_bridges__ — Sci-fi bridges spanning canyons.
// Flat slab held up by pylon supports at each end. Tall enough that
// the player can pass OVER them and low enough to buzz UNDER in the
// right approach.
(function addSkyBridges() {
  const deckMat = new THREE.MeshStandardMaterial({
    color: 0x3d4756, roughness: 0.55, metalness: 0.4, flatShading: true,
  });
  const railMat = new THREE.MeshBasicMaterial({
    color: 0xffcc66, toneMapped: false,
  });
  const pylonMat = new THREE.MeshStandardMaterial({
    color: 0x2a313a, roughness: 0.6, metalness: 0.3,
  });
  const bridges = [
    { x:     0, z: -2000, yaw: 0,           span: 320, h: 160 },
    { x:  -600, z: -4600, yaw: 0.8,         span: 420, h: 220 },
    { x:  1800, z:   800, yaw: Math.PI / 2, span: 280, h: 140 },
    { x: -2000, z:  -800, yaw: -0.3,        span: 360, h: 200 },
  ].concat((worldOpportunities.bridgeCandidates || []).map((cand, idx) => ({
    x: cand.x,
    z: cand.z,
    yaw: cand.yaw,
    span: cand.span,
    h: cand.h,
    generated: true,
    id: idx,
  })));
  window.__skyBridges = [];
  bridges.forEach((b, i) => {
    const g = new THREE.Group();
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(b.span, 4, 14),
      deckMat.clone()
    );
    deck.position.y = b.h;
    g.add(deck);
    // Side guard rails — thin emissive strips that read at night
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(b.span, 0.4, 0.3),
        railMat.clone()
      );
      rail.position.set(0, b.h + 2.2, side * 7);
      g.add(rail);
    }
    // Pylons — one at each end, tapered cones
    const pylonH = b.h + 8;
    for (const end of [-1, 1]) {
      const pylon = new THREE.Mesh(
        new THREE.CylinderGeometry(4, 11, pylonH, 7),
        pylonMat.clone()
      );
      pylon.position.set(end * b.span * 0.5, pylonH * 0.5, 0);
      g.add(pylon);
    }
    g.position.set(b.x, 0, b.z);
    g.rotation.y = b.yaw;
    applyShadowFlags(g);
    scene.add(g);
    window.__skyBridges.push(g);
    // Score gate positioned MID-DECK, below the deck — awards the
    // player for flying *under* a bridge. Radius is narrow so the
    // player must actually thread the gap.
    const underGate = new THREE.Mesh(
      new THREE.TorusGeometry(35, 0.5, 6, 20),
      new THREE.MeshBasicMaterial({ color: 0x4ecbff, transparent: true, opacity: 0.18, toneMapped: false })
    );
    underGate.position.set(b.x, b.h * 0.55, b.z);
    underGate.rotation.y = b.yaw + Math.PI / 2;
    scene.add(underGate);
    underGate.userData.__origEmissive = 0x4ecbff;
    underGate.userData.__origEmissiveInt = 0;
    underGate.userData.__origOpacity = 0.18;
    registerGate(underGate, {
      radius: 34,
      points: b.generated ? 650 : 500,
      kind: 'bridge',
      label: b.generated ? 'GENERATED BRIDGE RUN' : 'BRIDGE RUN',
    });
  });
})();

// __world_feature_mountain_portals__ — Procedural rock portals anchored high
// on ridges so the world has dramatic fly-through moments that feel tied to
// the landscape instead of hand-placed every time.
(function addMountainPortals() {
  const portals = worldOpportunities.portalCandidates || [];
  if (!portals.length) return;
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x82735f, roughness: 0.96, metalness: 0.03, flatShading: true,
  });
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0x7fdcff, transparent: true, opacity: 0.22, toneMapped: false,
  });
  window.__mountainPortals = [];
  portals.forEach((p, idx) => {
    const group = new THREE.Group();
    const outer = new THREE.Mesh(
      new THREE.TorusGeometry(p.radius, p.radius * 0.24, 8, 18),
      rockMat.clone()
    );
    group.add(outer);
    for (const side of [-1, 1]) {
      const buttress = new THREE.Mesh(
        new THREE.CylinderGeometry(p.radius * 0.18, p.radius * 0.34, p.depth, 7),
        rockMat.clone()
      );
      buttress.rotation.z = Math.PI / 2;
      buttress.position.set(side * (p.radius * 0.82), -p.radius * 0.1, 0);
      group.add(buttress);
    }
    group.position.set(p.x, p.y, p.z);
    group.rotation.y = p.yaw;
    applyShadowFlags(group);
    scene.add(group);

    const gate = new THREE.Mesh(
      new THREE.TorusGeometry(p.radius * 0.74, 0.55, 8, 24),
      glowMat.clone()
    );
    gate.position.copy(group.position);
    gate.rotation.y = p.yaw + Math.PI / 2;
    scene.add(gate);
    gate.userData.__origEmissive = 0x7fdcff;
    gate.userData.__origEmissiveInt = 0;
    gate.userData.__origOpacity = 0.22;
    registerGate(gate, { radius: p.radius * 0.72, points: 700, kind: 'portal', label: 'MOUNTAIN PORTAL' });
    window.__mountainPortals.push({ group, gate, phase: idx * 0.8 });
  });
  window.__mountainPortalSpin = (dt) => {
    for (const p of window.__mountainPortals || []) {
      p.phase += dt * 0.5;
      p.gate.rotation.z = Math.sin(p.phase) * 0.08;
      p.gate.material.opacity = 0.16 + Math.max(0, Math.sin(p.phase * 1.9)) * 0.12;
    }
  };
})();

// __world_feature_mountain_targets__ — Glowing spheres parked on
// mountain peaks. Shooting one rewards points + heals hull. Positions
// sampled from the heightfield so they sit just above the peak.
(function addMountainTargets() {
  const positions = [
    { x:  1800, z: -1600 }, { x: -2100, z: -2200 }, { x:   900, z: -3400 },
    { x: -1400, z: -4100 }, { x:  2400, z: -2800 }, { x: -2800, z: -3600 },
    { x:   200, z: -5400 }, { x:  3200, z: -4200 }, { x: -2600, z:  1800 },
    { x:  2100, z:  2400 },
  ];
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0xffeb5a, emissive: 0xffb820, emissiveIntensity: 1.1,
    roughness: 0.3, metalness: 0.2,
  });
  const coreGeo = new THREE.OctahedronGeometry(4.2, 1);
  const haloGeo = new THREE.SphereGeometry(6, 16, 12);
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xfff3a8, transparent: true, opacity: 0.28,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  window.__mountainTargets = [];
  positions.forEach((p, i) => {
    const h = Math.max(60, getHeight(p.x, p.z));
    const group = new THREE.Group();
    const core = new THREE.Mesh(coreGeo, glowMat.clone());
    group.add(core);
    const halo = new THREE.Mesh(haloGeo, haloMat.clone());
    group.add(halo);
    group.position.set(p.x, h + 12, p.z);
    group.userData.spinPhase = i * 0.6;
    scene.add(group);
    const target = registerDestructible(group, { radius: 6, kind: 'mountainTarget', health: 1 });
    target.rewardPoints = 500;
    target.rewardHealth = 15;
    target.rewardAmmo = 40;
    window.__mountainTargets.push({ group, target });
  });
  // Spin animation — piggybacks on updateAtmospheric timer
  window.__mountainTargetSpin = (dt) => {
    if (!window.__mountainTargets) return;
    for (const mt of window.__mountainTargets) {
      if (!mt.target.alive) continue;
      mt.group.userData.spinPhase += dt * 0.8;
      mt.group.rotation.y = mt.group.userData.spinPhase;
      mt.group.position.y += Math.sin(mt.group.userData.spinPhase * 1.6) * dt * 0.8;
    }
  };
})();

