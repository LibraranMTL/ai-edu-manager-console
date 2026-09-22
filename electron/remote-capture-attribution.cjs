function reportedCaptureTime(value) {
  const raw = String(value || '').trim().slice(0, 80);
  if (!raw) return { capturedAt: '', raw, status: 'missing' };
  const milliseconds = Date.parse(raw);
  if (!Number.isFinite(milliseconds)) return { capturedAt: '', raw, status: 'invalid' };
  // Date.parse otherwise treats a timezone-less device value as host local time.
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) return { capturedAt: '', raw, status: 'timezone_unspecified' };
  return { capturedAt: new Date(milliseconds).toISOString(), raw, status: 'device_reported' };
}

function remoteCaptureAttribution(url, student, project = null, trustedDeviceId = '') {
  const captureSessionId = String(url?.searchParams?.get('captureSessionId') || '').trim().slice(0, 180);
  if (!captureSessionId) return null;
  const captureTime = reportedCaptureTime(url?.searchParams?.get('capturedAt'));
  const requestedPlatform = String(url?.searchParams?.get('capturePlatform') || '').trim();
  const captureClient = {
    'android-student-terminal': { platform: 'android-student-terminal', label: 'Android 学生端' },
    'android-teacher-terminal': { platform: 'android-teacher-terminal', label: 'Android 教师端' },
    'windows-student-terminal': { platform: 'windows-student-terminal', label: 'Windows 学生端' },
  }[requestedPlatform] || { platform: 'windows-student-terminal', label: 'Windows 学生端' };
  return {
    session: {
      id: captureSessionId,
      name: `${student?.name || '学生'} · ${captureClient.label}采集`,
      platform: captureClient.platform,
      deviceId: String(trustedDeviceId || '').trim().slice(0, 180),
      sourceType: 'screen',
      sourceName: `${captureClient.label}屏幕采集`,
      studentId: String(student?.id || ''),
      studentName: String(student?.name || ''),
      projectId: String(project?.id || ''),
      projectName: String(project?.name || ''),
      courseId: String(url?.searchParams?.get('courseId') || ''),
      courseUrl: String(url?.searchParams?.get('courseUrl') || ''),
    },
    captureItemId: String(url?.searchParams?.get('captureItemId') || '').trim().slice(0, 180),
    capturedAt: captureTime.capturedAt,
    reportedCapturedAtRaw: captureTime.raw,
    captureTimeStatus: captureTime.status,
    sequence: Math.max(0, Number(url?.searchParams?.get('captureSequence') || 0)),
    highlighted: url?.searchParams?.get('captureHighlighted') === '1',
  };
}

module.exports = { remoteCaptureAttribution, reportedCaptureTime };
