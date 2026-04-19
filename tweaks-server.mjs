#!/usr/bin/env node
// Static file server + localhost-only tweak persistence.
// Run:  node tweaks-server.mjs   →   http://localhost:8765
//
// GET  /api/tweaks              → returns plane-tweaks.json
// PUT  /api/tweaks/<filename>   → merges one plane's tweak into the file
//                                 (localhost-only; rejects remote writers)
// everything else               → served statically from this directory

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

const PORT = Number(process.env.PORT) || 8765;
const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)));
const TWEAKS_FILE = path.join(ROOT, 'plane-tweaks.json');

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

const isLocalhost = (req) => {
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
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

const readBody = async (req, max = 64 * 1024) => {
  let total = 0;
  let raw = '';
  for await (const chunk of req) {
    total += chunk.length;
    if (total > max) throw new Error('Body too large');
    raw += chunk;
  }
  return raw;
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

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    // --- API: read (open) -----------------------------------------
    if (u.pathname === '/api/tweaks' && req.method === 'GET') {
      const data = await readTweaks();
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
      return;
    }

    // --- API: write single plane (localhost only) -----------------
    const m = u.pathname.match(/^\/api\/tweaks\/(.+)$/);
    if (m && req.method === 'PUT') {
      if (!isLocalhost(req)) {
        res.writeHead(403, { 'content-type': 'text/plain' });
        res.end('Forbidden: tweak writes are localhost-only');
        return;
      }
      const planeFile = decodeURIComponent(m[1]);
      let body;
      try { body = JSON.parse(await readBody(req)); }
      catch { res.writeHead(400); res.end('Invalid JSON'); return; }

      const tweak = sanitiseTweak(body);
      if (!tweak) { res.writeHead(400); res.end('Invalid tweak object'); return; }

      const all = await readTweaks();
      all[planeFile] = tweak;
      await writeTweaks(all);

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, plane: planeFile, tweak }));
      console.log(`✓ saved tweak for ${planeFile}:`, tweak);
      return;
    }

    // --- API: delete single plane's tweak (localhost only) --------
    if (m && req.method === 'DELETE') {
      if (!isLocalhost(req)) { res.writeHead(403); res.end('Forbidden'); return; }
      const planeFile = decodeURIComponent(m[1]);
      const all = await readTweaks();
      delete all[planeFile];
      await writeTweaks(all);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, removed: planeFile }));
      return;
    }

    // --- Static file serve ---------------------------------------
    let pathname = decodeURIComponent(u.pathname);
    if (pathname === '/' || pathname === '') pathname = '/plane-select.html';

    const relative = pathname.replace(/^\/+/, '');
    const safe = path.normalize(relative);
    const filepath = path.join(ROOT, safe);
    // path traversal guard
    if (!filepath.startsWith(ROOT + path.sep) && filepath !== ROOT) {
      res.writeHead(403); res.end('Forbidden'); return;
    }

    const stat = await fsp.stat(filepath).catch(() => null);
    if (!stat || !stat.isFile()) { res.writeHead(404); res.end('Not found'); return; }

    const ext = path.extname(filepath).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': 'no-cache',
    });
    fs.createReadStream(filepath).pipe(res);
  } catch (err) {
    console.error('[tweaks-server]', err);
    if (!res.headersSent) res.writeHead(500);
    res.end('Server error');
  }
});

server.listen(PORT, () => {
  console.log(`\n  ✈  tweaks-server listening on http://localhost:${PORT}`);
  console.log(`     root:   ${ROOT}`);
  console.log(`     tweaks: ${TWEAKS_FILE}`);
  console.log(`     writes: localhost-only (remote ${`\x1b[1mforbidden\x1b[0m`})\n`);
});
