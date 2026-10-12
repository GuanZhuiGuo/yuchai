export const normalizeSearchText = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/\s+/gu, ' ').trim();

const text = values => normalizeSearchText(values.flat(Infinity).filter(value => typeof value === 'string').join(' '));

export function searchCourses(courses, practices, query, { filter = 'all', isCompleted = () => false } = {}) {
  const terms = normalizeSearchText(query).split(' ').filter(Boolean);
  return courses.map((course, index) => {
    if (filter === 'todo' && isCompleted(course.id) || filter === 'done' && !isCompleted(course.id)) return null;
    const linked = practices.filter(practice => (course.practiceIds ?? []).includes(practice.id));
    const fields = [
      [8, text([course.title])], [6, text([course.subtitle])], [4, text([course.keypoints ?? []])],
      [3, text([course.summary, course.practicePrompt, ...(course.sections ?? []).map(section => [section.title, section.paragraphs ?? [], section.bullets ?? []]), course.quiz?.question, course.quiz?.options ?? [], course.quiz?.explanation])],
      [1, text(linked.map(practice => [practice.title, practice.brief, practice.roleName, practice.roleTitle, practice.goals ?? []]))],
    ];
    if (!terms.every(term => fields.some(([, value]) => value.includes(term)))) return null;
    const score = terms.reduce((sum, term) => sum + Math.max(0, ...fields.filter(([, value]) => value.includes(term)).map(([weight]) => weight)), 0);
    return { course, index, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score || a.index - b.index).map(result => result.course);
}
