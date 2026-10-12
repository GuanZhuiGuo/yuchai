import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import * as learningState from '../public/learning-state.js';
import * as lessonModel from '../public/lesson-model.js';
import { searchCourses } from '../public/course-search.js';
import { buildLiveRecommendations, matchReportCourse, validReviewRecommendations } from '../public/report-model.js';

const appSource = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const curriculumSource = readFileSync(new URL('../public/curriculum.js', import.meta.url), 'utf8');
const response = data => ({ ok: true, status: 200, json: async () => data });

function harness(hash = '#home', { observeCards = false, intersectionObserver = true, cache = null, media = {} } = {}) {
  const nodes = new Map(), requests = [], timeoutControls = [], observers = [];
  const windowEvents = new Map(), documentEvents = new Map();
  const documentHandlers = new Map(), cacheWrites = [];
  let cached = cache;
  let cards = [], labels = [];
  function node(selector) {
    if (!nodes.has(selector)) {
      let html = '';
      const events = new Map();
      nodes.set(selector, {
        writes: 0, textContent: '', scrollTop: 0, value: '',
        currentTime: 0, paused: true, seeking: false, readyState: 0,
        get innerHTML() { return html; },
        set innerHTML(value) {
          this.writes++; html = value;
          if (observeCards && selector === '#app-main') {
            for (const card of cards) card.isConnected = false;
            cards = []; labels = [];
            for (const match of value.matchAll(/<a class="practice-card" data-practice="([^"]+)"[\s\S]*?<div class="practice-mode" data-plan-mode="([^"]+)">([\s\S]*?)<\/div>/g)) {
              cards.push({ dataset: { practice: match[1] }, isConnected: true });
              labels.push({ dataset: { planMode: match[2] }, innerHTML: match[3] });
            }
          }
        },
        classList: { add() {}, remove() {}, toggle() {} },
        querySelectorAll: selector => selector === '.practice-card[data-practice]' ? cards : selector === '[data-plan-mode]' ? labels : [],
        addEventListener: (event, handler) => events.set(event, handler), emit: event => events.get(event)?.(),
      });
    }
    return nodes.get(selector);
  }
  const context = vm.createContext({
    initialReportUI: () => ({}), URL, ...learningState, ...lessonModel, searchCourses, buildLiveRecommendations, matchReportCourse, validReviewRecommendations,
    YUCHAI_MEDIA: { courseMedia: media },
    document: { baseURI: 'http://127.0.0.1:9999/yuchai-training/', visibilityState: 'visible', querySelector: node, addEventListener: (event, handler) => { documentEvents.set(event, handler); if (!documentHandlers.has(event)) documentHandlers.set(event, []); documentHandlers.get(event).push(handler); } },
    window: { addEventListener: (event, handler) => windowEvents.set(event, handler), scrollTo() {} }, location: { hash },
    localStorage: { getItem: () => cached, setItem: (_key, value) => { cached = value; cacheWrites.push(value); } },
    AbortSignal: { timeout(ms) {
      const controller = new AbortController();
      timeoutControls.push({ ms, controller });
      return controller.signal;
    } },
    fetch(url, options) {
      const path = url.pathname.replace('/yuchai-training', '');
      return new Promise((resolve, reject) => {
        const record = { path, settled: false, signal: options.signal,
          resolve(value) { record.settled = true; resolve(value); },
          reject(error) { record.settled = true; reject(error); } };
        options.signal?.addEventListener('abort', () => record.reject(options.signal.reason), { once: true });
        requests.push(record);
      });
    },
    ...(observeCards && intersectionObserver ? { IntersectionObserver: class {
      constructor(callback) { this.callback = callback; this.observed = new Set(); this.disconnected = false; observers.push(this); }
      observe(card) { this.observed.add(card); }
      unobserve(card) { this.observed.delete(card); }
      disconnect() { this.disconnected = true; this.observed.clear(); }
      enter(card) { this.callback([{ target: card, isIntersecting: true }]); }
    } } : {}),
  });
  vm.runInContext(curriculumSource, context);
  vm.runInContext(appSource.replace(/^import .*\n/gm, ''), context);
  return { node, requests, timeoutControls, observers, windowEvents, documentEvents, cacheWrites,
    cached: () => cached,
    emit: (event, value) => documentHandlers.get(event)?.forEach(handler => handler(value)),
    card: id => cards.find(card => card.dataset.practice === id),
    label: id => labels.find(label => Number(label.dataset.planMode) === id),
    run: code => vm.runInContext(code, context) };
}
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
function resolveStartup(app) {
  app.requests.find(r => r.path === '/api/health').resolve(response({ mode: 'live' }));
  app.requests.find(r => r.path === '/api/plans').resolve(response({ plans: [{ id: 71, status: 'active' }] }));
}
const details = app => app.requests.filter(request => /^\/api\/plans\//.test(request.path));
const pendingDetail = (app, id) => details(app).find(request => !request.settled && request.path === `/api/plans/${id}`);
function clickAction(app, action, data = {}) {
  const element = { dataset: { action, ...data }, disabled: false };
  app.emit('click', { target: { closest: selector => selector === '[data-action]' ? element : null } });
}
async function finishModes(app, modeForId = () => 'text') {
  for (let wave = 0; wave < 8 && app.run('planDetailRequests.size'); wave++) {
    await flush();
    const pending = details(app).filter(request => !request.settled);
    assert.ok(pending.length > 0 && pending.length <= 2);
    for (const request of pending) {
      const id = Number(request.path.split('/').at(-1));
      request.resolve(response({ id, dialogueMode: modeForId(id) }));
    }
    await flush();
  }
  assert.equal(app.run('planDetailRequests.size'), 0);
}

test('the initial module graph excludes the large voice decoder and keeps it for explicit practice start', () => {
  const visited = new Set();
  function visit(url) {
    if (visited.has(url.pathname)) return;
    visited.add(url.pathname);
    const source = readFileSync(url, 'utf8');
    for (const match of source.matchAll(/^import\s+.*?from\s+['"](.+?)['"]/gm)) visit(new URL(match[1], url));
  }
  visit(new URL('../public/app.js', import.meta.url));
  assert.ok(![...visited].some(path => /\/(voice|opus-decoder)\.js$/.test(path)));
  assert.match(appSource, /import\('\.\/voice\.js'\)/);
  const start = appSource.slice(appSource.indexOf('async function startPractice('), appSource.indexOf('async function connect('));
  assert.ok(start.indexOf('await loadVoiceClient()') < start.indexOf("api('/api/exercises'"));
});

test('real search input handles composition, whitespace and case without rebuilding or dropping focus', () => {
  const app = harness('#courses');
  const writes = app.node('#app-main').writes;
  app.emit('input', { target: { id: 'course-search', value: ' tco ' }, isComposing: true });
  assert.equal(app.run('query'), '');
  app.emit('compositionend', { target: { id: 'course-search', value: ' tco ' } });
  assert.match(app.node('#course-list').innerHTML, /让动力方案说清经营价值/);
  assert.match(app.node('#course-search-status').textContent, /找到 \d+ 门相关课程/);
  assert.equal(app.node('#app-main').writes, writes);
  app.node('#course-search').value = ' tco ';
  clickAction(app, 'clear-search');
  assert.equal(app.node('#course-search').value, '');
  assert.match(app.node('#course-search-status').textContent, /5 门课程/);
  assert.equal(app.node('#app-main').writes, writes);
});

test('assessment shows all eight cards without any practice filter controls', () => {
  const app = harness('#assessment', { observeCards: true });
  assert.doesNotMatch(app.node('#app-main').innerHTML, /data-action="practice-filter"|全部任务/);
  assert.equal(app.run('D.practices.length'), 8);
  for (const id of app.run('D.practices.map(p=>p.id)')) assert.ok(app.card(id));
});

test('bad cache fields never crash home and valid completions are deduplicated and retained after reload', () => {
  const invalid = harness('#home', { cache: '{"completed":null,"visited":"bad","videos":null}' });
  assert.match(invalid.node('#app-main').innerHTML, /你好，玉柴伙伴/);
  assert.equal(invalid.run('state.completed.length'), 0);
  const old = harness('#home', { cache: JSON.stringify({ completed: ['c1', 'c1', 'old'] }) });
  assert.equal(old.run('state.completed.length'), 1);
  assert.match(old.node('#app-main').innerHTML, /<b>1<small> \/ 5<\/small>/);
  old.run('save()');
  const refreshed = harness('#home', { cache: old.cached() });
  assert.equal(refreshed.run('completed("c1")'), true);
});

test('reading and correct self-check immediately persist partial progress without claiming course completion', () => {
  const app = harness('#reader/c1/0');
  clickAction(app, 'read-next', { course: 'c1', index: '0' });
  assert.deepEqual(JSON.parse(app.cached()).visited.c1, [0]);
  app.run('selectedAnswer=course("c1").quiz.correctIndex');
  clickAction(app, 'check-answer', { course: 'c1' });
  const cache = JSON.parse(app.cached());
  assert.deepEqual(cache.quizAnswers.c1, ['c1-q1']);
  assert.deepEqual(cache.quizPassed, []);
  assert.deepEqual(cache.completed, []);
  const refreshed = harness('#courses', { cache: app.cached() });
  assert.match(refreshed.node('#course-list').innerHTML, /学习中 · \d+%/);
  assert.ok(refreshed.run('learningProgress()') > 0);
});

test('three self-check questions persist individually, resume the next question, and require all answers for completion', () => {
  const app = harness('#reader/c1/3');
  const questions = app.run('quizzesForCourse(course("c1"))');
  assert.equal(questions.length, 3);
  app.run('selectedAnswer=currentQuiz(course("c1")).correctIndex');
  clickAction(app, 'check-answer', { course: 'c1' });
  assert.deepEqual(JSON.parse(app.cached()).quizAnswers.c1, ['c1-q1']);
  assert.deepEqual(JSON.parse(app.cached()).quizPassed, []);
  const resumed = harness('#reader/c1/3', { cache: app.cached() });
  assert.equal(resumed.run('activeQuizIndex'), 1);
  resumed.run('selectedAnswer=(currentQuiz(course("c1")).correctIndex+1)%currentQuiz(course("c1")).options.length');
  clickAction(resumed, 'check-answer', { course: 'c1' });
  assert.deepEqual(JSON.parse(resumed.cached()).quizAnswers.c1, ['c1-q1']);
  for (const index of [1, 2]) {
    clickAction(resumed, 'quiz-jump', { course: 'c1', index });
    resumed.run('selectedAnswer=currentQuiz(course("c1")).correctIndex');
    clickAction(resumed, 'check-answer', { course: 'c1' });
  }
  assert.deepEqual(JSON.parse(resumed.cached()).quizAnswers.c1, ['c1-q1', 'c1-q2', 'c1-q3']);
  assert.deepEqual(JSON.parse(resumed.cached()).quizPassed, ['c1']);
  assert.deepEqual(JSON.parse(resumed.cached()).completed, []);
});

test('routing resets only H5 content scroll and home exposes both learning and practice without a progress gate', () => {
  const app = harness('#home');
  const html = app.node('#app-main').innerHTML;
  assert.match(html, /class="home-actions"/);
  assert.match(html, /href="#course\/c1"[^>]*>[\s\S]*?学课程/);
  assert.match(html, /href="#assessment"[^>]*>[\s\S]*?开始实战/);
  assert.equal(app.run('esc("考核要点与考试报告")'), '练习要点与练习报告');
  app.node('.app-frame').scrollTop = 240;
  app.node('#app-main').scrollTop = 400;
  app.run('window.scrollTo=()=>{throw Error("outer scroll must remain unchanged")}; location.hash="#me"; render()');
  assert.equal(app.node('#app-main').scrollTop, 0);
  assert.equal(app.node('.app-frame').scrollTop, 240);
});

test('short playback is saved on navigation, resumes without credit and pagehide persists the final seconds', () => {
  const media = { c1: { video: { durationSeconds: 10, src: 'video.mp4', title: '示范' } } };
  const app = harness('#course/c1', { media });
  const video = app.node('#lesson-video');
  video.paused = false;video.currentTime = 1;video.emit('timeupdate');
  video.currentTime = 1.5;video.emit('timeupdate');
  assert.equal(app.cacheWrites.length, 0);
  app.run('location.hash="#courses";render()');
  assert.equal(JSON.parse(app.cached()).videos.c1.watched, 1.5);
  const refreshed = harness('#course/c1', { cache: app.cached(), media });
  const resumed = refreshed.node('#lesson-video');
  resumed.emit('loadedmetadata');
  assert.equal(resumed.currentTime, 1.5);
  assert.equal(refreshed.run('state.videos.c1.watched'), 1.5);
  resumed.paused = false;resumed.currentTime = 2;resumed.emit('timeupdate');
  refreshed.windowEvents.get('pagehide')();
  assert.equal(JSON.parse(refreshed.cached()).videos.c1.watched, 2);
});

test('storage synchronization preserves active video playback and a newer reset cannot be revived', () => {
  const media = { c1: { video: { durationSeconds: 10, src: 'video.mp4', title: '示范' } } };
  const app = harness('#course/c1', { media });
  const video = app.node('#lesson-video');video.paused = false;video.currentTime = 1;video.emit('timeupdate');
  const writes = app.node('#app-main').writes;
  app.windowEvents.get('storage')({ key: 'yuchai-learning-demo-v2', newValue: JSON.stringify({ visited: { c1: [0] }, videos: { c1: { ranges: [[2, 3]], position: 3 } } }) });
  assert.equal(app.node('#app-main').writes, writes);
  assert.equal(video.currentTime, 1);
  assert.equal(app.run('state.videos.c1.watched'), 2);
  video.currentTime = 1.5;video.emit('timeupdate');
  assert.equal(app.run('state.videos.c1.watched'), 2.5);
  app.windowEvents.get('storage')({ key: 'yuchai-learning-demo-v2', newValue: JSON.stringify(learningState.emptyLearningState(100)) });
  assert.equal(app.run('state.resetAt'), 100);
  assert.equal(app.run('state.visited.c1'), undefined);
  app.run('save()');
  assert.deepEqual(JSON.parse(app.cached()).visited, {});
});

test('home and course navigation render while plan requests are pending and are not rebuilt on completion', async () => {
  const app = harness();
  assert.match(app.node('#app-main').innerHTML, /你好，玉柴伙伴/);
  assert.deepEqual(app.requests.map(r => r.path), ['/api/health', '/api/plans']);
  app.run('location.hash="#course/c1"; render()');
  assert.match(app.node('#app-main').innerHTML, /把第一次拜访谈成一次有效沟通/);
  const html = app.node('#app-main').innerHTML, writes = app.node('#app-main').writes;
  app.node('.app-frame').scrollTop = 430;
  resolveStartup(app);
  await flush();
  assert.equal(app.node('#app-main').innerHTML, html);
  assert.equal(app.node('#app-main').writes, writes);
  assert.equal(app.node('.app-frame').scrollTop, 430);
  assert.match(app.node('#connection-status').textContent, /实战已就绪/);
  assert.equal(app.requests.length, 2);
});

test('only the selected detail is loaded and a slow detail does not block the start button or reset input', async () => {
  const app = harness('#prepare/p-demand');
  assert.deepEqual(app.requests.map(r => r.path), ['/api/health', '/api/plans']);
  app.run('ensurePlanDetail(practice("p-demand"))');
  await flush();
  assert.deepEqual(app.requests.map(r => r.path).sort(), ['/api/health', '/api/plans', '/api/plans/71'].sort());
  assert.equal(app.requests.filter(r => r.path === '/api/plans/71').length, 1);
  assert.match(app.node('#app-main').innerHTML, /正在连接实战服务/);
  const writes = app.node('#app-main').writes;
  app.node('input[name=input-mode]:checked').value = 'voice';
  resolveStartup(app);
  await flush();
  const button = app.node('#practice-launch').innerHTML.match(/<button[^>]*data-action="start-practice"[^>]*>/)?.[0];
  assert.ok(button);
  assert.doesNotMatch(button, /disabled/);
  assert.equal(app.node('#app-main').writes, writes);
  assert.equal(app.node('input[name=input-mode]:checked').value, 'voice');
  // The selected detail is deliberately still pending here.
  assert.equal(app.run('available(practice("p-demand"))'), true);
});

test('all practice modes finish without any observer event, with at most two background requests', async () => {
  const app = harness('#home', { observeCards: true });
  assert.deepEqual(app.requests.map(r => r.path), ['/api/health', '/api/plans']);
  assert.match(app.label(71).innerHTML, /等待确认对话方式/);
  assert.doesNotMatch(app.label(71).innerHTML, /消息对话/);
  const writes = app.node('#app-main').writes;
  app.node('.app-frame').scrollTop = 790;
  resolveStartup(app);
  await flush();
  assert.equal(details(app).length, 2);
  await finishModes(app, id => id === 71 ? 'virtual_streaming_dialogue' : 'text');
  assert.equal(details(app).length, 8);
  assert.match(app.label(71).innerHTML, /实时对话/);
  assert.match(app.label(72).innerHTML, /消息对话/);
  assert.equal(app.node('#app-main').writes, writes);
  assert.equal(app.node('.app-frame').scrollTop, 790);
});

test('visible cards take queue priority and an unavailable observer does not prevent completion', async () => {
  const app = harness('#assessment', { observeCards: true });
  app.observers.at(-1).enter(app.card('p-complaint'));
  await flush();
  assert.equal(details(app)[0].path, '/api/plans/75');
  assert.equal(details(app).filter(request => !request.settled).length, 2);
  await finishModes(app);
  const noObserver = harness('#assessment', { observeCards: true, intersectionObserver: false });
  await finishModes(noObserver);
  assert.equal(details(noObserver).length, 8);
  assert.match(noObserver.label(71).innerHTML, /消息对话/);
});

test('idle, queued, active and failed labels reflect actual requests', async () => {
  const app = harness('#courses');
  assert.match(app.run('dialogueTag(practice("p-demand"))'), /对话方式待加载/);
  app.run('ensurePlanDetail(practice("p-demand"))');
  assert.match(app.run('dialogueTag(practice("p-demand"))'), /等待确认对话方式/);
  await flush();
  assert.match(app.run('dialogueTag(practice("p-demand"))'), /确认对话方式中/);
  pendingDetail(app, 71).resolve({ ok: false, status: 502, json: async () => ({ error: { message: 'Upstream unavailable' } }) });
  await flush();
  assert.match(app.run('dialogueTag(practice("p-demand"))'), /对话方式读取失败/);
  assert.doesNotMatch(app.run('dialogueTag(practice("p-demand"))'), /消息对话|实时对话|确认对话方式中/);
});

test('every queued timeout terminates with an error even when the observer never emits', async () => {
  const app = harness('#assessment', { observeCards: true });
  for (let wave = 0; wave < 8 && app.run('planDetailRequests.size'); wave++) {
    await flush();
    const pending = details(app).filter(request => !request.settled);
    assert.ok(pending.length > 0 && pending.length <= 2);
    for (const request of pending) {
      const timeout = app.timeoutControls.find(control => control.controller.signal === request.signal);
      assert.equal(timeout.ms, 8000);
      timeout.controller.abort(new DOMException('Timed out', 'TimeoutError'));
    }
    await flush();
  }
  assert.equal(details(app).length, 8);
  assert.equal(app.run('planDetailRequests.size'), 0);
  for (const id of [47, 49, 71, 72, 73, 74, 75, 76]) {
    assert.match(app.label(id).innerHTML, /对话方式读取失败/);
    assert.doesNotMatch(app.label(id).innerHTML, /等待确认|确认对话方式中/);
  }
});

test('preparation prioritizes its selected live detail ahead of background tasks', async () => {
  const app = harness('#assessment', { observeCards: true });
  app.run('location.hash="#prepare/p-datacenter";render()');
  await flush();
  assert.equal(details(app)[0].path, '/api/plans/76');
  assert.equal(details(app).filter(request => !request.settled).length, 2);
  pendingDetail(app, 76).resolve(response({ id: 76, dialogueMode: 'virtual_streaming_dialogue' }));
  await flush();
  assert.match(app.node('.prepare-tags').innerHTML, /实时对话/);
});

test('returning to the page refreshes changed modes and merges focus and visibility requests', async () => {
  const app = harness('#assessment', { observeCards: true });
  app.observers.at(-1).enter(app.card('p-demand'));
  await finishModes(app, id => id === 71 ? 'virtual_streaming_dialogue' : 'text');
  assert.match(app.label(71).innerHTML, /实时对话/);
  const writes = app.node('#app-main').writes;
  app.windowEvents.get('focus')();
  app.observers.at(-1).enter(app.card('p-demand'));
  app.documentEvents.get('visibilitychange')();
  app.observers.at(-1).enter(app.card('p-demand'));
  await flush();
  assert.equal(app.requests.filter(r => r.path === '/api/plans/71').length, 2);
  assert.match(app.label(71).innerHTML, /上次确认：实时对话 · 更新中/);
  pendingDetail(app, 71).resolve(response({ id: 71, dialogueMode: 'text' }));
  await flush();
  assert.match(app.label(71).innerHTML, /消息对话/);
  assert.equal(app.node('#app-main').writes, writes);
  app.run('location.hash="#home";render()');
  app.observers.at(-1).enter(app.card('p-demand'));
  await flush();
  assert.equal(app.requests.filter(r => r.path === '/api/plans/71').length, 2);
  assert.match(app.label(71).innerHTML, /消息对话/);
});

test('disconnected observers and cards cannot reprioritize background detail requests', () => {
  const app = harness('#assessment', { observeCards: true });
  const oldObserver = app.observers.at(-1), oldCard = app.card('p-demand');
  app.run('location.hash="#course/c1";render()');
  oldObserver.enter(oldCard);
  assert.equal(app.run('planDetailQueue.find(job=>job.practice.planId===71).priority'), 0);
  const currentCard = app.card('p-demand');
  currentCard.isConnected = false;
  app.observers.at(-1).enter(currentCard);
  assert.equal(app.run('planDetailQueue.find(job=>job.practice.planId===71).priority'), 0);
});

test('failed or invalid details never fall back to static curriculum modes', async () => {
  for (const result of [Error('offline'), { id: 72, dialogueMode: 'text' }, { id: 71, dialogueMode: 'unsupported' }]) {
    const app = harness('#assessment', { observeCards: true });
    app.observers.at(-1).enter(app.card('p-demand'));
    await flush();
    if (result instanceof Error) pendingDetail(app, 71).reject(result);
    else pendingDetail(app, 71).resolve(response(result));
    await flush();
    assert.match(app.label(71).innerHTML, /对话方式读取失败/);
    assert.doesNotMatch(app.label(71).innerHTML, /消息对话|实时对话/);
    assert.equal(app.run('planDetails.has(71)'), false);
  }
});

test('default detail calls reuse the cache briefly, while expired details are revalidated', async () => {
  const app = harness('#prepare/p-demand');
  await flush();
  pendingDetail(app, 71).resolve(response({ id: 71, dialogueMode: 'text' }));
  await flush();
  app.run('ensurePlanDetail(practice("p-demand"))');
  assert.equal(app.requests.filter(r => r.path === '/api/plans/71').length, 1);
  app.run('planDetailUpdatedAt.set(71,Date.now()-30001);ensurePlanDetail(practice("p-demand"))');
  await flush();
  assert.equal(app.requests.filter(r => r.path === '/api/plans/71').length, 2);
  assert.match(app.node('.prepare-tags').innerHTML, /上次确认：消息对话 · 更新中/);
});

test('preparation refreshes even a fresh mode and preserves explicitly stale confirmation on failure', async () => {
  const app = harness('#prepare/p-demand');
  await flush();
  pendingDetail(app, 71).resolve(response({ id: 71, dialogueMode: 'virtual_streaming_dialogue' }));
  await flush();
  app.run('prepare("p-demand")');
  await flush();
  assert.equal(details(app).length, 2);
  assert.match(app.node('.prepare-tags').innerHTML, /上次确认：实时对话 · 更新中/);
  pendingDetail(app, 71).reject(Error('offline'));
  await flush();
  assert.match(app.node('.prepare-tags').innerHTML, /上次确认：实时对话 · 更新失败/);
  assert.doesNotMatch(app.node('.prepare-tags').innerHTML, /消息对话|确认对话方式中/);
  app.run('prepare("p-demand")');
  await flush();
  pendingDetail(app, 71).resolve(response({ id: 71, dialogueMode: 'text' }));
  await flush();
  assert.match(app.node('.prepare-tags').innerHTML, /消息对话/);
  assert.doesNotMatch(app.node('.prepare-tags').innerHTML, /上次确认|更新失败|实时对话/);
});

test('preparation updates the actual mode without resetting the selected input', async () => {
  const app = harness('#prepare/p-demand');
  const writes = app.node('#app-main').writes;
  app.node('input[name=input-mode]:checked').value = 'voice';
  await flush();
  app.requests.find(r => r.path === '/api/plans/71').resolve(response({ id: 71, dialogueMode: 'virtual_streaming_dialogue' }));
  await flush();
  assert.match(app.node('.prepare-tags').innerHTML, /实时对话/);
  assert.equal(app.node('#app-main').writes, writes);
  assert.equal(app.node('input[name=input-mode]:checked').value, 'voice');
});

test('an eight-second background timeout leaves learning available and a deduplicated retry restores practice', async () => {
  const app = harness('#prepare/p-demand');
  await flush();
  assert.ok(app.timeoutControls.every(entry => entry.ms === 8000));
  for (const { controller } of app.timeoutControls) controller.abort(new DOMException('Timed out', 'TimeoutError'));
  await flush();
  assert.match(app.node('#app-main').innerHTML, /三分钟开场与采购需求探询/);
  assert.match(app.node('#practice-launch').innerHTML, /重新连接实战服务/);
  assert.equal(app.run('available(practice("p-demand"))'), false);
  const count = app.requests.length;
  app.run('const firstRetry=refreshConnection(); const sameRetry=refreshConnection();');
  assert.equal(app.run('firstRetry===sameRetry'), true);
  assert.equal(app.requests.length, count + 2);
  app.requests.at(-2).resolve(response({ mode: 'live' }));
  app.requests.at(-1).resolve(response({ plans: [{ id: 71, status: 'active' }] }));
  await flush();
  assert.equal(app.run('available(practice("p-demand"))'), true);
  assert.match(app.node('#practice-launch').innerHTML, /开始实战练习/);
});

test('failure before creating a new exercise returns to preparation without reopening the previous record', async () => {
  for (const failureAt of ['module', 'create']) {
    const app = harness();
    app.run(`session={id:111,practiceId:'p-oem',ended:true};
      liveAvailable=true; plans=[{id:71,status:'active'}];
      const feedback=[];
      prepare=(id)=>feedback.push(['prepare',id]); toast=text=>feedback.push(['toast',text]);
      loadVoiceClient=async()=>{${failureAt === 'module' ? "throw Error('component unavailable');" : 'return {};' }};`);
    const attempt = app.run('startPractice("p-demand")');
    if (failureAt === 'create') {
      await flush();
      app.requests.find(request => request.path === '/api/exercises').reject(Error('creation unavailable'));
    }
    await attempt;
    assert.equal(app.run('session.id'), 111);
    assert.equal(app.run('session.error'), undefined);
    assert.equal(app.run('location.hash'), '#home');
    assert.equal(app.run('feedback[0][0]'), 'prepare');
    assert.equal(app.run('feedback[1][0]'), 'toast');
    assert.equal(app.run('startingLive'), false);
  }
});

test('the deferred dialogue module still connects the current record with its original playback preferences', async () => {
  const app = harness();
  app.run(`const connectionEvents=[];
    session={id:321,practiceId:'p-demand',dialogueMode:'text',soundPreferred:false};
    renderCall=()=>{}; clock=()=>connectionEvents.push('clock');
    loadVoiceClient=async()=>({SparringVoice:class {
      async start(id,options){connectionEvents.push({id,options});}
      async stop(){}
    }});`);
  await app.run('connect()');
  assert.equal(app.run('session.connected'), true);
  assert.equal(app.run('session.connecting'), false);
  assert.equal(app.run('connectionEvents[0].id'), 321);
  assert.equal(app.run('connectionEvents[0].options.dialogueMode'), 'text');
  assert.equal(app.run('connectionEvents[0].options.inputMode'), 'text');
  assert.equal(app.run('connectionEvents[0].options.playbackEnabled'), false);
  assert.equal(app.run('connectionEvents[1]'), 'clock');
});
