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
import { existsSync, unlinkSync, copyFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const wantReset = args.includes('--reset');
const only = args.find(a => !a.startsWith('--'));

const ROOT = process.cwd();
const FILES_TO_RESET = [
  'autopilot-skills.json',
  'world-state.json',
  'feature-requests.json',
  'build-log.json',
];

if (wantReset) {
  for (const f of FILES_TO_RESET) {
    const p = path.join(ROOT, f);
    if (existsSync(p)) {
      try { unlinkSync(p); console.log('[orch] wiped', f); } catch {}
    }
  }
  const bak = path.join(ROOT, 'flight-sim3.html.bak');
  const html = path.join(ROOT, 'flight-sim3.html');
  if (existsSync(bak)) {
    copyFileSync(bak, html);
    console.log('[orch] restored flight-sim3.html from .bak');
  }
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

const procs = [];
const serveProc = launchServe(PORT);
procs.push(serveProc);
console.log(`${C.orch}[orch]${C.reset}       launched ‘npx serve’ — waiting for port…`);
try {
  PORT = await waitForServePort(serveProc);
  console.log(`${C.orch}[orch]${C.reset}       server is on :${PORT}`);
} catch (e) {
  console.error(`${C.orch}[orch]${C.reset}       ${e.message}`);
  for (const p of procs) { try { p.kill('SIGTERM'); } catch {} }
  process.exit(1);
}

// Give the HTTP server a beat to finish binding after it prints the URL
await new Promise(r => setTimeout(r, 500));

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
