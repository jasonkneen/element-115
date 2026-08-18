// @module src/game/12b-mission.js
function setFlightPhase(label, tone = '') {
  flightPhaseState.label = label;
  flightPhaseState.tone = tone || '';
  if ($phaseInd) {
    $phaseInd.textContent = label;
    $phaseInd.className = `hud-chip ${tone}`.trim();
  }
}
function resetMissionDebrief() {
  missionDebriefState.startedAt = performance.now();
  missionDebriefState.distanceMeters = 0;
  missionDebriefState.peakSpeedKts = 0;
  missionDebriefState.peakAltitudeFt = 0;
  missionDebriefState.gates = 0;
  missionDebriefState.bridgeRuns = 0;
  missionDebriefState.portalShots = 0;
  missionDebriefState.lowRuns = 0;
  missionDebriefState.landings = 0;
  missionDebriefState.landingScore = 0;
  missionDebriefState.landingGrade = '';
  missionDebriefState.landingMedal = '';
  missionDebriefState.lastHighlight = 'FIRST FLIGHT';
  missionDebriefState.grade = 'C';
  missionDebriefState.reason = 'TERRAIN IMPACT';
  missionDebriefState.summary = null;
  landingMedalState.lastMedal = '—';
  landingMedalState.lastGrade = '';
  landingMedalState.lastScore = 0;
  landingMedalState.lastDetail = '';
  landingMedalState.lastWasBest = false;
  landingMedalState.count = 0;
  landingCompleteState.armed = false;
  landingCompleteState.active = false;
  landingCompleteState.touchdownAt = 0;
  landingCompleteState.bonusPoints = 0;
  landingCompleteState.result = null;
}
function saveBestLandingRecord() {
  try {
    localStorage.setItem(LANDING_RECORD_KEY, JSON.stringify({
      medal: landingMedalState.bestMedal,
      grade: landingMedalState.bestGrade,
      score: landingMedalState.bestScore,
      detail: landingMedalState.bestDetail,
    }));
  } catch {}
}
function evaluateLandingTouchdown({ sinkRateMps = 0, speedKts = 0, centerlineFt = 0, headingErrorDeg = 0, onRunway = true, hard = false } = {}) {
  const sink = Math.abs(sinkRateMps);
  const speedErr = Math.abs(speedKts - 74);
  const centerPenalty = Math.min(40, centerlineFt * 1.35);
  const headingPenalty = Math.min(35, headingErrorDeg * 2.4);
  const sinkPenalty = Math.max(0, sink - 0.8) * 14;
  const speedPenalty = Math.max(0, speedErr - 4) * 1.1;
  const runwayPenalty = onRunway ? 0 : 22;
  const hardPenalty = hard ? 14 : 0;
  const score = Math.max(0, Math.round(100 - sinkPenalty - speedPenalty - centerPenalty - headingPenalty - runwayPenalty - hardPenalty));
  let grade = 'D';
  let medal = 'HEAVY ARRIVAL';
  let color = '#ff6f5a';
  if (score >= 94) { grade = 'S'; medal = 'GREASER'; color = '#7fe7ff'; }
  else if (score >= 84) { grade = 'A'; medal = 'SILK SETDOWN'; color = '#66ff99'; }
  else if (score >= 72) { grade = 'B'; medal = 'RUNWAY STABLE'; color = '#c8ff7a'; }
  else if (score >= 58) { grade = 'C'; medal = onRunway ? 'PATCHED IN' : 'OFF-CENTER'; color = '#ffd36a'; }
  if (!onRunway) {
    medal = score >= 58 ? 'RUNWAY EDGE' : 'OFF-RUNWAY';
    color = score >= 58 ? '#ffb36a' : '#ff7b6a';
  }
  const detail = `${sink.toFixed(1)}M/S · ${Math.round(centerlineFt)}FT OFF · ${Math.round(headingErrorDeg)}° OFF`;
  return { score, grade, medal, detail, color, sinkRateMps: sink, centerlineFt, headingErrorDeg, speedKts, onRunway };
}
function recordLandingTouchdown(sample = {}) {
  const result = evaluateLandingTouchdown(sample);
  const isNewBest = result.score > landingMedalState.bestScore;
  const landingBonusPoints = result.onRunway ? Math.round(140 + result.score * 4.6) : Math.round(40 + result.score * 2.1);
  landingMedalState.lastMedal = result.medal;
  landingMedalState.lastGrade = result.grade;
  landingMedalState.lastScore = result.score;
  landingMedalState.lastDetail = result.detail;
  landingMedalState.lastWasBest = isNewBest;
  landingMedalState.count += 1;
  missionDebriefState.landings += 1;
  missionDebriefState.landingScore = Math.max(missionDebriefState.landingScore, result.score);
  missionDebriefState.landingGrade = result.grade;
  missionDebriefState.landingMedal = result.medal;
  missionDebriefState.lastHighlight = result.medal;
  missionDebriefState.summary = null;
  if (window.__gameScore && result.onRunway) {
    awardUnbankedPoints(landingBonusPoints, 'LANDING BONUS', result.color || '#72ff91');
  }
  landingCompleteState.armed = !!result.onRunway;
  landingCompleteState.active = false;
  landingCompleteState.touchdownAt = performance.now();
  landingCompleteState.bonusPoints = result.onRunway ? landingBonusPoints : 0;
  landingCompleteState.result = result;
  if (isNewBest) {
    landingMedalState.bestScore = result.score;
    landingMedalState.bestMedal = result.medal;
    landingMedalState.bestGrade = result.grade;
    landingMedalState.bestDetail = result.detail;
    saveBestLandingRecord();
  }
  if (typeof window.showComboBanner === 'function') {
    const suffix = isNewBest ? ' · NEW BEST' : '';
    const pointsText = result.onRunway ? ` · +${landingBonusPoints}` : '';
    window.showComboBanner(result.medal, `${result.grade} LANDING${pointsText} · ${result.detail}${suffix}`, result.color);
  }
  if (typeof flashStatus === 'function') {
    const pointsText = result.onRunway ? ` · +${landingBonusPoints}` : '';
    flashStatus(`${result.grade} LANDING · ${result.medal}${pointsText}`, result.score >= 72 ? 'panel ok' : 'panel warn', 1.9);
  }
  return result;
}
function updateLandingCompleteFlow(speedKts) {
  if (plane.crashed) return;
  if (landingCompleteState.active) {
    if (!plane.onGround || speedKts > 42) {
      landingCompleteState.active = false;
      if (typeof syncReplayUI === 'function') syncReplayUI();
    }
    return;
  }
  if (!landingCompleteState.armed || !landingCompleteState.result) return;
  const settleMs = performance.now() - landingCompleteState.touchdownAt;
  const settled = plane.onGround && speedKts < 16 && plane.throttle < 0.34;
  if (!settled || settleMs < 1200) return;
  landingCompleteState.armed = false;
  landingCompleteState.active = true;
  missionDebriefState.reason = 'LANDING COMPLETE';
  setFlightPhase('TAXI COMPLETE', 'ok');
  const summary = captureMissionDebrief('LANDING COMPLETE');
  if (typeof syncReplayUI === 'function') syncReplayUI();
  if (typeof window.showComboBanner === 'function') {
    const result = landingCompleteState.result;
    window.showComboBanner('LANDING COMPLETE', `${result.medal} · +${landingCompleteState.bonusPoints} · ${summary.grade} RUN`, result.color);
  }
  if (typeof flashStatus === 'function') {
    flashStatus(`LANDING COMPLETE — ${landingCompleteState.result.medal}`, 'panel ok', 2.4);
  }
}
function recordMissionMoment({ kind = '', gateLabel = '', stunts = [], points = 0 } = {}) {
  missionDebriefState.gates += 1;
  if (kind === 'bridge') missionDebriefState.bridgeRuns += 1;
  if (kind === 'portal') missionDebriefState.portalShots += 1;
  if (stunts.includes('LOW RUN')) missionDebriefState.lowRuns += 1;
  missionDebriefState.lastHighlight = stunts[0] || gateLabel || (kind ? `${kind.toUpperCase()} GATE` : `+${points}`);
  missionDebriefState.summary = null;
}
function updateMissionDebrief(dt, speedKts) {
  if (!running || plane.crashed) return;
  missionDebriefState.distanceMeters += Math.max(0, plane.vel.length() * dt);
  missionDebriefState.peakSpeedKts = Math.max(missionDebriefState.peakSpeedKts, speedKts);
  missionDebriefState.peakAltitudeFt = Math.max(missionDebriefState.peakAltitudeFt, plane.pos.y * 3.28);
}
function captureMissionDebrief(reason = 'TERRAIN IMPACT') {
  const score = window.__gameScore || { points: 0, bestStreak: 0 };
  const seconds = Math.max(1, (performance.now() - missionDebriefState.startedAt) / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const distanceNm = missionDebriefState.distanceMeters / 1852;
  const gunneryHits = combatState.shotHits || 0;
  const targetKills = combatState.kills || 0;
  const accuracy = combatState.shotsFired > 0 ? gunneryHits / combatState.shotsFired : 0;
  const landingBonus = missionDebriefState.landingScore / 28 + missionDebriefState.landings * 0.4;
  const rating = score.points / 520 + score.bestStreak * 0.72 + missionDebriefState.bridgeRuns * 1.25 + missionDebriefState.portalShots * 1.45 + missionDebriefState.lowRuns * 0.38 + gunneryHits * 0.22 + targetKills * 0.28 + accuracy * 2.4 + landingBonus;
  const grade = rating >= 8.2 ? 'S' : rating >= 5.6 ? 'A' : rating >= 3.6 ? 'B' : rating >= 2.1 ? 'C' : 'D';
  const awards = [];
  if (missionDebriefState.landingMedal) awards.push(`${missionDebriefState.landingMedal} · ${missionDebriefState.landingGrade}`);
  if (landingMedalState.lastWasBest) awards.push('NEW BEST LANDING');
  if (missionDebriefState.bridgeRuns > 0) awards.push(`BRIDGE ACE ×${missionDebriefState.bridgeRuns}`);
  if (missionDebriefState.portalShots > 0) awards.push(`PORTAL HUNTER ×${missionDebriefState.portalShots}`);
  if (score.bestStreak >= 5) awards.push(`STREAK MASTER ×${score.bestStreak}`);
  if (missionDebriefState.lowRuns >= 2) awards.push(`LOW-LEVEL RUNNER ×${missionDebriefState.lowRuns}`);
  if (gunneryHits >= 3) awards.push(`GUNS ON TARGET ×${gunneryHits}`);
  if (accuracy >= 0.35 && combatState.shotsFired >= 6) awards.push(`SHARP SHOOTER ${Math.round(accuracy * 100)}%`);
  if (targetKills >= 2) awards.push(`TARGETS DOWN ×${targetKills}`);
  if (missionDebriefState.peakSpeedKts >= 165) awards.push(`REDLINE ${Math.round(missionDebriefState.peakSpeedKts)}KT`);
  if (landingMedalState.bestScore > 0) awards.push(`CAREER BEST · ${landingMedalState.bestMedal}`);
  const neutralHighlight = (missionDebriefState.lastHighlight === 'READY FOR TAKEOFF' || missionDebriefState.lastHighlight === 'FIRST FLIGHT')
    ? (reason === 'LANDING COMPLETE' ? 'SORTIE COMPLETE' : 'REVIEW AVAILABLE')
    : missionDebriefState.lastHighlight;
  if (!awards.length) awards.push(neutralHighlight || 'KEEP PUSHING THE CANYON');
  const cards = [
    { label: 'SCORE', value: String(score.points), detail: `${score.bestStreak || 0}× BEST CHAIN` },
    { label: 'DISTANCE', value: `${distanceNm.toFixed(1)}NM`, detail: 'THROUGH THE CANYON' },
    { label: 'TIME', value: `${minutes}:${String(secs).padStart(2, '0')}`, detail: 'ELAPSED' },
    { label: 'TOP SPEED', value: `${Math.round(missionDebriefState.peakSpeedKts)}KT`, detail: 'RUN PEAK' },
  ];
  if (missionDebriefState.peakAltitudeFt >= 50) {
    cards.push({
      label: 'ALTITUDE',
      value: `${Math.round(missionDebriefState.peakAltitudeFt)}FT`,
      detail: 'MAX ALT',
    });
  }
  if (missionDebriefState.landings > 0) {
    cards.splice(1, 0, {
      label: 'LANDING',
      value: missionDebriefState.landingGrade || landingMedalState.lastGrade || '—',
      detail: `${missionDebriefState.landingMedal || landingMedalState.lastMedal} · ${missionDebriefState.landingScore}`,
    });
  } else {
    cards.splice(1, 0, {
      label: 'GUNS',
      value: combatState.shotsFired ? `${Math.round(accuracy * 100)}%` : '—',
      detail: `${gunneryHits} HITS / ${combatState.shotsFired} SHOTS`,
    });
  }
  if (landingMedalState.bestScore > 0) {
    cards.push({
      label: 'CAREER BEST',
      value: landingMedalState.bestGrade || '—',
      detail: `${landingMedalState.bestMedal} · ${landingMedalState.bestScore}`,
    });
  }
  missionDebriefState.grade = grade;
  missionDebriefState.reason = reason;
  missionDebriefState.summary = {
    grade,
    reason,
    awards: awards.slice(0, 5),
    cards,
    highlight: neutralHighlight || 'CANYON RUN',
    score: score.points || 0,
    bestStreak: score.bestStreak || 0,
    kills: targetKills,
    seconds: Math.round(seconds),
  };
  return missionDebriefState.summary;
}
function setHelpStripCollapsed(next, manual = false) {
  if (!controlsHelpEl) return;
  helpStripState.collapsed = !!next;
  controlsHelpEl.classList.toggle('collapsed', helpStripState.collapsed);
  if (manual) helpStripState.lastManualAt = performance.now();
}
function syncHudActionsTray() {
  if (!$hudActionsTray || !$hudActionsState) return;
  const open = !!$hudActionsTray.open;
  $hudActionsState.textContent = open ? 'OPEN' : 'SHOW';
  $hudActionsState.className = open ? 'warn' : 'ok';
}
if ($hudActionsTray) {
  $hudActionsTray.addEventListener('toggle', syncHudActionsTray);
  syncHudActionsTray();
}
if ($devOverlay && !DEBUG_UI) $devOverlay.remove();
const $inputDebug = document.getElementById('input-debug');
if ($inputDebug && !DEBUG_UI) $inputDebug.remove();

// Button click toggles style (in addition to T key)
document.getElementById('style-btn').addEventListener('click', toggleStyle);
document.getElementById('biome-btn').addEventListener('click', cycleBiome);
document.getElementById('prop-model-btn').addEventListener('click', () => cyclePropModel(1));
document.getElementById('race-btn').addEventListener('click', toggleMultiplayerRace);
// Bottom-center checkpoint icon row — reuse existing toggle handlers.
(function nhudWireCheckpointIcons() {
  const pulseKey = (code) => { keys[code] = true; setTimeout(() => { keys[code] = false; }, 80); };
  const waypointBtn = document.getElementById('nhud-icon-waypoint');
  if (waypointBtn) waypointBtn.addEventListener('click', toggleMultiplayerRace);
  const targetBtn = document.getElementById('nhud-icon-target');
  if (targetBtn) targetBtn.addEventListener('click', () => pulseKey('KeyC'));
  const cameraBtn = document.getElementById('nhud-icon-camera');
  if (cameraBtn) cameraBtn.addEventListener('click', () => { if (typeof camOrbit !== 'undefined') { camOrbit.yaw = 0; camOrbit.pitch = 0; } });
  const planeBtn = document.getElementById('nhud-icon-plane');
  if (planeBtn) planeBtn.addEventListener('click', () => cyclePropModel(1));
})();
window.addEventListener('keydown', (e) => {
  const tgt = e.target;
  if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
  const graphicsOverlayEl = document.getElementById('graphics-overlay');
  const optionsOpen = graphicsOverlayEl && graphicsOverlayEl.style.display === 'block';
  if (e.code === 'Tab' && $hudActionsTray && running && !optionsOpen && !document.body.classList.contains('review-open')) {
    e.preventDefault();
    $hudActionsTray.open = !$hudActionsTray.open;
    syncHudActionsTray();
  } else if (e.code === 'Escape' && $hudActionsTray && $hudActionsTray.open) {
    $hudActionsTray.open = false;
    syncHudActionsTray();
  }
});

function syncPropModelIndicator() {
  if (!$propModelInd) return;
  const selection = getAircraftSelectionState();
  const preset = selection.visual;
  const requested = selection.requested;
  const suffix = selection.status === 'loading' && requested.key !== preset.key
    ? ` · LOAD ${requested.hudLabel || requested.label}`
    : selection.status === 'fallback'
      ? ' · FALLBACK'
      : '';
  $propModelInd.textContent = `${preset.hudLabel || preset.label}${suffix}`;
  $propModelInd.className = selection.status === 'fallback' ? 'warn' : 'ok';
}
function syncPropModelPicker() {
  const selection = getAircraftSelectionState();
  const active = selection.visual;
  const requested = selection.requested;
  if (planePickerGrid) {
    while (planePickerGrid.firstChild) planePickerGrid.removeChild(planePickerGrid.firstChild);
    PROP_MODEL_PRESETS.forEach((preset) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'plane-picker-btn' + (preset.key === active.key ? ' active' : '');
      btn.innerHTML = `<span class="plane-picker-name">${preset.name || preset.label}</span><span class="plane-picker-meta"><span>${preset.type || 'Airframe'}</span><span class="plane-picker-badge">${preset.badge || 'READY'}</span></span>`;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (preset.key !== active.key) applyPropModelPreset(preset.key);
      });
      planePickerGrid.appendChild(btn);
    });
  }
  if (planePickerNote) {
    const loading = selection.status === 'loading' && requested.key !== active.key
      ? ` Loading ${requested.name || requested.label}.`
      : selection.status === 'fallback'
        ? ' Requested model failed, so E-115 is flying.'
        : '';
    planePickerNote.textContent = `Active airframe: ${active.name || active.label}.${loading} All hangar planes selectable — press M in flight or use Options [P] / Planes menu to switch.`;
  }
}
if (mpCallsignInput) {
  mpCallsignInput.value = playerProfileState.callsign;
  mpCallsignInput.addEventListener('input', () => setPlayerCallsign(mpCallsignInput.value));
}
if (mpUrlInput) {
  mpUrlInput.value = MULTIPLAYER_URL;
  mpUrlInput.addEventListener('change', () => {
    applyMultiplayerUrl(mpUrlInput.value);
    syncMultiplayerSetupUI();
  });
}
if (mpRoomInput) {
  mpRoomInput.value = MULTIPLAYER_ROOM;
  mpRoomInput.addEventListener('change', () => {
    setMultiplayerRoom(mpRoomInput.value);
    syncMultiplayerSetupUI();
  });
}

document.getElementById('landing-btn').addEventListener('click', () => {
  plane.landingLights = !plane.landingLights;
  syncLandingIndicator();
});

// Audio toggle button
const $audioInd = document.getElementById('audio-ind');
function syncAudioIndicator() {
  $audioInd.textContent = audio.enabled ? 'ON' : 'OFF';
  $audioInd.className = audio.enabled ? 'ok' : 'warn';
}
function syncLandingIndicator() {
  $landingInd.textContent = plane.landingLights ? 'ON' : 'OFF';
  $landingInd.className = plane.landingLights ? 'ok' : 'warn';
}
document.getElementById('audio-btn').addEventListener('click', () => {
  setAudioEnabled(!audio.enabled);
  syncAudioIndicator();
});
syncAudioIndicator();
syncLandingIndicator();
syncMultiplayerIndicator();
syncMultiplayerSetupUI();
syncPropModelIndicator();
syncPropModelPicker();
function syncActiveAircraftRuntime() {
  const visual = getLoadedAircraftPreset();
  plane.aircraftKey = visual.key;
  plane.aircraftSpec = getActiveAircraftSpec();
}
syncActiveAircraftRuntime();
window.addEventListener('aircraftvisualchange', () => {
  syncActiveAircraftRuntime();
  syncPropModelIndicator();
  syncPropModelPicker();
});

const transientStatus = { text: '', className: 'panel', timer: 0 };
function flashStatus(text, className = 'panel ok', duration = 1.2) {
  transientStatus.text = text;
  transientStatus.className = className;
  transientStatus.timer = duration;
}

// Right-column NEARBY CONTACTS panel — driven from the global `traffic`
// array (world positions), decoupled from updateTargetHud's local
// displayTargets. 10Hz gate, reused scratch array (no per-call alloc).
let _nhudContactsLast = 0;
let _nhudContactRows = null;
const _nhudContactsScratch = [];
function updateContactsHUD() {
  const now = performance.now();
  if (now - _nhudContactsLast < 100) return;
  _nhudContactsLast = now;
  if (typeof traffic === 'undefined') return;
  if (!_nhudContactRows) {
    _nhudContactRows = [0, 1, 2, 3].map(i => {
      const row = document.getElementById('nhud-contact-' + i);
      if (!row) return null;
      return { row, cs: row.querySelector('.cs'), ty: row.querySelector('.ty'), ds: row.querySelector('.ds') };
    });
    if (!_nhudContactRows[0]) return;
  }
  _nhudContactsScratch.length = 0;
  for (let i = 0; i < traffic.length; i++) {
    const rec = traffic[i];
    if (!rec.loaded || !rec.group || !rec.group.visible) continue;
    const dx = rec.group.position.x - plane.pos.x;
    const dz = rec.group.position.z - plane.pos.z;
    _nhudContactsScratch.push({ rec, dist: Math.hypot(dx, dz) });
  }
  _nhudContactsScratch.sort((a, b) => a.dist - b.dist);
  for (let i = 0; i < 4; i++) {
    const cached = _nhudContactRows[i];
    if (!cached) continue;
    const entry = _nhudContactsScratch[i];
    if (!entry) {
      if (cached.row.style.display !== 'none') cached.row.style.display = 'none';
      continue;
    }
    if (cached.row.style.display !== 'flex') cached.row.style.display = 'flex';
    const rec = entry.rec;
    const hostile = rec.targetKind === 'ufo-saucer';
    cached.row.classList.toggle('hostile', hostile);
    const csText = rec.callsign || rec.hudId;
    if (cached.cs && cached.cs.textContent !== csText) cached.cs.textContent = csText;
    const tyText = rec.typeLabel || inferTargetTypeLabel(rec.file);
    if (cached.ty && cached.ty.textContent !== tyText) cached.ty.textContent = tyText;
    const dsText = entry.dist >= 1000 ? (entry.dist / 1000).toFixed(1) + 'KM' : Math.round(entry.dist) + 'M';
    if (cached.ds && cached.ds.textContent !== dsText) cached.ds.textContent = dsText;
  }
}

const latestFeaturesFallback = {
  version: 'dev',
  title: 'Welcome back, pilot',
  subtitle: 'New combat training upgrades are live.',
  features: [
    { title: 'Target upgrade course', description: 'Fly target gates in sequence to earn ammo, missiles, shields, and alien pulse time.' },
    { title: 'Missile rail drop', description: 'Wing missiles drop clear before their motors light.' },
    { title: 'UFO damage feedback', description: 'Damaged alien ships now flicker, spark, and trail smoke.' },
  ],
};
function closeFeaturesPopup() {
  const popup = document.getElementById('features-popup');
  if (!popup) return;
  popup.classList.remove('is-visible');
  popup.setAttribute('aria-hidden', 'true');
  try { renderer.domElement.focus(); } catch {}
}
function renderFeaturesPopup(data) {
  // No modal anymore — the "Welcome back, pilot" interstitial annoyed more
  // than it informed. Latest-feature notes render as a compact strip inside
  // the ABOUT sub-panel of the main menu instead.
  const info = data && typeof data === 'object' ? data : latestFeaturesFallback;
  const version = String(info.version || 'dev');
  const host = document.getElementById('menu-panel-about');
  if (!host || document.getElementById('title-latest')) return;
  const features = Array.isArray(info.features) && info.features.length ? info.features : latestFeaturesFallback.features;
  const wrap = document.createElement('div');
  wrap.id = 'title-latest';
  const head = document.createElement('div');
  head.className = 'title-latest-head';
  head.textContent = `LATEST · ${version}`;
  wrap.appendChild(head);
  for (const feature of features.slice(0, 3)) {
    const row = document.createElement('div');
    row.className = 'title-latest-row';
    const strong = document.createElement('strong');
    strong.textContent = feature.title || 'Feature';
    const span = document.createElement('span');
    span.textContent = ` — ${feature.description || ''}`;
    row.append(strong, span);
    wrap.appendChild(row);
  }
  host.appendChild(wrap);
}
fetch('latest-features.json', { cache: 'no-store' })
  .then((res) => res.ok ? res.json() : latestFeaturesFallback)
  .then(renderFeaturesPopup)
  .catch(() => renderFeaturesPopup(latestFeaturesFallback));

let vsSmoothed = 0;
let nhudFuel = 100;
let nhudFps = 60;
let gSmoothed = 1;
let lastVel = new THREE.Vector3();
