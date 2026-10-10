import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import { ALLOWED_PLAN_IDS } from '../server.mjs';

const source = readFileSync(new URL('../public/curriculum.js', import.meta.url), 'utf8');
function curriculum() {
  const context = vm.createContext({});
  vm.runInContext(source, context);
  return JSON.parse(JSON.stringify(context.YUCHAI_CURRICULUM));
}

function appHarness(data = curriculum()) {
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { innerHTML: '', textContent: '', scrollTop: 0, classList: { add() {}, remove() {}, toggle() {} } });
    return nodes.get(selector);
  };
  const context = vm.createContext({
    YUCHAI_CURRICULUM: data,
    initialReportUI: () => ({ tab: 'overview' }),
    document: { querySelector: node, addEventListener() {} },
    window: { addEventListener() {}, scrollTo() {} },
    location: { hash: '#home' },
    localStorage: { getItem: () => null },
  });
  const rawApp = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  // Exercise the real render functions in a DOM stub; omit network bootstrap.
  const bootstrap = rawApp.indexOf('\nrender();\nPromise.allSettled(');
  assert.ok(bootstrap > 0);
  vm.runInContext(rawApp.slice(0, bootstrap).replace(/^import .*\n/gm, ''), context);
  return { context, node, run: code => vm.runInContext(code, context) };
}

test('five methods and eight practices keep nineteen symmetric links and valid publication metadata', () => {
  const data = curriculum();
  const courses = new Map(data.courses.map(course => [course.id, course]));
  const practices = new Map(data.practices.map(practice => [practice.id, practice]));
  assert.equal(courses.size, 5);
  assert.equal(practices.size, 8);
  assert.equal(data.meta.courseCount, courses.size);
  assert.equal(data.meta.practiceCount, practices.size);
  assert.equal(data.meta.livePracticeCount, data.practices.filter(practice => practice.availability === 'live').length);
  assert.equal(data.meta.plannedPracticeCount, data.practices.filter(practice => practice.availability !== 'live').length);
  assert.equal(data.courses.reduce((sum, course) => sum + course.practiceIds.length, 0), 19);
  const livePlanIds = [];
  const liveRoleIds = [];
  for (const course of courses.values()) {
    assert.equal(new Set(course.practiceIds).size, course.practiceIds.length, course.id);
    for (const id of course.practiceIds) assert.ok(practices.get(id)?.courseIds.includes(course.id), `${course.id} -> ${id}`);
  }
  for (const practice of practices.values()) {
    assert.equal(new Set(practice.courseIds).size, practice.courseIds.length, practice.id);
    for (const id of practice.courseIds) assert.ok(courses.get(id)?.practiceIds.includes(practice.id), `${practice.id} -> ${id}`);
    if (practice.availability === 'live') {
      assert.ok(Number.isSafeInteger(practice.planId) && practice.planId > 0, practice.id);
      assert.ok(Number.isSafeInteger(practice.roleId) && practice.roleId > 0, practice.id);
      assert.ok(['text', 'virtual_streaming_dialogue'].includes(practice.dialogueMode), practice.id);
      assert.ok(ALLOWED_PLAN_IDS.has(practice.planId), `${practice.id}: server permits this live plan`);
      livePlanIds.push(practice.planId);
      liveRoleIds.push(practice.roleId);
    }
  }
  assert.equal(new Set(livePlanIds).size, livePlanIds.length);
  assert.equal(new Set(liveRoleIds).size, liveRoleIds.length);
  assert.deepEqual([...ALLOWED_PLAN_IDS].sort((a, b) => a - b), livePlanIds.sort((a, b) => a - b));
  assert.deepEqual(practices.get('p-complaint').courseIds, ['c4', 'c5']);
  assert.deepEqual(practices.get('p-datacenter').courseIds, ['c2', 'c3', 'c4']);
});

test('public practices contain learner fields and valid covers without private scenario configuration', () => {
  const app = appHarness();
  const allowed = new Set(['id', 'title', 'roleName', 'roleTitle', 'brief', 'goals', 'estimatedMinutes', 'courseIds', 'planId', 'roleId', 'dialogueMode', 'availability', 'capabilityLabel', 'textAvailable', 'coverKey', 'backendMode', 'sourceLabel']);
  for (const practice of curriculum().practices) {
    assert.ok(Object.keys(practice).every(key => allowed.has(key)), practice.id);
    assert.equal(typeof practice.textAvailable, 'boolean', practice.id);
    const cover = app.run(`practiceCover(practice(${JSON.stringify(practice.id)}))`);
    assert.equal(cover.includes('undefined'), false, practice.id);
    assert.ok(existsSync(fileURLToPath(new URL(`../public/${cover}`, import.meta.url))), practice.id);
    assert.ok(practice.brief.length > 0 && practice.goals.length > 0, practice.id);
  }
  const publicText = JSON.stringify(curriculum().practices);
  for (const hiddenField of ['hiddenInformation', 'pressureRules', 'advanceConditions', 'exitConditions', 'rolePrompt', 'evaluationInstruction', 'referenceAnswer', 'assessmentStandard', 'scoringDimensions']) {
    assert.equal(publicText.includes(`"${hiddenField}"`), false, hiddenField);
  }
});

test('the home count follows the task model and zero learning progress still permits an active live practice', () => {
  const data = curriculum();
  data.practices.push({ ...data.practices[0], id: 'test-only-extra-practice' });
  const app = appHarness(data);
  app.run('home()');
  assert.ok(app.node('#app-main').innerHTML.includes('<b>9</b><span>关联实战任务</span>'));
  app.run('state.completed=[]; liveAvailable=true; plans=D.practices.filter(published).map(p=>({id:p.planId,status:"active"}))');
  for (const practice of curriculum().practices.filter(practice => practice.availability === 'live')) {
    app.run(`prepare(${JSON.stringify(practice.id)})`);
    const html = app.node('#app-main').innerHTML;
    assert.ok(html.includes('可先学后练，也可直接实战'), practice.id);
    assert.match(html, /data-action="start-practice"[^>]*>开始实战考核/, practice.id);
    assert.doesNotMatch(html.match(/<button[^>]*data-action="start-practice"[^>]*>/)?.[0] || '', /disabled/, practice.id);
  }
  assert.equal(app.run('available(practice("p-oem"))'), true);
  app.run('plans=[]');
  assert.equal(app.run('available(practice("p-oem"))'), false);
});

test('input availability is explicit and new feedback terms route back to the appropriate method', () => {
  const app = appHarness();
  assert.equal(app.run('textReady(practice("p-oem"))'), true);
  assert.equal(app.run('textReady(practice("p-overseas"))'), false);
  assert.equal(app.run('textReady({planId:999})'), false);
  assert.equal(app.run('textReady({planId:999,textAvailable:true})'), true);
  assert.equal(app.run('matchCourse("客诉中的事实核查与根因调查")'), 'c4');
  assert.equal(app.run('matchCourse("备用电源规范偏差与见证测试")'), 'c3');
  assert.equal(app.run('matchCourse("确定下一步跟进与采购评审")'), 'c5');
  assert.equal(app.run('matchCourse("简短开场与拜访价值")'), 'c1');
  assert.equal(app.run('matchCourse("现状、工况与经营影响")'), 'c2');
  assert.equal(app.run('matchCourse("可复算的全生命周期成本")'), 'c3');
  assert.equal(app.run('matchCourse("流程规范性")'), null);
});
