'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function endpoint(value, mode) {
  let url; try { url = new URL(String(value || '')); } catch { throw Error('请输入完整转写服务地址'); }
  if (!['cloud', 'local'].includes(mode) || url.username || url.password || url.search || url.hash) throw Error('转写模式或服务地址无效');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (mode === 'local' ? !loopback || !['http:', 'https:'].includes(url.protocol)
    : url.protocol !== 'https:' || loopback || /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[|0\.)/.test(url.hostname)) throw Error(mode === 'local' ? '本地引擎仅允许本机回环地址' : '云端引擎必须使用公开 HTTPS 地址');
  return url.href.replace(/\/+$/, '');
}
function createAudioTranscription({ directory, protect, unprotect, request = fetch }) {
  const file = path.join(directory, 'audio-transcription.json'); let queue = Promise.resolve();
  const defaults = () => ({ schema: 'audio-transcription.v1', mode: 'local', profiles: {
    cloud: { baseUrl: 'https://api.openai.com/v1', model: 'whisper-1', language: 'zh' },
    local: { baseUrl: 'http://127.0.0.1:8000/v1', model: 'whisper-1', language: 'zh' },
  } });
  async function load() {
    try { if ((await fs.lstat(file)).isSymbolicLink()) throw Error('配置文件不能使用链接'); return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return defaults(); throw error; }
  }
  const publicState = state => ({ mode: state.mode, profiles: Object.fromEntries(Object.entries(state.profiles).map(([mode, profile]) => [mode,
    { baseUrl: profile.baseUrl, model: profile.model, language: profile.language, hasApiKey: !!profile.secret, lastCheck: profile.lastCheck || null }])) });
  function serialize(work) { const job = queue.catch(() => {}).then(work); queue = job; return job; }
  async function save(input) { return serialize(async () => {
    const state = await load(), mode = input?.mode; const baseUrl = endpoint(input?.baseUrl, mode);
    const model = String(input?.model || '').trim(), language = String(input?.language || '').trim();
    if (!model || model.length > 120 || /[\x00-\x1f]/.test(model) || (language && !/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(language))) throw Error('模型名或语言代码无效');
    const old = state.profiles[mode]; const key = String(input.apiKey || '').trim();
    if (key.length > 4096 || /[\r\n]/.test(key)) throw Error('密钥格式无效');
    if (old.secret && old.baseUrl !== baseUrl && !key && !input.clearApiKey) throw Error('服务地址改变时请重新输入或清除密钥，避免发送到另一服务');
    const secret = key ? await protect(key) : input.clearApiKey ? '' : old.secret || '';
    state.mode = mode; state.profiles[mode] = { baseUrl, model, language, secret, lastCheck: null };
    await fs.mkdir(directory, { recursive: true }); if ((await fs.lstat(directory)).isSymbolicLink()) throw Error('配置目录不能使用链接');
    const temp = file + '.' + crypto.randomUUID() + '.tmp';
    try { await fs.writeFile(temp, JSON.stringify(state), { flag: 'wx', mode: 0o600 }); await fs.rename(temp, file); }
    finally { await fs.rm(temp, { force: true }); }
    return publicState(state);
  }); }
  async function config() {
    const state = await load(), profile = state.profiles[state.mode]; endpoint(profile.baseUrl, state.mode);
    return { ...profile, mode: state.mode, apiKey: profile.secret ? await unprotect(profile.secret) : '' };
  }
  async function json(response) {
    if (!response.ok) throw Error(`转写服务返回 HTTP ${response.status}；请检查地址、密钥、模型与兼容接口`);
    const reader = response.body?.getReader(); let total = 0; const chunks = [];
    if (!reader) throw Error('服务没有返回内容');
    try { while (true) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > 1024 * 1024) { await reader.cancel(); throw Error('转写服务响应过大'); } chunks.push(Buffer.from(value)); } }
    finally { reader.releaseLock(); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Error('服务未返回兼容 JSON'); }
  }
  const headers = profile => profile.apiKey ? { authorization: `Bearer ${profile.apiKey}` } : {};
  return {
    get: async () => publicState(await load()), save,
    test: async () => {
      const profile = await config();
      const result = await json(await request(`${profile.baseUrl}/models`, { headers: headers(profile), redirect: 'error', signal: AbortSignal.timeout(15000) }));
      if (!Array.isArray(result.data) || !result.data.some(item => item.id === profile.model)) throw Error('服务可连接，但未发现所选模型；不能确认该转写模型可用');
      return { checkedAt: new Date().toISOString(), message: '连接与模型列表检查通过；未发送音频，不代表实际转写已验收。' };
    },
    transcribe: async ({ bytes, filename, consent }) => {
      const profile = await config();
      if (profile.mode === 'cloud' && consent !== true) throw Error('云端转写会上传所选音频，必须明确授权本次发送');
      if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 20 * 1024 * 1024) throw Error('音频大小无效');
      const ext = path.extname(String(filename || '')).toLowerCase();
      if (!['.webm', '.wav', '.mp3', '.m4a', '.ogg', '.mp4'].includes(ext)) throw Error('不支持该音频格式');
      const form = new FormData(); form.append('file', new Blob([bytes]), `recording${ext}`); form.append('model', profile.model); form.append('response_format', 'json');
      if (profile.language) form.append('language', profile.language);
      const result = await json(await request(`${profile.baseUrl}/audio/transcriptions`, { method: 'POST', headers: headers(profile), body: form, redirect: 'error', signal: AbortSignal.timeout(90000) }));
      if (typeof result.text !== 'string' || !result.text.trim()) throw Error('转写服务没有返回有效文本');
      return { text: result.text.trim(), mode: profile.mode, model: profile.model };
    },
  };
}
module.exports = { createAudioTranscription, endpoint };
