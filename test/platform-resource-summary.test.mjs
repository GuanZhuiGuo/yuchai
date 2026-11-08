import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrainingWorkspace } from '../training-platform.mjs';

const dateAt = seconds => new Date(Date.UTC(2026, 10, 8, 12, 0, seconds)).toISOString();
async function catalog(serviceId, { state = {}, list = [] } = {}) {
  return createTrainingWorkspace({
    async readUserState(namespace) {
      assert.equal(namespace, serviceId + '-workspace');
      return { revision: 0, value: null, ...state };
    },
    async externalFetch(path, options) {
      assert.equal(path, 'resources?page=1&page_size=20');
      assert.equal(options.method, 'GET');
      return Response.json({ data: { list } });
    },
  }, serviceId).resources();
}

for (const serviceId of ['yuchai', 'huali']) {
  test(serviceId + ' resource titles remove control characters, fall back when blank, and preserve Unicode at 500 characters', async () => {
    const result = await catalog(serviceId, {
      state: { value: {
        'huali-training-content-v1': JSON.stringify([
          { id: 'draft-clean', title: '\0课程\t草稿\x7f', createdAt: dateAt(1) },
          { id: 'draft-empty', title: ' \n\t\x7f ', createdAt: dateAt(2) },
        ]),
        'huali-training-activity-v1': JSON.stringify([
          { id: 'activity-empty', title: '\r\n ', createdAt: dateAt(3), type: 'exam' },
        ]),
      } },
      list: [
        { external_id: '1', updated_at: dateAt(4), metadata: { name: '\0实战\n记录\x7f' } },
        { external_id: '2', updated_at: dateAt(5), metadata: { name: ' \t\n ' } },
        { external_id: '3', updated_at: dateAt(6), metadata: { name: '😀'.repeat(501) } },
        { external_id: '4', updated_at: dateAt(7), metadata: { planName: '课程名称' } },
      ],
    });
    const byId = new Map(result.resources.map(row => [row.id, row]));
    assert.equal(byId.get('exercise-1').title, '实战 记录');
    assert.equal(byId.get('exercise-2').title, '个人实战练习');
    assert.equal(byId.get('exercise-3').title, '😀'.repeat(500));
    assert.equal(byId.get('exercise-4').title, '课程名称');
    if (serviceId === 'huali') {
      assert.equal(byId.get('draft-clean').title, '课程 草稿');
      assert.equal(byId.get('draft-empty').title, '个人课程草稿');
      assert.equal(byId.get('activity-empty').title, '个人练习记录');
    }
    for (const row of result.resources) {
      assert.ok(row.title.trim());
      assert.ok(Array.from(row.title).length <= 500);
      assert.doesNotMatch(row.title, /[\x00-\x1f\x7f]/);
    }
  });

  test(serviceId + ' resource summaries retain the newest 100 across sources even when upstream ignores page size', async () => {
    const drafts = Array.from({ length: 40 }, (_, i) => ({ id: 'draft-' + i, title: '课程', createdAt: dateAt(i * 3) }));
    const activities = Array.from({ length: 40 }, (_, i) => ({ id: 'activity-' + i, title: '练习', createdAt: dateAt(i * 3 + 1) }));
    const list = Array.from({ length: 120 }, (_, i) => ({ external_id: String(i + 1), updated_at: dateAt(i * 3 + 2), metadata: {} }));
    const result = await catalog(serviceId, {
      state: { revision: 1, updated_at: dateAt(0), value: {
        'huali-training-content-v1': JSON.stringify(drafts),
        'huali-training-activity-v1': JSON.stringify(activities),
      } },
      list,
    });
    assert.equal(result.scope, 'current_user');
    assert.equal(result.resources.length, 100);
    assert.equal(result.resources[0].id, 'exercise-120');
    assert.ok(!result.resources.some(row => row.id === 'exercise-1' || row.id === 'learning-state'));
    if (serviceId === 'huali') {
      assert.ok(result.resources.some(row => row.id === 'draft-39'));
      assert.ok(result.resources.some(row => row.id === 'activity-39'));
    }
    for (let i = 1; i < result.resources.length; i++) {
      assert.ok(result.resources[i - 1].updated_at >= result.resources[i].updated_at);
    }
  });

  test(serviceId + ' skips malformed records and invalid dates without emitting invalid summary tokens or timestamps', async () => {
    const result = await catalog(serviceId, {
      state: { revision: 1, updated_at: 'invalid-date', value: {
        'huali-training-content-v1': JSON.stringify([
          null, { id: 123, createdAt: dateAt(0) }, { id: 'invalid date', createdAt: dateAt(0) },
          { id: 'bad-date', createdAt: 'invalid' }, { id: 'valid-draft', createdAt: dateAt(0) },
        ]),
        'huali-training-activity-v1': JSON.stringify([
          null, { id: 'bad-year', createdAt: '+010000-01-01T00:00:00Z' },
        ]),
      } },
      list: [
        null, { external_id: 'bad/id', updated_at: dateAt(0) },
        { external_id: '1', updated_at: 'invalid' },
        { external_id: '2', updated_at: '+010000-01-01T00:00:00Z' },
        { external_id: '3', updated_at: '0000-01-01T00:00:00Z' },
        { external_id: '4', updated_at: '2026-11-08T20:01:00+08:00', metadata: {} },
      ],
    });
    assert.deepEqual(result.resources.map(row => row.id), serviceId === 'huali' ? ['exercise-4', 'valid-draft'] : ['exercise-4']);
    for (const row of result.resources) {
      for (const key of ['id', 'type', 'status']) assert.match(row[key], /^[A-Za-z0-9_.:-]{1,128}$/);
      assert.match(row.updated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
    assert.equal(result.resources[0].updated_at, '2026-11-08T12:01:00.000Z');
  });
}
