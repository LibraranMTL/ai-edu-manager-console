const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  compareSourceSnapshot,
  createMigrationPackage,
  inspectMigrationPackage,
  inspectMigrationSources,
  isSameOrInside,
  portableRelative,
  restoreMigrationPackage,
  sha256File,
  walkFiles,
} = require('../electron/host-migration.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-host-migration-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const managedRoot = path.join(root, 'old', 'student-data');
  const externalRoot = path.join(root, 'external', 'project-workspace');
  const userData = path.join(root, 'old-user-data');
  const destination = path.join(root, 'packages');
  fs.mkdirSync(path.join(managedRoot, 'student-a', 'raw'), { recursive: true });
  fs.mkdirSync(externalRoot, { recursive: true });
  fs.mkdirSync(path.join(userData, 'course-catalog'), { recursive: true });
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(managedRoot, 'student-a', 'raw', 'exercise.md'), '# exercise\n', 'utf8');
  fs.writeFileSync(path.join(externalRoot, 'work.txt'), 'external project', 'utf8');
  fs.writeFileSync(path.join(userData, 'course-catalog', 'tenant-custom-courses.json'), JSON.stringify({ courses: [{ id: 'course-1', imagePath: path.join(userData, 'course-catalog', 'custom-assets', 'cover.png') }] }), 'utf8');
  return { root, managedRoot, externalRoot, userData, destination };
}

function exportOptions(fx, password = '') {
  return {
    destinationParent: fx.destination,
    password,
    managedRoot: fx.managedRoot,
    userDataRoot: fx.userData,
    appVersion: '0.15.10',
    hostDisplayName: '旧主机',
    sources: [
      { kind: 'managed', id: 'managed-root', label: '学生资料', rootPath: fx.managedRoot },
      { kind: 'external', id: 'project-1', label: '项目工作空间', rootPath: fx.externalRoot },
      { kind: 'state', id: 'course-catalog', destinationPrefix: 'course-catalog', rootPath: path.join(fx.userData, 'course-catalog') },
    ],
    virtualFiles: [
      { kind: 'state', id: 'host-state', relativePath: 'settings.json', content: JSON.stringify({ studentBaseDir: fx.managedRoot, archiveRoot: fx.managedRoot, license: 'must-not-export', apiToken: 'must-not-export' }) },
      { kind: 'state', id: 'host-state', relativePath: 'students.json', content: JSON.stringify([{ id: 'student-1', rootPath: path.join(fx.managedRoot, 'student-a') }]) },
      { kind: 'state', id: 'host-state', relativePath: 'projects.json', content: JSON.stringify({ version: 1, projects: [{ id: 'project-1', workspacePath: fx.externalRoot }] }) },
    ],
  };
}

test('migration source inspection counts managed and external documents', (t) => {
  const fx = fixture(t);
  const result = inspectMigrationSources(exportOptions(fx).sources);
  assert.equal(result.fileCount, 3);
  assert.ok(result.totalBytes > 0);
  assert.equal(result.sources.filter((item) => item.exists).length, 3);
});

test('migration package refuses a destination inside any source tree before copying', async (t) => {
  const fx = fixture(t);
  const options = exportOptions(fx, 'correct-password');
  options.destinationParent = fx.externalRoot;
  await assert.rejects(() => createMigrationPackage(options), /不能保存在正在迁移的资料目录内/);
  assert.deepEqual(fs.readdirSync(fx.externalRoot), ['work.txt']);
  assert.equal(isSameOrInside(fx.externalRoot, path.join(fx.externalRoot, 'nested')), true);
  assert.equal(isSameOrInside(fx.externalRoot, fx.destination), false);
});

test('migration snapshot ignores timestamp-only touches but reports real content changes', async (t) => {
  const fx = fixture(t);
  const source = { kind: 'external', id: 'project-1', label: '项目工作空间', rootPath: fx.externalRoot };
  const expected = walkFiles(source.rootPath, source);
  const file = expected[0];
  const hashes = new Map([[file.relativePath, await sha256File(file.absolutePath)]]);
  const touchedAt = new Date(Date.now() + 10_000);
  fs.utimesSync(file.absolutePath, touchedAt, touchedAt);
  const metadataOnly = await compareSourceSnapshot(source, expected, hashes);
  assert.deepEqual(metadataOnly.modified, []);
  assert.deepEqual(metadataOnly.metadataOnly, ['work.txt']);
  fs.writeFileSync(file.absolutePath, 'external projecT', 'utf8');
  const changed = await compareSourceSnapshot(source, expected, hashes);
  assert.deepEqual(changed.modified, ['work.txt']);
});

test('active knowledge metadata changing after a stable copy becomes a report warning instead of failing the package', async (t) => {
  const fx = fixture(t);
  let changed = false;
  const created = await createMigrationPackage({
    ...exportOptions(fx),
    onProgress: (progress) => {
      if (!changed && progress.current === 'work.txt') {
        changed = true;
        fs.writeFileSync(path.join(fx.externalRoot, 'work.txt'), 'external project updated after copy', 'utf8');
      }
    },
  });
  assert.equal(created.ok, true);
  assert.equal(created.sourceChangeWarnings.length, 1);
  assert.equal(created.sourceChangeWarnings[0].label, '项目工作空间');
  assert.equal(created.sourceChangeWarnings[0].modified, 1);
  assert.deepEqual(created.sourceChangeWarnings[0].examples, ['work.txt']);
  const manifest = JSON.parse(fs.readFileSync(path.join(created.packagePath, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.sourceChangesDuringExport, created.sourceChangeWarnings);
  const report = fs.readFileSync(path.join(created.packagePath, 'migration-report.md'), 'utf8');
  assert.match(report, /每个文件复制时通过前后 SHA-256 校验的稳定版本/);
  assert.match(report, /work\.txt/);
});

test('new migration package is password-free and restores through staging with path remap', async (t) => {
  const fx = fixture(t);
  const progress = [];
  const created = await createMigrationPackage({ ...exportOptions(fx), onProgress: (item) => progress.push(item) });
  assert.equal(created.ok, true);
  assert.equal(created.encrypted, false);
  assert.equal(progress.at(-1).phase, 'completed');
  assert.equal(fs.existsSync(path.join(created.packagePath, 'manifest.sha256')), true);
  const inspected = await inspectMigrationPackage(created.packagePath);
  assert.equal(inspected.storedVerified, inspected.fileCount);
  assert.equal(inspected.requiresPassword, false);

  const targetRoot = path.join(fx.root, 'new', 'student-data');
  const targetUserData = path.join(fx.root, 'new-user-data');
  fs.mkdirSync(targetUserData, { recursive: true });
  fs.writeFileSync(path.join(targetUserData, 'settings.json'), JSON.stringify({ license: { licenseId: 'new-license' }, apiToken: 'new-token' }), 'utf8');
  const restored = await restoreMigrationPackage({
    packageRoot: created.packagePath,
    targetRoot,
    userDataDir: targetUserData,
  });
  assert.equal(restored.ok, true);
  assert.equal(restored.sourceManagedRoot, fx.managedRoot);
  assert.equal(fs.readFileSync(path.join(targetRoot, 'student-a', 'raw', 'exercise.md'), 'utf8'), '# exercise\n');
  assert.equal(fs.readFileSync(path.join(targetRoot, '.edu-manager', 'migrated-external', 'project-1', 'work.txt'), 'utf8'), 'external project');
  const students = JSON.parse(fs.readFileSync(path.join(targetUserData, 'students.json'), 'utf8'));
  assert.equal(students[0].rootPath, path.join(targetRoot, 'student-a'));
  const projects = JSON.parse(fs.readFileSync(path.join(targetUserData, 'projects.json'), 'utf8'));
  assert.equal(projects.projects[0].workspacePath, path.join(targetRoot, '.edu-manager', 'migrated-external', 'project-1'));
  const settings = JSON.parse(fs.readFileSync(path.join(targetUserData, 'settings.json'), 'utf8'));
  assert.equal(settings.license.licenseId, 'new-license');
  assert.equal(settings.apiToken, 'new-token');
  assert.equal(settings.studentBaseDir, targetRoot);
  const courses = JSON.parse(fs.readFileSync(path.join(targetUserData, 'course-catalog', 'tenant-custom-courses.json'), 'utf8'));
  assert.equal(courses.courses[0].imagePath, path.join(targetUserData, 'course-catalog', 'custom-assets', 'cover.png'));
});

test('migration streams a SQLite state snapshot and restores it without JSON serialization', async (t) => {
  const fx = fixture(t);
  const snapshotPath = path.join(fx.root, 'asset-index.sqlite3');
  const snapshot = crypto.randomBytes(512 * 1024);
  fs.writeFileSync(snapshotPath, snapshot);
  const options = exportOptions(fx);
  options.virtualFiles.push({
    kind: 'state',
    id: 'host-state',
    relativePath: 'migration-assets/asset-index.sqlite3',
    sourcePath: snapshotPath,
  });
  const created = await createMigrationPackage(options);
  const targetRoot = path.join(fx.root, 'sqlite-new', 'student-data');
  const targetUserData = path.join(fx.root, 'sqlite-new-user-data');
  fs.mkdirSync(targetUserData, { recursive: true });
  await restoreMigrationPackage({ packageRoot: created.packagePath, targetRoot, userDataDir: targetUserData });
  assert.deepEqual(fs.readFileSync(path.join(targetUserData, 'migration-assets', 'asset-index.sqlite3')), snapshot);
  const manifest = JSON.parse(fs.readFileSync(path.join(created.packagePath, 'manifest.json'), 'utf8'));
  const entry = manifest.files.find((item) => item.relativePath === 'migration-assets/asset-index.sqlite3');
  assert.equal(entry.size, snapshot.length);
  assert.equal(entry.sha256, crypto.createHash('sha256').update(snapshot).digest('hex'));
});

test('migration package uses short ASCII physical paths while restoring deep Chinese logical paths', async (t) => {
  const fx = fixture(t);
  const deepRelative = path.join('学生甲', '语文课程', '长期学习资料', '第一单元', '课堂记录', '作文修改建议.md');
  const deepSource = path.join(fx.managedRoot, deepRelative);
  fs.mkdirSync(path.dirname(deepSource), { recursive: true });
  fs.writeFileSync(deepSource, '保留原始中文目录与文件名', 'utf8');

  const created = await createMigrationPackage(exportOptions(fx));
  assert.match(path.basename(created.packagePath), /^AI-Edu-Migrate-\d{14}-[a-f0-9]{8}$/);
  const manifest = JSON.parse(fs.readFileSync(path.join(created.packagePath, 'manifest.json'), 'utf8'));
  assert.equal(manifest.payloadLayout, 'flat-sha256-v2');
  const physicalPaths = manifest.files.map((entry) => entry.payloadRelativePath);
  assert.ok(physicalPaths.every((value) => /^objects\/[a-f0-9]{2}\/[a-f0-9]{64}\.bin$/.test(value)));
  assert.ok(physicalPaths.every((value) => /^[\x20-\x7e]+$/.test(value)));
  assert.ok(physicalPaths.every((value) => value.length < 90));
  assert.equal(fs.existsSync(path.join(created.packagePath, 'migration-report.md')), true);

  const targetRoot = path.join(fx.root, 'new', 'student-data');
  const targetUserData = path.join(fx.root, 'new-user-data');
  const restored = await restoreMigrationPackage({
    packageRoot: created.packagePath,
    targetRoot,
    userDataDir: targetUserData,
  });
  assert.equal(restored.ok, true);
  assert.equal(fs.readFileSync(path.join(targetRoot, deepRelative), 'utf8'), '保留原始中文目录与文件名');
});

test('restore remaps portable knowledge metadata JSON after verifying original package hashes', async (t) => {
  const fx = fixture(t);
  const managerDir = path.join(fx.managedRoot, 'student-a', '.ai-manager');
  const growthDir = path.join(fx.managedRoot, 'student-a', '学情分析汇总', '成长模型');
  fs.mkdirSync(managerDir, { recursive: true });
  fs.mkdirSync(growthDir, { recursive: true });
  fs.writeFileSync(path.join(managerDir, 'pathmap.json'), JSON.stringify({ root: path.join(fx.managedRoot, 'student-a'), external: fx.externalRoot }), 'utf8');
  fs.writeFileSync(path.join(growthDir, 'growth-index.json'), JSON.stringify({ sourcePath: path.join(fx.managedRoot, 'student-a', 'raw', 'exercise.md') }), 'utf8');
  const created = await createMigrationPackage(exportOptions(fx));
  const targetRoot = path.join(fx.root, 'new', 'student-data');
  const targetUserData = path.join(fx.root, 'new-user-data');
  const restored = await restoreMigrationPackage({ packageRoot: created.packagePath, targetRoot, userDataDir: targetUserData });
  assert.ok(restored.remappedMetadataFiles >= 2);
  const pathmap = JSON.parse(fs.readFileSync(path.join(targetRoot, 'student-a', '.ai-manager', 'pathmap.json'), 'utf8'));
  assert.equal(pathmap.root, path.join(targetRoot, 'student-a'));
  assert.equal(pathmap.external, path.join(targetRoot, '.edu-manager', 'migrated-external', 'project-1'));
  const growth = JSON.parse(fs.readFileSync(path.join(targetRoot, 'student-a', '学情分析汇总', '成长模型', 'growth-index.json'), 'utf8'));
  assert.equal(growth.sourcePath, path.join(targetRoot, 'student-a', 'raw', 'exercise.md'));
});

test('restore upgrades a legacy array-only project index into the readable project envelope', async (t) => {
  const fx = fixture(t);
  const options = exportOptions(fx);
  const projectState = options.virtualFiles.find((item) => item.relativePath === 'projects.json');
  projectState.content = JSON.stringify([{ id: 'legacy-project', workspacePath: fx.externalRoot }]);
  const created = await createMigrationPackage(options);
  const targetRoot = path.join(fx.root, 'new', 'student-data');
  const targetUserData = path.join(fx.root, 'new-user-data');
  const restored = await restoreMigrationPackage({
    packageRoot: created.packagePath,
    targetRoot,
    userDataDir: targetUserData,
  });
  assert.equal(restored.ok, true);
  const projectIndex = JSON.parse(fs.readFileSync(path.join(targetUserData, 'projects.json'), 'utf8'));
  assert.equal(projectIndex.version, 1);
  assert.equal(projectIndex.projects.length, 1);
  assert.equal(projectIndex.projects[0].id, 'legacy-project');
  assert.equal(projectIndex.projects[0].workspacePath, path.join(targetRoot, '.edu-manager', 'migrated-external', 'project-1'));
});

test('migration inspection remains compatible with legacy manifest payload paths', async (t) => {
  const fx = fixture(t);
  const created = await createMigrationPackage(exportOptions(fx));
  const manifestPath = path.join(created.packagePath, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const entry = manifest.files.find((item) => item.category === 'managed');
  const currentPayload = path.join(created.packagePath, 'payload', ...entry.payloadRelativePath.split('/'));
  const legacyRelative = `managed/${entry.scopeId}/${entry.relativePath}`;
  const legacyPayload = path.join(created.packagePath, 'payload', ...legacyRelative.split('/'));
  fs.mkdirSync(path.dirname(legacyPayload), { recursive: true });
  fs.renameSync(currentPayload, legacyPayload);
  entry.payloadRelativePath = legacyRelative;
  delete manifest.payloadLayout;
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.writeFileSync(manifestPath, manifestText, 'utf8');
  fs.writeFileSync(path.join(created.packagePath, 'manifest.sha256'), `${crypto.createHash('sha256').update(manifestText).digest('hex')}  manifest.json\n`, 'utf8');

  const inspected = await inspectMigrationPackage(created.packagePath);
  assert.equal(inspected.ok, true);
  assert.equal(inspected.storedVerified, inspected.fileCount);
});

test('legacy encrypted migration package still requires the correct password', async (t) => {
  const fx = fixture(t);
  const created = await createMigrationPackage(exportOptions(fx, 'correct-password'));
  const targetRoot = path.join(fx.root, 'new', 'student-data');
  const targetUserData = path.join(fx.root, 'new-user-data');
  fs.mkdirSync(targetUserData, { recursive: true });
  fs.writeFileSync(path.join(targetUserData, 'settings.json'), '{"apiToken":"keep"}', 'utf8');
  await assert.rejects(() => restoreMigrationPackage({ packageRoot: created.packagePath, targetRoot, userDataDir: targetUserData, password: 'wrong-password' }));
  assert.equal(fs.existsSync(targetRoot), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(targetUserData, 'settings.json'), 'utf8')).apiToken, 'keep');
});

test('tampered migration payload fails inspection before restore', async (t) => {
  const fx = fixture(t);
  const created = await createMigrationPackage(exportOptions(fx));
  const manifest = JSON.parse(fs.readFileSync(path.join(created.packagePath, 'manifest.json'), 'utf8'));
  const payload = path.join(created.packagePath, 'payload', ...manifest.files[0].payloadRelativePath.split('/'));
  fs.appendFileSync(payload, crypto.randomBytes(8));
  await assert.rejects(() => inspectMigrationPackage(created.packagePath), /校验失败/);
});

test('restore refuses a non-empty target and portable paths reject traversal', async (t) => {
  const fx = fixture(t);
  const created = await createMigrationPackage(exportOptions(fx));
  const targetRoot = path.join(fx.root, 'new', 'student-data');
  fs.mkdirSync(targetRoot, { recursive: true });
  fs.writeFileSync(path.join(targetRoot, 'existing.txt'), 'do not overwrite');
  await assert.rejects(() => restoreMigrationPackage({ packageRoot: created.packagePath, targetRoot, userDataDir: path.join(fx.root, 'new-user-data') }), /必须为空/);
  assert.equal(fs.readFileSync(path.join(targetRoot, 'existing.txt'), 'utf8'), 'do not overwrite');
  assert.throws(() => portableRelative('../secret.txt'), /路径无效/);
});
