// @module src/game/05-airfield.js
// =============================================================
//  RUNWAY + TOWER
// =============================================================
const airfieldNightFx = {
  edgeInst: null,            // InstancedMesh — runway edge lights (uniform pulse)
  edgePositions: [],         // per-instance Vector3 base positions
  approachInst: null,        // InstancedMesh — approach lights (sequenced pulse, varying width)
  approachData: [],          // per-instance { pos, width, sequence }
  edgeMaterial: null,
  approachMaterial: null,
  beacon: null,
  beaconMaterial: null,
};
const _airfieldLightMat4 = new THREE.Matrix4();
const _airfieldLightScale = new THREE.Vector3();
const _airfieldLightQuat = new THREE.Quaternion();
const airfieldAmbientState = {
  windsock: null,
  windsockPole: null,
  apronFloods: [],
  taxiSigns: [],
  clutterCount: 0,
};
const LANDING_RECORD_KEY = 'flight-best-landing-v1';
const bestLandingRecord = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(LANDING_RECORD_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      return {
        medal: saved.medal || '—',
        grade: saved.grade || '',
        score: Number.isFinite(saved.score) ? saved.score : 0,
        detail: saved.detail || '',
      };
    }
  } catch {}
  return { medal: '—', grade: '', score: 0, detail: '' };
})();
const destructibleTargets = [];

function registerDestructible(object, opts = {}) {
  const target = {
    object,
    radius: opts.radius || 3,
    health: opts.health || 1,
    maxHealth: opts.maxHealth || opts.health || 1,
    shield: opts.shield || 0,
    shieldMax: opts.shieldMax || opts.shield || 0,
    shieldPulse: 0,
    lastHitAt: 0,
    lastDamageText: '',
    alive: true,
    kind: opts.kind || 'prop',
  };
  destructibleTargets.push(target);
  return target;
}

function applyShadowFlags(root, { cast = true, receive = true } = {}) {
  root.traverse(obj => {
    if (!obj.isMesh) return;
    const material = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    const isBasic = material && material.type === 'MeshBasicMaterial';
    const isMostlyTransparent = material && material.transparent && material.opacity < 0.95;
    obj.receiveShadow = receive && !isBasic;
    obj.castShadow = cast && !isBasic && !isMostlyTransparent;
  });
}

function buildAirfield() {
  const g = new THREE.Group();

  const surfaceY = AIRFIELD_SURFACE_Y;

  const runwaySurfaceTexture = (() => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 4096;
    const g2 = c.getContext('2d');
    g2.fillStyle = '#26242a';
    g2.fillRect(0, 0, c.width, c.height);
    const grad = g2.createLinearGradient(0, 0, c.width, 0);
    grad.addColorStop(0, 'rgba(76,78,88,0.18)');
    grad.addColorStop(0.15, 'rgba(10,10,12,0.14)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.03)');
    grad.addColorStop(0.85, 'rgba(10,10,12,0.14)');
    grad.addColorStop(1, 'rgba(76,78,88,0.18)');
    g2.fillStyle = grad;
    g2.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < 5200; i++) {
      const x = Math.random() * c.width;
      const y = Math.random() * c.height;
      const s = 1 + Math.random() * 2.4;
      const shade = 28 + Math.random() * 20;
      g2.fillStyle = `rgba(${shade},${shade},${shade + 6},${0.05 + Math.random() * 0.08})`;
      g2.fillRect(x, y, s, s * (0.7 + Math.random() * 1.4));
    }
    g2.strokeStyle = 'rgba(255,241,206,0.92)';
    g2.lineWidth = 10;
    g2.setLineDash([74, 58]);
    g2.beginPath();
    g2.moveTo(c.width * 0.5, 180);
    g2.lineTo(c.width * 0.5, c.height - 180);
    g2.stroke();
    g2.setLineDash([]);
    g2.strokeStyle = 'rgba(255,245,230,0.52)';
    g2.lineWidth = 6;
    g2.beginPath();
    g2.moveTo(42, 80);
    g2.lineTo(42, c.height - 80);
    g2.moveTo(c.width - 42, 80);
    g2.lineTo(c.width - 42, c.height - 80);
    g2.stroke();
    g2.fillStyle = 'rgba(255,241,220,0.88)';
    for (let i = 0; i < 6; i++) {
      const y = 140 + i * 34;
      g2.fillRect(76 + i * 18, y, 28, 84);
      g2.fillRect(c.width - 104 - i * 18, y, 28, 84);
      const y2 = c.height - 224 - i * 34;
      g2.fillRect(76 + i * 18, y2, 28, 84);
      g2.fillRect(c.width - 104 - i * 18, y2, 28, 84);
    }
    for (let i = 0; i < 18; i++) {
      const cx = c.width * (0.45 + (Math.random() - 0.5) * 0.18);
      const cy = 260 + Math.random() * (c.height - 520);
      const len = 140 + Math.random() * 420;
      const wid = 4 + Math.random() * 11;
      g2.fillStyle = `rgba(12,12,12,${0.05 + Math.random() * 0.08})`;
      g2.save();
      g2.translate(cx, cy);
      g2.rotate((Math.random() - 0.5) * 0.08);
      g2.fillRect(-wid * 0.5, -len * 0.5, wid, len);
      g2.restore();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace || tex.colorSpace;
    tex.anisotropy = 8;
    return tex;
  })();

  const apronSurfaceTexture = (() => {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 1024;
    const g2 = c.getContext('2d');
    g2.fillStyle = '#353038';
    g2.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < 1800; i++) {
      const x = Math.random() * c.width;
      const y = Math.random() * c.height;
      const s = 1 + Math.random() * 4;
      const shade = 40 + Math.random() * 22;
      g2.fillStyle = `rgba(${shade},${shade},${shade + 8},${0.05 + Math.random() * 0.08})`;
      g2.fillRect(x, y, s, s);
    }
    g2.strokeStyle = 'rgba(255,193,77,0.85)';
    g2.lineWidth = 8;
    g2.strokeRect(78, 78, c.width - 156, c.height - 156);
    g2.strokeStyle = 'rgba(255,193,77,0.45)';
    g2.lineWidth = 5;
    g2.beginPath();
    g2.moveTo(c.width * 0.28, 160);
    g2.lineTo(c.width * 0.28, c.height - 160);
    g2.moveTo(c.width * 0.72, 160);
    g2.lineTo(c.width * 0.72, c.height - 160);
    g2.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace || tex.colorSpace;
    tex.anisotropy = 8;
    return tex;
  })();

  const taxiwaySurfaceTexture = (() => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 1024;
    const g2 = c.getContext('2d');
    g2.fillStyle = '#403933';
    g2.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * c.width;
      const y = Math.random() * c.height;
      const s = 1 + Math.random() * 3;
      g2.fillStyle = `rgba(255,255,255,${0.015 + Math.random() * 0.03})`;
      g2.fillRect(x, y, s, s);
    }
    g2.strokeStyle = 'rgba(255,186,71,0.9)';
    g2.lineWidth = 8;
    g2.setLineDash([58, 34]);
    g2.beginPath();
    g2.moveTo(c.width * 0.5, 80);
    g2.lineTo(c.width * 0.5, c.height - 80);
    g2.stroke();
    g2.setLineDash([]);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace || tex.colorSpace;
    tex.anisotropy = 8;
    return tex;
  })();

  // Runway — long strip along -Z
  const runway = new THREE.Mesh(
    new THREE.PlaneGeometry(34, 420),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: runwaySurfaceTexture,
      roughness: 0.94,
      metalness: 0.04,
    })
  );
  runway.rotation.x = -Math.PI / 2;
  runway.position.set(0, surfaceY, 0);
  g.add(runway);

  // Taxiway apron
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(58, 56),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: apronSurfaceTexture,
      roughness: 0.92,
      metalness: 0.05,
    })
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(34, surfaceY - 0.004, 150);
  g.add(apron);

  const taxiway = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 74),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: taxiwaySurfaceTexture,
      roughness: 0.91,
      metalness: 0.04,
    })
  );
  taxiway.rotation.x = -Math.PI / 2;
  taxiway.position.set(17, surfaceY - 0.002, 116);
  g.add(taxiway);

  const shadowCatcher = new THREE.Mesh(
    new THREE.PlaneGeometry(520, 520),
    new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.22 })
  );
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.position.set(0, surfaceY - 0.03, 20);
  shadowCatcher.receiveShadow = true;
  shadowCatcher.material.depthWrite = false;
  shadowCatcher.renderOrder = 1;
  g.add(shadowCatcher);

  // Tower
  const towerGrp = new THREE.Group();
  towerGrp.position.set(38, 0, 70);
  const towerMat = new THREE.MeshStandardMaterial({ color: 0xbba487, roughness: 0.9, metalness: 0.05 });
  const towerDark = new THREE.MeshStandardMaterial({ color: 0x2a2d36, roughness: 0.6, metalness: 0.2 });
  const towerGlass = new THREE.MeshStandardMaterial({
    color: 0x0a2838, roughness: 0.1, metalness: 1.0,
    transparent: true, opacity: 0.85
  });

  const base = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 8), towerMat);
  base.position.y = 2;
  towerGrp.add(base);

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, 16, 10), towerMat);
  shaft.position.y = 12;
  towerGrp.add(shaft);

  const deck = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 2.6, 1, 12), towerDark);
  deck.position.y = 20.5;
  towerGrp.add(deck);

  const cabin = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 2.8, 12), towerGlass);
  cabin.position.y = 22.4;
  towerGrp.add(cabin);

  const roof = new THREE.Mesh(new THREE.CylinderGeometry(0, 3.3, 1.2, 12), towerDark);
  roof.position.y = 24.4;
  towerGrp.add(roof);

  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4), towerDark);
  antenna.position.y = 27;
  towerGrp.add(antenna);

  g.add(towerGrp);

  // Some hangars / crates as set dressing
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x9a7d5a, roughness: 0.95 });
  for (let i = 0; i < 6; i++) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 4), crateMat);
    c.position.set(28 + (i % 3) * 8, 1.5, 176 - Math.floor(i / 3) * 8);
    g.add(c);
    registerDestructible(c, { radius: 3.7, kind: 'crate' });
  }

  // Hangar — semi-cylinder for visibility from altitude
  const hangarMat = new THREE.MeshStandardMaterial({ color: 0x8a8275, roughness: 0.85, metalness: 0.15 });
  const hangar = new THREE.Mesh(
    new THREE.CylinderGeometry(7, 7, 16, 18, 1, true, 0, Math.PI),
    hangarMat
  );
  hangar.rotation.z = Math.PI / 2;
  hangar.position.set(68, 0, 146);
  hangar.material.side = THREE.DoubleSide;
  g.add(hangar);
  // Hangar back wall
  const hangarBack = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 7),
    new THREE.MeshStandardMaterial({ color: 0x6d6655, roughness: 0.9 })
  );
  hangarBack.position.set(68, 3.5, 154);
  g.add(hangarBack);

  const hangar2 = hangar.clone();
  hangar2.position.set(-66, 0, 132);
  hangar2.rotation.y = Math.PI;
  g.add(hangar2);
  const hangar2Back = hangarBack.clone();
  hangar2Back.position.set(-66, 3.5, 124);
  g.add(hangar2Back);

  // Fuel tanks
  const tankMat = new THREE.MeshStandardMaterial({ color: 0xb8a285, roughness: 0.7, metalness: 0.4 });
  for (let i = 0; i < 2; i++) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 4, 16), tankMat);
    tank.position.set(-36 + i * 8, 2, 110);
    g.add(tank);
    registerDestructible(tank, { radius: 2.8, kind: 'fuel' });
  }

  const windsockPole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 9, 8), towerDark);
  windsockPole.position.set(-22, 4.5, 168);
  g.add(windsockPole);
  const windsock = new THREE.Mesh(
    new THREE.ConeGeometry(0.65, 2.8, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, toneMapped: false })
  );
  windsock.rotation.z = -Math.PI / 2;
  windsock.position.set(-20.5, 7.3, 168);
  g.add(windsock);
  airfieldAmbientState.windsock = windsock;
  airfieldAmbientState.windsockPole = windsockPole;

  const servicePaint = new THREE.MeshStandardMaterial({ color: 0xd6d1c6, roughness: 0.82, metalness: 0.18 });
  const serviceDark = new THREE.MeshStandardMaterial({ color: 0x2f3138, roughness: 0.7, metalness: 0.24 });
  const hazardPaint = new THREE.MeshStandardMaterial({ color: 0xffc247, roughness: 0.7, metalness: 0.08 });
  function addServiceTruck(x, z, yaw = 0, bodyColor = 0xd6d1c6) {
    const truck = new THREE.Group();
    const bodyMat = servicePaint.clone();
    bodyMat.color.setHex(bodyColor);
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.55, 1.7), serviceDark);
    chassis.position.y = 0.55;
    truck.add(chassis);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 1.6), bodyMat);
    cab.position.set(-1.05, 1.2, 0);
    truck.add(cab);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.95, 1.5), bodyMat);
    bed.position.set(0.95, 1.0, 0);
    truck.add(bed);
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.18, 8),
      new THREE.MeshBasicMaterial({ color: 0xffb133, toneMapped: false, transparent: true, opacity: 0.7 })
    );
    beacon.position.set(-1.05, 1.92, 0);
    truck.add(beacon);
    for (const wx of [-1.45, 1.15]) {
      for (const wz of [-0.82, 0.82]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.28, 12), serviceDark);
        // Ground vehicles run along +X here, so the axle spans across Z.
        // CylinderGeometry is Y-up by default → rotate around X, not Z.
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(wx, 0.3, wz);
        truck.add(wheel);
      }
    }
    truck.position.set(x, 0, z);
    truck.rotation.y = yaw;
    g.add(truck);
    airfieldAmbientState.clutterCount += 1;
    return truck;
  }
  function addTowCart(x, z, yaw = 0) {
    const cart = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.35, 1.25), hazardPaint);
    frame.position.y = 0.45;
    cart.add(frame);
    const towArm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 0.18), serviceDark);
    towArm.position.set(-1.7, 0.42, 0);
    cart.add(towArm);
    for (const wx of [-0.8, 0.8]) {
      for (const wz of [-0.58, 0.58]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.18, 10), serviceDark);
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(wx, 0.18, wz);
        cart.add(wheel);
      }
    }
    cart.position.set(x, 0, z);
    cart.rotation.y = yaw;
    g.add(cart);
    airfieldAmbientState.clutterCount += 1;
    return cart;
  }
  function addCone(x, z) {
    const cone = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.12, 10), serviceDark);
    base.position.y = 0.06;
    cone.add(base);
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.7, 10), hazardPaint);
    body.position.y = 0.42;
    cone.add(body);
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.08, 10), new THREE.MeshBasicMaterial({ color: 0xfff3d0, toneMapped: false }));
    stripe.position.y = 0.45;
    cone.add(stripe);
    cone.position.set(x, 0, z);
    g.add(cone);
    airfieldAmbientState.clutterCount += 1;
    return cone;
  }
  function addTaxiSign(x, z, yaw = 0, signColor = 0xffc247) {
    const sign = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.0, 8), serviceDark);
    post.position.y = 0.5;
    sign.add(post);
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.55, 0.14),
      new THREE.MeshStandardMaterial({ color: signColor, roughness: 0.72, metalness: 0.08, emissive: 0x332200, emissiveIntensity: 0.18 })
    );
    panel.position.y = 1.05;
    sign.add(panel);
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.12), new THREE.MeshBasicMaterial({ color: 0x111111, toneMapped: false }));
    stripe.position.set(0, 1.05, 0.08);
    stripe.rotation.y = Math.PI;
    sign.add(stripe);
    const stripeBack = stripe.clone();
    stripeBack.position.z = -0.08;
    stripeBack.rotation.y = 0;
    sign.add(stripeBack);
    sign.position.set(x, 0, z);
    sign.rotation.y = yaw;
    g.add(sign);
    airfieldAmbientState.taxiSigns.push(sign);
    airfieldAmbientState.clutterCount += 1;
    return sign;
  }
  function addApronFlood(x, z, yaw = 0) {
    const flood = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 8.6, 10), serviceDark);
    pole.position.y = 4.3;
    flood.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.28, 0.42), towerDark);
    head.position.set(0, 8.55, 0.12);
    flood.add(head);
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffefc8, transparent: true, opacity: 0.0, toneMapped: false })
    );
    glow.position.set(0, 8.38, -0.02);
    flood.add(glow);
    const light = new THREE.PointLight(0xfff0d8, 0, 52, 2.2);
    light.position.set(0, 8.3, 0);
    flood.add(light);
    flood.position.set(x, 0, z);
    flood.rotation.y = yaw;
    g.add(flood);
    airfieldAmbientState.apronFloods.push({ light, glow, head });
    airfieldAmbientState.clutterCount += 1;
    return flood;
  }

  addServiceTruck(18, 154, Math.PI * 0.18, 0xd8d5cd);
  addServiceTruck(-10, 144, -Math.PI * 0.42, 0xc8d5a8);
  addTowCart(2, 162, Math.PI * 0.08);
  addTowCart(-28, 152, -Math.PI * 0.2);
  addTaxiSign(10, 126, 0.05, 0xffc247);
  addTaxiSign(-12, 182, Math.PI * 0.92, 0x2d2d2d);
  addApronFlood(56, 176, -0.18);
  addApronFlood(-52, 164, 0.12);
  for (let i = 0; i < 6; i++) addCone(-6 + i * 4.2, 186);
  for (let i = 0; i < 5; i++) addCone(44 + i * 3.4, 136 + (i % 2) * 3);

  // Strafe-range explosive drums along the runway edge so the player can shoot things immediately.
  const drumMat = new THREE.MeshStandardMaterial({
    color: 0xcc4422,
    emissive: 0x661100,
    emissiveIntensity: 0.25,
    roughness: 0.5,
    metalness: 0.2,
  });
  const drumOffsets = [
    { x: -18, z: 40 }, { x: 18, z: 20 },
    { x: -18, z: -60 }, { x: 18, z: -120 },
  ];
  for (const off of drumOffsets) {
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 2.1, 12), drumMat);
    drum.position.set(off.x, 1.05, off.z);
    g.add(drum);
    registerDestructible(drum, { radius: 1.4, kind: 'barrel' });
  }

  // Floating range drones straight down the runway so the new guns have obvious targets.
  const droneMat = new THREE.MeshStandardMaterial({
    color: 0xff5533,
    emissive: 0xff2200,
    emissiveIntensity: 0.9,
    roughness: 0.35,
    metalness: 0.15,
  });
  const dronePoints = [
    { x: 0, y: 4, z: -280 },
    { x: 18, y: 10, z: -520 },
    { x: -18, y: 14, z: -760 },
  ];
  for (const pt of dronePoints) {
    const drone = new THREE.Mesh(new THREE.OctahedronGeometry(2.3, 0), droneMat.clone());
    drone.position.set(pt.x, pt.y, pt.z);
    g.add(drone);
    registerDestructible(drone, { radius: 4.2, kind: 'drone' });
  }

  // Radio mast
  const mastMat = new THREE.MeshStandardMaterial({ color: 0xaa3322, roughness: 0.6 });
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.4, 30, 6), mastMat);
  mast.position.set(-40, 15, 60);
  g.add(mast);
  // Red beacon at mast top
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff2200, transparent: true, opacity: 0.2, toneMapped: false })
  );
  beacon.position.set(-40, 30.3, 60);
  g.add(beacon);
  airfieldNightFx.beacon = beacon;
  airfieldNightFx.beaconMaterial = beacon.material;

  // Runway edge lights — one InstancedMesh (42 instances) instead of 42 draw calls.
  // The night-FX pulse (uniform across edge lights) is applied via per-instance
  // matrices in updateRunwayLights, gated on airfield proximity so it's free when away.
  const lightMat = new THREE.MeshBasicMaterial({
    color: 0xffe499,
    transparent: true,
    opacity: 0.18,
    toneMapped: false,
  });
  airfieldNightFx.edgeMaterial = lightMat;
  const edgePositions = [];
  for (let z = -200; z <= 200; z += 20) {
    edgePositions.push(new THREE.Vector3(-15, 0.3, z));
    edgePositions.push(new THREE.Vector3(15, 0.3, z));
  }
  const edgeInst = new THREE.InstancedMesh(new THREE.SphereGeometry(0.25, 6, 6), lightMat, edgePositions.length);
  edgeInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < edgePositions.length; i++) {
    _airfieldLightMat4.compose(edgePositions[i], _airfieldLightQuat.identity(), _airfieldLightScale.set(1, 1, 1));
    edgeInst.setMatrixAt(i, _airfieldLightMat4);
  }
  edgeInst.instanceMatrix.needsUpdate = true;
  g.add(edgeInst);
  airfieldNightFx.edgeInst = edgeInst;
  airfieldNightFx.edgePositions = edgePositions;

  // Approach lights — one InstancedMesh (16 instances). Each light's width varies
  // (w = 1 + i*0.4), so we use a UNIT box and bake width into the instance matrix's
  // X scale; the sequenced "rabbit" pulse is applied per-instance in updateRunwayLights.
  const approachMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.16,
    toneMapped: false,
  });
  airfieldNightFx.approachMaterial = approachMat;
  const approachData = [];
  for (let i = 1; i <= 8; i++) {
    const w = 1 + i * 0.4;
    approachData.push({ pos: new THREE.Vector3(0, 0.05, -208 - i * 14), width: w, sequence: i });
    approachData.push({ pos: new THREE.Vector3(0, 0.05, 208 + i * 14), width: w, sequence: i });
  }
  const approachInst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.1, 0.5), approachMat, approachData.length);
  approachInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < approachData.length; i++) {
    _airfieldLightMat4.compose(approachData[i].pos, _airfieldLightQuat.identity(), _airfieldLightScale.set(approachData[i].width, 1, 1));
    approachInst.setMatrixAt(i, _airfieldLightMat4);
  }
  approachInst.instanceMatrix.needsUpdate = true;
  g.add(approachInst);
  airfieldNightFx.approachInst = approachInst;
  airfieldNightFx.approachData = approachData;

  runway.receiveShadow = true;
  runway.castShadow = false;
  apron.receiveShadow = true;
  apron.castShadow = false;
  applyShadowFlags(g);
  shadowCatcher.receiveShadow = true;
  shadowCatcher.castShadow = false;

  scene.add(g);
}
buildAirfield();

const worldInstallations = [];
function addGenerativeInstallation(label, x, z, opts = {}) {
  const groundY = (x * x + z * z < AIRFIELD_FLAT_R2) ? AIRFIELD_SURFACE_Y : getHeight(x, z);
  const group = new THREE.Group();
  group.name = `installation:${label}`;
  group.position.set(x, groundY, z);
  const padRadius = opts.padRadius || 24;
  const padMat = new THREE.MeshStandardMaterial({ color: opts.padColor || 0x34333a, roughness: 0.86, metalness: 0.12 });
  const trimMat = new THREE.MeshBasicMaterial({ color: opts.trimColor || 0x7de7ff, transparent: true, opacity: 0.45, toneMapped: false });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x242936, roughness: 0.62, metalness: 0.34 });
  const wallMat = new THREE.MeshStandardMaterial({ color: opts.wallColor || 0x8e897c, roughness: 0.82, metalness: 0.12 });
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(padRadius, padRadius * 1.06, 0.22, 36), padMat);
  pad.position.y = 0.08;
  group.add(pad);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(padRadius * 0.86, 0.16, 8, 48), trimMat.clone());
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.28;
  group.add(ring);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(5.6, 18, 10), wallMat);
  dome.scale.set(1.25, 0.52, 1.25);
  dome.position.set(-padRadius * 0.22, 3.0, padRadius * 0.12);
  group.add(dome);
  const block = new THREE.Mesh(new THREE.BoxGeometry(10, 5.2, 7.2), wallMat.clone());
  block.position.set(padRadius * 0.26, 2.6, -padRadius * 0.18);
  group.add(block);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.34, 24, 8), darkMat);
  mast.position.set(padRadius * 0.42, 12, padRadius * 0.38);
  group.add(mast);
  const dish = new THREE.Mesh(new THREE.ConeGeometry(3.2, 1.25, 28, 1, true), new THREE.MeshStandardMaterial({ color: 0x9fb6c7, roughness: 0.34, metalness: 0.56, side: THREE.DoubleSide }));
  dish.rotation.x = Math.PI * 0.36;
  dish.rotation.z = opts.dishYaw || 0;
  dish.position.set(padRadius * 0.42, 24.2, padRadius * 0.38);
  group.add(dish);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + (opts.phase || 0);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), trimMat.clone());
    beacon.position.set(Math.cos(a) * padRadius * 0.72, 0.62, Math.sin(a) * padRadius * 0.72);
    beacon.userData.phase = i / 6;
    group.add(beacon);
  }
  applyShadowFlags(group);
  scene.add(group);
  const rec = { label, group, pos: new THREE.Vector3(x, groundY, z), radius: padRadius, beacons: group.children.filter(o => o.material && o.material.toneMapped === false) };
  worldInstallations.push(rec);
  return rec;
}
addGenerativeInstallation('RIDGE ARRAY', 420, -760, { padRadius: 28, trimColor: 0x7df7ff, dishYaw: 0.4 });
addGenerativeInstallation('CANYON RELAY', -560, -430, { padRadius: 24, trimColor: 0xffd37f, wallColor: 0x9a8066, phase: 0.3 });
addGenerativeInstallation('RESERVOIR LAB', 620, 720, { padRadius: 30, trimColor: 0x8dffcb, wallColor: 0x7f8f90, dishYaw: -0.55 });
window.__worldInstallations = worldInstallations;

function updateGenerativeInstallations(dt) {
  const t = performance.now() * 0.002;
  for (const inst of worldInstallations) {
    if (inst.group) inst.group.rotation.y += dt * 0.015;
    for (const beacon of inst.beacons || []) {
      const pulse = 0.28 + Math.max(0, Math.sin(t * 2.2 + (beacon.userData.phase || 0) * Math.PI * 2)) * 0.46;
      beacon.material.opacity = pulse;
      beacon.scale.setScalar(0.75 + pulse * 1.35);
    }
  }
}

let _runwayLightsLastAt = 0;
function updateRunwayLights(nightFactor, twilight) {
  const nightGlow = Math.max(0, nightFactor * 1.15 + twilight * 0.22);
  const pulseT = performance.now() * 0.004;
  const pulse = 0.9 + Math.sin(pulseT) * 0.08;
  if (airfieldNightFx.edgeMaterial) {
    airfieldNightFx.edgeMaterial.opacity = 0.04 + nightGlow * 0.92;
  }
  if (airfieldNightFx.approachMaterial) {
    airfieldNightFx.approachMaterial.opacity = 0.03 + nightGlow * 0.95;
  }
  // Publish flood demand every call (above the 20 Hz gate) for the group-N
  // state machine; visibility is APPLIED per frame in updateJetVisual alongside
  // the landing rigs so all four group-N lights flip atomically in one frame —
  // a second application site here would render frames with mismatched
  // point/spot counts (hashes outside the prewarmed states → shader recompile).
  auxLightGroupN.floodWant = nightGlow * 1.25;
  // Per-instance pulse — only rebuild matrices when near the airfield (the instanced
  // lights are frustum-culled in cruise, so this work is skipped the rest of the time).
  // The pulse animates slowly, so 20 Hz is indistinguishable from per-frame and
  // skips ~2/3 of the matrix recompose + GPU buffer re-uploads.
  const nowMs = performance.now();
  if (nowMs - _runwayLightsLastAt < 50) return;
  _runwayLightsLastAt = nowMs;
  const nf = airfieldNightFx;
  const nearField = (plane.pos.x * plane.pos.x + plane.pos.z * plane.pos.z) < (3200 * 3200);
  if (nearField && nf.edgeInst) {
    const s = 0.72 + nightGlow * 1.05 * pulse;
    for (let i = 0; i < nf.edgePositions.length; i++) {
      _airfieldLightMat4.compose(nf.edgePositions[i], _airfieldLightQuat.identity(), _airfieldLightScale.set(s, s, s));
      nf.edgeInst.setMatrixAt(i, _airfieldLightMat4);
    }
    nf.edgeInst.instanceMatrix.needsUpdate = true;
  }
  if (nearField && nf.approachInst) {
    for (let i = 0; i < nf.approachData.length; i++) {
      const d = nf.approachData[i];
      const seqPulse = 0.82 + Math.max(0, Math.sin(pulseT * 1.9 - d.sequence * 0.72)) * 0.48;
      const sx = (1 + nightGlow * 0.42 * seqPulse) * d.width;  // bake per-instance width into X scale
      _airfieldLightMat4.compose(d.pos, _airfieldLightQuat.identity(), _airfieldLightScale.set(sx, 1, 1 + nightGlow * 0.24 * seqPulse));
      nf.approachInst.setMatrixAt(i, _airfieldLightMat4);
    }
    nf.approachInst.instanceMatrix.needsUpdate = true;
  }
  for (const rig of airfieldAmbientState.apronFloods) {
    rig.light.intensity = nightGlow * 1.25;
    rig.glow.material.opacity = 0.02 + nightGlow * 0.28;
    rig.glow.scale.setScalar(0.85 + nightGlow * 0.9);
  }
  if (airfieldNightFx.beaconMaterial) {
    const blink = Math.sin(performance.now() * 0.009) > 0.35 ? 1 : 0.25;
    airfieldNightFx.beaconMaterial.opacity = 0.08 + nightGlow * 0.82 * blink;
  }
}

// Ambient gust amplitude (0.16-1.2), refreshed every updateAirfieldAmbient
// call; the WIND HUD chip (nhudUpdateWind) reads this rather than recomputing
// its own noise so the chip and the windsock stay in lockstep.
let nhudWindGust = 0.5;
function updateAirfieldAmbient(dt) {
  const t = performance.now() * 0.001;
  const gustBase = 0.52 + Math.sin(t * 0.23 + timeOfDay.phase * Math.PI * 2) * 0.18 + Math.sin(t * 0.61) * 0.08;
  const localBoost = plane.onGround ? Math.max(0, plane.throttle - 0.18) * 0.42 : 0;
  const gust = Math.max(0.16, Math.min(1.2, gustBase + localBoost));
  nhudWindGust = gust;
  const windsock = airfieldAmbientState.windsock;
  if (windsock) {
    windsock.rotation.y = 0.52 + Math.sin(t * 0.17) * 0.18;
    windsock.rotation.x = Math.sin(t * 3.2) * 0.03 * gust;
    windsock.rotation.z = -Math.PI / 2 + Math.sin(t * 2.3) * 0.08 * gust;
    windsock.scale.set(0.82 + gust * 0.32, 0.92 + gust * 0.06, 0.92 + gust * 0.08);
  }
  for (let i = 0; i < airfieldAmbientState.taxiSigns.length; i++) {
    const sign = airfieldAmbientState.taxiSigns[i];
    if (!sign) continue;
    sign.position.y = Math.sin(performance.now() * 0.0014 + i) * 0.015;
  }
}

