import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  normalizeReportDetail, scoreRatio, radarAxes, meaningfulRecommendationText,
  validReviewRecommendations, matchReportCourse, buildLiveRecommendations,
  reportReviewContext, reportFeedbackConflicts,
} from '../public/report-model.js';

const fixture = file => JSON.parse(readFileSync(new URL(`./fixtures/reports/${file}`, import.meta.url), 'utf8'));
const voice261 = fixture('voice-e2e-report.json');
const text266 = fixture('ui-text-e2e-report-266.json');
const text264 = fixture('text-e2e-plan47-report.json');
const oem300 = fixture('oem-report-300.json');

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

const recommendationCourses = [
  { id: 'c1', subtitle: '开场破冰与信任建立' },
  { id: 'c2', subtitle: '工况、痛点与决策链' },
  { id: 'c3', subtitle: '适配依据、TCO 与服务保障' },
  { id: 'c4', subtitle: '异议与风险应对' },
  { id: 'c5', subtitle: '谈判与下一步推进' },
];

test('recommendation empty markers never appear as advice while actual instructions remain intact', () => {
  for (const value of [null, undefined, 0, {}, '', ' \n ', '无', ' 无。 ', '暂无建议', 'null', 'N/A', '--', '—', '无需改进。']) {
    assert.equal(meaningfulRecommendationText(value), '', String(value));
  }
  assert.equal(meaningfulRecommendationText('  无需展开集团历史，先回应客户当前工况。  '), '无需展开集团历史，先回应客户当前工况。');
  assert.equal(meaningfulRecommendationText('说明产品覆盖、法规能力与联合适配。'), '说明产品覆盖、法规能力与联合适配。');
  const values = [
    { courseId: 'c1', title: '回看开场方法', reason: '无' },
    { courseId: 'c2', title: '回看工况方法', reason: '  确认负载与使用时长。  ' },
    { courseId: 'c3', title: '', reason: '给出服务保障依据。' },
    { title: '回看服务方法', reason: '给出服务保障依据。' },
  ];
  const original = structuredClone(values);
  assert.deepEqual(validReviewRecommendations(values), [
    { courseId: 'c2', title: '回看工况方法', reason: '确认负载与使用时长。' },
  ]);
  assert.deepEqual(values, original);
  assert.deepEqual(validReviewRecommendations(null), []);
});

test('course recommendations use public feedback, valid low scores and actual local course mappings', () => {
  const dimension = (name, score, suggestion, topics = []) => ({
    name, eval_score: score, eval_total_score: 10, eval_suggestion: suggestion,
    related_scene: [{ topics }],
  });
  const rules = [
    dimension('推进下一步', 7, '明确提交材料、责任人与评审时间。'),
    dimension('需求分析', 0, '无', [
      { name: '需求确认', suggestion: '无' },
      { name: '开场表达', suggestion: '暂无' },
      { name: '需求确认', suggestion: '确认工况、客户痛点及决策人。' },
      { name: '需求确认', suggestion: '再次复述需求。' },
    ]),
    dimension('产品适配', 1, '说明联合适配与本地服务保障。'),
    dimension('风险应对', 3, '说明审批条件、负责人和反馈时间。'),
    dimension('开场信任', 8, '说明身份并确认本次会议目标。'),
    { ...dimension('开场信任', 0, '该维度没有有效分母，不应生成推荐。'), eval_total_score: 0 },
    dimension('未知维度', -1, '开场建议来自无效评分，不应使用。'),
    { ...dimension('开场信任', null, ''), eval_benchmark: 'PRIVATE_CONFIG_NOT_ADVICE' },
  ];
  const before = structuredClone(rules);
  const recommendations = buildLiveRecommendations(rules, recommendationCourses);
  assert.deepEqual(recommendations, [
    { courseId: 'c2', title: '建议回看：工况、痛点与决策链', reason: '确认工况、客户痛点及决策人。' },
    { courseId: 'c3', title: '建议回看：适配依据、TCO 与服务保障', reason: '说明联合适配与本地服务保障。' },
    { courseId: 'c4', title: '建议回看：异议与风险应对', reason: '说明审批条件、负责人和反馈时间。' },
  ]);
  assert.deepEqual(rules, before);
  assert.equal(JSON.stringify(recommendations).includes('PRIVATE_CONFIG_NOT_ADVICE'), false);
  assert.deepEqual(buildLiveRecommendations(rules, []), []);
  assert.deepEqual(buildLiveRecommendations(null, recommendationCourses), []);
  assert.equal(matchReportCourse('工况确认', recommendationCourses), 'c2');
  assert.equal(matchReportCourse('TCO 与服务保障', recommendationCourses), 'c3');
  assert.equal(matchReportCourse('产品适配', recommendationCourses.filter(course => course.id !== 'c3')), null);
  assert.equal(matchReportCourse('未知内容', recommendationCourses), null);
});

test('empty topic advice falls back only to meaningful dimension feedback without inventing content', () => {
  const rules = [{
    name: '产品方案', eval_score: 5, eval_total_score: 10,
    eval_suggestion: '无需展开集团历史，先说明与当前工况有关的产品适配依据。',
    related_scene: [{ topics: [{ name: '产品介绍', suggestion: '无' }] }],
  }];
  assert.deepEqual(buildLiveRecommendations(rules, recommendationCourses), [{
    courseId: 'c3', title: '建议回看：适配依据、TCO 与服务保障',
    reason: rules[0].eval_suggestion,
  }]);
  rules[0].eval_suggestion = '暂无改进建议';
  assert.deepEqual(buildLiveRecommendations(rules, recommendationCourses), []);
});

test('OEM 300 explicit same-norm contradiction is flagged without changing either source or score', () => {
  const before = structuredClone(oem300);
  const report = normalizeReportDetail(oem300);
  const conflicts = reportFeedbackConflicts(report.dimensions, report.transcript);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].turnId, 'rt0');
  assert.equal(conflicts[0].itemId, 'live0-scene0-topic0');
  assert.equal(conflicts[0].title, '沟通与开场规范');
  assert.equal(conflicts[0].evaluation, oem300.report_detail.turn_evaluations[0].evaluation);
  assert.equal(conflicts[0].reason, oem300.report_detail.evaluation_rule[0].related_scene[0].topics[0].reason);
  assert.equal(report.totalScore, 75);
  assert.equal(report.dimensions[0].items[0].score, 6);
  assert.equal(report.dimensions[1].score, 6);
  assert.deepEqual(oem300, before);
});

test('generic praise, different criteria, ambiguous citations and negative phrases do not assert a conflict', () => {
  const raw = structuredClone(oem300);
  for (const evaluation of [
    '表达礼貌清晰，有效推进对话，无违规问题。',
    '符合需求挖掘规范，主动询问项目工况。',
    '不符合沟通开场规范，缺少场景复述。',
    '没有完全符合开场规范。',
  ]) {
    raw.report_detail.turn_evaluations[0].evaluation = evaluation;
    const report = normalizeReportDetail(raw);
    assert.deepEqual(reportFeedbackConflicts(report.dimensions, report.transcript), [], evaluation);
  }
  raw.report_detail.turn_evaluations[0].evaluation = oem300.report_detail.turn_evaluations[0].evaluation;
  raw.report_detail.evaluation_rule[0].related_scene[0].topics[0].reason = '开场不存在违规行为，符合规范要求。';
  let report = normalizeReportDetail(raw);
  assert.deepEqual(reportFeedbackConflicts(report.dimensions, report.transcript), []);
  raw.report_detail.evaluation_rule[0].related_scene[0].topics[0].reason = oem300.report_detail.evaluation_rule[0].related_scene[0].topics[0].reason;
  raw.report_detail.evaluation_rule[0].related_scene[0].topics[0].related_text[0].type = 'assistant';
  report = normalizeReportDetail(raw);
  assert.deepEqual(reportFeedbackConflicts(report.dimensions, report.transcript), []);
  raw.report_detail.evaluation_rule[0].related_scene[0].topics[0].related_text[0].type = 'user';
  raw.report_detail.turn_evaluations.push(structuredClone(raw.report_detail.turn_evaluations[0]));
  report = normalizeReportDetail(raw);
  assert.deepEqual(reportFeedbackConflicts(report.dimensions, report.transcript), []);
});

test('review takeaway and retry identity remain attached to the OEM report, including no-advice cases', () => {
  const practices = [
    { id: 'p-oem', planId: 47, goals: ['确认新平台动力选型条件。'] },
    { id: 'p-overseas', planId: 49, goals: ['海外经销商准入与独家合作。'] },
  ];
  const advice = buildLiveRecommendations(oem300.report_detail.evaluation_rule, recommendationCourses);
  const report = { ...normalizeReportDetail(oem300), id: 300, planId: 47, practiceId: 'p-oem', reviewRecommendations: advice };
  let model = reportReviewContext(report, practices);
  assert.equal(model.retryRoute, 'prepare/p-oem');
  assert.equal(model.takeaway, advice[0].reason);
  assert.equal(model.takeawaySource, '本次报告的评分建议');
  assert.equal(JSON.stringify(model).includes('海外经销商'), false);
  model = reportReviewContext({ ...report, reviewRecommendations: [] }, practices);
  assert.equal(model.retryRoute, 'prepare/p-oem');
  assert.equal(model.takeaway, practices[0].goals[0]);
  assert.equal(model.takeawaySource, '本场景练习目标');
  model = reportReviewContext({ id: 999, reviewRecommendations: [] }, practices);
  assert.equal(model.retryRoute, 'assessment');
  assert.equal(model.takeaway, '');
  assert.equal(model.practice, null);
  assert.equal(reportReviewContext({ planId: 47 }, practices).practice.id, 'p-oem');
  assert.equal(reportReviewContext({ ...report, isMock: true }, practices).retryRoute, 'assessment');
});
