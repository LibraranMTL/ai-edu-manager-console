'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
function createObsidianVaults({ registryPath, installed, running, open }) {
  let queue = Promise.resolve();
  return { open: directory => {
    const job = queue.catch(() => {}).then(async () => {
      if (!await installed()) throw Error('未发现 Obsidian 协议处理程序；请安装并运行一次 Obsidian 后重试');
      const dir = path.resolve(directory || '');
      if (!directory || dir === path.parse(dir).root) throw Error('Vault 目录范围无效');
      const stat = await fs.lstat(dir); if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Vault 必须是当前受控目录，不能使用目录链接');
      let raw = '', state = { vaults: {} };
      try { if ((await fs.lstat(registryPath)).isSymbolicLink()) throw Error('Obsidian 登记文件不能使用链接'); raw = await fs.readFile(registryPath, 'utf8'); state = JSON.parse(raw); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!state.vaults || typeof state.vaults !== 'object' || Array.isArray(state.vaults)) throw Error('Obsidian Vault 登记格式不兼容，未改写原配置');
      const key = value => path.resolve(value).toLowerCase();
      let id = Object.keys(state.vaults).find(id => typeof state.vaults[id]?.path === 'string' && key(state.vaults[id].path) === key(dir));
      const created = !id;
      // Obsidian caches its registry. Do not overwrite a running application's state.
      if (created && await running()) throw Error('首次登记新 Vault 请先保存并退出 Obsidian，再点击本按钮；已有 Vault 可直接打开');
      const configDir = path.join(dir, '.obsidian');
      try { if ((await fs.lstat(configDir)).isSymbolicLink()) throw Error('已有 Vault 配置目录不能使用链接'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (created) {
        await fs.mkdir(path.dirname(registryPath), { recursive: true });
        let current = ''; try { current = await fs.readFile(registryPath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (current !== raw) throw Error('Obsidian 配置同时发生变化，未覆盖；请重试');
        if (raw) await fs.writeFile(`${registryPath}.edu-backup-${crypto.randomUUID()}`, raw, { flag: 'wx', mode: 0o600 });
        id = crypto.randomBytes(8).toString('hex'); state.vaults[id] = { path: dir, ts: Date.now(), open: true };
        await fs.mkdir(configDir, { recursive: true });
        const temp = `${registryPath}.${crypto.randomUUID()}.tmp`;
        try { await fs.writeFile(temp, JSON.stringify(state), { flag: 'wx', mode: 0o600 }); await fs.rename(temp, registryPath); }
        finally { await fs.rm(temp, { force: true }); }
      }
      await open(`obsidian://open?vault=${encodeURIComponent(id)}`);
      return { path: dir, created, message: created ? '已将当前目录登记为 Vault，并请求 Obsidian 打开；资料未复制。' : '已请求 Obsidian 打开已有 Vault；原配置未覆盖。' };
    }); queue = job; return job;
  } };
}
module.exports = { createObsidianVaults };
