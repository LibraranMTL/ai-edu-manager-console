const crypto = require('node:crypto');

const AGENT_RESULT_ENVELOPE_SCHEMA = 'edu-manager.agent-result-envelope.v1';

function clean(value) {
  return String(value ?? '').trim();
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function repairJsonBackslashes(value) {
  return String(value || '').replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
}

function jsonSegments(text) {
  const segments = [];
  for (let start = 0; start < text.length; start += 1) {
    if (!['{', '['].includes(text[start])) continue;
    const stack = [];
    let quoted = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') {
        quoted = true;
        continue;
      }
      if (char === '{' || char === '[') stack.push(char);
      if (char === '}' || char === ']') {
        const expected = char === '}' ? '{' : '[';
        if (stack.pop() !== expected) break;
        if (!stack.length) {
          segments.push(text.slice(start, index + 1));
          start = index;
          break;
        }
      }
    }
  }
  return segments;
}

function parseMarkdownRecords(text) {
  const records = [];
  let current = {};
  const push = () => {
    if (Object.keys(current).length) records.push(current);
    current = {};
  };
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      push();
      continue;
    }
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      push();
      current.title = heading[1].trim();
      continue;
    }
    const field = line.match(/^(?:[-*+]\s*)?(?:\*\*)?([^:*：]{1,40})(?:\*\*)?\s*[:：]\s*(.+)$/);
    if (field) {
      const key = field[1].trim();
      const value = field[2].trim().replace(/^['"]|['"]$/g, '');
      if (current[key] !== undefined) push();
      current[key] = value;
      continue;
    }
    const bullet = line.match(/^[-*+]\s+(.+)$/);
    if (bullet) {
      if (current.content) push();
      current.content = bullet[1].trim();
    } else if (Object.keys(current).length) {
      current.content = [current.content, line].filter(Boolean).join('\n');
    }
  }
  push();
  return records.filter((record) => Object.keys(record).length);
}

function parseAgentPayload(input) {
  if (input && typeof input === 'object') return { payload: input, sourceFormat: 'object', rawText: JSON.stringify(input) };
  const rawText = String(input ?? '').replace(/^\uFEFF/, '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();
  if (!rawText) throw new Error('Agent 结果为空。');
  const fenced = [...rawText.matchAll(/```(?:json|javascript|js)?\s*([\s\S]*?)```/gi)].map((match) => match[1].trim()).filter(Boolean);
  const attempts = [rawText, ...fenced, ...jsonSegments(rawText)];
  for (const candidate of [...attempts, ...attempts.map(repairJsonBackslashes)]) {
    try {
      return { payload: JSON.parse(candidate), sourceFormat: fenced.includes(candidate) ? 'fenced_json' : candidate === rawText ? 'json' : 'embedded_json', rawText };
    } catch {
      // Continue through compatible representations.
    }
  }
  const records = parseMarkdownRecords(rawText);
  if (records.length) return { payload: { items: records }, sourceFormat: 'markdown', rawText };
  throw new Error('没有识别到 JSON 或结构化 Markdown 结果。');
}

function valueOf(object, aliases) {
  for (const key of aliases) {
    if (object?.[key] !== undefined && object?.[key] !== null && object?.[key] !== '') return object[key];
  }
  return '';
}

function unknownFields(object, known) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return {};
  return Object.fromEntries(Object.entries(object).filter(([key]) => !known.includes(key)));
}

function arrayOf(payload, aliases) {
  if (Array.isArray(payload)) return payload;
  for (const key of aliases) if (Array.isArray(payload?.[key])) return payload[key];
  return [];
}

function sourcePathsOf(item) {
  const values = [
    ...(Array.isArray(item?.sourcePaths) ? item.sourcePaths : []),
    ...(Array.isArray(item?.sources) ? item.sources : []),
    ...(Array.isArray(item?.sourceFiles) ? item.sourceFiles.map((source) => typeof source === 'string' ? source : source?.path) : []),
  ];
  const direct = valueOf(item, ['sourcePath', 'path', 'relativePath', 'filePath']);
  if (direct) values.push(direct);
  return [...new Set(values.map(clean).filter(Boolean))];
}

function normalizeEvidence(payload) {
  const students = arrayOf(payload, ['students', 'studentEvidence', 'participants', 'items', 'results']);
  return students.map((student, index) => {
    const records = Array.isArray(student?.evidence) ? student.evidence : [];
    const studentId = clean(valueOf(student, ['studentId', 'student_id', 'id', '学生ID', '学生编号']));
    const studentName = clean(valueOf(student, ['studentName', 'student_name', 'name', '学生姓名', '学生']));
    const ability = clean(valueOf(student, ['ability', 'competency', 'competencyName', 'skillName', '能力维度']));
    const observation = clean(valueOf(student, ['observation', 'performance', 'detail', 'content', '具体表现']));
    const valid = Boolean(studentId || studentName) && Boolean(records.length || ability || observation);
    return {
      valid,
      reason: valid ? '' : `第 ${index + 1} 项缺少学生身份或证据内容`,
      item: {
        id: clean(valueOf(student, ['evidenceId', 'id'])) || hash(`${studentId}|${studentName}|${ability}|${index}`).slice(0, 20),
        type: 'student_evidence',
        subjectId: studentId || studentName,
        title: ability || studentName || `学生证据 ${index + 1}`,
        content: observation,
        status: clean(valueOf(student, ['status', 'state'])) || 'draft',
        confidence: clean(valueOf(student, ['confidence', 'confidenceLevel'])),
        sourcePaths: [...new Set([
          ...sourcePathsOf(student),
          ...clean(valueOf(student, ['来源路径', '来源文件'])).split(/[、,，;；]/).map(clean).filter(Boolean),
          ...records.flatMap(sourcePathsOf),
        ])],
        payload: student,
        extensions: unknownFields(student, ['studentId', 'student_id', 'id', 'studentName', 'student_name', 'name', 'ability', 'competency', 'competencyName', 'skillName', '能力维度', 'observation', 'performance', 'detail', 'content', '具体表现', 'status', 'state', 'confidence', 'confidenceLevel', 'sourcePaths', 'sources', 'sourceFiles', 'sourcePath', 'path', 'relativePath', 'filePath', 'evidence', 'summary']),
      },
    };
  });
}

function normalizeScreening(payload) {
  const records = arrayOf(payload, ['recommendations', 'candidates', 'items', 'results', 'materials']);
  return records.map((record, index) => {
    const data = typeof record === 'string' ? { filename: record } : record;
    const identity = clean(valueOf(data, ['id', 'itemId', 'stagingId', 'sha1', 'path', 'sourcePath', 'filename', 'name', '文件名']));
    const valid = Boolean(data && typeof data === 'object' && identity);
    return {
      valid,
      reason: valid ? '' : `第 ${index + 1} 项缺少可匹配的资料标识`,
      item: {
        id: clean(valueOf(data, ['id', 'itemId', 'stagingId'])) || hash(`${identity}|${index}`).slice(0, 20),
        type: 'screening_recommendation',
        subjectId: identity,
        title: clean(valueOf(data, ['filename', 'name', 'title', '文件名'])) || identity,
        content: clean(valueOf(data, ['reason', 'aiReason', 'preview', 'content', '理由'])),
        status: clean(valueOf(data, ['status', 'action', 'recommendation', 'decision', '结论'])),
        confidence: clean(valueOf(data, ['confidence', 'score'])),
        sourcePaths: sourcePathsOf(data),
        payload: data,
        extensions: unknownFields(data, ['id', 'itemId', 'stagingId', 'sha1', 'path', 'sourcePath', 'filename', 'name', '文件名', 'title', 'reason', 'aiReason', 'preview', 'content', '理由', 'status', 'action', 'recommendation', 'decision', '结论', 'confidence', 'score', 'sourcePaths', 'sources', 'sourceFiles', 'relativePath', 'filePath']),
      },
    };
  });
}

function normalizeDigest(payload) {
  const records = arrayOf(payload, ['processed', 'digestedFiles', 'items', 'processedFiles', 'results']);
  return records.map((record, index) => {
    const data = typeof record === 'string' ? { relativePath: record } : record;
    const relativePath = clean(valueOf(data, ['relativePath', 'path', 'fileName', 'filename', '文件']));
    const valid = Boolean(relativePath);
    return {
      valid,
      reason: valid ? '' : `第 ${index + 1} 项缺少 relativePath`,
      item: {
        id: clean(valueOf(data, ['materialId', 'id', 'recordId'])) || hash(`${relativePath}|${index}`).slice(0, 20),
        type: 'digest_file',
        subjectId: relativePath,
        title: relativePath || `消化结果 ${index + 1}`,
        content: clean(valueOf(data, ['message', 'notes', 'summary', 'content'])),
        status: clean(valueOf(data, ['status', 'state'])) || 'completed',
        confidence: clean(valueOf(data, ['confidence'])),
        sourcePaths: relativePath ? [relativePath] : [],
        payload: data,
        extensions: unknownFields(data, ['materialId', 'id', 'recordId', 'relativePath', 'path', 'fileName', 'filename', '文件', 'message', 'notes', 'summary', 'content', 'status', 'state', 'confidence', 'sha1', 'artifacts']),
      },
    };
  });
}

function parseAgentResultInput(input, options = {}) {
  const parsed = parseAgentPayload(input);
  const payload = parsed.payload;
  const kind = clean(options.kind || payload?.kind || payload?.type || 'generic');
  const normalizer = kind === 'project_student_evidence' ? normalizeEvidence
    : kind === 'project_screening' ? normalizeScreening
      : kind === 'digest' ? normalizeDigest
        : normalizeScreening;
  const normalized = normalizer(payload);
  const items = normalized.filter((entry) => entry.valid).map((entry) => entry.item);
  const invalidItems = normalized.filter((entry) => !entry.valid).map((entry, index) => ({ index, reason: entry.reason, raw: entry.item?.payload }));
  const identity = {
    projectId: clean(valueOf(payload, ['projectId', 'project_id']) || payload?.project?.projectId || payload?.project?.id || options.projectId),
    studentId: clean(valueOf(payload, ['studentId', 'student_id']) || options.studentId),
    batchId: clean(valueOf(payload, ['digestBatchId', 'batchId', 'batch_id']) || options.batchId),
  };
  const knownTop = ['kind', 'type', 'projectId', 'project_id', 'project', 'studentId', 'student_id', 'digestBatchId', 'batchId', 'batch_id', 'students', 'studentEvidence', 'participants', 'recommendations', 'candidates', 'items', 'results', 'materials', 'processed', 'digestedFiles', 'processedFiles'];
  const canonical = { kind, identity, items: items.map((item) => ({ id: item.id, type: item.type, subjectId: item.subjectId, status: item.status, payload: item.payload })) };
  return {
    schema: AGENT_RESULT_ENVELOPE_SCHEMA,
    kind,
    identity,
    sourceFormat: parsed.sourceFormat,
    rawHash: hash(parsed.rawText),
    idempotencyKey: clean(options.idempotencyKey) || hash(JSON.stringify(stable(canonical))),
    items,
    invalidItems,
    partial: items.length > 0 && invalidItems.length > 0,
    diagnostics: invalidItems.map((item) => item.reason),
    extensions: unknownFields(payload, knownTop),
    raw: options.retainRaw === false ? undefined : parsed.rawText,
    payload,
  };
}

function mergeAgentResultEnvelopes(previous, next) {
  if (!previous) return next;
  if (!next) return previous;
  if (previous.kind !== next.kind) throw new Error('不能合并不同类型的 Agent 结果。');
  const byId = new Map();
  for (const item of [...(previous.items || []), ...(next.items || [])]) byId.set(`${item.type}:${item.id}`, item);
  const invalidByKey = new Map();
  for (const item of [...(previous.invalidItems || []), ...(next.invalidItems || [])]) invalidByKey.set(hash(JSON.stringify(stable(item.raw || item.reason))), item);
  const items = [...byId.values()];
  const invalidItems = [...invalidByKey.values()];
  return {
    ...previous,
    ...next,
    items,
    invalidItems,
    partial: items.length > 0 && invalidItems.length > 0,
    diagnostics: [...new Set([...(previous.diagnostics || []), ...(next.diagnostics || [])])],
    extensions: { ...(previous.extensions || {}), ...(next.extensions || {}) },
    idempotencyKey: hash(JSON.stringify(stable({ kind: next.kind, identity: next.identity, items: items.map((item) => item.payload) }))),
  };
}

function retryableItems(envelope) {
  return {
    invalidItems: envelope?.invalidItems || [],
    pendingItems: (envelope?.items || []).filter((item) => ['failed', 'error', 'pending', 'retry'].includes(clean(item.status).toLowerCase())),
  };
}

module.exports = {
  AGENT_RESULT_ENVELOPE_SCHEMA,
  mergeAgentResultEnvelopes,
  parseAgentPayload,
  parseAgentResultInput,
  parseMarkdownRecords,
  retryableItems,
};
