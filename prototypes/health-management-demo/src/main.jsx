import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  ArrowRight,
  BookOpenCheck,
  Bot,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Clock3,
  Download,
  FileCheck2,
  FileHeart,
  FilePlus2,
  Files,
  Filter,
  FolderArchive,
  HeartHandshake,
  HeartPulse,
  History,
  Home,
  Info,
  ListChecks,
  LockKeyhole,
  MessageCircleMore,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  TrendingUp,
  UploadCloud,
  UserRound,
  X,
} from 'lucide-react';
import './styles.css';

const profiles = [
  { id: 'PROFILE-LZ', name: '林舟', initials: 'LZ', meta: '50+ · 家庭成员', role: '本人档案', coverage: 78 },
  { id: 'PROFILE-ZY', name: '周妍', initials: 'ZY', meta: '13岁 · 学生档案', role: '受托管理', coverage: 46 },
];

const navItems = [
  ['overview', '健康总览', Home],
  ['documents', '健康资料', Files, '2'],
  ['records', '记录与趋势', TrendingUp],
  ['actions', '干预行动', ListChecks, '3'],
  ['courses', '健康课程', BookOpenCheck],
  ['services', '精选服务', HeartHandshake],
  ['settings', '设置', Settings2],
];

const documents = [
  { id: 'HEA-2026-018', name: '年度健康检查报告.pdf', type: 'PDF', category: '健康检查', date: '2026-02-18', source: '示例健康中心', status: '已复核', evidence: '来源记载', pages: 12, updated: '今天 09:42', tone: 'good' },
  { id: 'HEA-2026-021', name: '门诊检验记录.jpg', type: 'JPG', category: '检验记录', date: '2026-06-16', source: '本人拍照上传', status: '待复核', evidence: '机器提取', pages: 1, updated: '昨天 20:14', tone: 'warn' },
  { id: 'HEA-2026-012', name: '专科门诊处方.png', type: 'PNG', category: '用药记录', date: '2026-06-08', source: '本机文件导入', status: '已确认', evidence: '本人确认', pages: 2, updated: '6月8日', tone: 'good' },
  { id: 'HEA-2025-037', name: '影像复查报告.pdf', type: 'PDF', category: '影像检查', date: '2025-11-11', source: '历史资料导入', status: '已归档', evidence: '来源记载', pages: 3, updated: '2025年11月', tone: 'neutral' },
  { id: 'HEA-2025-024', name: '急诊资料汇总.pdf', type: 'PDF', category: '就诊记录', date: '2025-06-03', source: 'Obsidian历史资料', status: '已复核', evidence: '来源记载', pages: 8, updated: '2025年6月', tone: 'good' },
];

const metrics = {
  sleep: {
    label: '平均睡眠时长', value: '8.1', unit: '小时', change: '近4周 +0.4', tone: 'good',
    points: [62, 68, 65, 72, 76, 73, 82, 79, 88, 84, 91, 90],
    labels: ['7/28', '8/4', '8/11', '8/18', '8/25', '9/1', '9/8', '9/15', '9/22', '9/29', '10/6', '10/13'],
    note: '来源：本人确认的睡眠行动卡，仅用于生活记录。',
  },
  height: {
    label: '身高记录', value: '158.4', unit: 'cm', change: '12个月 +5.8 cm', tone: 'neutral',
    points: [48, 51, 55, 58, 61, 64, 66, 70, 74, 78, 81, 85],
    labels: ['2025/11', '12', '2026/1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
    note: '来源：学校及家庭测量记录；不同测量条件保留原始说明。',
  },
  vision: {
    label: '裸眼视力记录', value: '4.9', unit: '左眼', change: '2条待复核', tone: 'warn',
    points: [82, 82, 79, 79, 76, 76, 73, 73, 71, 71, 68, 68],
    labels: ['2025/3', '4', '5', '6', '9', '10', '2026/3', '4', '6', '7', '9', '10'],
    note: '显示原报告记录，不设置疾病阈值，不代替眼科检查。',
  },
};

const timeline = [
  { date: '10月13日', title: '睡眠行动卡完成', meta: '本人确认 · 平均 8.1 小时', icon: Check, tone: 'good' },
  { date: '6月16日', title: '门诊检验记录待复核', meta: '机器提取 · 采样条件待确认', icon: CircleAlert, tone: 'warn' },
  { date: '6月8日', title: '专科门诊处方已归档', meta: '本人确认 · 原件可回查', icon: FileCheck2, tone: 'good' },
  { date: '2月18日', title: '年度健康检查资料整理完成', meta: '来源记载 · 24项记录', icon: FolderArchive, tone: 'neutral' },
];

const tasksSeed = [
  { id: 'ACT-031', title: '补齐最近一次影像报告原件', source: '资料缺口清单', due: '今天', state: 'todo', kind: '资料补全' },
  { id: 'ACT-027', title: '整理复诊时需要询问的三个问题', source: '用户设置', due: '10月22日', state: 'doing', kind: '本人计划' },
  { id: 'ACT-024', title: '完成代谢指标复查预约', source: '医生记录', due: '10月28日', state: 'doing', kind: '复查安排' },
  { id: 'ACT-019', title: '核对当前用药清单', source: '门诊处方记录', due: '已完成', state: 'done', kind: '重点记录' },
];

const clinicalMetrics = {
  urate: {
    label: '尿酸', value: '427', unit: 'μmol/L', change: '较上次 -18', tone: 'warn',
    points: [84, 79, 72], labels: ['2025/02', '2026/02', '2026/06'],
    note: '演示值已扰动；仅比较单位和采样条件明确的来源记录。', reference: '参考上限 420',
  },
  glucose: {
    label: '血糖', value: '6.2', unit: 'mmol/L', change: '采样条件待确认', tone: 'warn',
    points: [54, 58, 64], labels: ['2025/02', '2026/02', '2026/06'],
    note: '最近一次是否空腹尚未确认，不与空腹结果直接合并判断。', reference: '演示参考 3.9–6.1',
  },
  ldl: {
    label: 'LDL-C', value: '3.68', unit: 'mmol/L', change: '等待复查', tone: 'warn',
    points: [69, 72, 75], labels: ['2024/12', '2025/08', '2026/02'],
    note: '来自三份已复核检查记录；参考区间随报告保存。', reference: '演示参考 <3.36',
  },
  tsh: {
    label: 'TSH', value: '0.58', unit: 'mIU/L', change: '临界值记录', tone: 'neutral',
    points: [60, 52, 45], labels: ['2025/05', '2026/01', '2026/06'],
    note: '单次临界值不形成健康结论，按原医嘱安排复查。', reference: '演示参考 0.56–5.91',
  },
};

const healthTimeline = [
  { date: '2026.08', title: '专项影像复查', meta: '报告结论已归档 · 1项来源缺口', type: '影像', tone: 'good' },
  { date: '2026.06', title: '专科门诊与化验', meta: '处方、检验和随访建议已关联', type: '门诊', tone: 'good' },
  { date: '2026.06', title: '急诊资料整理', meta: '已确认8份原件 · 最终医嘱待补齐', type: '急诊', tone: 'warn' },
  { date: '2026.02', title: '代谢指标复查', meta: '尿酸、血糖、血脂进入趋势', type: '检验', tone: 'neutral' },
  { date: '2025.11', title: '年度影像随访', meta: '报告提示与前次对照无明显变化', type: '影像', tone: 'good' },
  { date: '2024.12', title: '年度健康检查', meta: '形成第一版长期指标基线', type: '体检', tone: 'neutral' },
];

const medicationRecords = [
  { name: '抑酸药（处方记录）', purpose: '门诊症状管理', period: '2026.06 · 短期', source: '处方原件', status: '需确认是否仍在使用', tone: 'warn' },
  { name: '中成药口服液', purpose: '门诊处方', period: '2026.06 · 短期', source: '处方原件', status: '疗程状态待确认', tone: 'neutral' },
  { name: '外用镇痛贴剂', purpose: '肌肉关节不适', period: '2026.05 · 短期', source: '门诊处方', status: '历史记录', tone: 'good' },
  { name: '口服镇痛药', purpose: '慢性疼痛处理', period: '2026.05 · 短期', source: '门诊处方', status: '用药结束待确认', tone: 'neutral' },
];

const followups = [
  { title: '复查空腹血糖与尿酸', owner: '本人', due: '10月28日', progress: 70, state: '准备中' },
  { title: '补齐影像正式报告', owner: '档案管理员', due: '11月05日', progress: 35, state: '收集中' },
  { title: '专科复诊问题回顾', owner: '本人', due: '11月12日', progress: 20, state: '待开始' },
  { title: '核对当前用药状态', owner: '本人确认', due: '已完成', progress: 100, state: '已完成' },
];

const courses = [
  { id: 'COURSE-HEA-01', age: '初中', title: '把睡眠还给成长', topic: '睡眠与精力', minutes: 12, progress: 68, desc: '认识睡眠规律，完成一张可执行的七日行动卡。', tag: '进行中' },
  { id: 'COURSE-HEA-02', age: '初中', title: '青春期身体变化', topic: '身体成长', minutes: 15, progress: 0, desc: '理解成长变化、个人卫生与可信求助渠道。', tag: '适合当前年龄' },
  { id: 'COURSE-HEA-03', age: '初中', title: '屏幕之外的眼睛', topic: '视力与数字健康', minutes: 10, progress: 0, desc: '建立用眼、户外活动与屏幕休息的日常节奏。', tag: '机构精选' },
  { id: 'COURSE-HEA-04', age: '小学高年级', title: '身体的边界与求助', topic: '安全与边界', minutes: 9, progress: 0, desc: '认识身体边界，知道不适时如何向可信成年人求助。', tag: '适龄课程' },
  { id: 'COURSE-HEA-05', age: '高中', title: '压力不是一个人的事', topic: '情绪与求助', minutes: 18, progress: 0, desc: '识别压力信号，练习表达和获得支持。', tag: '专业复核' },
  { id: 'COURSE-HEA-06', age: '高中', title: '健康信息辨别课', topic: '健康决策', minutes: 20, progress: 0, desc: '判断来源、证据和适用条件，不被夸大信息带走。', tag: '平台课程' },
];

const services = [
  { id: 'SRV-01', name: '青少年视力健康咨询', category: '视力', provider: '星河眼视光中心', mode: '线下 · 海淀', reviewed: '2026-09-20', desc: '检查前问题整理与基础视功能咨询。', badge: '机构已核验' },
  { id: 'SRV-02', name: '家庭营养习惯评估', category: '营养', provider: '禾日营养工作室', mode: '线上', reviewed: '2026-08-16', desc: '基于家庭饮食记录进行教育性回顾，不提供治疗方案。', badge: '专业人员复核' },
  { id: 'SRV-03', name: '青少年运动姿态体验', category: '运动', provider: '向上运动健康中心', mode: '线下 · 朝阳', reviewed: '2026-10-02', desc: '运动安全教育与基础动作体验。', badge: '家长可陪同' },
];

function Status({ tone = 'neutral', children }) {
  return <span className={`status status-${tone}`}><i />{children}</span>;
}

function Toast({ text }) {
  return <div className={`toast ${text ? 'show' : ''}`}><Check size={15} />{text}</div>;
}

function PageHeader({ title, subtitle, children }) {
  return <header className="page-header"><div><h1>{title}</h1><p>{subtitle}</p></div><div className="page-actions">{children}</div></header>;
}

function MiniChart({ data }) {
  const width = 780;
  const height = 210;
  const pad = 14;
  const step = (width - pad * 2) / (data.points.length - 1);
  const path = data.points.map((point, index) => {
    const x = pad + step * index;
    const y = height - pad - (point / 100) * (height - pad * 2);
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  const area = `${path} L ${width - pad} ${height - pad} L ${pad} ${height - pad} Z`;
  return <div className="chart-wrap">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${data.label}趋势图`}>
      {[0.25, 0.5, 0.75].map((v) => <line key={v} x1="0" x2={width} y1={height * v} y2={height * v} className="grid-line" />)}
      <path d={area} className="chart-area" />
      <path d={path} className="chart-line" />
      {data.points.map((point, index) => {
        const x = pad + step * index;
        const y = height - pad - (point / 100) * (height - pad * 2);
        return <circle key={`${point}-${index}`} cx={x} cy={y} r={index === data.points.length - 1 ? 5 : 2.7} className={index === data.points.length - 1 ? 'point last' : 'point'} />;
      })}
    </svg>
    <div className="chart-labels">{data.labels.filter((_, i) => i % 2 === 0 || i === data.labels.length - 1).map((label) => <span key={label}>{label}</span>)}</div>
  </div>;
}

function AppShell({ activePage, setActivePage, profile, setProfile, children, onImport, onAsk }) {
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><i /><b /></span><div><strong>群星矩阵</strong><small>AI 教育管家</small></div></div>
      <button className="profile-switch" type="button">
        <span>{profile.initials}</span><div><small>当前健康档案</small><b>{profile.name}</b><em>{profile.meta}</em></div><ChevronDown size={15} />
      </button>
      <nav>
        <p>健康管理</p>
        {navItems.map(([id, label, Icon, count]) => <button key={id} className={activePage === id ? 'active' : ''} onClick={() => setActivePage(id)} type="button"><Icon size={18} strokeWidth={1.8} /><span>{label}</span>{count ? <em>{count}</em> : null}</button>)}
      </nav>
      <div className="sidebar-tools">
        <button onClick={onAsk} type="button"><Bot size={18} /><span><b>健康 AI 助手</b><small>仅使用本次授权资料</small></span><ChevronRight size={16} /></button>
        <div><ShieldCheck size={16} /><p><b>健康资料独立保存</b><small>教育 Agent 默认不可读取</small></p></div>
      </div>
    </aside>
    <main className="main-column">
      <div className="demo-banner"><ShieldCheck size={14} />交互演示 · 本机档案仅用于脱敏结构参考 · 人物、机构、日期与数值均为虚构</div>
      <header className="topbar">
        <div className="context"><span>健</span><p><small>当前领域</small><b>个人健康档案</b></p><Status tone="good">本地有效</Status></div>
        <div className="top-actions"><button className="search-button" type="button"><Search size={17} />搜索健康档案</button><button className="ghost-button" onClick={onAsk} type="button"><MessageCircleMore size={17} />询问 AI</button><button className="primary-button" onClick={onImport} type="button"><Plus size={17} />采集资料</button><button className="avatar" type="button">管</button></div>
      </header>
      {children}
    </main>
  </div>;
}

function OverviewPage({ profile, onImport, onNavigate, onOpenDoc, onVisitPrep }) {
  return <div className="page-content page-enter">
    <PageHeader title="健康总览" subtitle={`${profile.name} · 资料更新时间 2026年10月13日 09:42`}>
      <button className="ghost-button" onClick={() => onNavigate('courses')} type="button"><BookOpenCheck size={16} />健康课程</button>
      <button className="secondary-button" onClick={onVisitPrep} type="button"><ClipboardCheck size={16} />生成就诊准备</button>
      <button className="primary-button" onClick={onImport} type="button"><FilePlus2 size={16} />添加资料</button>
    </PageHeader>

    <section className="health-lead">
      <div className="lead-copy"><span className="eyebrow"><i />PERSONAL HEALTH RECORD · {profile.id}</span><h2>资料正在形成可回查的长期健康记录</h2><p>最近更新来自门诊检验记录，其中采样条件仍需人工核对。</p><div><button onClick={() => onOpenDoc(documents[1])} type="button">处理待复核资料 <ArrowRight size={16} /></button><span><LockKeyhole size={14} />健康与教育资料保持分域</span></div></div>
      <div className="coverage-visual"><div className="coverage-ring" style={{ '--coverage': `${profile.coverage * 3.6}deg` }}><span><b>{profile.coverage}%</b><small>资料覆盖</small></span></div><div><p><span>已归档原件</span><b>18</b></p><p><span>正式健康记录</span><b>42</b></p><p><span>待复核字段</span><b className="warning">2</b></p></div></div>
    </section>

    <section className="signal-strip">
      <div><span>最近健康检查</span><strong>2026.02.18</strong><small>24项记录 · 来源可回查</small></div>
      <div><span>当前行动</span><strong>3</strong><small>1项今天到期</small></div>
      <div><span>健康课程</span><strong>1 / 3</strong><small>本周完成进度</small></div>
      <div className="boundary"><ShieldCheck size={21} /><p><b>非诊断健康管理</b><small>不提供疾病预测、处方或治疗决策</small></p></div>
    </section>

    <div className="overview-grid">
      <section className="surface-section trend-panel">
        <div className="section-heading"><div><h3>生活记录趋势</h3><p>本人确认的睡眠行动卡 · 最近12周</p></div><button className="text-button" onClick={() => onNavigate('records')} type="button">查看全部趋势 <ChevronRight size={15} /></button></div>
        <div className="metric-focus"><div><strong>8.1</strong><span>小时 / 日</span></div><Status tone="good">近4周 +0.4小时</Status></div>
        <MiniChart data={metrics.sleep} />
        <p className="source-note"><Info size={14} />仅反映已记录数据，不用于判断健康状况。</p>
      </section>
      <section className="surface-section timeline-panel">
        <div className="section-heading"><div><h3>最近时间线</h3><p>原件、记录和行动按时间排列</p></div></div>
        <div className="timeline-list">{timeline.map(({ date, title, meta, icon: Icon, tone }) => <button onClick={() => title.includes('检验') && onOpenDoc(documents[1])} key={date + title} type="button"><time>{date}</time><span className={`timeline-icon ${tone}`}><Icon size={15} /></span><p><b>{title}</b><small>{meta}</small></p><ChevronRight size={15} /></button>)}</div>
      </section>
    </div>

    <section className="surface-section course-ribbon">
      <div><span className="course-kicker">本周健康教育</span><h3>把睡眠还给成长</h3><p>已完成 68% · 下一节：让大脑进入休息模式</p></div><div className="course-line"><i style={{ width: '68%' }} /></div><button onClick={() => onNavigate('courses')} type="button">继续学习 <ArrowRight size={16} /></button><small>课程学习记录属于教育领域，不自动形成健康事实。</small>
    </section>
  </div>;
}

function DocumentsPage({ onImport, onOpenDoc }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('全部');
  const filtered = useMemo(() => documents.filter((doc) => (filter === '全部' || doc.status === filter) && `${doc.name}${doc.category}${doc.source}`.toLowerCase().includes(query.trim().toLowerCase())), [query, filter]);
  return <div className="page-content page-enter">
    <PageHeader title="健康资料" subtitle="保留原件、来源、版本与处理状态">
      <button className="ghost-button" type="button"><Download size={16} />导出清单</button><button className="primary-button" onClick={onImport} type="button"><UploadCloud size={16} />导入资料</button>
    </PageHeader>
    <div className="asset-summary"><p><strong>18</strong><span>原始资料</span></p><p><strong>42</strong><span>结构化记录</span></p><p><strong>2</strong><span>待人工复核</span></p><div><ShieldCheck size={17} /><span>原件不会被AI改写，删除前说明下游影响。</span></div></div>
    <div className="asset-toolbar"><label><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索文件名、来源或类型" /></label><div>{['全部', '待复核', '已确认', '已归档'].map((item) => <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)} type="button">{item}</button>)}</div><button className="filter-button" type="button"><Filter size={16} />更多筛选</button></div>
    <section className="document-table">
      <div className="table-head"><span>资料</span><span>分类与日期</span><span>证据状态</span><span>处理状态</span><span /></div>
      {filtered.map((doc) => <button className="doc-row" key={doc.id} onClick={() => onOpenDoc(doc)} type="button"><div className="file-cell"><span>{doc.type}</span><p><b>{doc.name}</b><small>{doc.id} · {doc.pages}页 · {doc.source}</small></p></div><div><b>{doc.category}</b><small>{doc.date}</small></div><div><b>{doc.evidence}</b><small>可回到原件</small></div><div><Status tone={doc.tone}>{doc.status}</Status><small>{doc.updated}</small></div><ChevronRight size={17} /></button>)}
    </section>
  </div>;
}

function SubTabs({ items, value, onChange }) {
  return <div className="sub-tabs" role="tablist">{items.map(([id, label, hint]) => <button role="tab" aria-selected={value === id} className={value === id ? 'active' : ''} onClick={() => onChange(id)} key={id} type="button"><span>{label}</span>{hint ? <em>{hint}</em> : null}</button>)}</div>;
}

function RecordsPage() {
  const [tab, setTab] = useState('timeline');
  const [metric, setMetric] = useState('urate');
  const active = clinicalMetrics[metric];
  const tabs = [['timeline', '健康时间线', '6个节点'], ['metrics', '指标趋势', '4项重点'], ['medication', '用药与过敏记录', '1项待确认'], ['summary', '健康摘要', '阶段性']];
  return <div className="page-content page-enter">
    <PageHeader title="记录与趋势" subtitle="脱敏演示数据 · 事实、转述与待确认项分层展示"><button className="secondary-button" type="button"><Download size={16} />导出阶段记录</button></PageHeader>
    <SubTabs items={tabs} value={tab} onChange={setTab} />

    {tab === 'timeline' ? <div className="tab-stage">
      <div className="timeline-health-stats"><div><span>资料覆盖</span><b>4年</b><small>2024—2026</small></div><div><span>已核对事件</span><b>5</b><small>1项仍需补件</small></div><div><span>证据来源</span><b>23</b><small>报告、处方与本人记录</small></div><p><ShieldCheck size={18} /><span><b>时间语义已校准</b><small>保存日期、检查日期和归档日期分别记录。</small></span></p></div>
      <section className="health-timeline-workspace">
        <aside><span>时间跨度</span><strong>22</strong><small>个月连续整理</small><div className="year-track"><i style={{ height: '82%' }} /><b>2026</b><b>2025</b><b>2024</b></div></aside>
        <div className="clinical-timeline"><header><div><h2>健康事件时间线</h2><p>按检查和就诊实际发生时间排列</p></div><button className="text-button" type="button">筛选事件 <Filter size={14} /></button></header>{healthTimeline.map((item, index) => <article key={item.date + item.title}><time>{item.date}</time><span className={`timeline-node ${item.tone}`}><i /></span><div><small>{item.type}</small><h3>{item.title}</h3><p>{item.meta}</p></div><Status tone={item.tone}>{item.tone === 'warn' ? '待补齐' : '已归档'}</Status><button type="button"><ChevronRight size={16} /></button>{index < healthTimeline.length - 1 ? <i className="timeline-link" /> : null}</article>)}</div>
      </section>
      <p className="deid-note"><Info size={15} />本页参考本机健康档案的信息结构制作，人物、机构、日期与医学细节均已替换或模糊化。</p>
    </div> : null}

    {tab === 'metrics' ? <div className="tab-stage">
      <div className="record-layout clinical-record-layout">
        <aside className="metric-index"><p>重点追踪指标</p>{Object.entries(clinicalMetrics).map(([key, item]) => <button className={metric === key ? 'active' : ''} key={key} onClick={() => setMetric(key)} type="button"><span>{item.label}</span><b>{item.value} <small>{item.unit}</small></b><em className={item.tone}>{item.change}</em></button>)}<div><ShieldCheck size={16} /><p><b>比较规则已启用</b><small>单位、采样条件或参考区间不同的数据不会直接合并。</small></p></div></aside>
        <section className="record-canvas"><header><div><span>当前指标</span><h2>{active.label}</h2><p>{active.note}</p></div><div className="record-value"><strong>{active.value}</strong><span>{active.unit}</span><Status tone={active.tone}>{active.change}</Status></div></header><MiniChart data={active} /><div className="metric-reference"><span>报告参考</span><b>{active.reference}</b><small>参考区间随原始报告保存，不跨机构自动统一。</small></div><div className="record-legend"><span><i className="confirmed" />人工确认</span><span><i className="reported" />来源记载</span><span><i className="machine" />条件待确认</span><button type="button">查看原始记录 <ChevronRight size={14} /></button></div></section>
      </div>
      <section className="metric-context"><div><span>数据完整性</span><strong>76%</strong><i><b style={{ width: '76%' }} /></i></div><div><span>单位一致性</span><strong>100%</strong><i><b style={{ width: '100%' }} /></i></div><div><span>采样条件</span><strong>67%</strong><i><b style={{ width: '67%' }} /></i></div><p><Info size={16} /><span><b>非诊断趋势</b><small>图表只帮助回顾和准备复查，不用于预测疾病或调整治疗。</small></span></p></section>
    </div> : null}

    {tab === 'medication' ? <div className="tab-stage medication-stage">
      <div className="medication-overview"><div><span>处方记录</span><strong>4</strong><small>均保留来源和时间范围</small></div><div><span>当前状态待确认</span><strong>2</strong><small>不会自动标记为“正在服用”</small></div><div className="allergy-focus"><CircleAlert size={20} /><p><span>过敏记录</span><b>花粉 · 本人记录</b><small>反应表现和首次发生时间待补充；暂无已确认药物过敏记录不等于“无药物过敏”。</small></p></div></div>
      <section className="medication-table"><header><span>药物或类别</span><span>用途与时间</span><span>证据来源</span><span>当前状态</span></header>{medicationRecords.map((item) => <article key={item.name}><div><span className="med-icon"><FileHeart size={16} /></span><p><b>{item.name}</b><small>{item.purpose}</small></p></div><p><b>{item.period}</b><small>日期已模糊</small></p><p><b>{item.source}</b><small>可回查原件</small></p><Status tone={item.tone}>{item.status}</Status></article>)}</section>
      <section className="medication-map"><div className="section-heading"><div><h3>用药时间分布</h3><p>用于发现记录重叠和状态缺口，不判断药物相互作用</p></div></div><div className="med-axis"><span>5月</span><span>6月</span><span>7月</span><span>8月</span></div>{medicationRecords.map((item, index) => <div className="med-band" key={item.name}><span>{item.name}</span><i style={{ marginLeft: `${index < 2 ? 26 : 5}%`, width: `${index < 2 ? 25 : 20}%` }} className={index < 2 ? 'uncertain' : ''} /><em>{index < 2 ? '结束状态待确认' : '历史记录'}</em></div>)}</section>
    </div> : null}

    {tab === 'summary' ? <div className="tab-stage summary-stage">
      <section className="health-summary-hero"><div><span className="eyebrow"><i />HEALTH SUMMARY · DE-IDENTIFIED</span><h2>长期管理重点已形成四条可回查主线</h2><p>影像随访、代谢指标、专科症状与资料补全分别记录；本摘要不替代医生诊断。</p></div><div className="summary-score"><strong>81</strong><span>档案可用度</span><small>较上次整理 +7</small></div></section>
      <div className="summary-grid"><section><header><h3>重点主线</h3><span>按资料充分度排序</span></header>{[['影像随访', 88, '多次报告可对照'], ['代谢指标', 76, '已有连续数值'], ['专科症状', 64, '复诊结论待补'], ['用药状态', 52, '需本人再次确认']].map(([label, value, note]) => <div className="summary-bar" key={label}><p><b>{label}</b><small>{note}</small></p><span><i style={{ width: `${value}%` }} /></span><em>{value}%</em></div>)}</section><section className="summary-actions"><header><h3>本阶段建议整理</h3><span>资料管理动作，不是治疗建议</span></header><div><b>01</b><p><strong>补齐正式报告与最终医嘱</strong><small>避免仅凭截图或设备自动结论形成摘要。</small></p></div><div><b>02</b><p><strong>确认当前用药状态</strong><small>区分处方记录、实际使用和已经停用。</small></p></div><div><b>03</b><p><strong>复查时保持采样条件一致</strong><small>便于对照尿酸、血糖与血脂趋势。</small></p></div></section></div>
      <p className="deid-note"><ShieldCheck size={15} />摘要中的人物、机构、日期、数值和事件组合均为脱敏改编，仅用于产品交互演示。</p>
    </div> : null}
  </div>;
}

function ActionsPage({ tasks, setTasks, toast }) {
  const [tab, setTab] = useState('current');
  const moveTask = (id) => setTasks((items) => items.map((item) => item.id === id ? { ...item, state: item.state === 'done' ? 'todo' : 'done', due: item.state === 'done' ? '待安排' : '已完成' } : item));
  const tabs = [['current', '当前行动', '4项'], ['visit', '就诊准备单', '可生成'], ['followup', '随访任务', '3项进行中']];
  return <div className="page-content page-enter">
    <PageHeader title="干预行动" subtitle="把资料缺口、复查准备和本人计划变成可追踪任务"><button className="primary-button" onClick={() => toast('已创建一项本人设置的健康行动')} type="button"><Plus size={16} />新建行动</button></PageHeader>
    <SubTabs items={tabs} value={tab} onChange={setTab} />

    {tab === 'current' ? <div className="tab-stage"><section className="action-focus"><div><span className="eyebrow"><i />NEXT ACTION</span><h2>今天先补齐一份正式报告</h2><p>当前摘要引用了报告截图，补入正式原件后再更新长期趋势。</p><button onClick={() => toast('已打开资料缺口和关联摘要')} type="button">查看资料缺口 <ArrowRight size={16} /></button></div><div className="action-date"><span>今天</span><strong>16</strong><small>十月 · 星期五</small></div></section>
      <div className="action-board">{[['todo', '待处理'], ['doing', '进行中'], ['done', '已完成']].map(([state, label]) => <section key={state}><header><b>{label}</b><em>{tasks.filter((t) => t.state === state).length}</em></header>{tasks.filter((t) => t.state === state).map((task) => <article key={task.id}><span>{task.kind}</span><h3>{task.title}</h3><p><FileHeart size={14} />{task.source}</p><footer><time>{task.due}</time><button onClick={() => moveTask(task.id)} type="button">{state === 'done' ? '重新打开' : '标记完成'} <Check size={14} /></button></footer></article>)}</section>)}</div></div> : null}

    {tab === 'visit' ? <div className="tab-stage visit-prep-layout">
      <section className="visit-preview"><header><div><span>就诊准备单</span><h2>林舟 · 专科复诊准备</h2><p>生成于 2026年10月16日 · 演示资料</p></div><Status tone="good">已排除未确认推断</Status></header><div className="visit-summary-strip"><div><span>本次目的</span><b>复查与资料补全</b></div><div><span>已选资料</span><b>6份</b></div><div><span>待问问题</span><b>3项</b></div></div><article><span>01</span><div><h3>近期情况</h3><p>最近一次专科资料已归档；症状变化由本人到诊时补充，不由系统推断。</p></div></article><article><span>02</span><div><h3>重点指标</h3><p>尿酸、血糖和血脂存在连续记录；其中一次血糖采样条件待确认。</p></div></article><article><span>03</span><div><h3>当前用药与过敏</h3><p>两项短期处方的结束状态待本人确认；花粉过敏反应表现待补充。</p></div></article><article><span>04</span><div><h3>希望医生协助确认</h3><p>复查项目与周期、现有药物状态、缺失报告是否影响后续判断。</p></div></article><footer><ShieldCheck size={16} />仅包含已确认记录和明确标注的待确认项</footer></section>
      <aside className="visit-builder"><header><ClipboardCheck size={20} /><div><h3>准备单内容</h3><p>逐项选择，不自动发送档案</p></div></header>{['近12个月检查记录', '当前用药与过敏', '重点指标趋势', '本人填写的症状变化', '资料缺口与待询问事项'].map((label, index) => <label key={label}><input type="checkbox" defaultChecked={index !== 3} /><span><b>{label}</b><small>{index === 3 ? '到诊前由本人补充' : '已选择'}</small></span></label>)}<div className="visit-format"><span>输出格式</span><button className="active" type="button">Word</button><button type="button">PDF</button></div><button className="primary-button full-button" onClick={() => toast('就诊准备单已生成脱敏预览')} type="button"><Download size={16} />生成准备单预览</button><p><LockKeyhole size={14} />生成文件保存在当前健康档案，不自动发送给机构。</p></aside>
    </div> : null}

    {tab === 'followup' ? <div className="tab-stage followup-stage">
      <section className="followup-overview"><div className="followup-ring"><span><strong>56%</strong><small>本月完成度</small></span></div><div><span>随访任务</span><h2>4项任务，3项正在推进</h2><p>来源包括医生记录、资料缺口和本人计划；AI建议不会自动成为必须执行的任务。</p></div><div className="followup-legend"><span><i className="done" />已完成 1</span><span><i className="doing" />进行中 2</span><span><i className="todo" />待开始 1</span></div></section>
      <section className="followup-list"><header><span>任务</span><span>负责人</span><span>计划日期</span><span>进度</span><span>状态</span></header>{followups.map((item) => <article key={item.title}><div><span className="followup-check"><CalendarClock size={17} /></span><b>{item.title}</b></div><span>{item.owner}</span><time>{item.due}</time><div className="task-progress"><i><b style={{ width: `${item.progress}%` }} /></i><em>{item.progress}%</em></div><Status tone={item.progress === 100 ? 'good' : item.progress >= 50 ? 'neutral' : 'warn'}>{item.state}</Status></article>)}</section>
      <div className="followup-calendar"><div><span>10/16</span><b>今天</b><i /></div><div><span>10/28</span><b>代谢指标复查</b><i /></div><div><span>11/05</span><b>报告补齐</b><i /></div><div><span>11/12</span><b>专科复诊回顾</b></div></div>
    </div> : null}
    <p className="privacy-note"><LockKeyhole size={15} />系统通知只显示“有健康事项待查看”，不会在锁屏显示健康详情。</p>
  </div>;
}

function CoursesPage({ openCourse }) {
  const [age, setAge] = useState('初中');
  const visible = courses.filter((course) => course.age === age);
  return <div className="page-content page-enter">
    <PageHeader title="青少年健康教育课程" subtitle="课程在原精选课程体系中管理，学习记录属于教育领域"><button className="ghost-button" type="button"><Info size={16} />课程与健康档案边界</button></PageHeader>
    <section className="course-intro"><div><span className="eyebrow"><i />HEALTH LITERACY</span><h2>把健康知识变成每天能做到的小行动</h2><p>课程不读取个人健康档案，也不会根据学习行为推断疾病、心理或家庭健康状态。</p></div><BookOpenCheck size={84} strokeWidth={1.05} /></section>
    <div className="course-filter"><span>适用年龄</span>{['小学高年级', '初中', '高中'].map((item) => <button className={age === item ? 'active' : ''} onClick={() => setAge(item)} key={item} type="button">{item}</button>)}<em>{visible.length} 门课程</em></div>
    <section className="course-list">{visible.map((course, index) => <button onClick={() => openCourse(course)} type="button" key={course.id}><span className="course-number">0{index + 1}</span><div><small>{course.topic} · {course.minutes}分钟</small><h3>{course.title}</h3><p>{course.desc}</p>{course.progress ? <div className="inline-progress"><i style={{ width: `${course.progress}%` }} /><em>{course.progress}%</em></div> : null}</div><Status tone={course.progress ? 'good' : 'neutral'}>{course.tag}</Status><ArrowRight size={18} /></button>)}</section>
    <div className="course-boundary"><ShieldCheck size={18} /><p><b>领域边界</b><small>课程分配、学习与行动卡进入教育资料；体检、用药、过敏和就诊资料只进入健康档案。</small></p></div>
  </div>;
}

function ServicesPage({ openService }) {
  return <div className="page-content page-enter">
    <PageHeader title="精选健康服务" subtitle="可信服务目录与轻量转介 · 不包含交易结算或自动诊断匹配"><button className="ghost-button" type="button"><HeartHandshake size={16} />我的咨询</button></PageHeader>
    <section className="service-notice"><ShieldCheck size={20} /><div><b>健康档案默认不随咨询发送</b><p>如服务确需资料，由你逐次选择文件、范围和接收方。</p></div><span>后续可选模块</span></section>
    <div className="service-toolbar"><div><button className="active" type="button">全部服务</button><button type="button">视力</button><button type="button">营养</button><button type="button">运动</button><button type="button">心理支持</button></div><button className="filter-button" type="button"><Filter size={16} />地区与方式</button></div>
    <section className="service-list">{services.map((service, index) => <article key={service.id}><span className="service-index">0{index + 1}</span><div className="service-copy"><small>{service.category} · {service.mode}</small><h2>{service.name}</h2><p>{service.desc}</p><footer><b>{service.provider}</b><span>{service.badge}</span><em>复核于 {service.reviewed}</em></footer></div><button onClick={() => openService(service)} className="secondary-button" type="button">了解并咨询 <ArrowRight size={15} /></button></article>)}</section>
  </div>;
}

function SettingsPage({ toast }) {
  const [ai, setAi] = useState(true);
  const [external, setExternal] = useState(false);
  const [cross, setCross] = useState(false);
  return <div className="page-content page-enter settings-page">
    <PageHeader title="健康管理设置" subtitle="资料位置、AI授权、备份恢复和访问边界" />
    <section className="settings-section"><header><div><h2>健康 AI 处理</h2><p>本地保存不以模型授权为前提。</p></div></header><div className="setting-row"><div><Bot size={18} /><p><b>启用健康资料智能整理</b><small>允许对新资料生成结构化候选和待复核字段。</small></p></div><label className="switch"><input checked={ai} onChange={() => setAi(!ai)} type="checkbox" /><span /></label></div><div className="setting-row"><div><UploadCloud size={18} /><p><b>允许发送到外部模型</b><small>当前关闭；开启前将显示提供商、资料范围和处理内容。</small></p></div><label className="switch"><input checked={external} onChange={() => setExternal(!external)} type="checkbox" /><span /></label></div></section>
    <section className="settings-section"><header><div><h2>资料与备份</h2><p>健康空间与教育知识库保持路径独立。</p></div></header><div className="path-row"><FolderArchive size={18} /><p><span>健康资料位置</span><b>D:\AI管家数据\profiles\PROFILE-LZ\health</b></p><button className="ghost-button" type="button">重新绑定</button></div><div className="backup-row"><div><span>最近完整备份</span><b>2026年10月12日 22:18</b><small>18份原件 · SHA-256清单已校验</small></div><button className="secondary-button" onClick={() => toast('已生成直接导出预检清单；导出包不加密')} type="button"><Download size={16} />直接导出备份</button></div><p className="warning-line"><CircleAlert size={15} />导出包以普通文件保存，不设置密码；恢复前执行完整性检查和暂存预检。</p></section>
    <section className="settings-section"><header><div><h2>领域访问</h2><p>跨领域分析不属于第一、二阶段。</p></div></header><div className="setting-row"><div><LockKeyhole size={18} /><p><b>允许教育与健康跨领域分析</b><small>默认关闭；未来需要逐次选择人物、目的、资料类别和有效期。</small></p></div><label className="switch"><input checked={cross} onChange={() => setCross(!cross)} type="checkbox" disabled /><span /></label></div><div className="permission-list"><div><span>教育 Agent</span><b>无健康资料访问权</b><Status tone="good">隔离</Status></div><div><span>健康 AI 助手</span><b>仅当前人物健康资料</b><Status tone="good">最小范围</Status></div><div><span>第三方健康服务</span><b>逐次选择资料后才可发送</b><Status>未授权</Status></div></div></section>
  </div>;
}

function Drawer({ doc, onClose, toast }) {
  return <div className={`drawer-backdrop ${doc ? 'open' : ''}`} onClick={onClose}><aside className="drawer" onClick={(e) => e.stopPropagation()}><header><div><span>资料详情</span><h2>{doc?.name}</h2></div><button className="icon-button" onClick={onClose} type="button"><X size={19} /></button></header>{doc ? <><div className="drawer-file"><span>{doc.type}</span><div><b>{doc.id}</b><small>{doc.source} · {doc.pages}页 · {doc.date}</small></div><Status tone={doc.tone}>{doc.status}</Status></div><section><h3>证据状态</h3><div className="evidence-steps"><div className="done"><Check size={14} /><p><b>原件已保存</b><small>SHA-256 · 8ac4…91f2</small></p></div><div className="done"><Check size={14} /><p><b>结构化候选已生成</b><small>处理模板 health-records-v1</small></p></div><div className={doc.status === '待复核' ? 'active' : 'done'}>{doc.status === '待复核' ? <Clock3 size={14} /> : <Check size={14} />}<p><b>{doc.status === '待复核' ? '等待人工核对' : '人工复核完成'}</b><small>{doc.evidence}</small></p></div></div></section><section><h3>候选记录</h3><div className="candidate-record"><span>检查日期</span><b>{doc.date}</b><em>来源记载</em></div><div className="candidate-record"><span>资料类型</span><b>{doc.category}</b><em>来源记载</em></div>{doc.status === '待复核' ? <div className="candidate-record flagged"><span>采样条件</span><b>是否空腹？</b><em>需与原图或本人核对</em></div> : null}</section><footer><button className="ghost-button" type="button">打开原件</button><button className="primary-button" onClick={() => { toast('复核结果已保存；原始提取仍保留'); onClose(); }} type="button">{doc.status === '待复核' ? '确认复核' : '查看记录'}</button></footer></> : null}</aside></div>;
}

function Modal({ config, onClose, toast }) {
  if (!config) return null;
  const isImport = config.type === 'import';
  const isVisit = config.type === 'visit';
  const isCourse = config.type === 'course';
  const isService = config.type === 'service';
  const isAssistant = config.type === 'assistant';
  return <div className="modal-backdrop" onClick={onClose}><section className={`modal ${isAssistant ? 'assistant-modal' : ''}`} onClick={(e) => e.stopPropagation()}><header><div><span>{isImport ? 'COLLECT' : isVisit ? 'VISIT PREP' : isCourse ? 'HEALTH COURSE' : isService ? 'SERVICE CONSENT' : 'HEALTH AI'}</span><h2>{isImport ? '采集健康资料' : isVisit ? '生成就诊准备单' : isCourse ? config.item.title : isService ? config.item.name : '询问健康 AI 助手'}</h2><p>{isImport ? '人物与领域在提交时固定，切换页面不会改变归属。' : isVisit ? '只使用已确认记录和选择的资料范围。' : isCourse ? `${config.item.topic} · ${config.item.minutes}分钟` : isService ? '咨询不会自动附带健康档案。' : '仅基于当前人物已授权的健康资料回答。'}</p></div><button className="icon-button" onClick={onClose} type="button"><X size={19} /></button></header><div className="modal-body">
    {isImport ? <><div className="drop-upload"><UploadCloud size={28} /><b>拖入文件或点击选择</b><span>PDF、图片、Office、Markdown和录音原件</span></div><div className="form-grid"><label><span>人物</span><select><option>林舟 · PROFILE-LZ</option></select></label><label><span>领域</span><select><option>健康 · health-records-v1</option></select></label><label><span>资料类型</span><select><option>自动建议，提交前确认</option><option>健康检查</option><option>专项检查</option><option>就诊记录</option></select></label><label><span>处理方式</span><select><option>保存原件并生成候选</option><option>仅保存原件</option></select></label></div><p className="modal-note"><ShieldCheck size={15} />保存成功与AI处理状态分开显示，处理失败不会丢失原件。</p></> : null}
    {isVisit ? <><div className="scope-list"><label><input type="checkbox" defaultChecked /><span><b>最近12个月健康检查记录</b><small>2份原件 · 18条正式记录</small></span></label><label><input type="checkbox" defaultChecked /><span><b>当前行动与待询问事项</b><small>3项行动 · 1项待复核</small></span></label><label><input type="checkbox" /><span><b>历史运动损伤记录</b><small>2025年5月 · 本人确认</small></span></label></div><div className="form-grid"><label><span>输出格式</span><select><option>Word 文档</option><option>PDF 文档</option></select></label><label><span>用途</span><select><option>健康咨询准备</option><option>家庭阶段回顾</option></select></label></div></> : null}
    {isCourse ? <><div className="course-modal-visual"><BookOpenCheck size={44} /><div><span>{config.item.age}</span><b>{config.item.desc}</b></div></div><div className="course-outline"><div><span>01</span><p><b>认识问题</b><small>4分钟 · 情境学习</small></p><Check size={15} /></div><div><span>02</span><p><b>练习一个方法</b><small>5分钟 · 互动选择</small></p><ChevronRight size={15} /></div><div><span>03</span><p><b>制定行动卡</b><small>3分钟 · 自主填写</small></p><ChevronRight size={15} /></div></div><p className="modal-note"><Info size={15} />课程学习进入教育领域，不写入体检、用药或就诊摘要。</p></> : null}
    {isService ? <><div className="service-consent"><HeartHandshake size={30} /><p><b>{config.item.provider}</b><small>{config.item.mode} · {config.item.badge}</small></p></div><div className="consent-list"><div><Check size={15} /><p><b>发送咨询意向</b><small>姓名、联系方式和希望咨询的服务</small></p></div><div><LockKeyhole size={15} /><p><b>不发送健康档案</b><small>如后续需要，必须重新选择具体文件</small></p></div><div><Info size={15} /><p><b>平台仅记录转介状态</b><small>不自动判断服务效果或治疗结果</small></p></div></div></> : null}
    {isAssistant ? <><div className="assistant-scope"><ShieldCheck size={17} /><p><b>本次授权范围</b><small>林舟 · 健康资料 · 仅本次对话 · 排除教育数据</small></p></div><div className="assistant-thread"><div className="assistant-prompt">最近需要优先处理哪些健康资料？</div><div className="assistant-answer"><Sparkles size={16} /><p>当前最需要处理的是<strong>6月16日门诊检验记录</strong>：采样条件尚未人工确认，同时建议补齐最近一次影像正式报告。<button onClick={() => toast('已打开引用：HEA-2026-021')} type="button">查看来源 HEA-2026-021 <ArrowRight size={13} /></button></p></div></div><label className="assistant-input"><input placeholder="继续询问档案、资料或准备事项" /><button type="button"><ArrowRight size={17} /></button></label><p className="modal-note"><Info size={15} />AI回答不是诊断；更新当前用药、过敏等重点记录前需再次确认。</p></> : null}
  </div><footer><button className="ghost-button" onClick={onClose} type="button">取消</button><button className="primary-button" onClick={() => { toast(isImport ? '演示资料已进入健康收件箱' : isVisit ? '就诊准备单已生成预览' : isCourse ? '课程已在教育领域继续学习' : isService ? '咨询意向已记录，未发送健康档案' : '本次健康AI授权已结束'); onClose(); }} type="button">{isImport ? '确认采集' : isVisit ? '生成预览' : isCourse ? '继续学习' : isService ? '确认咨询' : '结束本次问答'}</button></footer></section></div>;
}

function App() {
  const [activePage, setActivePage] = useState('overview');
  const [profile, setProfile] = useState(profiles[0]);
  const [drawerDoc, setDrawerDoc] = useState(null);
  const [modal, setModal] = useState(null);
  const [toastText, setToastText] = useState('');
  const [tasks, setTasks] = useState(tasksSeed);

  const toast = (text) => { setToastText(text); window.clearTimeout(window.__healthToast); window.__healthToast = window.setTimeout(() => setToastText(''), 2600); };
  const openImport = () => setModal({ type: 'import' });
  const openVisit = () => setModal({ type: 'visit' });
  const openAssistant = () => setModal({ type: 'assistant' });

  const pages = {
    overview: <OverviewPage profile={profile} onImport={openImport} onNavigate={setActivePage} onOpenDoc={setDrawerDoc} onVisitPrep={openVisit} />,
    documents: <DocumentsPage onImport={openImport} onOpenDoc={setDrawerDoc} />,
    records: <RecordsPage />,
    actions: <ActionsPage tasks={tasks} setTasks={setTasks} onVisitPrep={openVisit} toast={toast} />,
    courses: <CoursesPage openCourse={(item) => setModal({ type: 'course', item })} />,
    services: <ServicesPage openService={(item) => setModal({ type: 'service', item })} />,
    settings: <SettingsPage toast={toast} />,
  };

  return <>
    <AppShell activePage={activePage} setActivePage={setActivePage} profile={profile} setProfile={setProfile} onImport={openImport} onAsk={openAssistant}>{pages[activePage]}</AppShell>
    <Drawer doc={drawerDoc} onClose={() => setDrawerDoc(null)} toast={toast} />
    <Modal config={modal} onClose={() => setModal(null)} toast={toast} />
    <Toast text={toastText} />
  </>;
}

createRoot(document.getElementById('root')).render(<App />);
