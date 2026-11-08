/* Server-hydrated state belongs to one verified account. Never import browser demo data. */
(() => {
  const config = globalThis.TRAINING_PLATFORM;
  if (!config?.enabled) return;
  if (!config.user?.user_id || !config.user?.tenant_id || !config.state) throw Error('个人学习状态未加载');
  const allowed = key => /^(?:yuchai-learning-demo-v2|huali-learning-center-v1|huali-training-(?:activity|content)-v1)$/.test(key);
  const clean = value => Object.fromEntries(Object.entries(value && typeof value === 'object' ? value : {}).filter(([key, item]) => allowed(key) && typeof item === 'string'));
  const endpoint = new URL(`./api/platform/user-state/${config.namespace}`, document.baseURI);
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init = {}) => {
    const request = typeof Request !== 'undefined' && input instanceof Request;
    const url = new URL(request ? input.url : input, document.baseURI);
    if (url.origin === location.origin) {
      const headers = new Headers(init.headers || (request ? input.headers : undefined));
      headers.set('X-Platform-Expected-User', config.user.user_id);
      init = { ...init, headers };
    }
    return nativeFetch(input, init);
  };
  const OriginalSocket = globalThis.WebSocket;
  if (OriginalSocket) globalThis.WebSocket = class extends OriginalSocket {
    constructor(value, ...args) {
      const url = new URL(value, document.baseURI);
      if (url.host === location.host) url.searchParams.set('platform_expected_user', config.user.user_id);
      super(url.href, ...args);
    }
  };
  let revision = config.state.revision, values = clean(config.state.value), confirmed = clean(config.state.value);
  const pending = new Map(), mergers = new Map();
  let running, timer, status = 'saved';
  function notify(value) {
    status = value;
    const element = document.getElementById('training-state-status');
    if (element) { element.hidden = value === 'saved'; element.textContent = value === 'saving' ? '个人状态保存中…' : '个人状态尚未保存，点击重试'; }
  }
  async function save() {
    notify('saving');
    let conflicts = 0;
    while (pending.size) {
      const batch = new Map(pending), sent = { ...values };
      const response = await fetch(endpoint, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision, value: sent }) });
      const payload = await response.json();
      if (response.status === 409 && payload.error?.code === 'state_conflict' && payload.current && conflicts++ < 3) {
        const remote = clean(payload.current.value), rebased = { ...remote };
        for (const [key, value] of pending) {
          const merge = mergers.get(key);
          if (remote[key] !== confirmed[key] && value !== remote[key] && !merge) throw Error('另一页面已修改相同内容，请保留当前内容后刷新核对。');
          rebased[key] = merge ? merge(remote[key], value) : value;
        }
        revision = payload.current.revision; confirmed = remote; values = rebased;
        for (const key of pending.keys()) pending.set(key, values[key]);
        continue;
      }
      if (!response.ok || !Number.isInteger(payload.revision)) throw Error(payload.error?.message || '个人状态保存失败');
      revision = payload.revision; confirmed = clean(payload.value ?? sent);
      for (const [key, value] of batch) if (pending.get(key) === value) pending.delete(key);
      values = { ...confirmed, ...Object.fromEntries(pending) };
    }
    notify('saved');
  }
  function flush() {
    clearTimeout(timer);
    if (running) return running;
    if (!pending.size) return Promise.resolve();
    return running = save().catch(error => { notify('error'); throw error; }).finally(() => { running = null; });
  }
  globalThis.TrainingPersonalStorage = Object.freeze({
    getItem(key) { return Object.hasOwn(values, key) ? values[key] : null; },
    setItem(key, value) {
      if (!allowed(key)) throw Error('个人状态字段不被允许');
      value = String(value); if (values[key] === value) return;
      values[key] = value; pending.set(key, value); notify('saving');
      clearTimeout(timer); timer = setTimeout(() => flush().catch(() => {}), 200);
    },
    setMerger(key, merge) { mergers.set(key, merge); }, flush, status: () => status,
  });
  globalThis.addEventListener('beforeunload', event => { if (pending.size) { event.preventDefault(); event.returnValue = ''; } });
  globalThis.addEventListener('online', () => flush().catch(() => {}));
  document.addEventListener('DOMContentLoaded', () => {
    globalThis.PlatformWorkspace?.onBeforeNavigate(flush);
    const button = document.createElement('button'); button.id = 'training-state-status'; button.type = 'button'; button.hidden = true;
    button.setAttribute('role', 'status'); button.onclick = () => flush().catch(() => {}); document.body.append(button); notify(status);
  });
})();
