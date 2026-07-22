const REMOVABLE_UPLOAD_STATUSES = new Set(['pending_digest', 'failed', 'ignored']);

function markUploadRecordsRemoved(records, options = {}) {
  const studentId = String(options.studentId || '');
  const requestedIds = new Set((Array.isArray(options.recordIds) ? options.recordIds : []).map(String).filter(Boolean));
  const removedAt = String(options.removedAt || new Date().toISOString());
  const removed = [];
  const blocked = [];
  const missing = new Set(requestedIds);
  const nextRecords = (Array.isArray(records) ? records : []).map((record) => {
    const recordId = String(record?.id || '');
    if (!requestedIds.has(recordId) || String(record?.studentId || '') !== studentId) return record;
    missing.delete(recordId);
    const status = String(record?.status || 'pending_digest');
    if (!REMOVABLE_UPLOAD_STATUSES.has(status)) {
      blocked.push({ id: recordId, status, filename: String(record?.filename || '') });
      return record;
    }
    const next = {
      ...record,
      status: 'removed',
      statusUpdatedAt: removedAt,
      removedAt,
      removalMode: 'record_only',
      removalNote: '已从教育管家活动资料队列移除；物理文件和文件资产均保留。',
    };
    removed.push(next);
    return next;
  });
  return {
    records: nextRecords,
    removed,
    blocked,
    missing: Array.from(missing),
  };
}

module.exports = { REMOVABLE_UPLOAD_STATUSES, markUploadRecordsRemoved };
