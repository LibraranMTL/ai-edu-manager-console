const net = require('node:net');

const TOPIC_RULES = [
  ['数学学习', /数学|代数|几何|函数|方程|微积分|统计|概率/i],
  ['科学与工程', /物理|化学|生物|实验|工程|机械|电子|无人机|机器人|建模|CAD/i],
  ['语言与写作', /英语|中文|语文|写作|作文|阅读|词汇|文书|演讲|出版/i],
  ['编程与人工智能', /编程|代码|软件|算法|Python|JavaScript|AI|人工智能|模型|Agent/i],
  ['项目研究', /项目|研究|调研|方案|设计|原型|测试|成果|竞赛/i],
  ['升学与规划', /升学|申请|专业|大学|学校|课程|职业|规划|目标/i],
  ['学习反馈', /反馈|复盘|进展|困难|改进|掌握|练习|作业|考试/i],
];

const CATEGORY_RULES = [
  ['学习进展与反馈', /学习|练习|作业|掌握|进展|复盘|考试|成绩|困难|改进/i],
  ['项目研究与成果', /项目|调研|研究|方案|设计|原型|测试|成果|交付|作品/i],
  ['升学申请与规划', /申请|大学|院校|专业|文书|录取|奖学金|职业|规划/i],
  ['资料整理与知识生产', /资料|总结|归纳|知识|笔记|报告|文档|出版|写作/i],
  ['问题诊断与解决', /报错|错误|失败|异常|修复|解决|排查|原因|无法/i],
];

const STOPWORDS = new Set([
  '这个', '那个', '可以', '需要', '进行', '已经', '没有', '什么', '如何', '以及', '目前',
  '我们', '你们', '他们', '用户', '助手', '请问', '请帮', '一下', '一个', '一些', '相关',
  '内容', '问题', '情况', '如果', '是否', '然后', '但是', '因此', '通过', '使用', '实现',
  'the', 'and', 'for', 'with', 'from', 'that', 'this',
]);

function compactText(value, limit = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function meaningfulConversationLines(text) {
  return String(text || '').split(/\r?\n/)
    .map((line) => compactText(line.replace(/^#{1,6}\s+/, ''), 360))
    .filter((line) => line.length >= 3 && !/^[-#>*`\s]+$/.test(line));
}

function extractKeywords(text, limit = 12) {
  const counts = new Map();
  const add = (raw) => {
    const word = String(raw || '').trim();
    const normalized = word.toLocaleLowerCase('zh-CN');
    if (word.length < 2 || word.length > 24 || STOPWORDS.has(normalized) || /^\d+$/.test(word)) return;
    counts.set(word, (counts.get(word) || 0) + 1);
  };
  for (const word of String(text || '').match(/[A-Za-z][A-Za-z0-9+_.-]{2,23}/g) || []) add(word);
  for (const phrase of String(text || '').match(/[\u3400-\u9fff]{2,8}/g) || []) {
    add(phrase);
    if (phrase.length > 4) {
      for (let index = 0; index <= phrase.length - 4; index += 2) add(phrase.slice(index, index + 4));
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length)
    .slice(0, limit)
    .map(([word]) => word);
}

function selectLines(lines, pattern, limit = 5) {
  return lines.filter((line) => pattern.test(line)).slice(0, limit).map((line) => compactText(line, 220));
}

function analyzeConversationAsset(content, projects = []) {
  const text = String(content || '');
  const lines = meaningfulConversationLines(text);
  const topics = TOPIC_RULES.filter(([, pattern]) => pattern.test(text)).map(([topic]) => topic).slice(0, 4);
  const keywords = extractKeywords(text);
  const projectSuggestions = (Array.isArray(projects) ? projects : [])
    .map((project) => {
      const name = compactText(project?.name, 160);
      const nameHit = name.length >= 2 && text.toLocaleLowerCase('zh-CN').includes(name.toLocaleLowerCase('zh-CN'));
      const description = `${project?.description || ''} ${project?.objective || ''}`;
      const overlap = extractKeywords(`${name} ${description}`, 10).filter((word) => keywords.includes(word)).length;
      return { id: String(project?.id || ''), score: nameHit ? 100 : overlap };
    })
    .filter((item) => item.id && item.score >= 2)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
    .map((item) => item.id);
  const title = compactText(lines[0] || keywords.slice(0, 3).join(' · ') || '未命名对话', 80);
  const questions = selectLines(lines, /[？?]|如何|为什么|能否|是否|怎么|请问/i, 5);
  const decisions = selectLines(lines, /决定|确定|结论|同意|采用|选择|最终|确认/i, 5);
  const actionItems = selectLines(lines, /下一步|待办|需要|应当|建议|执行|完成|改进|修复/i, 6);
  const outcomes = selectLines(lines, /已完成|成功|通过测试|解决|结果|产出|形成|提交|发布/i, 5);
  const category = CATEGORY_RULES.find(([, pattern]) => pattern.test(text))?.[0] || '综合对话资料';
  const summaryCandidates = [...outcomes, ...decisions, ...lines].filter(Boolean);
  const summary = compactText([...new Set(summaryCandidates)].slice(0, 3).join(' '), 300);
  return {
    schema: 'edu-manager.conversation-topic-analysis.v2',
    title,
    summary,
    category,
    archiveReason: `检测到主题：${(topics.length ? topics : ['综合对话']).join('、')}`,
    topics: topics.length ? topics : ['综合对话'],
    keywords,
    questions,
    decisions,
    actionItems,
    outcomes,
    suggestedProjectIds: projectSuggestions,
    suggestedTargetType: projectSuggestions.length === 1 ? 'project' : 'student',
    confidence: projectSuggestions.length === 1 ? 'high' : topics.length ? 'medium' : 'low',
    analyzedAt: new Date().toISOString(),
    analyzer: 'local-rules-v2',
  };
}

function privateIpv4(hostname) {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

function validateConversationShareUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['https:', 'http:'].includes(url.protocol)) return { ok: false, message: '仅支持 http 或 https 分享链接。' };
    const hostname = url.hostname.toLocaleLowerCase('en-US');
    if (!hostname || hostname === 'localhost' || hostname.endsWith('.local') || privateIpv4(hostname)) {
      return { ok: false, message: '分享链接不能指向本机或局域网内部地址。' };
    }
    if (net.isIP(hostname) === 6 && (hostname === '::1' || hostname.startsWith('fe80:') || hostname.startsWith('fc') || hostname.startsWith('fd'))) {
      return { ok: false, message: '分享链接不能指向本机或局域网内部地址。' };
    }
    return { ok: true, url: url.toString(), hostname };
  } catch {
    return { ok: false, message: '分享链接格式无效。' };
  }
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function embeddedConversationText(source) {
  const values = [];
  const seen = new Set();
  for (const script of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const quoted of script[1].matchAll(/"((?:\\.|[^"\\]){8,4000})"/g)) {
      let value = '';
      try { value = JSON.parse(`"${quoted[1]}"`); } catch { continue; }
      value = decodeHtmlEntities(value).replace(/\\n/g, '\n').trim();
      if (
        value.length < 12
        || /^https?:\/\//i.test(value)
        || /^(data:|webpack|function|[a-z-]+\/[a-z-]+$)/i.test(value)
        || (!/[\u3400-\u9fff]/.test(value) && !/\s/.test(value))
      ) continue;
      const compact = compactText(value, 1000);
      if (!seen.has(compact)) {
        seen.add(compact);
        values.push(compact);
      }
    }
  }
  return values.slice(0, 300).join('\n');
}

function htmlToConversationText(html) {
  const source = String(html || '');
  const title = decodeHtmlEntities(
    source.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1]
      || source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      || '',
  ).replace(/\s+/g, ' ').trim();
  const visibleBody = decodeHtmlEntities(source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '\n')
    .replace(/<(br|\/p|\/div|\/li|\/article|\/section|\/h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  const embedded = embeddedConversationText(source);
  // Modern share pages often render only navigation in the visible HTML and
  // keep the real conversation in hydration JSON. Prefer a substantive
  // embedded transcript instead of selecting by raw page length.
  const useEmbedded = embedded.length >= 20;
  const content = useEmbedded ? embedded : visibleBody;
  return {
    title: compactText(title, 160),
    content: content.trim(),
    extraction: useEmbedded ? 'embedded_json' : 'visible_html',
  };
}

module.exports = {
  analyzeConversationAsset,
  htmlToConversationText,
  validateConversationShareUrl,
};
