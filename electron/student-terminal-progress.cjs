function studentTerminalProgress(records = [], state = {}, options = {}) {
  const normalizeStatus = typeof options.normalizeStatus === 'function' ? options.normalizeStatus : (value) => String(value || '');
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const sevenDaysStart = todayStart - (6 * dayMs);
  const previousSevenStart = todayStart - (13 * dayMs);
  const thirtyDaysStart = todayStart - (29 * dayMs);
  const lastDigestMs = Date.parse(state.lastDigestAt || '') || 0;
  const valid = records.map((record) => ({ record, uploadedMs: Date.parse(record.uploadedAt || '') || 0 })).filter((item) => item.uploadedMs > 0);
  const submittedTodayCount = valid.filter((item) => item.uploadedMs >= todayStart).length;
  const recentUploadCount7 = valid.filter((item) => item.uploadedMs >= sevenDaysStart).length;
  const previousUploadCount7 = valid.filter((item) => item.uploadedMs >= previousSevenStart && item.uploadedMs < sevenDaysStart).length;
  const activeDays30 = new Set(valid.filter((item) => item.uploadedMs >= thirtyDaysStart).map((item) => {
    const date = new Date(item.uploadedMs);
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  })).size;
  const knowledgeAssetCount = records.filter((record) => normalizeStatus(record.status) === 'processed').length;
  return {
    schema: 'edu-manager.student-terminal-progress.v1',
    submittedTodayCount,
    recentUploadCount7,
    previousUploadCount7,
    recentTrend: recentUploadCount7 - previousUploadCount7,
    activeDays30,
    knowledgeAssetCount,
    newSinceLastDigestCount: valid.filter((item) => !lastDigestMs || item.uploadedMs > lastDigestMs).length,
    lastUploadAt: valid.map((item) => item.record.uploadedAt || '').sort().pop() || '',
  };
}

module.exports = { studentTerminalProgress };
