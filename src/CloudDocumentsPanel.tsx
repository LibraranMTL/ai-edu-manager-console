import React, { useEffect, useRef, useState } from 'react';
import './cloud-documents.css';
import { boundedWork } from './bounded-work';

type Result<T> = { ok: boolean; data?: T; message?: string };
type Student = { id: string; name: string };
type CloudStudent = { id: string; displayName: string; expiresAt?: number | null };
type CloudReport = { revisionId: string; reportType: string; originDeviceId: string; originPlatform: string; publishedAt: string; receivedAt: number; filename: string };
type CloudDocument = { documentId: string; displayName: string; contentType: string; byteSize: number; createdAt: number };
type CachedStudent = { cloudStudentId: string; displayName: string };
type UploadStatus = { configured: boolean; enabled: boolean; cloudStudentId?: string; lastSyncAt?: number; serverVerifiedAt?: number; syncing?: boolean; lastError?: string; pendingServerWriteState?: boolean | null; lastUploaded?: number; lastUnchanged?: number; lastReady?: number; skipped?: { filename: string; reason: string }[] };

export type CloudReportApi = {
  cloudReportSettings?: () => Promise<string>;
  cloudReportSaveSettings?: (serverUrl: string) => Promise<string>;
  cloudReportCheckConnection?: (serverUrl: string) => Promise<string>;
  cloudReportEnrollSource?: (input: { serverUrl: string; enrollmentCode: string; localStudentId: string }) => Promise<string>;
  cloudReportSetUpload?: (studentId: string, enabled: boolean) => Promise<string>;
  cloudReportStatus?: (studentId: string) => Promise<string>;
  cloudReportSyncNow?: (studentId: string) => Promise<string>;
  cloudReportCreatePairing?: (serverUrl: string) => Promise<string>;
  cloudReportApprovePairing?: (pairingCode: string, studentIds: string[]) => Promise<string>;
  cloudReportListStudents?: () => Promise<string>;
  cloudReportListReports?: (cloudStudentId: string, cursor?: string) => Promise<string>;
  cloudReportDownload?: (cloudStudentId: string, revisionId: string) => Promise<string>;
  cloudReportListDocuments?: (cloudStudentId: string, cursor?: string) => Promise<string>;
  cloudReportDownloadDocument?: (cloudStudentId: string, documentId: string, reveal?: boolean) => Promise<string>;
  cloudReportListCachedStudents?: () => Promise<string>;
  cloudReportClearCache?: (cloudStudentId: string) => Promise<string>;
};

const reportNames: Record<string, string> = {
  learning_profile: '整体画像', learning_change: '历史变化', weekly_action: '每周行动建议', stage_summary: '阶段总结',
};

async function unwrap<T>(work: Promise<string> | undefined): Promise<T> {
  if (!work) throw new Error('当前版本尚未接入云端文档');
  const result = JSON.parse(await boundedWork(work, 75000, '等待云端响应超时，结果未确认。请刷新状态核对，勿重复开通许可。')) as Result<T>;
  if (!result.ok) throw new Error(result.message || '云端操作失败');
  return result.data as T;
}

export function CloudDocumentsPanel({ api, localStudents }: { api?: CloudReportApi; localStudents: Student[] }) {
  const [serverUrl, setServerUrl] = useState('https://www.greatbg.com/edu-cloud');
  const [serverBound, setServerBound] = useState(false);
  const [cloudStudents, setCloudStudents] = useState<CloudStudent[]>([]);
  const [selectedCloudId, setSelectedCloudId] = useState('');
  const selectedCloudIdRef = useRef(selectedCloudId);
  selectedCloudIdRef.current = selectedCloudId;
  const [reports, setReports] = useState<CloudReport[]>([]);
  const [documents, setDocuments] = useState<CloudDocument[]>([]);
  const [documentCursor, setDocumentCursor] = useState('');
  const [cachedStudents, setCachedStudents] = useState<CachedStudent[]>([]);
  const [tab, setTab] = useState<'reports' | 'documents'>('reports');
  const [nextCursor, setNextCursor] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [pairingExpiresAt, setPairingExpiresAt] = useState(0);
  const [selectedLocalId, setSelectedLocalId] = useState(localStudents[0]?.id || '');
  const selectedLocalIdRef = useRef(selectedLocalId);
  selectedLocalIdRef.current = selectedLocalId;
  const [enrollmentCode, setEnrollmentCode] = useState('');
  const [approvalCode, setApprovalCode] = useState('');
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({ configured: false, enabled: false });
  const [preview, setPreview] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

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
  async function refreshCache() {
    setCachedStudents(await unwrap<CachedStudent[]>(api?.cloudReportListCachedStudents?.()));
  }
  async function refreshUploadStatus(studentId: string) {
    const status = await unwrap<UploadStatus>(api?.cloudReportStatus?.(studentId));
    if (selectedLocalIdRef.current === studentId) setUploadStatus(status);
  }
  useEffect(() => {
    let active = true;
    if (api?.cloudReportSettings) void unwrap<{ serverUrl: string; bound: boolean }>(api.cloudReportSettings()).then(settings => {
      if (active) { setServerUrl(settings.serverUrl); setServerBound(settings.bound); }
    }).catch(error => { if (active) setNotice(error.message); });
    return () => { active = false; };
  }, [api]);
  useEffect(() => { if (api?.cloudReportListStudents) void refreshStudents().catch(() => {}); }, [api]);
  useEffect(() => { if (api?.cloudReportListCachedStudents) void refreshCache().catch(() => {}); }, [api]);
  useEffect(() => {
    setPreview('');
    if (!selectedCloudId) { setReports([]); setDocuments([]); return; }
    const work = tab === 'reports' ? refreshReports(selectedCloudId) : refreshDocuments(selectedCloudId);
    void work.catch(error => setNotice((error as Error).message));
  }, [selectedCloudId, tab]);
  useEffect(() => { if (selectedLocalId) void refreshUploadStatus(selectedLocalId).catch(() => {}); }, [selectedLocalId]);

  return <section className="cloud-documents-screen" aria-label="云端文档">
    <header className="cloud-documents-header">
      <div><h2>云端文档</h2><p>只查看本机已获许可学生的共享报告；本机报告与云端副本彼此独立。</p></div>
      <button className="secondary" disabled={busy} onClick={() => void run(refreshStudents)}>刷新许可</button>
    </header>
    {notice && <div className="notice" role="status">{notice}</div>}
    <details className="cloud-setup"><summary>云端服务设置与连接测试</summary>
      <label>HTTPS 服务地址<input value={serverUrl} disabled={busy || serverBound} onChange={event => setServerUrl(event.target.value)} /></label>
      <p>{serverBound ? '本机已有设备许可，地址锁定，避免凭据泄露到其他服务。' : '仅保存地址不会上传任何学生资料。开通指定学生后才会同步正式报告。'}</p>
      <button className="secondary" disabled={busy} onClick={() => void run(async () => {
        await unwrap(api?.cloudReportCheckConnection?.(serverUrl)); setNotice('HTTPS 与云端服务身份检查通过；尚未证明学生许可或同步成功。');
      })}>测试连接</button>
      <button className="secondary" disabled={busy || serverBound} onClick={() => void run(async () => {
        const settings = await unwrap<{ serverUrl: string; bound: boolean }>(api?.cloudReportSaveSettings?.(serverUrl));
        setServerUrl(settings.serverUrl); setServerBound(settings.bound); setNotice('云端地址已保存到本机。');
      })}>保存地址</button>
      <a href={`${serverUrl.replace(/\/+$/, '')}/`} target="_blank" rel="noreferrer">打开云端管理页</a>
    </details>
    <div className="cloud-documents-layout">
      <aside className="cloud-student-rail">
        <strong>已获许可的学生</strong>
        {cloudStudents.map(student => <button key={student.id} className={selectedCloudId === student.id ? 'selected' : ''}
          onClick={() => { selectedCloudIdRef.current = student.id; setSelectedCloudId(student.id); setReports([]); setDocuments([]); setNextCursor(''); setPreview(''); }}>{student.displayName}{student.expiresAt ? ` · 有效至 ${new Date(student.expiresAt).toLocaleDateString('zh-CN')}` : ''}</button>)}
        {!cloudStudents.length && <p>尚无下载许可。请先为本机开通指定学生。</p>}
      </aside>
      <div className="cloud-documents-main">
        <div className="cloud-documents-tabs"><div className="cloud-tab-buttons">
          <button className={tab === 'reports' ? 'active' : ''} onClick={() => setTab('reports')}>学情报告</button>
          <button className={tab === 'documents' ? 'active' : ''} onClick={() => setTab('documents')}>其他文档</button>
        </div><span>同一学生下载许可，无需逐份申请</span></div>
        {selectedCloudId ? <>
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
          </> : <><div className="cloud-list-tools"><span>由有权限的来源端或云端管理页主动上传</span>
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
          {preview && <details className="cloud-preview" open><summary>{tab === 'reports' ? '报告正文' : '文档预览'}（只读）</summary><pre>{preview}</pre></details>}
        </> : <p className="cloud-empty">先完成一次配对，即可持续查看该学生后续更新，无需逐份申请。</p>}
      </div>
    </div>
    <details className="cloud-setup"><summary>Windows主机下载许可</summary>
      <p>本机出示短配对码后，请已有权限的 Android 单机版或 Windows 主机来源端选择学生并确认。许可有效期一年，期间无需逐份申请；到期后重新配对即可续期。</p>
      <button className="primary" disabled={busy} onClick={() => void run(async () => {
        const result = await unwrap<{ pairingCode: string; expiresAt: number }>(api?.cloudReportCreatePairing?.(serverUrl));
        setServerBound(true);
        setPairingCode(result.pairingCode); setPairingExpiresAt(result.expiresAt);
      })}>出示配对码</button>
      {pairingCode && <div className="cloud-pair-code"><strong>{pairingCode}</strong><span>有效至 {new Date(pairingExpiresAt).toLocaleTimeString('zh-CN')}；确认后点“刷新许可”</span></div>}
    </details>
    <details className="cloud-setup"><summary>已下载的本机副本</summary>
      <p>撤销下载许可会阻止新的云端读取，已有本机副本不会自动删除。这里可按学生主动清除；本机正式报告不受影响。</p>
      <button className="secondary compact" disabled={busy} onClick={() => void run(refreshCache)}>刷新缓存</button>
      {cachedStudents.map(student => <div className="cloud-cache-row" key={student.cloudStudentId}>
        <span>{student.displayName}</span>
        <button className="secondary compact" disabled={busy} onClick={() => {
          if (!window.confirm(`仅清除“${student.displayName}”已下载到本机的云端副本？本机正式报告不会删除。`)) return;
          void run(async () => { await unwrap(api?.cloudReportClearCache?.(student.cloudStudentId));
            await refreshCache(); setPreview(''); setNotice('该学生的本机云端副本已清除。'); });
        }}>清除此学生副本</button>
      </div>)}
      {!cachedStudents.length && <p>本机尚无已下载的云端副本。</p>}
    </details>
    <details className="cloud-setup"><summary>本机学生上传与授权</summary>
      {localStudents.length ? <>
        <label>本机学生<select value={selectedLocalId} disabled={busy} onChange={event => { setUploadStatus({ configured: false, enabled: false }); setSelectedLocalId(event.target.value); }}>
          {localStudents.map(student => <option key={student.id} value={student.id}>{student.name}</option>)}</select></label>
        <p>{uploadStatus.configured ? `自动上传：${uploadStatus.enabled ? '开启' : '关闭'}${uploadStatus.lastError ? ` · ${uploadStatus.lastError}` : ''}` : '尚未为此学生开通上传。'}</p>
        {uploadStatus.configured && <>
          <p>开启授权不等于已经上传。最近检查：{uploadStatus.lastSyncAt ? new Date(uploadStatus.lastSyncAt).toLocaleString('zh-CN') : '尚未执行'}{uploadStatus.pendingServerWriteState !== null && uploadStatus.pendingServerWriteState !== undefined ? ' · 云端开关仍待确认' : ''}</p>
          <p>{uploadStatus.syncing ? '正在核对云端回执…' : uploadStatus.serverVerifiedAt ? `云端已核对：${new Date(uploadStatus.serverVerifiedAt).toLocaleString('zh-CN')}` : '旧本机状态尚未重新核对云端，请点击立即检查并上传。'} 上传许可与下载许可相互独立；本机云端浏览器不重复显示自己的报告。请在云端管理页选择同一学生，并查看“学情报告”，而非“其他文档”。</p>
          {uploadStatus.lastSyncAt && <p>本次上传 {uploadStatus.lastUploaded || 0} 份 · 内容未变 {uploadStatus.lastUnchanged || 0} 份 · 未上传 {uploadStatus.skipped?.length || 0} 份</p>}
          {!!uploadStatus.skipped?.length && <ul aria-label="报告未上传原因">{uploadStatus.skipped.map(item => <li key={item.filename}>{item.filename}：{item.reason}</li>)}</ul>}
          <button className="secondary" disabled={busy || !uploadStatus.enabled} onClick={() => void run(async () => {
            const studentId = selectedLocalId;
            const status = await unwrap<UploadStatus>(api?.cloudReportSyncNow?.(studentId));
            if (selectedLocalIdRef.current !== studentId) return;
            setUploadStatus(status);
            setNotice(status.lastError || `报告检查完成：本次上传 ${status.lastUploaded || 0} 份，内容未变 ${status.lastUnchanged || 0} 份，未上传 ${status.skipped?.length || 0} 份。`);
            if (selectedCloudId) await refreshReports(selectedCloudId);
          })}>立即检查并上传</button>
          <button className="secondary" disabled={busy} onClick={() => void run(() => refreshUploadStatus(selectedLocalId))}>刷新上传状态</button>
        </>}
        <div className="cloud-inline-form"><input aria-label="学生开通码" placeholder="输入云端管理页生成的学生开通码" value={enrollmentCode} onChange={event => setEnrollmentCode(event.target.value)} />
          <button className="primary" disabled={busy || !enrollmentCode} onClick={() => void run(async () => {
            await unwrap(api?.cloudReportEnrollSource?.({ serverUrl, enrollmentCode, localStudentId: selectedLocalId }));
            setServerBound(true);
            setEnrollmentCode(''); await refreshUploadStatus(selectedLocalId); setNotice('已开启当前正式报告及后续更新的自动上传。');
          })}>{uploadStatus.configured ? '重新开通' : '开通并上传'}</button></div>
        {uploadStatus.configured && <button className="secondary" disabled={busy} onClick={() => void run(async () => {
          await unwrap(api?.cloudReportSetUpload?.(selectedLocalId, !uploadStatus.enabled));
          await refreshUploadStatus(selectedLocalId);
        })}>{uploadStatus.enabled ? '关闭自动上传' : '重新开启上传'}</button>}
        <div className="cloud-inline-form"><input aria-label="接收 Windows 主机配对码" placeholder="接收 Windows 主机出示的 8 位配对码" value={approvalCode} onChange={event => setApprovalCode(event.target.value)} />
          <button className="secondary" disabled={busy || !approvalCode || !uploadStatus.enabled} onClick={() => void run(async () => {
            await unwrap(api?.cloudReportApprovePairing?.(approvalCode, [selectedLocalId]));
            setApprovalCode(''); setNotice('已为接收 Windows 主机开通此学生的持续下载许可。');
          })}>确认下载许可</button></div>
      </> : <p>本机没有学生档案；仍可只使用上方云端下载入口。</p>}
    </details>
  </section>;
}
