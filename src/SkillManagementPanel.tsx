import React, { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  Archive, Bot, Check, CheckCircle2, ChevronDown, Copy, Download, FileArchive, FolderOpen, FolderOutput,
  HardDrive, Info, Library, LoaderCircle, LockKeyhole, PackageCheck, RefreshCw, RotateCcw,
  Search, ShieldAlert, ShieldCheck, Tag, Trash2, Upload, X,
} from 'lucide-react';
import './skill-management.css';

export type SkillLibraryApi = { skillLibraryAction?: (action: string, input: unknown) => Promise<string> };
type ProviderId = 'codex' | 'workbuddy' | 'qclaw';
type RiskFinding = { id: string; severity: 'info' | 'warn' | 'block'; path?: string; message: string };
type Installation = { installationId: string; providerId: ProviderId; versionId: string; state: string; installedAt: string; verifiedAt?: string };
type Artifact = {
  artifactId: string; kind: 'skill' | 'plugin'; currentVersionId: string;
  identity: { name: string; displayName: string; publisher: string };
  tags: { system: string[]; semantic: string[]; user: string[]; manualLocked: boolean };
  compatibility: ProviderId[];
  version?: { versionId: string; declaredVersion: string; description: string; sourceType: string; sourceUri: string; treeSha256: string; manifestSha256: string; fileCount: number; totalBytes: number; license: string; riskFindings: RiskFinding[]; observedCapabilities: string[] };
  installations: Installation[];
};
type Candidate = {
  discoveryId: string; providerId: ProviderId; sourceKind: string; sourceRoot: string; relativePath: string;
  kind: 'skill' | 'plugin' | 'unknown'; identity?: { name: string; displayName: string; description: string; declaredVersion: string };
  treeSha256: string; fileCount: number; totalBytes: number; riskFindings: RiskFinding[]; inspectionStatus: string; message?: string;
};
type ProviderCapability = {
  providerId: ProviderId; installed: boolean; canScan: boolean; canExport: boolean; canInstallSkill: boolean;
  canInstallPlugin: boolean; canUpdate: boolean; canRollback: boolean; canUninstall: boolean; requiresRestart: boolean; reason: string;
};
type Snapshot = {
  library: { rootPath: string; writable: boolean; settings: { limits: Record<string, number> } };
  counts: { artifacts: number; versions: number; installations: number; quarantined: number };
  providers: ProviderCapability[];
  scans: Array<{ providerId: ProviderId; scannedAt: string; candidates: Candidate[] }>;
  recentReceipts: Array<{ receiptId: string; kind: string; status: string; providerId?: string; createdAt?: string }>;
  scope: string; mcpEnabled: boolean; pluginInstallEnabled: boolean;
};
type InstallPlan = {
  planId: string; planHash: string; artifactId: string; versionId: string; providerId: ProviderId; targetPath: string;
  beforeFingerprint: string; objectTreeSha256: string; changes: { add: number; replace: number; preserve: number };
  riskFindings: RiskFinding[]; requiresRestart: boolean; rollbackAvailable: boolean; expiresAt: string;
};
type ImportResult = {
  status: 'completed' | 'partial' | 'failed'; mode: 'single' | 'batch'; total: number;
  counts: { archived: number; duplicate: number; quarantined: number; failed: number };
};
type ManualInstallInfo = { archivePath: string; readOnlyArchive: true; kind: 'skill'; treeSha256: string };

const providerLabels: Record<ProviderId, string> = { codex: 'Codex', workbuddy: 'WorkBuddy', qclaw: 'QClaw' };
const categories = ['全部', 'education', 'research', 'documents', 'development', 'media', 'automation', 'knowledge', 'office'];
const categoryLabels: Record<string, string> = { 全部: '全部', education: '教育教学', research: '研究', documents: '文档', development: '开发', media: '媒体', automation: '自动化', knowledge: '知识库', office: '办公' };

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function parseResponse<T>(raw: string): T {
  const parsed = JSON.parse(raw || '{}') as { ok?: boolean; data?: T; message?: string };
  if (!parsed.ok) throw Error(parsed.message || 'Skills 管理操作失败');
  return parsed.data as T;
}

function SourceBadge({ providerId }: { providerId: ProviderId }) {
  return <span className={`skill-lib-source skill-lib-source--${providerId}`}>{providerLabels[providerId]}</span>;
}

function RiskBadge({ findings = [] }: { findings?: RiskFinding[] }) {
  const blocked = findings.some(item => item.severity === 'block');
  const warned = findings.some(item => item.severity === 'warn');
  return <span className={`skill-lib-risk ${blocked ? 'is-blocked' : warned ? 'is-warned' : 'is-safe'}`}>{blocked ? <ShieldAlert size={13} /> : <ShieldCheck size={13} />}{blocked ? '已阻止' : warned ? '需确认' : '低风险'}</span>;
}

const DiscoveryRow = memo(function DiscoveryRow({ item, checked, busy, onToggle }: { item: Candidate; checked: boolean; busy: boolean; onToggle: (id: string) => void }) {
  const blocked = item.inspectionStatus === 'quarantined' || item.inspectionStatus === 'unsupported';
  return <label className={`skill-lib-discovery-row ${blocked ? 'is-blocked' : ''}`}><input type="checkbox" disabled={blocked || busy} checked={checked} onChange={() => onToggle(item.discoveryId)} /><span className="skill-lib-mini-icon">{item.kind === 'plugin' ? 'P' : 'S'}</span><span className="skill-lib-discovery-main"><strong>{item.identity?.displayName || item.identity?.name || item.relativePath}</strong><small><SourceBadge providerId={item.providerId} /> {item.relativePath} · {item.fileCount} 文件 · {formatBytes(item.totalBytes)}</small></span><RiskBadge findings={item.riskFindings} /></label>;
});

function InstallDialog({ artifact, plan, busy, onClose, onConfirm }: { artifact: Artifact; plan: InstallPlan; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  return <div className="skill-lib-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && !busy && onClose()}>
    <section className="skill-lib-dialog" role="dialog" aria-modal="true" aria-labelledby="skill-install-title">
      <button type="button" className="skill-lib-icon-button dialog-close" aria-label="关闭" disabled={busy} onClick={onClose}><X size={18} /></button>
      <div className="skill-lib-dialog-heading"><span className="skill-lib-artifact-icon"><PackageCheck size={22} /></span><div><span>安装预览</span><h3 id="skill-install-title">{artifact.identity.displayName}</h3><code>{artifact.identity.name} · {artifact.version?.declaredVersion}</code></div></div>
      <dl className="skill-lib-plan-grid">
        <div><dt>目标 Agent</dt><dd>{providerLabels[plan.providerId]}</dd></div>
        <div><dt>安装范围</dt><dd>本机用户级</dd></div>
        <div className="wide"><dt>受管目标</dt><dd title={plan.targetPath}>{plan.targetPath}</dd></div>
        <div><dt>新增文件</dt><dd>{plan.changes.add}</dd></div>
        <div><dt>替换文件</dt><dd>{plan.changes.replace}</dd></div>
      </dl>
      <div className="skill-lib-checks">
        <p><ShieldCheck size={17} /><span><strong>对象哈希已锁定</strong><small>{plan.objectTreeSha256.slice(0, 16)}…</small></span></p>
        <p><FileArchive size={17} /><span><strong>{plan.rollbackAvailable ? '将备份当前受管版本' : '首次安装，无既有受管版本'}</strong><small>失败时恢复原目标或保留恢复记录</small></span></p>
        <p><RefreshCw size={17} /><span><strong>安装后需要重启或新会话</strong><small>文件落盘不等于 Skill 已真实加载</small></span></p>
      </div>
      {!!plan.riskFindings.length && <div className="skill-lib-plan-risk"><ShieldAlert size={17} /><span>发现 {plan.riskFindings.length} 项风险提示，请确认详情后安装。</span></div>}
      <button type="button" className="primary skill-lib-wide-button" disabled={busy} onClick={onConfirm}>{busy ? <><LoaderCircle className="spin" size={17} />正在安装并校验…</> : <><Download size={17} />确认安装到 {providerLabels[plan.providerId]}</>}</button>
    </section>
  </div>;
}

function DeleteDialog({ artifact, busy, onClose, onConfirm }: { artifact: Artifact; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const activeInstallations = artifact.installations.filter(item => item.state !== 'uninstalled').length;
  return <div className="skill-lib-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && !busy && onClose()}>
    <section className="skill-lib-dialog skill-lib-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="skill-delete-title">
      <button type="button" className="skill-lib-icon-button dialog-close" aria-label="关闭" disabled={busy} onClick={onClose}><X size={18} /></button>
      <div className="skill-lib-dialog-heading"><span className="skill-lib-artifact-icon danger"><Trash2 size={21} /></span><div><span>删除存档资产</span><h3 id="skill-delete-title">{artifact.identity.displayName}</h3><code>{artifact.identity.name} · {artifact.version?.declaredVersion}</code></div></div>
      {activeInstallations ? <div className="skill-lib-delete-blocked"><ShieldAlert size={18} /><span><strong>当前不能删除</strong><small>仍有 {activeInstallations} 个受管安装。请先在下方 Codex/WorkBuddy 安装目标中卸载，再删除存档。</small></span></div> : <div className="skill-lib-checks">
        <p><Trash2 size={17} /><span><strong>删除资产索引与存档对象</strong><small>此操作不会删除最初扫描或导入的来源目录。</small></span></p>
        <p><ShieldCheck size={17} /><span><strong>历史回执与恢复副本保留</strong><small>便于审计此前的导入、安装和卸载操作。</small></span></p>
      </div>}
      <button type="button" className="skill-lib-danger-button skill-lib-wide-button" disabled={busy || activeInstallations > 0} onClick={onConfirm}>{busy ? <><LoaderCircle className="spin" size={17} />正在删除并更新索引…</> : <><Trash2 size={17} />确认删除存档</>}</button>
    </section>
  </div>;
}

export function SkillManagementPanel({ api }: { api: SkillLibraryApi }) {
  const [tab, setTab] = useState<'archive' | 'browse'>('archive');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selectedDiscoveries, setSelectedDiscoveries] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const [providerFilter, setProviderFilter] = useState<ProviderId | ''>('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [busy, setBusy] = useState('');
  const [manualBusy, setManualBusy] = useState('');
  const [manualInfo, setManualInfo] = useState<ManualInstallInfo | null>(null);
  const [manualNotice, setManualNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [migrationNotice, setMigrationNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [importNotice, setImportNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [plan, setPlan] = useState<InstallPlan | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Artifact | null>(null);

  const invoke = useCallback(async <T,>(action: string, input: unknown = {}) => {
    if (!api.skillLibraryAction) throw Error('当前 Windows 主机版本不支持 Skills 管理');
    return parseResponse<T>(await api.skillLibraryAction(action, input));
  }, [api]);

  const reload = useCallback(async () => {
    const [nextSnapshot, nextArtifacts] = await Promise.all([invoke<Snapshot>('snapshot'), invoke<Artifact[]>('listArtifacts', {})]);
    setSnapshot(nextSnapshot); setArtifacts(nextArtifacts);
    setSelectedId(current => nextArtifacts.some(item => item.artifactId === current) ? current : nextArtifacts[0]?.artifactId || '');
  }, [invoke]);

  useEffect(() => { setBusy('loading'); reload().catch(error => setMessage({ tone: 'error', text: error.message })).finally(() => setBusy('')); }, [reload]);

  const discoveries = useMemo(() => snapshot?.scans.flatMap(scan => scan.candidates) || [], [snapshot]);
  const selectedDiscoveryIds = useMemo(() => new Set(selectedDiscoveries), [selectedDiscoveries]);
  const toggleDiscovery = useCallback((id: string) => setSelectedDiscoveries(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]), []);
  const deferredQuery = useDeferredValue(query);
  const searchableArtifacts = useMemo(() => artifacts.map(item => ({ item,
    text: [item.identity.name, item.identity.displayName, item.identity.publisher, item.version?.description, ...item.tags.system, ...item.tags.user].join(' ').toLowerCase(),
  })), [artifacts]);
  const filteredArtifacts = useMemo(() => {
    const search = deferredQuery.trim().toLowerCase();
    const direction = sortOrder === 'asc' ? 1 : -1;
    return searchableArtifacts.filter(({ item, text }) => (!search || text.includes(search)) && (category === '全部' || item.tags.system.includes(category))
      && (!providerFilter || item.compatibility.includes(providerFilter))).map(({ item }) => item)
      .sort((left, right) => direction * (left.identity.displayName || left.identity.name).localeCompare(right.identity.displayName || right.identity.name, 'zh-CN-u-co-pinyin', { numeric: true, sensitivity: 'base' }));
  }, [searchableArtifacts, category, providerFilter, deferredQuery, sortOrder]);
  const selected = filteredArtifacts.find(item => item.artifactId === selectedId) || filteredArtifacts[0] || null;

  useEffect(() => {
    let cancelled = false;
    setManualInfo(null); setManualNotice(null);
    if (tab !== 'browse' || !selected?.version || selected.kind !== 'skill') return () => { cancelled = true; };
    setManualBusy('info');
    invoke<ManualInstallInfo>('manualInstallInfo', { artifactId: selected.artifactId, versionId: selected.version.versionId })
      .then(result => { if (!cancelled) setManualInfo(result); })
      .catch(error => { if (!cancelled) setManualNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) }); })
      .finally(() => { if (!cancelled) setManualBusy(''); });
    return () => { cancelled = true; };
  }, [invoke, selected?.artifactId, selected?.kind, selected?.version?.versionId, tab]);

  async function run(action: string, operation: () => Promise<unknown>, success: string) {
    setBusy(action); setMessage(null);
    try { await operation(); await reload(); setMessage({ tone: 'success', text: success }); }
    catch (error) { setMessage({ tone: 'error', text: error instanceof Error ? error.message : String(error) }); }
    finally { setBusy(''); }
  }

  async function scan() {
    await run('scan', async () => {
      await invoke('scanSources', { providerIds: ['codex', 'workbuddy', 'qclaw'] });
      setSelectedDiscoveries([]);
    }, '本机 Agent Skills 扫描完成。扫描过程未修改任何来源目录。');
  }

  async function chooseAndImport(kind: 'directory' | 'archive') {
    const chooseAction = kind === 'directory' ? 'chooseImportDirectory' : 'chooseImportArchive';
    const importAction = kind === 'directory' ? 'importDirectory' : 'importArchive';
    setBusy(chooseAction); setMessage(null);
    setImportNotice({ tone: 'info', text: kind === 'directory' ? '请选择单个 Skill 目录，或包含多个 Skill 一级子目录的文件夹。' : '请选择一个 Skill ZIP 包。' });
    try {
      const choice = await invoke<{ cancelled: boolean; selectionId?: string; displayPath?: string }>(chooseAction);
      if (choice.cancelled || !choice.selectionId) { setImportNotice({ tone: 'info', text: '已取消导入，存档没有变化。' }); return; }
      setBusy(importAction);
      setImportNotice({ tone: 'info', text: `正在检查并存档${choice.displayPath ? `：${choice.displayPath}` : ''}…` });
      if (kind === 'directory') {
        const result = await invoke<ImportResult>(importAction, { selectionId: choice.selectionId });
        await reload();
        const detail = `共检查 ${result.total} 项：新增 ${result.counts.archived}、已存在 ${result.counts.duplicate}、隔离 ${result.counts.quarantined}、失败 ${result.counts.failed}。`;
        setImportNotice({ tone: result.status === 'failed' ? 'error' : result.status === 'partial' || result.counts.quarantined ? 'info' : 'success', text: detail });
      } else {
        const result = await invoke<{ status: string }>(importAction, { selectionId: choice.selectionId });
        await reload();
        const labels: Record<string, string> = { archived: 'ZIP 已安全解包、检查并新增存档。', duplicate: 'ZIP 内容已存在，已记录重复导入回执。', quarantined: 'ZIP 已完成检查，但因风险项进入隔离记录。' };
        setImportNotice({ tone: result.status === 'quarantined' ? 'info' : 'success', text: labels[result.status] || 'ZIP 已完成检查并记录结果。' });
      }
    } catch (error) { setImportNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) }); }
    finally { setBusy(''); }
  }

  async function migrateArchive() {
    setBusy('migration-choose'); setMessage(null);
    setMigrationNotice({ tone: 'info', text: '请选择或新建一个空文件夹。取消选择不会改变当前路径。' });
    try {
      const choice = await invoke<{ cancelled: boolean; selectionId?: string; displayPath?: string }>('chooseArchiveRoot');
      if (choice.cancelled || !choice.selectionId) { setMigrationNotice({ tone: 'info', text: '已取消迁移，当前存档路径未改变。' }); return; }
      setBusy('migration-copy');
      setMigrationNotice({ tone: 'info', text: `正在复制并校验存档${choice.displayPath ? `至 ${choice.displayPath}` : ''}，请稍候…` });
      const result = await invoke<{ activeRoot: string }>('migrateArchiveRoot', { selectionId: choice.selectionId });
      if (!result.activeRoot) throw Error('迁移未返回有效位置，请重新读取存档状态后确认。');
      setSnapshot(current => current ? { ...current, library: { ...current.library, rootPath: result.activeRoot } } : current);
      setPlan(null);
      setMigrationNotice({ tone: 'success', text: `已切换至 ${result.activeRoot}。后续存档使用新位置，旧存档保留。` });
      try { await reload(); }
      catch { setMigrationNotice({ tone: 'info', text: `存档位置已切换至 ${result.activeRoot}，但列表刷新失败。请重新进入页面；不需要再次迁移。` }); }
    } catch (error) { setMigrationNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) }); }
    finally { setBusy(''); }
  }

  async function preview(providerId: ProviderId) {
    if (!selected?.version) return;
    setBusy(`preview-${providerId}`); setMessage(null);
    try { setPlan(await invoke<InstallPlan>('previewInstall', { artifactId: selected.artifactId, versionId: selected.version.versionId, providerId, scope: 'user' })); }
    catch (error) { setMessage({ tone: 'error', text: error instanceof Error ? error.message : String(error) }); }
    finally { setBusy(''); }
  }

  async function confirmInstall() {
    if (!plan) return;
    await run('install', async () => { await invoke('install', { planId: plan.planId, planHash: plan.planHash }); setPlan(null); }, '安装文件与回执已写入。请重启目标 Agent 或开启新会话后继续验证。');
  }

  async function confirmDelete() {
    if (!deleteTarget?.version) return;
    setBusy('delete-artifact'); setMessage(null);
    try {
      const result = await invoke<{ deleted: boolean; cleanupPending: boolean }>('deleteArtifact', {
        artifactId: deleteTarget.artifactId, currentVersionId: deleteTarget.version.versionId,
      });
      setDeleteTarget(null); setPlan(null);
      try { await reload(); }
      catch {
        setMessage({ tone: 'info', text: 'Skill 存档已删除，但列表刷新失败。请重新进入 Skills 管理确认；不要重复删除。' });
        return;
      }
      setMessage({ tone: result.cleanupPending ? 'info' : 'success', text: result.cleanupPending
        ? 'Skill 存档已从资产库移除；少量临时对象等待后续清理，历史回执和恢复副本仍保留。'
        : 'Skill 存档已删除；原始来源、历史回执和恢复副本未受影响。' });
    } catch (error) { setMessage({ tone: 'error', text: error instanceof Error ? error.message : String(error) }); }
    finally { setBusy(''); }
  }

  async function archiveSelected() {
    if (!selectedDiscoveries.length) return;
    await run('archive-selected', () => invoke('archiveDiscovered', { discoveryIds: selectedDiscoveries }), '所选发现项已完成来源复核、安检和不可变存档。');
    setSelectedDiscoveries([]);
  }

  async function manualAction(action: 'copy' | 'open' | 'export') {
    if (!selected?.version || selected.kind !== 'skill') return;
    setManualBusy(action); setManualNotice(null);
    const identity = { artifactId: selected.artifactId, versionId: selected.version.versionId };
    try {
      if (action === 'copy') {
        await invoke('copyManualInstallPath', identity);
        setManualNotice({ tone: 'success', text: '只读存档路径已复制。手动安装时请复制文件，不要移动或修改存档原件。' });
      } else if (action === 'open') {
        await invoke('openManualInstallPath', identity);
        setManualNotice({ tone: 'info', text: '已打开只读存档目录。建议使用“导出安装副本”后再交给其他 Agent。' });
      } else {
        const choice = await invoke<{ cancelled: boolean; selectionId?: string }>('chooseManualExportRoot');
        if (choice.cancelled || !choice.selectionId) { setManualNotice({ tone: 'info', text: '已取消导出，存档没有变化。' }); return; }
        setManualBusy('exporting');
        const result = await invoke<{ exportPath: string }>('exportManualInstallCopy', { ...identity, selectionId: choice.selectionId });
        setManualNotice({ tone: 'success', text: `已生成并校验独立副本：${result.exportPath}` });
      }
    } catch (error) { setManualNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) }); }
    finally { setManualBusy(''); }
  }

  const loading = busy === 'loading' && !snapshot;
  if (loading) return <section className="panel skill-lib-loading"><LoaderCircle className="spin" size={22} />正在读取本机 Skill 存档…</section>;

  return <section className="panel skill-lib-panel">
    <div className="skill-lib-subtabs" role="tablist" aria-label="Skills 管理">
      <button type="button" role="tab" aria-selected={tab === 'archive'} className={tab === 'archive' ? 'active' : ''} onClick={() => setTab('archive')}><Archive size={17} />Skill存档管理</button>
      <button type="button" role="tab" aria-selected={tab === 'browse'} className={tab === 'browse' ? 'active' : ''} onClick={() => setTab('browse')}><Library size={17} />Skill浏览</button>
    </div>
    {message && <div className={`notice skill-lib-message ${message.tone === 'error' ? 'error' : message.tone === 'success' ? 'success' : 'muted'}`} role={message.tone === 'error' ? 'alert' : 'status'}><span>{message.text}</span><button type="button" aria-label="关闭" onClick={() => setMessage(null)}><X size={16} /></button></div>}

    {tab === 'archive' && <div className="skill-lib-view">
      <header className="skill-lib-hero"><div><span className="skill-lib-eyebrow"><Archive size={15} />本机主机级资产</span><h2>把散落的 Skills 整理成可复用资产</h2><p>扫描、安检和存档与安装分别记录；QClaw 始终只读，MCP 与插件安装暂未启用。</p></div><button type="button" className="primary" disabled={!!busy} onClick={() => void scan()}>{busy === 'scan' ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}{busy === 'scan' ? '扫描中…' : '扫描本机 Skills'}</button></header>
      <div className="skill-lib-metrics">
        <div><Library size={20} /><span><strong>{snapshot?.counts.artifacts || 0}</strong>已存档 Skill</span></div>
        <div><ShieldCheck size={20} /><span><strong>{snapshot?.counts.versions || 0}</strong>不可变版本</span></div>
        <div><PackageCheck size={20} /><span><strong>{snapshot?.counts.installations || 0}</strong>受管安装</span></div>
        <div><ShieldAlert size={20} /><span><strong>{snapshot?.counts.quarantined || 0}</strong>隔离记录</span></div>
      </div>
      <div className="skill-lib-section-heading"><div><h3>本机 Agent 来源</h3><p>只扫描适配器登记的有效根，不遍历整个用户目录。</p></div></div>
      <div className="skill-lib-provider-grid">{snapshot?.providers.map(item => {
        const scanItem = snapshot.scans.find(scan => scan.providerId === item.providerId);
        return <article key={item.providerId} className={`skill-lib-provider-card provider-${item.providerId}`}><div className="skill-lib-provider-top"><span><Bot size={20} /></span><div><h4>{providerLabels[item.providerId]}</h4><small>{item.installed ? '已发现本机配置' : '当前未发现宿主'}</small></div><em>{item.providerId === 'qclaw' ? <><LockKeyhole size={12} />只读导出</> : <><PackageCheck size={12} />支持安装</>}</em></div><strong className="skill-lib-provider-count">{scanItem?.candidates.length ?? '—'}<small>个有效候选</small></strong><p>{item.reason}</p></article>;
      })}</div>
      <div className="skill-lib-two-column">
        <section>
          <div className="skill-lib-section-heading"><div><h3>待存档与检查结果</h3><p>{discoveries.length ? `本次扫描发现 ${discoveries.length} 项` : '扫描后可在这里选择并存档'}</p></div>{!!selectedDiscoveries.length && <button type="button" className="primary compact" disabled={!!busy} onClick={() => void archiveSelected()}>存档所选 {selectedDiscoveries.length} 项</button>}</div>
          <div className="skill-lib-discovery-list">{discoveries.map(item => <DiscoveryRow key={item.discoveryId} item={item} checked={selectedDiscoveryIds.has(item.discoveryId)} busy={!!busy} onToggle={toggleDiscovery} />)}{!discoveries.length && <div className="skill-lib-empty"><Search size={25} /><strong>尚未扫描本机 Skills</strong><span>点击“扫描本机 Skills”读取 Codex、WorkBuddy 和 QClaw 的受控来源。</span></div>}</div>
        </section>
        <aside className="skill-lib-storage">
          <div className="skill-lib-storage-title"><HardDrive size={20} /><div><h3>存档位置</h3><p>本机私有，不进入学生资料或云同步</p></div></div>
          <div className="skill-lib-path"><code title={snapshot?.library.rootPath}>{snapshot?.library.rootPath || '—'}</code><button type="button" aria-label="打开存档目录" disabled={!!busy} onClick={() => void run('open', () => invoke('openArchivePath'), '已打开 Skill 存档目录。')}><FolderOpen size={17} /></button></div>
          <span className={`skill-lib-write-state ${snapshot?.library.writable ? '' : 'is-error'}`}>{snapshot?.library.writable ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}{snapshot?.library.writable ? '可写入，索引正常' : '存档位置不可写'}</span>
          <button type="button" className="secondary" disabled={!!busy} onClick={() => void migrateArchive()}>{busy.startsWith('migration-') ? <LoaderCircle className="spin" size={16} /> : <HardDrive size={16} />}{busy === 'migration-choose' ? '正在选择位置…' : busy === 'migration-copy' ? '正在迁移并校验…' : '迁移到自定义位置'}</button>
          <small>请选择空文件夹；不会覆盖目标中的现有文件。</small>
          {migrationNotice && <div className={`notice skill-lib-migration-status ${migrationNotice.tone}`} role={migrationNotice.tone === 'error' ? 'alert' : 'status'}>{migrationNotice.text}</div>}
          <hr />
          <h4>导入本地 Skill</h4><div className="skill-lib-import-actions"><button type="button" className="secondary" disabled={!!busy} onClick={() => void chooseAndImport('directory')}>{busy === 'chooseImportDirectory' || busy === 'importDirectory' ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}{busy === 'chooseImportDirectory' ? '选择中…' : busy === 'importDirectory' ? '导入中…' : '导入目录'}</button><button type="button" className="secondary" disabled={!!busy} onClick={() => void chooseAndImport('archive')}>{busy === 'chooseImportArchive' || busy === 'importArchive' ? <LoaderCircle className="spin" size={16} /> : <FileArchive size={16} />}{busy === 'chooseImportArchive' ? '选择中…' : busy === 'importArchive' ? '导入中…' : '导入 ZIP'}</button></div>
          <small>目录导入支持单个 Skill，或批量导入一级子目录中含 SKILL.md 的 Skills。</small>
          {importNotice && <div className={`notice skill-lib-migration-status ${importNotice.tone}`} role={importNotice.tone === 'error' ? 'alert' : 'status'}>{importNotice.text}</div>}
          <div className="skill-lib-boundary"><Info size={15} /><span>插件包可存档浏览，但本轮不会安装、启用 Hook 或配置 MCP。</span></div>
        </aside>
      </div>
    </div>}

    {tab === 'browse' && <div className="skill-lib-view">
      <header className="skill-lib-hero skill-lib-browse-hero"><div><span className="skill-lib-eyebrow"><Library size={15} />本机 Skill 资产库</span><h2>浏览、核对并安装 Skills</h2><p>目标路径由主进程适配器解析；安装前再次检查目标指纹，避免覆盖手工修改。</p></div><strong>{artifacts.length}<small>项资产</small></strong></header>
      <div className="skill-lib-toolbar"><label className="skill-lib-search"><Search size={17} /><input aria-label="搜索 Skill" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索名称、简介、发布者或标签" /></label><select aria-label="兼容 Agent" value={providerFilter} onChange={event => setProviderFilter(event.target.value as ProviderId | '')}><option value="">全部兼容 Agent</option><option value="codex">Codex</option><option value="workbuddy">WorkBuddy</option></select><select aria-label="排序方式" value={sortOrder} onChange={event => setSortOrder(event.target.value as 'asc' | 'desc')}><option value="asc">名称 A → Z</option><option value="desc">名称 Z → A</option></select></div>
      <div className="skill-lib-category-tabs">{categories.map(item => <button type="button" key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{categoryLabels[item]}</button>)}</div>
      <div className="skill-lib-browser-layout">
        <div className="skill-lib-artifact-list"><small className="skill-lib-result-count">找到 {filteredArtifacts.length} 项</small>{filteredArtifacts.map(item => <button type="button" key={item.artifactId} className={`skill-lib-artifact-row ${selected?.artifactId === item.artifactId ? 'active' : ''}`} onClick={() => setSelectedId(item.artifactId)}><span className="skill-lib-artifact-icon">{item.kind === 'plugin' ? 'P' : 'S'}</span><span><strong>{item.identity.displayName}</strong><small>{item.version?.description || '暂无简介'}</small><em><span>{item.kind === 'plugin' ? '插件' : 'Skill'}</span><span>{item.identity.publisher}</span><span>{item.version?.declaredVersion}</span></em></span><RiskBadge findings={item.version?.riskFindings} /></button>)}{!filteredArtifacts.length && <div className="skill-lib-empty"><Search size={25} /><strong>没有匹配的 Skill</strong><span>换一个关键词或清除筛选条件。</span></div>}</div>
        {selected ? <aside className="skill-lib-detail">
          <div className="skill-lib-detail-top"><span className="skill-lib-kind">{selected.kind === 'plugin' ? 'PLUGIN' : 'SKILL'}</span><RiskBadge findings={selected.version?.riskFindings} /></div>
          <div className="skill-lib-detail-title"><span className="skill-lib-artifact-icon"><PackageCheck size={20} /></span><div><h3>{selected.identity.displayName}</h3><code>{selected.identity.name}</code></div></div>
          <p>{selected.version?.description}</p>
          <div className="skill-lib-tag-area"><div><span><Tag size={14} />标签</span><small>{selected.tags.manualLocked ? '已人工锁定' : '主机确定性标签'}</small></div><p>{[...selected.tags.system, ...selected.tags.user].map(tag => <span key={tag}>{tag}</span>)}</p></div>
          <dl className="skill-lib-detail-grid"><div><dt>版本</dt><dd>{selected.version?.declaredVersion}</dd></div><div><dt>文件</dt><dd>{selected.version?.fileCount}</dd></div><div><dt>大小</dt><dd>{formatBytes(selected.version?.totalBytes || 0)}</dd></div><div><dt>许可证</dt><dd>{selected.version?.license || '未声明'}</dd></div></dl>
          <details className="skill-lib-integrity"><summary>来源与完整性 <ChevronDown size={15} /></summary><dl><div><dt>来源</dt><dd>{selected.version?.sourceType}</dd></div><div><dt>tree SHA-256</dt><dd>{selected.version?.treeSha256}</dd></div><div><dt>manifest SHA-256</dt><dd>{selected.version?.manifestSha256}</dd></div></dl></details>
          <div className="skill-lib-install-targets"><h4>本地安装目标</h4>{(['codex', 'workbuddy', 'qclaw'] as ProviderId[]).map(providerId => {
            const capability = snapshot?.providers.find(item => item.providerId === providerId);
            const installation = selected.installations.find(item => item.providerId === providerId && item.state !== 'uninstalled');
            const allowed = selected.kind === 'skill' && capability?.canInstallSkill && providerId !== 'qclaw';
            return <div key={providerId} className="skill-lib-install-row"><span className={`skill-lib-agent-dot ${providerId}`}>{providerLabels[providerId][0]}</span><span><strong>{providerLabels[providerId]}</strong><small>{providerId === 'qclaw' ? '仅作为只读来源' : installation ? `状态：${installation.state}` : allowed ? '可安装到用户级持久目录' : capability?.reason || '不支持'}</small></span>{installation ? <div className="skill-lib-row-actions"><button type="button" title="重新检查目标库存" disabled={!!busy} onClick={() => void run('verify', () => invoke('verifyInstallation', { installationId: installation.installationId }), '已重新检查目标持久目录；仍需新会话触发验证。')}><Check size={15} /></button>{capability?.canRollback && <button type="button" title="预览并回滚" disabled={!!busy} onClick={() => void setMessage({ tone: 'info', text: '回滚必须基于有效备份与当前指纹；请在操作记录中确认后执行。' })}><RotateCcw size={15} /></button>}<button type="button" title="卸载受管版本" disabled={!!busy} onClick={() => void run('uninstall', () => invoke('uninstall', { installationId: installation.installationId }), '受管 Skill 已卸载，存档与恢复副本仍保留。')}><Trash2 size={15} /></button></div> : <button type="button" className="secondary compact" disabled={!allowed || !!busy} onClick={() => void preview(providerId)}>{busy === `preview-${providerId}` ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />}{providerId === 'qclaw' ? '不可安装' : selected.kind === 'plugin' ? '插件暂缓' : '安装'}</button>}</div>;
          })}</div>
          <section className="skill-lib-manual-install" aria-labelledby="skill-manual-install-title">
            <div className="skill-lib-manual-heading"><div><h4 id="skill-manual-install-title">手动安装到其他 Agent</h4><p>适用于非 Codex / WorkBuddy 的本地 Agent。</p></div><span>独立管理</span></div>
            {selected.kind === 'plugin' ? <div className="skill-lib-manual-unavailable"><Info size={15} />插件不能按目录手动安装；请按目标 Agent 的插件机制单独配置。</div> : <>
              <label>教育管家只读存档路径</label>
              <code className="skill-lib-manual-path" title={manualInfo?.archivePath}>{manualBusy === 'info' ? '正在读取路径…' : manualInfo?.archivePath || '路径暂不可用'}</code>
              <div className="skill-lib-manual-actions"><button type="button" className="secondary" disabled={!manualInfo || !!manualBusy} onClick={() => void manualAction('copy')}><Copy size={14} />复制路径</button><button type="button" className="secondary" disabled={!manualInfo || !!manualBusy} onClick={() => void manualAction('open')}><FolderOpen size={14} />打开目录</button><button type="button" className="primary" disabled={!manualInfo || !!manualBusy} onClick={() => void manualAction('export')}>{manualBusy === 'export' || manualBusy === 'exporting' ? <LoaderCircle className="spin" size={14} /> : <FolderOutput size={14} />}{manualBusy === 'exporting' ? '正在复制校验…' : '导出安装副本'}</button></div>
              <small>推荐导出副本后，在目标 Agent 中选择该副本目录。手动安装不会由教育管家自动验证、升级或卸载。</small>
              {manualNotice && <div className={`notice skill-lib-manual-notice ${manualNotice.tone}`} role={manualNotice.tone === 'error' ? 'alert' : 'status'}>{manualNotice.text}</div>}
            </>}
          </section>
          <div className="skill-lib-boundary"><LockKeyhole size={15} /><span>Renderer 只提交资产、版本、Agent 与安装计划 ID，不提交路径或命令。</span></div>
          <button type="button" className="skill-lib-delete-archive" disabled={!!busy} onClick={() => setDeleteTarget(selected)}><Trash2 size={15} />删除此存档</button>
        </aside> : <aside className="skill-lib-detail"><div className="skill-lib-empty"><Library size={26} /><strong>选择一个 Skill 查看详情</strong></div></aside>}
      </div>
    </div>}
    {plan && selected && <InstallDialog artifact={selected} plan={plan} busy={busy === 'install'} onClose={() => setPlan(null)} onConfirm={() => void confirmInstall()} />}
    {deleteTarget && <DeleteDialog artifact={deleteTarget} busy={busy === 'delete-artifact'} onClose={() => setDeleteTarget(null)} onConfirm={() => void confirmDelete()} />}
  </section>;
}

export default memo(SkillManagementPanel);
