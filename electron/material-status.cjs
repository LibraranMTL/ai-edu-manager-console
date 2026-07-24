const MATERIAL_TERMINAL_STATUSES = new Set(['processed', 'ignored', 'invalid', 'removed']);

function normalizeMaterialStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (['pending_digest', 'pending', 'new', 'imported', 'queued', 'waiting'].includes(status)) return 'pending_digest';
  if (['submitted', 'waiting_result', 'waiting_receipt'].includes(status)) return 'submitted';
  if (['digesting', 'processing', 'running'].includes(status)) return 'digesting';
  if (['processed', 'digested', 'completed', 'complete', 'done', 'success', 'succeeded', 'covered'].includes(status)) return 'processed';
  if (['ignored', 'skipped', 'duplicate', 'excluded'].includes(status)) return 'ignored';
  if (['invalid', 'empty', 'empty_file'].includes(status)) return 'invalid';
  if (['failed', 'error', 'unreadable'].includes(status)) return 'failed';
  if (status === 'removed') return 'removed';
  return 'pending_digest';
}

function isOpenMaterialStatus(value) {
  return ['pending_digest', 'submitted', 'digesting'].includes(normalizeMaterialStatus(value));
}

function isTerminalMaterialStatus(value) {
  return MATERIAL_TERMINAL_STATUSES.has(normalizeMaterialStatus(value));
}

function classifyReceiptDisposition(entry = {}) {
  const status = String(entry.status || '').trim().toLowerCase();
  const reason = String(entry.reason || entry.message || entry.notes || '').trim();
  if (['completed', 'complete', 'processed', 'digested', 'success', 'succeeded', 'done', 'covered'].includes(status)) return 'processed';
  if (['ignored', 'skipped', 'duplicate', 'excluded'].includes(status)) return 'ignored';
  if (['invalid', 'empty', 'empty_file'].includes(status)) return 'invalid';
  if (/\bempty\b|0\s*bytes?|0\s*字节|空文件|无可读取内容|no readable content/i.test(reason)) return 'invalid';
  if (/\bignored?\b|\bskipped?\b|\bduplicate\b|no digestible|non[- ]educational|personal photo|协议忽略|无需消化|重复资料/i.test(reason)) return 'ignored';
  return 'failed';
}

module.exports = {
  MATERIAL_TERMINAL_STATUSES,
  classifyReceiptDisposition,
  isOpenMaterialStatus,
  isTerminalMaterialStatus,
  normalizeMaterialStatus,
};
