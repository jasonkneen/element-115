// @module src/game/12a-targeting.js
// =============================================================
//  HUD
// =============================================================
const $speed = document.getElementById('speed');
const $alt = document.getElementById('altitude');
const $hdg = document.getElementById('heading');
const $vs = document.getElementById('vspeed');
const $aoa = document.getElementById('aoa');
const $gforce = document.getElementById('gforce');
const $gear = document.getElementById('gear');
const $crosshair = document.getElementById('crosshair');
const $targetOverlay = document.getElementById('target-overlay');
const $hullPct = document.getElementById('hull-pct');
const $shieldPct = document.getElementById('shield-pct');
const $hullBar = document.getElementById('hull-bar');
const $ammoVal = document.getElementById('ammo-val');
const $ammoMax = document.getElementById('ammo-max');
const $ammoBar = document.getElementById('ammo-bar');
const $missileVal = document.getElementById('missile-val');
const $supplyVal = document.getElementById('supply-val');
const $weaponMode = document.getElementById('weapon-mode');
const $gunMode = document.getElementById('gun-mode');
const $gunTier = document.getElementById('gun-tier');
const $mslTier = document.getElementById('msl-tier');
const $shdOd = document.getElementById('shd-od');
function updateWeaponProgressHud() {
  if (typeof weaponProgress === 'undefined') return;
  const gt = weaponProgress.gun, mt = weaponProgress.msl;
  if ($gunTier) { const s = gt > 0 ? ROMAN[gt] : ''; if (hudCache.gunTier !== s) { hudCache.gunTier = s; $gunTier.textContent = s; $gunTier.style.display = gt > 0 ? '' : 'none'; } }
  if ($gunMode) { const nm = GUN_MODE_SHORT[weaponProgress.gunMode] || 'STD'; const key = (gt > 0 ? '1' : '0') + nm; if (hudCache.gunMode !== key) { hudCache.gunMode = key; $gunMode.textContent = nm; $gunMode.style.display = gt > 0 ? '' : 'none'; } }
  if ($mslTier) { const s = mt > 0 ? ROMAN[mt] : ''; if (hudCache.mslTier !== s) { hudCache.mslTier = s; $mslTier.textContent = s; $mslTier.style.display = mt > 0 ? '' : 'none'; } }
  if ($shdOd) {
    const od = typeof overdriveActive === 'function' && overdriveActive();
    const txt = od ? ('OD ' + Math.ceil((combatState.overdriveUntil - performance.now()) / 1000) + 'S') : ((weaponProgress.overdriveCharges > 0) ? ('OD x' + weaponProgress.overdriveCharges) : '');
    if (hudCache.shdOd !== txt) { hudCache.shdOd = txt; $shdOd.textContent = txt; $shdOd.style.display = txt ? '' : 'none'; }
    const cls = od ? 'nhud-cap on' : 'nhud-cap';
    if (hudCache.shdOdCls !== cls) { hudCache.shdOdCls = cls; $shdOd.className = cls; }
  }
}
const $scoreVal = document.getElementById('score-val');
const $scoreStreak = document.getElementById('score-streak');
const $courseDirector = document.getElementById('course-director');
const $courseTitle = document.getElementById('course-title');
const $courseNext = document.getElementById('course-next');
const $courseRange = document.getElementById('course-range');
const $nhudCpDist = document.getElementById('nhud-cp-dist');
const $courseTurn = document.getElementById('course-turn');
const $courseAlt = document.getElementById('course-alt');
const $courseCue = document.getElementById('course-cue');
const $racePanel = document.getElementById('mp-race-panel');
const $raceRoom = document.getElementById('race-room');
const $raceTimer = document.getElementById('race-timer');
const $raceStatus = document.getElementById('race-status');
const $raceBoard = document.getElementById('race-board');
const $raceInd = document.getElementById('race-ind');
const $headingChip = document.getElementById('hud-heading-chip');
const $aeroChip = document.getElementById('hud-aero-chip');
const $gearChip = document.getElementById('hud-gear-chip');
const $ammoChip = document.getElementById('hud-ammo-chip');
const $scoreChip = document.getElementById('hud-score-chip');
const $engPct = document.getElementById('eng-pct');
const $engBar = document.getElementById('eng-bar');
const $shdBar = document.getElementById('shd-bar');
const $fuelPct = document.getElementById('fuel-pct');
const $fuelBar = document.getElementById('fuel-bar');
const $fpsVal = document.getElementById('fps-val');
const $pingVal = document.getElementById('ping-val');
const $pingChip = document.getElementById('nhud-ping');
const $hdgMirror = document.getElementById('hdg-mirror');
const $nhudBoostVal = document.getElementById('nhud-boost-val');
const _aiBall = document.getElementById('ai-ball');
const _aiRollText = document.getElementById('ai-roll-text');
const _devInfo = document.getElementById('dev-planeinfo');
const _inputDebugLine1 = document.getElementById('input-debug-line1');
const _inputDebugLine2 = document.getElementById('input-debug-line2');
const _inputDebugLine3 = document.getElementById('input-debug-line3');
const _inputDebugLine4 = document.getElementById('input-debug-line4');
const _inputDebugLine5 = document.getElementById('input-debug-line5');
const $throttleVal = document.getElementById('throttle-val');
const $throttleBar = document.getElementById('throttle-bar');
const $abStatus = document.getElementById('ab-status');
const $styleInd = document.getElementById('style-ind');
const $biomeInd = document.getElementById('biome-ind');
const $todInd = document.getElementById('tod-ind');
const $phaseInd = document.getElementById('phase-ind');
const $mpInd = document.getElementById('mp-ind');
const $propModelInd = document.getElementById('prop-model-ind');
const $landingInd = document.getElementById('landing-ind');
const $hudActionsTray = document.getElementById('hud-actions-tray');
const $hudActionsState = document.getElementById('hud-actions-state');
const statusMsg = document.getElementById('status-msg');
const $devOverlay = document.getElementById('dev-overlay');
const controlsHelpEl = document.getElementById('controls-help');
const mpCallsignInput = document.getElementById('mp-callsign');
const mpUrlInput = document.getElementById('mp-url');
const mpRoomInput = document.getElementById('mp-room');
const mpSpawnRow = document.getElementById('mp-spawn-row');
const mpSetupNote = document.getElementById('mp-setup-note');
const planePickerGrid = document.getElementById('plane-picker-grid');
const planePickerNote = document.getElementById('plane-picker-note');
const helpStripState = {
  collapsed: false,
  autoCollapsed: false,
  lastManualAt: 0,
};
const flightPhaseState = {
  label: 'PREFLIGHT',
  tone: '',
};
const missionDebriefState = {
  startedAt: performance.now(),
  distanceMeters: 0,
  peakSpeedKts: 0,
  peakAltitudeFt: 0,
  gates: 0,
  bridgeRuns: 0,
  portalShots: 0,
  lowRuns: 0,
  landings: 0,
  landingScore: 0,
  landingGrade: '',
  landingMedal: '',
  lastHighlight: 'FIRST FLIGHT',
  grade: 'C',
  reason: 'TERRAIN IMPACT',
  summary: null,
};
const landingMedalState = {
  lastMedal: '—',
  lastGrade: '',
  lastScore: 0,
  lastDetail: '',
  lastWasBest: false,
  bestMedal: bestLandingRecord.medal || '—',
  bestGrade: bestLandingRecord.grade || '',
  bestScore: bestLandingRecord.score || 0,
  bestDetail: bestLandingRecord.detail || '',
  count: 0,
};
const landingCompleteState = {
  armed: false,
  active: false,
  touchdownAt: 0,
  bonusPoints: 0,
  result: null,
};
const RETICLE_SCREEN_Y_RATIO = 0.46;
const RETICLE_GUN_Y_OFFSET_PX = -35;
const reticleState = {
  x: window.innerWidth * 0.5,
  y: window.innerHeight * RETICLE_SCREEN_Y_RATIO,
  vx: 0,
  vy: 0,
  baseYOffset: RETICLE_GUN_Y_OFFSET_PX,
  visible: false,
};
const mouseFlightState = {
  targetX: 0,
  targetY: 0,
  steerX: 0,
  steerY: 0,
  lastClientX: null,
  lastClientY: null,
};
const targetHudState = {
  boxes: [],
  visibleCount: 0,
  activeId: '',
  activeLabel: '',
  activeType: '',
  activeDistanceM: 0,
  activeTarget: null,
  selectedId: '',
  selectedLabel: '',
  selectedIndex: 0,
  selectedVisible: false,
  selectableCount: 0,
  cyclePressed: false,
  selectedCycleCount: 0,
  lockId: '',
  lockAmount: 0,
  lockSolid: false,
  lockTone: 'off',
  lockHoldUntil: 0,
  lockCenterHoldPx: 320,
  aimAssist: 0,
};
const _hudWorldA = new THREE.Vector3();
const _hudWorldB = new THREE.Vector3();
const _hudWorldC = new THREE.Vector3();
const _hudWorldD = new THREE.Vector3();
const _hudWorldE = new THREE.Vector3();
const _hudWorldF = new THREE.Vector3();
const _hudWorldG = new THREE.Vector3();
const _hudWorldH = new THREE.Vector3();
const _hudQuatA = new THREE.Quaternion();
const _hudDirA = new THREE.Vector3();
const _hudNdcA = new THREE.Vector3();
const _hudNdcB = new THREE.Vector3();
const _hudHalfBase = new THREE.Vector3();
const TARGET_BOX_LIMIT = 8;
function inferTargetTypeLabel(id) {
  const token = String(id || '').toLowerCase();
  if (token.includes('f14')) return 'F-14';
  if (token.includes('warthog') || token.includes('a-10')) return 'A-10';
  if (token.includes('plane')) return 'PROP';
  if (token.includes('stunt')) return 'STUNT';
  if (token.includes('drone')) return 'DRONE';
  return String(id || 'AIR').replace(/^models\//, '').replace(/\.glb$/i, '').replace(/[_-]+/g, ' ').trim().toUpperCase() || 'AIR';
}
function ensureTargetHudPool() {
  if (!$targetOverlay) return;
  while (targetHudState.boxes.length < TARGET_BOX_LIMIT) {
    const el = document.createElement('div');
    el.className = 'target-bracket';
    el.style.display = 'none';
    const frame = document.createElement('div');
    frame.className = 'target-frame';
    el.appendChild(frame);
    $targetOverlay.appendChild(el);
    targetHudState.boxes.push({ el });
  }
}
function resetReticleHud() {
  reticleState.x = window.innerWidth * 0.5;
  reticleState.y = window.innerHeight * RETICLE_SCREEN_Y_RATIO;
  reticleState.vx = 0;
  reticleState.vy = 0;
  reticleState.visible = false;
  recenterMouseFlightReticle();
  targetHudState.visibleCount = 0;
  targetHudState.activeId = '';
  targetHudState.activeLabel = '';
  targetHudState.activeType = '';
  targetHudState.activeDistanceM = 0;
  targetHudState.activeTarget = null;
  targetHudState.selectedId = '';
  targetHudState.selectedLabel = '';
  targetHudState.selectedIndex = 0;
  targetHudState.selectedVisible = false;
  targetHudState.selectableCount = 0;
  targetHudState.cyclePressed = false;
  targetHudState.selectedCycleCount = 0;
  targetHudState.lockId = '';
  targetHudState.lockAmount = 0;
  targetHudState.lockSolid = false;
  targetHudState.lockTone = 'off';
  targetHudState.lockHoldUntil = 0;
  targetHudState.aimAssist = 0;
  if (typeof stopLockTone === 'function') stopLockTone();
  if ($crosshair) {
    $crosshair.style.left = `${reticleState.x}px`;
    $crosshair.style.top = `${reticleState.y}px`;
    $crosshair.style.opacity = '0';
    $crosshair.classList.remove('locked');
    $crosshair.classList.remove('tracking');
  }
  for (const box of targetHudState.boxes) {
    box.el.style.display = 'none';
    box.el.classList.remove('active');
    box.el.classList.remove('tracking');
    box.el.classList.remove('locked');
    box.el.classList.remove('locking');
    box.el.classList.remove('cue-warn');
    box.el.classList.remove('cue-ready');
    box.el.classList.remove('shield-hit');
    box.el.classList.remove('damaged');
    box._shieldHueKey = -1;
    if (box.el.firstChild) box.el.firstChild.style.borderColor = '';
  }
}
function mouseFlightUiTarget(target) {
  if (!target || typeof target !== 'object') return false;
  const hasClosest = typeof target.closest === 'function';
  return !!(
    target.tagName === 'BUTTON' ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    (hasClosest && (
      target.closest('#graphics-panel') ||
      target.closest('#graphics-overlay') ||
      target.closest('#replay-panel') ||
      target.closest('#tweak-hud')
    ))
  );
}
function recenterMouseFlightReticle() {
  mouseFlightState.targetX = 0;
  mouseFlightState.targetY = 0;
  mouseFlightState.steerX = 0;
  mouseFlightState.steerY = 0;
  mouseFlightState.lastClientX = null;
  mouseFlightState.lastClientY = null;
}
function getMouseFlightAimLimits() {
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  const aimBoxPx = 300;
  return {
    x: aimBoxPx / Math.max(1, w * 0.5),
    y: aimBoxPx / Math.max(1, h * 0.5),
  };
}
function getMouseFlightAimBaseNdc() {
  const limits = getMouseFlightAimLimits();
  return {
    x: 0,
    y: Math.max(-limits.y * 0.35, Math.min(limits.y * 0.35, -0.10)),
  };
}
function getMouseFlightAimNdc() {
  const limits = getMouseFlightAimLimits();
  const base = getMouseFlightAimBaseNdc();
  const baseX = Math.max(-limits.x * 0.35, Math.min(limits.x * 0.35, base.x));
  const baseY = Math.max(-limits.y * 0.35, Math.min(limits.y * 0.35, base.y));
  return {
    x: Math.max(-limits.x, Math.min(limits.x, baseX + mouseFlightState.targetX)),
    y: Math.max(-limits.y, Math.min(limits.y, baseY + mouseFlightState.targetY)),
  };
}
function updateMouseFlightSteer(dt) {
  const aimLimit = getMouseFlightAimLimits();
  mouseFlightState.steerX += (mouseFlightState.targetX - mouseFlightState.steerX) * Math.min(0.82, dt * 24);
  mouseFlightState.steerY += (mouseFlightState.targetY - mouseFlightState.steerY) * Math.min(0.84, dt * 25);
  mouseFlightState.steerX = Math.max(-aimLimit.x, Math.min(aimLimit.x, mouseFlightState.steerX));
  mouseFlightState.steerY = Math.max(-aimLimit.y, Math.min(aimLimit.y, mouseFlightState.steerY));
}
function estimateTrafficVelocity(rec) {
  if (!rec || !rec.pathFn) return _hudWorldH.set(0, 0, 0);
  const sampleTime = 0.12;
  const phaseDelta = Math.max(2, (rec.speed || 60) * sampleTime);
  const prev = rec.pathFn(rec.phase - phaseDelta).pos;
  const next = rec.pathFn(rec.phase + phaseDelta).pos;
  return _hudWorldH.copy(next).sub(prev).multiplyScalar(1 / Math.max(0.001, sampleTime * 2));
}
function collectAirTargetCandidates() {
  const targets = [];
  let trafficIndex = 0;
  for (const rec of traffic) {
    if (!rec || !rec.loaded || !rec.group || !rec.destructible || !rec.destructible.alive || rec.group.visible === false) continue;
    trafficIndex += 1;
    targets.push({
      id: rec.hudId || `traffic-${trafficIndex}`,
      label: rec.callsign || `TRAFFIC ${String(trafficIndex).padStart(2, '0')}`,
      type: rec.typeLabel || inferTargetTypeLabel(rec.file || rec.group.name || 'traffic'),
      kind: 'traffic',
      isThreat: rec.targetKind === 'ufo-saucer' || !!(rec.child && rec.child.userData.__isUfoTarget),
      object: rec.group,
      destructible: rec.destructible,
      trafficRef: rec,
      radius: Math.max(6, (rec.destructible.radius || 6) * 1.15),
      distanceM: plane.pos.distanceTo(rec.group.position),
      speedKts: (rec.speed || 0) * 1.94,
      altFt: rec.group.position.y * 3.28,
      // Reuse a per-record vector — this ran ~22 clones per frame
      velocity: (rec.__hudVel || (rec.__hudVel = new THREE.Vector3())).copy(
        rec.velocity && rec.velocity.lengthSq && rec.velocity.lengthSq() > 0.01 ? rec.velocity : estimateTrafficVelocity(rec)
      ),
    });
  }
  for (const [id, rec] of multiplayerState.remotePlayers) {
    if (!rec || !rec.group || rec.group.visible === false) continue;
    targets.push({
      id: `remote-${id}`,
      label: rec.callsign || sanitizeCallsign(id),
      type: inferTargetTypeLabel(rec.planeKey || id),
      kind: 'remote',
      object: rec.group,
      radius: 8.4,
      distanceM: plane.pos.distanceTo(rec.group.position),
      speedKts: rec.speedKts || 0,
      altFt: rec.group.position.y * 3.28,
      velocity: null,
    });
  }
  return targets;
}
function selectTargetHudEntry(target, { announce = false, manual = false } = {}) {
  if (!target) return null;
  const changed = targetHudState.selectedId !== target.id;
  targetHudState.selectedId = target.id;
  targetHudState.selectedLabel = target.label || '';
  targetHudState.selectedVisible = false;
  if (changed) {
    targetHudState.lockId = target.id;
    targetHudState.lockAmount = 0;
    targetHudState.lockSolid = false;
    targetHudState.lockTone = 'off';
    targetHudState.lockHoldUntil = 0;
    targetHudState.aimAssist = 0;
    if (typeof stopLockTone === 'function') stopLockTone();
  }
  if (announce && typeof flashStatus === 'function') {
    flashStatus(`${manual ? 'TARGET SELECT' : 'TARGET'} · ${target.label || 'THREAT'}`, 'panel ok', 0.85);
  }
  return target;
}
function resolveSelectedThreatTarget(threats, cycleChoices = threats) {
  targetHudState.selectableCount = threats.length;
  targetHudState.selectedVisible = false;
  const cycleDown = !!(typeof keys !== 'undefined' && keys['KeyC']);
  if (!threats.length) {
    targetHudState.selectedId = '';
    targetHudState.selectedLabel = '';
    targetHudState.selectedIndex = 0;
    targetHudState.cyclePressed = cycleDown;
    targetHudState.lockAmount = Math.max(0, targetHudState.lockAmount - 0.08);
    return null;
  }
  let selected = threats.find(t => t.id === targetHudState.selectedId) || null;
  if (cycleDown && !targetHudState.cyclePressed) {
    const choices = cycleChoices.length ? cycleChoices : threats;
    let choiceIndex = choices.findIndex(t => t.id === targetHudState.selectedId);
    choiceIndex = choiceIndex >= 0 ? (choiceIndex + 1) % choices.length : 0;
    const target = choices[choiceIndex];
    targetHudState.selectedCycleCount += 1;
    targetHudState.cyclePressed = true;
    targetHudState.selectedIndex = Math.max(0, threats.findIndex(t => t.id === target.id));
    return selectTargetHudEntry(target, { announce: true, manual: true });
  }
  targetHudState.cyclePressed = cycleDown;
  if (!selected) selected = cycleChoices[0] || threats[0];
  targetHudState.selectedIndex = Math.max(0, threats.findIndex(t => t.id === selected.id));
  return selectTargetHudEntry(selected);
}
function getMouseFlightReticleScreenPoint() {
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  const aimNdc = getMouseFlightAimNdc();
  return {
    x: w * 0.5 + aimNdc.x * w * 0.5,
    y: h * 0.5 - aimNdc.y * h * 0.5,
  };
}
function getGunReticleScreenPoint() {
  if (!jet.userData.gunL || !jet.userData.gunR) return null;
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  _hudWorldA.copy(jet.userData.gunL).applyQuaternion(jet.quaternion).add(jet.position);
  _hudWorldB.copy(jet.userData.gunR).applyQuaternion(jet.quaternion).add(jet.position);
  _hudWorldC.copy(_hudWorldA).add(_hudWorldB).multiplyScalar(0.5);
  _hudDirA.set(0, 0, -1).applyQuaternion(jet.quaternion).normalize();
  _hudNdcA.copy(_hudWorldC).addScaledVector(_hudDirA, 900).project(camera);
  if (!Number.isFinite(_hudNdcA.x) || !Number.isFinite(_hudNdcA.y) || _hudNdcA.z < -1 || _hudNdcA.z > 1) return null;
  return {
    x: (_hudNdcA.x * 0.5 + 0.5) * w,
    y: (-_hudNdcA.y * 0.5 + 0.5) * h + (reticleState.baseYOffset || 0),
  };
}
function getReticleAimDirection(origin, out = _hudWorldG) {
  if (!origin || !camera) return null;
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  const sx = reticleState && Number.isFinite(reticleState.x) ? reticleState.x : w * 0.5;
  const sy = reticleState && Number.isFinite(reticleState.y) ? reticleState.y : h * RETICLE_SCREEN_Y_RATIO;
  const ndcX = (sx / w) * 2 - 1;
  const ndcY = -(sy / h) * 2 + 1;
  const ray = _hudWorldE.set(ndcX, ndcY, 0.5).unproject(camera).sub(camera.position).normalize();
  if (!Number.isFinite(ray.x) || !Number.isFinite(ray.y) || !Number.isFinite(ray.z) || ray.lengthSq() < 0.5) return null;
  const aimDistance = Math.max(420, Math.min(1600, origin.distanceTo(camera.position) + 980));
  _hudWorldF.copy(camera.position).addScaledVector(ray, aimDistance);
  out.copy(_hudWorldF).sub(origin).normalize();
  return Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z) ? out : null;
}
function getTargetHudBounds() {
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  return {
    minX: Math.max(58, w * 0.20),
    maxX: Math.min(w - 58, w * 0.80),
    minY: Math.max(58, h * 0.18),
    maxY: Math.min(h - 72, h * 0.78),
  };
}
function clampTargetHudCuePoint(x, y) {
  const b = getTargetHudBounds();
  const cx = Math.max(b.minX, Math.min(b.maxX, x));
  const cy = Math.max(b.minY, Math.min(b.maxY, y));
  return { x: cx, y: cy, clamped: Math.abs(cx - x) > 0.5 || Math.abs(cy - y) > 0.5 };
}
function makeGuidedTargetHudEntry(candidate, camForward, camRight, camUp) {
  if (!candidate || !candidate.object) return null;
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  candidate.object.getWorldPosition(_hudWorldA);
  const rel = _hudWorldD.copy(_hudWorldA).sub(camera.position);
  const distance = Math.max(1, rel.length());
  const depth = rel.dot(camForward);
  const side = rel.dot(camRight) / distance;
  const up = rel.dot(camUp) / distance;
  const fwd = depth / distance;
  const denom = Math.max(0.18, Math.abs(fwd) + 0.20);
  const cue = clampTargetHudCuePoint(
    w * 0.5 + (side / denom) * w * 0.33,
    h * 0.5 - (up / denom) * h * 0.33
  );
  const size = 58;
  const distanceM = candidate.distanceM || plane.pos.distanceTo(_hudWorldA);
  const behind = depth <= 0;
  const far = distanceM > 2800;
  return {
    ...candidate,
    centerX: cue.x,
    centerY: cue.y,
    shipCenterX: cue.x,
    shipCenterY: cue.y,
    shipReticleDist: 9999,
    width: size,
    height: size,
    left: cue.x - size * 0.5,
    top: cue.y - size * 0.5,
    depth,
    score: (cue.x - reticleState.x) ** 2 + (cue.y - reticleState.y) ** 2 + Math.max(0, depth) * 0.45,
    guided: true,
    offscreenCue: true,
    cueWarn: true,
    cueReady: false,
    guidanceLabel: behind ? 'BEHIND' : far ? 'FAR' : 'OFF CAMERA',
    distanceM,
    altFt: candidate.altFt != null ? candidate.altFt : _hudWorldA.y * 3.28,
  };
}
function updateReticleHud(dt = 1 / 60) {
  if (!$crosshair || !jet.userData.gunL || !jet.userData.gunR) {
    if ($crosshair) $crosshair.style.opacity = '0';
    reticleState.visible = false;
    return;
  }
  const body = document.body;
  const hudHidden = !running || (body && (body.classList.contains('preflight') || body.classList.contains('review-open')));
  if (hudHidden) {
    $crosshair.style.opacity = '0';
    reticleState.visible = false;
    return;
  }

  const basePoint = INPUT_FLAGS.mouseFlight
    ? getMouseFlightReticleScreenPoint()
    : getGunReticleScreenPoint();
  if (!basePoint) {
    $crosshair.style.opacity = '0';
    reticleState.visible = false;
    return;
  }

  const targetX = Math.max(24, Math.min(window.innerWidth - 24, basePoint.x));
  const targetY = Math.max(24, Math.min(window.innerHeight - 24, basePoint.y));

  if (!reticleState.visible) {
    reticleState.x = targetX;
    reticleState.y = targetY;
  } else {
    // 15.0 provides a sweet-spot combination of responsive aiming and satisfying fluid lag.
    const f = 1 - Math.exp(-15.0 * dt);
    reticleState.x += (targetX - reticleState.x) * f;
    reticleState.y += (targetY - reticleState.y) * f;
  }
  reticleState.vx = 0;
  reticleState.vy = 0;
  reticleState.visible = true;
  $crosshair.style.opacity = '1';
  $crosshair.style.left = `${reticleState.x.toFixed(1)}px`;
  $crosshair.style.top = `${reticleState.y.toFixed(1)}px`;
}
function updateTargetHud(dt = 1 / 60) {
  if (!$targetOverlay || !$crosshair || !reticleState.visible || !running) {
    resetReticleHud();
    return;
  }
  const body = document.body;
  if (body && (body.classList.contains('preflight') || body.classList.contains('review-open'))) {
    resetReticleHud();
    return;
  }
  ensureTargetHudPool();
  const camForward = _hudWorldF.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
  const camRight = _hudWorldB.set(1, 0, 0).applyQuaternion(camera.quaternion);
  const camUp = _hudWorldC.set(0, 1, 0).applyQuaternion(camera.quaternion);
  const candidates = collectAirTargetCandidates();
  const allThreats = candidates.filter(v => v.isThreat || v.kind === 'traffic');
  const visible = [];
  let active = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    candidate.object.getWorldPosition(_hudWorldA);
    const depth = _hudWorldD.copy(_hudWorldA).sub(camera.position).dot(camForward);
    if (depth < 24) continue;
    _hudNdcA.copy(_hudWorldA).project(camera);
    if (!Number.isFinite(_hudNdcA.x) || !Number.isFinite(_hudNdcA.y) || _hudNdcA.z < -1 || _hudNdcA.z > 1) continue;
    const centerX = (_hudNdcA.x * 0.5 + 0.5) * window.innerWidth;
    const centerY = (-_hudNdcA.y * 0.5 + 0.5) * window.innerHeight;
    const extent = Math.max(4.5, candidate.radius || 6);
    _hudWorldD.copy(_hudWorldA).addScaledVector(camRight, extent);
    _hudWorldE.copy(_hudWorldA).addScaledVector(camUp, extent * 0.72);
    _hudNdcB.copy(_hudWorldD).project(camera);
    const rightX = (_hudNdcB.x * 0.5 + 0.5) * window.innerWidth;
    _hudNdcB.copy(_hudWorldE).project(camera);
    const upY = (-_hudNdcB.y * 0.5 + 0.5) * window.innerHeight;
    let width = Math.max(42, Math.min(220, Math.abs(rightX - centerX) * 2));
    let height = Math.max(42, Math.min(220, Math.abs(upY - centerY) * 2));
    const boxSize = Math.max(width, height);
    width = boxSize;
    height = boxSize;
    const cue = clampTargetHudCuePoint(centerX, centerY);
    const left = cue.x - width * 0.5;
    const top = cue.y - height * 0.5;
    const dx = cue.x - reticleState.x;
    const dy = cue.y - reticleState.y;
    const shipDx = centerX - reticleState.x;
    const shipDy = centerY - reticleState.y;
    const shipReticleDist = Math.hypot(shipDx, shipDy);
    const score = dx * dx + dy * dy + depth * 0.45;
    const far = (candidate.distanceM || 0) > 2800;
    const cueWarn = cue.clamped || far || depth < 60;
    const guidanceLabel = depth < 60 ? 'BEHIND' : far ? 'FAR' : cue.clamped ? 'OFF CAMERA' : 'IN FRONT';
    const entry = {
      ...candidate,
      centerX: cue.x,
      centerY: cue.y,
      shipCenterX: centerX,
      shipCenterY: centerY,
      shipReticleDist,
      width,
      height,
      left,
      top,
      depth,
      score,
      offscreenCue: cue.clamped,
      cueWarn,
      cueReady: !cueWarn,
      guidanceLabel,
    };
    visible.push(entry);
    if (score < bestScore) {
      bestScore = score;
      active = entry;
    }
  }
  visible.sort((a, b) => a.score - b.score || a.depth - b.depth);
  const visibleThreats = visible.filter(v => v.isThreat || v.kind === 'traffic');
  const selectedCandidate = resolveSelectedThreatTarget(allThreats, visibleThreats);
  const selectedVisible = selectedCandidate ? visible.find(v => v.id === selectedCandidate.id) : null;
  // If the pilot has a visible threat under the reticle, make THAT the active
  // lock candidate immediately. Otherwise an older/offscreen selected UFO can
  // steal the HUD and make lock feel impossible even while aiming at another ship.
  const reticleThreat = visibleThreats.find(v => {
    const r = Math.max(116, Math.min(250, (v.width || 58) * 1.85));
    return !v.offscreenCue && v.depth > 28 && Math.min(v.shipReticleDist || 9999, Math.hypot((v.centerX || 0) - reticleState.x, (v.centerY || 0) - reticleState.y)) < r;
  }) || null;
  active = reticleThreat || selectedVisible || (selectedCandidate ? makeGuidedTargetHudEntry(selectedCandidate, camForward, camRight, camUp) : null);
  targetHudState.selectedVisible = !!active;
  const displayTargets = [];
  if (active) {
    displayTargets.push(active);
  }
  for (const v of visible) {
    if (active && v.id === active.id) continue;
    displayTargets.push(v);
  }
  if (displayTargets.length > TARGET_BOX_LIMIT) {
    displayTargets.length = TARGET_BOX_LIMIT;
  }
  targetHudState.visibleCount = displayTargets.length;
  targetHudState.activeTarget = active || null;
  targetHudState.activeId = active ? active.id : '';
  targetHudState.activeLabel = active ? active.label : '';
  targetHudState.activeType = active ? active.type : '';
  targetHudState.activeDistanceM = active ? active.distanceM : 0;

  const activeReticleDx = active ? (active.centerX - reticleState.x) : 0;
  const activeReticleDy = active ? (active.centerY - reticleState.y) : 0;
  const activeReticleDist = active ? Math.hypot(activeReticleDx, activeReticleDy) : 9999;
  const shipReticleDist = active ? (Number.isFinite(active.shipReticleDist) ? active.shipReticleDist : activeReticleDist) : 9999;
  // Acquisition must be on the actual ship projection, not the edge cue/target box.
  // But the playable tolerance needs to be generous: small/far UFOs project to only
  // a few pixels, and the lowered gunsight makes exact pixel-perfect lock miserable.
  const shipLockRadius = active ? Math.max(118, Math.min(260, (active.width || 58) * 1.9)) : 126;
  const lockDistPx = Math.min(shipReticleDist, activeReticleDist);
  const desiredLockId = active ? active.id : '';
  const nowMs = performance.now();
  const wasSolid = !!(active && targetHudState.lockSolid && targetHudState.lockId === desiredLockId);
  const reticleOnShip = !!(active && !active.offscreenCue && active.depth > 28 && lockDistPx < shipLockRadius);
  const solidSticky = !!(wasSolid && active && !active.offscreenCue && active.depth > 32 && active.distanceM < 6200);
  const lockEligible = reticleOnShip || solidSticky;
  const lockProximity = solidSticky ? 1 : (lockEligible ? clamp01(1 - lockDistPx / shipLockRadius) : 0);
  const lockDistanceEase = lockEligible ? clamp01(1 - Math.max(0, active.distanceM - 450) / 5200) : 0;
  const withinLockHold = !!(lockEligible && active.depth > 36 && active.distanceM < 6500 && lockDistPx < shipLockRadius * 1.12);
  if (!active) {
    targetHudState.lockAmount = Math.max(0, targetHudState.lockAmount - dt * 1.8);
    if (targetHudState.lockAmount <= 0.02) targetHudState.lockId = '';
  } else {
    if (targetHudState.lockId && desiredLockId !== targetHudState.lockId && targetHudState.lockAmount > 0.12) {
      targetHudState.lockAmount = Math.max(0, targetHudState.lockAmount - dt * 2.6);
    } else {
      if (targetHudState.lockId !== desiredLockId) {
        targetHudState.lockId = desiredLockId;
        targetHudState.lockAmount *= 0.28;
        targetHudState.lockHoldUntil = 0;
      }
      let desiredLock = clamp01(lockProximity * (0.80 + lockDistanceEase * 0.20) + lockDistanceEase * 0.16);
      if (!reticleOnShip && !solidSticky) desiredLock = 0;
      if (withinLockHold && (wasSolid || targetHudState.lockAmount > 0.68)) {
        desiredLock = Math.max(desiredLock, 0.94);
        targetHudState.lockHoldUntil = nowMs + 1850;
      } else if (targetHudState.lockHoldUntil > nowMs && reticleOnShip) {
        desiredLock = Math.max(desiredLock, 0.86);
      }
      const snapEase = smoothstep(clamp01((targetHudState.lockAmount - 0.42) / 0.36));
      const acquireRate = (2.7 + lockProximity * 3.9 + snapEase * 4.2) * mslLockMul();
      const releaseRate = (wasSolid || targetHudState.lockHoldUntil > nowMs) ? 0.18 : 0.78;
      const lockRate = desiredLock > targetHudState.lockAmount ? acquireRate : releaseRate;
      targetHudState.lockAmount += (desiredLock - targetHudState.lockAmount) * Math.min(1, dt * lockRate);
    }
  }
  targetHudState.lockAmount = clamp01(targetHudState.lockAmount);
  const centerLocked = withinLockHold && targetHudState.lockAmount > 0.74;
  targetHudState.lockSolid = !!active && (reticleOnShip || solidSticky) && targetHudState.lockId === desiredLockId && (centerLocked || solidSticky || (targetHudState.lockHoldUntil > nowMs && targetHudState.lockAmount > 0.58));
  targetHudState.lockTone = (reticleOnShip || targetHudState.lockSolid) ? (targetHudState.lockSolid ? 'solid' : (targetHudState.lockAmount > 0.08 ? 'beep' : 'off')) : 'off';
  if (targetHudState.lockSolid && active) {
    const lockX = Number.isFinite(active.shipCenterX) ? active.shipCenterX : active.centerX;
    const lockY = Number.isFinite(active.shipCenterY) ? active.shipCenterY : active.centerY;
    reticleState.x = Math.max(24, Math.min(window.innerWidth - 24, lockX));
    reticleState.y = Math.max(24, Math.min(window.innerHeight - 24, lockY));
    $crosshair.style.left = `${reticleState.x.toFixed(1)}px`;
    $crosshair.style.top = `${reticleState.y.toFixed(1)}px`;
  }
  targetHudState.aimAssist = active && active.kind === 'traffic'
    ? (targetHudState.lockSolid ? 0.86 : 0.24 + clamp01((targetHudState.lockAmount - 0.18) / 0.52) * 0.48)
    : 0;
  $crosshair.classList.toggle('tracking', !!active && (reticleOnShip || targetHudState.lockSolid) && targetHudState.lockAmount > 0.18);
  $crosshair.classList.toggle('locked', !!active && targetHudState.lockSolid);

  for (let i = 0; i < targetHudState.boxes.length; i++) {
    const poolEntry = targetHudState.boxes[i];
    const target = displayTargets[i];
    if (!target) {
      poolEntry.el.style.display = 'none';
      poolEntry.el.classList.remove('active');
      poolEntry.el.classList.remove('tracking');
      poolEntry.el.classList.remove('locked');
      poolEntry.el.classList.remove('locking');
      poolEntry.el.classList.remove('cue-warn');
      poolEntry.el.classList.remove('cue-ready');
      poolEntry.el.classList.remove('shield-hit');
      poolEntry.el.classList.remove('damaged');
      poolEntry._shieldHueKey = -1;
      if (poolEntry.el.firstChild) poolEntry.el.firstChild.style.borderColor = '';
      continue;
    }
    poolEntry.el.style.display = 'block';
    const isActive = !!active && active.id === target.id;
    const isTracking = isActive && targetHudState.lockAmount > 0.18;
    const isReticleLocked = isActive && targetHudState.lockSolid;
    const targetBoxLocked = isActive && targetHudState.lockId === target.id && targetHudState.lockAmount > 0.58;
    const isLocking = isActive && !targetBoxLocked && targetHudState.lockAmount > 0.42;
    // The target box belongs to the target: always draw it at the target/cue.
    // Only the player's central indicator drops lock when alignment is lost.
    const displayW = target.width;
    const displayH = target.height;
    const displayCenterX = target.centerX;
    const displayCenterY = target.centerY;
    poolEntry.el.style.transform = `translate(${(displayCenterX - displayW * 0.5).toFixed(1)}px, ${(displayCenterY - displayH * 0.5).toFixed(1)}px)`;
    poolEntry.el.style.width = `${displayW.toFixed(1)}px`;
    poolEntry.el.style.height = `${displayH.toFixed(1)}px`;
    poolEntry.el.classList.toggle('active', isActive);
    poolEntry.el.classList.toggle('tracking', isTracking);
    poolEntry.el.classList.toggle('locked', targetBoxLocked);
    poolEntry.el.classList.toggle('locking', isLocking);
    poolEntry.el.classList.toggle('cue-warn', !!(target.cueWarn && !targetBoxLocked));
    poolEntry.el.classList.toggle('cue-ready', !!(target.cueReady || targetBoxLocked));
    const d = target.destructible || null;
    const shieldFrac = d && d.shieldMax ? clamp01(d.shield / Math.max(1, d.shieldMax)) : 0;
    const hullPct = d && d.maxHealth ? Math.round((d.health / Math.max(1, d.maxHealth)) * 100) : 100;
    // Shield-state tint on the bracket frame border: cyan (full) → amber →
    // red (nearly down). Inline so it beats the class colors; cleared at 0
    // shield so the standard state colors (lock/cue) take back over.
    const shieldHueKey = d && d.shieldMax && shieldFrac > 0
      ? Math.round(shieldFrac > 0.5 ? 40 + (shieldFrac - 0.5) * 294 : shieldFrac * 80)
      : -1;
    if (poolEntry._shieldHueKey !== shieldHueKey) {
      poolEntry._shieldHueKey = shieldHueKey;
      const frame = poolEntry.el.firstChild;
      if (frame) frame.style.borderColor = shieldHueKey >= 0 ? `hsl(${shieldHueKey} 95% 58%)` : '';
    }
    // Zero-shield targets never flash shield-hit — the flash was misleading
    // once the shield was already gone.
    poolEntry.el.classList.toggle('shield-hit', !!(d && d.shield > 0 && (d.shieldPulse || 0) > 0.08));
    poolEntry.el.classList.toggle('damaged', !!(d && hullPct < 100));
    poolEntry.el.style.opacity = targetBoxLocked ? '1' : isTracking ? '0.96' : isActive ? '0.78' : '0.35';
  }
}
function getAimAssistDirection(origin, baseDir, out = _hudWorldG) {
  const target = targetHudState.activeTarget;
  if (!target || target.kind !== 'traffic' || !target.destructible || !target.destructible.alive) return null;
  const assist = targetHudState.aimAssist || 0;
  if (assist <= 0.02) return null;
  target.object.getWorldPosition(_hudWorldH);
  const dist = Math.max(1, origin.distanceTo(_hudWorldH));
  if (target.velocity) {
    const travelTime = dist / 430;
    _hudWorldH.addScaledVector(target.velocity, travelTime * (0.92 + targetHudState.lockAmount * 0.62));
  }
  out.copy(_hudWorldH).sub(origin).normalize();
  return out.copy(baseDir).lerp(out, assist).normalize();
}
ensureTargetHudPool();
resetReticleHud();
