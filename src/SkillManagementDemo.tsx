import React, { useMemo, useState } from 'react';
import {
  Archive,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleGauge,
  Clock3,
  Download,
  FileArchive,
  FileText,
  FolderOpen,
  HardDrive,
  Info,
  Library,
  LockKeyhole,
  PackageCheck,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Tag,
  X,
} from 'lucide-react';
import './skill-management-demo.css';

type DemoTab = 'archive' | 'browse';
type HostId = 'codex' | 'workbuddy';

type SkillRecord = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  version: string;
  source: 'Codex' | 'WorkBuddy' | 'QClaw';
  tags: string[];
  risk: '低风险' | '需审查';
  status: '已验证' | '已存档' | '待审查';
  fileCount: number;
  updatedAt: string;
  accent: string;
  initials: string;
  compatible: HostId[];
};

const skills: SkillRecord[] = [
  {
    id: 'local-knowledge-digest',
    name: 'local-knowledge-digest',
    displayName: '本地知识整理',
    description: '将本地原始资料整理为可追溯的知识摘要、索引与主题页面。',
    category: '知识管理',
    version: '2.3.1',
    source: 'Codex',
    tags: ['知识库', '本地文件', '教育资料'],
    risk: '低风险',
    status: '已验证',
    fileCount: 9,
    updatedAt: '今天 09:42',
    accent: '#297c68',
    initials: '知',
    compatible: ['codex', 'workbuddy'],
  },
  {
    id: 'documents',
    name: 'documents',
    displayName: '文档协作助手',
    description: '创建、编辑与检查 Word 文档，保留批注、修订与版式结构。',
    category: '文档办公',
    version: '1.8.0',
    source: 'WorkBuddy',
    tags: ['Word', '报告', '教案'],
    risk: '低风险',
    status: '已存档',
    fileCount: 14,
    updatedAt: '昨天 18:20',
    accent: '#4a67b1',
    initials: '文',
    compatible: ['codex', 'workbuddy'],
  },
  {
    id: 'managebac-tasks',
    name: 'managebac-tasks',
    displayName: 'ManageBac 任务查看',
    description: '读取课程任务与截止日期，按学生范围生成清晰的待办清单。',
    category: '教育教学',
    version: '1.4.2',
    source: 'Codex',
    tags: ['课程', '任务', '学生'],
    risk: '需审查',
    status: '待审查',
    fileCount: 6,
    updatedAt: '10月17日',
    accent: '#af694c',
    initials: '课',
    compatible: ['codex'],
  },
  {
    id: 'imagegen',
    name: 'imagegen',
    displayName: '教学插图生成',
    description: '为教案、课堂材料与科普内容生成或编辑配图。',
    category: '媒体创作',
    version: '3.0.0',
    source: 'QClaw',
    tags: ['图片', '创作', '课堂素材'],
    risk: '低风险',
    status: '已存档',
    fileCount: 5,
    updatedAt: '10月16日',
    accent: '#8a5e9d',
    initials: '图',
    compatible: ['codex', 'workbuddy'],
  },
  {
    id: 'pdf',
    name: 'pdf',
    displayName: 'PDF 阅读与检查',
    description: '读取、创建、渲染并检查 PDF 文件的内容与页面布局。',
    category: '文档办公',
    version: '2.1.0',
    source: 'WorkBuddy',
    tags: ['PDF', '版式', '检查'],
    risk: '低风险',
    status: '已验证',
    fileCount: 11,
    updatedAt: '10月15日',
    accent: '#b14f58',
    initials: 'P',
    compatible: ['codex', 'workbuddy'],
  },
  {
    id: 'feishu-log',
    name: 'feishu-log',
    displayName: '飞书工作日志',
    description: '将工作摘要追加到指定飞书文档，并保留写入结果。',
    category: '自动化',
    version: '1.2.4',
    source: 'Codex',
    tags: ['飞书', '日志', '自动记录'],
    risk: '需审查',
    status: '已存档',
    fileCount: 7,
    updatedAt: '10月14日',
    accent: '#32789a',
    initials: '录',
    compatible: ['codex'],
  },
];

const categories = ['全部', '教育教学', '知识管理', '文档办公', '媒体创作', '自动化'];

function SourceMark({ label }: { label: SkillRecord['source'] }) {
  return <span className={`skill-source skill-source--${label.toLowerCase()}`}>{label}</span>;
}

function StatusRail({ active = 4 }: { active?: number }) {
  const steps = ['发现', '安检', '存档', '可安装', '已验证'];
  return (
    <ol className="skill-status-rail" aria-label="Skill 状态进度">
      {steps.map((step, index) => (
        <li key={step} className={index <= active ? 'is-complete' : ''}>
          <span className="skill-status-dot">{index < active ? <Check size={12} /> : index + 1}</span>
          <span>{step}</span>
        </li>
      ))}
    </ol>
  );
}

function ScanSourceCard({
  name,
  description,
  count,
  detail,
  tone,
  readonly,
  scanning,
}: {
  name: string;
  description: string;
  count: number;
  detail: string;
  tone: string;
  readonly?: boolean;
  scanning: boolean;
}) {
  return (
    <article className="scan-source-card" style={{ '--source-tone': tone } as React.CSSProperties}>
      <div className="scan-source-heading">
        <span className="scan-source-icon"><Bot size={20} /></span>
        <div>
          <h3>{name}</h3>
          <p>{description}</p>
        </div>
        <span className={`source-mode ${readonly ? 'source-mode--readonly' : ''}`}>
          {readonly ? <LockKeyhole size={13} /> : <PackageCheck size={13} />}
          {readonly ? '只读导出' : '支持安装'}
        </span>
      </div>
      <div className="scan-source-result">
        <strong>{scanning ? '—' : count}</strong>
        <span>{scanning ? '正在识别…' : detail}</span>
      </div>
      <div className="scan-source-foot">
        <span className={scanning ? 'scan-pulse' : 'scan-source-ok'}>
          {scanning ? <RefreshCw size={14} /> : <CheckCircle2 size={14} />}
          {scanning ? '扫描进行中' : '路径已确认'}
        </span>
        <button type="button" className="text-button">查看路径 <ChevronRight size={14} /></button>
      </div>
    </article>
  );
}

function ArchiveView({ onBrowse }: { onBrowse: () => void }) {
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState('今天 09:42');
  const [notice, setNotice] = useState('');

  function runScan() {
    if (scanning) return;
    setScanning(true);
    setNotice('');
    window.setTimeout(() => {
      setScanning(false);
      setLastScan('刚刚');
      setNotice('扫描完成：发现 2 个更新，1 项需要人工确认。');
    }, 1100);
  }

  return (
    <div className="skills-view archive-view">
      <section className="skill-hero">
        <div>
          <div className="eyebrow"><Archive size={15} /> 本机 Skill 资产库</div>
          <h1>把散落的能力，整理成可复用的资产</h1>
          <p>扫描 Codex、WorkBuddy 与 QClaw 的本地 Skills，完成去重、安检、存档和标签整理。</p>
        </div>
        <button type="button" className="primary-button" onClick={runScan} disabled={scanning}>
          <RefreshCw size={17} className={scanning ? 'is-spinning' : ''} />
          {scanning ? '正在扫描…' : '扫描本机 Skills'}
        </button>
      </section>

      {notice && (
        <div className="inline-notice" role="status">
          <CheckCircle2 size={17} />
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} aria-label="关闭通知"><X size={16} /></button>
        </div>
      )}

      <section className="archive-summary" aria-label="存档概况">
        <div className="summary-metric">
          <span className="summary-icon summary-icon--green"><Library size={20} /></span>
          <div><strong>35</strong><span>已存档 Skills</span></div>
        </div>
        <div className="summary-metric">
          <span className="summary-icon summary-icon--blue"><ShieldCheck size={20} /></span>
          <div><strong>31</strong><span>通过基础安检</span></div>
        </div>
        <div className="summary-metric">
          <span className="summary-icon summary-icon--amber"><Clock3 size={20} /></span>
          <div><strong>3</strong><span>发现可用更新</span></div>
        </div>
        <div className="summary-meta">
          <span>上次扫描</span>
          <strong>{lastScan}</strong>
        </div>
      </section>

      <section className="demo-section">
        <div className="section-heading">
          <div>
            <h2>扫描来源</h2>
            <p>按 Agent 分开识别，来源与权限边界全程保留。</p>
          </div>
          <button type="button" className="secondary-button"><Settings2 size={16} /> 扫描设置</button>
        </div>
        <div className="scan-source-grid">
          <ScanSourceCard name="Codex" description="本机 Skills 目录" count={12} detail="个有效 Skill" tone="#7058a8" scanning={scanning} />
          <ScanSourceCard name="WorkBuddy" description="工作伙伴能力目录" count={8} detail="个有效 Skill" tone="#297c68" scanning={scanning} />
          <ScanSourceCard name="QClaw" description="只读扫描与导出" count={15} detail="个有效 Skill · 已排除 97 项缓存" tone="#9a6b36" readonly scanning={scanning} />
        </div>
      </section>

      <div className="archive-lower-grid">
        <section className="demo-section recent-section">
          <div className="section-heading">
            <div>
              <h2>最近处理</h2>
              <p>每项存档都保留来源、版本与处理结果。</p>
            </div>
            <button type="button" className="text-button" onClick={onBrowse}>查看全部 <ChevronRight size={14} /></button>
          </div>
          <div className="recent-list">
            {[
              ['本地知识整理', 'Codex', '已验证', '更新版本 2.3.1', 'green'],
              ['教学插图生成', 'QClaw', '已存档', '只读导出', 'blue'],
              ['ManageBac 任务查看', 'Codex', '待审查', '检测到网络访问', 'amber'],
            ].map(([name, source, status, infoText, tone]) => (
              <button type="button" className="recent-row" key={name} onClick={onBrowse}>
                <span className={`recent-state recent-state--${tone}`}><FileArchive size={17} /></span>
                <span className="recent-main"><strong>{name}</strong><span>{source} · {infoText}</span></span>
                <span className={`compact-status compact-status--${tone}`}>{status}</span>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        </section>

        <aside className="archive-aside">
          <section className="storage-card">
            <div className="storage-heading">
              <span><HardDrive size={20} /></span>
              <div><h2>存档位置</h2><p>本机私有，不同步到云端</p></div>
            </div>
            <div className="path-box">
              <code>D:\\AI教育管家\\Skills存档</code>
              <button type="button" aria-label="打开存档文件夹"><FolderOpen size={17} /></button>
            </div>
            <div className="storage-meter"><span style={{ width: '38%' }} /></div>
            <div className="storage-foot"><span>已使用 486 MB</span><span>可用 8.4 GB</span></div>
            <button type="button" className="secondary-button secondary-button--full">更改存档位置</button>
          </section>

          <section className="boundary-card">
            <div className="boundary-title"><LockKeyhole size={17} /><strong>当前能力边界</strong></div>
            <p>Codex、WorkBuddy 支持本地安装闭环；QClaw 当前只读取并导出，不会写回原目录。</p>
            <span className="boundary-note">MCP 与插件管理暂未启用</span>
          </section>
        </aside>
      </div>
    </div>
  );
}

function SkillListCard({ skill, selected, onClick }: { skill: SkillRecord; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`skill-list-card ${selected ? 'is-selected' : ''}`} onClick={onClick}>
      <span className="skill-avatar" style={{ '--skill-accent': skill.accent } as React.CSSProperties}>{skill.initials}</span>
      <span className="skill-list-copy">
        <span className="skill-title-row"><strong>{skill.displayName}</strong><SourceMark label={skill.source} /></span>
        <span className="skill-description">{skill.description}</span>
        <span className="skill-card-meta">
          <span>{skill.category}</span><span>v{skill.version}</span><span className={skill.risk === '低风险' ? 'risk-low' : 'risk-review'}>{skill.risk}</span>
        </span>
      </span>
      <ChevronRight size={18} className="skill-card-chevron" />
    </button>
  );
}

function InstallDialog({ skill, onClose }: { skill: SkillRecord; onClose: () => void }) {
  const [host, setHost] = useState<HostId>(skill.compatible.includes('codex') ? 'codex' : 'workbuddy');
  const [phase, setPhase] = useState<'preview' | 'installing' | 'done'>('preview');

  function install() {
    setPhase('installing');
    window.setTimeout(() => setPhase('done'), 1250);
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="install-dialog" role="dialog" aria-modal="true" aria-labelledby="install-dialog-title">
        <button type="button" className="dialog-close" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        {phase === 'done' ? (
          <div className="install-success">
            <span className="success-orbit"><CheckCircle2 size={34} /></span>
            <p className="eyebrow">安装回执已保存</p>
            <h2 id="install-dialog-title">已安装到 {host === 'codex' ? 'Codex' : 'WorkBuddy'}</h2>
            <p>已创建原版本备份，并完成文件一致性检查。重启目标 Agent 后即可验证加载。</p>
            <div className="receipt-box">
              <span>安装版本 <strong>v{skill.version}</strong></span>
              <span>备份状态 <strong>已完成</strong></span>
              <span>下一步 <strong>重启并验证</strong></span>
            </div>
            <button type="button" className="primary-button primary-button--full" onClick={onClose}>完成</button>
          </div>
        ) : (
          <>
            <div className="dialog-heading">
              <span className="skill-avatar skill-avatar--large" style={{ '--skill-accent': skill.accent } as React.CSSProperties}>{skill.initials}</span>
              <div><p className="eyebrow">安装预览</p><h2 id="install-dialog-title">{skill.displayName}</h2><p>{skill.name} · v{skill.version}</p></div>
            </div>
            <div className="dialog-section">
              <label className="dialog-label">选择目标 Agent</label>
              <div className="host-options">
                {(['codex', 'workbuddy'] as HostId[]).map((item) => {
                  const enabled = skill.compatible.includes(item);
                  return (
                    <button type="button" className={`host-option ${host === item ? 'is-selected' : ''}`} key={item} onClick={() => enabled && setHost(item)} disabled={!enabled}>
                      <span className="host-radio">{host === item && enabled && <Check size={13} />}</span>
                      <span><strong>{item === 'codex' ? 'Codex' : 'WorkBuddy'}</strong><small>{enabled ? '已检测到，可安装' : '当前版本不兼容'}</small></span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="install-checks">
              <div><ShieldCheck size={17} /><span><strong>基础安检通过</strong><small>未发现可执行文件与越界路径</small></span></div>
              <div><FileArchive size={17} /><span><strong>自动备份原版本</strong><small>安装失败可恢复，不覆盖唯一副本</small></span></div>
              <div><RefreshCw size={17} /><span><strong>需要重启验证</strong><small>安装后不会自动启动或调用 Skill</small></span></div>
            </div>
            <div className="dialog-warning"><Info size={16} /><span>这是界面演示，不会修改本机 Agent 或文件。</span></div>
            <button type="button" className="primary-button primary-button--full" onClick={install} disabled={phase === 'installing'}>
              {phase === 'installing' ? <><RefreshCw size={17} className="is-spinning" /> 正在模拟安装…</> : <><Download size={17} /> 确认安装到 {host === 'codex' ? 'Codex' : 'WorkBuddy'}</>}
            </button>
          </>
        )}
      </section>
    </div>
  );
}

function SkillDetail({ skill, onInstall }: { skill: SkillRecord; onInstall: () => void }) {
  const [explainTags, setExplainTags] = useState(false);
  return (
    <aside className="skill-detail">
      <div className="detail-topline">
        <SourceMark label={skill.source} />
        <span className={`detail-status ${skill.status === '待审查' ? 'detail-status--review' : ''}`}><CheckCircle2 size={14} /> {skill.status}</span>
      </div>
      <div className="detail-identity">
        <span className="skill-avatar skill-avatar--large" style={{ '--skill-accent': skill.accent } as React.CSSProperties}>{skill.initials}</span>
        <div><h2>{skill.displayName}</h2><code>{skill.name}</code></div>
      </div>
      <p className="detail-description">{skill.description}</p>
      <StatusRail active={skill.status === '已验证' ? 4 : skill.status === '已存档' ? 2 : 1} />

      <div className="detail-section">
        <div className="detail-section-title"><span><Sparkles size={16} /> Agent 建议标签</span><button type="button" onClick={() => setExplainTags(!explainTags)}>{explainTags ? '收起' : '为什么这样分类？'}</button></div>
        <div className="tag-list">{skill.tags.map((tagName) => <span key={tagName}><Tag size={12} /> {tagName}</span>)}<button type="button">+ 编辑</button></div>
        {explainTags && <div className="tag-explanation">根据 SKILL.md 的用途描述、允许访问的文件类型与关键词生成。标签仅用于浏览，可由你修改或锁定。</div>}
      </div>

      <div className="detail-grid">
        <div><span>版本</span><strong>v{skill.version}</strong></div>
        <div><span>文件</span><strong>{skill.fileCount} 项</strong></div>
        <div><span>更新</span><strong>{skill.updatedAt}</strong></div>
        <div><span>风险</span><strong className={skill.risk === '低风险' ? 'risk-low' : 'risk-review'}>{skill.risk}</strong></div>
      </div>

      <div className="detail-section compatibility-section">
        <h3>可安装目标</h3>
        <div className="compat-row"><span><span className="agent-dot agent-dot--codex">C</span>Codex</span><strong>{skill.compatible.includes('codex') ? '可安装' : '不兼容'}</strong></div>
        <div className="compat-row"><span><span className="agent-dot agent-dot--work">W</span>WorkBuddy</span><strong>{skill.compatible.includes('workbuddy') ? '可安装' : '不兼容'}</strong></div>
        <div className="compat-row compat-row--muted"><span><span className="agent-dot agent-dot--qclaw">Q</span>QClaw</span><strong>仅作为来源</strong></div>
      </div>

      <details className="artifact-details">
        <summary>存档与完整性信息 <ChevronDown size={15} /></summary>
        <dl><div><dt>存档编号</dt><dd>SKL-202610-{skill.id.slice(0, 4).toUpperCase()}</dd></div><div><dt>内容摘要</dt><dd>9b8f…21ca</dd></div><div><dt>存档位置</dt><dd>本机 Skills存档</dd></div></dl>
      </details>

      <button type="button" className="primary-button primary-button--full" onClick={onInstall} disabled={skill.status === '待审查'}>
        <Download size={17} /> {skill.status === '待审查' ? '完成审查后可安装' : '安装到 Agent'}
      </button>
      <p className="install-footnote"><LockKeyhole size={13} /> 安装前会展示目标路径、变更内容与备份方案</p>
    </aside>
  );
}

function BrowseView() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const [selectedId, setSelectedId] = useState(skills[0].id);
  const [installing, setInstalling] = useState<SkillRecord | null>(null);

  const filteredSkills = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return skills.filter((skill) => {
      const matchCategory = category === '全部' || skill.category === category;
      const haystack = [skill.displayName, skill.name, skill.description, ...skill.tags].join(' ').toLowerCase();
      return matchCategory && (!normalized || haystack.includes(normalized));
    });
  }, [query, category]);

  const selected = skills.find((skill) => skill.id === selectedId) ?? filteredSkills[0] ?? skills[0];

  return (
    <div className="skills-view browse-view">
      <section className="browse-heading">
        <div><div className="eyebrow"><Library size={15} /> 本机 Skill 资产库</div><h1>浏览与安装 Skills</h1><p>按用途查找已存档能力，确认内容和风险后安装到目标 Agent。</p></div>
        <div className="browse-count"><strong>35</strong><span>个可浏览 Skill</span></div>
      </section>
      <div className="browse-toolbar">
        <label className="search-box"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、用途或标签" /><kbd>Ctrl K</kbd></label>
        <button type="button" className="secondary-button"><CircleGauge size={16} /> 兼容性筛选</button>
      </div>
      <div className="category-tabs" role="tablist" aria-label="Skill 分类">
        {categories.map((item) => <button type="button" role="tab" aria-selected={category === item} className={category === item ? 'is-active' : ''} onClick={() => setCategory(item)} key={item}>{item}</button>)}
      </div>
      <div className="browse-layout">
        <section className="skill-list" aria-label="Skill 列表">
          <div className="list-meta"><span>找到 {filteredSkills.length} 个结果</span><button type="button">最近更新 <ChevronDown size={14} /></button></div>
          {filteredSkills.length ? filteredSkills.map((skill) => <SkillListCard key={skill.id} skill={skill} selected={selected.id === skill.id} onClick={() => setSelectedId(skill.id)} />) : <div className="empty-state"><Search size={28} /><h3>没有找到匹配的 Skill</h3><p>换一个关键词或清除分类筛选。</p></div>}
        </section>
        <SkillDetail skill={selected} onInstall={() => setInstalling(selected)} />
      </div>
      {installing && <InstallDialog skill={installing} onClose={() => setInstalling(null)} />}
    </div>
  );
}

export default function SkillManagementDemo() {
  const [tab, setTab] = useState<DemoTab>('archive');

  return (
    <div className="skills-demo-shell">
      <header className="demo-app-header">
        <div className="demo-brand"><span className="demo-brand-mark"><Sparkles size={20} /></span><div><strong>AI 教育管家</strong><span>Windows 管理中心</span></div></div>
        <div className="demo-header-status"><span className="status-light" /> 本机服务正常</div>
        <button type="button" className="demo-user" aria-label="账户菜单">教师</button>
      </header>
      <main className="demo-main">
        <nav className="settings-context" aria-label="Agent 设置路径">
          <div><span className="context-icon"><Bot size={20} /></span><div><span>Agent 管理</span><strong>设置与能力</strong></div></div>
          <span className="context-separator">/</span>
          <strong>Skills 管理</strong>
        </nav>
        <div className="settings-tabs" role="tablist" aria-label="Agent 设置页面">
          {['工具授权', '数据授权', '连接管理', '云端协作'].map((item) => <button type="button" role="tab" aria-selected="false" key={item}>{item}</button>)}
          <button type="button" role="tab" aria-selected="true" className="is-active"><Archive size={16} /> Skills 管理 <span className="new-badge">NEW</span></button>
        </div>
        <section className="skills-panel">
          <div className="skills-subtabs" role="tablist" aria-label="Skills 管理子页面">
            <button type="button" role="tab" aria-selected={tab === 'archive'} className={tab === 'archive' ? 'is-active' : ''} onClick={() => setTab('archive')}><FileArchive size={17} /> Skill 存档管理</button>
            <button type="button" role="tab" aria-selected={tab === 'browse'} className={tab === 'browse' ? 'is-active' : ''} onClick={() => setTab('browse')}><Library size={17} /> Skill 浏览</button>
          </div>
          {tab === 'archive' ? <ArchiveView onBrowse={() => setTab('browse')} /> : <BrowseView />}
        </section>
      </main>
      <div className="demo-watermark"><Info size={13} /> 可交互界面 Demo · 不执行真实扫描与安装</div>
    </div>
  );
}
