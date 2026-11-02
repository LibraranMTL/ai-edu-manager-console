'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const executionLedger = require('./task-execution-ledger.cjs');
const backlogRecovery=require('./task-backlog-recovery.cjs');
const { taskSummary, taskPresentation, scheduledAtTime } = require('./task-read-model.cjs');

const COLUMNS = {
  source_type: "TEXT NOT NULL DEFAULT ''", source_id: "TEXT NOT NULL DEFAULT ''", kind: "TEXT NOT NULL DEFAULT ''",
  executor: "TEXT NOT NULL DEFAULT ''", automatic_execution: 'INTEGER NOT NULL DEFAULT 0',
  scheduled_at: "TEXT NOT NULL DEFAULT ''", next_retry_at: "TEXT NOT NULL DEFAULT ''", resource_retry_at: "TEXT NOT NULL DEFAULT ''",
  task_revision: 'INTEGER NOT NULL DEFAULT 0', status_group: "TEXT NOT NULL DEFAULT ''", user_group: "TEXT NOT NULL DEFAULT ''",
  sort_rank: 'INTEGER NOT NULL DEFAULT 0', summary_json: "TEXT NOT NULL DEFAULT '{}'", presentation_due: 'INTEGER NOT NULL DEFAULT 0',
  work_key: "TEXT NOT NULL DEFAULT ''", source_version: "TEXT NOT NULL DEFAULT ''", pipeline_version: "TEXT NOT NULL DEFAULT ''",
  settlement_state: "TEXT NOT NULL DEFAULT ''", business_outcome: "TEXT NOT NULL DEFAULT ''",
  priority_class: 'INTEGER NOT NULL DEFAULT 40', priority_boost_until: "TEXT NOT NULL DEFAULT ''",
  queued_at: "TEXT NOT NULL DEFAULT ''", resource_block_json: "TEXT NOT NULL DEFAULT '{}'",
};
function fail(code, message) { return Object.assign(new Error(message || code), { code }); }
function sqlTime(value, now) {
  const time = scheduledAtTime(value, now);
  return Number.isFinite(time) ? new Date(time).toISOString() : '';
}
function encodeRunnableCursor(row) {
  if (!row) return '';
  return Buffer.from(JSON.stringify({ v: 2, priority: Number(row.effective_priority || 0),
    queuedAt: String(row.queue_time || ''), taskId: String(row.task_id || '') }), 'utf8').toString('base64url');
}
function decodeRunnableCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (parsed?.v !== 2 || !Number.isFinite(Number(parsed.priority)) || !parsed.taskId) return null;
    return { priority: Number(parsed.priority), queuedAt: String(parsed.queuedAt || ''), taskId: String(parsed.taskId) };
  } catch { return null; }
}
function createTaskSqlStore({ legacyPath, migrate }) {
  const dbPath = path.join(path.dirname(legacyPath), 'task-state.sqlite3');
  let db, revision = 0, viewRevision = 0, presentationRevision = 0, epoch = crypto.randomUUID();
  const statements = new Map();
  const stmt = sql => { if (!statements.has(sql)) statements.set(sql, db.prepare(sql)); return statements.get(sql); };
  const meta = (key, fallback = null) => {
    const row = stmt('SELECT value_json FROM task_state_meta WHERE key=?').get(key);
    return row ? JSON.parse(row.value_json) : fallback;
  };
  function setMeta(key, value) {
    const json = JSON.stringify(value);
    stmt(`INSERT INTO task_state_meta(key,value_json) VALUES(?,?) ON CONFLICT(key)
      DO UPDATE SET value_json=excluded.value_json WHERE value_json<>excluded.value_json`).run(key, json);
  }
  function indexes() {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_source ON tasks(source_type,source_id,task_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(status,scheduled_at,task_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_retry ON tasks(status,next_retry_at,task_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_page ON tasks(sort_rank,updated_at DESC,task_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_user_page ON tasks(user_group,sort_rank,updated_at DESC,task_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_source_page ON tasks(source_type,sort_rank,updated_at DESC,task_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_executor_page ON tasks(executor,sort_rank,updated_at DESC,task_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_presentation_due ON tasks(presentation_due);
      CREATE INDEX IF NOT EXISTS idx_tasks_summary ON tasks(status_group,user_group);
      CREATE INDEX IF NOT EXISTS idx_tasks_work_key ON tasks(work_key,updated_at DESC,task_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_dispatch_priority ON tasks(status,priority_class DESC,queued_at,scheduled_at,task_id);
      CREATE TABLE IF NOT EXISTS task_source_state (
        source_type TEXT NOT NULL, source_id TEXT NOT NULL, source_revision TEXT NOT NULL DEFAULT '',
        processed_revision TEXT NOT NULL DEFAULT '', dirty INTEGER NOT NULL DEFAULT 1,
        reason TEXT NOT NULL DEFAULT '', projection_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL DEFAULT '',
        PRIMARY KEY(source_type,source_id));
      CREATE INDEX IF NOT EXISTS idx_task_sources_dirty ON task_source_state(dirty,updated_at,source_type,source_id);
      CREATE TABLE IF NOT EXISTS task_history_entries (
        history_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, occurred_at TEXT NOT NULL, payload_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_task_history_entries ON task_history_entries(task_id,occurred_at DESC);
      CREATE TABLE IF NOT EXISTS task_mutations (mutation_id TEXT PRIMARY KEY, revision INTEGER NOT NULL);`);
    db.exec(`CREATE TABLE IF NOT EXISTS task_execution_budget (
      budget_key TEXT PRIMARY KEY,
      work_key TEXT NOT NULL,
      error_signature TEXT NOT NULL DEFAULT '',
      input_hash TEXT NOT NULL DEFAULT '',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT NOT NULL DEFAULT '',
      terminal_state TEXT NOT NULL DEFAULT '',
      last_error_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_task_execution_budget_work ON task_execution_budget(work_key,updated_at DESC);`);
  }
  function values(task, taskRevision) {
    const now = Date.now(), summary = taskSummary(task);
    const deadlines = [task.scheduledAt, task.nextRetryAt, task.resourceRetryAt].map(v => scheduledAtTime(v, now)).filter(v => Number.isFinite(v) && v > now);
    return [String(task.id), String(task.status || ''), String(task.updatedAt || ''), JSON.stringify(task),
      String(task.sourceType || ''), String(task.sourceId || ''), String(task.kind || ''), String(task.executor || ''),
      task.automaticExecution === true ? 1 : 0,
      task.trigger === 'event' || ['student_digest','topic_suggestion_refresh'].includes(task.kind) ? '' : sqlTime(task.scheduledAt, now),
      sqlTime(task.nextRetryAt, now), sqlTime(task.resourceRetryAt, now),
      taskRevision, summary.statusGroup, summary.userGroup,
      ({ actionable: 0, running: 1, scheduled: 2, completed: 3, archived: 4 })[summary.statusGroup] ?? 5,
      JSON.stringify(summary), deadlines.length ? Math.min(...deadlines) : 0,
      String(task.workKey || ''), String(task.sourceVersion || ''), String(task.pipelineVersion || ''),
      String(task.settlementState || ''), String(task.businessOutcome || ''),
      Math.max(0, Math.min(100, Number(task.priorityClass ?? 40))), String(task.priorityBoostUntil || ''),
      String(task.queuedAt || task.createdAt || ''), JSON.stringify(task.resourceBlock || {})];
  }
  function put(task, taskRevision) {
    const columns = ['task_id','status','updated_at','payload_json', ...Object.keys(COLUMNS)];
    stmt(`INSERT INTO tasks(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})
      ON CONFLICT(task_id) DO UPDATE SET ${columns.slice(1).map(k => `${k}=excluded.${k}`).join(',')}`).run(...values(task, taskRevision));
  }
  function history(entries) {
    for (const entry of entries || []) {
      const json = JSON.stringify(entry), id = String(entry.id || crypto.createHash('sha256').update(json).digest('hex'));
      stmt('INSERT OR IGNORE INTO task_history_entries VALUES(?,?,?,?)').run(id, String(entry.taskId || ''), String(entry.at || entry.updatedAt || ''), json);
    }
  }
  function check(full = false) {
    const result = db.prepare(`PRAGMA ${full ? 'integrity_check' : 'quick_check'}`).get();
    if (Object.values(result)[0] !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw fail('TASK_DATABASE_INTEGRITY', '任务数据库完整性检查失败');
  }
  function migrationBackup(version) {
    const parent = path.dirname(dbPath);
    const nonce = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    const standardDir = path.join(parent, 'migration-backups');
    const standardBackup = path.join(standardDir, `v${version}-${nonce}.db`);
    // The authoritative database can still be below MAX_PATH while adding the
    // descriptive backup directory crosses SQLite's Windows filename limit.
    // Keep the documented layout whenever it fits; otherwise use a compact
    // sibling whose absolute path is recorded in the task database metadata and therefore
    // remains fully recoverable without directory discovery.
    const backup = standardBackup.length <= 248
      ? standardBackup
      : path.join(parent, `.b${version}-${crypto.randomBytes(3).toString('hex')}.db`);
    const dir = path.dirname(backup);
    fs.mkdirSync(dir, { recursive: true });
    // SQLite on Windows still rejects some otherwise valid paths near MAX_PATH.
    // Keep the durable backup in the documented directory, but use a compact,
    // collision-resistant name so a deep student root can migrate exactly once.
    try {
      // VACUUM INTO reads a consistent live SQLite snapshot, including WAL.
      db.prepare('VACUUM INTO ?').run(backup);
      return backup;
    } catch (error) {
      // Failed VACUUM attempts can leave an empty file. It is not a backup and
      // must not accumulate or be mistaken for recoverable migration evidence.
      try { fs.unlinkSync(backup); } catch {}
      throw error;
    }
  }
  function open() {
    if (db) return;
    if (!fs.existsSync(dbPath)) migrate({ legacyPath, dbPath });
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000');
    let version = Number(db.prepare('PRAGMA user_version').get().user_version);
    if (version > 5) { db.close(); db=null; throw fail('TASK_SCHEMA_NEWER', '任务数据库版本高于本程序'); }
    if (version < 2) {
      const backup = migrationBackup(version);
      db.exec('BEGIN IMMEDIATE');
      try {
        const existing = new Set(db.prepare('PRAGMA table_info(tasks)').all().map(row => row.name));
        for (const [name, type] of Object.entries(COLUMNS)) if (!existing.has(name)) db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${type}`);
        indexes();
        let cursor = '';
        for (;;) {
          const rows = db.prepare('SELECT task_id,payload_json FROM tasks WHERE task_id>? ORDER BY task_id LIMIT 100').all(cursor);
          if (!rows.length) break;
          for (const row of rows) put(JSON.parse(row.payload_json), 1);
          cursor = rows.at(-1).task_id;
        }
        history(db.prepare('SELECT payload_json FROM task_history ORDER BY sequence').all().map(row => JSON.parse(row.payload_json)));
        setMeta('v2Backup', backup); db.exec('PRAGMA user_version=2'); check(true); db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); statements.clear(); db.close(); db = null; throw error; }
      version = 2;
    }
    if (version < 3) {
      const backup = migrationBackup(version);
      db.exec('BEGIN IMMEDIATE');
      try {
        const existing = new Set(db.prepare('PRAGMA table_info(tasks)').all().map(row => row.name));
        for (const [name, type] of Object.entries(COLUMNS)) if (!existing.has(name)) db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${type}`);
        indexes();
        let cursor = '';
        for (;;) {
          const rows = db.prepare('SELECT task_id,payload_json,task_revision FROM tasks WHERE task_id>? ORDER BY task_id LIMIT 100').all(cursor);
          if (!rows.length) break;
          for (const row of rows) put(JSON.parse(row.payload_json), Math.max(1, Number(row.task_revision || 0)));
          cursor = rows.at(-1).task_id;
        }
        setMeta('v3Backup', backup); db.exec('PRAGMA user_version=3'); check(true); db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); statements.clear(); db.close(); db = null; throw error; }
    }
    if (version < 4) {
      const backup = migrationBackup(version);
      db.exec('BEGIN IMMEDIATE');
      try {
        indexes();
        let cursor = '';
        for (;;) {
          const rows = db.prepare('SELECT task_id,payload_json,task_revision FROM tasks WHERE task_id>? ORDER BY task_id LIMIT 100').all(cursor);
          if (!rows.length) break;
          for (const row of rows) {
            const task = JSON.parse(row.payload_json), boostUntil = Date.parse(task.priorityBoostUntil || '');
            if (Number(task.priorityClass) === 100 && (!Number.isFinite(boostUntil) || boostUntil <= Date.now())) {
              task.priorityClass = task.trigger === 'manual' ? 80 : task.trigger === 'event' ? 60
                : String(task.kind || '').includes('maintenance') ? 20 : 40;
              put(task, Math.max(1, Number(row.task_revision || 0)));
            }
          }
          cursor = rows.at(-1).task_id;
        }
        setMeta('v4Backup', backup); db.exec('PRAGMA user_version=4'); check(true); db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); statements.clear(); db.close(); db = null; throw error; }
    } else { check(); indexes(); }
    version = Number(db.prepare('PRAGMA user_version').get().user_version);
    if(version<5){
      const backup=migrationBackup(version);
      try{db.exec('BEGIN IMMEDIATE');db.exec(executionLedger.SCHEMA);setMeta('v5Backup',backup);db.exec('PRAGMA user_version=5');check(true);db.exec('COMMIT');}
      catch(error){db.exec('ROLLBACK');statements.clear();db.close();db=null;throw error;}
    }
    db.exec(executionLedger.SCHEMA);
    if(!db.prepare('PRAGMA table_info(task_execution_attempts)').all().some(column=>column.name==='profile_id'))db.exec("ALTER TABLE task_execution_attempts ADD COLUMN profile_id TEXT NOT NULL DEFAULT 'legacy'");
    revision = Number(meta('revision', 0));
    viewRevision = Number(meta('viewRevision', revision));
  }
  function transaction(work) {
    open(); db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function applyDelta(query = {}) {
    open();
    if ((query.upserts?.length || 0) + (query.deletes?.length || 0) > 100) throw fail('TASK_BATCH_TOO_LARGE');
    const duplicate = query.mutationId && stmt('SELECT revision FROM task_mutations WHERE mutation_id=?').get(query.mutationId);
    if (duplicate) return { ok: true, revision, appliedRevision:duplicate.revision, duplicate: true, changedTaskIds: [] };
    if (query.expectedRevision != null && Number(query.expectedRevision) !== revision) throw fail('TASK_STORE_CONFLICT');
    const changed = [], next = revision + 1;let updated=false;
    transaction(() => {
      const before=Number(stmt('SELECT total_changes() n').get().n);
      for (const task of query.upserts || []) {
        if (!task?.id) throw fail('TASK_ID_REQUIRED');
        const current = stmt('SELECT task_revision,payload_json FROM tasks WHERE task_id=?').get(String(task.id));
        const expected = query.taskRevisions?.[task.id];
        if (expected != null && Number(expected) !== Number(current?.task_revision || 0)) throw fail('TASK_STORE_CONFLICT');
        if (current?.payload_json === JSON.stringify(task)) continue;
        put(task, Number(current?.task_revision || 0) + 1); changed.push(String(task.id));
      }
      for (const id of query.deletes || []) if (stmt('DELETE FROM tasks WHERE task_id=?').run(String(id)).changes) changed.push(String(id));
      history(query.history);
      for (const event of query.events || []) appendEvent(event);
      for (const [key, value] of Object.entries(query.meta || {})) {
        if (!['protocolVersion','updatedAt','runtime','deletedTasks'].includes(key)) throw fail('TASK_META_FIELD_INVALID');
        setMeta(key, value);
      }
      updated=Number(stmt('SELECT total_changes() n').get().n)!==before;
      if(!updated)return;
      setMeta('revision', next);
      if(changed.length)setMeta('viewRevision',viewRevision+1);
      if (query.mutationId) stmt('INSERT INTO task_mutations VALUES(?,?)').run(query.mutationId, next);
    });
    if(updated)revision = next;
    if(updated&&changed.length)viewRevision++;
    return { ok: true, revision, unchanged:!updated,changedTaskIds: changed, summaryChanged: changed.length > 0 };
  }
  function patchTask(id, patch, expectedTaskRevision) {
    open(); const row = stmt('SELECT payload_json,task_revision FROM tasks WHERE task_id=?').get(String(id));
    if (!row) throw fail('TASK_NOT_FOUND');
    return applyDelta({ upserts: [{ ...JSON.parse(row.payload_json), ...patch, id: String(id) }], taskRevisions: { [id]: expectedTaskRevision ?? row.task_revision } });
  }
  function executionMutation(operation,query){
    open();
    const ledger=executionLedger.createTaskExecutionLedger({stmt,persist(task,taskRevision,type,data){
      put(task,taskRevision);setMeta('revision',revision+1);setMeta('viewRevision',viewRevision+1);
      appendEvent({id:crypto.randomUUID(),taskId:task.id,type,at:task.updatedAt,data});
      return {ok:true,revision:revision+1,taskRevision,task:{...task,taskRevision},changedTaskIds:[task.id],summaryChanged:true};
    }});
    const result=transaction(()=>ledger[operation](query));
    if(result.changedTaskIds?.length){revision=result.revision;viewRevision++;}
    return {...result,revision};
  }
  function recoveryPlanRow(row){
    const task=JSON.parse(row.payload_json);
    const attempt=task.executionId?stmt('SELECT * FROM task_execution_attempts WHERE execution_id=? AND task_id=?').get(task.executionId,task.id):null;
    const evidence=backlogRecovery.recoveryEvidence(task,attempt);
    return {taskId:task.id,title:String(task.title||task.id).slice(0,500),expectedTaskRevision:row.task_revision,evidenceRevision:backlogRecovery.recoveryEvidenceRevision(task,evidence),
      ...backlogRecovery.planTaskRecovery(task,evidence),status:task.status,executionId:task.executionId||'',workKey:task.workKey||'',sourceType:task.sourceType,sourceId:task.sourceId};
  }
  function previewTaskRecovery(query={}){
    open();const start=Date.now(),rows=[],counts={};let cursor=String(query.cursor||'');
    const ids=Array.isArray(query.taskIds)?[...new Set(query.taskIds.map(String))].slice(0,20):null;
    if(ids&&!ids.length)return {ok:true,readonly:true,rows,counts,cursor:'',revision,elapsedMs:0};
    const selected=stmt(`SELECT task_id,task_revision,payload_json FROM tasks WHERE task_id>? AND (?='' OR source_id=?) ${ids?`AND task_id IN (${ids.map(()=>'?').join(',')})`:''} ORDER BY task_id LIMIT ?`)
      .all(cursor,String(query.sourceId||''),String(query.sourceId||''),...(ids||[]),Math.max(1,Math.min(20,Number(query.limit)||20)));
    for(const row of selected){const plan=recoveryPlanRow(row);rows.push(plan);counts[plan.action]=(counts[plan.action]||0)+1;cursor=row.task_id;if(Date.now()-start>=500)break;}
    return {ok:true,readonly:true,rows,counts,cursor:rows.length?cursor:'',revision,elapsedMs:Date.now()-start};
  }
  function applyTaskRecovery(query){
    open();const result=transaction(()=>{
      const row=stmt('SELECT task_id,task_revision,payload_json FROM tasks WHERE task_id=?').get(String(query.taskId));
      const conflict=reason=>({ok:false,code:'TASK_EXECUTION_CONFLICT',reason});
      if(!row||row.task_revision!==Number(query.expectedTaskRevision))return conflict('task_changed');
      const plan=recoveryPlanRow(row);if(plan.evidenceRevision!==query.evidenceRevision||plan.action!==query.action)return conflict('evidence_changed');
      if(!['settle_existing','requeue_proven_not_sent','reconcile_original'].includes(plan.action))return {ok:true,applied:false,reason:plan.reason};
      const task=JSON.parse(row.payload_json),at=new Date().toISOString();
      if(plan.action==='settle_existing'){
        Object.assign(task,{status:'succeeded',settlementState:'settled',businessOutcome:'completed',completedAt:task.completedAt||at});
        stmt(`UPDATE task_execution_attempts SET phase='settled',active=0,settled_at=?,result_kind='completed' WHERE execution_id=? AND active=1`).run(at,task.executionId||'');
        if(task.executionPhase)task.executionPhase='settled';
      }else if(plan.action==='requeue_proven_not_sent')Object.assign(task,{status:'queued',error:null,nextRetryAt:'',recoveryState:'stopped'});
      else {if(task.status==='waiting_result'&&task.settlementState==='reconciling')return {ok:true,applied:false,reason:'already_reconciling'};
        Object.assign(task,{status:'waiting_result',settlementState:'reconciling',businessOutcome:'execution_unknown',autoRetry:false});}
      task.updatedAt=at;put(task,row.task_revision+1);setMeta('revision',revision+1);setMeta('viewRevision',viewRevision+1);
      if(query.jobId)setMeta('backlogRecoveryJob',{jobId:String(query.jobId),cursor:task.id,updatedAt:at});
      appendEvent({id:crypto.randomUUID(),taskId:task.id,executionId:task.executionId,type:'backlog_'+plan.action,at,detail:{evidenceRevision:plan.evidenceRevision}});
      return {ok:true,applied:true,task,taskRevision:row.task_revision+1,revision:revision+1,changedTaskIds:[task.id]};
    });
    if(result.applied){revision=result.revision;viewRevision++;}return {...result,revision};
  }
  function refreshPresentation() {
    // Only time-sensitive rows are recalculated; completed history is immutable.
    const rows = stmt('SELECT payload_json,task_revision FROM tasks WHERE presentation_due>0 AND presentation_due<=? LIMIT 100').all(Date.now());
    if (rows.length) {
      transaction(() => { for (const row of rows) put(JSON.parse(row.payload_json), row.task_revision); });
      presentationRevision++;
    }
  }
  function list(query = {}) {
    open();
    const queryKey = JSON.stringify([query.page || 1,query.status || '',query.source || '',query.sourceId || '',query.executor || '']);
    const token = `${epoch}:${viewRevision}:${presentationRevision}:${queryKey}`;
    if (query.knownRevision === token) return { ok: true, ready: true, unchanged: true, revision: token };
    const where = [], args = [];
    if (query.status && query.status !== 'all') {
      where.push(['automatic','needs_help','history'].includes(query.status)?'user_group=?':'status_group=?');args.push(query.status);
    }
    if (query.source && query.source !== 'all') { where.push('source_type=?'); args.push(query.source); }
    if (query.sourceId) { where.push('source_id=?'); args.push(String(query.sourceId)); }
    if (query.executor && query.executor !== 'all') { where.push('executor=?'); args.push(query.executor); }
    const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const total = Number(stmt(`SELECT count(*) n FROM tasks${clause}`).get(...args).n);
    const pageCount = Math.max(1,Math.ceil(total / 20)), page = Math.min(pageCount, Math.max(1,Math.floor(Number(query.page) || 1)));
    const tasks = stmt(`SELECT summary_json FROM tasks${clause} ORDER BY sort_rank,updated_at DESC,task_id LIMIT 20 OFFSET ?`).all(...args,(page-1)*20).map(row => JSON.parse(row.summary_json));
    const summary = { total:0,actionable:0,running:0,scheduled:0,completed:0,archived:0 }, userSummary = { automatic:0,needs_help:0,history:0 };
    for (const row of stmt('SELECT status_group,user_group,count(*) n FROM tasks GROUP BY status_group,user_group').all()) {
      summary.total += Number(row.n); summary[row.status_group] = (summary[row.status_group] || 0) + Number(row.n); userSummary[row.user_group] = (userSummary[row.user_group] || 0) + Number(row.n);
    }
    return { ok:true,ready:true,revision:token,storeRevision:revision,page,pageCount,pageSize:20,filteredTotal:total,tasks,history:[],summary,userSummary,
      protocolVersion:meta('protocolVersion',''),generatedAt:meta('updatedAt',''),executors:stmt("SELECT DISTINCT executor FROM tasks WHERE executor<>''").all().map(row=>row.executor) };
  }
  function readTasks(query = {}) {
    open(); const args = [String(query.cursor || '')], where = ['task_id>?'];
    if (query.sourceType) { where.push('source_type=?'); args.push(query.sourceType); }
    if (query.sourceId) { where.push('source_id=?'); args.push(String(query.sourceId)); }
    const rows = stmt(`SELECT payload_json,task_revision FROM tasks WHERE ${where.join(' AND ')} ORDER BY task_id LIMIT ?`).all(...args,Math.min(100,Math.max(1,Number(query.limit)||100)));
    const tasks = rows.map(row => JSON.parse(row.payload_json));
    return { ok:true,tasks,revisions:Object.fromEntries(rows.map((row,i)=>[tasks[i].id,row.task_revision])),cursor:tasks.at(-1)?.id || '',revision };
  }
  function listRunnableTasks(query = {}) {
    open(); const now = query.now || new Date().toISOString();
    const states = query.retry ? ['failed','timed_out','blocked'] : ['pending','approved','queued'];
    const cursor = decodeRunnableCursor(query.cursor);
    const rows = stmt(`WITH runnable AS (
        SELECT payload_json,task_id,
          (CASE WHEN priority_boost_until>? THEN 100 ELSE priority_class END
            + MIN(20, MAX(0, CAST((julianday(?) - julianday(COALESCE(NULLIF(queued_at,''),NULLIF(updated_at,''),?)))*288 AS INTEGER)))) AS effective_priority,
          COALESCE(NULLIF(queued_at,''),NULLIF(updated_at,''),?) AS queue_time
        FROM tasks WHERE status IN (?,?,?)
          AND (?=1 OR scheduled_at='' OR scheduled_at<=?)
          AND (next_retry_at='' OR next_retry_at<=?)
          AND (resource_retry_at='' OR resource_retry_at<=?)
      ) SELECT payload_json,task_id,effective_priority,queue_time FROM runnable
      WHERE (?=0 OR effective_priority<? OR (effective_priority=? AND (queue_time>? OR (queue_time=? AND task_id>?))))
      ORDER BY effective_priority DESC,queue_time,task_id LIMIT ?`).all(
      now,now,now,now,...states,query.retry?1:0,now,now,now,
      cursor?1:0,cursor?.priority??0,cursor?.priority??0,cursor?.queuedAt||'',cursor?.queuedAt||'',cursor?.taskId||'',
      Math.min(100,Number(query.limit)||20));
    const tasks = rows.map(row=>JSON.parse(row.payload_json));
    return { ok:true,tasks,cursor:encodeRunnableCursor(rows.at(-1)),revision };
  }
  function listCapabilityWaitTasks(query={}){
    open();const rows=stmt(`SELECT task_id,payload_json FROM tasks WHERE status IN ('pending','approved','queued')
      AND next_retry_at>'' AND task_id>? AND json_type(payload_json,'$.capabilityWait')='object'
      ORDER BY task_id LIMIT ?`).all(String(query.cursor||''),Math.max(1,Math.min(100,Number(query.limit)||20)));
    return {ok:true,tasks:rows.map(row=>JSON.parse(row.payload_json)),cursor:rows.at(-1)?.task_id||'',revision};
  }
  function listDigestClosureRepairs(query={}){
    open();const rows=stmt(`SELECT task_id,payload_json FROM tasks WHERE task_id>? AND kind IN ('student_digest','project_digest') AND (
      (status='succeeded' AND json_extract(payload_json,'$.result.validation.valid')=1 AND
        (COALESCE(json_extract(payload_json,'$.settlementState'),'')='' OR COALESCE(json_extract(payload_json,'$.businessOutcome'),'')='')) OR
      (status IN ('failed','timed_out','blocked') AND json_extract(payload_json,'$.error.code')='nothing_pending') OR
      (kind='project_digest' AND status IN ('pending','approved','queued') AND COALESCE(json_extract(payload_json,'$.attempt'),0)=0 AND
        COALESCE(json_extract(payload_json,'$.executionId'),'')='' AND COALESCE(json_extract(payload_json,'$.requestOrigin'),'')!='user_manual_once'))
      ORDER BY task_id LIMIT ?`).all(String(query.cursor||''),Math.max(1,Math.min(20,Number(query.limit)||20)));
    return {ok:true,tasks:rows.map(row=>JSON.parse(row.payload_json)),cursor:rows.at(-1)?.task_id||'',revision};
  }
  function detail(id) {
    open(); const row = stmt('SELECT payload_json,task_revision FROM tasks WHERE task_id=?').get(String(id));
    if (!row) return { ok:false,code:'TASK_NOT_FOUND',message:'未找到任务。' };
    const task = JSON.parse(row.payload_json);
    return { ok:true,task:{...task,...taskPresentation(task)},taskRevision:row.task_revision,history:stmt('SELECT payload_json FROM task_history_entries WHERE task_id=? ORDER BY occurred_at DESC LIMIT 100').all(String(id)).map(r=>JSON.parse(r.payload_json)) };
  }
  function appendEvent(event) {
    open(); stmt('INSERT OR IGNORE INTO task_events VALUES(?,?,?,?,?)').run(String(event.id||crypto.randomUUID()),String(event.taskId||''),String(event.type||''),String(event.at||''),JSON.stringify(event));
  }
  function budget(action, query = {}) {
    open();
    const key = String(query.budgetKey || '');
    if (!key) throw fail('TASK_BUDGET_KEY_REQUIRED');
    if (action === 'get') return { ok:true, budget:stmt('SELECT * FROM task_execution_budget WHERE budget_key=?').get(key) || null };
    const now = new Date().toISOString();
    if (action === 'reset') {
      stmt('DELETE FROM task_execution_budget WHERE budget_key=?').run(key);
      return { ok:true, budget:null };
    }
    if (action !== 'record') throw fail('TASK_BUDGET_ACTION_INVALID');
    const current = stmt('SELECT * FROM task_execution_budget WHERE budget_key=?').get(key);
    const attempts = Math.max(0, Number(current?.attempts || 0)) + Math.max(0, Number(query.increment ?? 1));
    const terminalState = String(query.terminalState || current?.terminal_state || (attempts >= Math.max(1, Number(query.maxAttempts || 2)) ? 'failed_terminal' : ''));
    stmt(`INSERT INTO task_execution_budget(budget_key,work_key,error_signature,input_hash,attempts,next_retry_at,terminal_state,last_error_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(budget_key) DO UPDATE SET
      attempts=excluded.attempts,next_retry_at=excluded.next_retry_at,terminal_state=excluded.terminal_state,
      last_error_json=excluded.last_error_json,updated_at=excluded.updated_at`).run(key,String(query.workKey||current?.work_key||''),
      String(query.errorSignature||current?.error_signature||''),String(query.inputHash||current?.input_hash||''),attempts,
      String(query.nextRetryAt||''),terminalState,JSON.stringify(query.error||{}),String(current?.created_at||now),now);
    return { ok:true, budget:stmt('SELECT * FROM task_execution_budget WHERE budget_key=?').get(key) };
  }
  function source(action, query = {}) {
    open(); const type = String(query.sourceType || ''), id = String(query.sourceId || '');
    if(action==='versions')return {ok:true,sources:(query.sources||[]).slice(0,100).map(s=>stmt("SELECT dirty,json_extract(projection_json,'$.catalogSignature') catalogSignature FROM task_source_state WHERE source_type=? AND source_id=?").get(s.sourceType,s.sourceId)||null)};
    if (action === 'dirty') {
      stmt(`INSERT INTO task_source_state(source_type,source_id,source_revision,dirty,reason,updated_at) VALUES(?,?,?,1,?,?)
        ON CONFLICT(source_type,source_id) DO UPDATE SET source_revision=excluded.source_revision,dirty=1,reason=excluded.reason,updated_at=excluded.updated_at`).run(type,id,String(query.sourceRevision||''),String(query.reason||''),new Date().toISOString());
      return { ok:true };
    }
    if (action === 'projection') {
      stmt(`UPDATE task_source_state SET projection_json=?,processed_revision=?,dirty=CASE WHEN source_revision=? THEN 0 ELSE 1 END WHERE source_type=? AND source_id=?`).run(JSON.stringify(query.projection),query.sourceRevision,query.sourceRevision,type,id); return { ok:true };
    }
    if (action === 'list') return { ok:true,sources:stmt('SELECT * FROM task_source_state WHERE dirty=1 ORDER BY updated_at,source_type,source_id LIMIT 20').all() };
    return { ok:true,source:stmt('SELECT * FROM task_source_state WHERE source_type=? AND source_id=?').get(type,id) || null };
  }
  return { dbPath,open,list,readTasks,listRunnableTasks,listCapabilityWaitTasks,listDigestClosureRepairs,previewTaskRecovery,applyTaskRecovery,detail,applyDelta,patchTask,source,budget,appendEvent,refreshPresentation,
    revision:()=>revision,
    info:()=>{open();return {ok:true,revision,value:{protocolVersion:meta('protocolVersion',''),updatedAt:meta('updatedAt',''),runtime:meta('runtime',{}),deletedTasks:meta('deletedTasks',[]),tasks:[],history:stmt('SELECT payload_json FROM task_history_entries ORDER BY occurred_at DESC LIMIT 500').all().map(row=>JSON.parse(row.payload_json))}};},
    upsertTaskBatch:(tasks,expectedRevision)=>applyDelta({upserts:tasks,expectedRevision}),
    archiveTaskBatch:ids=>{ if(ids.length>100)throw fail('TASK_BATCH_TOO_LARGE');return applyDelta({upserts:ids.map(id=>{const row=detail(id);if(!row.ok)throw fail('TASK_NOT_FOUND');return {...row.task,status:'archived',updatedAt:new Date().toISOString()};})}); },
    appendTaskHistoryBatch:entries=>applyDelta({history:entries}),patchTaskMeta:patch=>applyDelta({meta:patch}),
    claimTaskExecution:query=>executionMutation('claim',query),
    advanceTaskExecution:query=>executionMutation('advance',query),
    recordTaskRunOutcome:query=>executionMutation('recordOutcome',query),
    getTaskSessionSummary:sessionRunId=>{open();return executionLedger.readTaskSessionSummary(stmt,String(sessionRunId));},
    writeSnapshot:()=>{throw fail('task_full_snapshot_write_forbidden');},
    release:()=>{},
    close(){if(db){try{db.exec('PRAGMA wal_checkpoint(PASSIVE)');}catch{} db.close();db=null;statements.clear();}},
  };
}
module.exports = { createTaskSqlStore, COLUMNS, encodeRunnableCursor, decodeRunnableCursor };
