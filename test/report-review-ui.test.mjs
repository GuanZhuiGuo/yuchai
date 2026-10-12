import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import * as model from '../public/report-model.js';
import * as view from '../public/report-view.js';
import * as learning from '../public/learning-state.js';
import { searchCourses } from '../public/course-search.js';

const report300 = JSON.parse(readFileSync(new URL('./fixtures/reports/oem-report-300.json', import.meta.url), 'utf8'));
const rawApp = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const curriculum = readFileSync(new URL('../public/curriculum.js', import.meta.url), 'utf8');

function harness(responses = {}) {
  const nodes = new Map(), requests = [];
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { innerHTML: '', classList: { add() {}, remove() {}, toggle() {} }, querySelectorAll: () => [] });
    return nodes.get(selector);
  };
  const context = vm.createContext({
    ...model, ...view, ...learning, searchCourses, URL,
    document: { baseURI: 'http://test/', querySelector: node, addEventListener() {} },
    window: { addEventListener() {} }, location: { hash: '#review' },
    localStorage: { getItem: () => null },
    AbortSignal: { timeout: () => undefined },
    fetch: async url => {
      requests.push(url.pathname + url.search);
      const data = responses[url.pathname + url.search];
      if (data instanceof Error) throw data;
      return { ok: true, json: async () => data };
    },
  });
  vm.runInContext(curriculum, context);
  const bootstrap = rawApp.indexOf('\nrender();\n');
  vm.runInContext(rawApp.slice(0, bootstrap).replace(/^import .*\n/gm, ''), context);
  context.rawReport = report300;
  return { run: code => vm.runInContext(code, context), node, requests };
}

test('my review shows OEM report identity and actual feedback, then retries the same OEM practice', async () => {
  const app = harness();
  app.run('route=["review"]; activeReport=normalizeLive(rawReport,300,{planId:47})');
  await app.run('review()');
  const html = app.node('#app-main').innerHTML;
  assert.ok(html.includes('练习 300 · 商用车OEM新平台动力定点'));
  assert.ok(html.includes('href="#report/live/300"'));
  assert.ok(html.includes('href="#prepare/p-oem"'));
  assert.ok(html.includes('本次报告的评分建议'));
  assert.ok(html.includes(report300.report_detail.evaluation_rule[1].eval_suggestion));
  assert.equal(html.includes('与经销商负责人讨论准入与独家合作'), false);
  assert.equal(html.includes('prepare/p-overseas'), false);
  assert.deepEqual(app.requests, []);
});

test('a refreshed my-review page reads the latest evaluated real report instead of silently reusing sample advice', async () => {
  const app = harness({
    '/api/history?pageSize=20': { list: [
      { exercise_id: 999, status: 'running' },
      { exercise_id: 266, status: 'evaluated' },
      { exercise_id: 300, status: 'evaluated' },
    ] },
    '/api/exercises/300': { planId: 47, status: 'evaluated' },
    '/api/exercises/300/report': report300,
  });
  app.run('route=["review"]; state.demoReportSeen=true');
  await app.run('review()');
  const html = app.node('#app-main').innerHTML;
  assert.ok(html.includes('最近完成的练习'));
  assert.ok(html.includes('练习 300 · 商用车OEM'));
  assert.ok(html.includes('href="#prepare/p-oem"'));
  assert.equal(html.includes('固定参考样例'), false);
  assert.deepEqual(app.requests, ['/api/history?pageSize=20', '/api/exercises/300', '/api/exercises/300/report']);
});

test('unavailable history shows a source-selection error without falling back to another scenario', async () => {
  const app = harness({ '/api/history?pageSize=20': new Error('连接失败') });
  app.run('route=["review"]; state.demoReportSeen=true');
  await app.run('review()');
  const html = app.node('#app-main').innerHTML;
  assert.ok(html.includes('暂时无法读取练习建议'));
  assert.ok(html.includes('从报告列表选择练习'));
  assert.equal(html.includes('p-overseas'), false);
  assert.equal(html.includes('固定参考样例'), false);
});
