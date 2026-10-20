'use strict';
const DEFAULT_CLOUD_SERVER = 'https://www.greatbg.com/edu-cloud';
function checkedServerUrl(value) {
  const raw = String(value || '').trim();
  if (raw.includes('\\') || /%(?:2e|2f|5c)/i.test(raw) || /\/\.\.?(?:\/|$)/.test(raw)) throw new Error('云端路径不能包含目录跳转');
  const url = new URL(raw);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash ||
      !/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]*$/.test(url.pathname)) {
    throw new Error('云端地址须为 HTTPS 和可选服务路径；仅本机测试允许 HTTP');
  }
  return url.origin + url.pathname.replace(/\/+$/, '');
}
function cloudRequestUrl(base, route) {
  if (!/^\/(?:v[12](?:\/|\?)|health(?:\?|$))/.test(route) || route.includes('..') || route.includes('\\')) throw new Error('云端请求路径无效');
  return checkedServerUrl(base) + route;
}
module.exports = { DEFAULT_CLOUD_SERVER, checkedServerUrl, cloudRequestUrl };
