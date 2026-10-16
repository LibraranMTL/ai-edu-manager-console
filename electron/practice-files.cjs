'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
async function scopedFile(root, folder, name, create = false) {
  if (!/^[a-z-]+$/.test(folder) || !/^[A-Za-z0-9_.-]+$/.test(name) || name.includes('..')) throw Error('无效的卡片文件引用');
  if ((await fs.lstat(root)).isSymbolicLink()) throw Error('卡片目录不能使用链接');
  const directory = path.join(root, folder);
  if (create) await fs.mkdir(directory, { recursive: true });
  if ((await fs.lstat(directory)).isSymbolicLink()) throw Error('卡片子目录不能使用链接');
  const file = path.join(directory, name);
  try { if (!(await fs.lstat(file)).isFile() || (await fs.lstat(file)).isSymbolicLink()) throw Error('卡片文件必须是普通文件'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return file;
}
async function putObject(root, folder, value) {
  const serialized = JSON.stringify(value), key = hash(serialized);
  const file = await scopedFile(root, folder, `${key}.json`, true);
  try { await fs.writeFile(file, serialized, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; if (hash(await fs.readFile(file)) !== key) throw Error('卡片历史文件完整性校验失败'); }
  return key;
}
async function readObject(root, folder, key) {
  if (!/^[a-f0-9]{64}$/.test(key || '')) throw Error('卡片版本引用无效');
  const bytes = await fs.readFile(await scopedFile(root, folder, `${key}.json`));
  if (hash(bytes) !== key) throw Error('卡片历史文件已变化');
  return JSON.parse(bytes);
}
async function readAttachment(root, attachment) {
  if (!attachment || attachment.objectId !== attachment.sha256 + attachment.extension || !/^[a-f0-9]{64}$/.test(attachment.sha256)) throw Error('作答文件引用无效');
  const file = await scopedFile(root, 'answers', attachment.objectId);
  const bytes = await fs.readFile(file);
  if (hash(bytes) !== attachment.sha256 || bytes.length !== attachment.bytes) throw Error('作答原件校验失败');
  return { path: file, bytes };
}
module.exports = { hash, scopedFile, putObject, readObject, readAttachment };
