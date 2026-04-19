const port = Number(process.argv[2] || process.env.PORT || 8787);
const PLAYER_TTL_MS = 15000;

const rooms = new Map();

function getRoom(name) {
  if (!rooms.has(name)) {
    rooms.set(name, { players: new Map(), sockets: new Set() });
  }
  return rooms.get(name);
}

function broadcast(roomName, payload, except = null) {
  const room = rooms.get(roomName);
  if (!room) return;
  const data = JSON.stringify(payload);
  for (const ws of room.sockets) {
    if (ws === except) continue;
    try { ws.send(data); } catch {}
  }
}

function removeSocket(ws) {
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

setInterval(() => {
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
}, 3000);

Bun.serve({
  port,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, rooms: rooms.size }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (server.upgrade(req)) return;
    return new Response('Multiplayer websocket server is running. Connect via ws://host:' + port, { status: 200 });
  },
  websocket: {
    open(ws) {
      ws.data = { id: null, room: 'default' };
    },
    message(ws, raw) {
      let msg;
      try { msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString()); }
      catch { return; }
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'join') {
        removeSocket(ws);
        const roomName = String(msg.room || 'default');
        const id = String(msg.id || crypto.randomUUID());
        ws.data = { id, room: roomName };
        const room = getRoom(roomName);
        room.sockets.add(ws);
        const players = [...room.players.entries()].map(([pid, player]) => ({ id: pid, state: player.state }));
        ws.send(JSON.stringify({ type: 'welcome', id, players }));
        return;
      }

      if (msg.type === 'state') {
        const roomName = String(msg.room || ws.data?.room || 'default');
        const id = String(msg.id || ws.data?.id || '');
        if (!id) return;
        const room = getRoom(roomName);
        room.sockets.add(ws);
        room.players.set(id, { state: msg.state || {}, lastSeen: Date.now() });
        broadcast(roomName, { type: 'state', id, state: msg.state || {} }, ws);
        return;
      }

      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', t: Date.now() }));
      }
    },
    close(ws) {
      removeSocket(ws);
    },
  },
});

console.log(`[multiplayer] listening on ws://0.0.0.0:${port}`);
