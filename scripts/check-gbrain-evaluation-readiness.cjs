const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function locate(command, candidates = []) {
  const result = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [command], { encoding: 'utf8' });
  const fromPath = result.status === 0 ? String(result.stdout || '').split(/\r?\n/).find(Boolean) || '' : '';
  const locatedPath = [fromPath, ...candidates].map((item) => String(item || '').trim()).find((item) => item && fs.existsSync(item)) || '';
  if (!locatedPath) return { installed: false, path: '', version: '' };
  const versionResult = spawnSync(locatedPath, ['--version'], { encoding: 'utf8' });
  return {
    installed: true,
    path: locatedPath.trim(),
    version: String(versionResult.stdout || versionResult.stderr || '').trim(),
  };
}

const result = {
  schema: 'edu-manager.gbrain-evaluation-readiness.v1',
  checkedAt: new Date().toISOString(),
  syntheticDataOnly: true,
  bun: locate('bun', [path.join(os.homedir(), '.bun', 'bin', process.platform === 'win32' ? 'bun.exe' : 'bun')]),
  gbrain: locate('gbrain', [path.join(os.homedir(), '.bun', 'bin', process.platform === 'win32' ? 'gbrain.exe' : 'gbrain')]),
};
result.ready = result.bun.installed && result.gbrain.installed;
result.nextAction = result.ready
  ? '在独立 namespace 中运行 education-synthetic-v1，不连接正式学生目录。'
  : '在隔离目录准备 Bun 与 GBrain 后重跑；不要将正式学生目录、正式凭据或备份挂载到评估环境。';

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
