const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value.trim() : '';

export function quizzesForCourse(course) {
  if (!object(course) || !text(course.id)) return [];
  const source = Array.isArray(course.quizzes) && course.quizzes.length ? course.quizzes : [course.quiz];
  const ids = new Set();
  return source.flatMap((quiz, index) => {
    if (!object(quiz) || !text(quiz.question) || !Array.isArray(quiz.options) || quiz.options.length < 2
      || !quiz.options.every(option => text(option)) || !Number.isInteger(quiz.correctIndex)
      || quiz.correctIndex < 0 || quiz.correctIndex >= quiz.options.length) return [];
    const id = text(quiz.id) || `${course.id}-q${index + 1}`;
    if (ids.has(id)) return [];
    ids.add(id);
    return [{ ...quiz, id }];
  });
}

export function passedQuizIds(course, state) {
  const quizzes = quizzesForCourse(course);
  const answers = object(state?.quizAnswers) && Array.isArray(state.quizAnswers[course?.id])
    ? state.quizAnswers[course.id] : [];
  const ids = new Set(answers.filter(id => typeof id === 'string'));
  // Versions before granular answers only know whether the original question
  // was answered correctly. They cannot attest to questions added later.
  if ((state?.schemaVersion === undefined || state.schemaVersion < 4)
    && Array.isArray(state?.quizPassed) && state.quizPassed.includes(course?.id) && quizzes[0]) {
    ids.add(quizzes[0].id);
  }
  return quizzes.filter(quiz => ids.has(quiz.id)).map(quiz => quiz.id);
}

export function quizProgress(course, state) {
  const total = quizzesForCourse(course).length;
  const passed = passedQuizIds(course, state).length;
  return { passed, total, ratio: total > 0 ? passed / total : 0, complete: total > 0 && passed === total };
}

export function isQuizComplete(course, state) {
  return quizProgress(course, state).complete;
}

export function videoLearningGuide(course, media) {
  const video = object(media?.video) ? media.video : media;
  const focus = video?.learningFocus;
  if (!object(focus) || !text(focus.goal) || !Number.isFinite(video?.durationSeconds)) return null;
  const sections = Array.isArray(course?.sections) ? course.sections : [];
  const segments = (Array.isArray(focus.segments) ? focus.segments : []).flatMap(segment => {
    if (!object(segment) || !Number.isFinite(segment.start) || !Number.isFinite(segment.end)
      || segment.start < 0 || segment.end <= segment.start || segment.end > video.durationSeconds
      || !text(segment.title) || !text(segment.action) || !Number.isInteger(segment.sectionIndex)
      || !sections[segment.sectionIndex]) return [];
    return [{ ...segment, sectionTitle: sections[segment.sectionIndex].title }];
  });
  if (!segments.length) return null;
  return {
    sourceTitle: text(focus.sourceTitle) || text(video.title), reused: focus.reused === true,
    connection: text(focus.connection), goal: text(focus.goal), segments,
    transferAction: text(focus.transferAction), boundary: text(focus.boundary),
  };
}
