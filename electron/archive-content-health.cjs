function stripMarkdownStructure(content) {
  return String(content || '')
    .replace(/^---[\s\S]*?---\s*/u, '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^#{1,6}\s+/u.test(line))
    .filter((line) => !/^\|?\s*:?-{3,}/u.test(line))
    .filter((line) => !/^>\s*(?:本报告|本目录|本文件)/u.test(line));
}

function isPlaceholderLine(line) {
  const value = String(line || '').replace(/^[-*]\s*/u, '').trim();
  return /^(?:待生成|待补充|待确认|暂无(?:内容|记录|资料|数据)?|无)[。.]?$/u.test(value)
    || /^待补充(?:已确认的)?/u.test(value)
    || /^\|\s*待补充(?:\s*\|\s*待补充)+/u.test(value);
}

function isTemplateInstruction(line) {
  const value = String(line || '').replace(/^[-*]\s*/u, '').trim();
  return /^(?:本目录|本文件|本报告|记录从|每条判断应|成长模型：|能力画像：|成长证据：|项目贡献：)/u.test(value);
}

function analyzeArchiveMarkdownContent(content) {
  const text = String(content || '');
  if (!text.trim()) return { state: 'empty', placeholderCount: 0, meaningfulLineCount: 0, message: '文件为空' };
  const lines = stripMarkdownStructure(text);
  const placeholderCount = lines.filter(isPlaceholderLine).length;
  const meaningful = lines.filter((line) => !isPlaceholderLine(line) && !isTemplateInstruction(line));
  if (!meaningful.length) {
    return {
      state: placeholderCount ? 'template' : 'empty',
      placeholderCount,
      meaningfulLineCount: 0,
      message: placeholderCount ? '当前为占位模板' : '只有标题或结构，没有正文',
    };
  }
  if (placeholderCount) {
    return { state: 'partial', placeholderCount, meaningfulLineCount: meaningful.length, message: '已有部分正文，仍有待补充内容' };
  }
  return { state: 'substantive', placeholderCount: 0, meaningfulLineCount: meaningful.length, message: '已检测到正文内容' };
}

function summarizeArchiveContentHealth(files = []) {
  const counts = { substantive: 0, partial: 0, template: 0, empty: 0 };
  for (const file of files) {
    const state = String(file?.contentState || 'empty');
    if (Object.hasOwn(counts, state)) counts[state] += 1;
  }
  return {
    ...counts,
    total: files.length,
    needsAttention: counts.partial + counts.template + counts.empty,
    message: counts.partial + counts.template + counts.empty
      ? `共 ${files.length} 份档案：${counts.substantive} 份有正文，${counts.partial} 份部分待补充，${counts.template} 份占位模板，${counts.empty} 份空文件。`
      : `共 ${files.length} 份档案，均检测到正文内容。`,
  };
}

module.exports = {
  analyzeArchiveMarkdownContent,
  summarizeArchiveContentHealth,
};
