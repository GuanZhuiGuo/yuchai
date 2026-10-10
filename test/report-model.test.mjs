import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { normalizeReportDetail, scoreRatio, radarAxes } from '../public/report-model.js';

const fixture = file => JSON.parse(readFileSync(new URL(`./fixtures/reports/${file}`, import.meta.url), 'utf8'));
const voice261 = fixture('voice-e2e-report.json');
const text266 = fixture('ui-text-e2e-report-266.json');
const text264 = fixture('text-e2e-plan47-report.json');

test('266 retains the missing 0/0 axis and distinguishes actual zero from unavailable scores', () => {
  const report = normalizeReportDetail(text266);
  assert.equal(report.totalScore, 26);
  assert.equal(report.passingScore, 60);
  assert.equal(report.roundCount, 2);
  assert.equal(report.finishedTime, text266.report_detail.finished_time);
  assert.equal(report.dimensions[0].score, 0);
  assert.equal(report.dimensions[0].maxScore, 0);
  assert.deepEqual(radarAxes(report.dimensions).map(axis => axis.ratio), [null, 0.6, 1, 1]);
  assert.equal(radarAxes(report.dimensions).length, 4);
  assert.equal(scoreRatio(0, 10), 0);
  const genuineZero = structuredClone(text266);
  genuineZero.report_detail.final_score = 0;
  genuineZero.report_detail.evaluation_rule[0].eval_total_score = 10;
  const normalizedZero = normalizeReportDetail(genuineZero);
  assert.equal(normalizedZero.totalScore, 0);
  assert.equal(normalizedZero.dimensions[0].score, 0);
  assert.equal(radarAxes(normalizedZero.dimensions)[0].ratio, 0);
  for (const [score, max] of [[0, 0], [null, 10], [undefined, 10], [10, null], [NaN, 10], [Infinity, 10], [-1, 10], [11, 10], ['0', 10], [0, '10']]) {
    assert.equal(scoreRatio(score, max), null, `${score}/${max}`);
  }
  const missing = normalizeReportDetail({ report_detail: { evaluation_rule: [{}] } });
  assert.equal(missing.totalScore, null);
  assert.equal(missing.passingScore, null);
  assert.equal(missing.dimensions[0].score, null);
  assert.equal(missing.dimensions[0].maxScore, null);
  assert.equal(scoreRatio(missing.dimensions[0].score, missing.dimensions[0].maxScore), null);
});

test('261 keeps authoritative dimension totals, weights, reasons, advice and per-turn feedback', () => {
  const report = normalizeReportDetail(voice261);
  assert.equal(report.totalScore, 70.5);
  assert.deepEqual(radarAxes(report.dimensions).map(axis => axis.ratio), [0.7, 0.25, 0.9, 1]);
  assert.deepEqual(report.dimensions.map(dimension => dimension.weight), [70, 10, 10, 10]);
  for (const [index, dimension] of report.dimensions.entries()) {
    assert.equal(dimension.reason, voice261.report_detail.evaluation_rule[index].eval_reason || '');
    assert.equal(dimension.advice, voice261.report_detail.evaluation_rule[index].eval_suggestion || '');
  }
  assert.equal(report.transcript[0].evaluationLevel, 'good');
  assert.equal(report.transcript[0].evaluation, voice261.report_detail.turn_evaluations[0].evaluation);
  assert.equal(report.transcript[1].evaluationLevel, '');
  assert.equal(report.transcript[1].evaluation, '');
  assert.equal(report.transcript[0].speaker, 'learner');
  assert.equal(report.transcript[1].speaker, 'customer');
  const items = report.dimensions[0].items;
  assert.equal(items.reduce((sum, item) => sum + item.score, 0), 31);
  assert.equal(report.dimensions[0].score, 21);
  assert.equal(report.dimensions[0].maxScore, 30);
  assert.ok(items.every(item => item.maxScore === null));
  assert.equal(items[0].reason, voice261.report_detail.evaluation_rule[0].related_scene[0].topics[0].reason);
  assert.equal(items[0].advice, voice261.report_detail.evaluation_rule[0].related_scene[0].topics[0].suggestion);
  assert.equal(items[0].id, 'live0-scene0-topic0');
  assert.equal(items[0].references[0].turnId, 'rt0');
  assert.equal(items[0].references[0].ambiguous, false);
  assert.ok(report.transcript[0].itemIds.includes(items[0].id));
});

test('264 preserves an uncounted zero topic, retains its explanation and does not borrow scenes denominators', () => {
  const report = normalizeReportDetail(text264);
  const item = report.dimensions[0].items[1];
  assert.equal(report.totalScore, 55.75);
  assert.equal(item.score, 0);
  assert.equal(item.counted, false);
  assert.equal(item.initiated, true);
  assert.ok(item.reason.length > 0);
  assert.ok(item.advice.length > 0);
  assert.deepEqual(item.references, []);
  assert.deepEqual(item.turnIds, []);
  assert.equal(item.maxScore, null);
  assert.equal(text264.report_detail.scenes[0].topics[1].eval_score, 20);
  assert.deepEqual(report.dimensions[0].items.map(item => item.score), [5, 0, 6, 10]);
  assert.ok(report.dimensions[0].items.every(item => item.maxScore === null));
});

test('reference locations require exact text and the same role; duplicate turns remain ambiguous', () => {
  const raw = {
    report_detail: {
      evaluation_rule: [{ related_scene: [{ topics: [{
        name: '引用校验', score: 0, reason: '依据', suggestion: '建议',
        related_text: [
          { type: 'user', text: '重复发言' },
          { type: 'assistant', text: '重复发言' },
          { type: 'user', text: '完整原文。' },
          { type: 'user', text: '完整原文' },
          { type: 'user', text: '仅客户出现' },
        ],
      }] }] }],
      turn_evaluations: [
        { role: 'user', content: '重复发言' },
        { role: 'assistant', content: '重复发言' },
        { role: 'user', content: '重复发言' },
        { role: 'user', content: '完整原文。' },
        { role: 'assistant', content: '仅客户出现' },
      ],
    },
  };
  const report = normalizeReportDetail(raw);
  const item = report.dimensions[0].items[0];
  const [duplicate, customer, exact, punctuation, wrongRole] = item.references;
  assert.equal(duplicate.turnId, null);
  assert.deepEqual(duplicate.candidateTurnIds, ['rt0', 'rt2']);
  assert.equal(duplicate.ambiguous, true);
  assert.equal(customer.turnId, 'rt1');
  assert.equal(exact.turnId, 'rt3');
  assert.deepEqual(punctuation.candidateTurnIds, []);
  assert.deepEqual(wrongRole.candidateTurnIds, []);
  assert.deepEqual(item.turnIds, ['rt1', 'rt3']);
  assert.equal(item.ambiguous, true);
  assert.deepEqual(report.transcript[0].itemIds, []);
  assert.deepEqual(report.transcript[2].itemIds, []);
  assert.deepEqual(report.transcript[0].ambiguousItemIds, [item.id]);
  assert.deepEqual(report.transcript[2].ambiguousItemIds, [item.id]);
  assert.deepEqual(report.transcript[1].itemIds, [item.id]);
});

test('normalization does not mutate raw reports or invent topic denominators from undocumented fields', () => {
  const raw = structuredClone(voice261);
  const topic = raw.report_detail.evaluation_rule[0].related_scene[0].topics[0];
  topic.max_score = 10;
  topic.total_score = 10;
  const before = JSON.stringify(raw);
  const report = normalizeReportDetail(raw);
  assert.equal(JSON.stringify(raw), before);
  assert.equal(report.dimensions[0].items[0].maxScore, null);
  assert.deepEqual(normalizeReportDetail(null), {
    totalScore: null, maxScore: 100, passingScore: null, summary: '', finishedTime: '', roundCount: null,
    dimensions: [], transcript: [],
  });
});
