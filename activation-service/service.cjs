'use strict';
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PRODUCTS, codeHash, digest, verifyRequest } = require('../shared/activation-code.cjs');
const { capabilitiesFor } = require('../electron/license-entitlements.cjs');
function fail(code, message, status = 400) { throw Object.assign(new Error(message), { code, status }); }
function createService(options) {
  const now = options.now || Date.now;
  const privateKey = crypto.createPrivateKey(options.privateKey);
  if (privateKey.asymmetricKeyType !== 'rsa' || privateKey.asymmetricKeyDetails.modulusLength < 3072) throw new Error('线上签发须使用独立 RSA 3072 或更强密钥');
  if (!/^[a-z0-9_-]{3,80}$/.test(options.keyId || '')) throw new Error('签发 keyId 无效');
  fs.mkdirSync(options.dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(options.dataDir, 'activations.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY, payload TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'active', created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS codes(hash TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES batches(id), state TEXT NOT NULL DEFAULT 'available');
    CREATE TABLE IF NOT EXISTS activations(hash TEXT PRIMARY KEY REFERENCES codes(hash), operation_id TEXT UNIQUE NOT NULL, product TEXT NOT NULL, device TEXT NOT NULL, public_key TEXT NOT NULL, license TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS nonces(id TEXT PRIMARY KEY, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, at INTEGER NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS credentials(id INTEGER PRIMARY KEY CHECK(id=1), salt TEXT NOT NULL, hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS control(id INTEGER PRIMARY KEY CHECK(id=1), frozen INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS metrics(minute INTEGER NOT NULL,status INTEGER NOT NULL,requests INTEGER NOT NULL,duration INTEGER NOT NULL,max_ms INTEGER NOT NULL,PRIMARY KEY(minute,status));
    INSERT OR IGNORE INTO control(id) VALUES(1);`);
  const audit = (action, target) => db.prepare('INSERT INTO audit(at,action,target) VALUES(?,?,?)').run(now(), action, target);
  if (!db.prepare('SELECT id FROM credentials').get()) {
    if (String(options.adminPassword || '').length < 20) throw new Error('首次初始化需要至少20字符管理员密码');
    const salt = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO credentials VALUES(1,?,?)').run(salt, crypto.scryptSync(options.adminPassword, salt, 64).toString('hex'));
  }
  function transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } }
  function login(password) {
    const stored = db.prepare('SELECT * FROM credentials WHERE id=1').get();
    if (!crypto.timingSafeEqual(crypto.scryptSync(String(password || ''), stored.salt, 64), Buffer.from(stored.hash, 'hex'))) fail('UNAUTHORIZED', '管理员登录失败', 401);
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM sessions WHERE expires<?').run(now());
    db.prepare('INSERT INTO sessions VALUES(?,?)').run(digest(token), now() + 1800000);
    audit('admin_login', 'admin'); return { ok: true, token, expiresIn: 1800 };
  }
  function authorize(token) { if (!db.prepare('SELECT hash FROM sessions WHERE hash=? AND expires>?').get(digest(String(token || '')), now())) fail('UNAUTHORIZED', '请重新登录授权管理服务', 401); }
  function register(input) {
    const id = String(input.id || ''); const hashes = input.hashes;
    if (!/^[\w-]{8,128}$/.test(id) || !PRODUCTS.includes(input.productId) || !['TRIAL','FAMILY','PRO','ORG'].includes(input.edition) ||
        !Number.isInteger(input.students) || input.students < 1 || input.students > 9999 || !Number.isInteger(input.durationDays) || input.durationDays < 1 || input.durationDays > 3650 ||
        (input.terminalDevices !== undefined && (!Number.isInteger(input.terminalDevices) || input.terminalDevices < 1 || input.terminalDevices > 9999 || (input.productId === 'ANDROID_STANDALONE' && input.terminalDevices !== 1))) ||
        !Number.isFinite(Date.parse(input.redeemBefore)) || Date.parse(input.redeemBefore) <= now() ||
        !Array.isArray(hashes) || hashes.length < 1 || hashes.length > 1000 || new Set(hashes).size !== hashes.length || hashes.some(h => !/^[a-f0-9]{64}$/.test(h))) fail('INVALID_BATCH', '批次、套餐、日期或码摘要无效');
    const payload = JSON.stringify({ productId: input.productId, edition: input.edition, students: input.students, durationDays: input.durationDays,
      ...(input.terminalDevices !== undefined ? {terminalDevices:input.terminalDevices} : {}),
      redeemBefore: new Date(input.redeemBefore).toISOString(), orderNo: String(input.orderNo || '').slice(0, 120), customer: String(input.customer || '').slice(0, 120), hashes: [...hashes].sort() });
    return transaction(() => {
      const previous = db.prepare('SELECT payload FROM batches WHERE id=?').get(id);
      if (previous) { if (previous.payload !== payload) fail('BATCH_CONFLICT', '同一批次不能更改权益或码清单', 409); return { ok: true, id, existing: true }; }
      if (hashes.some(h => db.prepare('SELECT hash FROM codes WHERE hash=?').get(h))) fail('CODE_CONFLICT', '兑换码已在其他批次登记', 409);
      db.prepare('INSERT INTO batches(id,payload,created) VALUES(?,?,?)').run(id, payload, now());
      const insert = db.prepare('INSERT INTO codes(hash,batch_id) VALUES(?,?)'); hashes.forEach(h => insert.run(h, id)); audit('batch_registered', id);
      return { ok: true, id, count: hashes.length };
    });
  }
  function batchAction(id, action) {
    if (!['pause','resume','void'].includes(action)) fail('INVALID_ACTION', '操作不受支持');
    return transaction(() => {
      if (!db.prepare('SELECT id FROM batches WHERE id=?').get(id)) fail('NOT_FOUND', '批次不存在', 404);
      if (action === 'void') db.prepare("UPDATE codes SET state='void' WHERE batch_id=? AND state='available'").run(id);
      else db.prepare('UPDATE batches SET state=? WHERE id=?').run(action === 'pause' ? 'paused' : 'active', id);
      audit(`batch_${action}`, id); return { ok: true };
    });
  }
  function exchange(route, input) {
    if (!verifyRequest(route, input, now())) fail('INVALID_PROOF', '设备证明无效或系统时间偏差超过5分钟', 403);
    if (route.endsWith('/redeem') && codeHash(input.code) !== input.codeHash) fail('INVALID_CODE', '激活码摘要不一致');
    return transaction(() => {
      db.prepare('DELETE FROM nonces WHERE expires<?').run(now());
      if (db.prepare('SELECT id FROM nonces WHERE id=?').get(input.nonce)) fail('REPLAY', '请求已经处理，请重新核验', 409);
      db.prepare('INSERT INTO nonces VALUES(?,?)').run(input.nonce, now() + 600000);
      const old = db.prepare('SELECT * FROM activations WHERE hash=?').get(input.codeHash);
      if (old) {
        if (old.product !== input.productId) fail('PRODUCT_MISMATCH', '此激活码不属于当前产品', 409);
        if (old.device !== input.deviceId || old.public_key !== input.publicKey) fail('DEVICE_BOUND', '此码已绑定其他设备或设备凭据已变化，请联系售后', 409);
        audit('license_recovered', old.operation_id); return { ok: true, licenseToken: old.license, operationId: old.operation_id, recovered: true };
      }
      if (route.endsWith('/recover')) fail('NOT_COMMITTED', '未找到已提交结果，可使用原激活码继续激活', 404);
      if (db.prepare('SELECT frozen FROM control WHERE id=1').get().frozen) fail('SERVICE_FROZEN', '服务恢复核对中，请稍后重试', 503);
      const row = db.prepare('SELECT c.state,b.state AS batch_state,b.payload FROM codes c JOIN batches b ON b.id=c.batch_id WHERE c.hash=?').get(input.codeHash);
      if (!row) fail('INVALID_CODE', '激活码不存在或尚未登记', 404);
      const batch = JSON.parse(row.payload);
      if (batch.productId !== input.productId) fail('PRODUCT_MISMATCH', '此激活码不属于当前产品', 409);
      if (row.state === 'void') fail('CODE_VOID', '激活码已作废', 409);
      if (row.batch_state !== 'active') fail('BATCH_PAUSED', '此批次暂停兑换，请联系销售', 409);
      if (Date.parse(batch.redeemBefore) < now()) fail('CODE_EXPIRED', '激活码已超过兑换期限', 410);
      if (db.prepare('SELECT hash FROM activations WHERE operation_id=?').get(input.operationId)) fail('OPERATION_CONFLICT', '操作标识已用于另一项激活', 409);
      const payload = { schema: 'edu-manager.license.v3', licenseId: crypto.randomUUID(), productId: input.productId, edition: batch.edition,
        capabilities: capabilitiesFor(batch.edition), maxActiveStudents: batch.students, maxDevices: batch.terminalDevices || 1, devicePolicy: 'required_binding', deviceId: input.deviceId,
        issuedAt: new Date(now()).toISOString(), expiresAt: new Date(now() + batch.durationDays * 86400000).toISOString(), issuer: 'activation-service', keyId: options.keyId };
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url'); const signed = `AIE3.${encoded}`;
      const token = `${signed}.${crypto.sign('RSA-SHA256', Buffer.from(signed), privateKey).toString('base64url')}`;
      db.prepare('INSERT INTO activations VALUES(?,?,?,?,?,?,?)').run(input.codeHash, input.operationId, input.productId, input.deviceId, input.publicKey, token, now());
      db.prepare("UPDATE codes SET state='redeemed' WHERE hash=?").run(input.codeHash); audit('license_issued', input.operationId);
      return { ok: true, licenseToken: token, operationId: input.operationId, recovered: false };
    });
  }
  function list(kind, offset = 0) {
    offset = Math.max(0, Math.min(10000000, Number.parseInt(offset,10) || 0));
    if (kind === 'batches') return { ok: true, rows: db.prepare(`SELECT b.id,b.state,b.created,b.payload,COUNT(c.hash) AS total,
      SUM(c.state='redeemed') AS redeemed,SUM(c.state='void') AS voided FROM batches b LEFT JOIN codes c ON c.batch_id=b.id GROUP BY b.id ORDER BY b.created DESC LIMIT 100 OFFSET ?`).all(offset).map(r => {
        const {hashes, ...summary} = JSON.parse(r.payload); const {payload, ...rest} = r; return {...rest, ...summary, expired: Date.parse(summary.redeemBefore) < now()};
      }) };
    return { ok: true, rows: db.prepare('SELECT operation_id,product,device,created FROM activations ORDER BY created DESC LIMIT 100 OFFSET ?').all(offset) };
  }
  function recordRequest(status, duration) {
    const minute=Math.floor(now()/60000);
    db.prepare('INSERT INTO metrics VALUES(?,?,1,?,?) ON CONFLICT(minute,status) DO UPDATE SET requests=requests+1,duration=duration+excluded.duration,max_ms=MAX(max_ms,excluded.max_ms)').run(minute,status,duration,duration);
    db.prepare('DELETE FROM metrics WHERE minute<?').run(minute-43200);
  }
  function status() {
    const recent=db.prepare('SELECT COALESCE(SUM(requests),0) requests,COALESCE(SUM(CASE WHEN status>=500 THEN requests ELSE 0 END),0) errors,COALESCE(MAX(max_ms),0) maxLatencyMs FROM metrics WHERE minute>=?').get(Math.floor(now()/60000)-15);
    let backup={};let offsite={};try{backup=JSON.parse(fs.readFileSync(path.join(options.dataDir,'backup-status.json'),'utf8'));}catch{}
    try{offsite=JSON.parse(fs.readFileSync(path.join(options.dataDir,'offsite-status.json'),'utf8'));}catch{}
    const disk=fs.statfsSync(options.dataDir);const freeBytes=Number(disk.bavail)*Number(disk.bsize);
    const frozen=Boolean(db.prepare('SELECT frozen FROM control WHERE id=1').get().frozen);
    const alerts=[];if(frozen)alerts.push('兑换已冻结');if(freeBytes<512*1024*1024)alerts.push('可用空间不足512MiB');
    if(!backup.created || now()-Date.parse(backup.created)>36*3600000)alerts.push('加密备份超过36小时未成功');
    if(!offsite.receivedAt || now()-Date.parse(offsite.receivedAt)>36*3600000)alerts.push('异地备份超过36小时未确认');
    if(recent.errors>=5&&recent.errors/Math.max(1,recent.requests)>0.1)alerts.push('15分钟服务错误率超过10%');
    if(recent.maxLatencyMs>5000)alerts.push('15分钟内存在超过5秒的请求');
    return {ok:true,frozen,freeBytes,recent,backupAt:backup.created || null,offsiteAt:offsite.receivedAt || null,alerts};
  }
  return { login, authorize, register, batchAction, exchange, list, recordRequest, status, db, close: () => db.close() };
}
module.exports = { createService };
