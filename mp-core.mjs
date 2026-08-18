// Shared multiplayer room core for the flight-sim websocket host.
// Imported by multiplayer-server.mjs and tweaks-server.mjs so validation,
// id binding, caps, and broadcast logic live in one place.

const PLAYER_TTL_MS = 15_000;
const MAX_MSG_BYTES = 4_096;
const MAX_PLAYERS_PER_ROOM = 16;
const MAX_ROOMS = 64;
const MAX_OPEN_SOCKETS = Math.max(16, Math.min(1024, Number(process.env.MULTIPLAYER_MAX_OPEN_SOCKETS) || 128));
const MAX_PLAYER_ID_LENGTH = 48;
const MAX_ROOM_NAME_LENGTH = 32;
const MAX_MESSAGES_PER_SECOND = 32;
const MAX_STATE_MESSAGES_PER_SECOND = 20;
const MAX_WORLD_COORDINATE = 1_000_000;
const MAX_VELOCITY = 10_000;
const MAX_SPEED_KTS = 2_000;
const TOKEN_RE = /^[A-Za-z0-9_-]+$/;
const ROOM_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]*$/;
const RACE_STATUSES = new Set(['idle', 'countdown', 'racing', 'finished']);
const TEXT_ENCODER = new TextEncoder();

export const rooms = new Map();
const openSockets = new Set();

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteInRange(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function normalizePlayerId(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return id.length > 0 && id.length <= MAX_PLAYER_ID_LENGTH && TOKEN_RE.test(id) ? id : null;
}

function normalizeRoomName(value) {
  if (value == null || value === '') return 'default';
  if (typeof value !== 'string') return null;
  const room = value.trim();
  return room.length > 0 && room.length <= MAX_ROOM_NAME_LENGTH && ROOM_RE.test(room) ? room : null;
}

function sanitizeVector(value, limit) {
  if (!isPlainObject(value)) return null;
  const { x, y, z } = value;
  if (!isFiniteInRange(x, -limit, limit)
    || !isFiniteInRange(y, -limit, limit)
    || !isFiniteInRange(z, -limit, limit)) return null;
  return { x, y, z };
}

function sanitizeQuaternion(value) {
  if (!isPlainObject(value)) return null;
  const { x, y, z, w } = value;
  if (!isFiniteInRange(x, -2, 2)
    || !isFiniteInRange(y, -2, 2)
    || !isFiniteInRange(z, -2, 2)
    || !isFiniteInRange(w, -2, 2)) return null;
  const length = Math.hypot(x, y, z, w);
  if (!Number.isFinite(length) || length < 0.01 || length > 2) return null;
  return { x: x / length, y: y / length, z: z / length, w: w / length };
}

function sanitizeCallsign(value) {
  if (typeof value !== 'string') return null;
  return value.toUpperCase().replace(/[^A-Z0-9 -]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

function sanitizePlaneKey(value) {
  if (typeof value !== 'string') return null;
  return value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
}

function sanitizeRace(value) {
  if (!isPlainObject(value) || !RACE_STATUSES.has(value.status)) return null;
  const raceId = typeof value.raceId === 'string'
    ? value.raceId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64)
    : '';
  const integer = (raw, min, max) => Number.isInteger(raw) && raw >= min && raw <= max ? raw : 0;
  const timestamp = isFiniteInRange(value.startedWallAt, 0, Date.now() + 86_400_000)
    ? value.startedWallAt
    : 0;
  return {
    version: 1,
    raceId,
    status: value.status,
    gateIndex: integer(value.gateIndex, 0, 10_000),
    gateCount: integer(value.gateCount, 0, 10_000),
    lapMs: integer(value.lapMs, 0, 86_400_000),
    bestMs: integer(value.bestMs, 0, 86_400_000),
    startedWallAt: timestamp,
    countdownMs: integer(value.countdownMs, 0, 60_000),
    t: isFiniteInRange(value.t, 0, Number.MAX_SAFE_INTEGER) ? value.t : Date.now(),
  };
}

// Keep only the state fields consumed by remote clients. This prevents a
// connected peer from using the relay as an arbitrary JSON fan-out service.
function sanitizeState(value) {
  if (!isPlainObject(value)) return null;
  const pos = sanitizeVector(value.pos, MAX_WORLD_COORDINATE);
  const quat = sanitizeQuaternion(value.quat);
  if (!pos || !quat) return null;

  const state = { pos, quat };
  if (value.vel != null) {
    const vel = sanitizeVector(value.vel, MAX_VELOCITY);
    if (!vel) return null;
    state.vel = vel;
  }
  if (value.callsign != null) {
    const callsign = sanitizeCallsign(value.callsign);
    if (callsign == null) return null;
    state.callsign = callsign;
  }
  if (value.planeKey != null) {
    const planeKey = sanitizePlaneKey(value.planeKey);
    if (planeKey == null) return null;
    state.planeKey = planeKey;
  }
  if (value.speedKts != null) {
    if (!isFiniteInRange(value.speedKts, 0, MAX_SPEED_KTS)) return null;
    state.speedKts = value.speedKts;
  }
  if (value.race != null) {
    const race = sanitizeRace(value.race);
    if (!race) return null;
    state.race = race;
  }
  return state;
}

function sendProtocolError(ws, code) {
  try { ws.send(JSON.stringify({ type: 'error', code })); } catch {}
}

function resetRateWindow(data, now) {
  data.rateWindowStartedAt = now;
  data.messageCount = 0;
  data.stateMessageCount = 0;
  data.rateLimitNoticeAt = 0;
}

function sendRateLimitNotice(ws, data, now) {
  if (!data.rateLimitNoticeAt || now - data.rateLimitNoticeAt >= 1_000) {
    data.rateLimitNoticeAt = now;
    sendProtocolError(ws, 'rate_limited');
  }
}

function allowMessage(ws) {
  const data = ws.data || (ws.data = { id: null, room: null });
  const now = Date.now();
  if (!data.rateWindowStartedAt || now - data.rateWindowStartedAt >= 1_000) {
    resetRateWindow(data, now);
  }
  data.messageCount = (data.messageCount || 0) + 1;
  if (data.messageCount <= MAX_MESSAGES_PER_SECOND) return true;
  sendRateLimitNotice(ws, data, now);
  return false;
}

function allowStateMessage(ws) {
  const data = ws.data || (ws.data = { id: null, room: null });
  const now = Date.now();
  if (!data.rateWindowStartedAt || now - data.rateWindowStartedAt >= 1_000) {
    resetRateWindow(data, now);
  }
  data.stateMessageCount = (data.stateMessageCount || 0) + 1;
  if (data.stateMessageCount <= MAX_STATE_MESSAGES_PER_SECOND) return true;
  sendRateLimitNotice(ws, data, now);
  return false;
}

export function getRoom(name) {
  if (!rooms.has(name)) {
    rooms.set(name, { players: new Map(), sockets: new Set() });
  }
  return rooms.get(name);
}

export function roomStats() {
  let players = 0;
  for (const room of rooms.values()) players += room.players.size;
  return { rooms: rooms.size, players, sockets: openSockets.size, maxSockets: MAX_OPEN_SOCKETS };
}

export function broadcast(roomName, payload, except = null) {
  const room = rooms.get(roomName);
  if (!room) return;
  const data = JSON.stringify(payload);
  for (const ws of room.sockets) {
    if (ws === except) continue;
    try { ws.send(data); } catch {}
  }
}

export function removeSocket(ws) {
  const data = ws.data || {};
  const roomName = data.room;
  if (!roomName) return;
  const room = rooms.get(roomName);
  if (!room) return;
  room.sockets.delete(ws);
  const player = data.id && room.players.get(data.id);
  if (player && player.socket === ws) {
    room.players.delete(data.id);
    broadcast(roomName, { type: 'leave', id: data.id });
  }
  data.id = null;
  data.room = null;
  if (room.sockets.size === 0 && room.players.size === 0) {
    rooms.delete(roomName);
  }
}

export function handleMessage(ws, raw) {
  const text = typeof raw === 'string' ? raw : raw.toString();
  if (TEXT_ENCODER.encode(text).byteLength > MAX_MSG_BYTES) {
    sendProtocolError(ws, 'message_too_large');
    return;
  }
  if (!allowMessage(ws)) return;
  let msg;
  try { msg = JSON.parse(text); }
  catch { sendProtocolError(ws, 'invalid_json'); return; }
  if (!isPlainObject(msg) || typeof msg.type !== 'string') {
    sendProtocolError(ws, 'invalid_message');
    return;
  }
  if (msg.type === 'state' && !allowStateMessage(ws)) return;

  if (msg.type === 'join') {
    removeSocket(ws);
    const roomName = normalizeRoomName(msg.room);
    const id = msg.id == null ? crypto.randomUUID() : normalizePlayerId(msg.id);
    const state = sanitizeState(msg.state);
    if (!roomName || !id || !state) {
      sendProtocolError(ws, 'invalid_join');
      return;
    }
    if (!rooms.has(roomName) && rooms.size >= MAX_ROOMS) {
      sendProtocolError(ws, 'rooms_full');
      return;
    }
    const room = getRoom(roomName);
    if (room.players.has(id)) {
      sendProtocolError(ws, 'duplicate_id');
      return;
    }
    if (room.sockets.size >= MAX_PLAYERS_PER_ROOM || room.players.size >= MAX_PLAYERS_PER_ROOM) {
      sendProtocolError(ws, 'players_full');
      return;
    }
    ws.data = { ...(ws.data || {}), id, room: roomName };
    room.sockets.add(ws);
    room.players.set(id, { state, lastSeen: Date.now(), socket: ws });
    const players = [...room.players.entries()].map(([pid, player]) => ({ id: pid, state: player.state }));
    try { ws.send(JSON.stringify({ type: 'welcome', id, players })); } catch {}
    broadcast(roomName, { type: 'state', id, state }, ws);
    return;
  }

  if (msg.type === 'state') {
    const data = ws.data || {};
    if (!data.id || !data.room || String(msg.id || '') !== data.id || (msg.room != null && msg.room !== data.room)) return;
    const room = rooms.get(data.room);
    const player = room && room.players.get(data.id);
    if (!room || !player || player.socket !== ws || !room.sockets.has(ws)) return;
    const state = sanitizeState(msg.state);
    if (!state) {
      sendProtocolError(ws, 'invalid_state');
      return;
    }
    player.state = state;
    player.lastSeen = Date.now();
    broadcast(data.room, { type: 'state', id: data.id, state }, ws);
    return;
  }

  if (msg.type === 'ping') {
    try { ws.send(JSON.stringify({ type: 'pong', t: Date.now() })); } catch {}
    return;
  }

  sendProtocolError(ws, 'unsupported_message');
}

export function startTtlSweep(intervalMs = 3_000) {
  return setInterval(() => {
    const now = Date.now();
    for (const [roomName, room] of rooms) {
      for (const [id, player] of room.players) {
        if (now - player.lastSeen <= PLAYER_TTL_MS) continue;
        room.players.delete(id);
        room.sockets.delete(player.socket);
        if (player.socket && player.socket.data) {
          player.socket.data.id = null;
          player.socket.data.room = null;
        }
        try { player.socket.close(1008, 'Session timed out'); } catch {}
        broadcast(roomName, { type: 'leave', id });
      }
      if (room.sockets.size === 0 && room.players.size === 0) rooms.delete(roomName);
    }
  }, intervalMs);
}

export const websocketHandlers = {
  maxPayloadLength: MAX_MSG_BYTES,
  idleTimeout: 60,
  backpressureLimit: 64 * 1024,
  closeOnBackpressureLimit: true,
  perMessageDeflate: false,
  open(ws) {
    // Room caps only apply after a client joins. Keep a separate global cap
    // so an unauthenticated connection flood cannot consume the process while
    // never selecting a room.
    if (openSockets.size >= MAX_OPEN_SOCKETS) {
      try { ws.close(1013, 'Server busy'); } catch {}
      return;
    }
    openSockets.add(ws);
    ws.data = {
      id: null,
      room: null,
      rateWindowStartedAt: Date.now(),
      messageCount: 0,
      stateMessageCount: 0,
      rateLimitNoticeAt: 0,
    };
  },
  message(ws, raw) {
    if (!openSockets.has(ws)) return;
    handleMessage(ws, raw);
  },
  close(ws) {
    openSockets.delete(ws);
    removeSocket(ws);
  },
};
