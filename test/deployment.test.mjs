import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createApplication, deploymentOrigin } from '../server.mjs';

function localRequest(port, { method = 'POST', path = '/api/exercises', origin, host, upgrade = false } = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ planId: 0, roleId: 47 });
    const req = request({
      hostname: '127.0.0.1', port, method: upgrade ? 'GET' : method, path,
      agent: false,
      headers: {
        Host: host ?? `127.0.0.1:${port}`,
        ...(origin === undefined ? {} : { Origin: origin }),
        ...(upgrade ? {
          Connection: 'Upgrade', Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        } : {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        }),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        } catch (error) { reject(error); }
      });
    });
    req.on('upgrade', (_res, socket) => {
      socket.destroy();
      reject(new Error('未知练习不应建立 WebSocket 连接'));
    });
    req.on('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error('本机验证请求超时')));
    req.end(upgrade ? undefined : body);
  });
}

test('PUBLIC_ORIGIN only accepts an HTTP(S) origin without path or credentials', () => {
  assert.equal(deploymentOrigin(), '');
  assert.equal(deploymentOrigin(''), '');
  assert.equal(deploymentOrigin('https://training.example.com'), 'https://training.example.com');
  assert.equal(deploymentOrigin('https://training.example.com/'), 'https://training.example.com');
  assert.equal(deploymentOrigin('http://training.example.com:8080'), 'http://training.example.com:8080');
  assert.equal(deploymentOrigin('https://training.example.com:443'), 'https://training.example.com');
  for (const invalid of [
    'https://training.example.com/yuchai',
    'https://training.example.com/?entry=yuchai',
    'https://training.example.com/#assessment',
    'https://user@training.example.com',
    'https://user:password@training.example.com',
    'ftp://training.example.com',
    'wss://training.example.com',
    'training.example.com',
  ]) {
    assert.throws(() => deploymentOrigin(invalid), undefined, invalid);
    assert.throws(() => createApplication({ publicOrigin: invalid, accessKey: '', secretKey: '' }), undefined, invalid);
  }
});

test('reverse proxy Origin access retains loopback Host and exact Origin checks', async (t) => {
  const publicOrigin = 'https://training.example.com';
  let upstreamCalls = 0;
  let websocketCalls = 0;
  const app = createApplication({
    publicOrigin, accessKey: '', secretKey: '',
    upstreamFetch: () => {
      upstreamCalls++;
      assert.fail('部署验证不得连接上游 API');
    },
    connectWebSocket: () => {
      websocketCalls++;
      assert.fail('部署验证不得连接上游 WebSocket');
    },
  });
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', resolve);
  });
  const port = app.server.address().port;
  t.after(async () => {
    await app.close();
    assert.equal(upstreamCalls, 0);
    assert.equal(websocketCalls, 0);
  });

  await t.test('configured public and matching local Origins reach business validation', async () => {
    for (const origin of [publicOrigin, `http://127.0.0.1:${port}`]) {
      const result = await localRequest(port, { origin });
      assert.equal(result.status, 400, origin);
      assert.equal(result.data.error.code, 'INVALID_PARAMETER', origin);
    }
    const result = await localRequest(port, { host: `localhost:${port}`, origin: `http://localhost:${port}` });
    assert.equal(result.status, 400);
    assert.equal(result.data.error.code, 'INVALID_PARAMETER');
  });

  await t.test('missing and non-exact Origins are rejected before business validation', async () => {
    for (const origin of [
      undefined,
      'https://other.example.com',
      'http://training.example.com',
      'https://training.example.com:8443',
      'https://training.example.com.evil.example',
      `${publicOrigin}/`,
      `http://127.0.0.1:${port + 1}`,
      'null',
    ]) {
      const result = await localRequest(port, { origin });
      assert.equal(result.status, 403, String(origin));
      assert.equal(result.data.error.code, 'ORIGIN_REJECTED', String(origin));
    }
  });

  await t.test('public Origin cannot bypass loopback Host restriction', async () => {
    for (const host of ['training.example.com', '127.0.0.1.evil.example', 'user@127.0.0.1']) {
      const result = await localRequest(port, { host, origin: publicOrigin });
      assert.equal(result.status, 403, host);
      assert.equal(result.data.error.code, 'LOCAL_HOST_REQUIRED', host);
    }
  });

  await t.test('allowed WebSocket Origins reach unknown-exercise validation without an upstream call', async () => {
    for (const origin of [publicOrigin, `http://127.0.0.1:${port}`]) {
      const result = await localRequest(port, { path: '/api/voice/999999', origin, upgrade: true });
      assert.equal(result.status, 403, origin);
      assert.match(result.data.error.message, /仅可操作本次服务启动后由本页创建的练习/, origin);
    }
  });

  await t.test('invalid WebSocket Origin or Host is refused before unknown-exercise validation', async () => {
    for (const options of [
      { origin: 'https://other.example.com' },
      { origin: `${publicOrigin}/` },
      { origin: undefined },
      { origin: publicOrigin, host: 'training.example.com' },
    ]) {
      const result = await localRequest(port, { path: '/api/voice/999999', upgrade: true, ...options });
      assert.equal(result.status, 403);
      assert.equal(result.data.error.message, '语音连接来源不被允许');
    }
  });
});

test('without PUBLIC_ORIGIN only an exact loopback Origin is accepted', async (t) => {
  let upstreamCalls = 0;
  const app = createApplication({
    publicOrigin: '', accessKey: '', secretKey: '',
    upstreamFetch: () => { upstreamCalls++; assert.fail('部署验证不得连接上游 API'); },
  });
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', resolve);
  });
  const port = app.server.address().port;
  t.after(async () => { await app.close(); assert.equal(upstreamCalls, 0); });
  const local = await localRequest(port, { origin: `http://127.0.0.1:${port}` });
  assert.equal(local.status, 400);
  assert.equal(local.data.error.code, 'INVALID_PARAMETER');
  const publicRequest = await localRequest(port, { origin: 'https://training.example.com' });
  assert.equal(publicRequest.status, 403);
  assert.equal(publicRequest.data.error.code, 'ORIGIN_REJECTED');
});

test('the server stays running when started through a current release symlink', { timeout: 8000 }, async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'yuchai-deployment-'));
  const current = join(temporaryRoot, 'current');
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  let child;
  try {
    await symlink(projectRoot, current, 'dir');
    const portReservation = createServer();
    await new Promise((done, reject) => {
      portReservation.once('error', reject);
      portReservation.listen(0, '127.0.0.1', done);
    });
    const port = portReservation.address().port;
    await new Promise((done) => portReservation.close(done));
    child = spawn(process.execPath, [join(current, 'server.mjs')], {
      cwd: current,
      env: {
        ...process.env,
        PORT: String(port),
        PUBLIC_ORIGIN: '',
        SPARRING_OPENAPI_ACCESS_KEY: '',
        SPARRING_OPENAPI_SECRET_KEY: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((done, reject) => {
      let output = '';
      const timer = setTimeout(() => finish(new Error('符号链接启动未在期限内监听服务')), 4000);
      const onData = (chunk) => {
        output += chunk.toString();
        if (output.includes(`http://127.0.0.1:${port}`)) finish();
      };
      const onError = (error) => finish(error);
      const onExit = (code, signal) => finish(new Error(`符号链接启动后提前退出：${code ?? signal}`));
      function finish(error) {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        child.off('error', onError);
        child.off('exit', onExit);
        if (error) reject(error); else done();
      }
      child.stdout.on('data', onData);
      child.once('error', onError);
      child.once('exit', onExit);
    });
    const health = await localRequest(port, { method: 'GET', path: '/api/health' });
    assert.equal(health.status, 200);
    assert.deepEqual(health.data, { mode: 'unconfigured', projectId: 5, userId: 1 });
    await new Promise((done) => setTimeout(done, 50));
    assert.equal(child.exitCode, null, '处理 health 请求后进程应保持运行');
    assert.equal(child.signalCode, null);
  } finally {
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((done) => child.once('exit', done));
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      await exited;
      clearTimeout(timer);
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
