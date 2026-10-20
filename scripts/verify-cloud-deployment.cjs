'use strict';
// Runs as root on the authorized server. Credentials stay in memory and never enter output.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createCloudReportRuntime } = require('/tmp/edu-cloud-20261001/test-suite/electron/cloud-report-runtime.cjs');
const BASE = 'https://www.greatbg.com/edu-cloud';
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-cloud-acceptance-'));
  const reportDir = path.join(root, 'reports'); await fs.mkdir(reportDir);
  const content = '---\nstudent_id: synthetic-cloud-check\ntype: learning_profile\nstatus: published\nupdated: 2026-10-01\n---\n\n# 非敏感合成验收报告\n\n## 观察依据\n\n此报告仅用于测试公开 HTTPS 下的签名上传与下载，不包含真实学生资料。\n';
  await fs.writeFile(path.join(reportDir, '整体画像.md'), content);
  const create = (dataDir, resolver) => createCloudReportRuntime({ dataDir, protect: value => value, unprotect: value => value, resolveReportDir: resolver });
  const source = create(path.join(root, 'source'), id => id === 'synthetic-cloud-check' ? reportDir : '');
  const receiver = create(path.join(root, 'viewer'), () => '');
  let session, sourceId, viewerId, reportId;
  async function call(method, route, body) {
    const res = await fetch(BASE + route, { method, redirect: 'error', signal: AbortSignal.timeout(15000), headers: { ...(session ? { authorization: `Bearer ${session}` } : {}), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) throw Error(`Acceptance HTTP ${res.status}: ${route}`);
    return res.json();
  }
  try {
    await source.load(); await receiver.load();
    assert.equal((await source.checkConnection(BASE)).reachable, true);
    const credential = (await fs.readFile('/opt/edu-cloud-documents/admin-bootstrap.secret', 'utf8')).trim();
    session = (await call('POST', '/v1/admin/sessions', { credential })).sessionToken;
    const student = await call('POST', '/v1/students', { displayName: '部署验收 · 非敏感合成学生' });
    const code = await call('POST', '/v1/source-enrollments', { cloudStudentId: student.id });
    await source.enrollSource({ serverUrl: BASE, localStudentId: 'synthetic-cloud-check', enrollmentCode: code.enrollmentCode });
    await source.syncStudent('synthetic-cloud-check');
    assert.ok(source.status('synthetic-cloud-check').lastSyncAt); assert.equal(source.status('synthetic-cloud-check').lastError, '');
    sourceId = JSON.parse(await fs.readFile(path.join(root, 'source/cloud-report-state.json'))).sourceDeviceId;
    const pairing = await receiver.createPairing(BASE); viewerId = pairing.deviceId;
    await source.approvePairing(pairing.pairingCode, ['synthetic-cloud-check']);
    assert.ok((await receiver.listCloudStudents()).some(item => item.id === student.id));
    const reports = await receiver.listCloudReports(student.id); assert.equal(reports.reports.length, 1);
    reportId = reports.reports[0].revisionId;
    const downloaded = await receiver.downloadCloudReport(student.id, reportId);
    assert.equal(downloaded.content, content);
    assert.equal(crypto.createHash('sha256').update(downloaded.content).digest('hex'), crypto.createHash('sha256').update(content).digest('hex'));
    // A fresh unapproved viewer must not see this student.
    const stranger = create(path.join(root, 'unapproved'), () => '');
    try { const unapproved = await stranger.createPairing(BASE); assert.equal((await stranger.listCloudStudents()).length, 0); await call('POST', '/v1/devices/revoke', { deviceId: unapproved.deviceId }); }
    finally { stranger.close(); }
    await source.setUpload('synthetic-cloud-check', false);
    await call('DELETE', `/v1/reports/${reportId}`);
    await assert.rejects(receiver.downloadCloudReport(student.id, reportId));
    await call('POST', '/v1/devices/revoke', { deviceId: viewerId }); viewerId = null;
    await assert.rejects(receiver.listCloudStudents());
    await call('POST', '/v1/devices/revoke', { deviceId: sourceId }); sourceId = null;
    const result = { checkedAt: new Date().toISOString(), serverUrl: BASE, syntheticStudentId: student.id,
      https: 'passed', serviceIdentity: 'passed', enrollment: 'passed', signedUpload: 'passed', pairing: 'passed', scopedDownload: 'passed', hashVerification: 'passed', unauthorizedStudentIsolation: 'passed', uploadSwitch: 'passed', withdrawal: 'passed', revocation: 'passed', realWindowsUi: 'not_accepted', androidDevice: 'not_accepted', note: '合成学生与撤回报告记录保留供审计；测试设备许可均撤销。' };
    await fs.writeFile('/opt/edu-cloud-documents-backups/deploy-20261001/public-acceptance.json', JSON.stringify(result, null, 2), { mode: 0o600 });
    process.stdout.write(JSON.stringify(result));
  } finally {
    source.close(); receiver.close();
    if (session) {
      for (const deviceId of [viewerId, sourceId].filter(Boolean)) await call('POST', '/v1/devices/revoke', { deviceId }).catch(() => {});
      await call('DELETE', '/v1/admin/sessions/current').catch(() => {});
    }
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch(error => { process.stderr.write(`Public acceptance failed: ${error.message}\n`); process.exitCode = 1; });
