const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { invariant, identifier, relativeMaterialPath } = require('./project-material-contract.cjs');
const { hashStableFile, safePath, writeJsonAtomic } = require('./project-materials.cjs');

const SCHEMA = 'edu-manager.project-upload-intake.v1';
const keyFor = (scope) => crypto.createHash('sha256').update(JSON.stringify([
  scope.projectId, scope.studentId, scope.deviceId, scope.uploadId,
])).digest('hex');

function createProjectUploadIntake(project) {
  identifier(project.id, '项目ID');
  invariant(path.isAbsolute(project.workspacePath || '') && path.isAbsolute(project.managerPath || ''),
    'invalid_root', '项目上传目录无效。');
  const inbox = relativeMaterialPath(project.inboxRelativePath || '收件箱');
  const directory = path.join(project.managerPath, 'project-materials', 'upload-intake');
  const workspace = path.resolve(project.workspacePath);

  function targetFor(relativePath) {
    const relative = relativeMaterialPath(relativePath);
    invariant(relative.startsWith(`${inbox}/`), 'invalid_upload_location', '上传目标不在项目收件箱。');
    const target = path.resolve(workspace, ...relative.split('/'));
    invariant(path.relative(workspace, target) === relative.split('/').join(path.sep),
      'invalid_upload_location', '上传目标越过项目工作空间。');
    return target;
  }

  function validate(entry, key) {
    invariant(entry?.schema === SCHEMA && entry.projectId === project.id && entry.key === key
      && ['prepared', 'written'].includes(entry.state), 'intake_corrupt', '上传恢复记录无效。');
    identifier(entry.uploadId, '上传ID');
    invariant(!entry.sourceType || ['terminal_upload', 'direct_import', 'staging_import', 'capture_import', 'conversation_delivery', 'conversation_submission', 'agent_approved_upload', 'host_material_source', 'host_manual_import', 'collaboration_publication', 'collaboration_attachment'].includes(entry.sourceType),
      'intake_corrupt', '上传恢复记录来源类型无效。');
    if (entry.sourceType === 'capture_import') {
      invariant(entry.intent === 'active', 'intake_corrupt', '采集晋升采用意图无效。');
      identifier(entry.captureSessionId, '采集会话ID');
      identifier(entry.captureItemId, '采集项ID');
      identifier(entry.studentId, '学生ID');
    }
    if (entry.sourceType === 'conversation_delivery') {
      invariant(entry.intent === 'active', 'intake_corrupt', '对话投递采用意图无效。');
      identifier(entry.studentId, '学生ID');
      identifier(entry.conversationDeliveryId, '对话投递ID');
      identifier(entry.conversationAssetId, '对话资产ID');
    }
    if (entry.sourceType === 'conversation_submission') {
      invariant(entry.intent === 'active', 'intake_corrupt', '对话提交采用意图无效。');
      identifier(entry.studentId, '学生ID');
      identifier(entry.conversationAssetId, '对话资产ID');
      identifier(entry.conversationInteractionId, '对话会话ID');
    }
    if (entry.sourceType === 'agent_approved_upload') {
      invariant(entry.intent === 'active', 'intake_corrupt', '授权 Agent 上传采用意图无效。');
      identifier(entry.studentId, '学生ID');
      identifier(entry.agentIntentId, 'Agent 写入意图ID');
    }
    if (['host_material_source', 'host_manual_import'].includes(entry.sourceType)) {
      invariant(entry.intent === 'active', 'intake_corrupt', '主机资料来源导入采用意图无效。');
      identifier(entry.studentId, '学生ID');
      invariant(typeof entry.hostSourcePath === 'string' && path.isAbsolute(entry.hostSourcePath)
        && entry.hostSourcePath.length <= 4096 && typeof entry.hostSourceName === 'string'
        && entry.hostSourceName.length > 0 && entry.hostSourceName.length <= 256,
      'intake_corrupt', '主机资料来源身份无效。');
    }
    if (entry.sourceType === 'collaboration_publication') {
      invariant(entry.intent === 'active', 'intake_corrupt', '协作项目原文采用意图无效。');
      identifier(entry.publicationId, '协作发布ID');
      identifier(entry.publicationObjectId, '协作对象ID');
      identifier(entry.publicationSourceNodeId, '协作来源节点ID');
      invariant(!entry.publicationMaterialId || (typeof entry.publicationMaterialId === 'string'
        && entry.publicationMaterialId.length <= 256), 'intake_corrupt', '协作来源资料ID无效。');
      invariant(Number.isSafeInteger(entry.publicationMaterialVersion)
        && entry.publicationMaterialVersion >= 0, 'intake_corrupt', '协作来源资料版本无效。');
    }
    if (entry.sourceType === 'collaboration_attachment') {
      invariant(entry.intent === 'active', 'intake_corrupt', '协作附件采用意图无效。');
      identifier(entry.studentId, '学生ID');
      identifier(entry.collaborationTaskId, '协作任务ID');
      identifier(entry.collaborationAttachmentObjectId, '协作附件对象ID');
    }
    invariant(!entry.intent || ['active', 'later'].includes(entry.intent),
      'intake_corrupt', '上传恢复记录采用意图无效。');
    invariant(keyFor(entry) === key, 'intake_corrupt', '上传恢复记录身份不匹配。');
    targetFor(entry.relativePath);
    invariant(!entry.expectedSha256 || /^[a-f0-9]{64}$/.test(entry.expectedSha256),
      'intake_corrupt', '上传恢复记录哈希无效。');
    if (entry.state === 'written') invariant(/^[a-f0-9]{64}$/.test(entry.sha256 || '')
      && Number.isSafeInteger(entry.size) && entry.size >= 0, 'intake_corrupt', '上传恢复记录字节信息无效。');
    return entry;
  }

  async function read(key) {
    invariant(/^[a-f0-9]{64}$/.test(key), 'invalid_intake_key', '上传恢复记录编号无效。');
    let entry;
    try {
      await safePath(project.managerPath, `project-materials/upload-intake/${key}.json`, { allowMissing: true });
      entry = JSON.parse(await fsp.readFile(path.join(directory, `${key}.json`), 'utf8'));
    }
    catch (error) {
      if (error.code === 'ENOENT') return null;
      throw Object.assign(new Error('上传恢复记录无法读取，不能重新落盘。'), { code: 'intake_corrupt', cause: error });
    }
    return validate(entry, key);
  }

  async function find({ uploadId, studentId = '', deviceId = '' }) {
    return read(keyFor({ projectId: project.id, uploadId, studentId: String(studentId), deviceId: String(deviceId) }));
  }

  async function prepare({ uploadId, studentId = '', deviceId = '', targetPath, expectedSha256 = '',
    sourceType = 'terminal_upload', intent = 'active', captureSessionId = '', captureItemId = '',
    conversationDeliveryId = '', conversationAssetId = '', conversationInteractionId = '', agentIntentId = '',
    hostSourcePath = '', hostSourceName = '', publicationId = '', publicationObjectId = '',
    publicationSourceNodeId = '', publicationMaterialId = '', publicationMaterialVersion = 0,
    collaborationTaskId = '', collaborationAttachmentObjectId = '' }) {
    identifier(uploadId, '上传ID');
    identifier(deviceId || 'local', '设备ID');
    invariant(['terminal_upload', 'direct_import', 'staging_import', 'capture_import', 'conversation_delivery', 'conversation_submission', 'agent_approved_upload', 'host_material_source', 'host_manual_import', 'collaboration_publication', 'collaboration_attachment'].includes(sourceType), 'invalid_source_type', '上传来源类型无效。');
    invariant(['active', 'later'].includes(intent), 'invalid_intent', '上传采用意图无效。');
    if (sourceType === 'capture_import') {
      invariant(intent === 'active', 'invalid_intent', '屏幕采集晋升必须登记为已采用资料。');
      identifier(studentId, '学生ID');
      identifier(captureSessionId, '采集会话ID');
      identifier(captureItemId, '采集项ID');
    }
    if (sourceType === 'conversation_delivery') {
      invariant(intent === 'active', 'invalid_intent', '对话投递必须登记为已采用资料。');
      identifier(studentId, '学生ID');
      identifier(conversationDeliveryId, '对话投递ID');
      identifier(conversationAssetId, '对话资产ID');
    }
    if (sourceType === 'conversation_submission') {
      invariant(intent === 'active', 'invalid_intent', '对话提交必须登记为已采用资料。');
      identifier(studentId, '学生ID');
      identifier(conversationAssetId, '对话资产ID');
      identifier(conversationInteractionId, '对话会话ID');
    }
    if (sourceType === 'agent_approved_upload') {
      invariant(intent === 'active', 'invalid_intent', '授权 Agent 上传必须登记为已采用资料。');
      identifier(studentId, '学生ID');
      identifier(agentIntentId, 'Agent 写入意图ID');
    }
    if (['host_material_source', 'host_manual_import'].includes(sourceType)) {
      invariant(intent === 'active', 'invalid_intent', '主机资料来源导入必须登记为已采用资料。');
      identifier(studentId, '学生ID');
      invariant(typeof hostSourcePath === 'string' && path.isAbsolute(hostSourcePath)
        && hostSourcePath.length <= 4096 && typeof hostSourceName === 'string'
        && hostSourceName.length > 0 && hostSourceName.length <= 256,
      'invalid_identity', '主机资料来源身份无效。');
    }
    if (sourceType === 'collaboration_publication') {
      invariant(intent === 'active', 'invalid_intent', '协作项目原文必须登记为已采用资料。');
      identifier(publicationId, '协作发布ID');
      identifier(publicationObjectId, '协作对象ID');
      identifier(publicationSourceNodeId, '协作来源节点ID');
      invariant(!publicationMaterialId || (typeof publicationMaterialId === 'string'
        && publicationMaterialId.length <= 256), 'invalid_identity', '协作来源资料ID无效。');
      invariant(Number.isSafeInteger(publicationMaterialVersion) && publicationMaterialVersion >= 0,
        'invalid_identity', '协作来源资料版本无效。');
    }
    if (sourceType === 'collaboration_attachment') {
      invariant(intent === 'active', 'invalid_intent', '协作附件必须登记为已采用资料。');
      identifier(studentId, '学生ID');
      identifier(collaborationTaskId, '协作任务ID');
      identifier(collaborationAttachmentObjectId, '协作附件对象ID');
    }
    const relativePath = path.relative(workspace, path.resolve(targetPath)).replace(/\\/g, '/');
    targetFor(relativePath);
    const scope = { projectId: project.id, uploadId, studentId: String(studentId), deviceId: String(deviceId) };
    const key = keyFor(scope);
    await fsp.mkdir(project.managerPath, { recursive: true });
    invariant(!(await fsp.lstat(project.managerPath)).isSymbolicLink(), 'linked_path', '项目管理目录不能是链接。');
    await safePath(project.managerPath, 'project-materials/upload-intake', { allowMissing: true });
    await fsp.mkdir(directory, { recursive: true });
    await safePath(project.managerPath, 'project-materials/upload-intake');
    const previous = await read(key);
    if (previous) {
      invariant(!expectedSha256 || !previous.expectedSha256 || previous.expectedSha256 === expectedSha256,
        'upload_id_content_conflict', '同一上传编号声明了不同内容。');
      invariant((previous.sourceType || 'terminal_upload') === sourceType,
        'upload_id_content_conflict', '同一上传编号的资料来源类型不同。');
      invariant((previous.intent || 'active') === intent,
        'upload_id_content_conflict', '同一上传编号的采用意图不同。');
      invariant(sourceType !== 'capture_import' || (previous.captureSessionId === captureSessionId
        && previous.captureItemId === captureItemId && previous.studentId === String(studentId)),
      'upload_id_content_conflict', '同一采集上传编号的会话或学生归属不同。');
      invariant(sourceType !== 'conversation_delivery' || (previous.conversationDeliveryId === conversationDeliveryId
        && previous.conversationAssetId === conversationAssetId && previous.studentId === String(studentId)),
      'upload_id_content_conflict', '同一对话投递编号的来源或学生归属不同。');
      invariant(sourceType !== 'conversation_submission' || (previous.conversationInteractionId === conversationInteractionId
        && previous.conversationAssetId === conversationAssetId && previous.studentId === String(studentId)),
      'upload_id_content_conflict', '同一对话提交编号的会话或学生归属不同。');
      invariant(sourceType !== 'agent_approved_upload' || (previous.agentIntentId === agentIntentId
        && previous.studentId === String(studentId)),
      'upload_id_content_conflict', '同一 Agent 上传编号的意图或学生归属不同。');
      invariant(!['host_material_source', 'host_manual_import'].includes(sourceType) || (previous.hostSourcePath === hostSourcePath
        && previous.hostSourceName === hostSourceName && previous.studentId === String(studentId)),
      'upload_id_content_conflict', '同一资料来源导入编号的来源或学生归属不同。');
      invariant(sourceType !== 'collaboration_publication' || (previous.publicationId === publicationId
        && previous.publicationObjectId === publicationObjectId
        && previous.publicationSourceNodeId === publicationSourceNodeId
        && previous.publicationMaterialId === publicationMaterialId
        && previous.publicationMaterialVersion === publicationMaterialVersion),
      'upload_id_content_conflict', '同一协作项目原文编号的来源身份不同。');
      invariant(sourceType !== 'collaboration_attachment' || (previous.collaborationTaskId === collaborationTaskId
        && previous.collaborationAttachmentObjectId === collaborationAttachmentObjectId
        && previous.studentId === String(studentId)),
      'upload_id_content_conflict', '同一协作附件编号的任务或学生身份不同。');
      return previous;
    }
    const entry = { schema: SCHEMA, key, ...scope, sourceType, intent, relativePath, expectedSha256,
      ...(sourceType === 'capture_import' ? { captureSessionId, captureItemId } : {}),
      ...(sourceType === 'conversation_delivery' ? { conversationDeliveryId, conversationAssetId } : {}),
      ...(sourceType === 'conversation_submission' ? { conversationInteractionId, conversationAssetId } : {}),
      ...(sourceType === 'agent_approved_upload' ? { agentIntentId } : {}),
      ...(['host_material_source', 'host_manual_import'].includes(sourceType) ? { hostSourcePath, hostSourceName } : {}),
      ...(sourceType === 'collaboration_publication' ? { publicationId, publicationObjectId,
        publicationSourceNodeId, publicationMaterialId, publicationMaterialVersion } : {}),
      ...(sourceType === 'collaboration_attachment' ? { collaborationTaskId, collaborationAttachmentObjectId } : {}),
      state: 'prepared', createdAt: new Date().toISOString() };
    await writeJsonAtomic(path.join(directory, `${key}.json`), entry);
    return entry;
  }

  async function verifyExisting(entry, incoming) {
    validate(entry, entry.key);
    const target = targetFor(entry.relativePath);
    let observed;
    try { observed = await hashStableFile(target); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    invariant(observed.size === incoming.size && observed.sha256 === incoming.sha256
      && (!entry.expectedSha256 || entry.expectedSha256 === incoming.sha256)
      && (entry.state !== 'written' || entry.sha256 === incoming.sha256),
    'upload_id_content_conflict', '同一上传编号的已落盘资料与本次字节不同。');
    return { path: target, size: observed.size, sha1: observed.sha1, sha256: observed.sha256 };
  }

  async function recordWritten(entry, fingerprint) {
    validate(entry, entry.key);
    const observed = await hashStableFile(targetFor(entry.relativePath));
    invariant(observed.size === fingerprint.size && observed.sha256 === fingerprint.sha256
      && (!entry.expectedSha256 || entry.expectedSha256 === observed.sha256),
    'source_changed', '上传文件在登记前发生变化。');
    invariant(entry.state !== 'written' || (entry.size === observed.size && entry.sha256 === observed.sha256),
      'upload_id_content_conflict', '已记录的上传字节与本次内容不同。');
    const next = { ...entry, state: 'written', size: observed.size, sha256: observed.sha256,
      writtenAt: entry.writtenAt || new Date().toISOString() };
    await writeJsonAtomic(path.join(directory, `${entry.key}.json`), next);
    return next;
  }

  async function complete(entry) {
    validate(entry, entry.key);
    await fsp.rm(path.join(directory, `${entry.key}.json`), { force: true });
  }

  async function pending() {
    let names;
    try {
      await safePath(project.managerPath, 'project-materials/upload-intake');
      invariant(!(await fsp.lstat(directory)).isSymbolicLink(), 'linked_path', '上传恢复目录不能是链接。');
      names = await fsp.readdir(directory);
    }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    invariant(names.length <= 10000, 'intake_capacity', '项目上传恢复记录过多，需要管理员处理。');
    const entries = [];
    for (const name of names) {
      // A crash before the atomic rename leaves only an uncommitted temporary
      // file. The previous journal (if any) remains authoritative.
      if (/^[a-f0-9]{64}\.json\.[a-f0-9-]{36}\.tmp$/.test(name)) continue;
      invariant(/^[a-f0-9]{64}\.json$/.test(name), 'intake_corrupt', '上传恢复目录包含未知文件。');
      const entry = await read(name.slice(0, -5));
      if (entry) entries.push(entry);
    }
    return entries;
  }

  async function recoverPending(commit) {
    invariant(typeof commit === 'function', 'invalid_recovery', '上传恢复提交函数无效。');
    const result = { recovered: [], abandoned: [], issues: [] };
    for (const entry of await pending()) {
      const target = targetFor(entry.relativePath);
      let observed;
      try { observed = await hashStableFile(target); }
      catch (error) {
        if (error.code === 'ENOENT') {
          if (entry.state === 'prepared') {
            await complete(entry);
            result.abandoned.push(entry.key);
          } else result.issues.push({ key: entry.key, code: 'source_missing' });
          continue;
        }
        result.issues.push({ key: entry.key, code: error.code || 'source_unavailable' });
        continue;
      }
      const recordedHash = entry.state === 'written' ? entry.sha256 : entry.expectedSha256;
      if (!recordedHash) {
        result.issues.push({ key: entry.key, code: 'unverified_prepared' });
        continue;
      }
      if (recordedHash !== observed.sha256 || (entry.state === 'written' && entry.size !== observed.size)) {
        result.issues.push({ key: entry.key, code: 'source_changed' });
        continue;
      }
      try {
        const written = entry.state === 'written' ? entry
          : await recordWritten(entry, { size: observed.size, sha256: observed.sha256 });
        await commit(written, { path: target, ...observed });
        await complete(written);
        result.recovered.push(entry.key);
      } catch (error) { result.issues.push({ key: entry.key, code: error.code || 'recovery_failed' }); }
    }
    return result;
  }

  return { directory, targetFor, find, prepare, verifyExisting, recordWritten, complete, pending, recoverPending };
}

module.exports = { createProjectUploadIntake };
