#!/usr/bin/env bun
/**
 * Release smoke test: validates the actual `dist/` package instead of the
 * editable source page. It catches missing menu art, broken redirect aliases,
 * local-runtime failures, and a non-interactive plane selector.
 */
import { createServer } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const screenshotDir = path.join(root, 'output', 'playwright');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
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

function log(message) {
  console.log(`[production-smoke] ${message}`);
}

async function startDistServer() {
  // Exercise the package under the CSP that Netlify will actually send.  Read
  // the configured value instead of keeping a second, drifting copy in test
  // code.
  const netlifyToml = await readFile(path.join(root, 'netlify.toml'), 'utf8').catch(() => '');
  const configuredCsp = netlifyToml.match(/^\s*Content-Security-Policy\s*=\s*"([^"]+)"\s*$/m)?.[1] || '';
  const server = createServer(async (req, res) => {
    try {
      const parsed = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
      const abs = path.resolve(dist, `.${decodeURIComponent(pathname)}`);
      if (!abs.startsWith(dist + path.sep) && abs !== dist) {
        res.writeHead(403); res.end('forbidden'); return;
      }
      const entry = await stat(abs).catch(() => null);
      if (!entry || !entry.isFile()) {
        res.writeHead(404); res.end('not found'); return;
      }
      const headers = { 'content-type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream' };
      if (configuredCsp && path.extname(abs).toLowerCase() === '.html') headers['content-security-policy'] = configuredCsp;
      res.writeHead(200, headers);
      res.end(await readFile(abs));
    } catch (error) {
      res.writeHead(500); res.end(String(error && error.message || error));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function main() {
  const server = await startDistServer();
  const failures = [];
  const browser = await chromium.launch({
    headless: true,
    // Match the established source smoke configuration. Explicit SwiftShader
    // is much slower for this shader-heavy scene on CI/macOS and masks real
    // menu regressions behind a renderer bootstrap timeout.
    args: ['--use-gl=angle', '--ignore-gpu-blocklist'],
  });
  // Keep the release check representative of a laptop/desktop while avoiding
  // an oversized SwiftShader target that can hide boot regressions behind GPU
  // initialization time in CI.
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const badResponses = [];
  const pageErrors = [];
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.origin === server.origin && response.status() >= 400) {
      badResponses.push(`${response.status()} ${url.pathname}`);
    }
  });
  page.on('pageerror', (error) => pageErrors.push(String(error && error.message || error)));

  try {
    const indexResponse = await page.request.get(`${server.origin}/`);
    if (!indexResponse.ok()) failures.push(`release index failed: ${indexResponse.status()}`);
    else if (!String(await indexResponse.text()).includes('game.html')) failures.push('release index does not redirect to game.html');
    // Navigate through the deployed root entry instead of only fetching it:
    // this proves the production redirect and CSP still lead to the game.
    log(`opening ${server.origin}/`);
    await page.goto(`${server.origin}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    // `goto` may already have followed the synchronous redirect before this
    // next line runs, so first inspect the settled URL and only wait when the
    // root document is still active.
    if (new URL(page.url()).pathname !== '/game.html') {
      await page.waitForFunction(() => location.pathname === '/game.html', null, { timeout: 15_000 });
    }
    await page.waitForFunction(() => !!window.__sim, null, { timeout: 90_000 });
    log('__sim booted');
    await page.waitForTimeout(250);

    const titleState = await page.evaluate(() => ({
      titleVisible: !!document.getElementById('title') && !document.getElementById('title').classList.contains('hide'),
      playButton: !!document.getElementById('menu-btn-solo'),
      gameCanvas: !!document.querySelector('canvas'),
    }));
    if (!titleState.titleVisible || !titleState.playButton || !titleState.gameCanvas) {
      failures.push(`menu did not become interactive: ${JSON.stringify(titleState)}`);
    }

    await mkdir(screenshotDir, { recursive: true });
    // Keep a first-frame artifact as well as the hangar state.  The title
    // image is the place deploys most often lose their UI asset paths.
    await page.screenshot({ path: path.join(screenshotDir, 'production-title.png'), fullPage: false });

    if (titleState.titleVisible) {
      await page.click('#menu-btn-planes');
      await page.waitForFunction(() => {
        const panel = document.getElementById('menu-panel-planes');
        return !!panel && !panel.hidden;
      }, null, { timeout: 10_000 });
      await page.waitForFunction(() => document.querySelectorAll('#hangar-grid .hangar-card').length > 0, null, { timeout: 10_000 });
      // The menu deliberately scrolls a newly opened panel into view.  Let
      // that short animation settle before asserting the compact layout and
      // recording the production artifact.
      await page.waitForTimeout(400);
    }

    const menuLayout = await page.evaluate(() => {
      const inViewport = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
      };
      const panel = document.getElementById('menu-panel-planes');
      const grid = document.getElementById('hangar-grid');
      const active = grid && grid.querySelector('.hangar-card.active');
      return {
        panelVisible: inViewport(panel),
        gridVisible: inViewport(grid),
        activeVisible: inViewport(active),
      };
    });
    if (!menuLayout.panelVisible || !menuLayout.gridVisible || !menuLayout.activeVisible) {
      failures.push(`plane selector is not visible after opening: ${JSON.stringify(menuLayout)}`);
    }

    const hangar = await page.evaluate(async () => {
      const cards = [...document.querySelectorAll('#hangar-grid .hangar-card')];
      const thumbnailRequests = await Promise.all(cards.map(async (card) => {
        const image = card.querySelector('img');
        if (!image) return { src: '', ok: false };
        try {
          const response = await fetch(image.src, { cache: 'no-store' });
          return { src: new URL(image.src).pathname, ok: response.ok };
        } catch {
          return { src: new URL(image.src).pathname, ok: false };
        }
      }));
      const mustLoad = [
        'assets/ui/menu/bg-169.jpg',
        'assets/ui/menu/05_play_solo_normal.png',
        'vendor/three/r128/build/three.min.js',
      ];
      const staticRequests = await Promise.all(mustLoad.map(async (src) => {
        try {
          const response = await fetch(src, { cache: 'no-store' });
          return { src, ok: response.ok };
        } catch {
          return { src, ok: false };
        }
      }));
      return {
        cards: cards.length,
        active: cards.filter((card) => card.classList.contains('active')).length,
        thumbnails: thumbnailRequests,
        staticRequests,
      };
    });
    if (hangar.cards !== 16) failures.push(`expected 16 hangar cards, got ${hangar.cards}`);
    if (hangar.active !== 1) failures.push(`expected one active airframe, got ${hangar.active}`);
    for (const request of [...hangar.thumbnails, ...hangar.staticRequests]) {
      if (!request.ok) failures.push(`missing release asset ${request.src}`);
    }

    await page.screenshot({ path: path.join(screenshotDir, 'production-menu.png'), fullPage: false });

    // The deployed menu is only useful if it hands off to gameplay.  Start a
    // real solo flight, advance enough fixed time for the deferred terrain
    // queue to paint, and retain a visual artifact of the first in-game view.
    await page.click('#menu-btn-solo');
    await page.waitForFunction(() => {
      const title = document.getElementById('title');
      return !!title && title.classList.contains('hide') && !document.body.classList.contains('preflight');
    }, null, { timeout: 10_000 });
    await page.evaluate(() => window.advanceTime(360));
    const gameplayState = await page.evaluate(() => ({
      titleHidden: document.getElementById('title')?.classList.contains('hide'),
      preflight: document.body.classList.contains('preflight'),
      canvas: !!document.querySelector('canvas'),
      planeFinite: !!window.__sim && Number.isFinite(window.__sim.plane.pos.x)
        && Number.isFinite(window.__sim.plane.pos.y) && Number.isFinite(window.__sim.plane.pos.z),
    }));
    if (!gameplayState.titleHidden || gameplayState.preflight || !gameplayState.canvas || !gameplayState.planeFinite) {
      failures.push(`solo launch did not reach gameplay: ${JSON.stringify(gameplayState)}`);
    }
    await page.screenshot({ path: path.join(screenshotDir, 'production-gameplay.png'), fullPage: false });

    // Verify legacy deploy aliases remain usable for old links/bookmarks.
    for (const alias of ['/flight-sim3.html', '/plane-select.html']) {
      const response = await page.request.get(`${server.origin}${alias}`);
      if (!response.ok()) failures.push(`legacy alias failed: ${alias} (${response.status()})`);
    }

    if (badResponses.length) failures.push(`release HTTP failures: ${[...new Set(badResponses)].join(', ')}`);
    if (pageErrors.length) failures.push(`page errors: ${pageErrors.slice(0, 3).join(' | ')}`);
  } finally {
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }

  if (failures.length) {
    console.error('[production-smoke] FAIL');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
  } else {
    log('PASS');
  }
}

main().catch((error) => {
  console.error('[production-smoke] fatal', error && error.stack || error);
  process.exit(1);
});
