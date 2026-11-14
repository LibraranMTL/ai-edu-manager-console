'use strict';

// Synthetic, loopback-only course host for the packaged Windows student-terminal
// candidate. It contains no real student identity, device credential, or course data.

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const options = Object.fromEntries(process.argv.slice(2).map((value) => {
  const [key, ...rest] = value.replace(/^--/, '').split('=');
  return [key, rest.join('=') || true];
}));
const port = Number(options.port || 18888);
const profile = options.profile ? path.resolve(String(options.profile)) : '';
const hostId = 'qa-host-public-course-r1';
const studentId = 'qa-student-public-course-r1';
const generatedAt = new Date().toISOString();
const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const offlineOpenOffsetSeconds = Number(options['offline-open-offset-seconds'] ?? 15 * 60);
if (!Number.isFinite(offlineOpenOffsetSeconds) || Math.abs(offlineOpenOffsetSeconds) > 24 * 60 * 60) {
  throw new Error('offline-open-offset-seconds must be a finite value within one day.');
}
const offlineOpenUntil = new Date(Date.now() + offlineOpenOffsetSeconds * 1000).toISOString();
const course = {
  courseId: 'platform:qa-window-student-course',
  name: 'Windows Student Course Fixture',
  summary: 'Synthetic candidate-only course fixture for isolated browser verification.',
  provider: 'AI Education Manager QA',
  url: 'https://example.com/',
  allowedHosts: ['example.com'],
  coverUrl: '/cover.png',
  accountRequirement: 'No account required for this fixture.',
  legalNotice: 'Candidate-only synthetic acceptance fixture.',
  offlineOpenUntil,
};
const projection = {
  schemaVersion: 2,
  hostId,
  studentId,
  publisherKeyId: 'course-catalog-candidate-20261106',
  trustPolicyRevision: 'course-trust-transition-2026-11-06-v1',
  policyRevision: 'qa-policy-r1',
  manifestRevision: 'manifest-rev-qa-windows-student-r1',
  projectionRevision: 'qa-projection-rev-windows-student-r1',
  generatedAt,
  expiresAt,
  cloudFreshUntil: expiresAt,
  courses: [course],
  tombstones: [],
  disclaimer: 'Synthetic candidate-only course fixture. Opening it does not represent learning completion.',
};
const student = { id: studentId, name: 'QA Student', grade: 'QA' };
const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Jm8kAAAAASUVORK5CYII=', 'base64');

if (profile) {
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, 'terminal-config.json'), `${JSON.stringify({
    version: 1,
    hostUrl: `http://127.0.0.1:${port}`,
    token: 'synthetic-device-token-not-a-secret',
    sessionToken: 'synthetic-student-session-not-a-secret',
    terminalMode: 'personal',
    currentStudent: student,
    hostScope: { hostId, dataGeneration: 'qa-generation-r1', observedAt: generatedAt },
    observedHostScope: { hostId, dataGeneration: 'qa-generation-r1', observedAt: generatedAt },
    deviceId: 'qa-windows-student-device-r1',
    deviceName: 'Windows Student Candidate QA',
    autoDelivery: { enabled: false, folder: '' },
    agentCapture: { enabled: false },
    updatedAt: generatedAt,
  }, null, 2)}\n`, 'utf8');
}

function json(response, status, body, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  response.end(JSON.stringify(body));
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url || '/', `http://127.0.0.1:${port}`);
  if (url.pathname === '/api/health') return json(response, 200, { ok: true, hostId, dataGeneration: 'qa-generation-r1', version: '0.23.4-qa-fixture' });
  if (url.pathname === '/api/device/mode') return json(response, 200, { device: { terminalMode: 'personal', boundStudentId: studentId } });
  if (url.pathname === '/api/student-session/me') return json(response, 200, { student, students: [student], projects: [] });
  if (url.pathname === '/api/student-session/capabilities') return json(response, 200, { ok: true, capabilities: {} });
  if (url.pathname === `/api/v2/students/${studentId}/courses`) {
    if (request.headers['if-none-match'] === '"qa-projection-rev-windows-student-r1"') {
      response.writeHead(304, { etag: '"qa-projection-rev-windows-student-r1"', 'cache-control': 'no-store' });
      return response.end();
    }
    return json(response, 200, projection, { etag: '"qa-projection-rev-windows-student-r1"' });
  }
  if (url.pathname === '/api/student-session/course-start') return json(response, 404, { ok: false, message: 'Synthetic fixture does not persist course starts.' });
  if (url.pathname === '/cover.png') {
    response.writeHead(200, { 'content-type': 'image/png', 'content-length': tinyPng.length, 'cache-control': 'no-store' });
    return response.end(tinyPng);
  }
  return json(response, 404, { ok: false, message: 'Synthetic fixture route not implemented.' });
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`${JSON.stringify({ ok: true, port, hostId, studentId, profile, offlineOpenUntil, offlineOpenOffsetSeconds })}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
