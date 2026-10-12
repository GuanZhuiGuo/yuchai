import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createGateway } from '../deploy/console-3048/gateway.mjs';
import { createApplication } from '../server.mjs';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

function get(port, { path = '/', method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('Test request timeout')));
    req.end(body);
  });
}

async function fixture(t, handler, options = {}) {
  const upstream = createServer(handler);
  const peers = new Set();
  upstream.on('connection', (peer) => { peers.add(peer); peer.once('close', () => peers.delete(peer)); });
  const upstreamPort = await listen(upstream);
  const gateway = createGateway({ upstreamPort, ...options });
  const port = await listen(gateway.server);
  t.after(async () => {
    await gateway.close({ graceMs: 30 });
    for (const peer of peers) peer.destroy();
    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
  });
  return { port, upstreamPort, upstream, gateway };
}

test('gateway forwards Range, request bodies and exact Origin, removing client proxy headers', async (t) => {
  let seen;
  const { port, upstreamPort } = await fixture(t, (req, res) => {
    seen = req.headers;
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      res.writeHead(206, { 'Content-Range': 'bytes 2-4/6', 'Accept-Ranges': 'bytes', 'Content-Type': 'video/mp4' });
      res.end(Buffer.concat(chunks));
    });
  });
  const result = await get(port, {
    method: 'POST', path: '/video.mp4', body: 'cde',
    headers: {
      Host: 'public.example:3048', Origin: 'http://public.example:3048', Range: 'bytes=2-4',
      Connection: 'close, x-secret-hop, origin', 'X-Secret-Hop': 'ignore',
      Forwarded: 'host=trusted.example', 'X-Forwarded-Host': 'trusted.example',
      'X-Forwarded-For': '127.0.0.1', 'X-Forwarded-Proto': 'https',
      'X-Real-IP': '127.0.0.1', Via: 'forged', 'Proxy-Authorization': 'invalid',
    },
  });
  assert.equal(result.status, 206);
  assert.equal(result.body, 'cde');
  assert.equal(result.headers['content-range'], 'bytes 2-4/6');
  assert.equal(result.headers['accept-ranges'], 'bytes');
  assert.equal(seen.host, `127.0.0.1:${upstreamPort}`);
  assert.equal(seen.origin, 'http://public.example:3048');
  assert.equal(seen.range, 'bytes=2-4');
  for (const name of ['forwarded', 'x-forwarded-host', 'x-forwarded-for', 'x-forwarded-proto', 'x-real-ip', 'via', 'proxy-authorization', 'x-secret-hop']) assert.equal(seen[name], undefined, name);
});

test('gateway delivers streamed response chunks before the upstream response ends', async (t) => {
  let finish;
  const finished = new Promise((resolve) => { finish = resolve; });
  const { port } = await fixture(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('first\n');
    finished.then(() => res.end('last\n'));
  });
  await new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, agent: false }, (res) => {
      const chunks = [];
      res.once('data', (chunk) => {
        assert.equal(chunk.toString(), 'first\n');
        finish();
      });
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => { assert.equal(Buffer.concat(chunks).toString(), 'first\nlast\n'); resolve(); });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('Buffered response')));
    req.end();
  });
});

test('WebSocket Upgrade preserves handshake and both directions including upgrade head bytes', async (t) => {
  const { port, upstreamPort, upstream } = await fixture(t, (_req, res) => res.end());
  let seen;
  upstream.on('upgrade', (req, peer, head) => {
    seen = req.headers;
    peer.on('error', () => {});
    peer.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: test-accept\r\n\r\nHELLO');
    if (head.length) peer.write(head);
    peer.on('data', (chunk) => peer.write(chunk));
  });
  await new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    let received = '';
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('Upgrade timeout')); }, 3000);
    socket.on('error', reject);
    socket.on('connect', () => socket.write(
      'GET /api/voice/1 HTTP/1.1\r\nHost: public.example:3048\r\nOrigin: http://public.example:3048\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: test-key\r\nSec-WebSocket-Version: 13\r\nX-Forwarded-Host: forged\r\n\r\nEARLY'));
    socket.on('data', (chunk) => {
      received += chunk.toString();
      if (received.includes('HELLOEARLY')) {
        assert.match(received, /^HTTP\/1\.1 101 Switching Protocols\r\n/);
        assert.match(received, /sec-websocket-accept: test-accept\r\n/i);
        socket.removeAllListeners('data');
        socket.on('data', (echo) => {
          assert.equal(echo.toString(), 'LATER');
          clearTimeout(timer);
          socket.destroy();
          resolve();
        });
        socket.write('LATER');
      }
    });
  });
  assert.equal(seen.host, `127.0.0.1:${upstreamPort}`);
  assert.equal(seen.origin, 'http://public.example:3048');
  assert.equal(seen['x-forwarded-host'], undefined);
});

test('unavailable upstream gives a generic 502 for HTTP and WebSocket', async (t) => {
  const unused = createServer();
  const upstreamPort = await listen(unused);
  await new Promise((resolve) => unused.close(resolve));
  const gateway = createGateway({ upstreamPort });
  const port = await listen(gateway.server);
  t.after(() => gateway.close({ graceMs: 30 }));
  const normal = await get(port);
  const upgrade = await get(port, { headers: { Connection: 'Upgrade', Upgrade: 'websocket' } });
  for (const result of [normal, upgrade]) {
    assert.equal(result.status, 502);
    assert.equal(result.body, 'Bad Gateway\n');
    assert.doesNotMatch(result.body, /ECONN|127\.0\.0\.1|3049/);
  }
});

test('application keeps exact Origin protection behind the gateway for HTTP and WebSocket', async (t) => {
  const publicOrigin = 'http://public.example:3048';
  const app = createApplication({ publicOrigin, accessKey: '', secretKey: '', upstreamFetch: () => assert.fail('No external API permitted') });
  const upstreamPort = await listen(app.server);
  const gateway = createGateway({ upstreamPort });
  const port = await listen(gateway.server);
  t.after(async () => { await gateway.close({ graceMs: 30 }); await app.close(); });
  for (const origin of [publicOrigin, 'http://evil.example:3048', 'null', undefined]) {
    const expected = origin === publicOrigin ? 400 : 403;
    const headers = { Host: 'public.example:3048', 'Content-Type': 'application/json', 'X-Forwarded-Host': '127.0.0.1' };
    if (origin !== undefined) headers.Origin = origin;
    const result = await get(port, { method: 'POST', path: '/api/exercises', headers, body: JSON.stringify({ planId: 0, roleId: 47 }) });
    assert.equal(result.status, expected, String(origin));
    const data = JSON.parse(result.body);
    assert.equal(data.error.code, origin === publicOrigin ? 'INVALID_PARAMETER' : 'ORIGIN_REJECTED');
    const ws = await get(port, { path: '/api/voice/999999', headers: { ...headers, Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' } });
    assert.equal(ws.status, 403);
    if (origin === publicOrigin) assert.match(JSON.parse(ws.body).error.message, /仅可操作/);
    else assert.equal(JSON.parse(ws.body).error.message, '语音连接来源不被允许');
  }
});

test('upstream response timeout is bounded and returns 502', async (t) => {
  const { port } = await fixture(t, () => {}, { upstreamTimeoutMs: 30 });
  const result = await get(port);
  assert.equal(result.status, 502);
  assert.equal(result.body, 'Bad Gateway\n');
});

test('CLI refuses invalid ports and a self-proxy loop before binding', () => {
  const file = new URL('../deploy/console-3048/gateway.mjs', import.meta.url);
  for (const [port, upstreamPort, error] of [
    ['3048', '3048', /must differ/], ['0', '3049', /PORT must be/],
    ['3048', '65536', /UPSTREAM_PORT must be/], ['abc', '3049', /PORT must be/],
  ]) {
    const child = spawnSync(process.execPath, [fileURLToPath(file)], { env: { ...process.env, PORT: port, UPSTREAM_PORT: upstreamPort }, encoding: 'utf8', timeout: 3000 });
    assert.equal(child.status, 1);
    assert.match(child.stderr, error);
  }
});

test('CLI starts through a release symlink and shuts down on SIGTERM', { timeout: 5000 }, async (t) => {
  const { upstreamPort } = await fixture(t, (_req, res) => res.end('ready'));
  const temporary = await mkdtemp(join(tmpdir(), 'console-gateway-'));
  const entry = join(temporary, 'gateway.mjs');
  await symlink(fileURLToPath(new URL('../deploy/console-3048/gateway.mjs', import.meta.url)), entry);
  const reservation = createServer();
  const port = await listen(reservation);
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, PORT: String(port), UPSTREAM_PORT: String(upstreamPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  t.after(async () => { if (child.exitCode === null) child.kill('SIGKILL'); await rm(temporary, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => { if (chunk.toString().includes('Gateway listening')) resolve(); });
    child.once('error', reject);
    child.once('exit', () => reject(new Error('Gateway exited before listening')));
  });
  assert.equal((await get(port)).body, 'ready');
  child.kill('SIGTERM');
  assert.deepEqual(await exited, { code: 0, signal: null });
});

test('gateway shutdown closes an upgraded connection within its grace period', async (t) => {
  const { port, upstream, gateway } = await fixture(t, (_req, res) => res.end());
  upstream.on('upgrade', (_req, peer) => {
    peer.on('error', () => {});
    peer.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
  });
  const socket = connect(port, '127.0.0.1');
  socket.on('error', () => {});
  await new Promise((resolve) => {
    socket.on('connect', () => socket.write('GET /ws HTTP/1.1\r\nHost: public.example\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'));
    socket.once('data', resolve);
  });
  const closed = new Promise((resolve) => socket.once('close', resolve));
  await gateway.close({ graceMs: 30 });
  await closed;
});
