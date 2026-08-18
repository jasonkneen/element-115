// @module src/game/01-boot-config.js
// Query parameters are the canonical game URL format. We still accept the
// older hash format used by copied model-tweak links, but only when the hash
// contains actual game keys. This keeps an unrelated page anchor from
// shadowing a valid ?plane= selection.
const GAME_URL_PARAM_KEYS = new Set([
  'plane', 'variant', 's', 'rx', 'ry', 'rz', 'dx', 'dy', 'dz', 'px', 'py', 'pz', 'jet',
  'debug', 'autopilot', 'floatingtarget', 'mp', 'room', 'name', 'spawn',
]);
function getGameParamsFromLocation() {
  const searchStr = (window.location.search || '').replace(/^\?/, '');
  const hashStr = (window.location.hash || '').replace(/^#/, '');
  if (!hashStr || !hashStr.includes('=')) return new URLSearchParams(searchStr);
  const hashParams = new URLSearchParams(hashStr);
  const hasGameParam = Array.from(GAME_URL_PARAM_KEYS).some(key => hashParams.has(key));
  return new URLSearchParams(hasGameParam ? hashStr : searchStr);
}
const bootParams = getGameParamsFromLocation();
const DEBUG_UI = bootParams.get('debug') === '1';
const AUTOPILOT_UI = DEBUG_UI || bootParams.get('autopilot') === '1';
const ENABLE_FLOATING_TARGET = DEBUG_UI || bootParams.get('floatingtarget') === '1';
const MULTIPLAYER_URL_KEY = 'flight_mp_url';
const MULTIPLAYER_CALLSIGN_KEY = 'flight_mp_callsign';
const MULTIPLAYER_ROOM_KEY = 'flight_mp_room';
const PLAYER_SPAWN_KEY = 'flight_spawn_mode';
const PLAYER_SPAWN_EXPLICIT_KEY = 'flight_spawn_mode_explicit';
const DEFAULT_SPAWN_MODE = 'sky';
function defaultMultiplayerUrl() {
  const hostIsLocal = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
  const hostProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return hostIsLocal ? `${hostProto}//${location.hostname}:8787` : `${hostProto}//${location.host}`;
}
function normalizeMultiplayerUrl(value) {
  return String(value || '').trim();
}
let MULTIPLAYER_URL = (() => {
  const explicitMp = bootParams.get('mp');
  if (explicitMp != null) return normalizeMultiplayerUrl(explicitMp);
  try {
    // Live static hosts like Netlify do not provide a websocket endpoint by
    // default. Keep multiplayer opt-in; otherwise Chrome logs repeated failed
    // wss://<site>/ attempts and the player is still solo anyway.
    const stored = normalizeMultiplayerUrl(localStorage.getItem(MULTIPLAYER_URL_KEY));
    const hostIsLocal = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
    if (!hostIsLocal && stored === defaultMultiplayerUrl()) {
      localStorage.removeItem(MULTIPLAYER_URL_KEY);
      return '';
    }
    return stored;
  } catch {
    return '';
  }
})();
let MULTIPLAYER_ROOM = (() => {
  try {
    return bootParams.get('room') || localStorage.getItem(MULTIPLAYER_ROOM_KEY) || 'default';
  } catch {
    return bootParams.get('room') || 'default';
  }
})();
function sanitizeCallsign(value) {
  const cleaned = String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 -]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
  return cleaned || 'PILOT';
}
function resolveInitialSpawnMode() {
  const explicitSpawn = bootParams.get('spawn');
  if (explicitSpawn) return explicitSpawn;
  try {
    const storedSpawn = localStorage.getItem(PLAYER_SPAWN_KEY);
    const explicitStoredSpawn = localStorage.getItem(PLAYER_SPAWN_EXPLICIT_KEY) === '1';
    // Default new sessions to an air start. Respect explicitly selected
    // spawn modes, but upgrade stale/non-explicit runway storage from older
    // live builds so the game opens already flying.
    if (storedSpawn && !explicitStoredSpawn && storedSpawn !== DEFAULT_SPAWN_MODE) {
      localStorage.setItem(PLAYER_SPAWN_KEY, DEFAULT_SPAWN_MODE);
      return DEFAULT_SPAWN_MODE;
    }
    return storedSpawn || DEFAULT_SPAWN_MODE;
  } catch {
    return DEFAULT_SPAWN_MODE;
  }
}
const playerProfileState = {
  callsign: (() => {
    try {
      return sanitizeCallsign(bootParams.get('name') || localStorage.getItem(MULTIPLAYER_CALLSIGN_KEY) || 'PILOT');
    } catch {
      return sanitizeCallsign(bootParams.get('name') || 'PILOT');
    }
  })(),
  spawnMode: resolveInitialSpawnMode(),
};
const SPAWN_OPTIONS = [
  { key: 'sky', label: 'SKY' },
  { key: 'runway36', label: 'RWY 36' },
  { key: 'runway18', label: 'RWY 18' },
  { key: 'apron', label: 'APRON' },
];
function normalizeSpawnMode(mode) {
  const found = SPAWN_OPTIONS.find(opt => opt.key === mode);
  return found ? found.key : DEFAULT_SPAWN_MODE;
}
playerProfileState.spawnMode = normalizeSpawnMode(playerProfileState.spawnMode);
function persistPlayerProfile() {
  try {
    localStorage.setItem(MULTIPLAYER_CALLSIGN_KEY, playerProfileState.callsign);
    localStorage.setItem(MULTIPLAYER_ROOM_KEY, MULTIPLAYER_ROOM || 'default');
    localStorage.setItem(PLAYER_SPAWN_KEY, playerProfileState.spawnMode || DEFAULT_SPAWN_MODE);
  } catch {}
}
// Default airframe: procedural Element-115 jet fighter (file:'default').
// The aircraft spec is deliberately separate from the visual loader. Physics
// can consume it without inferring flight or ground behaviour from GLB names.
const DEFAULT_PROP_MODEL_KEY = 'e115';
const AIRCRAFT_SPECS = Object.freeze({
  e115: Object.freeze({
    key: 'e115',
    flight: Object.freeze({ profile: 'racer', accel: 1.28, topSpeedKts: 720, lift: 1.06, idlePower: 1.0, pitchAuthority: 1.12, rollAuthority: 1.18, rudderAuthority: 1.0, stallSoftness: 1.02 }),
    ground: Object.freeze({ gearHeight: 2.3, wheelbase: 5.8, fixedGear: false, retractable: true, taildragger: false }),
    visual: Object.freeze({ class: 'jet', procedural: true }),
  }),
  f15: Object.freeze({
    key: 'f15',
    flight: Object.freeze({ profile: 'racer', accel: 1.38, topSpeedKts: 780, lift: 0.98, idlePower: 0.94, pitchAuthority: 1.04, rollAuthority: 1.16, rudderAuthority: 0.92, stallSoftness: 0.92 }),
    ground: Object.freeze({ gearHeight: 2.25, wheelbase: 6.8, fixedGear: false, retractable: true, taildragger: false }),
    visual: Object.freeze({ class: 'jet' }),
  }),
  f15lp: Object.freeze({
    key: 'f15lp',
    flight: Object.freeze({ profile: 'racer', accel: 1.32, topSpeedKts: 740, lift: 1.0, idlePower: 0.94, pitchAuthority: 1.08, rollAuthority: 1.2, rudderAuthority: 0.94, stallSoftness: 0.95 }),
    ground: Object.freeze({ gearHeight: 2.25, wheelbase: 6.8, fixedGear: false, retractable: true, taildragger: false }),
    visual: Object.freeze({ class: 'jet' }),
  }),
  a10: Object.freeze({
    key: 'a10',
    flight: Object.freeze({ profile: 'trainer', accel: 1.04, topSpeedKts: 500, lift: 1.22, idlePower: 1.04, pitchAuthority: 0.9, rollAuthority: 0.82, rudderAuthority: 1.08, stallSoftness: 1.22 }),
    ground: Object.freeze({ gearHeight: 2.4, wheelbase: 6.6, fixedGear: false, retractable: true, taildragger: false }),
    visual: Object.freeze({ class: 'jet' }),
  }),
  dusty: Object.freeze({
    key: 'dusty',
    flight: Object.freeze({ profile: 'trainer', accel: 0.94, topSpeedKts: 390, lift: 1.26, idlePower: 1.08, pitchAuthority: 1.02, rollAuthority: 0.9, rudderAuthority: 1.14, stallSoftness: 1.3 }),
    ground: Object.freeze({ gearHeight: 1.85, wheelbase: 4.1, fixedGear: true, retractable: false, taildragger: false }),
    visual: Object.freeze({ class: 'prop' }),
  }),
  stunt1: Object.freeze({
    key: 'stunt1',
    flight: Object.freeze({ profile: 'stunt', accel: 1.08, topSpeedKts: 460, lift: 1.14, idlePower: 0.9, pitchAuthority: 1.56, rollAuthority: 1.74, rudderAuthority: 1.42, stallSoftness: 1.16 }),
    ground: Object.freeze({ gearHeight: 1.75, wheelbase: 3.8, fixedGear: true, retractable: false, taildragger: true }),
    visual: Object.freeze({ class: 'prop' }),
  }),
  stunt2: Object.freeze({
    key: 'stunt2',
    // Roll specialist: fastest roll of the stunt family, trades a little top speed.
    flight: Object.freeze({ profile: 'stunt', accel: 1.08, topSpeedKts: 435, lift: 1.14, idlePower: 0.9, pitchAuthority: 1.56, rollAuthority: 1.88, rudderAuthority: 1.42, stallSoftness: 1.16 }),
    ground: Object.freeze({ gearHeight: 1.75, wheelbase: 3.8, fixedGear: true, retractable: false, taildragger: true }),
    visual: Object.freeze({ class: 'prop' }),
  }),
  stunt3: Object.freeze({
    key: 'stunt3',
    // Agility/lift variant: strongest pull + pitch response of the stunt family.
    flight: Object.freeze({ profile: 'stunt', accel: 1.08, topSpeedKts: 460, lift: 1.24, idlePower: 0.9, pitchAuthority: 1.68, rollAuthority: 1.74, rudderAuthority: 1.42, stallSoftness: 1.16 }),
    ground: Object.freeze({ gearHeight: 1.75, wheelbase: 3.8, fixedGear: true, retractable: false, taildragger: true }),
    visual: Object.freeze({ class: 'prop' }),
  }),
  stunt4: Object.freeze({
    key: 'stunt4',
    // Speed variant: fastest + quickest of the stunt family, rolls a touch slower.
    flight: Object.freeze({ profile: 'stunt', accel: 1.17, topSpeedKts: 505, lift: 1.14, idlePower: 0.9, pitchAuthority: 1.56, rollAuthority: 1.62, rudderAuthority: 1.42, stallSoftness: 1.16 }),
    ground: Object.freeze({ gearHeight: 1.75, wheelbase: 3.8, fixedGear: true, retractable: false, taildragger: true }),
    visual: Object.freeze({ class: 'prop' }),
  }),
  corsair: Object.freeze({
    key: 'corsair',
    flight: Object.freeze({ profile: 'racer', accel: 1.18, topSpeedKts: 510, lift: 1.04, idlePower: 0.92, pitchAuthority: 1.04, rollAuthority: 1.16, rudderAuthority: 1.04, stallSoftness: 1.0 }),
    ground: Object.freeze({ gearHeight: 2.0, wheelbase: 4.9, fixedGear: true, retractable: false, taildragger: true }),
    visual: Object.freeze({ class: 'prop' }),
  }),
  macchi: Object.freeze({
    key: 'macchi',
    flight: Object.freeze({ profile: 'racer', accel: 1.1, topSpeedKts: 480, lift: 1.08, idlePower: 0.94, pitchAuthority: 1.0, rollAuthority: 1.08, rudderAuthority: 1.08, stallSoftness: 1.06 }),
    ground: Object.freeze({ gearHeight: 1.9, wheelbase: 4.7, fixedGear: true, retractable: false, taildragger: true }),
    visual: Object.freeze({ class: 'prop' }),
  }),
  yak9: Object.freeze({
    key: 'yak9',
    flight: Object.freeze({ profile: 'racer', accel: 1.1, topSpeedKts: 490, lift: 1.08, idlePower: 0.94, pitchAuthority: 1.04, rollAuthority: 1.12, rudderAuthority: 1.08, stallSoftness: 1.06 }),
    ground: Object.freeze({ gearHeight: 1.9, wheelbase: 4.7, fixedGear: true, retractable: false, taildragger: true }),
    visual: Object.freeze({ class: 'prop' }),
  }),
  tucano: Object.freeze({
    key: 'tucano',
    flight: Object.freeze({ profile: 'trainer', accel: 1.08, topSpeedKts: 450, lift: 1.18, idlePower: 1.0, pitchAuthority: 1.0, rollAuthority: 1.0, rudderAuthority: 1.16, stallSoftness: 1.22 }),
    ground: Object.freeze({ gearHeight: 2.0, wheelbase: 5.0, fixedGear: true, retractable: false, taildragger: false }),
    visual: Object.freeze({ class: 'prop' }),
  }),
  ripslinger: Object.freeze({
    key: 'ripslinger',
    flight: Object.freeze({ profile: 'racer', accel: 1.22, topSpeedKts: 530, lift: 0.98, idlePower: 0.9, pitchAuthority: 1.08, rollAuthority: 1.28, rudderAuthority: 1.0, stallSoftness: 0.96 }),
    ground: Object.freeze({ gearHeight: 1.9, wheelbase: 4.5, fixedGear: true, retractable: false, taildragger: false }),
    visual: Object.freeze({ class: 'prop' }),
  }),
  p100: Object.freeze({
    key: 'p100',
    flight: Object.freeze({ profile: 'stunt', accel: 1.12, topSpeedKts: 470, lift: 1.12, idlePower: 0.92, pitchAuthority: 1.3, rollAuthority: 1.46, rudderAuthority: 1.22, stallSoftness: 1.12 }),
    ground: Object.freeze({ gearHeight: 1.9, wheelbase: 4.2, fixedGear: true, retractable: false, taildragger: false }),
    visual: Object.freeze({ class: 'prop' }),
  }),
  lowpolytrainer: Object.freeze({
    key: 'lowpolytrainer',
    flight: Object.freeze({ profile: 'trainer', accel: 0.9, topSpeedKts: 360, lift: 1.3, idlePower: 1.1, pitchAuthority: 0.94, rollAuthority: 0.88, rudderAuthority: 1.18, stallSoftness: 1.34 }),
    ground: Object.freeze({ gearHeight: 1.75, wheelbase: 3.9, fixedGear: true, retractable: false, taildragger: false }),
    visual: Object.freeze({ class: 'prop' }),
  }),
});
const PROP_MODEL_PRESETS = [
  { key: 'e115', label: 'E-115 FIGHTER', name: 'Element-115 Fighter', hudLabel: 'E-115', type: 'Jet Fighter', badge: 'DEFAULT', file: 'default', procedural: true, jet: true, spec: AIRCRAFT_SPECS.e115 },
  // Jets (GLB). jet:true skips prop detection/synthesis, keeps afterburner FX + jet audio.
  // Both F-15 GLBs are authored nose-along +X; ry:-90 maps nose to flight -Z
  // (twin tails end up at +Z = aft, facing the chase cam). Re-center runs on load.
  { key: 'f15', label: 'F-15 EAGLE', name: 'F-15 Eagle', hudLabel: 'F-15', type: 'Jet Fighter', badge: 'JET', file: 'models/f-15.glb', jet: true, ry: -90, spec: AIRCRAFT_SPECS.f15 },
  { key: 'f15lp', label: 'F-15 STRIKE', name: 'F-15 Strike (low poly)', hudLabel: 'F-15 LP', type: 'Jet Fighter', badge: 'JET', file: 'models/low_poly_f-15.glb', jet: true, ry: -90, spec: AIRCRAFT_SPECS.f15lp },
  // low_poly_a-10 has a real landing-gear clip; the older "avion" GLB sits off-camera
  // with the prior rx=90 / pz=-24 tweak and is kept only as a URL fallback.
  { key: 'a10', label: 'A-10 WARTHOG', name: 'A-10 Thunderbolt II', hudLabel: 'A-10', type: 'Attack Jet', badge: 'JET', file: 'models/low_poly_a-10_warthog.glb', jet: true, ry: 0, spec: AIRCRAFT_SPECS.a10 },
  // Props / warbirds (calibrated entries in plane-tweaks.json where available)
  { key: 'dusty', label: 'DUSTY TURBO', name: 'Dusty Turbo', hudLabel: 'DUSTY', type: 'Hero Prop', badge: 'READY', file: 'models/disney_planes_-_dusty_turbo.glb', spec: AIRCRAFT_SPECS.dusty },
  { key: 'stunt1', label: 'STUNT PLANE I', name: 'Stunt Plane I', hudLabel: 'STUNT I', type: 'Stunt Prop', badge: 'V1', file: 'models/stunt_plane.glb', variant: '1', spec: AIRCRAFT_SPECS.stunt1 },
  { key: 'stunt2', label: 'STUNT PLANE II', name: 'Stunt Plane II', hudLabel: 'STUNT II', type: 'Stunt Prop', badge: 'V2', file: 'models/stunt_plane.glb', variant: '2', spec: AIRCRAFT_SPECS.stunt2 },
  { key: 'stunt3', label: 'STUNT PLANE III', name: 'Stunt Plane III', hudLabel: 'STUNT III', type: 'Stunt Prop', badge: 'V3', file: 'models/stunt_plane.glb', variant: '3', spec: AIRCRAFT_SPECS.stunt3 },
  { key: 'stunt4', label: 'STUNT PLANE IV', name: 'Stunt Plane IV', hudLabel: 'STUNT IV', type: 'Stunt Prop', badge: 'V4', file: 'models/stunt_plane.glb', variant: '4', spec: AIRCRAFT_SPECS.stunt4 },
  { key: 'corsair', label: 'F4U CORSAIR', name: 'F4U-1 Corsair', hudLabel: 'CORSAIR', type: 'Warbird', badge: 'WWII', file: 'models/corsair_f4u-1_airplane.glb', spec: AIRCRAFT_SPECS.corsair },
  { key: 'macchi', label: 'MACCHI C.202', name: 'Macchi C.202 Folgore', hudLabel: 'FOLGORE', type: 'Warbird', badge: 'WWII', file: 'models/italian_macchi_c.202_folgore.glb', spec: AIRCRAFT_SPECS.macchi },
  { key: 'yak9', label: 'YAK-9', name: 'Yakovlev Yak-9', hudLabel: 'YAK-9', type: 'Warbird', badge: 'WWII', file: 'models/yak-9.glb', spec: AIRCRAFT_SPECS.yak9 },
  { key: 'tucano', label: 'EMB-314 TUCANO', name: 'EMB-314 Super Tucano', hudLabel: 'TUCANO', type: 'Turboprop', badge: 'COIN', file: 'models/colombian_emb_314_tucano.glb', spec: AIRCRAFT_SPECS.tucano },
  { key: 'ripslinger', label: 'RIPSLINGER', name: 'Ripslinger', hudLabel: 'RIP', type: 'Racing Prop', badge: 'RACE', file: 'models/ripslinger.glb', spec: AIRCRAFT_SPECS.ripslinger },
  { key: 'p100', label: 'P-100 AVENGER', name: 'P-100 Avenger', hudLabel: 'P-100', type: 'Sport Prop', badge: 'SPORT', file: 'models/p-100_avenger_-_free.glb', spec: AIRCRAFT_SPECS.p100 },
  { key: 'lowpolytrainer', label: 'LOW POLY TRAINER', name: 'Low Poly Trainer', hudLabel: 'TRAINER', type: 'Utility Prop', badge: 'TRAIN', file: 'models/low_poly_plane.glb', spec: AIRCRAFT_SPECS.lowpolytrainer },
];
const REMOVED_PROP_MODEL_FILES = new Set([
  'models/claude_scruggs.glb',
  'models/crank_bush_plane.glb',
]);
const PROP_MODEL_BY_KEY = new Map(PROP_MODEL_PRESETS.map(p => [p.key, p]));

function getDefaultPropPreset() {
  return PROP_MODEL_BY_KEY.get(DEFAULT_PROP_MODEL_KEY) || PROP_MODEL_PRESETS[0];
}

function getAircraftPresetByKey(key) {
  return PROP_MODEL_BY_KEY.get(String(key || '')) || null;
}

function getAircraftSpecByPreset(preset) {
  const resolved = typeof preset === 'string' ? getAircraftPresetByKey(preset) : preset;
  return (resolved && resolved.spec) || getDefaultPropPreset().spec;
}

function getStoredPropModelKey() {
  try {
    const stored = localStorage.getItem('flight_prop_model_key');
    if (stored && PROP_MODEL_BY_KEY.has(stored)) return stored;
  } catch {}
  return DEFAULT_PROP_MODEL_KEY;
}

function findPropPresetByPlaneFile(file, variant) {
  const candidates = PROP_MODEL_PRESETS.filter(p => p.file === file);
  if (!candidates.length) return null;
  if (variant != null) {
    return candidates.find(p => String(p.variant == null ? '' : p.variant) === String(variant)) || null;
  }
  return candidates.find(p => p.variant == null) || candidates[0];
}

function findPropPresetByParams(params) {
  if (!params || !params.has('plane')) return null;
  const plane = params.get('plane');
  const variant = params.get('variant');
  return findPropPresetByPlaneFile(plane, variant == null ? undefined : variant);
}

function resolvePropPresetFromParams(params) {
  if (!params || !params.has('plane')) return { preset: null, invalid: false };
  const preset = findPropPresetByParams(params);
  return { preset, invalid: !preset };
}

function applyPropPresetIdentityToParams(params, preset) {
  params.set('plane', preset.file);
  if (preset.variant != null) params.set('variant', String(preset.variant)); else params.delete('variant');
  if (preset.jet && !preset.procedural) params.set('jet', '1'); else params.delete('jet');
}

function applyPropPresetToParams(params, preset) {
  applyPropPresetIdentityToParams(params, preset);
  if (preset.s != null) params.set('s', String(preset.s)); else params.delete('s');
  if (preset.rx != null) params.set('rx', String(preset.rx)); else params.delete('rx');
  if (preset.ry != null) params.set('ry', String(preset.ry)); else params.delete('ry');
  if (preset.rz != null) params.set('rz', String(preset.rz)); else params.delete('rz');
  if (preset.dy != null) params.set('dy', String(preset.dy)); else params.delete('dy');
}

let activePropModelKeyOverride = null;

function getActivePropPreset() {
  if (activePropModelKeyOverride && PROP_MODEL_BY_KEY.has(activePropModelKeyOverride)) {
    return PROP_MODEL_BY_KEY.get(activePropModelKeyOverride);
  }
  const explicit = resolvePropPresetFromParams(bootParams);
  if (explicit.invalid) return getDefaultPropPreset();
  if (explicit.preset) return explicit.preset;
  return PROP_MODEL_BY_KEY.get(getStoredPropModelKey())
    || getDefaultPropPreset();
}

const initialRequestedAircraftPreset = getActivePropPreset();
const aircraftVisualState = {
  requestedKey: initialRequestedAircraftPreset.key,
  visualKey: initialRequestedAircraftPreset.procedural ? initialRequestedAircraftPreset.key : DEFAULT_PROP_MODEL_KEY,
  status: initialRequestedAircraftPreset.procedural ? 'loaded' : 'loading',
  error: '',
};

function getLoadedAircraftPreset() {
  return getAircraftPresetByKey(aircraftVisualState.visualKey) || getDefaultPropPreset();
}

function getActiveAircraftSpec() {
  return getAircraftSpecByPreset(getLoadedAircraftPreset());
}

function getAircraftSelectionState() {
  return {
    requested: getAircraftPresetByKey(aircraftVisualState.requestedKey) || getDefaultPropPreset(),
    visual: getLoadedAircraftPreset(),
    status: aircraftVisualState.status,
    error: aircraftVisualState.error,
  };
}

function dispatchAircraftVisualChange() {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent('aircraftvisualchange', { detail: getAircraftSelectionState() }));
}

function markAircraftVisualLoading(preset) {
  const requested = getAircraftPresetByKey(preset && preset.key) || getDefaultPropPreset();
  aircraftVisualState.requestedKey = requested.key;
  aircraftVisualState.visualKey = requested.procedural ? requested.key : DEFAULT_PROP_MODEL_KEY;
  aircraftVisualState.status = requested.procedural ? 'loaded' : 'loading';
  aircraftVisualState.error = '';
}

function markAircraftVisualLoaded(preset) {
  const loaded = getAircraftPresetByKey(preset && preset.key) || getDefaultPropPreset();
  activePropModelKeyOverride = loaded.key;
  aircraftVisualState.requestedKey = loaded.key;
  aircraftVisualState.visualKey = loaded.key;
  aircraftVisualState.status = 'loaded';
  aircraftVisualState.error = '';
  try { localStorage.setItem('flight_prop_model_key', loaded.key); } catch {}
  dispatchAircraftVisualChange();
}

function markAircraftVisualFallback(reason = '') {
  const fallback = getDefaultPropPreset();
  activePropModelKeyOverride = fallback.key;
  aircraftVisualState.requestedKey = fallback.key;
  aircraftVisualState.visualKey = fallback.key;
  aircraftVisualState.status = 'fallback';
  aircraftVisualState.error = String(reason || 'MODEL LOAD FAILED');
  try { localStorage.setItem('flight_prop_model_key', fallback.key); } catch {}
  dispatchAircraftVisualChange();
  return fallback;
}

function applyPropModelPreset(key) {
  const preset = PROP_MODEL_BY_KEY.get(key);
  if (!preset) return;
  try { localStorage.setItem('flight_prop_model_key', preset.key); } catch {}
  const url = new URL(location.href);
  applyPropPresetToParams(url.searchParams, preset);
  if ((url.hash || '').includes('=')) url.hash = '';
  location.assign(url.toString());
}

function cyclePropModel(direction = 1) {
  const active = getActivePropPreset();
  const idx = Math.max(0, PROP_MODEL_PRESETS.findIndex(p => p.key === active.key));
  const next = PROP_MODEL_PRESETS[(idx + direction + PROP_MODEL_PRESETS.length) % PROP_MODEL_PRESETS.length];
  applyPropModelPreset(next.key);
}
