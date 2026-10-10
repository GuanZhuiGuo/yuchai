import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createApplication, publicReportDetail } from '../server.mjs';
import { normalizeReportDetail, radarAxes } from '../public/report-model.js';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/reports/${name}`, import.meta.url), 'utf8'));
const fixtureNames = ['voice-e2e-report.json', 'ui-text-e2e-report-266.json', 'text-e2e-plan47-report.json'];

test('public reports keep the real feedback model and envelope without mutating upstream data', () => {
  for (const name of fixtureNames) {
    const raw = fixture(name);
    const before = structuredClone(raw);
    const publicReport = publicReportDetail(raw);
    assert.deepEqual(normalizeReportDetail(publicReport), normalizeReportDetail(raw), name);
    assert.deepEqual(raw, before, name);
    for (const key of ['report_version', 'status', 'dialogue_round_count', 'average_score', 'score_rank_percent']) {
      assert.deepEqual(publicReport[key], raw[key], `${name}: ${key}`);
    }
    assert.equal(Object.hasOwn(publicReport.report_detail, 'scenes'), false, name);
    assert.equal(Object.hasOwn(publicReport.report_detail, 'compliance_result'), false, name);
  }
});

test('hidden configuration and future fields cannot pass through at any report layer', () => {
  const raw = fixture('voice-e2e-report.json');
  const marker = 'PRIVATE_SCORING_BENCHMARK_MARKER';
  const hidden = { prompt: marker, eval_rule: marker, eval_benchmark: marker };
  raw.internal = hidden;
  raw.average_score = hidden;
  raw.report_detail.internal = hidden;
  raw.report_detail.scenes.push({ sceneDescription: marker, topics: [hidden] });
  const dimension = raw.report_detail.evaluation_rule[0];
  dimension.prompt = marker;
  dimension.scoring = hidden;
  const scene = dimension.related_scene[0];
  scene.sceneDescription = marker;
  scene.hidden = hidden;
  const topic = scene.topics[0];
  topic.description = marker;
  topic.eval_rule = marker;
  topic.eval_benchmark = marker;
  topic.eval_score = 999;
  topic.related_text[0].scoring = hidden;
  raw.report_detail.turn_evaluations[0].prompt = marker;
  const publicReport = publicReportDetail(raw);
  assert.equal(JSON.stringify(publicReport).includes(marker), false);
  assert.equal(Object.hasOwn(publicReport, 'average_score'), false);
  assert.equal(Object.hasOwn(publicReport.report_detail, 'scenes'), false);
  const visibleTopic = publicReport.report_detail.evaluation_rule[0].related_scene[0].topics[0];
  assert.equal(Object.hasOwn(visibleTopic, 'eval_score'), false);
  assert.deepEqual(normalizeReportDetail(publicReport), normalizeReportDetail(raw));
});

test('zero scores, a missing denominator, count flags and exact references retain their meaning', () => {
  const raw = fixture('text-e2e-plan47-report.json');
  raw.report_detail.final_score = 0;
  raw.report_detail.evaluation_rule[0].eval_score = 0;
  raw.report_detail.evaluation_rule[0].eval_total_score = 0;
  raw.report_detail.evaluation_rule[0].eval_reason = '尚未给出可验证的推进动作。';
  raw.report_detail.evaluation_rule[0].eval_suggestion = '下一次明确负责人、日期和材料。';
  const publicReport = publicReportDetail(raw);
  const model = normalizeReportDetail(publicReport);
  assert.equal(model.totalScore, 0);
  assert.equal(model.dimensions[0].score, 0);
  assert.equal(model.dimensions[0].maxScore, 0);
  assert.equal(radarAxes(model.dimensions)[0].ratio, null);
  assert.equal(model.dimensions[0].reason, raw.report_detail.evaluation_rule[0].eval_reason);
  assert.equal(model.dimensions[0].advice, raw.report_detail.evaluation_rule[0].eval_suggestion);
  assert.equal(model.dimensions[0].items[1].score, 0);
  assert.equal(model.dimensions[0].items[1].counted, false);
  assert.equal(model.dimensions[0].items[1].initiated, true);
  assert.equal(model.dimensions[0].items[1].maxScore, null);
  assert.deepEqual(model, normalizeReportDetail(raw));
  const voice = publicReportDetail(fixture('voice-e2e-report.json'));
  const voiceModel = normalizeReportDetail(voice);
  assert.equal(voiceModel.dimensions[0].items[0].references[0].turnId, 'rt0');
  assert.equal(voiceModel.transcript[0].evaluationLevel, 'good');
  assert.ok(voiceModel.transcript[0].evaluation.length > 0);
});

test('the HTTP report response is projected without a new exercise-status gate', async t => {
  const raw = fixture('voice-e2e-report.json');
  raw.hidden = 'PRIVATE_REPORT_HTTP_MARKER';
  let exerciseStatus = 'running';
  let reportCode = 0;
  const calls = [];
  const app = createApplication({
    accessKey: 'test-only-key', secretKey: 'test-only-secret',
    upstreamFetch: async url => {
      calls.push(url.pathname);
      const data = url.pathname.endsWith('/detail')
        ? { exercise_id: 261, user_id: 1, plan_id: 49, status: exerciseStatus }
        : raw;
      return { ok: true, json: async () => ({ code: url.pathname.endsWith('/detail') ? 0 : reportCode, data }) };
    },
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  for (const status of ['running', 'evaluated']) {
    exerciseStatus = status;
    const response = await fetch(`${origin}/api/exercises/261/report`);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data, publicReportDetail(raw));
    assert.equal(JSON.stringify(data).includes('PRIVATE_REPORT_HTTP_MARKER'), false);
    assert.equal(Object.hasOwn(data.report_detail, 'scenes'), false);
  }
  reportCode = 404;
  const response = await fetch(`${origin}/api/exercises/261/report`);
  assert.equal(response.status, 404);
  assert.deepEqual((await response.json()).error, {
    code: 'UPSTREAM_NOT_FOUND', message: '评测报告尚未就绪，或练习记录不存在', retryable: true,
  });
  assert.equal(calls.length, 6);
  assert.ok(calls.every(path => path.endsWith('/detail') || path.endsWith('/getReport')));
});
