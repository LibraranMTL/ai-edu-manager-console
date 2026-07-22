const path = require('path');
const { parseAgentResultInput } = require('./agent-result-envelope.cjs');

const PROJECT_SCREENING_PARSER_VERSION = 'project-staging-screening-v2';

function parseProjectScreeningReceipt(content) {
  return parseAgentResultInput(content, { kind: 'project_screening' }).payload;
  /* istanbul ignore next -- retained as a legacy parser reference during protocol migration */
  const repairJsonBackslashes = (value) => String(value || '').replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
  const normalized = String(content || '')
    .replace(/^\uFEFF/, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
  const fenced = normalized.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : normalized;
  const firstObject = candidate.indexOf('{');
  const lastObject = candidate.lastIndexOf('}');
  const firstArray = candidate.indexOf('[');
  const lastArray = candidate.lastIndexOf(']');
  const objectJson = firstObject >= 0 && lastObject > firstObject ? candidate.slice(firstObject, lastObject + 1) : '';
  const arrayJson = firstArray >= 0 && lastArray > firstArray ? candidate.slice(firstArray, lastArray + 1) : '';
  const rawAttempts = [candidate.trim(), objectJson.trim(), arrayJson.trim()].filter(Boolean);
  const attempts = [...rawAttempts, ...rawAttempts.map(repairJsonBackslashes)];
  let lastError = null;
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('未找到 JSON 内容');
}

function recommendationsFromProjectScreening(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of ['recommendations', 'candidates', 'items', 'results']) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function normalizeProjectScreeningStatus(value) {
  const text = String(value || '').trim().toLowerCase();
  if (['promote', 'promotion', 'promoted', '晋升', '建议晋升', '正式资产'].includes(text)) return 'selected';
  if (['select', 'selected', 'analysis', 'analyze', '分析', '选入分析', '采用'].includes(text)) return 'selected';
  if (['screen', 'screened', '初筛', '已初筛', '候选'].includes(text)) return 'screened';
  if (['analyzed', '分析完成', '已分析'].includes(text)) return 'analyzed';
  if (['discard', 'discarded', 'skip', 'ignore', '丢弃', '跳过', '忽略', '低价值'].includes(text)) return 'discarded';
  if (['collect', 'collected', '收集', '已收集'].includes(text)) return 'collected';
  return '';
}

function normalizeProjectScreeningAction(value, fallbackStatus) {
  const text = String(value || '').trim();
  const lower = text.toLowerCase();
  if (['select', 'selected', 'promote', 'promotion', 'promoted'].includes(lower)) return '建议选入分析';
  if (['screen', 'screened'].includes(lower)) return '建议保留候选';
  if (['discard', 'discarded', 'skip', 'ignore'].includes(lower)) return '建议丢弃/归档';
  if (['analyzed', 'analysis'].includes(lower)) return '已分析';
  if (text) return text;
  if (fallbackStatus === 'selected') return '建议选入分析';
  if (fallbackStatus === 'discarded') return '建议丢弃/归档';
  if (fallbackStatus === 'screened') return '建议保留候选';
  if (fallbackStatus === 'analyzed') return '已分析';
  return '';
}

function normalizeSourceStrategy(value, fallback = '') {
  const text = String(value || '').trim().toLowerCase();
  if (['full_copy', 'full', 'copy', '完整副本', '保存完整副本'].includes(text)) return 'full_copy';
  if (['snapshot', '快照', '保存快照'].includes(text)) return 'snapshot';
  if (['reference_only', 'reference', 'link', '仅引用', '仅来源记录'].includes(text)) return 'reference_only';
  return fallback;
}

function normalizedPath(value) {
  if (!value) return '';
  try {
    return path.resolve(String(value)).toLowerCase();
  } catch {
    return String(value).toLowerCase();
  }
}

function buildProjectScreeningPreview(project, rawText) {
  const payload = parseProjectScreeningReceipt(rawText);
  const recommendations = recommendationsFromProjectScreening(payload);
  if (!recommendations.length) throw new Error('评估结果中没有 recommendations / candidates / items / results 数组。');
  const items = Array.isArray(project?.stagingItems) ? project.stagingItems : [];
  const indexes = { id: new Map(), sha1: new Map(), path: new Map(), filename: new Map() };
  for (const item of items) {
    indexes.id.set(String(item.id || ''), item);
    if (item.sha1) indexes.sha1.set(String(item.sha1), item);
    for (const value of [item.path, item.sourcePath]) {
      if (value) indexes.path.set(normalizedPath(value), item);
    }
    if (item.filename) indexes.filename.set(String(item.filename).toLowerCase(), item);
  }
  const matchedIds = new Set();
  const changes = [];
  const unmatched = [];
  recommendations.forEach((rec, index) => {
    if (!rec || typeof rec !== 'object') {
      unmatched.push({ index, reason: '评估项不是对象。' });
      return;
    }
    const candidates = [
      ['id', rec.id || rec.itemId || rec.stagingId],
      ['sha1', rec.sha1],
      ['path', rec.path || rec.sourcePath],
      ['filename', rec.filename || rec.name],
    ];
    let item = null;
    let matchBasis = '';
    for (const [basis, value] of candidates) {
      if (!value) continue;
      const key = basis === 'path' ? normalizedPath(value) : basis === 'filename' ? String(value).toLowerCase() : String(value);
      item = indexes[basis].get(key) || null;
      if (item) {
        matchBasis = basis;
        break;
      }
    }
    if (!item) {
      unmatched.push({ index, id: rec.id || rec.itemId || rec.stagingId || '', filename: rec.filename || rec.name || '', path: rec.path || rec.sourcePath || '', reason: '未匹配当前项目暂存资料。' });
      return;
    }
    if (matchedIds.has(String(item.id))) {
      unmatched.push({ index, id: rec.id || '', filename: rec.filename || rec.name || '', reason: `同一暂存资料重复匹配：${item.filename}` });
      return;
    }
    matchedIds.add(String(item.id));
    const toStatus = normalizeProjectScreeningStatus(rec.status || rec.action || rec.recommendation || rec.decision) || item.status;
    const reasons = Array.isArray(rec.reasons) ? rec.reasons.join('；') : '';
    const reason = String(rec.reason || rec.aiReason || reasons || rec.preview || '').slice(0, 1000);
    const score = Number(rec.score);
    changes.push({
      recommendationIndex: index,
      stagingId: item.id,
      filename: item.filename,
      matchBasis,
      fromStatus: item.status,
      toStatus,
      fromStrategy: item.sourceStrategy || '',
      toStrategy: normalizeSourceStrategy(rec.sourceStrategy || rec.saveStrategy || rec.storageStrategy, item.sourceStrategy || ''),
      aiAction: normalizeProjectScreeningAction(rec.action || rec.recommendation || rec.decision, toStatus),
      aiReason: reason,
      aiScore: rec.score === undefined || rec.score === '' || !Number.isFinite(score) ? item.aiScore : score,
    });
  });
  return {
    ok: changes.length > 0,
    parserVersion: PROJECT_SCREENING_PARSER_VERSION,
    projectId: project?.id || '',
    projectName: project?.name || '',
    parsedCount: recommendations.length,
    matchedCount: changes.length,
    unmatchedCount: unmatched.length,
    changes,
    unmatched,
    payload,
  };
}

module.exports = {
  PROJECT_SCREENING_PARSER_VERSION,
  buildProjectScreeningPreview,
  normalizeProjectScreeningStatus,
  normalizeSourceStrategy,
  parseProjectScreeningReceipt,
};
