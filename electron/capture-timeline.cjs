const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { attachEventCoverage } = require('./capture-timeline-duration.cjs');

const TIMELINE_SCHEMA = 'edu-manager.learner-event.v1';
const TEMPORAL_SCHEMA = 'edu-manager.temporal-event.v1';
const eventIdCache = new Map();

function safeId(value) {
  const input = String(value || '').trim();
  const stem = input.replace(/[^a-zA-Z0-9\u4e00-\u9fff._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'unknown';
  const hash = crypto.createHash('sha1').update(input || 'unknown').digest('hex').slice(0, 10);
  return `${stem}-${hash}`;
}

function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  const valid = Number.isFinite(date.getTime()) ? date : new Date();
  const year = valid.getFullYear();
  const month = String(valid.getMonth() + 1).padStart(2, '0');
  const day = String(valid.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function validReportedTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const milliseconds = Date.parse(raw);
  if (!Number.isFinite(milliseconds)) return null;
  return { raw, iso: new Date(milliseconds).toISOString() };
}

function reportedTimePrecision(raw) {
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) return 'timezone_unspecified';
  if (/\.\d+(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) return 'subsecond';
  if (/T\d{2}:\d{2}:\d{2}/i.test(raw)) return 'second';
  return 'minute_or_coarser';
}

function explicitActor(session, item) {
  const claimedActorType = String(item.actorType || session.actorType || '').trim().toLowerCase();
  const actorEvidence = String(item.actorEvidence || session.actorEvidence || '').trim().slice(0, 240);
  const allowed = new Set(['student', 'parent', 'teacher']);
  return {
    actorType: allowed.has(claimedActorType) && actorEvidence ? claimedActorType : 'unknown',
    claimedActorType: allowed.has(claimedActorType) ? claimedActorType : '',
    actorEvidence,
  };
}

function timelineStudentRoot(rootPath, studentId) {
  return path.join(rootPath, 'timeline', safeId(studentId));
}

function timelineDateRoot(rootPath, studentId, date) {
  return path.join(timelineStudentRoot(rootPath, studentId), String(date));
}

function eventsPath(rootPath, studentId, date) {
  return path.join(timelineDateRoot(rootPath, studentId, date), 'events.jsonl');
}

function summaryPath(rootPath, studentId, date) {
  return path.join(timelineDateRoot(rootPath, studentId, date), 'summary.json');
}

function thumbnailsRoot(rootPath, studentId, date) {
  return path.join(timelineDateRoot(rootPath, studentId, date), 'thumbnails');
}

function thumbnailPath(rootPath, event) {
  return path.join(thumbnailsRoot(rootPath, event.studentId, event.date), `${safeId(event.id)}.jpg`);
}

function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temporary, filePath);
}

function readEvents(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function knownEventIds(filePath) {
  if (!eventIdCache.has(filePath)) {
    eventIdCache.set(filePath, new Set(readEvents(filePath).map((event) => String(event.id || ''))));
  }
  return eventIdCache.get(filePath);
}

function captureEventFromSessionItem(session = {}, item = {}) {
  const processedAt = new Date().toISOString();
  const reportedCapture = validReportedTime(item.capturedAt);
  const reportedUpload = validReportedTime(item.uploadedAt);
  const reportedSessionStart = validReportedTime(session.startedAt);
  // A screenshot cannot be captured well after its host-side receipt. Preserve
  // the device value for audit, but do not treat its interval as measured time.
  const clockStatus = reportedCapture && reportedUpload
    && Date.parse(reportedCapture.iso) - Date.parse(reportedUpload.iso) > 5 * 60_000
    ? 'suspected_future_capture' : reportedCapture && reportedUpload ? 'not_future_skewed'
      : 'not_comparable';
  const timeSource = reportedCapture ? 'captured_at' : reportedUpload ? 'uploaded_at'
    : reportedSessionStart ? 'session_started_at' : 'processing_at';
  const selectedTime = reportedCapture || reportedUpload || reportedSessionStart || { raw: processedAt, iso: processedAt };
  const capturedAt = selectedTime.iso;
  const legacyEventTime = String(item.capturedAt || item.uploadedAt || session.startedAt || '');
  const fallbackId = legacyEventTime ? `${session.id || 'capture'}-${legacyEventTime}`
    : `capture-${crypto.createHash('sha1').update([
      session.id || '', item.sequence ?? '', item.contentHash || item.sha1 || '', item.path || '',
    ].join('|')).digest('hex').slice(0, 24)}`;
  const eventId = String(item.id || item.captureItemId || fallbackId);
  const actor = explicitActor(session, item);
  return {
    schema: TIMELINE_SCHEMA,
    temporalSchema: TEMPORAL_SCHEMA,
    id: eventId,
    eventType: 'capture',
    occurredAt: capturedAt,
    reportedCapturedAt: String(item.reportedCapturedAtRaw || item.capturedAt || '').trim().slice(0, 80),
    reportedUploadedAt: String(item.uploadedAt || '').trim().slice(0, 80),
    receivedAt: reportedUpload?.iso || '',
    receivedAtSource: String(item.receivedAtSource || '').trim().slice(0, 40),
    processedAt,
    timeSource,
    timePrecision: reportedCapture ? reportedTimePrecision(reportedCapture.raw) : 'event_time_unknown',
    captureTimeStatus: String(item.captureTimeStatus || (reportedCapture ? 'device_reported' : 'unknown')).trim().slice(0, 40),
    clockStatus,
    localDateTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    reportedClockOffsetMs: Number.isFinite(Number(item.clockOffsetMs)) && item.clockOffsetMs !== '' && item.clockOffsetMs != null
      ? Number(item.clockOffsetMs) : null,
    date: localDateKey(capturedAt),
    studentId: String(session.studentId || ''),
    deviceId: String(item.deviceId || session.deviceId || ''),
    studentName: String(session.studentName || ''),
    sessionId: String(session.id || item.captureSessionId || ''),
    sessionName: String(session.name || ''),
    platform: String(session.platform || 'windows'),
    sourceType: String(session.sourceType || 'screen'),
    sourceName: String(session.sourceName || '屏幕采集'),
    projectId: String(session.projectId || ''),
    projectName: String(session.projectName || ''),
    courseId: String(session.courseId || ''),
    courseName: String(session.courseName || ''),
    courseUrl: String(session.courseUrl || ''),
    taskId: String(item.taskId || session.taskId || ''),
    taskVersion: String(item.taskVersion || session.taskVersion || ''),
    conceptIds: (Array.isArray(item.conceptIds) ? item.conceptIds : Array.isArray(session.conceptIds) ? session.conceptIds : [])
      .map((value) => String(value || '').trim()).filter(Boolean).slice(0, 20),
    ...actor,
    reason: String(item.reason || 'interval'),
    difference: Number(item.difference || 0),
    highlighted: Boolean(item.isHighlighted),
    archiveStatus: String(item.archiveStatus || 'candidate'),
    assetId: String(item.assetId || ''),
    hashAlgorithm: String(item.hashAlgorithm || (item.sha1 ? 'sha1' : '')),
    contentHash: String(item.contentHash || item.sha1 || ''),
    filename: String(item.filename || path.basename(String(item.path || ''))),
    originalPath: String(item.path || ''),
    createdAt: new Date().toISOString(),
  };
}

function publicEvent(event, rootPath) {
  const thumb = thumbnailPath(rootPath, event);
  const { originalPath: _originalPath, ...safe } = event;
  return { ...safe, thumbnailAvailable: fs.existsSync(thumb) };
}

function appendEvent(rootPath, event) {
  if (!event.studentId || !event.id) return { appended: false, event };
  const filePath = eventsPath(rootPath, event.studentId, event.date);
  const ids = knownEventIds(filePath);
  if (ids.has(event.id)) return { appended: false, event };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, 'utf8');
  ids.add(event.id);
  const oldSummary = readJson(summaryPath(rootPath, event.studentId, event.date), {});
  const sessions = new Set(Array.isArray(oldSummary.sessionIds) ? oldSummary.sessionIds.map(String) : []);
  if (event.sessionId) sessions.add(event.sessionId);
  writeJsonAtomic(summaryPath(rootPath, event.studentId, event.date), {
    schema: TIMELINE_SCHEMA,
    studentId: event.studentId,
    studentName: event.studentName,
    date: event.date,
    eventCount: Number(oldSummary.eventCount || 0) + 1,
    highlightedCount: Number(oldSummary.highlightedCount || 0) + (event.highlighted ? 1 : 0),
    firstOccurredAt: oldSummary.firstOccurredAt && oldSummary.firstOccurredAt < event.occurredAt ? oldSummary.firstOccurredAt : event.occurredAt,
    lastOccurredAt: oldSummary.lastOccurredAt && oldSummary.lastOccurredAt > event.occurredAt ? oldSummary.lastOccurredAt : event.occurredAt,
    sessionIds: Array.from(sessions).slice(-200),
    updatedAt: new Date().toISOString(),
  });
  return { appended: true, event };
}

function appendCaptureItem(rootPath, session, item) {
  const event = captureEventFromSessionItem(session, item);
  const covered = attachEventCoverage([event], session, { contextEvents: [event] })[0];
  return appendEvent(rootPath, covered);
}

function rebuildSessionTimeline(rootPath, session = {}) {
  const items = Array.isArray(session.items) ? session.items : [];
  const timelineEvents = items.map((item) => captureEventFromSessionItem(session, item));
  const coveredEvents = attachEventCoverage(timelineEvents, session, { contextEvents: timelineEvents });
  const grouped = new Map();
  for (const event of coveredEvents) {
    if (!event.studentId || !event.id) continue;
    const group = grouped.get(event.date) || [];
    group.push(event);
    grouped.set(event.date, group);
  }
  let appended = 0;
  for (const [date, candidates] of grouped) {
    const filePath = eventsPath(rootPath, session.studentId, date);
    const existing = readEvents(filePath);
    const ids = new Set(existing.map((event) => String(event.id || '')));
    const candidateById = new Map(candidates.map((event) => [String(event.id || ''), event]));
    let updated = false;
    const retained = existing.map((event) => {
      const candidate = candidateById.get(String(event.id || ''));
      if (!candidate) return event;
      const coverage = {
        coverageStartAt: candidate.coverageStartAt || '',
        coverageEndAt: candidate.coverageEndAt || '',
        durationMs: Math.max(0, Number(candidate.durationMs || 0)),
        observedDurationMs: Math.max(0, Number(candidate.observedDurationMs || 0)),
        inferredDurationMs: Math.max(0, Number(candidate.inferredDurationMs || 0)),
        unobservedDurationMs: Math.max(0, Number(candidate.unobservedDurationMs || 0)),
        duplicateSampleCount: Math.max(0, Number(candidate.duplicateSampleCount || 0)),
        trustedSampleCount: Math.max(0, Number(candidate.trustedSampleCount || 0)),
        durationBasis: String(candidate.durationBasis || ''),
        durationConfidence: String(candidate.durationConfidence || ''),
        historicalReconstruction: Boolean(candidate.historicalReconstruction),
      };
      if (Object.entries(coverage).some(([key, value]) => event[key] !== value)) updated = true;
      return { ...event, ...coverage };
    });
    const additions = candidates.filter((event) => {
      if (ids.has(event.id)) return false;
      ids.add(event.id);
      return true;
    });
    if (!additions.length && !updated) {
      eventIdCache.set(filePath, ids);
      continue;
    }
    const nextEvents = [...retained, ...additions]
      .sort((left, right) => String(left.occurredAt || '').localeCompare(String(right.occurredAt || '')) || String(left.id || '').localeCompare(String(right.id || '')));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${nextEvents.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8');
    eventIdCache.set(filePath, ids);
    rebuildDateSummary(rootPath, session.studentId, date, nextEvents);
    appended += additions.length;
  }
  return { ok: true, appended, total: items.length };
}

function listDates(rootPath, studentId, month = '') {
  const studentRoot = timelineStudentRoot(rootPath, studentId);
  if (!fs.existsSync(studentRoot)) return [];
  return fs.readdirSync(studentRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name) && (!month || entry.name.startsWith(month)))
    .map((entry) => readJson(summaryPath(rootPath, studentId, entry.name), { date: entry.name, eventCount: 0 }))
    .sort((left, right) => String(right.date).localeCompare(String(left.date)));
}

function parseCursor(cursor) {
  const value = Number.parseInt(String(cursor || '0'), 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function queryTimeline(rootPath, input = {}) {
  const studentId = String(input.studentId || '');
  const date = String(input.date || '');
  const limit = Math.max(1, Math.min(60, Number(input.limit || 30)));
  if (!studentId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, events: [], nextCursor: '', message: '请选择学生和日期。' };
  const archiveStatuses = input.sessionArchiveStatuses && typeof input.sessionArchiveStatuses === 'object' ? input.sessionArchiveStatuses : {};
  let events = readEvents(eventsPath(rootPath, studentId, date)).map((event) => ({
    ...event,
    archiveStatus: String(archiveStatuses[event.sessionId] || event.archiveStatus || 'candidate'),
  }));
  if (input.reason) events = events.filter((event) => event.reason === input.reason);
  if (input.archiveStatus) events = events.filter((event) => input.archiveStatus === 'candidate'
    ? ['candidate', 'awaiting_review'].includes(event.archiveStatus)
    : event.archiveStatus === input.archiveStatus);
  if (input.sessionId) events = events.filter((event) => event.sessionId === input.sessionId);
  events.sort((left, right) => String(left.occurredAt).localeCompare(String(right.occurredAt)));
  const offset = parseCursor(input.cursor);
  const page = events.slice(offset, offset + limit).map((event) => publicEvent(event, rootPath));
  const nextOffset = offset + page.length;
  return {
    ok: true,
    studentId,
    date,
    total: events.length,
    events: page,
    nextCursor: nextOffset < events.length ? String(nextOffset) : '',
  };
}

function findEvent(rootPath, studentId, date, eventId) {
  if (!studentId || !eventId || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return null;
  return readEvents(eventsPath(rootPath, studentId, date)).find((event) => String(event.id) === String(eventId)) || null;
}

function findEvents(rootPath, studentId, date, eventIds = []) {
  if (!studentId || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return new Map();
  const requested = new Set((eventIds || []).map(String).filter(Boolean));
  if (!requested.size) return new Map();
  return new Map(readEvents(eventsPath(rootPath, studentId, date))
    .filter((event) => requested.has(String(event.id || '')))
    .map((event) => [String(event.id), event]));
}

function rebuildDateSummary(rootPath, studentId, date, events) {
  const target = summaryPath(rootPath, studentId, date);
  if (!events.length) {
    if (fs.existsSync(target)) fs.rmSync(target, { force: true });
    return;
  }
  const sessions = Array.from(new Set(events.map((event) => String(event.sessionId || '')).filter(Boolean)));
  writeJsonAtomic(target, {
    schema: TIMELINE_SCHEMA,
    studentId,
    studentName: events.find((event) => event.studentName)?.studentName || '',
    date,
    eventCount: events.length,
    highlightedCount: events.filter((event) => event.highlighted).length,
    firstOccurredAt: events.map((event) => event.occurredAt).sort()[0] || '',
    lastOccurredAt: events.map((event) => event.occurredAt).sort().at(-1) || '',
    sessionIds: sessions.slice(-200),
    updatedAt: new Date().toISOString(),
  });
}

function deleteSessionEvents(rootPath, studentId, sessionId) {
  const studentRoot = timelineStudentRoot(rootPath, studentId);
  if (!fs.existsSync(studentRoot)) return { removed: 0 };
  let removed = 0;
  for (const entry of fs.readdirSync(studentRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
    const filePath = eventsPath(rootPath, studentId, entry.name);
    const events = readEvents(filePath);
    const deleted = events.filter((event) => String(event.sessionId || '') === String(sessionId));
    if (!deleted.length) continue;
    const retained = events.filter((event) => String(event.sessionId || '') !== String(sessionId));
    for (const event of deleted) {
      const thumb = thumbnailPath(rootPath, event);
      if (fs.existsSync(thumb)) fs.rmSync(thumb, { force: true });
    }
    if (retained.length) fs.writeFileSync(filePath, `${retained.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8');
    else if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
    eventIdCache.delete(filePath);
    rebuildDateSummary(rootPath, studentId, entry.name, retained);
    const dateRoot = timelineDateRoot(rootPath, studentId, entry.name);
    if (!retained.length && path.dirname(dateRoot) === studentRoot && fs.existsSync(dateRoot)) {
      fs.rmSync(dateRoot, { recursive: true, force: true });
    }
    removed += deleted.length;
  }
  return { removed };
}

module.exports = {
  TIMELINE_SCHEMA,
  TEMPORAL_SCHEMA,
  appendCaptureItem,
  appendEvent,
  captureEventFromSessionItem,
  deleteSessionEvents,
  eventsPath,
  findEvent,
  findEvents,
  listDates,
  localDateKey,
  publicEvent,
  queryTimeline,
  rebuildSessionTimeline,
  safeId,
  thumbnailPath,
};
