import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ChevronRight, Download, FileSearch, FolderInput, History, RefreshCw, ShieldCheck, X } from 'lucide-react';
import './project-overall-report.css';

type RepresentativeResult = { title: string; displayTitle?: string; statement: string; displayStatement?: string; evidenceId: string; citationId: string };
type ReportClaim = { claimKey: string; section: string; kind: 'fact' | 'judgement' | 'suggestion'; status: string; displayStatus?: string; statement: string; displayStatement?: string; evidenceIds: string[] };
type ReportChange = ReportClaim & { previousStatement?: string; reason?: string; displayReason?: string };
type ReportDifference = { added: ReportChange[]; revised: ReportChange[]; withdrawn: ReportChange[]; unchanged: ReportChange[] };
type VersionSummary = { versionId: string; reportType: string; policyVersion: string; generation: number; createdAt: string };
type ProjectReport = {
  projectId: string; snapshotId: string; versionId: string; previousVersionId?: string;
  status: 'empty' | 'ready' | 'authorization_changed'; authorizationNotice?: string;
  reportType: 'stage_summary' | 'overall' | 'completion'; asOf: string; policyVersion: string; dataGeneration: number; authorizationVersion: string;
  reportTypeLabel?: string; updatedAt?: string;
  project: { name: string; type: string; status: string; objective: string; description: string };
  summary: { currentStage: string; changes: string; displayChanges?: string; representativeResults: RepresentativeResult[]; nextAction: string; displayNextAction?: string };
  sections?: Array<{ key: string; title: string; items: ReportClaim[] }>;
  changes?: ReportDifference; versions?: VersionSummary[];
  claims: ReportClaim[]; gaps: string[]; displayGaps?: string[]; disclaimer: string; displayDisclaimer?: string;
  personalContributions: Array<{ studentId: string; ability: string; observation: string; status: string; evidenceIds: string[] }>;
  coverage: { materials: { total: number; analyzed: number; unavailable: number; pending: number };
    knowledge: { total: number; analyzed: number; pending: number }; contributions: { confirmed: number; unconfirmed: number } };
  completion?: { completedAt: string; frozenInputFingerprint: string };
};
type Citation = { citationId: string; sourceType: string; displaySourceType?: string; sourceId: string; revision: string; contentHash: string;
  availability: string; displayAvailability?: string; title: string; displayTitle?: string; locator: { kind: string; logicalPath?: string; page?: number; row?: number; sheet?: string; timecode?: string } };
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
  return ({ fact: '已记录', observed: '已看到', pending: '待确认', achieved: '已完成', partially_achieved: '部分完成',
    not_achieved: '未完成', recommended: '建议下一步', withdrawn: '已移除' } as Record<string, string>)[value] || value;
}
const CHANGE_GROUPS: Array<[keyof ReportDifference, string]> = [
  ['added', '新增内容'], ['revised', '内容调整'], ['withdrawn', '移除内容'],
];

function reportLabel(report: ProjectReport | null) {
  return report?.reportTypeLabel || ({ stage_summary: '阶段进展', overall: '项目进展与成果', completion: '结项成果报告' } as const)[report?.reportType || 'overall'];
}
function originalFileName(value: string) {
  return String(value || '').replaceAll('\\', '/').split('/').filter(Boolean).at(-1) || '未命名资料';
}
function citationLocation(value: Citation) {
  if (value.locator.page) return `第 ${value.locator.page} 页`;
  if (value.locator.sheet && value.locator.row) return `${value.locator.sheet} · 第 ${value.locator.row} 行`;
  if (value.locator.row) return `第 ${value.locator.row} 行`;
  if (value.locator.timecode) return value.locator.timecode;
  return value.locator.logicalPath ? originalFileName(value.locator.logicalPath) : '项目资料';
}

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
      setMessage('报告已根据当前项目资料更新。');
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
    catch (error) { setMessage(error instanceof Error ? error.message : '来源已变化或当前不可查看。'); }
  };

  const exportReport = async (format: 'markdown' | 'html') => {
    const bridge = api(); if (!bridge?.exportProjectOverallReport || !report?.versionId) return;
    setExporting(format); setMessage('');
    try {
      const result = JSON.parse(await bridge.exportProjectOverallReport(project.id, report.versionId, format)) as { ok?: boolean; message?: string };
      if (!result.ok) throw new Error(result.message || '项目总体报告导出失败。');
      setMessage(result.message || `已下载${format === 'markdown' ? '文字版' : '网页版'}报告。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : '项目总体报告导出失败。'); }
    finally { setExporting(''); }
  };

  const results = report?.summary.representativeResults || [];
  const versions = report?.versions || [];
  const shownDifference = difference || report?.changes || null;
  return <section className="project-report-shell" aria-labelledby="project-overall-report-heading">
    <header className="project-report-heading">
      <div>
        <span className="project-report-eyebrow"><ShieldCheck size={15} />项目报告</span>
        <h3 id="project-overall-report-heading">{reportLabel(report)}</h3>
        <p>汇总项目目标、进展、成果和下一步行动，内容均来自当前项目资料。</p>
      </div>
      <div className="project-report-actions">
        {versions.length > 0 && <label className="project-report-version"><History size={15} /><span>历史报告</span>
          <select value={report?.versionId || ''} disabled={switching} onChange={(event) => void switchVersion(event.target.value)}>
            {versions.map((version, index) => <option key={version.versionId} value={version.versionId}>
              {version.reportType === 'completion' ? '结项报告 · ' : index === 0 ? '最近更新 · ' : ''}{formatAsOf(version.createdAt)}
            </option>)}
          </select>
        </label>}
        {report?.versionId && <>
          <button className="secondary compact" type="button" onClick={() => void exportReport('markdown')} disabled={Boolean(exporting)}>
            <Download size={16} />{exporting === 'markdown' ? '下载中…' : '下载文字版'}
          </button>
          <button className="secondary compact" type="button" onClick={() => void exportReport('html')} disabled={Boolean(exporting)}>
            <Download size={16} />{exporting === 'html' ? '下载中…' : '下载网页版'}
          </button>
        </>}
        {report?.reportType !== 'completion' && <>
          <button className="secondary compact" type="button" onClick={onAddMaterials}><FolderInput size={16} />添加项目资料</button>
          <button className="primary compact" type="button" onClick={() => void refresh()} disabled={refreshing || loading || switching}>
            <RefreshCw size={16} />{refreshing ? '正在更新…' : report?.status === 'empty' ? '生成报告' : '更新报告'}
          </button>
        </>}
      </div>
    </header>

    {loading ? <div className="project-report-empty">正在读取已保存的报告版本…</div> : report && <>
      {report.authorizationNotice && <div className="project-report-access-note"><ShieldCheck size={16} />{report.authorizationNotice}</div>}
      {report.reportType === 'completion' && <div className="project-report-completion-note">
        <ShieldCheck size={18} /><span><strong>结项成果报告</strong>保留了截至 {formatAsOf(report.completion?.completedAt || report.asOf)} 的项目内容；后续订正会作为补充说明，不会改写本报告。</span>
      </div>}
      <div className="project-report-four">
        <article><span>项目状态</span><strong>{report.summary.currentStage}</strong><small>{report.project.objective || '项目目标还没有填写'}</small></article>
        <article><span>最近更新</span><strong>{report.versionId ? formatAsOf(report.updatedAt || report.asOf) : '尚未生成报告'}</strong><small>{report.summary.displayChanges || report.summary.changes}</small></article>
        <article><span>主要成果</span><strong>{results.length} 项</strong><small>{results.length ? results.map((item) => item.displayTitle || item.title).join('、') : '还没有可查看的主要成果'}</small></article>
        <article className="next"><span>建议下一步</span><strong>{report.summary.displayNextAction || report.summary.nextAction}</strong><small>完成后可以继续检查项目进展。</small></article>
      </div>

      <div className="project-report-meta">
        <span>更新于：{formatAsOf(report.updatedAt || report.asOf)}</span><span>项目资料：{report.coverage.materials.analyzed} 份</span>
        <span>已形成可复用内容：{report.coverage.knowledge.analyzed} 条</span><span>已确认成员贡献：{report.coverage.contributions.confirmed} 项</span>
        {report.previousVersionId && <button className="project-report-diff-button" type="button" onClick={() => void compareWithPrevious()}><History size={14} />查看本次更新</button>}
      </div>

      {shownDifference && report.previousVersionId && <div className="project-report-diff" aria-label="版本差异">
        {CHANGE_GROUPS.map(([key, label]) => <article key={key}><strong>{label} {shownDifference[key]?.length || 0}</strong>
          {(shownDifference[key] || []).slice(0, 3).map((item) => <small key={item.claimKey}>{item.displayStatement || item.statement}{item.displayReason || item.reason ? ` · ${item.displayReason || item.reason}` : ''}</small>)}
          {!shownDifference[key]?.length && <small>无</small>}
        </article>)}
      </div>}

      {report.sections?.length ? <div className="project-report-sections">
        {report.sections.map((section, index) => <article key={section.key}>
          <header><span>{String(index + 1).padStart(2, '0')}</span><h4>{section.title}</h4></header>
          <div className="project-report-section-items">
            {section.items.map((item) => <div key={item.claimKey}><span className={`report-status ${item.status}`}>{item.displayStatus || statusText(item.status)}</span><p>{item.displayStatement || item.statement}</p>
              {item.evidenceIds.length > 0 && <small>有 {item.evidenceIds.length} 项来源支持</small>}</div>)}
            {!section.items.length && <div className="project-report-empty compact">当前可见范围内暂无内容。</div>}
          </div>
        </article>)}
      </div> : <div className="project-report-body">
        <div><h4>主要成果与来源</h4><div className="project-report-list">
          {results.map((item) => <article key={item.evidenceId}><span><strong title={originalFileName(item.title)}>{item.displayTitle || item.title}</strong><small>{item.displayStatement || item.statement}</small></span>
            <button className="secondary compact" type="button" onClick={() => void openCitation(item.citationId)}><FileSearch size={15} />查看来源</button></article>)}
          {!results.length && <div className="project-report-empty compact">添加项目资料后，报告会在这里展示主要成果。</div>}
        </div></div>
        <div><h4>已记录信息与待确认事项</h4><div className="project-report-list">
          {report.claims.filter((item) => item.kind === 'fact').map((item) => <article key={item.claimKey}><span><strong>已记录</strong><small>{item.displayStatement || item.statement}</small></span></article>)}
          {(report.displayGaps || report.gaps).map((gap) => <article className="gap" key={gap}><AlertTriangle size={16} /><span><strong>待确认</strong><small>{gap}</small></span></article>)}
        </div></div>
      </div>}

      <div className="project-report-evidence-row">
        <h4>主要成果来源</h4>{results.map((item) => <button key={item.evidenceId} className="secondary compact" title={originalFileName(item.title)} type="button" onClick={() => void openCitation(item.citationId)}>
          <FileSearch size={15} />{item.displayTitle || item.title}</button>)}{!results.length && <span>暂无可查看来源</span>}
      </div>
      <footer className="project-report-footer"><span>{report.displayDisclaimer || report.disclaimer}</span>{report.status === 'empty' && <button type="button" onClick={onAddMaterials}>添加项目资料 <ChevronRight size={15} /></button>}</footer>
    </>}
    {message && <div className="notice" role="status">{message}</div>}
    {citation && <aside className="project-report-citation" aria-label="项目报告来源详情">
      <button className="icon-button" aria-label="关闭来源" type="button" onClick={() => setCitation(null)}><X size={17} /></button>
      <span>来源详情</span><h4 title={originalFileName(citation.title || citation.sourceId)}>{citation.displayTitle || citation.title || citation.sourceId}</h4>
      <dl><div><dt>来源</dt><dd>{citation.displaySourceType || citation.sourceType}</dd></div><div><dt>版本</dt><dd>第 {citation.revision} 版</dd></div>
        <div><dt>状态</dt><dd>{citation.displayAvailability || citation.availability}</dd></div><div><dt>位置</dt><dd>{citationLocation(citation)}</dd></div></dl>
    </aside>}
  </section>;
}
