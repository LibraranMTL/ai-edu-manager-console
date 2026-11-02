'use strict';

const { isDeepStrictEqual } = require('node:util');

function withoutVolatileFields(value) {
  if (Array.isArray(value)) return value.map(withoutVolatileFields);
  if (!value || typeof value !== 'object') return value;
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'updatedAt') continue;
    next[key] = withoutVolatileFields(item);
  }
  return next;
}

function studentMaterialsSemanticallyEqual(current, next) {
  return isDeepStrictEqual(withoutVolatileFields(Array.isArray(current) ? current : []),
    withoutVolatileFields(Array.isArray(next) ? next : []));
}

function digestStateSemanticallyEqual(current, next) {
  return isDeepStrictEqual(withoutVolatileFields(current && typeof current === 'object' ? current : {}),
    withoutVolatileFields(next && typeof next === 'object' ? next : {}));
}

function materialStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function digestBusinessSnapshot({ materials = [], digestState = {}, receipts = [] } = {}) {
  const rows = Array.isArray(materials) ? materials : [];
  const receiptRows = Array.isArray(receipts) ? receipts : [];
  return Object.freeze({
    state: Object.freeze({ ...digestState }),
    pendingCount: rows.filter(item => materialStatus(item?.status) === 'pending_digest').length,
    submittedCount: rows.filter(item => ['submitted', 'digesting'].includes(materialStatus(item?.status))).length,
    processedCount: rows.filter(item => materialStatus(item?.status) === 'processed').length,
    materialIds: Object.freeze(rows.map(item => String(item?.id || '')).filter(Boolean)),
    validatedReceipts: Object.freeze(receiptRows.filter(receipt => receipt?.validation?.valid === true
      || receipt?.validation?.passed === true).map(receipt => Object.freeze({
        batchId: String(receipt.batchId || receipt.digestBatchId || ''),
        status: String(receipt.status || ''),
      }))),
  });
}

function digestReconciliationDecision(snapshot = {}, now = new Date().toISOString()) {
  if (Array.isArray(snapshot.validatedReceipts) && snapshot.validatedReceipts.length > 0) {
    return { changed: true, outcome: 'settle_receipt', nextCheckAt: '', writeRequired: true };
  }
  if (Number(snapshot.submittedCount || 0) > 0) {
    const nowMs = Date.parse(now);
    return { changed: false, outcome: 'awaiting_receipt',
      nextCheckAt: new Date((Number.isFinite(nowMs) ? nowMs : Date.now()) + 30_000).toISOString(), writeRequired: false };
  }
  if (Number(snapshot.pendingCount || 0) > 0) {
    return { changed: false, outcome: 'pending_materials', nextCheckAt: '', writeRequired: false };
  }
  return { changed: false, outcome: 'no_work', nextCheckAt: '', writeRequired: false };
}

module.exports = {
  digestBusinessSnapshot,
  digestReconciliationDecision,
  digestStateSemanticallyEqual,
  studentMaterialsSemanticallyEqual,
};
