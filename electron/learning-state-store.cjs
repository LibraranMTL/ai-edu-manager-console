'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA_VERSION = 2;
const POLICY_VERSION = 'learning-state-1a-v1';
const DIMENSIONS = ['goalClarity', 'confidence', 'difficulty', 'recovery', 'workload'];
const SOURCE_CATEGORIES = new Set(['student_self_report', 'external_observation', 'system_observation', 'system_inference']);

function text(value) { return String(value ?? '').trim(); }
function nowIso(now) { return new Date(now()).toISOString(); }
function reliableIso(value) {
  const raw = text(value);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)
    && Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : '';
}
function parseJson(value, fallback = {}) { try { return JSON.parse(value); } catch { return fallback; } }
function id(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function sqliteString(value) { return `'${String(value).replaceAll("'", "''")}'`; }

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
    CREATE TABLE IF NOT EXISTS learning_checkins (
      student_id TEXT NOT NULL, checkin_id TEXT NOT NULL, client_submission_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('baseline','weekly')), occurred_at TEXT NOT NULL,
      dimensions_json TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', source_category TEXT NOT NULL,
      created_at TEXT NOT NULL, PRIMARY KEY(student_id,checkin_id), UNIQUE(student_id,client_submission_id)
    ) WITHOUT ROWID, STRICT;
    CREATE INDEX IF NOT EXISTS learning_checkins_time ON learning_checkins(student_id,created_at,occurred_at);
    CREATE TABLE IF NOT EXISTS learning_goal_versions (
      student_id TEXT NOT NULL, goal_id TEXT NOT NULL, revision INTEGER NOT NULL,
      category TEXT NOT NULL, title TEXT NOT NULL, success_criteria TEXT NOT NULL DEFAULT '',
      due_at TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL, actor_role TEXT NOT NULL, actor_id TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(student_id,goal_id,revision)
    ) WITHOUT ROWID, STRICT;
    CREATE INDEX IF NOT EXISTS learning_goal_versions_time ON learning_goal_versions(student_id,created_at,goal_id,revision);
    CREATE TABLE IF NOT EXISTS learning_problem_versions (
      student_id TEXT NOT NULL, problem_id TEXT NOT NULL, revision INTEGER NOT NULL,
      category TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
      actor_role TEXT NOT NULL, actor_id TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(student_id,problem_id,revision)
    ) WITHOUT ROWID, STRICT;
    CREATE INDEX IF NOT EXISTS learning_problem_versions_time ON learning_problem_versions(student_id,created_at,problem_id,revision);
    CREATE TABLE IF NOT EXISTS learning_evidence_versions (
      student_id TEXT NOT NULL, evidence_id TEXT NOT NULL, revision INTEGER NOT NULL,
      source_category TEXT NOT NULL, source_type TEXT NOT NULL, source_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', statement TEXT NOT NULL,
      dimension TEXT NOT NULL DEFAULT '', polarity TEXT NOT NULL DEFAULT 'neutral', payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL, actor_role TEXT NOT NULL, actor_id TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(student_id,evidence_id,revision), UNIQUE(student_id,source_type,source_id,revision)
    ) WITHOUT ROWID, STRICT;
    CREATE INDEX IF NOT EXISTS learning_evidence_time ON learning_evidence_versions(student_id,created_at,occurred_at);
    CREATE TABLE IF NOT EXISTS learning_findings (
      student_id TEXT NOT NULL, finding_id TEXT NOT NULL, input_fingerprint TEXT NOT NULL,
      source_category TEXT NOT NULL, evidence_type TEXT NOT NULL, evidence_id TEXT NOT NULL,
      statement TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('published','pending','disputed')),
      confidence TEXT NOT NULL CHECK(confidence IN ('observed','self_reported','low','medium')),
      policy_version TEXT NOT NULL, as_of TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(student_id,finding_id), UNIQUE(student_id,input_fingerprint)
    ) WITHOUT ROWID, STRICT;
    CREATE INDEX IF NOT EXISTS learning_findings_time ON learning_findings(student_id,created_at,as_of);
    CREATE TABLE IF NOT EXISTS learning_corrections (
      student_id TEXT NOT NULL, correction_id TEXT NOT NULL, commit_key TEXT NOT NULL,
      target_type TEXT NOT NULL, object_id TEXT NOT NULL, target_revision INTEGER NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('correct','withdraw')), reason TEXT NOT NULL,
      replacement_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
      actor_role TEXT NOT NULL, actor_id TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(student_id,correction_id), UNIQUE(student_id,commit_key)
    ) WITHOUT ROWID, STRICT;
    CREATE INDEX IF NOT EXISTS learning_corrections_target ON learning_corrections(student_id,target_type,object_id,target_revision,created_at);
  `;
}

function schemaUpgradeBackup(db, dbPath, targetVersion, now) {
  const stamp = new Date(now()).toISOString().replaceAll(':', '-');
  let target = `${dbPath}.pre-schema-v${targetVersion}-${stamp}.sqlite3`;
  if (fs.existsSync(target)) target = `${target}-${crypto.randomBytes(3).toString('hex')}`;
  db.exec(`VACUUM INTO ${sqliteString(target)}`);
  return target;
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
  if (version > SCHEMA_VERSION || version < 0) {
    db.close();
    throw Object.assign(new Error(`Unsupported learning state schema ${version}`), { code: 'learning_state_schema_unsupported' });
  }
  if (version > 0 && version < SCHEMA_VERSION) schemaUpgradeBackup(db, dbPath, SCHEMA_VERSION, now);
  db.exec(schemaSql());
  if (!existed || version === 0) {
    db.prepare("UPDATE learning_state_meta SET value=? WHERE key='changed_at'").run(nowIso(now));
  }
  if (version < SCHEMA_VERSION) db.exec(`PRAGMA user_version=${SCHEMA_VERSION}`);
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

  function assertScope(scope, payloadStudentId = '') {
    const studentId = text(scope?.studentId);
    if (!studentId || studentId === 'all') throw Object.assign(new Error('单学生范围缺失。'), { code: 'student_scope_missing' });
    if (payloadStudentId && text(payloadStudentId) !== studentId) {
      throw Object.assign(new Error('写入内容与可信学生范围不一致。'), { code: 'student_scope_mismatch' });
    }
    const actorRole = text(scope?.actorRole);
    if (!actorRole) throw Object.assign(new Error('可信写入主体缺失。'), { code: 'actor_scope_missing' });
    return { studentId, actorRole, actorId: text(scope?.actorId) };
  }

  function assertReader(reader, studentId) {
    studentId = text(studentId);
    if (!studentId || studentId === 'all') throw Object.assign(new Error('单学生范围缺失。'), { code: 'student_scope_missing' });
    const readerStudentId = text(reader?.studentId);
    if (readerStudentId && readerStudentId !== studentId) {
      throw Object.assign(new Error('读取范围与授权学生不一致。'), { code: 'student_scope_mismatch' });
    }
    if (!text(reader?.role)) throw Object.assign(new Error('读取角色缺失。'), { code: 'reader_scope_missing' });
    return studentId;
  }

  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const value = work();
      db.exec('COMMIT');
      return value;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* transaction already ended */ }
      throw error;
    }
  }

  function normalizeDimensions(input) {
    const source = input && typeof input === 'object' ? input : {};
    const result = {};
    for (const key of DIMENSIONS) {
      const value = source[key];
      if (value === undefined || value === null || value === '') { result[key] = null; continue; }
      const number = Number(value);
      if (!Number.isInteger(number) || number < 1 || number > 5) {
        throw Object.assign(new Error(`${key} 必须是 1–5 或跳过。`), { code: 'checkin_dimension_invalid' });
      }
      result[key] = number;
    }
    return result;
  }

  function mapCheckIn(row) {
    return {
      studentId: row.student_id, checkInId: row.checkin_id, clientSubmissionId: row.client_submission_id,
      kind: row.kind, occurredAt: row.occurred_at, dimensions: parseJson(row.dimensions_json, {}), note: row.note,
      sourceCategory: row.source_category, createdAt: row.created_at,
    };
  }

  function submitCheckIn(scope, payload = {}, clientSubmissionId) {
    const actor = assertScope(scope, payload.studentId);
    clientSubmissionId = text(clientSubmissionId);
    if (!clientSubmissionId) throw Object.assign(new Error('稳定提交键缺失。'), { code: 'commit_key_missing' });
    const existing = db.prepare('SELECT * FROM learning_checkins WHERE student_id=? AND client_submission_id=?')
      .get(actor.studentId, clientSubmissionId);
    if (existing) return mapCheckIn(existing);
    const kind = text(payload.kind) || 'weekly';
    if (!['baseline', 'weekly'].includes(kind)) throw Object.assign(new Error('反馈类型无效。'), { code: 'checkin_kind_invalid' });
    const occurredAt = reliableIso(payload.occurredAt) || nowIso(now);
    const createdAt = nowIso(now);
    const checkInId = id('checkin');
    const dimensions = normalizeDimensions(payload.dimensions);
    return transaction(() => {
      db.prepare(`INSERT INTO learning_checkins(student_id,checkin_id,client_submission_id,kind,occurred_at,
        dimensions_json,note,source_category,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
        .run(actor.studentId, checkInId, clientSubmissionId, kind, occurredAt, JSON.stringify(dimensions), text(payload.note), 'student_self_report', createdAt);
      advanceGeneration(createdAt);
      return mapCheckIn(db.prepare('SELECT * FROM learning_checkins WHERE student_id=? AND checkin_id=?').get(actor.studentId, checkInId));
    });
  }

  function mapGoal(row) {
    return {
      studentId: row.student_id, goalId: row.goal_id, revision: Number(row.revision), category: row.category,
      title: row.title, successCriteria: row.success_criteria, dueAt: row.due_at, status: row.status,
      ...parseJson(row.payload_json, {}), createdAt: row.created_at,
    };
  }

  function upsertGoal(scope, goal = {}, expectedRevision) {
    const actor = assertScope(scope, goal.studentId);
    const goalId = text(goal.goalId) || id('goal');
    const current = db.prepare('SELECT MAX(revision) revision FROM learning_goal_versions WHERE student_id=? AND goal_id=?')
      .get(actor.studentId, goalId);
    const actualRevision = Number(current?.revision || 0);
    if (Number(expectedRevision) !== actualRevision) throw Object.assign(new Error('目标已被其他修改更新。'), { code: 'revision_conflict', actualRevision });
    if (!text(goal.title)) throw Object.assign(new Error('目标标题缺失。'), { code: 'goal_title_missing' });
    const createdAt = nowIso(now);
    const revision = actualRevision + 1;
    return transaction(() => {
      db.prepare(`INSERT INTO learning_goal_versions(student_id,goal_id,revision,category,title,success_criteria,due_at,status,
        payload_json,created_at,actor_role,actor_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(actor.studentId, goalId, revision, text(goal.category) || 'subject', text(goal.title), text(goal.successCriteria),
          reliableIso(goal.dueAt), text(goal.status) || 'active', '{}', createdAt, actor.actorRole, actor.actorId);
      advanceGeneration(createdAt);
      return mapGoal(db.prepare('SELECT * FROM learning_goal_versions WHERE student_id=? AND goal_id=? AND revision=?')
        .get(actor.studentId, goalId, revision));
    });
  }

  function mapProblem(row) {
    return {
      studentId: row.student_id, problemId: row.problem_id, revision: Number(row.revision), category: row.category,
      title: row.title, description: row.description, status: row.status, ...parseJson(row.payload_json, {}), createdAt: row.created_at,
    };
  }

  function upsertProblem(scope, problem = {}, expectedRevision) {
    const actor = assertScope(scope, problem.studentId);
    const problemId = text(problem.problemId) || id('problem');
    const current = db.prepare('SELECT MAX(revision) revision FROM learning_problem_versions WHERE student_id=? AND problem_id=?')
      .get(actor.studentId, problemId);
    const actualRevision = Number(current?.revision || 0);
    if (Number(expectedRevision) !== actualRevision) throw Object.assign(new Error('问题已被其他修改更新。'), { code: 'revision_conflict', actualRevision });
    if (!text(problem.title)) throw Object.assign(new Error('问题标题缺失。'), { code: 'problem_title_missing' });
    const createdAt = nowIso(now);
    const revision = actualRevision + 1;
    return transaction(() => {
      db.prepare(`INSERT INTO learning_problem_versions(student_id,problem_id,revision,category,title,description,status,
        payload_json,created_at,actor_role,actor_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
        .run(actor.studentId, problemId, revision, text(problem.category) || 'knowledge', text(problem.title), text(problem.description),
          text(problem.status) || 'watching', '{}', createdAt, actor.actorRole, actor.actorId);
      advanceGeneration(createdAt);
      return mapProblem(db.prepare('SELECT * FROM learning_problem_versions WHERE student_id=? AND problem_id=? AND revision=?')
        .get(actor.studentId, problemId, revision));
    });
  }

  function mapEvidence(row) {
    return {
      studentId: row.student_id, evidenceId: row.evidence_id, revision: Number(row.revision), sourceCategory: row.source_category,
      sourceType: row.source_type, sourceId: row.source_id, occurredAt: row.occurred_at, subject: row.subject,
      statement: row.statement, dimension: row.dimension, polarity: row.polarity, ...parseJson(row.payload_json, {}), createdAt: row.created_at,
    };
  }

  function ingestEvidence(scope, sourceRef = {}, revision) {
    const actor = assertScope(scope, sourceRef.studentId);
    const sourceCategory = text(sourceRef.sourceCategory);
    if (!SOURCE_CATEGORIES.has(sourceCategory)) throw Object.assign(new Error('证据来源类别无效。'), { code: 'evidence_source_category_invalid' });
    const evidenceId = text(sourceRef.evidenceId) || id('evidence');
    revision = Number(revision);
    if (!Number.isInteger(revision) || revision < 1) throw Object.assign(new Error('证据修订号无效。'), { code: 'revision_invalid' });
    const existing = db.prepare('SELECT * FROM learning_evidence_versions WHERE student_id=? AND evidence_id=? AND revision=?')
      .get(actor.studentId, evidenceId, revision);
    if (existing) return mapEvidence(existing);
    const current = db.prepare('SELECT MAX(revision) revision FROM learning_evidence_versions WHERE student_id=? AND evidence_id=?')
      .get(actor.studentId, evidenceId);
    if (revision !== Number(current?.revision || 0) + 1) throw Object.assign(new Error('证据修订不连续。'), { code: 'revision_conflict' });
    if (!text(sourceRef.statement)) throw Object.assign(new Error('证据事实描述缺失。'), { code: 'evidence_statement_missing' });
    const createdAt = nowIso(now);
    return transaction(() => {
      db.prepare(`INSERT INTO learning_evidence_versions(student_id,evidence_id,revision,source_category,source_type,source_id,
        occurred_at,subject,statement,dimension,polarity,payload_json,created_at,actor_role,actor_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(actor.studentId, evidenceId, revision, sourceCategory, text(sourceRef.sourceType), text(sourceRef.sourceId),
          reliableIso(sourceRef.occurredAt) || createdAt, text(sourceRef.subject), text(sourceRef.statement), text(sourceRef.dimension),
          text(sourceRef.polarity) || 'neutral', '{}', createdAt, actor.actorRole, actor.actorId);
      advanceGeneration(createdAt);
      return mapEvidence(db.prepare('SELECT * FROM learning_evidence_versions WHERE student_id=? AND evidence_id=? AND revision=?')
        .get(actor.studentId, evidenceId, revision));
    });
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

  function mapFinding(row) {
    return {
      studentId: row.student_id, findingId: row.finding_id, sourceCategory: row.source_category,
      evidenceType: row.evidence_type, evidenceId: row.evidence_id, statement: row.statement,
      status: row.status, confidence: row.confidence, policyVersion: row.policy_version,
      asOf: row.as_of, createdAt: row.created_at,
    };
  }

  function correctionExists(studentId, targetType, objectId, revision, asOf) {
    return Boolean(db.prepare(`SELECT 1 FROM learning_corrections WHERE student_id=? AND target_type=? AND object_id=?
      AND target_revision=? AND action='withdraw' AND created_at<=? LIMIT 1`).get(studentId, targetType, objectId, revision, asOf));
  }

  function publishFindings(studentId, asOf) {
    studentId = text(studentId);
    if (!studentId || studentId === 'all') throw Object.assign(new Error('单学生范围缺失。'), { code: 'student_scope_missing' });
    asOf = reliableIso(asOf) || nowIso(now);
    const createdAt = nowIso(now);
    const candidates = [];
    const checkIns = db.prepare('SELECT * FROM learning_checkins WHERE student_id=? AND created_at<=? ORDER BY created_at,checkin_id')
      .all(studentId, asOf);
    for (const row of checkIns) {
      if (correctionExists(studentId, 'checkin', row.checkin_id, 1, asOf)) continue;
      const dimensions = parseJson(row.dimensions_json, {});
      const answered = DIMENSIONS.filter((key) => dimensions[key] !== null && dimensions[key] !== undefined);
      candidates.push({
        sourceCategory: 'student_self_report', evidenceType: 'checkin', evidenceId: row.checkin_id,
        statement: answered.length ? `学生本人完成${row.kind === 'baseline' ? '首次基线' : '本周'}反馈（${answered.length}/5 项）。` : '学生本人提交反馈，本次五项均选择跳过。',
        status: 'published', confidence: 'self_reported', revision: 1,
      });
    }
    const evidences = db.prepare(`SELECT e.* FROM learning_evidence_versions e JOIN (
      SELECT evidence_id,MAX(revision) revision FROM learning_evidence_versions WHERE student_id=? AND created_at<=? GROUP BY evidence_id
    ) latest ON latest.evidence_id=e.evidence_id AND latest.revision=e.revision WHERE e.student_id=? ORDER BY e.created_at,e.evidence_id`)
      .all(studentId, asOf, studentId);
    const conflictKeys = new Set();
    const polarities = new Map();
    for (const row of evidences) {
      if (!row.dimension || row.source_category === 'system_inference') continue;
      const key = `${row.subject}\n${row.dimension}`;
      if (!polarities.has(key)) polarities.set(key, new Set());
      if (row.polarity === 'positive' || row.polarity === 'negative') polarities.get(key).add(row.polarity);
    }
    for (const [key, values] of polarities) if (values.size > 1) conflictKeys.add(key);
    for (const row of evidences) {
      if (correctionExists(studentId, 'evidence', row.evidence_id, row.revision, asOf)) continue;
      const inferred = row.source_category === 'system_inference';
      const conflicted = conflictKeys.has(`${row.subject}\n${row.dimension}`);
      candidates.push({
        sourceCategory: row.source_category, evidenceType: 'evidence', evidenceId: row.evidence_id,
        statement: row.statement, status: conflicted ? 'disputed' : inferred ? 'pending' : 'published',
        confidence: conflicted ? 'medium' : inferred ? 'low' : row.source_category === 'student_self_report' ? 'self_reported' : 'observed',
        revision: Number(row.revision),
      });
    }
    let changed = false;
    transaction(() => {
      for (const candidate of candidates) {
        const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
          studentId, evidenceType: candidate.evidenceType, evidenceId: candidate.evidenceId,
          revision: candidate.revision, status: candidate.status, policyVersion: POLICY_VERSION,
        })).digest('hex');
        const result = db.prepare(`INSERT OR IGNORE INTO learning_findings(student_id,finding_id,input_fingerprint,source_category,
          evidence_type,evidence_id,statement,status,confidence,policy_version,as_of,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(studentId, id('finding'), fingerprint, candidate.sourceCategory, candidate.evidenceType, candidate.evidenceId,
            candidate.statement, candidate.status, candidate.confidence, POLICY_VERSION, asOf, createdAt);
        if (Number(result.changes) > 0) changed = true;
      }
      if (changed) advanceGeneration(createdAt);
    });
    return db.prepare('SELECT * FROM learning_findings WHERE student_id=? AND created_at<=? ORDER BY created_at,finding_id')
      .all(studentId, asOf).filter((row) => !correctionExists(studentId, 'finding', row.finding_id, 1, asOf)).map(mapFinding);
  }

  function mapCorrection(row) {
    return {
      studentId: row.student_id, correctionId: row.correction_id, commitKey: row.commit_key,
      targetType: row.target_type, objectId: row.object_id, revision: Number(row.target_revision),
      action: row.action, reason: row.reason, replacement: parseJson(row.replacement_json, {}), createdAt: row.created_at,
    };
  }

  function correctOrWithdraw(scope, input = {}) {
    const actor = assertScope(scope, input.studentId);
    const commitKey = text(input.commitKey);
    if (!commitKey) throw Object.assign(new Error('稳定提交键缺失。'), { code: 'commit_key_missing' });
    const existing = db.prepare('SELECT * FROM learning_corrections WHERE student_id=? AND commit_key=?').get(actor.studentId, commitKey);
    if (existing) return mapCorrection(existing);
    const action = text(input.action);
    if (!['correct', 'withdraw'].includes(action)) throw Object.assign(new Error('更正动作无效。'), { code: 'correction_action_invalid' });
    const targetType = text(input.targetType);
    const objectId = text(input.objectId);
    const revision = Number(input.revision);
    if (!targetType || !objectId || !Number.isInteger(revision) || revision < 1) {
      throw Object.assign(new Error('更正目标无效。'), { code: 'correction_target_invalid' });
    }
    if (!text(input.reason)) throw Object.assign(new Error('更正原因缺失。'), { code: 'correction_reason_missing' });
    const createdAt = nowIso(now);
    const correctionId = id('correction');
    return transaction(() => {
      db.prepare(`INSERT INTO learning_corrections(student_id,correction_id,commit_key,target_type,object_id,target_revision,
        action,reason,replacement_json,created_at,actor_role,actor_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(actor.studentId, correctionId, commitKey, targetType, objectId, revision, action, text(input.reason),
          JSON.stringify(input.replacement || {}), createdAt, actor.actorRole, actor.actorId);
      advanceGeneration(createdAt);
      return mapCorrection(db.prepare('SELECT * FROM learning_corrections WHERE student_id=? AND correction_id=?')
        .get(actor.studentId, correctionId));
    });
  }

  function latestEffectiveRows(table, idColumn, targetType, studentId, asOf, mapper) {
    const rows = db.prepare(`SELECT item.* FROM ${table} item JOIN (
      SELECT ${idColumn} object_id,MAX(revision) revision FROM ${table} WHERE student_id=? AND created_at<=? GROUP BY ${idColumn}
    ) latest ON latest.object_id=item.${idColumn} AND latest.revision=item.revision
      WHERE item.student_id=? ORDER BY item.created_at,item.${idColumn}`).all(studentId, asOf, studentId);
    return rows.filter((row) => !correctionExists(studentId, targetType, row[idColumn], Number(row.revision), asOf)).map(mapper);
  }

  function getLearningState(reader, studentId, asOf) {
    studentId = assertReader(reader, studentId);
    asOf = reliableIso(asOf) || nowIso(now);
    const checkIns = db.prepare('SELECT * FROM learning_checkins WHERE student_id=? AND created_at<=? ORDER BY occurred_at DESC,created_at DESC')
      .all(studentId, asOf).filter((row) => !correctionExists(studentId, 'checkin', row.checkin_id, 1, asOf)).map(mapCheckIn);
    const goals = latestEffectiveRows('learning_goal_versions', 'goal_id', 'goal', studentId, asOf, mapGoal);
    const problems = latestEffectiveRows('learning_problem_versions', 'problem_id', 'problem', studentId, asOf, mapProblem);
    const evidence = latestEffectiveRows('learning_evidence_versions', 'evidence_id', 'evidence', studentId, asOf, mapEvidence);
    const findings = db.prepare('SELECT * FROM learning_findings WHERE student_id=? AND created_at<=? ORDER BY created_at DESC')
      .all(studentId, asOf).filter((row) => !correctionExists(studentId, 'finding', row.finding_id, 1, asOf)).map(mapFinding);
    return {
      studentId, asOf, policyVersion: POLICY_VERSION, authorizationVersion: text(reader.authorizationVersion) || 'local-host-v1',
      ...state(), checkIns, goals, problems, evidence, findings,
      automationEnabled: false,
      coverage: { hasBaseline: checkIns.some((item) => item.kind === 'baseline'), weeklyFeedbackCount: checkIns.filter((item) => item.kind === 'weekly').length },
    };
  }

  function history(studentId) {
    studentId = text(studentId);
    return {
      checkIns: db.prepare('SELECT * FROM learning_checkins WHERE student_id=? ORDER BY created_at').all(studentId).map(mapCheckIn),
      goals: db.prepare('SELECT * FROM learning_goal_versions WHERE student_id=? ORDER BY goal_id,revision').all(studentId).map(mapGoal),
      problems: db.prepare('SELECT * FROM learning_problem_versions WHERE student_id=? ORDER BY problem_id,revision').all(studentId).map(mapProblem),
      evidence: db.prepare('SELECT * FROM learning_evidence_versions WHERE student_id=? ORDER BY evidence_id,revision').all(studentId).map(mapEvidence),
      corrections: db.prepare('SELECT * FROM learning_corrections WHERE student_id=? ORDER BY created_at').all(studentId).map(mapCorrection),
    };
  }

  return {
    dbPath, db, state, reconcileEvents, listPoints, weeklyGrowth,
    submitCheckIn, upsertGoal, upsertProblem, ingestEvidence, publishFindings, correctOrWithdraw, getLearningState, history,
    close() { db.close(); },
  };
}

module.exports = { SCHEMA_VERSION, POLICY_VERSION, DIMENSIONS, createLearningStateStore, learningStatePath, localDateKey, weekCalendar };
