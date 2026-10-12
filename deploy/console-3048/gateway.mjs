import { Agent, createServer, request, STATUS_CODES } from 'node:http';
import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
]);
const FORWARD_HEADERS = new Set([
  'forwarded', 'via', 'x-real-ip', 'client-ip', 'true-client-ip', 'x-client-ip',
  'x-original-host', 'x-original-proto', 'x-original-url', 'x-original-uri', 'x-rewrite-url',
]);

function portNumber(value, name) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${name} must be an integer from 1 to 65535`);
  return port;
}

function cleanHeaders(headers, stripForwarding = false) {
  const connectionTokens = new Set(String(headers.connection ?? '').toLowerCase().split(',').map((value) => value.trim()));
  return Object.fromEntries(Object.entries(headers).filter(([name]) =>
    !HOP_HEADERS.has(name) && !connectionTokens.has(name) &&
    !(stripForwarding && (FORWARD_HEADERS.has(name) || name.startsWith('x-forwarded-')))));
}

function rawHeaders(status, headers) {
  const lines = [`HTTP/1.1 ${status} ${STATUS_CODES[status] ?? 'Response'}`];
  for (const [name, value] of Object.entries(headers)) {
    for (const entry of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${entry}`);
  }
  return `${lines.join('\r\n')}\r\n\r\n`;
}

function rejectSocket(socket, status = 502) {
  if (socket.destroyed) return;
  const body = `${STATUS_CODES[status]}\n`;
  socket.end(rawHeaders(status, {
    'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(body),
    connection: 'close',
  }) + body);
}

export function createGateway({ upstreamPort = 3049, upstreamTimeoutMs = 30000 } = {}) {
  const targetPort = portNumber(upstreamPort, 'UPSTREAM_PORT');
  if (!Number.isInteger(upstreamTimeoutMs) || upstreamTimeoutMs < 1) throw new Error('upstreamTimeoutMs must be a positive integer');
  const agent = new Agent({ keepAlive: true });
  const sockets = new Set();
  const outboundSockets = new Set();
  let closing = false;
  let closePromise;
  let notifyDrained = () => {};

  function boundRequest(upstream) {
    // Applies to HTTP inactivity and the Upgrade handshake, never the established WebSocket.
    upstream.setTimeout(upstreamTimeoutMs, () => upstream.destroy());
    const timer = setTimeout(() => upstream.destroy(), upstreamTimeoutMs);
    const clear = () => clearTimeout(timer);
    for (const event of ['response', 'upgrade', 'error', 'close']) upstream.once(event, clear);
    return upstream;
  }

  function requestOptions(req, upgrade = false) {
    const headers = cleanHeaders(req.headers, true);
    // Origin stays exactly as supplied so the application remains the authority.
    if (req.headers.origin !== undefined) headers.origin = req.headers.origin;
    headers.host = `127.0.0.1:${targetPort}`;
    if (upgrade) {
      headers.connection = 'Upgrade';
      headers.upgrade = 'websocket';
    }
    return {
      hostname: '127.0.0.1', port: targetPort, method: req.method,
      path: req.url, headers, agent: upgrade ? false : agent,
    };
  }

  const server = createServer((req, res) => {
    if (closing || !req.url?.startsWith('/')) {
      res.writeHead(closing ? 503 : 400, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
      res.end(closing ? 'Service Unavailable\n' : 'Bad Request\n');
      return;
    }
    const upstream = boundRequest(request(requestOptions(req), (reply) => {
      res.writeHead(reply.statusCode, cleanHeaders(reply.headers));
      reply.on('error', () => res.destroy());
      reply.pipe(res);
    }));
    upstream.once('upgrade', (_reply, peer) => { peer.destroy(); res.destroy(); });
    upstream.on('error', () => {
      if (res.destroyed) return;
      if (res.headersSent) return res.destroy();
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
      res.end('Bad Gateway\n');
    });
    req.on('aborted', () => upstream.destroy());
    req.on('error', () => upstream.destroy());
    res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
    req.pipe(upstream);
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => { sockets.delete(socket); notifyDrained(); });
  });
  server.on('connect', (_req, socket) => rejectSocket(socket, 405));
  server.on('upgrade', (req, socket, head) => {
    if (closing || req.method !== 'GET' || !req.url?.startsWith('/') || req.headers.upgrade?.toLowerCase() !== 'websocket') {
      rejectSocket(socket, closing ? 503 : 400);
      return;
    }
    const upstream = boundRequest(request(requestOptions(req, true)));
    let upgraded = false;
    socket.once('close', () => { if (!upgraded) upstream.destroy(); });
    upstream.on('error', () => { if (!upgraded) rejectSocket(socket); });
    upstream.once('response', (reply) => {
      const headers = { ...cleanHeaders(reply.headers), connection: 'close' };
      socket.write(rawHeaders(reply.statusCode, headers));
      reply.on('error', () => socket.destroy());
      reply.pipe(socket);
    });
    upstream.once('upgrade', (reply, peer, peerHead) => {
      if (socket.destroyed || closing || reply.statusCode !== 101 || reply.headers.upgrade?.toLowerCase() !== 'websocket') {
        peer.destroy();
        rejectSocket(socket);
        return;
      }
      upgraded = true;
      peer.setTimeout(0);
      outboundSockets.add(peer);
      peer.once('close', () => { outboundSockets.delete(peer); socket.destroy(); notifyDrained(); });
      socket.once('close', () => peer.destroy());
      peer.on('error', () => socket.destroy());
      const headers = { ...cleanHeaders(reply.headers), connection: 'Upgrade', upgrade: 'websocket' };
      socket.write(rawHeaders(101, headers));
      if (peerHead.length) socket.write(peerHead);
      if (head.length) peer.write(head);
      peer.pipe(socket);
      socket.pipe(peer);
    });
    upstream.end();
  });

  function close({ graceMs = 5000 } = {}) {
    if (closePromise) return closePromise;
    closing = true;
    closePromise = (async () => {
      const drained = new Promise((resolve) => {
        notifyDrained = () => { if (!sockets.size && !outboundSockets.size) resolve(); };
        notifyDrained();
      });
      const stopped = new Promise((resolve) => server.close(resolve));
      server.closeIdleConnections();
      const timer = setTimeout(() => {
        for (const socket of [...sockets, ...outboundSockets]) socket.destroy();
        agent.destroy();
      }, graceMs);
      await Promise.all([stopped, drained]);
      clearTimeout(timer);
      agent.destroy();
    })();
    return closePromise;
  }
  return { server, close };
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  const port = portNumber(process.env.PORT ?? 3048, 'PORT');
  const upstreamPort = portNumber(process.env.UPSTREAM_PORT ?? 3049, 'UPSTREAM_PORT');
  if (port === upstreamPort) throw new Error('PORT and UPSTREAM_PORT must differ');
  const gateway = createGateway({ upstreamPort });
  gateway.server.on('error', () => {
    console.error('Gateway failed to listen');
    process.exitCode = 1;
  });
  gateway.server.listen(port, '0.0.0.0', () => console.log(`Gateway listening on port ${port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { gateway.close().catch(() => { process.exitCode = 1; }); });
}
