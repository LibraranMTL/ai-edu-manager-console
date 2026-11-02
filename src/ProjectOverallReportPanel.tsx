import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ChevronRight, FileSearch, FolderInput, RefreshCw, ShieldCheck, X } from 'lucide-react';
import './project-overall-report.css';

type RepresentativeResult = { title: string; statement: string; evidenceId: string; citationId: string };
type ReportClaim = { claimKey: string; section: string; kind: 'fact' | 'suggestion'; status: string; statement: string; evidenceIds: string[] };
type ProjectReport = {
  projectId: string; snapshotId: string; versionId: string; status: 'empty' | 'ready' | 'authorization_changed';
  reportType: 'stage_summary'; asOf: string; policyVersion: string; dataGeneration: number; authorizationVersion: string;
  project: { name: string; type: string; status: string; objective: string; description: string };
  summary: { currentStage: string; changes: string; representativeResults: RepresentativeResult[]; nextAction: string };
  claims: ReportClaim[]; gaps: string[]; disclaimer: string;
  personalContributions: Array<{ studentId: string; ability: string; observation: string; status: string; evidenceIds: string[] }>;
  coverage: { materials: { total: number; analyzed: number; unavailable: number; pending: number };
    knowledge: { total: number; analyzed: number; pending: number }; contributions: { confirmed: number; unconfirmed: number } };
};
type Citation = { citationId: string; sourceType: string; sourceId: string; revision: string; contentHash: string;
  availability: string; title: string; locator: { kind: string; logicalPath?: string; page?: number; row?: number; sheet?: string; timecode?: string } };
type ProjectReportApi = {
  getProjectOverallReport?: (projectId: string) => Promise<string>;
  refreshProjectOverallReport?: (projectId: string) => Promise<string>;
  getProjectReportCitation?: (projectId: string, versionId: string, citationId: string) => Promise<string>;
};

function api() { return (window as unknown as { AndroidBridge?: ProjectReportApi }).AndroidBridge; }
function parse<T>(raw: string, key: string): T {
  const value = JSON.parse(raw || '{}') as { ok?: boolean; message?: string } & Record<string, unknown>;
  if (!value.ok) throw new Error(value.message || '项目阶段摘要读取失败。');
  return value[key] as T;
}
function formatAsOf(value: string) {
  const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN') : '尚未固定';
}

export function ProjectOverallReportPanel({ project, onAddMaterials }: { project: { id: string; name: string }; onAddMaterials: () => void }) {
  const [report, setReport] = useState<ProjectReport | null>(null);
  const [citation, setCitation] = useState<Citation | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const bridge = api();
    if (!bridge?.getProjectOverallReport) { setMessage('当前版本尚未提供项目阶段摘要接口。'); setLoading(false); return; }
    setLoading(true); setMessage(''); setCitation(null);
    try { setReport(parse<ProjectReport>(await bridge.getProjectOverallReport(project.id), 'report')); }
    catch (error) { setMessage(error instanceof Error ? error.message : '项目阶段摘要读取失败。'); }
    finally { setLoading(false); }
  }, [project.id]);

  useEffect(() => { void load(); }, [load]);

  const refresh = async () => {
    const bridge = api(); if (!bridge?.refreshProjectOverallReport) return;
    setRefreshing(true); setMessage(''); setCitation(null);
    try { setReport(parse<ProjectReport>(await bridge.refreshProjectOverallReport(project.id), 'report')); setMessage('阶段摘要已基于当前登记资料更新。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '阶段摘要更新失败。'); }
    finally { setRefreshing(false); }
  };

  const openCitation = async (citationId: string) => {
    const bridge = api(); if (!bridge?.getProjectReportCitation || !report?.versionId) return;
    setMessage('');
    try { setCitation(parse<Citation>(await bridge.getProjectReportCitation(project.id, report.versionId, citationId), 'citation')); }
    catch (error) { setMessage(error instanceof Error ? error.message : '依据已变化或当前不可查看。'); }
  };

  const results = report?.summary.representativeResults || [];
  return <section className="project-report-shell" aria-labelledby="project-overall-report-heading">
    <header className="project-report-heading">
      <div>
        <span className="project-report-eyebrow"><ShieldCheck size={15} />M1 · 可核查阶段摘要</span>
        <h3 id="project-overall-report-heading">项目综合报告</h3>
        <p>只呈现已登记事实、证据缺口和下一步；不把团队成果自动写成个人能力或知识掌握。</p>
      </div>
      <div className="project-report-actions">
        <button className="secondary compact" type="button" onClick={onAddMaterials}><FolderInput size={16} />添加资料</button>
        <button className="primary compact" type="button" onClick={() => void refresh()} disabled={refreshing || loading}>
          <RefreshCw size={16} />{refreshing ? '正在固定快照…' : report?.status === 'ready' ? '更新阶段摘要' : '构建阶段摘要'}
        </button>
      </div>
    </header>

    {loading ? <div className="project-report-empty">正在读取已保存的阶段摘要…</div> : report && <>
      <div className="project-report-four">
        <article><span>当前阶段</span><strong>{report.summary.currentStage}</strong><small>{report.project.objective || '尚未登记明确目标'}</small></article>
        <article><span>本次变化</span><strong>{report.status === 'ready' ? '已固定证据快照' : '尚未构建'}</strong><small>{report.summary.changes}</small></article>
        <article><span>代表成果</span><strong>{results.length} 项</strong><small>{results.length ? results.map((item) => item.title).join('、') : '尚无可核查的已采用材料'}</small></article>
        <article className="next"><span>下一步行动</span><strong>{report.summary.nextAction}</strong><small>完成动作仍不代表目标已经达成。</small></article>
      </div>

      <div className="project-report-meta">
        <span>资料截止：{formatAsOf(report.asOf)}</span><span>资料 {report.coverage.materials.analyzed}/{report.coverage.materials.total}</span>
        <span>知识 {report.coverage.knowledge.analyzed}/{report.coverage.knowledge.total}</span><span>已确认个人贡献 {report.coverage.contributions.confirmed}</span>
      </div>

      <div className="project-report-body">
        <div>
          <h4>代表成果与依据</h4>
          <div className="project-report-list">
            {results.map((item) => <article key={item.evidenceId}><span><strong>{item.title}</strong><small>{item.statement}</small></span>
              <button className="secondary compact" type="button" onClick={() => void openCitation(item.citationId)}><FileSearch size={15} />查看依据</button></article>)}
            {!results.length && <div className="project-report-empty compact">添加并采用项目资料后，才能形成带依据的代表成果。</div>}
          </div>
        </div>
        <div>
          <h4>事实、缺口与待验证项</h4>
          <div className="project-report-list">
            {report.claims.filter((item) => item.kind === 'fact').map((item) => <article key={item.claimKey}><span><strong>已登记事实</strong><small>{item.statement}</small></span></article>)}
            {report.gaps.map((gap) => <article className="gap" key={gap}><AlertTriangle size={16} /><span><strong>待验证</strong><small>{gap}</small></span></article>)}
          </div>
        </div>
      </div>

      <footer className="project-report-footer"><span>{report.disclaimer}</span>{report.status !== 'ready' && <button type="button" onClick={onAddMaterials}>添加资料 <ChevronRight size={15} /></button>}</footer>
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

