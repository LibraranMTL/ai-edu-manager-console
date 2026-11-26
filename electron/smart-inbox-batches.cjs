'use strict';
const crypto = require('node:crypto');
const P = require('./smart-inbox-policy.cjs');

function needsHuman(item) {
  if (P.isTechnicalWait(item)) return false;
  if (['delivered', 'ignored'].includes(item.status)) return Boolean(item.learningReview);
  if (item.originalMissing || ['execution_unknown', 'delivery_reconcile'].includes(item.status)) return false;
  if (item.blockReason?.recoverable || ['pending', 'retry', 'analyzing', 'delivering', 'archive_pending'].includes(item.status)) return false;
  return item.status === 'review' && (!item.studentId || item.reasonCode === 'student_conflict'
    || Boolean(item.suggestion?.conflict) || Boolean(item.proposedTarget)
    || item.reasonCode === 'retention_decision');
}
function problemKey(item, reason) {
  return P.digest([item.studentId || '', item.sourceId, reason(item), item.proposedTarget || item.target || null,
    item.suggestion?.conflict ? item.suggestion.candidates : null, Boolean(item.learningReview)]);
}

function createInboxBatches({ init, items, sources, batches, save, now, changed, reason, previewOne, decide,
  checkCurrent, withItemLock, wake, allowed, decisionReceipt }) {
  const iso = () => new Date(now()).toISOString();
  const inScope = (item, query) => (!query.studentId || !item.studentId || item.studentId === query.studentId)
    && (!query.sourceId || item.sourceId === query.sourceId);
  function summarize(batch) {
    const counts = { pending: 0, processing: 0, delivered: 0, ignored: 0, review: 0, technicalWaiting: 0, sourceUnavailable: 0, skipped: 0, failed: 0 };
    for (const entry of batch.entries) {
      const row = items.get(entry.id);
      if (entry.message === '用户排除') counts.skipped++;
      else if (entry.state === 'pending') counts.pending++;
      else if (row?.status === 'delivered') counts.delivered++;
      else if (row?.status === 'ignored') counts.ignored++;
      else if (entry.state === 'skipped' && entry.message !== entry.reason) counts.skipped++;
      else if (row?.originalMissing) counts.sourceUnavailable++;
      else if (row && needsHuman(row)) counts.review++;
      else if (row && (row.status === 'review' || P.isTechnicalWait(row)
        || ['execution_unknown', 'delivery_reconcile', 'archive_pending'].includes(row.status))) counts.technicalWaiting++;
      else if (entry.state === 'skipped' || entry.state === 'failed') counts[entry.state]++;
      else counts.processing++;
    }
    return { id: batch.id, type: batch.type, studentId: batch.studentId, status: batch.status, action: batch.action,
      target: batch.target, targetStudentId: batch.targetStudentId,
      humanItems: batch.entries.filter(entry => entry.message !== '用户排除' && items.has(entry.id) && needsHuman(items.get(entry.id)))
        .slice(0, 25).map(entry => ({ id: entry.id, name: items.get(entry.id).name, reason: reason(items.get(entry.id)), message: items.get(entry.id).message })),
      total: batch.entries.length, counts, createdAt: batch.createdAt, expiresAt: batch.expiresAt,
      businessResult: counts.pending || counts.processing ? 'processing' : counts.technicalWaiting || counts.sourceUnavailable || counts.review || counts.failed || counts.skipped ? 'attention' : 'settled',
      previewCounts: batch.previewCounts, error: batch.error || '' };
  }
  return {
    async groups(query = {}) {
      await init();
      const grouped = new Map();
      for (const item of items.values()) {
        if (!inScope(item, query) || !needsHuman(item)) continue;
        const id = problemKey(item, reason);
        const group = grouped.get(id) || { id, studentId: item.studentId, sourceId: item.sourceId,
          sourceName: sources.get(item.sourceId)?.name || '', reason: item.learningReview ? 'learning_review' : reason(item),
          target: item.proposedTarget || item.target || null, total: 0, examples: [], actions: ['ignore'] };
        group.total++;
        if (group.examples.length < 3) group.examples.push({ id: item.id, name: item.name, message: item.message });
        if (item.originalMissing) group.actions = ['ignore'];
        else if (!item.learningReview && item.status === 'review' && item.proposedTarget && !item.suggestion?.conflict) group.actions = ['accept', 'correct', 'ignore', 'retry'];
        else if (!item.studentId) group.actions = ['confirm_student', 'correct', 'ignore'];
        else if (['execution_unknown', 'delivery_reconcile'].includes(item.status)) group.actions = ['reconcile'];
        else if (item.learningReview) group.actions = ['correct'];
        else group.actions = ['correct', 'ignore', 'retry'];
        grouped.set(id, group);
      }
      return { groups: [...grouped.values()], jobs: [...batches.values()].filter(batch => !query.studentId || batch.studentId === query.studentId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20).map(summarize) };
    },
    async preview(input = {}) {
      await init();
      if (!['backlog', 'group'].includes(input.type)) throw Error('批处理类型无效');
      const action = input.type === 'backlog' ? 'retry' : input.action;
      if (!['accept', 'correct', 'confirm_student', 'ignore', 'retry', 'reconcile'].includes(action)) throw Error('批处理动作无效');
      if (action === 'correct') P.target(input.target);
      if (action === 'confirm_student' && !input.targetStudentId) throw Error('请选择学生');
      const entries = [], previewCounts = {};
      for (const item of items.values()) {
        if (!inScope(item, input)) continue;
        if (input.type === 'group' ? problemKey(item, reason) !== input.groupId || !needsHuman(item)
          : ['delivered', 'ignored'].includes(item.status)) continue;
        const source = sources.get(item.sourceId);
        let result;
        if (input.type === 'backlog') result = await previewOne(item);
        else result = { id: item.id, name: item.name, revision: item.revision, sourceRevision: source?.revision,
          eligible: Boolean(source && !source.detached && (source.enabled || action === 'ignore')),
          suggestedAction: ['accept', 'correct'].includes(action) ? 'deliver' : ['retry', 'confirm_student'].includes(action) ? 'classify' : action === 'ignore' ? 'ignore' : 'confirm',
          reason: item.message || '', fingerprint: item.fingerprint || null };
        if (!source?.enabled && action !== 'ignore' || input.type === 'backlog' && !source.automatic && result.suggestedAction !== 'reconcile') result.eligible = false;
        const bucket = result.eligible ? result.suggestedAction : result.suggestedAction === 'wait' ? 'wait' : 'ineligible';
        previewCounts[bucket] = (previewCounts[bucket] || 0) + 1;
        entries.push({ ...result, state: result.eligible ? 'pending' : 'skipped', sourceId: item.sourceId,
          studentId: item.studentId, message: result.reason });
        await new Promise(resolve => setImmediate(resolve));
      }
      const batch = { id: crypto.randomUUID(), type: input.type, groupId: input.groupId || '', studentId: input.studentId || '',
        targetStudentId: input.targetStudentId || '', target: input.target || null, onlyThis: input.onlyThis === true,
        action, entries, previewCounts, status: 'preview', createdAt: iso(), expiresAt: new Date(now() + 15 * 60_000).toISOString() };
      await save('batches', batch);
      return { ...summarize(batch), entries: entries.slice(0, 25) };
    },
    async detail(input = {}) {
      await init(); const batch = batches.get(input.id);
      if (!batch) throw Error('批任务不存在');
      const page = Math.max(1, Math.floor(Number(input.page) || 1));
      return { ...summarize(batch), page, entries: batch.entries.slice((page - 1) * 25, page * 25).map(entry => ({
        ...entry, currentStatus: items.get(entry.id)?.status || 'missing' })) };
    },
    async control(input = {}) {
      await init();
      const batch = batches.get(input.id);
      if (!batch) throw Error('批任务不存在');
      if (!['start', 'pause', 'resume'].includes(input.action)) throw Error('批任务操作无效');
      if (input.action === 'start') {
        if (input.confirmed !== true) throw Error('请确认批处理预览');
        const signature = P.digest([...(input.excludeIds || [])].sort());
        if (batch.startSignature) {
          if (batch.startSignature !== signature) throw Error('已确认批次的排除范围不能改变');
          return summarize(batch);
        }
        if (batch.status !== 'preview' || Date.parse(batch.expiresAt) <= now()) throw Error('预览已过期，请重新试算');
        const exclude = new Set(input.excludeIds || []);
        if ([...exclude].some(id => !batch.entries.some(entry => entry.id === id))) throw Error('排除项超出预览范围');
        await save('batches', { ...batch, status: 'running', startSignature: signature,
          entries: batch.entries.map(entry => exclude.has(entry.id) ? { ...entry, state: 'skipped', message: '用户排除' } : entry) });
      } else {
        if (!['running', 'paused'].includes(batch.status)) throw Error('此批次不能暂停或继续');
        await save('batches', { ...batch, status: input.action === 'pause' ? 'paused' : 'running' });
      }
      changed?.(); wake(); return summarize(batches.get(batch.id));
    },
    async process() {
      let progress = false;
      for (const original of batches.values()) {
        if (original.status !== 'running') continue;
        let count = 0;
        for (const entry of original.entries) {
          const batch = batches.get(original.id);
          if (batch.status !== 'running' || count >= 20 || !allowed(batch.studentId)) break;
          if (entry.state !== 'pending') continue;
          count++; progress = true;
          let result;
          try {
            const recovered = await decisionReceipt(`${batch.id}-${entry.id}`);
            result = (recovered?.result?.results || recovered?.results)?.[0];
            if (!result) {
            let item = items.get(entry.id); const source = item && sources.get(item.sourceId);
            if (!item || !source || !source.enabled && batch.action !== 'ignore' || source.detached || source.revision !== entry.sourceRevision
              || item.revision !== entry.revision || item.studentId !== entry.studentId) throw Error('资料或来源版本已变化');
            const entryAction = batch.type === 'backlog' && entry.suggestedAction === 'reconcile' ? 'reconcile' : batch.action;
            if (batch.type === 'backlog' && (entryAction !== 'reconcile' && (!source.automatic || item.receipt) || item.manualLocked)) throw Error('资料已投递、人工锁定或来源自动化关闭');
            await withItemLock(item.id, async () => {
              item = items.get(entry.id);
              if (!['ignore', 'reconcile'].includes(entryAction)) await checkCurrent(item, source);
              if (entry.fingerprint?.sha256 && item.fingerprint?.sha256 && entry.fingerprint.sha256 !== item.fingerprint.sha256) throw Error('原件指纹已变化');
              await save('items', { ...item, automationEligible: true, automationBatchId: batch.id });
            });
            const decision = await decide({ requestId: `${batch.id}-${entry.id}`, action: entryAction, onlyThis: batch.onlyThis,
              items: [{ id: entry.id, revision: entry.revision, studentId: batch.targetStudentId,
                target: batch.target || undefined, confirmedStudentChange: batch.action === 'correct' }] });
            result = { ...decision.results[0], failed: decision.results[0]?.ok === false };
            }
          } catch (error) { result = { ok: false, message: error.message }; }
          const current = batches.get(original.id);
          await save('batches', { ...current, entries: current.entries.map(value => value.id === entry.id
            ? { ...value, state: result.ok ? 'queued' : result.failed ? 'failed' : 'skipped', message: result.message || '' } : value) });
        }
        const current = batches.get(original.id), summary = summarize(current);
        if (current.status === 'running' && !summary.counts.pending && !summary.counts.processing) {
          await save('batches', { ...current, status: 'complete', completedAt: iso() }); progress = true;
        }
      }
      if (progress) changed?.(); return progress;
    },
  };
}
module.exports = { createInboxBatches, needsHuman, problemKey };
