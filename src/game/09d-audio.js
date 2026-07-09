// @module src/game/09d-audio.js
// =============================================================
//  SOUND — WebAudio + online CC0 prop-engine sample (engine, wind, warnings)
// =============================================================
const PROP_ENGINE_SAMPLE = {
  // Candidate URLs tried in order — first one whose decoded audio is
  // long enough to loop cleanly wins. `prop-flying-*` are ~30s sustained
  // clips that loop seamlessly; the shorter "engine-noise" ones are fall-backs.
  urls: [
    'audio/engine/prop-flying-1.wav',
    'audio/engine/prop-flying-2.wav',
    'audio/engine/prop-flying-3.wav',
    'audio/engine/prop-flying-4.wav',
    'audio/engine/prop-engine-noise-3.wav',
    'audio/engine/prop-engine-noise-4.wav',
    'audio/engine/isolated-plane-noise.wav',
    'audio/engine/light-prop-cruise.wav',
  ],
  title: 'Local prop engine loop',
  author: 'local',
  license: 'project',
};
const PROP_DETAIL_BEDS = {};

// One-shots keyed by event name. Loaded lazily on first trigger; held as
// decoded AudioBuffers and scheduled against the shared audio.master gain
// node so they respect mute + master volume.
const SFX_POOL = {
  urls: {
    'mg-burst':      ['audio/combat/mg-burst-1.wav', 'audio/combat/mg-burst-2.wav'],
    'mg-hit':        ['audio/impact/mg-hit-1.wav', 'audio/impact/mg-hit-2.wav', 'audio/impact/mg-hit-3.wav', 'audio/impact/mg-hit-4.wav'],
    'explosion':     ['audio/impact/explosion-big.wav'],
    'dogfight':      ['audio/combat/dogfight-1.wav', 'audio/combat/dogfight-2.wav', 'audio/combat/dogfight-3.wav'],
  },
  buffers: {},   // event → AudioBuffer[]
  loading: {},   // event → Promise
  lastPlayAt: {}, // event → perf.now(), for throttling (gun bursts etc)
};

// Load the buffers for a given SFX event the first time it's needed.
// Fetch is done via the same origin so cache + mime handling "just works"
// through tweaks-server.mjs. Errors are logged once and the event goes
// dormant (returns null from playSfx) rather than hard-failing.
async function loadSfxEvent(event) {
  if (!audio.ctx) return null;
  if (SFX_POOL.buffers[event]) return SFX_POOL.buffers[event];
  if (SFX_POOL.loading[event]) return SFX_POOL.loading[event];
  const urls = SFX_POOL.urls[event] || [];
  if (!urls.length) return null;
  const p = (async () => {
    const out = [];
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arr = await res.arrayBuffer();
        const buf = await new Promise((resolve, reject) =>
          audio.ctx.decodeAudioData(arr, resolve, reject));
        out.push(buf);
      } catch (err) {
        console.warn(`[sfx] ${event} "${url}" failed:`, err && err.message || err);
      }
    }
    SFX_POOL.buffers[event] = out;
    return out;
  })();
  SFX_POOL.loading[event] = p;
  return p;
}

// Fire-and-forget one-shot playback. `opts`:
//   volume (0..1, default 1), rate (playbackRate, default 1),
//   throttleMs (skip if same event played within this window),
//   variantIndex (pick a specific variant; otherwise random),
//   maxMs (optionally cap playback length with a short fade-out).
function playSfx(event, opts = {}) {
  if (!audio.ctx || !audio.enabled) return;
  const now = performance.now();
  const last = SFX_POOL.lastPlayAt[event] || 0;
  if (opts.throttleMs && (now - last) < opts.throttleMs) return;
  const buffers = SFX_POOL.buffers[event];
  if (!buffers) {
    // Kick off loading; caller can retry next event.
    loadSfxEvent(event);
    return;
  }
  if (!buffers.length) return;
  SFX_POOL.lastPlayAt[event] = now;
  const buf = (opts.variantIndex != null)
    ? buffers[opts.variantIndex % buffers.length]
    : buffers[(Math.random() * buffers.length) | 0];
  const src = audio.ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = opts.rate || 1;
  const g = audio.ctx.createGain();
  const baseVol = opts.volume != null ? opts.volume : 1;
  const ct = audio.ctx.currentTime;
  g.gain.setValueAtTime(baseVol, ct);
  let panner = null;
  if (opts.pan != null && typeof audio.ctx.createStereoPanner === 'function') {
    panner = audio.ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, opts.pan));
    src.connect(g).connect(panner).connect(audio.master);
  } else {
    src.connect(g).connect(audio.master);
  }
  src.start();

  if (opts.maxMs) {
    const maxSec = Math.max(0.02, opts.maxMs / 1000);
    const fadeSec = Math.min(0.04, maxSec * 0.45);
    g.gain.setValueAtTime(baseVol, ct + Math.max(0, maxSec - fadeSec));
    g.gain.linearRampToValueAtTime(0.0001, ct + maxSec);
    try { src.stop(ct + maxSec + 0.005); } catch {}
  }

  // Clean up when done
  src.onended = () => { try { src.disconnect(); g.disconnect(); if (panner) panner.disconnect(); } catch {} };
}

// Spatial one-shot: distance attenuation + equal-power stereo pan from the
// camera, routed through the shared playSfx pool so throttle/cleanup are reused.
// opts.radialVel (m/s, +=receding) optionally shifts pitch +/-8% for doppler.
const _sfx3DCam = new THREE.Vector3();
const _sfx3DLocal = new THREE.Vector3();
function playSfx3D(event, worldPos, opts = {}) {
  if (!audio.ctx || !audio.enabled || !worldPos) return;
  camera.getWorldPosition(_sfx3DCam);
  const dist = _sfx3DCam.distanceTo(worldPos);
  const baseVol = (opts.volume != null ? opts.volume : 1) / (1 + dist / 220);
  if (baseVol < 0.02) return;
  _sfx3DLocal.copy(worldPos);
  camera.worldToLocal(_sfx3DLocal);
  const pan = Math.max(-1, Math.min(1, _sfx3DLocal.x / Math.max(1, dist)));
  let rate = opts.rate || 1;
  if (opts.radialVel) rate *= Math.max(0.92, Math.min(1.08, 1 - opts.radialVel / 343));
  playSfx(event, { ...opts, volume: baseVol, rate, pan });
}

const audio = {
  ctx: null, enabled: false, master: null,
  engineGain: null, engineFilter: null,
  engineOsc: null, engineOscGain: null,
  windGain: null,
  lockToneOsc: null,
  lockToneGain: null,
  lockCueAt: 0,
  // Prop engine is an AudioBufferSourceNode (web-audio-native loop with
  // loopStart/loopEnd trimming so the seam is silent). No HTMLAudioElement.
  propBuffer: null,
  propBufferNode: null,
  propPlaybackRate: 1,
  propSampleLoading: false,
  propSampleGain: null,
  propSampleFilter: null,
  propSampleHighpass: null,
  propSampleReady: false,
  propSampleMode: 'none',
  engineSampleLabel: 'synth',
  propDetailBeds: {},
  propTextureBlend: 0,
};

// Crash-replay theme — intentionally disabled (was `final.mp3` on impact).
// Keep the stub so call sites in the replay path stay safe no-ops.
const crashFinalMusic = {
  el: null,
  source: null,
  routed: false,
  triggered: false,
  unavailable: true,
  warnedUnavailable: false,
  warnUnavailable() {},
  ensure() { return null; },
  routeThroughMaster() {},
  play() {
    // No crash music — user preference. Replay still runs silently.
    this.triggered = true;
  },
  stop() {
    this.triggered = false;
  },
};

function isPropAirframe() {
  return typeof plane !== 'undefined' && !!((plane.props && plane.props.length) || plane.suppressJetFX);
}

function propLoopShouldPlay(forcePlay = false) {
  const alive = !(typeof plane !== 'undefined' && plane.crashed);
  const parked = plane && plane.onGround && plane.throttle < 0.02 && plane.throttleTarget < 0.02
    && (!plane.vel || plane.vel.length() < 2);
  return !!(audio.enabled && alive && !parked && (forcePlay || isPropAirframe()));
}

// Engine loop — decoded into an AudioBuffer and played via
// AudioBufferSourceNode with `loop = true` + `loopStart/loopEnd` trimmed
// to the sustain portion (skipping attack + release). This avoids the
// "pop" an HTMLAudioElement emits at the loop seam, and lets us modulate
// playbackRate cleanly with engine RPM.
function syncPropSamplePlayback(forcePlay = false) {
  const shouldPlay = propLoopShouldPlay(forcePlay);
  if (shouldPlay && audio.propSampleReady && !audio.propBufferNode) {
    startPropBuffer();
  } else if (!shouldPlay && audio.propBufferNode) {
    stopPropBuffer();
  }
  syncPropDetailBeds(forcePlay, shouldPlay);
}

function startPropBuffer() {
  if (!audio.ctx || !audio.propBuffer || audio.propBufferNode) return;
  const src = audio.ctx.createBufferSource();
  src.buffer = audio.propBuffer;
  src.loop = true;
  // Trim 10% off each end so we loop only the sustain. Works for clips
  // with fade-in/out as well as clean sustained drones.
  const dur = audio.propBuffer.duration;
  src.loopStart = dur * 0.10;
  src.loopEnd   = dur * 0.90;
  src.playbackRate.value = audio.propPlaybackRate || 1;
  src.connect(audio.propSampleGain);
  src.start(0, src.loopStart);
  audio.propBufferNode = src;
}

function stopPropBuffer() {
  if (!audio.propBufferNode) return;
  try { audio.propBufferNode.stop(0); } catch {}
  try { audio.propBufferNode.disconnect(); } catch {}
  audio.propBufferNode = null;
}

function ensurePropDetailGraph(name) {
  const cfg = PROP_DETAIL_BEDS[name];
  if (!cfg) return null;
  if (audio.propDetailBeds[name] && audio.propDetailBeds[name].gain) return audio.propDetailBeds[name];
  const hp = audio.ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = cfg.highpass;
  const lp = audio.ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = cfg.lowpass;
  lp.Q.value = 0.7;
  const gain = audio.ctx.createGain();
  gain.gain.value = 0;
  hp.connect(lp).connect(gain).connect(audio.master);
  const state = audio.propDetailBeds[name] || {};
  Object.assign(state, { highpass: hp, filter: lp, gain, ready: false, loading: false, buffer: null, node: null, playbackRate: 1 });
  audio.propDetailBeds[name] = state;
  return state;
}

function startPropDetailBed(name) {
  const bed = audio.propDetailBeds[name];
  if (!audio.ctx || !bed || !bed.buffer || bed.node) return;
  const src = audio.ctx.createBufferSource();
  src.buffer = bed.buffer;
  src.loop = true;
  const dur = bed.buffer.duration;
  src.loopStart = dur * 0.08;
  src.loopEnd = dur * 0.92;
  src.playbackRate.value = bed.playbackRate || 1;
  src.connect(bed.highpass);
  src.start(0, src.loopStart);
  bed.node = src;
}

function stopPropDetailBed(name) {
  const bed = audio.propDetailBeds[name];
  if (!bed || !bed.node) return;
  try { bed.node.stop(0); } catch {}
  try { bed.node.disconnect(); } catch {}
  bed.node = null;
}

async function ensurePropDetailBed(name) {
  if (!audio.ctx) return;
  const cfg = PROP_DETAIL_BEDS[name];
  if (!cfg) return;
  const bed = ensurePropDetailGraph(name);
  if (!bed || bed.buffer || bed.loading) return;
  bed.loading = true;
  for (const url of cfg.urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arr = await res.arrayBuffer();
      const buf = await new Promise((resolve, reject) => audio.ctx.decodeAudioData(arr, resolve, reject));
      if (buf.duration < 0.8) continue;
      bed.buffer = buf;
      bed.ready = true;
      bed.loading = false;
      if (propLoopShouldPlay()) startPropDetailBed(name);
      return;
    } catch (err) {
      console.warn(`[audio] detail ${name} ${url} failed:`, err && err.message || err);
    }
  }
  bed.loading = false;
}

function syncPropDetailBeds(forcePlay = false, shouldPlay = propLoopShouldPlay(forcePlay)) {
  for (const name of Object.keys(PROP_DETAIL_BEDS)) {
    const bed = audio.propDetailBeds[name];
    if (!bed) continue;
    if (shouldPlay && bed.ready && !bed.node) startPropDetailBed(name);
    else if (!shouldPlay && bed.node) stopPropDetailBed(name);
  }
}

async function ensurePropEngineSample() {
  if (!audio.ctx || audio.propBuffer || audio.propSampleLoading) return;
  audio.propSampleLoading = true;
  audio.engineSampleLabel = 'loading';

  // Build the filter chain once (reused per buffer node restart)
  if (!audio.propSampleGain) {
    const hp = audio.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 55;
    const lp = audio.ctx.createBiquadFilter();
    lp.type = 'lowpass';  lp.frequency.value = 1400; lp.Q.value = 0.5;
    const gain = audio.ctx.createGain();
    gain.gain.value = 0;
    hp.connect(lp).connect(gain).connect(audio.master);
    audio.propSampleHighpass = hp;
    audio.propSampleFilter = lp;
    audio.propSampleGain = gain;
    audio.propSampleMode = 'buffer-node';
  }

  const urls = PROP_ENGINE_SAMPLE.urls || [PROP_ENGINE_SAMPLE.url];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arr = await res.arrayBuffer();
      const buf = await new Promise((resolve, reject) =>
        audio.ctx.decodeAudioData(arr, resolve, reject));
      // Accept any clip ≥ 1s — shorter ones tend to audibly loop
      if (buf.duration < 1.0) {
        console.log(`[audio] skipping ${url} (too short: ${buf.duration.toFixed(2)}s)`);
        continue;
      }
      audio.propBuffer = buf;
      audio.propSampleReady = true;
      audio.engineSampleLabel = url.split('/').pop();
      console.log(`[audio] engine loop loaded: ${audio.engineSampleLabel} (${buf.duration.toFixed(2)}s)`);
      syncPropSamplePlayback(true);
      audio.propSampleLoading = false;
      return;
    } catch (err) {
      console.warn(`[audio] ${url} failed:`, err && err.message || err);
    }
  }
  audio.engineSampleLabel = 'synth-fallback';
  audio.propSampleLoading = false;
}

function initAudio() {
  if (audio.ctx) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  audio.ctx = new Ctx();
  audio.master = audio.ctx.createGain();
  audio.master.gain.value = 0.55;
  // Glue bus: DynamicsCompressor tames stacked-explosion clipping, no per-frame cost.
  const masterComp = audio.ctx.createDynamicsCompressor();
  masterComp.threshold.value = -14;
  masterComp.knee.value = 24;
  masterComp.ratio.value = 5;
  masterComp.attack.value = 0.004;
  masterComp.release.value = 0.18;
  audio.masterComp = masterComp;
  audio.master.connect(masterComp).connect(audio.ctx.destination);

  // Preload the combat + impact SFX so the first gun trigger isn't silent
  // while the fetch+decode happens. Engine audio stays as the continuous
  // hum/loop only, per the latest simplification pass.
  ['mg-burst', 'mg-hit', 'explosion'].forEach(loadSfxEvent);

  // Shared looping noise buffer (2s)
  const sr = audio.ctx.sampleRate;
  const noiseBuf = audio.ctx.createBuffer(1, sr * 2, sr);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  // -- ENGINE: filtered noise (jet roar) + sawtooth tone (turbine whine) --
  const eNoise = audio.ctx.createBufferSource();
  eNoise.buffer = noiseBuf; eNoise.loop = true;
  const eFilt = audio.ctx.createBiquadFilter();
  eFilt.type = 'lowpass';
  eFilt.frequency.value = 350;
  eFilt.Q.value = 1.8;
  const eGain = audio.ctx.createGain();
  eGain.gain.value = 0.05;
  eNoise.connect(eFilt).connect(eGain).connect(audio.master);
  eNoise.start();
  audio.engineGain = eGain;
  audio.engineFilter = eFilt;

  const eOsc = audio.ctx.createOscillator();
  eOsc.type = 'sawtooth';
  eOsc.frequency.value = 65;
  const oFilt = audio.ctx.createBiquadFilter();
  oFilt.type = 'bandpass';
  oFilt.frequency.value = 220;
  oFilt.Q.value = 3;
  const eOscG = audio.ctx.createGain();
  eOscG.gain.value = 0.02;
  eOsc.connect(oFilt).connect(eOscG).connect(audio.master);
  eOsc.start();
  audio.engineOsc = eOsc;
  audio.engineOscGain = eOscG;

  // -- WIND: bandpassed noise scales with airspeed --
  const wNoise = audio.ctx.createBufferSource();
  wNoise.buffer = noiseBuf; wNoise.loop = true;
  const wFilt = audio.ctx.createBiquadFilter();
  wFilt.type = 'bandpass';
  wFilt.frequency.value = 1700;
  wFilt.Q.value = 0.4;
  const wGain = audio.ctx.createGain();
  wGain.gain.value = 0.0;
  wNoise.connect(wFilt).connect(wGain).connect(audio.master);
  wNoise.start();
  audio.windGain = wGain;

  ensurePropEngineSample();
  audio.enabled = true;
  syncPropSamplePlayback();
}

function audioBeep(freq, dur, vol) {
  if (!audio.ctx) return;
  const t = audio.ctx.currentTime;
  const o = audio.ctx.createOscillator();
  o.type = 'square';
  o.frequency.value = freq;
  const g = audio.ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(audio.master);
  o.start(t);
  o.stop(t + dur + 0.05);
}
function stopLockTone() {
  if (!audio.lockToneOsc) return;
  const t = audio.ctx ? audio.ctx.currentTime : 0;
  try {
    if (audio.lockToneGain) {
      audio.lockToneGain.gain.cancelScheduledValues(t);
      audio.lockToneGain.gain.setTargetAtTime(0.0001, t, 0.04);
    }
    audio.lockToneOsc.stop(t + 0.08);
  } catch {}
  audio.lockToneOsc.onended = () => {
    try { if (audio.lockToneOsc) audio.lockToneOsc.disconnect(); } catch {}
    try { if (audio.lockToneGain) audio.lockToneGain.disconnect(); } catch {}
    audio.lockToneOsc = null;
    audio.lockToneGain = null;
  };
}
function ensureLockTone(freq = 1240) {
  if (!audio.ctx || !audio.enabled) return;
  const t = audio.ctx.currentTime;
  if (!audio.lockToneOsc) {
    const osc = audio.ctx.createOscillator();
    osc.type = 'sine';
    const gain = audio.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    osc.connect(gain).connect(audio.master);
    osc.start(t);
    audio.lockToneOsc = osc;
    audio.lockToneGain = gain;
  }
  audio.lockToneOsc.frequency.setTargetAtTime(freq, t, 0.05);
  audio.lockToneGain.gain.setTargetAtTime(0.074, t, 0.04);
}
function updateTargetLockAudio(dt) {
  if (!audio.ctx || !audio.enabled || !running || !reticleState.visible) {
    stopLockTone();
    return;
  }
  const target = targetHudState.activeTarget;
  const lockAmount = targetHudState.lockAmount || 0;
  if (!target || targetHudState.lockTone === 'off' || lockAmount < 0.06) {
    stopLockTone();
    return;
  }
  if (targetHudState.lockSolid) {
    ensureLockTone(1280 + Math.min(220, lockAmount * 140));
    return;
  }
  stopLockTone();
  const now = performance.now();
  const ramp = smoothstep(clamp01(lockAmount));
  const intervalMs = 720 - ramp * 600; // beep...beep..beep-beep, then solid tone
  if ((now - (audio.lockCueAt || 0)) >= intervalMs) {
    audio.lockCueAt = now;
    audioBeep(700 + ramp * 620, 0.07 + ramp * 0.055, 0.042 + ramp * 0.045);
  }
}

function audioThud(intensity = 0.5) {
  if (!audio.ctx) return;
  const t = audio.ctx.currentTime;
  const sr = audio.ctx.sampleRate;
  const buf = audio.ctx.createBuffer(1, sr * 0.4, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    d[i] = (Math.random() * 2 - 1) * Math.exp(-i / d.length * 5);
  }
  const src = audio.ctx.createBufferSource();
  src.buffer = buf;
  const f = audio.ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 180;
  const g = audio.ctx.createGain();
  g.gain.value = intensity;
  src.connect(f).connect(g).connect(audio.master);
  src.start(t);
}

let stallTimer = 0.5;
function updateAudio(dt) {
  if (!audio.ctx || !audio.enabled) return;
  if (isPropAirframe()) {
    ensurePropEngineSample();
  }

  const ct = audio.ctx.currentTime;
  const surgePower = plane.crashed ? 1 : engineSurgeState.powerMul;
  const t = clamp01(plane.throttle * surgePower);
  const sp = plane.vel.length();
  const surgeDip = clamp01((1 - surgePower) / 0.16);
  const surgeRecovery = clamp01((surgePower - 1) / 0.13);
  const propSampleActive = isPropAirframe() && !!audio.propSampleReady;

  // Keep the master gain steady. The previous ground-proximity bounce
  // made the single prop loop swell/duck like a second moving layer,
  // which reads more like a fake doppler effect than a clean engine hum.
  if (audio.master && audio.enabled) {
    audio.master.gain.setTargetAtTime(0.55, ct, 0.15);
  }

  if (audio.propSampleReady) {
    if (propSampleActive) syncPropSamplePlayback();
    // Throttle-linked pitch: idle->full spans 1.06->1.20 playback rate. Slow tau
    // (0.25) keeps the one-clear-voice design with no swell/duck artifact.
    const targetRate = 1.06 + t * 0.14;
    audio.propPlaybackRate = targetRate;
    if (audio.propBufferNode) {
      audio.propBufferNode.playbackRate.setTargetAtTime(targetRate, ct, 0.25);
    }
    audio.propTextureBlend = 0;
    const sampleVol = propSampleActive
      ? Math.min(0.76, 0.46 + t * 0.18)
      : 0;
    if (audio.propSampleGain) {
      audio.propSampleGain.gain.setTargetAtTime(sampleVol, ct, 0.14);
    }
    if (audio.propSampleFilter) {
      audio.propSampleFilter.frequency.setTargetAtTime(1180, ct, 0.16);
    }
    if (audio.propSampleHighpass) {
      audio.propSampleHighpass.frequency.setTargetAtTime(58, ct, 0.16);
    }
  }

  // When the recorded prop sample is playing, silence the synth engine
  // layers entirely. Previously they blended at 0.18 which left an
  // audible hiss baseline. The bandpass wind noise (at 1700 Hz, i.e.
  // exactly the "sssss" band) also gets killed — the sample already
  // contains airstream noise.
  const synthBlend = propSampleActive ? 0 : 1.0;
  const synthFilterTarget = propSampleActive
    ? 210 + t * 680 + sp * 0.8 + surgeRecovery * 70 - surgeDip * 55
    : 260 + t * 950 + sp * 1.2 + surgeRecovery * 120 - surgeDip * 110;
  const synthOscFreq = propSampleActive
    ? 36 + t * 62 + surgeRecovery * 10 - surgeDip * 8
    : 50 + t * 100 + surgeRecovery * 18 - surgeDip * 12;

  // When the plane is crashed we silence every engine/wind synth layer.
  // Without this the filtered noise + sawtooth osc keep droning on top of
  // the explosion FX, which reads as "engine keeps running after I died".
  const deadMul = plane.crashed ? 0 : 1;
  audio.engineGain.gain.setTargetAtTime((0.28 * t + 0.04) * synthBlend * deadMul, ct, 0.12);
  audio.engineFilter.frequency.setTargetAtTime(synthFilterTarget, ct, 0.12);
  audio.engineOscGain.gain.setTargetAtTime((t * 0.08 + 0.015 + surgeRecovery * 0.012) * (propSampleActive ? 0 : 1) * deadMul, ct, 0.12);
  audio.engineOsc.frequency.setTargetAtTime(synthOscFreq, ct, 0.12);

  // Wind noise — entirely disabled when the prop sample is live (the
  // sample already contains airstream), and killed on crash.
  const windV = propSampleActive || plane.crashed
    ? 0
    : Math.min(0.45, Math.max(0, sp - 30) / 280);
  audio.windGain.gain.setTargetAtTime(windV, ct, 0.2);

  // Stall warning beep
  const lv = plane.vel.clone().applyQuaternion(plane.quat.clone().invert());
  const fwd = -lv.z;
  const aoa = fwd > 1 ? Math.atan2(-lv.y, fwd) : 0;
  if (Math.abs(aoa) > 0.27 && fwd > 25) {
    stallTimer += dt;
    if (stallTimer > 0.45) { audioBeep(880, 0.16, 0.10); stallTimer = 0; }
  } else stallTimer = 0.5;
  updateTargetLockAudio(dt);
}

function setAudioEnabled(on) {
  if (on && !audio.ctx) initAudio();
  if (!audio.ctx) return;
  if (audio.ctx.state === 'suspended') audio.ctx.resume();
  audio.enabled = on;
  if (on) {
    ensurePropEngineSample();
  } else {
    stopLockTone();
  }
  audio.master.gain.setTargetAtTime(on ? 0.55 : 0, audio.ctx.currentTime, 0.1);
  if (!on && audio.propSampleGain) audio.propSampleGain.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.08);
  for (const bed of Object.values(audio.propDetailBeds || {})) {
    if (bed && bed.gain) bed.gain.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.08);
  }
  syncPropSamplePlayback();
}

// Engine hum stays continuous; no extra throttle-start stinger.
let _prevThrottleForStart = 0;
function maybeTriggerEngineStart() {
  _prevThrottleForStart = plane.throttle;
}

// NOTE: `spawnDamageDecal` and `damageDecalsClear` are declared above
// (near the jet creation) with `var` so the decal setup IIFE can assign
// them before this block runs. Do not re-declare here.

