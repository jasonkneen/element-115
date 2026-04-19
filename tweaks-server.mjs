#!/usr/bin/env node
// Static file server + tweak persistence + integrated multiplayer websocket host.
// Run: bun tweaks-server.mjs -> http://localhost:8765
//
// GET    /api/tweaks              -> returns plane-tweaks.json
// PUT    /api/tweaks/<filename>   -> merges one plane's tweak into the file
// DELETE /api/tweaks/<filename>   -> removes one plane's tweak
// GET    /health                  -> simple host + multiplayer health
// WebSocket on same host/port     -> join/state/leave/ping multiplayer messages
// everything else                 -> served statically from this directory

import fsp from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

const PORT = Number(process.env.PORT) || 8765;
const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)));
const TWEAKS_FILE = path.join(ROOT, 'plane-tweaks.json');
const PLAYER_TTL_MS = 15000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb':  'model/gltf-binary',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.css':  'text/css; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.wav':  'audio/wav',
  '.mp3':  'audio/mpeg',
  '.ogg':  'audio/ogg',
  '.m4a':  'audio/mp4',
  '.flac': 'audio/flac',
  '.aac':  'audio/aac',
  '.opus': 'audio/opus',
};

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
  if (room.sockets.size === 0 && room.players.size === 0) rooms.delete(data.room);
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

const isLocalhost = (req, server) => {
  const addr = server.requestIP(req)?.address || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
};

const readTweaks = async () => {
  try {
    const raw = await fsp.readFile(TWEAKS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
};

const writeTweaks = async (obj) => {
  const tmp = TWEAKS_FILE + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(obj, null, 2) + '\n');
  await fsp.rename(tmp, TWEAKS_FILE);
};

const SANITISE_NUMBER = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const sanitiseTweak = (input) => {
  if (!input || typeof input !== 'object') return null;
  const allowed = ['s', 'rx', 'ry', 'rz', 'px', 'py', 'pz'];
  const out = {};
  for (const k of allowed) {
    if (k in input) out[k] = SANITISE_NUMBER(input[k], 0);
  }
  return out;
};

function roomStats() {
  let players = 0;
  for (const room of rooms.values()) players += room.players.size;
  return { rooms: rooms.size, players };
}

const server = Bun.serve({
  port: PORT,
  async fetch(req, server) {
    try {
      const u = new URL(req.url);
      if (req.headers.get('upgrade') === 'websocket') {
        if (server.upgrade(req)) return;
        return new Response('WebSocket upgrade failed', { status: 500 });
      }

      if (u.pathname === '/health') {
        return Response.json({ ok: true, port: PORT, root: ROOT, ...roomStats() });
      }

      if (u.pathname === '/api/tweaks' && req.method === 'GET') {
        return Response.json(await readTweaks());
      }

      const tweakMatch = u.pathname.match(/^\/api\/tweaks\/(.+)$/);
      if (tweakMatch && req.method === 'PUT') {
        if (!isLocalhost(req, server)) {
          return new Response('Forbidden: tweak writes are localhost-only', { status: 403 });
        }
        const planeFile = decodeURIComponent(tweakMatch[1]);
        let body;
        try { body = await req.json(); }
        catch { return new Response('Invalid JSON', { status: 400 }); }
        const tweak = sanitiseTweak(body);
        if (!tweak) return new Response('Invalid tweak object', { status: 400 });
        const all = await readTweaks();
        all[planeFile] = tweak;
        await writeTweaks(all);
        console.log(`✓ saved tweak for ${planeFile}:`, tweak);
        return Response.json({ ok: true, plane: planeFile, tweak });
      }

      if (tweakMatch && req.method === 'DELETE') {
        if (!isLocalhost(req, server)) return new Response('Forbidden', { status: 403 });
        const planeFile = decodeURIComponent(tweakMatch[1]);
        const all = await readTweaks();
        delete all[planeFile];
        await writeTweaks(all);
        return Response.json({ ok: true, removed: planeFile });
      }

      let pathname = decodeURIComponent(u.pathname);
      if (pathname === '/' || pathname === '') pathname = '/plane-select.html';
      const relative = pathname.replace(/^\/+/, '');
      const safe = path.normalize(relative);
      const filepath = path.join(ROOT, safe);
      if (!filepath.startsWith(ROOT + path.sep) && filepath !== ROOT) {
        return new Response('Forbidden', { status: 403 });
      }
      const stat = await fsp.stat(filepath).catch(() => null);
      if (!stat || !stat.isFile()) return new Response('Not found', { status: 404 });
      const ext = path.extname(filepath).toLowerCase();
      return new Response(Bun.file(filepath), {
        headers: {
          'content-type': MIME[ext] || 'application/octet-stream',
          'cache-control': 'no-cache',
        },
      });
    } catch (err) {
      console.error('[tweaks-server]', err);
      return new Response('Server error', { status: 500 });
    }
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
        const state = msg.state || {};
        ws.data = { id, room: roomName };
        const room = getRoom(roomName);
        room.sockets.add(ws);
        room.players.set(id, { state, lastSeen: Date.now() });
        const players = [...room.players.entries()].map(([pid, player]) => ({ id: pid, state: player.state }));
        ws.send(JSON.stringify({ type: 'welcome', id, players }));
        broadcast(roomName, { type: 'state', id, state }, ws);
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

console.log(`\n  ✈  tweaks-server listening on http://localhost:${PORT}`);
console.log(`     root:   ${ROOT}`);
console.log(`     tweaks: ${TWEAKS_FILE}`);
console.log(`     writes: localhost-only (remote forbidden)`);
console.log(`     ws:     enabled on same host/port\n`);
