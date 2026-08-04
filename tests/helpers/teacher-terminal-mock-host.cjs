const http = require('node:http');

const port = Number(process.env.TEACHER_MOCK_PORT || 18888);
const token = 'teacher-test-token';
const uploads = [];
const requests = [];

const students = [
  {
    id: 'stu-001',
    name: '张晨',
    grade: '七年级',
    rawFileCount: 2,
    archiveFileCount: 3,
    pendingDigestCount: 1,
    processedDigestCount: 4,
    progress: { submittedTodayCount: 1, recentUploadCount7: 5, activeDays30: 8, knowledgeAssetCount: 4 },
  },
  {
    id: 'stu-002',
    name: '李玥',
    grade: '八年级',
    rawFileCount: 1,
    archiveFileCount: 2,
    processedDigestCount: 2,
    progress: { submittedTodayCount: 0, recentUploadCount7: 2, activeDays30: 4, knowledgeAssetCount: 2 },
  },
  {
    id: 'stu-003',
    name: '王知行',
    grade: '九年级',
    rawFileCount: 0,
    archiveFileCount: 1,
    processedDigestCount: 1,
    progress: { submittedTodayCount: 0, recentUploadCount7: 1, activeDays30: 2, knowledgeAssetCount: 1 },
  },
];

const projects = [
  { id: 'project-alpha', name: '城市生态调查', status: 'active', studentIds: ['stu-001', 'stu-002'] },
  { id: 'project-beta', name: '历史口述档案', status: 'active', studentIds: ['stu-003'] },
];

function json(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
  });
  response.end(body);
}

function authorized(request) {
  return request.headers.authorization === `Bearer ${token}`;
}

function collect(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || `127.0.0.1:${port}`}`);
  requests.push({ method: request.method, path: url.pathname, query: url.search });
  if (request.method === 'GET' && url.pathname === '/api/health') {
    json(response, 200, { ok: true, version: 'teacher-mock-1', license: { status: 'active', planLabel: '教师端验收' } });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/__test/state') {
    json(response, 200, { ok: true, uploads, requests });
    return;
  }
  if (!authorized(request)) {
    json(response, 401, { ok: false, message: 'test token required' });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/device/heartbeat') {
    json(response, 200, {
      ok: true,
      device: {
        id: 'teacher-emulator',
        name: '教师端验收模拟器',
        deviceRole: 'teacher',
        authorizationStatus: 'approved',
        terminalMode: 'personal',
      },
    });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/students') {
    json(response, 200, {
      ok: true,
      students,
      authorization: {
        type: 'device',
        deviceId: 'teacher-emulator',
        deviceName: '教师端验收模拟器',
        deviceRole: 'teacher',
        terminalMode: 'personal',
        requiresApproval: false,
        allowedStudentCount: students.length,
      },
    });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/projects') {
    json(response, 200, { ok: true, projects });
    return;
  }
  const archiveFiles = url.pathname.match(/^\/api\/students\/([^/]+)\/archive\/files$/);
  if (request.method === 'GET' && archiveFiles) {
    const studentId = decodeURIComponent(archiveFiles[1]);
    json(response, 200, {
      ok: true,
      studentId,
      files: [
        { name: '教育档案总览', path: '教育档案总览.md' },
        { name: '学习观察', path: '学情报告/学习观察.md' },
      ],
    });
    return;
  }
  const archiveFile = url.pathname.match(/^\/api\/students\/([^/]+)\/archive\/file$/);
  if (request.method === 'GET' && archiveFile) {
    const studentId = decodeURIComponent(archiveFile[1]);
    const path = url.searchParams.get('path') || '教育档案总览.md';
    json(response, 200, { ok: true, studentId, path, content: `# ${studentId} 教育档案\n\n这是教师端运行验收档案。` });
    return;
  }
  const reports = url.pathname.match(/^\/api\/students\/([^/]+)\/reports$/);
  if (request.method === 'GET' && reports) {
    json(response, 200, {
      ok: true,
      reports: [
        { id: 'profile', title: '整体画像' },
        { id: 'daily', title: '每日行动建议' },
        { id: 'changes', title: '历史变化' },
        { id: 'stage', title: '阶段总结' },
      ],
    });
    return;
  }
  const report = url.pathname.match(/^\/api\/students\/([^/]+)\/reports\/([^/]+)$/);
  if (request.method === 'GET' && report) {
    const studentId = decodeURIComponent(report[1]);
    const reportId = decodeURIComponent(report[2]);
    json(response, 200, {
      ok: true,
      id: reportId,
      title: `${studentId} · ${reportId}`,
      fileName: `${reportId}.md`,
      content: `# ${studentId} 学情报告\n\n教师端运行验收报告。`,
    });
    return;
  }
  const growth = url.pathname.match(/^\/api\/students\/([^/]+)\/growth-summary$/);
  if (request.method === 'GET' && growth) {
    const studentId = decodeURIComponent(growth[1]);
    json(response, 200, {
      ok: true,
      studentId,
      summary: { evidenceCount: 2, confirmedCount: 1, watchingCount: 1, abilityCount: 1, projectCount: 1 },
      abilities: [{ name: '资料整理', maturityLabel: '正在形成', trendLabel: '持续增强', evidenceCount: 2 }],
      projects: [{ projectName: '城市生态调查', reviewStatusLabel: '积累中', confirmedEvidenceCount: 1, evidenceCount: 2 }],
      recentEvidence: [{ title: '资料归类', statusLabel: '已确认', ability: '资料整理' }],
    });
    return;
  }
  const projectArchiveFiles = url.pathname.match(/^\/api\/projects\/([^/]+)\/archive\/files$/);
  if (request.method === 'GET' && projectArchiveFiles) {
    json(response, 200, { ok: true, files: [{ name: '项目知识总览', path: '项目知识总览.md' }] });
    return;
  }
  const projectArchiveFile = url.pathname.match(/^\/api\/projects\/([^/]+)\/archive\/file$/);
  if (request.method === 'GET' && projectArchiveFile) {
    const projectId = decodeURIComponent(projectArchiveFile[1]);
    json(response, 200, { ok: true, content: `# ${projectId} 项目知识\n\n教师端运行验收项目知识。` });
    return;
  }
  const studentUpload = url.pathname.match(/^\/api\/students\/([^/]+)\/materials$/);
  const projectUpload = url.pathname.match(/^\/api\/projects\/([^/]+)\/materials$/);
  if (request.method === 'POST' && (studentUpload || projectUpload)) {
    const body = await collect(request);
    const targetType = studentUpload ? 'student' : 'project';
    const targetId = decodeURIComponent((studentUpload || projectUpload)[1]);
    uploads.push({
      targetType,
      targetId,
      studentId: url.searchParams.get('studentId') || (studentUpload ? targetId : ''),
      filename: url.searchParams.get('filename') || '',
      bytes: body.length,
    });
    json(response, 200, { ok: true, imported: 1, targetType, targetId, filename: url.searchParams.get('filename') || '' });
    return;
  }
  json(response, 404, { ok: false, message: `unhandled mock route: ${request.method} ${url.pathname}` });
});

server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`teacher mock host listening on ${port}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
