import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { quizzesForCourse, passedQuizIds, quizProgress, isQuizComplete, videoLearningGuide } from '../public/lesson-model.js';
import { normalizeLearningState, mergeLearningState, emptyLearningState, courseLearningProgress } from '../public/learning-state.js';

const context = {};
vm.runInNewContext(fs.readFileSync(new URL('../public/curriculum.js', import.meta.url), 'utf8'), context);
vm.runInNewContext(fs.readFileSync(new URL('../public/media.js', import.meta.url), 'utf8'), context);
const courses = JSON.parse(JSON.stringify(context.YUCHAI_CURRICULUM.courses));
const media = JSON.parse(JSON.stringify(context.YUCHAI_MEDIA.courseMedia));

test('five courses have fifteen distinct questions and retain the original question as the first item', () => {
  assert.equal(courses.length, 5);
  for (const course of courses) {
    const quizzes = quizzesForCourse(course);
    assert.equal(quizzes.length, 3);
    assert.deepEqual(quizzes.map(q => q.id), [1, 2, 3].map(i => `${course.id}-q${i}`));
    assert.equal(quizzes[0].question, course.quiz.question);
    assert.deepEqual(quizzes[0].options, course.quiz.options);
    assert.equal(quizzes[0].correctIndex, course.quiz.correctIndex);
    assert.equal(new Set(quizzes.map(q => q.question)).size, 3);
    for (const quiz of quizzes) assert.ok(quiz.explanation.length > 25);
  }
});

test('old single-question progress only migrates the original answer and retains historical course completion', () => {
  const state = normalizeLearningState({ schemaVersion: 3, quizPassed: ['c1', 'c5'], completed: ['c5'] }, courses, media);
  assert.equal(state.schemaVersion, 4);
  assert.deepEqual(state.quizAnswers, { c1: ['c1-q1'], c5: ['c5-q1'] });
  assert.deepEqual(state.quizPassed, []);
  assert.deepEqual(quizProgress(courses[0], state), { passed: 1, total: 3, ratio: 1 / 3, complete: false });
  assert.equal(isQuizComplete(courses[0], state), false);
  assert.equal(isQuizComplete(courses[4], state), false);
  assert.equal(courseLearningProgress(courses[4], state, media.c5), 100);
  assert.deepEqual(normalizeLearningState(JSON.parse(JSON.stringify(state)), courses, media), state);
});

test('granular answers are validated and all three correct answers are required for the new completion marker', () => {
  assert.deepEqual(normalizeLearningState({ schemaVersion: 4, quizPassed: ['c1'] }, courses, media).quizAnswers, {});
  const partial = normalizeLearningState({ schemaVersion: 4, quizPassed: ['c1'], quizAnswers: {
    c1: ['c1-q2', 'c1-q2', 'c1-q3', 'c2-q1', 'deleted', 3], old: ['old-q1'],
  } }, courses, media);
  assert.deepEqual(partial.quizAnswers, { c1: ['c1-q2', 'c1-q3'] });
  assert.deepEqual(partial.quizPassed, []);
  assert.equal(isQuizComplete(courses[0], partial), false);
  const complete = mergeLearningState(partial, { ...emptyLearningState(), quizAnswers: { c1: ['c1-q1'] } }, courses, media);
  assert.deepEqual(complete.quizAnswers.c1, ['c1-q1', 'c1-q2', 'c1-q3']);
  assert.deepEqual(complete.quizPassed, ['c1']);
  assert.equal(isQuizComplete(courses[0], complete), true);
  assert.equal(passedQuizIds(courses[1], complete).length, 0);
});

test('multi-question progress counts a fraction of one learning unit and reset cannot revive old answers', () => {
  const state = { ...emptyLearningState(10), quizAnswers: { c1: ['c1-q1'] } };
  // c1 has three reading units, one video unit and one quiz unit.
  assert.equal(courseLearningProgress(courses[0], state, media.c1), 7);
  state.quizAnswers.c1.push('c1-q2');
  assert.equal(courseLearningProgress(courses[0], state, media.c1), 13);
  const cleared = emptyLearningState(20);
  assert.deepEqual(mergeLearningState(state, cleared, courses, media), cleared);
  assert.deepEqual(mergeLearningState(cleared, state, courses, media), cleared);
});

test('legacy single-question consumers have stable ids while malformed quiz data is excluded', () => {
  const course = { id: 'legacy', quiz: { question: '先确认哪项？', options: ['工况', '承诺'], correctIndex: 0 } };
  assert.equal(quizzesForCourse(course)[0].id, 'legacy-q1');
  assert.deepEqual(passedQuizIds(course, { quizPassed: ['legacy'] }), ['legacy-q1']);
  assert.equal(isQuizComplete(course, { quizPassed: ['legacy'] }), true);
  assert.deepEqual(quizzesForCourse({ id: 'broken', quizzes: [{ question: '', options: [], correctIndex: 9 }] }), []);
  assert.equal(isQuizComplete({ id: 'broken' }, emptyLearningState()), false);
});

test('every video guide uses real chapter boundaries and links the viewing action to an existing lesson section', () => {
  for (const course of courses) {
    const video = media[course.id].video;
    const guide = videoLearningGuide(course, video);
    assert.ok(guide?.goal && guide.transferAction && guide.boundary);
    assert.deepEqual(videoLearningGuide(course, media[course.id]), guide);
    assert.ok(guide.segments.length >= 2);
    const boundaries = new Set([...video.chapters.map(chapter => chapter.time), video.durationSeconds]);
    for (const segment of guide.segments) {
      assert.ok(boundaries.has(segment.start));
      assert.ok(boundaries.has(segment.end));
      assert.equal(segment.sectionTitle, course.sections[segment.sectionIndex].title);
      assert.ok(segment.action.length > 15);
    }
  }
  const opener = videoLearningGuide(courses[0], media.c1);
  assert.equal(opener.sourceTitle, media.c2.video.learningFocus.sourceTitle);
  assert.equal(opener.reused, true);
  assert.match(opener.connection, /没有演示身份介绍/);
  const risk = videoLearningGuide(courses[3], media.c4);
  assert.equal(risk.sourceTitle, media.c3.video.learningFocus.sourceTitle);
  assert.equal(risk.reused, true);
  assert.match(risk.boundary, /第3节图文/);
});

test('invalid video segment ranges and section links do not produce misleading jump targets', () => {
  const course = courses[0], video = media.c1.video;
  assert.equal(videoLearningGuide(course, { ...video, learningFocus: { goal: '测试', segments: [
    { start: -1, end: 20, title: '越界', action: '不可跳转', sectionIndex: 0 },
    { start: 0, end: 120, title: '越界', action: '不可跳转', sectionIndex: 0 },
    { start: 0, end: 20, title: '章节不存在', action: '不可跳转', sectionIndex: 99 },
  ] } }), null);
});
