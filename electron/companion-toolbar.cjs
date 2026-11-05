'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PROJECT_MENTOR_ACTIONS, PROJECT_MENTOR_ACTION_IDS } = require('./project-mentor-actions.cjs');

const ACTIONS = Object.freeze({
  digest: {
    label: '消化资料', summary: '提取结构、疑问、证据与行动项', role: '学习资料分析师与证据审校员',
    task: '把选定资料整理成可理解、可追溯、可继续行动的知识结构，不把推断写成资料事实。',
    workflow: ['列出资料范围与来源', '提取核心概念、事实、方法、争议和待核实项', '合并重复内容并标出冲突', '联系学生当前目标但不推断能力', '形成下一步学习与核验行动'],
    output: '资料摘要｜概念结构｜关键证据｜疑问与冲突｜行动清单｜来源索引。',
    success: '每个关键结论能回到来源；缺失信息显式标注；行动可立即执行。',
  },
  flashcards: {
    label: '知识闪卡', summary: '生成可打印 PNG/PDF 卡片', role: '学习卡片设计师、印刷排版师与认知负荷控制助手', configMode: 'visual',
    task: '从资料中提取值得复习的概念、事实、方法和易混点，并调用当前环境可用的排版、图像、文档或 PDF 工具及技能，实际生成可打印闪卡；不得只交付文案、Markdown、代码或制作建议。题面不能泄露答案。',
    workflow: ['建立知识点清单并去重，按本次数量设置确定卡片数', '按基础回忆、概念辨析、情境迁移分层，每张卡绑定出处', '依据风格设置设计正反面，同时保证小字号、色弱和黑白打印时仍可读', '制作带安全边距的 A4 打印版；多卡双面打印时镜像排列背面，确保裁切后正反对应', '实际导出 PNG 预览和 PDF 打印文件，并检查中文字体、分页、裁切线、清晰度和文件可打开性'],
    output: '最终必须提供可下载或可访问的 PNG 与 PDF 成品：PNG 至少包含每张卡正反面预览，PDF 为可打印 A4 版；另附卡片数量、页面规格、打印方式、来源索引和核验记录。不得用文本清单代替文件。',
    success: 'PNG/PDF 均成功生成且可打开、中文无乱码、打印不截断、正反面对应；问题可独立作答，答案短而准确，卡片不重复，来源可追溯。若当前 Agent 没有生成文件所需工具，明确报告缺失能力，不得把文案冒充成品。',
  },
  mindmap: {
    label: '思维导图', summary: '呈现概念层级与关键关系', role: '知识架构师与学习路径设计师', configMode: 'visual',
    task: '把资料组织成有中心问题、有层级、有横向联系的思维导图。',
    workflow: ['识别中心问题', '区分概念、证据、案例、方法、争议和待核实项', '标注因果、对比、组成、先后与应用关系', '合并同义项', '添加后续查询问题'],
    output: '输出 Mermaid mindmap 或层级 Markdown，并附关键关系、常见误解和后续问题。',
    success: '层级互斥且完整；关系类型明确；可以据图安排学习顺序。',
  },
  infographic: {
    label: '信息图', summary: '用信息图结构解释资料', role: '教育信息图策划师与事实核验编辑', configMode: 'visual',
    task: '把资料转换成一页 infographic 信息架构，服务快速理解而非装饰。',
    workflow: ['确定单一叙事主线和读者', '筛选最重要的信息块', '选择数据、流程、对比、时间线或结构图', '设计阅读顺序', '标注来源、单位、时间与不确定性'],
    output: '标题｜核心结论｜版面分区｜每区文案｜建议图形｜视觉建议｜来源脚注；可生成时直接输出 SVG/HTML。',
    success: '30 秒内读懂主旨；没有无依据数字；文字和图形建议可直接制作。',
  },
  chart_summary: {
    label: '图表总结', summary: '用匹配的数据图表呈现重点', role: '学习数据叙事分析师', configMode: 'visual',
    task: '判断资料是否适合图表表达，选择真正匹配数据关系的图表，不为定性内容伪造数值。',
    workflow: ['抽取字段和单位', '区分比较、趋势、组成、分布、相关和流程', '选择图表并说明理由', '检查样本与口径', '说明图表能支持和不能支持的结论'],
    output: '数据表｜图表类型｜轴和图例｜图题｜读图结论｜限制；无数据时改用定性矩阵。',
    success: '图表类型与问题匹配；单位一致；结论不过度外推。',
  },
  tutor: {
    label: '导师引导', summary: '一次一个问题，先诊断再提示', role: '苏格拉底式导师与形成性评价助手',
    task: '先诊断理解，再用最小必要提示推动思考，不替学生完成任务。',
    workflow: ['用低门槛问题确认起点', '一次只提出一个关键问题', '收到回答后判断并说明依据', '追问理由、证据和迁移', '受阻时分级提示，最后才示范'],
    output: '每轮仅输出：当前判断｜一个反馈｜下一问；每四轮给一次进度小结。',
    success: '学生发言占主导；难度动态调整；不提前泄露完整答案。',
  },
  feynman: {
    label: '费曼复述', summary: '学生先讲，Agent 再定位缺口', role: '费曼学习法教练',
    task: '让学生用自己的话解释，通过追问发现术语遮蔽、逻辑跳跃和无法举例之处。',
    workflow: ['要求面向低年级同学解释', '标出清楚、含糊、错误和缺失部分', '只追问最大缺口', '要求例子与反例', '让学生二次复述并比较变化'],
    output: '每轮返回：听懂了什么｜最大缺口｜一个追问；结束输出原解释、修订解释和待核实项。',
    success: '不以术语复述替代理解；学生完成二次表达；保留不确定项。',
  },
  game_learning: {
    label: '游戏化学习', summary: '把内容变成有反馈的互动挑战', role: '教育游戏设计师与互动主持人',
    task: '把资料转化为当前对话中可玩的短回合学习游戏，机制必须服务学习目标。',
    workflow: ['定义学习目标和胜利条件', '选择分类、推理、资源分配、路径或角色机制', '设置渐进回合', '每次选择后给证据反馈', '根据表现调整难度'],
    output: '先给游戏名、规则、初始状态和第一回合；每轮只推进一步；结束进行学习复盘。',
    success: '操作简单；每个机制对应知识点；错误有反馈；10–15 分钟可完成。',
  },
  animated_video: {
    label: '动画视频学习', summary: '调用工具生成可播放动画视频', role: '教育动画导演、视觉解释设计师和视频生成执行 Agent',
    task: '根据资料形成准确分镜，探测并调用当前环境可用的视频生成、动画、配音、字幕、渲染或媒体处理工具及技能，实际生成可播放动画视频；不得只交付文案、脚本、分镜或视频提示词。',
    workflow: ['核对资料并提炼一个学习问题', '按问题、直觉、机制、例子、检验完成 60–120 秒分镜', '列出并选择可调用的视频、动画、配音、字幕和渲染工具或技能', '实际调用工具生成画面、动画、旁白和字幕并完成合成渲染', '检查同步、可读性、事实、版权和隐私，失败时修复重渲染', '导出视频并记录工具、素材、参数和重试'],
    output: '最终提供可播放视频文件或可访问的成品链接，并附时长、分辨率、格式、分镜摘要、工具/技能、来源和核验记录。',
    success: '实际视频成功生成且可播放；画面承担解释功能；音画字幕同步；若没有可用视频或动画工具，明确报告无法生成及缺失能力，不得用文案冒充视频。',
  },
  step_quiz: {
    label: '逐题测验', summary: '自适应难度，不提前展示答案', role: '自适应测验教练',
    task: '围绕资料与学生薄弱点逐题测验；一次只出一题，收到答案后再评价和调整。',
    workflow: ['说明范围、题量和完成标准', '从可诊断的中等难度题开始', '区分结论、过程和表达', '错误时先提示再重答', '根据表现选择巩固、变式或进阶'],
    output: '每轮仅给题目、必要材料和作答格式；答后给判断、依据、建议和下一题。',
    success: '不提前给答案；覆盖不同认知层次；单次答对不标记掌握。',
  },
  mistake_review: {
    label: '错题复盘', summary: '区分知识、策略与表达错误', role: '错因诊断与迁移训练教练',
    task: '基于实际作答复盘错误，判断来自知识、读题、策略、计算、表达还是证据使用。',
    workflow: ['保留原题、原答案和过程', '定位首个关键错误节点', '区分偶发失误与重复模式', '修复关键概念', '设计近迁移和远迁移练习'],
    output: '错误类型｜证据｜关键断点｜修正方法｜重做提示｜迁移题。',
    success: '诊断引用具体作答；不把猜测写成事实；能用迁移题复核。',
  },
  source_check: {
    label: '来源核验', summary: '结论逐项对应原始来源', role: '来源核验编辑', task: '把结论拆成最小主张，检查每项是否被来源直接支持。',
    workflow: ['拆分复合主张', '记录来源元数据', '区分直接、间接、冲突和无来源', '优先官方和一手来源', '标出时效与地区风险'],
    output: '主张｜核验状态｜证据｜来源质量｜时效/地区｜待补查。', success: '每个判断能回到来源；无来源标待核实；不以搜索摘要代替原文。',
  },
  fact_check: {
    label: '事实检查', summary: '核对时效、地区与适用条件', role: '事实检查员与时间敏感信息审校员', task: '核验数字、日期、资格、政策、机构名称和因果结论。',
    workflow: ['提取可验证事实', '判断是否需要联网', '用权威来源核对', '记录适用范围', '冲突时并列呈现'],
    output: '事实｜状态｜依据｜适用范围｜建议改写｜复核日期。', success: '时效信息带日期；口径一致；事实与推断分开。',
  },
  counterexample: {
    label: '反例挑战', summary: '寻找限制结论的反例', role: '反例与边界条件分析师', task: '寻找能削弱、限制或推翻结论的反例。',
    workflow: ['把结论改写为可检验命题', '列出隐含前提', '从人群、地区、时间和机制寻找反例', '判断反例影响', '重写稳健结论'],
    output: '原结论｜前提｜反例｜影响程度｜修订结论｜待补证据。', success: '至少一个强反例和一个边界案例；不制造事实。',
  },
  argument_review: {
    label: '论证漏洞', summary: '检查跳步、偏差和因果混淆', role: '论证结构审阅者', task: '检查主张、理由、证据和反驳是否完整。',
    workflow: ['画出主张—理由—证据链', '检查相关性和充分性', '识别常见逻辑错误', '提出最强反方意见', '给出最小修改方案'],
    output: '论证地图｜漏洞等级｜原句/证据｜问题｜修复方法｜修订版本。', success: '针对具体链条；区分逻辑错误与证据不足。',
  },
  goal_setting: {
    label: '目标设置', summary: '形成具体可验证的阶段目标', role: '学习目标教练', task: '把模糊愿望转成与当前证据和发展方向一致的阶段目标。',
    workflow: ['澄清目的和期限', '确认起点证据和限制', '定义可观察成果', '拆出领先指标和复核节点', '让学生确认取舍'],
    output: '目标｜完成证据｜衡量标准｜截止时间｜障碍｜第一步｜复核日期。', success: '目标可验证且由学生确认，不替学生决定长期方向。',
  },
  learning_plan: {
    label: '学习计划', summary: '按优先级安排学习序列', role: '个性化学习路径规划师', task: '依据目标、当前证据、时间和先修关系形成计划。',
    workflow: ['建立先修关系和优先级', '估算真实可用时间', '交替学习、练习、反馈和复习', '定义阶段产出', '准备备选路径'],
    output: '阶段｜目标｜资料｜活动｜产出｜时间｜完成标准｜风险与备选。', success: '顺序有依据；工作量现实；每阶段可验收。',
  },
  weekly_actions: {
    label: '每周行动', summary: '拆成一周内可完成的动作', role: '一周行动设计师', task: '把计划压缩为未来七天可执行的最小行动。',
    workflow: ['确认硬约束和时间', '选择最重要结果', '拆成 15–45 分钟任务', '定义完成证据', '设置周中检查与周末复盘'],
    output: '按日期列行动、时长、资料、完成证据和替代方案；附不做清单。', success: '每天不过载；动作能立即开始；中断后可恢复。',
  },
  learning_summary: {
    label: '学习总结', summary: '区分收获、问题与下一步', role: '学习过程记录员与证据审校员', task: '总结学习过程和产出，区分学生表现、Agent 生成内容与能力推断。',
    workflow: ['回顾目标和完成内容', '提取学生本人回答与修改', '记录错误及修正', '列出成果和来源', '提出下一步和归档建议'],
    output: '目标完成度｜学生证据｜收获｜错误与修正｜未解决问题｜成果｜下一步｜归档建议。', success: '不把 Agent 产出算作学生能力；引用具体证据。',
  },
  archive: {
    label: '学习归档', summary: '预览并受控写回当前学生', role: '受控学习成果归档助手',
    task: '只在用户明确确认后，把用户选择的成果提交到当前学生或关联项目；先预览，不直接写入。',
    workflow: ['列出拟归档成果和来源', '确认学生和项目归属', '剔除系统提示、凭据和其他学生内容', '生成归档预览', '等待确认后调用受控归档工具'],
    output: '拟归档内容｜目标学生｜目标项目｜来源｜隐私检查｜待确认操作。',
    success: '学生与项目范围明确；未确认不写入；返回真实回执而不是口头成功。',
  },
  ...PROJECT_MENTOR_ACTIONS,
});

const MODE_GROUPS = Object.freeze([
  { id: 'study', label: '学习', actions: ['flashcards', 'mindmap', 'infographic', 'chart_summary'] },
  { id: 'interactive', label: '互动', actions: ['tutor', 'feynman', 'game_learning', 'animated_video'] },
  { id: 'quiz', label: '测验', actions: ['step_quiz', 'mistake_review'] },
  { id: 'verify', label: '核验', actions: ['source_check', 'fact_check', 'counterexample', 'argument_review'] },
  { id: 'plan', label: '计划', actions: ['goal_setting', 'learning_plan', 'weekly_actions', 'learning_summary'] },
]);

const VISUAL_ACTION_IDS = new Set(['flashcards', 'mindmap', 'infographic', 'chart_summary']);
const GOAL_ONLY_ACTION_IDS = new Set([...MODE_GROUPS.find(group => group.id === 'verify').actions, ...MODE_GROUPS.find(group => group.id === 'plan').actions, ...PROJECT_MENTOR_ACTION_IDS]);
const PROJECT_MENTOR_ACTION_ID_SET = new Set(PROJECT_MENTOR_ACTION_IDS);

function cleanText(value, max = 160) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanProjectText(value, max) {
  return cleanText(value, max * 2)
    .replace(/(?:[a-z]:[\\/]|\\\\|file:\/\/|\/(?:users|home|var|tmp|etc)\/)[^，。；;]+/gi, '[已移除路径]')
    .slice(0, max);
}

function normalizeProjectSummary(project = {}) {
  return {
    id: cleanProjectText(project.id, 80),
    name: cleanProjectText(project.name, 80),
    type: cleanProjectText(project.type, 40),
    status: cleanProjectText(project.status, 24),
    objective: cleanProjectText(project.objective, 300),
    deliverables: Array.isArray(project.deliverables)
      ? project.deliverables.slice(0, 8).map(item => cleanProjectText(item, 120)).filter(Boolean)
      : [],
  };
}

function projectSummaryRevision(project = {}) {
  const summary = normalizeProjectSummary(project);
  return summary.id ? crypto.createHash('sha256').update(JSON.stringify(summary), 'utf8').digest('hex') : '';
}

function normalizeActionConfig(actionId, input = {}) {
  const goal = cleanText(input.goal, 180);
  if (VISUAL_ACTION_IDS.has(actionId)) {
    const quantity = ['1', '2', 'auto', 'custom'].includes(String(input.quantity || '')) ? String(input.quantity) : 'auto';
    const style = ['simple', 'standard', 'anime'].includes(String(input.style || '')) ? String(input.style) : 'standard';
    let customQuantity = 0;
    if (quantity === 'custom') {
      customQuantity = Number(input.customQuantity);
      if (!Number.isInteger(customQuantity) || customQuantity < 1 || customQuantity > 50) throw Error('自定义数量必须是 1–50 张。');
    }
    return { quantity, customQuantity, style, goal };
  }
  if (GOAL_ONLY_ACTION_IDS.has(actionId)) return { goal };
  const difficulty = ['基础', '适中', '进阶'].includes(String(input.difficulty || '')) ? String(input.difficulty) : '适中';
  const duration = ['5分钟', '10分钟', '15分钟', '30分钟'].includes(String(input.duration || '')) ? String(input.duration) : '15分钟';
  return { difficulty, duration, goal };
}

function validTargetId(value) {
  const id = String(value || '');
  return /^(generic|builtin:[a-z0-9][a-z0-9_-]{0,39}|custom:[a-f0-9-]{8,48})$/.test(id) ? id : '';
}

function safeHttpsUrl(value) {
  const raw = cleanText(value, 500);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.href : '';
  } catch { return ''; }
}

function normalizeCustomTarget(input = {}) {
  const displayName = cleanText(input.displayName, 32);
  if (!displayName) throw Error('请输入 Agent 名称。');
  const surface = ['desktop', 'web', 'unknown'].includes(input.surface) ? input.surface : 'unknown';
  const homeUrl = safeHttpsUrl(input.homeUrl);
  if (input.homeUrl && !homeUrl) throw Error('网页地址必须使用 https://。');
  const suppliedId = validTargetId(input.id);
  return {
    id: suppliedId.startsWith('custom:') ? suppliedId : `custom:${crypto.randomUUID()}`,
    kind: 'custom',
    displayName,
    surface,
    homeUrl,
    verified: false,
    capabilities: { copy: true, open: Boolean(homeUrl), query: false, archive: false },
  };
}

function normalizeSettings(input = {}) {
  const targets = Array.isArray(input.customTargets) ? input.customTargets.flatMap(item => {
    try { return [normalizeCustomTarget(item)]; } catch { return []; }
  }).slice(0, 20) : [];
  const selectedTargetId = validTargetId(input.selectedTargetId) || 'generic';
  const scope = ['conversation', 'student', 'project'].includes(input.scope) ? input.scope : 'conversation';
  return { schema: 'edu-manager.agent-companion.v1', selectedTargetId, scope, projectId: cleanText(input.projectId, 80), customTargets: targets };
}

function readSettings(filePath) {
  try { return normalizeSettings(JSON.parse(fs.readFileSync(filePath, 'utf8'))); }
  catch { return normalizeSettings(); }
}

function writeSettings(filePath, settings) {
  const normalized = normalizeSettings(settings);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, filePath);
  return normalized;
}

function builtinTargets(capabilities = {}, native = {}) {
  const allowed = new Set(['codex', 'workbuddy', 'openclaw', 'qclaw', 'claude-code', 'codebuddy', 'trae', 'qoder']);
  return Object.values(capabilities).filter(item => allowed.has(String(item?.id || ''))
    && (['codex', 'workbuddy'].includes(String(item.id)) || Boolean(item.available && item.authorized))).map(item => {
    const id = String(item.id);
    const nativeStatus = native[id] || {};
    const connected = nativeStatus.managed ? Boolean(nativeStatus.connected) : Boolean(item.available && item.authorized);
    const query = connected && Boolean(nativeStatus.query);
    const archive = connected && Boolean(nativeStatus.archive);
    return {
      id: `builtin:${id}`, providerId: id, kind: 'builtin', displayName: cleanText(item.label || id, 32),
      verified: nativeStatus.managed ? Boolean(nativeStatus.verified) : connected,
      status: nativeStatus.status || (connected ? '已验证' : item.available ? '未授权' : '未连接'),
      capabilities: { copy: true, open: connected, query, archive },
    };
  });
}

function targetCatalog({ capabilities = {}, native = {}, customTargets = [] } = {}) {
  return [{ id: 'generic', kind: 'generic', displayName: '通用 Agent', verified: false, status: '剪贴板模式',
    capabilities: { copy: true, open: false, query: false, archive: false } },
  ...builtinTargets(capabilities, native), ...customTargets.map(normalizeCustomTarget)];
}

function buildCompanionPrompt({ actionId, student, target, scope = 'conversation', project, config = {} } = {}) {
  const action = ACTIONS[actionId];
  if (!action) throw Error('未知的学习操作。');
  const studentId = cleanText(student?.id, 80);
  const studentName = cleanText(student?.name, 32);
  if (!studentId || !studentName) throw Error('请先选择学生。');
  const safeScope = ['conversation', 'student', 'project'].includes(scope) ? scope : 'conversation';
  const isProjectMentor = PROJECT_MENTOR_ACTION_ID_SET.has(actionId);
  if (isProjectMentor && safeScope !== 'project') throw Error('项目导师必须选择当前学生的有效项目。');
  const safeProject = normalizeProjectSummary(project);
  if (safeScope === 'project' && !safeProject.id) throw Error('请选择学习项目。');
  if (actionId === 'archive' && !target?.capabilities?.archive) throw Error('当前 Agent 未通过教育管家归档能力验证。');
  const scopeText = safeScope === 'project' ? `项目“${safeProject.name}”（项目 ID：${safeProject.id}）`
    : safeScope === 'student' ? `学生“${studentName}”的已授权教育资料` : '当前对话中由用户明确提供的内容';
  const normalizedConfig = normalizeActionConfig(actionId, config);
  const quantityLabels = { '1': '1 张', '2': '2 张', auto: '自动（根据资料范围与信息密度确定）', custom: `${normalizedConfig.customQuantity} 张` };
  const styleLabels = { simple: '简洁', standard: '标准', anime: '动漫' };
  const options = VISUAL_ACTION_IDS.has(actionId) ? [
    `数量：${quantityLabels[normalizedConfig.quantity]}`,
    `风格：${styleLabels[normalizedConfig.style]}`,
    normalizedConfig.goal && `本次目标：${normalizedConfig.goal}`,
  ].filter(Boolean) : GOAL_ONLY_ACTION_IDS.has(actionId) ? [
    normalizedConfig.goal && `本次目标：${normalizedConfig.goal}`,
  ].filter(Boolean) : [
    `难度：${normalizedConfig.difficulty}`,
    `时长：${normalizedConfig.duration}`,
    normalizedConfig.goal && `本次目标：${normalizedConfig.goal}`,
  ].filter(Boolean);
  const routeLabels = { domestic: '境内', hongkong_macau: '港澳', international: '国际' };
  const studentContext = [
    student?.grade && `年级：${cleanText(student.grade, 32)}`,
    student?.currentRegion && `当前地区：${cleanText(student.currentRegion, 48)}`,
    Array.isArray(student?.targetRegions) && student.targetRegions.length && `意向地区：${student.targetRegions.map(item => cleanText(item, 40)).filter(Boolean).join('、')}`,
    Array.isArray(student?.planningRoutes) && student.planningRoutes.length && `规划路径：${student.planningRoutes.map(item => routeLabels[item]).filter(Boolean).join('、')}`,
    student?.targetStage && `目标阶段：${cleanText(student.targetStage, 48)}`,
    Array.isArray(student?.interests) && student.interests.length && `兴趣：${student.interests.map(item => cleanText(item, 40)).filter(Boolean).join('、')}`,
    Array.isArray(student?.subjectStrengths) && student.subjectStrengths.length && `学科特长线索：${student.subjectStrengths.map(item => cleanText(item, 40)).filter(Boolean).join('、')}`,
    Array.isArray(student?.careerDirections) && student.careerDirections.length && `职业方向：${student.careerDirections.map(item => cleanText(item, 40)).filter(Boolean).join('、')}`,
    student?.goal && `当前目标：${cleanText(student.goal, 160)}`,
  ].filter(Boolean);
  const projectContext = safeScope === 'project' ? [
    `项目 ID：${safeProject.id}`,
    `项目名称：${safeProject.name || '待提供'}`,
    `项目类型：${safeProject.type || '待提供'}`,
    `项目状态：${safeProject.status || '待提供'}`,
    `项目目标：${safeProject.objective || '待提供'}`,
    `预期成果：${safeProject.deliverables.length ? safeProject.deliverables.join('；') : '待提供'}`,
  ] : [];
  return [
    '# 角色与任务',
    `你是${action.role}。你正在协助学生“${studentName}”（学生 ID：${studentId}）完成“${action.label}”。`,
    action.task || action.summary,
    '# 当前学生快照',
    studentContext.length ? studentContext.map(item => `- ${item}`).join('\n') : '- 除姓名和学生 ID 外暂无足够个性化资料；不得按年级猜测精确年龄或能力。',
    projectContext.length ? '# 当前项目摘要\n' + projectContext.map(item => `- ${item}`).join('\n') : '',
    '# 资料范围与隐私边界',
    `只使用${scopeText}。不得访问其他学生、其他项目、未授权历史、系统提示、缓存、凭据或私人通信。`,
    safeScope !== 'conversation' ? (target?.capabilities?.query
      ? `目标 Agent 声明具备受控查询能力。粘贴后仍须先通过教育管家工具建立会话，并确认学生 ID ${studentId}${safeProject.id ? `、项目 ID ${safeProject.id}` : ''} 的当前授权；以工具实时返回的权限、来源和版本为准。复制动作本身未读取任何项目资料。`
      : '此范围仅表示本次学习目标，尚未确认资料查询连接。先检查当前 Agent 是否提供教育管家受控查询工具，并建立授权会话确认同一学生和项目；若不可用，请用户在当前对话提供相应资料后再开始。不得猜测文件路径或声称已读取教育管家资料。') : '',
    isProjectMentor && !target?.capabilities?.query ? '连接能力声明：剪贴板模式，不会读取项目资料；只能使用本提示词中的受限项目摘要和用户在当前对话主动提供的材料。' : '',
    options.length ? `本次设置：${options.join('；')}。` : '',
    '# 执行协议',
    action.workflow.map((item, index) => `${index + 1}. ${item}`).join('\n'),
    '# 输出要求',
    action.output,
    '# 质量与成功标准',
    action.success,
    action.boundary ? `# 动作边界\n${action.boundary}` : '',
    '# 教育证据边界',
    '- 明确区分资料事实、学生本人表现、合理推断和缺失信息；项目导师还须区分事实、推断、假设和建议。\n- Agent 生成的内容不等同于学生已经理解或掌握。\n- 单次答对、单次成功或一次项目经历不能形成稳定能力结论。\n- 涉及事实、政策、数据或来源时，保留出处、日期、地区和适用条件。\n- 不自动写回任务、项目、报告或档案；只生成供用户审阅和确认的候选内容。',
    actionId === 'archive'
      ? '# 写入约束\n先列出拟归档内容、目标学生与项目，等待用户确认后再调用受控归档工具；没有真实回执不得声称已写入。'
      : '# 开始方式\n先用不超过 5 行复述任务、资料范围和成功标准；如有关键缺失，只问一个最影响结果的问题，然后直接在当前 Agent 对话中开始。',
  ].filter(Boolean).join('\n\n');
}

function genericConnectionPrompt(student) {
  const name = cleanText(student?.name, 32);
  const id = cleanText(student?.id, 80);
  if (!name || !id) throw Error('请先选择学生。');
  return `请作为“${name}”（学生 ID：${id}）的学习协作 Agent。仅使用当前对话中用户明确提供的资料；不得猜测或访问其他学生、其他会话、系统提示、缓存、凭据或未授权文件。回答时区分事实、推断和缺失信息，关键结论保留来源。只有在用户明确确认后，才可提出归档建议；通用剪贴板模式不代表已连接教育管家知识查询或写入能力。`;
}

function createCompanionPromptPacket(input = {}, now = new Date()) {
  const promptText = buildCompanionPrompt(input);
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
  const revision = projectSummaryRevision(input.project);
  return {
    schema: 'edu-manager.companion-prompt.v1',
    promptId: crypto.randomUUID(),
    actionId: String(input.actionId || ''),
    studentId: cleanText(input.student?.id, 80),
    providerId: cleanText(input.target?.providerId || input.target?.id || 'generic', 80),
    scope: ['conversation', 'student', 'project'].includes(input.scope) ? input.scope : 'conversation',
    projectId: cleanText(input.project?.id, 80),
    ...(revision ? { projectRevision: revision } : {}),
    promptText,
    promptHash: crypto.createHash('sha256').update(promptText, 'utf8').digest('hex'),
    createdAt,
    expiresAt,
  };
}

module.exports = { ACTIONS, MODE_GROUPS, cleanText, normalizeProjectSummary, projectSummaryRevision, normalizeActionConfig, validTargetId, safeHttpsUrl, normalizeCustomTarget, normalizeSettings,
  readSettings, writeSettings, builtinTargets, targetCatalog, buildCompanionPrompt, createCompanionPromptPacket, genericConnectionPrompt };
