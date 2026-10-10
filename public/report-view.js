import { scoreRatio, radarAxes } from './report-model.js';

const tabs = [['overview', '能力概览'], ['scoring', '评分依据'], ['replay', '逐句复盘']];
const num = value => typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value * 10) / 10) : '—';
const pct = ratio => ratio === null ? '未形成评分' : `${num(ratio * 100)}%`;
const roleName = speaker => speaker === 'learner' ? '学员' : speaker === 'customer' ? 'AI 客户' : '其他发言';
const levelNames = { good: '良好', excellent: '优秀', normal: '一般', medium: '一般', bad: '需改进', poor: '需改进' };

function content(r) {
  const transcript = (r.transcript || []).map(t => ({ ...t, itemIds: t.itemIds || [] }));
  const dimensions = (r.dimensions || []).map((d, index) => ({
    ...d, index, dimensionId: d.dimensionId || d.id || `dimension${index}`,
    items: (d.items || []).map((item, itemIndex) => {
      const itemId = item.itemId || item.id || `item${index}-${itemIndex}`;
      const sampleReferences = r.isMock ? transcript.filter(t => t.itemIds.includes(itemId)).map(t => ({
        speaker: t.speaker, text: t.text, turnId: t.id, candidateTurnIds: [t.id], ambiguous: false
      })) : [];
      return { ...item, itemId, references: item.references || sampleReferences };
    })
  }));
  return { dimensions, transcript };
}

export function initialReportUI() {
  return { tab: 'overview', filter: 'all', dimension: null, topic: null, highlighted: [] };
}

function conclusion(summary, esc) {
  const value = summary || '本次报告未返回总体评价。';
  const characters = [...value];
  if (characters.length <= 160) return `<p class="report-conclusion">${esc(value)}</p>`;
  return `<details class="report-conclusion-expand"><summary><span class="report-conclusion-preview">${esc(characters.slice(0, 100).join(''))}…</span><span class="report-conclusion-control"><span class="when-closed">阅读完整总体评价</span><span class="when-open">收起总体评价</span></span></summary><p class="report-conclusion">${esc(value)}</p></details>`;
}

export function reportPage(r, ctx, ui) {
  const { esc, icon } = ctx;
  const valid = typeof r.totalScore === 'number' && Number.isFinite(r.totalScore);
  const pass = r.isMock ? 60 : r.passingScore;
  const hasPass = typeof pass === 'number' && Number.isFinite(pass);
  const reached = valid && hasPass && r.totalScore >= pass;
  const state = valid ? hasPass ? reached ? '达到合格分' : '建议复练' : '已生成评分' : '等待有效评分';
  const source = r.isMock ? '固定参考样例' : r.isSyntheticVerification ? r.verificationLabel : '本次实战报告';
  const dims = r.dimensions || [];
  const footer = r.isMock ? '固定样例用于说明报告结构，不计入学员成绩。' :
    r.isSyntheticVerification ? `本记录为${r.verificationLabel}，不计入学员成绩。` : '分数与评价来自本次实战的服务端报告。';
  return `<div class="report-cover">
    <div class="report-source"><span class="tag ${r.isMock || r.isSyntheticVerification ? 'amber' : 'green'}">${esc(source)}</span><span>${r.isMock ? '阅读参考' : `练习 ${esc(r.id)}`}</span></div>
    <h2>${esc(r.scenarioTitle)}</h2>
    <div class="report-result"><div class="report-total"><span>${valid ? num(r.totalScore) : '—'}</span><small>/ ${num(r.maxScore)} 分</small></div><div class="report-verdict ${reached ? 'is-passed' : ''}"><strong>${state}</strong><span>${hasPass ? `合格分 ${num(pass)} 分` : '报告未返回合格阈值'}</span></div></div>
    ${conclusion(r.summary, esc)}
    <div class="report-facts"><span>${icon('clock')}${esc(r.durationLabel || '未返回对话时长')}</span><span>${dims.length} 个评价维度</span></div>
    <p class="report-source-note">${esc(footer)}</p>
  </div>
  <div class="report-tabs" role="group" aria-label="报告阅读方式">${tabs.map(([key, label]) => `<button type="button" data-action="report-tab" data-tab="${key}" aria-pressed="${ui.tab === key}">${label}</button>`).join('')}</div>
  <div id="report-panel" class="report-panel">${reportPanel(r, ctx, ui)}</div>
  <div class="report-finish"><a class="button full" href="#${r.isMock ? 'assessment' : `prepare/${esc(r.practiceId || 'p-overseas')}`}">再练一次，检验改变 ${icon('arrow')}</a></div>`;
}

function radar(dimensions, esc) {
  const axes = radarAxes(dimensions);
  if (axes.length < 3) return '<p class="report-empty">有效维度结构不足，暂不绘制雷达图。下方保留原始分值。</p>';
  const n = axes.length, cx = 180, cy = 152, radius = 91;
  const at = (i, r) => {
    const angle = -Math.PI / 2 + i * Math.PI * 2 / n;
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
  };
  const point = ([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`;
  const complete = axes.every(a => a.ratio !== null);
  const grid = [.25, .5, .75, 1].map(q => `<polygon points="${axes.map((_, i) => point(at(i, radius * q))).join(' ')}" class="radar-grid"/>`).join('');
  const spokes = axes.map((_, i) => `<line x1="${cx}" y1="${cy}" x2="${at(i, radius)[0]}" y2="${at(i, radius)[1]}" class="radar-spoke"/>`).join('');
  const polygon = complete ? `<polygon points="${axes.map((a, i) => point(at(i, radius * a.ratio))).join(' ')}" class="radar-value"/>` : '';
  const segments = !complete ? axes.map((a, i) => {
    const next = axes[(i + 1) % n];
    if (a.ratio === null || next.ratio === null) return '';
    const p = at(i, radius * a.ratio), q = at((i + 1) % n, radius * next.ratio);
    return `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" class="radar-segment"/>`;
  }).join('') : '';
  const nodes = axes.map((a, i) => a.ratio === null ? '' : `<circle cx="${at(i, radius * a.ratio)[0]}" cy="${at(i, radius * a.ratio)[1]}" r="4" class="radar-node"/>`).join('');
  const labels = axes.map((a, i) => {
    const p = at(i, radius + 28);
    const label = a.title.replace(/得分$/u, '');
    const chunks = label.match(/.{1,7}/gu) || ['未命名维度'];
    return `<text x="${p[0]}" y="${p[1] - (chunks.length - 1) * 7}" class="radar-label" text-anchor="middle">${chunks.slice(0, 3).map((text, line) => `<tspan x="${p[0]}" dy="${line ? 14 : 0}">${esc(text)}</tspan>`).join('')}</text>`;
  }).join('');
  return `<svg class="report-radar" viewBox="0 0 360 304" role="img" aria-label="${esc(`能力雷达图。${axes.map(a => `${a.title}：${pct(a.ratio)}`).join('；')}`)}"><title>各维度得分率</title>${grid}${spokes}<text x="188" y="73" class="radar-scale">100%</text><text x="188" y="119" class="radar-scale">50%</text>${polygon}${segments}${nodes}${labels}</svg>`;
}

function recommendations(r, ctx) {
  const { esc, icon } = ctx;
  return `<section class="report-priorities"><h3>下一次，先练这几件事</h3>${(r.reviewRecommendations || []).length ? r.reviewRecommendations.map(x => `<a href="#reader/${esc(x.courseId)}/0?review=1" class="report-recommendation"><span>${icon('refresh')}</span><div><strong>${esc(x.title)}</strong><p>${esc(x.reason)}</p></div>${icon('chevron')}</a>`).join('') : '<p class="report-help">本次没有可自动对应的复习课程。请先阅读评分原因与改进建议。</p>'}</section>`;
}

function overview(r, ctx, model) {
  const { esc, icon } = ctx, { dimensions } = model;
  const known = dimensions.filter(d => scoreRatio(d.score, d.maxScore) !== null).length;
  return `<section class="report-chart-section"><div class="report-section-heading"><h3>能力雷达</h3><span>${known} / ${dimensions.length} 维可计算</span></div>
    <p class="report-help">按每个维度的得分率比较表现，满分为 100%。</p>
    ${radar(dimensions, esc)}
    ${known < dimensions.length ? '<div class="report-data-note">部分维度缺少有效分母，雷达保留缺口，不将缺失数据记为零分。</div>' : ''}
    <div class="report-axis-list">${dimensions.map((d, index) => {
      const ratio = scoreRatio(d.score, d.maxScore);
      return `<button data-action="report-dimension" data-index="${index}"><span class="axis-dot ${ratio === null ? 'unknown' : ''}"></span><span>${esc(d.title)}</span><strong>${pct(ratio)}</strong>${icon('chevron')}</button>`;
    }).join('')}</div>
    <p class="report-help report-method">${r.isMock ? '本图使用固定样例的 8 个维度。' : '本图使用本次实战返回的评分维度。'}点击维度可查看原始分值与评价依据，雷达不参与总分计算。</p>
  </section>${recommendations(r, ctx)}
  <button class="report-replay-entry" data-action="report-tab" data-tab="replay">${icon('file')}<span><strong>回到每一句客户对话</strong><small>${r.isMock ? '查看参考对话节选与评分关联' : '查看学员发言、接口点评与相关考核话题'}</small></span>${icon('arrow')}</button>`;
}

function topic(item, r, ctx) {
  const { esc, icon, course } = ctx;
  const ratio = scoreRatio(item.score, item.maxScore);
  const scoreText = ratio !== null ? `${num(item.score)} / ${num(item.maxScore)} 分` : typeof item.score === 'number' ? `原始分 ${num(item.score)}` : '未返回分值';
  const lost = ratio !== null ? item.maxScore - item.score : null;
  const reason = item.reason || (r.isMock ? item.evidence : '');
  return `<div class="report-topic" id="report-topic-${esc(item.itemId)}" tabindex="-1">
    <div class="topic-heading"><h4>${esc(item.title)}</h4><span>${scoreText}</span></div>
    <div class="topic-status">${item.counted === false ? '<span class="tag">未纳入计分</span>' : item.counted === true ? '<span class="tag">已纳入计分</span>' : ''}${lost !== null && lost > 0 ? `<span class="topic-loss">少 ${num(lost)} 分</span>` : ''}</div>
    <dl class="report-reason"><div><dt>${r.isMock ? '样例评价依据' : '评分原因'}</dt><dd>${esc(reason || '接口未返回本项评价原因。')}</dd></div>${item.advice ? `<div><dt>下次这样做</dt><dd>${esc(item.advice)}</dd></div>` : ''}</dl>
    ${(item.references || []).length ? `<div class="report-quotes"><h5>${r.isMock ? '关联的对话节选' : '相关对话原文'}</h5>${item.references.map(ref => {
      const targets = ref.turnId ? [ref.turnId] : ref.ambiguous ? ref.candidateTurnIds || [] : [];
      return `<blockquote><span>${roleName(ref.speaker)}</span><p>${esc(ref.text)}</p>${targets.length ? `<button class="text-button" data-action="report-jump" data-turns="${esc(targets.join(','))}">${targets.length === 1 ? '定位这句发言' : `核对 ${targets.length} 处相同发言`}${icon('arrow')}</button>` : '<small class="quote-location-note">该引用未匹配到本次对话，暂无法定位。</small>'}</blockquote>`;
    }).join('')}</div>` : `<p class="report-help">${r.isMock ? '该项没有关联到此份对话节选。' : '本项未返回可定位的对话引用。'}</p>`}
    ${item.observationLimit ? `<p class="report-observation">${esc(item.observationLimit)}</p>` : ''}
    ${item.courseId ? `<a class="text-button topic-course" href="#reader/${esc(item.courseId)}/0?review=1">回看「${esc(course(item.courseId).subtitle)}」${icon('arrow')}</a>` : ''}
  </div>`;
}

function scoring(r, ctx, ui, model) {
  const { esc, icon } = ctx, { dimensions } = model;
  const valid = dimensions.map((d, i) => ({ index: i, ratio: scoreRatio(d.score, d.maxScore) })).filter(d => d.ratio !== null);
  const initial = valid.sort((a, b) => a.ratio - b.ratio)[0]?.index ?? 0;
  const opened = ui.dimension ?? initial;
  return `<div class="report-section-heading"><h3>评分与改进依据</h3><span>${dimensions.reduce((sum, d) => sum + d.items.length, 0)} 项话题</span></div>
    <p class="report-help">${r.isMock ? '固定样例的细项可查看满分与失分。' : '维度显示原始得分和权重。细项未返回满分时，仅展示原始分，不推算扣分；未纳入计分的话题单独标识。'}</p>
    <div class="report-dimensions">${dimensions.map((d, i) => {
      const ratio = scoreRatio(d.score, d.maxScore);
      return `<details class="report-dimension" id="report-dimension-${i}" ${i === opened ? 'open' : ''}>
        <summary><div><strong>${esc(d.title)}</strong><small>${typeof d.weight === 'number' ? `权重 ${num(d.weight)}% · ` : ''}${ratio === null ? '缺少有效评分数据' : `得分率 ${pct(ratio)}`}</small></div><span>${ratio === null ? '未形成评分' : `${num(d.score)} / ${num(d.maxScore)}`} ${icon('chevron')}</span></summary>
        ${ratio !== null ? `<div class="report-score-track"><span style="width:${ratio * 100}%"></span></div>` : ''}
        <div class="report-dimension-content">${d.reason ? `<dl class="report-reason"><div><dt>维度评分原因</dt><dd>${esc(d.reason)}</dd></div></dl>` : ''}${d.advice ? `<dl class="report-reason"><div><dt>维度改进建议</dt><dd>${esc(d.advice)}</dd></div></dl>` : ''}
        ${d.items.length ? d.items.map(item => topic(item, r, ctx)).join('') : `<p class="report-empty">${ratio === null ? '本维度未形成有效评分，也未返回细项原因。' : '该维度未返回细项；以上保留维度评价。'}</p>`}</div>
      </details>`;
    }).join('')}</div>`;
}

function replay(r, ctx, ui, model) {
  const { esc, icon } = ctx, { dimensions, transcript } = model;
  const items = new Map(dimensions.flatMap((d, index) => d.items.map(item => [item.itemId, { ...item, dimensionIndex: index }])));
  const turns = transcript.map((turn, index) => ({ ...turn, order: index + 1 }));
  const learnerComments = turns.filter(t => t.speaker === 'learner' && t.evaluation).length;
  const visible = turns.filter(t => ui.filter === 'learner' ? t.speaker === 'learner' : ui.filter === 'feedback' ? t.evaluation || t.itemIds.some(id => items.has(id)) || (t.ambiguousItemIds || []).some(id => items.has(id)) : true);
  return `<div class="report-section-heading"><h3>逐句复盘</h3><span>${turns.length} 条发言</span></div>
    <p class="report-help">${r.isMock ? '参考案例对话节选。关联标签指向样例评分，时间仅为示例。' : `${learnerComments} 条学员发言带有接口点评。按返回顺序复盘，点评等级不代表逐句数字评分。`}</p>
    <div class="replay-filters" role="group" aria-label="筛选复盘发言">${[['all', '全部发言'], ['learner', '仅看学员'], ['feedback', '含点评或评分关联']].map(([key, label]) => `<button data-action="report-filter" data-filter="${key}" aria-pressed="${ui.filter === key}">${label}</button>`).join('')}</div>
    ${ui.highlighted.length > 1 ? '<div class="report-data-note">原文重复出现，接口未提供定位标识。已标出所有同文发言，请结合上下文核对。</div>' : ''}
    <div class="review-timeline">${visible.length ? visible.map(t => {
      const related = (t.itemIds || []).map(id => items.get(id)).filter(Boolean);
      return `<article class="review-turn ${t.speaker === 'learner' ? 'is-learner' : ''} ${ui.highlighted.includes(t.id) ? 'is-highlighted' : ''}" id="report-turn-${esc(t.id)}" data-turn-id="${esc(t.id)}" tabindex="-1">
        <div class="review-turn-heading"><span class="turn-sequence">${String(t.order).padStart(2, '0')}</span><strong>${roleName(t.speaker)}</strong>${r.isMock && t.time ? `<small>示例 ${esc(t.time)}</small>` : ''}</div>
        <p class="review-utterance">${esc(t.text)}</p>
        ${t.evaluation ? `<div class="turn-feedback"><div><span>${icon('checkCircle')}本句点评</span>${t.evaluationLevel ? `<b class="evaluation-level">${esc(levelNames[t.evaluationLevel] || t.evaluationLevel)}</b>` : ''}</div><p>${esc(t.evaluation)}</p></div>` : ''}
        ${related.length ? `<div class="turn-topics"><span>${r.isMock ? '样例评分关联' : '相关考核话题'}</span>${related.map(item => `<button data-action="report-topic" data-index="${item.dimensionIndex}" data-topic="${esc(item.itemId)}">${esc(item.title)}${icon('chevron')}</button>`).join('')}</div>` : ''}
        ${(t.ambiguousItemIds || []).length ? '<p class="report-help">存在同文引用，话题关联需结合上下文核对。</p>' : ''}
      </article>`;
    }).join('') : '<p class="report-empty">当前筛选没有发言。切换“全部发言”可查看已有记录。</p>'}</div>
    ${!turns.length ? '<div class="report-data-note">报告没有返回对话原文，暂时无法逐句复盘。请保留本次记录并联系课程管理员。</div>' : ''}
    ${!r.isMock ? '<p class="report-help report-method">当前报告未提供发言时间点和录音回放地址；客户发言保留作上下文。相关话题按同角色、同原文匹配，重复原文不强行定位。</p>' : ''}`;
}

export function reportPanel(r, ctx, ui) {
  const model = content(r);
  if (ui.tab === 'scoring') return scoring(r, ctx, ui, model);
  if (ui.tab === 'replay') return replay(r, ctx, ui, model);
  return overview(r, ctx, model);
}
