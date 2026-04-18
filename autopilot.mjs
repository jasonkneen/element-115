#!/usr/bin/env node
// =============================================================
//  AUTOPILOT · Learn-to-Fly with a real curriculum
// =============================================================
//  The AI is a pilot. It cannot see code, cannot see how the
//  sim works. It reads the screen, experiments, crashes, and
//  builds a skill notebook.
//
//  The AI does NOT decide when a stage is complete. An external
//  curriculum tracker inspects telemetry history and declares
//  each stage mastered objectively. The pilot just keeps flying.
//
//  Stages: takeoff → climb → cruise → turn_left → turn_right →
//          descend → low_pass → mountain_buzz → barrel_roll →
//          landing. All ten must be passed.
// =============================================================

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const exec = promisify(execFile);

// ——— Config ———
// URL priority: env.TARGET_URL > env.PORT > hardcoded default. The
// orchestrator (self-evolve.mjs) passes the real port via env after it
// starts serve, so these always match.
const TARGET_URL = process.env.TARGET_URL
  || `http://localhost:${process.env.PORT || 55073}/flight-sim3#plane=disney_planes_-_dusty_turbo.glb`;
const MODEL = 'accounts/fireworks/models/kimi-k2p5';
const API_URL = 'https://api.fireworks.ai/inference/v1/chat/completions';
const API_KEY = process.env.FIREWORKS_API_KEY;
const SKILLS_PATH = path.resolve(process.cwd(), 'autopilot-skills.json');
const WORLD_PATH = path.resolve(process.cwd(), 'world-state.json');
const REQUESTS_PATH = path.resolve(process.cwd(), 'feature-requests.json');
const FRAME_PATH = '/tmp/ap-frame.png';
const MAX_ITERS = 500;
const ACT_DURATION_MS = 900;       // play time between thoughts
const MAX_HOLD_MS = 3500;
const TELEMETRY_HZ = 5;            // background sample rate
const HISTORY_SECONDS = 45;        // ring buffer length

if (!API_KEY) { console.error('FIREWORKS_API_KEY is not set.'); process.exit(1); }

// Spawn agent-browser with a hard timeout so a stuck CDP connection can't
// freeze the whole agent. Returns stdout (possibly empty) on success or
// failure.
const run = async (...args) => {
  const opts = { maxBuffer: 16 << 20, timeout: 20_000 };
  try { const { stdout } = await exec('agent-browser', args, opts); return stdout; }
  catch (e) {
    if (e && e.killed) console.warn(`[autopilot] agent-browser ${args.join(' ')} TIMED OUT`);
    return e.stdout || '';
  }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ——— Key normalisation ———
function toCode(k) {
  if (!k) return null;
  const s = String(k).trim();
  const up = s.toUpperCase();
  const map = {
    'SHIFT': 'ShiftLeft', 'LEFT SHIFT': 'ShiftLeft',
    'CTRL': 'ControlLeft', 'CONTROL': 'ControlLeft',
    'ALT': 'AltLeft', 'SPACE': 'Space', ' ': 'Space',
    'ENTER': 'Enter', 'RETURN': 'Enter', 'TAB': 'Tab', 'ESC': 'Escape', 'ESCAPE': 'Escape',
    'LEFT': 'ArrowLeft', 'LEFT ARROW': 'ArrowLeft',
    'RIGHT': 'ArrowRight', 'RIGHT ARROW': 'ArrowRight',
    'UP': 'ArrowUp', 'UP ARROW': 'ArrowUp',
    'DOWN': 'ArrowDown', 'DOWN ARROW': 'ArrowDown',
  };
  if (map[up]) return map[up];
  if (up.startsWith('KEY') && up.length === 4) return 'Key' + up[3];
  if (up.startsWith('ARROW')) return 'Arrow' + up.slice(5,6) + up.slice(6).toLowerCase();
  if (up.length === 1 && /[A-Z]/.test(up)) return 'Key' + up;
  if (up.length === 1 && /[0-9]/.test(up)) return 'Digit' + up;
  return s;
}

// ——— Browser bridge via eval ———
async function evalPage(js) {
  const out = await run('eval', js);
  const line = out.trim().split('\n').pop() || '';
  let v;
  try { v = JSON.parse(line); } catch { return line; }
  if (typeof v === 'string' && /^\s*[{\[]/.test(v)) {
    try { v = JSON.parse(v); } catch {}
  }
  return v;
}
async function pageReady() { return evalPage('JSON.stringify({ hasAp: !!window.__ap, loaded: document.readyState })'); }
async function waitForBridge(maxTries = 30) {
  for (let k = 0; k < maxTries; k++) {
    const r = await pageReady();
    if (r && r.hasAp) return true;
    await sleep(400);
  }
  console.warn('[autopilot] window.__ap bridge never attached');
  return false;
}
// Force-dismiss the intro overlay and start the simulation via the bridge
// so the AI never has to click. Handles the initial load and every reload
// triggered by a world-designer revision bump.
async function dismissIntro() {
  await evalPage(`(() => {
    const t = document.getElementById('title');
    if (t) t.classList.add('hide');
    if (window.__ap) window.__ap.resume();
    "ok";
  })()`).catch(() => {});
}
async function resetPlane() { await evalPage('window.__ap && window.__ap.reset(); "ok"'); }
async function telemetry() { return evalPage('JSON.stringify(window.__ap.telemetry())'); }
async function keyDown(code) { await evalPage(`window.__ap.keyDown(${JSON.stringify(code)}); "ok"`); }
async function keyUp(code)   { await evalPage(`window.__ap.keyUp(${JSON.stringify(code)}); "ok"`); }
async function holdKey(code, ms) {
  await keyDown(code);
  await sleep(Math.min(MAX_HOLD_MS, ms | 0));
  await keyUp(code);
}

// ——— Telemetry history buffer ———
// Background poller fills a ring buffer of {t, spd_kts, alt_ft, ...}
const history = [];
let polling = true;
async function pollTelemetry() {
  while (polling) {
    try {
      const t = await telemetry();
      if (t && typeof t === 'object') {
        history.push(t);
        const cutoff = Date.now() - HISTORY_SECONDS * 1000;
        while (history.length && history[0].t < cutoff) history.shift();
      }
    } catch {}
    await sleep(1000 / TELEMETRY_HZ);
  }
}
function latest() { return history.length ? history[history.length - 1] : null; }
function lastN(seconds) {
  const cutoff = Date.now() - seconds * 1000;
  return history.filter(h => h.t >= cutoff);
}

// ——— Stage detectors ———
// Each returns { passed: bool, note: string }
function detSustained(pred, seconds) {
  const win = lastN(seconds + 1);
  if (win.length < 3) return { passed: false };
  const allMatch = win.every(pred);
  return { passed: allMatch && (win[win.length-1].t - win[0].t) >= seconds * 1000 };
}
function detReached(pred) {
  const l = latest();
  return { passed: !!l && pred(l) };
}
function detAltStable(band_ft, seconds, minSpd) {
  const win = lastN(seconds + 1);
  if (win.length < seconds * 2) return { passed: false };
  if (win[win.length-1].t - win[0].t < seconds * 1000) return { passed: false };
  const alts = win.map(w => w.alt_ft);
  const mean = alts.reduce((a,b)=>a+b,0) / alts.length;
  const maxDev = Math.max(...alts.map(a => Math.abs(a - mean)));
  const alwaysFast = win.every(w => w.spd_kts > minSpd && !w.crashed && w.alt_ft > 200);
  return { passed: maxDev <= band_ft && alwaysFast, note: `dev=${maxDev.toFixed(0)}ft` };
}
function detTurnedBy(deltaDeg) {
  // Integrate heading change across the full history buffer.
  // deltaDeg positive = right, negative = left.
  if (history.length < 10) return { passed: false };
  let acc = 0;
  for (let i = 1; i < history.length; i++) {
    let d = history[i].hdg_deg - history[i-1].hdg_deg;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    acc += d;
  }
  const direction = deltaDeg > 0 ? 1 : -1;
  const passed = direction > 0 ? acc >= deltaDeg : acc <= deltaDeg;
  const l = latest();
  // Must finish not crashed and still airborne
  return { passed: passed && l && !l.crashed && l.alt_ft > 300, note: `acc=${acc.toFixed(0)}°` };
}
function detDescended(fromFt, toFt) {
  const reachedHigh = history.some(h => h.alt_ft > fromFt);
  const l = latest();
  const now = !!l && l.alt_ft < toFt && l.alt_ft > 50 && !l.crashed;
  return { passed: reachedHigh && now };
}
function detMountainBuzz(maxAgl) {
  // Over last 10s, find a moment of low AGL where terrain is rising
  const win = lastN(15);
  for (let i = 5; i < win.length; i++) {
    const a = win[i];
    if (a.crashed) continue;
    const terrainRising = win[i].terrain_ft - win[i-5].terrain_ft > 150;
    if (a.agl_ft < maxAgl && a.agl_ft > 0 && a.spd_kts > 100 && terrainRising) {
      return { passed: true, note: `agl=${a.agl_ft.toFixed(0)} rising` };
    }
  }
  return { passed: false };
}
function detCompletedRoll() {
  // Integrate roll rate; look for a full 360° of cumulative roll change
  // within a 10s window while staying airborne-ish.
  const win = lastN(10);
  if (win.length < 20) return { passed: false };
  let acc = 0;
  for (let i = 1; i < win.length; i++) {
    let d = win[i].roll_deg - win[i-1].roll_deg;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    acc += d;
  }
  const l = latest();
  return { passed: Math.abs(acc) >= 330 && l && !l.crashed && l.alt_ft > 200, note: `roll=${acc.toFixed(0)}°` };
}
function detLanded() {
  // Touched down: on_ground after flight, speed bleeding off, not crashed, gear down
  const wasHigh = history.some(h => h.alt_ft > 400);
  const l = latest();
  if (!l || !wasHigh) return { passed: false };
  const recent = lastN(4);
  const onGroundNow = recent.every(r => r.agl_ft < 15);
  const slow = recent.every(r => r.spd_kts < 90);
  const gearDown = l.gear > 0.7;
  return { passed: onGroundNow && slow && gearDown && !l.crashed };
}

const CURRICULUM = [
  { id: 'takeoff',        name: 'TAKEOFF',         goal: 'Get airborne: reach 300 ft altitude at > 70 kts without crashing. Tip: this prop plane rotates at low speed — hold SHIFT (throttle) and S (pitch up) together from the very start.',
    check: () => detSustained(t => t.alt_ft > 300 && t.spd_kts > 70 && !t.crashed, 2) },
  { id: 'climb',          name: 'CLIMB',            goal: 'Reach 2000 ft altitude.',
    check: () => detReached(t => t.alt_ft > 2000 && !t.crashed) },
  { id: 'cruise',         name: 'LEVEL CRUISE',     goal: 'Hold altitude within ±150 ft for 15s while moving forward at > 100 kts.',
    check: () => detAltStable(150, 15, 100) },
  { id: 'turn_left',      name: 'LEFT 180° TURN',   goal: 'Complete a 180° heading change to the LEFT without crashing.',
    check: () => detTurnedBy(-180) },
  { id: 'turn_right',     name: 'RIGHT 180° TURN',  goal: 'Complete a 180° heading change to the RIGHT without crashing.',
    check: () => detTurnedBy(180) },
  { id: 'descend',        name: 'DESCEND',          goal: 'Descend from above 1500 ft to below 400 ft without crashing.',
    check: () => detDescended(1500, 400) },
  { id: 'low_pass',       name: 'LOW-ALTITUDE PASS',goal: 'Fly under 200 ft AGL at > 100 kts for 4s without crashing.',
    check: () => detSustained(t => t.agl_ft < 200 && t.agl_ft > 5 && t.spd_kts > 100 && !t.crashed, 4) },
  { id: 'mountain_buzz',  name: 'MOUNTAIN BUZZ',    goal: 'Skim rising terrain: AGL under 150 ft while ground climbs beneath you.',
    check: () => detMountainBuzz(150) },
  { id: 'barrel_roll',    name: 'BARREL ROLL',      goal: 'Complete a full 360° roll and recover airborne.',
    check: () => detCompletedRoll() },
  { id: 'landing',        name: 'LANDING',          goal: 'Touch down: gear down, speed below 90 kts on the ground without crashing.',
    check: () => detLanded() },
];

// ——— Vision call ———
async function askLLM(messages) {
  const body = {
    model: MODEL,
    max_tokens: 1600,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages,
  };
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  if (!res.ok) throw new Error('LLM error: ' + JSON.stringify(j));
  return j.choices?.[0]?.message?.content ?? '';
}
function encodeImage(p) {
  const b64 = readFileSync(p).toString('base64');
  return { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } };
}
function parseLLM(text) {
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch {}
  const start = t.indexOf('{');
  if (start === -1) throw new Error('no JSON in reply: ' + t.slice(0, 300));
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { try { return JSON.parse(t.slice(start, i+1)); } catch {} break; } }
  }
  throw new Error('unparsable JSON: ' + t.slice(0, 300));
}

// ——— Skill notebook ———
function loadSkills() {
  if (existsSync(SKILLS_PATH)) {
    try { return JSON.parse(readFileSync(SKILLS_PATH, 'utf8')); } catch {}
  }
  return {
    mission: 'Master the curriculum below. The coordinator, NOT you, decides when each stage is passed.',
    iterations: 0, crashes: 0, resets: 0,
    control_map: {},
    observations: [],
    strategy: '',
    recent_actions: [],
    stages_mastered: [],
    stage_playbooks: {},   // per-stage 3–5 bullet "what worked" summary
    current_stage: 'takeoff',
    session_best: { max_altitude: 0, max_speed: 0, longest_flight_s: 0 },
  };
}
function saveSkills(s) { writeFileSync(SKILLS_PATH, JSON.stringify(s, null, 2)); }

// ——— Observation clustering ———
// Append-only notebooks drown in near-duplicate lines like "Inverted
// flight at X° roll...". This dedups by keyword-signature so the
// notebook stays dense. Keeps at most `perKey` unique observations per
// semantic bucket, and caps total size too.
function clusterObservations(list, perKey = 2, totalMax = 60) {
  const sigOf = (s) => {
    const lower = (s || '').toLowerCase();
    // Strip numbers and punctuation — what's left is a semantic key.
    return lower.replace(/-?\d+(\.\d+)?/g, '#').replace(/[^a-z# ]/g, ' ')
      .replace(/\s+/g, ' ').trim().slice(0, 60);
  };
  const buckets = new Map();
  // Walk newest-first so the freshest copy of each lesson wins.
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i]; if (typeof s !== 'string') continue;
    const k = sigOf(s); if (!k) continue;
    const arr = buckets.get(k) || [];
    if (arr.length < perKey) { arr.push(s); buckets.set(k, arr); }
  }
  const out = [];
  for (const arr of buckets.values()) out.push(...arr);
  return out.slice(0, totalMax);
}

// ——— Prompt ———
function buildSystem(skills) {
  const mastered = skills.stages_mastered.map(id => CURRICULUM.find(s => s.id === id)?.name).filter(Boolean);
  const idx = CURRICULUM.findIndex(s => s.id === skills.current_stage);
  const stage = CURRICULUM[idx] || CURRICULUM[0];
  const remaining = CURRICULUM.slice(idx).map(s => `${s.name}: ${s.goal}`);
  const l = latest() || {};
  const fixedGear = l.gear > 0.95 && l.on_ground && l.spd_kts < 5
    ? true  // on ground, gear full down — likely fixed-gear config
    : undefined;
  return `You are an autonomous AI pilot learning to fly a browser flight simulator by vision alone.

HARD RULES:
- You ONLY see screenshots. You cannot read code. You cannot claim success.
- A separate coordinator evaluates your telemetry and announces when each stage is mastered.
- NEVER output action type "done". There is no "done". Your only job is to keep flying and
  make progress on the current stage.
- If you crash, the status line tells you so. Press R (action type "reset") to try again.
- If you lose control, level the wings (use A/D to roll back to level), then recover altitude.

PLANE CONFIG: fixed-wing prop plane with FIXED (non-retractable) landing gear.
- Do NOT press G. The gear is permanently down. The G key is a no-op.
- There is no "retract gear" step. Skip it entirely.
- The on-screen control legend has already been updated to omit G GEAR.

SELF-HEALING — BUG REPORTS:
- Your live telemetry includes prop_count, prop_spin_phase, prop_stuck,
  and fixed_gear. Use them to catch silent bugs:
    * prop_count == 0      → bug_report: "no prop mesh exists on the plane;
                               GLB-swap procedural prop fallback didn't fire"
    * prop_stuck == true   → bug_report: "propeller is not spinning even
                               though throttle > 0; plane.props[0].rotation.z
                               isn't changing between frames"
- Only report a bug ONCE per session (look at your recent observations).
- Be specific and actionable. The world-designer/bug-fixer will patch it
  live and the browser will hot-reload.

CURRENT STAGE: ${stage.name}
GOAL: ${stage.goal}

STAGES MASTERED: ${mastered.length ? mastered.join(', ') : '(none yet)'}

STAGE PLAYBOOKS (what actually worked last time — use these patterns):
${(() => {
  const pb = skills.stage_playbooks || {};
  const keys = Object.keys(pb);
  if (!keys.length) return '  (none yet — first attempt)';
  return keys.map(id => {
    const s = CURRICULUM.find(c => c.id === id);
    const p = pb[id];
    const obs = (p.key_observations || []).slice(0, 3).map(o => '      - ' + o.slice(0, 120)).join('\n');
    const acts = (p.action_shape || []).slice(-6).join(', ');
    return `  ${s?.name || id}:\n${obs}\n      actions near success: ${acts}`;
  }).join('\n');
})()}
REMAINING STAGES:
${remaining.map((s,i)=> (i===0?'> ':'  ') + s).join('\n')}

CONTROLS (you discovered these by reading the legend in screenshots):
${Object.entries(skills.control_map).map(([k,v]) => `  ${k} = ${v}`).join('\n') || '  (none yet, read the bottom-left legend)'}

CANONICAL CONTROL MEANINGS (do not second-guess these):
  ShiftLeft   = throttle UP (ramps target, stays where you leave it)
  ControlLeft = throttle DOWN (USE THIS at cruise — target 120–180 kts)
  KeyW        = pitch DOWN (nose toward ground)
  KeyS        = pitch UP   (nose toward sky)
  KeyA        = roll LEFT  — for TURNING, not just recovery
  KeyD        = roll RIGHT — for TURNING, not just recovery
  KeyQ / ArrowLeft  = yaw left  (rudder only — weak, use A to turn)
  KeyE / ArrowRight = yaw right (rudder only — weak, use D to turn)
  KeyR        = reset after crash

TIPS you've learned so far:
${skills.observations.slice(-10).map(o => '  · ' + o).join('\n') || '  (none)'}

OUTPUT SCHEMA (single JSON object, no prose):
{
  "observe": "1-sentence: what I see (altitude/speed/attitude/terrain)",
  "reasoning": "1-sentence: what I'll do and why",
  "action": {
    "type": "press"|"tap"|"click"|"wait"|"reset",
    "key":  "W"|"S"|"A"|"D"|"Q"|"E"|"ShiftLeft"|"ControlLeft"|"G"|"B"|"T"|"Y"|"R"|"ArrowLeft"|"ArrowRight",
    "keys": ["ShiftLeft", "KeyS"],    // OPTIONAL — use instead of "key" to hold multiple keys simultaneously (e.g. throttle+pitch for takeoff)
    "hold_ms": 100-3000,
    "ms": 200-2000
  },
  "notebook_updates": {
    "control_map": { "KeyW": "pitch down (confirmed)" },
    "observations": ["append-only tips"],
    "strategy": "very short plan sentence"
  },
  "feature_request": "OPTIONAL — 1 sentence describing a new element you want the world designer to add (e.g. 'a ring gate at 2000ft over the airstrip' or 'slalom poles along the valley'). Leave null if not needed.",
  "bug_report": "OPTIONAL — 1 sentence describing something broken or unfair in the world (e.g. 'I clipped through the control tower', 'the ring gate wasn't visible until too late'). Leave null if none."
}

Action semantics:
- press : hold key(s) for hold_ms. Use "keys":["ShiftLeft","KeyS"] to hold
          multiple simultaneously (essential for takeoff: SHIFT+S together
          throttles up AND pitches up in one motion).
- tap   : quick press (G, B, T, Y, R). Also supports "keys":[...] for
          combos if ever needed.
- click : click the canvas once (only needed to dismiss intro overlay)
- wait  : observe for ms
- reset : press R to reset after a crash

Throttle note: holding SHIFT ramps the throttle TARGET up over time. Once
you release SHIFT, the throttle STAYS at whatever it reached — it doesn't
snap back to zero. So a common pattern is: press SHIFT+S together for 1-2
seconds (throttle climbs while you pitch up), then keep holding S alone
until airborne.

================================================================
PILOT MANUAL — READ AND FOLLOW, DO NOT IMPROVISE
================================================================

AIRSPEED IS LIFE. Every stage below has a minimum safe speed.
Below that speed the wing stalls, lift collapses, the plane drops.
You CANNOT out-pitch a stall. Pulling S (pitch up) when slow makes
the stall DEEPER.

V-SPEEDS (this airframe — crop duster class):
  stall clean       Vs   = 55 kts   → NEVER fly below this in the air
  rotation          Vr   = 65 kts
  best climb        Vy   = 85 kts
  approach          Vref = 85 kts
  cruise target          = 140–160 kts
  maneuver          Va   = 130 kts  → full-deflection inputs OK below this
  never-exceed      Vne  = 220 kts

GOLDEN RULES:
  1. PITCH CONTROLS AIRSPEED. Nose down → faster. Nose up → slower.
  2. THROTTLE CONTROLS ALTITUDE (in level trim). More throttle → climbs.
  3. If spd_kts < 80 and descending: push W (nose down) AND hold
     SHIFT (throttle up). Do NOT press S.
  4. In a turn: BANK with A/D. Auto-rudder handles coordination.
     NEVER use rudder (Q/E/arrows) to turn — only for final-approach
     alignment.
  5. If you see the status say CRASHED, press R (reset) immediately.

STALL RECOVERY (MEMORIZE THIS):
  Symptoms: spd < 70 kts AND pitch_deg > 10 AND vs_ft_min negative/falling.
  Procedure:
    (a) Release S immediately.
    (b) TAP W for 200–400ms — get the nose BELOW the horizon.
    (c) Hold SHIFT for 1–2s — add power.
    (d) Wait. Let the plane fly itself back to speed.
    (e) Once spd > 100 kts, level wings with A or D as needed.
  Do NOT pull up until speed is back above 100 kts. You will stall
  again ("secondary stall").

LANDING PROCEDURE (when on landing stage):
  1. Set up 3 nautical-mile final: altitude ≈ 1000 ft AGL, aligned
     with runway heading 0° (north, since runway runs along ±Z).
  2. Reduce throttle to ≈40% (tap ControlLeft repeatedly) for
     target approach speed 85 kts.
  3. Nose pitch ≈ -3° for a 500 ft/min descent.
  4. Cross threshold at 50 ft AGL, 85 kts.
  5. Flare: tap S gently at 20 ft AGL to arrest the descent rate.
  6. Touch down at < 80 kts. Hold B (brake) until stopped.
  Gear is fixed-down — no G press needed.

COORDINATED TURN (to change heading by N degrees):
  1. Tap A (left) or D (right) 500ms to bank ≈30°.
  2. Tap S lightly (100–200ms) to hold altitude through the turn.
  3. WAIT. The nose swings around on its own (it's auto-rudder).
  4. When heading within 15° of target, tap opposite rudder-roll
     (D if banked left, A if banked right) 400ms to level wings.
  5. Micro-adjust with short pitch taps to regain cruise altitude.

ALTITUDE DISCIPLINE:
  Every stage has a band. STAY in the band.
  climb  stage: target 2000 ft, DO NOT exceed 3000 ft.
  cruise stage: target 1500–2500 ft. If you're above 4000 ft, you've
                overshot — descend FIRST, then cruise.
  descend:      target 300–500 ft. Arrest descent rate to < 1500 ft/min.
  Do not climb to 20000 ft. That is a bug report in itself.

================================================================

CRUISE NOTE — READ THIS IF YOU KEEP CRASHING / OSCILLATING:
Control authority grows with airspeed. At 300+ kts a 400ms pitch press
becomes a 15–20° pitch change — far too aggressive. If you're oscillating
between steep climbs and steep dives, THE FIX IS NOT MORE PITCH INPUT.
The fix is:
  1) Tap CONTROL (ControlLeft) for 1–2s to BLEED THROTTLE back to ~50–60%.
     Your target cruise speed is 120–180 kts, NOT 400 kts.
  2) Then use SHORT pitch taps — hold_ms of 80–150, not 400+.
  3) Wait 600–1000ms between pitch inputs so you can see the effect.

TURNING — READ THIS IF YOU NEED TO CHANGE HEADING:
A/D do not just 'recover from inverted'. They BANK the plane, and a banked
wing turns the aircraft via auto-rudder (built-in coordinated turn). To
turn 180° left:
  1) Tap A for 400–600ms to roll into a ~25–35° left bank.
  2) Hold a tiny S (pitch up, 100–200ms) to keep the nose from dropping.
  3) WAIT — the nose swings around on its own. Don't keep pressing A.
  4) When heading is reached, tap D for ~400ms to roll back to level.
ArrowLeft/ArrowRight yaw the rudder only — much weaker than banking.
Prefer A/D for real turns.

Smooth, gentle inputs win. Overcontrol = crash.`;
}

// Track consecutive samples where the prop is at the same phase — a
// reliable "prop not spinning" detector across real-time iterations.
let _lastPropPhase = null;
let _propStaleFrames = 0;
function buildUserMessage(skills, frame, liveStatus) {
  const l = latest() || {};
  // Detect stuck propeller across successive samples
  const phase = l.prop_spin_phase;
  if (phase != null) {
    if (_lastPropPhase === phase) _propStaleFrames++;
    else { _propStaleFrames = 0; _lastPropPhase = phase; }
  }
  const propStuck = (l.prop_count > 0) && (_propStaleFrames > 6) && (l.throttle > 0.05);

  const tele = {
    spd_kts: l.spd_kts?.toFixed?.(0),
    alt_ft: l.alt_ft?.toFixed?.(0),
    agl_ft: l.agl_ft?.toFixed?.(0),
    vs_ft_min: l.vs_ft_min?.toFixed?.(0),
    hdg_deg: l.hdg_deg?.toFixed?.(0),
    pitch_deg: l.pitch_deg?.toFixed?.(1),
    roll_deg: l.roll_deg?.toFixed?.(1),
    throttle_pct: (l.throttle * 100)?.toFixed?.(0),
    gear: l.gear > 0.7 ? 'down' : (l.gear < 0.3 ? 'up' : 'moving'),
    crashed: !!l.crashed,
    on_ground: !!l.on_ground,
    fixed_gear: !!l.fixed_gear,
    prop_count: l.prop_count ?? 0,
    prop_spin_phase: phase,
    prop_stuck: propStuck,   // reliable "prop not spinning" signal
  };
  return [
    { type: 'text', text:
      `STATUS: ${liveStatus}\n` +
      `LIVE TELEMETRY: ${JSON.stringify(tele)}\n` +
      `Your screen right now:` },
    frame,
  ];
}

function actionLabel(a) {
  if (!a) return 'noop';
  const keyStr = Array.isArray(a.keys) && a.keys.length
    ? a.keys.join('+').replace(/(Left|Right)$/g, '').replace(/^Key/, '')
    : (a.key || '').replace(/(Left|Right)$/g, '').replace(/^Key/, '');
  switch (a.type) {
    case 'press': return `HOLD ${keyStr} ${a.hold_ms || 600}ms`;
    case 'tap':   return `TAP ${keyStr}`;
    case 'click': return 'CLICK';
    case 'wait':  return `WAIT ${a.ms || 800}ms`;
    case 'reset': return 'RESET (R)';
    default:      return a.type || '?';
  }
}

// ——— On-screen panel ———
async function setStatus(update) {
  const js = `(() => {
    let el = document.getElementById('__ap_thoughts');
    if (!el) {
      el = document.createElement('div');
      el.id = '__ap_thoughts';
      el.style.cssText = [
        // Center-docked: leave left HUD (~240px) and right throttle/style
        // panel (~200px) visible so the AI can read its own telemetry from
        // the screenshot.
        'position:fixed','top:6px','left:260px','right:260px',
        'background:rgba(8,14,25,0.78)',
        'color:#cfe3ff','border:1px solid #2a4060','border-radius:6px',
        'font:12px/1.45 ui-monospace,Menlo,monospace',
        'padding:8px 14px 10px','z-index:9998',
        'pointer-events:none','backdrop-filter:blur(6px)',
        'max-height:38vh','overflow:hidden'
      ].join(';');
      el.innerHTML = [
        '<div style="display:flex;gap:14px;align-items:baseline;margin-bottom:5px;">',
          '<span style="color:#4ecbff;font-weight:600;letter-spacing:0.2em;">🤖 AUTOPILOT</span>',
          '<span id="__ap_iter" style="color:#6a7fa0;font-size:11px;"></span>',
          '<span id="__ap_stage" style="color:#ffd27a;font-weight:600;"></span>',
          '<span id="__ap_phase" style="color:#5df09a;font-weight:600;margin-left:auto;"></span>',
          '<span id="__ap_action" style="color:#ff9d4e;font-weight:600;"></span>',
        '</div>',
        '<div style="font-size:10px;color:#6a7fa0;letter-spacing:0.15em;margin-bottom:4px;">STAGE GOAL: <span id="__ap_goal" style="color:#ffd27a;letter-spacing:0;"></span></div>',
        '<div id="__ap_progress" style="display:flex;gap:3px;margin-bottom:6px;"></div>',
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
    set('__ap_stage', u.stage);
    set('__ap_goal', u.goal);
    set('__ap_obs', u.observe);
    set('__ap_why', u.reasoning);
    set('__ap_plan', u.strategy);
    if (u.progress != null) {
      const p = el.querySelector('#__ap_progress');
      p.innerHTML = u.progress.map(s => {
        const col = s.mastered ? '#5df09a' : (s.current ? '#ffd27a' : '#2a4060');
        const bg = s.mastered ? 'rgba(93,240,154,0.2)' : (s.current ? 'rgba(255,210,122,0.2)' : 'transparent');
        return '<span title="' + s.name + '" style="flex:1;height:6px;background:'+bg+';border:1px solid '+col+';border-radius:2px;"></span>';
      }).join('');
    }
    if (u.learnings != null) {
      const box = el.querySelector('#__ap_learnings');
      box.innerHTML = u.learnings.map(l =>
        '<span style="display:inline-block;background:rgba(93,240,154,0.1);border:1px solid #2a5040;border-radius:3px;padding:1px 6px;margin:1px 4px 1px 0;"><b style="color:#5df09a;">' + l.k + '</b> <span style="color:#a8bcd8;">' + l.v + '</span></span>'
      ).join('');
    }
    if (u.recent != null) {
      const r = el.querySelector('#__ap_recent');
      r.innerHTML = '<b style="color:#6a7fa0;">recent:</b> ' + u.recent.map(x => '<span style="color:#cfe3ff;">· ' + x + '</span>').join(' ');
    }
    "ok";
  })()`;
  await evalPage(js).catch(() => {});
}

// ——— Action executor ———
async function executeAction(a, skills) {
  const t = (a && a.type) || 'wait';
  const step = { action: a, t0: Date.now() };
  let effect = '';
  try {
    switch (t) {
      case 'press': {
        // Accept either single `key` or an array `keys` for simultaneous
        // holds (e.g. Shift+S for throttle-up + pitch-up during takeoff).
        const keyList = Array.isArray(a.keys) ? a.keys : (a.key ? [a.key] : []);
        const codes = keyList.map(toCode).filter(Boolean);
        if (!codes.length) { effect = 'bad key'; break; }
        const ms = Math.max(80, a.hold_ms || 400);
        for (const c of codes) await keyDown(c);
        await sleep(Math.min(MAX_HOLD_MS, ms));
        for (const c of codes) await keyUp(c);
        effect = codes.length > 1
          ? `held ${codes.join('+')} for ${ms}ms`
          : `held ${codes[0]} for ${ms}ms`;
        break;
      }
      case 'tap': {
        const keyList = Array.isArray(a.keys) ? a.keys : (a.key ? [a.key] : []);
        const codes = keyList.map(toCode).filter(Boolean);
        if (!codes.length) { effect = 'bad key'; break; }
        for (const c of codes) await keyDown(c);
        await sleep(90);
        for (const c of codes) await keyUp(c);
        effect = `tapped ${codes.join('+')}`;
        break;
      }
      case 'start':
      case 'click': {
        // Force-dismiss any intro overlay and resume the sim. Click is a
        // fallback so the AI can never get stuck on the start screen.
        await dismissIntro();
        await run('click', 'body');
        effect = 'dismissed intro / clicked canvas';
        break;
      }
      case 'wait':  { await sleep(Math.min(4000, a.ms || 600)); effect = `waited ${a.ms || 600}ms`; break; }
      case 'reset': { await resetPlane(); skills.resets++; effect = 'reset plane'; break; }
      case 'done':  { effect = 'done (IGNORED — only coordinator can end stages)'; break; }
      default:      effect = 'unknown action';
    }
  } catch (e) { effect = 'error: ' + e.message; }
  step.effect = effect;
  skills.recent_actions.push(step);
  if (skills.recent_actions.length > 20) skills.recent_actions.shift();
  return effect;
}

// ——— World-state loader (for designer → pilot sync) ———
function readWorldRevision() {
  if (!existsSync(WORLD_PATH)) return 0;
  try { return JSON.parse(readFileSync(WORLD_PATH, 'utf8')).revision || 0; } catch { return 0; }
}
function writeWorldRevision(rev, note) {
  let cur = {};
  if (existsSync(WORLD_PATH)) { try { cur = JSON.parse(readFileSync(WORLD_PATH, 'utf8')); } catch {} }
  cur.revision = rev;
  cur.note = note;
  cur.updated = new Date().toISOString();
  writeFileSync(WORLD_PATH, JSON.stringify(cur, null, 2));
}

// ——— Feature request channel ———
function appendRequest(kind, text, currentStage) {
  let cur = { pending: [], resolved: [] };
  if (existsSync(REQUESTS_PATH)) {
    try { cur = JSON.parse(readFileSync(REQUESTS_PATH, 'utf8')); } catch {}
  }
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  cur.pending = cur.pending || [];
  cur.pending.push({ id, kind, text, stage: currentStage, at: new Date().toISOString() });
  // Dedup pending against recent text
  const seen = new Set();
  cur.pending = cur.pending.filter(r => {
    const k = r.kind + ':' + r.text.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  writeFileSync(REQUESTS_PATH, JSON.stringify(cur, null, 2));
}

// ——— Main loop ———
(async () => {
  console.log(`[autopilot] booting · model=${MODEL}`);
  console.log(`[autopilot] target=${TARGET_URL}`);
  console.log(`[autopilot] notebook=${SKILLS_PATH}`);

  // Preflight: is the server actually up?
  try {
    const url = new URL(TARGET_URL);
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`${url.protocol}//${url.host}/flight-sim3.html`, { signal: ctrl.signal });
    clearTimeout(to);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log(`[autopilot] ✓ server reachable at ${url.host}`);
  } catch (e) {
    console.error(`[autopilot] ✗ cannot reach ${TARGET_URL}: ${e.message}`);
    console.error(`[autopilot]   start the server first, e.g.:`);
    console.error(`[autopilot]     npx serve -l 55073 .            # in another terminal`);
    console.error(`[autopilot]   or run the orchestrator which handles it:`);
    console.error(`[autopilot]     node self-evolve.mjs`);
    process.exit(1);
  }

  console.log('[autopilot] closing any stale browser sessions...');
  await run('close', '--all').catch(() => {});

  // Window placement — configurable via env so you can stream from any
  // screen without editing code.
  //   BROWSER_POS     "x,y"       e.g. "3024,0" for second screen on right
  //   BROWSER_SIZE    "w,h"       e.g. "1600,1000"
  //   SECOND_SCREEN   "1"          shortcut: primary-right external @ 1920x1080
  const chromeArgs = [];
  let pos = process.env.BROWSER_POS;
  let size = process.env.BROWSER_SIZE;
  if (process.env.SECOND_SCREEN === '1' && !pos) {
    // macOS reports the main display x=0..primaryWidth. An external screen
    // to the right starts at x=primaryWidth. Default MBP retina is ~3024.
    pos  = process.env.MAIN_WIDTH ? `${process.env.MAIN_WIDTH},0` : '3024,0';
    size = size || '1600,1000';
  }
  if (pos)  chromeArgs.push(`--window-position=${pos}`);
  if (size) chromeArgs.push(`--window-size=${size}`);
  if (chromeArgs.length) console.log('[autopilot] chrome args:', chromeArgs.join(' '));

  console.log(`[autopilot] opening ${TARGET_URL} (headed)...`);
  const openArgs = ['open', TARGET_URL, '--headed'];
  if (chromeArgs.length) openArgs.push('--args', chromeArgs.join(','));
  await run(...openArgs);
  await sleep(2500);

  console.log('[autopilot] waiting for window.__ap bridge...');
  const bridgeOk = await waitForBridge();
  if (!bridgeOk) {
    console.error('[autopilot] bridge never attached. Is flight-sim3.html serving correctly?');
    process.exit(1);
  }
  console.log('[autopilot] ✓ bridge attached, dismissing intro overlay...');
  await dismissIntro();
  console.log('[autopilot] ✓ game is live, entering main loop');

  // Launch background telemetry poller
  const poller = pollTelemetry();

  const skills = loadSkills();
  skills.iterations = 0; skills.recent_actions = [];
  if (!skills.stages_mastered) skills.stages_mastered = [];
  if (!skills.current_stage) skills.current_stage = 'takeoff';

  let lastWorldRev = readWorldRevision();
  let statusNote = 'just spawned — intro overlay may be present';

  for (let i = 0; i < MAX_ITERS; i++) {
    skills.iterations = i + 1;

    // Auto-reload if the world designer bumped the revision
    const worldRev = readWorldRevision();
    if (worldRev > lastWorldRev) {
      console.log(`\n[autopilot] world revision bumped ${lastWorldRev}→${worldRev}, reloading`);
      await run('reload');
      await sleep(2500);
      await waitForBridge();
      await dismissIntro();
      lastWorldRev = worldRev;
      statusNote = `world was updated to revision ${worldRev} — intro auto-dismissed, game is live`;
    }

    // Evaluate curriculum on every iteration, BEFORE asking the AI
    const stageIdx = CURRICULUM.findIndex(s => s.id === skills.current_stage);
    const stage = CURRICULUM[stageIdx];
    if (stage) {
      const result = stage.check();
      if (result.passed) {
        skills.stages_mastered.push(stage.id);
        console.log(`\n🎉 [coordinator] STAGE MASTERED: ${stage.name} ${result.note ? '('+result.note+')' : ''}`);
        // Snapshot a playbook for this stage from the last 12 actions and
        // observations so the next stage starts with concrete "what
        // worked" notes in the prompt rather than 300 lines of narration.
        try {
          const recentObs = clusterObservations(skills.observations.slice(-40), 1, 6)
            .slice(0, 6);
          const recentActs = (skills.recent_actions || []).slice(-10)
            .map(a => actionLabel(a.action));
          skills.stage_playbooks[stage.id] = {
            passed_at_iter: skills.iterations,
            note: result.note || '',
            key_observations: recentObs,
            action_shape: recentActs,
          };
        } catch {}
        const next = CURRICULUM[stageIdx + 1];
        if (next) {
          skills.current_stage = next.id;
          statusNote = `STAGE PASSED: ${stage.name}. NEW STAGE: ${next.name} — ${next.goal}`;
        } else {
          console.log('\n✈️  [coordinator] ALL STAGES MASTERED. Pilot is ace.');
          skills.current_stage = 'ace';
          saveSkills(skills);
          break;
        }
      }
    }

    // Paint the panel with progress
    const progress = CURRICULUM.map(s => ({
      name: s.name,
      mastered: skills.stages_mastered.includes(s.id),
      current: s.id === skills.current_stage,
    }));
    await setStatus({ phase: 'THINKING…', action: '', iter: `iter ${i+1}/${MAX_ITERS}`,
      stage: CURRICULUM.find(s=>s.id===skills.current_stage)?.name || skills.current_stage,
      goal: CURRICULUM.find(s=>s.id===skills.current_stage)?.goal || '',
      progress });

    await run('screenshot', FRAME_PATH);

    const user = buildUserMessage(skills, encodeImage(FRAME_PATH), statusNote);
    let parsed;
    try {
      const reply = await askLLM([
        { role: 'system', content: buildSystem(skills) },
        { role: 'user', content: user },
      ]);
      parsed = parseLLM(reply);
    } catch (e) {
      console.error('[llm]', e.message);
      await sleep(1200);
      continue;
    }

    console.log(`\n[iter ${i+1}] ${skills.current_stage} · obs: ${parsed.observe}`);
    console.log(`          act: ${JSON.stringify(parsed.action)}`);
    if (parsed.reasoning) console.log(`          why: ${parsed.reasoning}`);

    const u = parsed.notebook_updates || {};
    if (u.control_map && typeof u.control_map === 'object') Object.assign(skills.control_map, u.control_map);
    if (Array.isArray(u.observations)) {
      for (const o of u.observations) if (typeof o === 'string') skills.observations.push(o);
      // Cluster on every write so the notebook stays meaningful instead
      // of becoming 300 near-duplicates.
      if (skills.observations.length > 60) {
        skills.observations = clusterObservations(skills.observations, 2, 60);
      }
    }
    if (typeof u.strategy === 'string') skills.strategy = u.strategy;

    // Pipe feature requests / bug reports to the world designer
    if (typeof parsed.feature_request === 'string' && parsed.feature_request.trim()) {
      appendRequest('feature', parsed.feature_request.trim(), skills.current_stage);
      console.log(`[pilot→designer] FEATURE: ${parsed.feature_request.trim()}`);
    }
    if (typeof parsed.bug_report === 'string' && parsed.bug_report.trim()) {
      appendRequest('bug', parsed.bug_report.trim(), skills.current_stage);
      console.log(`[pilot→designer] BUG: ${parsed.bug_report.trim()}`);
    }

    const learnings = Object.entries(skills.control_map).slice(-12)
      .map(([k, v]) => ({ k: k.replace(/^Key/, ''), v: String(v).slice(0, 36) }));
    const recent = skills.observations.slice(-3).map(o => String(o).slice(0, 80));
    await setStatus({
      phase: 'ACTING', action: `▶ ${actionLabel(parsed.action)}`,
      iter: `iter ${i+1}/${MAX_ITERS} · crashes ${skills.crashes} · resets ${skills.resets}`,
      stage: CURRICULUM.find(s=>s.id===skills.current_stage)?.name || skills.current_stage,
      goal: CURRICULUM.find(s=>s.id===skills.current_stage)?.goal || '',
      observe: parsed.observe || '', reasoning: parsed.reasoning || '',
      strategy: skills.strategy || '', progress, learnings, recent,
    });

    const effect = await executeAction(parsed.action, skills);
    await sleep(ACT_DURATION_MS);

    const l = latest();
    if (l) {
      skills.session_best.max_altitude = Math.max(skills.session_best.max_altitude || 0, l.alt_ft);
      skills.session_best.max_speed    = Math.max(skills.session_best.max_speed    || 0, l.spd_kts);
      if (l.crashed) {
        skills.crashes++;
        statusNote = `CRASHED (alt=${l.alt_ft.toFixed(0)}ft spd=${l.spd_kts.toFixed(0)}kts). You must reset with R.`;
      } else {
        statusNote = `alive · spd=${l.spd_kts.toFixed(0)}kts alt=${l.alt_ft.toFixed(0)}ft vs=${l.vs_ft_min.toFixed(0)} ` +
                     `hdg=${l.hdg_deg.toFixed(0)}° roll=${l.roll_deg.toFixed(0)}° pitch=${l.pitch_deg.toFixed(0)}° ` +
                     `thr=${(l.throttle*100).toFixed(0)}% · effect=${effect}`;
      }
    }
    saveSkills(skills);
  }

  polling = false;
  await poller.catch(()=>{});
  console.log('\n[autopilot] session complete.');
  console.log('[autopilot] mastered:', skills.stages_mastered.join(', ') || '(none)');
})().catch(err => { console.error('[autopilot] fatal:', err); process.exit(1); });
