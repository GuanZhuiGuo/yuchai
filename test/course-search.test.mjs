import assert from 'node:assert/strict';
import test from 'node:test';
import '../public/curriculum.js';
import { searchCourses } from '../public/course-search.js';

const { courses, practices } = globalThis.YUCHAI_CURRICULUM;
const ids = (query, options) => searchCourses(courses, practices, query, options).map(course => course.id);

test('course search ignores outer whitespace, case and full width input and prioritizes the course subject', () => {
  assert.equal(ids(' tco ')[0], 'c3');
  assert.deepEqual(ids('ＴＣＯ'), ids('TCO'));
  assert.equal(ids('需求')[0], 'c2');
  assert.deepEqual(ids('　   '), courses.map(course => course.id));
});

test('course search covers lesson content and linked practice scenes with every query term required', () => {
  const localCourses = [{ id: 'one', title: '课程甲', sections: [{ paragraphs: ['确认停机损失'] }], practiceIds: ['p1'] }, { id: 'two', title: '课程乙', sections: [], practiceIds: [] }];
  const localPractices = [{ id: 'p1', title: '技术入围评审', goals: ['取得测试安排'] }];
  assert.deepEqual(searchCourses(localCourses, localPractices, '停机 损失').map(course => course.id), ['one']);
  assert.deepEqual(searchCourses(localCourses, localPractices, '入围 测试').map(course => course.id), ['one']);
  assert.equal(searchCourses(localCourses, localPractices, '停机 课程乙').length, 0);
  assert.deepEqual(ids('三分钟'), ['c1', 'c2']);
  assert.deepEqual(ids('完全不存在的内容'), []);
});

test('learning filters work together with search and clearing retains original course order', () => {
  const isCompleted = id => id === 'c3';
  assert.deepEqual(ids('tco', { filter: 'done', isCompleted }), ['c3']);
  assert.ok(!ids('tco', { filter: 'todo', isCompleted }).includes('c3'));
  assert.deepEqual(ids(''), courses.map(course => course.id));
});
