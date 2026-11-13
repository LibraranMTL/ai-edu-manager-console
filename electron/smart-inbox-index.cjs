'use strict';
const { DatabaseSync } = require('node:sqlite');

// Disposable projection: JSON records remain the authoritative, recoverable state.
function createInboxIndex(root, records) {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY, source_id TEXT NOT NULL, student_id TEXT NOT NULL,
        status TEXT NOT NULL, created_at TEXT NOT NULL, sha256 TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS inbox_source ON items(source_id,status,created_at DESC);
      CREATE INDEX IF NOT EXISTS inbox_student ON items(student_id,status,created_at DESC);
      CREATE INDEX IF NOT EXISTS inbox_fingerprint ON items(student_id,sha256) WHERE sha256<>'';`);
    const upsert = db.prepare(`INSERT OR REPLACE INTO items(id,source_id,student_id,status,created_at,sha256) VALUES(?,?,?,?,?,?)`);
    const update = item => upsert.run(String(item.id), String(item.sourceId || ''), String(item.studentId || ''),
      String(item.status || ''), String(item.createdAt || ''), String(item.fingerprint?.sha256 || ''));
    db.exec('BEGIN IMMEDIATE');
    try { db.exec('DELETE FROM items'); for (const item of records) update(item); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
    return { update, close: () => db.close(), matchingFingerprint(studentId, sha256) {
      return db.prepare("SELECT id FROM items WHERE student_id=? AND sha256=? AND status='delivered' ORDER BY created_at DESC,id ASC").all(studentId, sha256).map(row => row.id);
    }, list({ studentId, sourceId, status, page, size }) {
      const conditions = [], args = [];
      if (sourceId) { conditions.push('source_id=?'); args.push(sourceId); }
      if (studentId) { conditions.push("(student_id='' OR student_id=?)"); args.push(studentId); }
      if (status === 'delivered' || status === 'ignored') { conditions.push('status=?'); args.push(status); }
      else conditions.push("status NOT IN ('delivered','ignored')");
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const total = Number(db.prepare(`SELECT COUNT(*) AS count FROM items ${where}`).get(...args).count);
      const ids = db.prepare(`SELECT id FROM items ${where} ORDER BY created_at DESC,id ASC LIMIT ? OFFSET ?`)
        .all(...args, size, (page - 1) * size).map(row => row.id);
      return { total, ids };
    } };
  } catch (error) { db.close(); throw error; }
}
module.exports = { createInboxIndex };
