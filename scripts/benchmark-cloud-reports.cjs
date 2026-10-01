'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { createHttpServer } = require('../cloud-report-service/http.cjs');
const { REPORTS, snapshotPublishedReports, uploadPublishedReports } = require('../electron/cloud-report-sync.cjs');
const { sourceProof } = require('../electron/cloud-device-proof.cjs');
const percentile = (samples, p) => [...samples].sort((a, b) => a - b)[Math.min(samples.length - 1, Math.floor(samples.length * p))];
async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-benchmark-'));
  const admin = crypto.randomBytes(32).toString('base64url');
  const app = createHttpServer({ dataDir: path.join(root, 'service'), adminToken: admin });
  const session = app.service.loginAdmin(admin).sessionToken;
  const student = app.service.createStudent(session, '合成性能样本');
  const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1', publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const source = app.service.registerSource(session, keys.publicKey);
  app.service.allowWrite(session, source.deviceId, student.id);
  const reportDir = path.join(root, 'reports'); fs.mkdirSync(reportDir);
  const write = iteration => REPORTS.forEach(item => fs.writeFileSync(path.join(reportDir, item.filename),
    `---\ntype: ${item.type}\nstatus: active\nupdated: 2026-09-26\nstudent_id: synthetic-student\n---\n# 合成报告\n\n${'合成学习证据，用于本机性能回归。'.repeat(600)}\n${iteration}\n`));
  write(0);
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const options = { serverUrl: base, deviceToken: source.deviceToken, reportDir, localStudentId: 'synthetic-student', cloudStudentId: student.id,
    proof: (method, route, body) => sourceProof(source.deviceId, keys.privateKey, method, route, body) };
  const loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable();
  const baseline = [], uploads = [], noChanges = [], lists = [];
  const memoryBefore = process.memoryUsage().rss;
  try {
    let hashes = {};
    for (let i = 0; i < 30; i++) {
      let start = performance.now(); await snapshotPublishedReports(options); baseline.push(performance.now() - start);
      write(i + 1); start = performance.now();
      hashes = (await uploadPublishedReports({ ...options, knownHashes: hashes })).hashes; uploads.push(performance.now() - start);
      start = performance.now();
      const unchanged = await uploadPublishedReports({ ...options, knownHashes: hashes });
      if (unchanged.uploaded.length) throw new Error('未变化报告仍发送上传');
      noChanges.push(performance.now() - start);
      start = performance.now();
      const response = await fetch(`${base}/v1/students/${student.id}/reports`, { headers: { authorization: `Bearer ${session}` } });
      if (!response.ok) throw new Error('报告列表失败'); await response.json(); lists.push(performance.now() - start);
    }
    const metrics = { samples: 30, snapshotP95Ms: percentile(baseline, .95), uploadFourReportsP95Ms: percentile(uploads, .95),
      unchangedCheckP95Ms: percentile(noChanges, .95), listP95Ms: percentile(lists, .95), eventLoopP95Ms: loop.percentile(95) / 1e6,
      rssDeltaMiB: (process.memoryUsage().rss - memoryBefore) / 1024 / 1024, unchangedUploads: 0 };
    const passed = metrics.uploadFourReportsP95Ms < 500 && metrics.listP95Ms < 150 && metrics.unchangedCheckP95Ms < 100 && metrics.rssDeltaMiB < 128;
    const result = { schema: 'edu-manager.cloud-benchmark.v1', createdAt: new Date().toISOString(), node: process.version,
      platform: process.platform, cpus: os.cpus().length, data: 'synthetic only, four ~30KB reports per update',
      scope: 'Local cloud subsystem only; not Android SAF/device power or full host cold-start acceptance', metrics,
      thresholds: { uploadFourReportsP95Ms: 500, listP95Ms: 150, unchangedCheckP95Ms: 100, rssDeltaMiB: 128 }, passed };
    const output = process.argv[2];
    if (output) { fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true }); fs.writeFileSync(output, JSON.stringify(result, null, 2)); }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (!passed) process.exitCode = 1;
  } finally { loop.disable(); await app.close(); fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
