export const domains = [
  { id: 'education', label: '教育', code: 'education-v1', icon: '教', detail: '学生、课程、成长证据与报告', status: '完整演示' },
  { id: 'project', label: '项目', code: 'business-project-v1', icon: '项', detail: '任务、会议、决策与交付物', status: '完整演示' },
  { id: 'health', label: '健康', code: 'health-records-v1', icon: '健', detail: '检查资料与健康时间线', status: '基础演示' },
  { id: 'finance', label: '财务', code: 'finance-records-v1', icon: '财', detail: '合同、票据与收支记录', status: '基础演示' },
];

export const profiles = [
  { id: 'profile-linxiao', initials: 'LX', name: '林晓', type: '个人档案', scope: '教育 · 项目', assets: 18, updated: '12 分钟前', note: 'Year 7 · 校园 AI 项目成员' },
  { id: 'profile-zhou', initials: 'ZY', name: '周岩', type: '专家档案', scope: '项目 · 业务', assets: 11, updated: '昨天', note: '课程设计 · 项目评审' },
  { id: 'profile-studio', initials: 'QX', name: '群星创新组', type: '组织档案', scope: '业务 · 项目', assets: 27, updated: '2 天前', note: '3 个活跃项目 · 5 名成员' },
];

export const sources = [
  { id: 'SRC-021', name: '英语阶段学习报告.pdf', type: 'PDF', owner: '林晓', domain: '教育', state: '已确认', time: '今天 16:42', hash: '8ac4…91f2', sensitivity: '一般' },
  { id: 'SRC-022', name: '校园AI项目方案.docx', type: 'DOCX', owner: '林晓', domain: '项目', state: '已消化', time: '今天 15:18', hash: '32b1…2ab7', sensitivity: '内部' },
  { id: 'SRC-023', name: '项目周会纪要.md', type: 'MD', owner: '群星创新组', domain: '项目', state: '待复核', time: '今天 14:05', hash: 'c6d2…fa34', sensitivity: '内部' },
  { id: 'SRC-024', name: '视力检查记录.png', type: 'PNG', owner: '林晓', domain: '健康', state: '已隔离', time: '昨天', hash: 'fe81…447c', sensitivity: '敏感' },
  { id: 'SRC-025', name: '演示费用票据.pdf', type: 'PDF', owner: '群星创新组', domain: '财务', state: '已隔离', time: '昨天', hash: '502a…de18', sensitivity: '敏感' },
  { id: 'SRC-026', name: 'Codex项目讨论.jsonl', type: 'JSONL', owner: '林晓', domain: '项目', state: '已消化', time: '2 天前', hash: 'ab11…84dc', sensitivity: '内部' },
];

export const projectRows = [
  { id: 'PRJ-008', name: '校园 AI 知识库', owner: '林晓', progress: 72, tasks: '8 / 11', evidence: 14, next: '完成试用反馈整理' },
  { id: 'PRJ-012', name: '英语表达提升计划', owner: '林晓', progress: 58, tasks: '7 / 12', evidence: 9, next: '提交阶段练习' },
  { id: 'PRJ-016', name: '专家案例标准化', owner: '周岩', progress: 35, tasks: '3 / 9', evidence: 6, next: '确认评价量规' },
];

export const initialTasks = [
  { id: 'TSK-104', title: '整理校园 AI 试用反馈', project: '校园 AI 知识库', owner: '林晓', due: '今天', status: 'doing', proof: '会议纪要 + 汇总表' },
  { id: 'TSK-105', title: '完成英语场景表达练习', project: '英语表达提升计划', owner: '林晓', due: '明天', status: 'todo', proof: '练习结果' },
  { id: 'TSK-098', title: '确认项目评价量规', project: '专家案例标准化', owner: '周岩', due: '9月13日', status: 'review', proof: '人工确认记录' },
  { id: 'TSK-091', title: '归档第一轮访谈', project: '校园 AI 知识库', owner: '林晓', due: '已完成', status: 'done', proof: '4 份访谈记录' },
];

export const activity = [
  { time: '16:42', title: '学习报告被确认为正式证据', meta: '林晓 · education-v1 · SRC-021' },
  { time: '15:24', title: '项目方案生成 3 条候选知识', meta: '校园 AI 知识库 · 等待人工复核' },
  { time: '14:18', title: 'Codex 上下文授权已到期', meta: '仅撤销访问，不删除历史资料' },
  { time: '昨天', title: '健康资料进入独立敏感分区', meta: '默认不提供给任何 Agent' },
];

export const agents = [
  { name: 'Codex', mode: '命令钩子', state: '已连接', detail: '上次采集：2 天前' },
  { name: 'QClaw', mode: '本地插件', state: '可连接', detail: '未授予档案访问权' },
  { name: 'WorkBuddy', mode: '命令钩子', state: '可连接', detail: '等待初始化' },
  { name: 'Claude Code', mode: '命令钩子', state: '可连接', detail: '等待初始化' },
  { name: 'OpenClaw', mode: '本地插件', state: '可连接', detail: '等待初始化' },
  { name: 'Hermes', mode: '本地 Agent', state: '可连接', detail: '等待初始化' },
];

export const nodes = [
  { name: '本机 · 工作台', id: 'NODE-A13', state: '在线', sync: '刚刚', items: 54, primary: true },
  { name: '林晓 · 学生终端', id: 'NODE-T07', state: '在线', sync: '3 分钟前', items: 12 },
  { name: '周岩 · 评审终端', id: 'NODE-R02', state: '待同步', sync: '昨天 18:20', items: 7 },
];

export const pageCopy = {
  overview: ['总览', '本地资料、知识与任务的当前状态'],
  profiles: ['用户档案', '统一身份，不同领域按授权使用'],
  inbox: ['采集收件箱', '处理来自文件、网页和 Agent 的新资料'],
  agents: ['Agent 知识', '控制不同 Agent 可以读取和写入的上下文'],
  projects: ['项目知识', '把资料、任务、决策和成果沉淀在项目中'],
  assets: ['文件资产', '保留原件、来源、哈希和完整处理记录'],
  tasks: ['任务中心', '从目标到证据回执的闭环'],
  collaboration: ['知识协作', '按对象和权限同步，不复制整个资料库'],
  extensions: ['领域扩展', '用模板解释同一套核心知识对象'],
  studio: ['专家数据工作室', '把已完成工作转为可评价、可授权的数据资产'],
};
