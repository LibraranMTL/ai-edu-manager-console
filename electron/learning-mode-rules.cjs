'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROLES = ['host', 'student'];
const DEFAULT_RULES = Object.freeze({
  games: true,
  websites: ['douyin.com', 'bilibili.com', 'b23.tv', 'kuaishou.com', 'ixigua.com'],
  allowedUrls: [],
  blockedApps: [],
  allowedApps: [],
});
const GAME_CATALOG = Object.freeze([
  { file: 'steam.exe', signer: 'Valve Corp.', name: 'Steam' },
  { file: 'epicgameslauncher.exe', signer: 'Epic Games, Inc.', name: 'Epic Games Launcher' },
  { file: 'robloxplayerbeta.exe', signer: 'Roblox Corporation', name: 'Roblox' },
  { file: 'riotclientservices.exe', signer: 'Riot Games, Inc.', name: 'Riot Client' },
  { file: 'valorant.exe', signer: 'Riot Games, Inc.', name: 'VALORANT' },
  { file: 'battle.net.exe', signer: 'Blizzard Entertainment, Inc.', name: 'Battle.net' },
  { file: 'douyin.exe', signer: 'Beijing Microlive Vision Technology Co., Ltd.', name: '抖音' },
]);

function rootPath() {
  return path.join(process.env.LOCALAPPDATA || os.homedir(), 'QXMatrix', 'LearningMode');
}
function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return fallback; }
}
function statePath(role, root = rootPath()) {
  if (!ROLES.includes(role)) throw Error('INVALID_CLIENT');
  return path.join(root, role + '.json');
}
function active(state, now = Date.now()) {
  return state?.enabled === true && !(Number(state.pauseUntil) > now);
}
function list(value, parse) {
  if (!Array.isArray(value) || value.length > 100) throw Error('每组规则最多 100 条。');
  return [...new Set(value.map(parse))];
}
function urlValue(value) {
  if (typeof value !== 'string' || value.length > 600) throw Error('课程链接最多 600 个字符。');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) throw Error('课程例外须为 HTTPS 页面。');
  return url.href;
}
function rulesFrom(value) {
  const domain = (v) => {
    const host = String(v).trim().toLowerCase();
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]*$/.test(host)) throw Error('请输入有效的站点域名。');
    return host;
  };
  const fingerprint = (v) => {
    if (typeof v !== 'string' || !/^[0-9a-f]{64}$/i.test(v)) throw Error('应用规则需要有效文件指纹。');
    return v.toLowerCase();
  };
  return {
    games: value.games === true,
    websites: list(value.websites, domain),
    allowedUrls: list(value.allowedUrls, urlValue),
    blockedApps: list(value.blockedApps, fingerprint),
    allowedApps: list(value.allowedApps, fingerprint),
  };
}
function activeSources(root = rootPath(), now = Date.now()) {
  return ROLES.map(role => ({ role, state: readJson(statePath(role, root)) }))
    .filter(({ role, state }) => active(state, now) && installed(role, root))
    .map(({ role, state }) => ({ role, revision: state.revision, rules: state.rules }));
}
function installed(role, root = rootPath()) {
  const executable = readJson(path.join(root, role, 'installation.json'))?.runtimeExe;
  return typeof executable === 'string' && fs.existsSync(executable);
}
function blockedBy(url, sources) {
  try {
    const page = new URL(url);
    if (!['http:', 'https:'].includes(page.protocol)) return null;
    page.hash = '';
    return sources.find(({ rules }) => !rules.allowedUrls.includes(page.href)
      && rules.websites.some(host => page.hostname === host || page.hostname.endsWith('.' + host))) || null;
  } catch { return null; }
}
function applicationDecision(app, rules) {
  if (!app.hash || rules.allowedApps.includes(app.hash)) return 'allow';
  if (rules.blockedApps.includes(app.hash)) return 'block';
  if (!rules.games) return 'allow';
  const catalog = GAME_CATALOG.find(item => item.file === app.file);
  if (catalog && app.signatureValid && app.signer?.toLowerCase() === catalog.signer.toLowerCase()) return 'block';
  if (catalog || /\b(?:game|gaming|roblox|steam|riot games|unity player)\b/i.test(app.product || '')) return 'review';
  return 'allow';
}

module.exports = { ROLES, DEFAULT_RULES, GAME_CATALOG, rootPath, readJson, statePath, active, rulesFrom, activeSources, installed, blockedBy, applicationDecision };
