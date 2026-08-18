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
import { roomStats, startTtlSweep, websocketHandlers } from './mp-core.mjs';

const PORT = Number(process.env.PORT) || 8765;
const LOOPBACK_HOST = '127.0.0.1';
const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)));
const TWEAKS_FILE = path.join(ROOT, 'plane-tweaks.json');
const MAX_TWEAK_BODY_BYTES = 4_096;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb':  'model/gltf-binary',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
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
  '.gltf': 'model/gltf+json',
  '.bin':  'application/octet-stream',
};

const PUBLIC_ROOT_FILES = new Set([
  'flight-sim3.html',
  'index.html',
  'plane-select.html',
  'plane-tweaks.json',
  'latest-features.json',
]);
const PUBLIC_ASSET_DIRECTORIES = new Map([
  ['assets/', new Set(['.png', '.jpg', '.jpeg', '.webp'])],
  ['audio/', new Set(['.wav', '.mp3', '.ogg', '.m4a', '.flac', '.aac', '.opus'])],
  ['models/', new Set(['.glb', '.gltf', '.bin', '.png', '.jpg', '.jpeg', '.webp'])],
  // The game is deliberately self-hosted in development as well as in the
  // release package.  Allow only the pinned Three.js runtime, never an
  // arbitrary vendor subtree.
  ['vendor/three/r128/', new Set(['.js'])],
]);
const ALLOWED_TWEAK_PLANES = new Set([
  'models/a-10_thunderbolt_ii_warthog_plane__avion.glb',
  'models/colombian_emb_314_tucano.glb',
  'models/corsair_f4u-1_airplane.glb',
  'models/crank_bush_plane.glb',
  'models/disney_planes_-_dusty_turbo.glb',
  'models/f-15.glb',
  'models/italian_macchi_c.202_folgore.glb',
  'models/low_poly_a-10_warthog.glb',
  'models/low_poly_f-15.glb',
  'models/low_poly_plane.glb',
  'models/p-100_avenger_-_free.glb',
  'models/ripslinger.glb',
  'models/stunt_plane.glb',
  'models/yak-9.glb',
]);
const TWEAK_LIMITS = {
  s: [0.001, 100],
  rx: [-360, 360],
  ry: [-360, 360],
  rz: [-360, 360],
  px: [-100, 100],
  py: [-100, 100],
  pz: [-100, 100],
};

startTtlSweep();

const isLocalhost = (req, server) => {
  const addr = server.requestIP(req)?.address || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
};

const isAllowedLocalWebSocketOrigin = (req) => {
  const origin = req.headers.get('origin');
  // Non-browser localhost tooling does not send Origin. Browser requests must
  // originate from the local game host, not an arbitrary website.
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const localHost = parsed.hostname === 'localhost'
      || parsed.hostname === '127.0.0.1'
      || parsed.hostname === '::1'
      || parsed.hostname === '[::1]';
    const originPort = parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80);
    return parsed.protocol === 'http:' && localHost && originPort === PORT;
  } catch {
    return false;
  }
};

function resolvePublicFile(pathname) {
  const decoded = decodeURIComponent(pathname);
  if (!decoded.startsWith('/') || decoded.includes('\\') || decoded.includes('\0')) return null;
  const requested = decoded === '/' || decoded === '' ? 'plane-select.html' : decoded.replace(/^\/+/, '');
  const relative = path.posix.normalize(requested);
  if (!relative || relative === '.' || relative === '..' || relative.startsWith('../')) return null;
  const segments = relative.split('/');
  if (segments.some(segment => !segment || segment.startsWith('.'))) return null;

  let allowed = PUBLIC_ROOT_FILES.has(relative);
  if (!allowed) {
    for (const [prefix, extensions] of PUBLIC_ASSET_DIRECTORIES) {
      if (!relative.startsWith(prefix)) continue;
      allowed = extensions.has(path.extname(relative).toLowerCase());
      break;
    }
  }
  if (!allowed) return null;

  const filepath = path.resolve(ROOT, relative);
  return filepath.startsWith(ROOT + path.sep) ? filepath : null;
}

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

const sanitiseTweak = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const keys = Object.keys(input);
  if (!keys.length || keys.some(key => !(key in TWEAK_LIMITS))) return null;
  const out = {};
  for (const key of keys) {
    const value = input[key];
    const [min, max] = TWEAK_LIMITS[key];
    if (!Number.isFinite(value) || value < min || value > max) return null;
    out[key] = value;
  }
  return out;
};

const server = Bun.serve({
  hostname: LOOPBACK_HOST,
  port: PORT,
  async fetch(req, server) {
    try {
      const u = new URL(req.url);
      if (req.headers.get('upgrade') === 'websocket') {
        if (!isAllowedLocalWebSocketOrigin(req)) {
          return new Response('Forbidden origin', { status: 403 });
        }
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
        if (!ALLOWED_TWEAK_PLANES.has(planeFile)) {
          return new Response('Unknown plane model', { status: 404 });
        }
        const contentLength = Number(req.headers.get('content-length'));
        if (Number.isFinite(contentLength) && contentLength > MAX_TWEAK_BODY_BYTES) {
          return new Response('Payload too large', { status: 413 });
        }
        let body;
        try {
          const raw = await req.text();
          if (new TextEncoder().encode(raw).byteLength > MAX_TWEAK_BODY_BYTES) {
            return new Response('Payload too large', { status: 413 });
          }
          body = JSON.parse(raw);
        }
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
        if (!ALLOWED_TWEAK_PLANES.has(planeFile)) return new Response('Unknown plane model', { status: 404 });
        const all = await readTweaks();
        delete all[planeFile];
        await writeTweaks(all);
        return Response.json({ ok: true, removed: planeFile });
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
      }
      const filepath = resolvePublicFile(u.pathname);
      if (!filepath) return new Response('Not found', { status: 404 });
      const stat = await fsp.stat(filepath).catch(() => null);
      if (!stat || !stat.isFile()) return new Response('Not found', { status: 404 });
      const ext = path.extname(filepath).toLowerCase();
      return new Response(Bun.file(filepath), {
        headers: {
          'content-type': MIME[ext] || 'application/octet-stream',
          'cache-control': 'no-cache',
          'x-content-type-options': 'nosniff',
        },
      });
    } catch (err) {
      console.error('[tweaks-server]', err);
      return new Response('Server error', { status: 500 });
    }
  },
  websocket: websocketHandlers,
});

console.log(`\n  tweaks-server listening on http://${LOOPBACK_HOST}:${PORT}`);
console.log(`     root:   ${ROOT}`);
console.log(`     tweaks: ${TWEAKS_FILE}`);
console.log(`     writes: localhost-only (remote forbidden)`);
console.log(`     ws:     enabled on same host/port\n`);
