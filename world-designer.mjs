#!/usr/bin/env node
// =============================================================
//  WORLD DESIGNER · Builder Agent
// =============================================================
//  Runs in parallel with the pilot. Reads the pilot's progress,
//  feature requests, and bug reports. Modifies flight-sim3.html
//  to add obstacles, features, and challenges. Maintains a backup
//  and syntax-checks every change. Rolls back on failure.
//
//  The pilot has its own browser window; when this agent bumps
//  the revision in world-state.json, the pilot reloads to pick
//  up the new world.
//
//  Safety guardrails:
//  - Never modify the `window.__ap` bridge (pilot depends on it)
//  - Never modify physics (makeJet, updatePhysics) without explicit ask
//  - Always keep a .bak of the last known-good HTML
//  - Every patch must pass `new Function(code)` syntax check
//  - If syntax check fails → revert, mark attempt failed, try a
//    different idea
// =============================================================

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import path from 'node:path';

const exec = promisify(execFile);

// ——— Config ———
const HTML_PATH      = path.resolve(process.cwd(), 'flight-sim3.html');
const HTML_BACKUP    = path.resolve(process.cwd(), 'flight-sim3.html.bak');
const SKILLS_PATH    = path.resolve(process.cwd(), 'autopilot-skills.json');
const WORLD_PATH     = path.resolve(process.cwd(), 'world-state.json');
const REQUESTS_PATH  = path.resolve(process.cwd(), 'feature-requests.json');
const BUILD_LOG_PATH = path.resolve(process.cwd(), 'build-log.json');

const MODEL    = 'accounts/fireworks/models/kimi-k2p5';
const API_URL  = 'https://api.fireworks.ai/inference/v1/chat/completions';
const API_KEY  = process.env.FIREWORKS_API_KEY;
const POLL_MS  = 15_000;           // how often to check for work
const MAX_BUILDS = 30;

if (!API_KEY) { console.error('[designer] FIREWORKS_API_KEY is not set.'); process.exit(1); }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ——— State files ———
function readJSON(p, fallback = null) {
  if (!existsSync(p)) return fallback;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; }
}
function writeJSON(p, v) { writeFileSync(p, JSON.stringify(v, null, 2)); }

function readPilotSkills() { return readJSON(SKILLS_PATH, { stages_mastered: [], current_stage: 'takeoff' }); }
function readRequests()    { return readJSON(REQUESTS_PATH, { pending: [], resolved: [] }); }
function readBuildLog()    { return readJSON(BUILD_LOG_PATH, { builds: [] }); }
function writeBuildLog(l)  { writeJSON(BUILD_LOG_PATH, l); }
function readWorld()       { return readJSON(WORLD_PATH, { revision: 0, features: [] }); }
function writeWorld(w)     { writeJSON(WORLD_PATH, w); }

// ——— HTML backup + syntax check ———
function ensureBackup() {
  if (!existsSync(HTML_BACKUP)) {
    copyFileSync(HTML_PATH, HTML_BACKUP);
    console.log('[designer] created backup:', HTML_BACKUP);
  }
}
function restoreBackup() {
  copyFileSync(HTML_BACKUP, HTML_PATH);
  console.log('[designer] reverted to backup');
}
function checkHtmlSyntax(html) {
  // Extract every inline <script>...</script> and try new Function on each
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let m, idx = 0;
  while ((m = re.exec(html)) != null) {
    idx++;
    const src = m[1].trim();
    if (!src) continue;
    try { new Function(src); }
    catch (e) { return { ok: false, error: `script #${idx}: ${e.message}` }; }
  }
  return { ok: true };
}

// ——— Curriculum-aware feature catalog ———
// Auto-generated ideas based on the stage the pilot is working on.
// Each is a natural-language spec for the LLM to implement.
const STAGE_FEATURES = {
  takeoff: [
    'Paint large runway-end markers (a striped threshold stripe and 4 corner cone pylons) at z=-150 and z=+150 on the airstrip so the pilot can see the runway clearly. Pure visual — no physics.',
  ],
  climb: [
    'Add three floating ring gates at (x=0, y=60, z=-400), (x=0, y=150, z=-800), (x=0, y=250, z=-1200). Rings are 30m radius, bright magenta torus, glowing. No physics. They mark a climbing corridor.',
  ],
  cruise: [
    'Add a chain of 6 floating ring gates at cruise altitude (y=180) arranged in a gentle S-curve extending from z=-1200 to z=-3000, each 28m radius, alternating cyan and magenta colors.',
  ],
  turn_left: [
    'Add two ring gates positioned to force a left turn: one ahead at (x=0, y=180, z=-800), one at (x=-900, y=180, z=-1400) requiring a left bank to reach. 30m radius, orange.',
  ],
  turn_right: [
    'Add two ring gates positioned to force a right turn: one ahead at (x=0, y=180, z=-800), one at (x=+900, y=180, z=-1400). 30m radius, green.',
  ],
  descend: [
    'Add a descending ring corridor: 5 gates from (x=0,y=400,z=-1500) stepping down to (x=0,y=60,z=-3000). 30m radius, yellow.',
  ],
  low_pass: [
    'Add low-altitude slalom poles: 8 vertical pylons 40m tall, alternating left and right of a path along x=0, spaced 200m apart starting at z=-800. The pilot must weave between them.',
  ],
  mountain_buzz: [
    'Add a bright red landing-strip marker painted across a mountain ridge at approximately (x=1500, z=-2500) so the pilot knows where to buzz. Just a large flat rectangle, no physics.',
  ],
  barrel_roll: [
    'Add a large sky ring: a 60m-radius thin gold torus at (x=0, y=600, z=-1500) oriented with its axis along Z, so the pilot must roll through it.',
  ],
  landing: [
    'Add landing-approach lighting: a line of 20 small glowing white spheres leading up to the runway at z > 120, each 1m radius, spaced 25m apart along x=0. Non-solid, purely visual guidance.',
  ],
};

function pickFeatureForPilot(skills, requests, log) {
  // 1) Explicit pilot feature requests take priority
  const pending = (requests.pending || []).filter(r => r.kind === 'feature');
  if (pending.length) return { source: 'pilot_request', request: pending[0] };

  // 2) Pilot bug reports also need attention (but we rarely patch bugs — just log)
  const bugs = (requests.pending || []).filter(r => r.kind === 'bug');
  if (bugs.length) return { source: 'pilot_bug', request: bugs[0] };

  // 3) Stage-driven features — pick based on current stage, skip already-built
  const built = new Set((log.builds || []).map(b => b.feature_key));
  const stage = skills.current_stage || 'takeoff';
  const ideas = STAGE_FEATURES[stage] || [];
  for (const idea of ideas) {
    const key = stage + ':' + idea.slice(0, 80);
    if (!built.has(key)) {
      return { source: 'stage_curriculum', request: { id: 'auto-' + Date.now().toString(36), kind: 'feature', text: idea, stage, at: new Date().toISOString() }, feature_key: key };
    }
  }
  return null;
}

function markRequestResolved(requestId, result) {
  const r = readRequests();
  r.pending = (r.pending || []).filter(x => x.id !== requestId);
  r.resolved = r.resolved || [];
  r.resolved.push({ id: requestId, result, at: new Date().toISOString() });
  if (r.resolved.length > 60) r.resolved = r.resolved.slice(-60);
  writeJSON(REQUESTS_PATH, r);
}

// ——— LLM call ———
async function askLLM(messages, maxTokens = 4000) {
  const body = {
    model: MODEL, max_tokens: maxTokens, temperature: 0.2,
    response_format: { type: 'json_object' }, messages,
  };
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  if (!res.ok) throw new Error('LLM error: ' + JSON.stringify(j).slice(0, 400));
  return j.choices?.[0]?.message?.content ?? '';
}

function parseEdits(text) {
  // Expect { edits: [ { oldText, newText }, ... ], insertion_point?: string, summary: string }
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch {}
  const start = t.indexOf('{'), end = t.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no JSON in designer reply');
  return JSON.parse(t.slice(start, end + 1));
}

// ——— Designer prompt ———
const DESIGNER_SYSTEM = `You are the WORLD DESIGNER for a Three.js browser flight sim.
The game is served from a single HTML file. A pilot AI is learning to fly it.
Your job is to add new world elements, obstacles, and visual markers that help the
pilot progress through its curriculum, and to fulfil specific requests.

STRICT RULES:
1. Output a SINGLE JSON object. No prose outside it. Schema:
   {
     "summary": "one line describing what you're adding",
     "insertion_point_id": "optional marker",
     "edits": [
       { "oldText": "...", "newText": "..." }
     ]
   }
2. oldText must be COPIED EXACTLY from the source HTML. Keep it small (a
   few lines) and UNIQUE. newText is the replacement.
3. NEVER modify the \`window.__ap\` bridge object or any \`plane.\` physics.
4. NEVER modify makeJet, updatePhysics, animate, the GLB-swap block, or the
   autopilot panel (#__ap_thoughts).
5. You can ONLY add: visual meshes (Mesh, Group), materials, instanced
   groups, simple rotations/animations in the animate loop via a small
   helper, and scene.add calls.
6. Put ALL new code inside one insertion region. Choose a unique anchor
   in the existing HTML to attach to \u2014 preferably right before the line
   \`requestAnimationFrame(animate);\` which sits near the end of the inline
   script. Your edit's oldText should include that exact line so we can
   inject cleanly.
7. Three.js revision 128 is loaded globally as THREE. Stick to r128 APIs.
8. Keep the insertion self-contained: guard with a unique marker like
   \`// __world_feature_<id>__\` so later additions can coexist.
9. The plane spawns near (0, 2.3, 120) facing \u2212Z. "Forward down the
   runway" means smaller/more negative Z. The runway extends from around
   z=+150 to z=\u2212150 at x=0.
10. Coordinates: +Y is up (world units = metres, altitude shown on HUD is
    metres * 3.28 = feet). Keep rings/obstacles at sensible altitudes.
11. Materials: use MeshStandardMaterial or MeshBasicMaterial. For "glowing"
    rings, use emissive colour on Standard, or a Basic material with high
    opacity.
12. Do NOT add collision; the game doesn't collide with most objects. These
    are visual guides/targets.
13. Do not reference variables you don't know exist. Safe globals: THREE,
    scene, camera, renderer, plane, jet, getHeight (if available).

If the request is a BUG report, propose a minimal fix only if you are
confident; otherwise return edits: [] and explain in summary.`;

function buildDesignerUserMessage(html, request, skills) {
  return `Pilot progress: mastered=[${(skills.stages_mastered||[]).join(', ')}] current=${skills.current_stage}.

Request (${request.kind}, source=${request.id || '(auto)'}):
${request.text}

Current flight-sim3.html follows (around 3000+ lines). Identify a unique anchor near the END of the inline script — ideally the line \`requestAnimationFrame(animate);\` — and emit an edit with small oldText/newText. The newText should include a unique marker comment so future features can live alongside.

=== BEGIN flight-sim3.html ===
${html}
=== END flight-sim3.html ===

Reply with the JSON edit spec only.`;
}

// ——— Apply edits ———
function applyEdits(html, edits) {
  let out = html;
  for (const e of edits) {
    if (!e.oldText || typeof e.newText !== 'string') return { ok: false, error: 'edit missing oldText/newText' };
    const firstIdx = out.indexOf(e.oldText);
    if (firstIdx === -1) return { ok: false, error: 'oldText not found: ' + e.oldText.slice(0, 120) };
    const lastIdx = out.lastIndexOf(e.oldText);
    if (firstIdx !== lastIdx) return { ok: false, error: 'oldText not unique' };
    out = out.slice(0, firstIdx) + e.newText + out.slice(firstIdx + e.oldText.length);
  }
  return { ok: true, html: out };
}

// ——— Main loop ———
(async () => {
  console.log(`[designer] booting · model=${MODEL}`);
  ensureBackup();

  const log = readBuildLog();
  if (!log.builds) log.builds = [];
  let builds = 0;

  while (builds < MAX_BUILDS) {
    await sleep(POLL_MS);

    const skills = readPilotSkills();
    const requests = readRequests();
    const pick = pickFeatureForPilot(skills, requests, log);
    if (!pick) {
      console.log(`[designer] nothing to build · stage=${skills.current_stage} · mastered=${(skills.stages_mastered||[]).length}`);
      continue;
    }

    const { source, request, feature_key } = pick;
    console.log(`\n[designer] picking up: ${source} · "${request.text.slice(0, 120)}"`);

    const html = readFileSync(HTML_PATH, 'utf8');

    let spec;
    try {
      const reply = await askLLM([
        { role: 'system', content: DESIGNER_SYSTEM },
        { role: 'user', content: buildDesignerUserMessage(html, request, skills) },
      ]);
      spec = parseEdits(reply);
    } catch (e) {
      console.error('[designer] LLM failed:', e.message);
      log.builds.push({ t: new Date().toISOString(), request: request.text, ok: false, error: 'llm: ' + e.message });
      writeBuildLog(log);
      continue;
    }

    if (!spec.edits || !spec.edits.length) {
      console.log('[designer] empty edits returned:', spec.summary || '(no summary)');
      if (request.id) markRequestResolved(request.id, 'no_edits: ' + (spec.summary || ''));
      continue;
    }

    const applied = applyEdits(html, spec.edits);
    if (!applied.ok) {
      console.error('[designer] apply failed:', applied.error);
      log.builds.push({ t: new Date().toISOString(), request: request.text, ok: false, error: 'apply: ' + applied.error, spec });
      writeBuildLog(log);
      continue;
    }

    const syn = checkHtmlSyntax(applied.html);
    if (!syn.ok) {
      console.error('[designer] syntax check failed:', syn.error);
      log.builds.push({ t: new Date().toISOString(), request: request.text, ok: false, error: 'syntax: ' + syn.error, spec });
      writeBuildLog(log);
      continue;
    }

    // Write and bump revision
    writeFileSync(HTML_PATH, applied.html);
    const world = readWorld();
    world.revision = (world.revision || 0) + 1;
    world.features = world.features || [];
    world.features.push({
      revision: world.revision,
      summary: spec.summary || request.text,
      source, stage: skills.current_stage,
      at: new Date().toISOString(),
    });
    writeWorld(world);

    log.builds.push({
      t: new Date().toISOString(),
      request: request.text,
      source, stage: skills.current_stage,
      revision: world.revision,
      ok: true,
      summary: spec.summary || '',
      feature_key,
    });
    writeBuildLog(log);

    if (request.id) markRequestResolved(request.id, `built @ rev${world.revision}`);

    console.log(`✅ [designer] built @ rev${world.revision}: ${spec.summary || request.text.slice(0, 80)}`);
    builds++;

    // Give the pilot time to reload + test before next build
    await sleep(20_000);
  }

  console.log('\n[designer] done. built', builds, 'features.');
})().catch(err => { console.error('[designer] fatal:', err); process.exit(1); });
