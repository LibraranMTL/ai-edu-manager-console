const crypto = require('crypto');

const { AUTO_CAPTURE_AGENT_IDS } = require('./agent-adapter-registry.cjs');

const LIFECYCLE_CAPTURE_SCHEMA = 'edu-manager.agent-lifecycle-event.v1';
const SUPPORTED_AGENTS = AUTO_CAPTURE_AGENT_IDS;

function text(value, limit = 20_000) {
  return String(value ?? '').trim().slice(0, limit);
}

function stableHash(value, size = 32) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, size);
}

function normalizeTimestamp(value, fallback = new Date().toISOString()) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    return new Date(milliseconds).toISOString();
  }
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function eventName(payload = {}) {
  return text(
    payload.hook_event_name
      || payload.hookEventName
      || payload.eventName
      || payload.type,
    120,
  ).toLowerCase();
}

function nativeSessionId(payload = {}) {
  return text(
    payload.session_id
      || payload.sessionId
      || payload.sessionKey
      || payload.event?.sessionId
      || payload.event?.sessionKey
      || payload.context?.sessionId
      || payload.context?.sessionKey
      || payload.context?.conversationId
      || payload.event?.conversationId,
    500,
  );
}

function normalizeLifecycleEnvelope(value = {}) {
  const sourceAgent = text(value.sourceAgent, 120).toLowerCase();
  if (!SUPPORTED_AGENTS.includes(sourceAgent)) throw new Error('Unsupported lifecycle Agent.');
  const payload = value.payload && typeof value.payload === 'object' ? value.payload : {};
  const name = eventName(payload);
  const nativeId = nativeSessionId(payload);
  if (!nativeId) return null;
  const occurredAt = normalizeTimestamp(
    payload.timestamp || payload.occurredAt || payload.event?.timestamp,
    normalizeTimestamp(value.capturedAt),
  );
  let action = '';
  let role = '';
  let content = '';
  let status = 'completed';
  if (['sessionstart', 'session_start', 'on_session_start'].includes(name)) action = 'start';
  else if (['userpromptsubmit', 'message_received', 'pre_llm_call'].includes(name)) {
    action = 'append';
    role = 'user';
    content = text(payload.prompt || payload.user_message || payload.content || payload.event?.content);
  } else if (['stop', 'message_sent', 'post_llm_call'].includes(name)) {
    if (name === 'message_sent' && payload.event?.success === false) return null;
    action = 'append';
    role = 'assistant';
    content = text(payload.last_assistant_message || payload.assistant_response || payload.content || payload.event?.content);
  } else if (['sessionend', 'session_end', 'on_session_end', 'on_session_finalize'].includes(name)) action = 'finalize';
  else if (['interrupt', 'stopfailure'].includes(name)) {
    action = 'finalize';
    status = name === 'stopfailure' ? 'failed' : 'cancelled';
  } else return null;
  if (action === 'append' && !content) return null;
  const sessionId = `lifecycle-${sourceAgent}-${stableHash(nativeId)}`;
  const nativeEventId = text(
    payload.turn_id
      || payload.turnId
      || payload.messageId
      || payload.event?.messageId
      || payload.event?.runId
      || payload.context?.runId,
    300,
  );
  return {
    schema: LIFECYCLE_CAPTURE_SCHEMA,
    sourceAgent,
    scopeId: text(value.scopeId, 240),
    grantId: text(value.grantId, 240),
    nativeSessionId: nativeId,
    sessionId,
    action,
    status,
    title: `${sourceAgent} 授权会话`,
    occurredAt,
    eventId: `lifecycle-event-${stableHash(`${sourceAgent}\n${nativeId}\n${name}\n${nativeEventId}\n${role}\n${content}\n${occurredAt}`, 48)}`,
    message: action === 'append' ? { role, content, occurredAt } : null,
    finalizationKey: `lifecycle-finalize:${sourceAgent}:${stableHash(nativeId, 48)}`,
  };
}

function lifecycleCaptureAllowed(descriptor = {}, sourceAgent = '') {
  const capture = descriptor.lifecycleCapture || {};
  const allowed = Array.isArray(capture.allowedAgents) ? capture.allowedAgents.map((item) => String(item).toLowerCase()) : [];
  return capture.enabled === true && allowed.includes(String(sourceAgent).toLowerCase());
}

module.exports = {
  LIFECYCLE_CAPTURE_SCHEMA,
  SUPPORTED_AGENTS,
  lifecycleCaptureAllowed,
  normalizeLifecycleEnvelope,
  stableHash,
};
