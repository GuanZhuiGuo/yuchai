import assert from 'node:assert/strict';
import test from 'node:test';
import {
  emptyLearningState, normalizeLearningState, mergeLearningState,
  normalizeVideoProgress, recordVideoRange, courseLearningProgress, overallLearningProgress,
} from '../public/learning-state.js';

const courses = [
  { id: 'c1', sections: [{}, {}, {}], quiz: { id: 'c1-q1', question: '确认什么？', options: ['工况', '未知承诺'], correctIndex: 0 } },
  { id: 'c2', sections: [{}], quiz: { id: 'c2-q1', question: '下一步？', options: ['确认参与人', '编造参数'], correctIndex: 0 } },
];
const media = { c1: { video: { durationSeconds: 100 } } };

test('bad cache types are bounded while valid old completion, reading, and reports survive', () => {
  const raw = {
    completed: ['c1', 'c1', 'old', null], reviewed: null, quizPassed: ['c2', 'old'],
    visited: { c1: [0, 0, 2, -1, 3, '1', Infinity], c2: 'bad', old: [0] },
    videos: { c1: { watched: 94, done: true, position: 47 }, old: { watched: 100 } },
    realReports: [{ id: 7, date: '2026-10-11', isSyntheticVerification: false }, null, { id: 7, name: '保留报告元数据' }],
    demoReportSeen: 'true', resetAt: Infinity,
  };
  const state = normalizeLearningState(raw, courses, media);
  assert.deepEqual(state.completed, ['c1']);
  assert.deepEqual(state.visited, { c1: [0, 2] });
  assert.deepEqual(state.quizPassed, ['c2']);
  assert.deepEqual(state.reviewed, []);
  assert.deepEqual(Object.keys(state.videos), ['c1']);
  assert.equal(state.videos.c1.legacyWatched, 94);
  assert.equal(state.videos.c1.done, true);
  assert.equal(state.demoReportSeen, false);
  assert.deepEqual(state.realReports, [{ id: 7, date: '2026-10-11', isSyntheticVerification: false, name: '保留报告元数据' }]);
  assert.equal(state.resetAt, 0);
  assert.equal(courseLearningProgress(courses[0], state, media.c1.video), 100);
  for (const value of [null, undefined, [], 'broken JSON', { completed: null, visited: 1, videos: [], realReports: 'bad' }]) {
    assert.deepEqual(normalizeLearningState(value, courses, media), emptyLearningState());
  }
  assert.deepEqual(raw.visited.c1, [0, 0, 2, -1, 3, '1', Infinity]);
});

test('only valid video intervals count, overlapping replay is unique, and position earns nothing', () => {
  const raw = { ranges: [[15, 25], [0, 10], [5, 20], [95, 120], [-10, 2], null, ['0', 90], [50, 40], [30, Infinity]], watched: 999, done: true, position: 900 };
  const video = normalizeVideoProgress(raw, 100);
  assert.deepEqual(video.ranges, [[0, 25], [95, 100]]);
  assert.equal(video.watched, 30);
  assert.equal(video.done, false);
  assert.equal(video.position, 100);
  assert.equal(video.legacyWatched, 0);
  let recorded = recordVideoRange(undefined, 0, 10, 100);
  recorded = recordVideoRange(recorded, 0, 10, 100);
  assert.equal(recorded.watched, 10);
  const unchanged = recordVideoRange(recorded, NaN, 99, 100);
  assert.deepEqual(unchanged, recorded);
  assert.equal(normalizeVideoProgress({ ranges: [], position: 100, done: true }, 100).watched, 0);
  assert.equal(normalizeVideoProgress({ watched: 89.99 }, 100).done, false);
  assert.equal(normalizeVideoProgress({ watched: 90 }, 100).done, true);
  assert.deepEqual(normalizeVideoProgress({ watched: 10, position: 10 }, 0), { ranges: [], legacyWatched: 0, watched: 0, done: false, position: 0 });
  assert.deepEqual(raw.ranges[0], [15, 25]);
});

test('legacy video totals are retained conservatively and never added twice to new ranges', () => {
  let video = normalizeVideoProgress({ watched: 50, done: false, position: 10 }, 100);
  assert.equal(video.legacyWatched, 50);
  assert.deepEqual(video.ranges, []);
  video = recordVideoRange(video, 0, 20, 100);
  assert.equal(video.watched, 50);
  video = recordVideoRange(video, 20, 60, 100);
  assert.equal(video.watched, 60);
  assert.equal(video.position, 10);
  assert.equal(video.legacyWatched, 50);
  assert.equal(video.done, false);
});

test('same reset epoch merges two tabs without lost reading, quiz, playback ranges, or reports', () => {
  const first = { ...emptyLearningState(11), completed: ['c1'], reviewed: ['c1'], visited: { c1: [0] }, videos: { c1: { ranges: [[0, 20]], position: 20 } }, realReports: [{ id: 1, date: 'one' }] };
  const second = { ...emptyLearningState(11), completed: ['c2'], quizPassed: ['c2'], quizAnswers: { c2: ['c2-q1'] }, visited: { c1: [0, 1], c2: [0] }, videos: { c1: { ranges: [[10, 30]], legacyWatched: 15, position: 5 } }, realReports: [{ id: 2, date: 'two' }], demoReportSeen: true };
  const combined = mergeLearningState(first, second, courses, media);
  assert.deepEqual(combined.completed, ['c1', 'c2']);
  assert.deepEqual(combined.visited, { c1: [0, 1], c2: [0] });
  assert.deepEqual(combined.reviewed, ['c1']);
  assert.deepEqual(combined.quizPassed, ['c2']);
  assert.deepEqual(combined.videos.c1.ranges, [[0, 30]]);
  assert.equal(combined.videos.c1.watched, 30);
  assert.equal(combined.videos.c1.position, 5);
  assert.equal(combined.demoReportSeen, true);
  assert.deepEqual(combined.realReports.map(r => r.id), [1, 2]);
  assert.equal(first.videos.c1.ranges[0][1], 20);
  assert.deepEqual(second.completed, ['c2']);
});

test('a newer reset wins in either merge order, preventing stale tabs from reviving cleared progress', () => {
  const old = { ...emptyLearningState(10), completed: ['c1'], quizPassed: ['c1'], visited: { c1: [0] }, videos: { c1: { watched: 95 } }, realReports: [{ id: 1 }] };
  const reset = emptyLearningState(20);
  assert.deepEqual(mergeLearningState(old, reset, courses, media), reset);
  assert.deepEqual(mergeLearningState(reset, old, courses, media), reset);
  const afterReset = { ...reset, visited: { c2: [0] } };
  assert.deepEqual(mergeLearningState(old, afterReset, courses, media).visited, { c2: [0] });
  assert.deepEqual(mergeLearningState(old, afterReset, courses, media).completed, []);
});

test('learning percentage includes partial reading, quiz, and effective video threshold with a dynamic course denominator', () => {
  const state = emptyLearningState();
  assert.equal(courseLearningProgress(courses[0], state, media.c1), 0);
  state.visited.c1 = [0];
  state.videos.c1 = { ranges: [[0, 45]], position: 100 };
  assert.equal(courseLearningProgress(courses[0], state, media.c1), 30); // 1 read + .5 video out of 5 units
  state.visited.c1 = [0, 1, 2, 2, 99];
  state.quizPassed = ['c1'];
  state.quizAnswers.c1 = ['c1-q1'];
  assert.equal(courseLearningProgress(courses[0], state, media.c1), 90);
  state.videos.c1 = { ranges: [[0, 90]] };
  assert.equal(courseLearningProgress(courses[0], state, media.c1.video), 100);
  state.visited.c2 = [0];
  assert.equal(courseLearningProgress(courses[1], state), 50);
  assert.equal(overallLearningProgress(courses, state, media), 75);
  state.completed = ['c2'];
  assert.equal(overallLearningProgress(courses, state, media), 100);
  assert.equal(overallLearningProgress([], state, media), 0);
  assert.equal(courseLearningProgress(null, state), 0);
});

test('JSON reload keeps all normalized progress and old course completions even without granular records', () => {
  const initial = normalizeLearningState({ completed: ['c2'], visited: { c1: [1] }, videos: { c1: { watched: 40, position: 25 } }, realReports: [{ id: '266', isSyntheticVerification: false }] }, courses, media);
  const reloaded = normalizeLearningState(JSON.parse(JSON.stringify(initial)), courses, media);
  assert.deepEqual(reloaded, initial);
  assert.equal(courseLearningProgress(courses[1], reloaded), 100);
  assert.equal(reloaded.videos.c1.watched, 40);
  assert.equal(reloaded.videos.c1.position, 25);
});
