import { passedQuizIds, quizProgress, isQuizComplete } from './lesson-model.js';

const SCHEMA_VERSION = 4;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const nonnegative = value => finite(value) ? Math.max(0, value) : 0;
const durationOf = media => {
  const video = object(media?.video) ? media.video : media;
  return finite(video?.durationSeconds) && video.durationSeconds > 0 ? video.durationSeconds : 0;
};
const courseList = courses => Array.isArray(courses) ? courses.filter(c => object(c) && typeof c.id === 'string') : [];
const validIds = (values, courses) => {
  const ids = new Set(Array.isArray(values) ? values.filter(id => typeof id === 'string') : []);
  return courses.filter(c => ids.has(c.id)).map(c => c.id);
};
const sectionIndices = (values, course) => {
  const length = Array.isArray(course.sections) ? course.sections.length : 0;
  return [...new Set(Array.isArray(values) ? values.filter(i => Number.isInteger(i) && i >= 0 && i < length) : [])].sort((a, b) => a - b);
};

export function emptyLearningState(resetAt = 0) {
  return {
    completed: [], visited: {}, reviewed: [], videos: {}, quizPassed: [], quizAnswers: {},
    demoReportSeen: false, realReports: [],
    resetAt: Number.isSafeInteger(resetAt) && resetAt >= 0 ? resetAt : 0,
    schemaVersion: SCHEMA_VERSION,
  };
}

function validRanges(values, duration) {
  const ranges = [];
  if (duration <= 0) return ranges;
  for (const item of Array.isArray(values) ? values : []) {
    if (!Array.isArray(item) || !finite(item[0]) || !finite(item[1]) || item[1] <= item[0]) continue;
    const start = Math.max(0, Math.min(duration, item[0]));
    const end = Math.max(0, Math.min(duration, item[1]));
    if (end > start) ranges.push([start, end]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

export function normalizeVideoProgress(record, duration) {
  const raw = object(record) ? record : {};
  const seconds = finite(duration) && duration > 0 ? duration : 0;
  const ranges = validRanges(raw.ranges, seconds);
  // Older caches stored only watched seconds. Retain that baseline without
  // inventing where playback happened or adding it twice to new coverage.
  const legacyWatched = Math.min(seconds, Math.max(
    nonnegative(raw.legacyWatched),
    Array.isArray(raw.ranges) ? 0 : nonnegative(raw.watched),
  ));
  const coverage = ranges.reduce((total, [start, end]) => total + end - start, 0);
  const watched = Math.min(seconds, Math.max(legacyWatched, coverage));
  return {
    ranges, legacyWatched, watched,
    done: seconds > 0 && watched >= seconds * .9,
    position: Math.min(seconds, nonnegative(raw.position)),
  };
}

export function recordVideoRange(record, start, end, duration) {
  const previous = normalizeVideoProgress(record, duration);
  return normalizeVideoProgress({ ...previous, ranges: [...previous.ranges, [start, end]] }, duration);
}

function reportRecords(values) {
  const records = new Map();
  for (const row of Array.isArray(values) ? values : []) {
    if (!object(row) || !((typeof row.id === 'string' && row.id.trim()) || finite(row.id))) continue;
    const key = String(row.id);
    records.set(key, { ...records.get(key), ...row });
  }
  return [...records.values()];
}

export function normalizeLearningState(raw, courses, mediaMap = {}) {
  const input = object(raw) ? raw : {};
  const list = courseList(courses);
  const state = emptyLearningState(input.resetAt);
  for (const field of ['completed', 'reviewed']) state[field] = validIds(input[field], list);
  for (const c of list) {
    const answers = passedQuizIds(c, input);
    if (answers.length) state.quizAnswers[c.id] = answers;
    if (isQuizComplete(c, state)) state.quizPassed.push(c.id);
    const visited = sectionIndices(object(input.visited) ? input.visited[c.id] : null, c);
    if (visited.length) state.visited[c.id] = visited;
    if (object(input.videos) && object(input.videos[c.id])) {
      const duration = durationOf(mediaMap?.[c.id]);
      if (duration > 0) state.videos[c.id] = normalizeVideoProgress(input.videos[c.id], duration);
    }
  }
  state.demoReportSeen = input.demoReportSeen === true;
  state.realReports = reportRecords(input.realReports);
  return state;
}

export function mergeLearningState(a, b, courses, mediaMap = {}) {
  const left = normalizeLearningState(a, courses, mediaMap);
  const right = normalizeLearningState(b, courses, mediaMap);
  // Reset epochs win as a whole: a stale tab cannot resurrect cleared progress.
  if (left.resetAt !== right.resetAt) return left.resetAt > right.resetAt ? left : right;
  const list = courseList(courses);
  const merged = emptyLearningState(left.resetAt);
  for (const field of ['completed', 'reviewed']) merged[field] = validIds([...left[field], ...right[field]], list);
  for (const c of list) {
    const answers = passedQuizIds(c, { schemaVersion: SCHEMA_VERSION, quizAnswers: {
      [c.id]: [...(left.quizAnswers[c.id] || []), ...(right.quizAnswers[c.id] || [])],
    } });
    if (answers.length) merged.quizAnswers[c.id] = answers;
    if (isQuizComplete(c, merged)) merged.quizPassed.push(c.id);
    const visited = sectionIndices([...(left.visited[c.id] || []), ...(right.visited[c.id] || [])], c);
    if (visited.length) merged.visited[c.id] = visited;
    const first = left.videos[c.id], second = right.videos[c.id];
    if (first || second) merged.videos[c.id] = normalizeVideoProgress({
      ranges: [...(first?.ranges || []), ...(second?.ranges || [])],
      legacyWatched: Math.max(first?.legacyWatched || 0, second?.legacyWatched || 0),
      // The caller supplies its most recent snapshot as b. Position is a resume
      // hint; it never contributes to watched coverage or completion.
      position: second ? second.position : first.position,
    }, durationOf(mediaMap?.[c.id]));
  }
  merged.demoReportSeen = left.demoReportSeen || right.demoReportSeen;
  merged.realReports = reportRecords([...left.realReports, ...right.realReports]);
  return merged;
}

export function courseLearningProgress(course, state, media) {
  if (!object(course) || typeof course.id !== 'string') return 0;
  if (Array.isArray(state?.completed) && state.completed.includes(course.id)) return 100;
  const sectionCount = Array.isArray(course.sections) ? course.sections.length : 0;
  const duration = durationOf(media);
  const units = sectionCount + 1 + (duration > 0 ? 1 : 0);
  const read = sectionIndices(state?.visited?.[course.id], course).length;
  const quiz = quizProgress(course, state).ratio;
  const video = duration > 0 ? Math.min(1, normalizeVideoProgress(state?.videos?.[course.id], duration).watched / (duration * .9)) : 0;
  return Math.max(0, Math.min(100, Math.round((read + quiz + video) / units * 100)));
}

export function overallLearningProgress(courses, state, mediaMap = {}) {
  const list = courseList(courses);
  return list.length ? Math.round(list.reduce((total, c) => total + courseLearningProgress(c, state, mediaMap?.[c.id]), 0) / list.length) : 0;
}
