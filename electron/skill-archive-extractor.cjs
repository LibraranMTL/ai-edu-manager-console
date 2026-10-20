'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const yauzl = require('yauzl');
const { DEFAULT_LIMITS, sha256 } = require('./skill-package-inspector.cjs');

function safeZipPath(rawName) {
  const name = String(rawName || '').replace(/\\/g, '/');
  if (!name || name.includes('\0') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) throw Error('ZIP 包含绝对路径或空路径');
  const segments = name.split('/').filter(Boolean);
  if (!segments.length || segments.some(segment => segment === '..' || segment === '.')) throw Error('ZIP 包含路径越界条目');
  return segments.join('/');
}

function openZip(file) {
  return new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (error, zip) => error ? reject(error) : resolve(zip)));
}

function readEntry(zip, entry) {
  return new Promise((resolve, reject) => zip.openReadStream(entry, (error, stream) => {
    if (error) return reject(error);
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(Buffer.concat(chunks)));
  }));
}

async function extractSkillArchive(archivePath, stagingRoot, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
  const archive = path.resolve(String(archivePath || ''));
  if (!fs.existsSync(archive) || !fs.statSync(archive).isFile()) throw Error('ZIP 文件不存在');
  if (path.extname(archive).toLowerCase() !== '.zip') throw Error('首版仅支持 ZIP 格式');
  const operationId = crypto.randomUUID();
  const target = path.join(path.resolve(stagingRoot), operationId);
  fs.mkdirSync(target, { recursive: true });
  const zip = await openZip(archive);
  let entries = 0, files = 0, totalBytes = 0, compressedBytes = 0, settled = false;
  const fail = (reject, error) => {
    if (settled) return;
    settled = true;
    try { zip.close(); } catch {}
    try { fs.rmSync(target, { recursive: true, force: true }); } catch {}
    reject(error);
  };
  return new Promise((resolve, reject) => {
    zip.once('error', error => fail(reject, /invalid relative path/i.test(String(error?.message || ''))
      ? Error('ZIP 包含路径越界条目') : error));
    zip.once('end', () => {
      if (settled) return;
      settled = true;
      const roots = fs.readdirSync(target, { withFileTypes: true });
      const contentRoot = roots.length === 1 && roots[0].isDirectory() ? path.join(target, roots[0].name) : target;
      resolve({ operationId, stagingPath: target, contentRoot, packageSha256: sha256(fs.readFileSync(archive)), entries, files, totalBytes });
    });
    zip.on('entry', async entry => {
      try {
        entries++;
        if (entries > limits.maxEntries) throw Error('ZIP 条目数量超过限制');
        const relative = safeZipPath(entry.fileName);
        const output = path.join(target, ...relative.split('/'));
        if (path.resolve(output) !== path.resolve(target) && !path.resolve(output).startsWith(path.resolve(target) + path.sep)) throw Error('ZIP 条目路径越界');
        const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
        const fileType = unixMode & 0o170000;
        if (fileType === 0o120000 || fileType && ![0o100000, 0o040000].includes(fileType)) throw Error('ZIP 包含链接或特殊文件');
        if (/\/$/.test(entry.fileName)) fs.mkdirSync(output, { recursive: true });
        else {
          files++;
          if (files > limits.maxFiles) throw Error('ZIP 文件数量超过限制');
          if (entry.uncompressedSize > limits.maxFileBytes) throw Error(`ZIP 单文件超过限制：${relative}`);
          totalBytes += entry.uncompressedSize;
          compressedBytes += Math.max(1, entry.compressedSize);
          if (totalBytes > limits.maxTotalBytes) throw Error('ZIP 解压后总大小超过限制');
          if (totalBytes > 10 * 1024 * 1024 && totalBytes / compressedBytes > 200) throw Error('ZIP 压缩比异常，疑似压缩炸弹');
          const data = await readEntry(zip, entry);
          if (data.length !== entry.uncompressedSize) throw Error(`ZIP 条目大小不一致：${relative}`);
          fs.mkdirSync(path.dirname(output), { recursive: true });
          fs.writeFileSync(output, data, { flag: 'wx', mode: 0o600 });
        }
        zip.readEntry();
      } catch (error) { fail(reject, error); }
    });
    zip.readEntry();
  });
}

module.exports = { extractSkillArchive, safeZipPath };
