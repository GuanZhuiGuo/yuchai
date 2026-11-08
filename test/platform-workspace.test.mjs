import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createApplication, PROJECT_ID } from '../server.mjs';

const service = PROJECT_ID === 5 ? 'yuchai' : 'huali';
const key = service === 'yuchai' ? 'yuchai-learning-demo-v2' : 'huali-learning-center-v1';
const namespace = `${service}-workspace`;
const script = readFileSync(new URL('../public/platform-workspace.js', import.meta.url), 'utf8');
const empty = () => ({ revision: 0, value: null, updated_at: null });
const statePath = `/api/platform/user-state/${namespace}`;

function browser(user, state, backend) {
  let browserReads = 0;
  const calls = [];
  const sandbox = {
    TRAINING_PLATFORM: { enabled: true, user: { user_id: user, tenant_id: 'tenant' }, namespace, state: structuredClone(state) },
    document: { baseURI: 'https://portal.example/training/', getElementById() {}, addEventListener() {} },
    location: { origin: 'https://portal.example', host: 'portal.example' },
    fetch: async (input, options = {}) => { calls.push({ input, options }); return backend(input, options); },
    Headers, Request, URL, setTimeout() { return 1; }, clearTimeout() {}, addEventListener() {},
    WebSocket: class { constructor(url) { this.url = url; } },
    get localStorage() { browserReads++; throw Error('Legacy browser state must not be read'); },
  };
  vm.runInNewContext(script, sandbox);
  return { sandbox, store: sandbox.TrainingPersonalStorage, calls, browserReads: () => browserReads };
}

test('central personal persistence and identity headers cover two users, GETs and socket connections', async () => {
  const states = new Map();
  const backend = async (_url, options) => {
    if (!options.body) return Response.json({});
    const user = options.headers.get('X-Platform-Expected-User');
    const payload = JSON.parse(options.body), previous = states.get(user) || empty();
    assert.equal(payload.revision, previous.revision);
    const value = { revision: previous.revision + 1, value: payload.value, updated_at: new Date().toISOString() };
    states.set(user, value); return Response.json(value);
  };
  const a = browser('A', empty(), backend), b = browser('B', empty(), backend);
  a.store.setItem(key, '{"visited":{"c1":[0]}}'); await a.store.flush();
  assert.equal(b.store.getItem(key), null);
  assert.equal(browser('A', states.get('A'), backend).store.getItem(key), '{"visited":{"c1":[0]}}');
  assert.equal(a.browserReads() + b.browserReads(), 0);
  await a.sandbox.fetch(new Request('https://portal.example/training/api/history'));
  assert.equal(a.calls.at(-1).options.headers.get('X-Platform-Expected-User'), 'A');
  await a.sandbox.fetch('https://external.example/data');
  assert.equal(a.calls.at(-1).options.headers, undefined);
  assert.equal(new a.sandbox.WebSocket('wss://portal.example/training/api/voice/123').url,
    'wss://portal.example/training/api/voice/123?platform_expected_user=A');
});

test('CAS rebases independent changes and preserves unsaved state on account change or network failure', async () => {
  let requests = 0;
  const otherKey = 'huali-training-activity-v1';
  const page = browser('A', empty(), async (_url, options) => {
    if (!requests++) return Response.json({ error: { code: 'state_conflict' }, current: {
      revision: 1, value: { [otherKey]: '[{"id":"other-tab"}]' }, updated_at: new Date().toISOString() } }, { status: 409 });
    const payload = JSON.parse(options.body);
    assert.equal(payload.revision, 1); assert.equal(payload.value[otherKey], '[{"id":"other-tab"}]');
    return Response.json({ revision: 2, value: payload.value });
  });
  page.store.setItem(key, '{}'); await page.store.flush(); assert.equal(page.store.status(), 'saved');
  for (const backend of [async () => Response.json({ error: { code: 'account_changed', message: '账号已变化' } }, { status: 409 }), async () => { throw Error('offline'); }]) {
    const denied = browser('A', empty(), backend); denied.store.setItem(key, '{"pending":true}');
    await assert.rejects(denied.store.flush()); assert.equal(denied.store.status(), 'error');
    assert.equal(denied.store.getItem(key), '{"pending":true}'); assert.equal(denied.browserReads(), 0);
  }
});

test('same-key concurrent edits merge only with an explicit domain merger', async () => {
  const conflict = () => Response.json({ error: { code: 'state_conflict' }, current: { revision: 1, value: { [key]: '["remote"]' } } }, { status: 409 });
  const noMerge = browser('A', empty(), async () => conflict());
  noMerge.store.setItem(key, '["mine"]'); await assert.rejects(noMerge.store.flush());
  assert.equal(noMerge.store.status(), 'error');
  let calls = 0;
  const merged = browser('A', empty(), async (_url, options) => {
    if (!calls++) return conflict();
    const value = JSON.parse(options.body).value;
    assert.deepEqual(JSON.parse(value[key]), ['remote', 'mine']);
    return Response.json({ revision: 2, value });
  });
  merged.store.setMerger(key, (left, right) => JSON.stringify([...JSON.parse(left || '[]'), ...JSON.parse(right || '[]')]));
  merged.store.setItem(key, '["mine"]'); await merged.store.flush(); assert.equal(merged.store.status(), 'saved');
});

test('HTTP workspace identity, shell hydration, personal resources and restart retain actor boundaries', async t => {
  const context = new AsyncLocalStorage(), states = new Map(); let legacyCalls = 0;
  const platform = {
    async protect(req, res) { const uid = req.headers.cookie?.replace('fixture=', ''); if (!uid) { res.writeHead(401); res.end(); return false; }
      req.platformAuth = { user_id: uid, tenant_id: 'tenant', display_name: uid === 'A' ? '甲 <测试>' : '乙', is_guest: uid === 'B' }; return true; },
    async protectUpgrade(req) { return this.protect(req, { writeHead() {}, end() {} }); },
    withRequest(req, fn) { return context.run(req.platformAuth, fn); }, currentActor() { return context.getStore(); },
    async readUserState(ns) { assert.equal(ns, namespace); assert.ok(context.getStore()?.user_id); return states.get(context.getStore().user_id) || empty(); },
    injectWorkspaceShell(html) { return html.replace('</head>', '<script defer src="/workspace-shell.js" data-platform-workspace-script></script></head>'); },
    async handleWorkspaceRequest(req, res) {
      if (req.url !== statePath) return false;
      const uid = context.getStore().user_id, current = states.get(uid) || empty();
      if (req.method === 'GET') { res.end(JSON.stringify(current)); return true; }
      let body = ''; for await (const part of req) body += part;
      const update = JSON.parse(body);
      if (update.revision !== current.revision) { res.writeHead(409); res.end(JSON.stringify({ error: { code: 'state_conflict' }, current })); return true; }
      const result = { revision: current.revision + 1, value: update.value, updated_at: '2026-11-08T12:00:00Z' };
      states.set(uid, result); res.end(JSON.stringify(result)); return true;
    },
    async externalFetch(path) { assert.equal(path, 'resources?page=1&page_size=20'); return Response.json({ code: 0, data: { list: context.getStore().user_id === 'A'
      ? [{ external_id: '501', created_at: '2026-11-08T11:00:00Z', metadata: { name: '甲的练习', ended: true } }] : [] } }); },
  };
  async function open() { const app = createApplication({ platformAdapter: platform, upstreamFetch() { legacyCalls++; throw Error('legacy'); } });
    app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening'); return { app, origin: `http://127.0.0.1:${app.server.address().port}` }; }
  let running = await open(); t.after(() => running.app.close());
  const get = (path, user = 'A', expected = user) => fetch(running.origin + path, { headers: { Cookie: 'fixture=' + user, 'X-Platform-Expected-User': expected } });
  const htmlResponse = await get('/'); const html = await htmlResponse.text();
  assert.equal(htmlResponse.status, 200); assert.match(html, /data-platform-workspace-script/);
  assert.match(html, /甲 \\u003c测试>/); assert.match(html, /"identity_type":"feishu"/);
  assert.ok(html.indexOf('globalThis.TRAINING_PLATFORM=') < html.indexOf('src="./app.js"'));
  assert.match(htmlResponse.headers.get('content-security-policy'), /nonce-/);
  assert.equal(htmlResponse.headers.get('cache-control'), 'no-store, private');
  const save = await fetch(running.origin + statePath, { method: 'PUT', headers: { Cookie: 'fixture=A', 'X-Platform-Expected-User': 'A', 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: 0, value: { [key]: '{"visited":{"c1":[0]}}' } }) });
  assert.equal(save.status, 200);
  assert.equal((await get(statePath, 'B').then(r => r.json())).value, null);
  assert.equal((await get(statePath, 'B', 'A')).status, 409);
  const aResources = await get('/api/platform/resources').then(r => r.json());
  assert.deepEqual(aResources.resources.map(row => row.id), ['learning-state', 'exercise-501']);
  assert.deepEqual((await get('/api/platform/resources', 'B').then(r => r.json())).resources, []);
  await running.app.close(); running = await open();
  assert.equal((await get(statePath).then(r => r.json())).revision, 1);
  assert.match(await get('/', 'B').then(r => r.text()), /"identity_type":"guest"/);
  const status = await new Promise((resolve, reject) => { const ws = new WebSocket(running.origin.replace('http:', 'ws:') + '/api/voice/501?platform_expected_user=A', { headers: { Cookie: 'fixture=B', Origin: running.origin } });
    ws.once('unexpected-response', (_req, res) => { res.resume(); resolve(res.statusCode); }); ws.once('open', () => { ws.close(); reject(Error('Stale socket opened')); }); ws.once('error', reject); });
  assert.equal(status, 409); assert.equal(legacyCalls, 0);
});
