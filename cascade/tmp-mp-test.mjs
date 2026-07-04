// Round-trip + hardening test for the shared multiplayer core.
// Run:  bun cascade/tmp-mp-test.mjs          (spawns multiplayer-server.mjs)
//       bun cascade/tmp-mp-test.mjs tweaks   (spawns tweaks-server.mjs)
// Exits 0 on pass, 1 on fail.
const MODE = process.argv[2] || 'mp';
const PORT = 8801;
const cmd = MODE === 'tweaks'
  ? ['bun', new URL('../tweaks-server.mjs', import.meta.url).pathname]
  : ['bun', new URL('../multiplayer-server.mjs', import.meta.url).pathname, String(PORT)];
const env = MODE === 'tweaks' ? { ...process.env, PORT: String(PORT) } : process.env;
const WS = `ws://127.0.0.1:${PORT}`;

const proc = Bun.spawn(cmd, { env, stdout: 'inherit', stderr: 'inherit' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fail = (m) => { console.error('FAIL:', m); try { proc.kill(); } catch {} process.exit(1); };

function open() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS);
    ws.inbox = [];
    ws.addEventListener('message', (e) => { ws.inbox.push(JSON.parse(e.data)); });
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', reject);
  });
}

try {
  await sleep(600); // let server boot
  const a = await open();
  a.send(JSON.stringify({ type: 'join', room: 'r', id: 'A', state: { pos: { x: 0, y: 0, z: 0 } } }));
  await sleep(150);
  if (!a.inbox.some(m => m.type === 'welcome' && m.id === 'A')) fail('A did not get welcome');

  const b = await open();
  b.send(JSON.stringify({ type: 'join', room: 'r', id: 'B', state: { pos: { x: 1, y: 1, z: 1 } } }));
  await sleep(150);
  if (!b.inbox.some(m => m.type === 'welcome')) fail('B did not get welcome');
  if (!a.inbox.some(m => m.type === 'state' && m.id === 'B')) fail('A did not get B join broadcast');

  a.inbox.length = 0;
  b.send(JSON.stringify({ type: 'state', id: 'B', state: { pos: { x: 2, y: 2, z: 2 } } }));
  await sleep(150);
  if (!a.inbox.some(m => m.type === 'state' && m.id === 'B')) fail('A did not get valid B state broadcast');

  a.inbox.length = 0;
  b.send(JSON.stringify({ type: 'state', id: 'A', state: { pos: { x: 999, y: 999, z: 999 } } }));
  await sleep(150);
  if (a.inbox.some(m => m.type === 'state' && m.id === 'A' && m.state && m.state.pos && m.state.pos.x === 999)) fail('spoofed id was accepted');

  a.inbox.length = 0;
  b.send(JSON.stringify({ type: 'state', id: 'B', state: { blob: 'x'.repeat(5000) } }));
  await sleep(150);
  if (a.inbox.some(m => m.type === 'state')) fail('oversized payload was broadcast');
  b.send(JSON.stringify({ type: 'ping' }));
  await sleep(150);
  if (!b.inbox.some(m => m.type === 'pong')) fail('server dead after oversized payload');

  a.inbox.length = 0;
  b.close();
  await sleep(250);
  if (!a.inbox.some(m => m.type === 'leave' && m.id === 'B')) fail('A did not get B leave');

  console.log('PASS: all multiplayer core assertions');
  try { proc.kill(); } catch {}
  process.exit(0);
} catch (e) {
  fail((e && e.message) || String(e));
}
