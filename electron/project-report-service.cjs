'use strict';

const { buildProjectReportSnapshot, POLICY_VERSION, sha256 } = require('./project-report-snapshot.cjs');
const { buildM1ProjectReport } = require('./project-report-claims.cjs');
const { projectReportProjection, citationProjection } = require('./project-report-access.cjs');

function text(value) { return String(value ?? '').trim(); }
function statusLabel(status) { return ({ active: '进行中', paused: '已暂停', completed: '已完成待归档', archived: '已归档', published: '已发布' })[text(status)] || '状态待核对'; }
function emptyProjection(project, authorizationVersion, asOf) {
  return { projectId: text(project.id), snapshotId: '', versionId: '', reportType: 'stage_summary', status: 'empty', asOf,
    policyVersion: POLICY_VERSION, dataGeneration: 0, authorizationVersion,
    project: { name: text(project.name), type: text(project.type), status: text(project.status || 'active'),
      objective: text(project.objective), description: text(project.description), deliverables: Array.isArray(project.deliverables) ? project.deliverables : [] },
    summary: { currentStage: statusLabel(project.status), changes: '尚未构建阶段摘要。', representativeResults: [],
      nextAction: project.objective ? '添加能证明当前阶段的资料，然后构建阶段摘要。' : '先补充项目目标和完成标准。' },
    claims: [], gaps: [project.objective ? '尚无固定证据快照。' : '尚未登记明确项目目标。'], personalContributions: [],
    coverage: { materials: { total: 0, analyzed: 0, unavailable: 0, pending: 0 }, knowledge: { total: 0, analyzed: 0, pending: 0 }, contributions: { confirmed: 0, unconfirmed: 0 } },
    disclaimer: '尚无项目报告版本；当前只显示项目登记信息，读取不会扫描目录、派发任务或写入项目。' };
}

function createProjectReportService({ store, loadProject, loadRegistry, authorizationVersion, now = Date.now } = {}) {
  if (!store || typeof loadProject !== 'function' || typeof loadRegistry !== 'function' || typeof authorizationVersion !== 'function') {
    throw new Error('Project report service dependencies are required');
  }
  async function get(reader, projectId, asOf = new Date(now()).toISOString()) {
    const project = await loadProject(projectId);
    if (!project) throw Object.assign(new Error('未找到学习项目。'), { code: 'project_not_found' });
    const currentAuthorization = authorizationVersion(project);
    const current = store.getCurrentProjectReport(projectId);
    if (!current) return emptyProjection(project, currentAuthorization, asOf);
    if (text(current.snapshot.authorizationVersion) !== text(currentAuthorization)) {
      return { ...emptyProjection(project, currentAuthorization, asOf), status: 'authorization_changed',
        gaps: ['项目成员或授权已变化，旧阶段摘要已停止展示。'],
        summary: { ...emptyProjection(project, currentAuthorization, asOf).summary, changes: '授权已变化，需要明确更新阶段摘要。' } };
    }
    return { ...projectReportProjection({ ...reader, authorizationVersion: currentAuthorization }, current.snapshot, current.version.report, current.version), status: 'ready' };
  }
  async function refresh(scope, reader, projectId, asOf = new Date(now()).toISOString()) {
    const project = await loadProject(projectId);
    if (!project) throw Object.assign(new Error('未找到学习项目。'), { code: 'project_not_found' });
    const currentAuthorization = authorizationVersion(project);
    const snapshot = await buildProjectReportSnapshot({ projectId, asOf, authorizationVersion: currentAuthorization,
      loadProject: () => loadProject(projectId), loadRegistry: () => loadRegistry(projectId) });
    const snapshotCommitKey = sha256(`project-report-snapshot\n${projectId}\n${snapshot.inputFingerprint}\n${currentAuthorization}`);
    const savedSnapshot = store.saveSnapshot(scope, snapshot, snapshotCommitKey);
    const report = buildM1ProjectReport(savedSnapshot);
    const reportCommitKey = sha256(`project-report-m1\n${projectId}\n${savedSnapshot.inputFingerprint}\n${report.policyVersion}`);
    const version = store.commitReportVersion(scope, { snapshotId: savedSnapshot.snapshotId, commitKey: reportCommitKey, report });
    return { ...projectReportProjection({ ...reader, authorizationVersion: currentAuthorization }, savedSnapshot, version.report, version), status: 'ready' };
  }
  async function citation(reader, projectId, versionId, citationId) {
    const project = await loadProject(projectId);
    if (!project) throw Object.assign(new Error('未找到学习项目。'), { code: 'project_not_found' });
    const current = store.getCurrentProjectReport(projectId);
    if (!current || text(current.version.versionId) !== text(versionId)) throw Object.assign(new Error('项目报告版本不存在或已变化。'), { code: 'project_report_version_missing' });
    const currentAuthorization = authorizationVersion(project);
    if (text(current.snapshot.authorizationVersion) !== text(currentAuthorization)) throw Object.assign(new Error('项目授权已变化。'), { code: 'subject_scope_forbidden' });
    return citationProjection({ ...reader, authorizationVersion: currentAuthorization }, current.snapshot, citationId);
  }
  return { get, refresh, citation };
}

module.exports = { createProjectReportService, emptyProjection };

