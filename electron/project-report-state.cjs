'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { stableJson, sha256 } = require('./project-report-snapshot.cjs');

const SCHEMA_VERSION = 2;
function text(value) { return String(value ?? '').trim(); }
function json(value, fallback) { try { return JSON.parse(String(value || '')); } catch { return fallback; } }
function nowIso(now) { return new Date(typeof now === 'function' ? now() : now).toISOString(); }
function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function schemaSql() { return `
  PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS project_report_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
  INSERT OR IGNORE INTO project_report_meta(key,value) VALUES('generation','0');
  CREATE TABLE IF NOT EXISTS project_report_snapshots(
    snapshot_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,commit_key TEXT NOT NULL,input_fingerprint TEXT NOT NULL,
    as_of TEXT NOT NULL,authorization_version TEXT NOT NULL,content_hash TEXT NOT NULL,snapshot_json TEXT NOT NULL,created_at TEXT NOT NULL,
    UNIQUE(project_id,commit_key),UNIQUE(project_id,input_fingerprint,authorization_version)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS project_report_snapshots_project ON project_report_snapshots(project_id,created_at DESC);
  CREATE TABLE IF NOT EXISTS project_report_versions(
    version_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,snapshot_id TEXT NOT NULL REFERENCES project_report_snapshots(snapshot_id),
    commit_key TEXT NOT NULL,report_type TEXT NOT NULL,policy_version TEXT NOT NULL,content_hash TEXT NOT NULL,report_json TEXT NOT NULL,
    generation INTEGER NOT NULL,created_at TEXT NOT NULL,UNIQUE(project_id,commit_key)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS project_report_versions_project ON project_report_versions(project_id,created_at DESC);
  CREATE TABLE IF NOT EXISTS project_report_current(project_id TEXT PRIMARY KEY,version_id TEXT NOT NULL REFERENCES project_report_versions(version_id)) STRICT;
  CREATE TABLE IF NOT EXISTS project_report_generation_runs(
    task_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,task_key TEXT NOT NULL,snapshot_id TEXT NOT NULL REFERENCES project_report_snapshots(snapshot_id),
    report_type TEXT NOT NULL,policy_version TEXT NOT NULL,base_version_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,execution_id TEXT NOT NULL DEFAULT '',version_id TEXT NOT NULL DEFAULT '',
    result_hash TEXT NOT NULL DEFAULT '',error_code TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
    UNIQUE(project_id,task_key)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS project_report_generation_runs_project ON project_report_generation_runs(project_id,updated_at DESC);
  PRAGMA user_version=${SCHEMA_VERSION};`;
}
function assertScope(scope, projectId) {
  if (!text(scope?.projectId)) throw Object.assign(new Error('项目报告写入缺少可信项目范围。'), { code: 'subject_scope_required' });
  if (text(scope.projectId) !== text(projectId)) throw Object.assign(new Error('项目报告写入范围与对象不一致。'), { code: 'subject_scope_forbidden' });
  if (!text(scope.actorRole) || !text(scope.actorId)) throw Object.assign(new Error('项目报告写入主体无效。'), { code: 'subject_scope_required' });
}
function openDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  const version = Number(db.prepare('PRAGMA user_version').get().user_version || 0);
  if (version > SCHEMA_VERSION) { db.close(); throw Object.assign(new Error(`不支持的项目报告数据库版本：${version}`), { code: 'project_report_db_unsupported' }); }
  if (version > 0 && version < SCHEMA_VERSION) {
    const backupPath = `${dbPath}.pre-schema-v${SCHEMA_VERSION}-${stamp()}.sqlite3`;
    db.exec(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);
  }
  db.exec(schemaSql());
  const check = db.prepare('PRAGMA quick_check').get();
  if (String(check.quick_check || check.integrity_check) !== 'ok') { db.close(); throw Object.assign(new Error('项目报告数据库完整性检查失败。'), { code: 'project_report_db_corrupt' }); }
  return db;
}
function mapSnapshot(row) { return row ? json(row.snapshot_json, null) : null; }
function mapVersion(row) { if (!row) return null; return { versionId: row.version_id, projectId: row.project_id, snapshotId: row.snapshot_id,
  commitKey: row.commit_key, reportType: row.report_type, policyVersion: row.policy_version, contentHash: row.content_hash,
  report: json(row.report_json, {}), generation: Number(row.generation), createdAt: row.created_at }; }
function mapRun(row) { if (!row) return null; return { taskId: row.task_id, projectId: row.project_id, taskKey: row.task_key,
  snapshotId: row.snapshot_id, reportType: row.report_type, policyVersion: row.policy_version, baseVersionId: row.base_version_id,
  status: row.status, executionId: row.execution_id, versionId: row.version_id, resultHash: row.result_hash,
  errorCode: row.error_code, createdAt: row.created_at, updatedAt: row.updated_at }; }

function createProjectReportStore({ dbPath, now = Date.now } = {}) {
  if (!path.isAbsolute(dbPath || '')) throw new Error('Project report database path must be absolute');
  const db = openDatabase(dbPath);
  function generation() { return Number(db.prepare("SELECT value FROM project_report_meta WHERE key='generation'").get().value || 0); }
  function nextGeneration() { const next = generation() + 1; db.prepare("UPDATE project_report_meta SET value=? WHERE key='generation'").run(String(next)); return next; }
  function transaction(run) { db.exec('BEGIN IMMEDIATE'); try { const result = run(); db.exec('COMMIT'); return result; }
    catch (error) { try { db.exec('ROLLBACK'); } catch { /* ignore */ } throw error; } }
  function saveSnapshot(scope, snapshot, commitKey) {
    assertScope(scope, snapshot?.projectId); commitKey = text(commitKey);
    if (!commitKey || !/^[a-f0-9]{64}$/i.test(text(snapshot?.inputFingerprint))) throw Object.assign(new Error('项目快照提交键或指纹无效。'), { code: 'project_report_snapshot_invalid' });
    const content = stableJson(snapshot), contentHash = sha256(content);
    const existing = db.prepare('SELECT * FROM project_report_snapshots WHERE project_id=? AND commit_key=?').get(snapshot.projectId, commitKey);
    if (existing) {
      if (existing.content_hash !== contentHash) throw Object.assign(new Error('相同提交键对应不同项目快照。'), { code: 'project_report_commit_conflict' });
      return mapSnapshot(existing);
    }
    const duplicate = db.prepare('SELECT * FROM project_report_snapshots WHERE project_id=? AND input_fingerprint=? AND authorization_version=?')
      .get(snapshot.projectId, snapshot.inputFingerprint, text(snapshot.authorizationVersion));
    if (duplicate) return mapSnapshot(duplicate);
    const snapshotId = text(snapshot.snapshotId) || `project-report-snapshot-${contentHash.slice(0, 24)}`;
    const value = { ...snapshot, snapshotId };
    return transaction(() => {
      db.prepare(`INSERT INTO project_report_snapshots(snapshot_id,project_id,commit_key,input_fingerprint,as_of,authorization_version,content_hash,snapshot_json,created_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(snapshotId, snapshot.projectId, commitKey, snapshot.inputFingerprint, snapshot.asOf,
          text(snapshot.authorizationVersion), sha256(stableJson(value)), stableJson(value), nowIso(now));
      nextGeneration();
      return structuredClone(value);
    });
  }
  function getSnapshot(snapshotId) { return mapSnapshot(db.prepare('SELECT * FROM project_report_snapshots WHERE snapshot_id=?').get(text(snapshotId))); }
  function commitReportVersion(scope, input = {}) {
    const snapshot = getSnapshot(input.snapshotId); if (!snapshot) throw Object.assign(new Error('项目报告快照不存在。'), { code: 'project_report_snapshot_missing' });
    assertScope(scope, snapshot.projectId); const commitKey = text(input.commitKey), report = input.report;
    if (!commitKey || !report?.reportType) throw Object.assign(new Error('项目报告提交内容无效。'), { code: 'project_report_version_invalid' });
    const contentHash = sha256(stableJson({ snapshotId: snapshot.snapshotId, report }));
    const existing = db.prepare('SELECT * FROM project_report_versions WHERE project_id=? AND commit_key=?').get(snapshot.projectId, commitKey);
    if (existing) {
      if (existing.content_hash !== contentHash) throw Object.assign(new Error('相同提交键对应不同报告版本。'), { code: 'project_report_commit_conflict' });
      return mapVersion(existing);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'expectedCurrentVersionId')) {
      const current = db.prepare('SELECT version_id FROM project_report_current WHERE project_id=?').get(snapshot.projectId);
      if (text(current?.version_id) !== text(input.expectedCurrentVersionId)) {
        throw Object.assign(new Error('项目报告当前版本已变化，旧结果不得覆盖。'), { code: 'project_report_current_changed' });
      }
    }
    return transaction(() => {
      const next = nextGeneration(), versionId = `project-report-version-${contentHash.slice(0, 24)}`, createdAt = nowIso(now);
      db.prepare(`INSERT INTO project_report_versions(version_id,project_id,snapshot_id,commit_key,report_type,policy_version,content_hash,report_json,generation,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(versionId, snapshot.projectId, snapshot.snapshotId, commitKey, report.reportType,
          text(report.policyVersion || snapshot.policyVersion), contentHash, stableJson(report), next, createdAt);
      db.prepare(`INSERT INTO project_report_current(project_id,version_id) VALUES(?,?)
        ON CONFLICT(project_id) DO UPDATE SET version_id=excluded.version_id`).run(snapshot.projectId, versionId);
      return mapVersion(db.prepare('SELECT * FROM project_report_versions WHERE version_id=?').get(versionId));
    });
  }
  function getCurrentProjectReport(projectId) {
    const row = db.prepare(`SELECT v.* FROM project_report_current c JOIN project_report_versions v ON v.version_id=c.version_id WHERE c.project_id=?`).get(text(projectId));
    const version = mapVersion(row); if (!version) return null;
    return { snapshot: getSnapshot(version.snapshotId), version };
  }
  function getProjectReportVersion(projectId, versionId) {
    const version = mapVersion(db.prepare('SELECT * FROM project_report_versions WHERE project_id=? AND version_id=?')
      .get(text(projectId), text(versionId)));
    return version ? { snapshot: getSnapshot(version.snapshotId), version } : null;
  }
  function listProjectReportVersions(projectId) { return db.prepare('SELECT * FROM project_report_versions WHERE project_id=? ORDER BY created_at DESC,version_id DESC')
    .all(text(projectId)).map((row) => { const item = mapVersion(row); return { versionId: item.versionId, projectId: item.projectId,
      snapshotId: item.snapshotId, reportType: item.reportType, policyVersion: item.policyVersion, generation: item.generation, createdAt: item.createdAt }; }); }
  function ensureGenerationRun(scope, input = {}) {
    assertScope(scope, input.projectId);
    const taskId = text(input.taskId), taskKey = text(input.taskKey), snapshotId = text(input.snapshotId);
    const snapshot = getSnapshot(snapshotId);
    if (!taskId || !taskKey || !snapshot || snapshot.projectId !== text(input.projectId)) {
      throw Object.assign(new Error('项目报告生成任务无效。'), { code: 'project_report_task_invalid' });
    }
    const existing = db.prepare('SELECT * FROM project_report_generation_runs WHERE project_id=? AND task_key=?')
      .get(input.projectId, taskKey);
    if (existing) return { ...mapRun(existing), created: false };
    const current = db.prepare('SELECT version_id FROM project_report_current WHERE project_id=?').get(input.projectId);
    const createdAt = nowIso(now);
    return transaction(() => {
      db.prepare(`INSERT INTO project_report_generation_runs(task_id,project_id,task_key,snapshot_id,report_type,policy_version,
        base_version_id,status,execution_id,version_id,result_hash,error_code,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(taskId, input.projectId, taskKey, snapshotId, text(input.reportType) || 'overall',
        text(input.policyVersion), text(current?.version_id), 'pending', '', '', '', '', createdAt, createdAt);
      nextGeneration();
      return { ...mapRun(db.prepare('SELECT * FROM project_report_generation_runs WHERE task_id=?').get(taskId)), created: true };
    });
  }
  function getGenerationRun(taskId) { return mapRun(db.prepare('SELECT * FROM project_report_generation_runs WHERE task_id=?').get(text(taskId))); }
  function beginGenerationRun(scope, taskId, executionId) {
    const run = getGenerationRun(taskId); if (!run) throw Object.assign(new Error('项目报告生成任务不存在。'), { code: 'project_report_task_missing' });
    assertScope(scope, run.projectId); executionId = text(executionId);
    if (!executionId) throw Object.assign(new Error('项目报告执行批次无效。'), { code: 'project_report_execution_invalid' });
    if (run.status === 'succeeded') return run;
    if (run.executionId && run.executionId !== executionId && run.status !== 'failed') {
      throw Object.assign(new Error('项目报告执行批次不匹配。'), { code: 'project_report_execution_mismatch' });
    }
    if (run.status === 'running') return run;
    const updatedAt = nowIso(now);
    return transaction(() => {
      db.prepare(`UPDATE project_report_generation_runs SET status='running',execution_id=?,version_id='',result_hash='',error_code='',updated_at=? WHERE task_id=?`)
        .run(executionId, updatedAt, run.taskId); nextGeneration(); return getGenerationRun(run.taskId);
    });
  }
  function settleGenerationRun(scope, taskId, input = {}) {
    const run = getGenerationRun(taskId); if (!run) throw Object.assign(new Error('项目报告生成任务不存在。'), { code: 'project_report_task_missing' });
    assertScope(scope, run.projectId);
    if (run.executionId && text(input.executionId) && run.executionId !== text(input.executionId)) {
      throw Object.assign(new Error('项目报告执行批次不匹配。'), { code: 'project_report_execution_mismatch' });
    }
    if (run.status === 'succeeded' && text(input.versionId) === run.versionId) return run;
    const status = text(input.status);
    if (!['succeeded', 'stale', 'failed'].includes(status)) throw Object.assign(new Error('项目报告任务结算状态无效。'), { code: 'project_report_task_invalid' });
    const updatedAt = nowIso(now);
    return transaction(() => {
      db.prepare(`UPDATE project_report_generation_runs SET status=?,version_id=?,result_hash=?,error_code=?,updated_at=? WHERE task_id=?`)
        .run(status, text(input.versionId), text(input.resultHash), text(input.errorCode), updatedAt, run.taskId);
      nextGeneration(); return getGenerationRun(run.taskId);
    });
  }
  return { saveSnapshot, getSnapshot, commitReportVersion, getCurrentProjectReport, getProjectReportVersion, listProjectReportVersions,
    ensureGenerationRun, getGenerationRun, beginGenerationRun, settleGenerationRun,
    state: () => ({ schemaVersion: SCHEMA_VERSION, generation: generation() }), close: () => db.close() };
}

module.exports = { SCHEMA_VERSION, createProjectReportStore };

