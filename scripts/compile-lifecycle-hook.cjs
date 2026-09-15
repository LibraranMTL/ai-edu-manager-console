const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function compileLifecycleHook(sourcePath, outputPath) {
  if (process.platform !== 'win32') throw new Error('The lifecycle hook executable requires Windows.');
  const windowsDir = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows';
  const framework = ['Framework64', 'Framework']
    .map((name) => path.join(windowsDir, 'Microsoft.NET', name, 'v4.0.30319'))
    .find((dir) => fs.existsSync(path.join(dir, 'csc.exe')));
  if (!framework) throw new Error('The Windows .NET Framework C# compiler is unavailable.');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const result = spawnSync(path.join(framework, 'csc.exe'), [
    '/nologo', '/optimize+', '/target:exe', '/platform:x64',
    `/out:${outputPath}`,
    sourcePath,
  ], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0 || !fs.existsSync(outputPath)) {
    throw new Error(`Lifecycle hook compilation failed: ${result.error?.message || result.stdout || result.stderr || result.status}`);
  }
  return outputPath;
}

module.exports = { compileLifecycleHook };
