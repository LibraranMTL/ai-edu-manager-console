const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SCHEMA = 'edu-manager.student-portable-package.v1';
const SESSION_TTL_MS = 30 * 60 * 1000;

function safeId(value) {
  const normalized = String(value || '').trim();
  if (!/^[a-zA-Z0-9._-]{1,160}$/.test(normalized)) throw new Error('迁移对象 ID 不合法。');
  return normalized;
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function copyTree(source, destination) {
  const sourceRoot = path.resolve(source);
  const stat = await fs.promises.stat(sourceRoot);
  if (!stat.isDirectory()) throw new Error(`迁移目录不存在：${source}`);
  await fs.promises.mkdir(destination, { recursive: true });
  const entries = await fs.promises.readdir(sourceRoot, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceRoot, entry.name);
    const targetPath = path.join(destination, entry.name);
    if (!isInside(sourceRoot, sourcePath)) throw new Error('检测到越界路径。');
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) await copyTree(sourcePath, targetPath);
    else if (entry.isFile()) await fs.promises.copyFile(sourcePath, targetPath);
  }
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function manifestFiles(root, relative = '') {
  const output = [];
  const entries = await fs.promises.readdir(path.join(root, relative), { withFileTypes: true });
  for (const entry of entries) {
    const next = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) output.push(...await manifestFiles(root, next));
    else if (entry.isFile()) {
      const absolute = path.join(root, ...next.split('/'));
      const stat = await fs.promises.stat(absolute);
      output.push({ path: next, bytes: stat.size, sha256: await sha256File(absolute) });
    }
  }
  return output;
}

function runTar(stagingDir, outputPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('tar.exe', ['-a', '-c', '-f', outputPath, '-C', stagingDir, '.'], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `tar.exe 退出码 ${code}`)));
  });
}

function publicSession(session) {
  return {
    ok: session.status !== 'failed',
    schema: SCHEMA,
    sessionId: session.id,
    studentId: session.studentId,
    status: session.status,
    message: session.message,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    bytes: session.bytes || 0,
    sha256: session.sha256 || '',
  };
}

function createStudentPortableMigrationManager(options) {
  const rootDir = path.resolve(options.rootDir);
  const sessions = new Map();

  function cleanup() {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (Date.parse(session.expiresAt) > now) continue;
      sessions.delete(id);
      fs.rm(session.sessionDir, { recursive: true, force: true }, () => {});
    }
  }

  async function build(session, student, projects) {
    try {
      session.status = 'preparing';
      session.message = '正在固定学生档案快照。';
      const staging = path.join(session.sessionDir, 'package');
      await fs.promises.mkdir(staging, { recursive: true });
      await copyTree(options.resolveStudentRoot(student), path.join(staging, 'workspace'));

      const includedProjects = [];
      for (const project of projects || []) {
        const studentIds = Array.isArray(project.studentIds) ? project.studentIds.map(String) : [];
        if (!studentIds.includes(String(student.id))) continue;
        const projectRoot = options.resolveProjectRoot(project);
        if (!projectRoot || !fs.existsSync(projectRoot)) continue;
        const projectId = safeId(project.id);
        await copyTree(projectRoot, path.join(staging, 'projects', projectId));
        includedProjects.push({
          id: projectId,
          name: String(project.name || projectId),
          type: String(project.type || '学习项目'),
          description: String(project.description || ''),
          objective: String(project.objective || ''),
          status: String(project.status || 'active'),
          source: `projects/${projectId}`,
        });
      }

      const migration = {
        schema: SCHEMA,
        createdAt: new Date().toISOString(),
        student: {
          id: String(student.id),
          name: String(student.name || ''),
          grade: String(student.grade || ''),
          school: String(student.school || ''),
          goal: String(student.goal || ''),
          source: 'workspace',
        },
        projects: includedProjects,
      };
      await fs.promises.writeFile(path.join(staging, 'migration.json'), `${JSON.stringify(migration, null, 2)}\n`, 'utf8');
      const files = await manifestFiles(staging);
      const manifest = {
        schema: SCHEMA,
        studentId: String(student.id),
        fileCount: files.length,
        totalBytes: files.reduce((sum, item) => sum + item.bytes, 0),
        files,
      };
      await fs.promises.writeFile(path.join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      session.status = 'packaging';
      session.message = '正在生成迁移包。';
      await runTar(staging, session.filePath);
      const stat = await fs.promises.stat(session.filePath);
      session.bytes = stat.size;
      session.sha256 = await sha256File(session.filePath);
      session.status = 'ready';
      session.message = '迁移包已就绪，请在单机版中完成接管。';
      await fs.promises.rm(staging, { recursive: true, force: true });
    } catch (error) {
      session.status = 'failed';
      session.message = `生成迁移包失败：${error.message}`;
    }
  }

  function create(student, projects = []) {
    cleanup();
    const id = crypto.randomUUID();
    const createdAt = new Date();
    const sessionDir = path.join(rootDir, id);
    const session = {
      id,
      studentId: String(student.id),
      status: 'queued',
      message: '迁移任务已创建。',
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + SESSION_TTL_MS).toISOString(),
      sessionDir,
      filePath: path.join(sessionDir, `student-${safeId(student.id)}.edu-migration.zip`),
    };
    sessions.set(id, session);
    const run = typeof options.runBackground === 'function' ? options.runBackground : (work) => work();
    try {
      Promise.resolve(run(async () => {
        await fs.promises.mkdir(sessionDir, { recursive: true });
        await build(session, student, projects);
      })).catch((error) => { session.status = 'failed'; session.message = `生成迁移包失败：${error.message}`; });
    } catch (error) { session.status = 'failed'; session.message = `生成迁移包失败：${error.message}`; }
    return publicSession(session);
  }

  function requireSession(sessionId, studentId) {
    cleanup();
    const session = sessions.get(String(sessionId));
    if (!session || String(session.studentId) !== String(studentId)) return null;
    return session;
  }

  return { create, requireSession, publicSession, schema: SCHEMA };
}

module.exports = { SCHEMA, createStudentPortableMigrationManager, isInside, safeId };
