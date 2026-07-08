// @module src/game/03-scene-postfx.js
// =============================================================
//  SCENE
// =============================================================
const SKY_TOP = new THREE.Color(currentBiome.skyTop);
const SKY_BOT = new THREE.Color(currentBiome.skyBottom);
const FOG_COLOR = currentBiome.fogColor;
const SUN_DIR = new THREE.Vector3(0.58, 0.76, 0.28).normalize();
const sunDir = SUN_DIR.clone();
const ATMOS_REALISTIC = Object.freeze({ fogNear: 360, fogFar: 6200, hazeStrength: 0.92, hazeExponent: 1.55 });
const ATMOS_LOWPOLY  = Object.freeze({ fogNear: 500, fogFar: 6100, hazeStrength: 0.98, hazeExponent: 1.30 });
const timeOfDay = {
  phase: 0.12,
  cycleSeconds: 420,
  daylight: 1,
  label: 'MORNING',
};

// =============================================================
//  BOOT LOG — prefixed `[flight-sim]` so it's easy to grep.
//  Every major init block emits a single ✓ or ✗ line so load-time
//  regressions (missing GLBs, TDZ errors, CDN script failures) show
//  up immediately in the devtools console instead of being buried.
// =============================================================
const bootLog = {
  t0: performance.now(),
  step(name, ok = true, extra = '') {
    const dt = (performance.now() - this.t0).toFixed(1);
    const mark = ok ? '✓' : '✗';
    const fn = ok ? console.log : console.error;
    fn(`[flight-sim] ${mark} ${name}${extra ? ' — ' + extra : ''}  (+${dt}ms)`);
  },
};
window.addEventListener('error', (e) => {
  console.error('[flight-sim] ✗ runtime error:', e.message,
    e.filename ? `at ${e.filename.split('/').pop()}:${e.lineno}:${e.colno}` : '');
});
bootLog.step('three.js', typeof THREE === 'object', typeof THREE === 'object' ? ('r' + (THREE.REVISION || '?')) : 'MISSING');
bootLog.step('GLTFLoader', typeof THREE !== 'undefined' && typeof THREE.GLTFLoader === 'function');
bootLog.step('post-processing', typeof THREE !== 'undefined' && typeof THREE.EffectComposer === 'function');
const worldOpportunities = buildWorldOpportunities();
bootLog.step('world opportunities', worldOpportunities.bridgeCandidates.length > 0 || worldOpportunities.portalCandidates.length > 0,
  `bridges=${worldOpportunities.bridgeCandidates.length} · portals=${worldOpportunities.portalCandidates.length}`);

const scene = new THREE.Scene();
scene.background = new THREE.Color(FOG_COLOR);
scene.fog = new THREE.Fog(FOG_COLOR, ATMOS_LOWPOLY.fogNear, ATMOS_LOWPOLY.fogFar);
bootLog.step('scene created');

// =============================================================
//  WATER — flat shader plane at WATER_LEVEL. Any terrain below this
//  height appears submerged. Follows the player horizontally so the
//  plane can fly in any direction without running out of water.
//  Runway exception built into the fragment shader so the airstrip
//  doesn't flood.
// =============================================================
const WATER_LEVEL = 4.0;
const WATER_EXTENT = 24000;     // size of the water plane
const WATER_RUNWAY_R = 420;     // no water within this radius of origin

const waterMat = new THREE.ShaderMaterial({
  uniforms: {
    time:      { value: 0 },
    shallow:   { value: new THREE.Color(0x4ea68a) },   // lake-edge teal
    deep:      { value: new THREE.Color(0x143a46) },   // lake centre
    skyTop:    { value: SKY_TOP.clone() },
    skyBottom: { value: SKY_BOT.clone() },
    cameraPos: { value: new THREE.Vector3() },
    fogColor:  { value: new THREE.Color(FOG_COLOR) },
    fogNear:   { value: ATMOS_LOWPOLY.fogNear },
    fogFar:    { value: ATMOS_LOWPOLY.fogFar },
    sunDir:    { value: SUN_DIR.clone() },
    runwayR:   { value: WATER_RUNWAY_R },
    reflectivity: { value: 1.28 },
    fresnelBoost: { value: 1.12 },
    sunGlint: { value: 1.18 },
    waterOpacity: { value: 0.92 },
    flowDir:      { value: new THREE.Vector2(0.94, 0.34) },
    foamColor:    { value: new THREE.Color(0xeaf7ff) },
    foamAmount:   { value: 0.55 },
    specPower:    { value: 90.0 },
    posterize:    { value: 12.0 },
    uEnhance:     { value: 1.0 },
  },
  vertexShader: `
    varying vec3 vWorldPos;
    varying float vDist;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      vec4 mv = viewMatrix * wp;
      vDist = -mv.z;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: `
    precision highp float;
    uniform float time;
    uniform vec3 shallow;
    uniform vec3 deep;
    uniform vec3 skyTop;
    uniform vec3 skyBottom;
    uniform vec3 cameraPos;
    uniform vec3 fogColor;
    uniform float fogNear;
    uniform float fogFar;
    uniform vec3 sunDir;
    uniform float runwayR;
    uniform float reflectivity;
    uniform float fresnelBoost;
    uniform float sunGlint;
    uniform float waterOpacity;
    uniform vec2 flowDir;
    uniform vec3 foamColor;
    uniform float foamAmount;
    uniform float specPower;
    uniform float posterize;
    uniform float uEnhance;
    varying vec3 vWorldPos;
    varying float vDist;

    // Cheap 2D value noise
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
        u.y
      );
    }

    void main() {
      // Runway punch-out: kill water within the airstrip clearing.
      // NOTE: ships DOES have a runway hole (F7 prose wrong); keep this.
      float rw = length(vWorldPos.xz);
      if (rw < runwayR) discard;
      float rwFade = smoothstep(runwayR, runwayR + 60.0, rw);

      // --- Flowing, multi-directional ripple field (6 noise taps) ---
      vec2 fl = flowDir;
      vec2 baseUv = vWorldPos.xz * 0.012;
      vec2 uv1 = baseUv + fl * (time * 0.05);
      vec2 uv2 = baseUv * 2.3 + vec2(-fl.y, fl.x) * (time * 0.07);
      float h0 = noise(uv1) * 0.62 + noise(uv2) * 0.38;
      float e = 0.5;
      float hX = noise(uv1 + vec2(e, 0.0)) * 0.62 + noise(uv2 + vec2(e, 0.0)) * 0.38;
      float hZ = noise(uv1 + vec2(0.0, e)) * 0.62 + noise(uv2 + vec2(0.0, e)) * 0.38;
      vec3 norm = normalize(vec3(-(hX - h0) * 0.85, 1.0, -(hZ - h0) * 0.85));

      vec3 viewDir = normalize(cameraPos - vWorldPos);
      vec3 L = normalize(sunDir);
      vec3 Hh = normalize(L + viewDir);

      // --- Blinn-Phong sun glint (tight specular) + broad sheen ---
      float ndh = max(dot(norm, Hh), 0.0);
      float glint = pow(ndh, specPower);
      float sheen = pow(ndh, max(specPower * 0.16, 1.0)) * 0.12;

      // --- Fresnel sky reflection ---
      float fresnel = pow(1.0 - max(0.0, dot(norm, viewDir)), 3.0);
      float skyMix = clamp(viewDir.y * 0.5 + 0.5, 0.0, 1.0);
      vec3 reflectedSky = mix(skyBottom, skyTop, pow(skyMix, 0.8));

      // --- Depth-tinted base with a hint of subsurface back-glow ---
      vec3 col = mix(deep, shallow, h0 * 0.58 + 0.24);
      float back = max(dot(-norm, L), 0.0);
      col += shallow * back * 0.05 * uEnhance;

      // --- Refractive bend: air-to-water vector drives caustic tint ---
      vec3 refr = refract(-viewDir, norm, 0.7502);
      vec2 refrUv = baseUv * 1.65 + refr.xz * (0.48 + (1.0 - norm.y) * 1.15) + fl * (time * 0.040);
      float refrN = noise(refrUv * 3.2) * 0.7 +
        noise(refrUv * 8.5 + vec2(time * 0.07, -time * 0.05)) * 0.3;
      float refrStrength = clamp(0.24 + length(refr.xz) * 0.32 + (1.0 - fresnel) * 0.24, 0.0, 0.58) * uEnhance;
      vec3 refrCol = mix(deep, shallow, 0.34 + refrN * 0.66);
      col = mix(col, refrCol, refrStrength);
      float refrCaustic = pow(max(1.0 - abs(refrN - 0.5) * 2.0, 0.0), 4.0);
      float refrRibbon = pow(0.5 + 0.5 * sin(vWorldPos.x * 0.055 + vWorldPos.z * 0.036 + time * 0.85), 8.0);
      col += shallow * refrCaustic * 0.26 * uEnhance * (1.0 - fresnel * 0.45);
      col += vec3(0.62, 0.95, 1.0) * refrRibbon * 0.10 * uEnhance;

      float reflectionMix = clamp((0.14 + fresnel * 0.44 * fresnelBoost) * reflectivity, 0.0, 0.94);
      col = mix(col, reflectedSky, reflectionMix);
      col += reflectedSky * sheen * uEnhance;
      col += vec3(1.0, 0.98, 0.92) * glint * (0.28 + 0.42 * sunGlint);

      // --- Foam: animated wave crests + a shoreline ring at the runway edge ---
      float crest = smoothstep(0.66, 0.95, h0);
      float shore = 1.0 - smoothstep(runwayR, runwayR + 24.0, rw);
      float foamN = noise(baseUv * 7.0 + fl * (time * 0.22));
      float foam = clamp((crest + shore * 0.85) * foamAmount * (0.45 + foamN * 0.75), 0.0, 1.0);
      col = mix(col, foamColor, foam * uEnhance);

      // Cel posterization (12 levels reproduces the old low-poly look)
      if (posterize > 0.5) col = floor(col * posterize) / posterize;

      // Linear fog so water fades into the horizon haze like terrain
      float fogF = clamp((vDist - fogNear) / (fogFar - fogNear), 0.0, 1.0);
      col = mix(col, fogColor, fogF);

      gl_FragColor = vec4(col, waterOpacity * rwFade);
    }
  `,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
});

const waterGeo = new THREE.PlaneGeometry(WATER_EXTENT, WATER_EXTENT, 1, 1);
waterGeo.rotateX(-Math.PI / 2);
const waterMesh = new THREE.Mesh(waterGeo, waterMat);
waterMesh.position.y = WATER_LEVEL;
waterMesh.renderOrder = 3;   // after terrain, before clouds/sky
scene.add(waterMesh);

function updateWater(dt, px, pz) {
  waterMat.uniforms.time.value += dt;
  sandMat.uniforms.time.value += dt;
  sandMatLowPoly.uniforms.time.value += dt;
  waterMat.uniforms.cameraPos.value.copy(camera.position);
  // Snap position to a coarse grid so the ripple pattern doesn't
  // stutter as the player moves. Step = 40m.
  const step = 40;
  waterMesh.position.x = Math.round(px / step) * step;
  waterMesh.position.z = Math.round(pz / step) * step;
}

const CAMERA_REFERENCE_ASPECT = 16 / 9;
const CAMERA_BASE_FOV = 60;
const CAMERA_MAX_FOV = 68;
const CAMERA_MIN_FOV = 44;

function aspectCorrectedCameraFov(rawVerticalFov, aspect) {
  const fov = Math.max(CAMERA_MIN_FOV, Math.min(CAMERA_MAX_FOV, rawVerticalFov));
  const safeAspect = Math.max(0.25, aspect || CAMERA_REFERENCE_ASPECT);
  if (safeAspect <= CAMERA_REFERENCE_ASPECT) return fov;
  const halfTan = Math.tan(THREE.MathUtils.degToRad(fov) * 0.5);
  return THREE.MathUtils.radToDeg(2 * Math.atan((halfTan * CAMERA_REFERENCE_ASPECT) / safeAspect));
}

function applyCameraLensFov(rawVerticalFov, blend = 1) {
  const prevLensFov = camera.userData.lensFov == null ? CAMERA_BASE_FOV : camera.userData.lensFov;
  const targetLensFov = Math.max(CAMERA_MIN_FOV, Math.min(CAMERA_MAX_FOV, rawVerticalFov));
  const nextLensFov = prevLensFov + (targetLensFov - prevLensFov) * Math.max(0, Math.min(1, blend));
  camera.userData.lensFov = nextLensFov;
  camera.fov = aspectCorrectedCameraFov(nextLensFov, camera.aspect);
  camera.updateProjectionMatrix();
}

const camera = new THREE.PerspectiveCamera(
  aspectCorrectedCameraFov(CAMERA_BASE_FOV, window.innerWidth / window.innerHeight),
  window.innerWidth / window.innerHeight,
  0.8,
  14000
);
camera.userData.lensFov = CAMERA_BASE_FOV;

const renderer = new THREE.WebGLRenderer({
  antialias: false, powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.35));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
// PCF + shadow.radius reads nearly identical to PCFSoft here but is markedly
// cheaper per shadowed fragment (PCFSoft ignores radius and supersamples instead).
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute('aria-label', 'Flight simulator view');
document.body.appendChild(renderer.domElement);
bootLog.step('WebGL renderer', !!renderer.getContext(),
  renderer.capabilities ? `${renderer.capabilities.maxTextureSize}px · ${renderer.capabilities.precision}` : '');

const postFX = {
  enabled: false,
  ready: false,
  composer: null,
  bokehPass: null,
  fxaaPass: null,
  bloomPass: null,
  motionBlurPass: null,
};

const MOTION_BLUR_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    strength: { value: 0 },
    aspect: { value: window.innerWidth / Math.max(1, window.innerHeight) },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float strength;
    uniform float aspect;
    varying vec2 vUv;

    float rand2(vec2 n) {
      return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);
    }

    void main() {
      vec2 centered = vUv - vec2(0.5);
      // Direction from center outward — motion blur trails behind
      vec2 dir = normalize(vec2(centered.x, centered.y * aspect) + vec2(0.0001));
      float dist = length(centered);
      float edgeFalloff = smoothstep(0.30, 0.78, dist); // keep the frame centre clean
      float positionalStrength = edgeFalloff * strength * 0.018;
      vec4 accum = vec4(0.0);
      float total = 0.0;
      // 4 iterations (9 taps with base) — the per-pixel jitter hides any banding
      // at the strengths this pass runs at, and it's a full-screen bandwidth pass.
      for (int i = 0; i < 4; i++) {
        float stepF = (float(i) + rand2(vUv * 8.0)) * 0.33;
        vec2 offset = dir * positionalStrength * stepF;
        accum += texture2D(tDiffuse, clamp(vUv + offset, vec2(0.001), vec2(0.999)));
        accum += texture2D(tDiffuse, clamp(vUv - offset, vec2(0.001), vec2(0.999)));
        total += 2.0;
      }
      vec4 base = texture2D(tDiffuse, vUv);
      vec4 blur = accum / max(1.0, total);
      gl_FragColor = mix(base, blur, clamp(strength, 0.0, 0.85));
    }
  `,
};

function updateFxaaPassResolution() {
  if (!postFX.fxaaPass || !postFX.fxaaPass.material || !postFX.fxaaPass.material.uniforms || !postFX.fxaaPass.material.uniforms.resolution) return;
  const pxRatio = renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
  postFX.fxaaPass.material.uniforms.resolution.value.set(
    1 / Math.max(1, window.innerWidth * pxRatio),
    1 / Math.max(1, window.innerHeight * pxRatio),
  );
}

function initPostFX() {
  if (typeof THREE.EffectComposer !== 'function' || typeof THREE.RenderPass !== 'function') return;
  try {
    // The GL context is created with antialias:false, so the composer path
    // has zero geometric AA and FXAA alone leaves hard sawtooth edges on
    // low-poly silhouettes. On WebGL2, render into a 4x MSAA target instead
    // (r128: WebGLMultisampleRenderTarget; EffectComposer.clone() preserves
    // the samples count for its second buffer).
    let composerTarget;
    if (renderer.capabilities && renderer.capabilities.isWebGL2 && typeof THREE.WebGLMultisampleRenderTarget === 'function') {
      const dbSize = renderer.getDrawingBufferSize(new THREE.Vector2());
      composerTarget = new THREE.WebGLMultisampleRenderTarget(dbSize.x, dbSize.y, { format: THREE.RGBAFormat });
      // 2x, not 4x: at pixelRatio ~1.6 the visual difference is marginal but
      // 4x MSAA doubles AA fill-rate cost and pushed frame time into the
      // 55-58fps judder band on mid GPUs.
      composerTarget.samples = 2;
      composerTarget.texture.name = 'EffectComposer.rt1';
    }
    postFX.composer = composerTarget
      ? new THREE.EffectComposer(renderer, composerTarget)
      : new THREE.EffectComposer(renderer);
    postFX.msaa = !!composerTarget;
    const renderPass = new THREE.RenderPass(scene, camera);
    postFX.composer.addPass(renderPass);

    if (typeof THREE.BokehPass === 'function') {
      postFX.bokehPass = new THREE.BokehPass(scene, camera, {
        focus: 18.0,
        aperture: 0.00008,
        maxblur: 0.0035,
        width: window.innerWidth,
        height: window.innerHeight,
      });
      postFX.bokehPass.enabled = false;
      postFX.composer.addPass(postFX.bokehPass);
    }

    if (typeof THREE.UnrealBloomPass === 'function' && typeof THREE.Vector2 === 'function') {
      // Half-res input: the bloom mip chain is bandwidth-bound and visually
      // indistinguishable at half size for the soft strengths used here.
      postFX.bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.45, 0.28, 0.86);
      postFX.bloomPass.enabled = false;
      postFX.composer.addPass(postFX.bloomPass);
    }

    if (typeof THREE.ShaderPass === 'function') {
      postFX.motionBlurPass = new THREE.ShaderPass(MOTION_BLUR_SHADER);
      postFX.motionBlurPass.enabled = false;
      postFX.composer.addPass(postFX.motionBlurPass);
    }

    if (typeof THREE.ShaderPass === 'function' && typeof THREE.FXAAShader === 'object') {
      postFX.fxaaPass = new THREE.ShaderPass(THREE.FXAAShader);
      postFX.fxaaPass.enabled = true;
      postFX.composer.addPass(postFX.fxaaPass);
      updateFxaaPassResolution();
    }

    postFX.ready = true;
  } catch (err) {
    console.warn('[postfx] disabled', err && err.message ? err.message : err);
    postFX.enabled = false;
    postFX.ready = false;
  }
}

function updateDepthOfField() {
  if (!postFX.enabled || !postFX.bokehPass) return;
  const focusTarget = camera.userData.focusTarget || plane.pos;
  const focusDistance = Math.max(6, camera.position.distanceTo(focusTarget));
  const agl = plane && plane.pos ? Math.max(0, plane.pos.y - getHeight(plane.pos.x, plane.pos.z)) : 0;
  const groundFactor = plane && plane.onGround ? 1 : 0;
  const nightFactor = timeOfDay ? (1 - timeOfDay.daylight) : 0;
  const focus = focusDistance;
  const aperture = 0.00003 + groundFactor * 0.000035 + nightFactor * 0.000015 + Math.min(agl / 900, 1) * 0.00001;
  const maxblur = 0.0015 + groundFactor * 0.002 + nightFactor * 0.0012;
  const uniforms = postFX.bokehPass.materialBokeh.uniforms;
  uniforms.focus.value += (focus - uniforms.focus.value) * 0.12;
  uniforms.aperture.value += (aperture - uniforms.aperture.value) * 0.12;
  uniforms.maxblur.value += (maxblur - uniforms.maxblur.value) * 0.12;
}

function updateMotionBlurPostFX() {
  if (!postFX.motionBlurPass || !postFX.motionBlurPass.uniforms) return;
  const blurEnabled = window.gfx ? window.gfx.motionBlur !== false : true;
  const blurAmount = scene.userData.__motionBlurAmount != null ? scene.userData.__motionBlurAmount : 0.42;
  const speedKts = plane.vel.length() * 1.94;
  const throttleFactor = clamp01((plane.throttle - 0.42) / 0.58);
  const speedFactor = clamp01((speedKts - 45) / 230);
  // Cap well below the old 0.82 — high strengths smear the whole frame.
  const baseStrength = clamp01(speedFactor * (0.22 + throttleFactor * 0.92)) * 0.5;
  const targetStrength = blurEnabled ? baseStrength * blurAmount : 0;
  const current = postFX.motionBlurPass.uniforms.strength.value || 0;
  const blend = targetStrength < current ? 0.24 : 0.14;
  postFX.motionBlurPass.uniforms.strength.value = current + (targetStrength - current) * blend;
  postFX.motionBlurPass.uniforms.aspect.value = window.innerWidth / Math.max(1, window.innerHeight);
  // Skip the pass entirely below a visible strength — at <0.04 the blur is
  // imperceptible but still costs a full-screen render-target pass.
  postFX.motionBlurPass.enabled = blurEnabled && postFX.motionBlurPass.uniforms.strength.value > 0.04;
}

function renderScene() {
  const fxaaActive = !!(postFX.fxaaPass && postFX.fxaaPass.enabled);
  const bloomActive = !!(postFX.bloomPass && postFX.bloomPass.enabled);
  const motionBlurActive = !!(postFX.motionBlurPass && postFX.motionBlurPass.enabled);
  if ((postFX.enabled || fxaaActive || bloomActive || motionBlurActive) && postFX.composer) postFX.composer.render();
  else renderer.render(scene, camera);
}

initPostFX();

// Sky dome
const skyMat = new THREE.ShaderMaterial({
  uniforms: {
    topColor: { value: SKY_TOP },
    bottomColor: { value: SKY_BOT },
    offset: { value: 100 },
    exponent: { value: 0.55 },
    sunDirection: { value: SUN_DIR.clone() },
    sunColor: { value: new THREE.Color(0xfff1d4) },
    daylight: { value: 1.0 },
    twilight: { value: 0.0 },
    lowPoly: { value: 1.0 },
  },
  vertexShader: `
    varying vec3 vW;
    void main() {
      vW = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    precision highp float;
    uniform vec3 topColor;
    uniform vec3 bottomColor;
    uniform vec3 sunDirection;
    uniform vec3 sunColor;
    uniform float offset;
    uniform float exponent;
    uniform float daylight;
    uniform float twilight;
    uniform float lowPoly;
    varying vec3 vW;

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main() {
      // Sky dome follows the camera, so vW - cameraPosition is the view ray.
      vec3 dir = normalize(vW - cameraPosition);
      float h = normalize(vW + vec3(0.0, offset, 0.0)).y;
      vec3 base = mix(bottomColor, topColor, pow(max(h, 0.0), exponent));

      float mu = max(dot(dir, normalize(sunDirection)), 0.0);

      // Mie forward-scatter halo — broad warm glow around the sun, boosted at twilight
      float halo = pow(mu, 8.0) * 0.45 + pow(mu, 2.0) * 0.10;
      halo *= (0.35 + twilight * 0.9) * daylight;
      base += sunColor * halo;

      // Horizon saturation band — warm haze thickening toward the horizon line
      float band = pow(1.0 - abs(dir.y), 6.0);
      base = mix(base, sunColor * 0.6 + bottomColor * 0.5, band * (0.12 + twilight * 0.30) * daylight);

      // Soft sun disc: bright feathered core + faint outer glow
      float disc = smoothstep(0.9985, 0.99975, mu);
      float glow = smoothstep(0.995, 1.0, mu);
      base += sunColor * (disc * 1.6 + glow * 0.5) * daylight;

      // Static star field — hash-cell points in the upper hemisphere, faded in at night
      float night = 1.0 - daylight;
      if (night > 0.01 && dir.y > 0.02) {
        vec2 sc = dir.xz / max(dir.y + 0.35, 0.15);
        vec2 cell = floor(sc * 26.0);
        float star = hash21(cell);
        float bright = smoothstep(0.982, 0.999, star);
        float tw = 0.6 + 0.4 * sin(hash21(cell + 3.1) * 40.0);
        float upper = smoothstep(0.02, 0.30, dir.y);
        base += vec3(0.9, 0.93, 1.0) * bright * tw * upper * night * (1.0 - lowPoly * 0.35);
      }

      gl_FragColor = vec4(base, 1.0);
    }`,
  side: THREE.BackSide,
  depthWrite: false,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(12000, 32, 16), skyMat);
scene.add(sky);

// Lights
const sunTarget = new THREE.Object3D();
scene.add(sunTarget);
const sun = new THREE.DirectionalLight(0xfff1d4, 1.65);
sun.position.copy(sunDir).multiplyScalar(650);
sun.target = sunTarget;
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.bias = -0.00018;
sun.shadow.normalBias = 0.02;
sun.shadow.radius = 3;
sun.shadow.camera.near = 80;
sun.shadow.camera.far = 1400;
sun.shadow.camera.left = -230;
sun.shadow.camera.right = 230;
sun.shadow.camera.top = 230;
sun.shadow.camera.bottom = -230;
scene.add(sun);
const hemiLight = new THREE.HemisphereLight(0x9cbfe0, 0x8f6745, 0.42);
scene.add(hemiLight);
const ambientLight = new THREE.AmbientLight(0x4a3d32, 0.16);
scene.add(ambientLight);

// =============================================================
//  SAND SHADER — custom material for terrain
//  Wind-rippled normals, sun sparkle, hemisphere fill, backscatter
// =============================================================
const SAND_VS = `
  attribute vec3 color;
  varying vec3 vColor;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  void main() {
    vColor = color;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const SAND_FS = `
  precision highp float;
  uniform vec3 sunDir;
  uniform vec3 sunColor;
  uniform vec3 ambientColor;
  uniform vec3 skyTint;
  uniform vec3 groundTint;
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  uniform float hazeStrength;
  uniform float hazeExponent;
  uniform float waterLevel;
  uniform float time;

  varying vec3 vColor;
  varying vec3 vWorldPos;
  varying vec3 vNormal;

  // Stable hash for sparkle noise
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f*f*(3.0-2.0*f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  void main() {
    vec3 N = normalize(vNormal);
    vec2 uv = vWorldPos.xz;

    // ---- Wind-blown sand ripples ----
    // Multiple sin waves at different angles + scales = natural look
    float r1 = cos(uv.x * 0.55 + uv.y * 0.21);
    float r2 = cos(uv.y * 0.62 - uv.x * 0.27 + 1.7);
    float r3 = cos((uv.x + uv.y) * 0.13);
    // Mid-frequency dune-edge perturbation
    float r4 = cos(uv.x * 1.8 + uv.y * 0.6) * 0.3;
    float r5 = cos(uv.y * 1.6 - uv.x * 1.2 + 0.5) * 0.3;
    vec3 rippleN = normalize(vec3(
      r1 * 0.06 + r3 * 0.02 + r4 * 0.025,
      1.0,
      r2 * 0.06 + r3 * 0.02 + r5 * 0.025
    ));

    // Apply ripples ONLY on sandy/flat areas, not steep cliff faces
    float flatness = smoothstep(0.55, 0.92, N.y);
    vec3 perturbed = normalize(mix(N, normalize(N + (rippleN - vec3(0.0, 1.0, 0.0)) * 0.7), flatness));

    // ---- Lighting ----
    vec3 L = normalize(sunDir);
    float rawNdotL = dot(perturbed, L);
    float NdotL = max(rawNdotL, 0.0);
    float sunFacing = smoothstep(-0.18, 0.78, rawNdotL);

    // Hemisphere fill (sky from above, warm bounce from ground)
    float hemi = perturbed.y * 0.5 + 0.5;
    vec3 hemiCol = mix(groundTint, skyTint, hemi);

    // ---- Macro albedo patchiness (2-octave value noise) ----
    // Low-freq basins + mid-freq mottling break the flat single-colour read at
    // 100-800m; gated by flatness so cliff faces keep their strata colours.
    float m1 = vnoise(uv * 0.004);
    float m2 = vnoise(uv * 0.018);
    float macro = (m1 - 0.5) * 0.10 + (m2 - 0.5) * 0.06;
    vec3 hue = mix(vec3(1.0), vec3(1.05, 1.0, 0.95), m1);
    vec3 albedo = vColor * (1.0 + macro * flatness) * mix(vec3(1.0), hue, flatness);
    vec3 diffuse = albedo * (NdotL * sunColor + hemiCol * 0.45 + ambientColor);

    // ---- Specular + sand sparkle ----
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 H = normalize(L + V);
    float NdotH = max(dot(perturbed, H), 0.0);
    // Soft broad spec — sand isn't shiny, but has some
    float spec = pow(NdotH, 22.0) * 0.18 * flatness;
    // Crystalline sparkle — high-freq noise threshold gated by viewing angle
    float sparkleNoise = vnoise(uv * 55.0);
    float sparkleMask = smoothstep(0.79, 0.93, sparkleNoise) * pow(NdotH, 90.0) * flatness;
    vec3 sparkle = sunColor * sparkleMask * 5.0;

    // ---- Subsurface backscatter ----
    // Sand glows slightly when sun is behind it (light passes through grains)
    float backLight = max(dot(-perturbed, L), 0.0);
    vec3 backScatter = vColor * sunColor * backLight * 0.07;

    // ---- Rim light at grazing angles (atmospheric glow) ----
    float rim = 1.0 - max(dot(N, V), 0.0);
    rim = pow(rim, 2.5) * 0.15;
    vec3 rimCol = mix(vColor, fogColor, 0.6) * rim;

    vec3 color = diffuse + spec * sunColor + sparkle + backScatter + rimCol;
    color *= mix(vec3(0.72, 0.78, 0.88), vec3(1.03, 1.0, 0.97), sunFacing);

    // ---- Shoreline foam band — constrained to true shorelines (R5 F15) ----
    // Narrow to the ~2.5m just above water, biased hard at the very edge; fade
    // out past 1200m (shoreline detail only, kills grazing-angle far stripes);
    // break long bands into patches with a large-scale noise mask so flat coasts
    // read as foam pockets, not horizontal stripes.
    float foamEdge = 1.0 - smoothstep(waterLevel + 0.35, waterLevel + 2.8, vWorldPos.y);
    foamEdge = pow(foamEdge, 1.7) * step(waterLevel - 0.5, vWorldPos.y);
    float foamDist = length(vWorldPos - cameraPosition);
    foamEdge *= 1.0 - smoothstep(900.0, 1200.0, foamDist);
    float foamPatch = smoothstep(0.35, 0.75, vnoise(vWorldPos.xz * 0.05));
    float foamBand = foamEdge * (0.35 + 0.65 * foamPatch)
                   * (0.55 + 0.55 * vnoise(vWorldPos.xz * 3.0 + vec2(time * 0.15)));
    color = mix(color, vec3(0.92, 0.97, 1.0), clamp(foamBand, 0.0, 1.0) * 0.55);

    // ---- Distance haze / aerial perspective ----
    float dist = length(vWorldPos - cameraPosition);
    float fogF = clamp((dist - fogNear) / (fogFar - fogNear), 0.0, 1.0);
    float horizon = pow(clamp(1.0 - abs(V.y), 0.0, 1.0), hazeExponent);
    float haze = clamp(fogF * (0.86 + horizon * hazeStrength), 0.0, 1.0);
    vec3 hazeColor = mix(fogColor, skyTint, 0.38 + horizon * 0.22);
    color = mix(color, hazeColor, haze);

    gl_FragColor = vec4(color, 1.0);
  }
`;

const sandMat = new THREE.ShaderMaterial({
  uniforms: {
    sunDir:        { value: SUN_DIR.clone() },
    sunColor:      { value: new THREE.Color(0xfff1d4) },
    ambientColor:  { value: new THREE.Color(0x2a2520) },
    skyTint:       { value: new THREE.Color(0x88aacc) },
    groundTint:    { value: new THREE.Color(0x6a4830) },
    fogColor:      { value: new THREE.Color(0xe8b888) },
    fogNear:       { value: ATMOS_REALISTIC.fogNear },
    fogFar:        { value: ATMOS_REALISTIC.fogFar },
    hazeStrength:  { value: ATMOS_REALISTIC.hazeStrength },
    hazeExponent:  { value: ATMOS_REALISTIC.hazeExponent },
    waterLevel:    { value: WATER_LEVEL },
    time:          { value: 0 },
  },
  vertexShader: SAND_VS,
  fragmentShader: SAND_FS,
});

// =============================================================
//  LOW-POLY SHADER — flat-shaded cel rendering for stylised mode
// =============================================================
const LOWPOLY_FS = `
  precision highp float;
  uniform vec3 sunDir;
  uniform vec3 sunColor;
  uniform vec3 ambientColor;
  uniform vec3 skyTint;
  uniform vec3 groundTint;
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  uniform float hazeStrength;
  uniform float hazeExponent;
  uniform float waterLevel;
  uniform float time;

  varying vec3 vColor;
  varying vec3 vWorldPos;
  varying vec3 vNormal;

  // Value noise (copied from SAND_FS — LOWPOLY_FS had none) for foam breakup
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f*f*(3.0-2.0*f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  void main() {
    // True flat shading: derive normal from screen-space position derivatives,
    // so every triangle gets one solid color regardless of vertex normals
    vec3 dx = dFdx(vWorldPos);
    vec3 dy = dFdy(vWorldPos);
    vec3 N = normalize(cross(dx, dy));
    if (N.y < 0.0) N = -N;

    vec3 L = normalize(sunDir);
    float rawNdotL = dot(N, L);
    float NdotL = max(rawNdotL, 0.0);
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 H = normalize(L + V);

    // Cel-shaded: 4 softer light bands so low-poly mode keeps the faceted
    // read, but now responds to the same richer sun / sky / ground lighting
    // palette as the realistic terrain.
    float band;
    if (NdotL > 0.72)       band = 1.00;
    else if (NdotL > 0.38)  band = 0.86;
    else if (NdotL > 0.02)  band = 0.74;
    else                    band = 0.62;

    // Posterise color, but with more steps and a gentler boost
    vec3 c = vColor * 1.04;
    c = floor(c * 12.0) / 12.0;
    float lum = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(lum), c, 1.08);

    // Dynamic hemisphere fill — same warm ground bounce / cool sky fill
    // used by the realistic terrain, but slightly simplified for low-poly.
    float hemi = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 hemiCol = mix(groundTint, skyTint, hemi);
    float sunFacing = smoothstep(-0.18, 0.78, rawNdotL);
    float backLight = max(dot(-N, L), 0.0);
    float spec = pow(max(dot(N, H), 0.0), 18.0) * 0.08;
    float rim = pow(1.0 - max(dot(N, V), 0.0), 2.5) * 0.12;
    vec3 rimCol = mix(c, fogColor, 0.55) * rim;
    vec3 shadowCol = mix(groundTint, skyTint, 0.70 + hemi * 0.24);
    vec3 litCol = band * sunColor + hemiCol * 0.52 + ambientColor;
    vec3 shadeCol = shadowCol * (0.56 + hemi * 0.14) + ambientColor * 0.56;

    vec3 color = c * mix(shadeCol, litCol, smoothstep(-0.12, 0.34, rawNdotL));
    color += spec * sunColor;
    color += c * sunColor * backLight * 0.08;
    color += rimCol;
    color *= mix(vec3(0.84, 0.88, 0.95), vec3(1.04, 1.00, 0.96), sunFacing);

    // ---- Shoreline foam band — constrained to true shorelines (R5 F15) ----
    // Identical policy to SAND_FS: narrow near-water edge, 1200m distance fade,
    // large-scale patch mask so flat low-poly coasts read as pockets not stripes.
    float foamEdge = 1.0 - smoothstep(waterLevel + 0.35, waterLevel + 2.8, vWorldPos.y);
    foamEdge = pow(foamEdge, 1.7) * step(waterLevel - 0.5, vWorldPos.y);
    float foamDist = length(vWorldPos - cameraPosition);
    foamEdge *= 1.0 - smoothstep(900.0, 1200.0, foamDist);
    float foamPatch = smoothstep(0.35, 0.75, vnoise(vWorldPos.xz * 0.05));
    float foamBand = foamEdge * (0.35 + 0.65 * foamPatch)
                   * (0.55 + 0.55 * vnoise(vWorldPos.xz * 3.0 + vec2(time * 0.15)));
    color = mix(color, vec3(0.92, 0.97, 1.0), clamp(foamBand, 0.0, 1.0) * 0.55);

    // Lighter fog + horizon haze so distant terrain sits deeper in the scene
    float dist = length(vWorldPos - cameraPosition);
    float fogF = clamp((dist - fogNear) / (fogFar - fogNear), 0.0, 1.0);
    float horizon = pow(clamp(1.0 - abs(V.y), 0.0, 1.0), hazeExponent);
    float haze = clamp(fogF * (0.96 + horizon * (hazeStrength + 0.18)), 0.0, 1.0);
    vec3 hazeColor = mix(fogColor, skyTint, 0.66 + horizon * 0.16);
    color = mix(color, hazeColor, haze);

    gl_FragColor = vec4(color, 1.0);
  }
`;

const sandMatLowPoly = new THREE.ShaderMaterial({
  uniforms: {
    sunDir:       { value: SUN_DIR.clone() },
    sunColor:     { value: new THREE.Color(0xfff1d4) },
    ambientColor: { value: new THREE.Color(0x3a3328) },
    skyTint:      { value: new THREE.Color(0x88aacc) },
    groundTint:   { value: new THREE.Color(0x6a4830) },
    fogColor:     { value: new THREE.Color(0xe8b888) },
    fogNear:      { value: ATMOS_LOWPOLY.fogNear },
    fogFar:       { value: ATMOS_LOWPOLY.fogFar },
    hazeStrength: { value: ATMOS_LOWPOLY.hazeStrength },
    hazeExponent: { value: ATMOS_LOWPOLY.hazeExponent },
    waterLevel:   { value: WATER_LEVEL },
    time:         { value: 0 },
  },
  vertexShader: SAND_VS,
  fragmentShader: LOWPOLY_FS,
  extensions: { derivatives: true },
});

