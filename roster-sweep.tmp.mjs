// Roster orientation sweep: load every GLB preset, pose a consistent 3/4
// front-left camera, screenshot, and measure which end of the model is
// slender (nose should face -Z / toward camera-left in the shot).
import { chromium } from 'playwright';

const ROSTER = [
  ['dusty',    'plane=models/disney_planes_-_dusty_turbo.glb'],
  ['stunt',    'plane=models/stunt_plane.glb&variant=1'],
  ['corsair',  'plane=models/corsair_f4u-1_airplane.glb'],
  ['macchi',   'plane=models/italian_macchi_c.202_folgore.glb'],
  ['yak9',     'plane=models/yak-9.glb'],
  ['tucano',   'plane=models/colombian_emb_314_tucano.glb'],
  ['ripslinger','plane=models/ripslinger.glb'],
  ['p100',     'plane=models/p-100_avenger_-_free.glb'],
  ['trainer',  'plane=models/low_poly_plane.glb'],
  ['f15',      'plane=models/f-15.glb&jet=1&ry=0'],
  ['f15lp',    'plane=models/low_poly_f-15.glb&jet=1&ry=0'],
  ['a10',      'plane=models/a-10c_thunderbolt_ii.glb&jet=1&ry=0'],
];

const OUT = process.argv[2] || 'roster';
const browser = await chromium.launch({ executablePath: '/Users/jkneen/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell' });
const page = await browser.newPage({ viewport: { width: 760, height: 480 } });
const results = [];

for (const [key, qs] of ROSTER) {
  try {
    await page.goto(`http://localhost:8799/flight-sim3.html?${qs}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const metrics = await page.evaluate(async () => {
      await new Promise(r => setTimeout(r, 4500)); // boot + GLB
      const s = window.__sim;
      if (!s) return { error: 'no sim' };
      s.renderer.domElement.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await new Promise(r => setTimeout(r, 250));
      window.__ap.setSpawnMode('runway36'); window.__ap.reset();
      await new Promise(r => setTimeout(r, 900));
      window.__ap.setTimeOfDay(0.25);
      window.__ap.pause();
      const T = s.THREE, J = s.jet, C = s.camera, p = J.position;
      C.position.set(p.x - 11, p.y + 4.5, p.z - 10);
      C.lookAt(p.x + 1, p.y + 0.8, p.z + 2);
      C.updateMatrixWorld(true);
      // slice metric: sample visible vertices in jet-local space; compare
      // lateral spread (x) of the front (z<0) vs rear (z>0) halves; also
      // total extents to spot sideways models (wings along z).
      J.updateWorldMatrix(true, true);
      const inv = new T.Matrix4().copy(J.matrixWorld).invert();
      const v = new T.Vector3();
      let fx = 0, rx = 0, fn = 0, rn = 0, minX=1e9,maxX=-1e9,minZ=1e9,maxZ=-1e9;
      J.traverse(o => {
        if (!o.isMesh || !o.visible || !o.geometry || !o.geometry.attributes.position) return;
        const pos = o.geometry.attributes.position;
        const m = new T.Matrix4().multiplyMatrices(inv, o.matrixWorld);
        const step = Math.max(1, Math.floor(pos.count / 300));
        for (let i = 0; i < pos.count; i += step) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m);
          minX=Math.min(minX,v.x);maxX=Math.max(maxX,v.x);minZ=Math.min(minZ,v.z);maxZ=Math.max(maxZ,v.z);
          if (v.z < 0) { fx += Math.abs(v.x); fn++; } else { rx += Math.abs(v.x); rn++; }
        }
      });
      await new Promise(r => setTimeout(r, 250));
      return {
        frontSpread: +(fx/Math.max(1,fn)).toFixed(2),
        rearSpread: +(rx/Math.max(1,rn)).toFixed(2),
        spanX: +(maxX-minX).toFixed(1), lenZ: +(maxZ-minZ).toFixed(1),
      };
    });
    await page.screenshot({ path: `${OUT}/${key}.jpeg`, quality: 80, type: 'jpeg' });
    results.push({ key, ...metrics });
    console.log(key, JSON.stringify(metrics));
  } catch (e) {
    results.push({ key, error: String(e).slice(0, 120) });
    console.log(key, 'ERROR', String(e).slice(0, 120));
  }
}
await browser.close();
console.log('DONE', results.length);
