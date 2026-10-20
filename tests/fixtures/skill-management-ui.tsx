import React from 'react';
import { createRoot } from 'react-dom/client';
import SkillManagementPanel from '../../src/SkillManagementPanel';
import '../../src/styles.css';

const artifact = {
  artifactId: 'artifact-fixture', kind: 'skill', currentVersionId: 'version-fixture',
  identity: { name: 'education-fixture', displayName: '教育资料整理', publisher: 'edu-fixture' },
  tags: { system: ['skill', 'education', 'documents'], semantic: [], user: ['常用'], manualLocked: true },
  compatibility: ['codex', 'workbuddy'], installations: [],
  version: { versionId: 'version-fixture', declaredVersion: '1.0.0', description: '用于生产组件浏览与安装交互验收的合成 Skill。', sourceType: 'codex_scan', sourceUri: 'fixture', treeSha256: 'a'.repeat(64), manifestSha256: 'b'.repeat(64), fileCount: 4, totalBytes: 8200, license: 'MIT', riskFindings: [], observedCapabilities: [] },
};
const snapshot = {
  library: { rootPath: 'C:\\Synthetic\\skill-library', writable: true, settings: { limits: {} } },
  counts: { artifacts: 1, versions: 1, installations: 0, quarantined: 0 }, scope: 'host', mcpEnabled: false, pluginInstallEnabled: false,
  providers: [
    { providerId: 'codex', installed: true, canScan: true, canExport: true, canInstallSkill: true, canInstallPlugin: false, canUpdate: true, canRollback: true, canUninstall: true, requiresRestart: true, reason: 'Codex 用户级 Skills 根。' },
    { providerId: 'workbuddy', installed: true, canScan: true, canExport: true, canInstallSkill: true, canInstallPlugin: false, canUpdate: true, canRollback: true, canUninstall: true, requiresRestart: true, reason: '官方 CodeBuddy 用户级 Skills 根。' },
    { providerId: 'qclaw', installed: true, canScan: true, canExport: true, canInstallSkill: false, canInstallPlugin: false, canUpdate: false, canRollback: false, canUninstall: false, requiresRestart: false, reason: 'QClaw 只读扫描与导出。' },
  ],
  scans: [], recentReceipts: [],
};
let installed = false;
let artifactDeleted = false;
const migrationScenario = new URLSearchParams(location.search).get('migration');
let migratedRoot = '';
const stressCount = new URLSearchParams(location.search).get('stress') === '1' ? 1500 : 1;
const sortScenario = new URLSearchParams(location.search).get('sort') === '1';
let currentScans: typeof snapshot.scans = [];
const api = { skillLibraryAction: async (action: string) => {
  if (action === 'snapshot') {
    if (migratedRoot && migrationScenario === 'refresh-error') return JSON.stringify({ ok: false, message: '合成刷新失败' });
    return JSON.stringify({ ok: true, data: { ...snapshot, library: { ...snapshot.library, rootPath: migratedRoot || snapshot.library.rootPath }, scans: currentScans, counts: { ...snapshot.counts, installations: installed ? 1 : 0 } } });
  }
  if (action === 'chooseArchiveRoot') return JSON.stringify({ ok: true, data: { cancelled: migrationScenario === 'cancel', selectionId: 'selection-fixture', displayPath: 'D:\\自定义 Skill 存档' } });
  if (action === 'migrateArchiveRoot') {
    await new Promise(resolve => setTimeout(resolve, 700));
    if (migrationScenario === 'error') return JSON.stringify({ ok: false, message: '所选文件夹不是空目录。请新建一个空文件夹后选择；现有文件不会被覆盖。' });
    migratedRoot = 'D:\\自定义 Skill 存档';
    return JSON.stringify({ ok: true, data: { activeRoot: migratedRoot, oldLibraryRetained: true } });
  }
  if (action === 'listArtifacts') return JSON.stringify({ ok: true, data: artifactDeleted ? [] : Array.from({ length: sortScenario ? 3 : stressCount }, (_, index) => ({ ...artifact,
    artifactId: index ? `artifact-fixture-${index}` : artifact.artifactId,
    identity: sortScenario ? { ...artifact.identity, name: ['zebra-skill', 'alpha-skill', 'beta-skill'][index], displayName: ['Zebra Skill', 'Alpha Skill', 'Beta Skill'][index] } : index ? { ...artifact.identity, name: `education-fixture-${index}`, displayName: `教育资料整理 ${index}` } : artifact.identity,
    installations: installed ? [{ installationId: 'install-fixture', providerId: 'codex', versionId: 'version-fixture', state: 'restart_required', installedAt: new Date().toISOString() }] : [],
  })) });
  if (action === 'scanSources') { currentScans = [{ providerId: 'codex', scannedAt: new Date().toISOString(), candidates: [{ discoveryId: 'discovery-fixture', providerId: 'codex', sourceKind: 'user', sourceRoot: 'C:\\Synthetic\\.codex\\skills', relativePath: 'education-fixture', kind: 'skill', identity: { name: 'education-fixture', displayName: '教育资料整理', description: 'fixture', declaredVersion: '1.0.0' }, treeSha256: 'a'.repeat(64), fileCount: 4, totalBytes: 8200, riskFindings: [], inspectionStatus: 'ready_to_archive' }] }]; return JSON.stringify({ ok: true, data: { scans: currentScans } }); }
  if (action === 'previewInstall') return JSON.stringify({ ok: true, data: { planId: 'plan-fixture', planHash: 'c'.repeat(64), artifactId: 'artifact-fixture', versionId: 'version-fixture', providerId: 'codex', targetPath: 'C:\\Synthetic\\.codex\\skills\\education-fixture', beforeFingerprint: '', objectTreeSha256: 'a'.repeat(64), changes: { add: 4, replace: 0, preserve: 0 }, riskFindings: [], requiresRestart: true, rollbackAvailable: false, expiresAt: new Date(Date.now() + 600000).toISOString() } });
  if (action === 'install') { installed = true; return JSON.stringify({ ok: true, data: { record: { state: 'restart_required' } } }); }
  if (action === 'deleteArtifact') { artifactDeleted = true; return JSON.stringify({ ok: true, data: { deleted: true, cleanupPending: false } }); }
  if (action === 'manualInstallInfo') return JSON.stringify({ ok: true, data: { archivePath: 'D:\\SkillBackups\\objects\\sha256\\aaaaaaaa\\payload', readOnlyArchive: true, kind: 'skill', treeSha256: 'a'.repeat(64) } });
  if (action === 'copyManualInstallPath') return JSON.stringify({ ok: true, data: { copied: true } });
  if (action === 'openManualInstallPath') return JSON.stringify({ ok: true, data: { opened: true } });
  if (action === 'chooseManualExportRoot') return JSON.stringify({ ok: true, data: { cancelled: false, selectionId: 'export-selection' } });
  if (action === 'exportManualInstallCopy') return JSON.stringify({ ok: true, data: { exportPath: 'D:\\AgentSkills\\education-fixture-1.0.0-aaaaaaaa' } });
  if (['archiveDiscovered', 'verifyInstallation', 'uninstall', 'openArchivePath'].includes(action)) return JSON.stringify({ ok: true, data: {} });
  return JSON.stringify({ ok: false, message: `fixture 未实现 ${action}` });
} };

createRoot(document.getElementById('root')!).render(<SkillManagementPanel api={api} />);
