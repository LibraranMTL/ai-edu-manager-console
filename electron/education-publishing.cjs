const crypto = require('crypto');
const path = require('path');

const PUBLICATION_SCHEMA = 'edu-manager.education-publication.v1';
const PUBLICATION_DRAFT_SCHEMA = 'edu-manager.education-publication-draft.v2';

const TEMPLATES = Object.freeze([
  { id: 'formal', name: '正式报告', description: '完整保留报告主体，适合正式沟通', formats: ['pdf', 'markdown'], minPlan: 'basic' },
  { id: 'concise', name: '简明报告', description: '按结论、进展、关注与行动提取原文', formats: ['pdf', 'png', 'markdown'], minPlan: 'basic' },
  { id: 'growth-card', name: '成长要点卡', description: '适合手机查看和分享', formats: ['png', 'pdf'], minPlan: 'basic' },
  { id: 'monochrome', name: '黑白打印', description: '完整保留报告主体，低墨耗打印', formats: ['pdf', 'markdown'], minPlan: 'basic' },
]);

const BLOCKED_BASENAMES = /^(agent|agents|claude|ima|workbuddy|log|digest-state|digest-batch|project-digest-receipt)([-_.].*)?\.(md|json)$/i;
const BLOCKED_PATH_PARTS = /(^|[\\/])\.edu-manager([\\/]|$)|(^|[\\/])(audit|receipts?|回执|运行日志|索引缓存)([\\/]|$)/i;
const PLACEHOLDER = /^(?:待生成|待补充|待确认|暂无|无内容|一句话画像|基本信息概述|依据来源|来源依据|证据来源)[：:。\s]*$/i;
const SOURCE_HEADING = /^(依据来源|来源依据|证据来源)$/;
const ARCHIVE_METADATA_HEADING = /^(?:基本信息(?:\s*\/\s*basic\s*info)?|basic\s*info|与其他页面的关系(?:\s*\/\s*relations)?|relations|风险与不确定性(?:\s*\/\s*risks?\s*(?:&|and)\s*uncertainty)?|risks?\s*(?:&|and)\s*uncertainty|来源(?:\s*\/\s*source)?|source)$/i;

function fingerprint(content) {
  return crypto.createHash('sha256').update(String(content || ''), 'utf8').digest('hex');
}

function publicationEligibility(filePath) {
  const normalized = String(filePath || '');
  const base = path.basename(normalized);
  if (!normalized) return { eligible: false, reason: '未选择来源文件。' };
  if (BLOCKED_BASENAMES.test(base) || BLOCKED_PATH_PARTS.test(normalized)) {
    return { eligible: false, reason: '该文件属于规则、日志、回执或内部索引，不适合作为对外教育内容。' };
  }
  if (path.extname(base).toLowerCase() !== '.md') {
    return { eligible: false, reason: '当前仅支持将 Markdown 档案生成报告或卡片。' };
  }
  return { eligible: true, reason: '' };
}

function plainText(value) {
  return String(value || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_>#|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripLeadingFrontmatter(markdown) {
  const lines = String(markdown || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { markdown: lines.join('\n'), removed: false };
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (closing < 0) return { markdown: lines.join('\n'), removed: false };
  return { markdown: lines.slice(closing + 1).join('\n').replace(/^\s+/, ''), removed: true };
}

function stripTerminalSourceSection(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  let sourceIndex = -1;
  let sourceLevel = 7;
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^\s*(#{1,6})\s+(.+?)\s*$/);
    if (heading && SOURCE_HEADING.test(plainText(heading[2]))) {
      sourceIndex = index;
      sourceLevel = heading[1].length;
    }
  }
  if (sourceIndex < 0) return { markdown: lines.join('\n'), removed: false };
  const hasLaterPeer = lines.slice(sourceIndex + 1).some((line) => {
    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*$/);
    return heading && heading[1].length <= sourceLevel && !SOURCE_HEADING.test(plainText(heading[2]));
  });
  if (hasLaterPeer) return { markdown: lines.join('\n'), removed: false };
  return { markdown: lines.slice(0, sourceIndex).join('\n').trimEnd(), removed: true };
}

function stripSectionsByHeading(markdown, predicate) {
  const output = [];
  let skippedLevel = 0;
  for (const line of String(markdown || '').split(/\r?\n/)) {
    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*$/);
    if (heading) {
      const level = heading[1].length;
      if (skippedLevel && level <= skippedLevel) skippedLevel = 0;
      if (!skippedLevel && predicate(plainText(heading[2]))) {
        skippedLevel = level;
        continue;
      }
    }
    if (!skippedLevel) output.push(line);
  }
  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function normalizePublicationDocument(markdown, options = {}) {
  const frontmatter = stripLeadingFrontmatter(markdown);
  const sources = stripTerminalSourceSection(frontmatter.markdown);
  let bodyMarkdown = sources.markdown.trim();
  if (options.sourceType === 'archive_file' || options.excludeArchiveMetadata) {
    bodyMarkdown = stripSectionsByHeading(bodyMarkdown, (heading) => ARCHIVE_METADATA_HEADING.test(heading));
  }
  const firstHeading = bodyMarkdown.match(/^\s*#\s+(.+?)\s*(?:\n|$)/);
  const sourceTitle = plainText(options.title || '');
  const documentTitle = plainText(firstHeading?.[1] || sourceTitle || '教育内容报告');
  if (firstHeading && (!sourceTitle || documentTitle === sourceTitle)) {
    bodyMarkdown = bodyMarkdown.slice(firstHeading[0].length).replace(/^\s+/, '');
  }
  return {
    title: sourceTitle || documentTitle,
    documentTitle,
    bodyMarkdown,
    removedFrontmatter: frontmatter.removed,
    removedSources: sources.removed,
  };
}

function splitCompleteSentences(value) {
  const compact = plainText(value);
  if (!compact) return [];
  if (compact.length <= 220) return [compact];
  const clauses = compact.match(/[^。！？!?；;，,、]+[。！？!?；;，,、]?/g)?.map((item) => item.trim()).filter(Boolean) || [compact];
  const chunks = [];
  let current = '';
  for (const clause of clauses) {
    if (current && current.length + clause.length > 220) {
      chunks.push(current);
      current = '';
    }
    if (clause.length <= 220) {
      current += clause;
      continue;
    }
    if (current) { chunks.push(current); current = ''; }
    for (let offset = 0; offset < clause.length; offset += 220) chunks.push(clause.slice(offset, offset + 220));
  }
  if (current) chunks.push(current);
  return chunks.filter(Boolean);
}

function parseMarkdownSections(markdown) {
  const sections = [];
  let current = { heading: '正文', level: 1, lines: [] };
  const flush = () => {
    if (current.lines.some((line) => line.trim())) sections.push(current);
  };
  for (const line of String(markdown || '').split(/\r?\n/)) {
    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*$/);
    if (heading) {
      flush();
      current = { heading: plainText(heading[2]), level: heading[1].length, lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  flush();
  return sections;
}

function sectionUnits(section) {
  const units = [];
  let paragraph = [];
  const flushParagraph = () => {
    if (!paragraph.length) return;
    units.push(...splitCompleteSentences(paragraph.join(' ')));
    paragraph = [];
  };
  for (const line of section.lines) {
    const item = line.match(/^\s*(?:[-*+]\s+|\d+[.)]\s+)(.+?)\s*$/);
    if (item) {
      flushParagraph();
      units.push(...splitCompleteSentences(item[1]));
    } else if (!line.trim()) {
      flushParagraph();
    } else if (!/^\s*(?:```|\|?\s*:?-{3,})/.test(line)) {
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  return units
    .map((text) => ({ text: plainText(text), sourceHeading: section.heading }))
    .filter((item) => item.text.length >= 4 && !PLACEHOLDER.test(item.text));
}

function classifyUnit(item) {
  const haystack = `${item.sourceHeading} ${item.text}`;
  if (/(下一步|建议|行动|目标|计划|里程碑|不建议|观察点)/.test(haystack)) return 'action';
  if (/(短板|问题|风险|弱势|不足|关注|困难|波动|回落|待提升)/.test(haystack)) return 'attention';
  if (/(优势|亮点|潜力|擅长|兴趣|动力|能力)/.test(haystack)) return 'strength';
  if (/(最近|近期|本周|本月|变化|更新|进展|提升|完成)/.test(haystack)) return 'progress';
  if (/(整体|画像|概述|综合评估|结论|当前状态)/.test(haystack)) return 'overview';
  return 'other';
}

function uniqueUnits(units) {
  const seen = new Set();
  return units.filter((item) => {
    const key = item.text.replace(/[\s，。！？、；：“”‘’（）()]/g, '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function publicationUnits(markdown) {
  return uniqueUnits(parseMarkdownSections(markdown).flatMap(sectionUnits).map((item) => ({ ...item, category: classifyUnit(item) })));
}

function sourceItem(item, index) {
  return {
    id: `item-${index + 1}-${fingerprint(`${item.sourceHeading}\n${item.text}`).slice(0, 10)}`,
    text: item.text,
    sourceHeading: item.sourceHeading,
    sourceHash: fingerprint(item.text),
    grounded: true,
  };
}

function takeCategory(units, category, count) {
  return units.filter((item) => item.category === category).slice(0, count);
}

function buildSummarySections(units) {
  const definitions = [
    ['overview', '核心结论', 1],
    ['progress', '近期主要进展', 2],
    ['strength', '优势与潜力', 2],
    ['attention', '当前重点问题', 2],
    ['action', '下一步建议', 2],
  ];
  const used = new Set();
  const sections = definitions.map(([category, label, count]) => {
    let picked = takeCategory(units, category, count).filter((item) => !used.has(item.text));
    if (!picked.length && category === 'overview') picked = units.filter((item) => item.category === 'other').slice(0, 1);
    picked.forEach((item) => used.add(item.text));
    return { id: category, label, items: picked.map(sourceItem) };
  }).filter((section) => section.items.length);
  if (sections.reduce((sum, section) => sum + section.items.length, 0) < 3) {
    const fallback = units.filter((item) => !used.has(item.text)).slice(0, 3);
    if (fallback.length) sections.push({ id: 'other', label: '补充要点', items: fallback.map(sourceItem) });
  }
  return sections;
}

function buildGrowthSections(units) {
  const definitions = [
    ['progress', '本期进步'],
    ['strength', '当前优势'],
    ['attention', '需要关注'],
    ['action', '下一步行动'],
  ];
  const used = new Set();
  const sections = [];
  for (const [category, label] of definitions) {
    const item = units.find((candidate) => candidate.category === category && !used.has(candidate.text));
    if (!item) continue;
    used.add(item.text);
    sections.push({ id: category, label, items: [sourceItem(item, sections.length)] });
  }
  for (const item of units) {
    if (sections.reduce((sum, section) => sum + section.items.length, 0) >= 6) break;
    if (used.has(item.text)) continue;
    used.add(item.text);
    const target = sections.find((section) => section.id === item.category) || sections[0];
    if (target) target.items.push(sourceItem(item, target.items.length));
    else sections.push({ id: 'other', label: '成长要点', items: [sourceItem(item, 0)] });
  }
  return sections;
}

function validateDraftGrounding(draft, sourceMarkdown) {
  const source = plainText(normalizePublicationDocument(sourceMarkdown).bodyMarkdown).replace(/\s+/g, '');
  const items = (draft.sections || []).flatMap((section) => section.items || []);
  const grounded = items.filter((item) => source.includes(plainText(item.text).replace(/\s+/g, ''))).length;
  return {
    total: items.length,
    grounded,
    coverage: items.length ? grounded / items.length : 1,
    valid: !items.length || grounded === items.length,
  };
}

function buildPublicationDraft(markdown, options = {}) {
  const templateId = String(options.templateId || 'formal');
  const normalized = normalizePublicationDocument(markdown, { title: options.title, sourceType: options.sourceType, excludeArchiveMetadata: options.excludeArchiveMetadata });
  const base = {
    schema: PUBLICATION_DRAFT_SCHEMA,
    templateId,
    title: normalized.title,
    subtitle: plainText(options.subtitle || (templateId === 'formal' || templateId === 'monochrome' ? '完整报告' : '基于已选教育档案生成')),
    sourceHash: fingerprint(markdown),
    generatedAt: new Date().toISOString(),
    edited: false,
    normalization: {
      removedFrontmatter: normalized.removedFrontmatter,
      removedSources: normalized.removedSources,
    },
  };
  if (templateId === 'formal' || templateId === 'monochrome') {
    return { ...base, mode: 'document', markdown: normalized.bodyMarkdown, sections: [], validation: { total: 0, grounded: 0, coverage: 1, valid: true } };
  }
  const units = publicationUnits(normalized.bodyMarkdown);
  const sections = templateId === 'growth-card' ? buildGrowthSections(units) : buildSummarySections(units);
  const draft = { ...base, mode: templateId === 'growth-card' ? 'card' : 'summary', markdown: '', sections };
  return { ...draft, validation: validateDraftGrounding(draft, markdown) };
}

function extractPublicationOutline(markdown, options = {}) {
  const draft = buildPublicationDraft(markdown, { ...options, templateId: options.templateId || 'concise' });
  return {
    title: draft.title,
    subtitle: draft.subtitle,
    points: draft.sections.flatMap((section) => section.items.map((item) => item.text)),
  };
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');
}

function splitMarkdownTableRow(line) {
  const value = String(line || '').trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let cell = '';
  let escaped = false;
  for (const char of value) {
    if (escaped) { cell += char; escaped = false; continue; }
    if (char === '\\') { escaped = true; cell += char; continue; }
    if (char === '|') { cells.push(cell.trim()); cell = ''; continue; }
    cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function isMarkdownTableDelimiter(line) {
  const cells = splitMarkdownTableRow(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-+:?$/.test(cell.replace(/\s+/g, '')));
}

function repairCollapsedMarkdownTableLine(line) {
  const value = String(line || '');
  if (!value.includes('||')) return null;
  const chunks = value.split(/\|\s*\|/).map((item) => item.trim()).filter(Boolean);
  if (chunks.length < 3 || !isMarkdownTableDelimiter(chunks[1])) return null;
  const headers = splitMarkdownTableRow(chunks[0]);
  if (headers.length < 2) return null;
  const normalized = chunks.map((chunk) => {
    const cells = splitMarkdownTableRow(chunk).slice(0, headers.length);
    while (cells.length < headers.length) cells.push('');
    return `| ${cells.join(' | ')} |`;
  });
  return normalized;
}

function repairCollapsedMarkdownTables(markdown) {
  return String(markdown || '').split(/\r?\n/).flatMap((line) => repairCollapsedMarkdownTableLine(line) || [line]).join('\n');
}

function markdownToHtml(markdown) {
  const lines = repairCollapsedMarkdownTables(markdown).split(/\r?\n/);
  const html = [];
  let paragraph = [];
  let listType = '';
  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = '';
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*$/);
    const bullet = line.match(/^\s*[-*+]\s+(.+?)\s*$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.+?)\s*$/);
    const quote = line.match(/^\s*>\s?(.*)$/);
    const tableNext = isMarkdownTableDelimiter(lines[index + 1]);
    if (heading) {
      flushParagraph(); closeList();
      const level = Math.min(4, heading[1].length + 1);
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
    } else if (tableNext && line.includes('|')) {
      flushParagraph(); closeList();
      const headers = splitMarkdownTableRow(line);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        const cells = splitMarkdownTableRow(lines[index]);
        rows.push(headers.map((_, cellIndex) => cells[cellIndex] || ''));
        index += 1;
      }
      index -= 1;
      html.push(`<div class="table-wrap"><table><thead><tr>${headers.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    } else if (bullet || numbered) {
      flushParagraph();
      const desired = bullet ? 'ul' : 'ol';
      if (listType !== desired) { closeList(); listType = desired; html.push(`<${desired}>`); }
      html.push(`<li>${inlineMarkdown((bullet || numbered)[1])}</li>`);
    } else if (quote) {
      flushParagraph(); closeList();
      html.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`);
    } else if (!line.trim()) {
      flushParagraph(); closeList();
    } else if (!/^\s*```/.test(line)) {
      paragraph.push(line.trim());
    }
  }
  flushParagraph(); closeList();
  return html.join('\n');
}

function draftMarkdown(draft) {
  if (draft.mode === 'document') return `# ${draft.title}\n\n${draft.markdown}`.trim();
  return [`# ${draft.title}`, draft.subtitle ? `\n${draft.subtitle}` : '', ...(draft.sections || []).flatMap((section) => [`\n## ${section.label}`, ...(section.items || []).map((item) => `- ${item.text}`)])].join('\n').trim();
}

function publicationKindLabel(kind) {
  return ({
    metrics: '关键指标',
    timeline: '阶段进展',
    strength: '当前优势',
    attention: '需要关注',
    action: '下一步行动',
    narrative: '事实摘录',
  })[String(kind || '')] || '事实摘录';
}

function structuredPublicationSections(sections, className) {
  return `<section class="${className}">${sections.map((section) => {
    const kind = String(section.kind || 'narrative');
    const kindLabel = publicationKindLabel(kind);
    const badge = `<span class="kind-badge">${escapeHtml(kindLabel)}</span>`;
    const heading = String(section.label || '').trim() && String(section.label).trim() !== kindLabel
      ? `<h2>${escapeHtml(section.label)}</h2>`
      : '';
    const items = section.items.map((item) => `<li${item.emphasis === 'highlight' ? ' class="highlight"' : ''}>${escapeHtml(item.text)}</li>`).join('');
    return `<article data-kind="${escapeHtml(kind)}"><header>${badge}${heading}</header><ul>${items}</ul></article>`;
  }).join('')}</section>`;
}

function buildPublicationHtml(input) {
  const draft = input.draft || buildPublicationDraft(input.markdown, { templateId: input.templateId, title: input.title, subtitle: input.subtitle });
  const monochrome = input.colorMode === 'monochrome' || input.templateId === 'monochrome';
  const card = draft.mode === 'card' || input.outputFormat === 'png';
  const documentMode = draft.mode === 'document';
  const sections = (draft.sections || []).filter((section) => section.items?.length);
  let body;
  if (documentMode) {
    body = `<article class="markdown-body">${markdownToHtml(draft.markdown)}</article>`;
  } else if (draft.mode === 'card') {
    body = structuredPublicationSections(sections, 'card-points');
  } else {
    body = structuredPublicationSections(sections, 'summary-sections');
  }
  const cardCharacters = sections.reduce((sum, section) => sum + section.label.length + section.items.reduce((itemSum, item) => itemSum + item.text.length, 0), 0);
  const density = card && (cardCharacters > 1320 || draft.title.length > 34)
    ? ' compact'
    : card && (cardCharacters > 820 || draft.title.length > 24)
      ? ' dense'
      : '';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
    @page{size:${card ? '1080px 1920px' : 'A4'};margin:0}*{box-sizing:border-box}html,body{margin:0;min-width:${card ? '1080px' : '0'};background:${monochrome ? '#fff' : '#f3f1ff'};color:#172335;font-family:"Microsoft YaHei","Noto Sans SC",sans-serif}.page{width:${card ? '1080px' : '210mm'};min-height:${card ? '1920px' : '297mm'};padding:${card ? '72px 68px 62px' : '18mm 20mm'};margin:0 auto;background:${monochrome ? '#fff' : 'linear-gradient(150deg,#fff 0%,#faf8ff 62%,#eee7ff 100%)'};position:relative}.eyebrow{font-size:${card ? '22px' : '10pt'};letter-spacing:.14em;color:${monochrome ? '#333' : '#6f35db'};font-weight:700}.title{font-size:${card ? '52px' : '26pt'};line-height:1.18;margin:${card ? '22px 0 10px' : '6mm 0 2mm'};overflow-wrap:anywhere;word-break:break-word}.page.dense .title{font-size:44px}.page.compact .title{font-size:38px}.subtitle{font-size:${card ? '23px' : '12pt'};line-height:1.45;color:#667085;margin:0 0 ${card ? '30px' : '8mm'}}.markdown-body{font-size:11.5pt;line-height:1.75}.markdown-body h2{font-size:19pt;margin:8mm 0 3mm}.markdown-body h3{font-size:15pt;margin:6mm 0 2mm}.markdown-body h4{font-size:12.5pt;margin:5mm 0 2mm}.markdown-body p{margin:0 0 3.5mm}.markdown-body li{margin:1.5mm 0}.table-wrap{width:100%;overflow:visible;margin:4mm 0;break-inside:auto}.markdown-body table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:8.4pt;line-height:1.35}.markdown-body thead{display:table-header-group}.markdown-body tr{break-inside:avoid;page-break-inside:avoid}.markdown-body th,.markdown-body td{border:1px solid #b7bec8;padding:1.6mm;text-align:left;vertical-align:top;overflow-wrap:anywhere;word-break:break-word}.markdown-body blockquote{border-left:3px solid ${monochrome ? '#222' : '#7540e8'};margin:4mm 0;padding:2mm 4mm;color:#4b5563}.summary-sections{display:grid;gap:5mm}.summary-sections article{border:1px solid ${monochrome ? '#222' : '#d8cdf8'};border-radius:4mm;padding:5mm;background:${monochrome ? '#fff' : 'rgba(255,255,255,.86)'};break-inside:avoid}.summary-sections article header,.card-points article header{display:flex;align-items:center;gap:10px;margin-bottom:10px}.kind-badge{display:inline-flex;align-items:center;border-radius:999px;padding:1mm 2.6mm;background:${monochrome ? '#eee' : '#eee8ff'};color:${monochrome ? '#111' : '#5e2bc2'};font-size:${card ? '15px' : '8pt'};font-weight:800;white-space:nowrap}.summary-sections article[data-kind="metrics"],.card-points article[data-kind="metrics"]{background:${monochrome ? '#fff' : 'linear-gradient(135deg,#eee8ff,#fff)'};border-color:${monochrome ? '#111' : '#bca8ff'}}.summary-sections article[data-kind="timeline"],.card-points article[data-kind="timeline"]{background:${monochrome ? '#fff' : 'linear-gradient(135deg,#eaf4ff,#fff)'};border-color:${monochrome ? '#333' : '#9bc8ee'}}.summary-sections article[data-kind="strength"],.card-points article[data-kind="strength"]{background:${monochrome ? '#fff' : 'linear-gradient(135deg,#eaf8f0,#fff)'};border-color:${monochrome ? '#333' : '#83c7a4'}}.summary-sections article[data-kind="attention"],.card-points article[data-kind="attention"]{background:${monochrome ? '#fff' : 'linear-gradient(135deg,#fff3e8,#fff)'};border-color:${monochrome ? '#333' : '#eead76'}}.summary-sections article[data-kind="action"],.card-points article[data-kind="action"]{background:${monochrome ? '#fff' : 'linear-gradient(135deg,#fff0f2,#fff)'};border-left:5px solid ${monochrome ? '#111' : '#d65772'}}.summary-sections h2{font-size:14pt;margin:0;color:${monochrome ? '#111' : '#392464'}}.summary-sections ul{margin:0;padding-left:6mm}.summary-sections li{font-size:11.5pt;line-height:1.65;margin:1.5mm 0}.summary-sections article[data-kind="metrics"] li{font-size:12.5pt;font-weight:700}.summary-sections li.highlight,.card-points li.highlight{font-weight:800;color:${monochrome ? '#111' : '#5422ba'};padding-left:12px;border-left:3px solid ${monochrome ? '#111' : '#7b4ce2'}}.card-points{display:grid;grid-template-columns:minmax(0,1fr);gap:20px}.card-points article{min-width:0;background:${monochrome ? '#fff' : 'rgba(255,255,255,.9)'};border:2px solid ${monochrome ? '#111' : '#ded2ff'};border-radius:24px;padding:24px 28px;break-inside:avoid}.card-points h2{min-width:0;color:${monochrome ? '#222' : '#392464'};font-size:21px;line-height:1.3;font-weight:800;margin:0;overflow-wrap:anywhere}.card-points ul{min-width:0;margin:0;padding-left:1.15em}.card-points li{font-size:24px;line-height:1.52;margin:6px 0;overflow-wrap:anywhere;word-break:break-word}.card-points article[data-kind="metrics"] li{font-size:27px;font-weight:800}.page.dense .card-points{gap:14px}.page.dense .card-points article{padding:18px 23px;border-radius:20px}.page.dense .card-points li{font-size:21px;line-height:1.42;margin:4px 0}.page.dense .subtitle{margin-bottom:22px}.page.compact{padding-left:58px;padding-right:58px}.page.compact .card-points{gap:10px}.page.compact .card-points article{padding:14px 20px;border-radius:18px}.page.compact .card-points article header{margin-bottom:6px}.page.compact .card-points h2{font-size:18px}.page.compact .card-points li{font-size:18px;line-height:1.34;margin:3px 0}.page.compact .card-points article[data-kind="metrics"] li{font-size:20px}.page.compact .subtitle{font-size:20px;margin-bottom:16px}.page.compact .kind-badge{font-size:13px}.meta{margin-top:${card ? '34px' : '10mm'};display:flex;gap:18px;justify-content:space-between;align-items:flex-start;border-top:1px solid #c9ced6;padding-top:${card ? '18px' : '3mm'};font-size:${card ? '18px' : '9pt'};line-height:1.4;color:#6b7280}.meta span{min-width:0;overflow-wrap:anywhere}
  </style></head><body><main class="page${density}"><div class="eyebrow">AI 教育管家 · ROBOGALA</div><h1 class="title">${escapeHtml(draft.title)}</h1><p class="subtitle">${escapeHtml(draft.subtitle || '')}</p>${body}<footer class="meta"><span>${escapeHtml(input.studentName || '')}</span><span>${escapeHtml(input.generatedAt || '')}</span></footer></main></body></html>`;
}

function templateCatalog(plan = 'basic') {
  return TEMPLATES.map((template) => ({ ...template, locked: template.minPlan !== 'basic' && plan === 'basic' }));
}

module.exports = {
  PUBLICATION_SCHEMA,
  PUBLICATION_DRAFT_SCHEMA,
  TEMPLATES,
  buildPublicationDraft,
  buildPublicationHtml,
  draftMarkdown,
  extractPublicationOutline,
  fingerprint,
  markdownToHtml,
  normalizePublicationDocument,
  publicationEligibility,
  repairCollapsedMarkdownTables,
  templateCatalog,
  validateDraftGrounding,
};
