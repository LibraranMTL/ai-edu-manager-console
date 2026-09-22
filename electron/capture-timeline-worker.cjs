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
  captureEvidenceRoot,
  persistSemanticResult,
  preSegmentEvents,
  processingWindowPath,
  pruneRecognitionCache,
  readJson,
  recognitionPath,
  selectKeyFrames,
  writeProcessingJob,
  visionManifestPath,
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

function sourceItemFingerprint(item = {}, index = 0) {
  const sourcePath = String(item.path || '');
  let fileState = 'missing';
  if (sourcePath) {
    try {
      const stat = fs.statSync(sourcePath);
      fileState = stat.isFile() ? `${stat.size}:${stat.mtimeMs}` : 'not_file';
    } catch { /* Missing evidence must change the revision fingerprint. */ }
  }
  return crypto.createHash('sha1').update(JSON.stringify({
    id: String(item.id || item.captureItemId || ''), index,
    sourcePath, fileState,
    contentHash: String(item.contentHash || item.sha1 || ''),
    capturedAt: String(item.capturedAt || ''), uploadedAt: String(item.uploadedAt || ''),
    sequence: item.sequence ?? null, difference: item.difference ?? null,
    highlighted: Boolean(item.isHighlighted || item.highlighted),
    taskId: String(item.taskId || ''), taskVersion: String(item.taskVersion || ''),
    conceptIds: Array.isArray(item.conceptIds) ? item.conceptIds : [],
  })).digest('hex');
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

function partitionActivityWindows(groups, options = {}) {
  const maximumFrames = Math.max(1, Math.min(20, Number(options.maximumFrames || 20)));
  const maximumEvents = Math.max(1, Number(options.maximumEvents || 240));
  const windows = [];
  let current = [];
  let eventCount = 0;
  let frameCount = 0;
  const flush = () => {
    if (!current.length) return;
    windows.push(allocateKeyFrames(current, maximumFrames));
    current = [];
    eventCount = 0;
    frameCount = 0;
  };
  for (const group of groups) {
    // A continuous foreground page can last for hours. Bound its factual unit
    // without treating the artificial window edge as a learning interruption.
    for (let offset = 0; offset < group.length; offset += maximumEvents) {
      const piece = group.slice(offset, offset + maximumEvents);
      const selectedCount = selectKeyFrames(piece).length;
      const changedDay = current.length && String(current[0][0]?.date || '') !== String(piece[0]?.date || '');
      if (current.length && (changedDay || eventCount + piece.length > maximumEvents
        || frameCount + selectedCount > maximumFrames)) flush();
      current.push(piece);
      eventCount += piece.length;
      frameCount += selectedCount;
    }
  }
  flush();
  return windows;
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
  const items = Array.isArray(session.items) ? session.items : [];
  const incomingEventIds = items.map((item) => String(item.id || item.captureItemId || ''));
  const sourceFingerprintSequence = items.map((item, index) => sourceItemFingerprint(item, index));
  const sourceFingerprints = Object.fromEntries(incomingEventIds.map((id, index) => [id, sourceFingerprintSequence[index]]));
  const sourceRevision = crypto.createHash('sha1').update(JSON.stringify({
    studentId: String(session.studentId || ''), projectId: String(session.projectId || ''),
    courseId: String(session.courseId || ''), taskId: String(session.taskId || ''),
    sourceFingerprintSequence,
  })).digest('hex');
  const sameFrozenSource = incomingEventIds.length === (existingBundle?.sourceEventIds || []).length
    && incomingEventIds.every((id, index) => id && id === String(existingBundle.sourceEventIds[index] || ''))
    && existingBundle?.sourceRevision === sourceRevision;
  if (sameFrozenSource && existingBundle?.digestBatchId && String(existingBundle.status || '') === 'completed') {
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
      publishedWindowPaths: [],
      publishedEvidencePaths: [],
    };
  }
  const events = items.map((item, sequence) => ({ ...captureEventFromSessionItem(session, item), sequence: Number.isInteger(item.sequence) ? item.sequence : sequence }))
    .filter((event) => event.studentId && event.id);
  const byDate = new Map();
  for (const event of events) {
    const list = byDate.get(event.date) || [];
    list.push(event);
    byDate.set(event.date, list);
  }
  const initialGroups = [];
  for (const date of [...byDate.keys()].sort()) initialGroups.push(...preSegmentEvents(byDate.get(date)));
  const allocatedWindows = partitionActivityWindows(initialGroups);
  const allocated = allocatedWindows.flat();
  const windowForEvent = new Map();
  const windowIds = allocatedWindows.map((groups) => {
    const first = groups[0]?.events[0];
    const last = groups.at(-1)?.events.at(-1);
    const windowId = `capture-window-${crypto.createHash('sha1').update(`${session.studentId}|${session.id}|${first?.id || ''}|${last?.id || ''}|${STRATEGY_VERSION}`).digest('hex').slice(0, 20)}`;
    for (const group of groups) for (const event of group.events) windowForEvent.set(String(event.id), windowId);
    return windowId;
  });
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
  for (let index = 1; index < allSegments.length; index += 1) {
    const previous = allSegments[index - 1];
    const current = allSegments[index];
    if (previous.date === current.date) continue;
    const gap = Date.parse(current.startedAt) - Date.parse(previous.endedAt);
    current.gapBeforeMs = Number.isFinite(gap) && gap >= 0 ? gap : null;
    current.gapBeforeStatus = current.gapBeforeMs == null ? 'time_uncertain'
      : previous.timeStatus !== 'device_reported_capture_time' || current.timeStatus !== 'device_reported_capture_time'
        ? 'time_uncertain' : current.gapBeforeMs > 4 * 60_000 ? 'unobserved_interval' : 'bounded_interval';
  }
  const keyFrames = [...uniqueKeyFrames.values()].map((event) => {
    const recognition = recognitionByEventId.get(String(event.id)) || {};
    return {
      eventId: String(event.id),
      windowId: windowForEvent.get(String(event.id)) || '',
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
  const processingWindows = allocatedWindows.map((groups, index) => {
    const windowId = windowIds[index];
    const windowEvents = groups.flatMap((group) => group.events);
    const windowFrames = keyFrames.filter((frame) => frame.windowId === windowId);
    const windowSegments = allSegments.filter((segment) => windowForEvent.get(String(segment.sourceEventIds?.[0] || '')) === windowId);
    const sourceRevision = crypto.createHash('sha1').update(JSON.stringify(windowEvents.map((event) => [
      event.id, sourceFingerprints[String(event.id)] || '',
    ]))).digest('hex');
    return {
      windowId,
      sourceRevision,
      ordinal: index + 1,
      sourceEventIds: windowEvents.map((event) => String(event.id)),
      keyEventIds: windowFrames.map((frame) => frame.eventId),
      segmentIds: windowSegments.map((segment) => segment.segmentId),
      firstCapturedAt: String(windowEvents[0]?.occurredAt || ''),
      lastCapturedAt: String(windowEvents.at(-1)?.occurredAt || ''),
      sourceEventCount: windowEvents.length,
      keyFrameCount: windowFrames.length,
    };
  });
  let visionBatchNumber = 0;
  const visionBatches = [];
  for (const window of processingWindows) {
    let current = [];
    const flush = () => {
      if (!current.length) return;
      visionBatchNumber += 1;
      visionBatches.push({
        batchId: `vision-${visionBatchNumber}`,
        windowId: window.windowId,
        eventIds: current,
        maximumItems: 8,
        mode: 'vision_first_when_authorized',
      });
      current = [];
    };
    const windowKeyIds = new Set(window.keyEventIds);
    for (const segment of allSegments.filter((item) => window.segmentIds.includes(item.segmentId))) {
      const segmentKeys = (segment.keyEventIds || []).filter((id) => windowKeyIds.has(id));
      if (current.length + segmentKeys.length > 8) flush();
      current.push(...segmentKeys);
    }
    flush();
  }
  const sourceHashes = Object.fromEntries(keyFrames.filter((frame) => frame.contentHash).map((frame) => [frame.eventId, frame.contentHash]));
  const bundle = {
    schema: BUNDLE_SCHEMA,
    bundleId: `capture-bundle-${crypto.createHash('sha1').update(`${session.studentId}|${session.id}|${STRATEGY_VERSION}`).digest('hex').slice(0, 20)}`,
    studentId: String(session.studentId || ''),
    projectId: String(session.projectId || ''),
    sourceSessionId: String(session.id || ''),
    sourceEventIds: events.map((event) => String(event.id)),
    sourceRevision,
    sourceFingerprints,
    allowedEvidenceRefs: [...new Map([...(session.allowedEvidenceRefs || []), ...authorizedAgentCandidates(session)]
      .filter((ref) => ref?.sourceType && ref?.sourceId)
      .map((ref) => [`${ref.sourceType}:${ref.sourceId}`, ref])).values()],
    keyFrames,
    processingWindows,
    sourceHashes,
    visionBatches,
    segmentIds: allSegments.map((segment) => segment.segmentId),
    segmentRefs: allSegments.map((segment) => ({ segmentId: segment.segmentId, date: segment.date, sourceEventIds: segment.sourceEventIds })),
    status: 'pending_digest',
    digestBatchId: '',
    windowDigestStates: Object.fromEntries(processingWindows.filter((window) => {
      if (!existingBundle?.windowDigestStates?.[window.windowId]) return false;
      const prior = (existingBundle.processingWindows || []).find((item) => item.windowId === window.windowId);
      return prior && prior.sourceRevision === window.sourceRevision
        && prior.keyEventIds.length === window.keyEventIds.length
        && window.keyEventIds.every((eventId) => prior.keyEventIds.includes(eventId)
          && existingBundle.sourceHashes?.[eventId] === sourceHashes[eventId]);
    }).map((window) => [window.windowId, existingBundle.windowDigestStates[window.windowId]])),
    candidateSummary: Object.values(memoriesByDate).map((memory) => memory.candidateSummary).join(' '),
    capturePolicyVersion: String(session.capturePolicyVersion || 'capture-v1'),
    selectionVersion: STRATEGY_VERSION,
    createdAt: new Date().toISOString(),
    strategyVersion: STRATEGY_VERSION,
  };
  if (processingWindows.length && processingWindows.every((window) => bundle.windowDigestStates[window.windowId]?.status === 'completed')) {
    bundle.status = 'completed';
    bundle.digestBatchId = existingBundle?.digestBatchId || '';
  } else if (Object.keys(bundle.windowDigestStates).length) bundle.status = 'partial_completed';
  for (const window of processingWindows) {
    const windowFrames = keyFrames.filter((frame) => frame.windowId === window.windowId);
    const windowBatches = visionBatches.filter((batch) => batch.windowId === window.windowId);
    atomicWriteJson(processingWindowPath(rootPath, session.studentId, session.id, window.windowId), {
      schema: 'edu-manager.capture-processing-window.v1',
      bundleId: bundle.bundleId,
      studentId: bundle.studentId,
      projectId: bundle.projectId,
      sourceSessionId: bundle.sourceSessionId,
      selectionVersion: STRATEGY_VERSION,
      ...window,
      sourceHashes: Object.fromEntries(windowFrames.filter((frame) => frame.contentHash).map((frame) => [frame.eventId, frame.contentHash])),
      keyFrames: windowFrames,
      visionBatches: windowBatches,
    });
  }
  const retiredWindowIds = [];
  const currentWindowIds = new Set(processingWindows.map((window) => window.windowId));
  const rawDir = String(session.semanticTarget?.rawDir || '').trim();
  for (const previousWindow of existingBundle?.processingWindows || []) {
    const oldId = String(previousWindow.windowId || '');
    if (!/^capture-window-[0-9a-f]{20}$/.test(oldId) || currentWindowIds.has(oldId)) continue;
    retiredWindowIds.push(oldId);
    if (rawDir) {
      const oldFile = path.join(rawDir, '屏幕学习会话', `${String(session.id).replace(/[^a-zA-Z0-9._-]/g, '_')}.${oldId}.md`);
      if (fs.existsSync(oldFile)) {
        const retiredFile = path.join(path.dirname(bundlePath(rootPath, session.studentId, session.id)), 'retired', path.basename(oldFile));
        fs.mkdirSync(path.dirname(retiredFile), { recursive: true });
        fs.renameSync(oldFile, retiredFile);
      }
    }
  }
  adjustRecognitionReferences(existingBundle, bundle);
  persistSemanticResult(rootPath, session, segmentsByDate, memoriesByDate, bundle);
  for (const previousWindow of existingBundle?.processingWindows || []) {
    if (!previousWindow.windowId || currentWindowIds.has(previousWindow.windowId)) continue;
    try { fs.rmSync(processingWindowPath(rootPath, session.studentId, session.id, previousWindow.windowId), { force: true }); }
    catch { /* Stale derived manifests never block a fresh source index. */ }
  }
  let publishedBundlePath = '';
  const publishedWindowPaths = [];
  const publishedEvidencePaths = [];
  if (rawDir) {
    const bundleDir = path.join(rawDir, '屏幕学习会话');
    // Images and path-bearing manifests must never be placed in the formal
    // knowledge Agent's raw-material tree. Only the path-free Markdown facts
    // are promoted there; visual delivery reads this separate capture area.
    const evidenceDir = captureEvidenceRoot(rootPath, session.studentId, session.id);
    fs.mkdirSync(bundleDir, { recursive: true });
    fs.mkdirSync(evidenceDir, { recursive: true });
    for (const frame of keyFrames) {
      if (!frame.originalPath || !fs.existsSync(frame.originalPath)) continue;
      const extension = path.extname(frame.originalPath).toLowerCase() || '.png';
      const evidenceTarget = path.join(evidenceDir, `${String(frame.eventId).replace(/[^a-zA-Z0-9._-]/g, '_')}${extension}`);
      if (!fs.existsSync(evidenceTarget) || (await sha1File(evidenceTarget)) !== frame.contentHash) fs.copyFileSync(frame.originalPath, evidenceTarget);
      frame.evidencePath = evidenceTarget;
      publishedEvidencePaths.push(evidenceTarget);
    }
    publishedBundlePath = bundlePath(rootPath, session.studentId, session.id).replace(/\.bundle\.json$/i, '.md');
    fs.mkdirSync(path.dirname(publishedBundlePath), { recursive: true });
    const temporary = `${publishedBundlePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, bundleMarkdown(session, bundle, allSegments), 'utf8');
    fs.renameSync(temporary, publishedBundlePath);
    for (const window of processingWindows) {
      const windowEventIds = new Set(window.sourceEventIds);
      const windowKeyIds = new Set(window.keyEventIds);
      const windowSegments = allSegments.filter((segment) => window.segmentIds.includes(segment.segmentId));
      const scopedBundle = {
        ...bundle,
        processingWindows: [window],
        sourceEventIds: window.sourceEventIds,
        keyFrames: keyFrames.filter((frame) => windowKeyIds.has(frame.eventId)),
        sourceHashes: Object.fromEntries(Object.entries(bundle.sourceHashes).filter(([eventId]) => windowEventIds.has(eventId))),
        visionBatches: visionBatches.filter((batch) => batch.windowId === window.windowId),
        segmentIds: window.segmentIds,
      };
      const windowPath = path.join(bundleDir, `${String(session.id).replace(/[^a-zA-Z0-9._-]/g, '_')}.${window.windowId}.md`);
      const windowTemporary = `${windowPath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(windowTemporary, `${bundleMarkdown(session, scopedBundle, windowSegments)}\n<!-- EDU_CAPTURE_WINDOW_ID: ${window.windowId} -->\n`, 'utf8');
      fs.renameSync(windowTemporary, windowPath);
      publishedWindowPaths.push({ windowId: window.windowId, path: windowPath, segmentIds: window.segmentIds });
    }
    atomicWriteJson(visionManifestPath(rootPath, session.studentId, session.id), {
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
    publishedWindowPaths,
    retiredWindowIds,
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

module.exports = { adjustRecognitionReferences, allocateKeyFrames, processSession, recognizeEvent, runWindowsOcr, sha1File };
