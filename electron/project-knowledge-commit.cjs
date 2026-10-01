const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { invariant, MaterialError } = require('./project-material-contract.cjs');
const { safePath, hashStableFile, writeJsonAtomic, withCommitLock } = require('./project-materials.cjs');
const { openKnowledgeGuard } = require('./project-knowledge-guard.cjs');

const JOURNAL_SCHEMA = 'edu-manager.project-knowledge-commit.v1';
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const knowledgeId = (projectId, relativePath) => `knowledge-${digest(JSON.stringify([projectId, relativePath.toLowerCase()])).slice(0, 24)}`;

function dependencyGroups(artifacts) {
  const groups = [];
  for (const artifact of artifacts) {
    const sources = new Set(artifact.sources.map((source) => source.materialId));
    const overlapping = groups.filter((group) => group.some((item) => item.sources.some((source) => sources.has(source.materialId))));
    const merged = [artifact, ...overlapping.flat()];
    for (const group of overlapping) groups.splice(groups.indexOf(group), 1);
    groups.push(merged);
  }
  return groups;
}

function createProjectKnowledgeCommitter({ store, workspace, knowledgeRoot, guardFactory = openKnowledgeGuard, hooks = {} }) {
  const commitLock = `knowledge:${path.resolve(knowledgeRoot).toLowerCase()}`;

  async function journalPaths(commitId, create = false) {
    invariant(/^commit-[a-f0-9]{40}$/.test(commitId), 'invalid_commit', '知识提交ID无效。');
    const root = await safePath(store.directory, `commits/${commitId}`, { allowMissing: create });
    if (create) await fs.mkdir(root, { recursive: true });
    return { root, journal: await safePath(root, 'journal.json', { allowMissing: create }) };
  }

  async function writeJournal(paths, journal, state) {
    journal.state = state;
    journal.updatedAt = new Date().toISOString();
    await writeJsonAtomic(paths.journal, journal);
  }

  function assertCurrentSources(index, sources) {
    for (const source of sources) {
      const material = index.materials.find((item) => item.materialId === source.materialId);
      invariant(material?.version === source.version && material.sha256 === source.sha256
        && material.adoption.state === 'accepted', 'source_changed', '提交前资料版本或采用状态已变化。');
    }
  }

  async function sourceGuards(sources) {
    const result = [];
    for (const source of sources) {
      // Current, not the fixed snapshot: the guard prevents concurrent editors
      // changing this version while the host settles processing state.
      const current = await store.resolve(source.materialId);
      invariant(current.version === source.version && current.sha256 === source.sha256,
        'source_changed', '工作原文已更新，保留旧输出为候选。');
      const snapshot = await store.resolve(source.materialId, source.version);
      result.push({ path: current.path, root: path.dirname(current.path), sha256: current.sha256 });
      if (snapshot.path !== current.path) result.push({ path: snapshot.path, root: path.dirname(snapshot.path), sha256: source.sha256 });
    }
    return [...new Map(result.map((source) => [source.path.toLowerCase(), source])).values()];
  }

  async function publishLedger(journal) {
    return store.mutate((index) => {
      assertCurrentSources(index, journal.sources);
      const existing = index.commits.find((item) => item.commitId === journal.commitId);
      if (existing?.state === 'committed') return existing;
      index.knowledge ||= [];
      const committedAt = new Date().toISOString();
      const artifacts = journal.artifacts.map((artifact) => ({
        knowledgeId: knowledgeId(store.projectId, artifact.relativePath), relativePath: artifact.relativePath,
        sha256: artifact.sha256, size: artifact.size, sources: artifact.sources,
        batchId: journal.batchId, commitId: journal.commitId, committedAt, status: 'committed',
      }));
      for (const artifact of artifacts) {
        const position = index.knowledge.findIndex((item) => item.knowledgeId === artifact.knowledgeId);
        if (position >= 0) index.knowledge[position] = artifact;
        else index.knowledge.push(artifact);
      }
      const record = { commitId: journal.commitId, batchId: journal.batchId, state: 'committed', artifacts, committedAt };
      if (existing) Object.assign(existing, record);
      else index.commits.push(record);
      const batchOutputs = index.commits.filter((item) => item.batchId === journal.batchId && item.state === 'committed').flatMap((item) => item.artifacts);
      for (const source of journal.sources) {
        const material = index.materials.find((item) => item.materialId === source.materialId);
        material.links.knowledge ||= [];
        for (const artifact of artifacts.filter((item) => item.sources.some((ref) => ref.materialId === material.materialId))) {
          material.links.knowledge = material.links.knowledge.filter((item) => item.knowledgeId !== artifact.knowledgeId);
          material.links.knowledge.push({ knowledgeId: artifact.knowledgeId, version: source.version, commitId: journal.commitId });
        }
        const required = journal.expectedTargets.filter((target) => target.materialIds.includes(source.materialId));
        const completed = required.length > 0 && required.every((target) => batchOutputs.some((output) => output.relativePath === target.relativePath
          && output.sources.some((ref) => ref.materialId === source.materialId && ref.version === source.version && ref.sha256 === source.sha256)));
        if (completed) material.processing = { state: 'completed', processedVersion: source.version,
          batchId: journal.batchId, ruleVersion: journal.ruleVersion, completedAt: committedAt };
        material.recordRevision++;
      }
      return record;
    });
  }

  async function apply(journal, paths, { recovery = false } = {}) {
    const attempt = crypto.randomUUID();
    const backupRoot = await safePath(paths.root, `backup-${attempt}`, { allowMissing: true });
    await fs.mkdir(backupRoot);
    const sources = await sourceGuards(journal.sources);
    const targets = [];
    for (let i = 0; i < journal.artifacts.length; i++) {
      const artifact = journal.artifacts[i];
      const staged = await safePath(paths.root, artifact.frozenOutput);
      const bytes = await fs.readFile(staged);
      invariant(digest(bytes) === artifact.sha256, 'output_changed', '待提交知识内容已变化。');
      const destination = await safePath(knowledgeRoot, artifact.relativePath, { allowMissing: true });
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await safePath(knowledgeRoot, artifact.relativePath, { allowMissing: true });
      let baselineHash = artifact.baselineHash;
      if (recovery) {
        let currentHash = null;
        try { currentHash = (await hashStableFile(destination)).sha256; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        invariant(currentHash === artifact.baselineHash || currentHash === artifact.sha256,
          'recovery_conflict', '知识在中断后发生其他变化，保留现场和备份等待核对。');
        baselineHash = currentHash;
      }
      targets.push({ path: destination, baselineHash, sha256: artifact.sha256,
        contentBase64: bytes.toString('base64'), backupPath: path.join(backupRoot, `${i}.bin`) });
    }
    journal.attempts ||= [];
    journal.attempts.push({ attempt, backupDirectory: path.basename(backupRoot), startedAt: new Date().toISOString() });
    await writeJournal(paths, journal, 'preparing');
    const guard = guardFactory({ knowledgeRoot, backupRoot, sources, targets });
    let ledgerCommitted = false;
    let preserveForRecovery = false;
    try {
      await guard.ready();
      assertCurrentSources(await store.read(), journal.sources);
      await hooks.afterLocked?.({ journal, guard });
      await writeJournal(paths, journal, 'writing');
      await guard.write();
      await writeJournal(paths, journal, 'files_written');
      await hooks.afterFilesWritten?.({ journal, guard });
      const result = await publishLedger(journal);
      ledgerCommitted = true;
      await hooks.afterLedgerCommitted?.({ journal, guard });
      await guard.finalize();
      await writeJournal(paths, journal, 'committed');
      return result.result;
    } catch (error) {
      preserveForRecovery = ledgerCommitted || error.code === 'simulated_crash';
      if (ledgerCommitted) {
        // The ledger is now authoritative. Ask the helper to retain written
        // bytes; if it already died, recovery reconciles bytes with the ledger.
        try { await guard.finalize(); } catch { await guard.abort(); }
      } else {
        const rollback = await guard.abort();
        if (rollback?.interrupted || rollback?.rollbackFailures?.length) preserveForRecovery = true;
      }
      journal.error = { code: error.code || 'commit_failed', message: error.message };
      await writeJournal(paths, journal, preserveForRecovery ? 'recovery_required' : 'aborted');
      throw error;
    }
  }

  async function commit(batchId, receipt) {
    return withCommitLock(commitLock, async () => {
      const checked = await workspace.validate(batchId, receipt);
      const { manifest } = await workspace.readBatch(batchId);
      const results = [];
      for (const group of dependencyGroups(checked.artifacts)) {
        const identity = JSON.stringify([batchId, group.map((item) => [item.relativePath, item.sha256,
          item.sources.map((source) => [source.materialId, source.version, source.sha256]).sort()]).sort()]);
        const commitId = `commit-${digest(identity).slice(0, 40)}`;
        const existing = (await store.read()).commits.find((item) => item.commitId === commitId);
        if (existing?.state === 'committed') {
          const existingPaths = await journalPaths(commitId);
          const existingJournal = JSON.parse(await fs.readFile(existingPaths.journal, 'utf8'));
          results.push(existingJournal.state === 'committed' ? { ...existing, reused: true } : await recoverLocked(commitId));
          continue;
        }
        if (group.some((artifact) => artifact.status !== 'validated')) {
          results.push({ commitId, state: 'conflict', artifacts: group.map(({ relativePath, status }) => ({ relativePath, status })) });
          continue;
        }
        const paths = await journalPaths(commitId, true);
        let prior;
        try { prior = JSON.parse(await fs.readFile(paths.journal, 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (prior && prior.state !== 'aborted') {
          results.push(await recoverLocked(commitId));
          continue;
        }
        const sourceMap = new Map(group.flatMap((artifact) => artifact.sources).map((source) => [source.materialId, source]));
        const artifacts = [];
        for (let i = 0; i < group.length; i++) {
          const artifact = group[i];
          const bytes = await fs.readFile(artifact.outputPath);
          invariant(digest(bytes) === artifact.sha256, 'output_changed', '知识输出在校验后被修改。');
          const frozenOutput = `output-${i}-${artifact.sha256}.md`;
          const file = await safePath(paths.root, frozenOutput, { allowMissing: true });
          try { await fs.writeFile(file, bytes, { flag: 'wx' }); }
          catch (error) { if (error.code !== 'EEXIST') throw error; }
          invariant((await hashStableFile(file)).sha256 === artifact.sha256, 'output_changed', '固定输出内容不符。');
          artifacts.push({ ...artifact, outputPath: undefined, frozenOutput });
        }
        const journal = { schema: JOURNAL_SCHEMA, projectId: store.projectId, commitId, batchId,
          ruleVersion: manifest.ruleVersion, sources: [...sourceMap.values()], artifacts,
          expectedTargets: manifest.baselines.map((baseline) => ({ relativePath: baseline.relativePath,
            materialIds: baseline.materialIds || manifest.sources.map((source) => source.materialId) })),
          createdAt: new Date().toISOString(), state: 'planned', attempts: prior?.attempts || [] };
        await writeJournal(paths, journal, 'planned');
        results.push(await apply(journal, paths));
      }
      const finalIndex = await store.read();
      const remainingMaterialIds = manifest.sources.filter((source) => !finalIndex.materials.some((material) =>
        material.materialId === source.materialId && material.processing.state === 'completed'
        && material.processing.batchId === batchId && material.processing.processedVersion === source.version)).map((source) => source.materialId);
      return { projectId: store.projectId, batchId, results, remainingMaterialIds,
        fullyCommitted: results.length > 0 && results.every((item) => item.state === 'committed') && !remainingMaterialIds.length };
    });
  }

  async function recoverLocked(commitId) {
    const paths = await journalPaths(commitId);
    const journal = JSON.parse(await fs.readFile(paths.journal, 'utf8'));
    invariant(journal.schema === JOURNAL_SCHEMA && journal.projectId === store.projectId && journal.commitId === commitId,
      'invalid_commit', '提交恢复记录无效。');
    const ledger = (await store.read()).commits.find((item) => item.commitId === commitId);
    if (journal.state === 'committed' && ledger?.state === 'committed') return { ...ledger, reused: true };
    try { return await apply(journal, paths, { recovery: true }); }
    catch (error) {
      journal.error = { code: error.code || 'recovery_failed', message: error.message };
      await writeJournal(paths, journal, 'recovery_conflict');
      if (ledger?.state === 'committed') await store.mutate((index) => {
        const entry = index.commits.find((item) => item.commitId === commitId);
        entry.state = 'recovery_conflict';
        for (const artifact of index.knowledge || []) if (artifact.commitId === commitId) artifact.status = 'recovery_conflict';
        for (const material of index.materials) if (material.processing.batchId === journal.batchId) {
          material.processing = { ...material.processing, state: 'pending', recoveryConflict: commitId };
        }
      });
      throw error;
    }
  }

  async function recover(commitId) { return withCommitLock(commitLock, () => recoverLocked(commitId)); }
  return { commit, recover };
}

module.exports = { JOURNAL_SCHEMA, dependencyGroups, createProjectKnowledgeCommitter };
