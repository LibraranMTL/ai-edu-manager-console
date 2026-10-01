const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { hashStableFile, safePath } = require('./project-materials.cjs');
const { createProjectUploadIntake } = require('./project-upload-intake.cjs');

async function stageProjectDirectImport(project, sourcePath, proposedTarget,
  { findExisting, sourceType = 'direct_import', intent = 'active', studentId = '',
    captureSessionId = '', captureItemId = '', conversationDeliveryId = '', conversationAssetId = '',
    conversationInteractionId = '', agentIntentId = '', hostSourcePath = '', hostSourceName = '',
    publicationId = '', publicationObjectId = '', publicationSourceNodeId = '',
    publicationMaterialId = '', publicationMaterialVersion = 0,
    collaborationTaskId = '', collaborationAttachmentObjectId = '', expectedSha256 = '' } = {}) {
  if (!['direct_import', 'staging_import', 'capture_import', 'conversation_delivery', 'conversation_submission', 'agent_approved_upload', 'host_material_source', 'host_manual_import', 'collaboration_publication', 'collaboration_attachment'].includes(sourceType)) throw Object.assign(
    new Error('项目本机导入来源无效。'), { code: 'invalid_source_type' });
  if (!['active', 'later'].includes(intent) || (sourceType === 'staging_import' && intent !== 'later')) throw Object.assign(
    new Error('研究暂存必须登记为待采用资料。'), { code: 'invalid_intent' });
  const inbox = path.join(project.workspacePath, project.inboxRelativePath || '收件箱');
  await safePath(project.workspacePath, project.inboxRelativePath || '收件箱', { allowMissing: true });
  await fs.mkdir(inbox, { recursive: true });
  await safePath(project.workspacePath, project.inboxRelativePath || '收件箱');
  const temporary = path.join(inbox, `._edu-import-${crypto.randomUUID()}.partial`);
  const intake = createProjectUploadIntake(project);
  try {
    const fingerprint = await hashStableFile(sourcePath, { copyTo: temporary });
    if (expectedSha256 && fingerprint.sha256 !== expectedSha256) throw Object.assign(
      new Error('协作来源文件与发布清单哈希不一致。'), { code: 'source_changed' });
    const uploadId = `${sourceType === 'staging_import' ? 'staging' : sourceType === 'capture_import' ? 'capture' : sourceType === 'conversation_delivery' ? 'conversation' : sourceType === 'conversation_submission' ? 'conversation-submission' : sourceType === 'agent_approved_upload' ? 'agent-upload' : sourceType === 'host_material_source' ? 'host-source' : sourceType === 'host_manual_import' ? 'host-manual' : sourceType === 'collaboration_publication' ? 'publication' : sourceType === 'collaboration_attachment' ? 'collaboration-attachment' : 'direct'}-${crypto.createHash('sha256').update(JSON.stringify([
      project.id, sourceType === 'conversation_delivery' ? String(conversationDeliveryId)
        : sourceType === 'conversation_submission' ? String(conversationInteractionId)
          : sourceType === 'agent_approved_upload' ? String(agentIntentId)
            : sourceType === 'collaboration_publication' ? String(publicationId)
              : sourceType === 'collaboration_attachment' ? String(collaborationTaskId) : path.resolve(sourcePath),
      ...(sourceType === 'agent_approved_upload' ? [] : [fingerprint.sha256]),
      ...(sourceType === 'capture_import' ? [String(studentId), String(captureSessionId), String(captureItemId)] : []),
      ...(sourceType === 'conversation_delivery' ? [String(studentId), String(conversationAssetId)] : []),
      ...(sourceType === 'conversation_submission' ? [String(studentId), String(conversationAssetId)] : []),
      ...(sourceType === 'agent_approved_upload' ? [String(studentId)] : []),
      ...(['host_material_source', 'host_manual_import'].includes(sourceType) ? [String(studentId)] : []),
      ...(sourceType === 'collaboration_publication' ? [String(publicationObjectId), String(publicationSourceNodeId)] : []),
      ...(sourceType === 'collaboration_attachment' ? [String(studentId), String(collaborationTaskId), String(collaborationAttachmentObjectId)] : []),
    ])).digest('hex')}`;
    const existing = await findExisting?.(uploadId, fingerprint);
    if (existing) return { alreadyImported: true, uploadId, existing, fingerprint };
    const entry = await intake.prepare({ uploadId, studentId, deviceId: 'local-host', targetPath: proposedTarget,
      sourceType, intent, captureSessionId, captureItemId, conversationDeliveryId, conversationAssetId,
      conversationInteractionId, agentIntentId, hostSourcePath, hostSourceName,
      publicationId, publicationObjectId, publicationSourceNodeId,
      publicationMaterialId, publicationMaterialVersion,
      collaborationTaskId, collaborationAttachmentObjectId,
      expectedSha256: fingerprint.sha256 });
    const target = intake.targetFor(entry.relativePath);
    let exists = false;
    try { await fs.lstat(target); exists = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (exists) {
      await intake.verifyExisting(entry, fingerprint);
    } else {
      // Same-directory hard link publishes the already-fsynced copy without an
      // overwrite window or a partly visible destination.
      await fs.link(temporary, target);
    }
    const written = await intake.recordWritten(entry, fingerprint);
    return { target, uploadId, entry: written, intake, fingerprint };
  } finally { await fs.rm(temporary, { force: true }); }
}

module.exports = { stageProjectDirectImport };
