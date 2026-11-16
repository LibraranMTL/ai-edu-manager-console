'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { KNOWLEDGE_DIRS } = require('./project-material-task.cjs');

function studentControlledProject(student, managerPath) {
  const root = path.resolve(String(student.rootPath || ''));
  const raw = path.resolve(String(student.rawPath || ''));
  if (!student?.id || !path.isAbsolute(root) || !path.isAbsolute(raw) || !path.isAbsolute(managerPath)) throw new Error('学生受控消化范围无效');
  return {
    id: `student-controlled-${crypto.createHash('sha256').update(String(student.id)).digest('hex').slice(0, 24)}`,
    name: `${student.name || student.id}资料消化`, studentIds: [String(student.id)], agentTool: String(student.agentTool || 'manual'),
    materialStorageMode: 'workspace-v1', materialRegistryVersion: 1, materialOrganizationPolicy: { mode: 'suggest', autoMoveRoots: ['收件箱'] },
    inboxRelativePath: '收件箱', workspacePath: raw, rawPath: raw, projectRootPath: root,
    managerPath: path.resolve(managerPath), knowledgeRootPath: root, agentPath: String(student.agentPath || ''),
  };
}

async function registerStudentControlledBatch(host, batch, studentId) {
  const registered = [];
  for (const file of batch?.files || []) {
    if (!path.isAbsolute(String(file.path || ''))) throw new Error('学生批次包含非绝对原件路径');
    const result = await host.registerTerminalUpload(path.resolve(file.path), {
      eventId: `student-digest-${crypto.createHash('sha256').update(`${batch.batchId}|${file.materialId}`).digest('hex').slice(0, 32)}`,
      studentId: String(studentId), sourceType: 'student_controlled_digest', allowLegacy: true, intent: 'active',
    });
    registered.push({ studentMaterialId: String(file.materialId), projectMaterialId: result.material.materialId });
  }
  return registered;
}

async function sha1File(file) {
  const bytes = await fs.readFile(file);
  return crypto.createHash('sha1').update(bytes).digest('hex');
}

async function markdownFiles(root, directory) {
  const target = path.join(root, directory);
  let names = []; try { names = await fs.readdir(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return names.filter(name => name.toLowerCase().endsWith('.md')).sort().map(name => path.join(target, name));
}

async function writeAtomic(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.pending`;
  await fs.writeFile(temporary, content, { flag: 'wx' });
  await fs.rename(temporary, file);
}

async function finalizeStudentControlledDigest({ student, batch, receiptPath, summaryPath, output,
  registry = null, registered = [], now = () => new Date().toISOString(), authorize = async () => true }) {
  const requireAuthorization = async () => { if (!await authorize()) throw Object.assign(new Error('学生范围或授权已变化，未继续结算当前批次'), { code: 'SCOPE_CHANGED' }); };
  await requireAuthorization();
  const byStudentMaterial = new Map((registered || []).map(item => [String(item.studentMaterialId), String(item.projectMaterialId)]));
  const byProjectMaterial = new Map((registry?.materials || []).map(item => [String(item.materialId), item]));
  const batchOutcomes = (batch.files || []).map(file => {
    const materialId = byStudentMaterial.get(String(file.materialId));
    const record = materialId ? byProjectMaterial.get(materialId) : null;
    return { file, state: String(record?.processing?.state || ''), error: record?.processing?.error || null };
  });
  const exactBatchKnown = batchOutcomes.length > 0 && batchOutcomes.every(item => item.state);
  const terminalStates = new Set(['completed', 'skipped_unsupported', 'failed_terminal']);
  const unresolved = exactBatchKnown ? batchOutcomes.filter(item => !terminalStates.has(item.state)) : [];
  if ((!exactBatchKnown && !output?.fullyCommitted) || unresolved.length) {
    throw Object.assign(new Error(`当前批次仍有 ${unresolved.length || (batch.files || []).length} 份资料尚未结算，已保留进度等待后续处理`), {
      code: 'MATERIAL_PARTIAL_RETRY', details: { unresolved: unresolved.map(item => item.file.materialId) },
    });
  }
  for (const file of batch.files || []) {
    if (!path.isAbsolute(String(file.path || '')) || await sha1File(file.path) !== String(file.sha1 || '').toLowerCase()) {
      throw Object.assign(new Error('学生原件在消化期间发生变化，未结算当前批次'), { code: 'SOURCE_CHANGED' });
    }
  }
  const root = path.resolve(String(student.rootPath || ''));
  const indexPath = path.join(path.resolve(summaryPath), 'index.md');
  const logPath = path.join(path.resolve(summaryPath), 'log.md');
  const links = [];
  for (const directory of KNOWLEDGE_DIRS) {
    for (const file of await markdownFiles(root, directory)) links.push(`- [${path.basename(file, '.md')}](${path.relative(path.dirname(indexPath), file).replace(/\\/g, '/')})`);
  }
  let currentIndex = ''; try { currentIndex = await fs.readFile(indexPath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const marker = `<!-- controlled-digest:${batch.batchId} -->`;
  await requireAuthorization();
  if (!currentIndex.includes(marker)) await writeAtomic(indexPath, `${currentIndex.trim()}${currentIndex.trim() ? '\n\n' : ''}${marker}\n## 受控资料消化 ${batch.batchId}\n\n${links.join('\n') || '- 本批没有可提交的知识文件'}\n`);
  let currentLog = ''; try { currentLog = await fs.readFile(logPath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await requireAuthorization();
  if (!currentLog.includes(marker)) await writeAtomic(logPath, `${currentLog.trim()}${currentLog.trim() ? '\n' : ''}\n${marker} ${now()}：宿主校验并提交 ${(batch.files || []).length} 份资料的受控知识候选。\n`);
  const completedCount = exactBatchKnown ? batchOutcomes.filter(item => item.state === 'completed').length : (batch.files || []).length;
  const skippedCount = exactBatchKnown ? batchOutcomes.length - completedCount : 0;
  const receipt = {
    schema: 'edu-manager.digest-result.v1', studentId: String(student.id), digestBatchId: String(batch.batchId),
    status: 'completed', message: `宿主已校验当前批次：${completedCount} 份完成${skippedCount ? `，${skippedCount} 份终态跳过` : ''}。`,
    processed: (batch.files || []).map(file => {
      const outcome = batchOutcomes.find(item => String(item.file.materialId) === String(file.materialId));
      const completed = !exactBatchKnown || outcome?.state === 'completed';
      return { materialId: String(file.materialId), relativePath: String(file.relativePath || ''),
        sha1: String(file.sha1 || '').toLowerCase(), status: completed ? 'completed' : 'skipped',
        message: completed ? '' : outcome?.error?.message || '当前管线不支持，原件已保留且不再自动重试。',
        artifacts: completed ? [indexPath, logPath] : [] };
    }),
    artifacts: [indexPath, logPath], completedAt: now(),
  };
  await requireAuthorization();
  await writeAtomic(path.resolve(receiptPath), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

module.exports = { studentControlledProject, registerStudentControlledBatch, finalizeStudentControlledDigest };
