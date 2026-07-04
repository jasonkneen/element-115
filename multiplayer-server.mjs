import { roomStats, startTtlSweep, websocketHandlers } from './mp-core.mjs';

const port = Number(process.argv[2] || process.env.PORT || 8787);

startTtlSweep();

Bun.serve({
  port,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, ...roomStats() }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    if (server.upgrade(req)) return;
    return new Response('Multiplayer websocket server is running. Connect via ws://host:' + port, { status: 200 });
  },
  websocket: websocketHandlers,
});

console.log(`[multiplayer] listening on ws://0.0.0.0:${port}`);
