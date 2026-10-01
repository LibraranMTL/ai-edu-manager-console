'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const REPORT_TYPES = new Set(['learning_profile', 'learning_change', 'weekly_action', 'stage_summary']);
const MAX_REPORT_BYTES = 2 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const CODE_LIFETIME_MS = 5 * 60 * 1000;
const READ_GRANT_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;
const ADMIN_SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
const DEFAULT_MAX_STUDENT_BYTES = 256 * 1024 * 1024;
const DOCUMENT_TYPES = new Map([
  ['text/markdown', '.md'],
  ['application/pdf', '.pdf'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
]);

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function validId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{8,96}$/.test(value);
}

function createService({ dataDir, adminToken, now = () => Date.now(), maxStudentBytes = DEFAULT_MAX_STUDENT_BYTES, allowLegacyTestCredentials = false }) {
  if (allowLegacyTestCredentials && !process.env.NODE_TEST_CONTEXT) throw new Error('Legacy credentials are restricted to node:test migration fixtures');
  if (!dataDir || !adminToken || String(adminToken).length < 24) {
    throw new Error('dataDir and a 24+ character adminToken are required');
  }
  if (!Number.isSafeInteger(maxStudentBytes) || maxStudentBytes <= 0) {
    throw new Error('maxStudentBytes must be a positive safe integer');
  }
  fs.mkdirSync(dataDir, { recursive: true });
  const objectDir = path.join(dataDir, 'objects');
  fs.mkdirSync(objectDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'cloud-reports.sqlite'));
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY, display_name TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('source','viewer')),
      token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, public_key TEXT
    );
    CREATE TABLE IF NOT EXISTS request_nonces (
      device_id TEXT NOT NULL REFERENCES devices(id), nonce TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY(device_id,nonce)
    );
    CREATE TABLE IF NOT EXISTS grants (
      device_id TEXT NOT NULL REFERENCES devices(id), student_id TEXT NOT NULL REFERENCES students(id),
      scope TEXT NOT NULL CHECK(scope IN ('report.write','cloud_document.read')),
      revoked_at INTEGER, created_at INTEGER NOT NULL, expires_at INTEGER,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
      PRIMARY KEY(device_id, student_id, scope)
    );
    CREATE TABLE IF NOT EXISTS pairings (
      code_hash TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id),
      expires_at INTEGER NOT NULL, consumed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS source_enrollments (
      code_hash TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id),
      expires_at INTEGER NOT NULL, consumed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id),
      origin_device_id TEXT NOT NULL REFERENCES devices(id), origin_platform TEXT NOT NULL, report_type TEXT NOT NULL,
      source_sha256 TEXT NOT NULL, content_sha256 TEXT NOT NULL, source_status TEXT NOT NULL,
      published_at TEXT NOT NULL, received_at INTEGER NOT NULL, byte_size INTEGER NOT NULL,
      filename TEXT NOT NULL, object_name TEXT NOT NULL,
      UNIQUE(student_id, origin_device_id, report_type, content_sha256)
    );
    CREATE INDEX IF NOT EXISTS reports_student_cursor ON reports(student_id, received_at, id);
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id),
      origin_device_id TEXT NOT NULL REFERENCES devices(id), display_name TEXT NOT NULL,
      content_type TEXT NOT NULL, content_sha256 TEXT NOT NULL, byte_size INTEGER NOT NULL,
      object_name TEXT NOT NULL, created_at INTEGER NOT NULL, deleted_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS documents_student ON documents(student_id, created_at);
    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, occurred_at INTEGER NOT NULL,
      actor_id TEXT NOT NULL, action TEXT NOT NULL, student_id TEXT, target_id TEXT
    );
    CREATE INDEX IF NOT EXISTS audit_events_student ON audit_events(student_id, id);
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_identity (
      id TEXT PRIMARY KEY, salt TEXT NOT NULL, credential_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS report_tombstones (
      revision_id TEXT PRIMARY KEY REFERENCES reports(id), student_id TEXT NOT NULL,
      deleted_at INTEGER NOT NULL, actor_id TEXT NOT NULL
    );
  `);
  if (!db.prepare('PRAGMA table_info(reports)').all().some(column => column.name === 'origin_platform')) {
    db.exec("ALTER TABLE reports ADD COLUMN origin_platform TEXT NOT NULL DEFAULT 'unknown'");
  }
  if (!db.prepare('PRAGMA table_info(grants)').all().some(column => column.name === 'expires_at')) {
    db.exec('ALTER TABLE grants ADD COLUMN expires_at INTEGER');
    db.prepare('UPDATE grants SET expires_at=created_at+? WHERE scope=?')
      .run(READ_GRANT_LIFETIME_MS, 'cloud_document.read');
  }
  if (!db.prepare('PRAGMA table_info(grants)').all().some(column => column.name === 'enabled')) {
    db.exec('ALTER TABLE grants ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1))');
  }
  if (!db.prepare('PRAGMA table_info(devices)').all().some(column => column.name === 'public_key')) {
    db.exec('ALTER TABLE devices ADD COLUMN public_key TEXT');
  }
  if (!db.prepare('PRAGMA table_info(devices)').all().some(column => column.name === 'revoked_at')) db.exec('ALTER TABLE devices ADD COLUMN revoked_at INTEGER');
  if (!db.prepare('SELECT 1 FROM admin_identity WHERE id=?').get('admin_local')) {
    const salt = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO admin_identity VALUES(?,?,?)').run('admin_local', salt, crypto.scryptSync(adminToken, salt, 32).toString('hex'));
    db.exec('DELETE FROM admin_sessions');
  }
  db.prepare('INSERT OR IGNORE INTO devices(id,kind,token_hash,created_at) VALUES(?,?,?,?)')
    .run('admin_local', 'source', digest(`admin-local:${adminToken}`), now());

  function audit(actorId, action, studentId = null, targetId = null) {
    db.prepare('INSERT INTO audit_events(occurred_at,actor_id,action,student_id,target_id) VALUES(?,?,?,?,?)')
      .run(now(), actorId, action, studentId, targetId);
  }
  function atomic(action) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  function listAudit(token, cursor = '', studentId = '') {
    if (!isAdmin(token)) fail(401, '管理员凭据无效');
    if (cursor && (!/^[1-9]\d*$/.test(String(cursor)) || !Number.isSafeInteger(Number(cursor)))) fail(400, '审计游标无效');
    if (studentId && !validId(studentId)) fail(400, '学生标识无效');
    const rows = db.prepare(`SELECT id, occurred_at AS occurredAt, actor_id AS actorId, action,
      student_id AS studentId, target_id AS targetId FROM audit_events
      WHERE (?='' OR student_id=?) AND (?=0 OR id<?) ORDER BY id DESC LIMIT 101`)
      .all(studentId, studentId, cursor ? Number(cursor) : 0, cursor ? Number(cursor) : 0);
    const events = rows.slice(0, 100);
    return { events, nextCursor: rows.length > 100 ? String(events.at(-1).id) : '' };
  }

  function loginAdmin(credential) {
    if (!validAdminCredential(credential)) fail(401, '管理员凭据无效');
    const sessionToken = randomToken();
    const expiresAt = now() + ADMIN_SESSION_LIFETIME_MS;
    atomic(() => {
      db.prepare('DELETE FROM admin_sessions WHERE expires_at<=?').run(now());
      db.prepare('INSERT INTO admin_sessions(token_hash,created_at,expires_at) VALUES(?,?,?)')
        .run(digest(sessionToken), now(), expiresAt);
      audit('admin_local', 'admin.session.login');
    });
    return { sessionToken, expiresAt };
  }
  function validAdminCredential(value) {
    if (typeof value !== 'string' || value.length < 24 || value.length > 256) return false;
    const identity = db.prepare('SELECT * FROM admin_identity WHERE id=?').get('admin_local');
    return safeEqual(crypto.scryptSync(value, identity.salt, 32).toString('hex'), identity.credential_hash);
  }
  function rotateAdmin(token, oldCredential, newCredential) {
    if (!isAdmin(token) || !validAdminCredential(oldCredential)) fail(401, '管理员凭据无效');
    if (typeof newCredential !== 'string' || newCredential.length < 24 || newCredential.length > 256 || newCredential === oldCredential) fail(400, '新凭据须为不同的 24–256 字符');
    const salt = crypto.randomBytes(32).toString('hex');
    const hash = crypto.scryptSync(newCredential, salt, 32).toString('hex');
    atomic(() => {
      db.prepare('UPDATE admin_identity SET salt=?,credential_hash=? WHERE id=?').run(salt, hash, 'admin_local');
      db.exec('DELETE FROM admin_sessions');
      audit('admin_local', 'admin.credential.rotate');
    });
    return { rotated: true, loginRequired: true };
  }
  function logoutAdmin(token) {
    if (!token || safeEqual(token, adminToken)) fail(401, '管理会话无效');
    return atomic(() => {
      const result = db.prepare('DELETE FROM admin_sessions WHERE token_hash=? AND expires_at>?')
        .run(digest(token), now());
      if (result.changes !== 1) fail(401, '管理会话无效');
      audit('admin_local', 'admin.session.logout');
      return { loggedOut: true };
    });
  }
  function isAdmin(token) {
    if (!token) return false;
    if (allowLegacyTestCredentials && safeEqual(token, adminToken)) return true;
    return Boolean(db.prepare('SELECT 1 FROM admin_sessions WHERE token_hash=? AND expires_at>?')
      .get(digest(token), now()));
  }
  function deviceFor(token) {
    if (!token) return null;
    return db.prepare('SELECT id, kind, public_key FROM devices WHERE token_hash=? AND revoked_at IS NULL').get(digest(token)) || null;
  }
  function requireDevice(token, kind) {
    const device = deviceFor(token);
    if (!device || (kind && device.kind !== kind)) fail(401, '设备凭据无效');
    return device;
  }
  function verifyViewerProof(token, method, route, headers) {
    const device = deviceFor(token);
    if (!device || (device.kind === 'source' && allowLegacyTestCredentials && !device.public_key)) return;
    const row = db.prepare('SELECT public_key FROM devices WHERE id=?').get(device.id);
    const timestamp = String(headers['x-cloud-timestamp'] || '');
    const nonce = String(headers['x-cloud-nonce'] || '');
    const signature = String(headers['x-cloud-signature'] || '');
    if (!row?.public_key || headers['x-cloud-device-id'] !== device.id || !/^\d{10,16}$/.test(timestamp) ||
        Math.abs(now() - Number(timestamp)) > 60000 || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce) ||
        !/^[A-Za-z0-9_-]{64,256}$/.test(signature)) fail(401, '主机持有证明无效');
    const bodyHash = String(headers['x-cloud-body-sha256'] || '');
    if (device.kind === 'source' && !/^[a-f0-9]{64}$/.test(bodyHash)) fail(401, '请求正文证明缺失');
    const message = Buffer.from(`${method}\n${route}\n${timestamp}\n${nonce}${device.kind === 'source' ? `\n${bodyHash}` : ''}`);
    let verified = false;
    try { verified = crypto.verify('sha256', message, row.public_key, Buffer.from(signature, 'base64url')); }
    catch { /* malformed signature */ }
    if (!verified) fail(401, '主机持有证明无效');
    db.prepare('DELETE FROM request_nonces WHERE created_at<?').run(now() - 120000);
    try { db.prepare('INSERT INTO request_nonces(device_id,nonce,created_at) VALUES(?,?,?)').run(device.id, nonce, now()); }
    catch { fail(401, '主机请求已使用'); }
  }
  function verifyBody(token, bytes, headers) {
    verifyBodyHash(token, digest(bytes), headers);
  }
  function verifyBodyHash(token, hash, headers) {
    const device = deviceFor(token);
    if (device?.kind === 'source' && (device.public_key || !allowLegacyTestCredentials) &&
        !safeEqual(headers['x-cloud-body-sha256'], hash)) fail(401, '请求正文与签名不一致');
  }
  function checkedKey(value) {
    if (!value && allowLegacyTestCredentials) return null;
    try {
      const key = crypto.createPublicKey(value);
      if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1' || value.length > 1000) throw new Error();
      return key.export({ type: 'spki', format: 'pem' });
    } catch { fail(400, '来源公钥须为 P-256'); }
  }
  function rotateDevice(token, nextToken) {
    const device = requireDevice(token, 'source');
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(nextToken || '') || nextToken === token) fail(400, '新设备凭据无效');
    atomic(() => {
      db.prepare('UPDATE devices SET token_hash=? WHERE id=?').run(digest(nextToken), device.id);
      audit(device.id, 'device.credential.rotate', null, device.id);
    });
    return { rotated: true };
  }
  function recordDenied(token, status) {
    if ([401, 403, 429].includes(status)) audit(deviceFor(token)?.id || 'anonymous', `security.denied.${status}`);
  }
  function revokeDevice(token, deviceId) {
    if (!isAdmin(token)) fail(401, '管理员凭据无效');
    if (!validId(deviceId) || deviceId === 'admin_local') fail(400, '设备标识无效');
    atomic(() => {
      db.prepare('UPDATE devices SET revoked_at=? WHERE id=?').run(now(), deviceId);
      db.prepare('UPDATE grants SET revoked_at=? WHERE device_id=?').run(now(), deviceId);
      audit('admin_local', 'device.revoke', null, deviceId);
    });
    return { revoked: true };
  }
  function hasGrant(deviceId, studentId, scope) {
    return Boolean(db.prepare("SELECT 1 FROM grants WHERE device_id=? AND student_id=? AND scope=? AND revoked_at IS NULL AND (scope!='cloud_document.read' OR (expires_at IS NOT NULL AND expires_at>?))")
      .get(deviceId, studentId, scope, now()));
  }
  function requireGrant(deviceId, studentId, scope) {
    if (!hasGrant(deviceId, studentId, scope)) fail(403, '该设备没有此学生的许可');
  }
  function studentExists(studentId) {
    return Boolean(db.prepare('SELECT 1 FROM students WHERE id=?').get(studentId));
  }
  function studentUsedBytes(studentId) {
    const reports = db.prepare('SELECT COALESCE(SUM(byte_size),0) AS bytes FROM reports WHERE student_id=?').get(studentId).bytes;
    const documents = db.prepare('SELECT COALESCE(SUM(byte_size),0) AS bytes FROM documents WHERE student_id=?').get(studentId).bytes;
    return reports + documents;
  }
  function studentStorage(token, studentId) {
    if (!isAdmin(token)) fail(401, '管理员凭据无效');
    if (!studentExists(studentId)) fail(404, '学生不存在');
    return { cloudStudentId: studentId, usedBytes: studentUsedBytes(studentId), maxBytes: maxStudentBytes };
  }
  function requireStudentCapacity(studentId, additionalBytes) {
    if (additionalBytes > maxStudentBytes - studentUsedBytes(studentId)) fail(413, '该学生云端容量已满');
  }
  function grant(deviceId, studentId, scope, actorId = 'admin_local') {
    if (!studentExists(studentId)) fail(404, '学生不存在');
    const device = db.prepare('SELECT kind FROM devices WHERE id=?').get(deviceId);
    if (!device) fail(404, '设备不存在');
    if (scope === 'report.write' && device.kind !== 'source') fail(400, '只有来源设备可上传');
    if (scope === 'cloud_document.read' && device.kind !== 'viewer') fail(400, '只有接收设备可下载');
    const expiresAt = scope === 'cloud_document.read' ? now() + READ_GRANT_LIFETIME_MS : null;
    db.prepare(`INSERT INTO grants(device_id,student_id,scope,created_at,revoked_at,expires_at,enabled) VALUES(?,?,?,?,NULL,?,1)
      ON CONFLICT(device_id,student_id,scope) DO UPDATE SET revoked_at=NULL,created_at=excluded.created_at,expires_at=excluded.expires_at,enabled=1`)
      .run(deviceId, studentId, scope, now(), expiresAt);
    audit(actorId, `grant.issue.${scope}`, studentId, deviceId);
    return { deviceId, studentId, scope, active: true, expiresAt };
  }
  function createStudent(token, displayName) {
    if (!isAdmin(token)) fail(401, '管理员凭据无效');
    const name = String(displayName || '').trim();
    if (!name || name.length > 100) fail(400, '学生显示名无效');
    const id = `cs_${crypto.randomUUID().replaceAll('-', '')}`;
    atomic(() => {
      db.prepare('INSERT INTO students(id,display_name,created_at) VALUES(?,?,?)').run(id, name, now());
      audit('admin_local', 'student.create', id);
    });
    return { id, displayName: name };
  }
  function registerSource(token, publicKey) {
    if (!isAdmin(token)) fail(401, '管理员凭据无效');
    const key = checkedKey(publicKey);
    const deviceToken = randomToken();
    const deviceId = `src_${crypto.randomUUID().replaceAll('-', '')}`;
    atomic(() => {
      db.prepare('INSERT INTO devices(id,kind,token_hash,created_at,public_key) VALUES(?,?,?,?,?)')
        .run(deviceId, 'source', digest(deviceToken), now(), key);
      audit('admin_local', 'source.register', null, deviceId);
    });
    return { deviceId, deviceToken };
  }
  function allowWrite(token, deviceId, studentId) {
    if (!isAdmin(token)) fail(401, '管理员凭据无效');
    return atomic(() => grant(deviceId, studentId, 'report.write'));
  }
  function createSourceEnrollment(token, studentId) {
    if (!isAdmin(token)) fail(401, '管理员凭据无效');
    if (!studentExists(studentId)) fail(404, '学生不存在');
    const code = crypto.randomBytes(9).toString('base64url').toUpperCase();
    const expiresAt = now() + CODE_LIFETIME_MS;
    atomic(() => {
      db.prepare('INSERT INTO source_enrollments(code_hash,student_id,expires_at) VALUES(?,?,?)')
        .run(digest(code), studentId, expiresAt);
      audit('admin_local', 'source.enrollment.create', studentId);
    });
    return { enrollmentCode: code, expiresAt };
  }
  function redeemSourceEnrollment(code, existingToken = '', publicKey) {
    const key = checkedKey(publicKey);
    if (!/^[A-Z0-9_-]{12}$/.test(String(code || ''))) fail(400, '开通码格式无效');
    const record = db.prepare('SELECT student_id,expires_at,consumed_at FROM source_enrollments WHERE code_hash=?').get(digest(code));
    if (!record || record.consumed_at || record.expires_at <= now()) fail(404, '开通码无效或已过期');
    const existing = existingToken ? requireDevice(existingToken, 'source') : null;
    if (existing && existing.public_key !== key) fail(403, '来源公钥与已绑定设备不一致');
    const deviceToken = existing ? existingToken : randomToken();
    const deviceId = existing ? existing.id : `src_${crypto.randomUUID().replaceAll('-', '')}`;
    atomic(() => {
      const consumed = db.prepare('UPDATE source_enrollments SET consumed_at=? WHERE code_hash=? AND consumed_at IS NULL AND expires_at>?')
        .run(now(), digest(code), now());
      if (consumed.changes !== 1) fail(409, '开通码已使用');
      if (!existing) db.prepare('INSERT INTO devices(id,kind,token_hash,created_at,public_key) VALUES(?,?,?,?,?)')
        .run(deviceId, 'source', digest(deviceToken), now(), key);
      grant(deviceId, record.student_id, 'report.write', deviceId);
      audit(deviceId, 'source.enrollment.redeem', record.student_id);
    });
    return { deviceId, deviceToken, cloudStudentId: record.student_id };
  }
  function createPairing(existingToken = '', publicKey = '') {
    const existing = existingToken ? requireDevice(existingToken, 'viewer') : null;
    let key;
    try { key = crypto.createPublicKey(publicKey); }
    catch { fail(400, '主机公钥无效'); }
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1' || String(publicKey).length > 1000) {
      fail(400, '主机公钥须为 P-256');
    }
    if (existing) {
      const registered = db.prepare('SELECT public_key FROM devices WHERE id=?').get(existing.id)?.public_key;
      if (registered !== publicKey) fail(403, '主机公钥与已绑定设备不一致');
    }
    const deviceToken = existing ? existingToken : randomToken();
    const deviceId = existing ? existing.id : `win_${crypto.randomUUID().replaceAll('-', '')}`;
    const code = String(crypto.randomInt(0, 100000000)).padStart(8, '0');
    const codeHash = digest(code);
    atomic(() => {
      if (!existing) db.prepare('INSERT INTO devices(id,kind,token_hash,created_at,public_key) VALUES(?,?,?,?,?)')
        .run(deviceId, 'viewer', digest(deviceToken), now(), publicKey);
      db.prepare('INSERT INTO pairings(code_hash,device_id,expires_at) VALUES(?,?,?)')
        .run(codeHash, deviceId, now() + CODE_LIFETIME_MS);
      audit(deviceId, 'viewer.pairing.request');
    });
    return { deviceId, deviceToken, pairingCode: code, expiresAt: now() + CODE_LIFETIME_MS };
  }
  function approvePairing(token, code, studentIds) {
    const admin = isAdmin(token);
    const source = admin ? null : requireDevice(token, 'source');
    if (!/^\d{8}$/.test(String(code || ''))) fail(400, '配对码格式无效');
    const ids = [...new Set(Array.isArray(studentIds) ? studentIds : [])];
    if (ids.length < 1 || ids.length > 20 || ids.some(id => !validId(id))) fail(400, '请选择有效学生');
    for (const studentId of ids) {
      if (admin) { if (!studentExists(studentId)) fail(404, '学生不存在'); }
      else requireGrant(source.id, studentId, 'report.write');
    }
    const pairing = db.prepare('SELECT device_id,expires_at,consumed_at FROM pairings WHERE code_hash=?').get(digest(code));
    if (!pairing || pairing.consumed_at || pairing.expires_at <= now()) fail(404, '配对码无效或已过期');
    atomic(() => {
      const consumed = db.prepare('UPDATE pairings SET consumed_at=? WHERE code_hash=? AND consumed_at IS NULL AND expires_at>?')
        .run(now(), digest(code), now());
      if (consumed.changes !== 1) fail(409, '配对码已使用');
      for (const studentId of ids) grant(pairing.device_id, studentId, 'cloud_document.read', source?.id || 'admin_local');
      audit(source?.id || 'admin_local', 'viewer.pairing.approve', null, pairing.device_id);
    });
    return { deviceId: pairing.device_id, studentIds: ids, expiresAt: now() + READ_GRANT_LIFETIME_MS };
  }
  function revoke(token, deviceId, studentId, scope) {
    if (!validId(deviceId) || !validId(studentId) || !['report.write', 'cloud_document.read'].includes(scope)) {
      fail(400, '撤销许可参数无效');
    }
    const source = deviceFor(token);
    if (!isAdmin(token) && !(source?.kind === 'source' && hasGrant(source.id, studentId, 'report.write') && scope === 'cloud_document.read')) {
      fail(403, '没有撤销权限');
    }
    return atomic(() => {
      const result = db.prepare('UPDATE grants SET revoked_at=? WHERE device_id=? AND student_id=? AND scope=? AND revoked_at IS NULL')
        .run(now(), deviceId, studentId, scope);
      if (result.changes === 1) audit(isAdmin(token) ? 'admin_local' : source.id, `grant.revoke.${scope}`, studentId, deviceId);
      return { revoked: result.changes === 1 };
    });
  }
  function listGrants(token, studentId) {
    if (!isAdmin(token)) fail(401, '管理员凭据无效');
    if (!studentExists(studentId)) fail(404, '学生不存在');
    return db.prepare(`SELECT g.device_id AS deviceId, d.kind, g.scope,
      g.created_at AS createdAt, g.revoked_at AS revokedAt, g.expires_at AS expiresAt, g.enabled
      FROM grants g JOIN devices d ON d.id=g.device_id
      WHERE g.student_id=? ORDER BY g.created_at DESC,g.device_id`).all(studentId);
  }
  function setOwnWrite(token, studentId, enabled) {
    const source = requireDevice(token, 'source');
    if (typeof enabled !== 'boolean') fail(400, '上传开关无效');
    const known = db.prepare('SELECT 1 FROM grants WHERE device_id=? AND student_id=? AND scope=? AND revoked_at IS NULL')
      .get(source.id, studentId, 'report.write');
    if (!known) fail(403, '该设备没有有效的学生上传许可');
    atomic(() => {
      const result = db.prepare('UPDATE grants SET enabled=? WHERE device_id=? AND student_id=? AND scope=? AND revoked_at IS NULL')
        .run(enabled ? 1 : 0, source.id, studentId, 'report.write');
      if (result.changes !== 1) fail(403, '该设备没有有效的学生上传许可');
      audit(source.id, enabled ? 'report.upload.enable' : 'report.upload.disable', studentId);
    });
    return { studentId, enabled };
  }
  function listStudents(token) {
    if (isAdmin(token)) return db.prepare('SELECT id, display_name AS displayName FROM students ORDER BY display_name').all();
    const device = requireDevice(token);
    return db.prepare(`SELECT s.id, s.display_name AS displayName, g.scope, g.expires_at AS expiresAt
      FROM students s JOIN grants g ON g.student_id=s.id
      WHERE g.device_id=? AND g.revoked_at IS NULL AND (g.scope!='cloud_document.read' OR (g.expires_at IS NOT NULL AND g.expires_at>?)) ORDER BY s.display_name`)
      .all(device.id, now());
  }
  function checkSourceReports(token, input) {
    const source = requireDevice(token, 'source'), studentId = input?.cloudStudentId;
    requireGrant(source.id, studentId, 'report.write');
    if (!Array.isArray(input.reports) || input.reports.length > 4 || input.reports.some(item => !REPORT_TYPES.has(item.reportType) || !/^[a-f0-9]{64}$/.test(item.contentSha256 || ''))) fail(400, '报告回执核对合同无效');
    const receipts = input.reports.map(item => {
      const row = db.prepare('SELECT id FROM reports WHERE student_id=? AND origin_device_id=? AND report_type=? AND content_sha256=?').get(studentId, source.id, item.reportType, item.contentSha256);
      const withdrawn = row && db.prepare('SELECT 1 FROM report_tombstones WHERE revision_id=?').get(row.id);
      return { ...item, revisionId: row?.id || '', status: !row ? 'missing' : withdrawn ? 'withdrawn' : 'active' };
    });
    return { cloudStudentId: studentId, receipts, checkedAt: now() };
  }
  function uploadReport(token, input) {
    const source = requireDevice(token, 'source');
    const studentId = input?.cloudStudentId;
    requireGrant(source.id, studentId, 'report.write');
    const preference = db.prepare('SELECT enabled FROM grants WHERE device_id=? AND student_id=? AND scope=?')
      .get(source.id, studentId, 'report.write');
    if (!preference?.enabled) fail(403, '该学生已关闭自动上传');
    if (!REPORT_TYPES.has(input.reportType)) fail(400, '报告类型无效');
    if (!['android', 'windows'].includes(input.originPlatform)) fail(400, '报告来源端无效');
    if (!['active', 'published', 'current', 'updated'].includes(input.sourceStatus)) fail(400, '仅接受正式报告');
    if (typeof input.content !== 'string' || !input.content.trim()) fail(400, '报告正文为空');
    const content = Buffer.from(input.content, 'utf8');
    if (content.length > MAX_REPORT_BYTES) fail(413, '报告超过 2MB');
    if (typeof input.publishedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(input.publishedAt)) fail(400, '报告发布时间无效');
    const header = input.content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n/);
    if (!header) fail(400, '报告缺少元数据');
    const statusMatch = header[1].match(/^status:\s*(\S+)/im);
    if (!statusMatch || statusMatch[1].toLowerCase() !== input.sourceStatus) fail(400, '报告状态不一致');
    const typeMatch = header[1].match(/^type:\s*(\S+)/im);
    if (!typeMatch || typeMatch[1] !== input.reportType) fail(400, '报告类型与元数据不一致');
    const studentMatch = header[1].match(/^student_id:\s*(\S+)/im);
    if (studentMatch && (!input.localStudentId || studentMatch[1] !== input.localStudentId)) fail(400, '报告学生归属不一致');
    const updatedMatch = header[1].match(/^updated:\s*(\d{4}-\d{2}-\d{2})/im);
    if (!updatedMatch || updatedMatch[1] !== input.publishedAt.slice(0, 10)) fail(400, '报告更新时间不一致');
    const substantiveLines = input.content.slice(header[0].length).split(/\r?\n/)
      .map(line => line.trim()).filter(line => line && !line.startsWith('#'))
      .filter(line => !line.startsWith('> 本报告是成长模型的呈现输出'))
      .filter(line => !/^- (?:成长模型|能力画像|成长证据|项目贡献)：/u.test(line))
      .filter(line => !/^[-*]?\s*待(?:生成|补充)[。.]?$/u.test(line));
    if (!substantiveLines.some(line => line.replace(/^[-*]\s*/u, '').length >= 4)) fail(400, '报告正文仍是占位内容');
    if (/(?:[A-Za-z]:\\|file:\/\/|(?:^|\s)\/(?:Users|home)\/)/m.test(input.content)) fail(400, '报告包含本机绝对路径');
    const sha = digest(content);
    if (!safeEqual(sha, input.contentSha256)) fail(400, 'SHA-256 不匹配');
    const sourceSha = input.sourceSha256 || sha;
    if (!/^[a-f0-9]{64}$/.test(sourceSha)) fail(400, '原件 SHA-256 无效');
    const existing = db.prepare(`SELECT id FROM reports WHERE student_id=? AND origin_device_id=? AND report_type=? AND content_sha256=?`)
      .get(studentId, source.id, input.reportType, sha);
    if (existing) {
      if (db.prepare('SELECT 1 FROM report_tombstones WHERE revision_id=?').get(existing.id)) fail(410, '该报告修订已撤回，不可重新发布');
      return { revisionId: existing.id, duplicate: true };
    }
    requireStudentCapacity(studentId, content.length);
    const revisionId = `rev_${digest(`${studentId}|${source.id}|${input.reportType}|${sha}`).slice(0, 48)}`;
    const objectName = `${sha}.md`;
    const objectPath = path.join(objectDir, objectName);
    if (!fs.existsSync(objectPath)) {
      const tempPath = path.join(objectDir, `${objectName}.${crypto.randomUUID()}.tmp`);
      try {
        fs.writeFileSync(tempPath, content, { flag: 'wx' });
        fs.renameSync(tempPath, objectPath);
      } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
    }
    const filename = String(input.filename || `${input.reportType}.md`).replace(/[\\/\x00-\x1f]/g, '').slice(0, 120);
    atomic(() => {
      const result = db.prepare(`INSERT OR IGNORE INTO reports
        (id,student_id,origin_device_id,origin_platform,report_type,source_sha256,content_sha256,source_status,published_at,received_at,byte_size,filename,object_name)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(revisionId, studentId, source.id, input.originPlatform, input.reportType, sourceSha, sha, input.sourceStatus,
          input.publishedAt, now(), content.length, filename, objectName);
      if (result.changes === 1) audit(source.id, 'report.upload', studentId, revisionId);
    });
    return { revisionId, duplicate: false };
  }
  function listReports(token, studentId, cursor = '') {
    const admin = isAdmin(token);
    const viewer = admin ? null : requireDevice(token, 'viewer');
    if (!admin) requireGrant(viewer.id, studentId, 'cloud_document.read');
    const match = String(cursor || '').match(/^(\d+):(rev_[a-f0-9]{48})$/);
    if (cursor && !match) fail(400, '同步游标无效');
    const afterTime = match ? Number(match[1]) : 0;
    const afterId = match ? match[2] : '';
    if (!Number.isSafeInteger(afterTime) || afterTime < 0) fail(400, '同步游标无效');
    const rows = db.prepare(`SELECT id AS revisionId, report_type AS reportType,
      origin_device_id AS originDeviceId, origin_platform AS originPlatform, source_status AS sourceStatus,
      published_at AS publishedAt, received_at AS receivedAt,
      content_sha256 AS contentSha256, byte_size AS byteSize, filename
      FROM reports WHERE student_id=? AND id NOT IN (SELECT revision_id FROM report_tombstones) AND (?='' OR origin_device_id<>?)
      AND (received_at>? OR (received_at=? AND id>?))
      ORDER BY received_at,id LIMIT 201`).all(studentId, viewer?.id || '', viewer?.id || '', afterTime, afterTime, afterId);
    const page = rows.slice(0, 200);
    const last = page.at(-1);
    return { reports: page, nextCursor: rows.length > 200 ? `${last.receivedAt}:${last.revisionId}` : '' };
  }
  function getReport(token, revisionId) {
    const admin = isAdmin(token);
    const viewer = admin ? null : requireDevice(token, 'viewer');
    const row = db.prepare('SELECT * FROM reports WHERE id=?').get(revisionId);
    if (!row) fail(404, '报告不存在');
    if (!admin) requireGrant(viewer.id, row.student_id, 'cloud_document.read');
    if (db.prepare('SELECT 1 FROM report_tombstones WHERE revision_id=?').get(revisionId)) fail(410, '该报告修订已撤回');
    if (!admin && row.origin_device_id === viewer.id) fail(403, '本机报告无需下载');
    const content = fs.readFileSync(path.join(objectDir, row.object_name));
    if (!safeEqual(digest(content), row.content_sha256)) fail(500, '报告对象校验失败');
    audit(admin ? 'admin_local' : viewer.id, 'report.download', row.student_id, revisionId);
    return { content, contentSha256: row.content_sha256, filename: row.filename,
      cloudStudentId: row.student_id, reportType: row.report_type, originDeviceId: row.origin_device_id };
  }
  function deleteReport(token, revisionId) {
    if (!isAdmin(token)) fail(401, '管理员凭据无效');
    const row = db.prepare('SELECT student_id FROM reports WHERE id=?').get(revisionId);
    if (!row) fail(404, '报告不存在');
    atomic(() => {
      const result = db.prepare('INSERT OR IGNORE INTO report_tombstones VALUES(?,?,?,?)').run(revisionId, row.student_id, now(), 'admin_local');
      if (result.changes) audit('admin_local', 'report.withdraw', row.student_id, revisionId);
    });
    return { revisionId, deleted: true };
  }
  function uploadDocument(token, studentId, displayName, contentType, content) {
    const admin = isAdmin(token);
    const source = admin ? { id: 'admin_local' } : requireDevice(token, 'source');
    if (admin) { if (!studentExists(studentId)) fail(404, '学生不存在'); }
    else requireGrant(source.id, studentId, 'report.write');
    const name = String(displayName || '').trim();
    if (!name || name.length > 120 || /[\\/\x00-\x1f]/.test(name)) fail(400, '文件名无效');
    const suffix = DOCUMENT_TYPES.get(contentType);
    if (!suffix || !name.toLowerCase().endsWith(suffix)) fail(400, '仅支持 Markdown、PDF、DOCX');
    if (!Buffer.isBuffer(content) || !content.length || content.length > MAX_DOCUMENT_BYTES) fail(413, '文件大小无效');
    if (suffix === '.pdf' && !content.subarray(0, 5).equals(Buffer.from('%PDF-'))) fail(400, 'PDF 内容与类型不符');
    if (suffix === '.docx' && !content.subarray(0, 2).equals(Buffer.from('PK'))) fail(400, 'DOCX 内容与类型不符');
    requireStudentCapacity(studentId, content.length);
    const sha = digest(content);
    const objectName = `${sha}${suffix}`;
    const objectPath = path.join(objectDir, objectName);
    if (!fs.existsSync(objectPath)) {
      const tempPath = path.join(objectDir, `${objectName}.${crypto.randomUUID()}.tmp`);
      try {
        fs.writeFileSync(tempPath, content, { flag: 'wx' });
        fs.renameSync(tempPath, objectPath);
      } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
    }
    const documentId = `doc_${crypto.randomUUID().replaceAll('-', '')}`;
    atomic(() => {
      db.prepare(`INSERT INTO documents(id,student_id,origin_device_id,display_name,content_type,content_sha256,byte_size,object_name,created_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(documentId, studentId, source.id, name, contentType, sha, content.length, objectName, now());
      audit(admin ? 'admin_local' : source.id, 'document.upload', studentId, documentId);
    });
    return { documentId, contentSha256: sha, byteSize: content.length };
  }
  function prepareDocument(token, studentId, displayName, contentType) {
    const admin = isAdmin(token);
    const source = admin ? { id: 'admin_local' } : requireDevice(token, 'source');
    if (admin) { if (!studentExists(studentId)) fail(404, '学生不存在'); }
    else requireGrant(source.id, studentId, 'report.write');
    const name = String(displayName || '').trim();
    const suffix = DOCUMENT_TYPES.get(contentType);
    if (!name || name.length > 120 || /[\\/\x00-\x1f]/.test(name) || !suffix || !name.toLowerCase().endsWith(suffix)) fail(400, '文档名称或类型无效');
    requireStudentCapacity(studentId, 1);
    const tempPath = path.join(objectDir, `upload-${crypto.randomUUID()}.tmp`);
    return { tempPath, commit({ sha, size, head }) {
      // Recheck authorization and quota after the async transfer, before publishing the index.
      if (admin ? !isAdmin(token) : !deviceFor(token)) fail(401, '上传凭据已失效');
      if (!admin) requireGrant(source.id, studentId, 'report.write');
      if (size < 1 || size > MAX_DOCUMENT_BYTES || !/^[a-f0-9]{64}$/.test(sha)) fail(413, '文件大小无效');
      if (suffix === '.pdf' && !head.subarray(0, 5).equals(Buffer.from('%PDF-'))) fail(400, 'PDF 内容与类型不符');
      if (suffix === '.docx' && !head.subarray(0, 2).equals(Buffer.from('PK'))) fail(400, 'DOCX 内容与类型不符');
      const documentId = `doc_${crypto.randomUUID().replaceAll('-', '')}`;
      const objectName = `${sha}${suffix}`;
      atomic(() => {
        requireStudentCapacity(studentId, size);
        const target = path.join(objectDir, objectName);
        if (!fs.existsSync(target)) fs.renameSync(tempPath, target);
        db.prepare(`INSERT INTO documents(id,student_id,origin_device_id,display_name,content_type,content_sha256,byte_size,object_name,created_at)
          VALUES(?,?,?,?,?,?,?,?,?)`).run(documentId, studentId, source.id, name, contentType, sha, size, objectName, now());
        audit(source.id, 'document.upload', studentId, documentId);
      });
      return { documentId, contentSha256: sha, byteSize: size };
    } };
  }
  function listDocuments(token, studentId, includeTrash = false, cursor = '') {
    const admin = isAdmin(token);
    const viewer = admin ? null : requireDevice(token);
    if (!admin && !hasGrant(viewer.id, studentId, 'cloud_document.read') && !hasGrant(viewer.id, studentId, 'report.write')) {
      fail(403, '该设备没有此学生的许可');
    }
    if (includeTrash && !admin && !hasGrant(viewer.id, studentId, 'report.write')) fail(403, '只有来源设备可查看回收站');
    if (cursor && !/^\d+:doc_[a-f0-9]{32}$/.test(cursor)) fail(400, '文档游标无效');
    const [before, beforeId] = cursor ? cursor.split(':') : [Number.MAX_SAFE_INTEGER, 'z'];
    return db.prepare(`SELECT id AS documentId, display_name AS displayName, content_type AS contentType,
      content_sha256 AS contentSha256, byte_size AS byteSize, origin_device_id AS originDeviceId,
      created_at AS createdAt, deleted_at AS deletedAt
      FROM documents WHERE student_id=? AND ${includeTrash ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL'}
      AND (created_at<? OR (created_at=? AND id<?))
      ORDER BY created_at DESC,id DESC LIMIT 101`).all(studentId, Number(before), Number(before), beforeId);
  }
  function documentRow(documentId) {
    const row = db.prepare('SELECT * FROM documents WHERE id=?').get(documentId);
    if (!row) fail(404, '文档不存在');
    return row;
  }
  function getDocument(token, documentId) {
    const admin = isAdmin(token);
    const viewer = admin ? null : requireDevice(token);
    const row = documentRow(documentId);
    if (row.deleted_at !== null) fail(404, '文档已移入回收站');
    if (!admin && !hasGrant(viewer.id, row.student_id, 'cloud_document.read') && !hasGrant(viewer.id, row.student_id, 'report.write')) {
      fail(403, '该设备没有此学生的许可');
    }
    const content = fs.readFileSync(path.join(objectDir, row.object_name));
    if (!safeEqual(digest(content), row.content_sha256)) fail(500, '文档对象校验失败');
    audit(admin ? 'admin_local' : viewer.id, 'document.download', row.student_id, documentId);
    return { content, contentSha256: row.content_sha256, contentType: row.content_type,
      displayName: row.display_name, cloudStudentId: row.student_id };
  }
  function updateDocument(token, documentId, { displayName, deleted }) {
    const admin = isAdmin(token);
    const source = admin ? null : requireDevice(token, 'source');
    const row = documentRow(documentId);
    if (!admin) requireGrant(source.id, row.student_id, 'report.write');
    const name = displayName === undefined ? undefined : String(displayName).trim();
    if (name !== undefined && (!name || name.length > 120 || /[\\/\x00-\x1f]/.test(name))) fail(400, '文件名无效');
    if (deleted !== undefined && typeof deleted !== 'boolean') fail(400, '删除状态无效');
    atomic(() => {
      if (name !== undefined) {
        db.prepare('UPDATE documents SET display_name=? WHERE id=?').run(name, documentId);
        audit(admin ? 'admin_local' : source.id, 'document.rename', row.student_id, documentId);
      }
      if (deleted !== undefined) {
        db.prepare('UPDATE documents SET deleted_at=? WHERE id=?').run(deleted ? now() : null, documentId);
        audit(admin ? 'admin_local' : source.id, deleted ? 'document.trash' : 'document.restore', row.student_id, documentId);
      }
    });
    return { documentId, displayName: displayName === undefined ? row.display_name : String(displayName).trim(), deleted: deleted === undefined ? row.deleted_at !== null : deleted };
  }
  return { db, close: () => db.close(), loginAdmin, logoutAdmin, rotateAdmin, rotateDevice, revokeDevice, recordDenied, verifyBody, verifyBodyHash, prepareDocument, deleteReport, listAudit, studentStorage, verifyViewerProof, createStudent, registerSource, allowWrite, createPairing,
    createSourceEnrollment, redeemSourceEnrollment, approvePairing, revoke, listGrants, setOwnWrite, listStudents, uploadReport, checkSourceReports, listReports, getReport,
    uploadDocument, listDocuments, getDocument, updateDocument };
}

module.exports = { createService, digest, MAX_REPORT_BYTES, MAX_DOCUMENT_BYTES, CODE_LIFETIME_MS, ADMIN_SESSION_LIFETIME_MS, DEFAULT_MAX_STUDENT_BYTES };
