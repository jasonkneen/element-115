#!/usr/bin/env bun
/**
 * Headless smoke test for Element-115 via window.__sim / advanceTime.
 *
 * Boots flight-sim3.html, waits for the sim handle, advances a few
 * simulated seconds in the sky, and asserts basic invariants.
 *
 * Usage:
 *   bun tools/smoke-sim.mjs
 *   bun tools/smoke-sim.mjs --url http://127.0.0.1:8765/flight-sim3.html
 *
 * Exit 0 on pass, 1 on fail.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const urlArg = args.find((a) => a.startsWith('--url='))?.slice(6)
  || (args.includes('--url') ? args[args.indexOf('--url') + 1] : null);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.css': 'text/css; charset=utf-8',
};

function log(msg) {
  console.log(`[smoke] ${msg}`);
}

async function startStaticServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/') rel = '/flight-sim3.html';
      const abs = path.normalize(path.join(root, rel));
      if (!abs.startsWith(root)) {
        res.writeHead(403); res.end('forbidden'); return;
      }
      const st = await stat(abs).catch(() => null);
      if (!st || !st.isFile()) {
        res.writeHead(404); res.end('not found'); return;
      }
      const ext = path.extname(abs).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(await readFile(abs));
    } catch (err) {
      res.writeHead(500); res.end(String(err && err.message || err));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/flight-sim3.html?spawn=sky&debug=1`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function main() {
  let server = null;
  let pageUrl = urlArg;
  if (!pageUrl) {
    server = await startStaticServer();
    pageUrl = server.url;
  }
  log(`url ${pageUrl}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));

  try {
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    // Wait for sim handle (script evaluates and builds scene/chunks)
    await page.waitForFunction(() => !!(window.__sim && window.__sim.plane && typeof window.advanceTime === 'function'), null, {
      timeout: 90_000,
    });
    log('__sim ready');

    // Dismiss title / start flying if needed
    await page.evaluate(() => {
      if (window.__ap && typeof window.__ap.resume === 'function') window.__ap.resume();
      const title = document.getElementById('title');
      if (title) title.classList.add('hide');
      // Force sky spawn pose if still on ground
      const sim = window.__sim;
      if (sim && sim.plane) {
        if (sim.plane.pos.y < 80) {
          sim.plane.pos.set(0, 420, -400);
          sim.plane.vel.set(0, 0, 55);
          sim.plane.onGround = false;
          sim.plane.crashed = false;
          sim.plane.health = 100;
        }
        if (typeof sim.plane.throttle === 'number') sim.plane.throttle = 0.75;
      }
    });

    // Advance ~3 seconds of sim time in fixed steps
    const steps = 90;
    const stepMs = 33.3;
    for (let i = 0; i < steps; i++) {
      await page.evaluate((ms) => window.advanceTime(ms), stepMs);
    }

    const report = await page.evaluate(() => {
      const sim = window.__sim;
      const plane = sim.plane;
      const text = typeof window.render_game_to_text === 'function'
        ? window.render_game_to_text()
        : '';
      return {
        hasPlane: !!plane,
        crashed: !!(plane && plane.crashed),
        health: plane ? plane.health : null,
        y: plane ? plane.pos.y : null,
        speed: plane ? plane.vel.length() : null,
        textSnippet: String(text).slice(0, 400),
        moduleMarkers: {
          hasTHREE: !!sim.THREE,
          hasCamera: !!sim.camera,
          hasScene: !!sim.scene,
        },
      };
    });

    log(`health=${report.health} y=${report.y?.toFixed?.(1)} speed=${report.speed?.toFixed?.(2)} crashed=${report.crashed}`);

    const failures = [];
    if (!report.hasPlane) failures.push('missing plane');
    if (!report.moduleMarkers.hasTHREE) failures.push('missing THREE on __sim');
    if (!report.moduleMarkers.hasCamera) failures.push('missing camera');
    if (!report.moduleMarkers.hasScene) failures.push('missing scene');
    if (report.crashed) failures.push('plane crashed during smoke');
    if (!(report.health > 0)) failures.push(`bad health ${report.health}`);
    if (!(report.y > 10)) failures.push(`altitude too low ${report.y}`);
    if (!(report.speed > 1)) failures.push(`speed too low ${report.speed}`);
    if (pageErrors.length) failures.push(`page errors: ${pageErrors.slice(0, 3).join(' | ')}`);

    if (failures.length) {
      console.error('[smoke] FAIL');
      for (const f of failures) console.error(`  - ${f}`);
      if (report.textSnippet) console.error(`  telemetry: ${report.textSnippet}`);
      process.exitCode = 1;
    } else {
      log('PASS');
      process.exitCode = 0;
    }
  } finally {
    await browser.close().catch(() => {});
    if (server) await server.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error('[smoke] fatal', err && err.stack || err);
  process.exit(1);
});
