'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA_VERSION = 1;

function text(value) { return String(value ?? '').trim(); }
function nowIso(now) { return new Date(now()).toISOString(); }
function reliableIso(value) {
  const raw = text(value);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)
    && Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : '';
}

function learningStatePath(studentRootPath) {
  return path.join(studentRootPath, '.edu-manager', 'learning-state.sqlite3');
}

function schemaSql() {
  return `
    CREATE TABLE IF NOT EXISTS learning_state_meta (
      key TEXT PRIMARY KEY, value TEXT NOT NULL
    ) STRICT;
    INSERT OR IGNORE INTO learning_state_meta(key,value) VALUES('generation','0');
    INSERT OR IGNORE INTO learning_state_meta(key,value) VALUES('changed_at','');
    CREATE TABLE IF NOT EXISTS knowledge_first_seen (
      student_id TEXT NOT NULL,
      knowledge_point_id TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '',
      first_seen_at TEXT NOT NULL DEFAULT '',
      first_source_key TEXT NOT NULL DEFAULT '',
      first_source_type TEXT NOT NULL DEFAULT '',
      first_source_id TEXT NOT NULL DEFAULT '',
      unknown_first_seen INTEGER NOT NULL DEFAULT 0 CHECK(unknown_first_seen IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(student_id,knowledge_point_id)
    ) WITHOUT ROWID, STRICT;
    CREATE TABLE IF NOT EXISTS knowledge_sources (
      student_id TEXT NOT NULL,
      knowledge_point_id TEXT NOT NULL,
      source_key TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT '',
      source_id TEXT NOT NULL DEFAULT '',
      event_id TEXT NOT NULL DEFAULT '',
      recorded_at TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      withdrawn_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY(student_id,knowledge_point_id,source_key),
      FOREIGN KEY(student_id,knowledge_point_id) REFERENCES knowledge_first_seen(student_id,knowledge_point_id)
    ) WITHOUT ROWID, STRICT;
    CREATE INDEX IF NOT EXISTS knowledge_sources_active ON knowledge_sources(student_id,active,knowledge_point_id);
    CREATE INDEX IF NOT EXISTS knowledge_first_seen_date ON knowledge_first_seen(student_id,unknown_first_seen,first_seen_at);
  `;
}

function localDateKey(value, timezone) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addCalendarDays(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return value.toISOString().slice(0, 10);
}

function weekCalendar(asOf, timezone) {
  const currentDate = localDateKey(asOf, timezone);
  if (!currentDate) throw Object.assign(new Error('统计截止时间无效。'), { code: 'as_of_invalid' });
  const [year, month, day] = currentDate.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const weekStart = addCalendarDays(currentDate, mondayOffset);
  const labels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  return {
    currentDate,
    weekStart,
    weekEnd: addCalendarDays(weekStart, 6),
    days: labels.map((label, index) => ({ date: addCalendarDays(weekStart, index), label })),
  };
}

function createLearningStateStore({ dbPath, now = Date.now, quickCheck = true }) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const existed = fs.existsSync(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
  const version = Number(db.prepare('PRAGMA user_version').get().user_version || 0);
  if (version !== 0 && version !== SCHEMA_VERSION) {
    db.close();
    throw Object.assign(new Error(`Unsupported learning state schema ${version}`), { code: 'learning_state_schema_unsupported' });
  }
  db.exec(schemaSql());
  if (!existed || version === 0) {
    db.prepare("UPDATE learning_state_meta SET value=? WHERE key='changed_at'").run(nowIso(now));
    db.exec(`PRAGMA user_version=${SCHEMA_VERSION}`);
  }
  if (quickCheck) {
    const check = db.prepare('PRAGMA quick_check').get();
    if (Object.values(check || {})[0] !== 'ok') {
      db.close();
      throw Object.assign(new Error('Learning state database integrity check failed'), { code: 'learning_state_db_corrupt' });
    }
  }

  function state() {
    const rows = db.prepare("SELECT key,value FROM learning_state_meta WHERE key IN ('generation','changed_at')").all();
    const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    return { generation: Math.max(0, Number(values.generation || 0)), changedAt: text(values.changed_at) };
  }

  function advanceGeneration(changedAt) {
    db.prepare("UPDATE learning_state_meta SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT) WHERE key='generation'").run();
    db.prepare("UPDATE learning_state_meta SET value=? WHERE key='changed_at'").run(changedAt);
  }

  function reconcileEvents(studentId, events = []) {
    studentId = text(studentId);
    if (!studentId || studentId === 'all') throw Object.assign(new Error('单学生范围缺失。'), { code: 'student_scope_missing' });
    const accepted = (Array.isArray(events) ? events : []).filter((event) => text(event?.studentId) === studentId && text(event?.knowledgePoint?.id));
    const changedAt = nowIso(now);
    let changed = false;
    db.exec('BEGIN IMMEDIATE');
    try {
      const groups = new Map();
      for (const event of accepted) {
        const pointId = text(event.knowledgePoint.id);
        if (!groups.has(pointId)) groups.set(pointId, []);
        groups.get(pointId).push(event);
      }
      for (const [pointId, pointEvents] of groups) {
        const existing = db.prepare('SELECT * FROM knowledge_first_seen WHERE student_id=? AND knowledge_point_id=?').get(studentId, pointId);
        const reliable = pointEvents.map((event) => reliableIso(event.recordedAt)).filter(Boolean).sort();
        const hasUnknown = reliable.length !== pointEvents.length;
        const earliest = reliable[0] || '';
        const firstEvent = earliest
          ? pointEvents.find((event) => reliableIso(event.recordedAt) === earliest) || pointEvents[0]
          : pointEvents[0];
        const firstRef = Array.isArray(firstEvent?.evidenceRefs) ? firstEvent.evidenceRefs[0] || {} : {};
        const label = text(pointEvents.at(-1)?.knowledgePoint?.label);
        const subject = text(pointEvents.at(-1)?.knowledgePoint?.subject || pointEvents.at(-1)?.subject);
        if (!existing) {
          db.prepare(`INSERT INTO knowledge_first_seen(student_id,knowledge_point_id,label,subject,first_seen_at,
            first_source_key,first_source_type,first_source_id,unknown_first_seen,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(studentId, pointId, label, subject, hasUnknown ? '' : earliest,
            `event:${text(firstEvent?.eventId)}`, text(firstRef.sourceType), text(firstRef.sourceId), hasUnknown ? 1 : 0, changedAt, changedAt);
          changed = true;
        } else {
          const nextUnknown = Number(existing.unknown_first_seen) === 1 || hasUnknown ? 1 : 0;
          if (existing.label !== label || existing.subject !== subject || Number(existing.unknown_first_seen) !== nextUnknown) {
            db.prepare(`UPDATE knowledge_first_seen SET label=?,subject=?,unknown_first_seen=?,updated_at=?
              WHERE student_id=? AND knowledge_point_id=?`).run(label, subject, nextUnknown, changedAt, studentId, pointId);
            changed = true;
          }
        }
      }

      const activeKeys = new Set();
      for (const event of accepted) {
        const pointId = text(event.knowledgePoint.id);
        const sourceKey = `event:${text(event.eventId)}`;
        activeKeys.add(`${pointId}\n${sourceKey}`);
        const ref = Array.isArray(event.evidenceRefs) ? event.evidenceRefs[0] || {} : {};
        const values = {
          sourceType: text(ref.sourceType), sourceId: text(ref.sourceId), eventId: text(event.eventId),
          recordedAt: reliableIso(event.recordedAt),
        };
        const existing = db.prepare(`SELECT * FROM knowledge_sources
          WHERE student_id=? AND knowledge_point_id=? AND source_key=?`).get(studentId, pointId, sourceKey);
        if (!existing) {
          db.prepare(`INSERT INTO knowledge_sources(student_id,knowledge_point_id,source_key,source_type,source_id,event_id,
            recorded_at,active,withdrawn_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
            .run(studentId, pointId, sourceKey, values.sourceType, values.sourceId, values.eventId, values.recordedAt, 1, '', changedAt);
          changed = true;
        } else if (Number(existing.active) !== 1 || existing.source_type !== values.sourceType || existing.source_id !== values.sourceId
          || existing.event_id !== values.eventId || existing.recorded_at !== values.recordedAt) {
          db.prepare(`UPDATE knowledge_sources SET source_type=?,source_id=?,event_id=?,recorded_at=?,active=1,withdrawn_at='',updated_at=?
            WHERE student_id=? AND knowledge_point_id=? AND source_key=?`)
            .run(values.sourceType, values.sourceId, values.eventId, values.recordedAt, changedAt, studentId, pointId, sourceKey);
          changed = true;
        }
      }
      const currentSources = db.prepare('SELECT knowledge_point_id,source_key,active FROM knowledge_sources WHERE student_id=?').all(studentId);
      for (const source of currentSources) {
        if (Number(source.active) !== 1 || activeKeys.has(`${source.knowledge_point_id}\n${source.source_key}`)) continue;
        db.prepare(`UPDATE knowledge_sources SET active=0,withdrawn_at=?,updated_at=?
          WHERE student_id=? AND knowledge_point_id=? AND source_key=?`).run(changedAt, changedAt, studentId, source.knowledge_point_id, source.source_key);
        changed = true;
      }
      if (changed) advanceGeneration(changedAt);
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* transaction already ended */ }
      throw error;
    }
    return { ok: true, changed, ...state() };
  }

  function listPoints(studentId) {
    return db.prepare(`SELECT p.student_id studentId,p.knowledge_point_id knowledgePointId,p.label,p.subject,
      p.first_seen_at firstSeenAt,p.unknown_first_seen unknownFirstSeen,p.first_source_type firstSourceType,
      p.first_source_id firstSourceId,
      (SELECT COUNT(*) FROM knowledge_sources s WHERE s.student_id=p.student_id AND s.knowledge_point_id=p.knowledge_point_id AND s.active=1) activeSourceCount
      FROM knowledge_first_seen p WHERE p.student_id=? ORDER BY p.knowledge_point_id`).all(text(studentId)).map((row) => ({
      ...row, unknownFirstSeen: Boolean(row.unknownFirstSeen), activeSourceCount: Number(row.activeSourceCount),
    }));
  }

  function weeklyGrowth({ studentId, asOf, timezone }) {
    studentId = text(studentId);
    timezone = text(timezone) || 'UTC';
    const calendar = weekCalendar(asOf, timezone);
    const points = listPoints(studentId);
    const counts = new Map(calendar.days.map((day) => [day.date, 0]));
    let unknownFirstSeenCount = 0;
    for (const point of points) {
      if (point.activeSourceCount <= 0) continue;
      if (point.unknownFirstSeen || !point.firstSeenAt) { unknownFirstSeenCount += 1; continue; }
      const date = localDateKey(point.firstSeenAt, timezone);
      if (counts.has(date) && date <= calendar.currentDate) counts.set(date, counts.get(date) + 1);
    }
    const days = calendar.days.map((day) => ({ ...day, count: day.date > calendar.currentDate ? null : counts.get(day.date) || 0 }));
    return {
      ...calendar,
      days,
      weeklyNewKnowledgePoints: days.reduce((sum, day) => sum + (day.count || 0), 0),
      unknownFirstSeenCount,
      ...state(),
    };
  }

  return { dbPath, db, state, reconcileEvents, listPoints, weeklyGrowth, close() { db.close(); } };
}

module.exports = { SCHEMA_VERSION, createLearningStateStore, learningStatePath, localDateKey, weekCalendar };
