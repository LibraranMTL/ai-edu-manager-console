const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');

test('adopted student knowledge bases can be rebound after host migration without moving files', () => {
  assert.match(main, /function rebindAdoptedStudentWorkspace\(studentId\)/);
  assert.match(main, /student\.knowledgeBaseMode !== 'adopted'/);
  assert.match(main, /重新定位.*已有知识库根目录/);
  assert.match(main, /adoptedStorageRootCandidates\(student/);
  assert.match(main, /remapStorageTreeFromRoots\(\s*students\[index\],\s*oldRoots,\s*newRoot/);
  assert.match(main, /path\.basename\(String\(candidate\)\)/);
  assert.match(main, /function remapAdoptedStudentMetadata\(student, oldRoots, newRoot\)/);
  assert.match(main, /metadataFilesUpdated: metadataRemap\.changedFiles\.length/);
  assert.match(main, /updateAdoptedAgentDirectoryStructure\(nextStudent, oldRoots\)/);
  assert.match(main, /EDU-MANAGER-CURRENT-PATHS:START/);
  assert.match(main, /pre-rebind-\$\{timestampForFilename\(\)\}\.bak/);
  assert.match(main, /agentPathUpdated: agentUpdate\.updated/);
  assert.match(main, /agentBackupPath: agentUpdate\.backupPath/);
  assert.match(main, /writeStudentsIndex\(students\)/);
  assert.match(main, /refreshStudentArchiveSyncWatchers\(\)/);
  assert.match(main, /bridge:rebindAdoptedStudentWorkspace/);
  assert.match(preload, /rebindAdoptedStudentWorkspace\(studentId\)/);
  assert.match(renderer, /重新定位接管目录/);
  assert.match(renderer, /本操作只更新教育管家中的路径，不移动、复制或删除任何资料/);
});
