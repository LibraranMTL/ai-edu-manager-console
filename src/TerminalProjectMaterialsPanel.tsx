import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, BookOpen, Bot, CheckCircle2, Download, FileText, Play, RefreshCw, Search, Users } from 'lucide-react';
import { renderTerminalMarkdown } from './terminal-markdown.js';
import './terminal-project-materials.css';

type Operations = {
  list?: boolean; originalDownload?: boolean; classificationSuggest?: boolean;
  classificationWrite?: boolean; knowledgeRead?: boolean; evidenceRead?: boolean;
  organizationRead?: boolean; organizationRun?: boolean; organizationRetry?: boolean;
};
type Project = { id: string; name: string; status?: string; materialStorageMode?: string;
  materialMigrationState?: string;
  materialCapabilities?: { supported?: boolean; operations?: Operations } };
type Category = { categoryId: string; name: string };
type Material = {
  materialId: string; version: number; recordRevision: number; title: string; logicalPath: string;
  size: number; availability: string; adoption: string; categoryName: string;
  classification: { categoryId: string; tags: string[] }; processing: { state: string };
  pendingReasons: string[];
};
type Source = { materialId: string; version: number; sha256?: string; title?: string; status?: string;
  currentVersion?: number; exportAllowed?: boolean };
type Knowledge = { knowledgeId: string; documentId: string; title: string; status: string; committedAt: string; sources: Source[] };
type Contribution = { studentId: string; ability: string; observation: string; status: string; confidence: string;
  sourceStatus: string; sources: Source[] };
type RemoteView = { ok?: boolean; cached?: boolean; cachedAt?: string; message?: string; total: number;
  counts: { materials: number; pending: number; knowledge: number; contributions: number };
  categories: Category[]; items: Array<Material | Knowledge | Contribution> };
type Suggestion = { suggestionId: string; materialId: string; version: number; recordRevision: number;
  categoryId: string; tags: string[]; reason: string; source: string };
type KnowledgeDocument = { ok?: boolean; title?: string; relativePath?: string; content: string; provenance: string;
  message?: string; sources: Source[] };
type OrganizationOperation = { operationId: string; status: string; completedAt: string; createdAt: string;
  counts: { total: number; succeeded: number; failed: number; attention: number; retryable: number };
  items: Array<{ materialId: string; title: string; status: string; message: string; retryable: boolean }> };
type OrganizationStatus = { configuration: { enabled: boolean; maxBatch: number }; capacity: { ok: boolean; code: string };
  operations: OrganizationOperation[] };
type Api = {
  getProjectMaterialView: (projectId: string, query: Record<string, unknown>) => Promise<RemoteView>;
  getProjectClassificationSuggestions: (projectId: string, query: Record<string, unknown>) => Promise<{ items?: Suggestion[] }>;
  submitProjectClassificationSuggestions: (projectId: string, input: Record<string, unknown>) => Promise<{ results?: Array<{ ok: boolean; code?: string }> }>;
  applyProjectClassifications: (projectId: string, input: Record<string, unknown>) => Promise<{ results?: Array<{ ok: boolean; code?: string }> }>;
  getProjectMaterialOrganization: (projectId: string) => Promise<OrganizationStatus>;
  runProjectMaterialOrganization: (projectId: string, input: Record<string, unknown>) => Promise<{ ok?: boolean; message?: string }>;
  retryProjectMaterialOrganization: (projectId: string, operationId: string, input: Record<string, unknown>) => Promise<{ ok?: boolean; message?: string }>;
  readProjectKnowledgeDocument: (projectId: string, documentId: string) => Promise<KnowledgeDocument>;
  downloadProjectMaterialVersion: (projectId: string, materialId: string, version: number, title: string) => Promise<{ ok: boolean; message?: string }>;
};
type Tab = 'materials' | 'pending' | 'knowledge' | 'contributions';

const emptyView: RemoteView = { total: 0, counts: { materials: 0, pending: 0, knowledge: 0, contributions: 0 }, categories: [], items: [] };
const emptyOrganization: OrganizationStatus = { configuration: { enabled: false, maxBatch: 20 },
  capacity: { ok: true, code: '' }, operations: [] };
const pendingLabels: Record<string, string> = { needs_adoption: '待采用', needs_classification: '待分类',
  source_missing: '原件缺失', source_unavailable: '来源暂不可用', processing_failed: '处理异常' };
const tabLabels: Array<[Tab, string]> = [['materials', '项目资料'], ['pending', '待整理'], ['knowledge', '项目知识'], ['contributions', '贡献证据']];
const idempotencyKey = (prefix: string) => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;

function byteSize(value: number) {
  if (value < 1024) return `${value || 0} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function Markdown({ content }: { content: string }) {
  const html = useMemo(() => renderTerminalMarkdown(content), [content]);
  return <div className="terminal-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function TerminalProjectMaterialsPanel({ project, api }: { project: Project; api: Api }) {
  const [tab, setTab] = useState<Tab>('materials');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [view, setView] = useState<RemoteView>(emptyView);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [organization, setOrganization] = useState<OrganizationStatus>(emptyOrganization);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [document, setDocument] = useState<KnowledgeDocument | null>(null);
  const [documentTitle, setDocumentTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const serial = useRef(0);

  const capabilities = project.materialCapabilities?.operations || {};
  const load = useCallback(async () => {
    const current = ++serial.current;
    setLoading(true);
    setMessage('');
    try {
      const [response, organizationStatus] = await Promise.all([
        api.getProjectMaterialView(project.id, { view: tab, search: appliedSearch,
          categoryId, offset: 0, limit: 100 }),
        capabilities.organizationRead ? api.getProjectMaterialOrganization(project.id).catch(() => null) : Promise.resolve(null),
      ]);
      if (current !== serial.current) return;
      setView(response);
      if (organizationStatus) setOrganization(organizationStatus);
      if (tab === 'materials' || tab === 'pending') {
        try {
          const suggestionPage = await api.getProjectClassificationSuggestions(project.id,
            { status: 'pending', offset: 0, limit: 100 });
          if (current === serial.current) setSuggestions(suggestionPage.items || []);
        } catch { if (current === serial.current) setSuggestions([]); }
      }
      if (response.cached) setMessage(`当前显示离线只读缓存${response.cachedAt ? `（${new Date(response.cachedAt).toLocaleString('zh-CN')}）` : ''}；联网后刷新才能分类或下载。`);
    } catch (error) {
      if (current === serial.current) {
        setView(emptyView);
        setMessage(error instanceof Error ? error.message : '项目资料读取失败。');
      }
    } finally { if (current === serial.current) setLoading(false); }
  }, [api, appliedSearch, categoryId, project.id, tab]);

  useEffect(() => {
    setTab('materials'); setSearch(''); setAppliedSearch(''); setCategoryId(''); setDrafts({});
    setDocument(null); setMessage(''); setView(emptyView);
    setOrganization(emptyOrganization);
  }, [project.id]);
  useEffect(() => { void load(); }, [load]);

  const suggestionByMaterial = useMemo(() => new Map(suggestions.map((item) => [item.materialId, item])), [suggestions]);
  const categories = view.categories || [];

  async function classify(material: Material) {
    const target = drafts[material.materialId] || material.classification.categoryId;
    if (!target) { setMessage('请先选择分类。'); return; }
    setBusyId(material.materialId);
    try {
      const suggestion = suggestionByMaterial.get(material.materialId);
      const currentSuggestion = suggestion?.version === material.version && suggestion.recordRevision === material.recordRevision;
      let response;
      if (capabilities.classificationWrite) {
        const accepts = currentSuggestion && suggestion?.categoryId === target;
        response = await api.applyProjectClassifications(project.id, { idempotencyKey: idempotencyKey('windows-terminal-classify'), items: [{
          materialId: material.materialId, expectedVersion: material.version, expectedRecordRevision: material.recordRevision,
          categoryId: target, tags: accepts ? suggestion.tags : [], suggestionId: currentSuggestion ? suggestion.suggestionId : '',
          decision: accepts ? 'accept' : 'correct',
        }] });
      } else if (capabilities.classificationSuggest) {
        response = await api.submitProjectClassificationSuggestions(project.id, {
          idempotencyKey: idempotencyKey('windows-terminal-suggest'), items: [{ materialId: material.materialId,
            expectedVersion: material.version, expectedRecordRevision: material.recordRevision,
            categoryId: target, tags: [], reason: '由Windows轻终端用户人工选择分类，等待项目管理员确认。', needsConfirmation: true }],
        });
      } else throw new Error('当前身份没有分类或建议权限。');
      const result = response.results?.[0];
      if (!result?.ok) throw new Error(result?.code === 'version_conflict' ? '资料已更新，请刷新后重新确认。' : `本项未处理：${result?.code || '未知原因'}`);
      setMessage(capabilities.classificationWrite ? '分类已由主机确认；原文位置没有改变。' : '分类建议已提交，正式分类仍需项目管理员确认。');
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : '分类操作失败。'); }
    finally { setBusyId(''); }
  }

  async function download(source: Source) {
    if (view.cached) { setMessage('离线缓存不能打开原文；请联网刷新权限后再下载。'); return; }
    setBusyId(`${source.materialId}:${source.version}`);
    try {
      const result = await api.downloadProjectMaterialVersion(project.id, source.materialId, source.version, source.title || '项目资料');
      setMessage(result.message || '本地副本已保存。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '资料副本下载失败。'); }
    finally { setBusyId(''); }
  }

  async function openKnowledge(item: Knowledge) {
    if (view.cached) { setMessage('离线缓存只显示知识索引；联网刷新权限后才能打开正文和固定来源。'); return; }
    const request = ++serial.current;
    setBusyId(item.knowledgeId);
    try {
      const response = await api.readProjectKnowledgeDocument(project.id, item.documentId);
      if (request !== serial.current) return;
      setDocument(response); setDocumentTitle(item.title);
    } catch (error) { if (request === serial.current) setMessage(error instanceof Error ? error.message : '知识读取失败。'); }
    finally { if (request === serial.current) setBusyId(''); }
  }

  async function runOrganization() {
    if (!capabilities.organizationRun || view.cached) return;
    setBusyId('organization-run');
    try {
      const response = await api.runProjectMaterialOrganization(project.id, {
        idempotencyKey: idempotencyKey('windows-terminal-organization'), trigger: 'manual',
      });
      if (response.ok === false) throw new Error(response.message || '主机未运行自动整理。');
      setMessage(response.message || '主机已完成本次自动整理。');
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : '请求自动整理失败。'); }
    finally { setBusyId(''); }
  }

  async function retryOrganization(operation: OrganizationOperation) {
    if (!capabilities.organizationRetry || view.cached) return;
    const materialIds = operation.items.filter((item) => item.retryable).map((item) => item.materialId);
    if (!materialIds.length) return;
    setBusyId(`organization-retry:${operation.operationId}`);
    try {
      const response = await api.retryProjectMaterialOrganization(project.id, operation.operationId, {
        materialIds, idempotencyKey: idempotencyKey('windows-terminal-organization-retry'),
      });
      if (response.ok === false) throw new Error(response.message || '异常项未能重试。');
      setMessage(response.message || '主机已重试可恢复异常项。');
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : '重试自动整理失败。'); }
    finally { setBusyId(''); }
  }

  const countFor = (value: Tab) => view.counts?.[value] || 0;
  return <section className="tpm-shell" aria-label={`${project.name}项目资料`}>
    <header><div><span>远程项目 · {project.name}</span><h3>资料与知识</h3><p>内容来自绑定主机；下载的是本地副本，编辑不会自动同步。</p></div>
      <button className="terminal-secondary" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={16} />刷新</button></header>
    {(project.materialMigrationState === 'running' || project.materialMigrationState === 'partial'
      || project.materialMigrationState === 'attention') && <div className="tpm-migration" role="status"><strong>{project.materialMigrationState === 'running'
        ? 'Windows 主机正在迁移历史资料' : project.materialMigrationState === 'attention'
          ? '迁移现场需要在主机核对' : '历史资料已部分统一'}</strong><span>{project.materialMigrationState === 'running'
        ? '本终端保持只读，上传与分类等待主机迁移结束后重试。'
        : '部分旧来源或依赖文件保留原位；本终端只展示主机已授权的统一视图。'}</span></div>}
    {capabilities.organizationRead && <section className="tpm-organization" aria-label="主机自动整理状态"><div>
      <strong>{organization.configuration.enabled ? '主机已授权自动整理收件箱' : '主机当前仅提供分类建议'}</strong>
      <span>{organization.configuration.enabled ? `安全单文件每批最多 ${organization.configuration.maxBatch} 份；本终端不直接操作主机磁盘。` : '需在Windows主机一次授权后，才会物理整理收件箱。'}</span>
      {!organization.capacity.ok && <em>主机容量状态异常，自动整理已暂停。</em>}</div>
      {capabilities.organizationRun && organization.configuration.enabled && <button type="button" className="terminal-secondary" onClick={() => void runOrganization()} disabled={Boolean(view.cached) || Boolean(busyId)}><Play size={15} />请求主机整理</button>}
      {organization.operations.slice(0, 2).map((operation) => <article key={operation.operationId}><span>{operation.status === 'succeeded' ? '整理完成' : operation.status === 'partial' ? '部分完成' : '需要处理'} · 成功 {operation.counts.succeeded}/{operation.counts.total}{operation.counts.failed ? ` · 异常 ${operation.counts.failed}` : ''}</span>
        {capabilities.organizationRetry && operation.counts.retryable > 0 && <button type="button" className="terminal-secondary" onClick={() => void retryOrganization(operation)} disabled={Boolean(view.cached) || Boolean(busyId)}><RefreshCw size={14} />重试异常项</button>}
        {operation.items.filter((item) => item.status !== 'succeeded').slice(0, 3).map((item) => <small key={item.materialId}>{item.title}：{item.message || '等待主机处理'}</small>)}</article>)}</section>}
    <nav>{tabLabels.map(([id, label]) => <button type="button" key={id} className={tab === id ? 'active' : ''} onClick={() => { setTab(id); setDocument(null); }}>
      {id === 'knowledge' ? <BookOpen size={16} /> : id === 'contributions' ? <Users size={16} /> : <Archive size={16} />}{label}<b>{countFor(id)}</b></button>)}</nav>
    <div className="tpm-tools"><label><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)}
      onKeyDown={(event) => { if (event.key === 'Enter') setAppliedSearch(search.trim()); }} placeholder="搜索当前视图" /></label>
      {(tab === 'materials' || tab === 'pending') && <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">全部分类</option>
        {categories.map((category) => <option key={category.categoryId} value={category.categoryId}>{category.name}</option>)}</select>}
      <button className="terminal-secondary" type="button" onClick={() => setAppliedSearch(search.trim())}>搜索</button></div>
    {loading ? <div className="tpm-empty">正在读取主机授权范围…</div> : null}
    {!loading && (tab === 'materials' || tab === 'pending') ? <div className="tpm-list">
      {(view.items as Material[]).map((item) => { const suggestion = suggestionByMaterial.get(item.materialId); return <article key={item.materialId}>
        <div className="tpm-icon"><FileText size={18} /></div><div className="tpm-main"><strong>{item.title}<em>v{item.version}</em></strong><small>{item.logicalPath}</small>
          <div className="tpm-tags"><span>{byteSize(item.size)}</span><span>{item.adoption === 'accepted' ? '已采用' : '候选'}</span><span>{item.processing.state === 'processed' ? '已处理' : '等待处理'}</span>
            {item.pendingReasons?.map((reason) => <span className="warn" key={reason}>{pendingLabels[reason] || reason}</span>)}</div>
          {suggestion && <div className="tpm-suggestion"><b><Bot size={14} />{suggestion.source === 'ai' ? 'AI建议' : '成员建议'}</b><span>{suggestion.reason || '没有补充说明'}</span></div>}
        </div><div className="tpm-actions"><select aria-label={`${item.title}分类`} value={drafts[item.materialId] ?? item.classification.categoryId}
          onChange={(event) => setDrafts((current) => ({ ...current, [item.materialId]: event.target.value }))} disabled={Boolean(view.cached) || project.status === 'sealed' || project.materialMigrationState === 'running'}>
          <option value="">待分类</option>{categories.map((category) => <option key={category.categoryId} value={category.categoryId}>{category.name}</option>)}</select>
          {(capabilities.classificationWrite || capabilities.classificationSuggest) && <button className="terminal-primary" type="button" disabled={Boolean(view.cached) || project.status === 'sealed' || project.materialMigrationState === 'running' || Boolean(busyId)} onClick={() => void classify(item)}>
            <CheckCircle2 size={15} />{capabilities.classificationWrite ? '确认分类' : '提交建议'}</button>}
          {capabilities.originalDownload && <button className="terminal-secondary" type="button" disabled={Boolean(view.cached) || item.availability !== 'available' || Boolean(busyId)}
            onClick={() => void download({ materialId: item.materialId, version: item.version, title: item.title })}><Download size={15} />本地副本</button>}
        </div></article>; })}
      {!view.items.length && <div className="tpm-empty">当前筛选下没有可见资料。</div>}
    </div> : null}
    {!loading && tab === 'knowledge' ? <div className="tpm-knowledge-layout"><div className="tpm-list">
      {(view.items as Knowledge[]).map((item) => <button type="button" className="tpm-knowledge-item" key={item.knowledgeId} disabled={Boolean(busyId)} onClick={() => void openKnowledge(item)}>
        <BookOpen size={17} /><span><strong>{item.title}</strong><small>{item.sources.length} 个固定版本来源</small></span></button>)}
      {!view.items.length && <div className="tpm-empty">当前没有可查看的项目知识。</div>}
    </div><article className="tpm-reader"><h4>{documentTitle || '选择知识条目查看正文'}</h4>{document ? <><p className="tpm-provenance">{document.message}</p><Markdown content={document.content} />
      <div className="tpm-sources"><strong>固定来源版本</strong>{document.sources.map((source, index) => <div key={`${source.materialId || index}:${source.version || 0}`}>
        <span>{source.title || (source.status === 'restricted' ? '来源访问受限' : '已登记资料')} {source.version ? `· v${source.version}` : ''}</span>
        {source.exportAllowed && <button className="terminal-secondary" onClick={() => void download(source)} disabled={Boolean(busyId)}><Download size={14} />下载副本</button>}</div>)}</div></> : <p>知识正文与来源关系将在这里显示。</p>}</article></div> : null}
    {!loading && tab === 'contributions' ? <div className="tpm-list">{(view.items as Contribution[]).map((item, index) => <article key={`${item.studentId}:${index}`}>
      <div className="tpm-icon"><Users size={18} /></div><div className="tpm-main"><strong>{item.ability || '待确认贡献'}</strong><small>{item.status === 'verified' ? '已核验' : '待核验'} · {item.sourceStatus === 'fixed' ? '固定版本证据' : '部分来源受限'}</small><p>{item.observation}</p>
        <div className="tpm-sources">{item.sources.map((source) => <div key={`${source.materialId}:${source.version}`}><span>{source.title} · v{source.version}</span>
          {capabilities.originalDownload && <button className="terminal-secondary" onClick={() => void download(source)} disabled={Boolean(view.cached) || Boolean(busyId)}><Download size={14} />证据副本</button>}</div>)}</div></div></article>)}
      {!view.items.length && <div className="tpm-empty">当前身份没有可查看的贡献证据。</div>}</div> : null}
    {view.cached && <div className="tpm-cache">离线只读缓存 · {view.cachedAt ? new Date(view.cachedAt).toLocaleString('zh-CN') : '时间未知'}</div>}
    {message && <div className="tpm-message" role="status">{message}</div>}
  </section>;
}
