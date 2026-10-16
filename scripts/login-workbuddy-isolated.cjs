'use strict';
// Explicit user-assisted login only. Never reads or copies desktop credentials.
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), { spawn } = require('node:child_process');
const { discoverWorkBuddyRuntime, buildControlledWorkBuddyInvocation } = require('../electron/workbuddy-runtime.cjs');
async function main() {
  const executable = path.resolve(process.argv[2]), metadata = path.resolve(process.argv[3]);
  const installed = discoverWorkBuddyRuntime(executable, { env: {}, findExecutable: () => process.execPath });
  const fullRoot = process.argv[4] ? path.resolve(process.argv[4]) : '';
  if (fullRoot) {
    const pkg = JSON.parse(await fs.readFile(path.join(fullRoot, 'package.json'), 'utf8'));
    if (pkg.name !== '@tencent-ai/codebuddy-code') throw Error('Only the official full CLI package is supported.');
  }
  const interactiveBundle = fullRoot ? path.join(fullRoot, 'dist', 'codebuddy.js')
    : installed.mode === 'node' ? path.resolve(path.dirname(installed.cliPath), '..', 'dist', 'codebuddy.js') : '';
  await fs.mkdir(path.dirname(metadata), { recursive: true });
  if (!interactiveBundle || !await fs.stat(interactiveBundle).then(s => s.isFile(), () => false)) {
    await fs.writeFile(metadata, JSON.stringify({ checkedAt: new Date().toISOString(), status: 'interactive-login-unavailable',
      reason: 'Installed desktop CLI has no full interactive login bundle; desktop credentials are not copied or decrypted.' }, null, 2));
    console.error('当前自带 CLI 不包含独立交互登录模块；需要官方支持的登录入口，不能以桌面登录替代后台认证。');
    process.exitCode = 1; return;
  }
  const profileParent = process.argv[5] ? path.resolve(process.argv[5]) : os.tmpdir();
  await fs.mkdir(profileParent, { recursive: true });
  const root = await fs.mkdtemp(path.join(profileParent, 'edu-workbuddy-auth-'));
  const configDir = path.join(root, '.workbuddy'), cwd = path.join(root, 'empty-workspace');
  for (const dir of [configDir, cwd, path.join(root, 'AppData', 'Local'), path.join(root, 'AppData', 'Roaming')]) await fs.mkdir(dir, { recursive: true });
  const runtime = discoverWorkBuddyRuntime(executable, { homeDir: root, env: {}, findExecutable: () => process.execPath });
  // Run the independently downloaded full bundle, never replace desktop files.
  if (fullRoot) runtime.cliPath = interactiveBundle;
  const invocation = buildControlledWorkBuddyInvocation(runtime, { cwd, baseEnv: { ...process.env, HOME: root, USERPROFILE: root,
    LOCALAPPDATA: path.join(root, 'AppData', 'Local'), APPDATA: path.join(root, 'AppData', 'Roaming') } });
  // Interactive login is a built-in command, not an Agent task. Keep all tool,
  // plugin, hook and MCP restrictions; remove only the print-only transport.
  invocation.args = invocation.args.filter((arg, i, all) => !['--print', '--input-format', '--output-format'].includes(arg)
    && !['--input-format', '--output-format'].includes(all[i - 1]));
  invocation.args.push('/login');
  delete invocation.env.CODEBUDDY_FORCE_LITE_WB_BUNDLE;
  delete invocation.env.CODEBUDDY_FORCE_HEADLESS_BUNDLE;
  for (const name of Object.keys(invocation.env)) if (/(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN)$/.test(name)) delete invocation.env[name];
  await fs.writeFile(metadata, JSON.stringify({ root, configDir, cliPath: runtime.cliPath, productConfigPath: runtime.productConfigPath,
    provider: 'official-full-cli-with-workbuddy-product-config', createdAt: new Date().toISOString(), status: 'user-login-required' }, null, 2));
  console.log('Independent test profile: ' + root);
  const child = spawn(invocation.executable, invocation.args, { cwd, env: invocation.env, shell: false, windowsHide: true, stdio: 'inherit' });
  child.on('error', () => { console.error('WorkBuddy login process could not start'); process.exitCode = 1; });
  child.on('close', code => { process.exitCode = code || 0; });
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
