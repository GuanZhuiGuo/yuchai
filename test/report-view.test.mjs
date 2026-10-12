import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { reportPanel, reportPage, initialReportUI } from '../public/report-view.js';
import { normalizeReportDetail } from '../public/report-model.js';

const esc = value => String(value ?? '').replace(/[&<>"']/gu, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));
const ctx = { esc, icon: name => `<svg data-icon="${esc(name)}"></svg>` };
const report = reviewRecommendations => ({ dimensions: [], transcript: [], reviewRecommendations });

test('recommendation rows with empty feedback are omitted while meaningful rows keep course links and text', () => {
  const html = reportPanel(report([
    { courseId: 'c1', title: '建议回看：开场破冰与信任建立', reason: '先确认客户见面诉求。' },
    { courseId: 'c2', title: '建议回看：工况、痛点与决策链', reason: '无' },
    { courseId: 'c3', title: '建议回看：适配依据', reason: null },
    { courseId: 'c4', title: '建议回看：异议应对', reason: ' \n ' },
  ]), ctx, initialReportUI());
  assert.equal((html.match(/class="report-recommendation"/gu) || []).length, 1);
  assert.ok(html.includes('下一次，先练这几件事'));
  assert.ok(html.includes('href="#reader/c1/0?review=1"'));
  assert.ok(html.includes('先确认客户见面诉求。'));
  assert.equal(html.includes('工况、痛点与决策链'), false);
  assert.equal(html.includes('适配依据'), false);
  assert.equal(html.includes('异议应对'), false);
});

test('the entire recommendation section disappears when no valid recommendations exist', () => {
  for (const values of [undefined, null, [], [{ courseId: 'c2', title: '建议回看：需求分析', reason: '暂无建议' }]]) {
    const html = reportPanel(report(values), ctx, initialReportUI());
    assert.equal(html.includes('report-priorities'), false);
    assert.equal(html.includes('下一次，先练这几件事'), false);
    assert.equal(html.includes('本次没有可自动对应的复习课程'), false);
    assert.ok(html.includes('回到每一句客户对话'));
  }
});

test('meaningful reference recommendations retain content and escape upstream feedback', () => {
  const html = reportPanel({ ...report([
    { courseId: 'c5', title: '让下一步有明确的责任与时间', reason: '把“之后补资料”改成日期、内容与评审标准。' },
    { courseId: 'c3', title: '补齐适配依据', reason: '客户原文：<img src=x onerror=alert(1)>；请确认适配条件。' },
  ]), isMock: true }, ctx, initialReportUI());
  assert.equal((html.match(/class="report-recommendation"/gu) || []).length, 2);
  assert.ok(html.includes('让下一步有明确的责任与时间'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.equal(html.includes('<img src=x'), false);
});

test('report 300 exposes both original judgements in replay and scoring, replacing the misleading green verdict', () => {
  const raw = JSON.parse(readFileSync(new URL('./fixtures/reports/oem-report-300.json', import.meta.url), 'utf8'));
  const r = { ...normalizeReportDetail(raw), id: 300, practiceId: 'p-oem' };
  const opening = raw.report_detail.evaluation_rule[0].related_scene[0].topics[0];
  for (const tab of ['replay', 'scoring']) {
    const html = reportPanel(r, ctx, { ...initialReportUI(), tab });
    assert.ok(html.includes('评价结论不一致 · 待确认'), tab);
    assert.ok(html.includes(esc(raw.report_detail.turn_evaluations[0].evaluation)), tab);
    assert.ok(html.includes(esc(opening.reason)), tab);
    assert.ok(html.includes('当前保留接口原文和原分'), tab);
    assert.ok(html.includes(tab === 'scoring' ? '完整要求' : '单次发言'), tab);
  }
  const replay = reportPanel(r, ctx, { ...initialReportUI(), tab: 'replay' });
  const firstTurn = replay.slice(replay.indexOf('id="report-turn-rt0"'), replay.indexOf('id="report-turn-rt1"'));
  assert.equal(firstTurn.includes('class="evaluation-level"'), false);
  assert.equal(firstTurn.includes('data-icon="checkCircle"'), false);
  assert.ok(replay.includes('class="evaluation-level"'), 'other independent feedback keeps its original level');
  const overview = reportPanel(r, ctx, initialReportUI());
  assert.ok(overview.includes('本报告有评价结论不一致的发言'));
});

test('report retry links never invent an overseas practice when identity is unavailable', () => {
  const r = { ...report([]), id: 999, totalScore: 0 };
  const unknown = reportPage(r, ctx, initialReportUI());
  assert.ok(unknown.includes('href="#assessment">选择练习'));
  assert.equal(unknown.includes('p-overseas'), false);
  const known = reportPage({ ...r, practiceId: 'p-oem' }, ctx, initialReportUI());
  assert.ok(known.includes('href="#prepare/p-oem"'));
  assert.equal(known.includes('p-overseas'), false);
});
