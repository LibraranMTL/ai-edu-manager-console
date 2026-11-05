import React, { useEffect, useRef, useState } from 'react';
import './cloud-documents.css';
import { boundedWork } from './bounded-work';

type Result<T> = { ok: boolean; data?: T; message?: string };
type Student = { id: string; name: string; grade?: string; school?: string; goal?: string; currentRegion?: string; phone?: string; email?: string; birthDate?: string; address?: string; guardian?: unknown };
type CloudStudent = { id: string; displayName: string; expiresAt?: number | null; profileRevisionId?: string; localBinding?: { localStudentId: string; status: string } | null; bindingIssue?: string };
type CloudReport = { revisionId: string; reportType: string; originDeviceId: string; originPlatform: string; publishedAt: string; receivedAt: number; filename: string };
type CloudDocument = { documentId: string; displayName: string; contentType: string; byteSize: number; createdAt: number };
type CloudMaterial = { materialId: string; revisionId: string; category: string; displayName: string; contentType: string; byteSize: number; createdAt: number; indexStatus?: string; extractionStatus?: string };
type CachedStudent = { cloudStudentId: string; displayName: string };
type UploadScope = { profileFields: string[]; materialCategories: string[] };
type UploadStatus = { configured: boolean; enabled: boolean; cloudStudentId?: string; lastSyncAt?: number; serverVerifiedAt?: number; syncing?: boolean; lastError?: string; pendingServerWriteState?: boolean | null; pendingUploadScope?: UploadScope | null; savedUploadScope?: UploadScope | null; uploadScopePersistence?: 'default' | 'local_requires_enrollment' | 'local_requires_upgrade' | 'pending_cloud' | 'cloud_confirmed'; profileFields?: string[]; materialCategories?: string[]; healthObjectScope?: string[]; lastUploaded?: number; lastUnchanged?: number; lastReady?: number; skipped?: { filename: string; reason: string }[] };
type CloudInboxItem = { submissionId: string; provider: string; projectId: string; status: string; updatedAt: number; quarantinedReason?: string };
type RemoteAgentStatus = { sessionId: string; provider?: string; status?: string; expiresAt?: number; revokedAt?: number; projectId?: string; taskId?: string };
type ExpertDraft = { schema: 'edu-manager.expert-consultation-draft.v1'; studentId: string; purpose: 'expert_learning_interpretation'; profileFields: string[]; materialCategories: string[]; updatedAt: string; reviewedAuthorizationVersion?: string };
type ExpertDraftStatus = { draft: ExpertDraft | null; authorizationVersion: string; authorizationValid: boolean; reviewed: boolean };

export type CloudReportApi = {
  cloudReportSettings?: () => Promise<string>;
  cloudReportSaveSettings?: (serverUrl: string) => Promise<string>;
  cloudReportCheckConnection?: (serverUrl: string) => Promise<string>;
  cloudReportEnrollSource?: (input: { serverUrl: string; localStudentId: string; profileFields?: string[]; materialCategories?: string[] }) => Promise<string>;
  cloudReportSetUpload?: (studentId: string, enabled: boolean) => Promise<string>;
  cloudReportSetUploadScope?: (studentId: string, input: { profileFields: string[]; materialCategories: string[] }) => Promise<string>;
  cloudReportGetExpertConsultationDraft?: (studentId: string) => Promise<string>;
  cloudReportSaveExpertConsultationDraft?: (studentId: string, draft: Partial<ExpertDraft>) => Promise<string>;
  cloudReportClearExpertConsultationDraft?: (studentId: string) => Promise<string>;
  cloudReportSelectUploadHealth?: (studentId: string) => Promise<string>;
  cloudReportStatus?: (studentId: string) => Promise<string>;
  cloudReportSyncNow?: (studentId: string) => Promise<string>;
  cloudReportCreatePairing?: (serverUrl: string) => Promise<string>;
  cloudReportApprovePairing?: (pairingCode: string, studentIds: string[], options?: { profileFields: string[]; materialCategories: string[]; healthObjectScope?: string[] }) => Promise<string>;
  cloudReportListStudents?: () => Promise<string>;
  cloudReportRemoveStudent?: (cloudStudentId: string) => Promise<string>;
  cloudReportListReports?: (cloudStudentId: string, cursor?: string) => Promise<string>;
  cloudReportDownload?: (cloudStudentId: string, revisionId: string) => Promise<string>;
  cloudReportListDocuments?: (cloudStudentId: string, cursor?: string) => Promise<string>;
  cloudReportDownloadDocument?: (cloudStudentId: string, documentId: string, reveal?: boolean) => Promise<string>;
  cloudReportListMaterials?: (cloudStudentId: string, options?: { category?: string; history?: boolean; cursor?: string }) => Promise<string>;
  cloudReportDownloadMaterial?: (cloudStudentId: string, revisionId: string, reveal?: boolean) => Promise<string>;
  cloudReportImportMaterial?: (localStudentId: string, cloudStudentId: string, revisionId: string) => Promise<string>;
  cloudReportIssueRemoteAgent?: (input: unknown) => Promise<string>;
  cloudReportRemoteAgentStatus?: (sessionId: string) => Promise<string>;
  cloudReportRevokeRemoteAgent?: (sessionId: string) => Promise<string>;
  cloudReportListInbox?: (cursor?: string, recover?: boolean) => Promise<string>;
  cloudReportListCachedStudents?: () => Promise<string>;
  cloudReportClearCache?: (cloudStudentId: string) => Promise<string>;
};

const reportNames: Record<string, string> = {
  learning_profile: '整体画像', learning_change: '历史变化', weekly_action: '每周行动建议', stage_summary: '阶段总结',
};
const categoryNames: Record<string, string> = { learning_report: '学情报告', learning_material: '学习资料', topic_suggestion: '选题建议', competition_recommendation: '推荐比赛', learning_card: '学习卡片' };
const inboxStatusNames: Record<string, string> = { available: '等待系统核对', leased: '系统正在核对', committed: '已安全接收', quarantined: '结果待核对—未采纳' };
const materialIndexStatusNames: Record<string, string> = {
  ready: '可检索', pending: '等待索引', processing: '正在提取', retry: '等待重试', failed: '索引失败',
  superseded: '已被新版替代', not_scheduled: '尚未索引',
};
const profileFieldOptions = [
  ['displayName', '姓名（建档必需）'], ['grade', '年级'], ['school', '学校'], ['learningGoal', '学习目标'], ['currentRegion', '地区'],
  ['phone', '手机号'], ['email', '邮箱'], ['birthday', '生日'], ['address', '地址'], ['guardian', '监护人信息'],
] as const;
const materialCategoryOptions = Object.entries(categoryNames);
const defaultProfileFields = profileFieldOptions.map(([value]) => value);
const defaultMaterialCategories = ['learning_report'];

async function unwrap<T>(work: Promise<string> | undefined): Promise<T> {
  if (!work) throw new Error('当前版本尚未接入云端文档');
  const result = JSON.parse(await boundedWork(work, 75000, '等待云端响应超时，结果未确认。请刷新状态核对，勿重复开通许可。')) as Result<T>;
  if (!result.ok) throw new Error(result.message || '云端操作失败');
  return result.data as T;
}

export function CloudDocumentsPanel({ api, localStudents, mode = 'settings', focusedStudentId = '', expertIntent = false }: { api?: CloudReportApi; localStudents: Student[]; mode?: 'settings' | 'reports' | 'materials'; focusedStudentId?: string; expertIntent?: boolean }) {
  const [page, setPage] = useState<'connection' | 'results' | 'agents' | 'inbox'>(mode === 'settings' ? 'connection' : 'results');
  const [serverUrl, setServerUrl] = useState('https://www.greatbg.com/edu-cloud');
  const [serverBound, setServerBound] = useState(false);
  const [cloudStudents, setCloudStudents] = useState<CloudStudent[]>([]);
  const [selectedCloudId, setSelectedCloudId] = useState('');
  const selectedCloudIdRef = useRef(selectedCloudId);
  selectedCloudIdRef.current = selectedCloudId;
  const [reports, setReports] = useState<CloudReport[]>([]);
  const [documents, setDocuments] = useState<CloudDocument[]>([]);
  const [materials, setMaterials] = useState<CloudMaterial[]>([]);
  const [materialCursor, setMaterialCursor] = useState('');
  const [documentCursor, setDocumentCursor] = useState('');
  const [cachedStudents, setCachedStudents] = useState<CachedStudent[]>([]);
  const [inboxItems, setInboxItems] = useState<CloudInboxItem[]>([]);
  const [agentSessionId, setAgentSessionId] = useState('');
  const [agentSession, setAgentSession] = useState<RemoteAgentStatus | null>(null);
  const [tab, setTab] = useState<'reports' | 'materials' | 'documents'>(mode === 'materials' ? 'materials' : 'reports');
  const [nextCursor, setNextCursor] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [pairingExpiresAt, setPairingExpiresAt] = useState(0);
  const [selectedLocalId, setSelectedLocalId] = useState(focusedStudentId || localStudents[0]?.id || '');
  const selectedLocalIdRef = useRef(selectedLocalId);
  selectedLocalIdRef.current = selectedLocalId;
  const [approvalCode, setApprovalCode] = useState('');
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({ configured: false, enabled: false });
  const [profileFields, setProfileFields] = useState<string[]>(defaultProfileFields);
  const [materialCategories, setMaterialCategories] = useState<string[]>(defaultMaterialCategories);
  const [healthObjectScope, setHealthObjectScope] = useState<string[]>([]);
  const [preview, setPreview] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [expertDraftStatus, setExpertDraftStatus] = useState<ExpertDraftStatus | null>(null);

  useEffect(() => {
    if (mode === 'settings') return;
    setPage('results'); setTab(mode);
  }, [mode]);

  async function run(task: () => Promise<void>) {
    setBusy(true); setNotice('');
    try { await task(); } catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); }
  }
  async function refreshStudents() {
    const items = await unwrap<CloudStudent[]>(api?.cloudReportListStudents?.());
    setCloudStudents(items);
    setSelectedCloudId(current => items.some(item => item.id === current) ? current : items[0]?.id || '');
  }
  async function refreshReports(studentId: string, cursor = '') {
    const result = await unwrap<{ reports: CloudReport[]; nextCursor: string }>(api?.cloudReportListReports?.(studentId, cursor));
    if (selectedCloudIdRef.current !== studentId) return;
    setReports(current => cursor ? [...current, ...result.reports] : result.reports);
    setNextCursor(result.nextCursor || '');
  }
  async function refreshDocuments(studentId: string, cursor = '') {
    const result = await unwrap<{ documents: CloudDocument[]; nextCursor: string }>(api?.cloudReportListDocuments?.(studentId, cursor));
    if (selectedCloudIdRef.current === studentId) {
      setDocuments(current => cursor ? [...current, ...result.documents] : result.documents);
      setDocumentCursor(result.nextCursor || '');
    }
  }
  async function refreshMaterials(studentId: string, cursor = '') {
    const result = await unwrap<{ materials: CloudMaterial[]; nextCursor: string }>(api?.cloudReportListMaterials?.(studentId, { cursor }));
    if (selectedCloudIdRef.current === studentId) {
      setMaterials(current => cursor ? [...current, ...result.materials] : result.materials);
      setMaterialCursor(result.nextCursor || '');
    }
  }
  async function refreshCache() {
    setCachedStudents(await unwrap<CachedStudent[]>(api?.cloudReportListCachedStudents?.()));
  }
  async function refreshInbox(recover = false) {
    const result = await unwrap<{ submissions: CloudInboxItem[] }>(api?.cloudReportListInbox?.('', recover));
    setInboxItems(result.submissions || []);
  }
  async function refreshUploadStatus(studentId: string) {
    const status = await unwrap<UploadStatus>(api?.cloudReportStatus?.(studentId));
    if (selectedLocalIdRef.current === studentId) {
      setUploadStatus(status);
      setProfileFields(status.savedUploadScope?.profileFields || status.pendingUploadScope?.profileFields || status.profileFields || defaultProfileFields);
      setMaterialCategories(status.savedUploadScope?.materialCategories || status.pendingUploadScope?.materialCategories || status.materialCategories || defaultMaterialCategories);
      setHealthObjectScope(status.healthObjectScope || []);
    }
  }
  async function refreshExpertDraft(studentId: string) {
    if (!api?.cloudReportGetExpertConsultationDraft) return;
    const status = await unwrap<ExpertDraftStatus>(api.cloudReportGetExpertConsultationDraft(studentId));
    if (selectedLocalIdRef.current !== studentId) return;
    setExpertDraftStatus(status);
    if (status.draft) {
      setProfileFields(status.draft.profileFields);
      setMaterialCategories(status.draft.materialCategories);
    }
  }
  async function persistExpertDraft(studentId: string, nextProfileFields: string[], nextMaterialCategories: string[], reviewedAuthorizationVersion?: string) {
    if (!api?.cloudReportSaveExpertConsultationDraft || !studentId) return;
    const status = await unwrap<ExpertDraftStatus>(api.cloudReportSaveExpertConsultationDraft(studentId, {
      profileFields: nextProfileFields, materialCategories: nextMaterialCategories, reviewedAuthorizationVersion,
    }));
    if (selectedLocalIdRef.current === studentId) setExpertDraftStatus(status);
  }
  useEffect(() => {
    let active = true;
    if (page === 'connection' && api?.cloudReportSettings) void unwrap<{ serverUrl: string; bound: boolean }>(api.cloudReportSettings()).then(settings => {
      if (active) { setServerUrl(settings.serverUrl); setServerBound(settings.bound); }
    }).catch(error => { if (active) setNotice(error.message); });
    return () => { active = false; };
  }, [api, page]);
  useEffect(() => {
    if (page !== 'results') return;
    void Promise.allSettled([
      api?.cloudReportListStudents ? refreshStudents() : Promise.resolve(),
      api?.cloudReportListCachedStudents ? refreshCache() : Promise.resolve(),
    ]);
  }, [api, page]);
  useEffect(() => { if (page === 'inbox' && api?.cloudReportListInbox) void refreshInbox(false).catch(error => setNotice((error as Error).message)); }, [api, page]);
  useEffect(() => {
    setPreview('');
    if (page !== 'results' || !selectedCloudId) { if (!selectedCloudId) { setReports([]); setDocuments([]); } return; }
    const work = tab === 'reports' ? refreshReports(selectedCloudId) : tab === 'materials' ? refreshMaterials(selectedCloudId) : refreshDocuments(selectedCloudId);
    void work.catch(error => setNotice((error as Error).message));
  }, [page, selectedCloudId, tab]);
  useEffect(() => {
    if (page !== 'connection' || !selectedLocalId) return;
    void Promise.allSettled([refreshUploadStatus(selectedLocalId), refreshExpertDraft(selectedLocalId)]);
  }, [page, selectedLocalId]);

  const selectedLocal = localStudents.find(student => student.id === selectedLocalId);
  const profilePreviewRows: Array<[string, string, unknown]> = selectedLocal ? [
    ['displayName', '姓名', selectedLocal.name], ['grade', '年级', selectedLocal.grade], ['school', '学校', selectedLocal.school], ['learningGoal', '学习目标', selectedLocal.goal],
    ['currentRegion', '地区', selectedLocal.currentRegion], ['phone', '手机号', selectedLocal.phone], ['email', '邮箱', selectedLocal.email],
    ['birthday', '生日', selectedLocal.birthDate], ['address', '地址', selectedLocal.address], ['guardian', '监护人信息', typeof selectedLocal.guardian === 'string' ? selectedLocal.guardian : selectedLocal.guardian ? '已填写' : ''],
  ] : [];
  const profilePreview = profilePreviewRows.filter(([field, , value]) => profileFields.includes(field) && Boolean(value));

  function toggleSelection(current: string[], value: string, checked: boolean, update: (next: string[]) => void) {
    const next = checked ? [...new Set([...current, value])] : current.filter(item => item !== value);
    update(next);
    const nextProfile = update === setProfileFields ? next : profileFields;
    const nextCategories = update === setMaterialCategories ? next : materialCategories;
    void persistExpertDraft(selectedLocalId, nextProfile, nextCategories).catch(error => setNotice((error as Error).message));
  }
  const consultationLocked = Boolean(expertDraftStatus?.draft && (!expertDraftStatus.authorizationValid || !expertDraftStatus.reviewed));

  return <section className="cloud-documents-screen" aria-label={mode === 'reports' ? '云端学情报告' : mode === 'materials' ? '云端学习资料' : '云端同步设置'}>
    <header className="cloud-documents-header">
      <div><h2>{mode === 'reports' ? '云端学情报告' : mode === 'materials' ? '云端学习资料' : '云端同步设置'}</h2><p>{mode === 'settings' ? '连接与授权、同步结果、外部 Agent 云端访问和成果收件箱分开管理，进入哪一页才读取哪一类数据。' : mode === 'reports' ? '浏览获准学生的当前正式报告与历史修订；下载副本与本机正式档案保持隔离。' : '浏览五类教育资料的当前修订，并按需下载或正式导入本机学生资料库。'}</p></div>
    </header>
    {mode === 'settings' && <nav className="cloud-secondary-nav" aria-label="云端同步二级页面">
      <button className={page === 'connection' ? 'active' : ''} onClick={() => setPage('connection')}><strong>上传与下载设置</strong><span>服务、设备许可、学生上传类别</span></button>
      <button className={page === 'results' ? 'active' : ''} onClick={() => setPage('results')}><strong>同步结果</strong><span>许可学生、同步内容、本机副本</span></button>
      <button className={page === 'agents' ? 'active' : ''} onClick={() => setPage('agents')}><strong>外部 Agent 云端访问</strong><span>只读任务会话、状态与撤销</span></button>
      <button className={page === 'inbox' ? 'active' : ''} onClick={() => setPage('inbox')}><strong>云端成果收件箱</strong><span>查看 Agent 返回与隔离结果</span></button>
    </nav>}
    {notice && <div className="notice cloud-notice" role="status">{notice}</div>}

    {page === 'connection' && <div className="cloud-page" data-cloud-page="connection">
      <div className="cloud-page-intro"><div><strong>上传与下载设置</strong><p>连接只需配置一次；按学生和资料类别管理上传，并向获准设备开放下载。</p></div></div>
      <details className="cloud-setup" open><summary>云端服务设置与连接测试</summary>
        <label>HTTPS 服务地址<input value={serverUrl} disabled={busy || serverBound} onChange={event => setServerUrl(event.target.value)} /></label>
        <p>{serverBound ? '本机已有设备许可，地址已锁定，避免凭据被发送到其他服务。' : '仅保存地址不会上传学生资料；开通指定学生后才开始同步。'}</p>
        <div className="cloud-action-row"><button className="secondary" disabled={busy} onClick={() => void run(async () => {
          await unwrap(api?.cloudReportCheckConnection?.(serverUrl)); setNotice('连接检查通过；尚未改变任何学生许可。');
        })}>测试连接</button>
        <button className="secondary" disabled={busy || serverBound} onClick={() => void run(async () => {
          const settings = await unwrap<{ serverUrl: string; bound: boolean }>(api?.cloudReportSaveSettings?.(serverUrl));
          setServerUrl(settings.serverUrl); setServerBound(settings.bound); setNotice('云端地址已保存到本机。');
        })}>保存地址</button>
        <a href={`${serverUrl.replace(/\/+$/, '')}/`} target="_blank" rel="noreferrer">打开云端管理页</a></div>
      </details>
      <details className="cloud-setup" open><summary>Windows主机下载许可</summary>
        <p>本机出示短配对码后，由已有权限的来源端选择学生并确认。本机没有该学生时，会按云端学生 ID 自动建档；同名但 ID 不同不会自动合并。</p>
        <button className="primary" disabled={busy} onClick={() => void run(async () => {
          const result = await unwrap<{ pairingCode: string; expiresAt: number }>(api?.cloudReportCreatePairing?.(serverUrl));
          setServerBound(true); setPairingCode(result.pairingCode); setPairingExpiresAt(result.expiresAt);
        })}>出示配对码</button>
        {pairingCode && <div className="cloud-pair-code"><strong>{pairingCode}</strong><span>有效至 {new Date(pairingExpiresAt).toLocaleTimeString('zh-CN')}；对方确认后到“同步结果”刷新许可</span></div>}
      </details>
      <details className="cloud-setup" open><summary>授权上传学情资料</summary>
        <p><strong>授权上传学情资料，平台将派遣专属真人专家进行分析提供建议</strong></p>
        {expertIntent && <div className="cloud-expert-intent" role="note"><strong>真人专家解读咨询草稿</strong><span>这里只准备授权范围；进入页面不会上传资料、创建咨询单或改变授权。</span></div>}
        <p>资料按类别授权，不按单文件授权；勾选的类别包含当前有效内容及后续更新，可随时关闭后续上传。</p>
        {localStudents.length ? <>
          <label>本机学生<select value={selectedLocalId} disabled={busy} onChange={event => { setUploadStatus({ configured: false, enabled: false }); setExpertDraftStatus(null); setSelectedLocalId(event.target.value); }}>
            {localStudents.map(student => <option key={student.id} value={student.id}>{student.name}</option>)}</select></label>
          <p>{uploadStatus.configured ? `自动上传：${uploadStatus.enabled ? '开启' : '关闭'}${uploadStatus.lastError ? ` · ${uploadStatus.lastError}` : ''}` : '尚未为此学生开通上传。'}</p>
          <fieldset className="cloud-scope-fieldset"><legend>基础信息（默认全部选择，可手工调整）</legend>
            <div className="cloud-choice-grid">{profileFieldOptions.map(([value, label]) => <label className="cloud-choice" key={value}>
              <input type="checkbox" checked={profileFields.includes(value)} disabled={busy || value === 'displayName'} onChange={event => toggleSelection(profileFields, value, event.target.checked, setProfileFields)} />
              <span>{label}</span>
            </label>)}</div>
          </fieldset>
          {expertDraftStatus?.draft && <div className={`cloud-expert-draft-state ${expertDraftStatus.reviewed ? 'reviewed' : 'locked'}`}>
            <strong>{expertDraftStatus.reviewed ? '咨询范围已按当前授权复核' : expertDraftStatus.authorizationValid ? '需要重新核对咨询范围' : '咨询草稿已保留，当前授权已失效'}</strong>
            <span>切换学生、离开页面、关闭应用或撤权不会删除此草稿；健康资料不在此范围内。</span>
            {expertDraftStatus.authorizationValid && !expertDraftStatus.reviewed && <button className="secondary compact" disabled={busy} onClick={() => void run(async () => {
              await persistExpertDraft(selectedLocalId, profileFields, materialCategories, expertDraftStatus.authorizationVersion);
              setNotice('已按当前授权版本重新核对真人专家咨询范围。');
            })}>确认已重新核对范围</button>}
            <button className="secondary compact" disabled={busy} onClick={() => void run(async () => {
              await unwrap(api?.cloudReportClearExpertConsultationDraft?.(selectedLocalId)); setExpertDraftStatus(null);
              setNotice('已显式清空当前学生的真人专家咨询草稿。');
            })}>清空咨询草稿</button>
          </div>}
          <fieldset className="cloud-scope-fieldset"><legend>授权上传类别（可手工调整）</legend>
            <div className="cloud-choice-grid">{materialCategoryOptions.map(([value, label]) => <label className="cloud-choice" key={value}>
              <input type="checkbox" checked={materialCategories.includes(value)} disabled={busy} onChange={event => toggleSelection(materialCategories, value, event.target.checked, setMaterialCategories)} />
              <span>{label}</span>
            </label>)}</div>
          </fieldset>
          <div className="cloud-health-boundary"><strong>{healthObjectScope.length ? `健康资料：已单独授权 ${healthObjectScope.length} 份` : '健康资料：未授权'}</strong><span>默认关闭，只有在此单独选择的具体文件可以上传；普通资料许可和 Agent 权限不能扩大此范围。</span>
            <button className="secondary compact" disabled={busy || !uploadStatus.configured || !uploadStatus.enabled} onClick={() => void run(async () => {
              const result = await unwrap<{ cancelled: boolean; uploaded: Array<{ revisionId: string }>; objectScope?: string[] }>(api?.cloudReportSelectUploadHealth?.(selectedLocalId));
              if (result.objectScope) setHealthObjectScope(result.objectScope);
              setNotice(result.cancelled ? '未改变健康资料授权。' : `已单独授权并上传 ${result.uploaded.length} 份健康资料。`);
            })}>选择并上传健康资料</button></div>
          <div className="cloud-profile-preview"><strong>当前将同步的已填写信息</strong>
            <p>{profilePreview.length ? profilePreview.map(([, label, value]) => `${label}：${value}`).join('；') : '仅姓名'}。登录 ID、设备密钥、本机路径、Agent 配置、原始对话和原始证据不会上传。</p>
          </div>
          <div className="cloud-action-row"><button className="primary" disabled={busy} onClick={() => void run(async () => {
              const status = await unwrap<UploadStatus>(api?.cloudReportSetUploadScope?.(selectedLocalId, { profileFields, materialCategories }));
              setUploadStatus(status);
              setProfileFields(status.savedUploadScope?.profileFields || status.pendingUploadScope?.profileFields || status.profileFields || defaultProfileFields);
              setMaterialCategories(status.savedUploadScope?.materialCategories || status.pendingUploadScope?.materialCategories || status.materialCategories || defaultMaterialCategories);
              setNotice(status.uploadScopePersistence === 'cloud_confirmed'
                ? '上传范围已保存并经云端确认；后续同步与新开通的下载许可将使用此范围。'
                : status.uploadScopePersistence === 'pending_cloud'
                  ? '上传范围已保存到本机，系统会继续自动向云端确认。'
                  : '上传范围已保存到本机；开通云同步后将按此范围授权，不会自动扩大旧许可。');
            })}>保存选择</button>
            {uploadStatus.configured && <button className="secondary" disabled={busy || !uploadStatus.enabled || consultationLocked} onClick={() => void run(async () => {
              const studentId = selectedLocalId;
              const status = await unwrap<UploadStatus>(api?.cloudReportSyncNow?.(studentId));
              if (selectedLocalIdRef.current !== studentId) return;
              setUploadStatus(status);
              if (!status.lastError && !status.pendingUploadScope && Number(status.lastUploaded || 0) > 0 && expertDraftStatus?.draft) {
                await unwrap(api?.cloudReportClearExpertConsultationDraft?.(studentId)); setExpertDraftStatus(null);
              }
              setNotice(status.lastError || `检查完成：上传 ${status.lastUploaded || 0} 份，内容未变 ${status.lastUnchanged || 0} 份，未上传 ${status.skipped?.length || 0} 份。`);
            })}>立即检查并上传</button>}
            {uploadStatus.configured && <button className="secondary" disabled={busy} onClick={() => void run(() => refreshUploadStatus(selectedLocalId))}>刷新上传状态</button>}</div>
          {uploadStatus.uploadScopePersistence?.startsWith('local_') && <p className="cloud-scope-save-state">选择已保存在本机；旧许可未被扩大。点击开通后将使用本机有效许可证自动创建或复用该学生的云端身份。</p>}
          {uploadStatus.configured && <>
            <p>最近检查：{uploadStatus.lastSyncAt ? new Date(uploadStatus.lastSyncAt).toLocaleString('zh-CN') : '尚未执行'}{uploadStatus.pendingServerWriteState !== null && uploadStatus.pendingServerWriteState !== undefined ? ' · 云端开关仍待确认' : ''}{uploadStatus.pendingUploadScope ? ' · 上传范围仍待云端确认' : ''}</p>
            {uploadStatus.lastSyncAt && <p>本次上传 {uploadStatus.lastUploaded || 0} 份 · 内容未变 {uploadStatus.lastUnchanged || 0} 份 · 未上传 {uploadStatus.skipped?.length || 0} 份</p>}
            {!!uploadStatus.skipped?.length && <ul aria-label="报告未上传原因">{uploadStatus.skipped.map(item => <li key={item.filename}>{item.filename}：{item.reason}</li>)}</ul>}
          </>}
          <div className="cloud-inline-form">
            <button className="primary" disabled={busy || !selectedLocalId} onClick={() => void run(async () => {
              await unwrap(api?.cloudReportEnrollSource?.({ serverUrl, localStudentId: selectedLocalId, profileFields, materialCategories }));
              setServerBound(true); await refreshUploadStatus(selectedLocalId); setNotice('已使用本机许可证自动创建或匹配云端学生，并按勾选范围开通上传；健康资料仍未授权。');
            })}>{uploadStatus.configured ? '修复云端绑定' : '开通云同步'}</button>
            <span>无需管理员创建学生或生成开通码；同一本机学生会稳定复用原云端身份。</span>
          </div>
          {uploadStatus.configured && <button className="secondary" disabled={busy} onClick={() => void run(async () => {
            await unwrap(api?.cloudReportSetUpload?.(selectedLocalId, !uploadStatus.enabled)); await refreshUploadStatus(selectedLocalId);
          })}>{uploadStatus.enabled ? '关闭自动上传' : '重新开启上传'}</button>}
          <div className="cloud-inline-form"><input aria-label="接收 Windows 主机配对码" placeholder="接收 Windows 主机出示的 8 位配对码" value={approvalCode} onChange={event => setApprovalCode(event.target.value)} />
            <button className="secondary" disabled={busy || !approvalCode || !uploadStatus.enabled} onClick={() => void run(async () => {
              await unwrap(api?.cloudReportApprovePairing?.(approvalCode, [selectedLocalId], { profileFields, materialCategories, healthObjectScope }));
              setApprovalCode(''); setNotice(`已按当前勾选范围为接收主机开通下载许可${healthObjectScope.length ? `，并单独开放 ${healthObjectScope.length} 份健康资料` : '；健康资料未授权'}。`);
            })}>确认下载许可</button></div>
        </> : <p>本机没有学生档案；仍可使用上方 Windows 主机下载许可。</p>}
      </details>
    </div>}

    {page === 'results' && <div className="cloud-page" data-cloud-page="results">
      <div className="cloud-page-intro"><div><strong>同步结果</strong><p>查看已获许可学生的同步内容，以及本机已下载的副本。</p></div><button className="secondary" disabled={busy} onClick={() => void run(async () => { await Promise.all([refreshStudents(), refreshCache()]); })}>刷新同步结果</button></div>
      <div className="cloud-documents-layout">
      <aside className="cloud-student-rail">
        <strong>已获许可的学生</strong>
        {cloudStudents.map(student => <button key={student.id} className={selectedCloudId === student.id ? 'selected' : ''}
          title={student.bindingIssue || (student.localBinding ? '本机档案已自动建立或更新' : '')}
          onClick={() => { selectedCloudIdRef.current = student.id; setSelectedCloudId(student.id); setReports([]); setDocuments([]); setNextCursor(''); setPreview(''); }}>{student.displayName}{student.bindingIssue ? ' · 需要你处理' : student.localBinding ? ' · 本机档案已就绪' : ''}{student.expiresAt ? ` · 有效至 ${new Date(student.expiresAt).toLocaleDateString('zh-CN')}` : ''}</button>)}
        {!cloudStudents.length && <p>尚无下载许可。请先为本机开通指定学生。</p>}
      </aside>
      <div className="cloud-documents-main">
        <div className="cloud-documents-tabs"><div className="cloud-tab-buttons">
          {mode === 'settings' && <>
          <button className={tab === 'reports' ? 'active' : ''} onClick={() => setTab('reports')}>学情报告</button>
          <button className={tab === 'materials' ? 'active' : ''} onClick={() => setTab('materials')}>云端学习资料</button>
          <button className={tab === 'documents' ? 'active' : ''} onClick={() => setTab('documents')}>历史其他文档</button>
          </>}
          {mode === 'reports' && <strong>学情报告</strong>}{mode === 'materials' && <strong>云端学习资料</strong>}
        </div><span>同一学生下载许可，无需逐份申请</span></div>
        {selectedCloudId ? <>
          <div className="cloud-list-tools"><span>本机对该学生的云端下载许可</span>
            <button className="secondary compact" disabled={busy} onClick={() => {
              const student = cloudStudents.find(item => item.id === selectedCloudId);
              if (!student || !window.confirm(`从本机移除“${student.displayName}”的云端许可？这不会删除云端学生、本机学生档案或已经下载的副本。`)) return;
              void run(async () => {
                await unwrap(api?.cloudReportRemoveStudent?.(student.id));
                setReports([]); setDocuments([]); setMaterials([]); setPreview('');
                await refreshStudents();
                setNotice('已移除本机云端许可；已有本机档案和下载副本均已保留。');
              });
            }}>从本机移除许可</button>
          </div>
          {tab === 'reports' ? <><div className="cloud-list-tools"><span>来自 Android 单机版或其他 Windows 主机</span>
            <button className="secondary compact" disabled={busy} onClick={() => void run(() => refreshReports(selectedCloudId))}>刷新报告</button></div>
          <div className="cloud-report-table-wrap"><table className="cloud-report-table"><thead><tr>
            <th>报告</th><th>来源</th><th>生成时间</th><th>版本</th><th>操作</th>
          </tr></thead><tbody>{reports.map(item => <tr key={item.revisionId}>
            <td>{reportNames[item.reportType] || item.filename}</td><td>{item.originPlatform === 'windows' ? 'Windows' : 'Android'}</td>
            <td>{item.publishedAt}</td><td>{item.revisionId.slice(-8)}</td><td><button className="cloud-text-button" disabled={busy} onClick={() => void run(async () => {
              const downloaded = await unwrap<{ content: string }>(api?.cloudReportDownload?.(selectedCloudId, item.revisionId));
              await refreshCache();
              if (selectedCloudIdRef.current === selectedCloudId) { setPreview(downloaded.content); setNotice('已校验并保存到本机云端只读缓存。'); }
            })}>下载并查看</button></td>
          </tr>)}</tbody></table>{!reports.length && <p className="cloud-empty">这个学生还没有可下载的正式报告。</p>}</div>
          {nextCursor && <button className="secondary compact" disabled={busy} onClick={() => void run(() => refreshReports(selectedCloudId, nextCursor))}>加载更多历史修订</button>}
          </> : tab === 'materials' ? <><div className="cloud-list-tools"><span>五类资料按授权和修订版本隔离；默认显示当前版本</span>
            <button className="secondary compact" disabled={busy} onClick={() => void run(() => refreshMaterials(selectedCloudId))}>刷新资料</button></div>
          <div className="cloud-report-table-wrap"><table className="cloud-report-table"><thead><tr>
            <th>名称</th><th>类别</th><th>检索状态</th><th>大小</th><th>版本时间</th><th>操作</th>
          </tr></thead><tbody>{materials.map(item => <tr key={item.revisionId}>
            <td>{item.displayName}</td><td>{categoryNames[item.category] || item.category}</td>
            <td>{item.indexStatus ? (materialIndexStatusNames[item.indexStatus] || item.indexStatus) : '服务端待升级'}</td><td>{Math.ceil(item.byteSize / 1024)} KB</td>
            <td>{new Date(item.createdAt).toLocaleString('zh-CN')}</td><td><button className="cloud-text-button" disabled={busy} onClick={() => void run(async () => {
              const result = await unwrap<{ content: string; path: string }>(api?.cloudReportDownloadMaterial?.(selectedCloudId, item.revisionId, item.contentType !== 'text/markdown'));
              await refreshCache(); setPreview(result.content || ''); setNotice(result.content ? '资料已校验并保存到本机只读缓存。' : `资料已校验并保存：${result.path}`);
            })}>{item.contentType === 'text/markdown' ? '下载并查看' : '下载并定位'}</button>
              <button className="cloud-text-button" disabled={busy || !selectedLocalId} onClick={() => void run(async () => {
                const result = await unwrap<{ imported: number; skipped: number; message: string }>(api?.cloudReportImportMaterial?.(selectedLocalId, selectedCloudId, item.revisionId));
                await refreshCache(); setNotice(result.message || (result.imported ? '已导入本机学生资料库。' : '本机已有相同资料。'));
              })}>导入到本机</button></td>
          </tr>)}</tbody></table>{!materials.length && <p className="cloud-empty">这个学生还没有当前可下载的授权资料。</p>}</div>
          {materialCursor && <button className="secondary compact" disabled={busy} onClick={() => void run(() => refreshMaterials(selectedCloudId, materialCursor))}>加载更多资料</button>}
          </> : <><div className="cloud-list-tools"><span>旧版“其他文档”兼容入口，不会自动扩大为五类资料授权</span>
            <button className="secondary compact" disabled={busy} onClick={() => void run(() => refreshDocuments(selectedCloudId))}>刷新文档</button></div>
          <div className="cloud-report-table-wrap"><table className="cloud-report-table"><thead><tr>
            <th>名称</th><th>类型</th><th>大小</th><th>上传时间</th><th>操作</th>
          </tr></thead><tbody>{documents.map(item => <tr key={item.documentId}>
            <td>{item.displayName}</td><td>{item.contentType === 'text/markdown' ? 'Markdown' : item.contentType === 'application/pdf' ? 'PDF' : 'DOCX'}</td>
            <td>{Math.ceil(item.byteSize / 1024)} KB</td><td>{new Date(item.createdAt).toLocaleDateString('zh-CN')}</td>
            <td><button className="cloud-text-button" disabled={busy} onClick={() => void run(async () => {
              const result = await unwrap<{ content: string; path: string }>(api?.cloudReportDownloadDocument?.(
                selectedCloudId, item.documentId, item.contentType !== 'text/markdown'));
              await refreshCache();
              if (selectedCloudIdRef.current === selectedCloudId) {
                setPreview(result.content || '');
                setNotice(result.content ? '已校验并保存到本机云端缓存，可在下方查看。' : `已校验并保存，已在文件夹中定位：${result.path}`);
              }
            })}>{item.contentType === 'text/markdown' ? '下载并查看' : '下载并定位'}</button></td>
          </tr>)}</tbody></table>{!documents.length && <p className="cloud-empty">这个学生还没有可下载的其他文档。</p>}</div></>}
          {tab === 'documents' && documentCursor && <button disabled={busy} onClick={() => void run(() => refreshDocuments(selectedCloudId, documentCursor))}>加载更多文档</button>}
          {preview && <details className="cloud-preview" open><summary>{tab === 'reports' ? '报告正文' : '资料预览'}（只读）</summary><pre>{preview}</pre></details>}
        </> : <p className="cloud-empty">先完成一次配对，即可持续查看该学生后续更新，无需逐份申请。</p>}
      </div>
      </div>
      <section className="cloud-setup cloud-static-section"><h3>已下载的本机副本</h3>
        <p>撤销下载许可会阻止新的云端读取，已有本机副本不会自动删除。这里可按学生主动清除；本机正式报告不受影响。</p>
        <button className="secondary compact" disabled={busy} onClick={() => void run(refreshCache)}>刷新本机副本</button>
        {cachedStudents.map(student => <div className="cloud-cache-row" key={student.cloudStudentId}>
          <span>{student.displayName}</span>
          <button className="secondary compact" disabled={busy} onClick={() => {
            if (!window.confirm(`仅清除“${student.displayName}”已下载到本机的云端副本？本机正式报告不会删除。`)) return;
            void run(async () => { await unwrap(api?.cloudReportClearCache?.(student.cloudStudentId)); await refreshCache(); setPreview(''); setNotice('该学生的本机云端副本已清除。'); });
          }}>清除此学生副本</button>
        </div>)}
        {!cachedStudents.length && <p>本机尚无已下载的云端副本。</p>}
      </section>
    </div>}

    {page === 'agents' && <div className="cloud-page" data-cloud-page="agents">
      <div className="cloud-page-intro"><div><strong>外部 Agent 云端访问</strong><p>远程 Codex 或 WorkBuddy 仅在任务执行时获得短期、按学生和项目冻结的只读范围；上传许可不会自动转成 Agent 读取许可。</p></div></div>
      <section className="cloud-setup cloud-static-section">
        <h3>查询或撤销任务会话</h3>
        <p>输入任务记录中的会话编号。连接凭据不会在此页面显示；撤销只停止新的云端读取，不删除已同步资料。</p>
        <div className="cloud-inline-form"><input aria-label="远程 Agent 会话编号" placeholder="输入 sessionId" value={agentSessionId} onChange={event => setAgentSessionId(event.target.value.trim())} />
          <button className="secondary" disabled={busy || !agentSessionId} onClick={() => void run(async () => {
            const status = await unwrap<RemoteAgentStatus>(api?.cloudReportRemoteAgentStatus?.(agentSessionId));
            setAgentSession(status); setNotice('已读取会话状态。');
          })}>查询状态</button>
          <button className="danger" disabled={busy || !agentSessionId} onClick={() => {
            if (!window.confirm('停止该远程 Agent 会话的后续云端访问？已同步资料和本机任务不会删除。')) return;
            void run(async () => { const status = await unwrap<RemoteAgentStatus>(api?.cloudReportRevokeRemoteAgent?.(agentSessionId)); setAgentSession(status); setNotice('远程 Agent 会话已撤销。'); });
          }}>撤销访问</button></div>
        {agentSession && <div className="cloud-cache-row"><span>{agentSession.provider || 'Agent'} · {agentSession.status || (agentSession.revokedAt ? '已撤销' : '状态未知')}</span>
          <small>项目 {agentSession.projectId || '-'} · 任务 {agentSession.taskId || '-'}{agentSession.expiresAt ? ` · 有效至 ${new Date(agentSession.expiresAt).toLocaleString('zh-CN')}` : ''}</small></div>}
      </section>
    </div>}

    {page === 'inbox' && <div className="cloud-page" data-cloud-page="inbox">
      <div className="cloud-page-intro"><div><strong>云端成果收件箱</strong><p>查看 Codex、WorkBuddy 返回的成果；范围变化时自动隔离，不会重复派发或写入项目知识空间。</p></div>
        <button className="secondary" disabled={busy} onClick={() => void run(() => refreshInbox(true))}>核对并刷新成果</button></div>
      <section className="cloud-setup cloud-static-section">
      {inboxItems.map(item => <div className="cloud-cache-row" key={item.submissionId}>
        <span>{item.provider === 'codex' ? 'Codex' : item.provider === 'workbuddy' ? 'WorkBuddy' : item.provider} · {item.projectId || '单学生任务'} · {inboxStatusNames[item.status] || item.status}</span>
        <small>{item.quarantinedReason || new Date(item.updatedAt).toLocaleString('zh-CN')}</small>
      </div>)}
      {!inboxItems.length && <p className="cloud-empty">当前没有待处理的云端 Agent 成果。</p>}
      </section>
    </div>}
  </section>;
}
