const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { invariant, MaterialError } = require('./project-material-contract.cjs');
const { hashStableFile } = require('./project-materials.cjs');

const verified = new Map();
async function verifyMaterialSandbox(executable, { spawnProcess = spawn, signal } = {}) {
  invariant(process.platform === 'win32' && path.isAbsolute(executable || '') && /\.exe$/i.test(executable),
    'sandbox_unavailable', '统一资料消化需要可验证的Windows原生执行器。');
  const executableSha256 = (await hashStableFile(executable)).sha256;
  const key = JSON.stringify([executable, executableSha256]);
  if (!spawnProcess || spawnProcess === spawn) {
    if (verified.has(key)) return structuredClone(verified.get(key));
  }
  invariant(!signal?.aborted, 'cancelled', '任务已取消。');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-material-probe-'));
  try {
    const files = [path.join(root, 'original.txt'), path.join(root, 'knowledge.md')];
    await Promise.all(files.map((file) => fs.writeFile(file, 'SYNTHETIC PROBE')));
    const paths = files.map((file) => `'${file.replace(/'/g, "''")}'`).join(',');
    const script = `$ErrorActionPreference='Stop'; $results=@(foreach($p in @(${paths})) { $before=[IO.File]::ReadAllText($p); $denied=$false; try { [IO.File]::WriteAllText($p,'UNEXPECTED_WRITE') } catch { $denied=$true }; @{read=($before -eq 'SYNTHETIC PROBE');denied=$denied} }); @{results=$results}|ConvertTo-Json -Compress -Depth 4`;
    // sandbox has no exec-only --ignore-user-config option. Explicitly select
    // the native read-only policy and require observed denial, not exit alone.
    const args = ['sandbox', 'windows', '-c', 'sandbox_mode="read-only"', '--',
      'powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
    const output = await new Promise((resolve, reject) => {
      const child = spawnProcess(executable, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '', done = false;
      const finish = (error, value) => {
        if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel);
        error ? reject(error) : resolve(value);
      };
      const cancel = () => { child.kill(); finish(new MaterialError('cancelled', '任务已取消。')); };
      const timer = setTimeout(() => { child.kill(); finish(new MaterialError('sandbox_timeout', '隔离验证超时，未运行资料消化。')); }, 30000);
      signal?.addEventListener('abort', cancel, { once: true });
      child.stdout.on('data', (chunk) => { stdout = (stdout + chunk).slice(-65536); });
      child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4096); });
      child.on('error', (error) => finish(error));
      child.on('close', (code) => finish(null, { code, stdout, stderr }));
    });
    let result;
    try { result = JSON.parse(output.stdout.trim()); } catch { result = {}; }
    const unchanged = (await Promise.all(files.map((file) => fs.readFile(file, 'utf8')))).every((text) => text === 'SYNTHETIC PROBE');
    invariant(output.code === 0 && unchanged && result.results?.length === 2
      && result.results.every((item) => item.read === true && item.denied === true),
    'sandbox_unverified', '未证实此执行器的只读隔离，不能开始项目消化。', { exitCode: output.code, diagnostic: output.stderr, result });
    const evidence = { schema: 'edu-manager.project-material-sandbox-probe.v1', executable, executableSha256,
      passed: true, unchanged, measuredAt: new Date().toISOString() };
    if (spawnProcess === spawn) { verified.clear(); verified.set(key, evidence); }
    return evidence;
  } finally {
    const resolved = await fs.realpath(root);
    invariant(path.dirname(resolved) === await fs.realpath(os.tmpdir()) && path.basename(resolved).startsWith('edu-material-probe-'),
      'invalid_root', '拒绝清理非验证临时目录。');
    await fs.rm(resolved, { recursive: true, force: true });
  }
}
module.exports = { verifyMaterialSandbox };
