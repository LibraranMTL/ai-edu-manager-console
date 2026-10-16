'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { writeJsonAtomic } = require('./project-materials.cjs');

const PACKAGE = '@tencent-ai/codebuddy-code';
const VERSION = '2.164.0';
const REGISTRY = `https://registry.npmjs.org/${encodeURIComponent(PACKAGE)}/${VERSION}`;
const MAX_ARCHIVE_BYTES = 120 * 1024 * 1024;

function run(executable, args, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const append = chunk => { output = (output + String(chunk)).slice(-1024 * 1024); };
    child.stdout.on('data', append); child.stderr.on('data', append);
    const timer = setTimeout(() => { child.kill(); reject(Error('官方 CLI 解压超时')); }, timeoutMs); timer.unref?.();
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(Error(`官方 CLI 解压失败（${code}）`)); });
  });
}

function safeTarEntries(output) {
  const entries = String(output).split(/\r?\n/).filter(Boolean);
  if (!entries.length) throw Error('官方 CLI 压缩包为空');
  for (const raw of entries) {
    const value = raw.replaceAll('\\', '/');
    if (!value.startsWith('package/') || value.startsWith('/') || /^[A-Za-z]:/.test(value)
      || value.split('/').includes('..') || value.includes('\0')) throw Error('官方 CLI 压缩包包含不安全路径');
  }
  return entries;
}

async function noLinks(root) {
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name), stat = await fs.lstat(full);
      if (stat.isSymbolicLink()) throw Error('官方 CLI 包含不允许的链接');
      if (stat.isDirectory()) pending.push(full);
    }
  }
}

async function defaultDownload(url, fetchImpl) {
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw Error(`下载官方 CLI 失败（HTTP ${response.status}）`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length && length > MAX_ARCHIVE_BYTES) throw Error('官方 CLI 下载包超出安全上限');
  const value = Buffer.from(await response.arrayBuffer());
  if (!value.length || value.length > MAX_ARCHIVE_BYTES) throw Error('官方 CLI 下载包大小异常');
  return value;
}

function createWorkBuddyCliManager({ directory, fetch: fetchImpl = global.fetch, runProcess = run, download = defaultDownload } = {}) {
  if (!directory) throw Error('缺少官方 CLI 管理目录');
  async function verify(folder) {
    const pkg = JSON.parse(await fs.readFile(path.join(folder, 'package.json'), 'utf8'));
    if (pkg.name !== PACKAGE || pkg.version !== VERSION) throw Error('官方 CLI 名称或版本不匹配');
    const cliPath = path.join(folder, 'dist', 'codebuddy.js');
    if (!(await fs.stat(cliPath)).isFile()) throw Error('官方 CLI 缺少登录组件');
    return cliPath;
  }
  async function ensure() {
    const installed = path.join(directory, VERSION, 'package');
    try { return { cliPath: await verify(installed), version: VERSION, reused: true }; } catch { /* Download a verified copy. */ }
    if (typeof fetchImpl !== 'function') throw Error('当前运行环境不能下载官方 CLI');
    await fs.mkdir(directory, { recursive: true });
    const metadataResponse = await fetchImpl(REGISTRY, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!metadataResponse.ok) throw Error(`读取官方 CLI 信息失败（HTTP ${metadataResponse.status}）`);
    const metadata = await metadataResponse.json();
    if (metadata.name !== PACKAGE || metadata.version !== VERSION || !metadata.dist?.integrity) throw Error('官方 CLI 元数据校验失败');
    const tarball = new URL(metadata.dist.tarball);
    if (tarball.protocol !== 'https:' || tarball.hostname !== 'registry.npmjs.org') throw Error('官方 CLI 下载地址不受信任');
    const archive = await download(tarball.href, fetchImpl);
    const [algorithm, expected] = String(metadata.dist.integrity).split('-', 2);
    if (algorithm !== 'sha512' || crypto.createHash('sha512').update(archive).digest('base64') !== expected) throw Error('官方 CLI 完整性校验失败');
    const temporary = await fs.mkdtemp(path.join(directory, '.prepare-'));
    try {
      const archiveFile = path.join(temporary, 'official.tgz'), extract = path.join(temporary, 'extract');
      await fs.writeFile(archiveFile, archive, { flag: 'wx' }); await fs.mkdir(extract);
      const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
      safeTarEntries(await runProcess(tar, ['-tzf', archiveFile]));
      await runProcess(tar, ['-xzf', archiveFile, '-C', extract]);
      await noLinks(path.join(extract, 'package'));
      await verify(path.join(extract, 'package'));
      const versionRoot = path.join(directory, VERSION);
      await fs.mkdir(versionRoot, { recursive: true });
      try { await fs.rename(path.join(extract, 'package'), installed); }
      catch (error) { if (error.code !== 'EEXIST' && error.code !== 'ENOTEMPTY') throw error; }
      const cliPath = await verify(installed);
      await writeJsonAtomic(path.join(directory, 'installed.json'), { package: PACKAGE, version: VERSION,
        integrity: metadata.dist.integrity, cliPath, installedAt: new Date().toISOString() });
      return { cliPath, version: VERSION, reused: false };
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
  }
  return { ensure, verify };
}

module.exports = { createWorkBuddyCliManager, safeTarEntries, PACKAGE, VERSION };
