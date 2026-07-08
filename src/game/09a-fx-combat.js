// @module src/game/09a-fx-combat.js
// =============================================================
//  ATMOSPHERIC EFFECTS — particles, clouds, sun glow
// =============================================================

// Round soft sprite texture (white radial gradient → transparent)
function makeSpriteTexture(size = 64, soft = 0.85) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(soft * 0.6, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

function makeStreakTexture(width = 512, height = 128) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, height / 2, width, height / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.2, 'rgba(255,255,255,0.06)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.8, 'rgba(255,255,255,0.06)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, width, height);
  const core = g.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, height * 0.48);
  core.addColorStop(0, 'rgba(255,255,255,0.65)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, width, height);
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

// Cotton-cluster sprite: draw 5–7 overlapping soft circles at random-ish
// positions to make a fluffy multi-lobe blob that reads as a little cloud
// puff rather than a single bead of smoke. Deterministic per-call via a
// local seed so repeated calls with the same args give the same texture.
function makePuffTexture(size = 96, seed = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  // Seeded PRNG
  let s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const cx = size / 2, cy = size / 2;
  const lobeCount = 7;
  // Outer halo lobes first (big & soft), inner core last (bright).
  for (let i = 0; i < lobeCount; i++) {
    const ang = rnd() * Math.PI * 2;
    const rad = (0.10 + rnd() * 0.22) * size;        // offset from centre
    const lobeR = (0.18 + rnd() * 0.18) * size;      // lobe radius
    const lx = cx + Math.cos(ang) * rad;
    const ly = cy + Math.sin(ang) * rad;
    const alpha = 0.28 + rnd() * 0.22;
    const gr = g.createRadialGradient(lx, ly, 0, lx, ly, lobeR);
    gr.addColorStop(0,    'rgba(255,255,255,' + alpha.toFixed(3) + ')');
    gr.addColorStop(0.55, 'rgba(255,255,255,' + (alpha * 0.35).toFixed(3) + ')');
    gr.addColorStop(1,    'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
  }
  // Bright core pulls the mid-tones together so the cluster reads as one
  // object rather than dots.
  const core = g.createRadialGradient(cx, cy, 0, cx, cy, size * 0.38);
  core.addColorStop(0,    'rgba(255,255,255,0.85)');
  core.addColorStop(0.5,  'rgba(255,255,255,0.35)');
  core.addColorStop(1,    'rgba(255,255,255,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

function makeStuntPlanePaintTexture(size = 1024) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');

  const bg = g.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, '#fff7ef');
  bg.addColorStop(0.52, '#f3eadb');
  bg.addColorStop(1, '#e4d6c2');
  g.fillStyle = bg;
  g.fillRect(0, 0, size, size);

  // Broad stunt-racing color blocks so the UV layout gets readable paint even
  // without a shipped texture atlas in the GLB.
  g.fillStyle = '#d62828';
  g.fillRect(0, 0, size * 0.34, size);
  g.fillRect(size * 0.72, 0, size * 0.28, size * 0.42);

  g.fillStyle = '#1d4ed8';
  g.fillRect(size * 0.38, 0, size * 0.1, size);
  g.fillRect(size * 0.84, size * 0.42, size * 0.16, size * 0.58);

  g.fillStyle = '#111827';
  g.fillRect(0, size * 0.44, size, size * 0.035);
  g.fillRect(size * 0.46, 0, size * 0.02, size);

  // Wing/tail checker hints.
  const checker = size * 0.055;
  for (let y = 0; y < size; y += checker) {
    for (let x = 0; x < size; x += checker) {
      if (((x / checker) | 0) % 2 === ((y / checker) | 0) % 2) continue;
      if (x < size * 0.22 || x > size * 0.78 || y < size * 0.18 || y > size * 0.82) {
        g.fillStyle = 'rgba(255,255,255,0.22)';
        g.fillRect(x, y, checker, checker);
      }
    }
  }

  // Subtle panel lines / wear so it reads as a texture not flat color.
  g.strokeStyle = 'rgba(20,16,12,0.14)';
  g.lineWidth = Math.max(1, size * 0.0022);
  for (let i = 1; i < 10; i++) {
    const x = (size / 10) * i;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, size);
    g.stroke();
  }
  for (let i = 1; i < 7; i++) {
    const y = (size / 7) * i;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(size, y);
    g.stroke();
  }

  g.fillStyle = 'rgba(255,255,255,0.09)';
  g.fillRect(0, 0, size, size * 0.16);
  g.fillStyle = 'rgba(0,0,0,0.06)';
  g.fillRect(0, size * 0.84, size, size * 0.16);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace || t.colorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function makeStyledStuntPlaneTextureFromImage(image, variant = '1') {
  const w = image.width || 1024;
  const h = image.height || 1024;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.drawImage(image, 0, 0, w, h);

  const drawCheckerBand = (x, y, bw, bh, cell, a = 0.34) => {
    for (let yy = y; yy < y + bh; yy += cell) {
      for (let xx = x; xx < x + bw; xx += cell) {
        if ((((xx - x) / cell) | 0) % 2 === (((yy - y) / cell) | 0) % 2) continue;
        g.fillStyle = `rgba(255,255,255,${a})`;
        g.fillRect(xx, yy, cell, cell);
      }
    }
  };
  const drawWear = (count, alpha) => {
    for (let i = 0; i < count; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const len = 10 + Math.random() * 38;
      const ang = Math.random() * Math.PI * 2;
      g.strokeStyle = `rgba(18,16,14,${alpha * (0.5 + Math.random() * 0.8)})`;
      g.lineWidth = 1 + Math.random() * 1.8;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      g.stroke();
    }
  };
  const overlayGradient = (c1, c2, alpha, mode = 'multiply') => {
    g.save();
    g.globalCompositeOperation = mode;
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);
    g.globalAlpha = alpha;
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.restore();
  };

  if (variant === '1') {
    overlayGradient('#fff8f0', '#d7ddea', 0.22, 'screen');
    g.fillStyle = 'rgba(255,255,255,0.24)';
    g.fillRect(w * 0.18, h * 0.12, w * 0.10, h * 0.76);
    g.fillRect(w * 0.54, h * 0.10, w * 0.06, h * 0.80);
    g.fillStyle = 'rgba(214,40,40,0.18)';
    g.fillRect(w * 0.15, h * 0.12, w * 0.012, h * 0.76);
    g.fillRect(w * 0.60, h * 0.10, w * 0.012, h * 0.80);
  } else if (variant === '2') {
    drawCheckerBand(0, 0, w * 0.28, h * 0.22, Math.max(12, w * 0.028), 0.38);
    drawCheckerBand(w * 0.72, h * 0.72, w * 0.28, h * 0.28, Math.max(12, w * 0.028), 0.38);
    overlayGradient('#f7fafc', '#c9d5e5', 0.16, 'screen');
  } else if (variant === '3') {
    overlayGradient('#0b1220', '#020407', 0.72, 'multiply');
    g.save();
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = 'rgba(8,12,18,0.34)';
    g.fillRect(0, 0, w, h);
    g.restore();
    g.fillStyle = 'rgba(214,180,88,0.28)';
    g.fillRect(w * 0.30, h * 0.08, w * 0.016, h * 0.84);
    g.fillRect(w * 0.68, h * 0.08, w * 0.016, h * 0.84);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(0, 0, w, h * 0.10);
    g.fillStyle = 'rgba(0,0,0,0.14)';
    g.fillRect(0, h * 0.82, w, h * 0.18);
  } else if (variant === '4') {
    overlayGradient('#dccdb8', '#5b544b', 0.22, 'overlay');
    overlayGradient('#7a7367', '#2a2521', 0.16, 'multiply');
    g.fillStyle = 'rgba(60,46,36,0.15)';
    for (let i = 0; i < 24; i++) {
      g.fillRect(Math.random() * w, Math.random() * h, 18 + Math.random() * 46, 3 + Math.random() * 8);
    }
    drawWear(52, 0.13);
    g.fillStyle = 'rgba(255,255,255,0.04)';
    g.fillRect(0, 0, w, h * 0.12);
    g.fillStyle = 'rgba(0,0,0,0.08)';
    g.fillRect(0, h * 0.86, w, h * 0.14);
  }

  // Shared subtle paneling / wear pass so all variants feel more premium.
  g.strokeStyle = 'rgba(18,16,14,0.09)';
  g.lineWidth = Math.max(1, w * 0.0014);
  for (let i = 1; i < 8; i++) {
    const x = (w / 8) * i;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
  }
  for (let i = 1; i < 6; i++) {
    const y = (h / 6) * i;
    g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
  }
  drawWear(12, 0.05);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace || t.colorSpace;
  t.flipY = false;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

// Generic point-sprite particle pool with custom shader for size + alpha attenuation
class ParticlePool {
  constructor(scene, opts) {
    this.max = opts.max || 200;
    this.tex = opts.texture;
    
    // Pre-allocate circular buffer pool to avoid runtime object creation and array resizing GC
    this.pool = [];
    for (let i = 0; i < this.max; i++) {
      this.pool.push({
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        hasVel: false,
        life: 0,
        maxLife: 0,
        sizeMul: 1,
        rollPhase: 0,
      });
    }
    this.writeIndex = 0;

    this.geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(this.max * 3);
    this.alphas = new Float32Array(this.max);
    this.sizes = new Float32Array(this.max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1));
    this.geo.setAttribute('psize', new THREE.BufferAttribute(this.sizes, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: new THREE.Color(opts.color || 0xffffff) },
        map: { value: this.tex },
      },
      vertexShader: `
        attribute float alpha;
        attribute float psize;
        varying float vAlpha;
        void main() {
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = psize * (320.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 color;
        uniform sampler2D map;
        varying float vAlpha;
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(color, t.a * vAlpha);
        }`,
      transparent: true,
      depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.baseSize = opts.size || 1.0;
    this.lifeBase = opts.life || 1.0;
    this.growth = opts.growth || 1.0;
  }

  // Emit a single particle. Recycling the oldest slot in the circular buffer in-place.
  emit(pos, lifeMul = 1.0, sizeMul = 1.0, vel) {
    const p = this.pool[this.writeIndex];
    p.active = true;
    p.pos.copy(pos);
    if (vel) {
      p.vel.copy(vel);
      p.hasVel = true;
    } else {
      p.hasVel = false;
    }
    p.life = this.lifeBase * lifeMul;
    p.maxLife = this.lifeBase * lifeMul;
    p.sizeMul = sizeMul;
    p.rollPhase = Math.random() * Math.PI * 2;

    this.writeIndex = (this.writeIndex + 1) % this.max;
  }

  // Helper: emit a CLUSTER of N particles using static scratch vectors
  emitCluster(pos, count, spread, driftUp, lifeMul = 1.0, sizeMul = 1.0) {
    if (!ParticlePool._clusterPos) {
      ParticlePool._clusterPos = new THREE.Vector3();
      ParticlePool._clusterVel = new THREE.Vector3();
    }
    const cPos = ParticlePool._clusterPos;
    const cVel = ParticlePool._clusterVel;
    
    const r = spread;
    for (let k = 0; k < count; k++) {
      const u = Math.random(), v = Math.random(), w = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const rad = r * Math.cbrt(w);
      const ox = rad * Math.sin(phi) * Math.cos(theta);
      const oy = rad * Math.sin(phi) * Math.sin(theta);
      const oz = rad * Math.cos(phi);
      
      cPos.copy(pos);
      cPos.x += ox; cPos.y += oy; cPos.z += oz;
      
      const velScale = 0.15 + Math.random() * 0.35;
      cVel.set(
        ox * velScale,
        (oy * velScale) + (driftUp || 0) * (0.6 + Math.random() * 0.8),
        oz * velScale
      );
      
      const sizeJitter = 0.75 + Math.random() * 0.5;
      this.emit(cPos, lifeMul * (0.8 + Math.random() * 0.4), sizeMul * sizeJitter, cVel);
    }
  }

  update(dt) {
    // Idle pools (most of the ~15 pools, most of the time) skip the full-pool
    // scan AND the 3 attribute re-uploads — was a constant per-frame GPU
    // buffer upload even with zero live particles.
    if (this._wasEmpty === undefined) this._wasEmpty = false;
    let anyActive = false;
    for (let i = 0; i < this.max; i++) { if (this.pool[i].active) { anyActive = true; break; } }
    if (!anyActive) {
      if (!this._wasEmpty) {
        for (let i = 0; i < this.max; i++) this.alphas[i] = 0;
        this.geo.attributes.alpha.needsUpdate = true;
        this.geo.setDrawRange(0, 0);
        this._wasEmpty = true;
      }
      return;
    }
    this._wasEmpty = false;
    const dragK = Math.pow(0.6, dt);
    let activeParticles = 0;

    for (let i = 0; i < this.max; i++) {
      const p = this.pool[i];
      if (!p.active) continue;
      
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      
      if (p.hasVel) {
        p.pos.x += p.vel.x * dt;
        p.pos.y += p.vel.y * dt;
        p.pos.z += p.vel.z * dt;
        p.vel.multiplyScalar(dragK);
      }
      
      const t = 1 - p.life / p.maxLife;
      this.positions[activeParticles * 3] = p.pos.x;
      this.positions[activeParticles * 3 + 1] = p.pos.y;
      this.positions[activeParticles * 3 + 2] = p.pos.z;
      this.alphas[activeParticles] = (1 - t) * (1 - t);
      this.sizes[activeParticles] = this.baseSize * p.sizeMul * (1 + t * this.growth);
      
      activeParticles++;
    }
    
    for (let i = activeParticles; i < this.max; i++) {
      this.alphas[i] = 0;
    }
    
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
    this.geo.attributes.psize.needsUpdate = true;
    this.geo.setDrawRange(0, activeParticles);
  }
}

class StreamTrail {
  constructor(scene, opts = {}) {
    this.max = opts.max || 84;
    this.pointsData = [];
    this.positions = new Float32Array(this.max * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.mat = new THREE.LineBasicMaterial({
      color: opts.color || 0xf7fbff,
      transparent: true,
      opacity: opts.opacity || 0.56,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    this.line = new THREE.Line(this.geo, this.mat);
    this.line.frustumCulled = false;
    this.line.renderOrder = 8;
    scene.add(this.line);
    this.targetOpacity = this.mat.opacity;
    this.fadeRate = opts.fadeRate || 1.8;
  }
  addPoint(pos) {
    const last = this.pointsData[this.pointsData.length - 1];
    if (last && last.distanceToSquared(pos) < 0.18) return;
    this.pointsData.push(pos.clone());
    while (this.pointsData.length > this.max) this.pointsData.shift();
  }
  clear() {
    this.pointsData.length = 0;
    this.geo.setDrawRange(0, 0);
    this.geo.attributes.position.needsUpdate = true;
  }
  update(dt, active = false, opacity = 0.42) {
    this.targetOpacity = active ? opacity : 0;
    this.mat.opacity += (this.targetOpacity - this.mat.opacity) * Math.min(1, dt * 6.0);
    this.line.visible = this.mat.opacity > 0.01 || this.pointsData.length > 1;
    if (!active && this.pointsData.length) {
      const trim = Math.max(1, Math.round(dt * this.fadeRate * 18));
      this.pointsData.splice(0, Math.min(trim, this.pointsData.length));
    }
    const count = Math.min(this.pointsData.length, this.max);
    for (let i = 0; i < count; i++) {
      const p = this.pointsData[i];
      this.positions[i * 3] = p.x;
      this.positions[i * 3 + 1] = p.y;
      this.positions[i * 3 + 2] = p.z;
    }
    this.geo.setDrawRange(0, count);
    this.geo.attributes.position.needsUpdate = true;
  }
}

const sharedSpriteTex = makeSpriteTexture(64, 0.7);
// Multi-lobe cotton puff texture shared by the engine smoke pools. Larger
// canvas (128) gives enough resolution that the lobes read on screen.
const puffTex = makePuffTexture(128, 37);

// Log combat system availability once it's fully wired (moved below)
const combatState = {
  projectiles: [],
  missiles: [],
  fireCooldown: 0,
  missileCooldown: 0,
  // Mouse hold-to-fire gets its OWN flag so pollGamepadInput (which rewrites
  // fireHeld every frame) can't clobber it. fireHeld is the aggregate (gamepad
  // OR mouse) kept for HUD/visibility checks.
  mouseFireHeld: false,
  shotsFired: 0,
  shotHits: 0,
  missilesFired: 0,
  missileHits: 0,
  kills: 0,
  crashFxTriggered: false,
  crashBlastTimer: 0,
  // E16 — ammo is a belt of 300 rounds. Bullets are now lower-power
  // kinetic rounds; missiles carry the old explosive force one at a time.
  // The player starts light and earns the rest through active flight time
  // plus combat rewards, so weapons feel like resources instead of freebies.
  ammoStart: 120,
  ammo: 120,
  ammoMax: 300,
  ammoEarnRate: 7.5,
  ammoEarnBank: 0,
  ammoEarnedTotal: 0,
  missilesStart: 5,
  missilesAmmo: 5,
  missilesMax: 12,
  missileEarnInterval: 8,
  missileEarnBank: 0,
  missilesEarnedTotal: 0,
  supplyEarnSeconds: 0,
  supplyToastAmmo: 0,
  lastSupplyAwardAt: 0,
  lastSupplyFlashAt: 0,
  missileSide: -1,
  alienWeaponUntil: 0,
  alienWeaponLastAwardAt: 0,
  lastFiredAt: 0,
  dryClickUntil: 0,
  heat: 0,
  overheatedUntil: 0,
  lastHeatWarnAt: 0,
  heatCoolRate: 0.34,
  gunHeatPerBurst: 0.065,
  missileHeatPerShot: 0.22,
  flaresAmmo: 4,
  flaresMax: 4,
  flareCooldown: 0,
  smokeAmmo: 2,
  smokeMax: 2,
  smokeCooldown: 0,
  countermeasureUntil: 0,
  smokeScreenUntil: 0,
  smokeScreenTimer: 0,
  flarePressed: false,
  smokePressed: false,
  activeShooterId: '',
  activeShooterUntil: 0,
  spaceDown: false,
  lastSpaceTapAt: 0,
  spaceMissileQueued: false,
  suppressSpaceGunsUntil: 0,
  gunMode: 0,
  gunModePressed: false,
  overdrivePressed: false,
  overdriveActive: false,
  overdriveUntil: 0,
};
// ── Weapon progression (persistent tiers, gun modes, shield overdrive) ──────
// Persisted per-browser (no accounts). The blob holds ONLY tiers/xp/mode/
// charges — tier EFFECTS are applied at read-sites via getters (multipliers)
// or written into transient combatState caps by applyWeaponTierStats(); they
// are never stored, so the save stays forward-compatible. Tiers only ever
// climb and survive death/reset (resetCombatState/healPlane never touch them).
const WEAPON_TIER_KEY = 'e115-weapon-tiers-v1';
const weaponProgress = { gun: 0, msl: 0, gunMode: 0, overdriveCharges: 1, xpKills: 0, xpMslKills: 0, xpScore: 0 };
const ROMAN = ['', 'I', 'II', 'III'];
const GUN_MODE_NAMES = ['STANDARD', 'RAPID', 'HEAVY', 'SCATTER'];
const GUN_MODE_SHORT = ['STD', 'RAPID', 'HEAVY', 'SCAT'];
// gun-tier tables (index = gun tier 0..3)
const GUN_COOLDOWN_MUL = [1, 0.85, 0.72, 0.6];
const GUN_SPREAD_TIER = [1, 0.9, 0.82, 0.72];
const GUN_AMMOMAX_BONUS = [0, 60, 120, 200];
const GUN_EARN_BONUS = [0, 2, 4, 6];
// gun-mode tables (index = mode 0..3)
const GMODE_COOLDOWN_MUL = [1, 0.6, 1.8, 1];
const GMODE_SPREAD_MUL = [1, 1.4, 0.6, 1];
const GMODE_DAMAGE_MUL = [1, 1, 2.2, 1];
const GMODE_AMMO = [2, 4, 2, 6];
// msl-tier tables (index = msl tier 0..3)
const MSL_MAX_BONUS = [0, 2, 4, 6];
const MSL_LOCK_MUL = [1, 1.15, 1.3, 1.5];
const MSL_COOLDOWN_MUL = [1, 0.9, 0.8, 0.7];
const _wpnUp = new THREE.Vector3();
const _wpnRight = new THREE.Vector3();
function _wclampInt(v, lo, hi) { v = Math.round(Number(v) || 0); return v < lo ? lo : v > hi ? hi : v; }
// Read-site getters — the ONLY way tier/mode effects reach the sim.
function gunCooldownMul() { return GUN_COOLDOWN_MUL[weaponProgress.gun] * GMODE_COOLDOWN_MUL[weaponProgress.gunMode]; }
function gunSpreadMul() { return GUN_SPREAD_TIER[weaponProgress.gun] * GMODE_SPREAD_MUL[weaponProgress.gunMode]; }
function gunDamageMul() { return GMODE_DAMAGE_MUL[weaponProgress.gunMode]; }
function gunAmmoPerBurst() { return GMODE_AMMO[weaponProgress.gunMode]; }
function gunIsScatter() { return weaponProgress.gunMode === 3; }
function mslLockMul() { return MSL_LOCK_MUL[weaponProgress.msl]; }
function mslCooldownMul() { return MSL_COOLDOWN_MUL[weaponProgress.msl]; }
// Fold additive tier caps into transient combatState (NOT persisted).
function applyWeaponTierStats() {
  if (typeof combatState === 'undefined') return;
  combatState.ammoMax = 300 + GUN_AMMOMAX_BONUS[weaponProgress.gun];
  combatState.ammoEarnRate = 7.5 + GUN_EARN_BONUS[weaponProgress.gun];
  combatState.missilesMax = 12 + MSL_MAX_BONUS[weaponProgress.msl];
  if (combatState.ammo > combatState.ammoMax) combatState.ammo = combatState.ammoMax;
  if (combatState.missilesAmmo > combatState.missilesMax) combatState.missilesAmmo = combatState.missilesMax;
  if (weaponProgress.gunMode > weaponProgress.gun) weaponProgress.gunMode = weaponProgress.gun;
  combatState.gunMode = weaponProgress.gunMode;
}
function loadWeaponProgress() {
  try {
    const raw = localStorage.getItem(WEAPON_TIER_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && typeof d === 'object') {
        weaponProgress.gun = _wclampInt(d.gun, 0, 3);
        weaponProgress.msl = _wclampInt(d.msl, 0, 3);
        weaponProgress.gunMode = _wclampInt(d.gunMode, 0, 3);
        weaponProgress.overdriveCharges = d.overdriveCharges != null ? _wclampInt(d.overdriveCharges, 0, 2) : weaponProgress.overdriveCharges;
        weaponProgress.xpKills = Math.max(0, Number(d.xpKills) || 0);
        weaponProgress.xpMslKills = Math.max(0, Number(d.xpMslKills) || 0);
        weaponProgress.xpScore = Math.max(0, Number(d.xpScore) || 0);
      }
    }
  } catch (e) {}
  if (weaponProgress.gunMode > weaponProgress.gun) weaponProgress.gunMode = weaponProgress.gun;
  applyWeaponTierStats();
}
function saveWeaponProgress() { try { localStorage.setItem(WEAPON_TIER_KEY, JSON.stringify(weaponProgress)); } catch (e) {} }
function checkWeaponMilestones() {
  let changed = false;
  const gk = weaponProgress.xpKills || 0;
  const gt = gk >= 75 ? 3 : gk >= 30 ? 2 : gk >= 10 ? 1 : 0;
  if (gt > weaponProgress.gun) {
    weaponProgress.gun = gt; changed = true;
    if (typeof flashStatus === 'function') flashStatus('GUNS UPGRADED · TIER ' + ROMAN[gt], 'panel ok', 1.6);
  }
  const ms = weaponProgress.xpScore || 0, mk = weaponProgress.xpMslKills || 0;
  const mt = (ms >= 12000 || mk >= 35) ? 3 : (ms >= 5000 || mk >= 15) ? 2 : (ms >= 1500 || mk >= 5) ? 1 : 0;
  if (mt > weaponProgress.msl) {
    weaponProgress.msl = mt; changed = true;
    if (typeof flashStatus === 'function') flashStatus('MISSILES UPGRADED · TIER ' + ROMAN[mt], 'panel ok', 1.6);
  }
  if (changed) applyWeaponTierStats();
  return changed;
}
function recordCombatKill(source) {
  weaponProgress.xpKills = (weaponProgress.xpKills || 0) + 1;
  if (source === 'missile') weaponProgress.xpMslKills = (weaponProgress.xpMslKills || 0) + 1;
  checkWeaponMilestones();
  saveWeaponProgress();
}
function recordCombatScore(pts) {
  if (!(pts > 0)) return;
  weaponProgress.xpScore = (weaponProgress.xpScore || 0) + pts;
  if (checkWeaponMilestones()) saveWeaponProgress();
}
function cycleGunMode() {
  const maxMode = weaponProgress.gun;
  if (maxMode <= 0) { if (typeof flashStatus === 'function') flashStatus('GUN MODES LOCKED · REACH GUN TIER I', 'panel warn', 1.0); return; }
  weaponProgress.gunMode = ((weaponProgress.gunMode | 0) + 1) % (maxMode + 1);
  applyWeaponTierStats();
  saveWeaponProgress();
  if (typeof flashStatus === 'function') flashStatus('GUN MODE · ' + GUN_MODE_NAMES[weaponProgress.gunMode], 'panel ok', 1.1);
}
function overdriveActive() { return !!combatState.overdriveActive && performance.now() < combatState.overdriveUntil; }
function activateShieldOverdrive() {
  if (typeof plane === 'undefined' || !plane || plane.crashed) return false;
  if (overdriveActive()) { if (typeof flashStatus === 'function') flashStatus('SHIELD OVERDRIVE ALREADY ACTIVE', 'panel warn', 0.8); return false; }
  if ((weaponProgress.overdriveCharges || 0) <= 0) { if (typeof flashStatus === 'function') flashStatus('NO OVERDRIVE CHARGE', 'panel warn', 0.9); return false; }
  weaponProgress.overdriveCharges -= 1;
  saveWeaponProgress();
  combatState.overdriveActive = true;
  combatState.overdriveUntil = performance.now() + 14000;
  plane.shieldMax = 300;
  plane.shield = 300;
  plane.shieldPulse = Math.min(1.8, (plane.shieldPulse || 0) + 1.4);
  if (typeof flashStatus === 'function') flashStatus('SHIELD OVERDRIVE · 14S', 'panel ok', 1.4);
  return true;
}
function updateShieldOverdrive() {
  if (!combatState.overdriveActive) return;
  if (performance.now() >= combatState.overdriveUntil) deactivateShieldOverdrive(false);
}
function deactivateShieldOverdrive(silent) {
  const wasActive = !!combatState.overdriveActive;
  combatState.overdriveActive = false;
  combatState.overdriveUntil = 0;
  if (typeof plane !== 'undefined' && plane) {
    plane.shieldMax = 150;
    if (plane.shield > 150) plane.shield = 150;
  }
  if (wasActive && !silent && typeof flashStatus === 'function') flashStatus('OVERDRIVE EXPIRED · SHIELD 150', 'panel warn', 1.1);
}
function addOverdriveCharge(n) {
  weaponProgress.overdriveCharges = Math.min(2, (weaponProgress.overdriveCharges || 0) + (n || 1));
  saveWeaponProgress();
}
loadWeaponProgress();
window.addEventListener('beforeunload', saveWeaponProgress);
window.__weaponProgress = weaponProgress;

const projectileGroup = new THREE.Group();
scene.add(projectileGroup);
const projectileCoreGeo = new THREE.BoxGeometry(0.12, 0.12, 3.2);
const projectileShellGeo = new THREE.BoxGeometry(0.28, 0.28, 6.4);
const projectileHaloGeo = new THREE.BoxGeometry(0.48, 0.48, 9.2);
const projectileCoreMat = new THREE.MeshBasicMaterial({ color: 0xfffde8, toneMapped: false });
const projectileShellMat = new THREE.MeshBasicMaterial({
  color: 0xffb14d,
  toneMapped: false,
  transparent: true,
  opacity: 0.92,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const tracerHaloMat = new THREE.MeshBasicMaterial({
  color: 0xff5e2c,
  toneMapped: false,
  transparent: true,
  opacity: 0.34,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
for (let i = 0; i < 72; i++) {
  const mesh = new THREE.Group();
  const halo = new THREE.Mesh(projectileHaloGeo, tracerHaloMat.clone());
  const shell = new THREE.Mesh(projectileShellGeo, projectileShellMat.clone());
  const core = new THREE.Mesh(projectileCoreGeo, projectileCoreMat.clone());
  halo.renderOrder = 28;
  shell.renderOrder = 29;
  core.renderOrder = 30;
  mesh.add(halo);
  mesh.add(shell);
  mesh.add(core);
  mesh.visible = false;
  projectileGroup.add(mesh);
  combatState.projectiles.push({
    mesh,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    life: 0,
    active: false,
    halo,
    shell,
    core,
    damage: 0.36,
    intensity: 0.36,
    source: 'shot',
    type: 'bullet',
  });
}

const missileGroup = new THREE.Group();
scene.add(missileGroup);
const missileBodyGeo = new THREE.CylinderGeometry(0.24, 0.34, 3.15, 12);
const missileNoseGeo = new THREE.ConeGeometry(0.36, 0.78, 12);
const missileFinGeo = new THREE.BoxGeometry(0.68, 0.052, 0.32);
const missileBodyMat = new THREE.MeshStandardMaterial({ color: 0xd8dde4, roughness: 0.42, metalness: 0.36 });
const missileGlowMat = new THREE.MeshBasicMaterial({ color: 0x7de7ff, transparent: true, opacity: 0.72, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
for (let i = 0; i < 8; i++) {
  const mesh = new THREE.Group();
  const body = new THREE.Mesh(missileBodyGeo, missileBodyMat.clone());
  body.rotation.x = Math.PI / 2;
  const nose = new THREE.Mesh(missileNoseGeo, missileBodyMat.clone());
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -1.7;
  const flare = new THREE.Mesh(new THREE.SphereGeometry(0.52, 12, 9), missileGlowMat.clone());
  flare.position.z = 1.78;
  const finL = new THREE.Mesh(missileFinGeo, missileBodyMat.clone());
  finL.position.set(-0.43, 0, 1.05);
  const finR = finL.clone();
  finR.position.x = 0.32;
  mesh.add(body, nose, flare, finL, finR);
  mesh.visible = false;
  missileGroup.add(mesh);
  combatState.missiles.push({
    mesh,
    flare,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    target: null,
    targetId: '',
    life: 0,
    active: false,
    side: 1,
    smokeTimer: 0,
    launchAge: 0,
    ignitionDelay: 0.52,
    engineLit: false,
    launchForward: new THREE.Vector3(0, 0, -1),
    dropDir: new THREE.Vector3(0, -1, 0),
  });
}
const muzzleFlashPool = new ParticlePool(scene, {
  max: 110, color: 0xfff0b8, size: 1.65,
  life: 0.18, growth: 3.4, additive: true, texture: sharedSpriteTex,
});
const impactSparkPool = new ParticlePool(scene, {
  max: 420, color: 0xffdf9c, size: 1.45,
  life: 0.82, growth: 2.8, additive: true, texture: sharedSpriteTex,
});
const impactBlastPool = new ParticlePool(scene, {
  max: 360, color: 0xff9d57, size: 3.0,
  life: 0.42, growth: 6.8, additive: true, texture: sharedSpriteTex,
});
const explosionFirePool = new ParticlePool(scene, {
  max: 520, color: 0xff9448, size: 4.6,
  life: 1.05, growth: 6.2, additive: true, texture: sharedSpriteTex,
});
const explosionSmokePool = new ParticlePool(scene, {
  max: 620, color: 0x2c2520, size: 5.1,
  life: 2.8, growth: 8.0, additive: false, texture: puffTex,
});
const crashBlast = new THREE.Sprite(new THREE.SpriteMaterial({
  map: makeSpriteTexture(256, 0.32),
  color: 0xff9a48,
  transparent: true,
  opacity: 0.0,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  depthTest: false,
  toneMapped: false,
}));
crashBlast.visible = false;
scene.add(crashBlast);

// --- R5 F13: pooled expanding shockwave rings (emissive sprites, NO lights / I5) ---
// Radial ring texture: transparent core, bright ~0.78r annulus, soft outer falloff.
function makeRingTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const cx = size / 2;
  const grad = g.createRadialGradient(cx, cx, 0, cx, cx, cx);
  grad.addColorStop(0.00, 'rgba(255,255,255,0)');
  grad.addColorStop(0.60, 'rgba(255,244,224,0)');
  grad.addColorStop(0.78, 'rgba(255,250,236,1)');
  grad.addColorStop(0.90, 'rgba(255,232,198,0.32)');
  grad.addColorStop(1.00, 'rgba(255,214,170,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}
// Small pool of camera-facing ring sprites. Each ring owns its material so it
// can fade independently; the texture is shared. Additive, depthTest off so the
// flash always reads, like crashBlast.
class ShockwaveRingPool {
  constructor(scene, max = 8) {
    const tex = makeRingTexture(128);
    this.rings = [];
    for (let i = 0; i < max; i++) {
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex,
        color: 0xfff2d6,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      }));
      spr.visible = false;
      spr.renderOrder = 9;
      scene.add(spr);
      this.rings.push({ spr, age: 0, life: 0, startScale: 2, endScale: 55, peakOpacity: 0.7 });
    }
    this.writeIndex = 0;
  }
  emit(pos, opts = {}) {
    const r = this.rings[this.writeIndex];
    this.writeIndex = (this.writeIndex + 1) % this.rings.length;
    r.age = 0;
    r.life = opts.life || 0.55;
    r.startScale = opts.startScale || 2.0;
    r.endScale = opts.endScale || 55.0;
    r.peakOpacity = opts.opacity != null ? opts.opacity : 0.7;
    r.spr.position.copy(pos);
    if (opts.color != null) r.spr.material.color.set(opts.color);
    r.spr.material.opacity = r.peakOpacity;
    r.spr.scale.set(r.startScale, r.startScale, 1);
    r.spr.visible = true;
  }
  update(dt) {
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      if (!r.spr.visible) continue;
      r.age += dt;
      const t = r.age / r.life;
      if (t >= 1) { r.spr.visible = false; r.spr.material.opacity = 0; continue; }
      const ease = 1 - (1 - t) * (1 - t);
      const s = r.startScale + (r.endScale - r.startScale) * ease;
      r.spr.scale.set(s, s, 1);
      r.spr.material.opacity = r.peakOpacity * (1 - t);
    }
  }
}
const shockwaveRingPool = new ShockwaveRingPool(scene, 8);

// --- R5 F14: pooled saucer debris (InstancedMesh, one shared material / I5,I6) ---
// Tiny faceted tetrahedra: dark hull chunks with a faint energized emissive so
// they read at night. Gravity + tumble, fade-by-scale at end of life. Zero
// per-frame allocation (single scratch Object3D).
const debrisFieldFX = (() => {
  const MAX = 40;
  const geo = new THREE.TetrahedronGeometry(0.6, 0);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x15131c,
    emissive: 0x1d5560,
    emissiveIntensity: 0.7,
    roughness: 0.65,
    metalness: 0.25,
    flatShading: true,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = MAX;
  scene.add(mesh);
  const parts = [];
  for (let i = 0; i < MAX; i++) {
    parts.push({
      active: false,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      rot: new THREE.Euler(),
      spin: new THREE.Vector3(),
      life: 0, maxLife: 1.6, baseScale: 1,
    });
  }
  let writeIndex = 0;
  const dummy = new THREE.Object3D();
  // Park every instance at zero scale so nothing shows until a burst.
  dummy.position.set(0, -9999, 0);
  dummy.scale.set(0, 0, 0);
  dummy.updateMatrix();
  for (let i = 0; i < MAX; i++) mesh.setMatrixAt(i, dummy.matrix);
  mesh.instanceMatrix.needsUpdate = true;
  return {
    burst(pos, count = 8) {
      count = Math.max(4, Math.min(12, count | 0));
      for (let k = 0; k < count; k++) {
        const p = parts[writeIndex];
        writeIndex = (writeIndex + 1) % MAX;
        p.active = true;
        p.pos.copy(pos);
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const speed = 8 + Math.random() * 18; // 8-26 m/s radial
        p.vel.set(
          Math.sin(phi) * Math.cos(theta) * speed,
          Math.abs(Math.cos(phi)) * speed * 0.7 + 4,
          Math.sin(phi) * Math.sin(theta) * speed
        );
        p.rot.set(Math.random() * 6.283, Math.random() * 6.283, Math.random() * 6.283);
        p.spin.set((Math.random() - 0.5) * 11, (Math.random() - 0.5) * 11, (Math.random() - 0.5) * 11);
        p.life = p.maxLife = 1.6;
        p.baseScale = 0.7 + Math.random() * 0.8;
      }
    },
    update(dt) {
      let any = false;
      for (let i = 0; i < MAX; i++) {
        const p = parts[i];
        if (!p.active) continue;
        any = true;
        p.life -= dt;
        if (p.life <= 0) {
          p.active = false;
          dummy.position.set(0, -9999, 0);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(0, 0, 0);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          continue;
        }
        p.vel.y -= 9.8 * dt * 2.0;
        p.pos.addScaledVector(p.vel, dt);
        p.rot.x += p.spin.x * dt;
        p.rot.y += p.spin.y * dt;
        p.rot.z += p.spin.z * dt;
        const lifeT = p.life / p.maxLife;
        const s = p.baseScale * Math.min(1, lifeT * 3.0); // fade-by-scale in final third
        dummy.position.copy(p.pos);
        dummy.rotation.copy(p.rot);
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      if (any) mesh.instanceMatrix.needsUpdate = true;
    },
  };
})();

const groundScorchFX = (() => {
  const COUNT = 18;
  const tex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 6, 64, 64, 60);
    grad.addColorStop(0, 'rgba(10,8,6,0.88)');
    grad.addColorStop(0.45, 'rgba(22,18,14,0.62)');
    grad.addColorStop(0.82, 'rgba(38,28,22,0.18)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 10 + Math.random() * 44;
      const x = 64 + Math.cos(a) * r;
      const y = 64 + Math.sin(a) * r;
      const s = 2 + Math.random() * 8;
      g.fillStyle = `rgba(8,6,5,${0.12 + Math.random() * 0.22})`;
      g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace || t.colorSpace;
    return t;
  })();
  const pool = [];
  for (let i = 0; i < COUNT; i++) {
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 2;
    mesh.visible = false;
    scene.add(mesh);
    pool.push({ mesh, age: Infinity, life: 0, active: false });
  }
  return {
    spawn(pos, size = 1.0) {
      let slot = pool.find(p => !p.active);
      if (!slot) slot = pool.reduce((a, b) => (a.age > b.age ? a : b));
      slot.mesh.position.set(pos.x, pos.y + 0.03, pos.z);
      slot.mesh.rotation.z = Math.random() * Math.PI * 2;
      const s = 4.8 + size * 5.6;
      slot.mesh.scale.set(s, s, 1);
      slot.mesh.material.opacity = Math.min(0.72, 0.32 + size * 0.18);
      slot.mesh.visible = true;
      slot.age = 0;
      slot.life = 16 + size * 18;
      slot.active = true;
    },
    update(dt) {
      for (const p of pool) {
        if (!p.active) continue;
        p.age += dt;
        const fadeIn = Math.min(1, p.age / 0.18);
        const fadeOut = p.age > p.life ? Math.max(0, 1 - (p.age - p.life) / 5.5) : 1;
        p.mesh.material.opacity = Math.min(p.mesh.material.opacity, 0.72) * fadeIn * fadeOut;
        if (fadeOut <= 0.01) {
          p.active = false;
          p.mesh.visible = false;
          p.mesh.material.opacity = 0;
          p.age = Infinity;
          p.life = 0;
        }
      }
    },
    clear() {
      for (const p of pool) {
        p.active = false;
        p.mesh.visible = false;
        p.mesh.material.opacity = 0;
        p.age = Infinity;
        p.life = 0;
      }
    }
  };
})();
const bulletSurfaceDamageFX = (() => {
  const COUNT = 96;
  const tex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(48, 48, 1, 48, 48, 45);
    grad.addColorStop(0, 'rgba(4,3,2,0.95)');
    grad.addColorStop(0.23, 'rgba(18,13,9,0.76)');
    grad.addColorStop(0.52, 'rgba(48,34,24,0.22)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 96, 96);
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 7 + Math.random() * 22;
      const x = 48 + Math.cos(a) * r;
      const y = 48 + Math.sin(a) * r;
      g.fillStyle = `rgba(5,4,3,${0.18 + Math.random() * 0.32})`;
      g.beginPath(); g.arc(x, y, 1.2 + Math.random() * 3.4, 0, Math.PI * 2); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace || t.colorSpace;
    return t;
  })();
  const pool = [];
  for (let i = 0; i < COUNT; i++) {
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
      color: 0xffffff,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 3;
    mesh.visible = false;
    scene.add(mesh);
    pool.push({ mesh, age: Infinity, life: 0, active: false, baseOpacity: 0 });
  }
  return {
    spawn(pos, size = 1.0, opts = {}) {
      let slot = pool.find(p => !p.active);
      if (!slot) slot = pool.reduce((a, b) => (a.age > b.age ? a : b));
      const jitter = opts.jitter || 0.18;
      slot.mesh.position.set(
        pos.x + (Math.random() - 0.5) * jitter,
        pos.y + 0.055 + Math.random() * 0.018,
        pos.z + (Math.random() - 0.5) * jitter
      );
      slot.mesh.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
      const s = Math.max(0.45, 0.72 + size * 1.45) * (0.82 + Math.random() * 0.44);
      slot.mesh.scale.set(s, s * (0.72 + Math.random() * 0.42), 1);
      slot.baseOpacity = Math.min(0.46, 0.2 + size * 0.12);
      slot.mesh.material.opacity = slot.baseOpacity;
      slot.mesh.material.color.setHex(opts.color || 0xffffff);
      slot.mesh.visible = true;
      slot.age = 0;
      slot.life = opts.life || (7.5 + Math.random() * 9.0 + size * 4.0);
      slot.active = true;
    },
    update(dt) {
      for (const p of pool) {
        if (!p.active) continue;
        p.age += dt;
        const fadeIn = Math.min(1, p.age / 0.08);
        const fadeOut = p.age > p.life ? Math.max(0, 1 - (p.age - p.life) / 3.8) : 1;
        p.mesh.material.opacity = p.baseOpacity * fadeIn * fadeOut;
        if (fadeOut <= 0.01) {
          p.active = false;
          p.mesh.visible = false;
          p.mesh.material.opacity = 0;
          p.age = Infinity;
          p.life = 0;
        }
      }
    },
    clear() {
      for (const p of pool) {
        p.active = false;
        p.mesh.visible = false;
        p.mesh.material.opacity = 0;
        p.age = Infinity;
        p.life = 0;
      }
    },
    activeCount() {
      return pool.reduce((n, p) => n + (p.active ? 1 : 0), 0);
    }
  };
})();

function spawnGunSurfaceDamage(pos, opts = {}) {
  const bullet = opts.type !== 'alien';
  const size = bullet ? (opts.size || 0.38) : (opts.size || 0.72);
  const color = bullet ? 0xffffff : 0x80f4ff;
  if (bulletSurfaceDamageFX) bulletSurfaceDamageFX.spawn(pos, size, { color, life: bullet ? 10 + Math.random() * 8 : 4.5 + Math.random() * 3, jitter: bullet ? 0.34 : 0.5 });
  if (groundScorchFX && bullet && Math.random() < 0.28) groundScorchFX.spawn(pos, 0.08 + size * 0.14);
  const sparkCount = bullet ? 2 + Math.floor(Math.random() * 3) : 5;
  impactSparkPool.emitCluster(pos, sparkCount, bullet ? 0.22 : 0.55, 0.08, bullet ? 0.16 : 0.28, bullet ? 0.34 : 0.66);
}
const _combatTmpA = new THREE.Vector3();
const _combatTmpB = new THREE.Vector3();
const _combatTmpC = new THREE.Vector3();
const _combatTmpD = new THREE.Vector3();
const _combatTmpE = new THREE.Vector3();
const _combatTmpF = new THREE.Vector3();
const _combatCrashOffset = new THREE.Vector3(0, 2.4, -1.2);
const _combatCrashRingOffset = new THREE.Vector3(0, 2.4, 0);
const _projectileForward = new THREE.Vector3(0, 0, 1);
const _missileForward = new THREE.Vector3(0, 0, -1);

function alienWeaponActive(now = performance.now()) {
  return now < (combatState.alienWeaponUntil || 0);
}

function setProjectileVisual(p, type = 'bullet') {
  p.type = type;
  const alien = type === 'alien' || type === 'ufo-pulse';
  const hostile = type === 'ufo-pulse';
  if (p.halo && p.halo.material) {
    p.halo.material.color.setHex(hostile ? 0x22ff88 : alien ? 0x31d9ff : 0xff5e2c);
    p.halo.material.opacity = hostile ? 0.72 : alien ? 0.62 : 0.22;
  }
  if (p.shell && p.shell.material) {
    p.shell.material.color.setHex(hostile ? 0x42f5ff : alien ? 0x74efff : 0xffb14d);
    p.shell.material.opacity = hostile ? 0.98 : alien ? 0.96 : 0.58;
  }
  if (p.core && p.core.material) {
    p.core.material.color.setHex(hostile ? 0xd8fff0 : alien ? 0xd9fdff : 0xfffde8);
  }
  p.mesh.scale.set(hostile ? 1.45 : alien ? 1.22 : 0.62, hostile ? 1.45 : alien ? 1.22 : 0.62, hostile ? 1.35 : alien ? 1.18 : 0.42);
}

function deactivateMissile(m) {
  m.active = false;
  m.life = 0;
  m.target = null;
  m.targetId = '';
  m.smokeTimer = 0;
  m.launchAge = 0;
  m.engineLit = false;
  if (m.flare && m.flare.material) {
    m.flare.material.opacity = 0;
    m.flare.scale.setScalar(1);
  }
  m.mesh.visible = false;
}

function getMissileTarget() {
  const target = targetHudState.activeTarget;
  if (!target || target.kind !== 'traffic' || !target.destructible || !target.destructible.alive) return null;
  if ((targetHudState.lockAmount || 0) < 0.18 && targetHudState.activeId !== target.id) return null;
  return target;
}

function activateAlienWeapon(durationSec = 30) {
  const until = performance.now() + durationSec * 1000;
  combatState.alienWeaponUntil = Math.max(combatState.alienWeaponUntil || 0, until);
  if (typeof flashStatus === 'function') flashStatus(`ALIEN BLUE PULSE ONLINE · ${durationSec}S`, 'panel ok', 1.8);
  if (typeof window.showComboBanner === 'function') window.showComboBanner('ALIEN WEAPON', 'BLUE PULSE · 30 SECONDS', '#74efff');
}

function maybeAwardAlienWeapon() {
  if (combatState.kills > 0 && combatState.kills % 3 === 0 && combatState.alienWeaponLastAwardAt !== combatState.kills) {
    combatState.alienWeaponLastAwardAt = combatState.kills;
    activateAlienWeapon(30);
  }
}

function markAlienReaction(target, source = 'shot') {
  const rec = target && target.trafficRef;
  if (!rec || rec.targetKind !== 'ufo-saucer') return;
  const now = performance.now();
  rec.aiMode = source === 'missile' || (target.health <= Math.max(1, target.maxHealth * 0.55) && Math.random() > 0.35) ? 'flee' : 'dogfight';
  rec.aiUntil = now + (rec.aiMode === 'flee' ? 5200 : 7800);
  rec.evasivePhase = Math.random() * Math.PI * 2;
}

function fireMissile() {
  const now = performance.now();
  if (now < (combatState.overheatedUntil || 0)) {
    if (now - (combatState.lastHeatWarnAt || 0) > 700) {
      combatState.lastHeatWarnAt = now;
      if (typeof flashStatus === 'function') flashStatus('WEAPONS OVERHEATED · COOLING', 'panel warn', 0.8);
    }
    return false;
  }
  if (combatState.missileCooldown > 0 || combatState.missilesAmmo <= 0 || plane.crashed || combatState.missiles.some(m => m.active)) {
    if (combatState.missilesAmmo <= 0 && typeof flashStatus === 'function') flashStatus('MISSILES EMPTY · KEEP FLYING TO EARN', 'panel warn', 0.9);
    else if (combatState.missiles.some(m => m.active) && typeof flashStatus === 'function') {
      combatState.missileCooldown = Math.max(combatState.missileCooldown, 0.45);
      flashStatus('MISSILE IN FLIGHT', 'panel warn', 0.55);
    }
    return false;
  }
  const missile = combatState.missiles.find(m => !m.active);
  if (!missile) return false;
  const side = combatState.missileSide > 0 ? 1 : -1;
  combatState.missileSide = -side;
  combatState.missilesAmmo = Math.max(0, combatState.missilesAmmo - 1);
  combatState.missilesFired += 1;
  combatState.heat = Math.min(1.25, (combatState.heat || 0) + (combatState.missileHeatPerShot || 0.22));
  if (combatState.heat >= 1) combatState.overheatedUntil = Math.max(combatState.overheatedUntil || 0, performance.now() + 2300);
  combatState.missileCooldown = 0.72 * mslCooldownMul();
  combatState.lastFiredAt = performance.now();
  const forward = _combatTmpA.set(0, 0, -1).applyQuaternion(plane.quat).normalize();
  const anchor = side < 0 ? (jet.userData.missileL || jet.userData.gunL) : (jet.userData.missileR || jet.userData.gunR);
  missile.pos.copy(anchor || _combatTmpB.set(side * 4.0, -0.35, 0.4)).applyQuaternion(plane.quat).add(plane.pos);
  const dropDir = _combatTmpC.set(0, -1, 0).applyQuaternion(plane.quat).normalize();
  missile.vel.copy(plane.vel).addScaledVector(forward, 38).addScaledVector(dropDir, 18);
  missile.target = getMissileTarget();
  missile.targetId = missile.target ? missile.target.id : '';
  missile.life = 6.8;
  missile.active = true;
  missile.side = side;
  missile.launchAge = 0;
  missile.ignitionDelay = 0.48 + Math.random() * 0.12;
  missile.engineLit = false;
  missile.launchForward.copy(forward);
  missile.dropDir.copy(dropDir);
  if (missile.flare && missile.flare.material) missile.flare.material.opacity = 0;
  missile.mesh.visible = true;
  missile.mesh.position.copy(missile.pos);
  missile.mesh.quaternion.setFromUnitVectors(_missileForward, forward);
  const launchBack = missile.pos.clone().addScaledVector(forward, -1.4).addScaledVector(dropDir, 0.45);
  muzzleFlashPool.emitCluster(missile.pos, 9, 0.34, 0.12, 0.46, 0.78);
  impactBlastPool.emitCluster(launchBack, 12, 1.16, 0.10, 0.52, 1.15);
  explosionFirePool.emitCluster(launchBack, 12, 1.55, 0.18, 0.54, 1.05);
  explosionSmokePool.emitCluster(launchBack.clone().addScaledVector(forward, -1.1), 16, 1.7, 0.24, 1.35, 1.45);
  if (typeof playSfx === 'function') playSfx('mg-burst', { throttleMs: 90, maxMs: 190, volume: 0.84, rate: 0.62 });
  if (typeof flashStatus === 'function') flashStatus(missile.target ? `MISSILE DROPPED · ${missile.target.label}` : 'MISSILE DROPPED · DUMB FIRE', 'panel ok', 0.85);
  return true;
}

function deactivateProjectile(p) {
  p.active = false;
  p.life = 0;
  p.target = null;
  p.targetId = '';
  p.mesh.visible = false;
}

function getTargetWorldPosition(target, out) {
  target.object.getWorldPosition(out);
  return out;
}

function spawnExplosion(pos, intensity = 1.0, smokeMul = 1.0) {
  impactBlastPool.emitCluster(pos, Math.round(5 + intensity * 7), 0.9 + intensity * 0.8, 0.22, 0.42 + intensity * 0.18, 1.1 + intensity * 0.9);
  explosionFirePool.emitCluster(pos, Math.round(10 + intensity * 8), 1.6 + intensity * 1.1, 0.45, 0.9 + intensity * 0.35, 1.0 + intensity * 0.65);
  explosionSmokePool.emitCluster(pos, Math.round(10 + smokeMul * 8), 2.0 + smokeMul * 1.3, 0.8, 1.0 + smokeMul * 0.5, 1.0 + smokeMul * 0.8);
  impactSparkPool.emitCluster(pos, Math.round(8 + intensity * 10), 1.0 + intensity * 0.7, 0.55, 0.7 + intensity * 0.2, 1.1 + intensity * 0.5);
}

function spawnSaucerMissileExplosion(pos, killShot = false, intensity = 1.0) {
  const boom = killShot ? 2.9 + intensity * 0.45 : 1.55 + intensity * 0.35;
  spawnExplosion(pos, boom, boom * 1.15);
  const offsetA = pos.clone().add(new THREE.Vector3(2.8, 0.9, -1.9).multiplyScalar(killShot ? 1.65 : 1.0));
  const offsetB = pos.clone().add(new THREE.Vector3(-2.4, -0.35, 2.2).multiplyScalar(killShot ? 1.35 : 0.92));
  setTimeout(() => spawnExplosion(offsetA, boom * (killShot ? 0.82 : 0.62), boom * 0.8), killShot ? 90 : 70);
  if (killShot) setTimeout(() => spawnExplosion(offsetB, boom * 0.62, boom * 0.72), 185);
  impactSparkPool.emitCluster(pos, killShot ? 42 : 24, killShot ? 2.5 : 1.45, 0.42, killShot ? 1.35 : 0.88, killShot ? 2.2 : 1.35);
  explosionSmokePool.emitCluster(pos.clone().add(new THREE.Vector3(0, 2.2, 0)), killShot ? 38 : 18, killShot ? 4.8 : 2.5, 0.75, killShot ? 2.3 : 1.45, killShot ? 2.2 : 1.2);
  if (typeof playSfx3D === 'function') playSfx3D('explosion', pos, { volume: killShot ? 0.96 : 0.72, throttleMs: killShot ? 35 : 70, rate: killShot ? 0.88 : 0.96 });
}

function spawnGroundImpactExplosion(pos, intensity = 1.0) {
  const base = pos.clone();
  impactBlastPool.emitCluster(base, Math.round(14 + intensity * 14), 1.9 + intensity * 1.3, 0.16, 0.84 + intensity * 0.32, 1.9 + intensity * 1.15);
  explosionFirePool.emitCluster(base, Math.round(18 + intensity * 16), 2.8 + intensity * 1.8, 0.32, 1.2 + intensity * 0.55, 1.6 + intensity * 1.0);
  explosionSmokePool.emitCluster(base, Math.round(16 + intensity * 12), 3.1 + intensity * 1.8, 0.28, 1.25 + intensity * 0.42, 1.3 + intensity * 0.65);
  // Lingering smoke column so repeated hits build into a proper runway beat-up.
  explosionSmokePool.emitCluster(base.clone().add(new THREE.Vector3(0, 0.6, 0)), Math.round(10 + intensity * 9), 1.8 + intensity * 1.0, 1.05, 1.55 + intensity * 0.38, 1.22 + intensity * 0.34);
  impactSparkPool.emitCluster(base, Math.round(16 + intensity * 14), 1.9 + intensity * 1.3, 0.42, 1.05 + intensity * 0.28, 1.55 + intensity * 0.82);
  const dirA = new THREE.Vector3(0.42, 0, -0.24).multiplyScalar(0.65 + intensity * 0.55);
  const dirB = new THREE.Vector3(-0.38, 0, 0.28).multiplyScalar(0.65 + intensity * 0.55);
  const flankA = base.clone().add(dirA);
  const flankB = base.clone().add(dirB);
  impactBlastPool.emitCluster(flankA, Math.round(8 + intensity * 6), 1.05 + intensity * 0.72, 0.08, 0.68 + intensity * 0.18, 1.32 + intensity * 0.6);
  impactBlastPool.emitCluster(flankB, Math.round(8 + intensity * 6), 1.05 + intensity * 0.72, 0.08, 0.68 + intensity * 0.18, 1.32 + intensity * 0.6);
  explosionFirePool.emitCluster(flankA, Math.round(7 + intensity * 5), 1.25 + intensity * 0.72, 0.12, 0.9 + intensity * 0.22, 1.08 + intensity * 0.42);
  explosionFirePool.emitCluster(flankB, Math.round(7 + intensity * 5), 1.25 + intensity * 0.72, 0.12, 0.9 + intensity * 0.22, 1.08 + intensity * 0.42);
  if (groundScorchFX) {
    groundScorchFX.spawn(base, 0.95 + intensity * 0.5);
    groundScorchFX.spawn(flankA, 0.45 + intensity * 0.24);
    groundScorchFX.spawn(flankB, 0.45 + intensity * 0.24);
  }
  if (typeof playSfx3D === 'function') {
    playSfx3D('explosion', pos, { volume: 0.46 + intensity * 0.10, rate: 0.98 + Math.random() * 0.06, throttleMs: 45 });
  }
}

// Apply damage to a destructible. UFOs absorb hits through shields first;
// missiles carry the explosive punch, while bullets are mostly kinetic pings.
function autoSelectDamagedTarget(target, source = 'shot') {
  if (!target || target.kind !== 'traffic') return;
  if (!(source === 'shot' || source === 'missile' || source === 'alien-pulse' || source === 'ufo-pulse')) return;
  try {
    if (typeof collectAirTargetCandidates !== 'function' || typeof selectTargetHudEntry !== 'function') return;
    const candidate = collectAirTargetCandidates().find(t => t.destructible === target);
    if (candidate) selectTargetHudEntry(candidate, { announce: false, manual: false });
  } catch {}
}

function damageDestructible(target, pos, damage = 1.0, intensity = 1.0, source = 'shot') {
  if (!target || !target.alive) return false;
  const playerWeapon = source === 'shot' || source === 'missile' || source === 'alien-pulse';
  if (playerWeapon) combatState.shotHits += 1;
  const isTrafficTarget = target.kind === 'traffic';
  const isAirframeTarget = isTrafficTarget || target.kind === 'drone' || target.kind === 'floatingTarget';
  target.lastHitAt = performance.now();
  if (playerWeapon && isTrafficTarget) autoSelectDamagedTarget(target, source);
  target.shieldPulse = Math.min(1.8, (target.shieldPulse || 0) + 1.0);

  let hullDamage = damage;
  if (target.shield > 0) {
    const shieldDamage = Math.min(target.shield, damage * (source === 'missile' ? 1.65 : source === 'alien-pulse' ? 1.25 : 1.0));
    target.shield = Math.max(0, target.shield - shieldDamage);
    hullDamage = Math.max(0, damage - shieldDamage * 0.58);
    target.lastDamageText = `SHIELD ${Math.round((target.shield / Math.max(1, target.shieldMax || 1)) * 100)}%`;
    impactBlastPool.emitCluster(pos, Math.round(5 + intensity * 5), 0.72 + intensity * 0.42, 0.10, 0.32 + intensity * 0.12, 0.9 + intensity * 0.35);
    impactSparkPool.emitCluster(pos, Math.round(8 + damage * 5), 0.9 + damage * 0.42, 0.22, 0.45 + damage * 0.12, 1.0 + damage * 0.34);
    if (typeof flashStatus === 'function' && isTrafficTarget) flashStatus(`${target.lastDamageText} · ${target.health}/${target.maxHealth} HULL`, 'panel warn', 0.8);
  }

  if (hullDamage > 0.01) {
    target.health = Math.max(0, target.health - hullDamage);
    target.lastDamageText = `HULL ${Math.round((target.health / Math.max(1, target.maxHealth || 1)) * 100)}%`;
  }

  if (isAirframeTarget && source === 'missile') {
    const isSaucer = !!(target.trafficRef && target.trafficRef.targetKind === 'ufo-saucer');
    const killShot = target.health <= 0;
    if (isSaucer) spawnSaucerMissileExplosion(pos, killShot, intensity);
    else spawnExplosion(pos, killShot ? 1.8 + intensity * 0.45 : 0.78 + intensity * 0.38, 0.35 + intensity * 0.16);
  } else if (isAirframeTarget && source === 'alien-pulse') {
    impactBlastPool.emitCluster(pos, 9, 1.0, 0.12, 0.35, 1.2);
  } else if (isAirframeTarget) {
    impactSparkPool.emitCluster(pos, Math.round(4 + damage * 6), 0.45 + damage * 0.3, 0.18, 0.32 + damage * 0.14, 0.72 + damage * 0.28);
  } else {
    if (source === 'shot' || source === 'alien-pulse') {
      spawnGunSurfaceDamage(pos, { type: source === 'alien-pulse' ? 'alien' : 'bullet', size: source === 'alien-pulse' ? 0.6 : 0.3 });
    } else {
      impactBlastPool.emitCluster(pos, Math.round(2 + intensity * 2), 0.25 + intensity * 0.18, 0.10, 0.16 + intensity * 0.06, 0.45 + intensity * 0.18);
      impactSparkPool.emitCluster(pos, Math.round(3 + damage * 5), 0.45 + damage * 0.3, 0.22, 0.38 + damage * 0.14, 0.72 + damage * 0.28);
    }
  }

  markAlienReaction(target, source);
  if (typeof playSfx3D === 'function') {
    playSfx3D(source === 'missile' ? 'explosion' : 'mg-hit', pos, { volume: source === 'missile' ? 0.56 : 0.44 + intensity * 0.12, throttleMs: source === 'missile' ? 120 : 60 });
  }
  if (target.health <= 0) {
    destroyTarget(target, pos, intensity, source);
    return true;
  }
  if (hullDamage > 0.2) explosionSmokePool.emitCluster(pos, 3, 0.6, 0.3, 0.9, 0.9);
  return false;
}

function awardCombatAmmo(amount, source = 'supply') {
  if (!combatState || !Number.isFinite(amount) || amount <= 0) return 0;
  const before = combatState.ammo;
  combatState.ammo = Math.min(combatState.ammoMax, combatState.ammo + amount);
  const gained = Math.max(0, combatState.ammo - before);
  if (gained > 0) {
    combatState.ammoEarnedTotal += gained;
    if (source === 'supply') combatState.supplyToastAmmo += gained;
    combatState.lastSupplyAwardAt = performance.now();
  }
  return gained;
}

function awardCombatMissiles(amount, source = 'supply') {
  if (!combatState || !Number.isFinite(amount) || amount <= 0) return 0;
  const before = combatState.missilesAmmo;
  combatState.missilesAmmo = Math.min(combatState.missilesMax, combatState.missilesAmmo + Math.floor(amount));
  const gained = Math.max(0, combatState.missilesAmmo - before);
  if (gained > 0) {
    combatState.missilesEarnedTotal += gained;
    combatState.lastSupplyAwardAt = performance.now();
  }
  return gained;
}

function awardPlayerShield(amount, source = 'upgrade') {
  if (!plane || !Number.isFinite(amount) || amount <= 0) return 0;
  plane.shieldMax = Math.max(150, plane.shieldMax || 150);
  const before = plane.shield || 0;
  plane.shield = Math.min(plane.shieldMax, before + amount);
  const gained = Math.max(0, plane.shield - before);
  if (gained > 0) plane.shieldPulse = Math.min(1.8, (plane.shieldPulse || 0) + 1.1);
  return gained;
}

function formatPracticeReward(reward) {
  if (!reward) return 'AMMO CACHE';
  if (reward.type === 'missile') return `+${reward.amount || 1} MISSILE`;
  if (reward.type === 'shield') return `+${reward.amount || 20}% SHIELD`;
  if (reward.type === 'alien') return `ALIEN PULSE ${reward.amount || 18}S`;
  if (reward.type === 'repair') return `+${reward.amount || 8}% HULL`;
  return `+${reward.amount || 30} AMMO`;
}

function grantPracticeReward(reward, label = 'TARGET') {
  if (!reward) return '';
  let msg = formatPracticeReward(reward);
  if (reward.type === 'missile') {
    const gained = awardCombatMissiles(reward.amount || 1, 'target');
    msg = gained > 0 ? `+${gained} MSL` : 'MSL BAY FULL';
  } else if (reward.type === 'shield') {
    const gained = awardPlayerShield(reward.amount || 20, 'target');
    msg = gained > 0 ? `+${Math.round(gained)}% SHIELD` : 'SHIELD FULL';
  } else if (reward.type === 'alien') {
    activateAlienWeapon(reward.amount || 18);
    msg = `ALIEN PULSE ${reward.amount || 18}S`;
  } else if (reward.type === 'repair') {
    const gained = repairPlaneSystems(reward.amount || 8, 'SYSTEM REPAIR');
    msg = gained > 0 ? `+${Math.round(gained)}% REPAIR` : 'SYSTEMS STABLE';
  } else {
    const gained = awardCombatAmmo(reward.amount || 30, 'target');
    msg = gained > 0 ? `+${Math.round(gained)} AMMO` : 'AMMO FULL';
  }
  if (typeof flashStatus === 'function') flashStatus(`${label} UPGRADE · ${msg}`, 'panel ok', 1.35);
  return msg;
}

function getNextPracticeRewardInfo() {
  const course = window.__practiceRingCourse;
  if (!course || !course.enabled || !course.activeCount) return null;
  const activeCount = course.activeCount || course.length || 0;
  const idx = Math.max(0, Math.min(activeCount - 1, course.nextIndex || 0));
  const ring = course[idx];
  if (!ring) return null;
  return { course, ring, index: idx, remaining: Math.max(1, idx + 1), reward: ring.userData.upgradeReward || null };
}

function combatSupplyEarnActive() {
  if (!running || plane.crashed) return false;
  const speedKts = plane.vel.length() * 1.94;
  return !plane.onGround || speedKts > 32 || plane.throttle > 0.18 || plane.throttleTarget > 0.22;
}

function maybeFlashSupplyAward(ammoGained = 0, missileGained = 0) {
  const now = performance.now();
  if (!missileGained && combatState.supplyToastAmmo < 24) return;
  if ((now - (combatState.lastSupplyFlashAt || 0)) < 2200) return;
  const parts = [];
  if (combatState.supplyToastAmmo >= 1) parts.push(`+${Math.floor(combatState.supplyToastAmmo)} AMMO`);
  if (missileGained > 0) parts.push(`+${missileGained} MSL`);
  if (!parts.length) return;
  combatState.supplyToastAmmo = 0;
  combatState.lastSupplyFlashAt = now;
  if (typeof flashStatus === 'function') flashStatus(`SUPPLY EARNED · ${parts.join(' · ')}`, 'panel ok', 1.1);
}

function updateCombatSupplyEarnings(dt) {
  if (!combatSupplyEarnActive()) return;
  combatState.supplyEarnSeconds += dt;
  let ammoGained = 0;
  let missileGained = 0;
  if (combatState.ammo < combatState.ammoMax) {
    combatState.ammoEarnBank += dt * combatState.ammoEarnRate;
    const room = combatState.ammoMax - combatState.ammo;
    const award = Math.min(Math.floor(combatState.ammoEarnBank), Math.ceil(room));
    if (award > 0) {
      combatState.ammoEarnBank -= award;
      ammoGained = awardCombatAmmo(award, 'supply');
    }
  } else {
    combatState.ammoEarnBank = 0;
  }
  if (combatState.missilesAmmo < combatState.missilesMax) {
    combatState.missileEarnBank += dt / Math.max(1, combatState.missileEarnInterval || 24);
    const award = Math.floor(combatState.missileEarnBank);
    if (award > 0) {
      combatState.missileEarnBank -= award;
      missileGained = awardCombatMissiles(award, 'supply');
      if (combatState.missilesAmmo >= combatState.missilesMax) combatState.missileEarnBank = 0;
    }
  } else {
    combatState.missileEarnBank = 0;
  }
  maybeFlashSupplyAward(ammoGained, missileGained);
}

function destroyTarget(target, pos, intensity = 1.0, source = 'generic') {
  if (!target || !target.alive) return;
  target.alive = false;
  target.object.visible = false;
  combatState.kills += 1;
  const saucerKill = !!(target.trafficRef && target.trafficRef.targetKind === 'ufo-saucer');
  if (saucerKill && source === 'missile') spawnSaucerMissileExplosion(pos, true, intensity);
  else spawnExplosion(pos, intensity * (saucerKill ? 1.85 : 1.25), intensity * (saucerKill ? 1.9 : 1.35));
  if (saucerKill) {
    shockwaveRingPool.emit(pos);
    debrisFieldFX.burst(pos, 6 + (Math.random() * 5 | 0));
  }
  if (target.kind === 'traffic' && (source === 'shot' || source === 'missile' || source === 'alien-pulse') && typeof window.showComboBanner === 'function') {
    window.showComboBanner(source === 'missile' ? 'MISSILE KILL' : source === 'alien-pulse' ? 'ALIEN PULSE KILL' : 'AIR KILL', `HOSTILE DOWN · ${combatState.kills} TOTAL`, source === 'alien-pulse' ? '#74efff' : '#ffb36a');
  }
  // Reward destruction — mountain targets + big kills top up score,
  // hull and ammo so the player has a reason to chase them down.
  let msg = 'TARGET DESTROYED';
  if (target.rewardPoints && window.__gameScore) {
    awardUnbankedPoints(target.rewardPoints, 'TARGET DESTROYED', '#ffb36a');
    msg = `+${target.rewardPoints} PTS · TARGET`;
  }
  if (target.rewardHealth) {
    plane.health = Math.min(100, plane.health + target.rewardHealth);
    msg += ` +${target.rewardHealth} HULL`;
  }
  if (target.rewardAmmo && combatState) {
    const gainedAmmo = awardCombatAmmo(target.rewardAmmo, 'kill');
    if (gainedAmmo > 0) msg += ` +${Math.round(gainedAmmo)} AMMO`;
  }
  if (target.rewardMissiles && combatState) {
    const gainedMissiles = awardCombatMissiles(target.rewardMissiles, 'kill');
    if (gainedMissiles > 0) msg += ` +${gainedMissiles} MSL`;
  }
  if (target.kind === 'traffic' && (source === 'shot' || source === 'missile' || source === 'alien-pulse')) maybeAwardAlienWeapon();
  if (source === 'shot' || source === 'missile' || source === 'alien-pulse') {
    if (typeof recordCombatKill === 'function') recordCombatKill(source);
    if (saucerKill && typeof addOverdriveCharge === 'function') addOverdriveCharge(1);
  }
  if (typeof flashStatus === 'function') flashStatus(msg, 'panel ok', 1.4);
}

function resetCombatState() {
  combatState.fireCooldown = 0;
  combatState.missileCooldown = 0;
  combatState.crashFxTriggered = false;
  combatState.crashBlastTimer = 0;
  combatState.shotsFired = 0;
  combatState.shotHits = 0;
  combatState.missilesFired = 0;
  combatState.missileHits = 0;
  combatState.kills = 0;
  combatState.ammo = combatState.ammoStart;
  combatState.missilesAmmo = combatState.missilesStart;
  combatState.ammoEarnBank = 0;
  combatState.missileEarnBank = 0;
  combatState.ammoEarnedTotal = 0;
  combatState.missilesEarnedTotal = 0;
  combatState.supplyEarnSeconds = 0;
  combatState.supplyToastAmmo = 0;
  combatState.lastSupplyAwardAt = 0;
  combatState.lastSupplyFlashAt = 0;
  combatState.missileSide = -1;
  combatState.alienWeaponUntil = 0;
  combatState.alienWeaponLastAwardAt = 0;
  combatState.lastFiredAt = 0;
  combatState.dryClickUntil = 0;
  combatState.heat = 0;
  combatState.overheatedUntil = 0;
  combatState.lastHeatWarnAt = 0;
  combatState.flaresAmmo = combatState.flaresMax || 4;
  combatState.flareCooldown = 0;
  combatState.smokeAmmo = combatState.smokeMax || 2;
  combatState.smokeCooldown = 0;
  combatState.countermeasureUntil = 0;
  combatState.smokeScreenUntil = 0;
  combatState.smokeScreenTimer = 0;
  combatState.flarePressed = false;
  combatState.smokePressed = false;
  combatState.activeShooterId = '';
  combatState.activeShooterUntil = 0;
  combatState.spaceDown = false;
  combatState.lastSpaceTapAt = 0;
  combatState.spaceMissileQueued = false;
  combatState.suppressSpaceGunsUntil = 0;
  combatState.gunModePressed = false;
  combatState.overdrivePressed = false;
  if (typeof deactivateShieldOverdrive === 'function') deactivateShieldOverdrive(true);
  crashBlast.visible = false;
  crashBlast.material.opacity = 0;
  if (groundScorchFX) groundScorchFX.clear();
  if (bulletSurfaceDamageFX) bulletSurfaceDamageFX.clear();
  for (const p of combatState.projectiles) deactivateProjectile(p);
  for (const m of combatState.missiles) deactivateMissile(m);
  for (const target of destructibleTargets) {
    target.alive = true;
    target.health = target.maxHealth || target.health || 1;
    target.shield = target.shieldMax || 0;
    target.shieldPulse = 0;
    target.lastDamageText = '';
    target.lastHitAt = 0;
    target.object.visible = true;
  }
}
bootLog.step('combat system',
  combatState.projectiles.length > 0 && combatState.missiles.length > 0 && typeof damageDestructible === 'function',
  `${combatState.projectiles.length} rounds · ${combatState.missiles.length} missiles · ${destructibleTargets.length} static targets`);

function attemptInstantHit(origin, dir, damage = 0.36, intensityOverride = null, source = 'shot') {
  let best = null;
  let bestAlong = Infinity;
  for (const target of destructibleTargets) {
    if (!target.alive || !target.object.visible) continue;
    const targetPos = getTargetWorldPosition(target, _combatTmpC);
    _combatTmpD.copy(targetPos).sub(origin);
    const along = _combatTmpD.dot(dir);
    if (along < 0 || along > 900) continue;
    const nearest = _combatTmpB.copy(dir).multiplyScalar(along).add(origin);
    const miss = nearest.distanceTo(targetPos);
    const magnet = target.kind === 'traffic'
      ? 3.4 + (targetHudState.activeId && targetHudState.activeId === (target.trafficRef && target.trafficRef.hudId) ? 2.2 : 0) + (targetHudState.lockAmount || 0) * 5.0
      : 1.1;
    const allowance = target.radius + magnet;
    if (miss > allowance) continue;
    if (along < bestAlong) {
      bestAlong = along;
      best = { target, pos: targetPos.clone() };
    }
  }
  if (best) {
    const baseIntensity = best.target.kind === 'fuel' ? 1.65 : best.target.kind === 'traffic' ? 0.42 : best.target.kind === 'floatingTarget' ? 0.5 : best.target.kind === 'drone' ? 0.38 : best.target.kind === 'barrel' ? 0.42 : 0.28;
    damageDestructible(best.target, best.pos, damage, intensityOverride != null ? intensityOverride : baseIntensity, source);
  }
}

function fireProjectileBurst() {
  if (!jet.userData.gunL || !jet.userData.gunR) return;
  const now = performance.now();
  if (now < (combatState.overheatedUntil || 0)) {
    if (now - (combatState.lastHeatWarnAt || 0) > 700) {
      combatState.lastHeatWarnAt = now;
      if (typeof flashStatus === 'function') flashStatus('GUNS OVERHEATED · COOLING', 'panel warn', 0.75);
    }
    return;
  }
  if (combatState.ammo <= 0) {
    const now = performance.now();
    // Soft dry-click cue: only flash once per second of trying to fire
    if (now > combatState.dryClickUntil) {
      combatState.dryClickUntil = now + 1000;
      if (typeof flashStatus === 'function') flashStatus('OUT OF AMMO · KEEP FLYING TO EARN', 'panel warn', 0.9);
    }
    return;
  }
  const alien = alienWeaponActive(now);
  combatState.ammo = Math.max(0, combatState.ammo - (alien ? 1 : gunAmmoPerBurst()));
  combatState.heat = Math.min(1.25, (combatState.heat || 0) + (alien ? 0.085 : (combatState.gunHeatPerBurst || 0.065)));
  if (combatState.heat >= 1) combatState.overheatedUntil = Math.max(combatState.overheatedUntil || 0, now + 1900);
  combatState.lastFiredAt = now;
  // Machine-gun burst sample — capped to a very short burst so the gun
  // doesn't keep sounding like it's firing after the trigger is released.
  // The source clips are ~1.5s long, so without this they keep ringing on
  // long after the actual firing state has ended.
  playSfx('mg-burst', { throttleMs: alien ? 72 : 140, maxMs: alien ? 120 : 72, volume: alien ? 0.64 : 0.42 + Math.random() * 0.12, rate: alien ? 1.25 + Math.random() * 0.08 : 1.05 + Math.random() * 0.16 });
  const forward = _combatTmpA.set(0, 0, -1).applyQuaternion(plane.quat).normalize();
  const muzzles = [jet.userData.gunL, jet.userData.gunR];
  const dmgMul = alien ? 1 : gunDamageMul();
  const scatter = !alien && gunIsScatter();
  const spread = alien ? 0 : 0.016 * gunSpreadMul();
  const shots = scatter ? 5 : muzzles.length;
  _wpnUp.set(0, 1, 0).applyQuaternion(plane.quat);
  _wpnRight.set(1, 0, 0).applyQuaternion(plane.quat);
  for (let i = 0; i < shots; i++) {
    const muzzle = muzzles[i % muzzles.length];
    const projectile = combatState.projectiles.find(p => !p.active);
    if (!projectile) break;
    projectile.active = true;
    projectile.life = alien ? 1.45 : 1.25;
    projectile.damage = alien ? 1.05 : 0.34 * dmgMul;
    projectile.intensity = alien ? 0.78 : 0.30;
    projectile.source = alien ? 'alien-pulse' : 'shot';
    projectile.target = alien && targetHudState.activeTarget && targetHudState.lockId === targetHudState.activeId && (targetHudState.lockAmount || 0) > 0.24
      ? targetHudState.activeTarget
      : null;
    projectile.targetId = projectile.target ? projectile.target.id : '';
    setProjectileVisual(projectile, alien ? 'alien' : 'bullet');
    projectile.pos.copy(muzzle).applyQuaternion(plane.quat).add(plane.pos);
    const sightDir = (typeof getReticleAimDirection === 'function' && getReticleAimDirection(projectile.pos, _combatTmpC)) || forward;
    const shotDir = getAimAssistDirection(projectile.pos, sightDir, _combatTmpD) || sightDir;
    if (scatter) {
      shotDir.applyAxisAngle(_wpnUp, (i - 2) * 0.032).applyAxisAngle(_wpnRight, (Math.random() - 0.5) * 0.014).normalize();
    } else if (spread > 0) {
      shotDir.applyAxisAngle(_wpnUp, (Math.random() - 0.5) * spread).applyAxisAngle(_wpnRight, (Math.random() - 0.5) * spread).normalize();
    }
    projectile.vel.copy(shotDir).multiplyScalar(alien ? 620 : 520).add(plane.vel);
    projectile.mesh.visible = true;
    projectile.mesh.position.copy(projectile.pos);
    projectile.mesh.quaternion.setFromUnitVectors(_projectileForward, projectile.vel.clone().normalize());
    muzzleFlashPool.emitCluster(projectile.pos, alien ? 6 : 3, alien ? 0.34 : 0.11, 0.08, alien ? 0.45 : 0.24, alien ? 0.95 : 0.42);
    attemptInstantHit(projectile.pos, shotDir, projectile.damage, projectile.intensity, projectile.source);
  }
  combatState.shotsFired += 1;
}

function deployFlares() {
  const now = performance.now();
  if (plane.crashed || combatState.flareCooldown > 0 || combatState.flaresAmmo <= 0) return false;
  combatState.flaresAmmo -= 1;
  combatState.flareCooldown = 1.15;
  combatState.countermeasureUntil = Math.max(combatState.countermeasureUntil || 0, now + 2600);
  const forward = _combatTmpA.set(0, 0, -1).applyQuaternion(plane.quat).normalize();
  const right = _combatTmpB.set(1, 0, 0).applyQuaternion(plane.quat).normalize();
  const up = _combatTmpC.set(0, 1, 0).applyQuaternion(plane.quat).normalize();
  const anchors = [jet.userData.wingtipL, jet.userData.wingtipR].filter(Boolean);
  for (let i = 0; i < anchors.length; i++) {
    const side = i === 0 ? -1 : 1;
    const base = anchors[i].clone().applyQuaternion(plane.quat).add(plane.pos).addScaledVector(forward, 1.6);
    for (let k = 0; k < 8; k++) {
      const pos = base.clone().addScaledVector(right, side * (k * 0.85 + 0.6)).addScaledVector(up, Math.sin(k * 0.8) * 0.9 - k * 0.08);
      explosionFirePool.emitCluster(pos, 2, 0.75 + k * 0.06, 0.05, 0.18, 0.6);
      impactSparkPool.emitCluster(pos, 2, 0.58, 0.05, 0.18, 0.46);
    }
    explosionSmokePool.emitCluster(base.clone().addScaledVector(forward, 2.2), 8, 0.9, 0.10, 0.7, 0.85);
  }
  for (const t of traffic) if (t && t.targetKind === 'ufo-saucer') t.playerLock = Math.min(t.playerLock || 0, 0.22);
  if (typeof playSfx === 'function') playSfx('dogfight', { throttleMs: 90, maxMs: 180, volume: 0.52, rate: 1.75 });
  if (typeof window.showComboBanner === 'function') window.showComboBanner('FLARES', 'ANGEL WINGS · ENEMY LOCK BROKEN', '#ffd36a');
  return true;
}

function deploySmokeScreen() {
  const now = performance.now();
  if (plane.crashed || combatState.smokeCooldown > 0 || combatState.smokeAmmo <= 0) return false;
  combatState.smokeAmmo -= 1;
  combatState.smokeCooldown = 4.0;
  combatState.smokeScreenUntil = Math.max(combatState.smokeScreenUntil || 0, now + 5200);
  combatState.countermeasureUntil = Math.max(combatState.countermeasureUntil || 0, now + 4200);
  combatState.smokeScreenTimer = 0;
  for (const t of traffic) if (t && t.targetKind === 'ufo-saucer') t.playerLock = Math.min(t.playerLock || 0, 0.10);
  if (typeof playSfx === 'function') playSfx('explosion', { throttleMs: 240, maxMs: 180, volume: 0.36, rate: 0.62 });
  if (typeof window.showComboBanner === 'function') window.showComboBanner('SMOKE SCREEN', 'VISUAL LOCK DISRUPTED', '#b7d0c0');
  return true;
}

function updateSmokeScreen(dt) {
  const now = performance.now();
  if (now >= (combatState.smokeScreenUntil || 0)) return;
  combatState.smokeScreenTimer -= dt;
  const forward = _combatTmpA.set(0, 0, -1).applyQuaternion(plane.quat).normalize();
  const right = _combatTmpB.set(1, 0, 0).applyQuaternion(plane.quat).normalize();
  while (combatState.smokeScreenTimer <= 0) {
    combatState.smokeScreenTimer += 0.045;
    const base = plane.pos.clone().addScaledVector(forward, 8 + Math.random() * 9).addScaledVector(right, (Math.random() - 0.5) * 10).add(new THREE.Vector3(0, -1.2 + Math.random() * 2.4, 0));
    explosionSmokePool.emitCluster(base, 5, 2.25 + Math.random() * 0.9, 0.18, 1.7, 1.45);
  }
}

function fireUfoPulse(t, originPos, dt = 1 / 60) {
  if (!t || !originPos || plane.crashed || replay.playing) return false;
  const now = performance.now();
  const learning = getFlightLearningProfile ? getFlightLearningProfile() : null;
  const aggression = learning ? learning.aggression : 0.5;
  const dist = originPos.distanceTo(plane.pos);
  const toPlayer = _combatTmpA.copy(plane.pos).sub(originPos);
  const forward = _combatTmpC.set(0, 0, -1).applyQuaternion(t.group.quaternion).normalize();
  const facing = toPlayer.lengthSq() > 1 ? forward.dot(_combatTmpD.copy(toPlayer).normalize()) : 1;
  const cmActive = now < (combatState.countermeasureUntil || 0);
  const smokeActive = now < (combatState.smokeScreenUntil || 0);
  const canSee = dist < 840 && dist > 32 && facing > -0.06;
  const shooterId = t.hudId || t.callsign || t.file || String(t.phaseOffset || t.phase || Math.random());
  const activeExpired = !combatState.activeShooterId || now > (combatState.activeShooterUntil || 0);
  if (!activeExpired && combatState.activeShooterId !== shooterId) {
    // Keep the arena readable: one UFO is the current dogfight/shooter.
    // Everyone else is scenery until that engagement times out.
    t.playerLock = Math.max(0, (t.playerLock || 0) - dt * 1.8);
    return false;
  }
  if (activeExpired && canSee) {
    combatState.activeShooterId = shooterId;
    combatState.activeShooterUntil = now + 4200;
  }
  if (combatState.activeShooterId !== shooterId) return false;
  const lockTarget = canSee ? (cmActive ? 0.18 : smokeActive ? 0.08 : 1) : 0;
  t.playerLock = (t.playerLock || 0) + (lockTarget - (t.playerLock || 0)) * Math.min(1, dt * (lockTarget > (t.playerLock || 0) ? 0.85 + aggression * 0.8 : 2.8));
  combatState.activeShooterUntil = now + (canSee ? 4200 : 1200);
  const cadence = Math.max(620, 1450 - aggression * 460 - clamp01((t.aiBlend || 0)) * 180);
  if (now < (t.nextPulseAt || 0)) return false;
  if (!canSee || (t.playerLock || 0) < 0.34) return false;
  const realShooter = !cmActive && !smokeActive && (t.playerLock || 0) >= 0.62;
  t.nextPulseAt = now + cadence + Math.random() * 420;
  if (realShooter && t.destructible) autoSelectDamagedTarget(t.destructible, 'ufo-pulse');
  const p = combatState.projectiles.find(slot => !slot.active);
  if (!p) return false;
  const confused = cmActive || smokeActive || !realShooter;
  const lead = clamp01(dist / 620) * (0.42 + aggression * 0.22) * (confused ? 0.18 : 1);
  const aim = _combatTmpB.copy(plane.pos)
    .addScaledVector(plane.vel, lead)
    .add(new THREE.Vector3((Math.random() - 0.5) * (confused ? 180 : 10), (Math.random() - 0.5) * (confused ? 80 : 5), (Math.random() - 0.5) * (confused ? 180 : 10)));
  const dir = aim.sub(originPos).normalize();
  p.active = true;
  p.life = 2.2;
  p.damage = 0.0;
  p.intensity = 0.72;
  p.source = 'ufo-pulse';
  p.lockStrength = realShooter ? (t.playerLock || 0) : 0;
  p.cmConfused = confused;
  setProjectileVisual(p, 'ufo-pulse');
  p.pos.copy(originPos).addScaledVector(dir, 4.5).add(new THREE.Vector3(0, -1.1, 0));
  p.vel.copy(dir).multiplyScalar(260 + aggression * 80);
  p.mesh.visible = true;
  p.mesh.position.copy(p.pos);
  p.mesh.quaternion.setFromUnitVectors(_projectileForward, p.vel.clone().normalize());
  muzzleFlashPool.emitCluster(p.pos, 5, 0.24, 0.08, 0.34, 0.72);
  impactBlastPool.emitCluster(p.pos, 3, 0.52, 0.06, 0.18, 0.42);
  if (typeof playSfx3D === 'function') playSfx3D('dogfight', originPos, { throttleMs: 190, maxMs: 160, volume: 0.34, rate: 1.38 + Math.random() * 0.18 });
  return true;
}

function updateCombat(dt) {
  combatState.fireCooldown = Math.max(0, combatState.fireCooldown - dt);
  combatState.missileCooldown = Math.max(0, combatState.missileCooldown - dt);
  combatState.flareCooldown = Math.max(0, (combatState.flareCooldown || 0) - dt);
  combatState.smokeCooldown = Math.max(0, (combatState.smokeCooldown || 0) - dt);
  updateSmokeScreen(dt);
  const flareDown = !!keys['KeyV'];
  if (flareDown && !combatState.flarePressed) deployFlares();
  combatState.flarePressed = flareDown;
  const smokeDown = !!keys['KeyZ'];
  if (smokeDown && !combatState.smokePressed) deploySmokeScreen();
  combatState.smokePressed = smokeDown;
  // Gun fire-mode cycle (U) and shield overdrive (O) — edge-detected like flares.
  const modeDown = !!keys['KeyU'];
  if (modeDown && !combatState.gunModePressed) cycleGunMode();
  combatState.gunModePressed = modeDown;
  const odDown = !!keys['KeyO'];
  if (odDown && !combatState.overdrivePressed) activateShieldOverdrive();
  combatState.overdrivePressed = odDown;
  updateShieldOverdrive();
  const heatCool = combatState.heatCoolRate || 0.34;
  combatState.heat = Math.max(0, (combatState.heat || 0) - dt * heatCool * (combatState.overheatedUntil > performance.now() ? 1.65 : 1));
  if (combatState.heat <= 0.08 && combatState.overheatedUntil > 0 && performance.now() > combatState.overheatedUntil) combatState.overheatedUntil = 0;
  transientStatus.timer = Math.max(0, transientStatus.timer - dt);
  const combatNow = performance.now();
  // Time-earned supply: active flight steadily refills bullets and builds
  // missile credits. Firing can still outpace earning, so ammo remains scarce.
  updateCombatSupplyEarnings(dt);
  const missileRequested = !plane.crashed && (combatState.spaceMissileQueued || keys['KeyX'] || gamepadState.missile || touchButtonActive('missile'));
  if (missileRequested && combatState.missileCooldown <= 0) {
    const launched = fireMissile();
    if (combatState.spaceMissileQueued) {
      combatState.spaceMissileQueued = false;
      combatState.suppressSpaceGunsUntil = Math.max(combatState.suppressSpaceGunsUntil || 0, combatNow + (launched ? 180 : 90));
    }
  } else if (combatState.spaceMissileQueued && combatState.missileCooldown > 0.2) {
    combatState.spaceMissileQueued = false;
  }
  // Fire on Space OR left mouse. `combatState.fireHeld` tracks the
  // mouse button so left-click doesn't need to go through the keys
  // map (which can get stuck if keyup misses during focus changes).
  // A quick double-tap of Space is reserved for missile launch; suppress
  // gun bursts briefly so the second tap reads as MSL rather than MG fire.
  const spaceGunHeld = keys['Space'] && combatNow >= (combatState.suppressSpaceGunsUntil || 0);
  const firing = !plane.crashed && (spaceGunHeld || combatState.mouseFireHeld || gamepadState.fire);
  if (firing && combatState.fireCooldown <= 0) {
    fireProjectileBurst();
    combatState.fireCooldown = (alienWeaponActive() ? 0.055 : 0.115) * gunCooldownMul();
  }

  // Player-vs-object collision (D11): flying into any registered
  // destructible causes mutual damage. Relative speed scales severity
  // so a nudge at cruise is surface damage, but a head-on at 300kts
  // is fatal. Glancing hits destroy the target but leave the plane
  // alive and slightly wounded.
  if (!plane.crashed) {
    const playerRadius = 5.0;
    const playerSpeed = plane.vel.length();
    for (const target of destructibleTargets) {
      if (!target.alive || !target.object.visible) continue;
      const targetPos = getTargetWorldPosition(target, _combatTmpC);
      const dist = plane.pos.distanceTo(targetPos);
      if (dist > target.radius + playerRadius) continue;
      // Ambient traffic can cross the runway while the player is still parked.
      // Do not count that as a free kill or damage event; only armed/moving
      // player collisions should destroy air targets.
      if (target.kind === 'traffic' && plane.onGround && playerSpeed < 18) continue;
      // Relative speed: assume static for non-traffic; for traffic we
      // have .object position but no velocity — estimate zero (low
      // path speed relative to player at combat range).
      const relSpeed = playerSpeed;
      // Head-on check: dot product of player velocity and direction to
      // target. >0 = heading into target.
      _combatTmpD.copy(targetPos).sub(plane.pos);
      if (_combatTmpD.lengthSq() > 1e-6) _combatTmpD.normalize();
      _combatTmpA.copy(plane.vel);
      if (_combatTmpA.lengthSq() > 1e-6) _combatTmpA.normalize();
      const approach = Math.max(0, _combatTmpA.dot(_combatTmpD));
      // 0..1 severity. 60 m/s head-on = 0.5, 120 m/s head-on = 1.0.
      const severity = Math.min(1, (relSpeed / 140) * (0.4 + approach * 0.6));
      // Small targets (barrels, drones) scuff the paint; big ones
      // (traffic, floating) ruin the plane. Use radius as proxy.
      const massMul = Math.min(1, target.radius / 10);
      const playerDmg = severity * (0.2 + massMul * 0.6);
      // Scratch copies — damagePlane/destroyTarget may read pos while we reuse temps later.
      _combatTmpE.copy(targetPos);
      _combatTmpF.copy(targetPos);
      const fatal = damagePlane(playerDmg, 'airframe', {
        reason: 'COLLISION',
        worldPos: _combatTmpE,
      });
      destroyTarget(target, _combatTmpF,
        target.kind === 'fuel' ? 1.65 :
        target.kind === 'traffic' ? 1.4 :
        target.kind === 'floatingTarget' ? 1.6 :
        target.kind === 'drone' ? 1.1 :
        target.kind === 'barrel' ? 1.0 : 0.8,
        'collision'
      );
      // Big kinetic transfer: rebound the player away from the target.
      if (!fatal) {
        plane.vel.addScaledVector(_combatTmpD, -playerSpeed * 0.35 * 0.6);
        statusMsg.textContent = `HULL ${Math.round(plane.health)}% — IMPACT`;
        statusMsg.className = 'panel warn';
      }
      // Only collide with one target per frame to avoid cascading kills
      break;
    }
  }

  if (plane.crashed && !combatState.crashFxTriggered) {
    combatState.crashFxTriggered = true;
    combatState.crashBlastTimer = 0.9;
    crashBlast.visible = true;
    crashBlast.position.copy(plane.pos).add(_combatCrashOffset);
    crashBlast.scale.set(34, 34, 1);
    crashBlast.material.opacity = 1.0;
    spawnExplosion(plane.pos, 1.7, 1.6);
    shockwaveRingPool.emit(_combatTmpA.copy(plane.pos).add(_combatCrashRingOffset), { endScale: 70, opacity: 0.8, color: 0xffb060 });
    if (typeof flashStatus === 'function') flashStatus('AIRCRAFT LOST — PRESS R · OR REPLAY', 'panel warn', 2.5);
    // Surface the REPLAY panel so the player can watch what killed them.
    if (typeof syncReplayUI === 'function') syncReplayUI();
    if (!replay.playing && replay.size >= 1) replayStart();
  }
  if (combatState.crashBlastTimer > 0) {
    combatState.crashBlastTimer = Math.max(0, combatState.crashBlastTimer - dt);
    const t = 1 - combatState.crashBlastTimer / 0.9;
    crashBlast.visible = true;
    const blastScale = 34 + t * 120;
    crashBlast.scale.set(blastScale, blastScale, 1);
    crashBlast.material.opacity = (1 - t) * 1.0;
  } else {
    crashBlast.visible = false;
  }

  for (const p of combatState.projectiles) {
    if (!p.active) continue;
    p.life -= dt;
    if (p.life <= 0) {
      deactivateProjectile(p);
      continue;
    }
    if (p.source === 'alien-pulse' && p.target && p.target.destructible && p.target.destructible.alive && targetHudState.lockId === p.targetId && (targetHudState.lockAmount || 0) > 0.18) {
      p.target.object.getWorldPosition(_combatTmpC);
      const dist = Math.max(1, p.pos.distanceTo(_combatTmpC));
      if (p.target.velocity) _combatTmpC.addScaledVector(p.target.velocity, (dist / 560) * (0.75 + (targetHudState.lockAmount || 0) * 0.55));
      const desiredDir = _combatTmpC.sub(p.pos).normalize();
      const speed = Math.max(420, p.vel.length());
      p.vel.lerp(desiredDir.multiplyScalar(speed), Math.min(1, dt * (2.4 + (targetHudState.lockAmount || 0) * 4.6))).normalize().multiplyScalar(speed);
    }
    p.pos.addScaledVector(p.vel, dt);
    p.mesh.position.copy(p.pos);
    p.mesh.quaternion.setFromUnitVectors(_projectileForward, _combatTmpB.copy(p.vel).normalize());

    const groundH = (p.pos.x * p.pos.x + p.pos.z * p.pos.z < AIRFIELD_FLAT_R2)
      ? AIRFIELD_SURFACE_Y : getHeight(p.pos.x, p.pos.z);
    if (p.pos.y <= groundH + 0.12) {
      _combatTmpE.copy(p.pos);
      _combatTmpE.y = groundH + 0.05;
      if (p.type === 'alien' || p.type === 'ufo-pulse') {
        spawnGunSurfaceDamage(_combatTmpE, { type: 'alien', size: p.type === 'ufo-pulse' ? 0.9 : 0.74 });
        impactBlastPool.emitCluster(_combatTmpE, p.type === 'ufo-pulse' ? 7 : 5, 0.9, 0.06, 0.24, 0.8);
      } else {
        spawnGunSurfaceDamage(_combatTmpE, { type: 'bullet', size: 0.34 });
      }
      deactivateProjectile(p);
      continue;
    }

    if (p.source === 'ufo-pulse') {
      const playerMiss = p.pos.distanceTo(plane.pos);
      const maintainedLock = !p.cmConfused && (p.lockStrength || 0) >= 0.62;
      if (!plane.crashed && maintainedLock && playerMiss < 6.8) {
        _combatTmpE.copy(p.pos);
        impactBlastPool.emitCluster(_combatTmpE, 8, 1.05, 0.08, 0.36, 0.95);
        impactSparkPool.emitCluster(_combatTmpE, 10, 0.82, 0.16, 0.42, 0.9);
        damagePlane(0.9, 'airframe', { reason: 'UFO PULSE', worldPos: _combatTmpE });
        if (typeof flashStatus === 'function') flashStatus(`HULL ${Math.round(plane.health)}% · UFO PULSE HIT`, 'panel warn', 1.0);
        deactivateProjectile(p);
        continue;
      }
    }

    for (const target of destructibleTargets) {
      if (!target.alive || !target.object.visible) continue;
      const targetPos = getTargetWorldPosition(target, _combatTmpC);
      if (p.pos.distanceTo(targetPos) < target.radius) {
        damageDestructible(target, targetPos, p.damage || 0.34, p.intensity || 0.32, p.source || 'shot');
        deactivateProjectile(p);
        break;
      }
    }
  }

  for (const m of combatState.missiles) {
    if (!m.active) continue;
    m.life -= dt;
    if (m.life <= 0) {
      deactivateMissile(m);
      continue;
    }
    m.launchAge = (m.launchAge || 0) + dt;
    if (!m.engineLit && m.launchAge >= (m.ignitionDelay || 0.32)) {
      m.engineLit = true;
      const igniteDir = m.launchForward && m.launchForward.lengthSq() > 0.01
        ? _combatTmpA.copy(m.launchForward).normalize()
        : _combatTmpB.copy(m.vel).normalize();
      _combatTmpE.copy(igniteDir).multiplyScalar(255).addScaledVector(plane.vel, 0.35);
      m.vel.lerp(_combatTmpE, 0.86);
      if (m.flare && m.flare.material) {
        m.flare.material.opacity = 1.0;
        m.flare.scale.setScalar(1.35);
      }
      impactBlastPool.emitCluster(_combatTmpF.copy(m.pos).addScaledVector(igniteDir, -1.2), 18, 1.32, 0.10, 0.52, 1.35);
      explosionFirePool.emitCluster(_combatTmpF.copy(m.pos).addScaledVector(igniteDir, -1.15), 16, 1.85, 0.18, 0.62, 1.18);
      explosionSmokePool.emitCluster(_combatTmpF.copy(m.pos).addScaledVector(igniteDir, -1.8), 20, 1.9, 0.22, 1.35, 1.55);
      if (typeof playSfx === 'function') playSfx('mg-burst', { throttleMs: 70, maxMs: 220, volume: 1.0, rate: 1.58 });
    }
    const target = m.engineLit && m.target && m.target.destructible && m.target.destructible.alive ? m.target : null;
    if (target && target.object) {
      target.object.getWorldPosition(_combatTmpC);
      if (target.velocity) _combatTmpC.addScaledVector(target.velocity, 0.22 + targetHudState.lockAmount * 0.28);
      const desired = _combatTmpC.sub(m.pos).normalize();
      const speed = Math.max(180, m.vel.length());
      m.vel.lerp(desired.multiplyScalar(285), Math.min(1, dt * (2.2 + (targetHudState.lockAmount || 0) * 2.2))).normalize().multiplyScalar(Math.max(speed, 245));
    } else if (m.engineLit) {
      const dumbDir = m.launchForward && m.launchForward.lengthSq() > 0.01
        ? _combatTmpA.copy(m.launchForward).normalize()
        : _combatTmpB.copy(m.vel).normalize();
      m.vel.lerp(dumbDir.multiplyScalar(Math.max(245, m.vel.length() + dt * 80)), Math.min(1, dt * 1.8));
    } else {
      m.vel.addScaledVector(m.dropDir || _combatTmpC.set(0, -1, 0), 28 * dt);
      m.vel.addScaledVector(m.launchForward || _combatTmpB.set(0, 0, -1), 12 * dt);
    }
    m.pos.addScaledVector(m.vel, dt);
    m.mesh.position.copy(m.pos);
    const visualDir = m.engineLit ? _combatTmpB.copy(m.vel).normalize() : (m.launchForward && m.launchForward.lengthSq() > 0.01 ? m.launchForward : _combatTmpB.copy(m.vel).normalize());
    m.mesh.quaternion.setFromUnitVectors(_missileForward, visualDir);
    if (m.flare && m.flare.material) {
      m.flare.material.opacity = m.engineLit ? (0.78 + Math.sin(performance.now() * 0.03) * 0.18) : 0;
      m.flare.scale.setScalar(m.engineLit ? 1.08 + Math.sin(performance.now() * 0.028) * 0.18 : 1);
    }
    if (m.engineLit) {
      m.smokeTimer -= dt;
      if (m.smokeTimer <= 0) {
        m.smokeTimer = 0.018;
        _combatTmpE.copy(m.pos).addScaledVector(_combatTmpB.copy(m.vel).normalize(), -1.45);
        explosionSmokePool.emitCluster(_combatTmpE, 4, 1.28, 0.08, 0.98, 1.18);
        if (Math.random() < 0.55) explosionFirePool.emitCluster(_combatTmpE, 1, 0.72, 0.05, 0.18, 0.38);
      }
    }
    const groundH = (m.pos.x * m.pos.x + m.pos.z * m.pos.z < AIRFIELD_FLAT_R2) ? AIRFIELD_SURFACE_Y : getHeight(m.pos.x, m.pos.z);
    if (m.pos.y <= groundH + 0.2) {
      _combatTmpE.copy(m.pos);
      _combatTmpE.y = groundH + 0.05;
      spawnGroundImpactExplosion(_combatTmpE, 1.35);
      deactivateMissile(m);
      continue;
    }
    for (const targetObj of destructibleTargets) {
      if (!targetObj.alive || !targetObj.object.visible) continue;
      const targetPos = getTargetWorldPosition(targetObj, _combatTmpC);
      if (m.pos.distanceTo(targetPos) < targetObj.radius + 2.4) {
        combatState.missileHits += 1;
        damageDestructible(targetObj, targetPos, 4.2, 1.55, 'missile');
        deactivateMissile(m);
        break;
      }
    }
  }

  muzzleFlashPool.update(dt);
  impactSparkPool.update(dt);
  impactBlastPool.update(dt);
  explosionFirePool.update(dt);
  explosionSmokePool.update(dt);
  shockwaveRingPool.update(dt);
  debrisFieldFX.update(dt);
  if (groundScorchFX) groundScorchFX.update(dt);
  if (bulletSurfaceDamageFX) bulletSurfaceDamageFX.update(dt);
}

// Wing-vapor pools — continuous wingtip condensation stream for hard turns,
// climbs and descents. These use a softer sprite and frequent single-particle
// emission so they read as a thin vapor ribbon rather than a chain of puffs.
const vaporL = new ParticlePool(scene, {
  max: 420, color: 0xf7fbff, size: 1.15,
  life: 1.85, growth: 2.2, additive: false, texture: sharedSpriteTex,
});
const vaporR = new ParticlePool(scene, {
  max: 420, color: 0xf7fbff, size: 1.15,
  life: 1.85, growth: 2.2, additive: false, texture: sharedSpriteTex,
});
const wingTrailStreamL = new StreamTrail(scene, { max: 110, color: 0xf9fdff, opacity: 0.52, fadeRate: 1.2 });
const wingTrailStreamR = new StreamTrail(scene, { max: 110, color: 0xf9fdff, opacity: 0.52, fadeRate: 1.2 });
// Track previous forward speed so we can estimate longitudinal
// acceleration frame-to-frame — a cheap way to catch "speed-ups" without
// maintaining a full motion integrator.
let _prevFwdSpd = 0;
// Engine contrail — fades over longer time, slight gray tint
const contrail = new ParticlePool(scene, {
  max: 220, color: 0xeae8e0, size: 1.8,
  life: 3.0, growth: 5.0, additive: false, texture: sharedSpriteTex,
});

const greyTurnSmokeL = new ParticlePool(scene, {
  max: 320, color: 0x8c8984, size: 2.8,
  life: 4.0, growth: 2.8, additive: false, texture: puffTex,
});
const greyTurnSmokeR = new ParticlePool(scene, {
  max: 320, color: 0x8c8984, size: 2.8,
  life: 4.0, growth: 2.8, additive: false, texture: puffTex,
});
const throatClearSmokeL = new ParticlePool(scene, {
  max: 240, color: 0x2e2823, size: 2.7,
  life: 2.8, growth: 2.3, additive: false, texture: puffTex,
});
const throatClearSmokeR = new ParticlePool(scene, {
  max: 240, color: 0x2e2823, size: 2.7,
  life: 2.8, growth: 2.3, additive: false, texture: puffTex,
});
const dirtyExhaustCore = new ParticlePool(scene, {
  max: 260, color: 0x4b433d, size: 1.9,
  life: 2.0, growth: 1.7, additive: false, texture: sharedSpriteTex,
});

const engineSurgeState = {
  timer: 0,
  cooldown: 0,
  phase: 'steady',
  powerMul: 1,
  turnStress: 0,
  greyMix: 0,
  throatClear: 0,
};

function resetEngineSurgeFx() {
  engineSurgeState.timer = 0;
  engineSurgeState.cooldown = 0;
  engineSurgeState.phase = 'steady';
  engineSurgeState.powerMul = 1;
  engineSurgeState.turnStress = 0;
  engineSurgeState.greyMix = 0;
  engineSurgeState.throatClear = 0;
}

function updateEngineSurge(dt, fastTurnStress) {
  const propAirframe = !!(plane.props && plane.props.length) || !!plane.suppressJetFX;
  if (!propAirframe || plane.crashed) {
    resetEngineSurgeFx();
    return;
  }

  engineSurgeState.cooldown = Math.max(0, engineSurgeState.cooldown - dt);
  const stress = (!plane.onGround && plane.throttle > 0.18)
    ? clamp01(fastTurnStress)
    : 0;
  engineSurgeState.turnStress += (stress - engineSurgeState.turnStress) * Math.min(1, dt * 5.5);

  if (!plane.onGround
      && plane.throttle > 0.32
      && engineSurgeState.timer <= 0.05
      && engineSurgeState.cooldown <= 0
      && stress > 0.72) {
    engineSurgeState.timer = 1.35;
    engineSurgeState.cooldown = 2.4;
  }

  let targetPowerMul = 1.0;
  let phase = stress > 0.08 ? 'loaded' : 'steady';
  let greyMix = clamp01(engineSurgeState.turnStress * 0.85);
  let throatClear = 0;

  if (engineSurgeState.timer > 0) {
    engineSurgeState.timer = Math.max(0, engineSurgeState.timer - dt);
    const p = 1 - engineSurgeState.timer / 1.35;
    if (p < 0.26) {
      const t = smoothstep(clamp01(p / 0.26));
      phase = 'dip';
      targetPowerMul = 1.0 - 0.16 * t;
      greyMix = Math.max(greyMix, 0.44 + t * 0.18);
    } else if (p < 0.58) {
      const t = smoothstep(clamp01((p - 0.26) / 0.32));
      phase = 'recover';
      targetPowerMul = 0.84 + 0.29 * t;
      greyMix = Math.max(greyMix, 0.58 + t * 0.14);
      throatClear = 0.24 + t * 0.54;
    } else if (p < 0.82) {
      const t = smoothstep(clamp01((p - 0.58) / 0.24));
      phase = 'throat-clear';
      targetPowerMul = 1.13 - 0.07 * t;
      greyMix = Math.max(greyMix, 0.72 - t * 0.18);
      throatClear = 0.82 - t * 0.22;
    } else {
      const t = smoothstep(clamp01((p - 0.82) / 0.18));
      phase = 'settle';
      targetPowerMul = 1.06 - 0.06 * t;
      greyMix = Math.max(greyMix, 0.34 * (1 - t));
      throatClear = 0.38 * (1 - t);
    }
  }

  if (plane.onGround || plane.throttle < 0.18) {
    targetPowerMul = 1.0;
    phase = 'steady';
    greyMix = 0;
    throatClear = 0;
  }

  engineSurgeState.phase = phase;
  engineSurgeState.powerMul += (targetPowerMul - engineSurgeState.powerMul) * Math.min(1, dt * 6.5);
  engineSurgeState.greyMix += (greyMix - engineSurgeState.greyMix) * Math.min(1, dt * 5.0);
  engineSurgeState.throatClear += (throatClear - engineSurgeState.throatClear) * Math.min(1, dt * 8.0);
}

let vaporTimer = 0;
let greyTurnSmokeTimer = 0;
let throatClearSmokeTimer = 0;
let dirtyExhaustCoreTimer = 0;
let contrailTimer = 0;
// Reusable scratch vectors for updateAtmospheric — eliminates ~11 Vector3 + 1
// Quaternion allocations every frame (the top steady-state GC source). Each var
// has its own temp (no aliasing); emit/emitCluster/addPoint all copy/clone the
// position internally, so reusing these across frames is safe.
const _atmWlL = new THREE.Vector3(), _atmWlR = new THREE.Vector3(), _atmWlE = new THREE.Vector3();
const _atmFwd = new THREE.Vector3(), _atmRight = new THREE.Vector3(), _atmTrailBack = new THREE.Vector3();
const _atmWtL = new THREE.Vector3(), _atmWtR = new THREE.Vector3(), _atmWlCore = new THREE.Vector3();
const _atmLocalVel = new THREE.Vector3(), _atmInvQ = new THREE.Quaternion();
function updateAtmospheric(dt) {
  // Engine smoke stays near the cowling; healthy condensation trails come
  // from the real wing tips so hard manoeuvres read as wing vapor instead
  // of the engine smoking all the time.
  const smokeLAnchor = jet.userData.engineSmokeL || jet.userData.wingtipL;
  const smokeRAnchor = jet.userData.engineSmokeR || jet.userData.wingtipR;
  const wingLAnchor = jet.userData.wingtipL || smokeLAnchor;
  const wingRAnchor = jet.userData.wingtipR || smokeRAnchor;
  const wlL = _atmWlL.copy(smokeLAnchor).applyQuaternion(plane.quat).add(plane.pos);
  const wlR = _atmWlR.copy(smokeRAnchor).applyQuaternion(plane.quat).add(plane.pos);
  const wlE = _atmWlE.copy(jet.userData.engineExhaust).applyQuaternion(plane.quat).add(plane.pos);
  const forwardWorld = _atmFwd.set(0, 0, -1).applyQuaternion(plane.quat);
  const wingRightWorld = _atmRight.set(1, 0, 0).applyQuaternion(plane.quat);
  const trailBack = _atmTrailBack.copy(forwardWorld).multiplyScalar(-0.28);
  const wtL = _atmWtL.copy(wingLAnchor).applyQuaternion(plane.quat).add(plane.pos).addScaledVector(wingRightWorld, -0.45).add(trailBack);
  const wtR = _atmWtR.copy(wingRAnchor).applyQuaternion(plane.quat).add(plane.pos).addScaledVector(wingRightWorld, 0.45).add(trailBack);
  const wlCore = _atmWlCore.copy(wlL).lerp(wlR, 0.5).addScaledVector(forwardWorld, -0.35);

  const speed = plane.vel.length();
  const localVel = _atmLocalVel.copy(plane.vel).applyQuaternion(_atmInvQ.copy(plane.quat).invert());
  const fwdSpd = -localVel.z;
  const aoa = fwdSpd > 1 ? Math.atan2(-localVel.y, fwdSpd) : 0;
  const rollRate  = Math.abs(plane.angVel.z);
  const pitchRate = Math.abs(plane.angVel.x);
  const yawRate   = Math.abs(plane.angVel.y);
  const verticalRate = Math.abs(plane.vel.y);
  const pScale = (typeof window !== 'undefined' && window.__gfxParticleScale) ? window.__gfxParticleScale() : 1.0;
  // Longitudinal acceleration (m/s²) along the nose. Positive = speeding up.
  const fwdAccel = Math.max(0, (fwdSpd - _prevFwdSpd) / Math.max(dt, 1e-3));
  _prevFwdSpd = fwdSpd;

  // Wing-vapor should only show during genuinely aggressive manoeuvres:
  // tight turns, pull-ups, or push-downs — never during normal cruise or
  // mild corrections.
  const airborneGate = Math.min(1, fwdSpd / 34);
  const tightTurn = rollRate > 0.72 || yawRate > 0.52;
  const pullPush = pitchRate > 0.48 || verticalRate > 8.5 || Math.abs(aoa) > 0.14;
  const trailActive = !plane.onGround && airborneGate > 0.55 && (tightTurn || pullPush);
  const turnLoad = trailActive ? Math.max(
    Math.max(0, Math.abs(aoa) - 0.14) * 5.2,
    Math.max(0, rollRate  - 0.72) * 2.2,
    Math.max(0, pitchRate - 0.48) * 2.0,
    Math.max(0, yawRate   - 0.52) * 1.4,
    Math.max(0, verticalRate - 8.5) * 0.085
  ) * airborneGate : 0;
  scene.userData.__wingTrailIntensity = plane.onGround ? 0 : turnLoad;
  const greySmokeMix = clamp01(Math.max(engineSurgeState.greyMix * 1.1, Math.max(0, turnLoad - 0.78) * 0.24));
  const throatClearMix = clamp01(engineSurgeState.throatClear);

  vaporTimer += dt;
  if (turnLoad > 0.08) {
    const ints = Math.min(1.35, turnLoad);
    const emitInterval = ints > 1.0 ? 0.024 : ints > 0.62 ? 0.032 : 0.042;
    wingTrailStreamL.addPoint(wtL);
    wingTrailStreamR.addPoint(wtR);
    wingTrailStreamL.update(dt, true, 0.34 + ints * 0.22);
    wingTrailStreamR.update(dt, true, 0.34 + ints * 0.22);

    while (vaporTimer > emitInterval) {
      vaporTimer -= emitInterval;
    }
  } else {
    vaporTimer = Math.min(vaporTimer, 0.02);
    wingTrailStreamL.update(dt, false, 0);
    wingTrailStreamR.update(dt, false, 0);
  }

  // --- Damage-driven smoke (C8/C9) -----------------------------------
  //
  // Smoke is now gated by actual airframe state rather than normal
  // maneuvering. A healthy plane at cruise emits almost nothing; a
  // damaged plane emits proportionally. A crippled plane belches black
  // smoke. Engine events (power-cut restart, stall recovery) trigger a
  // transient dark puff via plane.engineEvent.
  plane.engineEvent = Math.max(0, plane.engineEvent - dt * 1.1); // ~1s decay

  // Engine heat — builds at sustained high throttle (>80%) and cools
  // below 50%. A hot engine (>0.7) joins damage as a trigger for dark
  // exhaust smoke. Simulates the "running it too hard" case.
  if (plane.engineHeat == null) plane.engineHeat = 0;
  const heatIn = plane.throttle > 0.8 ? (plane.throttle - 0.8) * 0.12 : 0;
  const heatOut = plane.throttle < 0.5 ? 0.15 : 0.04;
  plane.engineHeat = Math.max(0, Math.min(1, plane.engineHeat + (heatIn - heatOut) * dt));

  const damageMix = clamp01(plane.damage.engine * 0.65 + plane.damage.airframe * 0.45);
  // Grey damage smoke — ramps in only from ~25% damage, lighter tail.
  const damageSmokeMix = clamp01(Math.max(0, damageMix - 0.25) * 1.1);

  // Dark/black exhaust — ONLY from real damage or an overheated engine.
  // No power-cut cough, no stall-recovery puff. Damage floor raised so
  // a plane that's barely scuffed doesn't belch black smoke.
  const overheat = Math.max(0, plane.engineHeat - 0.70);
  const criticalMix = clamp01(
    Math.max(0, 1 - plane.health / 100 - 0.60) * 1.8 +
    Math.max(0, plane.damage.engine - 0.35) * 0.9 +
    overheat * 1.5
  );

  greyTurnSmokeTimer += dt;
  if (!plane.crashed && damageSmokeMix > 0.06 && greyTurnSmokeTimer > 0.07) {
    greyTurnSmokeTimer = 0;
    const spread = 0.26 + damageSmokeMix * 0.24;
    const driftUp = 0.30 + damageSmokeMix * 0.14;
    const lifeMul = 0.95 + damageSmokeMix * 1.05;
    const sizeMul = 1.02 + damageSmokeMix * 0.85;
    const count = Math.max(1, Math.round((damageSmokeMix > 0.65 ? 4 : damageSmokeMix > 0.35 ? 3 : 2) * pScale));
    greyTurnSmokeL.emitCluster(wlL, count, spread, driftUp, lifeMul, sizeMul);
    greyTurnSmokeR.emitCluster(wlR, count, spread, driftUp, lifeMul, sizeMul);
  }

  // Throat-clear only fires now when there's actual damage to cough up —
  // no more dark puff on a routine throttle cut/restart.
  const throatClearDriven = clamp01(
    Math.max(throatClearMix, plane.engineEvent * 0.9) * (damageMix > 0.2 ? 1 : 0)
  );
  throatClearSmokeTimer += dt;
  if (!plane.crashed && throatClearDriven > 0.05 && throatClearSmokeTimer > 0.055) {
    throatClearSmokeTimer = 0;
    const spread = 0.18 + throatClearDriven * 0.24;
    const driftUp = 0.22 + throatClearDriven * 0.12;
    const lifeMul = 0.88 + throatClearDriven * 1.05;
    const sizeMul = 0.92 + throatClearDriven * 0.95;
    const count = Math.max(1, Math.round((throatClearDriven > 0.58 ? 4 : 3) * pScale));
    throatClearSmokeL.emitCluster(wlL, count, spread, driftUp, lifeMul, sizeMul);
    throatClearSmokeR.emitCluster(wlR, count, spread, driftUp, lifeMul, sizeMul);
  }

  // Critical black exhaust — only when health has really bled out or
  // the engine is properly cooked. This is the "trailing black column"
  // people associate with a doomed plane.
  dirtyExhaustCoreTimer += dt;
  if (!plane.crashed && criticalMix > 0.08 && dirtyExhaustCoreTimer > 0.045) {
    dirtyExhaustCoreTimer = 0;
    const coreSpread = 0.10 + criticalMix * 0.10;
    const coreLife = 0.90 + criticalMix * 0.95;
    const coreSize = 0.82 + criticalMix * 0.72;
    const coreCount = Math.max(1, Math.round((criticalMix > 0.55 ? 4 : 3) * pScale));
    dirtyExhaustCore.emitCluster(wlCore, coreCount, coreSpread, 0.10, coreLife, coreSize);
  }

  // Engine contrail: emits when throttle is up and we're above ground
  const altAGL = plane.pos.y - getHeight(plane.pos.x, plane.pos.z);
  contrailTimer += dt;
  const emitInterval = plane.throttle > 0.55 ? 0.04 : 0.09;
  if (!plane.suppressJetFX && plane.throttle > 0.25 && altAGL > 4 && contrailTimer > emitInterval) {
    contrailTimer = 0;
    contrail.emit(wlE, 1.0, 0.7 + plane.throttle * 0.5);
  }

  vaporL.update(dt);
  vaporR.update(dt);
  greyTurnSmokeL.update(dt);
  greyTurnSmokeR.update(dt);
  throatClearSmokeL.update(dt);
  throatClearSmokeR.update(dt);
  dirtyExhaustCore.update(dt);
  contrail.update(dt);
  if (window.__mountainTargetSpin) window.__mountainTargetSpin(dt);
  if (window.__mountainPortalSpin) window.__mountainPortalSpin(dt);
}

