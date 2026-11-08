const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
const timestamp = value => { const date = new Date(value); return value && Number.isFinite(date.getTime()) ? date.toISOString() : null; };

export function createTrainingWorkspace(platform, serviceId) {
  const namespace = `${serviceId}-workspace`;
  function assertExpectedUser(req) {
    const expected = req.headers?.['x-platform-expected-user'] || new URL(req.url || '/', 'http://localhost').searchParams.get('platform_expected_user');
    if (expected && expected !== req.platformAuth?.user_id) {
      throw Object.assign(new Error('登录账号已变化，请刷新页面后继续。'), { status: 409, code: 'account_changed' });
    }
  }
  async function html(source, nonce) {
    const user = platform.currentActor();
    if (!user?.user_id || !user?.tenant_id) throw Error('Verified platform identity required');
    const state = await platform.readUserState(namespace);
    const config = { enabled: true, service_id: serviceId, namespace,
      user: { user_id: user.user_id, tenant_id: user.tenant_id, display_name: user.display_name || user.username || '工作台成员',
        is_guest: user.is_guest === true, identity_type: user.is_guest ? 'guest' : 'feishu' }, state };
    const bootstrap = `<script nonce="${nonce}">globalThis.TRAINING_PLATFORM=${json(config)};</script><script src="./platform-workspace.js"></script><link rel="stylesheet" href="./platform-workspace.css">`;
    return platform.injectWorkspaceShell(source.replace('</head>', bootstrap + '</head>').replaceAll('重置本地学习进度', '重置个人学习进度'));
  }
  async function resources() {
    const state = await platform.readUserState(namespace);
    const values = object(state.value);
    const resources = [];
    if (state.revision > 0 && state.updated_at) resources.push({ id: 'learning-state', type: 'workspace_state', title: '个人学习工作空间',
      updated_at: timestamp(state.updated_at), status: 'saved', path: '/#me' });
    if (serviceId === 'huali') {
      const parse = key => { try { const value = JSON.parse(values[key] || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } };
      for (const record of parse('huali-training-content-v1').slice(0, 30)) {
        if (!/^[a-zA-Z0-9_.:-]{1,100}$/.test(record.id || '') || !timestamp(record.createdAt)) continue;
        resources.push({ id: record.id, type: 'course_draft', title: String(record.title || '个人课程草稿').slice(0, 500),
          updated_at: timestamp(record.createdAt), status: ['draft', 'published', 'superseded'].includes(record.status) ? record.status : 'draft', path: `/#builder/${encodeURIComponent(record.id)}` });
      }
      for (const record of parse('huali-training-activity-v1').slice(0, 30)) {
        if (!/^[a-zA-Z0-9_.:-]{1,100}$/.test(record.id || '') || !timestamp(record.createdAt)) continue;
        resources.push({ id: record.id, type: record.type === 'exam' ? 'knowledge_exam' : 'practice', title: String(record.title || '个人练习记录').slice(0, 500),
          updated_at: timestamp(record.createdAt), status: 'completed', path: `/#${record.type === 'exam' ? 'exam-result' : 'local-report'}/${encodeURIComponent(record.id)}` });
      }
    }
    const response = await platform.externalFetch('resources?page=1&page_size=20', { method: 'GET' });
    const payload = await response.json();
    if (!response.ok || !Array.isArray(payload?.data?.list)) throw Error('Personal exercise catalog unavailable');
    for (const record of payload.data.list) {
      if (!/^[1-9][0-9]{0,17}$/.test(String(record.external_id || ''))) continue;
      const meta = object(record.metadata), updated = timestamp(record.updated_at || record.created_at);
      if (!updated) continue;
      resources.push({ id: `exercise-${record.external_id}`, type: 'exercise', title: String(meta.name || meta.planName || '个人实战练习').slice(0, 500),
        updated_at: updated, status: meta.ended ? 'finished' : 'recorded', path: `/#report/live/${record.external_id}` });
    }
    return { resources, scope: 'current_user' };
  }
  return { html, resources, assertExpectedUser };
}
