// Shared multiplayer room core for the flight-sim websocket host.
// Imported by multiplayer-server.mjs and tweaks-server.mjs so id-binding,
// caps, and broadcast logic live in exactly one place (F11 hardening baked in).

const PLAYER_TTL_MS = 15000;
const MAX_MSG_BYTES = 4096;
const MAX_PLAYERS_PER_ROOM = 16;
const MAX_ROOMS = 64;

export const rooms = new Map();

export function getRoom(name) {
  if (!rooms.has(name)) {
    rooms.set(name, { players: new Map(), sockets: new Set() });
  }
  return rooms.get(name);
}

export function roomStats() {
  let players = 0;
  for (const room of rooms.values()) players += room.players.size;
  return { rooms: rooms.size, players };
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
  if (!data.room) return;
  const room = rooms.get(data.room);
  if (!room) return;
  room.sockets.delete(ws);
  if (data.id && room.players.has(data.id)) {
    room.players.delete(data.id);
    broadcast(data.room, { type: 'leave', id: data.id });
  }
  if (room.sockets.size === 0 && room.players.size === 0) {
    rooms.delete(data.room);
  }
}

export function handleMessage(ws, raw) {
  const text = typeof raw === 'string' ? raw : raw.toString();
  if (text.length > MAX_MSG_BYTES) return; // drop oversized before parse
  let msg;
  try { msg = JSON.parse(text); }
  catch { return; }
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'join') {
    removeSocket(ws);
    const roomName = String(msg.room || 'default');
    if (!rooms.has(roomName) && rooms.size >= MAX_ROOMS) {
      try { ws.send(JSON.stringify({ type: 'full', scope: 'rooms' })); } catch {}
      return;
    }
    const id = String(msg.id || crypto.randomUUID());
    const room = getRoom(roomName);
    if (!room.players.has(id) && room.players.size >= MAX_PLAYERS_PER_ROOM) {
      try { ws.send(JSON.stringify({ type: 'full', scope: 'players' })); } catch {}
      return;
    }
    const state = msg.state || {};
    ws.data = { id, room: roomName };
    room.sockets.add(ws);
    room.players.set(id, { state, lastSeen: Date.now() });
    const players = [...room.players.entries()].map(([pid, player]) => ({ id: pid, state: player.state }));
    ws.send(JSON.stringify({ type: 'welcome', id, players }));
    broadcast(roomName, { type: 'state', id, state }, ws);
    return;
  }

  if (msg.type === 'state') {
    // Identity is bound at join; ignore state from unjoined sockets or spoofed ids.
    if (!ws.data || !ws.data.id) return;
    if (String(msg.id || '') !== ws.data.id) return;
    const id = ws.data.id;
    const roomName = ws.data.room || 'default';
    const room = getRoom(roomName);
    room.sockets.add(ws);
    room.players.set(id, { state: msg.state || {}, lastSeen: Date.now() });
    broadcast(roomName, { type: 'state', id, state: msg.state || {} }, ws);
    return;
  }

  if (msg.type === 'ping') {
    try { ws.send(JSON.stringify({ type: 'pong', t: Date.now() })); } catch {}
  }
}

export function startTtlSweep(intervalMs = 3000) {
  return setInterval(() => {
    const now = Date.now();
    for (const [roomName, room] of rooms) {
      for (const [id, player] of room.players) {
        if (now - player.lastSeen > PLAYER_TTL_MS) {
          room.players.delete(id);
          broadcast(roomName, { type: 'leave', id });
        }
      }
      if (room.sockets.size === 0 && room.players.size === 0) rooms.delete(roomName);
    }
  }, intervalMs);
}

export const websocketHandlers = {
  open(ws) {
    ws.data = { id: null, room: 'default' };
  },
  message(ws, raw) {
    handleMessage(ws, raw);
  },
  close(ws) {
    removeSocket(ws);
  },
};
