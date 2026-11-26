'use strict';
const path = require('node:path');
const C = require('./smart-inbox-conversation.cjs');

function readableContent(raw) {
  const original = String(raw || '');
  try {
    const value = JSON.parse(original);
    if (value?.schema === 'edu-manager.agent-conversation-submission.v1' && Array.isArray(value.messages)) {
      const segments = value.messages.filter(m => typeof m.content === 'string').map((m, index) => ({
        index, role: String(m.role || ''), text: m.content }));
      return { text: segments.map(s => `[${s.role}]\n${s.text}`).join('\n\n'), segments };
    }
  } catch { /* A normal document is already readable. */ }
  return { text: original, segments: [{ index: 0, role: 'document', text: original }] };
}
function quoteExists(raw, quote) {
  if (typeof quote !== 'string') return false;
  const normalize = s => s.replace(/\r\n/g, '\n');
  return normalize(String(raw)).includes(normalize(quote))
    || readableContent(raw).segments.some(s => normalize(s.text).includes(normalize(quote)));
}
function parseRoutingResult(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 200 * 1024) throw Object.assign(Error('分类结果不是受控JSON对象'), { code: 'ROUTING_JSON_INVALID' });
  const text = raw.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1');
  try { return JSON.parse(text); } catch { throw Object.assign(Error('分类结果不是有效JSON'), { code: 'ROUTING_JSON_INVALID' }); }
}
// Credentials are not routing evidence. Keep originals and fingerprints intact;
// sanitize only the outbound model request, including retained context strings.
function redactRoutingText(value) {
  let count = 0;
  const replace = (...args) => { count++; return args[1] + '[凭据已隐藏]'; };
  const text = String(value).replace(/(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    () => { count++; return '[私钥已隐藏]'; })
    .replace(/((?:登录密码|管理员密码|管理密码|授权密码|激活码|兑换码|购买码|password|passwd|api[_ -]?key|access[_ -]?token|client[_ -]?secret|secret)[^\r\n:：=]{0,24}[:：=][ \t*]*(?:\r?\n[ \t]*){0,3}(?:```[a-z]*[ \t]*\r?\n)?[ \t"'`]*)([a-z0-9+\/_.=-]{8,})(?=[ \t"'`]*(?:\r?\n|$|[,，。;}]))/gim, replace)
    .replace(/(\bAuthorization\s*:\s*Bearer\s+)([a-z0-9+\/_.=-]{8,})/gi, replace)
    .replace(/\bsk-[a-z0-9_-]{16,}\b/gi, () => { count++; return '[凭据已隐藏]'; });
  return { text, count };
}
function prepareRoutingInput(text, context) {
  const body = redactRoutingText(readableContent(text).text);
  let count = body.count;
  const sanitize = value => {
    if (typeof value === 'string') { const result = redactRoutingText(value); count += result.count; return result.text; }
    if (Array.isArray(value)) return value.map(sanitize);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sanitize(child)]));
    return value;
  };
  return { text: body.text, context: sanitize(context), redactions: count, policyVersion: 'routing-privacy-v1' };
}
// Only deterministic, fully readable content can authorize recycling. A model
// assessment, extraction failure or missing project candidate cannot do so.
function assessContent({ text = '', name = '', size, sourceType, truncated, blocked }) {
  if (truncated || blocked) return { action: 'recover', reason: 'extraction_incomplete' };
  const extension = path.extname(name).toLowerCase();
  if (size === 0 || ['.md', '.txt', '.csv'].includes(extension) && !String(text).trim()) return { action: 'recycle', reason: 'empty_content' };
  const conversation = C.inspectConversation(text);
  if (conversation.kind === 'internal_task') return { action: 'recycle', reason: 'internal_task' };
  let value;
  try { value = JSON.parse(text); } catch { return { action: text.trim() ? 'classify' : 'recover', reason: 'normal_content' }; }
  if (sourceType !== 'session' || value?.schema !== 'edu-manager.agent-conversation-submission.v1') return { action: 'classify', reason: 'normal_content' };
  const users = (value.messages || []).filter(m => m.role === 'user');
  const test = /^\s*(?:WINCAP-(?:WORKBUDDY(?:-OFFLINE)?|CODEX-DIRECT)-\d{8}-\d+|(?:Windows学生端)?会话采集验收测试(?:问答|标记)?[：:]?\s*WINCAP-[A-Z0-9-]+)[\s。.!！?？]*$/;
  const legacyTest = /^\s*Windows\s+学生端会话采集验收提问\s+WINCAP-(?:WORKBUDDY(?:-OFFLINE)?|CODEX-DIRECT)-\d{8}-\d+[\s。.!！?？]*$/;
  if (users.length && users.every(m => typeof m.content === 'string' && (test.test(m.content) || legacyTest.test(m.content)))) return { action: 'recycle', reason: 'capture_probe' };
  return { action: 'classify', reason: 'normal_content' };
}
module.exports = { readableContent, quoteExists, parseRoutingResult, assessContent, redactRoutingText, prepareRoutingInput };
