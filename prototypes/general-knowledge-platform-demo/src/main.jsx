import React, { startTransition, useDeferredValue, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Archive,
  ArrowRight,
  Bot,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  CircleGauge,
  Clock3,
  Database,
  Download,
  FileCheck2,
  FilePlus2,
  Files,
  Fingerprint,
  FolderKanban,
  HardDrive,
  Inbox,
  LayoutDashboard,
  Link2,
  ListChecks,
  LockKeyhole,
  Network,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import {
  activity,
  agents,
  domains,
  initialTasks,
  nodes,
  pageCopy,
  profiles,
  projectRows,
  sources,
} from './data.js';
import './styles.css';

const navGroups = [
  {
    label: '工作空间',
    items: [
      ['overview', '总览', LayoutDashboard],
      ['profiles', '用户档案', UserRound],
      ['inbox', '采集收件箱', Inbox, '3'],
    ],
  },
  {
    label: '知识资产',
    items: [
      ['agents', 'Agent 知识', Bot],
      ['projects', '项目知识', FolderKanban],
      ['assets', '文件资产', Files],
      ['tasks', '任务中心', ListChecks, '4'],
      ['collaboration', '知识协作', Network],
    ],
  },
  {
    label: '平台能力',
    items: [
      ['extensions', '领域扩展', Boxes],
      ['studio', '数据工作室', Database],
    ],
  },
];

const statusTone = {
  已确认: 'success',
  已消化: 'success',
  已隔离: 'sensitive',
  待复核: 'warning',
  已连接: 'success',
  可连接: 'neutral',
  在线: 'success',
  待同步: 'warning',
};

function Status({ children, tone }) {
  return <span className={`status status-${tone || statusTone[children] || 'neutral'}`}><i />{children}</span>;
}

function Meter({ value }) {
  return <span className="meter" aria-label={`完成 ${value}%`}><i style={{ width: `${value}%` }} /></span>;
}

function EmptyMark({ children }) {
  return <div className="empty-mark"><Sparkles size={18} />{children}</div>;
}

function AppShell({ activePage, onNavigate, children, domain, setDomain, onAddSource }) {
  const activeDomain = domains.find((item) => item.id === domain) || domains[0];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-symbol" aria-hidden="true"><span /><i /><b /></div>
          <div><strong>知域</strong><small>KNOWLEDGE HUB</small></div>
        </div>
        <div className="workspace-switch">
          <span>QX</span><div><small>当前空间</small><b>个人知识工作台</b></div><ChevronDown size={15} />
        </div>
        <nav>
          {navGroups.map((group) => (
            <section className="nav-group" key={group.label}>
              <p>{group.label}</p>
              {group.items.map(([id, label, Icon, count]) => (
                <button className={activePage === id ? 'active' : ''} key={id} onClick={() => onNavigate(id)} type="button">
                  <Icon size={17} strokeWidth={1.8} /><span>{label}</span>{count ? <em>{count}</em> : null}
                </button>
              ))}
            </section>
          ))}
        </nav>
        <div className="local-vault">
          <HardDrive size={17} /><div><b>本地知识仓</b><small>54 项 · 186 MB</small></div><span />
        </div>
      </aside>

      <main className="main-column">
        <div className="demo-banner"><ShieldCheck size={14} /> 方案 C 交互 Demo · 全部人物与资料均为虚构 · 不连接正式数据</div>
        <header className="topbar">
          <div className="domain-switcher">
            <span className="domain-glyph">{activeDomain.icon}</span>
            <div><small>当前领域视图</small><b>{activeDomain.label}知识空间</b></div>
            <select value={domain} onChange={(event) => setDomain(event.target.value)} aria-label="切换领域视图">
              {domains.map((item) => <option value={item.id} key={item.id}>{item.label} · {item.code}</option>)}
            </select>
          </div>
          <div className="top-actions">
            <button className="icon-button" type="button" aria-label="搜索"><Search size={18} /></button>
            <button className="secondary-button" onClick={() => onNavigate('extensions')} type="button"><Boxes size={16} />管理扩展</button>
            <button className="primary-button" onClick={onAddSource} type="button"><Plus size={16} />采集资料</button>
            <span className="avatar">管</span>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

function PageHeader({ page, actions }) {
  const [title, subtitle] = pageCopy[page];
  return <header className="page-header"><div><h1>{title}</h1><p>{subtitle}</p></div>{actions ? <div className="page-actions">{actions}</div> : null}</header>;
}

function OverviewPage({ domain, onNavigate, onOpenEvidence }) {
  const current = domains.find((item) => item.id === domain) || domains[0];
  const domainCopy = {
    education: ['学习证据正在形成可行动的成长记录', '3 条已确认结论', '英语表达提升计划'],
    project: ['项目过程正在沉淀为可复用组织知识', '5 项关键决策', '校园 AI 知识库'],
    health: ['敏感健康资料保持独立授权与本地隔离', '2 份健康记录', '不提供诊断建议'],
    finance: ['合同与票据已按主体形成可追溯记录', '4 项财务资料', '不提供投资建议'],
  }[domain];
  return (
    <div className="page-content page-enter">
      <PageHeader page="overview" actions={<><button className="secondary-button" onClick={() => onNavigate('collaboration')} type="button"><Network size={16} />查看同步</button><button className="primary-button" onClick={() => onNavigate('agents')} type="button"><Bot size={16} />生成上下文</button></>} />
      <section className="workspace-hero">
        <div className="hero-copy">
          <span className="eyebrow"><i />{current.code} · 已启用</span>
          <h2>{domainCopy[0]}</h2>
          <p>同一份原始资料只保存一次，由当前领域扩展提供对象、视图和治理规则。</p>
          <div className="hero-actions"><button onClick={onOpenEvidence} type="button">查看证据链 <ArrowRight size={16} /></button><span>{domainCopy[1]} · {domainCopy[2]}</span></div>
        </div>
        <div className="knowledge-orbit" aria-label="知识流转关系图">
          <span className="orbit-center"><Fingerprint size={25} /><b>统一档案</b><small>PROFILE-LX</small></span>
          <span className="orbit-node node-source"><Files size={16} />原始资料</span>
          <span className="orbit-node node-claim"><FileCheck2 size={16} />可信结论</span>
          <span className="orbit-node node-agent"><Bot size={16} />Agent</span>
          <i className="orbit-ring ring-one" /><i className="orbit-ring ring-two" />
        </div>
      </section>

      <section className="metrics-strip">
        <div><span>资料资产</span><strong>54</strong><small>6 种来源</small></div>
        <div><span>正式知识</span><strong>21</strong><small>含有效证据</small></div>
        <div><span>活跃项目</span><strong>3</strong><small>12 项待办</small></div>
        <div><span>Agent 授权</span><strong>1</strong><small>5 个未授权</small></div>
      </section>

      <section className="section-block">
        <div className="section-heading"><div><h3>知识处理状态</h3><p>资料从采集到可使用知识的完整路径</p></div><button className="text-button" onClick={() => onNavigate('inbox')} type="button">打开收件箱 <ChevronRight size={15} /></button></div>
        <div className="pipeline">
          <div><span>01</span><b>采集</b><small>54 项原始资料</small></div><i />
          <div><span>02</span><b>解析</b><small>51 项已完成</small></div><i />
          <div><span>03</span><b>形成候选</b><small>7 条待复核</small></div><i />
          <div><span>04</span><b>人工确认</b><small>21 条正式知识</small></div><i />
          <div><span>05</span><b>授权使用</b><small>1 个有效授权</small></div>
        </div>
      </section>

      <div className="two-column">
        <section className="section-block">
          <div className="section-heading"><div><h3>重点档案</h3><p>跨领域身份仍由同一个 Profile 承载</p></div></div>
          <div className="profile-list compact">
            {profiles.slice(0, 2).map((profile) => <button key={profile.id} onClick={() => onNavigate('profiles')} type="button"><span className="profile-avatar">{profile.initials}</span><div><b>{profile.name}</b><small>{profile.note}</small></div><em>{profile.assets} 项</em><ChevronRight size={16} /></button>)}
          </div>
        </section>
        <section className="section-block">
          <div className="section-heading"><div><h3>最近活动</h3><p>操作、授权与状态变化均保留记录</p></div></div>
          <div className="activity-list">
            {activity.slice(0, 3).map((item) => <div key={item.time + item.title}><time>{item.time}</time><span /><p><b>{item.title}</b><small>{item.meta}</small></p></div>)}
          </div>
        </section>
      </div>
    </div>
  );
}

function ProfilesPage() {
  const [selected, setSelected] = useState(profiles[0]);
  return (
    <div className="page-content page-enter">
      <PageHeader page="profiles" actions={<button className="primary-button" type="button"><Plus size={16} />创建档案</button>} />
      <div className="split-workspace">
        <section className="master-pane">
          <div className="pane-toolbar"><label><Search size={16} /><input placeholder="搜索姓名、组织或 ID" /></label><button className="icon-button" type="button"><SlidersHorizontal size={16} /></button></div>
          <div className="profile-list">
            {profiles.map((profile) => <button className={selected.id === profile.id ? 'selected' : ''} onClick={() => setSelected(profile)} key={profile.id} type="button"><span className="profile-avatar">{profile.initials}</span><div><b>{profile.name}</b><small>{profile.note}</small></div><em>{profile.assets} 项</em><ChevronRight size={16} /></button>)}
          </div>
        </section>
        <section className="detail-pane">
          <div className="identity-header"><span className="profile-avatar large">{selected.initials}</span><div><small>{selected.type} · {selected.id}</small><h2>{selected.name}</h2><p>{selected.note}</p></div><Status tone="success">本地有效</Status></div>
          <div className="detail-section"><h3>领域身份</h3><div className="domain-identity-grid">{domains.map((item, index) => <div className={index < 2 ? '' : 'locked'} key={item.id}><span>{item.icon}</span><p><b>{item.label}身份</b><small>{index < 2 ? '已建立 · 独立授权' : '未建立具体身份'}</small></p>{index < 2 ? <Check size={16} /> : <LockKeyhole size={15} />}</div>)}</div></div>
          <div className="detail-section"><h3>兼容映射</h3><div className="mapping-row"><span>通用对象</span><b>Profile / {selected.id}</b><ArrowRight size={15} /><span>教育对象</span><b>Student / STU-DEMO-001</b></div><p className="notice-line"><ShieldCheck size={15} />保留原 studentId、资料路径与 edu:// 引用，不移动原件。</p></div>
          <div className="detail-section"><h3>授权摘要</h3><div className="permission-table"><div><span>Codex</span><b>教育 + 项目</b><small>今天 18:00 到期</small></div><div><span>QClaw</span><b>未授权</b><small>无法读取档案</small></div><div><span>健康与财务</span><b>隔离</b><small>未加入任何 Agent 上下文</small></div></div></div>
        </section>
      </div>
    </div>
  );
}

function InboxPage({ onAddSource, toast }) {
  const queue = sources.filter((item) => item.state === '待复核' || item.id === 'SRC-022');
  return (
    <div className="page-content page-enter">
      <PageHeader page="inbox" actions={<><button className="secondary-button" type="button"><Link2 size={16} />添加网页</button><button className="primary-button" onClick={onAddSource} type="button"><FilePlus2 size={16} />导入资料</button></>} />
      <section className="inbox-summary">
        <div><span>待处理</span><strong>3</strong><small>解析或复核</small></div><div><span>今天完成</span><strong>8</strong><small>含 2 份 Agent 对话</small></div><div><span>敏感隔离</span><strong>2</strong><small>健康与财务资料</small></div><p><ShieldCheck size={18} /><span><b>自动分流已启用</b><small>系统可以建议领域与档案，但不会自动发布正式知识。</small></span></p>
      </section>
      <section className="section-block table-block">
        <div className="section-heading"><div><h3>处理队列</h3><p>确认建议对象、领域和敏感级别</p></div></div>
        <div className="source-table">
          <div className="table-head"><span>资料</span><span>建议归属</span><span>处理状态</span><span>下一步</span></div>
          {queue.map((item, index) => <div className="table-row" key={item.id}><div className="file-cell"><span>{item.type}</span><p><b>{item.name}</b><small>{item.id} · {item.hash}</small></p></div><div><b>{item.owner}</b><small>{item.domain}空间</small></div><div><Status>{item.state}</Status><small>{index ? '发现 3 条候选知识' : '原件已登记'}</small></div><div><button className="row-action" onClick={() => toast(index ? '已打开人工复核视图' : '已开始解析；原文件保持不变')} type="button">{index ? '复核候选' : '继续处理'} <ChevronRight size={15} /></button></div></div>)}
        </div>
      </section>
      <section className="drop-zone" onClick={onAddSource}><FilePlus2 size={24} /><b>拖入文件，或点击选择</b><span>支持 PDF、Office、图片、Markdown、网页快照和 Agent 对话</span></section>
    </div>
  );
}

function AgentsPage({ toast }) {
  const [querying, setQuerying] = useState(false);
  const [answered, setAnswered] = useState(false);
  const runQuery = () => {
    setQuerying(true);
    setAnswered(false);
    window.setTimeout(() => { setQuerying(false); setAnswered(true); }, 850);
  };
  return (
    <div className="page-content page-enter">
      <PageHeader page="agents" actions={<button className="primary-button" onClick={() => toast('已生成一次性上下文授权草稿')} type="button"><Plus size={16} />新建授权</button>} />
      <div className="agent-layout">
        <section className="section-block agent-registry"><div className="section-heading"><div><h3>Agent 连接</h3><p>首个真实适配器，其余展示兼容状态</p></div></div>{agents.map((agent) => <div className="agent-row" key={agent.name}><span className="agent-logo">{agent.name.slice(0, 1)}</span><p><b>{agent.name}</b><small>{agent.mode} · {agent.detail}</small></p><Status>{agent.state}</Status><button className="icon-button" type="button"><ChevronRight size={16} /></button></div>)}</section>
        <section className="context-panel">
          <span className="eyebrow"><i />CONTEXT GRANT · PREVIEW</span><h2>为 Agent 生成最小必要上下文</h2><p>回答完成后自动失效；健康和财务信息明确排除。</p>
          <div className="context-scope"><div><span>主体</span><b>林晓 · PROFILE-LX</b></div><div><span>允许范围</span><b>教育档案、项目 PRJ-008</b></div><div><span>排除范围</span><b>健康、财务、私人对话</b></div><div><span>有效期</span><b>仅本次请求</b></div></div>
          <label className="query-box"><span>向 Codex 提问</span><textarea defaultValue="根据已确认的学习证据和项目任务，为林晓安排下周三个优先事项。" /></label>
          <button className="primary-button wide" onClick={runQuery} disabled={querying} type="button">{querying ? <><CircleGauge className="spin" size={16} />正在读取已授权证据</> : <><Bot size={16} />生成带引用的回答</>}</button>
          {answered ? <div className="answer-box"><span><Check size={14} />已基于 3 条证据生成</span><p>下周优先完成项目反馈整理、英语场景表达练习，并在周五前复盘两项任务的完成证据。</p><button onClick={() => toast('证据抽屉已打开：SRC-021、SRC-022、TSK-104')} type="button">查看 3 条引用 <ArrowRight size={15} /></button></div> : null}
        </section>
      </div>
    </div>
  );
}

function ProjectsPage({ onNavigate }) {
  const [selected, setSelected] = useState(projectRows[0]);
  return (
    <div className="page-content page-enter">
      <PageHeader page="projects" actions={<button className="primary-button" type="button"><Plus size={16} />新建项目</button>} />
      <div className="project-layout">
        <section className="project-index"><div className="pane-toolbar"><label><Search size={16} /><input placeholder="搜索项目" /></label></div>{projectRows.map((project) => <button className={selected.id === project.id ? 'selected' : ''} onClick={() => setSelected(project)} key={project.id} type="button"><div><span>{project.id}</span><b>{project.name}</b><small>{project.owner} · {project.tasks} 项任务</small></div><Meter value={project.progress} /><strong>{project.progress}%</strong></button>)}</section>
        <section className="project-detail"><div className="project-title"><div><span>{selected.id} · 进行中</span><h2>{selected.name}</h2><p>下一步：{selected.next}</p></div><div className="progress-ring" style={{ '--progress': `${selected.progress * 3.6}deg` }}><span>{selected.progress}%</span></div></div>
          <div className="project-kpis"><div><span>原始资料</span><b>{selected.evidence + 4}</b></div><div><span>正式知识</span><b>{selected.evidence}</b></div><div><span>待办任务</span><b>{selected.tasks.split('/')[1] - selected.tasks.split('/')[0]}</b></div><div><span>关键决策</span><b>5</b></div></div>
          <div className="knowledge-chain"><h3>项目知识链</h3><div><span className="done"><Check size={15} /></span><p><b>问题与目标已确认</b><small>项目章程 · 人工确认</small></p></div><div><span className="done"><Check size={15} /></span><p><b>第一轮访谈完成</b><small>4 份原始记录 · 8 条候选发现</small></p></div><div><span className="active"><Clock3 size={15} /></span><p><b>整理试用反馈</b><small>任务 TSK-104 · 今天到期</small></p></div><div><span><Archive size={15} /></span><p><b>形成可复用案例</b><small>完成后可进入专家数据工作室</small></p></div></div>
          <button className="secondary-button" onClick={() => onNavigate('studio')} type="button">查看数据资产化路径 <ArrowRight size={16} /></button>
        </section>
      </div>
    </div>
  );
}

function AssetsPage() {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const filtered = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase();
    return normalized ? sources.filter((item) => `${item.name}${item.owner}${item.domain}${item.type}`.toLowerCase().includes(normalized)) : sources;
  }, [deferredQuery]);
  return (
    <div className="page-content page-enter">
      <PageHeader page="assets" actions={<button className="secondary-button" type="button"><Download size={16} />导出清单</button>} />
      <div className="asset-toolbar"><label><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文件、主体、领域或格式" /></label><button type="button">全部领域 <ChevronDown size={14} /></button><button type="button">全部状态 <ChevronDown size={14} /></button><span>{filtered.length} 项结果</span></div>
      <section className="section-block table-block"><div className="source-table asset-table"><div className="table-head"><span>文件资产</span><span>主体 / 领域</span><span>敏感级别</span><span>状态</span><span>更新时间</span></div>{filtered.map((item) => <div className="table-row" key={item.id}><div className="file-cell"><span>{item.type}</span><p><b>{item.name}</b><small>{item.id} · SHA256 {item.hash}</small></p></div><div><b>{item.owner}</b><small>{item.domain}</small></div><div><Status tone={item.sensitivity === '敏感' ? 'sensitive' : 'neutral'}>{item.sensitivity}</Status></div><div><Status>{item.state}</Status></div><div><b>{item.time}</b><small>原件未移动</small></div></div>)}</div>{filtered.length === 0 ? <EmptyMark>没有符合条件的资料</EmptyMark> : null}</section>
    </div>
  );
}

function TasksPage({ tasks, onCreateTask, toast }) {
  const columns = [
    ['todo', '待开始'], ['doing', '进行中'], ['review', '待复核'], ['done', '已完成'],
  ];
  return (
    <div className="page-content page-enter">
      <PageHeader page="tasks" actions={<button className="primary-button" onClick={onCreateTask} type="button"><Plus size={16} />创建任务</button>} />
      <div className="task-board">{columns.map(([id, label]) => <section key={id}><header><span>{label}</span><em>{tasks.filter((task) => task.status === id).length}</em></header>{tasks.filter((task) => task.status === id).map((task) => <button className="task-item" key={task.id} onClick={() => toast(`${task.id}：完成时必须提交“${task.proof}”`)} type="button"><small>{task.id} · {task.project}</small><b>{task.title}</b><p><span className="profile-avatar mini">{task.owner.slice(0, 1)}</span>{task.owner}<time>{task.due}</time></p><div><FileCheck2 size={14} />{task.proof}</div></button>)}</section>)}</div>
    </div>
  );
}

function CollaborationPage({ toast }) {
  const [syncing, setSyncing] = useState(false);
  const sync = () => { setSyncing(true); window.setTimeout(() => { setSyncing(false); toast('3 个节点已完成清单比对；没有复制未授权资料'); }, 950); };
  return (
    <div className="page-content page-enter">
      <PageHeader page="collaboration" actions={<button className="primary-button" onClick={sync} disabled={syncing} type="button">{syncing ? <CircleGauge className="spin" size={16} /> : <Network size={16} />}{syncing ? '正在比对清单' : '同步所有节点'}</button>} />
      <section className="sync-map"><div className="sync-hub"><Network size={28} /><b>本地协作网络</b><small>按对象授权 · 哈希比对</small></div>{nodes.map((node, index) => <div className={`sync-node sync-node-${index + 1}`} key={node.id}><span>{node.primary ? '主' : index === 1 ? '学' : '评'}</span><p><b>{node.name}</b><small>{node.id} · {node.items} 项</small></p><Status>{node.state}</Status></div>)}<i className="sync-line line-1" /><i className="sync-line line-2" /><i className="sync-line line-3" /></section>
      <div className="two-column"><section className="section-block"><div className="section-heading"><div><h3>共享规则</h3><p>按主体、项目和字段授权</p></div></div><div className="rule-list"><div><LockKeyhole size={17} /><p><b>林晓 → 周岩</b><small>仅共享 PRJ-008 的已确认成果；7 天后失效</small></p><Status tone="success">有效</Status></div><div><ShieldCheck size={17} /><p><b>健康与财务分区</b><small>禁止跨节点自动同步</small></p><Status tone="sensitive">隔离</Status></div></div></section><section className="section-block"><div className="section-heading"><div><h3>最近同步</h3><p>冲突不静默覆盖</p></div></div><div className="activity-list">{nodes.map((node) => <div key={node.id}><time>{node.sync}</time><span /><p><b>{node.name}</b><small>{node.state === '待同步' ? '1 项清单等待确认' : '清单与哈希一致'}</small></p></div>)}</div></section></div>
    </div>
  );
}

function ExtensionsPage({ domain, setDomain, enabled, toggleExtension, toast }) {
  return (
    <div className="page-content page-enter">
      <PageHeader page="extensions" actions={<button className="secondary-button" onClick={() => toast('Demo 仅允许声明式扩展，不执行第三方代码')} type="button"><ShieldCheck size={16} />扩展安全规则</button>} />
      <section className="extension-intro"><div><span className="eyebrow"><i />EXTENSION RUNTIME · DEMO</span><h2>领域改变视图与规则，不复制底层知识。</h2><p>每个扩展只声明对象、字段、工作流、提示词和权限边界。</p></div><div className="extension-diagram"><span>统一核心</span><i /><b>{domains.find((item) => item.id === domain)?.code}</b></div></section>
      <section className="extension-list">{domains.map((item, index) => <article className={domain === item.id ? 'active' : ''} key={item.id}><span className="extension-icon">{item.icon}</span><div><small>{item.code}</small><h3>{item.label}知识模板</h3><p>{item.detail}</p></div><Status tone={index < 2 ? 'success' : 'neutral'}>{item.status}</Status><label className="switch"><input checked={enabled[item.id]} onChange={() => toggleExtension(item.id)} type="checkbox" /><span /></label><button className="secondary-button" onClick={() => { startTransition(() => setDomain(item.id)); toast(`已切换到${item.label}知识视图`); }} disabled={!enabled[item.id]} type="button">打开视图 <ArrowRight size={15} /></button></article>)}</section>
      <p className="notice-line"><ShieldCheck size={15} />停用扩展不会删除资料、Profile、Project、Task 或 Evidence；重新启用后领域视图可恢复。</p>
    </div>
  );
}

function StudioPage({ rightsCleared, onRights, toast }) {
  const exportPack = () => {
    const payload = {
      schema: 'knowledge-hub.dataset-pack.demo.v1',
      demo: true,
      taskEpisode: 'EP-PRJ008-01',
      rightsRecord: 'RIGHTS-DEMO-001',
      objects: ['TaskEpisode', 'ActionEvent', 'ArtifactVersion', 'Outcome', 'Rubric', 'EvaluationRun'],
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'knowledge-hub-demo-dataset-pack.json';
    anchor.click();
    URL.revokeObjectURL(url);
    toast('演示数据包已导出；不包含任何真实资料');
  };
  return (
    <div className="page-content page-enter">
      <PageHeader page="studio" actions={<button className="primary-button" disabled={!rightsCleared} onClick={exportPack} type="button"><Download size={16} />{rightsCleared ? '导出演示数据包' : '授权后可导出'}</button>} />
      <section className="studio-source"><div><span className="eyebrow"><i />SOURCE PROJECT</span><h2>校园 AI 知识库 · 第一轮试用反馈</h2><p>从已完成的任务、过程事件和成果版本创建一个可评价案例。</p></div><Status tone="success">材料完整</Status></section>
      <section className="data-flow"><div className="data-object done"><span>01</span><Fingerprint size={18} /><p><b>TaskEpisode</b><small>目标、约束与上下文</small></p><Check size={16} /></div><i /><div className="data-object done"><span>02</span><Clock3 size={18} /><p><b>ActionEvent</b><small>7 个关键过程事件</small></p><Check size={16} /></div><i /><div className="data-object done"><span>03</span><Archive size={18} /><p><b>ArtifactVersion</b><small>3 个成果版本</small></p><Check size={16} /></div><i /><div className="data-object active"><span>04</span><CircleGauge size={18} /><p><b>Rubric + Evaluation</b><small>4 项评价维度</small></p><ChevronRight size={16} /></div></section>
      <div className="studio-grid"><section className="section-block"><div className="section-heading"><div><h3>案例对象</h3><p>每个结论都能回到原始事件与成果</p></div></div><div className="object-list"><div><span>EP</span><p><b>EP-PRJ008-01</b><small>校园 AI 试用反馈整理</small></p><Status tone="success">完整</Status></div><div><span>RB</span><p><b>RUBRIC-008-A</b><small>完整性、准确性、可追溯性、可复用性</small></p><Status tone="success">已确认</Status></div><div><span>EV</span><p><b>EVAL-008-01</b><small>总分 86 / 100 · 人工复核完成</small></p><Status tone="success">已评价</Status></div></div></section><section className={`rights-panel ${rightsCleared ? 'cleared' : ''}`}><LockKeyhole size={22} /><span>{rightsCleared ? 'RIGHTS RECORD · CLEARED' : 'RIGHTS RECORD · REQUIRED'}</span><h3>{rightsCleared ? '授权记录完整，可以导出' : '数据资产不是默认可导出的'}</h3><p>{rightsCleared ? '仅允许导出演示案例结构，授权范围和到期时间随数据包保留。' : '需要确认材料归属、使用目的、可见范围和有效期。'}</p><button className={rightsCleared ? 'secondary-button' : 'primary-button'} onClick={onRights} type="button">{rightsCleared ? '查看授权记录' : '补充授权记录'} <ArrowRight size={15} /></button></section></div>
    </div>
  );
}

function Modal({ open, title, subtitle, children, onClose, footer }) {
  if (!open) return null;
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-label={title}><header><div><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-button" onClick={onClose} type="button"><X size={18} /></button></header><div className="modal-body">{children}</div>{footer ? <footer>{footer}</footer> : null}</section></div>;
}

function AddSourceModal({ open, onClose, onComplete }) {
  const [kind, setKind] = useState('文件');
  return <Modal open={open} onClose={onClose} title="采集新资料" subtitle="Demo 只登记虚构文件，不读取本机真实资料" footer={<><button className="secondary-button" onClick={onClose} type="button">取消</button><button className="primary-button" onClick={() => onComplete(kind)} type="button"><FilePlus2 size={16} />加入处理队列</button></>}><div className="source-kind-grid">{['文件', '网页', 'Agent 对话', '手工记录'].map((item) => <button className={kind === item ? 'selected' : ''} onClick={() => setKind(item)} key={item} type="button"><span>{item.slice(0, 1)}</span><b>{item}</b><small>{item === '文件' ? 'PDF、Office、图片' : item === '网页' ? 'URL 与网页快照' : item === 'Agent 对话' ? 'JSONL 或显式提交' : '事实、观察或备忘'}</small></button>)}</div><label className="form-field"><span>归属档案</span><select defaultValue="profile-linxiao"><option value="profile-linxiao">林晓 · PROFILE-LX</option><option value="profile-zhou">周岩 · PROFILE-ZY</option><option value="profile-studio">群星创新组 · PROFILE-QX</option></select></label><p className="notice-line"><ShieldCheck size={15} />系统只建议领域和敏感级别，正式知识仍需人工确认。</p></Modal>;
}

function TaskModal({ open, onClose, onComplete }) {
  const [title, setTitle] = useState('复盘本周项目与学习任务');
  return <Modal open={open} onClose={onClose} title="创建闭环任务" subtitle="完成时必须提交可核验的结果或证据" footer={<><button className="secondary-button" onClick={onClose} type="button">取消</button><button className="primary-button" onClick={() => onComplete(title)} type="button"><Plus size={16} />创建任务</button></>}><label className="form-field"><span>任务名称</span><input value={title} onChange={(event) => setTitle(event.target.value)} /></label><div className="form-row"><label className="form-field"><span>关联项目</span><select><option>校园 AI 知识库</option><option>英语表达提升计划</option></select></label><label className="form-field"><span>负责人</span><select><option>林晓</option><option>周岩</option></select></label></div><label className="form-field"><span>完成证据</span><input defaultValue="复盘记录 + 下周三项优先事项" /></label></Modal>;
}

function RightsModal({ open, onClose, rightsCleared, onConfirm }) {
  const [checked, setChecked] = useState(rightsCleared);
  return <Modal open={open} onClose={onClose} title="数据资产授权记录" subtitle="授权仅适用于当前虚构演示案例" footer={<><button className="secondary-button" onClick={onClose} type="button">取消</button><button className="primary-button" disabled={!checked} onClick={onConfirm} type="button"><ShieldCheck size={16} />保存授权记录</button></>}><div className="rights-summary"><div><span>材料归属</span><b>群星创新组 · 演示资料</b></div><div><span>允许目的</span><b>内部能力评价与 Demo 展示</b></div><div><span>可见范围</span><b>本地管理员</b></div><div><span>有效期</span><b>30 天</b></div></div><label className="check-row"><input checked={checked} onChange={(event) => setChecked(event.target.checked)} type="checkbox" /><span><b>我确认以上全部是虚构演示资料</b><small>不包含真实学生、患者、财务主体或第三方机密。</small></span></label></Modal>;
}

function EvidenceDrawer({ open, onClose }) {
  return <div className={`drawer-backdrop ${open ? 'open' : ''}`} onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><aside className="drawer"><header><div><span className="eyebrow"><i />EVIDENCE CHAIN</span><h2>结论的来源与状态</h2></div><button className="icon-button" onClick={onClose} type="button"><X size={18} /></button></header><div className="claim-block"><small>CONFIRMED CLAIM</small><h3>林晓在有明确场景时，能更稳定地使用过去进行时。</h3><p>这是一条经过人工确认的阶段性结论，不构成永久能力标签。</p><Status tone="success">已确认 · 2026-09-10</Status></div><div className="evidence-items"><div><span>01</span><p><b>英语阶段学习报告.pdf</b><small>SRC-021 · 学习成果 · 原文第 3 页</small></p><FileCheck2 size={17} /></div><div><span>02</span><p><b>课堂练习观察记录</b><small>OBS-018 · 教师观察 · 2026-09-08</small></p><FileCheck2 size={17} /></div><div><span>03</span><p><b>学生自我复盘</b><small>REPORT-009 · 主体自述 · 2026-09-09</small></p><FileCheck2 size={17} /></div></div><p className="notice-line"><ShieldCheck size={15} />Agent 推断不能单独发布为正式事实。</p></aside></div>;
}

function Toast({ message }) {
  return <div className={`toast ${message ? 'show' : ''}`}><Check size={16} /><span>{message}</span></div>;
}

function App() {
  const [activePage, setActivePage] = useState('overview');
  const [domain, setDomain] = useState('education');
  const [modal, setModal] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [rightsCleared, setRightsCleared] = useState(false);
  const [tasks, setTasks] = useState(initialTasks);
  const [enabled, setEnabled] = useState({ education: true, project: true, health: true, finance: true });

  const toast = (text) => {
    setMessage(text);
    window.clearTimeout(window.__knowledgeHubToast);
    window.__knowledgeHubToast = window.setTimeout(() => setMessage(''), 2500);
  };

  const navigate = (page) => {
    startTransition(() => setActivePage(page));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleExtension = (id) => {
    setEnabled((current) => ({ ...current, [id]: !current[id] }));
    toast(`${domains.find((item) => item.id === id)?.label}扩展已${enabled[id] ? '停用；底层资料仍保留' : '启用'}`);
  };

  const completeSource = (kind) => {
    setModal(null);
    navigate('inbox');
    toast(`${kind}已加入处理队列；系统不会自动发布结论`);
  };

  const completeTask = (title) => {
    setTasks((current) => [{ id: `TSK-${110 + current.length}`, title: title || '未命名任务', project: '校园 AI 知识库', owner: '林晓', due: '9月16日', status: 'todo', proof: '复盘记录 + 下周三项优先事项' }, ...current]);
    setModal(null);
    toast('任务已创建，并绑定完成证据要求');
  };

  const pageProps = { onNavigate: navigate, toast };
  const pages = {
    overview: <OverviewPage {...pageProps} domain={domain} onOpenEvidence={() => setDrawerOpen(true)} />,
    profiles: <ProfilesPage />,
    inbox: <InboxPage onAddSource={() => setModal('source')} toast={toast} />,
    agents: <AgentsPage toast={toast} />,
    projects: <ProjectsPage onNavigate={navigate} />,
    assets: <AssetsPage />,
    tasks: <TasksPage tasks={tasks} onCreateTask={() => setModal('task')} toast={toast} />,
    collaboration: <CollaborationPage toast={toast} />,
    extensions: <ExtensionsPage domain={domain} setDomain={setDomain} enabled={enabled} toggleExtension={toggleExtension} toast={toast} />,
    studio: <StudioPage rightsCleared={rightsCleared} onRights={() => setModal('rights')} toast={toast} />,
  };

  return <>
    <AppShell activePage={activePage} onNavigate={navigate} domain={domain} setDomain={setDomain} onAddSource={() => setModal('source')}>{pages[activePage]}</AppShell>
    <AddSourceModal open={modal === 'source'} onClose={() => setModal(null)} onComplete={completeSource} />
    <TaskModal open={modal === 'task'} onClose={() => setModal(null)} onComplete={completeTask} />
    <RightsModal open={modal === 'rights'} onClose={() => setModal(null)} rightsCleared={rightsCleared} onConfirm={() => { setRightsCleared(true); setModal(null); toast('授权记录已保存；演示数据包现在可以导出'); }} />
    <EvidenceDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    <Toast message={message} />
  </>;
}

createRoot(document.getElementById('root')).render(<App />);
