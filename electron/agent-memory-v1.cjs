const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const AGENT_MEMORY_SCHEMA = 'edu-manager.agent-memory.v1';
const DEFAULT_HANDOFF_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CAPTURE_MESSAGES = 300;
const MAX_CAPTURE_CHARS = 60_000;

function bounded(value, limit = 4000) {
  return String(value || '').trim().slice(0, limit);
}

function stringList(value, limit = 20, itemLimit = 1000) {
  return (Array.isArray(value) ? value : [])
    .map((item) => bounded(item, itemLimit))
    .filter(Boolean)
    .slice(0, limit);
}

function stableSegment(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 32);
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
}

function readJson(file, fallback) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeSummary(value = {}) {
  return {
    objective: bounded(value.objective, 2000),
    completed: stringList(value.completed),
    decisions: stringList(value.decisions),
    openLoops: stringList(value.openLoops),
    risks: stringList(value.risks),
    nextSteps: stringList(value.nextSteps),
  };
}

function normalizeObservation(value = {}, now = new Date().toISOString()) {
  return {
    observationId: bounded(value.observationId, 240) || `observation-${crypto.randomUUID()}`,
    type: bounded(value.type, 80) || 'progress',
    summary: bounded(value.summary, 4000),
    sourceLocator: bounded(value.sourceLocator, 1000),
    contentHash: bounded(value.contentHash, 128),
    occurredAt: bounded(value.occurredAt, 80) || now,
  };
}

function normalizeMessage(value = {}, now = new Date().toISOString()) {
  const role = ['user', 'assistant', 'tool', 'system', 'unknown'].includes(String(value.role || '').toLowerCase())
    ? String(value.role).toLowerCase()
    : 'unknown';
  const content = bounded(value.content ?? value.text, 20_000);
  const occurredAt = bounded(value.occurredAt || value.createdAt, 80) || now;
  const suppliedEventId = bounded(value.eventId || value.messageId, 240);
  return {
    eventId: suppliedEventId || `message-${stableSegment(`${role}\n${occurredAt}\n${content}`)}`,
    role,
    content,
    occurredAt,
    ...(value.turnMarker ? { turnMarker: bounded(value.turnMarker, 64) } : {}),
  };
}

function normalizeSettings(value = {}) {
  return {
    automationEnabled: value.automationEnabled === true,
    allowedAgents: stringList(value.allowedAgents, 30, 120),
    captureEpoch: bounded(value.captureEpoch, 120),
    captureAuthorizedAt: bounded(value.captureAuthorizedAt, 80),
    retentionDays: Math.max(1, Math.min(180, Number(value.retentionDays || 30))),
    updatedAt: bounded(value.updatedAt, 80),
  };
}

function createAgentMemoryStore(options = {}) {
  const rootDir = path.resolve(String(options.rootDir || '.agent-memory-v1'));
  const clock = typeof options.now === 'function' ? options.now : () => new Date().toISOString();

  function studentDir(studentId) {
    if (!bounded(studentId)) throw new Error('studentId is required.');
    return path.join(rootDir, stableSegment(studentId));
  }

  function sessionPath(studentId, sessionId) {
    if (!bounded(sessionId)) throw new Error('sessionId is required.');
    return path.join(studentDir(studentId), 'sessions', `${stableSegment(sessionId)}.json`);
  }

  function settingsPath(studentId) {
    return path.join(studentDir(studentId), 'settings.json');
  }

  function readSession(studentId, sessionId) {
    return readJson(sessionPath(studentId, sessionId), null);
  }

  function saveSession(session) {
    writeJsonAtomic(sessionPath(session.studentId, session.sessionId), session);
    return session;
  }

  function listSessions(input = {}) {
    const studentId = bounded(input.studentId);
    const directory = path.join(studentDir(studentId), 'sessions');
    if (!fs.existsSync(directory)) return [];
    const nowMs = Date.parse(clock());
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => readJson(path.join(directory, entry.name), null))
      .filter((session) => session?.schema === AGENT_MEMORY_SCHEMA && session.studentId === studentId)
      .filter((session) => input.includeDeleted === true || session.status !== 'deleted')
      .map((session) => {
        if (session.handoff?.status === 'pending' && Date.parse(session.handoff.expiresAt || '') <= nowMs) {
          session.handoff.status = 'expired';
          session.handoff.updatedAt = clock();
          saveSession(session);
        }
        return session;
      })
      .filter((session) => !input.projectId || session.projectId === bounded(input.projectId))
      .sort((left, right) => Date.parse(right.updatedAt || right.startedAt || '') - Date.parse(left.updatedAt || left.startedAt || ''))
      .slice(0, Math.max(1, Math.min(100, Number(input.limit || 20))));
  }

  function getSettings(studentId) {
    const saved = normalizeSettings(readJson(settingsPath(studentId), {}));
    return typeof options.resolveSettings === 'function' ? normalizeSettings(options.resolveSettings(studentId, saved)) : saved;
  }

  function updateSettings(studentId, patch = {}) {
    const current = getSettings(studentId);
    const settings = normalizeSettings({ ...current, ...patch, updatedAt: clock() });
    writeJsonAtomic(settingsPath(studentId), { schema: AGENT_MEMORY_SCHEMA, studentId: bounded(studentId), ...settings });
    return settings;
  }

  function startSession(input = {}) {
    const studentId = bounded(input.studentId);
    const projectId = bounded(input.projectId);
    const agentId = bounded(input.agentId, 120) || 'unknown-agent';
    if (!studentId) throw new Error('studentId is required.');
    const requestedSessionId = bounded(input.sessionId, 240);
    if (requestedSessionId) {
      const existingById = readSession(studentId, requestedSessionId);
      if (existingById) {
        if (existingById.projectId !== projectId || existingById.agentId !== agentId) throw new Error('Agent memory session identity mismatch.');
        return { session: existingById, reused: true };
      }
    }
    const idempotencyKey = bounded(input.idempotencyKey, 500);
    if (idempotencyKey) {
      const existing = listSessions({ studentId, projectId, limit: 100 }).find((item) => item.idempotencyKey === idempotencyKey);
      if (existing) return { session: existing, reused: true };
    }
    const now = clock();
    const session = {
      schema: AGENT_MEMORY_SCHEMA,
      sessionId: requestedSessionId || `agent-session-${crypto.randomUUID()}`,
      idempotencyKey,
      studentId,
      projectId,
      agentId,
      origin: bounded(input.origin, 80) || 'unspecified',
      title: bounded(input.title || input.objective, 500),
      sourceNodeId: bounded(input.sourceNodeId, 240),
      workspacePath: bounded(input.workspacePath, 2000),
      repositoryPath: bounded(input.repositoryPath, 2000),
      taskId: bounded(input.taskId, 240),
      status: 'active',
      startedAt: now,
      updatedAt: now,
      finalizedAt: '',
      observations: [],
      messages: [],
      capturedChars: 0,
      conversationReceipt: null,
      summary: normalizeSummary({ objective: input.objective }),
      handoff: null,
      finalizationKey: '',
    };
    return { session: saveSession(session), reused: false };
  }

  function requireSession(input = {}) {
    const session = readSession(bounded(input.studentId), bounded(input.sessionId));
    if (!session) throw new Error('Agent memory session was not found.');
    if (session.studentId !== bounded(input.studentId)) throw new Error('Agent memory session scope mismatch.');
    if (input.projectId && session.projectId !== bounded(input.projectId)) throw new Error('Agent memory project scope mismatch.');
    return session;
  }

  function appendObservation(input = {}) {
    const session = requireSession(input);
    if (session.status !== 'active') throw new Error('Only active sessions accept observations.');
    const observation = normalizeObservation(input.observation || input, clock());
    if (!observation.summary) throw new Error('Observation summary is required.');
    if (!session.observations.some((item) => item.observationId === observation.observationId)) {
      session.observations = [...session.observations, observation].slice(-100);
      session.updatedAt = clock();
      saveSession(session);
    }
    return { session, observation };
  }

  function appendMessages(input = {}) {
    const session = requireSession(input);
    if (session.status !== 'active') throw new Error('Only active sessions accept messages.');
    const incoming = Array.isArray(input.messages) ? input.messages : [];
    if (!incoming.length) throw new Error('At least one authorized conversation message is required.');
    const existing = Array.isArray(session.messages) ? session.messages : [];
    const knownIds = new Set(existing.map((item) => item.eventId).filter(Boolean));
    let capturedChars = Number(session.capturedChars || existing.reduce((total, item) => total + String(item.content || '').length, 0));
    const accepted = [];
    let skippedProtected = 0;
    let truncated = false;
    for (const value of incoming) {
      if (existing.length + accepted.length >= MAX_CAPTURE_MESSAGES || capturedChars >= MAX_CAPTURE_CHARS) {
        truncated = true;
        break;
      }
      const message = normalizeMessage(value, clock());
      if (message.role === 'system') {
        skippedProtected += 1;
        continue;
      }
      if (!message.content || knownIds.has(message.eventId)) continue;
      const remaining = MAX_CAPTURE_CHARS - capturedChars;
      if (message.content.length > remaining) {
        message.content = message.content.slice(0, remaining);
        truncated = true;
      }
      if (!message.content) break;
      knownIds.add(message.eventId);
      accepted.push(message);
      capturedChars += message.content.length;
    }
    if (accepted.length) {
      session.messages = [...existing, ...accepted];
      session.capturedChars = capturedChars;
      session.updatedAt = clock();
      saveSession(session);
    }
    return {
      session,
      accepted: accepted.length,
      duplicateOrEmpty: incoming.length - accepted.length,
      skippedProtected,
      truncated,
    };
  }

  function attachConversationReceipt(input = {}) {
    const session = requireSession(input);
    if (session.status === 'deleted') throw new Error('Deleted Agent memory sessions cannot be restored by a receipt.');
    session.conversationReceipt = input.receipt && typeof input.receipt === 'object'
      ? JSON.parse(JSON.stringify(input.receipt))
      : null;
    session.updatedAt = clock();
    return { session: saveSession(session) };
  }

  function updateArchivedAssetLifecycle(input = {}) {
    const studentId = bounded(input.studentId);
    const assetId = bounded(input.assetId, 240);
    const action = bounded(input.action, 20);
    if (!studentId || !assetId || !['trash', 'restore', 'delete'].includes(action)) {
      throw new Error('A student, archived asset, and valid lifecycle action are required.');
    }
    const directory = path.join(studentDir(studentId), 'sessions');
    if (!fs.existsSync(directory)) return { matched: 0, changed: 0, sessionIds: [] };
    let matched = 0;
    let changed = 0;
    const sessionIds = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const session = readJson(path.join(directory, entry.name), null);
      if (session?.studentId !== studentId || String(session?.conversationReceipt?.assetId || '') !== assetId) continue;
      matched += 1;
      sessionIds.push(session.sessionId);
      if (session.status === 'deleted') {
        if (action !== 'delete') throw new Error('A permanently deleted Agent conversation cannot be restored.');
        continue;
      }
      if (!session.finalizedAt) throw new Error('An active Agent conversation cannot be managed as an archived asset.');
      const now = clock();
      if (action === 'delete') {
        // Keep only an identity tombstone so a late lifecycle event cannot recreate the erased conversation.
        saveSession({
          schema: AGENT_MEMORY_SCHEMA,
          sessionId: session.sessionId,
          idempotencyKey: session.idempotencyKey,
          studentId,
          projectId: session.projectId || '',
          agentId: session.agentId,
          origin: session.origin,
          status: 'deleted',
          materialLifecycleStatus: 'deleted',
          finalizedAt: session.finalizedAt,
          finalizationKey: session.finalizationKey,
          deletedAt: now,
          updatedAt: now,
          conversationReceipt: { assetId, status: 'deleted' },
        });
      } else {
        session.materialLifecycleStatus = action === 'trash' ? 'trashed' : 'active';
        session.updatedAt = now;
        if (action === 'trash' && session.handoff?.status === 'pending') {
          session.handoff.status = 'cancelled';
          session.handoff.updatedAt = now;
        }
        saveSession(session);
      }
      changed += 1;
    }
    return { matched, changed, sessionIds };
  }

  function deleteEmptySessions(input = {}) {
    const studentId = bounded(input.studentId);
    const requestedId = bounded(input.sessionId, 240);
    const directory = path.join(studentDir(studentId), 'sessions');
    if (!fs.existsSync(directory)) return { deleted: 0, remaining: 0 };
    let deleted = 0;
    let remaining = 0;
    const limit = requestedId ? 1 : 200;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const session = readJson(path.join(directory, entry.name), null);
      if (session?.schema !== AGENT_MEMORY_SCHEMA || session.studentId !== studentId
        || session.origin !== 'authorized_agent' || session.status === 'active' || session.status === 'deleted'
        || session.conversationReceipt || (session.messages || []).length || (session.observations || []).length
        || (requestedId && session.sessionId !== requestedId)) continue;
      if (deleted >= limit) { remaining += 1; continue; }
      const now = clock();
      saveSession({
        schema: AGENT_MEMORY_SCHEMA,
        studentId,
        sessionId: session.sessionId,
        idempotencyKey: session.idempotencyKey,
        projectId: session.projectId || '',
        agentId: session.agentId,
        origin: session.origin,
        status: 'deleted',
        finalizedAt: session.finalizedAt || now,
        finalizationKey: session.finalizationKey || '',
        updatedAt: now,
        deletedAt: now,
      });
      deleted += 1;
    }
    return { deleted, remaining };
  }

  function finalizeSession(input = {}) {
    const session = requireSession(input);
    const finalizationKey = bounded(input.idempotencyKey, 500);
    if (session.finalizedAt && finalizationKey && session.finalizationKey === finalizationKey) {
      return { session, reused: true };
    }
    if (session.finalizedAt) throw new Error('Agent memory session is already finalized.');
    const now = clock();
    session.status = ['completed', 'failed', 'cancelled'].includes(String(input.status)) ? String(input.status) : 'completed';
    session.summary = normalizeSummary({ ...session.summary, ...(input.summary || {}) });
    session.finalizedAt = now;
    session.updatedAt = now;
    session.finalizationKey = finalizationKey;
    const targetAgent = bounded(input.handoff?.targetAgent, 120);
    if (targetAgent || session.summary.openLoops.length || session.summary.nextSteps.length) {
      const ttlMs = Math.max(60 * 1000, Math.min(30 * 24 * 60 * 60 * 1000, Number(input.handoff?.ttlMs || DEFAULT_HANDOFF_TTL_MS)));
      session.handoff = {
        handoffId: bounded(input.handoff?.handoffId, 240) || `handoff-${crypto.randomUUID()}`,
        fromAgent: session.agentId,
        targetAgent: targetAgent || 'any-agent',
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(Date.parse(now) + ttlMs).toISOString(),
        acceptedBy: '',
        acceptedAt: '',
      };
    }
    return { session: saveSession(session), reused: false };
  }

  function recentContext(input = {}) {
    const sessions = listSessions({ studentId: input.studentId, projectId: input.projectId, limit: input.limit || 5 });
    const agentId = bounded(input.agentId, 120);
    const relevant = sessions.filter((session) => (
      session.status !== 'cancelled'
      && session.materialLifecycleStatus !== 'trashed'
      && session.status !== 'deleted'
      && (!session.handoff || session.handoff.status !== 'pending' || ['any-agent', agentId].includes(session.handoff.targetAgent))
    ));
    return {
      schema: AGENT_MEMORY_SCHEMA,
      studentId: bounded(input.studentId),
      projectId: bounded(input.projectId),
      generatedAt: clock(),
      sessions: relevant.map((session) => ({
        sessionId: session.sessionId,
        projectId: session.projectId || '',
        agentId: session.agentId,
        taskId: session.taskId,
        status: session.status,
        updatedAt: session.updatedAt,
        messageCount: Array.isArray(session.messages) ? session.messages.length : 0,
        summary: normalizeSummary(session.summary),
        handoff: session.handoff?.status === 'pending' ? session.handoff : null,
      })),
    };
  }

  function updateHandoff(input = {}, action) {
    const session = requireSession(input);
    if (!session.handoff || session.handoff.handoffId !== bounded(input.handoffId)) throw new Error('Handoff was not found.');
    if (session.handoff.status !== 'pending') return { session, reused: true };
    const now = clock();
    if (Date.parse(session.handoff.expiresAt || '') <= Date.parse(now)) {
      session.handoff.status = 'expired';
    } else if (action === 'accept') {
      const agentId = bounded(input.agentId, 120) || 'unknown-agent';
      if (!['any-agent', agentId].includes(session.handoff.targetAgent)) throw new Error('Handoff target Agent mismatch.');
      session.handoff.status = 'accepted';
      session.handoff.acceptedBy = agentId;
      session.handoff.acceptedAt = now;
    } else {
      session.handoff.status = 'cancelled';
    }
    session.handoff.updatedAt = now;
    session.updatedAt = now;
    return { session: saveSession(session), reused: false };
  }

  return {
    acceptHandoff: (input) => updateHandoff(input, 'accept'),
    appendMessages,
    appendObservation,
    attachConversationReceipt,
    cancelHandoff: (input) => updateHandoff(input, 'cancel'),
    deleteEmptySessions,
    finalizeSession,
    getSettings,
    listSessions,
    recentContext,
    readSession,
    startSession,
    updateArchivedAssetLifecycle,
    updateSettings,
  };
}

module.exports = {
  AGENT_MEMORY_SCHEMA,
  DEFAULT_HANDOFF_TTL_MS,
  MAX_CAPTURE_CHARS,
  MAX_CAPTURE_MESSAGES,
  createAgentMemoryStore,
  normalizeSummary,
};
