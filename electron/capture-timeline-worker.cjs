const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { parentPort, workerData } = require('worker_threads');
const {
  BUNDLE_SCHEMA,
  STRATEGY_VERSION,
  atomicWriteJson,
  buildMemory,
  buildSegments,
  bundleMarkdown,
  bundlePath,
  persistSemanticResult,
  preSegmentEvents,
  pruneRecognitionCache,
  readJson,
  recognitionPath,
  selectKeyFrames,
  writeProcessingJob,
} = require('./capture-timeline-semantic.cjs');
const { captureEventFromSessionItem, thumbnailPath } = require('./capture-timeline.cjs');
const { createAgentMemoryStore } = require('./agent-memory-v1.cjs');

let yieldRequested = false;
const onWorkerControl = (message) => {
  if (message?.type === 'yield_for_capture') yieldRequested = true;
};
if (parentPort) parentPort.on('message', onWorkerControl);

function sha1File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function isPathInside(rootPath, filePath) {
  const root = path.resolve(String(rootPath || ''));
  const target = path.resolve(String(filePath || ''));
  const relative = path.relative(root, target);
  return Boolean(rootPath) && relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function adjustRecognitionReferences(previousBundle, nextBundle) {
  const previous = new Set((previousBundle?.keyFrames || []).map((frame) => String(frame.recognitionRef || '')).filter(Boolean));
  const next = new Set((nextBundle?.keyFrames || []).map((frame) => String(frame.recognitionRef || '')).filter(Boolean));
  for (const target of new Set([...previous, ...next])) {
    const artifact = readJson(target, null);
    if (!artifact) continue;
    let referenceCount = Math.max(0, Number(artifact.referenceCount || 0));
    if (!previous.has(target) && next.has(target)) referenceCount += 1;
    if (previous.has(target) && !next.has(target)) referenceCount = Math.max(0, referenceCount - 1);
    atomicWriteJson(target, {
      ...artifact,
      referenceCount,
      retentionState: referenceCount > 0 ? 'referenced' : 'cache_only',
      lastAccessedAt: new Date().toISOString(),
    });
  }
}

function runWindowsOcr(imagePath, targetThumbnailPath) {
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, text: '', error: 'Windows OCR is unavailable on this platform.' });
  const bundledScriptPath = path.join(__dirname, 'capture-timeline-ocr.ps1');
  const unpackedScriptPath = bundledScriptPath.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  const scriptPath = fs.existsSync(unpackedScriptPath) ? unpackedScriptPath : bundledScriptPath;
  return new Promise((resolve) => {
    execFile('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      '-ImagePath', imagePath,
      '-ThumbnailPath', targetThumbnailPath,
    ], { windowsHide: true, timeout: 45_000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
      try {
        const parsed = JSON.parse(String(stdout || '').trim().split(/\r?\n/).filter(Boolean).at(-1) || '{}');
        resolve({ ...parsed, error: parsed.error || error?.message || '' });
      } catch {
        resolve({ ok: false, text: '', error: error?.message || 'Windows OCR returned an invalid result.' });
      }
    });
  });
}

function allocateKeyFrames(groups, maximum = 20) {
  const queues = groups.map((events) => selectKeyFrames(events));
  const selected = groups.map(() => []);
  let remaining = Math.max(1, Number(maximum || 20));
  let round = 0;
  while (remaining > 0 && queues.some((queue) => queue.length > round)) {
    for (let index = 0; index < queues.length && remaining > 0; index += 1) {
      const event = queues[index][round];
      if (!event) continue;
      selected[index].push(event);
      remaining -= 1;
    }
    round += 1;
  }
  return groups.map((events, index) => ({ events, keyFrames: selected[index] }));
}

function authorizedAgentCandidates(session) {
  if (!session.agentMemoryRootPath || !session.studentId) return [];
  try {
    const store = createAgentMemoryStore({ rootDir: session.agentMemoryRootPath });
    const settings = store.getSettings(String(session.studentId));
    if (settings.automationEnabled !== true) return [];
    const start = Date.parse(session.startedAt || '') || 0;
    const end = Date.parse(session.endedAt || session.completedAt || '') || start;
    if (!start) return [];
    const stable = (value) => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32);
    return store.listSessions({ studentId: String(session.studentId), limit: 100 })
      .filter((item) => item.origin === 'authorized_agent' && item.status !== 'active'
        && settings.allowedAgents.includes(String(item.agentId || ''))
        && String(item.projectId || '') === String(session.projectId || '')
        && !item.taskId && Array.isArray(item.messages) && item.messages.length > 0
        && Date.parse(item.startedAt || '') <= end + 12 * 60 * 60 * 1000
        && Date.parse(item.updatedAt || item.startedAt || '') >= start - 12 * 60 * 60 * 1000)
      .slice(0, 12).map((item) => ({
        sourceType: 'agent_session', sourceId: String(item.sessionId), tool: String(item.agentId || ''),
        path: path.join(session.agentMemoryRootPath, stable(session.studentId), 'sessions', `${stable(item.sessionId)}.json`),
        supportsReason: true, relation: 'candidate_only',
      }));
  } catch { return []; }
}

async function recognizeEvent(rootPath, event) {
  if (!event.originalPath || !fs.existsSync(event.originalPath)) {
    return { eventId: event.id, status: 'degraded', ocrText: '', error: 'source_missing', thumbnailAvailable: false };
  }
  const hashAlgorithm = String(event.hashAlgorithm || (event.contentHash ? 'sha1' : '') || 'sha1');
  const contentHash = String(event.contentHash || '') || await sha1File(event.originalPath);
  const target = recognitionPath(rootPath, event.studentId, hashAlgorithm, contentHash, STRATEGY_VERSION);
  const cached = readJson(target, null);
  const degradedStillCoolingDown = cached?.status === 'degraded' && Date.parse(cached.nextRetryAt || '') > Date.now();
  if (cached?.status === 'completed' || degradedStillCoolingDown) {
    const refreshed = { ...cached, lastAccessedAt: new Date().toISOString() };
    atomicWriteJson(target, refreshed);
    return { ...refreshed, cacheHit: true };
  }
  const thumb = thumbnailPath(rootPath, event);
  const result = await runWindowsOcr(event.originalPath, thumb);
  const artifact = {
    schema: 'edu-manager.timeline-recognition.v1',
    studentId: String(event.studentId || ''),
    sourceEventId: String(event.id || ''),
    hashAlgorithm,
    contentHash,
    recognitionStrategyVersion: STRATEGY_VERSION,
    status: result.ok ? 'completed' : 'degraded',
    ocrText: String(result.text || '').replace(/\s+/g, ' ').trim(),
    language: String(result.language || ''),
    pageType: '',
    visualSummary: '',
    confidence: result.ok ? 0.82 : 0,
    model: 'windows-media-ocr',
    error: String(result.error || ''),
    nextRetryAt: result.ok ? '' : new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    thumbnailAvailable: Boolean(result.thumbnailAvailable || fs.existsSync(thumb)),
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    referenceCount: 0,
    retentionState: 'cache_only',
  };
  atomicWriteJson(target, artifact);
  return { ...artifact, cacheHit: false };
}

async function processSession(rootPath, session, attempt = 1) {
  const existingBundle = readJson(bundlePath(rootPath, session.studentId, session.id), null);
  if (existingBundle?.digestBatchId && ['completed', 'partial_completed'].includes(String(existingBundle.status || ''))) {
    const job = writeProcessingJob(rootPath, {
      jobId: `timeline-job-${session.id}`,
      studentId: String(session.studentId || ''),
      sessionId: String(session.id || ''),
      state: 'completed',
      attempt: Number(attempt || 1),
      completedAt: new Date().toISOString(),
      requiresUserAction: false,
      blockingReason: '',
      recoveryTrigger: '',
    });
    return {
      ok: true,
      skipped: true,
      reason: 'formal_digest_already_reconciled',
      sessionId: session.id,
      studentId: session.studentId,
      segmentCount: Number(existingBundle.segmentIds?.length || 0),
      keyFrameCount: Number(existingBundle.keyFrames?.length || 0),
      recognizedKeyFrameCount: Number(existingBundle.keyFrames?.filter((frame) => frame.recognitionStatus === 'completed').length || 0),
      state: 'completed',
      bundle: existingBundle,
      job,
      publishedBundlePath: '',
      publishedEvidencePaths: [],
    };
  }
  const items = Array.isArray(session.items) ? session.items : [];
  const events = items.map((item, sequence) => ({ ...captureEventFromSessionItem(session, item), sequence: Number.isInteger(item.sequence) ? item.sequence : sequence }))
    .filter((event) => event.studentId && event.id);
  const byDate = new Map();
  for (const event of events) {
    const list = byDate.get(event.date) || [];
    list.push(event);
    byDate.set(event.date, list);
  }
  const initialGroups = [];
  for (const dateEvents of byDate.values()) initialGroups.push(...preSegmentEvents(dateEvents));
  const allocated = allocateKeyFrames(initialGroups, 20);
  const uniqueKeyFrames = new Map();
  for (const group of allocated) for (const event of group.keyFrames) uniqueKeyFrames.set(String(event.id), event);
  const recognitionByEventId = new Map();
  let available = 0;
  let missing = 0;
  const jobBase = {
    jobId: `timeline-job-${session.id}`,
    studentId: String(session.studentId || ''),
    sessionId: String(session.id || ''),
    state: 'running',
    attempt: Number(attempt || 1),
    completedUnitIds: [],
    nextRetryAt: '',
    recoveryTrigger: '',
    requiresUserAction: false,
    blockingReason: '',
  };
  writeProcessingJob(rootPath, { ...jobBase, unitCounts: { total: uniqueKeyFrames.size, completed: 0, retryScheduled: 0, degraded: 0, blocked: 0 } });
  for (const event of uniqueKeyFrames.values()) {
    if (yieldRequested) {
      writeProcessingJob(rootPath, {
        ...jobBase,
        state: 'retry_scheduled',
        completedUnitIds: [...recognitionByEventId.keys()],
        nextRetryAt: new Date(Date.now() + 30_000).toISOString(),
        recoveryTrigger: 'capture_finished',
      });
      return { ok: true, yielded: true, state: 'yielded', sessionId: session.id, studentId: session.studentId };
    }
    let recognition;
    try {
      if (!event.originalPath || !fs.existsSync(event.originalPath)) throw new Error('source_missing');
      // The capture worker freezes evidence only. OCR is a per-image fallback
      // of formal digestion, never a prerequisite for promotion.
      const contentHash = await sha1File(event.originalPath);
      recognition = {
        sourceEventId: event.id,
        hashAlgorithm: 'sha1',
        contentHash,
        status: 'pending_digest',
        thumbnailAvailable: fs.existsSync(thumbnailPath(rootPath, event)),
      };
    } catch (error) {
      recognition = { sourceEventId: event.id, status: 'source_missing', error: error.message, contentHash: '' };
    }
    recognitionByEventId.set(String(event.id), recognition);
    if (recognition.status === 'pending_digest') available += 1;
    else missing += 1;
    writeProcessingJob(rootPath, {
      ...jobBase,
      state: missing ? 'partial_completed' : 'running',
      completedUnitIds: [...recognitionByEventId.keys()],
      unitCounts: { total: uniqueKeyFrames.size, completed: available, retryScheduled: missing, degraded: missing, blocked: 0 },
    });
    parentPort?.postMessage({ type: 'progress', sessionId: session.id, total: uniqueKeyFrames.size, completed: available, degraded: missing });
  }

  const groupedByDate = {};
  for (const group of allocated) {
    const date = String(group.events[0]?.date || '');
    if (!date) continue;
    if (!groupedByDate[date]) groupedByDate[date] = [];
    groupedByDate[date].push(group);
  }
  const segmentsByDate = {};
  const memoriesByDate = {};
  for (const [date, groups] of Object.entries(groupedByDate)) {
    segmentsByDate[date] = buildSegments(session, groups, recognitionByEventId, { factualOnly: true });
    memoriesByDate[date] = buildMemory(session, date, segmentsByDate[date]);
  }
  const allSegments = Object.values(segmentsByDate).flat();
  const keyFrames = [...uniqueKeyFrames.values()].map((event) => {
    const recognition = recognitionByEventId.get(String(event.id)) || {};
    return {
      eventId: String(event.id),
      sequence: Number(event.sequence || 0),
      assetId: String(event.assetId || ''),
      capturedAt: String(event.occurredAt || ''),
      filename: String(event.filename || ''),
      originalPath: String(event.originalPath || ''),
      hashAlgorithm: String(recognition.hashAlgorithm || ''),
      contentHash: String(recognition.contentHash || ''),
      recognitionRef: '',
      recognitionStatus: String(recognition.status || 'source_missing'),
    };
  });
  const bundle = {
    schema: BUNDLE_SCHEMA,
    bundleId: `capture-bundle-${crypto.createHash('sha1').update(`${session.studentId}|${session.id}|${STRATEGY_VERSION}`).digest('hex').slice(0, 20)}`,
    studentId: String(session.studentId || ''),
    projectId: String(session.projectId || ''),
    sourceSessionId: String(session.id || ''),
    sourceEventIds: events.map((event) => String(event.id)),
    allowedEvidenceRefs: [...new Map([...(session.allowedEvidenceRefs || []), ...authorizedAgentCandidates(session)]
      .filter((ref) => ref?.sourceType && ref?.sourceId)
      .map((ref) => [`${ref.sourceType}:${ref.sourceId}`, ref])).values()],
    keyFrames,
    sourceHashes: Object.fromEntries(keyFrames.filter((frame) => frame.contentHash).map((frame) => [frame.eventId, frame.contentHash])),
    visionBatches: Array.from({ length: Math.ceil(keyFrames.length / 8) }, (_, index) => ({
      batchId: `vision-${index + 1}`,
      eventIds: keyFrames.slice(index * 8, index * 8 + 8).map((frame) => frame.eventId),
      maximumItems: 8,
      mode: 'vision_first_when_authorized',
    })),
    segmentIds: allSegments.map((segment) => segment.segmentId),
    segmentRefs: allSegments.map((segment) => ({ segmentId: segment.segmentId, date: segment.date, sourceEventIds: segment.sourceEventIds })),
    status: 'pending_digest',
    digestBatchId: '',
    candidateSummary: Object.values(memoriesByDate).map((memory) => memory.candidateSummary).join(' '),
    capturePolicyVersion: String(session.capturePolicyVersion || 'capture-v1'),
    selectionVersion: STRATEGY_VERSION,
    createdAt: new Date().toISOString(),
    strategyVersion: STRATEGY_VERSION,
  };
  adjustRecognitionReferences(existingBundle, bundle);
  persistSemanticResult(rootPath, session, segmentsByDate, memoriesByDate, bundle);
  let publishedBundlePath = '';
  const publishedEvidencePaths = [];
  const rawDir = String(session.semanticTarget?.rawDir || '').trim();
  if (rawDir) {
    const bundleDir = path.join(rawDir, '屏幕学习会话');
    const evidenceDir = path.join(bundleDir, `${session.id}-evidence`);
    fs.mkdirSync(evidenceDir, { recursive: true });
    for (const frame of keyFrames) {
      if (!frame.originalPath || !fs.existsSync(frame.originalPath)) continue;
      if (isPathInside(rawDir, frame.originalPath)) {
        frame.evidencePath = frame.originalPath;
        publishedEvidencePaths.push(frame.originalPath);
        continue;
      }
      const extension = path.extname(frame.originalPath).toLowerCase() || '.png';
      const evidenceTarget = path.join(evidenceDir, `${String(frame.eventId).replace(/[^a-zA-Z0-9._-]/g, '_')}${extension}`);
      if (!fs.existsSync(evidenceTarget)) fs.copyFileSync(frame.originalPath, evidenceTarget);
      frame.evidencePath = evidenceTarget;
      publishedEvidencePaths.push(evidenceTarget);
    }
    publishedBundlePath = path.join(bundleDir, `${String(session.id).replace(/[^a-zA-Z0-9._-]/g, '_')}.md`);
    const temporary = `${publishedBundlePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, bundleMarkdown(session, bundle, allSegments), 'utf8');
    fs.renameSync(temporary, publishedBundlePath);
    atomicWriteJson(path.join(bundleDir, `${String(session.id).replace(/[^a-zA-Z0-9._-]/g, '_')}.manifest.json`), {
      ...bundle,
      keyFrames: keyFrames.map(({ originalPath: _originalPath, ...frame }) => frame),
      bundlePath: publishedBundlePath,
      evidencePaths: publishedEvidencePaths,
    });
  }
  const finalState = missing ? (available ? 'partial_completed' : 'degraded') : 'completed';
  const job = writeProcessingJob(rootPath, {
    ...jobBase,
    state: finalState,
    completedAt: new Date().toISOString(),
    completedUnitIds: [...recognitionByEventId.keys()],
    unitCounts: { total: uniqueKeyFrames.size, completed: available, retryScheduled: missing, degraded: missing, blocked: 0 },
    recoveryTrigger: missing ? 'timer_or_dependency_available' : '',
    nextRetryAt: missing ? new Date(Date.now() + 30 * 60 * 1000).toISOString() : '',
  });
  return {
    ok: true,
    sessionId: session.id,
    studentId: session.studentId,
    segmentCount: allSegments.length,
    keyFrameCount: keyFrames.length,
    recognizedKeyFrameCount: 0,
    degradedKeyFrameCount: missing,
    cacheHits: 0,
    state: finalState,
    bundle,
    segments: allSegments,
    job,
    publishedBundlePath,
    publishedEvidencePaths,
  };
}

if (parentPort && workerData) {
  (async () => {
    try {
      const result = workerData.mode === 'report_rebuild'
        ? require('./capture-timeline-reports.cjs').rebuildReports(workerData.rootPath, workerData.studentId, workerData.sessionId, workerData.dates || [])
        : await processSession(workerData.rootPath, workerData.session || {}, workerData.attempt || 1);
      parentPort.postMessage({ type: 'completed', result });
    } catch (error) {
      parentPort.postMessage({ type: 'failed', error: { message: error.message, stack: error.stack } });
      process.exitCode = 1;
    } finally {
      parentPort.off('message', onWorkerControl);
    }
  })();
}

module.exports = { adjustRecognitionReferences, allocateKeyFrames, isPathInside, processSession, recognizeEvent, runWindowsOcr, sha1File };
