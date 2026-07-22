const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const TRANSACTION_SCHEMA = 'edu-manager.knowledge-promotion-transaction.v1';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function markerFor(candidateId, transactionId) {
  return {
    begin: `<!-- knowledge-candidate:${candidateId}:transaction:${transactionId}:begin -->`,
    end: `<!-- knowledge-candidate:${candidateId}:transaction:${transactionId}:end -->`,
  };
}

function promotionBlock(candidate, transactionId, promotedAt) {
  const marker = markerFor(candidate.id, transactionId);
  const source = candidate.source || {};
  const lines = [
    marker.begin,
    `## 候选晋升 ${candidate.id}`,
    '',
    String(candidate.content || '').trim(),
    '',
    `- 来源：${source.sourceUri || source.sourcePath || source.sourceId || '-'}`,
    `- 定位：${source.messageId || source.locator || '-'}`,
    `- 原文：${String(source.snippet || '').replace(/\r?\n/g, ' ') || '-'}`,
    `- 晋升时间：${promotedAt}`,
    `- 事务：${transactionId}`,
    marker.end,
  ];
  return `${lines.join('\n')}\n`;
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, content, 'utf8');
  fs.renameSync(temp, file);
}

function applyPromotionTransaction({ transactionId, studentId, candidates, resolveTarget, promotedAt = new Date().toISOString(), onProgress }) {
  const originals = new Map();
  const operations = [];
  try {
    for (const candidate of candidates) {
      const targetPath = path.resolve(resolveTarget(candidate));
      const existed = fs.existsSync(targetPath);
      const before = existed ? fs.readFileSync(targetPath, 'utf8') : '';
      if (!originals.has(targetPath)) originals.set(targetPath, { existed, content: before });
      const marker = markerFor(candidate.id, transactionId);
      if (before.includes(marker.begin)) continue;
      const block = promotionBlock(candidate, transactionId, promotedAt);
      const separator = before && !before.endsWith('\n') ? '\n\n' : before ? '\n' : '';
      const after = `${before}${separator}${block}`;
      const operation = {
        candidateId: candidate.id,
        target: candidate.target,
        targetPath,
        marker,
        block,
        separator,
        beforeHash: sha256(before),
        afterHash: sha256(after),
        createdFile: !existed,
      };
      operations.push(operation);
      onProgress?.({ schema: TRANSACTION_SCHEMA, id: transactionId, studentId: String(studentId || ''), status: 'applying', promotedAt, candidateIds: candidates.map((item) => item.id), operations: [...operations] });
      atomicWrite(targetPath, after);
    }
    return {
      schema: TRANSACTION_SCHEMA,
      id: transactionId,
      studentId: String(studentId || ''),
      status: 'committed',
      promotedAt,
      candidateIds: candidates.map((item) => item.id),
      operations,
    };
  } catch (error) {
    for (const [targetPath, original] of Array.from(originals.entries()).reverse()) {
      try {
        if (original.existed) atomicWrite(targetPath, original.content);
        else if (fs.existsSync(targetPath)) fs.rmSync(targetPath);
      } catch {
        // The caller records the failed transaction for manual recovery.
      }
    }
    throw error;
  }
}

function rollbackInterruptedPromotionTransaction(transaction, recoveredAt = new Date().toISOString()) {
  if (!transaction || !['preparing', 'applying'].includes(transaction.status)) throw new Error('事务不处于可恢复的中断状态。');
  const grouped = new Map();
  for (const operation of transaction.operations || []) {
    const list = grouped.get(operation.targetPath) || [];
    list.push(operation);
    grouped.set(operation.targetPath, list);
  }
  for (const [targetPath, operations] of grouped.entries()) {
    if (!fs.existsSync(targetPath)) continue;
    const current = fs.readFileSync(targetPath, 'utf8');
    let next = current;
    let changed = false;
    for (const operation of operations) {
      if (!next.includes(operation.marker?.begin || '')) continue;
      const removed = removeOperationBlock(next, operation);
      if (!removed.ok) throw new Error(removed.reason);
      next = removed.content;
      changed = true;
    }
    if (!changed) continue;
    if (operations.some((item) => item.createdFile) && !next.trim()) fs.rmSync(targetPath);
    else atomicWrite(targetPath, next);
  }
  return { ...transaction, status: 'failed_rolled_back', recoveredAt };
}

function removeOperationBlock(content, operation) {
  const begin = String(operation.marker?.begin || '');
  const end = String(operation.marker?.end || '');
  const start = content.indexOf(begin);
  if (start < 0) return { ok: false, content, reason: `未找到候选 ${operation.candidateId} 的事务标记。` };
  const endIndex = content.indexOf(end, start + begin.length);
  if (endIndex < 0) return { ok: false, content, reason: `候选 ${operation.candidateId} 的事务标记不完整。` };
  let removeEnd = endIndex + end.length;
  if (content.slice(removeEnd, removeEnd + 2) === '\r\n') removeEnd += 2;
  else if (content[removeEnd] === '\n' || content[removeEnd] === '\r') removeEnd += 1;
  const separator = String(operation.separator || '');
  const removeStart = separator && start >= separator.length && content.slice(start - separator.length, start) === separator
    ? start - separator.length
    : start;
  let next = `${content.slice(0, removeStart)}${content.slice(removeEnd)}`;
  next = next.replace(/\n{3,}/g, '\n\n');
  return { ok: true, content: next };
}

function rollbackPromotionTransaction(transaction, reversedAt = new Date().toISOString()) {
  if (!transaction || transaction.status !== 'committed') throw new Error('只有已提交事务可以撤销。');
  const grouped = new Map();
  for (const operation of transaction.operations || []) {
    const list = grouped.get(operation.targetPath) || [];
    list.push(operation);
    grouped.set(operation.targetPath, list);
  }
  const previews = [];
  for (const [targetPath, operations] of grouped.entries()) {
    const current = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '';
    let next = current;
    for (const operation of operations) {
      const removed = removeOperationBlock(next, operation);
      if (!removed.ok) throw new Error(removed.reason);
      next = removed.content;
    }
    previews.push({ targetPath, operations, current, next, createdFile: operations.some((item) => item.createdFile) });
  }
  const written = [];
  try {
    for (const preview of previews) {
      if (preview.createdFile && !preview.next.trim()) fs.rmSync(preview.targetPath);
      else atomicWrite(preview.targetPath, preview.next);
      written.push(preview);
    }
  } catch (error) {
    for (const preview of written.reverse()) {
      try { atomicWrite(preview.targetPath, preview.current); } catch { /* manual recovery */ }
    }
    throw error;
  }
  return { ...transaction, status: 'reversed', reversedAt };
}

function reapplyPromotionTransaction(transaction) {
  for (const operation of transaction.operations || []) {
    const current = fs.existsSync(operation.targetPath) ? fs.readFileSync(operation.targetPath, 'utf8') : '';
    if (current.includes(operation.marker.begin)) continue;
    atomicWrite(operation.targetPath, `${current}${current && !current.endsWith('\n') ? '\n\n' : current ? '\n' : ''}${operation.block}`);
  }
}

module.exports = {
  TRANSACTION_SCHEMA,
  applyPromotionTransaction,
  markerFor,
  promotionBlock,
  reapplyPromotionTransaction,
  rollbackInterruptedPromotionTransaction,
  rollbackPromotionTransaction,
};
