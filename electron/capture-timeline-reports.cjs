const fs = require('fs');
const path = require('path');
const { safeId, eventsPath } = require('./capture-timeline.cjs');
const { atomicWriteJson, readJson, segmentsPath, bundlePath } = require('./capture-timeline-semantic.cjs');

const REPORT_SCHEMA = 'edu-manager.capture-learning-reports.v1';

function reportPath(rootPath, studentId, kind, key) {
  return path.join(rootPath, 'reports', safeId(studentId), kind, `${safeId(key)}.json`);
}

function reportRepairJobPath(rootPath, studentId, sessionId) {
  return path.join(rootPath, 'report-jobs', safeId(studentId), `${safeId(sessionId)}.json`);
}

function writeReportRepairJob(rootPath, job) {
  const normalized = {
    schema: 'edu-manager.capture-report-repair-job.v1',
    ...job,
    studentId: String(job.studentId || ''),
    sessionId: String(job.sessionId || ''),
    dates: [...new Set((job.dates || []).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(String(date))))],
    updatedAt: new Date().toISOString(),
  };
  atomicWriteJson(reportRepairJobPath(rootPath, normalized.studentId, normalized.sessionId), normalized);
  return normalized;
}

function weekStart(date) {
  const [year, month, day] = String(date).split('-').map(Number);
  const value = new Date(year, month - 1, day);
  value.setDate(value.getDate() - ((value.getDay() + 6) % 7));
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function weekDates(date) {
  const first = weekStart(date);
  const [year, month, day] = first.split('-').map(Number);
  return Array.from({ length: 7 }, (_, index) => {
    const value = new Date(year, month - 1, day + index);
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  });
}

function readEvents(rootPath, studentId, date) {
  try {
    const seen = new Set();
    return fs.readFileSync(eventsPath(rootPath, studentId, date), 'utf8').split(/\r?\n/).filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter((event) => {
        const id = String(event?.id || '');
        if (!id || seen.has(id) || String(event.studentId) !== String(studentId)) return false;
        seen.add(id);
        return true;
      });
  } catch { return []; }
}

function compactSegment(segment) {
  const accepted = segment.observationStatus === 'accepted';
  const observation = accepted ? segment.observation || {} : {};
  return {
    segmentId: String(segment.segmentId || ''),
    date: String(segment.date || ''),
    sessionId: String(segment.sessionId || ''),
    projectId: String(segment.projectId || ''),
    startedAt: String(segment.startedAt || ''),
    endedAt: String(segment.endedAt || ''),
    topic: accepted ? String(observation.topic || segment.topic || '') : '',
    activityType: accepted ? String(observation.activityType || 'unknown') : 'unknown',
    observedAction: String(observation.observedAction || ''),
    attempts: observation.attempts || [],
    obstacle: String(observation.obstacle || ''),
    difficultyOrChange: String(observation.difficultyOrChange || ''),
    observedOutcome: String(observation.observedOutcome || ''),
    reason: observation.reason || null,
    evidenceEventIds: (segment.keyEventIds || []).map(String),
    evidenceRefs: observation.evidenceRefs || [],
    guidanceResponses: accepted ? (segment.guidanceResponses || []).filter((item) => item?.text && Array.isArray(item.evidenceRefs) && item.evidenceRefs.length > 0) : [],
    status: accepted ? 'observed' : 'pending_or_unknown',
  };
}

function aggregateTimeline(segments) {
  const observed = segments.filter((segment) => segment.status === 'observed');
  const topics = [...new Set(observed.map((segment) => segment.topic).filter(Boolean))].slice(0, 12);
  return {
    segmentCount: segments.length,
    observedCount: observed.length,
    unknownCount: segments.length - observed.length,
    topics,
    attempts: observed.flatMap((segment) => segment.attempts.map((text) => ({ segmentId: segment.segmentId, projectId: segment.projectId, text }))).slice(0, 30),
    obstacles: observed.filter((segment) => segment.obstacle).map((segment) => ({ segmentId: segment.segmentId, projectId: segment.projectId, text: segment.obstacle })).slice(0, 30),
    changes: observed.filter((segment) => segment.difficultyOrChange).map((segment) => ({ segmentId: segment.segmentId, projectId: segment.projectId, text: segment.difficultyOrChange })).slice(0, 30),
    outcomes: observed.filter((segment) => segment.observedOutcome).map((segment) => ({ segmentId: segment.segmentId, projectId: segment.projectId, text: segment.observedOutcome })).slice(0, 30),
    guidance: observed.flatMap((segment) => segment.guidanceResponses.map((item) => ({ segmentId: segment.segmentId, projectId: segment.projectId, text: item.text, evidenceRefs: item.evidenceRefs }))).slice(0, 30),
  };
}

function buildDayReport(rootPath, studentId, date) {
  const segments = (readJson(segmentsPath(rootPath, studentId, date), { segments: [] }).segments || [])
    .filter((segment) => String(segment.studentId) === String(studentId)).map(compactSegment);
  const events = readEvents(rootPath, studentId, date);
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, screenshotCount: 0, highlightedCount: 0, segmentCount: 0, activitySegmentCounts: {} }));
  for (const event of events) {
    const hour = new Date(event.occurredAt).getHours();
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    hours[hour].screenshotCount += 1;
    if (event.highlighted) hours[hour].highlightedCount += 1;
  }
  const activityCounts = {};
  for (const segment of segments) {
    activityCounts[segment.activityType] = (activityCounts[segment.activityType] || 0) + 1;
    const hour = new Date(segment.startedAt).getHours();
    if (Number.isInteger(hour) && hour >= 0 && hour < 24) {
      hours[hour].segmentCount += 1;
      hours[hour].activitySegmentCounts[segment.activityType] = (hours[hour].activitySegmentCounts[segment.activityType] || 0) + 1;
    }
  }
  const byProject = {};
  for (const segment of segments) (byProject[segment.projectId || 'student'] ||= []).push(segment);
  return {
    schema: REPORT_SCHEMA,
    studentId: String(studentId),
    date,
    timelineReport: {
      level: 'day',
      ...aggregateTimeline(segments),
      projects: Object.entries(byProject).map(([projectId, items]) => ({ projectId, ...aggregateTimeline(items) })),
      segments,
    },
    behaviorReport: {
      level: 'day',
      screenshotCount: events.length,
      highlightedCount: events.filter((event) => event.highlighted).length,
      sessionCount: new Set(events.map((event) => String(event.sessionId || '')).filter(Boolean)).size,
      representativeCount: new Set(segments.flatMap((segment) => segment.evidenceEventIds)).size,
      activitySegmentCounts: activityCounts,
      hours: hours.filter((hour) => hour.screenshotCount > 0 || hour.segmentCount > 0),
      durationMinutes: null,
      note: '仅统计可观察屏幕证据与活动段，不代表有效学习或专注时长。',
    },
    generatedAt: new Date().toISOString(),
  };
}

function rebuildReports(rootPath, studentId, sessionId, dates) {
  const uniqueDates = [...new Set((dates || []).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(String(date))))];
  const failedDates = [];
  const dayReports = uniqueDates.flatMap((date) => {
    try {
      const report = buildDayReport(rootPath, studentId, date);
      atomicWriteJson(reportPath(rootPath, studentId, 'days', date), report);
      return [report];
    } catch (error) {
      failedDates.push({ date, error: String(error.message || error) });
      return [];
    }
  });
  const bundle = readJson(bundlePath(rootPath, studentId, sessionId), null);
  if (bundle) {
    try {
      const sessionDates = [...new Set((bundle.segmentRefs || []).map((ref) => ref.date).filter(Boolean))];
      const sessionSegments = sessionDates.flatMap((date) =>
        (readJson(segmentsPath(rootPath, studentId, date), { segments: [] }).segments || [])
          .filter((segment) => String(segment.sessionId) === String(sessionId) && String(segment.studentId) === String(studentId)).map(compactSegment));
      atomicWriteJson(reportPath(rootPath, studentId, 'sessions', sessionId), {
        schema: REPORT_SCHEMA, studentId, sessionId, dates: sessionDates,
        timelineReport: { level: 'session', ...aggregateTimeline(sessionSegments), segments: sessionSegments },
        behaviorReport: { level: 'session', screenshotCount: Number(bundle.sourceEventIds?.length || 0), representativeCount: Number(bundle.keyFrames?.length || 0), durationMinutes: null },
        generatedAt: new Date().toISOString(),
      });
    } catch (error) { failedDates.push({ date: 'session', error: String(error.message || error) }); }
  }
  for (const first of new Set(uniqueDates.map(weekStart))) {
    const reports = weekDates(first).map((date) => readJson(reportPath(rootPath, studentId, 'days', date), null)).filter(Boolean);
    const segments = reports.flatMap((report) => report.timelineReport.segments || []);
    const screenshotCount = reports.reduce((sum, report) => sum + Number(report.behaviorReport.screenshotCount || 0), 0);
    const activitySegmentCounts = {};
    for (const segment of segments) activitySegmentCounts[segment.activityType] = (activitySegmentCounts[segment.activityType] || 0) + 1;
    const byProject = {};
    for (const segment of segments) (byProject[segment.projectId || 'student'] ||= []).push(segment);
    try { atomicWriteJson(reportPath(rootPath, studentId, 'weeks', first), {
      schema: REPORT_SCHEMA, studentId, weekStart: first, dates: reports.map((report) => report.date),
      timelineReport: { level: 'week', ...aggregateTimeline(segments), projects: Object.entries(byProject).map(([projectId, items]) => ({ projectId, ...aggregateTimeline(items) })), segmentRefs: segments.map((segment) => ({ date: segment.date, segmentId: segment.segmentId, sessionId: segment.sessionId })) },
      behaviorReport: {
        level: 'week', screenshotCount, activitySegmentCounts,
        days: reports.map((report) => ({ date: report.date, screenshotCount: report.behaviorReport.screenshotCount, activitySegmentCounts: report.behaviorReport.activitySegmentCounts })),
        durationMinutes: null, note: '按各日事实汇总，不代表有效学习或专注时长。',
      },
      generatedAt: new Date().toISOString(),
    }); } catch (error) { failedDates.push({ date: first, error: String(error.message || error) }); }
  }
  return { ok: failedDates.length === 0, dayCount: dayReports.length, weekCount: new Set(uniqueDates.map(weekStart)).size, failedDates };
}

function readReports(rootPath, studentId, date, sessionId = '') {
  return {
    day: readJson(reportPath(rootPath, studentId, 'days', date), null),
    week: readJson(reportPath(rootPath, studentId, 'weeks', weekStart(date)), null),
    session: sessionId ? readJson(reportPath(rootPath, studentId, 'sessions', sessionId), null) : null,
  };
}

module.exports = { REPORT_SCHEMA, aggregateTimeline, buildDayReport, readReports, rebuildReports, reportPath, reportRepairJobPath, weekDates, weekStart, writeReportRepairJob };
