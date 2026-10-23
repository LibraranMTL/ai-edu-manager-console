const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '../src/main.tsx'), 'utf8');

function bind(scope, name) {
  const functionStart = main.indexOf(`function ${name}(`);
  assert.ok(functionStart >= 0);
  const start = main.slice(functionStart - 6, functionStart) === 'async ' ? functionStart - 6 : functionStart;
  return Function('scope', `with (scope) { return (${main.slice(start, main.indexOf('\n}', functionStart) + 2)}); }`)(scope);
}

test('recovery diagnostics report journal state without mutating files or exposing source paths', async () => {
  const projects = [
    { id: 'new-1', name: '项目一', materialStorageMode: 'workspace-v1' },
    { id: 'new-2', name: '项目二', materialStorageMode: 'workspace-v1' },
    { id: 'legacy', name: '旧项目' },
  ];
  let pendingCalls = 0;
  const inspect = bind({
    readProjects: () => projects, readProjectMetadata: () => projects,
    normalizeProjectMetadata: (value) => value,
    isWorkspaceMaterialProject: (value) => value.materialStorageMode === 'workspace-v1',
    createProjectUploadIntake: (project) => ({ pending: async () => {
      pendingCalls += 1;
      if (project.id === 'new-2') throw Object.assign(new Error('unreadable'), { code: 'intake_corrupt' });
      return [{ key: 'key-1', uploadId: 'upload-1', sourceType: 'terminal_upload',
        state: 'written', createdAt: '2026-09-29T00:00:00.000Z',
        hostSourcePath: 'D:\\private\\student.txt', relativePath: '收件箱/student.txt' }];
    } }),
    projectUploadRecoveryIssues: [{ projectId: 'new-1', key: 'key-1', code: 'source_changed' }],
  }, 'inspectProjectUploadRecovery');
  const result = JSON.parse(await inspect());
  assert.equal(pendingCalls, 2);
  assert.equal(result.ok, false);
  assert.equal(result.total, 1);
  assert.equal(result.errorCount, 1);
  assert.equal(result.pending[0].issueCode, 'source_changed');
  assert.deepEqual(result.errors, [{ projectId: 'new-2', projectName: '项目二', code: 'intake_corrupt' }]);
  assert.equal(JSON.stringify(result).includes('D:\\private'), false);
  assert.equal(JSON.stringify(result).includes('收件箱/student.txt'), false);
});

test('recovery diagnostics are exposed only through local Electron bridge and host settings', () => {
  assert.match(main, /ipcMain\.handle\('bridge:inspectProjectUploadRecovery'/);
  assert.match(preload, /inspectProjectUploadRecovery\(\)\s*\{\s*return ipcRenderer\.invoke\('bridge:inspectProjectUploadRecovery'\)/);
  assert.match(renderer, /检查项目资料接收记录/);
  assert.match(renderer, /projectUploadRecoveryDiagnostics\.pending\.slice\(0, 20\)/);
});
