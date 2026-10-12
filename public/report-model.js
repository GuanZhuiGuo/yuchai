const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const list = value => Array.isArray(value) ? value : [];
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = value => typeof value === 'string' ? value : '';
const boolean = value => typeof value === 'boolean' ? value : null;
const speaker = role => role === 'user' ? 'learner' : role === 'assistant' ? 'customer' : null;

const emptyRecommendationValues = new Set([
  '无', '暂无', '无建议', '暂无建议', '无改进建议', '暂无改进建议', '暂无相关建议',
  '无需', '无需改进', '无需修改', '无需调整', '无需复习',
  '暂无数据', '无数据', '未提供', '未返回', '未返回建议', '不适用',
  'null', 'undefined', 'none', 'n/a', 'na', '-', '--', '—', '–',
]);

export function meaningfulRecommendationText(value) {
  const result = text(value).trim();
  const marker = result.toLowerCase().replace(/[\s。.!！:：;；,，]+/gu, '');
  return result && !emptyRecommendationValues.has(marker) ? result : '';
}

export function validReviewRecommendations(values) {
  return list(values).flatMap(value => {
    const recommendation = object(value);
    const courseId = text(recommendation.courseId).trim();
    const title = meaningfulRecommendationText(recommendation.title);
    const reason = meaningfulRecommendationText(recommendation.reason);
    return courseId && title && reason ? [{ ...recommendation, courseId, title, reason }] : [];
  });
}

export function matchReportCourse(value, courses) {
  const name = text(value);
  const mappings = [
    ['c1', /开场|身份|礼貌/u],
    ['c5', /谈判|成交|跟进|独家|准入|下一步|决策推动|商务|试销|收尾|结束语/u],
    ['c2', /需求|痛点|决策链|复述|信息确认|工况|经营影响|经营现状/u],
    ['c4', /异议|风险|顾虑|客诉|投诉|根因|调查|临时处置|证据保全|事实核查/u],
    ['c3', /技术|产品|服务保障|方案|价值|售后|运营|备件|适配|规范偏差|负载|验证|测试|并机|冗余|成本|TCO|可靠性证据|性能边界/iu],
    ['c1', /信任|态度|表达/u],
  ];
  const courseId = mappings.find(([, pattern]) => pattern.test(name))?.[0];
  return courseId && list(courses).some(course => object(course).id === courseId) ? courseId : null;
}

export function buildLiveRecommendations(rules, courses) {
  const dimensions = list(rules).map((value, index) => {
    const dimension = object(value);
    return { dimension, index, ratio: scoreRatio(dimension.eval_score, dimension.eval_total_score) };
  }).filter(value => value.ratio !== null && value.ratio < 0.8)
    .sort((a, b) => a.ratio - b.ratio || a.index - b.index);
  const recommendations = [], seen = new Set();
  for (const { dimension } of dimensions) {
    const topics = list(dimension.related_scene).flatMap(scene => list(object(scene).topics));
    const candidates = [...topics, { name: dimension.name, suggestion: dimension.eval_suggestion }];
    for (const value of candidates) {
      const candidate = object(value);
      const reason = meaningfulRecommendationText(candidate.suggestion);
      if (!reason) continue;
      const courseId = matchReportCourse(candidate.name, courses) || matchReportCourse(reason, courses);
      if (!courseId || seen.has(courseId)) continue;
      const course = courses.find(value => object(value).id === courseId);
      const courseName = meaningfulRecommendationText(course.subtitle) || meaningfulRecommendationText(course.title);
      if (!courseName) continue;
      seen.add(courseId);
      recommendations.push({ courseId, title: `建议回看：${courseName}`, reason });
      if (recommendations.length === 3) return recommendations;
    }
  }
  return recommendations;
}

// Keep a review attached to a verified practice identity. A shared course's
// scenario-specific practicePrompt must never become another scenario's advice.
export function reportReviewContext(report, practices) {
  const value = object(report);
  const practice = list(practices).find(candidate => {
    const item = object(candidate);
    return value.practiceId ? item.id === value.practiceId :
      finite(value.planId) !== null && item.planId === value.planId;
  }) || null;
  const recommendations = validReviewRecommendations(value.reviewRecommendations);
  const reportAdvice = recommendations[0]?.reason || '';
  const scenarioGoal = practice ? list(practice.goals).map(meaningfulRecommendationText).find(Boolean) || '' : '';
  return {
    practice, recommendations,
    takeaway: reportAdvice || scenarioGoal,
    takeawaySource: reportAdvice ? '本次报告的评分建议' : scenarioGoal ? '本场景练习目标' : '',
    retryRoute: !value.isMock && practice ? `prepare/${practice.id}` : 'assessment',
  };
}

const oppositeClaims = [
  {
    topic: /开场/u,
    positive: /(?:符合|满足|遵守)[^，。；;]{0,45}开场[^，。；;]{0,12}(?:规范|要求)/u,
    negative: /(?:开场[^，。；;]{0,18}(?:未(?:按|符合|满足|遵守|完成|达到|覆盖)|不(?:符合|满足|遵守|完整)|缺少|缺失|遗漏)|(?:未(?:按|符合|满足|遵守|完成|达到)|不(?:符合|满足|遵守))[^，。；;]{0,16}开场)/u,
  },
  {
    topic: /(?:玉柴|企业|公司)介绍/u,
    positive: /(?:符合|满足|完成)[^，。；;]{0,30}(?:玉柴|企业|公司)介绍[^，。；;]{0,12}(?:规范|要求)/u,
    negative: /(?:未(?:按|符合|满足|完成|覆盖)|不(?:符合|满足|完整)|缺少|缺失)[^，。；;]{0,25}(?:玉柴|企业|公司)介绍/u,
  },
];

function explicitPositive(value, pattern) {
  // Negative phrases such as "不符合开场规范" contain the positive substring.
  // Removing that clause avoids turning a negative judgement into a conflict.
  return text(value).split(/[，。；;]/u).some(clause =>
    !/(?:未|不|没有)(?:能|完全)?(?:符合|满足|遵守|完成)/u.test(clause) && pattern.test(clause));
}

export function reportFeedbackConflicts(dimensions, transcript) {
  const turns = new Map(list(transcript).map(turn => [object(turn).id, object(turn)]));
  const conflicts = [];
  for (const dimensionValue of list(dimensions)) {
    const dimension = object(dimensionValue);
    for (const itemValue of list(dimension.items)) {
      const item = object(itemValue);
      const claim = oppositeClaims.find(value => value.topic.test(text(item.title)) && value.negative.test(text(item.reason)));
      if (!claim) continue;
      // Only an unambiguous same-role, exact-text citation establishes that the
      // opposing statements concern this turn. Generic "good" is insufficient.
      for (const turnId of list(item.turnIds)) {
        const turn = turns.get(turnId);
        if (!turn || turn.speaker !== 'learner' || claim.negative.test(turn.evaluation) || !explicitPositive(turn.evaluation, claim.positive)) continue;
        conflicts.push({
          id: `${item.id}:${turnId}`, turnId, itemId: item.id, dimensionId: dimension.id,
          title: text(item.title), evaluation: text(turn.evaluation),
          reason: text(item.reason), advice: meaningfulRecommendationText(item.advice),
        });
      }
    }
  }
  return conflicts;
}

export function scoreRatio(score, maxScore) {
  return finite(score) !== null && finite(maxScore) !== null && maxScore > 0 && score >= 0 && score <= maxScore
    ? score / maxScore : null;
}

export function radarAxes(dimensions) {
  return list(dimensions).map(value => {
    const dimension = object(value);
    return {
      id: dimension.id,
      title: dimension.title,
      score: dimension.score,
      maxScore: dimension.maxScore,
      weight: dimension.weight,
      ratio: scoreRatio(dimension.score, dimension.maxScore),
    };
  });
}

export function normalizeReportDetail(raw) {
  const report = object(raw);
  const detail = object(report.report_detail);
  const transcript = list(detail.turn_evaluations).map((value, index) => {
    const turn = object(value);
    return {
      id: `rt${index}`,
      speaker: speaker(turn.role),
      text: text(turn.content),
      evaluationLevel: text(turn.evaluation_level),
      evaluation: text(turn.evaluation),
      itemIds: [],
      ambiguousItemIds: [],
    };
  });

  const dimensions = list(detail.evaluation_rule).map((value, dimensionIndex) => {
    const dimension = object(value);
    const id = `live${dimensionIndex}`;
    const items = list(dimension.related_scene).flatMap((sceneValue, sceneIndex) => {
      const scene = object(sceneValue);
      return list(scene.topics).map((topicValue, topicIndex) => {
        const topic = object(topicValue);
        const itemId = `${id}-scene${sceneIndex}-topic${topicIndex}`;
        const references = list(topic.related_text).map(value => {
          const reference = object(value);
          const referenceSpeaker = speaker(reference.type);
          const referenceText = text(reference.text);
          const matches = referenceSpeaker && referenceText
            ? transcript.filter(turn => turn.speaker === referenceSpeaker && turn.text === referenceText)
            : [];
          return {
            speaker: referenceSpeaker,
            text: referenceText,
            turnId: matches.length === 1 ? matches[0].id : null,
            candidateTurnIds: matches.map(turn => turn.id),
            ambiguous: matches.length > 1,
          };
        });
        const turnIds = [...new Set(references.flatMap(reference => reference.turnId ? [reference.turnId] : []))];
        for (const reference of references) {
          for (const candidateId of reference.candidateTurnIds) {
            const turn = transcript.find(value => value.id === candidateId);
            const related = reference.ambiguous ? turn.ambiguousItemIds : turn.itemIds;
            if (!related.includes(itemId)) related.push(itemId);
          }
        }
        return {
          id: itemId,
          title: text(topic.name) || `练习细项 ${topicIndex + 1}`,
          score: finite(topic.score),
          // The observed report does not define a topic denominator in the score's scale.
          maxScore: null,
          reason: text(topic.reason),
          advice: text(topic.suggestion),
          counted: boolean(topic.is_should_counted),
          initiated: boolean(topic.should_user_initiate),
          references,
          evidence: references.map(reference => `${reference.speaker === 'learner' ? '学员' : reference.speaker === 'customer' ? '客户' : '发言'}：${reference.text}`).join('；'),
          turnIds,
          ambiguous: references.some(reference => reference.ambiguous),
        };
      });
    });
    return {
      id,
      title: text(dimension.name) || `维度 ${dimensionIndex + 1}`,
      score: finite(dimension.eval_score),
      maxScore: finite(dimension.eval_total_score),
      weight: finite(dimension.weight),
      reason: text(dimension.eval_reason),
      advice: text(dimension.eval_suggestion),
      items,
    };
  });

  const roundCount = finite(report.dialogue_round_count);
  return {
    totalScore: finite(detail.final_score),
    maxScore: 100,
    passingScore: finite(detail.passing_score),
    summary: text(detail.final_conclusion),
    finishedTime: text(detail.finished_time),
    roundCount: roundCount !== null && Number.isInteger(roundCount) && roundCount >= 0 ? roundCount : null,
    dimensions,
    transcript,
  };
}
