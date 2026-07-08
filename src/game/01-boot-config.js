// @module src/game/01-boot-config.js
const bootParamSource = (() => {
  const hashStr = (window.location.hash || '').replace(/^#/, '');
  if (hashStr.includes('=')) return hashStr;
  return (window.location.search || '').replace(/^\?/, '');
})();
const bootParams = new URLSearchParams(bootParamSource);
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
const PROP_MODEL_PRESETS = [
  { key: 'e115', label: 'E-115 FIGHTER', name: 'Element-115 Fighter', hudLabel: 'E-115', type: 'Jet Fighter', badge: 'DEFAULT', file: 'default', procedural: true },
  { key: 'dusty', label: 'DUSTY TURBO', name: 'Dusty Turbo', hudLabel: 'DUSTY', type: 'Hero Prop', badge: 'READY', file: 'models/disney_planes_-_dusty_turbo.glb' },
  { key: 'stunt1', label: 'STUNT PLANE I', name: 'Stunt Plane I', hudLabel: 'STUNT I', type: 'Stunt Prop', badge: 'V1', file: 'models/stunt_plane.glb', variant: '1' },
  { key: 'stunt2', label: 'STUNT PLANE II', name: 'Stunt Plane II', hudLabel: 'STUNT II', type: 'Stunt Prop', badge: 'V2', file: 'models/stunt_plane.glb', variant: '2' },
  { key: 'stunt3', label: 'STUNT PLANE III', name: 'Stunt Plane III', hudLabel: 'STUNT III', type: 'Stunt Prop', badge: 'V3', file: 'models/stunt_plane.glb', variant: '3' },
  { key: 'stunt4', label: 'STUNT PLANE IV', name: 'Stunt Plane IV', hudLabel: 'STUNT IV', type: 'Stunt Prop', badge: 'V4', file: 'models/stunt_plane.glb', variant: '4' },
  // Calibrated warbirds/props (existing entries in plane-tweaks.json)
  { key: 'corsair', label: 'F4U CORSAIR', name: 'F4U-1 Corsair', hudLabel: 'CORSAIR', type: 'Warbird', badge: 'WWII', file: 'models/corsair_f4u-1_airplane.glb' },
  { key: 'macchi', label: 'MACCHI C.202', name: 'Macchi C.202 Folgore', hudLabel: 'FOLGORE', type: 'Warbird', badge: 'WWII', file: 'models/italian_macchi_c.202_folgore.glb' },
  { key: 'yak9', label: 'YAK-9', name: 'Yakovlev Yak-9', hudLabel: 'YAK-9', type: 'Warbird', badge: 'WWII', file: 'models/yak-9.glb' },
  { key: 'tucano', label: 'EMB-314 TUCANO', name: 'EMB-314 Super Tucano', hudLabel: 'TUCANO', type: 'Turboprop', badge: 'COIN', file: 'models/colombian_emb_314_tucano.glb' },
  { key: 'ripslinger', label: 'RIPSLINGER', name: 'Ripslinger', hudLabel: 'RIP', type: 'Racing Prop', badge: 'RACE', file: 'models/ripslinger.glb' },
  { key: 'p100', label: 'P-100 AVENGER', name: 'P-100 Avenger', hudLabel: 'P-100', type: 'Sport Prop', badge: 'SPORT', file: 'models/p-100_avenger_-_free.glb' },
  { key: 'lowpolytrainer', label: 'LOW POLY TRAINER', name: 'Low Poly Trainer', hudLabel: 'TRAINER', type: 'Utility Prop', badge: 'TRAIN', file: 'models/low_poly_plane.glb' },
  // Jets (auto-calibrated on load; "Low poly F-15" by SIpriv on Sketchfab, CC-BY).
  // jet:true skips prop detection/synthesis, keeps afterburner FX + jet audio;
  // ry flips models authored facing +Z into the game's -Z forward.
  { key: 'f15', label: 'F-15 EAGLE', name: 'F-15 Eagle', hudLabel: 'F-15', type: 'Jet Fighter', badge: 'JET', file: 'models/f-15.glb', jet: true, ry: 0 },
  { key: 'f15lp', label: 'F-15 STRIKE', name: 'F-15 Strike (low poly)', hudLabel: 'F-15 LP', type: 'Jet Fighter', badge: 'JET', file: 'models/low_poly_f-15.glb', jet: true, ry: 0 },
  { key: 'a10', label: 'A-10 WARTHOG', name: 'A-10 Thunderbolt II', hudLabel: 'A-10', type: 'Attack Jet', badge: 'JET', file: 'models/a-10_thunderbolt_ii_warthog_plane__avion.glb', jet: true },
];
const REMOVED_PROP_MODEL_FILES = new Set([
  'models/claude_scruggs.glb',
  'models/crank_bush_plane.glb',
]);
const PROP_MODEL_BY_KEY = new Map(PROP_MODEL_PRESETS.map(p => [p.key, p]));

function getStoredPropModelKey() {
  try { return localStorage.getItem('flight_prop_model_key') || PROP_MODEL_PRESETS[0].key; }
  catch { return PROP_MODEL_PRESETS[0].key; }
}

function findPropPresetByPlaneFile(file) {
  return PROP_MODEL_PRESETS.find(p => p.file === file && p.variant == null)
    || PROP_MODEL_PRESETS.find(p => p.file === file)
    || null;
}

function findPropPresetByParams(params) {
  const plane = params.get('plane');
  const variant = params.get('variant');
  if (plane && variant) {
    const exact = PROP_MODEL_PRESETS.find(p => p.file === plane && String(p.variant || '') === String(variant));
    if (exact) return exact;
  }
  if (plane) return findPropPresetByPlaneFile(plane);
  return null;
}

function applyPropPresetToParams(params, preset) {
  params.set('plane', preset.file);
  if (preset.variant != null) params.set('variant', String(preset.variant)); else params.delete('variant');
  if (preset.s != null) params.set('s', String(preset.s)); else params.delete('s');
  if (preset.rx != null) params.set('rx', String(preset.rx)); else params.delete('rx');
  if (preset.ry != null) params.set('ry', String(preset.ry)); else params.delete('ry');
  if (preset.rz != null) params.set('rz', String(preset.rz)); else params.delete('rz');
  if (preset.dy != null) params.set('dy', String(preset.dy)); else params.delete('dy');
  if (preset.jet) params.set('jet', '1'); else params.delete('jet');
}

function getActivePropPreset() {
  const explicitPreset = findPropPresetByParams(bootParams);
  if (explicitPreset) return explicitPreset;
  return PROP_MODEL_BY_KEY.get(getStoredPropModelKey()) || PROP_MODEL_PRESETS[0];
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

