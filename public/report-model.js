const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const list = value => Array.isArray(value) ? value : [];
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = value => typeof value === 'string' ? value : '';
const boolean = value => typeof value === 'boolean' ? value : null;
const speaker = role => role === 'user' ? 'learner' : role === 'assistant' ? 'customer' : null;

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
          title: text(topic.name) || `考核细项 ${topicIndex + 1}`,
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
