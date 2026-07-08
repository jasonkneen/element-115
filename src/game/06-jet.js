// @module src/game/06-jet.js
// =============================================================
//  FIGHTER JET
// =============================================================
function makeJet() {
  // ===== JET BUILD HELPERS (Round 6) =====
  // Generated once at module load; shared by every makeJet mesh.
  // WINDING NOTE for buildFuselageGeom + airfoilSurface: index order below
  // yields OUTWARD normals (verified: ring in local plane advancing along the
  // loft axis, cross-product points out). If a hero mesh renders inside-out at
  // boot (dark/back-culled interior), swap each face pair a,b,c / b,d,c -> a,c,b / b,c,d.

  // Teardrop cube-env for glass + subtle metal reflections (F17). 6 tiny
  // canvas faces: sky-blue top, warm-horizon sides, dark ground. No fetch,
  // not a light (I5 safe), CubeReflectionMapping default.
  function buildJetEnvCube() {
    const S = 32;
    const face = (top, bot) => {
      const c = document.createElement('canvas'); c.width = c.height = S;
      const x = c.getContext('2d');
      const g = x.createLinearGradient(0, 0, 0, S);
      g.addColorStop(0, top); g.addColorStop(1, bot);
      x.fillStyle = g; x.fillRect(0, 0, S, S);
      return c;
    };
    const side = face('#cfe0ee', '#e8cf9e');   // sky-top into warm horizon
    // order: +x, -x, +y, -y, +z, -z
    const imgs = [ side, face('#cfe0ee', '#e8cf9e'), face('#7fb2e6', '#8fbdec'),
                   face('#35322e', '#2a2724'), face('#cfe0ee', '#e8cf9e'),
                   face('#cfe0ee', '#e8cf9e') ];
    const tex = new THREE.CubeTexture(imgs);
    tex.needsUpdate = true;
    return tex;
  }

  // Lofted fuselage (F16): ~12 elliptical superellipse stations, wider-than-tall
  // with soft chine, radome taper, raised dorsal spine behind the canopy fading
  // to the tailcone. Plane forward = -Z. Cylindrical UVs for the F22 skin.
  function buildFuselageGeom() {
    // {z, w:half-width, h:half-height, cy:vertical-center-offset, e:superellipse-exp}
    const st = [
      { z: -8.40, w: 0.02, h: 0.02, cy: 0.00, e: 2.0 },  // radome tip
      { z: -7.60, w: 0.30, h: 0.28, cy: 0.00, e: 2.2 },
      { z: -6.40, w: 0.62, h: 0.55, cy: 0.02, e: 2.3 },
      { z: -4.80, w: 0.92, h: 0.78, cy: 0.05, e: 2.5 },
      { z: -3.00, w: 1.12, h: 0.92, cy: 0.08, e: 2.6 },
      { z: -1.20, w: 1.20, h: 1.00, cy: 0.10, e: 2.6 },  // cockpit / mid
      { z:  0.60, w: 1.18, h: 1.02, cy: 0.16, e: 2.6 },  // dorsal spine rises
      { z:  2.40, w: 1.08, h: 0.98, cy: 0.20, e: 2.5 },  // spine peak
      { z:  4.20, w: 0.92, h: 0.85, cy: 0.14, e: 2.4 },
      { z:  5.80, w: 0.76, h: 0.72, cy: 0.06, e: 2.3 },
      { z:  7.00, w: 0.64, h: 0.62, cy: 0.02, e: 2.2 },
      { z:  8.30, w: 0.85, h: 0.85, cy: 0.00, e: 2.0 },  // flares to socket nozzle throat (D5)
    ];
    const N = 18, rings = st.length, stride = N + 1;
    const pos = [], uv = [];
    for (let s = 0; s < rings; s++) {
      const S = st[s];
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const px = Math.sign(ca) * Math.pow(Math.abs(ca), 2 / S.e) * S.w;
        const py = Math.sign(sa) * Math.pow(Math.abs(sa), 2 / S.e) * S.h + S.cy;
        pos.push(px, py, S.z);
        uv.push(i / N, s / (rings - 1));
      }
    }
    const idx = [];
    for (let s = 0; s < rings - 1; s++) {
      for (let i = 0; i < N; i++) {
        const a = s * stride + i, b = a + 1, c = a + stride, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // Airfoil loft (F18/F19): one panel from root(x=0) to tip(x=span) — rounded
  // leading edge, cambered upper, sharp trailing edge, plus sweep/taper/dihedral.
  // Two-tone vertexColors (upper cTop, lower cBot). Caller mirrors (scale.x=-1)
  // for the opposite wing or rotates for the fin. Root/tip left open (root buried
  // in fuselage, tip edge is a negligible thin slit).
  function airfoilSurface(o) {
    const spanN = 6, chordC = [0, 0.06, 0.18, 0.40, 0.68, 1.0];
    const cTop = new THREE.Color(o.cTop), cBot = new THREE.Color(o.cBot);
    const camber = o.camber || 0, thick = o.thick;
    const yt = (c) => thick * (1.4845 * Math.sqrt(c) - 0.63 * c - 1.758 * c * c + 1.4215 * c * c * c - 0.5075 * c * c * c * c);
    const cm = (c) => camber * Math.sin(Math.PI * Math.pow(c, 0.8));
    const ring = chordC.length * 2;
    const pos = [], col = [];
    for (let s = 0; s < spanN; s++) {
      const f = s / (spanN - 1);
      const x = f * o.span;
      const chord = o.rootChord + (o.tipChord - o.rootChord) * f;
      const zLE = -chord * 0.5 + f * o.sweep;
      const y0 = f * o.dihedral;
      for (let k = 0; k < chordC.length; k++) {            // upper LE->TE
        const c = chordC[k], z = zLE + c * chord;
        pos.push(x, y0 + (cm(c) + yt(c)) * chord, z);
        col.push(cTop.r, cTop.g, cTop.b);
      }
      for (let k = chordC.length - 1; k >= 0; k--) {        // lower TE->LE
        const c = chordC[k], z = zLE + c * chord;
        pos.push(x, y0 + (cm(c) - yt(c)) * chord, z);
        col.push(cBot.r, cBot.g, cBot.b);
      }
    }
    const idx = [];
    for (let s = 0; s < spanN - 1; s++) {
      for (let k = 0; k < ring; k++) {
        const a = s * ring + k, b = s * ring + (k + 1) % ring;
        const c = (s + 1) * ring + k, d = (s + 1) * ring + (k + 1) % ring;
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  // --- end jet build helpers ---

  // ===== JET SKIN TEXTURE HELPERS (Round 6, F22) =====
  // Generated once at build; no fetches. Shared by fuselage/wing/tail materials.
  function buildJetSkinTexture() {
    const S = 1024;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d');
    x.fillStyle = '#6d7580'; x.fillRect(0, 0, S, S);
    // soft low-contrast camo blocks
    const blocks = [
      { x: 80, y: 120, w: 260, h: 200, c: '#5f6771' },
      { x: 520, y: 60, w: 300, h: 240, c: '#7a828d' },
      { x: 260, y: 520, w: 320, h: 220, c: '#5f6771' },
      { x: 640, y: 560, w: 280, h: 260, c: '#7a828d' },
    ];
    for (const b of blocks) {
      x.fillStyle = b.c;
      const r = 24;
      x.beginPath();
      x.moveTo(b.x + r, b.y);
      x.arcTo(b.x + b.w, b.y, b.x + b.w, b.y + b.h, r);
      x.arcTo(b.x + b.w, b.y + b.h, b.x, b.y + b.h, r);
      x.arcTo(b.x, b.y + b.h, b.x, b.y, r);
      x.arcTo(b.x, b.y, b.x + b.w, b.y, r);
      x.closePath();
      x.fill();
    }
    // panel lines + rivets on an irregular grid
    x.strokeStyle = 'rgba(30,34,40,0.55)'; x.lineWidth = 1;
    x.fillStyle = 'rgba(40,44,52,0.5)';
    for (let px = 0; px <= S; px += 90) {
      const jx = px + (Math.random() * 24 - 12);
      x.beginPath(); x.moveTo(jx, 0); x.lineTo(jx, S); x.stroke();
      for (let py = 10; py < S; py += 14) {
        x.beginPath(); x.arc(jx, py, 1.2, 0, Math.PI * 2); x.fill();
      }
    }
    for (let py = 0; py <= S; py += 120) {
      const jy = py + (Math.random() * 24 - 12);
      x.beginPath(); x.moveTo(0, jy); x.lineTo(S, jy); x.stroke();
      for (let px = 10; px < S; px += 14) {
        x.beginPath(); x.arc(px, jy, 1.2, 0, Math.PI * 2); x.fill();
      }
    }
    // livery accents (grey + orange, O5 default)
    x.fillStyle = '#d9721f';
    x.fillRect(0, 260, S, 18);
    x.fillRect(0, 700, S, 18);
    const roundel = (rx, ry) => {
      x.beginPath(); x.arc(rx, ry, 46, 0, Math.PI * 2);
      x.fillStyle = '#d9721f'; x.fill();
      x.beginPath(); x.arc(rx, ry, 30, 0, Math.PI * 2);
      x.fillStyle = '#6d7580'; x.fill();
    };
    roundel(300, 300); roundel(720, 700);
    x.fillStyle = '#d9721f'; x.font = 'bold 22px sans-serif';
    x.fillText('ELEMENT-115', 120, 150);
    x.fillStyle = '#e8e8e8'; x.font = '34px sans-serif';
    x.fillText('E-115', 860, 120);
    x.fillStyle = 'rgba(230,230,220,0.35)';
    x.fillRect(S / 2 - 6, 0, 12, S);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  function buildJetRoughTexture() {
    const S = 512;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d');
    x.fillStyle = '#808080'; x.fillRect(0, 0, S, S);
    x.strokeStyle = '#5a5a5a'; x.lineWidth = 1;
    for (let px = 0; px <= S; px += 45) {
      x.beginPath(); x.moveTo(px, 0); x.lineTo(px, S); x.stroke();
    }
    for (let py = 0; py <= S; py += 60) {
      x.beginPath(); x.moveTo(0, py); x.lineTo(S, py); x.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }
  // --- end jet skin texture helpers ---

  const root = new THREE.Group();

  const matFuse = new THREE.MeshStandardMaterial({
    color: 0x6d7580, metalness: 0.55, roughness: 0.5
  });
  const matDark = new THREE.MeshStandardMaterial({
    color: 0x292c34, metalness: 0.8, roughness: 0.35
  });
  const matCanopy = new THREE.MeshStandardMaterial({
    color: 0x1a3045, metalness: 1.0, roughness: 0.06,
    transparent: true, opacity: 0.42
  });
  const matAccent = new THREE.MeshStandardMaterial({
    color: 0x9a1a28, metalness: 0.3, roughness: 0.7
  });
  const matTire = new THREE.MeshStandardMaterial({
    color: 0x151515, metalness: 0.1, roughness: 0.95
  });
  const jetEnvCube = buildJetEnvCube();
  const jetSkin = buildJetSkinTexture();  jetSkin.anisotropy = 4;
  const jetRough = buildJetRoughTexture(); jetRough.anisotropy = 4;
  matFuse.map = jetSkin; matFuse.roughnessMap = jetRough;
  matFuse.envMap = jetEnvCube; matFuse.envMapIntensity = 0.5;
  matDark.envMap = jetEnvCube; matDark.envMapIntensity = 0.5;
  matCanopy.envMap = jetEnvCube; matCanopy.envMapIntensity = 1.1;

  // Fuselage — lofted superellipse loft, radome (z=-8.40) to tailcone (z=7.90)
  const fuse = new THREE.Mesh(buildFuselageGeom(), matFuse);
  root.add(fuse);

  // Wing-mounted gun pods / muzzle anchors — pushes the weapon read out to the wings.
  function addWingGun(side) {
    const pod = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.18, 1.05),
      matDark
    );
    pod.position.set(side * 5.45, -0.2, 0.15);
    pod.rotation.y = side * -0.06;
    root.add(pod);
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.032, 0.038, 0.62, 8),
      matDark
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(side * 5.45, -0.21, -0.48);
    root.add(barrel);
    return new THREE.Vector3(side * 5.45, -0.2, -0.82);
  }
  root.userData.gunL = addWingGun(-1);
  root.userData.gunR = addWingGun(1);
  root.userData.missileL = new THREE.Vector3(-5.0, -0.42, 0.72);
  root.userData.missileR = new THREE.Vector3(5.0, -0.42, 0.72);

  // Small under-wing rails for alternating missile launches.
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 1.15), matDark);
    rail.position.set(side * 5.0, -0.42, 0.72);
    rail.rotation.y = side * -0.04;
    root.add(rail);
  }

  // Engine nozzle — faceted convergent nozzle: 12 petal facets (lathe) + hot inner ring.
  const nozzle = new THREE.Mesh(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.85, 0),
        new THREE.Vector2(0.78, 0.4),
        new THREE.Vector2(0.62, 1.0),
        new THREE.Vector2(0.66, 1.2),
      ],
      12
    ),
    (() => { const m = matDark.clone(); m.flatShading = true; return m; })()
  );
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.z = 8.0;
  root.add(nozzle);

  // Nozzle inner glow ring
  const nozRing = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 0.6, 0.22, 14, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x662200, toneMapped: false })
  );
  nozRing.rotation.x = Math.PI / 2;
  nozRing.position.z = 8.5;
  root.add(nozRing);

  // Canopy — teardrop bubble via lathe profile (windscreen rake -> apex ->
  // spine fairing), thin dark frame rails, envMap glass (matCanopy set in P3).
  const canopyProfile = [
    new THREE.Vector2(0.00, 0.00),   // windscreen base tip (forward)
    new THREE.Vector2(0.34, 0.28),
    new THREE.Vector2(0.60, 0.95),   // bubble max
    new THREE.Vector2(0.58, 1.70),
    new THREE.Vector2(0.40, 2.55),
    new THREE.Vector2(0.17, 3.35),   // spine fairing taper
    new THREE.Vector2(0.00, 3.90),   // tail point
  ];
  const canopy = new THREE.Mesh(
    new THREE.LatheGeometry(canopyProfile, 20),
    matCanopy
  );
  // Lathe axis is +Y (length 0..3.9). Rotate axis to plane-forward (-Z) and
  // seat over the cockpit: nose end near z=-2.7, tail near z=+1.2.
  canopy.rotation.x = -Math.PI / 2;
  // scale.y is negative: the lathe profile's length axis (py, nose=0..tail=3.9)
  // maps to -Z after this rotation, so a positive scale.y put the tail
  // (py=3.9) more forward than the nose (py=0), burying the bubble ~3.5 units
  // too far forward. Negating restores nose-forward orientation.
  canopy.scale.set(1.3, -0.8, 0.96);       // wider (x) than tall (z)
  canopy.position.set(0, 1.18, -3.3);
  root.add(canopy);
  // Frame rails — thin dark arcs (windscreen bow + mid hoop)
  const canopyFrameMat = matDark;
  const wsBow = new THREE.Mesh(
    new THREE.TorusGeometry(0.42, 0.03, 6, 16, Math.PI),
    canopyFrameMat
  );
  wsBow.rotation.y = Math.PI / 2;
  wsBow.position.set(0, 0.55, -2.35);
  root.add(wsBow);
  const midHoop = new THREE.Mesh(
    new THREE.TorusGeometry(0.5, 0.028, 6, 16, Math.PI),
    canopyFrameMat
  );
  midHoop.rotation.y = Math.PI / 2;
  midHoop.position.set(0, 0.52, -0.7);
  root.add(midHoop);

  // --- Wings: airfoil loft (rounded LE, cambered upper, sharp TE), swept delta
  // with LERX strakes. Span stretched 5.4->6.5 (D6); sweep is a per-span-fraction
  // z-offset, so it's scaled by the same 6.5/5.4 ratio to hold the sweep angle
  // (dihedral left as-is per spec). Outboard anchors (gun x=+/-5.45, rail/missile
  // x=+/-5.0, wingtip FX) re-seated to match below. ---
  const wingMat = new THREE.MeshStandardMaterial({
    vertexColors: true, metalness: 0.55, roughness: 0.5
  });
  wingMat.envMap = jetEnvCube; wingMat.envMapIntensity = 0.5;
  const wingGeoR = airfoilSurface({
    span: 6.5, rootChord: 3.4, tipChord: 1.35, sweep: 2.05 * (6.5 / 5.4),
    dihedral: 0.22, thick: 0.15, camber: 0.015, cTop: 0x5a626d, cBot: 0x8a96a8
  });
  const wingR = new THREE.Mesh(wingGeoR, wingMat);
  const wingL = new THREE.Mesh(wingGeoR.clone(), wingMat);
  wingL.scale.x = -1;
  const wings = new THREE.Group();
  wings.add(wingR); wings.add(wingL);
  wings.position.set(0, -0.1, 0.8);
  root.add(wings);
  // LERX strakes — slim fillet running forward from the wing-root leading
  // edge, blending the root into the fuselage side. matFuse (grey, no
  // vertexColors) to avoid black-vertex artifacts.
  for (const s of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(s * 1.15, -0.7);   // inner edge, aft (hugs fuselage side)
    shape.lineTo(s * 1.55, -0.7);   // outer edge, aft (wing-root leading edge)
    shape.lineTo(s * 1.00, -3.8);   // outer edge, forward taper
    shape.lineTo(s * 0.85, -3.8);   // inner edge, forward (blends into hull)
    shape.closePath();
    const lerxGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: false });
    const lerx = new THREE.Mesh(lerxGeo, matFuse);
    lerx.rotation.x = Math.PI / 2;          // shape XY -> world XZ (lays flat)
    lerx.rotation.z = s * 0.06;             // slight outward-down cant
    lerx.position.set(0, 0.22, 0);
    root.add(lerx);
  }

  // Wing accent stripes — raised to sit on the thicker (D4) wing top surface.
  // Re-spanned 1.6..4.4 -> 1.9..5.3 to track the D6 wing stretch.
  const stripeL = new THREE.Mesh(
    new THREE.BoxGeometry(3.4, 0.03, 0.4), matAccent
  );
  stripeL.position.set(-3.6, 0.12, 1.2);
  root.add(stripeL);
  const stripeR = stripeL.clone();
  stripeR.position.x = 3.6;
  root.add(stripeR);

  // --- Vertical tail: swept airfoil fin (span becomes vertical after rotate),
  // recessed rudder shadow-line, tip antenna fairing pod. ---
  const finGeo = airfoilSurface({
    span: 2.1, rootChord: 2.6, tipChord: 1.0, sweep: 1.5,
    dihedral: 0, thick: 0.09, camber: 0, cTop: 0x6d7580, cBot: 0x6d7580
  });
  const tail = new THREE.Mesh(finGeo, matFuse);
  tail.rotation.z = Math.PI / 2;
  tail.position.set(0, 1.1, 5.5);
  root.add(tail);
  const rudderLine = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.6, 0.05), matDark);
  rudderLine.position.set(0, 1.7, 6.4);
  root.add(rudderLine);
  const finTipPod = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.03, 0.5, 6), matDark);
  finTipPod.position.set(0, 2.9, 6.2);
  root.add(finTipPod);

  // Horizontal stabilizers — all-moving airfoil panels, slight anhedral.
  const hstabGeoR = airfoilSurface({
    span: 2.2, rootChord: 1.5, tipChord: 0.7, sweep: 0.9,
    dihedral: -0.10, thick: 0.07, camber: 0, cTop: 0x6d7580, cBot: 0x7e8790
  });
  const hstabR = new THREE.Mesh(hstabGeoR, matFuse);
  const hstabL = new THREE.Mesh(hstabGeoR.clone(), matFuse);
  hstabL.scale.x = -1;
  const hstab = new THREE.Group();
  hstab.add(hstabR); hstab.add(hstabL);
  hstab.position.set(0, 0.1, 6.3);
  root.add(hstab);
  // Register the all-moving stabs as live elevator surfaces. The aero-flex
  // animator previously only knew GLB-named nodes, so the procedural tail
  // never deflected with pitch input. Registered in userData BEFORE the
  // merge pass runs — the exclusion walk keeps these nodes animatable.
  root.userData.controlSurfaces = {
    aileronL: [], aileronR: [],
    elevatorL: [{ node: hstabL, rx: hstabL.rotation.x, ry: hstabL.rotation.y, rz: hstabL.rotation.z }],
    elevatorR: [{ node: hstabR, rx: hstabR.rotation.x, ry: hstabR.rotation.y, rz: hstabR.rotation.z }],
    rudder: [],
  };

  // Engine intakes (sides) — curved bodies, splitter gap, ramped throat, diverter.
  // Fuselage half-width at the intake station (z~-0.5) is ~1.18, so seat the
  // intakes at x=+/-1.28 (outboard of the hull, ~0.1 splitter gap).
  function addIntake(side) {
    const x = side * 1.28;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.9, 2.4), matFuse);
    body.position.set(x, -0.25, -0.5);
    root.add(body);
    // rounded outer lip
    const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 2.4, 10, 1, true), matFuse);
    lip.rotation.z = Math.PI / 2;
    lip.position.set(x + side * 0.31, -0.25, -0.5);
    root.add(lip);
    // dark ramped throat
    const throat = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.6, 0.35),
      new THREE.MeshBasicMaterial({ color: 0x050608 })
    );
    throat.rotation.x = 0.12;
    throat.position.set(x, -0.25, -1.62);
    root.add(throat);
    // splitter plate
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.7, 1.6), matDark);
    splitter.position.set(x * 0.86, -0.25, -0.6);
    root.add(splitter);
    // boundary-layer diverter
    const diverter = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.5), matDark);
    diverter.position.set(x * 0.9, -0.25, -1.3);
    root.add(diverter);
  }
  addIntake(-1);
  addIntake(1);

  // --- Landing gear: two-stage oleo strut, scissor link, drag brace, hubbed
  // wheel(s) with brake disc + bolt studs, bay doors. CONTRACT: grp.userData.
  // {strut,wheel,side,baseStrutY,baseWheelY} keep pointing at the load-bearing
  // strut group and rolling wheel group so compression+spin code at ~12593
  // (frame loop) and gear retract rotation (jet.userData.gearNose/L/R) work untouched. ---
  const gearPolishedMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.95, roughness: 0.15 });
  function makeGear(isNose, side = 0) {
    const grp = new THREE.Group();
    const strutH = isNose ? 1.3 : 1.6, wheelR = isNose ? 0.22 : 0.30;

    const strut = new THREE.Group();
    const outerStrut = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, strutH * 0.6, 8), matDark);
    outerStrut.position.y = -strutH * 0.30;
    strut.add(outerStrut);
    const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, strutH * 0.55, 8), gearPolishedMat);
    piston.position.y = -strutH * 0.72;
    strut.add(piston);
    for (const sgn of [-1, 1]) {
      const link = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.18, 0.02), matDark);
      link.rotation.x = sgn * 0.5;
      link.position.set(0, -strutH * 0.5, 0.05);
      strut.add(link);
    }
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.5), matDark);
    brace.rotation.x = 0.6;
    brace.position.set(0, -strutH * 0.15, 0.2);
    strut.add(brace);
    strut.position.y = -strutH / 2;
    grp.add(strut);

    function buildWheelUnit() {
      const unit = new THREE.Group();
      const tire = new THREE.Mesh(new THREE.TorusGeometry(wheelR * 0.72, wheelR * 0.30, 8, 16), matTire);
      tire.rotation.y = Math.PI / 2;               // axle along X so rotation.x rolls it
      unit.add(tire);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(wheelR * 0.42, wheelR * 0.42, 0.16, 12), gearPolishedMat);
      hub.rotation.z = Math.PI / 2;
      unit.add(hub);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(wheelR * 0.5, wheelR * 0.5, 0.03, 16), matDark);
      disc.rotation.z = Math.PI / 2;
      disc.position.x = 0.1;
      unit.add(disc);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const stud = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.05, 6), matDark);
        stud.rotation.z = Math.PI / 2;
        stud.position.set(0.09, Math.cos(a) * wheelR * 0.3, Math.sin(a) * wheelR * 0.3);
        unit.add(stud);
      }
      return unit;
    }
    const wheel = new THREE.Group();
    if (isNose) {
      const wL = buildWheelUnit(); wL.position.x = -0.13; wheel.add(wL);
      const wR = buildWheelUnit(); wR.position.x = 0.13; wheel.add(wR);
      const mudguard = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.5), matDark);
      mudguard.position.y = 0.18;
      wheel.add(mudguard);
    } else {
      wheel.add(buildWheelUnit());
    }
    wheel.position.y = -strutH;
    grp.add(wheel);

    for (const sgn of [-1, 1]) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.7), matFuse);
      door.position.set(sgn * 0.28, -0.05, 0);
      door.rotation.z = sgn * 0.4;
      grp.add(door);
    }

    grp.userData.strut = strut;
    grp.userData.wheel = wheel;
    grp.userData.side = side;
    grp.userData.baseStrutY = strut.position.y;
    grp.userData.baseWheelY = wheel.position.y;
    return grp;
  }

  // Nose gear — retracts forward/up
  const gearNose = makeGear(true, 0);
  gearNose.position.set(0, -0.6, -4.2);
  root.add(gearNose);

  // Left main gear — retracts inward/up
  const gearL = makeGear(false, -1);
  gearL.position.set(-1.8, -0.4, 1.2);
  root.add(gearL);

  // Right main gear
  const gearR = makeGear(false, 1);
  gearR.position.set(1.8, -0.4, 1.2);
  root.add(gearR);

  // --- Afterburner glow ---
  const abMat = new THREE.MeshBasicMaterial({
    color: 0xff8833,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const abGeo = new THREE.ConeGeometry(0.55, 3.5, 14, 1, true);
  abGeo.translate(0, -1.75, 0);
  const afterburner = new THREE.Mesh(abGeo, abMat);
  afterburner.rotation.x = -Math.PI / 2;
  afterburner.position.z = 8.6;
  root.add(afterburner);

  // Secondary glow (inner, hotter)
  const ab2 = new THREE.Mesh(
    new THREE.ConeGeometry(0.35, 2, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffddaa,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  ab2.geometry.translate(0, -1, 0);
  ab2.rotation.x = -Math.PI / 2;
  ab2.position.z = 8.6;
  root.add(ab2);

  // ============ COCKPIT INTERIOR (visible through canopy) ============
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.85 });
  const helmetMat = new THREE.MeshStandardMaterial({
    color: 0xe8e4d8, roughness: 0.4, metalness: 0.2
  });
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0x0a0f18, roughness: 0.1, metalness: 1.0
  });
  const panelMat = new THREE.MeshStandardMaterial({
    color: 0x0a0a0a,
    roughness: 0.7,
    emissive: 0x07131b,
    emissiveIntensity: 0.0,
  });
  const gaugeGlowMat = new THREE.MeshBasicMaterial({
    color: 0x66ffd1,
    toneMapped: false,
    transparent: true,
    opacity: 0.0,
  });
  const warnGlowMat = new THREE.MeshBasicMaterial({
    color: 0xff9966,
    toneMapped: false,
    transparent: true,
    opacity: 0.0,
  });
  // Ejection seat
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.85, 0.55), seatMat);
  seat.position.set(0, 0.1, -1.5);
  root.add(seat);
  const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.18), seatMat);
  seatBack.position.set(0, 0.55, -1.25);
  root.add(seatBack);
  // Pilot helmet
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), helmetMat);
  helmet.position.set(0, 1.0, -1.6);
  root.add(helmet);
  // Visor (front of helmet)
  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.225, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
    visorMat
  );
  visor.rotation.x = Math.PI * 0.4;
  visor.position.set(0, 1.0, -1.62);
  root.add(visor);
  // HUD glass plate in front of pilot
  const hudGlass = new THREE.Mesh(
    new THREE.PlaneGeometry(0.45, 0.3),
    new THREE.MeshStandardMaterial({
      color: 0x66ff99, transparent: true, opacity: 0.18,
      side: THREE.DoubleSide, emissive: 0x224422, emissiveIntensity: 0.4
    })
  );
  hudGlass.position.set(0, 0.95, -2.05);
  hudGlass.rotation.x = -0.15;
  root.add(hudGlass);
  // Instrument panel
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.25, 0.15),
    panelMat
  );
  panel.position.set(0, 0.6, -2.4);
  root.add(panel);
  const cockpitGlowParts = [hudGlass];
  const leftDisplay = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.07, 0.01), gaugeGlowMat);
  leftDisplay.position.set(-0.14, 0.63, -2.49);
  root.add(leftDisplay);
  cockpitGlowParts.push(leftDisplay);
  const centerDisplay = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.09, 0.01), gaugeGlowMat.clone());
  centerDisplay.position.set(0, 0.61, -2.49);
  root.add(centerDisplay);
  cockpitGlowParts.push(centerDisplay);
  const rightDisplay = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.01), gaugeGlowMat.clone());
  rightDisplay.position.set(0.14, 0.64, -2.49);
  root.add(rightDisplay);
  cockpitGlowParts.push(rightDisplay);
  for (let i = 0; i < 3; i++) {
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.018, 10), (i === 1 ? warnGlowMat.clone() : gaugeGlowMat.clone()));
    lamp.position.set(-0.1 + i * 0.1, 0.54, -2.49);
    root.add(lamp);
    cockpitGlowParts.push(lamp);
  }

  // ============ PITOT TUBE on nose tip ============
  const pitot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.025, 0.9, 6), matDark
  );
  pitot.rotation.x = Math.PI / 2;
  pitot.position.z = -8.3;
  root.add(pitot);

  // ============ ANTENNAS ============
  const ant1 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.35, 0.18), matDark);
  ant1.position.set(0, 1.15, 3.5);
  root.add(ant1);
  const ant2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, 0.12), matDark);
  ant2.position.set(0, -0.85, -3.2);
  root.add(ant2);

  // ============ GREEBLES (Round 6, F23) ============
  // AoA vanes, blade antennas, RWR bumps — manually merged into one
  // BufferGeometry (no BufferGeometryUtils in this build) sharing matDark,
  // keeping this to a single extra draw call for the draw-call budget (P13).
  function mergeGeoms(geoms) {
    const positions = [], normals = [], uvs = [];
    for (const g of geoms) {
      const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        positions.push(p.getX(i), p.getY(i), p.getZ(i));
        normals.push(n.getX(i), n.getY(i), n.getZ(i));
        uvs.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    return geo;
  }
  function placedBox(w, h, d, x, y, z) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    return g;
  }
  const greebleGeom = mergeGeoms([
    placedBox(0.02, 0.14, 0.06, -0.9, 0.15, -6.2),   // AoA vane L
    placedBox(0.02, 0.14, 0.06, 0.9, 0.15, -6.2),    // AoA vane R
    placedBox(0.03, 0.28, 0.14, 0, 1.15, -1.0),       // blade antenna, dorsal
    placedBox(0.03, 0.28, 0.14, 0, -0.95, -0.5),      // blade antenna, belly
    placedBox(0.08, 0.05, 0.08, -1.1, 0.2, -6.6),     // RWR bump
    placedBox(0.08, 0.05, 0.08, 1.1, 0.2, -6.6),      // RWR bump
    placedBox(0.08, 0.05, 0.08, -0.5, 0.9, 6.0),      // RWR bump
    placedBox(0.08, 0.05, 0.08, 0.5, 0.9, 6.0),       // RWR bump
  ]);
  const greebles = new THREE.Mesh(greebleGeom, matDark);
  root.add(greebles);

  // Formation-light strips — one per wingtip, lying flat on the wing top
  // surface (was a single strip spanning the spine, floating above the hull).
  const formGeomL = new THREE.PlaneGeometry(0.06, 0.9);
  formGeomL.rotateX(-Math.PI / 2); formGeomL.translate(-6.15, 0.10, 2.75);
  const formGeomR = new THREE.PlaneGeometry(0.06, 0.9);
  formGeomR.rotateX(-Math.PI / 2); formGeomR.translate(6.15, 0.10, 2.75);
  const formationLights = new THREE.Mesh(
    mergeGeoms([formGeomL, formGeomR]),
    new THREE.MeshBasicMaterial({ color: 0x9fd8ff, toneMapped: false, transparent: true, opacity: 0.35 })
  );
  root.add(formationLights);

  // ============ WEAPONS LOADOUT ============
  function makeMissile(length, dia, bodyColor) {
    const grp = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: bodyColor, metalness: 0.35, roughness: 0.45
    });
    const finMat = new THREE.MeshStandardMaterial({
      color: 0x33363a, metalness: 0.5, roughness: 0.6
    });
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(dia, dia, length * 0.78, 12), bodyMat
    );
    body.rotation.x = Math.PI / 2;
    body.position.z = length * 0.05;
    grp.add(body);
    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(dia, length * 0.22, 12), bodyMat
    );
    tip.rotation.x = -Math.PI / 2;
    tip.position.z = -length * 0.45;
    grp.add(tip);
    // 4 tail fins (cruciform)
    for (let i = 0; i < 4; i++) {
      const finWrap = new THREE.Group();
      const fin = new THREE.Mesh(
        new THREE.BoxGeometry(0.025, dia * 2.4, length * 0.18), finMat
      );
      fin.position.y = dia + dia * 1.0;
      finWrap.add(fin);
      finWrap.rotation.z = i * Math.PI / 2;
      finWrap.position.z = length * 0.36;
      grp.add(finWrap);
    }
    // Front canards (smaller fins toward nose)
    for (let i = 0; i < 4; i++) {
      const finWrap = new THREE.Group();
      const fin = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, dia * 1.6, length * 0.10), finMat
      );
      fin.position.y = dia + dia * 0.6;
      finWrap.add(fin);
      finWrap.rotation.z = i * Math.PI / 2 + Math.PI / 4;
      finWrap.position.z = -length * 0.18;
      grp.add(finWrap);
    }
    return grp;
  }

  const pylonMat = new THREE.MeshStandardMaterial({
    color: 0x4a4f58, metalness: 0.6, roughness: 0.5
  });

  // 4 underwing pylons + AAMs (inner = larger, outer = sidewinder)
  const hardpoints = [
    { x: -3.4, len: 2.4, dia: 0.16, color: 0x3a4520, pylonH: 0.45 },
    { x: -1.9, len: 2.4, dia: 0.16, color: 0x3a4520, pylonH: 0.45 },
    { x:  1.9, len: 2.4, dia: 0.16, color: 0x3a4520, pylonH: 0.45 },
    { x:  3.4, len: 2.4, dia: 0.16, color: 0x3a4520, pylonH: 0.45 },
  ];
  for (const hp of hardpoints) {
    const pylon = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, hp.pylonH, 0.55), pylonMat
    );
    pylon.position.set(hp.x, -0.32 - hp.pylonH * 0.5, 0.95);
    root.add(pylon);
    const m = makeMissile(hp.len, hp.dia, hp.color);
    m.position.set(hp.x, -0.32 - hp.pylonH - hp.dia, 0.95);
    root.add(m);
  }

  // Wingtip launch rails — small AIM-9 style sidewinders
  for (const x of [-5.35, 5.35]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.7), pylonMat);
    rail.position.set(x, 0.05, 1.05);
    root.add(rail);
    const aim = makeMissile(1.6, 0.10, 0xeeeae0);
    aim.position.set(x, 0.05, 1.05);
    root.add(aim);
  }

  // Belly centerline fuel tank
  const cfTank = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.32, 3.2, 14),
    new THREE.MeshStandardMaterial({ color: 0x6d7580, metalness: 0.4, roughness: 0.6 })
  );
  cfTank.rotation.x = Math.PI / 2;
  cfTank.position.set(0, -0.85, 1.0);
  root.add(cfTank);
  const cfTip = new THREE.Mesh(
    new THREE.ConeGeometry(0.32, 0.7, 14),
    cfTank.material
  );
  cfTip.rotation.x = -Math.PI / 2;
  cfTip.position.set(0, -0.85, -0.85);
  root.add(cfTip);
  const cfBack = new THREE.Mesh(
    new THREE.ConeGeometry(0.32, 0.6, 14),
    cfTank.material
  );
  cfBack.rotation.x = Math.PI / 2;
  cfBack.position.set(0, -0.85, 2.85);
  root.add(cfBack);

  // ============ FUTURISTIC DETAILS ============
  // Emissive cyan edge lights — thin strips along wing leading edges
  const glowCyan = new THREE.MeshBasicMaterial({ color: 0x66e0ff, toneMapped: false });
  const glowOrange = new THREE.MeshBasicMaterial({ color: 0xffaa33, toneMapped: false });
  const glowMagenta = new THREE.MeshBasicMaterial({ color: 0xff3388, toneMapped: false, transparent: true, opacity: 0.4 });

  // Wing leading edge light strips (swept to match wing sweep)
  function addLEDStrip(xSign) {
    const len = 5.2;
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(len, 0.06, 0.08),
      glowCyan
    );
    // Position along leading edge, rotate to match sweep
    strip.position.set(xSign * 2.7, -0.04, -0.3);
    strip.rotation.y = xSign * -0.35;   // match wing sweep-back angle
    root.add(strip);
  }
  addLEDStrip(-1);
  addLEDStrip(1);

  // Fuselage chine strakes — thin glowing lines along each side
  for (const side of [-1, 1]) {
    const chine = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.05, 4.5),
      glowCyan
    );
    chine.position.set(side * 0.95, 0.1, -2.0);
    root.add(chine);
  }

  // Belly running light — orange marker
  const bellyLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 8, 6), glowOrange
  );
  bellyLight.position.set(0, -0.95, -2);
  root.add(bellyLight);

  // Port/starboard navigation lights (red/green) on wingtips
  const navRed = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff1133, toneMapped: false })
  );
  navRed.position.set(-5.45, 0.05, 1.3);
  root.add(navRed);
  const navGrn = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0x22ff55, toneMapped: false })
  );
  navGrn.position.set(5.45, 0.05, 1.3);
  root.add(navGrn);

  // Tail strobe (white blinker)
  const strobe = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })
  );
  strobe.position.set(0, 2.3, 6.6);
  root.add(strobe);

  // Retractable landing lights on the nose — twin beams angled slightly down
  function makeLandingLightRig(xSign) {
    const housing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.1, 0.18, 10),
      matDark
    );
    housing.rotation.x = Math.PI / 2;
    housing.position.set(xSign * 0.68, -0.12, -6.1);
    root.add(housing);

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 10, 8),
      new THREE.MeshBasicMaterial({
        color: 0xfff3d8,
        toneMapped: false,
        transparent: true,
        opacity: 0.0,
      })
    );
    glow.position.set(xSign * 0.68, -0.12, -6.28);
    root.add(glow);

    // Beam cone — apex at the bulb, base far ahead. Narrow at the
    // source, diffusing OUT as it projects forward. A wider opening
    // angle than before gives that volumetric "spotlight in fog" feel.
    // radius 3.5 at 24m length ⇒ ~8° half-angle, matches real landing
    // light spread (6–12°).
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(3.5, 24, 20, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xfff1c8,
        toneMapped: false,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
    );
    // Position so cone apex sits right at the bulb (z=-6.28) and base
    // stretches 24m further forward. Flipping rotation.x sign puts the
    // apex at +Z local (i.e. near the plane in world), base at -Z
    // (far ahead) — reversing the old "ice-cream-scoop pointing back"
    // orientation the user flagged.
    beam.position.set(xSign * 0.68, -0.35, -18.3);
    beam.rotation.x = Math.PI / 2;
    root.add(beam);

    const splash = new THREE.Mesh(
      new THREE.CircleGeometry(12, 28),
      new THREE.MeshBasicMaterial({
        color: 0xffefc8,
        toneMapped: false,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
    );
    splash.rotation.x = -Math.PI / 2;
    splash.renderOrder = 4;
    scene.add(splash);

    const light = new THREE.SpotLight(0xfff4db, 0.0, 260, Math.PI / 8, 0.44, 1.15);
    light.position.set(xSign * 0.68, -0.12, -6.15);
    light.castShadow = false;
    const target = new THREE.Object3D();
    target.position.set(xSign * 0.22, -3.0, -120);
    root.add(light);
    root.add(target);
    light.target = target;

    return { housing, glow, beam, splash, light, target, side: xSign };
  }
  const landingLeft = makeLandingLightRig(-1);
  const landingRight = makeLandingLightRig(1);

  // Canard foreplanes — small winglets ahead of the main wing
  function makeCanard() {
    const g = new THREE.BoxGeometry(1.6, 0.1, 0.9, 2, 1, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const ax = Math.abs(x);
      const z = p.getZ(i);
      p.setZ(i, z * (1 - ax * 0.3) + ax * 0.3);
    }
    g.computeVertexNormals();
    return g;
  }
  const canardL = new THREE.Mesh(makeCanard(), matFuse);
  canardL.position.set(-1.1, 0.15, -3.5);
  canardL.rotation.z = 0.05;
  root.add(canardL);
  const canardR = new THREE.Mesh(makeCanard(), matFuse);
  canardR.position.set(1.1, 0.15, -3.5);
  canardR.rotation.z = -0.05;
  root.add(canardR);

  // Dorsal spine — raised ridge with emissive accent
  const spine = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.25, 6), matFuse
  );
  spine.position.set(0, 1.0, 3.2);
  root.add(spine);
  const spineGlow = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.04, 5.5), glowMagenta
  );
  spineGlow.position.set(0, 0.80, 3.2);   // lowered ~0.35 to hug the spine
  root.add(spineGlow);

  // Sensor array panels on nose (hex cells)
  for (let i = 0; i < 3; i++) {
    const panel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.02, 6),
      new THREE.MeshStandardMaterial({
        color: 0x222830, metalness: 0.9, roughness: 0.2,
        emissive: 0x0a1a22, emissiveIntensity: 0.4
      })
    );
    panel.rotation.x = Math.PI / 2;
    panel.position.set((i - 1) * 0.25, 0.2, -7.2);
    root.add(panel);
  }

  // Under-fuselage conformal scanner strip (glowing)
  const scanner = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.04, 2.2), glowCyan
  );
  scanner.position.set(0, -1.0, -1.8);
  scanner.material = scanner.material.clone();
  scanner.material.color = new THREE.Color(0x44ccff);
  root.add(scanner);

  // Hookup refs for animation + particle emitters
  root.userData.gearNose = gearNose;
  root.userData.gearL = gearL;
  root.userData.gearR = gearR;
  root.userData.afterburner = afterburner;
  root.userData.ab2 = ab2;
  root.userData.strobe = strobe;
  root.userData.scanner = scanner;
  root.userData.navRed = navRed;
  root.userData.navGrn = navGrn;
  root.userData.bellyLight = bellyLight;
  root.userData.landingRigs = [landingLeft, landingRight];
  root.userData.cockpitGlow = { panelMat, hudGlass, visorMat, canopyMat: matCanopy, parts: cockpitGlowParts };
  // Local-space anchor points for atmospheric FX.
  // engineSmokeL/R — light engine exhaust / damage smoke near the cowling.
  // wingtipL/R — condensation / wing-vapor points used during aggressive
  // manoeuvres so healthy trails read from the wings, not the nose.
  // engineExhaust — behind-nozzle position for jet contrail (unused by
  //   swapped GLB props since suppressJetFX is set).
  root.userData.engineSmokeL  = new THREE.Vector3(-0.85, 0.10, -3.00);
  root.userData.engineSmokeR  = new THREE.Vector3( 0.85, 0.10, -3.00);
  root.userData.wingtipL      = new THREE.Vector3(-6.4, 0.16,  2.90);
  root.userData.wingtipR      = new THREE.Vector3( 6.4, 0.16,  2.90);
  root.userData.engineExhaust = new THREE.Vector3(0, 0, 9.5);

  // ============ MESH BUDGET MERGE PASS (Round 6 respec, P14) ============
  // Bakes static same-material opaque meshes into one draw call per material
  // to bring the jet under the mesh/material budget gate. Excludes: gear
  // subtrees (merged separately below, preserving grp.userData.strut/wheel
  // identity so compression/spin animation is untouched), anything reachable
  // from root.userData (every FX/animation anchor — gearNose/L/R, afterburner,
  // navRed/Grn, cockpitGlow.{panelMat,visorMat,canopyMat,parts}, etc.), and
  // any transparent/additive/non-MeshStandardMaterial mesh.
  function bakeAndConcat(meshes, material, refObject) {
    const refInv = new THREE.Matrix4().copy(refObject.matrixWorld).invert();
    const useColor = material.vertexColors === true;
    const positions = [], normals = [], uvs = [], colors = useColor ? [] : null;
    const v = new THREE.Vector3(), nv = new THREE.Vector3();
    for (const mesh of meshes) {
      const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
      const rel = new THREE.Matrix4().multiplyMatrices(refInv, mesh.matrixWorld);
      const normalMat = new THREE.Matrix3().getNormalMatrix(rel);
      const p = geo.attributes.position, n = geo.attributes.normal, u = geo.attributes.uv, c = geo.attributes.color;
      for (let i = 0; i < p.count; i++) {
        v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(rel);
        positions.push(v.x, v.y, v.z);
        if (n) { nv.set(n.getX(i), n.getY(i), n.getZ(i)).applyMatrix3(normalMat).normalize(); normals.push(nv.x, nv.y, nv.z); }
        else normals.push(0, 1, 0);
        uvs.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
        if (useColor) colors.push(c ? c.getX(i) : 1, c ? c.getY(i) : 1, c ? c.getZ(i) : 1);
      }
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    if (useColor) merged.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return new THREE.Mesh(merged, material);
  }
  function isMergeableMesh(o) {
    if (!o.isMesh) return false;
    const m = o.material;
    if (Array.isArray(m) || !m || !m.isMeshStandardMaterial) return false;
    if (m.transparent || m.blending !== THREE.NormalBlending) return false;
    return true;
  }
  function mergeStaticJetChildren(rootObj, gearGroups) {
    rootObj.updateMatrixWorld(true);

    // Anything reachable from root.userData (objects and materials, walked
    // through plain objects/arrays) is a live animation/FX anchor — exclude it
    // and (for objects) its whole subtree from the general merge sweep.
    const excludedObjects = new Set(gearGroups);
    const excludedMaterials = new Set();
    (function walk(v, depth) {
      if (!v || depth > 4) return;
      if (v.isObject3D) { excludedObjects.add(v); return; }
      if (v.isMaterial) { excludedMaterials.add(v); return; }
      if (Array.isArray(v)) { v.forEach(x => walk(x, depth + 1)); return; }
      if (typeof v === 'object') { for (const k in v) walk(v[k], depth + 1); }
    })(rootObj.userData, 0);
    function underExcluded(o) {
      for (let p = o; p; p = p.parent) if (excludedObjects.has(p)) return true;
      return false;
    }
    function eligibleMeshesOf(container, extraFilter) {
      const out = [];
      container.traverse(o => {
        if (o === container) return;
        if (!isMergeableMesh(o)) return;
        if (excludedMaterials.has(o.material)) return;
        if (extraFilter && !extraFilter(o)) return;
        out.push(o);
      });
      return out;
    }
    // Canonical key for a one-off material clone: same visual params -> same
    // key, regardless of object identity. Keeps texture/env-map identity
    // (by uuid) so we never merge visually-distinct textured materials.
    function materialDedupeKey(m) {
      return [
        m.type, m.color ? m.color.getHexString() : '', m.roughness, m.metalness,
        m.emissive ? m.emissive.getHexString() : '', m.emissiveIntensity,
        m.flatShading, m.side, m.vertexColors,
        m.map ? m.map.uuid : '', m.envMap ? m.envMap.uuid : ''
      ].join('|');
    }
    // Re-point duplicate-by-key meshes to a single canonical material
    // (first one seen wins). Dupes are orphaned, not disposed — some may
    // still be closure-referenced elsewhere.
    function dedupeMaterials(meshes) {
      const canonical = new Map();
      for (const mesh of meshes) {
        const key = materialDedupeKey(mesh.material);
        const existing = canonical.get(key);
        if (!existing) canonical.set(key, mesh.material);
        else mesh.material = existing;
      }
    }

    let mergedGroups = 0, removed = 0;
    function mergeChildrenOf(container, extraFilter) {
      const byMat = new Map();
      for (const o of eligibleMeshesOf(container, extraFilter)) {
        let arr = byMat.get(o.material);
        if (!arr) byMat.set(o.material, arr = []);
        arr.push(o);
      }
      for (const [material, meshes] of byMat) {
        if (meshes.length < 2) continue;
        const merged = bakeAndConcat(meshes, material, container);
        container.add(merged);
        for (const mesh of meshes) mesh.parent.remove(mesh);
        mergedGroups++; removed += meshes.length - 1;
      }
    }

    // Dedupe one-off material clones BEFORE grouping by material identity,
    // so parts that only differ by having their own clone (same visual
    // params) collapse onto one material and then merge below.
    dedupeMaterials(eligibleMeshesOf(rootObj, o => !underExcluded(o)));

    // General sweep: root-relative, skipping anything under an excluded
    // object (gear groups, or any mesh/group the animation code holds).
    mergeChildrenOf(rootObj, o => !underExcluded(o));

    // Per-gear: merge WITHIN each existing strut/wheel group (same parent
    // identity, so grp.userData.strut / grp.userData.wheel keep pointing at
    // the exact Group the compression/spin code already writes to — only
    // their static mesh children collapse). Bay doors (direct children of
    // the gear group, not strut/wheel) are merged among themselves too.
    for (const grp of gearGroups) {
      if (!grp || !grp.userData) continue;
      if (grp.userData.strut) mergeChildrenOf(grp.userData.strut);
      if (grp.userData.wheel) mergeChildrenOf(grp.userData.wheel);
      mergeChildrenOf(grp, o => o.parent === grp);
    }

    // Gear clones (nose/L/R) each keep their own strut/wheel meshes for
    // animation, but their one-off materials still visually match — dedupe
    // materials ACROSS all gear groups here (no further geometry merge) so
    // they share programs without collapsing into single animated meshes.
    { const gearMeshes = [];
      for (const grp of gearGroups) {
        if (!grp || !grp.userData) continue;
        if (grp.userData.strut) gearMeshes.push(...eligibleMeshesOf(grp.userData.strut));
        if (grp.userData.wheel) gearMeshes.push(...eligibleMeshesOf(grp.userData.wheel));
        gearMeshes.push(...eligibleMeshesOf(grp, o => o.parent === grp));
      }
      dedupeMaterials(gearMeshes);
    }
    return { mergedGroups, removed };
  }
  mergeStaticJetChildren(root, [gearNose, gearL, gearR]);

  { let meshes = 0; const mats = new Set();
    root.traverse(o => { if (o.isMesh) { meshes++; (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m && mats.add(m)); } });
    console.log(`[flight-sim] jet budget: meshes=${meshes} materials=${mats.size}`); }

  return root;
}

// Damage-decal stubs must exist BEFORE the setup IIFE (below) writes
// to them, and BEFORE damagePlane() (defined in the PLANE STATE block)
// calls them. Declared with `var` so they're function-scoped and
// guaranteed hoisted — avoids TDZ if any init order shifts later.
var spawnDamageDecal = function () {};
var damageDecalsClear = function () {};

const jet = makeJet();
applyShadowFlags(jet);
scene.add(jet);
bootLog.step('jet built', true,
  `guns=${!!(jet.userData && jet.userData.gunL && jet.userData.gunR)} · engineSmoke=${!!(jet.userData && jet.userData.engineSmokeL && jet.userData.engineSmokeR)}`);

const replayHeroRig = (() => {
  const target = new THREE.Object3D();
  const spot = new THREE.SpotLight(0xfff1cf, 0, 340, Math.PI / 5.8, 0.55, 1.5);
  spot.castShadow = false;
  spot.visible = false;
  spot.target = target;
  const fill = new THREE.PointLight(0x9fc7ff, 0, 180, 2.1);
  fill.visible = false;
  scene.add(target);
  scene.add(spot);
  scene.add(fill);
  return { spot, fill, target };
})();
const airframeFillRig = (() => {
  const target = new THREE.Object3D();
  const spot = new THREE.SpotLight(0xf3f6ff, 0, 210, Math.PI / 6.1, 0.62, 1.4);
  spot.castShadow = false;
  spot.visible = false;
  spot.target = target;
  const fill = new THREE.PointLight(0x9ebeff, 0, 120, 2.0);
  fill.visible = false;
  scene.add(target);
  scene.add(spot);
  scene.add(fill);
  return { spot, fill, target };
})();
// Aux-light visibility groups. three.js r128 bakes the VISIBLE point/spot light
// counts into every lit material's program hash, so flipping a light's `visible`
// flag forces a lazy shader recompile (a mid-flight hitch) unless that state was
// compiled up front. Three toggle groups exist:
//   F = airframeFillRig (1 spot + 1 point), H = replayHeroRig (1 spot + 1 point),
//   N = 2 apron-flood points + 2 landing spots (paired so point/spot counts stay
//       matched). Every reachable hash therefore has matched point+spot counts
//       0..4 — the five states prewarmLightStatePrograms compiles at boot. Adding
//       any new toggled Point/Spot light breaks this invariant; re-enumerate the
//       prewarm state list if you do.
// Group N's off-switch dwells so the lights-hash can't flap at the threshold.
const AUX_LIGHT_ON_INTENSITY = 0.02;
const AUX_LIGHT_OFF_INTENSITY = 0.005;
const AUX_LIGHT_OFF_DWELL_MS = 3000;
const auxLightGroupN = { on: true, offSince: 0, floodWant: 0, landingWant: 0 };
function updateAuxLightGroupN(nowMs) {
  const want = Math.max(auxLightGroupN.floodWant, auxLightGroupN.landingWant);
  if (!auxLightGroupN.on) {
    if (want > AUX_LIGHT_ON_INTENSITY) { auxLightGroupN.on = true; auxLightGroupN.offSince = 0; }
  } else if (want < AUX_LIGHT_OFF_INTENSITY) {
    if (!auxLightGroupN.offSince) auxLightGroupN.offSince = nowMs;
    else if (nowMs - auxLightGroupN.offSince > AUX_LIGHT_OFF_DWELL_MS) auxLightGroupN.on = false;
  } else {
    auxLightGroupN.offSince = 0;
  }
  return auxLightGroupN.on;
}
function prewarmLightStatePrograms() {
  const fill = [airframeFillRig.spot, airframeFillRig.fill];
  const hero = [replayHeroRig.spot, replayHeroRig.fill];
  const groupN = airfieldAmbientState.apronFloods.map(r => r.light)
    .concat(((jet.userData && jet.userData.landingRigs) || []).map(r => r.light));
  const all = groupN.concat(fill, hero);
  const saved = all.map(l => l.visible);
  // Matched point+spot sums 0,1,2,3,4 — the only hashes runtime toggles produce.
  const states = [[], [fill], [fill, hero], [fill, groupN], [fill, hero, groupN]];
  for (const groups of states) {
    for (const l of all) l.visible = false;
    for (const g of groups) for (const l of g) l.visible = true;
    try { renderer.compile(scene, camera); } catch (e) {}
  }
  all.forEach((l, i) => { l.visible = saved[i]; });
}
const aeroFlexState = {
  wingBend: 0,
  aileron: 0,
  elevator: 0,
  rudder: 0,
  shake: 0,
};

