const DIRECT_QUEUE_SCHEMA = 'edu-manager.collaboration-direct-deliveries.v2';
const ACTIVE_DELIVERY_STATUSES = new Set(['queued', 'transferring', 'retry_waiting', 'waiting_peer']);
const TERMINAL_DELIVERY_STATUSES = new Set(['delivered', 'cancelled', 'invalid', 'superseded']);

function deliveryBackoffMs(attempt = 0) {
  const value = Math.max(1, Number(attempt || 1));
  if (value === 1) return 30 * 1000;
  if (value === 2) return 60 * 1000;
  if (value === 3) return 3 * 60 * 1000;
  if (value === 4) return 5 * 60 * 1000;
  if (value === 5) return 15 * 60 * 1000;
  return 60 * 60 * 1000;
}

function peerProbeDelayMs(peerKey = '') {
  let hash = 0;
  for (const character of String(peerKey)) hash = ((hash * 33) ^ character.charCodeAt(0)) >>> 0;
  return 60 * 60 * 1000 + (hash % (10 * 60 * 1000));
}

function nextDeliveryWakeDelay(input = {}, now = Date.now(), options = {}) {
  const minimumMs = Math.max(1_000, Number(options.minimumMs || 5_000));
  const idleMs = Math.max(minimumMs, Number(options.idleMs || 60_000));
  const maximumMs = Math.max(idleMs, Number(options.maximumMs || 60 * 60 * 1000));
  const circuitUntil = typeof options.circuitUntil === 'function'
    ? options.circuitUntil
    : () => 0;
  let earliest = Number.POSITIVE_INFINITY;
  let hasActive = false;
  for (const record of Object.values(normalizeDeliveryStore(input).deliveries)) {
    if (record.status === 'transferring') {
      hasActive = true;
      earliest = Math.min(earliest, now + 30_000);
      continue;
    }
    if (!['queued', 'retry_waiting', 'waiting_peer'].includes(record.status)) continue;
    hasActive = true;
    const retryAt = Date.parse(record.nextAttemptAt || '') || now;
    const peerAt = Math.max(0, Number(circuitUntil(record) || 0));
    earliest = Math.min(earliest, Math.max(retryAt, peerAt));
  }
  if (!hasActive || !Number.isFinite(earliest)) return idleMs;
  return Math.max(minimumMs, Math.min(maximumMs, earliest - now));
}

function normalizeDelivery(record = {}, manifestId = '') {
  const status = String(record.status || 'queued');
  return {
    manifestId: String(record.manifestId || manifestId),
    targetNodeId: String(record.targetNodeId || ''),
    bindingId: String(record.bindingId || ''),
    packageRoot: String(record.packageRoot || ''),
    baseUrls: Array.isArray(record.baseUrls) ? record.baseUrls.map(String).filter(Boolean) : [],
    status: ACTIVE_DELIVERY_STATUSES.has(status) || TERMINAL_DELIVERY_STATUSES.has(status) || ['compatibility_queue', 'paused'].includes(status)
      ? status
      : 'queued',
    attempt: Math.max(0, Number(record.attempt || 0)),
    nextAttemptAt: String(record.nextAttemptAt || ''),
    queuedAt: String(record.queuedAt || record.createdAt || ''),
    startedAt: String(record.startedAt || ''),
    deliveredAt: String(record.deliveredAt || ''),
    pausedAt: String(record.pausedAt || ''),
    cancelledAt: String(record.cancelledAt || ''),
    error: String(record.error || ''),
    baseUrl: String(record.baseUrl || ''),
    channel: String(record.channel || ''),
    progress: record.progress && typeof record.progress === 'object' ? record.progress : null,
    receipt: record.receipt && typeof record.receipt === 'object' ? record.receipt : null,
    displayName: String(record.displayName || ''),
    packageKind: String(record.packageKind || ''),
    packageCreatedAt: String(record.packageCreatedAt || ''),
    fileCount: Math.max(0, Number(record.fileCount || 0)),
    totalBytes: Math.max(0, Number(record.totalBytes || 0)),
    lineageId: String(record.lineageId || ''),
    publicationVersion: Math.max(0, Number(record.publicationVersion || 0)),
    supersededBy: String(record.supersededBy || ''),
    peerFailureCount: Math.max(0, Number(record.peerFailureCount || 0)),
    peerProbeAt: String(record.peerProbeAt || ''),
    updatedAt: String(record.updatedAt || ''),
  };
}

function normalizeDeliveryStore(input = {}) {
  const deliveries = {};
  for (const [manifestId, record] of Object.entries(input?.deliveries || {})) {
    const normalized = normalizeDelivery(record, manifestId);
    if (!normalized.manifestId) continue;
    deliveries[normalized.manifestId] = normalized;
  }
  return {
    schema: DIRECT_QUEUE_SCHEMA,
    deliveries,
    updatedAt: String(input?.updatedAt || ''),
  };
}

function recoverInterruptedDeliveries(store) {
  const normalized = normalizeDeliveryStore(store);
  for (const record of Object.values(normalized.deliveries)) {
    if (record.status !== 'transferring') continue;
    record.status = 'retry_waiting';
    record.error = record.error || '程序上次关闭时传输尚未完成，已恢复到续传队列。';
    record.nextAttemptAt = '';
    record.progress = null;
  }
  return normalized;
}

function dueDeliveries(store, now = Date.now()) {
  return Object.values(normalizeDeliveryStore(store).deliveries)
    .filter((record) => ['queued', 'retry_waiting', 'waiting_peer'].includes(record.status))
    .filter((record) => !record.nextAttemptAt || Date.parse(record.nextAttemptAt) <= now)
    .filter((record) => !record.peerProbeAt || Date.parse(record.peerProbeAt) <= now)
    .sort((left, right) => {
      const leftAt = Date.parse(left.nextAttemptAt || left.queuedAt || left.updatedAt || '') || 0;
      const rightAt = Date.parse(right.nextAttemptAt || right.queuedAt || right.updatedAt || '') || 0;
      return leftAt - rightAt;
    });
}

function summarizeDeliveries(store) {
  const deliveries = Object.values(normalizeDeliveryStore(store).deliveries);
  return {
    total: deliveries.length,
    queued: deliveries.filter((item) => ['queued', 'retry_waiting', 'waiting_peer'].includes(item.status)).length,
    waitingPeer: deliveries.filter((item) => item.status === 'waiting_peer').length,
    transferring: deliveries.filter((item) => item.status === 'transferring').length,
    paused: deliveries.filter((item) => item.status === 'paused').length,
    failed: deliveries.filter((item) => item.status === 'retry_waiting' && item.error).length,
    delivered: deliveries.filter((item) => item.status === 'delivered').length,
    cancelled: deliveries.filter((item) => item.status === 'cancelled').length,
    invalid: deliveries.filter((item) => item.status === 'invalid').length,
    superseded: deliveries.filter((item) => item.status === 'superseded').length,
  };
}

function latestDeliveryForLineages(store, lineageIds = [], options = {}) {
  const allowedLineages = new Set((lineageIds || []).map(String).filter(Boolean));
  const packageKind = String(options.packageKind || '');
  if (!allowedLineages.size) return null;
  return Object.values(normalizeDeliveryStore(store).deliveries)
    .filter((record) => allowedLineages.has(record.lineageId))
    .filter((record) => !packageKind || record.packageKind === packageKind)
    .sort((left, right) => {
      const rightAt = Date.parse(right.packageCreatedAt || right.queuedAt || right.updatedAt || right.deliveredAt || '') || 0;
      const leftAt = Date.parse(left.packageCreatedAt || left.queuedAt || left.updatedAt || left.deliveredAt || '') || 0;
      return rightAt - leftAt;
    })[0] || null;
}

function reconcileDeliveries(input = {}, options = {}) {
  const inspectPackage = typeof options.inspectPackage === 'function'
    ? options.inspectPackage
    : () => ({ valid: true });
  const store = normalizeDeliveryStore(input);
  const invalidManifestIds = [];
  const supersededManifestIds = [];
  const candidatesByLineage = new Map();
  const inspectableStatuses = new Set(['queued', 'retry_waiting', 'paused', 'compatibility_queue']);

  for (const record of Object.values(store.deliveries)) {
    if (!inspectableStatuses.has(record.status)) continue;
    let inspection;
    try {
      inspection = inspectPackage(record) || { valid: false, error: '无法读取协作包。' };
    } catch (error) {
      inspection = { valid: false, error: error.message || '无法读取协作包。' };
    }
    Object.assign(record, {
      displayName: String(inspection.displayName || record.displayName || ''),
      packageKind: String(inspection.packageKind || record.packageKind || ''),
      packageCreatedAt: String(inspection.packageCreatedAt || record.packageCreatedAt || ''),
      fileCount: Math.max(0, Number(inspection.fileCount ?? record.fileCount ?? 0)),
      totalBytes: Math.max(0, Number(inspection.totalBytes ?? record.totalBytes ?? 0)),
      lineageId: String(inspection.lineageId || record.lineageId || ''),
      publicationVersion: Math.max(0, Number(inspection.publicationVersion ?? record.publicationVersion ?? 0)),
    });
    if (inspection.valid === false) {
      record.status = 'invalid';
      record.error = String(inspection.error || '协作包无效，已自动隔离。');
      record.nextAttemptAt = '';
      record.progress = null;
      record.updatedAt = new Date().toISOString();
      invalidManifestIds.push(record.manifestId);
      continue;
    }
    if (!record.lineageId) continue;
    const key = `${record.targetNodeId}:${record.lineageId}`;
    if (!candidatesByLineage.has(key)) candidatesByLineage.set(key, []);
    candidatesByLineage.get(key).push(record);
  }

  for (const candidates of candidatesByLineage.values()) {
    if (candidates.length < 2) continue;
    candidates.sort((left, right) => {
      const versionDifference = Number(right.publicationVersion || 0) - Number(left.publicationVersion || 0);
      if (versionDifference) return versionDifference;
      const rightAt = Date.parse(right.packageCreatedAt || right.queuedAt || right.updatedAt || '') || 0;
      const leftAt = Date.parse(left.packageCreatedAt || left.queuedAt || left.updatedAt || '') || 0;
      return rightAt - leftAt;
    });
    const latest = candidates[0];
    for (const record of candidates.slice(1)) {
      record.status = 'superseded';
      record.supersededBy = latest.manifestId;
      record.error = `已由更新的项目版本 ${latest.manifestId} 自动替代。`;
      record.nextAttemptAt = '';
      record.progress = null;
      record.updatedAt = new Date().toISOString();
      supersededManifestIds.push(record.manifestId);
    }
  }

  return { store, invalidManifestIds, supersededManifestIds };
}

module.exports = {
  ACTIVE_DELIVERY_STATUSES,
  DIRECT_QUEUE_SCHEMA,
  TERMINAL_DELIVERY_STATUSES,
  deliveryBackoffMs,
  peerProbeDelayMs,
  dueDeliveries,
  latestDeliveryForLineages,
  nextDeliveryWakeDelay,
  normalizeDelivery,
  normalizeDeliveryStore,
  reconcileDeliveries,
  recoverInterruptedDeliveries,
  summarizeDeliveries,
};
