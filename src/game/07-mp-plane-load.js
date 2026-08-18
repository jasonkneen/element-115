// @module src/game/07-mp-plane-load.js
// =============================================================
//  DAMAGE DECALS (D12) — scorch-mark sprites attached to the jet.
//  Each decal is a sprite parented under `jet` so it rides with
//  the plane. Pool size caps visual clutter; old decals fade.
// =============================================================
(function setupDamageDecals() {
  const DECAL_COUNT = 6;
  const tex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    // radial gradient: dark core → soft edge, irregular blob via noise
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 60);
    grad.addColorStop(0, 'rgba(14,10,8,0.95)');
    grad.addColorStop(0.35, 'rgba(38,28,22,0.75)');
    grad.addColorStop(0.8, 'rgba(60,40,28,0.25)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    // sprinkle a few darker dots for texture variation
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 10 + Math.random() * 40;
      const x = 64 + Math.cos(a) * r;
      const y = 64 + Math.sin(a) * r;
      const s = 2 + Math.random() * 6;
      g.fillStyle = `rgba(10,8,8,${0.2 + Math.random() * 0.35})`;
      g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace || t.colorSpace;
    return t;
  })();

  const pool = [];
  for (let i = 0; i < DECAL_COUNT; i++) {
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: 0,
      depthWrite: false, depthTest: true,
    });
    const spr = new THREE.Sprite(mat);
    spr.visible = false;
    spr.scale.set(1.4, 1.4, 1);
    jet.add(spr);
    pool.push({ sprite: spr, age: Infinity, life: 0, active: false });
  }

  // Plausible local-space anchor points on the hull (above/below wings,
  // fuselage top/bottom, tail). Picked randomly at spawn time.
  const HULL_ANCHORS = [
    new THREE.Vector3( 1.8, 0.2,  0.6),  // right wing top
    new THREE.Vector3(-1.8, 0.2,  0.6),  // left wing top
    new THREE.Vector3( 0.0, 0.6,  0.0),  // fuselage top
    new THREE.Vector3( 0.0,-0.3, -1.2),  // belly
    new THREE.Vector3( 0.0, 0.8,  2.2),  // tail
    new THREE.Vector3( 1.0, 0.0, -1.4),  // nose-right
    new THREE.Vector3(-1.0, 0.0, -1.4),  // nose-left
  ];

  spawnDamageDecal = function (worldPos, intensity = 0.5) {
    // Find oldest or inactive slot
    let slot = pool.find(p => !p.active);
    if (!slot) {
      slot = pool.reduce((a, b) => (a.age > b.age ? a : b));
    }
    const anchor = HULL_ANCHORS[(Math.random() * HULL_ANCHORS.length) | 0];
    slot.sprite.position.copy(anchor);
    slot.sprite.visible = true;
    slot.sprite.material.opacity = Math.min(1, 0.5 + intensity * 0.6);
    const s = 0.7 + intensity * 1.8;
    slot.sprite.scale.set(s, s, 1);
    slot.age = 0;
    slot.life = 9 + intensity * 16;   // seconds on hull before fade-out
    slot.active = true;
  };

  damageDecalsClear = function () {
    for (const p of pool) {
      p.active = false; p.age = Infinity; p.life = 0;
      p.sprite.visible = false;
      p.sprite.material.opacity = 0;
    }
  };

  // Registered on the animation loop via a global list probed each frame
  window.__damageDecalUpdate = (dt) => {
    for (const p of pool) {
      if (!p.active) continue;
      p.age += dt;
      const remaining = p.life - p.age;
      if (remaining <= 0) {
        p.active = false; p.sprite.visible = false; p.sprite.material.opacity = 0;
        continue;
      }
      // Fade in last 2.5s; otherwise hold full opacity
      if (remaining < 2.5) {
        p.sprite.material.opacity = Math.max(0, (remaining / 2.5) * 0.95);
      }
    }
  };
})();
bootLog.step('damage decals', typeof spawnDamageDecal === 'function' && spawnDamageDecal.length > 0,
  spawnDamageDecal.length > 0 ? '6 sprite slots' : 'STUB (IIFE did not run — check for earlier errors)');

const multiplayerState = {
  enabled: !!MULTIPLAYER_URL,
  connected: false,
  connecting: false,
  ws: null,
  playerId: `p_${Math.random().toString(36).slice(2, 10)}`,
  remotePlayers: new Map(),
  sendTimer: 0,
  reconnectAt: 0,
  failedAttempts: 0,
};
const MP_RACE_BEST_KEY = 'flight_mp_race_best_ms';
const multiplayerRaceState = {
  status: 'idle',
  raceId: '',
  startedAt: 0,
  startedWallAt: 0,
  countdownUntil: 0,
  finishedAt: 0,
  localGateIndex: 0,
  gateCount: 0,
  localLapMs: 0,
  bestMs: (() => {
    try {
      const v = Number(localStorage.getItem(MP_RACE_BEST_KEY));
      return Number.isFinite(v) && v > 0 ? v : 0;
    } catch {
      return 0;
    }
  })(),
  lastGateAt: 0,
  lastAnnouncement: '',
  lastAnnouncementUntil: 0,
  adoptedStart: false,
};

function formatRaceTime(ms, compact = false) {
  if (!Number.isFinite(ms) || ms <= 0) return compact ? '--' : '--:--.---';
  const total = Math.max(0, Math.floor(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  if (compact) return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds}.${String(Math.floor(millis / 100)).padStart(1, '0')}`;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function announceMultiplayerRace(title, detail = '', tone = 'ok') {
  multiplayerRaceState.lastAnnouncement = title;
  multiplayerRaceState.lastAnnouncementUntil = performance.now() + 1600;
  if (typeof window.showComboBanner === 'function') window.showComboBanner(title, detail, tone === 'warn' ? '#ffcc66' : '#7fe6ff');
  if (typeof flashStatus === 'function') flashStatus(detail ? `${title} · ${detail}` : title, tone === 'warn' ? 'panel warn' : 'panel ok', 1.4);
}

function resetPracticeCourseForRace() {
  const course = window.__practiceRingCourse;
  if (!course || !course.length) return 0;
  const activeCount = course.activeCount || course.length || 0;
  course.nextIndex = 0;
  course.completedRuns = course.completedRuns || 0;
  for (const ring of course) {
    if (ring && ring.userData) ring.userData.scored = false;
  }
  return activeCount;
}

function startMultiplayerRaceCountdown(opts = {}) {
  const activeCount = resetPracticeCourseForRace();
  const now = performance.now();
  const wallNow = Date.now();
  const requestedWallStart = Number(opts.startedWallAt);
  const startedWallAt = Number.isFinite(requestedWallStart)
    ? Math.max(wallNow + 700, requestedWallStart)
    : wallNow + 3200;
  multiplayerRaceState.status = 'countdown';
  multiplayerRaceState.raceId = opts.raceId || `race_${wallNow.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  multiplayerRaceState.startedAt = 0;
  multiplayerRaceState.startedWallAt = startedWallAt;
  multiplayerRaceState.countdownUntil = now + Math.max(700, startedWallAt - wallNow);
  multiplayerRaceState.finishedAt = 0;
  multiplayerRaceState.localGateIndex = 0;
  multiplayerRaceState.gateCount = activeCount;
  multiplayerRaceState.localLapMs = 0;
  multiplayerRaceState.lastGateAt = 0;
  multiplayerRaceState.adoptedStart = !!opts.adopted;
  announceMultiplayerRace(opts.adopted ? 'SYNC START' : 'RACE ARMED', `${Math.max(1, Math.ceil((multiplayerRaceState.countdownUntil - now) / 1000))} SECOND COUNTDOWN`);
  if (multiplayerState.connected) sendMultiplayerState();
}

function beginMultiplayerRaceIfDue(now = performance.now()) {
  if (multiplayerRaceState.status !== 'countdown') return;
  if (now < multiplayerRaceState.countdownUntil) return;
  multiplayerRaceState.status = 'racing';
  multiplayerRaceState.startedAt = now;
  multiplayerRaceState.localLapMs = 0;
  multiplayerRaceState.localGateIndex = 0;
  multiplayerRaceState.lastGateAt = now;
  announceMultiplayerRace('GO', 'THREAD THE COURSE');
}

function finishMultiplayerRace(activeCount = multiplayerRaceState.gateCount) {
  if (multiplayerRaceState.status !== 'racing') return;
  const now = performance.now();
  multiplayerRaceState.status = 'finished';
  multiplayerRaceState.finishedAt = now;
  multiplayerRaceState.localGateIndex = Math.max(multiplayerRaceState.localGateIndex, activeCount || multiplayerRaceState.localGateIndex);
  multiplayerRaceState.localLapMs = Math.max(1, now - multiplayerRaceState.startedAt);
  if (!multiplayerRaceState.bestMs || multiplayerRaceState.localLapMs < multiplayerRaceState.bestMs) {
    multiplayerRaceState.bestMs = multiplayerRaceState.localLapMs;
    try { localStorage.setItem(MP_RACE_BEST_KEY, String(Math.round(multiplayerRaceState.bestMs))); } catch {}
  }
  announceMultiplayerRace('RACE COMPLETE', `${formatRaceTime(multiplayerRaceState.localLapMs)} · BEST ${formatRaceTime(multiplayerRaceState.bestMs, true)}`);
  if (multiplayerState.connected) sendMultiplayerState();
}

function recordMultiplayerRaceGate(nextGateIndex, activeCount) {
  beginMultiplayerRaceIfDue();
  if (multiplayerRaceState.status !== 'racing') return;
  multiplayerRaceState.gateCount = activeCount || multiplayerRaceState.gateCount;
  multiplayerRaceState.localGateIndex = Math.max(multiplayerRaceState.localGateIndex, Math.min(activeCount || nextGateIndex, nextGateIndex));
  multiplayerRaceState.localLapMs = Math.max(1, performance.now() - multiplayerRaceState.startedAt);
  multiplayerRaceState.lastGateAt = performance.now();
  if (activeCount > 0 && nextGateIndex >= activeCount) finishMultiplayerRace(activeCount);
  if (multiplayerState.connected) sendMultiplayerState();
}

function toggleMultiplayerRace() {
  startMultiplayerRaceCountdown();
}

function buildLocalRaceState() {
  beginMultiplayerRaceIfDue();
  const now = performance.now();
  const lapMs = multiplayerRaceState.status === 'racing'
    ? Math.max(1, now - multiplayerRaceState.startedAt)
    : multiplayerRaceState.localLapMs;
  return {
    version: 1,
    raceId: multiplayerRaceState.raceId,
    status: multiplayerRaceState.status,
    gateIndex: multiplayerRaceState.localGateIndex,
    gateCount: multiplayerRaceState.gateCount || (window.__practiceRingCourse ? (window.__practiceRingCourse.activeCount || window.__practiceRingCourse.length || 0) : 0),
    lapMs: Math.round(lapMs || 0),
    bestMs: Math.round(multiplayerRaceState.bestMs || 0),
    startedWallAt: multiplayerRaceState.startedWallAt || 0,
    countdownMs: multiplayerRaceState.status === 'countdown' ? Math.max(0, Math.round(multiplayerRaceState.countdownUntil - now)) : 0,
    t: Date.now(),
  };
}

function maybeAdoptRemoteRaceCountdown(race) {
  if (!race || race.status !== 'countdown') return;
  if (multiplayerRaceState.status !== 'idle' && multiplayerRaceState.status !== 'finished') return;
  const startedWallAt = Number(race.startedWallAt);
  if (!Number.isFinite(startedWallAt) || !startedWallAt) return;
  const delta = startedWallAt - Date.now();
  if (delta < 250 || delta > 9000) return;
  startMultiplayerRaceCountdown({
    startedWallAt,
    raceId: race.raceId || '',
    adopted: true,
  });
}

function makeCallsignTexture(text, colorHex = 0xffe6b0) {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 80;
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = 'rgba(8,10,16,0.72)';
  g.strokeStyle = 'rgba(255,230,176,0.28)';
  g.lineWidth = 3;
  const r = 18;
  g.beginPath();
  g.moveTo(r, 8);
  g.lineTo(c.width - r, 8);
  g.quadraticCurveTo(c.width - 8, 8, c.width - 8, r);
  g.lineTo(c.width - 8, c.height - r);
  g.quadraticCurveTo(c.width - 8, c.height - 8, c.width - r, c.height - 8);
  g.lineTo(r, c.height - 8);
  g.quadraticCurveTo(8, c.height - 8, 8, c.height - r);
  g.lineTo(8, r);
  g.quadraticCurveTo(8, 8, r, 8);
  g.closePath();
  g.fill();
  g.stroke();
  const color = new THREE.Color(colorHex);
  g.fillStyle = `rgba(${Math.round(color.r*255)}, ${Math.round(color.g*255)}, ${Math.round(color.b*255)}, 0.98)`;
  g.font = '700 34px system-ui';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(text || 'PILOT').slice(0, 16), c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  tex.colorSpace = THREE.SRGBColorSpace || tex.colorSpace;
  return tex;
}

function setRemotePlayerCallsign(rec, text) {
  if (!rec || !rec.group || !rec.labelSprite) return;
  rec.callsign = sanitizeCallsign(text || rec.id || 'PILOT');
  rec.labelSprite.material.map = makeCallsignTexture(rec.callsign, rec.colorHex || 0xffe6b0);
  rec.labelSprite.material.needsUpdate = true;
}

function applyMultiplayerUrl(url, reconnect = true) {
  MULTIPLAYER_URL = normalizeMultiplayerUrl(url);
  try {
    if (MULTIPLAYER_URL) localStorage.setItem(MULTIPLAYER_URL_KEY, MULTIPLAYER_URL);
    else localStorage.removeItem(MULTIPLAYER_URL_KEY);
  } catch {}
  if (multiplayerState.ws) {
    try { multiplayerState.ws.close(); } catch {}
    multiplayerState.ws = null;
  }
  multiplayerState.connected = false;
  multiplayerState.connecting = false;
  multiplayerState.failedAttempts = 0;
  multiplayerState.enabled = !!MULTIPLAYER_URL;
  multiplayerState.reconnectAt = reconnect && MULTIPLAYER_URL ? 0 : Date.now() + 2000;
  for (const t of traffic || []) {
    if (!t.group) continue;
    t.group.visible = trafficEnabled() && (!t.destructible || t.destructible.alive);
  }
  syncMultiplayerIndicator();
}

function setMultiplayerRoom(room, reconnect = true) {
  MULTIPLAYER_ROOM = String(room || '').trim() || 'default';
  persistPlayerProfile();
  if (multiplayerState.connected || multiplayerState.connecting) {
    applyMultiplayerUrl(MULTIPLAYER_URL, reconnect);
  }
  syncMultiplayerIndicator();
}

function setPlayerCallsign(value) {
  playerProfileState.callsign = sanitizeCallsign(value);
  persistPlayerProfile();
  syncMultiplayerIndicator();
  if (multiplayerState.connected) sendMultiplayerState();
}

function setPlayerSpawnMode(mode) {
  playerProfileState.spawnMode = normalizeSpawnMode(mode);
  try { localStorage.setItem(PLAYER_SPAWN_EXPLICIT_KEY, '1'); } catch {}
  persistPlayerProfile();
  if (!running) resetPlane();
  syncMultiplayerSetupUI();
}

function syncMultiplayerSetupUI() {
  try {
    const hostUrl = defaultMultiplayerUrl();
    if (mpCallsignInput) mpCallsignInput.value = playerProfileState.callsign;
    if (mpUrlInput) {
      mpUrlInput.value = MULTIPLAYER_URL;
      mpUrlInput.placeholder = hostUrl;
    }
    if (mpRoomInput) mpRoomInput.value = MULTIPLAYER_ROOM;
    if (mpSpawnRow) {
      while (mpSpawnRow.firstChild) mpSpawnRow.removeChild(mpSpawnRow.firstChild);
      SPAWN_OPTIONS.forEach(opt => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'mp-spawn-btn' + (playerProfileState.spawnMode === opt.key ? ' active' : '');
        b.textContent = opt.label;
        b.addEventListener('click', () => setPlayerSpawnMode(opt.key));
        mpSpawnRow.appendChild(b);
      });
    }
    if (mpSetupNote) {
      const trafficLine = 'Leave server blank for SOLO. Enter a websocket URL only when a multiplayer server is running.';
      mpSetupNote.textContent = `${trafficLine} Spawn: ${SPAWN_OPTIONS.find(opt => opt.key === playerProfileState.spawnMode)?.label || 'SKY'} · Callsign: ${playerProfileState.callsign}.`;
    }
  } catch (err) {
    console.warn('[mp-ui] setup failed', err && err.message || err);
  }
}

function buildLocalMultiplayerState() {
  return {
    pos: { x: plane.pos.x, y: plane.pos.y, z: plane.pos.z },
    quat: { x: plane.quat.x, y: plane.quat.y, z: plane.quat.z, w: plane.quat.w },
    throttle: plane.throttle,
    gear: plane.gear,
    lights: plane.landingLights,
    callsign: playerProfileState.callsign,
    spawnMode: playerProfileState.spawnMode,
    planeKey: getActivePropPreset().key,
    speedKts: Math.min(999, plane.vel.length() * 1.94),
    vel: { x: Math.round(plane.vel.x * 100) / 100, y: Math.round(plane.vel.y * 100) / 100, z: Math.round(plane.vel.z * 100) / 100 },
    race: buildLocalRaceState(),
    t: Date.now(),
  };
}

function makeRemotePlayerMesh(colorHex) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: 0.22,
    roughness: 0.45,
    metalness: 0.15,
    transparent: true,
    opacity: 0.8,
  });
  const wingMat = bodyMat.clone();
  wingMat.opacity = 0.68;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.35, 8, 10), bodyMat);
  body.rotation.x = Math.PI / 2;
  group.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.6, 10), bodyMat);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -4.4;
  group.add(nose);
  const wings = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.12, 1.8), wingMat);
  wings.position.set(0, -0.05, 0.5);
  wings.rotation.z = 0.04;
  group.add(wings);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 1.1), wingMat);
  tail.position.set(0, 0.1, 3.35);
  group.add(tail);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.1, 1.2), wingMat);
  fin.position.set(0, 0.6, 3.2);
  group.add(fin);
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 10, 8),
    new THREE.MeshBasicMaterial({ color: colorHex, toneMapped: false, transparent: true, opacity: 0.9 })
  );
  beacon.position.set(0, 1.8, 0.2);
  group.add(beacon);
  const labelSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeCallsignTexture('PILOT', colorHex),
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  }));
  labelSprite.position.set(0, 4.2, 0);
  labelSprite.scale.set(8.8, 2.2, 1);
  group.add(labelSprite);
  group.userData.labelSprite = labelSprite;
  group.scale.setScalar(1.35);
  applyShadowFlags(group, { cast: false, receive: false });
  return group;
}

function colorFromId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return new THREE.Color().setHSL((h % 360) / 360, 0.72, 0.62).getHex();
}

function ensureRemotePlayer(id) {
  if (!multiplayerState.remotePlayers.has(id)) {
    const colorHex = colorFromId(id);
    const group = makeRemotePlayerMesh(colorHex);
    scene.add(group);
    multiplayerState.remotePlayers.set(id, {
      id,
      colorHex,
      group,
      labelSprite: group.userData.labelSprite,
      callsign: sanitizeCallsign(id),
      planeKey: '',
      race: null,
      speedKts: 0,
      targetPos: new THREE.Vector3(),
      targetQuat: new THREE.Quaternion(),
      targetVel: new THREE.Vector3(),
      receivedAt: performance.now(),
      lastSeen: Date.now(),
    });
  }
  return multiplayerState.remotePlayers.get(id);
}

function removeRemotePlayer(id) {
  const existing = multiplayerState.remotePlayers.get(id);
  if (!existing) return;
  scene.remove(existing.group);
  multiplayerState.remotePlayers.delete(id);
}

function handleMultiplayerMessage(raw) {
  let msg;
  try { msg = JSON.parse(typeof raw === 'string' ? raw : String(raw)); }
  catch { return; }
  if (!msg || msg.id === multiplayerState.playerId) return;
  if (msg.type === 'welcome') {
    multiplayerState.enabled = true;
    syncMultiplayerIndicator();
    const players = Array.isArray(msg.players) ? msg.players : [];
    for (const p of players) handleMultiplayerMessage({ type: 'state', ...p });
    return;
  }
  if (msg.type === 'leave') {
    removeRemotePlayer(msg.id);
    syncMultiplayerIndicator();
    return;
  }
  if (msg.type === 'state' && msg.state) {
    const rec = ensureRemotePlayer(msg.id);
    rec.targetPos.set(msg.state.pos.x, msg.state.pos.y, msg.state.pos.z);
    rec.targetQuat.set(msg.state.quat.x, msg.state.quat.y, msg.state.quat.z, msg.state.quat.w);
    if (msg.state.vel) rec.targetVel.set(msg.state.vel.x, msg.state.vel.y, msg.state.vel.z);
    else rec.targetVel.set(0, 0, 0);
    rec.receivedAt = performance.now();
    rec.planeKey = msg.state.planeKey || rec.planeKey || '';
    rec.speedKts = msg.state.speedKts != null ? msg.state.speedKts : rec.speedKts || 0;
    rec.race = msg.state.race || rec.race || null;
    if (rec.race) maybeAdoptRemoteRaceCountdown(rec.race);
    if (msg.state.callsign) setRemotePlayerCallsign(rec, msg.state.callsign);
    rec.lastSeen = Date.now();
    syncMultiplayerIndicator();
  }
}

function connectMultiplayer() {
  if (!MULTIPLAYER_URL || multiplayerState.ws || multiplayerState.connecting) {
    syncMultiplayerIndicator();
    return;
  }
  multiplayerState.connecting = true;
  syncMultiplayerIndicator();
  try {
    const ws = new WebSocket(MULTIPLAYER_URL);
    multiplayerState.ws = ws;
    ws.addEventListener('open', () => {
      multiplayerState.connecting = false;
      multiplayerState.connected = true;
      multiplayerState.enabled = true;
      multiplayerState.failedAttempts = 0;
      multiplayerState.sendTimer = 0;
      ws.send(JSON.stringify({
        type: 'join',
        room: MULTIPLAYER_ROOM,
        id: multiplayerState.playerId,
        state: buildLocalMultiplayerState(),
      }));
      syncMultiplayerIndicator();
    });
    ws.addEventListener('message', ev => handleMultiplayerMessage(ev.data));
    ws.addEventListener('close', () => {
      multiplayerState.ws = null;
      multiplayerState.connected = false;
      multiplayerState.connecting = false;
      multiplayerState.failedAttempts += 1;
      if (multiplayerState.failedAttempts >= 3) {
        multiplayerState.enabled = false;
        multiplayerState.reconnectAt = Infinity;
      } else {
        multiplayerState.reconnectAt = Date.now() + Math.min(15000, 2000 * multiplayerState.failedAttempts);
      }
      syncMultiplayerIndicator();
    });
    ws.addEventListener('error', () => {
      try { ws.close(); } catch {}
    });
  } catch {
    multiplayerState.ws = null;
    multiplayerState.connected = false;
    multiplayerState.connecting = false;
    multiplayerState.failedAttempts += 1;
    multiplayerState.reconnectAt = multiplayerState.failedAttempts >= 3 ? Infinity : Date.now() + Math.min(15000, 2000 * multiplayerState.failedAttempts);
    syncMultiplayerIndicator();
  }
}

function syncMultiplayerIndicator() {
  if (typeof $mpInd === 'undefined' || !$mpInd) return;
  const tag = playerProfileState.callsign;
  if (!MULTIPLAYER_URL) {
    $mpInd.textContent = `${tag} · SOLO`;
    $mpInd.className = 'hud-chip';
    return;
  }
  if (multiplayerState.connected) {
    $mpInd.textContent = `${tag} · ${multiplayerState.remotePlayers.size + 1}UP`;
    $mpInd.className = 'hud-chip ok';
  } else if (multiplayerState.connecting) {
    $mpInd.textContent = `${tag} · LINK`;
    $mpInd.className = 'hud-chip warn';
  } else {
    $mpInd.textContent = `${tag} · ${multiplayerState.failedAttempts >= 3 ? 'SOLO' : 'OFF'}`; 
    $mpInd.className = multiplayerState.failedAttempts >= 3 ? 'hud-chip' : 'hud-chip warn';
  }
}

function sendMultiplayerState() {
  if (!multiplayerState.connected || !multiplayerState.ws || multiplayerState.ws.readyState !== WebSocket.OPEN) return;
  multiplayerState.ws.send(JSON.stringify({
    type: 'state',
    room: MULTIPLAYER_ROOM,
    id: multiplayerState.playerId,
    state: buildLocalMultiplayerState(),
  }));
}

const _mpPredicted = new THREE.Vector3();

function updateMultiplayer(dt) {
  if (MULTIPLAYER_URL && multiplayerState.enabled !== false && !multiplayerState.connected && !multiplayerState.connecting && Date.now() >= multiplayerState.reconnectAt) {
    connectMultiplayer();
  }
  for (const [id, rec] of multiplayerState.remotePlayers) {
    if (Date.now() - rec.lastSeen > 7000) {
      removeRemotePlayer(id);
      continue;
    }
    const lead = Math.min((performance.now() - rec.receivedAt) / 1000, 0.35);
    _mpPredicted.copy(rec.targetPos).addScaledVector(rec.targetVel, lead);
    const smooth = 1 - Math.exp(-8 * dt);
    if (rec.group.position.distanceTo(_mpPredicted) > 80) {
      rec.group.position.copy(_mpPredicted);
    } else {
      rec.group.position.lerp(_mpPredicted, smooth);
    }
    rec.group.quaternion.slerp(rec.targetQuat, smooth);
  }
  if (!running) return;
  multiplayerState.sendTimer += dt;
  if (multiplayerState.sendTimer > 0.08) {
    multiplayerState.sendTimer = 0;
    sendMultiplayerState();
  }
}

// =============================================================
//  OPTIONAL GLB PLANE SWAP
//  Launched with ?plane=<filename.glb> — replaces the procedural
//  body mesh with a GLB model while keeping afterburner, strobe,
//  shadow, physics anchors, etc. intact.
// =============================================================
(function loadOptionalPlaneGLB() {
  // Use the same parser as boot config so the selected preset and the loader
  // cannot disagree about whether a query or a copied tweak hash is active.
  const params = getGameParamsFromLocation();
  let planeFile = params.get('plane');
  let explicitSelection = resolvePropPresetFromParams(params);
  const removedPlaneParam = !!(planeFile && REMOVED_PROP_MODEL_FILES.has(planeFile));
  const invalidPlaneParam = removedPlaneParam || explicitSelection.invalid;

  function replaceWithSafeAircraftUrl(preset) {
    const cleanUrl = new URL(location.href);
    const nextParams = new URLSearchParams(params);
    // Tweaks only have meaning for the model that failed/rejected. Keep
    // non-aircraft game settings (spawn, debug, room), but never carry a
    // rejected model's transform or class flags onto the E-115 fallback.
    for (const key of ['plane', 'variant', 's', 'rx', 'ry', 'rz', 'dx', 'dy', 'dz', 'px', 'py', 'pz', 'jet']) {
      nextParams.delete(key);
    }
    applyPropPresetIdentityToParams(nextParams, preset);
    cleanUrl.search = nextParams.toString() ? `?${nextParams.toString()}` : '';
    // A rejected hash must not resurrect the unsafe model on a refresh.
    if ((cleanUrl.hash || '').includes('=')) cleanUrl.hash = '';
    if (window.history && window.history.replaceState) window.history.replaceState(null, '', cleanUrl.toString());
  }

  if (invalidPlaneParam) {
    const fallback = markAircraftVisualFallback(removedPlaneParam ? 'REMOVED AIRCRAFT' : 'UNRECOGNISED AIRCRAFT');
    applyPropPresetIdentityToParams(params, fallback);
    replaceWithSafeAircraftUrl(fallback);
    planeFile = fallback.file;
    explicitSelection = { preset: fallback, invalid: false };
  } else if (!planeFile) {
    const preset = getActivePropPreset();
    if (preset) {
      applyPropPresetToParams(params, preset);
      planeFile = params.get('plane');
      explicitSelection = { preset, invalid: false };
    }
  }
  const selectedPreset = explicitSelection.preset || findPropPresetByPlaneFile(planeFile);
  if (!planeFile || planeFile === 'default') {
    markAircraftVisualLoaded(selectedPreset || getDefaultPropPreset());
    return;
  }

  // Snapshot user-authored URL/hash tweaks BEFORE hangar-preset fill-ins.
  // Preset keys (e.g. a10 rx:90, f15 ry:0) must NOT block plane-tweaks.json —
  // that was breaking calibrated scale/position for half the roster.
  const userUrlTweakKeys = new Set(
    ['s', 'rx', 'ry', 'rz', 'dx', 'dy', 'dz', 'px', 'py', 'pz'].filter((k) => params.has(k))
  );

  // Prefer the hangar preset (if this file maps to one) so jet flag + orientation
  // from PROP_MODEL_PRESETS always apply even when the URL is sparse.
  const matchedPreset = selectedPreset;
  if (!matchedPreset) {
    // This should be unreachable after the explicit allow-list above, but keep
    // the loader closed if the registry ever changes independently.
    const fallback = markAircraftVisualFallback('UNRECOGNISED AIRCRAFT');
    replaceWithSafeAircraftUrl(fallback);
    return;
  }
  markAircraftVisualLoading(matchedPreset);
  if (matchedPreset) {
    if (matchedPreset.jet && params.get('jet') !== '1') params.set('jet', '1');
    if (matchedPreset.variant != null && !params.has('variant')) params.set('variant', String(matchedPreset.variant));
    for (const k of ['s', 'rx', 'ry', 'rz', 'dy']) {
      if (matchedPreset[k] != null && !params.has(k)) params.set(k, String(matchedPreset[k]));
    }
  }

  // URL params for tweaking: #plane=X&s=<scale>&rx=&ry=&rz=&dy=
  // (may include hangar-preset fill-ins; plane-tweaks.json still wins later unless
  // the user explicitly put the key in the URL).
  const userScale = parseFloat(params.get('s'));
  const rx = (parseFloat(params.get('rx')) || 0) * Math.PI / 180;
  // Most models face +Z (sim forward is -Z) so the DEFAULT is a 180 flip —
  // but an explicit ry must win, INCLUDING ry=0 for models authored facing -Z
  // (the old `|| 180` treated 0 as "unset" and made ry=0 impossible to express).
  const ryRaw = parseFloat(params.get('ry'));
  const ry = (Number.isFinite(ryRaw) ? ryRaw : 180) * Math.PI / 180;
  const rz = (parseFloat(params.get('rz')) || 0) * Math.PI / 180;
  const dy = parseFloat(params.get('dy')) || 0;

  // — Tiny on-screen status HUD so you always know what's happening
  const hud = document.createElement('div');
  hud.style.cssText = `
    position:fixed; top:10px; left:50%; transform:translateX(-50%);
    background:rgba(8,14,25,0.85); color:#4ecbff; border:1px solid #1f2a44;
    font:12px/1.4 ui-monospace, Menlo, monospace; padding:6px 12px;
    border-radius:6px; letter-spacing:0.1em; z-index:9999;
    pointer-events:none; backdrop-filter:blur(4px);
  `;
  hud.textContent = `▸ LOADING ${planeFile}`;
  document.body.appendChild(hud);

  // References to the procedural body meshes — hide immediately so the user
  // sees something changed, even before the GLB finishes downloading.
  //
  // Keep ONLY the nav-light meshes (navRed/navGrn/strobe) because those
  // are functional aircraft markers a GLB model doesn't provide.
  // `scanner` (cyan belly box) and `bellyLight` (orange sphere) were
  // stylistic choices tied to the procedural jet — they read as stray
  // "blue thing / orange ball" floating through the GLB hull, so hide
  // them with the rest. Afterburner visuals stay hidden on prop planes
  // (the plane-swap later explicitly hides them for props).
  const keepRefs = new Set([
    jet.userData.strobe,
    jet.userData.navRed,
    jet.userData.navGrn,
  ]);
  const hiddenProcedural = [];
  jet.traverse(obj => {
    if (obj === jet) return;
    if (keepRefs.has(obj)) return;
    if (obj.isMesh && obj.visible) {
      obj.visible = false;
      hiddenProcedural.push(obj);
    }
  });

  const restoreProcedural = () => {
    for (const m of hiddenProcedural) m.visible = true;
  };

  if (typeof THREE.GLTFLoader !== 'function') {
    const fallback = markAircraftVisualFallback('GLTF LOADER UNAVAILABLE');
    replaceWithSafeAircraftUrl(fallback);
    hud.style.color = '#ff4e7a';
    hud.textContent = `✕ GLTFLoader not available — using ${fallback.hudLabel}`;
    restoreProcedural();
    setTimeout(() => hud.remove(), 4000);
    return;
  }

  const loader = new THREE.GLTFLoader();
  loader.load(
    planeFile,
    (gltf) => {
      const model = gltf.scene || (gltf.scenes && gltf.scenes[0]);
      if (!model) {
        const fallback = markAircraftVisualFallback('EMPTY AIRCRAFT MODEL');
        replaceWithSafeAircraftUrl(fallback);
        plane.aircraftKey = fallback.key;
        plane.aircraftSpec = getAircraftSpecByPreset(fallback);
        hud.style.color = '#ff4e7a';
        hud.textContent = `✕ Empty GLB — using ${fallback.hudLabel}`;
        restoreProcedural();
        setTimeout(() => hud.remove(), 4000);
        return;
      }

      // Mark model + descendants so animation loop skips them
      model.userData.__isGLBPlane = true;
      model.traverse(o => { o.userData.__isGLBPlane = true; });

      // Normalise size — target wingspan ~11 units based on the largest axis
      // (some models are nose-first, some wing-first; use max of all 3)
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3(); box.getSize(size);
      const center = new THREE.Vector3(); box.getCenter(center);
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const targetMax = 12;
      const auto = targetMax / maxDim;
      const s = (isFinite(userScale) && userScale > 0) ? userScale : auto;

      model.scale.setScalar(s);
      model.position.set(0, 0, 0);
      model.rotation.set(rx, ry, rz);
      // Re-center AFTER rotation. Centering pre-rotation leaves models that
      // need ry±90 (F-15 LP, etc.) several metres off the jet origin — the
      // chase cam frames jet.position, so the mesh looks uncentered / "wrong".
      model.updateMatrixWorld(true);
      {
        const postBox = new THREE.Box3().setFromObject(model);
        const postCenter = new THREE.Vector3();
        postBox.getCenter(postCenter);
        model.position.set(-postCenter.x, -postCenter.y + dy, -postCenter.z);
      }
      model.updateMatrixWorld(true);

      // Compute the model's bounds in the frame it is ABOUT to live in
      // (jet-local), BEFORE attaching to jet. If we ran setFromObject
      // after jet.add(model), matrixWorld would include jet.position
      // (already moved to plane.pos by the first animate() tick by the
      // time this async callback fires), pushing the procedural prop
      // tens of metres off the nose and out of frame. See bug: "prop
      // spins in telemetry but is invisible on screen".
      const modelBoxLocal = new THREE.Box3().setFromObject(model);

      // The stunt variants share the real stunt-plane mesh and swap between
      // the four copied livery textures.
      const activePropPreset = getActivePropPreset();
      const isStuntVariant = /stunt_plane\.glb$/i.test(planeFile)
        || !!(activePropPreset && (activePropPreset.type || '').includes('Stunt'));
      if (isStuntVariant) {
        let stuntTex = null;
        const variant = String(params.get('variant') || getActivePropPreset().variant || '1');
        const safeVariant = /^[1-4]$/.test(variant) ? variant : '1';
        try {
          stuntTex = new THREE.TextureLoader().load(
            `models/Polygon_Plane_Texture_0${safeVariant}.png`,
            (loaded) => {
              const styled = loaded && loaded.image
                ? makeStyledStuntPlaneTextureFromImage(loaded.image, safeVariant)
                : (stuntTex || makeStuntPlanePaintTexture(1024));
              model.traverse(o => {
                if (!o || !o.isMesh || !o.material) return;
                const applyStyled = (m) => {
                  if (!m || !('map' in m)) return m;
                  m.map = styled;
                  if (m.color) m.color.set(0xffffff);
                  m.userData = Object.assign({}, m.userData, { __preserveTextureShading: true });
                  m.needsUpdate = true;
                  return m;
                };
                o.material = Array.isArray(o.material) ? o.material.map(applyStyled) : applyStyled(o.material);
              });
            }
          );
          stuntTex.colorSpace = THREE.SRGBColorSpace || stuntTex.colorSpace;
          stuntTex.flipY = false;
          stuntTex.anisotropy = 4;
          stuntTex.needsUpdate = true;
        } catch (_) {
          stuntTex = makeStuntPlanePaintTexture(1024);
        }
        model.traverse(o => {
          if (!o || !o.isMesh || !o.material) return;
          const applyTo = (m) => {
            if (!m || !('map' in m)) return m;
            const next = m.clone();
            if (!next.map) next.map = stuntTex || makeStuntPlanePaintTexture(1024);
            if (next.color) next.color.set(0xffffff);
            if ('metalness' in next) next.metalness = Math.min(0.16, next.metalness ?? 0.16);
            if ('roughness' in next) next.roughness = 0.54;
            next.userData = Object.assign({}, next.userData, { __preserveTextureShading: true });
            next.needsUpdate = true;
            return next;
          };
          o.material = Array.isArray(o.material) ? o.material.map(applyTo) : applyTo(o.material);
        });
      }

      applyShadowFlags(model);
      jet.add(model);
      // The GLB lands seconds into gameplay (flight starts before the async load
      // finishes), so its MeshStandardMaterial program variants would otherwise
      // compile lazily on its first rendered frame — a classic multi-hundred-ms
      // hitch (shader compile + texture upload in one frame). Compile now, while
      // the model is freshly attached, instead of mid-flight on first sight.
      // Warm every aux-light state, not just the current one — otherwise the next
      // group toggle (dusk crossing, L key, replay start) re-hitches on the GLB's
      // materials. Already-warm scene materials are program-cache hits, so each
      // extra pass compiles only the GLB's few distinct programs.
      prewarmLightStatePrograms();

      // Swapped-in GLB planes default to fixed-gear. If we find a real
      // retract animation (F-15 clips) or named wheel nodes, wire glbGear so
      // G toggles a visual retract. Physics gear stays fixed unless the
      // airframe is a jet with a clip (true retractable undercarriage).
      const aircraftSpec = getAircraftSpecByPreset(matchedPreset);
      plane.aircraftKey = matchedPreset.key;
      plane.aircraftSpec = aircraftSpec;
      plane.fixedGear = !!aircraftSpec.ground.fixedGear;
      plane.gear = 1;
      plane.gearTarget = 1;
      plane.glbGear = null;

      // ——— GLB retractable-gear: animation clips first (F-15 "F15 ldg" / "flight_mode") ———
      // These models have no "wheel" node names — gear is bone-driven via GLTF clips.
      try {
        const clips = (gltf.animations && gltf.animations.length) ? gltf.animations : [];
        const gearClip = clips.find((c) => /ldg|gear|landing|undercarriage|flight[_\s-]?mode/i.test(c.name || ''))
          || (clips.length === 1 ? clips[0] : null);
        if (gearClip && typeof THREE.AnimationMixer === 'function') {
          const mixer = new THREE.AnimationMixer(model);
          const action = mixer.clipAction(gearClip);
          action.enabled = true;
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
          action.play();
          action.paused = true;
          const duration = Math.max(0.05, gearClip.duration || 1);

          // Decide which end of the clip is gear-DOWN: sample mid gear-bone Y
          // at t=0 vs t=duration — lower mean world Y = wheels extended.
          const sampleGearY = (t) => {
            action.time = Math.max(0, Math.min(duration, t));
            mixer.update(0);
            model.updateMatrixWorld(true);
            let sum = 0, n = 0;
            model.traverse((o) => {
              if (!o || !o.isMesh) return;
              // Prefer bones known to move in the F-15 ldg clip, else any mesh
              // under a bone* parent near the belly half of the model.
              const nm = (o.name || '') + ' ' + ((o.parent && o.parent.name) || '');
              if (!/bone23|bone26|bone31|bone32|bone33|bone34|wheel|gear|ldg|cylinder_1[012]|cylinder_2[4-8]/i.test(nm)) return;
              const box = new THREE.Box3().setFromObject(o);
              if (box.isEmpty()) return;
              sum += (box.min.y + box.max.y) * 0.5;
              n++;
            });
            return n ? sum / n : 0;
          };
          const y0 = sampleGearY(0);
          const y1 = sampleGearY(duration);
          // invert=false → time 0 = DOWN (anim 1), time duration = UP (anim 0)
          const invert = y0 > y1 + 0.02; // t=0 higher ⇒ t=0 is retracted
          action.time = invert ? duration : 0;
          mixer.update(0);

          plane.glbGear = {
            mode: 'clip',
            mixer,
            action,
            duration,
            invert: !!invert,
            deployed: true,
            anim: 1,
            nodes: [],
          };
          // Jets with a real gear clip: couple into physics gear (drag / gear-up landings).
          if (matchedPreset && matchedPreset.jet) {
            plane.fixedGear = false;
            plane.gear = 1;
            plane.gearTarget = 1;
          }
          jet.userData.glbAnimMixer = mixer;
          console.log(`[plane-swap] GLB gear CLIP "${gearClip.name}" ${duration.toFixed(2)}s invert=${!!invert} y0=${y0.toFixed(2)} y1=${y1.toFixed(2)}`);
        }
      } catch (e) {
        console.warn('[plane-swap] gear clip setup failed', e && e.message || e);
        plane.glbGear = null;
      }

      // ——— Named wheel/strut nodes (stunt / tucano / p100 / trainer) ———
      // Cosmetic retract: translate+squash. plane.fixedGear stays true so
      // gear-up crash path does not fire on prop planes with decorative wheels.
      if (!plane.glbGear) {
        try {
          const gearNameRx = /gear|wheel|tyre|tire|strut|undercarriage|lg_|oleo/i;
          const paintChildRx = /_paint_0$|_plane_0$/i;   // skip texture-only child nodes
          const rawGear = [];
          model.traverse(o => {
            if (!o || o === model) return;
            const nm = o.name || '';
            if (gearNameRx.test(nm) && !paintChildRx.test(nm)) rawGear.push(o);
          });
          const gearSet = new Set(rawGear);
          // Prefer the top-most matched transform node (drop matched descendants).
          const topGear = rawGear.filter(o => {
            let p = o.parent;
            while (p && p !== model) { if (gearSet.has(p)) return false; p = p.parent; }
            return true;
          });
          if (topGear.length) {
            jet.updateMatrixWorld(true);
            const pScale = new THREE.Vector3();
            const nodes = topGear.map(node => {
              const box = new THREE.Box3().setFromObject(node);   // world-space AABB
              const h = box.isEmpty() ? 0.5 : (box.max.y - box.min.y);
              if (node.parent) node.parent.getWorldScale(pScale); else pScale.set(1, 1, 1);
              // Spin only true wheels (not housings/struts) on ground roll.
              const spin = /wheel|tyre|tire/i.test(node.name || '')
                && !/box|strut|oleo|undercarriage/i.test(node.name || '');
              return {
                node,
                baseY: node.position.y,
                baseScaleY: node.scale.y,
                tuck: (h * 1.2) / (pScale.y || 1),   // retract lift in node-local units
                spin,
                radius: Math.max(0.15, h * 0.5),     // world-unit wheel radius for spin
              };
            });
            plane.glbGear = { mode: 'nodes', nodes, deployed: true, anim: 1 };
            console.log(`[plane-swap] GLB gear: ${nodes.length} node(s) [${topGear.map(n => n.name).join(', ')}], `
              + `${nodes.filter(n => n.spin).length} spinning`);
          }
        } catch (e) { plane.glbGear = null; }
      }

      // Keep the HUD gear chip visible. Retractable GLB gear starts DOWN and is
      // driven per-frame in updateHUD (P8); fixed-gear models stay FIXED.
      const ch2 = document.getElementById('ch-line2');
      if (ch2) ch2.textContent = 'SHIFT/CTRL THROTTLE · SPACE GUNS · C TARGET · X MSL · M MODEL · P OPTIONS · R RESET · G GEAR';
      const gearRow = document.getElementById('gear');
      if (gearRow) {
        gearRow.textContent = plane.glbGear ? 'DOWN' : 'FIXED';
        gearRow.className = 'ok';
        if (gearRow.parentElement) gearRow.parentElement.style.display = '';
      }

      // ——— Kill jet-specific FX on swapped-in PROP planes only ———
      // The procedural afterburner + engine contrail + heat-haze only make
      // sense for fighters. GLB presets flagged jet:true (F-15, A-10) keep
      // them and get jet engine audio instead of the prop sample loop.
      const jetSwap = params.get('jet') === '1' || !!(matchedPreset && matchedPreset.jet);
      if (!jetSwap) {
        if (jet.userData.afterburner) jet.userData.afterburner.visible = false;
        if (jet.userData.ab2)         jet.userData.ab2.visible = false;
        plane.suppressJetFX = true;
      } else {
        plane.suppressJetFX = false;
      }

      // ——— Find propeller meshes to spin ———
      // Jets skip the entire prop pipeline (named / extracted / procedural).
      const propNames = /prop(eller)?|blade|spinner|rotor|fan/i;
      const props = [];
      const rawProps = [];
      // Set when geometry extraction FOUND a cluster but the confidence
      // checks (P3) rejected it as a mis-detection. Suppresses the procedural
      // spinner fallback so we prefer NO prop over a visibly wrong one.
      let extractionRejected = false;
      if (jetSwap) {
        plane.props = [];
        console.log('[plane-swap] jet airframe — skipped prop detection');
      } else {
      const addPropDiscToPivot = (pivot, sweepR) => {
        if (!(sweepR > 0.12)) return;
        const discGeo = new THREE.CircleGeometry(sweepR * 1.02, 40);
        const discMat = new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 0.0,
          side: THREE.DoubleSide, depthWrite: false,
        });
        const disc = new THREE.Mesh(discGeo, discMat);
        disc.position.z = -0.02;
        disc.renderOrder = 2;
        pivot.add(disc);
        pivot.userData.__disc = disc;
        pivot.userData.__sweepR = sweepR;
      };
      const wrapNamedPropPivot = (node) => {
        if (!node || !node.parent || node.userData.__apWrappedProp) return null;
        node.updateMatrixWorld(true);
        const parent = node.parent;
        parent.updateMatrixWorld(true);
        const worldBox = new THREE.Box3().setFromObject(node);
        if (worldBox.isEmpty()) return null;
        const centerWorld = worldBox.getCenter(new THREE.Vector3());
        const sizeWorld = worldBox.getSize(new THREE.Vector3());
        const centerLocal = parent.worldToLocal(centerWorld.clone());
        const pivot = new THREE.Group();
        pivot.name = 'ap_named_prop_' + (node.name || 'prop');
        pivot.position.copy(centerLocal);
        parent.add(pivot);
        parent.updateMatrixWorld(true);
        pivot.attach(node);
        // Clone every mesh material under this pivot so the per-frame blade
        // fade (transparent=true, opacity<1) doesn't bleed into other meshes
        // that share the source material with the prop node.
        const cloneOne = (m) => (m && typeof m.clone === 'function') ? m.clone() : m;
        node.traverse(child => {
          if (!child || !child.isMesh || !child.material) return;
          child.material = Array.isArray(child.material)
            ? child.material.map(cloneOne)
            : cloneOne(child.material);
        });
        pivot.userData.__propAxis = 'z';
        pivot.userData.__isNamedProp = true;
        addPropDiscToPivot(pivot, Math.max(sizeWorld.x, sizeWorld.y) * 0.5);
        node.userData.__apWrappedProp = true;
        return pivot;
      };
      // Skip named-prop search for stunt variants — they share the
      // stunt_plane.glb mesh, whose named "prop" node is a low-poly placeholder.
      // Forcing the geometry-extraction path (the Dusty path) gives a real
      // spinning blade pivot + motion-blur disc, matching Dusty's effect.
      if (!isStuntVariant) {
        model.traverse(o => {
          if (!o.isMesh && !o.isObject3D) return;
          if (o === model) return;
          if (propNames.test(o.name || '')) rawProps.push(o);
        });
        const rawPropSet = new Set(rawProps);
        const topLevelRawProps = rawProps.filter((o) => {
          let p = o.parent;
          while (p && p !== model) {
            if (rawPropSet.has(p)) return false;
            p = p.parent;
          }
          return true;
        });
        topLevelRawProps.forEach((o) => {
          const pivot = wrapNamedPropPivot(o);
          if (pivot) props.push(pivot);
        });
      } else {
        console.log('[plane-swap] stunt variant — using Dusty-style extracted prop');
      }

      // ——— Geometry surgery: extract baked-in prop triangles ———
      // Most Sketchfab planes (incl. Disney Dusty) merge the propeller
      // into the fuselage mesh. When no named prop node was found, we
      // isolate triangles clustered near ONE end of the fuselage whose
      // vertices are tightly packed around the central axis (blade-like
      // cross-section), clone them onto a spinning pivot at the hub, and
      // collapse the originals so we don't get a double-render. Runs in
      // jet-local space so rotating the pivot around +Z spins the
      // extracted blades in place along the thrust axis.
      //
      // We don't know a priori which end of the GLB is the nose (models
      // differ in which Z-direction they face — even after the default
      // 180° Y rotation). So we try BOTH ends and score each candidate
      // cluster by tightness (XY radius relative to plane span). A real
      // propeller is tight around the central axis; a tail fin sprawls.
      if (props.length === 0) {
        const spanZ = modelBoxLocal.max.z - modelBoxLocal.min.z;
        const spanX = modelBoxLocal.max.x - modelBoxLocal.min.x;
        const spanY = modelBoxLocal.max.y - modelBoxLocal.min.y;
        jet.updateMatrixWorld(true);
        const jetWorldInv = new THREE.Matrix4().copy(jet.matrixWorld).invert();

        // Per-end candidate: tries triangles whose centroid lies in the
        // near-end slab (either min-z or max-z end). Returns null if no
        // meaningful cluster was found.
        function collectEndCluster(endSign) {
          // endSign = -1 → forward (min-z) 10%, +1 → aft (max-z) 10%.
          const cutZ = endSign < 0
            ? modelBoxLocal.min.z + spanZ * 0.10
            : modelBoxLocal.max.z - spanZ * 0.10;
          // Nose-third cut for the fuselage centreline estimate (P3 recenters
          // the extracted hub's Y onto this so blades spin on the body axis).
          const fuseCutZ = endSign < 0
            ? modelBoxLocal.min.z + spanZ * 0.33
            : modelBoxLocal.max.z - spanZ * 0.33;

          const per = [];                    // per-source-mesh extraction plans
          const blendAccum = { x: 0, y: 0, z: 0, n: 0 };
          // For tightness scoring: mean XY radius of extracted triangles
          let radiusSum = 0;
          // Fuselage-centreline estimate: mean Y of ALL geometry in the nose third.
          let fuseYSum = 0, fuseN = 0;
          // Extracted-cluster AABB (jet-local) — P3 uses depth-vs-sweep to
          // confirm the blades form a disc roughly perpendicular to +Z.
          let cbMinX = Infinity, cbMaxX = -Infinity;
          let cbMinY = Infinity, cbMaxY = -Infinity;
          let cbMinZ = Infinity, cbMaxZ = -Infinity;
          const expandCB = (vx, vy, vz) => {
            if (vx < cbMinX) cbMinX = vx; if (vx > cbMaxX) cbMaxX = vx;
            if (vy < cbMinY) cbMinY = vy; if (vy > cbMaxY) cbMaxY = vy;
            if (vz < cbMinZ) cbMinZ = vz; if (vz > cbMaxZ) cbMaxZ = vz;
          };

          model.traverse(o => {
            if (!o.isMesh || !o.geometry) return;
            const geo = o.geometry;
            const posAttr = geo.attributes.position;
            if (!posAttr) return;
            const idxAttr = geo.index;
            const triCount = idxAttr ? idxAttr.count / 3 : posAttr.count / 3;
            if (triCount < 30) return;

            o.updateMatrixWorld(true);
            const toJetLocal = new THREE.Matrix4().multiplyMatrices(jetWorldInv, o.matrixWorld);

            const vCount = posAttr.count;
            const jlVerts = new Float32Array(vCount * 3);
            const tmp = new THREE.Vector3();
            for (let i = 0; i < vCount; i++) {
              tmp.fromBufferAttribute(posAttr, i).applyMatrix4(toJetLocal);
              jlVerts[i*3]   = tmp.x;
              jlVerts[i*3+1] = tmp.y;
              jlVerts[i*3+2] = tmp.z;
              const inThird = endSign < 0 ? (tmp.z <= fuseCutZ) : (tmp.z >= fuseCutZ);
              if (inThird) { fuseYSum += tmp.y; fuseN++; }
            }

            const srcIndex = idxAttr ? idxAttr.array : null;
            const newStaticIdx = [];
            const propIdx = [];
            const sizeLimit2 = Math.max(spanX, spanY) * Math.max(spanX, spanY) * 0.25;

            for (let t = 0; t < triCount; t++) {
              const i0 = srcIndex ? srcIndex[t*3]   : t*3;
              const i1 = srcIndex ? srcIndex[t*3+1] : t*3+1;
              const i2 = srcIndex ? srcIndex[t*3+2] : t*3+2;
              const z0 = jlVerts[i0*3+2], z1 = jlVerts[i1*3+2], z2 = jlVerts[i2*3+2];
              const cz = (z0 + z1 + z2) / 3;
              const inSlab = endSign < 0 ? (cz <= cutZ) : (cz >= cutZ);
              if (!inSlab) { newStaticIdx.push(i0, i1, i2); continue; }

              const x0 = jlVerts[i0*3],   y0 = jlVerts[i0*3+1];
              const x1 = jlVerts[i1*3],   y1 = jlVerts[i1*3+1];
              const x2 = jlVerts[i2*3],   y2 = jlVerts[i2*3+1];
              const e01 = (x1-x0)*(x1-x0)+(y1-y0)*(y1-y0)+(z1-z0)*(z1-z0);
              const e12 = (x2-x1)*(x2-x1)+(y2-y1)*(y2-y1)+(z2-z1)*(z2-z1);
              const e20 = (x0-x2)*(x0-x2)+(y0-y2)*(y0-y2)+(z0-z2)*(z0-z2);
              const maxEdge2 = Math.max(e01, e12, e20);
              if (maxEdge2 > sizeLimit2) { newStaticIdx.push(i0, i1, i2); continue; }

              propIdx.push(i0, i1, i2);
              expandCB(x0, y0, z0); expandCB(x1, y1, z1); expandCB(x2, y2, z2);
              const cxT = (x0 + x1 + x2) / 3;
              const cyT = (y0 + y1 + y2) / 3;
              const czT = (z0 + z1 + z2) / 3;
              blendAccum.x += cxT;
              blendAccum.y += cyT;
              blendAccum.z += czT;
              blendAccum.n++;
              radiusSum += Math.hypot(cxT, cyT);
            }

            if (propIdx.length >= 60) {   // ≥ 20 triangles
              per.push({ srcMesh: o, propIdx, newStaticIdx });
            }
          });

          if (!per.length || blendAccum.n < 40) return null;
          const meanR = radiusSum / blendAccum.n;
          const planeSpanXY = Math.max(spanX, spanY);
          // Tightness: smaller mean XY radius relative to span = better
          // (real prop blades sweep around the nose axis). Score is
          // lower-is-better.
          const tightness = meanR / planeSpanXY;
          return {
            endSign, per, blendAccum,
            tri: blendAccum.n, meanR, tightness,
            hub: {
              x: blendAccum.x / blendAccum.n,
              y: blendAccum.y / blendAccum.n,
              z: blendAccum.z / blendAccum.n,
            },
            cbox: { minX: cbMinX, maxX: cbMaxX, minY: cbMinY, maxY: cbMaxY, minZ: cbMinZ, maxZ: cbMaxZ },
            fuseY: fuseN ? fuseYSum / fuseN : (blendAccum.y / blendAccum.n),
          };
        }

        const fwd = collectEndCluster(-1);
        const aft = collectEndCluster(+1);

        // Pick the end with the tightest XY cluster. If only one end has
        // a cluster, use that. If neither, fall through to procedural.
        let best = null;
        if (fwd && aft) best = (fwd.tightness < aft.tightness) ? fwd : aft;
        else best = fwd || aft;

        // ——— Confidence gate: prefer NO spin over a wrong one (F17) ———
        // A real propeller is a thin disc on the fuselage axis at the nose.
        // Reject clusters that are (a) too deep in Z to be a blade plane
        // perpendicular to +Z, (b) not near the model's nose extreme, or
        // (c) off the fuselage centreline in X beyond the recenter band.
        if (best) {
          const cz  = best.cbox.maxZ - best.cbox.minZ;
          const cxy = Math.max(best.cbox.maxX - best.cbox.minX, best.cbox.maxY - best.cbox.minY);
          const perpOK   = cz <= cxy * 0.8 + 0.05;
          const noseZ    = best.endSign < 0 ? modelBoxLocal.min.z : modelBoxLocal.max.z;
          const nearNose = Math.abs(best.hub.z - noseZ) <= spanZ * 0.15;
          const axisOK   = Math.abs(best.hub.x) <= 0.6;
          // Real props are a few hundred–few thousand tris. 10k+ usually means
          // we carved a wing/fuselage slab (corsair aft = 40k was a classic fail).
          // Size-only fails still allow the procedural spinner fallback; geometric
          // fails set extractionRejected so we prefer static over a wrong spin.
          const sizeOK   = best.tri <= 8000 && best.tightness < 0.55;
          if (!perpOK || !nearNose || !axisOK || !sizeOK) {
            console.log(`[plane-swap] prop-extraction REJECTED perp=${perpOK} nearNose=${nearNose} axis=${axisOK} size=${sizeOK} `
              + `(cz=${cz.toFixed(2)} cxy=${cxy.toFixed(2)} hubX=${best.hub.x.toFixed(2)} hubZ=${best.hub.z.toFixed(2)} tri=${best.tri} tight=${best.tightness.toFixed(3)}) — static, no wrong spin`);
            best = null;
            if (!perpOK || !nearNose || !axisOK) extractionRejected = true;
          } else {
            // (1) Recenter the spin axis: snap X to the fuselage line and Y
            // onto the nose-third centreline. Applied to best.hub BEFORE the
            // extraction bake (line ~7712) and pivot placement (~7734) below,
            // so blades keep their true world position while rotating about
            // the real prop axis instead of a biased triangle centroid.
            best.hub.x = 0;
            if (Math.abs(best.hub.y - best.fuseY) > 0.5) best.hub.y = best.fuseY;
          }
        }

        if (best) {
          console.log(`[plane-swap] prop-extraction scan: `
            + `fwd=${fwd ? fwd.tri+'tris tight='+fwd.tightness.toFixed(3) : 'none'} `
            + `aft=${aft ? aft.tri+'tris tight='+aft.tightness.toFixed(3) : 'none'} `
            + `→ picked ${best.endSign<0?'fwd':'aft'}`);

          // Apply the extraction: for each source mesh, actually build
          // the extracted geometry and collapse the originals.
          const extractedMeshes = [];
          for (const plan of best.per) {
            const o = plan.srcMesh;
            const geo = o.geometry;
            const keepAttrs = ['position', 'normal', 'uv', 'color', 'tangent'];
            const extractedGeo = new THREE.BufferGeometry();
            const vmap = new Map();
            const newIndex = new Array(plan.propIdx.length);
            for (let k = 0; k < plan.propIdx.length; k++) {
              const oi = plan.propIdx[k];
              let ni = vmap.get(oi);
              if (ni === undefined) { ni = vmap.size; vmap.set(oi, ni); }
              newIndex[k] = ni;
            }
            for (const name of keepAttrs) {
              const src = geo.attributes[name];
              if (!src) continue;
              const itemSize = src.itemSize;
              const dst = new Float32Array(vmap.size * itemSize);
              for (const [oi, ni] of vmap) {
                for (let c = 0; c < itemSize; c++) {
                  dst[ni * itemSize + c] = src.array[oi * itemSize + c];
                }
              }
              extractedGeo.setAttribute(name, new THREE.BufferAttribute(dst, itemSize));
            }
            extractedGeo.setIndex(newIndex);
            extractedGeo.computeBoundingSphere();

            // Collapse extracted triangles in the source
            geo.setIndex(plan.newStaticIdx);
            geo.computeBoundingSphere();

            // The extracted vertices are in the SOURCE mesh's local
            // coords (untouched by our jet-local transform). To attach
            // them to a pivot sitting in jet-local space, we need to
            // bake the source mesh's jet-local transform into the
            // extracted geometry's positions, then subtract the hub.
            o.updateMatrixWorld(true);
            const toJetLocal2 = new THREE.Matrix4().multiplyMatrices(jetWorldInv, o.matrixWorld);
            const pos = extractedGeo.attributes.position;
            const tmp = new THREE.Vector3();
            for (let i = 0; i < pos.count; i++) {
              tmp.fromBufferAttribute(pos, i).applyMatrix4(toJetLocal2);
              pos.setXYZ(i, tmp.x - best.hub.x, tmp.y - best.hub.y, tmp.z - best.hub.z);
            }
            pos.needsUpdate = true;
            extractedGeo.computeBoundingSphere();

            // Clone material(s) — the per-frame prop-blade animation sets
            // transparent=true and opacity<1 on these to fade the spinning
            // blades. If we shared the source fuselage mesh's material, the
            // entire body would go see-through whenever the blades fade
            // (notably on Disney Dusty, whose prop is baked into the
            // fuselage mesh).
            const cloneMat = (m) => (m && typeof m.clone === 'function') ? m.clone() : m;
            const propMat = Array.isArray(o.material)
              ? o.material.map(cloneMat)
              : cloneMat(o.material);
            const extractedMesh = new THREE.Mesh(extractedGeo, propMat);
            extractedMesh.name = 'ap_extracted_prop_from_' + (o.name || 'mesh');
            extractedMeshes.push({ mesh: extractedMesh, sourceName: o.name || '(unnamed)' });
          }

          const propPivot = new THREE.Group();
          propPivot.name = 'ap_extracted_prop';
          propPivot.position.set(best.hub.x, best.hub.y, best.hub.z);
          for (const { mesh } of extractedMeshes) propPivot.add(mesh);

          // Motion-blur disc: a translucent circle in the blade plane
          // that fades in as RPM climbs. Combined with the real spinning
          // blades this produces a natural strobe / beat pattern at high
          // throttle (just like a real prop on camera). We compute the
          // disc radius from the extracted geometry's own bounding sphere
          // so it always matches the actual blade sweep.
          let sweepR = 0;
          for (const { mesh } of extractedMeshes) {
            mesh.geometry.computeBoundingSphere();
            const r = (mesh.geometry.boundingSphere && mesh.geometry.boundingSphere.radius) || 0;
            if (r > sweepR) sweepR = r;
          }
          if (sweepR > 0.2) {
            const discGeo = new THREE.CircleGeometry(sweepR * 1.05, 40);
            const discMat = new THREE.MeshBasicMaterial({
              color: 0xffffff, transparent: true, opacity: 0.0,
              side: THREE.DoubleSide, depthWrite: false,
            });
            const disc = new THREE.Mesh(discGeo, discMat);
            // Face +Z (forward axis) — CircleGeometry is in XY plane by
            // default, so no rotation needed. Push it just ahead of the
            // blades along Z so it doesn't Z-fight with them.
            disc.position.z = -0.02;
            disc.renderOrder = 2;
            propPivot.add(disc);
            propPivot.userData.__disc = disc;
            propPivot.userData.__sweepR = sweepR;
          }

          // Attach to jet first to lock the computed world position, then
          // re-attach as a child of the GLB model so future tweak offsets
          // (py/rx etc) move the prop with the body instead of leaving
          // it floating mid-fuselage. `Object3D.attach()` preserves the
          // world transform across the reparent.
          jet.add(propPivot);
          jet.updateMatrixWorld(true);
          model.updateMatrixWorld(true);
          model.attach(propPivot);
          propPivot.userData.__propAxis = 'z';
          propPivot.userData.__isExtractedProp = true;
          props.push(propPivot);

          const names = extractedMeshes.map(e => e.sourceName).join(', ');
          console.log(`[plane-swap] extracted prop: ${extractedMeshes.length} mesh(es) from [${names}], ${best.tri} tris, hub=(${best.hub.x.toFixed(2)}, ${best.hub.y.toFixed(2)}, ${best.hub.z.toFixed(2)})`);
        }
      }

      // ——— Procedural prop disc fallback ———
      // Only used when BOTH named-node search AND geometry extraction
      // failed to find any prop geometry. The extracted-prop path above
      // handles the common Sketchfab "baked prop" case; this fallback is
      // here for degenerate models (e.g. no nose verts at all).
      // BUGFIX: force fallback when props array is empty (prop_count == 0)
      if (props.length === 0 && !extractionRejected) {
        // Use the pre-attach jet-local bounds captured above. The nose of
        // a +Z-natural model that's been rotated 180° around Y sits at
        // modelBoxLocal.min.z in jet-local space, so we place the prop
        // slightly FORWARD of that (more negative Z).
        const modelBox = modelBoxLocal;
        const cx = (modelBox.min.x + modelBox.max.x) / 2;
        const cy = (modelBox.min.y + modelBox.max.y) / 2;
        const noseZ = modelBox.min.z - 1.5;          // well in front of fuselage
        const span = modelBox.max.x - modelBox.min.x;
        // Half the old diameter — prop should look like a real nose
        // prop, not a helicopter rotor. Clamp and scale factor both
        // halved from previous (span*0.30, clamp 1.5–4.0) → span*0.15,
        // clamp 0.75–2.0.
        const discSize = Math.max(0.75, Math.min(2.0, span * 0.15));

        const propPivot = new THREE.Group();
        propPivot.name = 'ap_procedural_prop';
        propPivot.position.set(cx, cy, noseZ);

        // Two crossed blades — dark with a strong red emissive so they
        // remain visible against any terrain colour and pop on camera.
        const bladeGeo = new THREE.BoxGeometry(discSize * 2.6, 0.18, 0.22);
        const bladeMat = new THREE.MeshStandardMaterial({
          color: 0x1a1a1a, emissive: 0xff3322, emissiveIntensity: 0.35,
          metalness: 0.4, roughness: 0.5
        });
        const blade1 = new THREE.Mesh(bladeGeo, bladeMat);
        const blade2 = new THREE.Mesh(bladeGeo, bladeMat);
        blade2.rotation.z = Math.PI / 2;
        propPivot.add(blade1); propPivot.add(blade2);

        // Motion-blur translucent disc (fades with throttle)
        const discGeo = new THREE.CircleGeometry(discSize * 1.2, 32);
        const discMat = new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 0.18,
          side: THREE.DoubleSide, depthWrite: false,
        });
        const disc = new THREE.Mesh(discGeo, discMat);
        propPivot.add(disc);

        // White spinner cone pointing forward (-Z)
        const hubGeo = new THREE.ConeGeometry(discSize * 0.25, discSize * 0.65, 12);
        const hubMat = new THREE.MeshStandardMaterial({
          color: 0xffffff, metalness: 0.3, roughness: 0.4
        });
        const hub = new THREE.Mesh(hubGeo, hubMat);
        hub.rotation.x = -Math.PI / 2;               // cone axis -> -Z
        hub.position.z = -discSize * 0.25;
        propPivot.add(hub);

        jet.add(propPivot);
        propPivot.userData.__propAxis = 'z';
        propPivot.userData.__isProceduralProp = true;
        propPivot.userData.__disc = disc;
        props.push(propPivot);
        console.log(`[plane-swap] procedural prop @ (x=${cx.toFixed(1)} y=${cy.toFixed(1)} z=${noseZ.toFixed(1)}) discSize=${discSize.toFixed(2)}`);
      } else {
        const tagged = props.map(p =>
          p.userData.__isExtractedProp ? 'extracted'
          : p.userData.__isProceduralProp ? 'procedural'
          : (p.name || 'named')).join(', ');
        console.log(`[plane-swap] ${props.length} prop mesh(es): ${tagged}`);
      }
      } // end !jetSwap prop pipeline

      // CRITICAL: always assign props to plane object so telemetry shows prop_count
      if (!jetSwap) plane.props = props;

      function computeModelBoxInJetLocal() {
        jet.updateMatrixWorld(true);
        model.updateMatrixWorld(true);
        const jetWorldInv = new THREE.Matrix4().copy(jet.matrixWorld).invert();
        const box = new THREE.Box3();
        const tmp = new THREE.Vector3();
        let hasPoint = false;
        model.traverse(o => {
          if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
          o.updateMatrixWorld(true);
          const toJetLocal = new THREE.Matrix4().multiplyMatrices(jetWorldInv, o.matrixWorld);
          const posAttr = o.geometry.attributes.position;
          for (let i = 0; i < posAttr.count; i++) {
            tmp.fromBufferAttribute(posAttr, i).applyMatrix4(toJetLocal);
            if (!hasPoint) {
              box.min.copy(tmp);
              box.max.copy(tmp);
              hasPoint = true;
            } else {
              box.expandByPoint(tmp);
            }
          }
        });
        return hasPoint ? box : modelBoxLocal.clone();
      }
      function computeWingtipAnchors(modelBox) {
        jet.updateMatrixWorld(true);
        model.updateMatrixWorld(true);
        const jetWorldInv = new THREE.Matrix4().copy(jet.matrixWorld).invert();
        const tmp = new THREE.Vector3();
        const spanX = modelBox.max.x - modelBox.min.x;
        const leftXLimit = modelBox.min.x + spanX * 0.08;
        const rightXLimit = modelBox.max.x - spanX * 0.08;
        const left = { x: modelBox.min.x, y: 0, z: 0, n: 0 };
        const right = { x: modelBox.max.x, y: 0, z: 0, n: 0 };
        model.traverse(o => {
          if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
          o.updateMatrixWorld(true);
          const toJetLocal = new THREE.Matrix4().multiplyMatrices(jetWorldInv, o.matrixWorld);
          const posAttr = o.geometry.attributes.position;
          for (let i = 0; i < posAttr.count; i++) {
            tmp.fromBufferAttribute(posAttr, i).applyMatrix4(toJetLocal);
            if (tmp.x <= leftXLimit) {
              left.y += tmp.y;
              left.z += tmp.z;
              left.n++;
            }
            if (tmp.x >= rightXLimit) {
              right.y += tmp.y;
              right.z += tmp.z;
              right.n++;
            }
          }
        });
        return {
          left: new THREE.Vector3(left.x, left.n ? left.y / left.n : (modelBox.min.y + (modelBox.max.y - modelBox.min.y) * 0.5), left.n ? left.z / left.n : (modelBox.min.z + (modelBox.max.z - modelBox.min.z) * 0.46)),
          right: new THREE.Vector3(right.x, right.n ? right.y / right.n : (modelBox.min.y + (modelBox.max.y - modelBox.min.y) * 0.5), right.n ? right.z / right.n : (modelBox.min.z + (modelBox.max.z - modelBox.min.z) * 0.46)),
        };
      }
      function refreshSwappedPlaneAnchors() {
        const modelBox = computeModelBoxInJetLocal();
        const spanX = modelBox.max.x - modelBox.min.x;
        const spanY = modelBox.max.y - modelBox.min.y;
        const spanZ = modelBox.max.z - modelBox.min.z;
        const centerX = (modelBox.min.x + modelBox.max.x) * 0.5;
        const tipInset = Math.max(0.03, spanX * 0.05);
        const tipAnchors = computeWingtipAnchors(modelBox);
        const wingtipL = tipAnchors.left.clone().setX(modelBox.min.x + tipInset);
        const wingtipR = tipAnchors.right.clone().setX(modelBox.max.x - tipInset);
        jet.userData.wingtipL = wingtipL.clone();
        jet.userData.wingtipR = wingtipR.clone();
        if (jet.userData.navRed) {
          jet.userData.navRed.position.copy(wingtipL).add(new THREE.Vector3(-Math.max(0.04, spanX * 0.005), 0.02, 0));
          jet.userData.navRed.userData.__basePos = jet.userData.navRed.position.clone();
        }
        if (jet.userData.navGrn) {
          jet.userData.navGrn.position.copy(wingtipR).add(new THREE.Vector3( Math.max(0.04, spanX * 0.005), 0.02, 0));
          jet.userData.navGrn.userData.__basePos = jet.userData.navGrn.position.clone();
        }
        if (jet.userData.strobe) {
          jet.userData.strobe.position.set(
            centerX,
            modelBox.max.y + Math.max(0.06, spanY * 0.03),
            modelBox.max.z - spanZ * 0.12
          );
        }

        let propHubLocal = new THREE.Vector3(
          centerX,
          modelBox.min.y + spanY * 0.52,
          modelBox.min.z + spanZ * 0.10
        );
        const propRef = props[0];
        if (propRef && typeof propRef.getWorldPosition === 'function') {
          jet.updateMatrixWorld(true);
          model.updateMatrixWorld(true);
          const propWorld = new THREE.Vector3();
          propRef.getWorldPosition(propWorld);
          propHubLocal = jet.worldToLocal(propWorld.clone());
        }
        const smokeDx = Math.max(0.18, spanX * 0.055);
        const smokeDy = Math.max(0.04, spanY * 0.03);
        const smokeDz = Math.max(0.18, spanZ * 0.04);
        jet.userData.engineSmokeL = propHubLocal.clone().add(new THREE.Vector3(-smokeDx, smokeDy, smokeDz));
        jet.userData.engineSmokeR = propHubLocal.clone().add(new THREE.Vector3( smokeDx, smokeDy, smokeDz));
      }
      jet.userData.__refreshSwappedAnchors = refreshSwappedPlaneAnchors;
      refreshSwappedPlaneAnchors();

      jet.userData.visualModel = model;
      const controlSurfaces = { aileronL: [], aileronR: [], elevatorL: [], elevatorR: [], rudder: [] };
      const surfaceDefs = [
        ['aileronL', /(aileron|flap).*(left|_l|\.l|\bl\b)|left.*(aileron|flap)/i],
        ['aileronR', /(aileron|flap).*(right|_r|\.r|\br\b)|right.*(aileron|flap)/i],
        ['elevatorL', /(elevator|stab).*(left|_l|\.l|\bl\b)|left.*(elevator|stab)/i],
        ['elevatorR', /(elevator|stab).*(right|_r|\.r|\br\b)|right.*(elevator|stab)/i],
        ['rudder', /rudder|fin|tail_control/i],
      ];
      model.traverse(o => {
        if (!o || o === model) return;
        const name = o.name || '';
        for (const [key, rx] of surfaceDefs) {
          if (!rx.test(name)) continue;
          controlSurfaces[key].push({ node: o, rx: o.rotation.x, ry: o.rotation.y, rz: o.rotation.z });
          break;
        }
      });
      jet.userData.controlSurfaces = controlSurfaces;

      // The visual has now actually landed in the scene. Commit the selected
      // state only here so HUD, hangar, API, and physics metadata describe the
      // same airframe rather than a requested model that failed to load.
      markAircraftVisualLoaded(matchedPreset);

      hud.style.color = '#5df09a';
      hud.textContent = `✓ ${planeFile} · ×${s.toFixed(2)} · fixed gear${props.length ? ' · '+props.length+' prop(s)' : ''}`;
      console.log('[plane-swap] loaded', planeFile,
        'size=', size.toArray().map(v => v.toFixed(2)).join('×'),
        'scale=', s.toFixed(3));
      setTimeout(() => {
        hud.style.transition = 'opacity 0.8s';
        hud.style.opacity = '0';
        setTimeout(() => hud.remove(), 1000);
      }, 2500);

      // ── In-game tweak HUD + server-side persistence ──────────
      // Sliders live-edit model.scale/rotation/position. "Save"
      // PUTs to /api/tweaks/<file> on localhost (server rejects
      // remote writers). On deploy, the static plane-tweaks.json
      // is fetched on boot and applied when no URL hash overrides.
      const hostIsLocal = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
      const isBuiltStaticGame = /(?:^|\/)game\.html$/i.test(location.pathname);
      const tweakReadEndpoint = (hostIsLocal && !isBuiltStaticGame) ? '/api/tweaks' : 'plane-tweaks.json';

      // Shift model so its AABB centre sits on the jet origin (optional py lift).
      // Call after any scale/rotation change. Explicit px/py/pz tweaks are applied
      // AFTER this so calibrated offsets still work.
      const recenterModelOnJet = (extraPy = 0) => {
        model.updateMatrixWorld(true);
        jet.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(model);
        if (b.isEmpty()) return;
        const cWorld = b.getCenter(new THREE.Vector3());
        const cLocal = jet.worldToLocal(cWorld.clone());
        model.position.x -= cLocal.x;
        model.position.y -= cLocal.y;
        model.position.z -= cLocal.z;
        if (extraPy) model.position.y += extraPy;
      };

      const applyTweak = (t) => {
        if (!t || typeof t !== 'object') return;
        if (Number.isFinite(t.s) && t.s > 0) model.scale.setScalar(t.s);
        if ('rx' in t || 'ry' in t || 'rz' in t) {
          // ry honors an explicit 0 (models authored facing -Z); only a
          // genuinely absent/invalid ry falls back to the default 180 flip.
          const ryDeg = Number.isFinite(Number(t.ry)) ? Number(t.ry) : 180;
          model.rotation.set(
            (Number(t.rx) || 0) * Math.PI / 180,
            ryDeg * Math.PI / 180,
            (Number(t.rz) || 0) * Math.PI / 180
          );
        }
        // Re-center on the jet origin after scale/rotation unless the tweak
        // file supplies an explicit absolute position (calibrated props).
        const hasPos = Number.isFinite(t.px) || Number.isFinite(t.py) || Number.isFinite(t.pz);
        if (hasPos) {
          if (Number.isFinite(t.px)) model.position.x = t.px;
          if (Number.isFinite(t.py)) model.position.y = t.py;
          if (Number.isFinite(t.pz)) model.position.z = t.pz;
        } else {
          recenterModelOnJet(0);
        }
        // Re-capture node-gear rest poses after orientation/scale changes so
        // retract still tucks relative to the final pose.
        if (plane.glbGear && plane.glbGear.mode === 'nodes' && plane.glbGear.nodes) {
          for (const rec of plane.glbGear.nodes) {
            if (!rec || !rec.node) continue;
            rec.baseY = rec.node.position.y;
            rec.baseScaleY = rec.node.scale.y;
          }
        }
        if (typeof jet.userData.__refreshSwappedAnchors === 'function') jet.userData.__refreshSwappedAnchors();
      };

      const snapshotTweak = () => ({
        s:  +model.scale.x.toFixed(4),
        rx: +((model.rotation.x * 180 / Math.PI) % 360).toFixed(2),
        ry: +((model.rotation.y * 180 / Math.PI) % 360).toFixed(2),
        rz: +((model.rotation.z * 180 / Math.PI) % 360).toFixed(2),
        px: +model.position.x.toFixed(3),
        py: +model.position.y.toFixed(3),
        pz: +model.position.z.toFixed(3),
      });

      // Merge order:
      //   1) plane-tweaks.json calibrated baseline (always, when present)
      //   2) hangar-preset fill-ins only for keys not in the tweak file
      //   3) explicit user URL/hash keys always win
      // Previously any preset-injected ry/rx blocked the whole tweak file and
      // left A-10 / F-15 / etc. at auto-scale facing the wrong way.
      fetch(tweakReadEndpoint, { cache: 'no-cache' })
        .then(r => r.ok ? r.json() : {})
        .then(all => {
          if (!all || typeof all !== 'object') all = {};
          const bareKey = planeFile.replace(/^models\//, '');
          const saved = all[planeFile] || all[bareKey] || all['models/' + bareKey] || null;
          if (saved) applyTweak(saved);

          // Preset orientation/scale only fills keys the tweak file omitted
          // and the user did not set in the URL.
          if (matchedPreset) {
            const fill = {};
            for (const k of ['s', 'rx', 'ry', 'rz']) {
              if (matchedPreset[k] == null) continue;
              if (userUrlTweakKeys.has(k)) continue;
              if (saved && Object.prototype.hasOwnProperty.call(saved, k)) continue;
              fill[k] = matchedPreset[k];
            }
            if (matchedPreset.dy != null && !userUrlTweakKeys.has('dy') && !userUrlTweakKeys.has('py')
                && !(saved && (Object.prototype.hasOwnProperty.call(saved, 'py') || Object.prototype.hasOwnProperty.call(saved, 'dy')))) {
              // dy is a URL convenience; map onto py if no py yet
              if (!Number.isFinite(model.position.y) || !(saved && Object.prototype.hasOwnProperty.call(saved, 'py'))) {
                fill.py = matchedPreset.dy;
              }
            }
            if (Object.keys(fill).length) applyTweak(fill);
          }

          // Explicit user URL overrides always win.
          if (userUrlTweakKeys.size) {
            const o = {};
            if (userUrlTweakKeys.has('s')) {
              const v = parseFloat(params.get('s'));
              if (Number.isFinite(v) && v > 0) o.s = v;
            }
            if (userUrlTweakKeys.has('rx')) o.rx = parseFloat(params.get('rx')) || 0;
            if (userUrlTweakKeys.has('ry')) {
              const v = parseFloat(params.get('ry'));
              if (Number.isFinite(v)) o.ry = v;
            }
            if (userUrlTweakKeys.has('rz')) o.rz = parseFloat(params.get('rz')) || 0;
            if (userUrlTweakKeys.has('px')) o.px = parseFloat(params.get('px')) || 0;
            if (userUrlTweakKeys.has('py') || userUrlTweakKeys.has('dy')) {
              const v = parseFloat(params.get(userUrlTweakKeys.has('py') ? 'py' : 'dy'));
              if (Number.isFinite(v)) o.py = v;
            }
            if (userUrlTweakKeys.has('pz') || userUrlTweakKeys.has('dz')) {
              const v = parseFloat(params.get(userUrlTweakKeys.has('pz') ? 'pz' : 'dz'));
              if (Number.isFinite(v)) o.pz = v;
            }
            applyTweak(o);
          }
        })
        .catch(() => {})
        .finally(() => buildTweakHUD());

      function buildTweakHUD() {
        const panel = document.createElement('div');
        panel.id = 'tweak-hud';
        panel.style.cssText = [
          'position:fixed','left:18px','bottom:108px','z-index:9998',
          'font:11px/1.4 ui-monospace, Menlo, monospace','pointer-events:auto',
          'max-width:calc(100vw - 36px)'
        ].join(';');

        // Swallow keystrokes so typing in the inputs doesn't pilot the jet.
        for (const ev of ['keydown','keyup','keypress']) {
          panel.addEventListener(ev, e => e.stopPropagation());
        }

        const title = document.createElement('button');
        title.type = 'button';
        title.style.cssText = [
          'display:flex','align-items:center','justify-content:space-between','gap:10px',
          'width:fit-content','min-width:176px','padding:8px 12px',
          'border:1px solid rgba(255,204,102,0.35)','border-radius:999px',
          'background:rgba(20,10,5,0.78)','color:#ffcc66',
          'letter-spacing:0.16em','cursor:pointer','text-align:left',
          'backdrop-filter:blur(10px)','box-shadow:0 10px 24px rgba(0,0,0,0.26)'
        ].join(';');
        const titleWrap = document.createElement('div');
        titleWrap.style.cssText = 'display:flex;flex-direction:column;gap:1px;';
        const titleText = document.createElement('span');
        titleText.textContent = 'MODEL TUNE [;]';
        titleText.style.cssText = 'font-size:11px;color:#ffe0a0;';
        const titleMeta = document.createElement('span');
        titleMeta.textContent = 'position · rotation · scale';
        titleMeta.style.cssText = 'font-size:9px;letter-spacing:0.08em;opacity:0.58;';
        titleWrap.appendChild(titleText);
        titleWrap.appendChild(titleMeta);
        const collapseBtn = document.createElement('span');
        collapseBtn.textContent = 'EDIT';
        collapseBtn.style.cssText = 'font-size:9px;letter-spacing:0.14em;color:#ffcc66;opacity:0.82;';
        title.appendChild(titleWrap);
        title.appendChild(collapseBtn);
        panel.appendChild(title);

        const body = document.createElement('div');
        body.style.cssText = [
          'margin-top:8px','width:228px','max-width:calc(100vw - 36px)',
          'background:rgba(20,10,5,0.84)','color:#ffe0a0',
          'border:1px solid rgba(255,204,102,0.24)','border-radius:14px',
          'padding:10px 12px 12px','backdrop-filter:blur(12px)',
          'box-shadow:0 16px 38px rgba(0,0,0,0.34)'
        ].join(';');
        panel.appendChild(body);

        const DEG = Math.PI / 180;
        const rows = [
          ['Scale', 's',  0.05, 20,  0.01, () => model.scale.x,             v => model.scale.setScalar(v)],
          ['Rot X', 'rx', -180, 180, 1,    () => model.rotation.x / DEG,    v => model.rotation.x = v * DEG],
          ['Rot Y', 'ry', -180, 180, 1,    () => model.rotation.y / DEG,    v => model.rotation.y = v * DEG],
          ['Rot Z', 'rz', -180, 180, 1,    () => model.rotation.z / DEG,    v => model.rotation.z = v * DEG],
          ['Pos X', 'px', -30,  30,  0.05, () => model.position.x,          v => model.position.x = v],
          ['Pos Y', 'py', -30,  30,  0.05, () => model.position.y,          v => model.position.y = v],
          ['Pos Z', 'pz', -30,  30,  0.05, () => model.position.z,          v => model.position.z = v],
        ];

        const fmt = (step, v) => v.toFixed(step < 0.1 ? 2 : 1);
        for (const [label, id, min, max, step, getter, setter] of rows) {
          const row = document.createElement('div');
          row.style.cssText = 'display:grid;grid-template-columns:48px 1fr 58px;gap:6px;align-items:center;margin-bottom:5px;';

          const lab = document.createElement('label');
          lab.textContent = label;
          lab.style.cssText = 'color:rgba(255,204,102,0.66);font-size:10px;letter-spacing:0.08em;';

          const slider = document.createElement('input');
          slider.type = 'range';
          slider.min = String(min); slider.max = String(max); slider.step = String(step);
          slider.value = String(getter());
          slider.style.width = '100%';
          slider.style.accentColor = '#ffcc66';

          const num = document.createElement('input');
          num.type = 'number';
          num.min = String(min); num.max = String(max); num.step = String(step);
          num.style.cssText = 'width:58px;background:rgba(12,8,6,0.95);border:1px solid rgba(255,204,102,0.2);color:#ffe0a0;font:inherit;border-radius:6px;padding:3px 5px;';
          num.value = fmt(step, +getter());

          slider.addEventListener('input', () => {
            const v = parseFloat(slider.value);
            if (Number.isFinite(v)) {
              setter(v);
              if (typeof jet.userData.__refreshSwappedAnchors === 'function') jet.userData.__refreshSwappedAnchors();
              num.value = fmt(step, v);
            }
          });
          num.addEventListener('input', () => {
            const v = parseFloat(num.value);
            if (Number.isFinite(v)) {
              setter(v);
              if (typeof jet.userData.__refreshSwappedAnchors === 'function') jet.userData.__refreshSwappedAnchors();
              slider.value = String(v);
            }
          });

          row.appendChild(lab);
          row.appendChild(slider);
          row.appendChild(num);
          body.appendChild(row);
        }

        const status = document.createElement('div');
        status.style.cssText = 'margin-top:8px;min-height:14px;font-size:10px;color:rgba(255,204,102,0.55);letter-spacing:0.1em;';
        body.appendChild(status);

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:6px;margin-top:8px;';
        body.appendChild(btnRow);

        const mkBtn = (label, onClick, color) => {
          const b = document.createElement('button');
          b.textContent = label;
          b.type = 'button';
          const accent = color || '#ffcc66';
          b.style.cssText = [
            'flex:1','background:rgba(255,204,102,0.06)','border:1px solid rgba(255,204,102,0.22)',
            'border-radius:8px','padding:6px 7px','font:inherit','font-size:10px',
            'letter-spacing:0.15em','cursor:pointer',`color:${accent}`
          ].join(';');
          b.addEventListener('click', onClick);
          b.addEventListener('mouseenter', () => { b.style.borderColor = accent; b.style.background = 'rgba(255,204,102,0.12)'; });
          b.addEventListener('mouseleave', () => { b.style.borderColor = 'rgba(255,204,102,0.22)'; b.style.background = 'rgba(255,204,102,0.06)'; });
          return b;
        };

        if (hostIsLocal) {
          btnRow.appendChild(mkBtn('SAVE', async () => {
            status.textContent = 'saving…'; status.style.color = 'rgba(255,204,102,0.65)';
            try {
              const res = await fetch('/api/tweaks/' + encodeURIComponent(planeFile), {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(snapshotTweak()),
              });
              if (!res.ok) throw new Error('HTTP ' + res.status);
              status.textContent = 'saved locally';
              status.style.color = '#9cf2b0';
            } catch (err) {
              status.textContent = 'save failed';
              status.style.color = '#ff7a8e';
              console.warn('[tweak-save]', err);
            }
          }, '#9cf2b0'));
        } else {
          const lock = document.createElement('div');
          lock.textContent = 'LOCAL SAVE ONLY';
          lock.style.cssText = 'flex:1;font-size:9px;color:rgba(255,204,102,0.46);letter-spacing:0.1em;padding:6px 0;text-align:center;';
          btnRow.appendChild(lock);
        }

        btnRow.appendChild(mkBtn('COPY URL', () => {
          const t = snapshotTweak();
          const qs = new URLSearchParams({
            plane: planeFile,
            s: t.s, rx: t.rx, ry: t.ry, rz: t.rz, dy: t.py,
          });
          const url = location.origin + location.pathname + '#' + qs.toString();
          navigator.clipboard?.writeText(url);
          status.textContent = 'URL copied';
          status.style.color = '#ffcc66';
        }));

        let collapsed = true;
        const releaseHidden = !DEBUG_UI;
        const setCollapsed = (next) => {
          collapsed = !!next;
          const visible = !collapsed || !releaseHidden;
          panel.style.display = visible ? '' : 'none';
          body.style.display = collapsed ? 'none' : '';
          titleMeta.textContent = collapsed ? 'position · rotation · scale' : 'tap outside to hide';
          collapseBtn.textContent = collapsed ? 'EDIT' : 'HIDE';
          panel.style.width = collapsed ? 'auto' : '228px';
        };
        title.addEventListener('click', (e) => {
          e.preventDefault();
          setCollapsed(!collapsed);
        });

        const __tweakHUDOutsideClose = (e) => {
          if (collapsed) return;
          if (!panel.contains(e.target)) setCollapsed(true);
        };
        document.addEventListener('pointerdown', __tweakHUDOutsideClose, true);
        window.addEventListener('keydown', (e) => {
          const tgt = e.target;
          if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
          if (e.code === 'Semicolon' && !e.ctrlKey && !e.metaKey) {
            setCollapsed(!collapsed);
            e.preventDefault();
          } else if (e.code === 'Escape' && !collapsed) {
            setCollapsed(true);
          }
        });

        setCollapsed(releaseHidden);
        document.body.appendChild(panel);
      }
    },
    (xhr) => {
      if (xhr.total) {
        const pct = Math.round(xhr.loaded / xhr.total * 100);
        hud.textContent = `▸ LOADING ${planeFile} · ${pct}%`;
      } else {
        const kb = Math.round(xhr.loaded / 1024);
        hud.textContent = `▸ LOADING ${planeFile} · ${kb} KB`;
      }
    },
    (err) => {
      const fallback = markAircraftVisualFallback('AIRCRAFT MODEL LOAD FAILED');
      replaceWithSafeAircraftUrl(fallback);
      if (typeof plane !== 'undefined' && plane) {
        plane.aircraftKey = fallback.key;
        plane.aircraftSpec = getAircraftSpecByPreset(fallback);
      }
      hud.style.color = '#ff4e7a';
      hud.textContent = `✕ Failed to load ${planeFile} — using ${fallback.hudLabel}`;
      console.error('[plane-swap] failed to load', planeFile, err);
      restoreProcedural();
      setTimeout(() => hud.remove(), 6000);
    }
  );
})();
