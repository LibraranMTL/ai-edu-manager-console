'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeRemoteProjectResult } = require('../cloud-report-service/remote-result-contract.cjs');
const { sha256, stableJson } = require('../cloud-report-service/v2-contract.cjs');
const { pathWithinProjectScope } = require('./project-execution-scope.cjs');

const OUTPUT_FOLDER = path.join('综合汇总库', '云端Agent成果');

function sameStringSet(left, right) {
  const a = [...new Set((Array.isArray(left) ? left : []).map(String))].sort();
  const b = [...new Set((Array.isArray(right) ? right : []).map(String))].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function checkedScope(item, resolved) {
  const scope = resolved?.scope;
  return Boolean(scope && resolved.authorizedProvider !== false && resolved.taskCurrent !== false
    && scope.projectId === item.projectId
    && scope.scopeFingerprint === item.scopeFingerprint
    && sameStringSet(resolved.cloudStudentIds, item.cloudStudentIds)
    && pathWithinProjectScope(scope.knowledgeRootPath, scope));
}

function resultMarkdown(item, payload) {
  const lines = [
    '---',
    `title: ${JSON.stringify(payload.title)}`,
    `remoteSubmissionId: ${JSON.stringify(item.submissionId)}`,
    `remoteSessionId: ${JSON.stringify(item.sessionId || '')}`,
    `provider: ${JSON.stringify(item.provider)}`,
    `taskId: ${JSON.stringify(payload.taskId)}`,
    `executionId: ${JSON.stringify(payload.executionId)}`,
    `taskType: ${JSON.stringify(payload.taskType)}`,
    `projectId: ${JSON.stringify(payload.projectId)}`,
    `scopeFingerprint: ${JSON.stringify(payload.scopeFingerprint)}`,
    'sourceRevisions:',
    ...payload.sources.map(source => `  - ${JSON.stringify(source.revisionId)}`),
    '---', '',
    `# ${payload.title}`, '',
    payload.content, '',
    '## 资料来源', '',
    ...payload.sources.map(source => `- \`${source.materialId}\` · \`${source.revisionId}\` · \`${source.contentSha256}\``),
    '',
  ];
  if (payload.attachments?.length) lines.push('## 附件', '', ...payload.attachments.map(attachment =>
    `- [${attachment.displayName}](附件/${item.submissionId}/${attachment.attachmentId}-${attachment.displayName.replace(/[\\/:*?"<>|]/g, '_')}) · \`${attachment.contentSha256}\``), '');
  return lines.join('\n');
}

async function ensureSafeOutputDirectory(scope) {
  const root = await fs.promises.realpath(path.resolve(scope.knowledgeRootPath));
  let current = root;
  for (const segment of OUTPUT_FOLDER.split(path.sep)) {
    current = path.join(current, segment);
    try {
      const stat = await fs.promises.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('项目成果目录不是安全目录');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await fs.promises.mkdir(current);
    }
    const real = await fs.promises.realpath(current);
    const relative = path.relative(root, real);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('项目成果目录超出知识空间');
  }
  return current;
}

async function writeResultFile({ item, payload, scope, revalidate }) {
  const directory = await ensureSafeOutputDirectory(scope);
  const target = path.join(directory, `${item.submissionId}.md`);
  if (!pathWithinProjectScope(target, scope)) throw new Error('项目成果写入位置超出知识空间');
  const content = Buffer.from(resultMarkdown(item, payload), 'utf8');
  const expectedHash = crypto.createHash('sha256').update(content).digest('hex');
  try {
    const prior = await fs.promises.readFile(target);
    if (crypto.createHash('sha256').update(prior).digest('hex') !== expectedHash) {
      throw Object.assign(new Error('相同成果编号已存在不同内容'), { code: 'RESULT_CONFLICT' });
    }
    return { path: target, created: false, contentSha256: expectedHash };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temp = path.join(directory, `.${item.submissionId}.${crypto.randomUUID()}.pending`);
  let created = false;
  try {
    await fs.promises.writeFile(temp, content, { flag: 'wx' });
    if (!await revalidate()) throw Object.assign(new Error('项目范围在成果提交前发生变化'), { code: 'SCOPE_CHANGED' });
    await fs.promises.rename(temp, target);
    created = true;
    if (!await revalidate()) {
      const current = await fs.promises.readFile(target).catch(() => null);
      if (current && crypto.createHash('sha256').update(current).digest('hex') === expectedHash) await fs.promises.rm(target, { force: true });
      throw Object.assign(new Error('项目范围在成果提交时发生变化，结果已撤回'), { code: 'SCOPE_CHANGED' });
    }
    return { path: target, created, contentSha256: expectedHash };
  } finally {
    await fs.promises.rm(temp, { force: true }).catch(() => {});
  }
}

async function writeResultAttachments({ runtime, item, payload, scope, revalidate }) {
  if (!payload.attachments?.length) return [];
  const base = await ensureSafeOutputDirectory(scope);
  const root = path.join(base, '附件', item.submissionId);
  await fs.promises.mkdir(root, { recursive: true });
  if (!pathWithinProjectScope(root, scope)) throw new Error('成果附件目录超出知识空间');
  const written = [];
  for (const attachment of payload.attachments) {
    const safeName = attachment.displayName.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_');
    const target = path.join(root, `${attachment.attachmentId}-${safeName}`);
    if (!pathWithinProjectScope(target, scope)) throw new Error('成果附件路径超出知识空间');
    const downloaded = await runtime.downloadCloudInboxAttachment(item.submissionId, attachment.attachmentId, item.leaseId);
    if (downloaded.contentSha256 !== attachment.contentSha256 || downloaded.content.length !== attachment.byteSize) throw new Error('成果附件校验不一致');
    try {
      const prior = await fs.promises.readFile(target);
      if (sha256(prior) !== attachment.contentSha256) throw Object.assign(new Error('相同附件编号已存在不同内容'), { code: 'RESULT_CONFLICT' });
      written.push({ path: target, created: false }); continue;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temp = `${target}.${crypto.randomUUID()}.pending`;
    try {
      await fs.promises.writeFile(temp, downloaded.content, { flag: 'wx' });
      if (!await revalidate()) throw Object.assign(new Error('项目范围在附件落盘前发生变化'), { code: 'SCOPE_CHANGED' });
      await fs.promises.rename(temp, target);
      written.push({ path: target, created: true });
    } finally { await fs.promises.rm(temp, { force: true }).catch(() => {}); }
  }
  return written;
}

async function processCloudInbox({ runtime, resolveScope, maxItems = 20 }) {
  const page = await runtime.listCloudInbox('');
  const now = Date.now();
  const candidates = (page.submissions || []).filter(item => item.projectId &&
    (item.status === 'available' || (item.status === 'leased' && Number(item.leaseExpiresAt || 0) <= now))).slice(0, maxItems);
  const results = [];
  for (const listed of candidates) {
    let lease;
    try { lease = await runtime.leaseCloudInboxSubmission(listed.submissionId); }
    catch (error) { results.push({ submissionId: listed.submissionId, status: 'deferred', reason: error.message }); continue; }
    if (lease.status !== 'leased') { results.push({ submissionId: listed.submissionId, status: lease.status }); continue; }
    const quarantine = async reason => {
      try {
        const settled = await runtime.settleCloudInboxSubmission(lease.submissionId,
          { leaseId: lease.leaseId, status: 'quarantined', reason: String(reason).slice(0, 500) });
        results.push({ submissionId: lease.submissionId, status: settled.status, reason: String(reason) });
      } catch (error) {
        results.push({ submissionId: lease.submissionId, status: 'deferred',
          reason: `隔离回执尚未确认：${error.message}` });
      }
    };
    let payload;
    try {
      if (!/^[a-f0-9]{64}$/.test(String(lease.contentSha256 || '')) || sha256(stableJson(lease.payload)) !== lease.contentSha256) {
        throw new Error('成果内容校验值不一致');
      }
      payload = normalizeRemoteProjectResult(lease.payload, { taskId: lease.taskId, executionId: lease.executionId, taskType: lease.taskType,
        projectId: lease.projectId, scopeFingerprint: lease.scopeFingerprint, allowStoredAttachmentMetadata: true });
    } catch (error) { await quarantine(`成果合同无法验证：${error.message}`); continue; }
    let resolved;
    try { resolved = await resolveScope(lease); }
    catch (error) { results.push({ submissionId: lease.submissionId, status: 'deferred',
      reason: `项目范围暂时无法核对：${error.message}` }); continue; }
    if (!checkedScope(lease, resolved)) { await quarantine('项目成员、目录、权限或 Agent 资格已经变化，结果未采纳'); continue; }
    const revalidate = async () => {
      try { return checkedScope(lease, await resolveScope(lease)); } catch { return false; }
    };
    try {
      await writeResultAttachments({ runtime, item: lease, payload, scope: resolved.scope, revalidate });
      const written = await writeResultFile({ item: lease, payload, scope: resolved.scope, revalidate });
      const settled = await runtime.settleCloudInboxSubmission(lease.submissionId,
        { leaseId: lease.leaseId, status: 'committed' });
      results.push({ submissionId: lease.submissionId, status: settled.status, path: written.path, duplicate: !written.created });
    } catch (error) {
      if (error.code === 'SCOPE_CHANGED' || error.code === 'RESULT_CONFLICT') await quarantine(error.message);
      else results.push({ submissionId: lease.submissionId, status: 'deferred', reason: error.message });
    }
  }
  return { checked: candidates.length, results, nextCursor: page.nextCursor || '' };
}

module.exports = { OUTPUT_FOLDER, checkedScope, processCloudInbox, resultMarkdown, sameStringSet, writeResultAttachments, writeResultFile };
