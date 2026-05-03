#!/usr/bin/env bun
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');
const port = Number(process.env.PORT || process.argv[2] || 9878);

const types = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.glb', 'model/gltf-binary'],
  ['.gltf', 'model/gltf+json'],
  ['.bin', 'application/octet-stream'],
  ['.wav', 'audio/wav'],
  ['.mp3', 'audio/mpeg'],
  ['.ogg', 'audio/ogg'],
]);

function safeResolve(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const cleaned = decoded === '/' ? '/index.html' : decoded;
  const abs = path.resolve(distDir, `.${cleaned}`);
  if (!abs.startsWith(distDir + path.sep) && abs !== distDir) return null;
  return abs;
}

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    const abs = safeResolve(url.pathname);
    if (!abs) return new Response('Forbidden', { status: 403 });
    try {
      const s = await stat(abs);
      if (!s.isFile()) throw new Error('not a file');
      const body = await readFile(abs);
      return new Response(body, {
        headers: {
          'content-type': types.get(path.extname(abs).toLowerCase()) || 'application/octet-stream',
          'cache-control': 'no-store',
        },
      });
    } catch {
      return new Response('Not Found', { status: 404 });
    }
  },
});

console.log(`Serving dist at http://127.0.0.1:${port}/game.html`);
