// @module src/game/12c-hud-panels.js
function updateFlightPhase(speedKts, aglFt, aoaDeg) {
  if (!running) {
    setFlightPhase('PREFLIGHT');
    return;
  }
  if (plane.crashed) {
    setFlightPhase(replay.playing ? 'REVIEW' : 'IMPACT', replay.playing ? 'ok' : 'warn');
    return;
  }
  if (landingCompleteState.active) {
    setFlightPhase('TAXI COMPLETE', 'ok');
    return;
  }
  if (replay.playing) {
    setFlightPhase('REVIEW', 'ok');
  } else if (plane.onGround && speedKts < 8) {
    setFlightPhase(missionDebriefState.landings > 0 ? 'LANDED' : 'ON STAND', missionDebriefState.landings > 0 ? 'ok' : '');
  } else if (plane.onGround && speedKts < 55) {
    setFlightPhase(missionDebriefState.landings > 0 ? 'ROLL OUT' : 'TAKEOFF ROLL', missionDebriefState.landings > 0 ? 'ok' : '');
  } else if (plane.onGround) {
    setFlightPhase('ROTATE', 'ok');
  } else if (aglFt < 90) {
    setFlightPhase('GEAR CLEAR', 'ok');
  } else if (aglFt < 180 && speedKts > 105) {
    setFlightPhase('LOW RUN', 'warn');
  } else if (aglFt < 320) {
    setFlightPhase('CLIMB OUT', 'ok');
  } else if (Math.abs(aoaDeg) > 17) {
    setFlightPhase('STALL EDGE', 'warn');
  } else if (window.__gameScore && window.__gameScore.streak >= 4) {
    setFlightPhase('STUNT CHAIN', 'ok');
  } else if (plane.damage.airframe > 0.3 || plane.damage.engine > 0.25) {
    setFlightPhase('DAMAGED', 'warn');
  } else {
    setFlightPhase('FREE FLIGHT', 'ok');
  }
}
function updateStatusGuidance(speedKts, aoaDeg) {
  if (plane.crashed) return;
  if (!running) {
    statusMsg.textContent = 'THROTTLE UP · P OPTIONS';
    statusMsg.className = 'panel';
    return;
  }
  if (transientStatus.timer > 0) {
    statusMsg.textContent = transientStatus.text;
    statusMsg.className = transientStatus.className;
    return;
  }

  const groundH = getSurfaceHeight(plane.pos.x, plane.pos.z);
  const aglFt = Math.max(0, (plane.pos.y - groundH) * 3.28);
  const landingTrainingArmed = !plane.onGround && plane.gear > 0.95 && speedKts > 55 && speedKts < 165 && aglFt > 20 && aglFt < 900 && Math.abs(plane.pos.x) < 90 && Math.abs(plane.pos.z) > 220 && Math.abs(plane.pos.z) < 1200;

  let message = 'FREE FLIGHT';
  let className = 'panel';

  if (Math.abs(aoaDeg) > 17 && speedKts > 45) {
    message = 'STALL · RELEASE S AND BUILD SPEED';
    className = 'panel warn';
  } else if (timeOfDay.daylight < 0.22 && !plane.landingLights && (plane.onGround || aglFt < 350)) {
    message = 'PRESS L FOR LIGHTS';
    className = 'panel warn';
  } else if (missionDebriefState.landings > 0 && plane.onGround && speedKts < 18) {
    message = `LANDING COMPLETE · ${missionDebriefState.landingMedal || 'GOOD LANDING'}`;
    className = 'panel ok';
  } else if (landingTrainingArmed) {
    message = 'FOLLOW GATES';
    className = 'panel ok';
  } else if (plane.onGround && plane.throttle < 0.15) {
    message = 'THROTTLE UP';
  } else if (plane.onGround && speedKts < 55) {
    message = 'TAKEOFF ROLL';
  } else if (plane.onGround) {
    message = 'ROTATE · PRESS S';
    className = 'panel ok';
  } else if (aglFt < 80) {
    message = 'CLIMB OUT';
    className = 'panel ok';
  } else if (!plane.fixedGear && plane.gear > 0.95) {
    message = 'GEAR UP · PRESS G';
  } else if (aglFt < 260) {
    message = 'CLEAR OF RUNWAY';
    className = 'panel ok';
  }

  statusMsg.textContent = message;
  statusMsg.className = className;
}
function getNextPracticeRing() {
  const course = window.__practiceRingCourse;
  if (!course || !course.enabled || !course.activeCount) return null;
  const idx = Math.max(0, Math.min(course.activeCount - 1, course.nextIndex || 0));
  const ring = course[idx];
  return ring && ring.visible ? { course, ring, index: idx } : null;
}
const _cdTarget = new THREE.Vector3();
const _cdToTarget = new THREE.Vector3();
const _cdForward = new THREE.Vector3();
const _cdRight = new THREE.Vector3();
let _cdLastTextAt = 0;
function updateCourseDirectorHUD() {
  if (!$courseDirector) return;
  const next = getNextPracticeRing();
  if (!running || plane.crashed || !next) {
    $courseDirector.classList.add('is-hidden');
    return;
  }
  $courseDirector.classList.remove('is-hidden');
  // Guidance text at 10 Hz: the numbers move a couple of meters per frame and
  // six unconditional textContent writes per frame cost style/layout work.
  const now = performance.now();
  if (now - _cdLastTextAt < 100) return;
  _cdLastTextAt = now;
  const { course, ring, index } = next;
  const target = ring.getWorldPosition(_cdTarget);
  const toTarget = _cdToTarget.copy(target).sub(plane.pos);
  const forward = _cdForward.set(0, 0, -1).applyQuaternion(plane.quat).normalize();
  const right = _cdRight.set(1, 0, 0).applyQuaternion(plane.quat).normalize();
  const forwardDist = toTarget.dot(forward);
  const lateral = toTarget.dot(right);
  const vertical = target.y - plane.pos.y;
  const distanceM = toTarget.length();
  const turnLabel = Math.abs(lateral) < Math.max(18, distanceM * 0.05)
    ? 'ALIGN'
    : (lateral > 0 ? 'RIGHT' : 'LEFT');
  const altLabel = Math.abs(vertical) < 14
    ? 'LEVEL'
    : (vertical > 0 ? 'CLIMB' : 'DESCEND');
  const rewardLabel = formatPracticeReward(ring.userData.upgradeReward || null);
  const setText = (el, text) => { if (el && el.textContent !== text) el.textContent = text; };
  setText($courseTitle, course.completedRuns > 0 ? `TARGET RUN ${course.completedRuns + 1}` : 'TARGET COURSE');
  setText($courseNext, `TGT ${index + 1}/${course.activeCount}`);
  const rangeText = distanceM >= 1000 ? `${(distanceM / 1000).toFixed(1)}KM` : `${Math.round(distanceM)}M`;
  setText($courseRange, rangeText);
  setText($nhudCpDist, rangeText);
  setText($courseTurn, turnLabel);
  setText($courseAlt, altLabel);
  if ($courseCue) {
    const closure = forwardDist < -20 ? 'TURN BACK' : (distanceM < 90 ? 'COMMIT' : 'FOLLOW THE BLUE LINE');
    setText($courseCue, `${closure} · NEXT REWARD ${rewardLabel} · ${Math.round(Math.abs(lateral))}M ${turnLabel}`);
  }
}
function getLocalRaceEntry() {
  const race = buildLocalRaceState();
  return {
    id: multiplayerState.playerId,
    local: true,
    callsign: playerProfileState.callsign || 'YOU',
    status: race.status,
    gateIndex: race.gateIndex || 0,
    gateCount: race.gateCount || 0,
    lapMs: race.lapMs || 0,
    countdownMs: race.countdownMs || 0,
    bestMs: race.bestMs || 0,
    speedKts: plane.vel.length() * 1.94,
  };
}
function getRemoteRaceEntries() {
  const entries = [];
  const now = Date.now();
  for (const [id, rec] of multiplayerState.remotePlayers) {
    const race = rec.race || {};
    entries.push({
      id,
      local: false,
      callsign: rec.callsign || id,
      status: race.status || 'idle',
      gateIndex: Number(race.gateIndex) || 0,
      gateCount: Number(race.gateCount) || 0,
      lapMs: Number(race.lapMs) || 0,
      countdownMs: race.status === 'countdown' && race.startedWallAt ? Math.max(0, Number(race.startedWallAt) - now) : (Number(race.countdownMs) || 0),
      bestMs: Number(race.bestMs) || 0,
      speedKts: rec.speedKts || 0,
    });
  }
  return entries;
}
function raceSortValue(entry) {
  if (entry.status === 'finished') return 400000 + Math.max(0, entry.gateCount || entry.gateIndex) * 1000 - Math.min(999, (entry.lapMs || 0) / 1000);
  if (entry.status === 'racing') return 300000 + (entry.gateIndex || 0) * 1000 - Math.min(999, (entry.lapMs || 0) / 1000);
  if (entry.status === 'countdown') return 200000 - Math.min(999, (entry.countdownMs || 0) / 1000);
  return entry.bestMs ? 100000 - Math.min(999, entry.bestMs / 1000) : 0;
}
function updateMultiplayerRaceHUD() {
  beginMultiplayerRaceIfDue();
  const race = buildLocalRaceState();
  if ($raceInd) {
    if (race.status === 'countdown') {
      $raceInd.textContent = `${Math.max(1, Math.ceil(race.countdownMs / 1000))}S`;
      $raceInd.className = 'warn';
    } else if (race.status === 'racing') {
      $raceInd.textContent = `${race.gateIndex}/${race.gateCount || 0}`;
      $raceInd.className = 'ok';
    } else if (race.status === 'finished') {
      $raceInd.textContent = formatRaceTime(race.lapMs, true).toUpperCase();
      $raceInd.className = 'ok';
    } else {
      $raceInd.textContent = 'READY';
      $raceInd.className = 'ok';
    }
  }
  if (!$racePanel) return;
  const hasCourse = !!(window.__practiceRingCourse && (window.__practiceRingCourse.activeCount || window.__practiceRingCourse.length));
  if (!running || plane.crashed || !hasCourse) {
    $racePanel.classList.add('is-hidden');
    return;
  }
  $racePanel.classList.remove('is-hidden');
  if ($raceRoom) {
    const count = multiplayerState.remotePlayers.size + 1;
    $raceRoom.textContent = MULTIPLAYER_URL ? `${MULTIPLAYER_ROOM} · ${count}UP` : 'SOLO';
  }
  if ($raceTimer) {
    if (race.status === 'countdown') $raceTimer.textContent = `T-${(race.countdownMs / 1000).toFixed(1)}`;
    else if (race.status === 'racing') $raceTimer.textContent = formatRaceTime(race.lapMs);
    else if (race.status === 'finished') $raceTimer.textContent = formatRaceTime(race.lapMs);
    else $raceTimer.textContent = race.bestMs ? `BEST ${formatRaceTime(race.bestMs, true)}` : '--:--.---';
  }
  if ($raceStatus) {
    if (race.status === 'countdown') $raceStatus.textContent = multiplayerRaceState.adoptedStart ? 'SYNCED COUNTDOWN' : 'COUNTDOWN ACTIVE';
    else if (race.status === 'racing') $raceStatus.textContent = `GATE ${race.gateIndex + 1}/${race.gateCount || 0} · CLEAN LINES PAY`;
    else if (race.status === 'finished') $raceStatus.textContent = 'FINISHED · PRESS N TO RESTART';
    else $raceStatus.textContent = MULTIPLAYER_URL ? 'PRESS N TO START GRID' : 'SOLO TIME TRIAL · PRESS N';
  }
  if ($raceBoard && (performance.now() - (_raceBoardState.lastAt || 0)) >= 200) {
    // Leaderboard refresh at 5 Hz with pooled rows — the old per-frame
    // replaceChildren + 4 createElement per row was constant layout/GC churn.
    _raceBoardState.lastAt = performance.now();
    const entries = [getLocalRaceEntry(), ...getRemoteRaceEntries()]
      .sort((a, b) => raceSortValue(b) - raceSortValue(a) || (a.local ? -1 : 1))
      .slice(0, 5);
    while (_raceBoardState.rows.length < entries.length) {
      const row = document.createElement('div');
      const rank = document.createElement('span'); rank.className = 'race-rank';
      const name = document.createElement('span'); name.className = 'race-name';
      const progress = document.createElement('span'); progress.className = 'race-progress';
      row.append(rank, name, progress);
      $raceBoard.appendChild(row);
      _raceBoardState.rows.push({ row, rank, name, progress });
    }
    _raceBoardState.rows.forEach((slot, idx) => {
      const entry = entries[idx];
      if (!entry) { if (slot.row.style.display !== 'none') slot.row.style.display = 'none'; return; }
      if (slot.row.style.display === 'none') slot.row.style.display = '';
      const rowClass = 'race-row' + (entry.local ? ' local' : '');
      if (slot.row.className !== rowClass) slot.row.className = rowClass;
      const rankText = `#${idx + 1}`;
      if (slot.rank.textContent !== rankText) slot.rank.textContent = rankText;
      const nameText = entry.local ? `${entry.callsign} YOU` : entry.callsign;
      if (slot.name.textContent !== nameText) slot.name.textContent = nameText;
      let progressText;
      if (entry.status === 'finished') progressText = formatRaceTime(entry.lapMs, true).toUpperCase();
      else if (entry.status === 'racing') progressText = `${entry.gateIndex}/${entry.gateCount || 0}`;
      else if (entry.status === 'countdown') progressText = `T-${Math.max(1, Math.ceil(entry.countdownMs / 1000))}`;
      else progressText = entry.bestMs ? `B ${formatRaceTime(entry.bestMs, true).toUpperCase()}` : 'READY';
      if (slot.progress.textContent !== progressText) slot.progress.textContent = progressText;
    });
  }
}
const _raceBoardState = { lastAt: 0, rows: [] };
// Pre-allocated static scratch objects for updateHUD to avoid garbage collector pressure
const _hudFwd = new THREE.Vector3();
const _hudInvQ = new THREE.Quaternion();
const _hudLocalVel = new THREE.Vector3();
const _hudAccel = new THREE.Vector3();
const _hudPlaneUp = new THREE.Vector3();
const _hudEuler = new THREE.Euler();

const hudCache = {
  speed: -1,
  alt: -1,
  hdg: '',
  engPct: -1,
  fuelPct: -1,
  fps: -1,
  hdgMirror: '',
  pingText: '',
  pingHidden: null,
  boostText: '',
  vs: 9999,
  aoa: '',
  aoaClass: '',
  gforce: '',
  gearText: '',
  gearClass: '',
  hullPct: -1,
  hullClass: '',
  shieldPct: -1,
  shieldClass: '',
  hullBarWidth: '',
  hullBarBg: '',
  hullBarShadow: '',
  ammoVal: -1,
  ammoMax: -1,
  missileVal: -1,
  supplyVal: '',
  weaponModeText: '',
  weaponModeClass: '',
  ammoBarWidth: '',
  ammoBarBg: '',
  scoreVal: -1,
  scoreStreak: '',
  aeroChipHidden: null,
  ammoChipHidden: null,
  devInfoText: '',
  inputDebug1: '',
  inputDebug2: '',
  inputDebug3: '',
  inputDebug4: '',
  inputDebug5: '',
  aiBallTransform: '',
  aiRollText: '',
  throttleVal: -1,
  throttleBarWidth: '',
  abStatusText: '',
  abStatusClass: ''
};

// Compass ribbon — builds a degree scale once into #nhud-compass-scale, then
// each frame slides it by heading via transform translateX (cheap, no realloc).
let _nhudCompassBuilt = false;
const NHUD_PX_PER_DEG = 3.4;      // 320px view ≈ ±47° visible
const NHUD_CARDINALS = { 0:'N', 90:'E', 180:'S', 270:'W' };
function nhudBuildCompass() {
  const scale = document.getElementById('nhud-compass-scale');
  if (!scale) return false;
  let html = '';
  // Overscan -60..420 so the visible window never runs off the strip near N.
  for (let d = -60; d <= 420; d += 5) {
    const deg = ((d % 360) + 360) % 360;
    const x = (d + 60) * NHUD_PX_PER_DEG;           // strip-local px (0-based)
    const card = NHUD_CARDINALS[deg];
    const major = deg % 15 === 0;
    const label = card || (deg % 30 === 0 ? String(deg) : '');
    const cls = card ? ' card' : (major ? ' major' : '');
    html += `<div class="nhud-tick${cls}" style="left:${x}px"><u></u><s>${label}</s></div>`;
  }
  scale.innerHTML = html;
  scale.style.width = (480 * NHUD_PX_PER_DEG) + 'px';
  _nhudCompassBuilt = true;
  return true;
}
let _nhudCompassLast = -1;
function updateCompassHUD(hdg) {
  if (!_nhudCompassBuilt && !nhudBuildCompass()) return;
  const r = Math.round(hdg);
  if (r === _nhudCompassLast) return;
  _nhudCompassLast = r;
  const scale = document.getElementById('nhud-compass-scale');
  if (!scale) return;
  // Center the current heading under the caret (view center = 160px).
  const offset = 160 - (hdg + 60) * NHUD_PX_PER_DEG;
  scale.style.transform = `translateX(${offset.toFixed(1)}px)`;
}

// 2D radar — N-up, rings at 1KM/3KM, player triangle center, contact diamonds
// colored by hostility, faint rotating sweep. Own <canvas>, 2D ctx, 10Hz, no
// per-frame allocation. Canvas mount #nhud-radar-cv is created in P2; if the
// panel is absent this self-injects one so the stage boots standalone.
let _radarCtx = null, _radarLast = 0, _radarSweep = 0;
const NHUD_RADAR_RANGE = 3000;   // metres to outer ring
function nhudInitRadar() {
  let cv = document.getElementById('nhud-radar-cv');
  if (!cv) {
    const host = document.getElementById('nhud-radar') || document.getElementById('hud');
    if (!host) return false;
    cv = document.createElement('canvas');
    cv.id = 'nhud-radar-cv';
    host.appendChild(cv);
  }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = 200 * dpr; cv.height = 200 * dpr;
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  _radarCtx = ctx;
  return true;
}
function updateRadarHUD() {
  const now = performance.now();
  if (now - _radarLast < 100) return;   // 10 Hz
  _radarLast = now;
  if (!_radarCtx && !nhudInitRadar()) return;
  const ctx = _radarCtx, C = 100, R = 84;
  const scale = R / NHUD_RADAR_RANGE;
  ctx.clearRect(0, 0, 200, 200);
  // rings — green phosphor palette (ref)
  ctx.strokeStyle = 'rgba(120,220,160,0.35)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(C, C, R, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(C, C, R / 3, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(120,220,160,0.16)';
  ctx.beginPath(); ctx.moveTo(C, C - R); ctx.lineTo(C, C + R); ctx.moveTo(C - R, C); ctx.lineTo(C + R, C); ctx.stroke();
  // cardinal letters at the outer ring edge
  ctx.font = '9px ui-monospace, "SF Mono", "Courier New", monospace';
  ctx.fillStyle = 'rgba(150,235,190,0.8)';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('N', C, C - R - 8);
  ctx.fillText('S', C, C + R + 8);
  ctx.fillText('E', C + R + 8, C);
  ctx.fillText('W', C - R - 8, C);
  // range labels on the vertical axis
  ctx.textAlign = 'left';
  ctx.fillText('3KM', C + 4, C - R + 9);
  ctx.fillText('1KM', C + 4, C - R / 3 + 9);
  // heading (world) so player triangle points its true course, N up
  const fwd = _hudFwd.set(0, 0, -1).applyQuaternion(plane.quat);
  const hdgRad = Math.atan2(fwd.x, -fwd.z);
  // sweep wedge — greener than the rings for a phosphor-decay read
  _radarSweep = (_radarSweep + 0.05) % (Math.PI * 2);
  const g = ctx.createRadialGradient(C, C, 0, C, C, R);
  g.addColorStop(0, 'rgba(140,235,175,0.20)'); g.addColorStop(1, 'rgba(140,235,175,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(C, C);
  ctx.arc(C, C, R, _radarSweep - 0.35, _radarSweep); ctx.closePath(); ctx.fill();
  // contacts (N-up: world +z = south = down, +x = east = right)
  if (typeof traffic !== 'undefined') {
    for (let i = 0; i < traffic.length; i++) {
      const rec = traffic[i];
      if (!rec.loaded || !rec.group || !rec.group.visible) continue;
      let dx = (rec.group.position.x - plane.pos.x) * scale;
      let dz = (rec.group.position.z - plane.pos.z) * scale;
      if (dx * dx + dz * dz > R * R) continue;
      const hostile = rec.targetKind === 'ufo-saucer';
      ctx.fillStyle = hostile ? '#ff6a6a' : '#58e6d8';
      const px = C + dx, py = C + dz, s = 3;
      ctx.beginPath(); ctx.moveTo(px, py - s); ctx.lineTo(px + s, py); ctx.lineTo(px, py + s); ctx.lineTo(px - s, py); ctx.closePath(); ctx.fill();
    }
  }
  // player triangle (heading-rotated)
  ctx.save(); ctx.translate(C, C); ctx.rotate(hdgRad);
  ctx.fillStyle = '#ffc15a';
  ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill();
  ctx.restore();
}

// Center reticle furniture — two bracket arcs, speed tape (left), altitude tape
// (right), pitch ladder. Built once into #nhud-center; tapes slide via transform
// and value chips update dirty-checked. Cheap: only 2 textContent + 2 transforms.
let _nhudCenterBuilt = false;
let _nhudSpdChip = null, _nhudAltChip = null, _nhudSpdCol = null, _nhudAltCol = null, _nhudPitch = null;
let _nhudCenterSpd = -1, _nhudCenterAlt = -1;
let _nhudSpdBucket = null, _nhudAltBucket = null;
const NHUD_TAPE_PX_PER_UNIT = 0.44; // 220px mask ≈ 5 labels at 100-unit major spacing
const NHUD_TAPE_MASK_CENTER = 110;  // half of the 220px masked column
// Builds a ±300-unit window of rows around `center` (major label every 100
// units, minor tick every 20) and returns the strip plus its top-of-range
// value so the caller can compute the translateY offset for any value inside it.
function nhudTapeRows(center) {
  const maxV = Math.ceil((center + 300) / 20) * 20;
  const minV = Math.floor((center - 300) / 20) * 20;
  let html = '';
  for (let v = minV; v <= maxV; v += 20) {
    const major = ((v % 100) + 100) % 100 === 0;
    const y = (maxV - v) * NHUD_TAPE_PX_PER_UNIT;
    html += `<div class="nhud-tape-row${major ? ' major' : ''}" style="top:${y}px">${major ? `<b>${v}</b>` : ''}<u></u></div>`;
  }
  return { html, maxV };
}
function nhudBuildCenter() {
  let host = document.getElementById('nhud-center');
  if (!host) {
    const hud = document.getElementById('hud');
    if (!hud) return false;
    host = document.createElement('div');
    host.id = 'nhud-center';
    host.className = 'nhud-panel';
    hud.appendChild(host);
  }
  host.innerHTML =
    '<div class="nhud-arc l"></div><div class="nhud-arc r"></div>' +
    '<div class="nhud-tape spd"><div class="nhud-tape-col" id="nhud-spd-col"></div><span class="nhud-chip2" id="nhud-spd-chip">0 KTS</span></div>' +
    '<div class="nhud-tape alt"><div class="nhud-tape-col" id="nhud-alt-col"></div><span class="nhud-chip2" id="nhud-alt-chip">FT 0</span></div>' +
    '<div id="nhud-pitch"><u></u><u></u><u></u></div>';
  _nhudSpdChip = document.getElementById('nhud-spd-chip');
  _nhudAltChip = document.getElementById('nhud-alt-chip');
  _nhudSpdCol = document.getElementById('nhud-spd-col');
  _nhudAltCol = document.getElementById('nhud-alt-col');
  _nhudPitch = document.getElementById('nhud-pitch');
  _nhudCenterBuilt = true;
  return true;
}
function updateCenterHUD(spRound, ft) {
  if (!_nhudCenterBuilt && !nhudBuildCenter()) return;
  if (spRound !== _nhudCenterSpd) {
    _nhudCenterSpd = spRound;
    if (_nhudSpdChip) _nhudSpdChip.textContent = spRound + ' KTS';
    const bucket = Math.round(spRound / 100);
    if (_nhudSpdCol && bucket !== _nhudSpdBucket) {
      _nhudSpdBucket = bucket;
      const built = nhudTapeRows(bucket * 100);
      _nhudSpdCol.innerHTML = built.html;
      _nhudSpdCol._maxV = built.maxV;
    }
    if (_nhudSpdCol && typeof _nhudSpdCol._maxV === 'number') {
      const offset = NHUD_TAPE_MASK_CENTER - (_nhudSpdCol._maxV - spRound) * NHUD_TAPE_PX_PER_UNIT;
      _nhudSpdCol.style.transform = `translateY(${offset.toFixed(1)}px)`;
    }
  }
  if (ft !== _nhudCenterAlt) {
    _nhudCenterAlt = ft;
    if (_nhudAltChip) _nhudAltChip.textContent = 'FT ' + ft;
    const bucket = Math.round(ft / 100);
    if (_nhudAltCol && bucket !== _nhudAltBucket) {
      _nhudAltBucket = bucket;
      const built = nhudTapeRows(bucket * 100);
      _nhudAltCol.innerHTML = built.html;
      _nhudAltCol._maxV = built.maxV;
    }
    if (_nhudAltCol && typeof _nhudAltCol._maxV === 'number') {
      const offset = NHUD_TAPE_MASK_CENTER - (_nhudAltCol._maxV - ft) * NHUD_TAPE_PX_PER_UNIT;
      _nhudAltCol.style.transform = `translateY(${offset.toFixed(1)}px)`;
    }
  }
  // pitch ladder tilt from plane attitude (reuse shared euler scratch)
  if (_nhudPitch) {
    const e = _hudEuler.setFromQuaternion(plane.quat, 'YXZ');
    const pitchPx = Math.max(-40, Math.min(40, (e.x * 180 / Math.PI) * 1.4));
    _nhudPitch.style.transform = `translateX(-50%) translateY(${pitchPx.toFixed(1)}px)`;
  }
}

// WIND chip under the left cluster — kts derived from the ambient gust
// amplitude (nhudWindGust, set by updateAirfieldAmbient); no wind vector
// exists in the physics model, so direction is a stable fixed heading. 2Hz.
let _nhudWindLast = 0;
let _nhudWindVal = null;
function updateWindHUD() {
  const now = performance.now();
  if (now - _nhudWindLast < 500) return;
  _nhudWindLast = now;
  if (!_nhudWindVal) _nhudWindVal = document.getElementById('nhud-wind-val');
  if (!_nhudWindVal) return;
  const kts = Math.round(nhudWindGust * 22);
  const text = `NE ${kts}KT`;
  if (_nhudWindVal.textContent !== text) _nhudWindVal.textContent = text;
}

function updateHUD(dt = 1 / 60) {
  // Speed — m/s * ~1.94 = knots
  const sp = plane.vel.length() * 1.94;
  const spRound = Math.min(999, Math.round(sp));
  if (hudCache.speed !== spRound) {
    hudCache.speed = spRound;
    $speed.textContent = spRound;
  }

  // Altitude in feet (y in m × 3.28), clamped to realistic ceiling
  const rawFt = plane.pos.y * 3.28;
  const ft = Math.max(0, Math.min(3000, Math.round(rawFt)));
  if (hudCache.alt !== ft) {
    hudCache.alt = ft;
    $alt.textContent = ft;
  }

  // Heading from forward vector
  const fwd = _hudFwd.set(0, 0, -1).applyQuaternion(plane.quat);
  let hdg = Math.atan2(fwd.x, -fwd.z) * 180 / Math.PI;
  if (hdg < 0) hdg += 360;
  const hdgStr = String(Math.round(hdg)).padStart(3, '0');
  if (hudCache.hdg !== hdgStr) {
    hudCache.hdg = hdgStr;
    $hdg.textContent = hdgStr;
  }
  if (hudCache.hdgMirror !== hdgStr) {
    hudCache.hdgMirror = hdgStr;
    if ($hdgMirror) $hdgMirror.textContent = hdgStr;
  }

  // Vertical speed
  vsSmoothed += (plane.vel.y * 197 - vsSmoothed) * 0.1;
  const vsRound = Math.round(vsSmoothed);
  if (hudCache.vs !== vsRound) {
    hudCache.vs = vsRound;
    $vs.textContent = vsRound;
  }

  // AoA
  const invQ = _hudInvQ.copy(plane.quat).invert();
  const localVel = _hudLocalVel.copy(plane.vel).applyQuaternion(invQ);
  const fwdSpd = -localVel.z;
  const aoa = fwdSpd > 1 ? Math.atan2(-localVel.y, fwdSpd) * 180 / Math.PI : 0;
  const aoaStr = aoa.toFixed(1);
  if (hudCache.aoa !== aoaStr) {
    hudCache.aoa = aoaStr;
    $aoa.textContent = aoaStr;
  }
  const aoaClass = Math.abs(aoa) > 17 ? 'warn' : '';
  if (hudCache.aoaClass !== aoaClass) {
    hudCache.aoaClass = aoaClass;
    $aoa.className = aoaClass;
  }

  const terrH = getSurfaceHeight(plane.pos.x, plane.pos.z);
  const aglFt = Math.max(0, (plane.pos.y - terrH) * 3.28);
  updateFlightPhase(sp, aglFt, aoa);

  // G-force estimate: lift acceleration / g (smoothed)
  const accel = _hudAccel.copy(plane.vel).sub(lastVel).divideScalar(0.016666666666666666);
  const planeUp = _hudPlaneUp.set(0, 1, 0).applyQuaternion(plane.quat);
  const gInst = (accel.dot(planeUp) / GRAVITY) + Math.cos(aoa * Math.PI / 180);
  gSmoothed += (gInst - gSmoothed) * 0.15;
  const gStr = gSmoothed.toFixed(1);
  if (hudCache.gforce !== gStr) {
    hudCache.gforce = gStr;
    $gforce.textContent = gStr;
  }
  lastVel.copy(plane.vel);

  // Gear status
  let gearText = '';
  let gearClass = '';
  if (plane.glbGear) {
    const gg = plane.glbGear;
    if (gg.anim > 0.02 && gg.anim < 0.98) { gearText = 'MOVING'; gearClass = 'warn'; }
    else if (gg.deployed) { gearText = 'DOWN'; gearClass = 'ok'; }
    else { gearText = 'UP'; gearClass = ''; }
  } else if (plane.fixedGear) {
    gearText = 'FIXED';
    gearClass = 'ok';
  } else if (plane.gear > 0.95) {
    gearText = 'DOWN'; gearClass = 'ok';
  } else if (plane.gear < 0.05) {
    gearText = 'UP'; gearClass = '';
  } else {
    gearText = 'MOVING'; gearClass = 'warn';
  }
  if (hudCache.gearText !== gearText) {
    hudCache.gearText = gearText;
    $gear.textContent = gearText;
  }
  if (hudCache.gearClass !== gearClass) {
    hudCache.gearClass = gearClass;
    $gear.className = gearClass;
  }

  // Hull + ammo readouts
  if ($hullPct) {
    const pct = Math.max(0, Math.round(plane.health));
    const shd = Math.max(0, Math.round((plane.shield || 0) / Math.max(1, plane.shieldMax || 50) * 100));
    plane.shieldPulse = Math.max(0, (plane.shieldPulse || 0) - dt * 1.6);
    
    if (hudCache.hullPct !== pct) {
      hudCache.hullPct = pct;
      $hullPct.textContent = pct;
      const pctClass = pct > 65 ? 'ok' : pct > 30 ? 'warn' : 'err';
      if (hudCache.hullClass !== pctClass) {
        hudCache.hullClass = pctClass;
        $hullPct.className = pctClass;
      }
    }
    if ($shieldPct) {
      if (hudCache.shieldPct !== shd) {
        hudCache.shieldPct = shd;
        $shieldPct.textContent = shd;
        if ($shdBar) $shdBar.style.width = shd + '%';
      }
      const shdClass = shd > 55 ? 'ok' : shd > 0 ? 'warn' : '';
      if (hudCache.shieldClass !== shdClass) {
        hudCache.shieldClass = shdClass;
        $shieldPct.className = shdClass;
      }
    }
    if ($hullBar) {
      const barPct = plane.shield > 0 ? shd : pct;
      const barWidthStr = barPct + '%';
      if (hudCache.hullBarWidth !== barWidthStr) {
        hudCache.hullBarWidth = barWidthStr;
        $hullBar.style.width = barWidthStr;
      }
      const barBg = plane.shield > 0 ? '#74efff' : pct > 65 ? '#63d27a' : pct > 30 ? '#ffd56b' : '#ff6f6f';
      if (hudCache.hullBarBg !== barBg) {
        hudCache.hullBarBg = barBg;
        $hullBar.style.background = barBg;
      }
      const barShadow = plane.shieldPulse > 0 ? '0 0 14px rgba(116,239,255,0.85)' : '';
      if (hudCache.hullBarShadow !== barShadow) {
        hudCache.hullBarShadow = barShadow;
        $hullBar.style.boxShadow = barShadow;
      }
    }
  }
  if ($ammoVal) {
    const a = Math.floor(combatState.ammo);
    const msl = Math.floor(combatState.missilesAmmo);
    const alienLeft = Math.max(0, (combatState.alienWeaponUntil - performance.now()) / 1000);
    if (hudCache.ammoVal !== a) {
      hudCache.ammoVal = a;
      $ammoVal.textContent = a;
    }
    if ($ammoMax && hudCache.ammoMax !== combatState.ammoMax) {
      hudCache.ammoMax = combatState.ammoMax;
      $ammoMax.textContent = combatState.ammoMax;
    }
    if ($missileVal && hudCache.missileVal !== msl) {
      hudCache.missileVal = msl;
      $missileVal.textContent = msl;
    }
    if ($supplyVal) {
      const rewardInfo = getNextPracticeRewardInfo();
      const earnActive = combatSupplyEarnActive();
      const missileProgress = combatState.missilesAmmo >= combatState.missilesMax
        ? 1
        : clamp01(combatState.missileEarnBank || 0);
      let supplyText = '';
      if (rewardInfo) {
        supplyText = `TGT ${rewardInfo.index + 1}: ${formatPracticeReward(rewardInfo.reward)}`;
      } else if (combatState.ammo >= combatState.ammoMax && combatState.missilesAmmo >= combatState.missilesMax) {
        supplyText = 'FULL';
      } else if (!earnActive) {
        supplyText = 'IDLE';
      } else if (combatState.missilesAmmo < combatState.missilesMax) {
        supplyText = `MSL ${Math.round(missileProgress * 100)}%`;
      } else {
        supplyText = 'AMMO';
      }
      if (hudCache.supplyVal !== supplyText) {
        hudCache.supplyVal = supplyText;
        $supplyVal.textContent = supplyText;
      }
    }
    if ($weaponMode) {
      const heatPct = Math.round((combatState.heat || 0) * 100);
      let modeText = '';
      let modeClass = '';
      if (performance.now() < (combatState.overheatedUntil || 0)) {
        modeText = `OVERHEATED · COOLING ${heatPct}%`;
        modeClass = 'hud-subtle warn';
      } else if (alienLeft > 0) {
        modeText = `ALIEN PULSE ${Math.ceil(alienLeft)}S · HEAT ${heatPct}%`;
        modeClass = 'hud-subtle ok';
      } else {
        const lockPct = Math.round((targetHudState.lockAmount || 0) * 100);
        if (targetHudState.lockSolid) modeText = `MSL LOCK · ${targetHudState.activeLabel || 'TARGET'} · HEAT ${heatPct}%`;
        else if ((targetHudState.lockAmount || 0) > 0.35) modeText = `MSL TRACK ${lockPct}% · ${targetHudState.activeLabel || 'TARGET'} · HEAT ${heatPct}%`;
        else if (targetHudState.selectedLabel) modeText = `TGT ${targetHudState.selectedLabel} · C CYCLE · HEAT ${heatPct}%`;
        else modeText = `C TARGET · X MSL · HEAT ${heatPct}%`;
        modeClass = 'hud-subtle';
      }
      if (hudCache.weaponModeText !== modeText) {
        hudCache.weaponModeText = modeText;
        $weaponMode.textContent = modeText;
      }
      if (hudCache.weaponModeClass !== modeClass) {
        hudCache.weaponModeClass = modeClass;
        $weaponMode.className = modeClass;
      }
    }
    updateWeaponProgressHud();
    if ($ammoBar) {
      const barWidth = (a / combatState.ammoMax * 100).toFixed(0) + '%';
      const barBg = alienLeft > 0 ? '#74efff' : a > combatState.ammoMax * 0.3 ? '#ffcc66' : '#ff8866';
      if (hudCache.ammoBarWidth !== barWidth) {
        hudCache.ammoBarWidth = barWidth;
        $ammoBar.style.width = barWidth;
      }
      if (hudCache.ammoBarBg !== barBg) {
        hudCache.ammoBarBg = barBg;
        $ammoBar.style.background = barBg;
      }
    }
  }
  if ($scoreVal && window.__gameScore) {
    const pts = window.__gameScore.points || 0;
    const prevPts = Number($scoreVal.dataset.prevScore || 0);
    if (hudCache.scoreVal !== pts) {
      hudCache.scoreVal = pts;
      $scoreVal.textContent = pts;
      $scoreVal.dataset.prevScore = String(pts);
      if ($scoreChip && pts > prevPts) {
        $scoreChip.classList.remove('score-pop');
        void $scoreChip.offsetWidth;
        $scoreChip.classList.add('score-pop');
      }
    }
    const streakText = `${window.__gameScore.streak}× · B ${window.__gameScore.banked || 0} / RISK ${window.__gameScore.unbanked || 0}`;
    if (hudCache.scoreStreak !== streakText) {
      hudCache.scoreStreak = streakText;
      if ($scoreStreak) $scoreStreak.textContent = streakText;
    }
  }
  const combatRecent = (performance.now() - (combatState.lastFiredAt || 0)) < 7000;
  const combatVisible = combatRecent || combatState.fireHeld || combatState.missiles.some(m => m.active) || alienWeaponActive() || (targetHudState.lockAmount || 0) > 0.18 || (combatState.kills || 0) > 0 || plane.crashed;
  const aeroChipHidden = !combatVisible && plane.onGround && sp < 40;
  if ($aeroChip) {
    if (hudCache.aeroChipHidden !== aeroChipHidden) {
      hudCache.aeroChipHidden = aeroChipHidden;
      $aeroChip.classList.toggle('is-hidden', aeroChipHidden);
    }
  }
  const ammoChipHidden = !combatVisible;
  if ($ammoChip) {
    if (hudCache.ammoChipHidden !== ammoChipHidden) {
      hudCache.ammoChipHidden = ammoChipHidden;
      $ammoChip.classList.toggle('is-hidden', ammoChipHidden);
    }
  }
  if ($scoreChip) $scoreChip.classList.remove('is-hidden');

  // ——— Dev overlay: show prop count, fixed-gear, world-rev, throttle ———
  if (typeof _devInfo !== 'undefined' && _devInfo) {
    const propCnt = (plane.props && plane.props.length) || 0;
    const devInfoText =
      `PROP ${propCnt}×  ·  FIXED-GEAR ${plane.fixedGear ? 'Y' : 'N'}  ·  ` +
      `THR ${Math.round(plane.throttle * 100)}%  ·  ` +
      `SPD ${(plane.vel.length()*1.94).toFixed(0)}kt  ·  ` +
      `POS ${plane.pos.x.toFixed(0)},${plane.pos.y.toFixed(0)},${plane.pos.z.toFixed(0)}`;
    if (hudCache.devInfoText !== devInfoText) {
      hudCache.devInfoText = devInfoText;
      _devInfo.textContent = devInfoText;
    }
  }

  if (_inputDebugLine1 && _inputDebugLine2 && _inputDebugLine3 && _inputDebugLine4 && _inputDebugLine5) {
    const focusLabel = document.hasFocus() ? 'Y' : 'N';
    const secureLabel = window.isSecureContext ? 'Y' : 'N';
    const visibilityLabel = String(document.visibilityState || 'unknown').toUpperCase();
    const activeLabel = gamepadState.connected ? `#${gamepadState.index}` : 'NONE';
    const axisSummary = (gamepadState.axesRaw || []).slice(0, 6).map((v, i) => `A${i}:${v >= 0 ? '+' : ''}${v.toFixed(2)}`).join('  ');
    const buttonSummary = (gamepadState.buttonsRaw || []).slice(0, 10).map((v, i) => `B${i}:${v.toFixed(2)}`).join('  ');
    
    const dbg1 = `PADS ${gamepadState.padCount || 0} · ACTIVE ${activeLabel} · MAP ${gamepadState.mapping || '—'}`;
    const dbg2 = `FOCUS ${focusLabel} · SECURE ${secureLabel} · ${visibilityLabel}`;
    const dbg3 = `ID ${gamepadState.id || '—'}`;
    const dbg4 = `AX ${axisSummary || '—'}`;
    const dbg5 = `BTN ${buttonSummary || '—'}`;
    
    if (hudCache.inputDebug1 !== dbg1) { hudCache.inputDebug1 = dbg1; _inputDebugLine1.textContent = dbg1; }
    if (hudCache.inputDebug2 !== dbg2) { hudCache.inputDebug2 = dbg2; _inputDebugLine2.textContent = dbg2; }
    if (hudCache.inputDebug3 !== dbg3) { hudCache.inputDebug3 = dbg3; _inputDebugLine3.textContent = dbg3; }
    if (hudCache.inputDebug4 !== dbg4) { hudCache.inputDebug4 = dbg4; _inputDebugLine4.textContent = dbg4; }
    if (hudCache.inputDebug5 !== dbg5) { hudCache.inputDebug5 = dbg5; _inputDebugLine5.textContent = dbg5; }
  }

  // ——— Attitude indicator (artificial horizon) ———
  if (typeof _aiBall !== 'undefined' && _aiBall) {
    const euler = _hudEuler.setFromQuaternion(plane.quat, 'YXZ');
    const pitchDeg = euler.x * 180 / Math.PI;
    const rollDeg  = euler.z * 180 / Math.PI;
    const pitchPx  = Math.max(-55, Math.min(55, pitchDeg * 2.2));
    const trans = `translateY(${pitchPx}px) rotate(${-rollDeg}deg)`;
    if (hudCache.aiBallTransform !== trans) {
      hudCache.aiBallTransform = trans;
      _aiBall.style.transform = trans;
    }
    const rollText = `P ${pitchDeg.toFixed(0)}° · R ${rollDeg.toFixed(0)}°`;
    if (hudCache.aiRollText !== rollText) {
      hudCache.aiRollText = rollText;
      if (_aiRollText) _aiRollText.textContent = rollText;
    }
  }

  const tp = Math.round(plane.throttle * 100);
  $throttleVal.textContent = tp;
  $throttleBar.style.width = tp + '%';
  const highPowerLabel = isPropAirframe() ? '◈ HIGH POWER' : '◈ AFTERBURNER';
  $abStatus.textContent = tp > 55 ? highPowerLabel : ' ';
  $abStatus.className = tp > 55 ? 'warn' : '';
  const boostText = tp >= 55 ? 'SURGE' : 'RDY';
  if (hudCache.boostText !== boostText) {
    hudCache.boostText = boostText;
    if ($nhudBoostVal) $nhudBoostVal.textContent = boostText;
  }

  // ENG temp (derived, cosmetic) — 60 + throttle*35 + engine damage*40 °C
  const engC = Math.round(60 + plane.throttle * 35 + (plane.damage.engine || 0) * 40);
  if (hudCache.engPct !== engC) {
    hudCache.engPct = engC;
    if ($engPct) $engPct.textContent = engC;
    if ($engBar) $engBar.style.width = Math.min(100, (engC - 60) / 0.75) + '%';
  }
  // FUEL (cosmetic-only slow drain; no fuel system exists, refreshed on reset)
  nhudFuel = Math.max(15, nhudFuel - dt * 0.35);
  const fuelR = Math.round(nhudFuel);
  if (hudCache.fuelPct !== fuelR) {
    hudCache.fuelPct = fuelR;
    if ($fuelPct) $fuelPct.textContent = fuelR;
    if ($fuelBar) $fuelBar.style.width = fuelR + '%';
  }
  // FPS chip
  nhudFps += (1 / Math.max(dt, 1e-3) - nhudFps) * 0.08;
  const fpsR = Math.round(nhudFps);
  if (hudCache.fps !== fpsR) {
    hudCache.fps = fpsR;
    if ($fpsVal) $fpsVal.textContent = fpsR;
  }
  // PING chip — only shown when multiplayer is connected
  const mpOn = !!(typeof multiplayerState !== 'undefined' && multiplayerState.connected);
  const pingHidden = !mpOn;
  if (hudCache.pingHidden !== pingHidden) {
    hudCache.pingHidden = pingHidden;
    if ($pingChip) $pingChip.style.display = pingHidden ? 'none' : 'flex';
  }
  if (mpOn) {
    const ptext = String(Math.round(multiplayerState.pingMs || 0));
    if (hudCache.pingText !== ptext) {
      hudCache.pingText = ptext;
      if ($pingVal) $pingVal.textContent = ptext;
    }
  }

  if (!helpStripState.autoCollapsed && running && (sp > 42 || !plane.onGround)) {
    setHelpStripCollapsed(true);
    helpStripState.autoCollapsed = true;
  }
  updateStatusGuidance(sp, aoa);
  updateReticleHud(dt);
  updateTargetHud(dt);
  updateCourseDirectorHUD();
  updateMultiplayerRaceHUD();
  if (typeof updateCompassHUD === 'function') updateCompassHUD(hdg);
  if (typeof updateContactsHUD === 'function') updateContactsHUD();
  if (typeof updateRadarHUD === 'function') updateRadarHUD();
  if (typeof updateCenterHUD === 'function') updateCenterHUD(spRound, ft);
  if (typeof updateWindHUD === 'function') updateWindHUD();
}
