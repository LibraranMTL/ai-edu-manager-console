const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const {
  adoptedStorageRootCandidates,
  rebaseStoragePath,
  remapStorageTree,
  remapStorageTreeFromRoots,
  resolveConfiguredStoragePath,
  resolveStudentBaseDir,
  windowsVolumeAvailable,
  windowsUserProfileMismatch,
} = require('../electron/storage-root.cjs');

test('adopted roots are inferred from consistent child paths when restored root metadata is stale', () => {
  const student = {
    rootPath: 'C:\\Users\\teacher\\Documents\\学生资料\\包书源知识库',
    rootPathLabel: 'C:\\Users\\teacher\\Documents\\学生资料\\包书源知识库',
    rawPath: 'D:\\Obsidian\\MyVault\\phone\\baoshuyuan\\baoshuyuan-raw',
    summaryPath: 'D:\\Obsidian\\MyVault\\phone\\baoshuyuan\\baoshuyuan-wiki',
    agentPath: 'D:\\Obsidian\\MyVault\\phone\\baoshuyuan\\AGENT.md',
    outputPath: 'D:\\Obsidian\\MyVault\\phone\\baoshuyuan\\输出结果',
  };
  assert.deepEqual(adoptedStorageRootCandidates(student, { platform: 'win32' }), [
    'D:\\Obsidian\\MyVault\\phone\\baoshuyuan',
    'C:\\Users\\teacher\\Documents\\学生资料\\包书源知识库',
  ]);
});

test('adopted trees remap from the inferred real root instead of retaining stale D drive paths', () => {
  const oldRoot = 'D:\\Obsidian\\MyVault\\phone\\baoshuyuan';
  const wrongRestoredRoot = 'C:\\Users\\teacher\\Documents\\学生资料\\包书源知识库';
  const targetRoot = 'C:\\Users\\teacher\\Documents\\Knowledge\\baoshuyuan';
  const input = {
    rootPath: wrongRestoredRoot,
    rootPathLabel: wrongRestoredRoot,
    rawPath: `${oldRoot}\\baoshuyuan-raw`,
    summaryPath: `${oldRoot}\\baoshuyuan-wiki`,
    agentPath: `${oldRoot}\\AGENT.md`,
    outputPath: `${oldRoot}\\输出结果`,
    memoryConfig: { unifiedMemoryPath: `${oldRoot}\\Agent记忆\\UnifiedMemory.md` },
  };
  const roots = adoptedStorageRootCandidates(input, { platform: 'win32' });
  const result = remapStorageTreeFromRoots(input, roots, targetRoot, { platform: 'win32' });
  assert.equal(result.value.rootPath, targetRoot);
  assert.equal(result.value.rawPath, `${targetRoot}\\baoshuyuan-raw`);
  assert.equal(result.value.summaryPath, `${targetRoot}\\baoshuyuan-wiki`);
  assert.equal(result.value.agentPath, `${targetRoot}\\AGENT.md`);
  assert.equal(result.value.memoryConfig.unifiedMemoryPath, `${targetRoot}\\Agent记忆\\UnifiedMemory.md`);
});

test('Windows student storage falls back to Documents when D drive is absent', () => {
  const existsSync = (candidate) => String(candidate).toUpperCase() === 'C:\\';
  const result = resolveStudentBaseDir({
    configured: '',
    platform: 'win32',
    documentsDir: 'C:\\Users\\teacher\\Documents',
    homeDir: 'C:\\Users\\teacher',
    existsSync,
  });
  assert.equal(result, path.join('C:\\Users\\teacher\\Documents', '学生资料'));
});

test('legacy D drive default remains compatible when D drive exists', () => {
  const result = resolveStudentBaseDir({
    platform: 'win32',
    documentsDir: 'C:\\Users\\teacher\\Documents',
    existsSync: (candidate) => String(candidate).toUpperCase() === 'D:\\',
  });
  assert.equal(result, 'D:\\学生资料');
});

test('configured C drive takeover directory is preserved', () => {
  const configured = 'C:\\Users\\teacher\\Documents\\New project';
  const result = resolveStudentBaseDir({
    configured,
    platform: 'win32',
    documentsDir: 'C:\\Users\\teacher\\Documents',
    existsSync: (candidate) => String(candidate).toUpperCase() === 'C:\\',
  });
  assert.equal(result, configured);
});

test('restored paths owned by another Windows user profile fall back to current Documents', () => {
  const existsSync = (candidate) => String(candidate).toUpperCase() === 'C:\\';
  const result = resolveStudentBaseDir({
    configured: 'C:\\Users\\old-user\\Documents\\StudentData',
    platform: 'win32',
    documentsDir: 'C:\\Users\\teacher\\Documents',
    homeDir: 'C:\\Users\\teacher',
    existsSync,
  });
  assert.equal(result, path.join('C:\\Users\\teacher\\Documents', '\u5b66\u751f\u8d44\u6599'));
  assert.equal(
    windowsUserProfileMismatch(
      'C:\\Users\\old-user\\Documents\\StudentData',
      'C:\\Users\\teacher',
    ),
    true,
  );
});

test('configured roots inside the current profile or outside Users remain valid', () => {
  const existsSync = (candidate) => String(candidate).toUpperCase() === 'C:\\';
  assert.equal(resolveStudentBaseDir({
    configured: 'C:\\Users\\teacher\\Documents\\CustomStudentData',
    platform: 'win32',
    documentsDir: 'C:\\Users\\teacher\\Documents',
    homeDir: 'C:\\Users\\teacher',
    existsSync,
  }), 'C:\\Users\\teacher\\Documents\\CustomStudentData');
  assert.equal(resolveStudentBaseDir({
    configured: 'C:\\EducationData\\Students',
    platform: 'win32',
    documentsDir: 'C:\\Users\\teacher\\Documents',
    homeDir: 'C:\\Users\\teacher',
    existsSync,
  }), 'C:\\EducationData\\Students');
});

test('stale D drive settings and collaboration roots fall back safely', () => {
  const fallback = 'C:\\Users\\teacher\\Documents\\学生资料\\.edu-manager\\collaboration';
  const existsSync = (candidate) => String(candidate).toUpperCase() === 'C:\\';
  assert.equal(windowsVolumeAvailable('D:\\学生资料', existsSync), false);
  assert.equal(resolveConfiguredStoragePath('D:\\学生资料\\.edu-manager\\collaboration', fallback, {
    platform: 'win32',
    existsSync,
  }), fallback);
});

test('managed backup paths are rebased from a missing D drive to the current root', () => {
  const sourceRoot = 'D:\\学生资料';
  const targetRoot = 'C:\\Users\\teacher\\Documents\\学生资料';
  assert.equal(
    rebaseStoragePath('D:\\学生资料\\张三知识库\\张三原始资料库', sourceRoot, targetRoot, { platform: 'win32' }),
    'C:\\Users\\teacher\\Documents\\学生资料\\张三知识库\\张三原始资料库',
  );
  assert.equal(
    rebaseStoragePath('E:\\已有外部知识库\\张三', sourceRoot, targetRoot, { platform: 'win32' }),
    'E:\\已有外部知识库\\张三',
  );
});

test('backup trees remap nested student, project and asset paths without changing text or URLs', () => {
  const sourceRoot = 'D:\\学生资料';
  const targetRoot = 'C:\\Users\\teacher\\Documents\\学生资料';
  const result = remapStorageTree({
    rootPath: 'D:\\学生资料\\张三知识库',
    materialSources: [{ path: 'D:\\学生资料\\张三知识库\\来源资料' }],
    importFolder: 'D:\\学生资料\\张三知识库\\自动投递',
    workspacePath: 'E:\\外部项目工作空间',
    sourceUri: 'edu://student/zhangsan/knowledge/index.md',
    note: '资料原来位于 D:\\学生资料',
  }, sourceRoot, targetRoot, { platform: 'win32' });
  assert.deepEqual(result.value, {
    rootPath: 'C:\\Users\\teacher\\Documents\\学生资料\\张三知识库',
    materialSources: [{ path: 'C:\\Users\\teacher\\Documents\\学生资料\\张三知识库\\来源资料' }],
    importFolder: 'C:\\Users\\teacher\\Documents\\学生资料\\张三知识库\\自动投递',
    workspacePath: 'E:\\外部项目工作空间',
    sourceUri: 'edu://student/zhangsan/knowledge/index.md',
    note: '资料原来位于 D:\\学生资料',
  });
  assert.equal(result.changed, 3);
});
