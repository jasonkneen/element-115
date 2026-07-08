// @module src/game/09c-ambient.js
// =============================================================
//  DUST DEVILS — swirling sand columns, deterministic placement
// =============================================================
const DUST_DEVIL_COUNT = 12;
const DUST_PARTICLES_PER_DEVIL = 30;

// Tan/dust colored sprite texture
const dustTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(220,180,130,0.9)');
  grd.addColorStop(0.5, 'rgba(190,145,100,0.4)');
  grd.addColorStop(1, 'rgba(180,130,90,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();

const dustDevilGeo = new THREE.BufferGeometry();
const dustDevilPos = new Float32Array(DUST_DEVIL_COUNT * DUST_PARTICLES_PER_DEVIL * 3);
const dustDevilAlpha = new Float32Array(DUST_DEVIL_COUNT * DUST_PARTICLES_PER_DEVIL);
const dustDevilSize = new Float32Array(DUST_DEVIL_COUNT * DUST_PARTICLES_PER_DEVIL);
dustDevilGeo.setAttribute('position', new THREE.BufferAttribute(dustDevilPos, 3));
dustDevilGeo.setAttribute('alpha', new THREE.BufferAttribute(dustDevilAlpha, 1));
dustDevilGeo.setAttribute('psize', new THREE.BufferAttribute(dustDevilSize, 1));

const dustDevilMat = new THREE.ShaderMaterial({
  uniforms: {
    color: { value: new THREE.Color(0xd4a577) },
    map: { value: dustTex },
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
});
const dustDevilPoints = new THREE.Points(dustDevilGeo, dustDevilMat);
dustDevilPoints.frustumCulled = false;
scene.add(dustDevilPoints);

// Each dust devil has a position near the player (wraps as they fly)
const dustDevils = [];
for (let i = 0; i < DUST_DEVIL_COUNT; i++) {
  const angle = srand(i, 0, 333) * Math.PI * 2;
  const dist = 400 + srand(i, 1, 333) * 1800;
  dustDevils.push({
    cx: Math.cos(angle) * dist,   // position relative to recentering anchor
    cz: Math.sin(angle) * dist,
    anchorX: 0,
    anchorZ: 0,
    height: 18 + srand(i, 2, 333) * 35,
    spinSpeed: 1.2 + srand(i, 3, 333) * 1.4,
    phase: srand(i, 4, 333) * 10,
  });
}

function currentAmbientFxDensity() {
  return scene.userData.__ambientFxDensity != null ? scene.userData.__ambientFxDensity : 1.0;
}

function updateDustDevils(t, px, pz) {
  const density = Math.max(0, Math.min(1.2, currentAmbientFxDensity()));
  const activeDevils = Math.max(0, Math.min(dustDevils.length, Math.round(dustDevils.length * density)));
  dustDevilPoints.visible = activeDevils > 0;
  if (!dustDevilPoints.visible) {
    dustDevilGeo.attributes.alpha.array.fill(0);
    dustDevilGeo.attributes.alpha.needsUpdate = true;
    return;
  }
  const time = t * 0.001;
  let idx = 0;

  for (let d = 0; d < activeDevils; d++) {
    const dev = dustDevils[d];
    // Recenter devils when player has moved more than 1500m — they "wrap"
    const dx = (dev.anchorX + dev.cx) - px;
    const dz = (dev.anchorZ + dev.cz) - pz;
    if (Math.sqrt(dx * dx + dz * dz) > 2200) {
      dev.anchorX = px; dev.anchorZ = pz;
    }
    const devX = dev.anchorX + dev.cx;
    const devZ = dev.anchorZ + dev.cz;
    const groundY = getHeight(devX, devZ);

    for (let p = 0; p < DUST_PARTICLES_PER_DEVIL; p++) {
      const rise = p / DUST_PARTICLES_PER_DEVIL;
      const radius = 2 + rise * 4.5;
      const spinAngle = time * dev.spinSpeed + dev.phase + rise * 6;
      const px2 = devX + Math.cos(spinAngle) * radius;
      const py2 = groundY + rise * dev.height;
      const pz2 = devZ + Math.sin(spinAngle) * radius;

      dustDevilPos[idx * 3]     = px2;
      dustDevilPos[idx * 3 + 1] = py2;
      dustDevilPos[idx * 3 + 2] = pz2;
      dustDevilAlpha[idx] = (0.55 * (1 - rise * 0.7)) * Math.min(1, density + 0.1);
      dustDevilSize[idx] = 3 + rise * 6;
      idx++;
    }
  }

  for (let i = idx; i < dustDevilAlpha.length; i++) dustDevilAlpha[i] = 0;
  dustDevilGeo.attributes.position.needsUpdate = true;
  dustDevilGeo.attributes.alpha.needsUpdate = true;
  dustDevilGeo.attributes.psize.needsUpdate = true;
}

// =============================================================
//  PLANE SHADOW — rely on real scene shadows now that shadow-maps are in
// =============================================================
function updateShadow() {}

const sunShadowFocus = new THREE.Vector3();
function updateSunShadowRig() {
  const groundH = (plane.pos.x * plane.pos.x + plane.pos.z * plane.pos.z < AIRFIELD_FLAT_R2)
    ? AIRFIELD_SURFACE_Y : getHeight(plane.pos.x, plane.pos.z);
  sunShadowFocus.set(
    plane.pos.x,
    groundH + Math.min(36, Math.max(8, (plane.pos.y - groundH) * 0.35)),
    plane.pos.z
  );
  sunTarget.position.copy(sunShadowFocus);
  const shadowDistance = Math.max(140, Math.min(340, scene.userData.__shadowDistance || 230));
  sun.position.copy(sunShadowFocus).addScaledVector(sunDir, Math.max(420, shadowDistance * 2.45));
  // Projection bounds depend only on shadowDistance (an options-panel setting);
  // recompute the projection matrix only when it actually changes.
  if (sun.shadow && sun.shadow.camera && sun.shadow.camera.userData.__lastDist !== shadowDistance) {
    const cam = sun.shadow.camera;
    cam.userData.__lastDist = shadowDistance;
    cam.left = -shadowDistance;
    cam.right = shadowDistance;
    cam.top = shadowDistance;
    cam.bottom = -shadowDistance;
    cam.far = Math.max(1100, shadowDistance * 6.2);
    cam.updateProjectionMatrix();
  }
  sunTarget.updateMatrixWorld();
}

// =============================================================
//  HEAT SHIMMER — wobbly additive plumes behind the engine
// =============================================================
const heatPool = new ParticlePool(scene, {
  max: 60, color: 0xffaa66, size: 1.6,
  life: 0.7, growth: 6.0, additive: true, texture: sharedSpriteTex,
});
const runwayPropWashPool = new ParticlePool(scene, {
  max: 120, color: 0xd9b07a, size: 1.8,
  life: 0.95, growth: 4.8, additive: false, texture: dustTex,
});
const propWashState = { timer: 0, mix: 0, active: false };
let heatTimer = 0;
function updateHeat(dt) {
  heatTimer += dt;
  if (plane.throttle > 0.15 && heatTimer > 0.04) {
    heatTimer = 0;
    const ex = jet.userData.engineExhaust.clone()
      .applyQuaternion(plane.quat).add(plane.pos);
    // Add small randomness for wobble
    ex.x += (Math.random() - 0.5) * 0.6;
    ex.y += (Math.random() - 0.5) * 0.6;
    if (!plane.suppressJetFX) heatPool.emit(ex, 0.6 + plane.throttle * 0.4, 0.5 + plane.throttle * 0.6);
  }
  heatPool.update(dt);
}
const _dustFwd = new THREE.Vector3();
const _dustRight = new THREE.Vector3();
const _dustDrift = new THREE.Vector3();
const _dustPos = new THREE.Vector3();
const _dustVel = new THREE.Vector3();

function emitRunwayDustBurst(center, intensity = 1.0, lateral = 0) {
  _dustFwd.set(0, 0, -1).applyQuaternion(plane.quat);
  _dustDrift.copy(_dustFwd).multiplyScalar(-0.4 - intensity * 1.1);
  _dustDrift.x += lateral * 0.28;
  _dustDrift.y = 0.45 + intensity * 0.35;
  _dustDrift.z += (Math.random() - 0.5) * 0.35;
  for (let i = 0; i < Math.max(2, Math.round(2 + intensity * 3)); i++) {
    _dustPos.copy(center);
    _dustPos.x += (Math.random() - 0.5) * 0.9;
    _dustPos.z += (Math.random() - 0.5) * 0.9;
    // emit() copies vel/pos into the pool particle — scratch is safe.
    runwayPropWashPool.emit(
      _dustPos,
      0.7 + intensity * 0.35,
      0.8 + intensity * 0.6,
      _dustVel.copy(_dustDrift).multiplyScalar(0.6 + Math.random() * 0.45),
    );
  }
}
function updateRunwayPropWash(dt) {
  propWashState.timer += dt;
  const groundSpeed = Math.hypot(plane.vel.x, plane.vel.z);
  const targetMix = (!plane.crashed && plane.onGround)
    ? clamp01(Math.max((plane.throttle - 0.18) / 0.82, groundSpeed / 28, plane.brake * 0.65))
    : 0;
  propWashState.mix += (targetMix - propWashState.mix) * Math.min(1, dt * 5.5);
  propWashState.active = propWashState.mix > 0.08;
  if (propWashState.active && propWashState.timer > Math.max(0.03, 0.085 - propWashState.mix * 0.04)) {
    propWashState.timer = 0;
    _dustRight.set(1, 0, 0).applyQuaternion(plane.quat);
    _dustFwd.set(0, 0, -1).applyQuaternion(plane.quat);
    for (const side of [-1, 1]) {
      _dustPos.copy(plane.pos)
        .addScaledVector(_dustRight, side * 1.7)
        .addScaledVector(_dustFwd, 1.1);
      _dustPos.y = (_dustPos.x * _dustPos.x + _dustPos.z * _dustPos.z < AIRFIELD_FLAT_R2)
        ? AIRFIELD_SURFACE_Y + 0.12
        : getHeight(_dustPos.x, _dustPos.z) + 0.12;
      emitRunwayDustBurst(_dustPos, 0.55 + propWashState.mix * 0.95, side);
    }
  }
  runwayPropWashPool.update(dt);
}

// =============================================================
//  BIRDS — distant flocks for life in the sky
// =============================================================
function makeBirdTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#1a1a1a';
  // Simple swept-wing silhouette (M shape)
  g.beginPath();
  g.moveTo(2, 18);
  g.quadraticCurveTo(9, 9, 16, 16);
  g.quadraticCurveTo(23, 9, 30, 18);
  g.quadraticCurveTo(23, 15, 16, 17);
  g.quadraticCurveTo(9, 15, 2, 18);
  g.closePath();
  g.fill();
  return new THREE.CanvasTexture(c);
}
const birdTex = makeBirdTexture();
const birdFlocks = [];
for (let f = 0; f < 5; f++) {
  const grp = new THREE.Group();
  const angle = srand(f, 0, 9999) * Math.PI * 2;
  const dist = 600 + srand(f, 1, 9999) * 1200;
  const baseY = 250 + srand(f, 2, 9999) * 350;
  grp.position.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
  const count = 4 + Math.floor(srand(f, 3, 9999) * 4);
  for (let i = 0; i < count; i++) {
    const mat = new THREE.SpriteMaterial({
      map: birdTex, color: 0x111111,
      transparent: true, depthWrite: false, fog: true,
    });
    const s = new THREE.Sprite(mat);
    s.scale.set(7, 4, 1);
    // V formation
    const off = i - (count - 1) / 2;
    s.position.set(off * 5, baseY + Math.abs(off) * 2.5, Math.abs(off) * 4);
    s.userData.flapPhase = i * 0.6;
    s.userData.baseY = s.position.y;
    grp.add(s);
  }
  scene.add(grp);
  birdFlocks.push(grp);
}
function updateBirds(t) {
  const density = Math.max(0, Math.min(1.2, currentAmbientFxDensity()));
  const activeFlocks = Math.max(0, Math.min(birdFlocks.length, Math.round(birdFlocks.length * density)));
  for (let i = 0; i < birdFlocks.length; i++) {
    const flock = birdFlocks[i];
    flock.visible = i < activeFlocks;
    if (!flock.visible) continue;
    flock.children.forEach(b => {
      const phase = t * 0.004 + b.userData.flapPhase;
      // Bobbing reads as flapping at distance
      b.position.y = b.userData.baseY + Math.sin(phase) * 3;
      // Vertical scale wobble for wing-flap motion
      b.scale.y = 4 + Math.sin(phase * 5) * 1.2;
    });
  }
}

