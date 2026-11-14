'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const args = new Map(process.argv.slice(2).map(entry => {
  const separator = entry.indexOf('=');
  return separator < 0
    ? [entry.replace(/^--/, ''), 'true']
    : [entry.slice(0, separator).replace(/^--/, ''), entry.slice(separator + 1)];
}));

function required(name) {
  const value = String(args.get(name) || '').trim();
  if (!value) throw new Error(`--${name} is required`);
  return path.resolve(value);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

const database = required('database');
const fixture = required('fixture');
const db = new DatabaseSync(database, { readOnly: true });
const row = db.prepare("select task_id,status,payload_json,updated_at from tasks where kind='project_digest'").get();
if (!row) throw new Error('project_digest task not found');
const payload = JSON.parse(row.payload_json);
const attempts = db.prepare(`
  select execution_id,provider_id,phase,active,created_at,started_at,settled_at,result_kind,evidence_json
  from task_execution_attempts
  where task_id = ?
  order by created_at
`).all(row.task_id).map(attempt => ({
  ...attempt,
  evidence: attempt.evidence_json ? JSON.parse(attempt.evidence_json) : null,
  evidence_json: undefined,
}));
db.close();

const projectRoot = path.join(fixture, 'project-data', 'p0-synthetic-project-01');
const registryPath = path.join(projectRoot, '.edu-manager', 'project-materials', 'registry.json');
let registry = null;
let knowledge = [];
if (fs.existsSync(registryPath)) {
  registry = readJson(registryPath);
  knowledge = (registry.knowledge || []).map(item => {
    const file = path.join(projectRoot, '项目知识空间', item.relativePath);
    return {
      relativePath: item.relativePath,
      expectedSha256: String(item.sha256 || '').toUpperCase(),
      exists: fs.existsSync(file),
      actualSha256: fs.existsSync(file) ? sha256(file) : '',
      size: fs.existsSync(file) ? fs.statSync(file).size : 0,
    };
  });
}

const report = {
  task: {
    id: row.task_id,
    status: row.status,
    updatedAt: row.updated_at,
    adapterId: payload.adapterId || '',
    executionId: payload.executionId || '',
    executionPhase: payload.executionPhase || '',
    settlementState: payload.settlementState || '',
    businessOutcome: payload.businessOutcome || '',
    nextRetryAt: payload.nextRetryAt || '',
    capabilityWait: payload.capabilityWait || null,
    error: payload.error || null,
    result: payload.result || null,
  },
  attempts,
  registry: registry ? {
    revision: registry.revision,
    materialCount: (registry.materials || []).length,
    processingStates: (registry.materials || []).map(material => ({
      materialId: material.materialId,
      state: material.processing?.state || '',
      processedVersion: material.processing?.processedVersion || 0,
      batchId: material.processing?.batchId || '',
    })),
    commitCount: (registry.commits || []).length,
    knowledgeCount: (registry.knowledge || []).length,
  } : null,
  knowledge,
  knowledgeHashesMatch: knowledge.length > 0
    && knowledge.every(item => item.exists && item.expectedSha256 === item.actualSha256),
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
const output = String(args.get('output') || '').trim();
if (output) {
  const resolvedOutput = path.resolve(output);
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(resolvedOutput, serialized, 'utf8');
}
process.stdout.write(serialized);

