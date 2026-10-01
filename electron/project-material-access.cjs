const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { invariant, identifier, positiveVersion, sha256, relativeMaterialPath } = require('./project-material-contract.cjs');
const { safePath, within } = require('./project-materials.cjs');
const { createProjectMaterialHost, isWorkspaceMaterialProject } = require('./project-material-host.cjs');

const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const key = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
const categories = ['conceptPath', 'entityPath', 'summaryPath', 'qaPath', 'synthesisPath'];

// Reading the bytes which are displayed/exported is intentional. Listing source
// metadata never resolves, scans or hashes original files.
async function readBounded(file, limit) {
  const handle = await fs.open(file, 'r');
  try {
    const before = await handle.stat();
    invariant(before.isFile() && before.size <= limit, 'file_too_large', '文件不是普通文件或超过本次读取大小限制。');
    const chunks = [];
    let size = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, limit + 1 - size));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      invariant(size <= limit, 'file_too_large', '读取期间文件超过大小限制。');
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    const current = await fs.lstat(file);
    invariant(!current.isSymbolicLink() && before.dev === current.dev && before.ino === current.ino
      && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs
      && current.size === after.size && current.mtimeMs === after.mtimeMs && current.ctimeMs === after.ctimeMs,
    'source_changed', '读取期间文件发生变化，请重试。');
    return Buffer.concat(chunks, size);
  } finally { await handle.close(); }
}

function createProjectMaterialAccess(project, { authorize, externalRoots = {}, limits = {} } = {}) {
  identifier(project.id, '项目ID');
  invariant(typeof authorize === 'function', 'forbidden', '来源读取必须提供项目授权检查。');
  const service = isWorkspaceMaterialProject(project) ? createProjectMaterialHost(project, { externalRoots }) : null;
  async function permit(capability, source) {
    invariant(await authorize({ projectId: project.id, capability, ...source }) === true,
      'forbidden', '当前项目来源访问权限已失效。');
  }
  function knowledgeRelative(documentId) {
    invariant(typeof documentId === 'string' && documentId.length > 0, 'invalid_path', '请选择项目知识文档。');
    const root = path.resolve(project.knowledgeRootPath);
    const target = path.isAbsolute(documentId) ? path.resolve(documentId) : path.resolve(root, relativeMaterialPath(documentId));
    invariant(within(root, target) && path.extname(target).toLowerCase() === '.md'
      && categories.some((field) => project[field] && within(root, path.resolve(project[field]))
        && within(path.resolve(project[field]), target)), 'invalid_path', '该文件不在项目知识分类的阅读范围内。');
    return relativeMaterialPath(path.relative(root, target));
  }

  async function readKnowledge(documentId) {
    await permit('readKnowledge');
    const relativePath = knowledgeRelative(documentId);
    const file = await safePath(project.knowledgeRootPath, relativePath);
    const bytes = await readBounded(file, limits.knowledgeBytes || 4 * 1024 * 1024);
    invariant(file === await safePath(project.knowledgeRootPath, relativePath), 'source_changed', '知识位置已变化。');
    const result = { ok: true, projectId: project.id, relativePath, content: bytes.toString('utf8'), sha256: hash(bytes),
      provenance: service ? 'unregistered' : 'legacy', sources: [],
      message: '旧知识或人工知识尚未建立固定版本来源关联。' };
    if (service) {
      const index = await service.store.read();
      const matches = (index.knowledge || []).filter((item) => key(item.relativePath || '') === key(relativePath));
      if (matches.length) {
        const entry = matches[0];
        if (matches.length !== 1 || entry.status !== 'committed' || !Array.isArray(entry.sources) || entry.sources.length > 1000) {
          result.provenance = 'conflict'; result.message = '知识提交或来源登记存在冲突，暂不将旧关联作为当前依据。';
        } else if (entry.sha256 !== result.sha256) {
          result.provenance = 'modified'; result.message = '知识正文已修改，登记来源属于旧正文，需重新核对。';
        } else {
          result.provenance = 'linked'; result.message = '以下是该正文提交时的固定来源版本；来源关联不等于知识或贡献已经审核。';
          for (const ref of entry.sources) {
            identifier(ref.materialId); positiveVersion(ref.version); sha256(ref.sha256);
            const allowed = await authorize({ projectId: project.id, capability: 'read', materialId: ref.materialId, version: ref.version });
            if (allowed !== true) { result.sources.push({ status: 'restricted', name: '来源访问受限' }); continue; }
            const record = index.materials.find((item) => item.materialId === ref.materialId);
            const version = record?.versions.find((item) => item.version === ref.version);
            const status = !record || !version || version.sha256 !== ref.sha256 ? 'missing'
              : record.adoption.state === 'excluded' ? 'withdrawn' : record.version !== ref.version ? 'updated' : 'current';
            result.sources.push({ materialId: ref.materialId, version: ref.version, sha256: ref.sha256,
              name: record ? path.posix.basename(record.location.relativePath) : '来源未登记',
              currentVersion: record?.version, status,
              exportAllowed: status !== 'missing' && await authorize({ projectId: project.id, capability: 'export', materialId: ref.materialId, version: ref.version }) === true });
          }
        }
      }
    }
    await permit('readKnowledge');
    // Permissions may change while an earlier source was being checked.
    for (const source of result.sources) if (source.materialId) await permit('read', source);
    return result;
  }

  async function prepareKnowledgeSource(documentId, expectedKnowledgeHash, materialId, version) {
    identifier(materialId); positiveVersion(version); sha256(expectedKnowledgeHash);
    const document = await readKnowledge(documentId);
    invariant(document.sha256 === expectedKnowledgeHash && document.provenance === 'linked',
      'knowledge_changed', '知识正文或来源关联已变化，请重新打开知识后再查看依据。');
    const ref = document.sources.find((item) => item.materialId === materialId && item.version === version);
    invariant(ref && ref.status !== 'missing', 'source_unavailable', '未找到此正文对应的指定来源版本，不能用其他资料或最新版本替代。');
    await permit('export', ref);
    const resolved = await service.store.resolve(materialId, version);
    invariant(resolved.sha256 === ref.sha256, 'source_changed', '原文版本校验不一致。');
    const bytes = await readBounded(resolved.path, limits.sourceBytes || 32 * 1024 * 1024);
    invariant(hash(bytes) === ref.sha256, 'source_changed', '原文读取期间变化，未导出。');
    const fresh = await readKnowledge(documentId);
    invariant(fresh.sha256 === expectedKnowledgeHash && fresh.provenance === 'linked'
      && fresh.sources.some((item) => item.materialId === materialId && item.version === version && item.sha256 === ref.sha256),
    'knowledge_changed', '准备原文期间知识关联发生变化。');
    await permit('export', ref);
    const ext = path.extname(ref.name);
    const name = `${path.basename(ref.name, ext)}-引用版本${version}${ext}`;
    return { projectId: project.id, materialId, version, sha256: ref.sha256, name, bytes };
  }

  return { readKnowledge, prepareKnowledgeSource };
}

// The save dialog is the authority for this destination. Never overwrite an
// existing file, including an original, a previous export or a hard link.
async function saveSourceCopy(file, source) {
  invariant(path.isAbsolute(file), 'invalid_path', '导出位置必须来自保存对话框。');
  invariant(hash(source.bytes) === sha256(source.sha256), 'source_changed', '待导出的来源内容校验失败。');
  const handle = await fs.open(file, 'wx');
  try { await handle.writeFile(source.bytes); await handle.sync(); }
  catch (error) {
    // Do not erase a destination which may already be open/edited externally.
    // The caller must not report this as a successfully saved or opened copy.
    error.message = `${error.message}；可能不完整的导出副本保留在 ${file}，请检查后处理。`;
    throw error;
  }
  finally { await handle.close(); }
  return { path: file, sha256: source.sha256, size: source.bytes.length };
}

module.exports = { createProjectMaterialAccess, saveSourceCopy, readBounded };
