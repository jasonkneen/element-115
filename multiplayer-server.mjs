import { roomStats, startTtlSweep, websocketHandlers } from './mp-core.mjs';

const port = Number(process.argv[2] || process.env.PORT || 8787);
const allowedOrigins = new Set(
  String(process.env.MULTIPLAYER_ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean),
);

function isLoopbackAddress(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function isLoopbackOrigin(origin) {
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:'
      && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function isAllowedOrigin(req, server) {
  const origin = req.headers.get('origin');
  if (origin && allowedOrigins.has(origin)) return true;

  // A standalone public relay must have an exact deployment origin listed in
  // MULTIPLAYER_ALLOWED_ORIGINS.  The only automatic allowance is the local
  // developer path, which is restricted to a loopback client as well.
  if (!origin || !isLoopbackOrigin(origin)) return false;
  return isLoopbackAddress(server.requestIP(req)?.address || '');
}

function responseHeaders(contentType = 'text/plain; charset=utf-8') {
  return {
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };
}

startTtlSweep();

Bun.serve({
  port,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, ...roomStats() }), {
        headers: responseHeaders('application/json; charset=utf-8'),
      });
    }
    if (req.headers.get('upgrade') === 'websocket') {
      if (url.pathname !== '/' && url.pathname !== '/ws') {
        return new Response('Not found', { status: 404, headers: responseHeaders() });
      }
      if (!isAllowedOrigin(req, server)) {
        return new Response('Forbidden origin', { status: 403, headers: responseHeaders() });
      }
      if (server.upgrade(req)) return;
      return new Response('WebSocket upgrade failed', { status: 500, headers: responseHeaders() });
    }
    return new Response('Multiplayer websocket server is running. Connect via ws://host:' + port, {
      status: 200,
      headers: responseHeaders(),
    });
  },
  websocket: websocketHandlers,
});

console.log(`[multiplayer] listening on ws://0.0.0.0:${port}`);
if (!allowedOrigins.size) {
  console.log('[multiplayer] production browser origins are denied until MULTIPLAYER_ALLOWED_ORIGINS is configured');
}
