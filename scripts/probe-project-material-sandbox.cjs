// Explicit native sandbox probe, no model invocation or user data. The child
// attempts writes only against disposable files created by this invocation.
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

async function main() {
  const executable = process.argv[2];
  if (!executable || !path.isAbsolute(executable)) throw new Error('Provide the verified absolute Codex executable path');
  const temporaryRoot = path.resolve(__dirname, '../.tmp');
  await fs.mkdir(temporaryRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(temporaryRoot, 'project-material-sandbox-'));
  const original = path.join(root, 'original.txt');
  const knowledge = path.join(root, 'knowledge.md');
  const probe = path.join(root, 'probe.cjs');
  await fs.writeFile(original, 'SYNTHETIC ORIGINAL');
  await fs.writeFile(knowledge, 'SYNTHETIC KNOWLEDGE');
  await fs.writeFile(probe, `const fs=require('node:fs');const files=${JSON.stringify([original, knowledge])};const results=files.map(file=>{const before=fs.readFileSync(file,'utf8');let denied=false;let error='';try{fs.writeFileSync(file,'UNEXPECTED_WRITE')}catch(e){denied=true;error=e.code}return{read:before.startsWith('SYNTHETIC'),denied,error}});console.log(JSON.stringify({results}));process.exit(results.every(x=>x.read&&x.denied)?0:2);`);
  const args = ['sandbox', 'windows', '-c', 'sandbox_mode="read-only"', '--', process.execPath, '-e', await fs.readFile(probe, 'utf8')];
  let stdout = '', stderr = '';
  const started = Date.now();
  const code = await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill(), 30000);
    child.stdout.on('data', (chunk) => { stdout = (stdout + chunk).slice(-65536); });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-65536); });
    child.on('error', reject);
    child.on('close', (status) => { clearTimeout(timer); resolve(status); });
  });
  const unchanged = await fs.readFile(original, 'utf8') === 'SYNTHETIC ORIGINAL'
    && await fs.readFile(knowledge, 'utf8') === 'SYNTHETIC KNOWLEDGE';
  let parsed;
  try { parsed = JSON.parse(stdout.trim()); } catch { parsed = null; }
  const passed = code === 0 && unchanged && parsed?.results?.length === 2 && parsed.results.every((item) => item.read && item.denied);
  console.log(JSON.stringify({ schema: 'edu-manager.project-material-sandbox-probe.v1',
    measuredAt: new Date().toISOString(), executable, executableSha256: crypto.createHash('sha256').update(await fs.readFile(executable)).digest('hex'),
    passed, exitCode: code, unchanged, durationMs: Date.now() - started, results: parsed?.results || [], stderr }, null, 2));
  const resolved = await fs.realpath(root);
  const base = await fs.realpath(temporaryRoot);
  if (path.dirname(resolved) !== base || !path.basename(resolved).startsWith('project-material-sandbox-')) throw new Error('Unsafe fixture cleanup');
  await fs.rm(resolved, { recursive: true, force: true });
  if (!passed) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
