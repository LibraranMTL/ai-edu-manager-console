'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
function text(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\x00-\x1f]/.test(value)) throw new Error(`${label}格式无效`);
  return value.trim();
}
function subjects(input) {
  if (!Array.isArray(input) || input.length > 60) throw new Error('最多设置 60 个自定义学科或课程');
  const names = new Set();
  return input.map(item => {
    const name = text(item.name, 60, '学科或课程名称');
    if (names.has(name.toLowerCase()) || ['全部学科', '综合/未分类'].includes(name)) throw new Error('学科名称重复或使用了保留名称');
    names.add(name.toLowerCase());
    if (!Array.isArray(item.keywords) || !item.keywords.length || item.keywords.length > 20) throw new Error('请设置 1 至 20 个分类关键词');
    return { name, keywords: [...new Set(item.keywords.map(word => text(word, 80, '分类关键词')))] };
  });
}
function tool(input) {
  const name = text(input.name, 60, '工具名称');
  const target = text(input.target, 2048, '工具地址');
  if (input.kind === 'web') {
    const url = new URL(target);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('网页工具须使用不含凭据的 HTTPS 地址');
    return { name, kind: 'web', target: url.href };
  }
  if (input.kind !== 'exe' || !path.win32.isAbsolute(target) || !/\.exe$/i.test(target) || target.startsWith('\\\\')) throw new Error('请选择本机绝对路径的 EXE；不支持命令脚本或网络共享');
  return { name, kind: 'exe', target };
}
function createCustomOptions({ toolsDir, resolveStudentDir, launchWeb, launchExe }) {
  let queue = Promise.resolve();
  async function read(dir, name) {
    await fs.mkdir(dir, { recursive: true });
    const stat = await fs.lstat(dir);
    if (stat.isSymbolicLink()) throw new Error('配置目录不能是符号链接');
    const file = path.join(dir, name);
    try {
      if ((await fs.lstat(file)).isSymbolicLink()) throw new Error('配置文件不能是符号链接');
      return JSON.parse(await fs.readFile(file, 'utf8')).items;
    } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async function write(dir, name, items) {
    await read(dir, name);
    const file = path.join(dir, name), temp = `${file}.${crypto.randomUUID()}.tmp`;
    try { await fs.writeFile(temp, JSON.stringify({ version: 1, items }), { flag: 'wx', mode: 0o600 }); await fs.rename(temp, file); }
    finally { await fs.rm(temp, { force: true }); }
    return items;
  }
  function mutate(work) { const result = queue.catch(() => {}).then(work); queue = result; return result; }
  async function listTools() { return read(toolsDir, 'custom-agent-tools.json'); }
  return {
    getSubjects: async id => subjects(await read(await resolveStudentDir(id), 'custom-subjects.json')),
    saveSubjects: (id, input) => mutate(async () => write(await resolveStudentDir(id), 'custom-subjects.json', subjects(input))),
    listTools,
    addTool: input => mutate(async () => {
      const value = tool(input), items = await listTools();
      if (items.length >= 40 || items.some(item => item.name.toLowerCase() === value.name.toLowerCase())) throw new Error('工具名称重复或已达到 40 个工具上限');
      if (value.kind === 'exe' && !(await fs.stat(value.target)).isFile()) throw new Error('EXE 文件不存在');
      items.push({ id: `custom:${crypto.randomUUID()}`, ...value, createdAt: Date.now(), structuredTasks: false, webResearch: false });
      return write(toolsDir, 'custom-agent-tools.json', items);
    }),
    removeTool: id => mutate(async () => write(toolsDir, 'custom-agent-tools.json', (await listTools()).filter(item => item.id !== id))),
    openTool: async id => {
      const saved = (await listTools()).find(item => item.id === id);
      if (!saved) throw new Error('自定义工具不存在');
      const value = tool(saved);
      if (value.kind === 'web') await launchWeb(value.target);
      else { if (!(await fs.stat(value.target)).isFile()) throw new Error('EXE 文件已移动或删除'); await launchExe(value.target); }
      return { opened: true, structuredTasks: false, webResearch: false };
    },
  };
}
module.exports = { subjects, tool, createCustomOptions };
