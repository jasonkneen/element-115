#!/usr/bin/env bun
/**
 * Ground-contact smoke test for the source game.
 *
 * It verifies the shared runway surface, a parked spawn, a gentle gear-down
 * touchdown, and a gear-up belly strike in a real browser renderer.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
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
  console.log(`[physics-smoke] ${message}`);
}

async function startStaticServer() {
  const server = createServer(async (req, res) => {
    try {
      const parsed = new URL(req.url || '/', 'http://127.0.0.1');
      const rel = parsed.pathname === '/' ? '/flight-sim3.html' : decodeURIComponent(parsed.pathname);
      const abs = path.resolve(root, `.${rel}`);
      if (!abs.startsWith(root + path.sep) && abs !== root) {
        res.writeHead(403); res.end('forbidden'); return;
      }
      const entry = await stat(abs).catch(() => null);
      if (!entry || !entry.isFile()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream' });
      res.end(await readFile(abs));
    } catch (error) {
      res.writeHead(500); res.end(String(error && error.message || error));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function advancePhysics(page, milliseconds) {
  const steps = Math.max(1, Math.round(milliseconds / (1000 / 120)));
  await page.evaluate((count) => window.__sim.stepPhysics(count), steps);
}

function finiteNumber(value) {
  return Number.isFinite(value);
}

async function main() {
  const server = await startStaticServer();
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const failures = [];
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error && error.message || error)));

  try {
    const url = `${server.origin}/flight-sim3.html?spawn=runway36&plane=default&debug=1`;
    log(`opening ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(() => !!(
      window.__sim
      && window.__ap
      && typeof window.__sim.getSurfaceHeight === 'function'
      && typeof window.__sim.sampleSurface === 'function'
      && typeof window.__sim.stepPhysics === 'function'
      && typeof window.advanceTime === 'function'
    ), null, { timeout: 90_000 });

    // This test isolates surface response from the live combat encounter
    // layer.  The real game still runs that layer; it is covered by the
    // regular smoke, while a passing landing must not depend on UFO timing.
    await page.evaluate(() => {
      const sim = window.__sim;
      sim.scene.userData.__ambientFxDensity = 0;
      const combat = sim.combat;
      combat.activeShooterId = '';
      combat.activeShooterUntil = 0;
      for (const projectile of combat.projectiles || []) {
        projectile.active = false;
        if (projectile.mesh) projectile.mesh.visible = false;
      }
      for (const missile of combat.missiles || []) {
        missile.active = false;
        if (missile.mesh) missile.mesh.visible = false;
      }
      // Browser rendering can be intentionally slow under software WebGL.
      // Keep this focused physics test from reaching the normal five-minute
      // match limit while it advances deterministic test time.
      if (window.__gameMatch) {
        window.__gameMatch.startedAt = performance.now();
        window.__gameMatch.durationMs = 24 * 60 * 60 * 1000;
        window.__gameMatch.ended = false;
      }
    });

    const surfaceContract = await page.evaluate(() => {
      const sim = window.__sim;
      const sample = (x, z) => sim.sampleSurface(x, z, {}, true);
      return {
        runway: sample(0, 0),
        apron: sample(34, 150),
        // x=23 lies on the visible taxiway but outside the overlapping runway
        // mesh, so its surface label is unambiguous.
        taxiway: sample(23, 116),
        dryBowl: sample(260, 0),
      };
    });
    if (surfaceContract.runway.kind !== 'runway' || Math.abs(surfaceContract.runway.height - 0.08) > 0.001) {
      failures.push(`runway surface mismatch: ${JSON.stringify(surfaceContract.runway)}`);
    }
    if (surfaceContract.apron.kind !== 'apron' || Math.abs(surfaceContract.apron.height - 0.08) > 0.001) {
      failures.push(`apron surface mismatch: ${JSON.stringify(surfaceContract.apron)}`);
    }
    if (surfaceContract.taxiway.kind !== 'taxiway' || Math.abs(surfaceContract.taxiway.height - 0.08) > 0.001) {
      failures.push(`taxiway surface mismatch: ${JSON.stringify(surfaceContract.taxiway)}`);
    }
    if (surfaceContract.dryBowl.water) {
      failures.push(`airfield water exclusion mismatch: ${JSON.stringify(surfaceContract.dryBowl)}`);
    }

    await page.evaluate(() => {
      window.__ap.reset();
      window.__ap.pause();
    });
    await advancePhysics(page, 1200);
    const parked = await page.evaluate(() => {
      const sim = window.__sim;
      const p = sim.plane;
      const surface = sim.getSurfaceHeight(p.pos.x, p.pos.z);
      return {
        key: p.aircraftKey,
        onGround: p.onGround,
        health: p.health,
        speed: p.vel.length(),
        x: p.pos.x,
        y: p.pos.y,
        z: p.pos.z,
        expectedY: surface + p.aircraftSpec.ground.gearHeight,
      };
    });
    log(`parked key=${parked.key} y=${parked.y.toFixed(3)} speed=${parked.speed.toFixed(3)}`);
    if (parked.key !== 'e115') failures.push(`default aircraft is ${parked.key}, expected e115`);
    if (!parked.onGround) failures.push('runway spawn did not remain grounded');
    if (!(parked.health > 99.9)) failures.push(`parked plane lost health: ${parked.health}`);
    if (![parked.x, parked.y, parked.z, parked.speed].every(finiteNumber)) failures.push(`parked state is non-finite: ${JSON.stringify(parked)}`);
    if (Math.abs(parked.y - parked.expectedY) > 0.25) failures.push(`parked plane floats/clips: ${JSON.stringify(parked)}`);
    if (Math.hypot(parked.x, parked.z - 180) > 2.5) failures.push(`parked plane drifted: ${JSON.stringify(parked)}`);

    await page.evaluate(() => {
      const sim = window.__sim;
      const p = sim.plane;
      const surface = sim.getSurfaceHeight(0, -100);
      p.pos.set(0, surface + p.aircraftSpec.ground.gearHeight + 1.5, -100);
      p.prevPos.copy(p.pos);
      p.quat.identity();
      p.prevQuat.copy(p.quat);
      p.vel.set(0, -2, 0);
      p.angVel.set(0, 0, 0);
      p.throttle = 0;
      p.throttleTarget = 0;
      p.gear = 1;
      p.gearTarget = 1;
      p.onGround = false;
      p.crashed = false;
      p.health = 100;
      p.shield = 0;
      p.lastSurfaceImpactAt = -Infinity;
    });
    await advancePhysics(page, 900);
    const gentle = await page.evaluate(() => {
      const sim = window.__sim;
      const p = sim.plane;
      const surface = sim.getSurfaceHeight(p.pos.x, p.pos.z);
      return {
        onGround: p.onGround,
        crashed: p.crashed,
        health: p.health,
        y: p.pos.y,
        expectedY: surface + p.aircraftSpec.ground.gearHeight,
        verticalSpeed: p.vel.y,
      };
    });
    log(`gentle landing health=${gentle.health.toFixed(2)} y=${gentle.y.toFixed(3)} vertical=${gentle.verticalSpeed.toFixed(3)}`);
    if (!gentle.onGround || gentle.crashed || gentle.health < 99.9) failures.push(`gentle touchdown regressed: ${JSON.stringify(gentle)}`);
    if (Math.abs(gentle.y - gentle.expectedY) > 0.3) failures.push(`gentle touchdown surface mismatch: ${JSON.stringify(gentle)}`);

    await page.evaluate(() => {
      const sim = window.__sim;
      const p = sim.plane;
      const surface = sim.getSurfaceHeight(0, -50);
      p.pos.set(0, surface + 0.75, -50);
      p.prevPos.copy(p.pos);
      p.quat.identity();
      p.prevQuat.copy(p.quat);
      p.vel.set(0, -6, 0);
      p.angVel.set(0, 0, 0);
      p.throttle = 0;
      p.throttleTarget = 0;
      p.gear = 0;
      p.gearTarget = 0;
      p.onGround = false;
      p.crashed = false;
      p.health = 100;
      p.shield = 0;
      p.lastSurfaceImpactAt = -Infinity;
    });
    await advancePhysics(page, 180);
    const belly = await page.evaluate(() => {
      const p = window.__sim.plane;
      return { onGround: p.onGround, crashed: p.crashed, health: p.health, shield: p.shield, gear: p.gear };
    });
    log(`gear-up contact health=${belly.health.toFixed(2)} shield=${belly.shield.toFixed(2)} crashed=${belly.crashed}`);
    if (!(belly.health < 99.9 || belly.crashed)) failures.push(`gear-up belly strike was not detected: ${JSON.stringify(belly)}`);
    if (pageErrors.length) failures.push(`page errors: ${pageErrors.slice(0, 3).join(' | ')}`);
  } finally {
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }

  if (failures.length) {
    console.error('[physics-smoke] FAIL');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
  } else {
    log('PASS');
  }
}

main().catch((error) => {
  console.error('[physics-smoke] fatal', error && error.stack || error);
  process.exit(1);
});
