import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ChevronRight, Download, FileSearch, FolderInput, History, RefreshCw, ShieldCheck, X } from 'lucide-react';
import './project-overall-report.css';

type RepresentativeResult = { title: string; statement: string; evidenceId: string; citationId: string };
type ReportClaim = { claimKey: string; section: string; kind: 'fact' | 'judgement' | 'suggestion'; status: string; statement: string; evidenceIds: string[] };
type ReportChange = ReportClaim & { previousStatement?: string; reason?: string };
type ReportDifference = { added: ReportChange[]; revised: ReportChange[]; withdrawn: ReportChange[]; unchanged: ReportChange[] };
type VersionSummary = { versionId: string; reportType: string; policyVersion: string; generation: number; createdAt: string };
type ProjectReport = {
  projectId: string; snapshotId: string; versionId: string; previousVersionId?: string;
  status: 'empty' | 'ready' | 'authorization_changed'; authorizationNotice?: string;
  reportType: 'stage_summary' | 'overall' | 'completion'; asOf: string; policyVersion: string; dataGeneration: number; authorizationVersion: string;
  project: { name: string; type: string; status: string; objective: string; description: string };
  summary: { currentStage: string; changes: string; representativeResults: RepresentativeResult[]; nextAction: string };
  sections?: Array<{ key: string; title: string; items: ReportClaim[] }>;
  changes?: ReportDifference; versions?: VersionSummary[];
  claims: ReportClaim[]; gaps: string[]; disclaimer: string;
  personalContributions: Array<{ studentId: string; ability: string; observation: string; status: string; evidenceIds: string[] }>;
  coverage: { materials: { total: number; analyzed: number; unavailable: number; pending: number };
    knowledge: { total: number; analyzed: number; pending: number }; contributions: { confirmed: number; unconfirmed: number } };
  completion?: { completedAt: string; frozenInputFingerprint: string };
};
type Citation = { citationId: string; sourceType: string; sourceId: string; revision: string; contentHash: string;
  availability: string; title: string; locator: { kind: string; logicalPath?: string; page?: number; row?: number; sheet?: string; timecode?: string } };
type ProjectReportApi = {
  getProjectOverallReport?: (projectId: string) => Promise<string>;
  refreshProjectOverallReport?: (projectId: string) => Promise<string>;
  getProjectOverallReportVersion?: (projectId: string, versionId: string) => Promise<string>;
  compareProjectOverallReportVersions?: (projectId: string, fromVersionId: string, toVersionId: string) => Promise<string>;
  getProjectReportCitation?: (projectId: string, versionId: string, citationId: string) => Promise<string>;
  exportProjectOverallReport?: (projectId: string, versionId: string, format: 'markdown' | 'html') => Promise<string>;
};

function api() { return (window as unknown as { AndroidBridge?: ProjectReportApi }).AndroidBridge; }
function parse<T>(raw: string, key: string): T {
  const value = JSON.parse(raw || '{}') as { ok?: boolean; message?: string } & Record<string, unknown>;
  if (!value.ok) throw new Error(value.message || '项目总体报告读取失败。');
  return value[key] as T;
}
function formatAsOf(value: string) {
  const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN') : '尚未固定';
}
function statusText(value: string) {
  return ({ fact: '已登记', observed: '已观察', pending: '待验证', achieved: '已达成', partially_achieved: '部分达成',
    not_achieved: '未达成', recommended: '建议' } as Record<string, string>)[value] || value;
}
const CHANGE_GROUPS: Array<[keyof ReportDifference, string]> = [
  ['added', '新增'], ['revised', '修订'], ['withdrawn', '撤回'],
];

export function ProjectOverallReportPanel({ project, onAddMaterials }: { project: { id: string; name: string }; onAddMaterials: () => void }) {
  const [report, setReport] = useState<ProjectReport | null>(null);
  const [citation, setCitation] = useState<Citation | null>(null);
  const [difference, setDifference] = useState<ReportDifference | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState<'' | 'markdown' | 'html'>('');
  const [switching, setSwitching] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const bridge = api();
    if (!bridge?.getProjectOverallReport) { setMessage('当前版本尚未提供项目总体报告接口。'); setLoading(false); return; }
    setLoading(true); setMessage(''); setCitation(null); setDifference(null);
    try { setReport(parse<ProjectReport>(await bridge.getProjectOverallReport(project.id), 'report')); }
    catch (error) { setMessage(error instanceof Error ? error.message : '项目总体报告读取失败。'); }
    finally { setLoading(false); }
  }, [project.id]);

  useEffect(() => { void load(); }, [load]);

  const refresh = async () => {
    const bridge = api(); if (!bridge?.refreshProjectOverallReport) return;
    setRefreshing(true); setMessage(''); setCitation(null); setDifference(null);
    try {
      setReport(parse<ProjectReport>(await bridge.refreshProjectOverallReport(project.id), 'report'));
      setMessage('任务中心已校验当前证据并保存新的不可变报告版本。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '项目总体报告更新失败。'); }
    finally { setRefreshing(false); }
  };

  const switchVersion = async (versionId: string) => {
    const bridge = api(); if (!bridge?.getProjectOverallReportVersion || !versionId || versionId === report?.versionId) return;
    setSwitching(true); setMessage(''); setCitation(null); setDifference(null);
    try { setReport(parse<ProjectReport>(await bridge.getProjectOverallReportVersion(project.id, versionId), 'report')); }
    catch (error) { setMessage(error instanceof Error ? error.message : '历史版本读取失败。'); }
    finally { setSwitching(false); }
  };

  const compareWithPrevious = async () => {
    const bridge = api();
    if (!bridge?.compareProjectOverallReportVersions || !report?.versionId || !report.previousVersionId) return;
    setMessage('');
    try {
      setDifference(parse<ReportDifference>(await bridge.compareProjectOverallReportVersions(
        project.id, report.previousVersionId, report.versionId), 'difference'));
    } catch (error) { setMessage(error instanceof Error ? error.message : '版本差异读取失败。'); }
  };

  const openCitation = async (citationId: string) => {
    const bridge = api(); if (!bridge?.getProjectReportCitation || !report?.versionId) return;
    setMessage('');
    try { setCitation(parse<Citation>(await bridge.getProjectReportCitation(project.id, report.versionId, citationId), 'citation')); }
    catch (error) { setMessage(error instanceof Error ? error.message : '依据已变化或当前不可查看。'); }
  };

  const exportReport = async (format: 'markdown' | 'html') => {
    const bridge = api(); if (!bridge?.exportProjectOverallReport || !report?.versionId) return;
    setExporting(format); setMessage('');
    try {
      const result = JSON.parse(await bridge.exportProjectOverallReport(project.id, report.versionId, format)) as { ok?: boolean; message?: string };
      if (!result.ok) throw new Error(result.message || '项目总体报告导出失败。');
      setMessage(result.message || `已导出${format === 'markdown' ? ' Markdown' : '安全 HTML'} 报告。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : '项目总体报告导出失败。'); }
    finally { setExporting(''); }
  };

  const results = report?.summary.representativeResults || [];
  const versions = report?.versions || [];
  const shownDifference = difference || report?.changes || null;
  return <section className="project-report-shell" aria-labelledby="project-overall-report-heading">
    <header className="project-report-heading">
      <div>
        <span className="project-report-eyebrow"><ShieldCheck size={15} />M3 · 结项与交付</span>
        <h3 id="project-overall-report-heading">项目综合报告</h3>
        <p>从阶段摘要到结项报告均绑定固定证据快照；归档成功后冻结唯一结项版本，历史、依据与导出统一按当前授权读取。</p>
      </div>
      <div className="project-report-actions">
        {versions.length > 0 && <label className="project-report-version"><History size={15} /><span>报告版本</span>
          <select value={report?.versionId || ''} disabled={switching} onChange={(event) => void switchVersion(event.target.value)}>
            {versions.map((version, index) => <option key={version.versionId} value={version.versionId}>
              {version.reportType === 'completion' ? '结项版 · ' : index === 0 ? '最新版 · ' : ''}{formatAsOf(version.createdAt)}
            </option>)}
          </select>
        </label>}
        {report?.versionId && <>
          <button className="secondary compact" type="button" onClick={() => void exportReport('markdown')} disabled={Boolean(exporting)}>
            <Download size={16} />{exporting === 'markdown' ? '导出中…' : '导出 Markdown'}
          </button>
          <button className="secondary compact" type="button" onClick={() => void exportReport('html')} disabled={Boolean(exporting)}>
            <Download size={16} />{exporting === 'html' ? '导出中…' : '导出 HTML（安全）'}
          </button>
        </>}
        {report?.reportType !== 'completion' && <>
          <button className="secondary compact" type="button" onClick={onAddMaterials}><FolderInput size={16} />添加资料</button>
          <button className="primary compact" type="button" onClick={() => void refresh()} disabled={refreshing || loading || switching}>
            <RefreshCw size={16} />{refreshing ? '任务中心生成中…' : report?.status === 'empty' ? '生成总体报告' : '更新总体报告'}
          </button>
        </>}
      </div>
    </header>

    {loading ? <div className="project-report-empty">正在读取已保存的报告版本…</div> : report && <>
      {report.authorizationNotice && <div className="project-report-access-note"><ShieldCheck size={16} />{report.authorizationNotice}</div>}
      {report.reportType === 'completion' && <div className="project-report-completion-note">
        <ShieldCheck size={18} /><span><strong>唯一结项版本</strong>已在项目归档成功后冻结，截止 {formatAsOf(report.completion?.completedAt || report.asOf)}。后续订正将另作补充说明，不改写本版本。</span>
      </div>}
      <div className="project-report-four">
        <article><span>当前阶段</span><strong>{report.summary.currentStage}</strong><small>{report.project.objective || '尚未登记明确目标'}</small></article>
        <article><span>本次变化</span><strong>{report.versionId ? `第 ${report.dataGeneration} 代` : '尚未生成'}</strong><small>{report.summary.changes}</small></article>
        <article><span>代表成果</span><strong>{results.length} 项</strong><small>{results.length ? results.map((item) => item.title).join('、') : '尚无可核查的已采用材料'}</small></article>
        <article className="next"><span>下一步行动</span><strong>{report.summary.nextAction}</strong><small>完成动作仍不代表目标已经达成。</small></article>
      </div>

      <div className="project-report-meta">
        <span>资料截止：{formatAsOf(report.asOf)}</span><span>资料 {report.coverage.materials.analyzed}/{report.coverage.materials.total}</span>
        <span>知识 {report.coverage.knowledge.analyzed}/{report.coverage.knowledge.total}</span><span>已确认个人贡献 {report.coverage.contributions.confirmed}</span>
        {report.previousVersionId && <button className="project-report-diff-button" type="button" onClick={() => void compareWithPrevious()}><History size={14} />查看与上版差异</button>}
      </div>

      {shownDifference && report.previousVersionId && <div className="project-report-diff" aria-label="版本差异">
        {CHANGE_GROUPS.map(([key, label]) => <article key={key}><strong>{label} {shownDifference[key]?.length || 0}</strong>
          {(shownDifference[key] || []).slice(0, 3).map((item) => <small key={item.claimKey}>{item.statement}{item.reason ? ` · ${item.reason}` : ''}</small>)}
          {!shownDifference[key]?.length && <small>无</small>}
        </article>)}
      </div>}

      {report.sections?.length ? <div className="project-report-sections">
        {report.sections.map((section, index) => <article key={section.key}>
          <header><span>{String(index + 1).padStart(2, '0')}</span><h4>{section.title}</h4></header>
          <div className="project-report-section-items">
            {section.items.map((item) => <div key={item.claimKey}><span className={`report-status ${item.status}`}>{statusText(item.status)}</span><p>{item.statement}</p>
              {item.evidenceIds.length > 0 && <small>已绑定 {item.evidenceIds.length} 条快照依据</small>}</div>)}
            {!section.items.length && <div className="project-report-empty compact">当前权限和证据范围内暂无可展示内容。</div>}
          </div>
        </article>)}
      </div> : <div className="project-report-body">
        <div><h4>代表成果与依据</h4><div className="project-report-list">
          {results.map((item) => <article key={item.evidenceId}><span><strong>{item.title}</strong><small>{item.statement}</small></span>
            <button className="secondary compact" type="button" onClick={() => void openCitation(item.citationId)}><FileSearch size={15} />查看依据</button></article>)}
          {!results.length && <div className="project-report-empty compact">添加并采用项目资料后，才能形成带依据的代表成果。</div>}
        </div></div>
        <div><h4>事实、缺口与待验证项</h4><div className="project-report-list">
          {report.claims.filter((item) => item.kind === 'fact').map((item) => <article key={item.claimKey}><span><strong>已登记事实</strong><small>{item.statement}</small></span></article>)}
          {report.gaps.map((gap) => <article className="gap" key={gap}><AlertTriangle size={16} /><span><strong>待验证</strong><small>{gap}</small></span></article>)}
        </div></div>
      </div>}

      <div className="project-report-evidence-row">
        <h4>代表成果依据</h4>{results.map((item) => <button key={item.evidenceId} className="secondary compact" type="button" onClick={() => void openCitation(item.citationId)}>
          <FileSearch size={15} />{item.title}</button>)}{!results.length && <span>暂无可下钻依据</span>}
      </div>
      <footer className="project-report-footer"><span>{report.disclaimer}</span>{report.status === 'empty' && <button type="button" onClick={onAddMaterials}>添加资料 <ChevronRight size={15} /></button>}</footer>
    </>}
    {message && <div className="notice" role="status">{message}</div>}
    {citation && <aside className="project-report-citation" aria-label="项目报告依据详情">
      <button className="icon-button" aria-label="关闭依据" type="button" onClick={() => setCitation(null)}><X size={17} /></button>
      <span>依据详情</span><h4>{citation.title || citation.sourceId}</h4>
      <dl><div><dt>来源</dt><dd>{citation.sourceType} · {citation.sourceId}</dd></div><div><dt>版本</dt><dd>{citation.revision}</dd></div>
        <div><dt>状态</dt><dd>{citation.availability}</dd></div><div><dt>定位</dt><dd>{citation.locator.logicalPath || citation.locator.kind}</dd></div></dl>
      <small>内容哈希：{citation.contentHash.slice(0, 16)}…</small>
    </aside>}
  </section>;
}
