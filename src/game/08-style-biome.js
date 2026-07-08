// @module src/game/08-style-biome.js
// =============================================================
//  STYLE TOGGLE — realistic ↔ low-poly stylised
// =============================================================
const styleMode = { current: 'lowpoly' };

// Low-poly rock material — Phong supports flatShading (Lambert in r128 does not)
const rockMatLowPoly = new THREE.MeshPhongMaterial({
  color: 0xc88555, flatShading: true, shininess: 0
});
applyDistanceCulling(rockMatLowPoly, 350.0);


function applyAtmosphereProfile(profile) {
  scene.fog.near = profile.fogNear;
  scene.fog.far = profile.fogFar;
  waterMat.uniforms.fogNear.value = profile.fogNear;
  waterMat.uniforms.fogFar.value = profile.fogFar;
}

function applyStyle() {
  const lowPoly = styleMode.current === 'lowpoly';
  const sandM = lowPoly ? sandMatLowPoly : sandMat;
  const rockM = lowPoly ? rockMatLowPoly : rockMat;
  const floraM = lowPoly ? floraMatLow : floraMat;
  applyAtmosphereProfile(lowPoly ? ATMOS_LOWPOLY : ATMOS_REALISTIC);

  // Swap terrain + rock + flora materials on every existing chunk
  for (const c of chunks.values()) {
    if (c.terrainMesh) c.terrainMesh.material = sandM;
    c.group.children.forEach(child => {
      if (!child.isInstancedMesh) return;
      // Rocks use solid-color rockMat, flora uses vertex-color floraMat
      if (child.geometry === rockGeo) child.material = rockM;
      else child.material = floraM;
    });
  }
  for (const c of farChunks.values()) {
    c.mesh.material = sandM;
  }

  // Swap cloud materials (called safely — swapCloudMaterials handles init order)
  if (typeof swapCloudMaterials === 'function') swapCloudMaterials();

  // Toggle flat shading on the entire jet (Lambert doesn't support flatShading
  // in r128, so we only touch Standard / Phong materials)
  jet.traverse(obj => {
    const m = obj.material;
    if (!m || Array.isArray(m)) return;
    if (m.type === 'MeshStandardMaterial' || m.type === 'MeshPhongMaterial') {
      const keepTexturedShading = !!(m.map && m.userData && m.userData.__preserveTextureShading);
      const targetFlat = keepTexturedShading ? false : lowPoly;
      if (m.flatShading !== targetFlat) {
        m.flatShading = targetFlat;
        m.needsUpdate = true;
      }
    }
  });

  // Sky reads stronger in low-poly mode (less subtle gradient)
  skyMat.uniforms.exponent.value = lowPoly ? 0.35 : 0.55;

  // Update HUD indicator
  if (typeof $styleInd !== 'undefined' && $styleInd) {
    $styleInd.textContent = lowPoly ? 'LOW POLY' : 'REALISTIC';
    $styleInd.className = lowPoly ? 'warn' : 'ok';
  }
  if (typeof updateTimeOfDay === 'function') updateTimeOfDay(0);
}

function toggleStyle() {
  styleMode.current = styleMode.current === 'realistic' ? 'lowpoly' : 'realistic';
  applyStyle();
}

// =============================================================
//  BIOME SWITCHER — desert ↔ snow ↔ grassland
// =============================================================
const BIOME_ORDER = ['desert', 'snow', 'grassland'];

function applyBiome(name) {
  const b = BIOMES[name];
  if (!b) return;
  currentBiome.name = name;
  Object.assign(currentBiome, b);

  // Rewrite STRATA entries in-place (strataColor() dereferences by index)
  for (let i = 0; i < STRATA.length; i++) STRATA[i].c.setHex(b.strata[i].c);
  CLIFF_TINT.setHex(b.cliffTint);

  // Scene fog + background
  scene.background.setHex(b.fogColor);
  scene.fog.color.setHex(b.fogColor);
  waterMat.uniforms.fogColor.value.setHex(b.fogColor);

  // Sky dome gradient
  skyMat.uniforms.topColor.value.setHex(b.skyTop);
  skyMat.uniforms.bottomColor.value.setHex(b.skyBottom);

  // Actual scene lights should track the active biome too
  sun.color.setHex(b.sunColor);
  hemiLight.color.setHex(b.skyTop);
  hemiLight.groundColor.setHex(b.groundTint);
  ambientLight.color.setHex(b.ambient);

  // Sand shader uniforms (both realistic + low-poly variants)
  sandMat.uniforms.fogColor.value.setHex(b.fogColor);
  sandMat.uniforms.groundTint.value.setHex(b.groundTint);
  sandMat.uniforms.skyTint.value.setHex(b.skyTop);
  sandMat.uniforms.ambientColor.value.setHex(b.ambient);
  sandMat.uniforms.sunColor.value.setHex(b.sunColor);
  sandMatLowPoly.uniforms.fogColor.value.setHex(b.fogColor);
  sandMatLowPoly.uniforms.skyTint.value.setHex(b.skyTop);
  sandMatLowPoly.uniforms.groundTint.value.setHex(b.groundTint);
  sandMatLowPoly.uniforms.ambientColor.value.setHex(b.lowPolyAmbient);
  sandMatLowPoly.uniforms.sunColor.value.setHex(b.sunColor);

  // Cloud tint
  cloudMat.color.setHex(b.cloudColor);
  cloudMat.opacity = b.cloudOpacity;
  cloudMatLow.color.setHex(b.cloudColor);
  cloudMatLow.opacity = b.cloudOpacity;

  // Dust devil color — matches biome's ground tint
  if (typeof dustDevilMat !== 'undefined') {
    dustDevilMat.uniforms.color.value.setHex(b.groundTint).multiplyScalar(1.6);
  }

  // Nuke all loaded terrain chunks — they'll regenerate next frame with new
  // colors and biome-appropriate flora. Cheap since streaming rebuilds
  // automatically from the updateChunks() call in the animate loop.
  for (const c of chunks.values()) {
    scene.remove(c.group);
    c.geo.dispose();
  }
  chunks.clear();
  pendingChunkBuilds.length = 0;
  pendingChunkKeys.clear();
  for (const c of farChunks.values()) {
    scene.remove(c.mesh);
    c.geo.dispose();
  }
  farChunks.clear();
  pendingFarChunkBuilds.length = 0;
  pendingFarChunkKeys.clear();
  disposeAllHorizonChunks();
  // The chunk updaters early-out while the plane stays in the same cell —
  // invalidate the cached cell so the freshly cleared maps re-queue everything.
  _lastChunkCellX = null; _lastChunkCellZ = null;
  _lastFarCellX = null; _lastFarCellZ = null;
  updateChunks(plane.pos.x, plane.pos.z);
  updateFarChunks(plane.pos.x, plane.pos.z);
  updateHorizonChunks(plane.pos.x, plane.pos.z);
  processChunkBuildQueues(10, 32); // biome regen: build the visible subset fast, stream the rest

  // HUD update
  if (typeof $biomeInd !== 'undefined' && $biomeInd) {
    $biomeInd.textContent = b.label;
  }
  if (typeof updateTimeOfDay === 'function') updateTimeOfDay(0);
}

function cycleBiome() {
  const idx = BIOME_ORDER.indexOf(currentBiome.name);
  const next = BIOME_ORDER[(idx + 1) % BIOME_ORDER.length];
  applyBiome(next);
}

