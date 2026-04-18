#!/usr/bin/env node
// =============================================================
//  SELF-EVOLVE · Orchestrator
// =============================================================
//  Spawns both agents in parallel and multiplexes their logs:
//    - autopilot.mjs       (pilot: flies, learns, reports)
//    - world-designer.mjs  (builder: adds features, rollback on error)
//
//  Usage:
//    node self-evolve.mjs            # launch both
//    node self-evolve.mjs pilot      # just the pilot
//    node self-evolve.mjs designer   # just the designer
//    node self-evolve.mjs --reset    # wipe notebook/world/requests first
// =============================================================

import { spawn } from 'node:child_process';
import { existsSync, unlinkSync, copyFileSync, readFileSync, writeFileSync, statSync, watch } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const wantReset  = args.includes('--reset');     // only the pilot's flight experience
const wantRewind = args.includes('--rewind');    // full nuke, rewind game to baseline
const only = args.find(a => !a.startsWith('--'));

const ROOT = process.cwd();

// ——— Reset semantics ———
//   --reset  :  wipes ONLY the pilot's flight experience (notebook, stage
//               progress, pending feedback). The game itself keeps every
//               evolution the designer has ever made — flight-sim3.html,
//               world-state.json, build-log.json, world-rev* git tags all
//               stay intact. This is an evolving game.
//   --rewind :  full nuke back to git tag 'experiment-start' — restores
//               pristine flight-sim3.html, wipes world-state + build-log,
//               deletes all world-rev* tags. Use when you want to rewatch
//               evolution from the very beginning.
const PILOT_ONLY_FILES = ['autopilot-skills.json'];
const WORLD_FILES      = ['world-state.json', 'build-log.json'];

if (wantReset || wantRewind) {
  for (const f of PILOT_ONLY_FILES) {
    const p = path.join(ROOT, f);
    if (existsSync(p)) { try { unlinkSync(p); console.log('[orch] wiped (pilot)', f); } catch {} }
  }
  // Pilot's pending feature requests are now stale; keep resolved history
  const reqPath = path.join(ROOT, 'feature-requests.json');
  if (existsSync(reqPath)) {
    try {
      const cur = JSON.parse(readFileSync(reqPath, 'utf8'));
      cur.pending = [];
      writeFileSync(reqPath, JSON.stringify(cur, null, 2));
      console.log('[orch] cleared pending feature requests (kept resolved history)');
    } catch {}
  }
}

if (wantRewind) {
  console.log('[orch] REWIND: restoring game to experiment-start baseline');
  for (const f of WORLD_FILES) {
    const p = path.join(ROOT, f);
    if (existsSync(p)) { try { unlinkSync(p); console.log('[orch] wiped (world)', f); } catch {} }
  }
  const reqPath = path.join(ROOT, 'feature-requests.json');
  if (existsSync(reqPath)) { try { unlinkSync(reqPath); console.log('[orch] wiped feature-requests.json'); } catch {} }
  const { execSync } = await import('node:child_process');
  try {
    execSync('git rev-parse experiment-start', { cwd: ROOT, stdio: 'ignore' });
    execSync('git checkout experiment-start -- flight-sim3.html', { cwd: ROOT, stdio: 'inherit' });
    console.log('[orch] restored flight-sim3.html from tag experiment-start');
    const tags = execSync('git tag -l "world-rev*"', { cwd: ROOT }).toString().trim().split(/\s+/).filter(Boolean);
    for (const t of tags) {
      try { execSync(`git tag -d ${t}`, { cwd: ROOT, stdio: 'ignore' }); } catch {}
    }
    if (tags.length) console.log(`[orch] deleted ${tags.length} world-rev* tag(s)`);
  } catch (e) {
    console.warn('[orch] git rewind failed:', e.message.split('\n')[0]);
  }
  const bak = path.join(ROOT, 'flight-sim3.html.bak');
  if (existsSync(bak)) { try { unlinkSync(bak); console.log('[orch] wiped .bak'); } catch {} }
}

if (!process.env.FIREWORKS_API_KEY) {
  console.error('[orch] FIREWORKS_API_KEY not set. export it and re-run.');
  process.exit(1);
}

// ——— ANSI colors for the streams ———
const C = {
  serve:    '\x1b[38;5;120m',  // green
  pilot:    '\x1b[38;5;45m',   // cyan
  designer: '\x1b[38;5;213m',  // magenta
  orch:     '\x1b[38;5;226m',  // yellow
  reset:    '\x1b[0m',
};

let PORT = process.env.PORT ? Number(process.env.PORT) : null;

function pipe(name, proc) {
  const color = C[name] || '';
  const prefix = color + `[${name}]`.padEnd(11) + C.reset + ' ';
  const rl = (buf) => {
    const lines = buf.toString().split(/\r?\n/);
    for (const l of lines) if (l.length) process.stdout.write(prefix + l + '\n');
  };
  proc.stdout.on('data', rl);
  proc.stderr.on('data', rl);
  proc.on('exit', (code) => {
    process.stdout.write(prefix + `— exited with code ${code} —\n`);
  });
}

function launchNode(name, script) {
  const p = spawn('node', [script], {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  pipe(name, p);
  return p;
}

// Launch `npx serve` and auto-discover the port it binds by reading the
// "http://localhost:XXXXX" line it prints. If PORT is set in the env, we
// pass -l to pin it; otherwise we let serve pick a free port (its default
// behaviour when 3000 is busy is to try 5000, then a random high port).
function launchServe(pinPort) {
  const srvArgs = ['--yes', 'serve', '-n', '.'];
  if (pinPort) { srvArgs.push('-l', String(pinPort)); }
  const p = spawn('npx', srvArgs, {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  pipe('serve', p);
  return p;
}

function waitForServePort(proc, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const re = /https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/;
    const to = setTimeout(() => reject(new Error('timed out waiting for serve to announce its port')), timeoutMs);
    const scan = (d) => {
      buf += d.toString();
      const m = buf.match(re);
      if (m) {
        clearTimeout(to);
        proc.stdout.off('data', scan);
        proc.stderr.off('data', scan);
        resolve(Number(m[1]));
      }
    };
    proc.stdout.on('data', scan);
    proc.stderr.on('data', scan);
    proc.on('exit', () => { clearTimeout(to); reject(new Error('serve exited before announcing a port')); });
  });
}

// Probe common ports for an existing server that actually serves
// flight-sim3.html so we can reuse it instead of starting a second serve.
async function findExistingServer() {
  const candidates = [];
  if (PORT) candidates.push(PORT);
  candidates.push(3000, 5000, 55073, 50045, 8080, 8000);
  const seen = new Set();
  for (const p of candidates) {
    if (seen.has(p)) continue;
    seen.add(p);
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 700);
      const res = await fetch(`http://localhost:${p}/flight-sim3.html`, {
        method: 'GET', signal: ctrl.signal, redirect: 'follow',
      });
      clearTimeout(to);
      if (res.ok) {
        const body = await res.text();
        if (body.includes('CANYON AIRSTRIP') || body.includes('Flight Sim') || body.includes('flight-sim')) {
          return p;
        }
      }
    } catch {}
  }
  return null;
}

const procs = [];
const existing = await findExistingServer();
if (existing) {
  PORT = existing;
  console.log(`${C.orch}[orch]${C.reset}       → reusing existing server on :${PORT}`);
} else {
  const serveProc = launchServe(PORT);
  procs.push(serveProc);
  console.log(`${C.orch}[orch]${C.reset}       launched ‘npx serve’ — waiting for port…`);
  try {
    PORT = await waitForServePort(serveProc);
    console.log(`${C.orch}[orch]${C.reset}       server bound on :${PORT}`);
  } catch (e) {
    console.error(`${C.orch}[orch]${C.reset}       ${e.message}`);
    for (const p of procs) { try { p.kill('SIGTERM'); } catch {} }
    process.exit(1);
  }
  // Give it a beat to finish binding after it prints the URL
  await new Promise(r => setTimeout(r, 500));
}

const childEnv = {
  ...process.env,
  PORT: String(PORT),
  TARGET_URL: `http://localhost:${PORT}/flight-sim3#plane=disney_planes_-_dusty_turbo.glb`,
};

function launchNodeWithEnv(name, script) {
  const p = spawn('node', [script], {
    cwd: ROOT,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  pipe(name, p);
  return p;
}

if (!only || only === 'pilot')    procs.push(launchNodeWithEnv('pilot',    'autopilot.mjs'));
if (!only || only === 'designer') procs.push(launchNodeWithEnv('designer', 'world-designer.mjs'));

// ——— HOT RELOAD WATCHER ———
// Any change to flight-sim3.html (from the designer, from manual edits, or
// from a git checkout) bumps world-state.json's revision. The pilot polls
// that file every iteration and calls `agent-browser reload` when the
// revision moves, so game tweaks appear live without restarting the
// browser. Debounced so a rapid save-save-save only fires once.
const HTML_PATH  = path.join(ROOT, 'flight-sim3.html');
const WORLD_PATH = path.join(ROOT, 'world-state.json');
let lastHtmlMtime = existsSync(HTML_PATH) ? statSync(HTML_PATH).mtimeMs : 0;
let reloadTimer = null;
function bumpWorldRevision(reason) {
  let w = { revision: 0, features: [] };
  if (existsSync(WORLD_PATH)) {
    try { w = JSON.parse(readFileSync(WORLD_PATH, 'utf8')); } catch {}
  }
  w.revision = (w.revision || 0) + 1;
  w.note = reason;
  w.updated = new Date().toISOString();
  writeFileSync(WORLD_PATH, JSON.stringify(w, null, 2));
  console.log(`${C.orch}[orch]${C.reset}       hot-reload: bumped world-state to rev ${w.revision} (${reason})`);
}
try {
  watch(HTML_PATH, { persistent: false }, () => {
    const mt = existsSync(HTML_PATH) ? statSync(HTML_PATH).mtimeMs : 0;
    if (mt === lastHtmlMtime) return;
    lastHtmlMtime = mt;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => bumpWorldRevision('flight-sim3.html changed on disk'), 500);
  });
  console.log(`${C.orch}[orch]${C.reset}       watching flight-sim3.html — saves hot-reload the browser`);
} catch (e) {
  console.warn(`${C.orch}[orch]${C.reset}       watch failed: ${e.message}`);
}

console.log(`${C.orch}[orch]${C.reset}       self-evolving flight sim launched · ${procs.length} agent(s)`);
console.log(`${C.orch}[orch]${C.reset}       Ctrl+C to stop all`);

// Clean shutdown on Ctrl+C
function shutdown() {
  console.log(`\n${C.orch}[orch]${C.reset}       shutting down agents…`);
  for (const p of procs) { try { p.kill('SIGTERM'); } catch {} }
  setTimeout(() => process.exit(0), 600);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// If any child dies, keep the others running unless all have exited
let alive = procs.length;
for (const p of procs) {
  p.on('exit', () => {
    alive--;
    if (alive === 0) {
      console.log(`${C.orch}[orch]${C.reset}       all agents done.`);
      process.exit(0);
    }
  });
}
