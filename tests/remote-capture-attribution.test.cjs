const assert = require('node:assert/strict');
const test = require('node:test');
const { remoteCaptureAttribution, reportedCaptureTime } = require('../electron/remote-capture-attribution.cjs');

test('remote capture accepts only explicit timezone-bearing device timestamps', () => {
  assert.deepEqual(reportedCaptureTime(''), { capturedAt: '', raw: '', status: 'missing' });
  assert.equal(reportedCaptureTime('2026-09-10 03:04:00').status, 'timezone_unspecified');
  assert.equal(reportedCaptureTime('not-a-date').status, 'invalid');
  assert.deepEqual(reportedCaptureTime('2026-09-10T11:04:00+08:00'), {
    capturedAt: '2026-09-10T03:04:00.000Z', raw: '2026-09-10T11:04:00+08:00', status: 'device_reported',
  });
});

test('remote capture preserves invalid source time and uses trusted paired device identity', () => {
  const url = new URL('http://localhost/upload?captureSessionId=session-1&capturedAt=bad-time&capturePlatform=windows-student-terminal&deviceId=forged');
  const capture = remoteCaptureAttribution(url, { id: 'student-1', name: '学生' }, { id: 'project-1' }, 'paired-device-1');
  assert.equal(capture.capturedAt, '', '不得把主机当前时间伪装为设备采集时间');
  assert.equal(capture.reportedCapturedAtRaw, 'bad-time');
  assert.equal(capture.captureTimeStatus, 'invalid');
  assert.equal(capture.session.deviceId, 'paired-device-1');
  assert.equal(capture.session.studentId, 'student-1');
  assert.equal(capture.session.projectId, 'project-1');
  assert.equal(remoteCaptureAttribution(new URL('http://localhost/upload'), { id: 'student-1' }), null);
});
