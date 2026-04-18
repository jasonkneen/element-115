#!/usr/bin/env node
// =============================================================
//  AUTOPILOT · Learn-to-Fly
// =============================================================
//  An AI agent that tries to learn the flight sim controls from
//  scratch using ONLY vision. It cannot read this script, cannot
//  read the game code, and has no prior knowledge of the control
//  mapping. It must read the on-screen control legend, experiment,
//  observe results, crash, reset, and build up a skill notebook.
//
//  The human-facing autopilot.mjs (this file) is just plumbing:
//    - agent-browser for screenshots + keyboard + DOM eval
//    - Fireworks kimi-k2p5 for vision reasoning
//    - JSON skill notebook persisted between iterations
// =============================================================

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const exec = promisify(execFile);

// ——— Config ———
const TARGET_URL = 'http://localhost:52680/flight-sim3#plane=disney_planes_-_dusty_turbo.glb';
const MODEL = 'accounts/fireworks/models/kimi-k2p5';
const API_URL = 'https://api.fireworks.ai/inference/v1/chat/completions';
const API_KEY = process.env.FIREWORKS_API_KEY;
const SKILLS_PATH = path.resolve(process.cwd(), 'autopilot-skills.json');
const FRAME_PATH = '/tmp/ap-frame.png';
const MAX_ITERS = 200;
const ACT_DURATION_MS = 1200;    // how long an action plays before we re-evaluate
const MAX_HOLD_MS = 3000;
const THINK_PAUSE = false;        // real-time: game keeps running while AI thinks

if (!API_KEY) {
  console.error('FIREWORKS_API_KEY is not set.');
  process.exit(1);
}

// ——— Tiny sh helper ———
const run = async (...args) => {
  try {
    const { stdout } = await exec('agent-browser', args, { maxBuffer: 8 << 20 });
    return stdout;
  } catch (e) {
    return e.stdout || '';
  }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ——— Key normalisation ———
// The AI describes keys however it sees them ("W", "shift", "left arrow").
// Translate to DOM KeyboardEvent codes so the sim's handler picks them up.
function toCode(k) {
  if (!k) return null;
  const s = String(k).trim();
  const up = s.toUpperCase();
  const map = {
    'SHIFT': 'ShiftLeft', 'LEFT SHIFT': 'ShiftLeft', 'LSHIFT': 'ShiftLeft',
    'CTRL': 'ControlLeft', 'CONTROL': 'ControlLeft', 'LCTRL': 'ControlLeft',
    'ALT': 'AltLeft',
    'SPACE': 'Space', ' ': 'Space',
    'ENTER': 'Enter', 'RETURN': 'Enter',
    'TAB': 'Tab', 'ESC': 'Escape', 'ESCAPE': 'Escape',
    'LEFT': 'ArrowLeft', 'LEFT ARROW': 'ArrowLeft',
    'RIGHT': 'ArrowRight', 'RIGHT ARROW': 'ArrowRight',
    'UP': 'ArrowUp', 'UP ARROW': 'ArrowUp',
    'DOWN': 'ArrowDown', 'DOWN ARROW': 'ArrowDown',
  };
  if (map[up]) return map[up];
  if (up.startsWith('KEY')) return 'Key' + up.slice(3,4).toUpperCase();
  if (up.startsWith('ARROW')) return 'Arrow' + up.slice(5,6).toUpperCase() + up.slice(6).toLowerCase();
  if (up.length === 1 && /[A-Z]/.test(up)) return 'Key' + up;
  if (up.length === 1 && /[0-9]/.test(up)) return 'Digit' + up;
  return s; // pass through if it looks already-coded
}

// ——— Browser bridge via eval ———
// agent-browser prints the eval return value as a JSON-encoded string on
// stdout (so `42` → `42`, `"hi"` → `"hi"`, `{a:1}` → `"{\"a\":1}"` when
// we've already JSON.stringify'd inside the page). Unwrap one layer, then
// if the result is still JSON (object/array), unwrap a second layer.
async function evalPage(js) {
  const out = await run('eval', js);
  const line = out.trim().split('\n').pop() || '';
  let v;
  try { v = JSON.parse(line); } catch { return line; }
  if (typeof v === 'string' && /^\s*[{\[]/.test(v)) {
    try { v = JSON.parse(v); } catch { /* keep string */ }
  }
  return v;
}

async function pageReady() {
  const r = await evalPage('JSON.stringify({ hasAp: !!window.__ap, loaded: document.readyState })');
  return r;
}

async function pauseGame()   { await evalPage('window.__ap && window.__ap.pause(); "ok"'); }
async function resumeGame()  { await evalPage('window.__ap && window.__ap.resume(); "ok"'); }
async function resetPlane()  { await evalPage('window.__ap && window.__ap.reset(); "ok"'); }
async function telemetry()   { return evalPage('JSON.stringify(window.__ap.telemetry())'); }

// Renders a thoughts panel across the top of the screen so the human can
// watch the AI's reasoning live. Pass an object with any of these keys:
//   phase, action, observe, reasoning, strategy, iter
async function setStatus(update) {
  const js = `(() => {
    let el = document.getElementById('__ap_thoughts');
    if (!el) {
      el = document.createElement('div');
      el.id = '__ap_thoughts';
      el.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0',
        'background:linear-gradient(180deg,rgba(8,14,25,0.95),rgba(8,14,25,0.78))',
        'color:#cfe3ff', 'border-bottom:1px solid #2a4060',
        'font:12px/1.45 ui-monospace,Menlo,monospace',
        'padding:10px 18px 12px', 'z-index:9998',
        'pointer-events:none', 'backdrop-filter:blur(6px)',
        'max-height:40vh', 'overflow:hidden'
      ].join(';');
      el.innerHTML = [
        '<div style="display:flex;gap:14px;align-items:baseline;margin-bottom:6px;">',
          '<span style="color:#4ecbff;font-weight:600;letter-spacing:0.2em;">🤖 AUTOPILOT</span>',
          '<span id="__ap_iter" style="color:#6a7fa0;font-size:11px;"></span>',
          '<span id="__ap_phase" style="color:#5df09a;font-weight:600;margin-left:auto;"></span>',
          '<span id="__ap_action" style="color:#ff9d4e;font-weight:600;"></span>',
        '</div>',
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">',
          '<div>',
            '<div style="color:#4ecbff;font-size:10px;letter-spacing:0.2em;margin-bottom:3px;">THOUGHTS</div>',
            '<div style="display:grid;grid-template-columns:auto 1fr;gap:3px 8px;font-size:11px;line-height:1.4;">',
              '<span style="color:#6a7fa0;">see</span><span id="__ap_obs" style="color:#cfe3ff;"></span>',
              '<span style="color:#6a7fa0;">why</span><span id="__ap_why" style="color:#a8bcd8;"></span>',
              '<span style="color:#6a7fa0;">plan</span><span id="__ap_plan" style="color:#ffd27a;"></span>',
            '</div>',
          '</div>',
          '<div>',
            '<div style="color:#5df09a;font-size:10px;letter-spacing:0.2em;margin-bottom:3px;">LEARNINGS</div>',
            '<div id="__ap_learnings" style="font-size:11px;line-height:1.45;color:#cfe3ff;"></div>',
            '<div id="__ap_recent" style="font-size:10px;line-height:1.4;color:#8fa3c4;margin-top:4px;"></div>',
          '</div>',
        '</div>'
      ].join('');
      document.body.appendChild(el);
    }
    const u = ${JSON.stringify(update)};
    const set = (id, val) => { if (val != null) el.querySelector('#'+id).textContent = val; };
    set('__ap_iter', u.iter);
    set('__ap_phase', u.phase);
    set('__ap_action', u.action);
    set('__ap_obs', u.observe);
    set('__ap_why', u.reasoning);
    set('__ap_plan', u.strategy);
    if (u.learnings != null) {
      const box = el.querySelector('#__ap_learnings');
      box.innerHTML = u.learnings.map(l =>
        '<span style="display:inline-block;background:rgba(93,240,154,0.1);border:1px solid #2a5040;' +
        'border-radius:3px;padding:1px 6px;margin:1px 4px 1px 0;"><b style="color:#5df09a;">' +
        l.k + '</b> <span style="color:#a8bcd8;">' + l.v + '</span></span>'
      ).join('');
    }
    if (u.recent != null) {
      const r = el.querySelector('#__ap_recent');
      r.innerHTML = '<b style="color:#6a7fa0;">recent:</b> ' + u.recent.map(x =>
        '<span style="color:#cfe3ff;">· ' + x + '</span>'
      ).join(' ');
    }
    "ok";
  })()`;
  await evalPage(js).catch(() => {});
}
function actionLabel(a) {
  if (!a) return 'noop';
  switch (a.type) {
    case 'press': return `HOLD ${a.key} ${a.hold_ms || 600}ms`;
    case 'tap':   return `TAP ${a.key}`;
    case 'click': return 'CLICK';
    case 'start': return 'START';
    case 'wait':  return `WAIT ${a.ms || 800}ms`;
    case 'reset': return 'RESET (R)';
    case 'done':  return 'DONE';
    default:      return a.type || '?';
  }
}

async function keyDown(code) { await evalPage(`window.__ap.keyDown(${JSON.stringify(code)}); "ok"`); }
async function keyUp(code)   { await evalPage(`window.__ap.keyUp(${JSON.stringify(code)}); "ok"`); }
async function holdKey(code, ms) {
  await keyDown(code);
  await sleep(Math.min(MAX_HOLD_MS, ms | 0));
  await keyUp(code);
}

// ——— Vision call ———
async function askLLM(messages) {
  const body = {
    model: MODEL,
    max_tokens: 1600,
    temperature: 0.15,
    response_format: { type: 'json_object' },
    messages,
  };
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  if (!res.ok) throw new Error('LLM error: ' + JSON.stringify(j));
  return j.choices?.[0]?.message?.content ?? '';
}

function encodeImage(pngPath) {
  const b64 = readFileSync(pngPath).toString('base64');
  return { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } };
}

// ——— Skill notebook ———
function loadSkills() {
  if (existsSync(SKILLS_PATH)) {
    try { return JSON.parse(readFileSync(SKILLS_PATH, 'utf8')); } catch {}
  }
  return {
    mission: 'Learn to fly the plane: take off, climb, hold level flight for ~30s, land would be a stretch goal.',
    iterations: 0,
    crashes: 0,
    resets: 0,
    control_map: {},        // e.g. { "W": "pitch up (confirmed)", "ShiftLeft": "throttle up (confirmed)" }
    observations: [],       // free-form notes
    strategy: '',           // current plan in natural language
    recent_actions: [],     // last ~10 (action, immediate effect)
    session_best: { max_altitude: 0, max_speed: 0, longest_flight_s: 0 },
  };
}
function saveSkills(s) {
  writeFileSync(SKILLS_PATH, JSON.stringify(s, null, 2));
}

// ——— Prompt construction ———
const SYSTEM = `You are an autonomous AI pilot learning to fly a browser flight simulator.

HARD RULES:
- You can ONLY see screenshots. You cannot read any code.
- You have a notebook of things you've learned across attempts. Update it each turn.
- The on-screen control legend tells you what keys do. READ IT in screenshots.
- You must learn by trial, observation, and iteration.

GOAL (in order of priority):
1. Figure out how to start the game (there may be an intro overlay that needs a click/key).
2. Learn the controls from the on-screen legend and confirm each by experimenting.
3. Take off: build up speed on the runway, then pitch up gently.
4. Climb to a safe altitude and hold level flight.
5. If you crash, press R to reset. Don't give up. Update your notebook with what went wrong.

OUTPUT FORMAT — reply ONLY with a single JSON object, no prose whatsoever before or after. Keep "reasoning" and "observe" short (1–2 sentences each) so you don't run out of tokens. Schema:
{
  "observe": "what I see right now, briefly",
  "reasoning": "why I'm doing this",
  "action": {
    "type": "press" | "tap" | "click" | "wait" | "reset" | "start" | "done",
    "key": "W" | "ShiftLeft" | "ArrowLeft" | ...   // when type is press/tap
    "hold_ms": 800,                                // when type is press (how long to hold)
    "ms": 1000,                                    // when type is wait
    "reason": "..."                                // when type is done
  },
  "notebook_updates": {
    "control_map": { "KeyW": "pitch up (confirmed after altitude increased)" },
    "observations": ["append-only notes"],
    "strategy": "short plan sentence"
  }
}

Action semantics:
- "press" — hold the key for hold_ms milliseconds (use for W/S/A/D, Shift, Ctrl; typical 400–2000 ms)
- "tap"   — quick press & release (for G, R, B, T, Y)
- "click" — click center of screen (use once if you see "CLICK TO BEGIN")
- "start" — alias for click-to-begin
- "wait"  — do nothing for ms milliseconds, then re-observe
- "reset" — press R to reset the plane after a crash
- "done"  — only when you've clearly succeeded (sustained level flight)

Notes:
- Keys you'll find in the legend typically include: W, S, A, D, Q, E, Shift, Ctrl, G, B, T, Y, R, and arrow keys.
- Do NOT output code fences. Output raw JSON only.`;

function buildUserMessage(skills, frame, statusNote) {
  const skillSummary = {
    iteration: skills.iterations,
    crashes: skills.crashes,
    resets: skills.resets,
    control_map: skills.control_map,
    observations: skills.observations.slice(-25),
    strategy: skills.strategy,
    recent_actions: skills.recent_actions.slice(-10),
    session_best: skills.session_best,
  };
  return [
    { type: 'text', text:
      `Iteration ${skills.iterations + 1}/${MAX_ITERS}\n` +
      `Status: ${statusNote}\n\n` +
      `Your skill notebook so far:\n${JSON.stringify(skillSummary, null, 2)}\n\n` +
      `Current frame (pause-frozen while you think):` },
    frame,
  ];
}

function parseLLM(text) {
  // Strip code fences if any
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();

  // Try the whole thing first (response_format=json_object should give this)
  try { return JSON.parse(t); } catch {}

  // Fall back: find the first balanced JSON object
  const start = t.indexOf('{');
  if (start === -1) throw new Error('no JSON in LLM reply: ' + t.slice(0, 300));
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        const slice = t.slice(start, i + 1);
        try { return JSON.parse(slice); } catch {}
        break;
      }
    }
  }
  // Last resort: greedy outermost
  const end = t.lastIndexOf('}');
  if (end > start) {
    try { return JSON.parse(t.slice(start, end + 1)); } catch {}
  }
  throw new Error('unparsable JSON in LLM reply: ' + t.slice(0, 300));
}

// ——— Action executor ———
async function executeAction(a, skills) {
  const t = (a && a.type) || 'wait';
  const step = { action: a, t0: Date.now() };
  let effect = '';
  try {
    switch (t) {
      case 'press': {
        const code = toCode(a.key);
        if (!code) { effect = 'bad key'; break; }
        await holdKey(code, Math.max(80, a.hold_ms || 600));
        effect = `held ${code} for ${a.hold_ms || 600}ms`;
        break;
      }
      case 'tap': {
        const code = toCode(a.key);
        if (!code) { effect = 'bad key'; break; }
        await holdKey(code, 90);
        effect = `tapped ${code}`;
        break;
      }
      case 'start':
      case 'click': {
        // Click the center of the canvas (or overlay)
        await run('click', 'body');
        effect = 'clicked canvas';
        break;
      }
      case 'wait': {
        await sleep(Math.min(4000, a.ms || 800));
        effect = `waited ${a.ms || 800}ms`;
        break;
      }
      case 'reset': {
        await resetPlane();
        skills.resets++;
        effect = 'reset plane';
        break;
      }
      case 'done':
        effect = 'done';
        break;
      default:
        effect = 'unknown action';
    }
  } catch (e) {
    effect = 'error: ' + e.message;
  }
  step.effect = effect;
  skills.recent_actions.push(step);
  if (skills.recent_actions.length > 20) skills.recent_actions.shift();
  return effect;
}

// ——— Main loop ———
(async () => {
  console.log(`[autopilot] booting · model=${MODEL}`);
  console.log(`[autopilot] target=${TARGET_URL}`);
  console.log(`[autopilot] skills=${SKILLS_PATH}`);

  // Fresh browser session — headed so the human can watch
  await run('close', '--all').catch(() => {});
  await run('open', TARGET_URL, '--headed');
  await sleep(2500);

  // Wait for the page bridge to attach
  for (let i = 0; i < 15; i++) {
    const r = await pageReady();
    if (r && r.hasAp) break;
    await sleep(500);
  }

  const skills = loadSkills();
  skills.iterations = 0;
  skills.recent_actions = [];
  console.log('[autopilot] loaded notebook with', Object.keys(skills.control_map).length, 'known controls');

  let statusNote = 'starting fresh, intro overlay may be present';
  let flightStart = null;

  for (let i = 0; i < MAX_ITERS; i++) {
    skills.iterations = i + 1;

    // Pause → screenshot → ask
    if (THINK_PAUSE) await pauseGame();
    await setStatus({ phase: 'THINKING…', action: '', iter: `iter ${i+1}/${MAX_ITERS}` });
    await run('screenshot', FRAME_PATH);
    const tele = await telemetry().catch(() => null);

    const user = buildUserMessage(skills, encodeImage(FRAME_PATH), statusNote);
    let reply, parsed;
    try {
      reply = await askLLM([
        { role: 'system', content: SYSTEM },
        { role: 'user', content: user },
      ]);
      parsed = parseLLM(reply);
    } catch (e) {
      console.error('[llm]', e.message);
      await sleep(1500);
      continue;
    }

    console.log(`\n[iter ${i+1}] obs: ${parsed.observe}`);
    console.log(`          act: ${JSON.stringify(parsed.action)}`);
    if (parsed.reasoning) console.log(`          why: ${parsed.reasoning}`);

    // Merge notebook updates
    const u = parsed.notebook_updates || {};
    if (u.control_map && typeof u.control_map === 'object') {
      Object.assign(skills.control_map, u.control_map);
    }
    if (Array.isArray(u.observations)) {
      for (const o of u.observations) if (typeof o === 'string') skills.observations.push(o);
      if (skills.observations.length > 200) skills.observations.splice(0, skills.observations.length - 200);
    }
    if (typeof u.strategy === 'string') skills.strategy = u.strategy;

    // Resume and act
    if (THINK_PAUSE) await resumeGame();
    const learnings = Object.entries(skills.control_map)
      .slice(-12)
      .map(([k, v]) => ({ k: k.replace(/^Key/, ''), v: String(v).slice(0, 36) }));
    const recent = skills.observations.slice(-3).map(o => String(o).slice(0, 80));
    await setStatus({
      phase: 'ACTING',
      action: `▶ ${actionLabel(parsed.action)}`,
      observe: parsed.observe || '',
      reasoning: parsed.reasoning || '',
      strategy: skills.strategy || '',
      iter: `iter ${i+1}/${MAX_ITERS} · crashes ${skills.crashes} · resets ${skills.resets}`,
      learnings,
      recent,
    });

    const effect = await executeAction(parsed.action, skills);

    // Let the action play out, gather new telemetry
    await sleep(ACT_DURATION_MS);
    const tele2 = await telemetry().catch(() => null);

    // Track session bests + crash detection
    if (tele2) {
      skills.session_best.max_altitude = Math.max(skills.session_best.max_altitude || 0, tele2.altitude);
      skills.session_best.max_speed    = Math.max(skills.session_best.max_speed    || 0, tele2.speed);

      if (tele2.altitude > 30 && !flightStart) flightStart = Date.now();
      if (flightStart && tele2.altitude < 5) flightStart = null;
      if (flightStart) {
        const flightS = (Date.now() - flightStart) / 1000;
        skills.session_best.longest_flight_s = Math.max(skills.session_best.longest_flight_s || 0, flightS);
      }

      if (tele2.crashed) {
        skills.crashes++;
        statusNote = `CRASHED (alt=${tele2.altitude.toFixed(1)}, spd=${tele2.speed.toFixed(1)}). Press R to reset.`;
      } else {
        statusNote = `alive · spd=${tele2.speed.toFixed(1)} alt=${tele2.altitude.toFixed(1)} thr=${(tele2.throttle*100).toFixed(0)}% ` +
                     `effect=${effect}`;
      }
    } else {
      statusNote = `effect=${effect}`;
    }

    saveSkills(skills);

    if (parsed.action && parsed.action.type === 'done') {
      console.log('[autopilot] AI reports done:', parsed.action.reason || '');
      break;
    }
  }

  console.log('\n[autopilot] session complete.');
  console.log('[autopilot] stats:', JSON.stringify(skills.session_best, null, 2));
  console.log('[autopilot] notebook saved to', SKILLS_PATH);
})().catch(err => {
  console.error('[autopilot] fatal:', err);
  process.exit(1);
});
