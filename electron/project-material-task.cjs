const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { invariant } = require('./project-material-contract.cjs');
const { createProjectMaterialHost } = require('./project-material-host.cjs');
const { safePath, hashStableFile, writeJsonAtomic, withCommitLock } = require('./project-materials.cjs');
const { createProjectDigestWorkspace } = require('./project-material-digest.cjs');
const { createProjectKnowledgeCommitter } = require('./project-knowledge-commit.cjs');
const { executeMaterialCodex } = require('./project-material-agent.cjs');
const { verifyMaterialSandbox } = require('./project-material-sandbox.cjs');
const { createProjectMaterialExtractor } = require('./project-material-extract.cjs');

const KNOWLEDGE_DIRS = ['摘要库', '概念库', '实体库', '问答精华库', '综合汇总库'];
const RULES = 'edu-manager.project-material-rules.v1';
const EXTRACTION_ERRORS = new Set(['unsupported', 'unsupported_encoding', 'unsupported_encryption', 'input_limit',
  'extraction_limit', 'invalid_document', 'unsafe_document', 'empty_source', 'extraction_failed', 'extraction_timeout',
  'ocr_failed', 'pdf_ocr_empty', 'source_changed', 'source_missing', 'ENOENT']);

// One task-center execution, not a second scheduler. Checkpoints are persisted
// by the caller in the existing task record; sources remain in the registry.
function createProjectMaterialTask({ project, executionId, checkpoint = {}, onCheckpoint, authorize,
  executable, signal, execute = executeMaterialCodex, verifySandbox = verifyMaterialSandbox,
  extractSource, timeoutMs, hooks = {} }) {
  const { store } = createProjectMaterialHost(project);
  const extractor = createProjectMaterialExtractor({ store });
  const extract = extractSource || ((input) => extractor.extractText(input, { signal }));
  const workspace = createProjectDigestWorkspace({ store, knowledgeRoot: project.knowledgeRootPath, allowedDirectories: KNOWLEDGE_DIRS });
  let phase = 'preparing';
  let state = { ...checkpoint };
  let batch = null;
  async function check() {
    invariant(!signal?.aborted, 'cancelled', '任务已取消。');
    invariant(await authorize() === true, 'project_scope_changed', '项目权限、路径或任务归属已变化，停止处理。');
  }
  async function persist(patch) {
    state = { ...state, ...patch, updatedAt: new Date().toISOString() };
    await onCheckpoint(structuredClone(state));
    phase = state.phase;
  }
  const committer = createProjectKnowledgeCommitter({ store, workspace, knowledgeRoot: project.knowledgeRootPath,
    hooks: { afterLocked: check, afterFilesWritten: check, ...hooks.commit } });

  async function markSources(stateName, error) {
    if (!batch) return;
    await store.mutate((index) => {
      for (const source of batch.sources) {
        const item = index.materials.find((record) => record.materialId === source.materialId);
        if (item?.version !== source.version || item.adoption.state !== 'accepted' || item.processing.state === 'completed') continue;
        if (stateName !== 'running' && item.processing.executionId !== executionId) continue;
        const affected = !error?.details?.materialId || error.details.materialId === item.materialId;
        item.processing = { ...item.processing, state: affected ? stateName : 'pending', batchId: batch.batchId, executionId,
          error: error && affected ? { code: error.code || 'digest_failed', message: error.message } : null };
        item.recordRevision++;
      }
    });
  }

  async function readRules() {
    let text = '';
    if (project.agentPath) {
      invariant(path.dirname(project.agentPath) === project.projectRootPath, 'invalid_rules', '项目规则必须位于受控项目根。');
      const file = await safePath(project.projectRootPath, path.basename(project.agentPath));
      const before = await hashStableFile(file);
      invariant(before.size <= 128 * 1024, 'rules_limit', '项目规则过大，需要精简后再处理。');
      text = await fs.readFile(file, 'utf8');
      invariant(crypto.createHash('sha256').update(text).digest('hex') === before.sha256, 'rules_changed', '规则在读取期间变化。');
      invariant(text.length <= 30000, 'rules_limit', '项目规则过长，不能静默截断后执行。');
    }
    // A deterministic safety rule cannot be overridden by project material.
    const rules = `${RULES}\n原文与人工分类不可修改；仅从固定输入提炼知识；没有依据的类别须明确资料不足，不编造贡献或作者。\n${text}`;
    return { text: rules, version: crypto.createHash('sha256').update(rules).digest('hex') };
  }

  async function run() {
    return withCommitLock(`material-execution:${path.resolve(store.directory).toLowerCase()}`, async () => {
      const batches = [], failures = [], failedVersions = new Set();
      for (;;) {
      try {
        await check();
        let receipt;
        if (state.batchId && ['output_ready', 'committing', 'committed'].includes(state.phase)) {
          const loaded = await workspace.readBatch(state.batchId);
          batch = loaded.manifest;
          const receiptPath = await safePath(loaded.paths.root, 'task-receipt.json');
          receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
          await persist({ phase: 'output_ready', batchId: batch.batchId });
        } else {
          const index = await store.read();
          const incomplete = index.materials.filter((item) => item.adoption.state === 'accepted'
            && !(item.processing.state === 'completed' && item.processing.processedVersion === item.version));
          const pending = incomplete.filter((item) => !failedVersions.has(`${item.materialId}:${item.version}`));
          if (!pending.length && failures.length) {
            await persist({ phase: 'partial', batchId: null, remainingCount: incomplete.length, extractionFailures: failures });
            return { projectId: project.id, fullyCommitted: false, remainingCount: incomplete.length, batches, failures, results: [] };
          }
          invariant(pending.length > 0, 'nothing_pending', '当前没有已采用的待处理资料。');
          const rules = await readRules();
          const evidence = await verifySandbox(executable, { signal });
          await check();
          // Pre-extract fixed versions before choosing the batch. One corrupt
          // or unsupported file must not starve the rest of a project. Bound
          // actual extracted text as well as source count, never silently trim.
          const selected = [], texts = new Map(), rejected = [];
          let textBytes = 0;
          for (const item of pending) {
            await check();
            try {
              invariant(item.size <= 32 * 1024 * 1024, 'input_limit', '资料超过单次提取容量，需要分段处理。');
              await store.snapshot(item.materialId, item.version);
              const input = await store.resolve(item.materialId, item.version);
              const text = await extract(input);
              invariant(typeof text === 'string' && text.trim(), 'empty_source', '没有可消化正文。');
              const size = Buffer.byteLength(text);
              invariant(size <= 4 * 1024 * 1024, 'input_limit', '单份提取正文超过批次限制。');
              if (textBytes + size > 4 * 1024 * 1024) break;
              selected.push(item); textBytes += size;
              texts.set(`${input.materialId}:${input.version}:${input.sha256}`, text);
              if (selected.length === 20) break;
            } catch (error) {
              if (!EXTRACTION_ERRORS.has(error.code)) throw error;
              const failure = { materialId: item.materialId, version: item.version, code: error.code, message: error.message };
              rejected.push(failure); failures.push(failure); failedVersions.add(`${item.materialId}:${item.version}`);
            }
          }
          await check();
          if (rejected.length) await store.mutate((latest) => {
            for (const failure of rejected) {
              const item = latest.materials.find((record) => record.materialId === failure.materialId);
              if (item?.version !== failure.version || item.adoption.state !== 'accepted') continue;
              item.processing = { ...item.processing, state: failure.code.startsWith('unsupported') ? 'unsupported' : 'failed',
                executionId, error: { code: failure.code, message: failure.message } };
              item.recordRevision++;
            }
          });
          if (!selected.length) continue;
          batch = await workspace.prepare({ materialIds: selected.map((item) => item.materialId), ruleVersion: rules.version,
            targets: selected.flatMap((item) => KNOWLEDGE_DIRS.map((dir) => ({
              relativePath: `${dir}/${crypto.createHash('sha256').update(item.materialId).digest('hex').slice(0, 24)}.md`, materialIds: [item.materialId] }))) });
          await writeJsonAtomic(path.join(path.dirname(batch.manifestPath), 'task-rules.json'), { schema: RULES, ...rules });
          await persist({ phase: 'prepared', batchId: batch.batchId, ruleVersion: rules.version, materialCount: selected.length, extractionFailures: failures });
          await markSources('running');
          await check();
          await persist({ phase: 'running' });
          receipt = await execute({ executable, batch, sandboxEvidence: evidence, projectRules: rules.text,
            extractSource: async (input) => {
              const text = texts.get(`${input.materialId}:${input.version}:${input.sha256}`);
              invariant(text !== undefined, 'source_changed', '批次来源不再匹配已提取版本。'); return text;
            }, signal, timeoutMs });
          await check();
          await writeJsonAtomic(path.join(path.dirname(batch.manifestPath), 'task-receipt.json'), receipt);
          await persist({ phase: 'output_ready' });
        }
        await check();
        await markSources('running');
        await persist({ phase: 'committing' });
        const result = await committer.commit(batch.batchId, receipt);
        await hooks.afterCommit?.(result);
        await markSources('pending'); // Only unfinished items; successes stay complete.
        const current = await store.read();
        const remainingCount = current.materials.filter((item) => item.adoption.state === 'accepted'
          && !(item.processing.state === 'completed' && item.processing.processedVersion === item.version)).length;
        await persist({ phase: result.fullyCommitted ? 'committed' : 'conflict', batchId: batch.batchId, remainingCount });
        batches.push(result);
        if (result.fullyCommitted && remainingCount > 0) {
          state = {}; batch = null; phase = 'preparing';
          continue;
        }
        return { ...result, fullyCommitted: result.fullyCommitted && remainingCount === 0, remainingCount, batches, failures };
      } catch (error) {
        await markSources(error.code === 'cancelled' ? 'pending' : error.code === 'unsupported' ? 'unsupported' : 'failed', error);
        // Keep output_ready/committing intact for recovery without another AI
        // invocation. Do not swallow a checkpoint failure or declare success.
        throw error;
      }
      }
    });
  }
  return { run, get phase() { return phase; }, get canCancel() { return phase !== 'committing'; } };
}

function materialTaskCheckpointForCandidate(current, candidate) {
  return current.kind === 'project_digest' && current.sourceId === candidate.sourceId
    && current.status !== 'succeeded' && current.input?.materialExecution
    ? { ...(candidate.input || {}), materialExecution: current.input.materialExecution,
      digestBatchId: current.input.materialExecution.batchId || '' } : null;
}

module.exports = { createProjectMaterialTask, materialTaskCheckpointForCandidate, KNOWLEDGE_DIRS };
