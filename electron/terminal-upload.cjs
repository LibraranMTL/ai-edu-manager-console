const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TERMINAL_UPLOAD_QUEUE_VERSION = 2;
const TERMINAL_UPLOAD_STATES = new Set(['queued', 'uploading', 'receipt_unknown', 'received']);

const TERMINAL_UPLOAD_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
  '.pdf', '.txt', '.md',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.csv', '.zip',
]);

function normalizeHostUrl(value) {
  const input = String(value || '').trim().replace(/\/+$/, '');
  if (!input) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input) && !/^https?:\/\//i.test(input)) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `http://${input}`);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.origin;
  } catch {
    return '';
  }
}

function normalizeUploadTarget(target = {}) {
  const type = target.type === 'project' ? 'project' : 'student';
  return {
    type,
    id: String(target.id || '').trim(),
    name: String(target.name || '').trim(),
    studentId: String(target.studentId || '').trim(),
  };
}

function projectsForStudent(projects, studentId) {
  const requested = String(studentId || '');
  return (Array.isArray(projects) ? projects : []).filter((project) => (
    project?.status !== 'sealed'
    && Array.isArray(project?.studentIds)
    && project.studentIds.map(String).includes(requested)
  ));
}

function isTerminalUploadFile(filePath) {
  return TERMINAL_UPLOAD_EXTENSIONS.has(path.extname(String(filePath || '')).toLowerCase());
}

function stableUploadId(file = {}, target = {}) {
  const normalizedTarget = normalizeUploadTarget(target);
  const seed = [
    path.resolve(String(file.path || '')),
    Number(file.size || 0),
    Number(file.mtimeMs || 0),
    normalizedTarget.type,
    normalizedTarget.id,
  ].join('|');
  return `terminal-${crypto.createHash('sha1').update(seed).digest('hex').slice(0, 24)}`;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let count = 0;
    while ((count = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function normalizeQueueItem(item = {}, options = {}) {
  const state = TERMINAL_UPLOAD_STATES.has(item.state) ? item.state : 'queued';
  const fallbackId = `legacy-${crypto.createHash('sha1').update(JSON.stringify(item)).digest('hex').slice(0, 24)}`;
  const normalized = {
    queueId: String(item.queueId || item.uploadId || item.id || fallbackId),
    uploadId: String(item.uploadId || item.queueId || item.id || fallbackId),
    state: state === 'uploading' && options.recoverUploading ? 'receipt_unknown' : state,
    hostId: String(item.hostId || ''),
    dataGeneration: String(item.dataGeneration || ''),
    hostUrl: normalizeHostUrl(item.hostUrl),
    deviceId: String(item.deviceId || ''),
    studentId: String(item.studentId || ''),
    target: normalizeUploadTarget(item.target),
    filename: path.basename(String(item.filename || 'upload.bin')),
    stagingPath: String(item.stagingPath || item.localPath || item.path || ''),
    size: Math.max(0, Number(item.size || 0)),
    sha256: String(item.sha256 || '').toLowerCase(),
    sourceType: String(item.sourceType || 'windows_terminal_upload'),
    metadata: item.metadata && typeof item.metadata === 'object' ? { ...item.metadata } : {},
    attempt: Math.max(0, Number(item.attempt || 0)),
    createdAt: String(item.createdAt || ''),
    updatedAt: String(item.updatedAt || ''),
    nextAttemptAt: String(item.nextAttemptAt || ''),
    lastAttemptAt: String(item.lastAttemptAt || ''),
    receivedAt: String(item.receivedAt || ''),
    lastError: String(item.lastError || ''),
    pauseCode: String(item.pauseCode || (state === 'uploading' && options.recoverUploading ? 'restart_receipt_check' : '')),
    receipt: item.receipt && typeof item.receipt === 'object' ? { ...item.receipt } : null,
  };
  const issues = [];
  if (!normalized.hostId) issues.push('hostId');
  if (!normalized.dataGeneration) issues.push('dataGeneration');
  if (!normalized.studentId) issues.push('studentId');
  if (!normalized.target.id) issues.push('target');
  if (!normalized.stagingPath) issues.push('stagingPath');
  if (!/^[a-f0-9]{64}$/.test(normalized.sha256)) issues.push('sha256');
  if (issues.length && normalized.state !== 'received') {
    normalized.state = 'receipt_unknown';
    normalized.pauseCode = normalized.pauseCode || 'legacy_queue_incomplete';
    normalized.lastError = normalized.lastError || `旧上传记录缺少 ${issues.join('、')}，已保留并暂停自动上传。`;
    normalized.nextAttemptAt = '';
  }
  normalized.migrationIssues = issues;
  return normalized;
}

function corruptQueueSentinel(queuePath) {
  const queueId = `queue-corrupt-${crypto.createHash('sha1').update(path.resolve(queuePath)).digest('hex').slice(0, 20)}`;
  return normalizeQueueItem({
    queueId,
    uploadId: queueId,
    state: 'receipt_unknown',
    filename: '上传队列元数据损坏.json',
    pauseCode: 'queue_metadata_corrupt',
    lastError: '上传队列元数据无法读取；原文件和稳定待上传副本已保留，请人工核对。',
  });
}

function readTerminalUploadQueue(queuePath, options = {}) {
  let raw = {};
  let corrupt = false;
  try {
    raw = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || (Object.prototype.hasOwnProperty.call(raw, 'items') && !Array.isArray(raw.items))) {
      throw new Error('invalid queue structure');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') corrupt = true;
    raw = {};
  }
  const items = (Array.isArray(raw.items) ? raw.items : [])
    .map((item) => normalizeQueueItem(item, options));
  if (corrupt) items.unshift(corruptQueueSentinel(queuePath));
  return { version: TERMINAL_UPLOAD_QUEUE_VERSION, updatedAt: String(raw.updatedAt || ''), items,
    corrupt, corruptionBackup: '' };
}

function writeTerminalUploadQueue(queuePath, queue, now = new Date().toISOString()) {
  fs.mkdirSync(path.dirname(queuePath), { recursive: true });
  let corruptionBackup = '';
  if (queue?.corrupt && fs.existsSync(queuePath)) {
    corruptionBackup = `${queuePath}.corrupt-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.json`;
    fs.copyFileSync(queuePath, corruptionBackup, fs.constants.COPYFILE_EXCL);
  }
  const temporary = `${queuePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({
    version: TERMINAL_UPLOAD_QUEUE_VERSION,
    updatedAt: now,
    items: (queue.items || []).map((item) => normalizeQueueItem(item)),
  }, null, 2), 'utf8');
  fs.renameSync(temporary, queuePath);
  if (queue && typeof queue === 'object') {
    queue.corrupt = false;
    queue.corruptionBackup = corruptionBackup;
  }
}

function recoverTerminalUploadQueue(queuePath, now = new Date().toISOString(), options = {}) {
  const queue = readTerminalUploadQueue(queuePath, { recoverUploading: true });
  const raw = readTerminalUploadQueue(queuePath);
  const stagingDir = path.resolve(String(options.stagingDir
    || path.join(path.dirname(path.resolve(queuePath)), 'terminal-upload-staging')));
  const tracked = new Set(queue.items.map((item) => {
    try { return item.stagingPath ? path.resolve(item.stagingPath).toLowerCase() : ''; } catch { return ''; }
  }).filter(Boolean));
  if (fs.existsSync(stagingDir)) {
    const files = fs.readdirSync(stagingDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const file of files) {
      const stagingPath = path.resolve(stagingDir, file.name);
      if (tracked.has(stagingPath.toLowerCase())) continue;
      try {
        const link = fs.lstatSync(stagingPath);
        const stat = fs.statSync(stagingPath);
        if (link.isSymbolicLink() || !stat.isFile()) continue;
        const orphanId = `orphan-${crypto.createHash('sha1').update(stagingPath).digest('hex').slice(0, 24)}`;
        queue.items.push(normalizeQueueItem({
          queueId: orphanId,
          uploadId: orphanId,
          state: 'receipt_unknown',
          filename: path.basename(stagingPath),
          stagingPath,
          size: stat.size,
          sha256: sha256File(stagingPath),
          createdAt: stat.birthtime?.toISOString?.() || stat.mtime.toISOString(),
          updatedAt: now,
          pauseCode: 'orphan_staging_copy',
          lastError: '检测到未登记的稳定待上传副本；缺少原主机、学生和项目范围，已保留且不会自动发送。',
        }));
        tracked.add(stagingPath.toLowerCase());
      } catch {
        // Leave an unreadable file untouched. A later recovery can retry it.
      }
    }
  }
  if (raw.corrupt || queue.corrupt || JSON.stringify(raw.items) !== JSON.stringify(queue.items)) {
    writeTerminalUploadQueue(queuePath, queue, now);
  }
  return queue;
}

function safeStagingName(uploadId, filename) {
  const stem = String(uploadId || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || crypto.randomUUID();
  const extension = path.extname(String(filename || '')).toLowerCase().slice(0, 12);
  return `${stem}${extension}`;
}

function stageTerminalUpload(options = {}) {
  const sourcePath = path.resolve(String(options.sourcePath || ''));
  const queuePath = path.resolve(String(options.queuePath || ''));
  const stagingDir = path.resolve(String(options.stagingDir || ''));
  const target = normalizeUploadTarget(options.target);
  const hostId = String(options.hostId || '').trim();
  const dataGeneration = String(options.dataGeneration || '').trim();
  const studentId = String(options.studentId || target.studentId || (target.type === 'student' ? target.id : '')).trim();
  if (!sourcePath || !queuePath || !stagingDir || !target.id || !hostId || !dataGeneration || !studentId) {
    throw new Error('待上传资料缺少固定主机、数据代次、学生或目标。');
  }
  const sourceLink = fs.lstatSync(sourcePath);
  const before = fs.statSync(sourcePath);
  if (sourceLink.isSymbolicLink() || !before.isFile() || !isTerminalUploadFile(sourcePath)) throw new Error(`不支持上传该文件：${path.basename(sourcePath)}`);
  const sourceSha256Before = sha256File(sourcePath);
  const uploadId = String(options.uploadId || stableUploadId({ path: sourcePath, size: before.size, mtimeMs: before.mtimeMs }, target));
  const queueId = `queue-${crypto.createHash('sha1').update(JSON.stringify([
    hostId, dataGeneration, studentId, target.type, target.id, uploadId,
  ])).digest('hex').slice(0, 28)}`;
  const existingQueue = readTerminalUploadQueue(queuePath);
  const existing = existingQueue.items.find((item) => item.uploadId === uploadId
    && item.hostId === hostId && item.dataGeneration === dataGeneration
    && item.studentId === studentId && item.target.type === target.type && item.target.id === target.id);
  if (existing?.state === 'received') {
    if (existing.size === before.size && existing.sha256 === sourceSha256Before) return existing;
    throw new Error('同一上传编号对应的文件内容已变化，请作为新的资料重新添加。');
  }
  if (existing && fs.existsSync(existing.stagingPath)
    && fs.statSync(existing.stagingPath).size === existing.size
    && sha256File(existing.stagingPath) === existing.sha256) return existing;

  fs.mkdirSync(stagingDir, { recursive: true });
  const finalPath = path.join(stagingDir, safeStagingName(queueId, sourcePath));
  const temporary = `${finalPath}.${crypto.randomBytes(5).toString('hex')}.partial`;
  try {
    fs.copyFileSync(sourcePath, temporary, fs.constants.COPYFILE_EXCL);
    const after = fs.statSync(sourcePath);
    const staged = fs.statSync(temporary);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || staged.size !== before.size) {
      throw new Error(`文件在建立稳定待上传副本时发生变化：${path.basename(sourcePath)}`);
    }
    const sha256 = sha256File(temporary);
    if (sha256 !== sourceSha256Before || sha256File(sourcePath) !== sourceSha256Before) {
      throw new Error(`文件在建立稳定待上传副本时发生变化：${path.basename(sourcePath)}`);
    }
    if (fs.existsSync(finalPath)) {
      const finalLink = fs.lstatSync(finalPath);
      const finalStat = fs.statSync(finalPath);
      if (finalLink.isSymbolicLink() || !finalStat.isFile() || finalStat.size !== staged.size || sha256File(finalPath) !== sha256) {
        throw new Error('待上传暂存编号冲突，已保留现有副本等待核对。');
      }
      fs.unlinkSync(temporary);
    } else {
      fs.renameSync(temporary, finalPath);
    }
    const now = String(options.now || new Date().toISOString());
    const item = normalizeQueueItem({
      queueId,
      uploadId,
      state: 'queued',
      hostId,
      dataGeneration,
      hostUrl: options.hostUrl,
      deviceId: options.deviceId,
      studentId,
      target,
      filename: path.basename(sourcePath),
      stagingPath: finalPath,
      size: staged.size,
      sha256,
      sourceType: options.sourceType,
      metadata: options.metadata,
      createdAt: now,
      updatedAt: now,
      nextAttemptAt: now,
    });
    const index = existingQueue.items.findIndex((entry) => entry.queueId === item.queueId
      && entry.hostId === item.hostId && entry.dataGeneration === item.dataGeneration);
    if (index >= 0) existingQueue.items[index] = item;
    else existingQueue.items.push(item);
    writeTerminalUploadQueue(queuePath, existingQueue, now);
    return item;
  } catch (error) {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function publicTerminalUploadQueue(queue) {
  const items = (queue.items || []).map((item) => ({
    queueId: item.queueId,
    uploadId: item.uploadId,
    state: item.state,
    hostId: item.hostId,
    dataGeneration: item.dataGeneration,
    studentId: item.studentId,
    target: item.target,
    filename: item.filename,
    size: item.size,
    sourceType: item.sourceType,
    attempt: item.attempt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    receivedAt: item.receivedAt,
    lastError: item.lastError,
    pauseCode: item.pauseCode,
    receipt: item.receipt,
    migrationIssues: item.migrationIssues || [],
  }));
  const counts = Object.fromEntries([...TERMINAL_UPLOAD_STATES].map((state) => [state, items.filter((item) => item.state === state).length]));
  return { version: TERMINAL_UPLOAD_QUEUE_VERSION, updatedAt: queue.updatedAt || '', total: items.length, counts, items };
}

function acknowledgementValues(payload, evidence, names) {
  const values = [];
  for (const source of [payload, evidence]) {
    if (!source || typeof source !== 'object') continue;
    for (const name of names) {
      if (!Object.prototype.hasOwnProperty.call(source, name)) continue;
      const value = String(source[name] ?? '').trim();
      if (value) values.push(value);
    }
  }
  return [...new Set(values)];
}

function exactAcknowledgementField(payload, evidence, names, expected, missingCode, mismatchCode) {
  const values = acknowledgementValues(payload, evidence, names);
  if (!values.length) return { ok: false, code: missingCode };
  if (values.some((value) => value !== String(expected || ''))) return { ok: false, code: mismatchCode };
  return { ok: true };
}

function terminalUploadAcknowledgement(item = {}, payload = {}, options = {}) {
  const source = options.source === 'query' ? 'query' : 'upload';
  const files = Array.isArray(payload?.files) ? payload.files : [];
  if (files.length > 1) return { ok: false, code: 'receipt_file_ambiguous', legacy: false };
  const evidence = payload?.receipt && typeof payload.receipt === 'object'
    ? payload.receipt
    : files.length === 1 && files[0] && typeof files[0] === 'object'
      ? files[0]
      : payload;
  const statusNames = source === 'query' ? ['status', 'receiptStatus'] : ['receiptStatus', 'status'];
  const statuses = acknowledgementValues(payload, evidence, statusNames);
  const protocolMarkers = acknowledgementValues(payload, evidence, [
    'hostId', 'dataGeneration', 'targetType', 'targetId', 'studentId',
    'uploadId', 'receiptId', 'clientRequestId', 'receiptStatus',
  ]);
  if (!statuses.length) {
    return { ok: false, code: source === 'upload' && !protocolMarkers.length
      ? 'legacy_upload_result_unverifiable' : 'receipt_status_missing', legacy: source === 'upload' };
  }
  if (statuses.some((value) => value !== 'received_verified')) {
    return { ok: false, code: `receipt_${statuses[0] || 'unknown'}`, legacy: false };
  }

  const expectedTarget = normalizeUploadTarget(item.target);
  const checks = [
    exactAcknowledgementField(payload, evidence, ['hostId'], item.hostId,
      'receipt_host_missing', 'receipt_host_mismatch'),
    exactAcknowledgementField(payload, evidence, ['dataGeneration'], item.dataGeneration,
      'receipt_generation_missing', 'receipt_generation_mismatch'),
    exactAcknowledgementField(payload, evidence, ['targetType'], expectedTarget.type,
      'receipt_target_type_missing', 'receipt_target_type_mismatch'),
    exactAcknowledgementField(payload, evidence, ['targetId'], expectedTarget.id,
      'receipt_target_missing', 'receipt_target_mismatch'),
    exactAcknowledgementField(payload, evidence, ['studentId'], item.studentId,
      'receipt_student_missing', 'receipt_student_mismatch'),
  ];
  const failedScope = checks.find((check) => !check.ok);
  if (failedScope) return { ...failedScope, legacy: false };

  const ids = acknowledgementValues(payload, evidence, ['uploadId', 'receiptId']);
  const clientIds = acknowledgementValues(payload, evidence, ['clientRequestId']);
  if (!ids.length) return { ok: false, code: 'receipt_identifier_missing', legacy: false };
  if ([...ids, ...clientIds].some((value) => value !== String(item.uploadId || ''))) {
    return { ok: false, code: 'receipt_identifier_mismatch', legacy: false };
  }

  const sizes = acknowledgementValues(payload, evidence, ['size']);
  if (!sizes.length) return { ok: false, code: 'receipt_size_missing', legacy: false };
  if (sizes.some((value) => !/^\d+$/.test(value) || Number(value) !== Number(item.size))) {
    return { ok: false, code: 'receipt_size_mismatch', legacy: false };
  }
  const hashes = acknowledgementValues(payload, evidence, ['sha256']).map((value) => value.toLowerCase());
  if (!hashes.length) return { ok: false, code: 'receipt_sha256_missing', legacy: false };
  if (hashes.some((value) => !/^[a-f0-9]{64}$/.test(value)
    || value !== String(item.sha256 || '').toLowerCase())) {
    return { ok: false, code: 'receipt_sha256_mismatch', legacy: false };
  }
  return {
    ok: true,
    code: 'received_verified',
    legacy: false,
    receipt: {
      status: 'received_verified',
      hostId: String(item.hostId || ''),
      dataGeneration: String(item.dataGeneration || ''),
      uploadId: String(item.uploadId || ''),
      targetType: expectedTarget.type,
      targetId: expectedTarget.id,
      studentId: String(item.studentId || ''),
      size: Number(item.size),
      sha256: String(item.sha256 || '').toLowerCase(),
      materialId: String(evidence?.materialId || payload?.materialId || ''),
      materialVersion: Number(evidence?.materialVersion || payload?.materialVersion || 0),
      receivedAt: String(evidence?.receivedAt || payload?.receivedAt || ''),
    },
  };
}

function terminalReceiptScope(item = {}, payload = {}) {
  const evidence = payload?.receipt && typeof payload.receipt === 'object' ? payload.receipt : payload;
  const expectedTarget = normalizeUploadTarget(item.target);
  const checks = [
    exactAcknowledgementField(payload, evidence, ['hostId'], item.hostId,
      'receipt_host_missing', 'receipt_host_mismatch'),
    exactAcknowledgementField(payload, evidence, ['dataGeneration'], item.dataGeneration,
      'receipt_generation_missing', 'receipt_generation_mismatch'),
    exactAcknowledgementField(payload, evidence, ['targetType'], expectedTarget.type,
      'receipt_target_type_missing', 'receipt_target_type_mismatch'),
    exactAcknowledgementField(payload, evidence, ['targetId'], expectedTarget.id,
      'receipt_target_missing', 'receipt_target_mismatch'),
    exactAcknowledgementField(payload, evidence, ['studentId'], item.studentId,
      'receipt_student_missing', 'receipt_student_mismatch'),
  ];
  const failed = checks.find((check) => !check.ok);
  if (failed) return failed;
  const ids = acknowledgementValues(payload, evidence, ['uploadId', 'receiptId']);
  const clientIds = acknowledgementValues(payload, evidence, ['clientRequestId']);
  if (!ids.length) return { ok: false, code: 'receipt_identifier_missing' };
  if ([...ids, ...clientIds].some((value) => value !== String(item.uploadId || ''))) {
    return { ok: false, code: 'receipt_identifier_mismatch' };
  }
  return { ok: true, code: 'receipt_scope_verified' };
}

function terminalUploadNextAction(item, observed = {}, receipt = null, receiptError = null) {
  const observedHostId = String(observed.hostId || '');
  const observedGeneration = String(observed.dataGeneration || '');
  if (!observedHostId || observedHostId !== String(item.hostId || '')) {
    return { action: 'pause', code: 'host_identity_changed' };
  }
  if (!observedGeneration || observedGeneration !== String(item.dataGeneration || '')) {
    return { action: 'pause', code: 'host_data_generation_changed' };
  }
  if (receiptError) return { action: 'wait', code: String(receiptError.code || 'receipt_query_failed') };
  if (!receipt) return item.state === 'queued' && Number(item.attempt || 0) === 0
    ? { action: 'upload', code: 'not_attempted' }
    : { action: 'query_receipt', code: 'receipt_required' };
  const scope = terminalReceiptScope(item, receipt);
  if (!scope.ok) return { action: 'wait', code: scope.code };
  if (receipt.status === 'received_verified') {
    const verified = terminalUploadAcknowledgement(item, receipt, { source: 'query' });
    return verified.ok
      ? { action: 'received', code: 'received_verified' }
      : { action: 'wait', code: verified.code };
  }
  if (receipt.status === 'not_found') return { action: 'upload', code: 'receipt_not_found' };
  return { action: 'wait', code: `receipt_${receipt.status || 'unknown'}` };
}

function verifyTerminalStagedCopy(item = {}) {
  try {
    const link = fs.lstatSync(String(item.stagingPath || ''));
    const stat = fs.statSync(String(item.stagingPath || ''));
    if (link.isSymbolicLink() || !stat.isFile()) return { ok: false, code: 'staging_copy_unavailable' };
    if (stat.size !== Number(item.size)) return { ok: false, code: 'staging_copy_changed' };
    if (sha256File(item.stagingPath) !== String(item.sha256 || '').toLowerCase()) {
      return { ok: false, code: 'staging_copy_changed' };
    }
    return { ok: true, code: 'verified' };
  } catch (error) {
    return { ok: false, code: fs.existsSync(String(item.stagingPath || '')) ? 'staging_copy_unavailable' : 'staging_copy_missing',
      message: error.message };
  }
}

function buildTargetUploadPath(target, filename, metadata = {}) {
  const normalized = normalizeUploadTarget(target);
  if (!normalized.id) throw new Error('请选择资料目标。');
  const params = new URLSearchParams({
    filename: path.basename(String(filename || 'upload.bin')),
    sourceType: String(metadata.sourceType || 'windows_terminal_upload'),
  });
  if (metadata.uploadId) params.set('uploadId', String(metadata.uploadId));
  if (metadata.captureSessionId) params.set('captureSessionId', String(metadata.captureSessionId));
  if (metadata.captureItemId) params.set('captureItemId', String(metadata.captureItemId));
  if (metadata.capturedAt) params.set('capturedAt', String(metadata.capturedAt));
  if (metadata.captureSequence) params.set('captureSequence', String(metadata.captureSequence));
  if (metadata.captureHighlighted) params.set('captureHighlighted', '1');
  if (metadata.courseId) params.set('courseId', String(metadata.courseId));
  if (metadata.courseUrl) params.set('courseUrl', String(metadata.courseUrl));
  if (metadata.courseStartedAt) params.set('courseStartedAt', String(metadata.courseStartedAt));
  if (metadata.courseCompletedAt) params.set('courseCompletedAt', String(metadata.courseCompletedAt));
  if (normalized.type === 'project') {
    if (normalized.studentId) params.set('studentId', normalized.studentId);
    return `/api/projects/${encodeURIComponent(normalized.id)}/materials?${params.toString()}`;
  }
  return `/api/students/${encodeURIComponent(normalized.id)}/materials?${params.toString()}`;
}

module.exports = {
  TERMINAL_UPLOAD_EXTENSIONS,
  TERMINAL_UPLOAD_QUEUE_VERSION,
  TERMINAL_UPLOAD_STATES,
  buildTargetUploadPath,
  isTerminalUploadFile,
  normalizeHostUrl,
  normalizeUploadTarget,
  projectsForStudent,
  publicTerminalUploadQueue,
  readTerminalUploadQueue,
  recoverTerminalUploadQueue,
  sha256File,
  stageTerminalUpload,
  stableUploadId,
  terminalReceiptScope,
  terminalUploadAcknowledgement,
  terminalUploadNextAction,
  verifyTerminalStagedCopy,
  writeTerminalUploadQueue,
};
