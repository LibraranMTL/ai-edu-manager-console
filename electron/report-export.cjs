const fs = require('fs');
const path = require('path');

function safeExportStem(value, fallback = 'education-report') {
  const cleaned = String(value || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .slice(0, 96);
  return cleaned || fallback;
}

function exportBaseCandidates(paths = {}) {
  const values = [
    paths.downloads ? path.join(paths.downloads, 'AI教育管家导出') : '',
    paths.documents ? path.join(paths.documents, 'AI教育管家导出') : '',
    paths.desktop ? path.join(paths.desktop, 'AI教育管家导出') : '',
    paths.userData ? path.join(paths.userData, 'exports') : '',
  ];
  return [...new Set(values.filter(Boolean).map((item) => path.resolve(item)))];
}

function isRecoverableExportError(error) {
  return ['EPERM', 'EACCES', 'EBUSY', 'EROFS', 'ENOENT', 'ENOTDIR', 'EEXIST'].includes(String(error?.code || ''));
}

function ensureWritableDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
  fs.accessSync(directory, fs.constants.W_OK);
  return directory;
}

function uniqueTarget(base, stem, extension = '') {
  const cleanStem = safeExportStem(stem);
  const cleanExtension = extension ? `.${String(extension).replace(/^\.+/, '')}` : '';
  let target = path.join(base, `${cleanStem}${cleanExtension}`);
  for (let index = 2; fs.existsSync(target); index += 1) {
    target = path.join(base, `${cleanStem}-${index}${cleanExtension}`);
  }
  return target;
}

function copyDirectoryContents(source, target) {
  fs.mkdirSync(target, { recursive: false });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryContents(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    }
  }
}

function exportDirectoryWithFallback(source, candidates, stem) {
  if (!source || !fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    throw new Error('待导出的教育档案目录不存在。');
  }
  const failures = [];
  for (const base of candidates) {
    let target = '';
    try {
      ensureWritableDirectory(base);
      target = uniqueTarget(base, stem);
      copyDirectoryContents(source, target);
      return { path: target, base };
    } catch (error) {
      failures.push(`${base}: ${error.message}`);
      if (target && fs.existsSync(target)) {
        try {
          const resolvedBase = path.resolve(base);
          const resolvedTarget = path.resolve(target);
          if (resolvedTarget.startsWith(`${resolvedBase}${path.sep}`)) {
            fs.rmSync(resolvedTarget, { recursive: true, force: true });
          }
        } catch {}
      }
      if (!isRecoverableExportError(error)) throw error;
    }
  }
  throw new Error(`没有可写的导出目录。${failures.join('；')}`);
}

function writeFileWithFallback(candidates, stem, extension, content) {
  const failures = [];
  for (const base of candidates) {
    let target = '';
    try {
      ensureWritableDirectory(base);
      target = uniqueTarget(base, stem, extension);
      fs.writeFileSync(target, content);
      return { path: target, base };
    } catch (error) {
      failures.push(`${base}: ${error.message}`);
      if (target && fs.existsSync(target)) {
        try { fs.unlinkSync(target); } catch {}
      }
      if (!isRecoverableExportError(error)) throw error;
    }
  }
  throw new Error(`没有可写的导出目录。${failures.join('；')}`);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

function markdownToHtml(markdown) {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const output = [];
  let listType = '';
  let inFrontmatter = lines[0]?.trim() === '---';
  const tableCells = (line) => String(line || '').trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());

  const closeList = () => {
    if (listType) output.push(`</${listType}>`);
    listType = '';
  };

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    if (inFrontmatter) {
      if (index > 0 && trimmed === '---') inFrontmatter = false;
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    const unordered = /^[-*]\s+(.+)$/.exec(trimmed);
    const ordered = /^\d+[.)]\s+(.+)$/.exec(trimmed);
    const nextLine = String(lines[index + 1] || '').trim();
    const tableDivider = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(nextLine);
    if (trimmed.includes('|') && tableDivider) {
      closeList();
      const headers = tableCells(trimmed);
      output.push('<table><thead><tr>');
      for (const header of headers) output.push(`<th>${inlineMarkdown(header)}</th>`);
      output.push('</tr></thead><tbody>');
      index += 2;
      while (index < lines.length && String(lines[index] || '').trim().includes('|')) {
        output.push('<tr>');
        for (const cell of tableCells(lines[index])) output.push(`<td>${inlineMarkdown(cell)}</td>`);
        output.push('</tr>');
        index += 1;
      }
      index -= 1;
      output.push('</tbody></table>');
    } else if (heading) {
      closeList();
      const level = heading[1].length;
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
    } else if (unordered || ordered) {
      const nextType = unordered ? 'ul' : 'ol';
      if (listType !== nextType) {
        closeList();
        listType = nextType;
        output.push(`<${listType}>`);
      }
      output.push(`<li>${inlineMarkdown((unordered || ordered)[1])}</li>`);
    } else if (/^>\s?/.test(trimmed)) {
      closeList();
      output.push(`<blockquote>${inlineMarkdown(trimmed.replace(/^>\s?/, ''))}</blockquote>`);
    } else if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      closeList();
      output.push('<hr>');
    } else if (!trimmed) {
      closeList();
    } else {
      closeList();
      output.push(`<p>${inlineMarkdown(trimmed)}</p>`);
    }
  }
  closeList();
  return output.join('\n');
}

function learningReportHtml({ studentName, reportTitle, markdown, generatedAt }) {
  const title = `${studentName || '学生'} - ${reportTitle || '学情报告'}`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm 19mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #172033; font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif; font-size: 11pt; line-height: 1.75; }
  header { padding-bottom: 12mm; border-bottom: 2px solid #7546e8; margin-bottom: 10mm; }
  .eyebrow { color: #7546e8; font-size: 9pt; font-weight: 700; letter-spacing: .08em; }
  h1 { margin: 2mm 0 1mm; font-size: 24pt; line-height: 1.25; color: #111827; }
  header p { margin: 0; color: #657087; font-size: 9pt; }
  main h1 { font-size: 19pt; margin: 9mm 0 4mm; }
  main h2 { font-size: 15pt; margin: 8mm 0 3mm; padding-left: 3mm; border-left: 3px solid #7546e8; }
  main h3 { font-size: 12.5pt; margin: 6mm 0 2mm; }
  main h4 { font-size: 11.5pt; margin: 5mm 0 2mm; }
  p { margin: 0 0 3mm; overflow-wrap: anywhere; }
  ul, ol { margin: 1mm 0 4mm; padding-left: 7mm; }
  li { margin: 1mm 0; }
  blockquote { margin: 4mm 0; padding: 3mm 4mm; background: #f5f1ff; border-left: 3px solid #9d7af0; color: #4c566b; }
  table { width: 100%; border-collapse: collapse; margin: 4mm 0 6mm; font-size: 9.5pt; break-inside: avoid; }
  th, td { padding: 2mm 2.5mm; border: 1px solid #dce1e9; text-align: left; vertical-align: top; }
  th { background: #f5f1ff; color: #4f2aa8; font-weight: 700; }
  code { padding: 0.3mm 1mm; background: #f2f4f7; border-radius: 2px; font-family: Consolas, monospace; font-size: 9.5pt; }
  a { color: #5d32c7; text-decoration: none; }
  hr { border: 0; border-top: 1px solid #dce1e9; margin: 6mm 0; }
  h1, h2, h3, h4, blockquote, li { break-inside: avoid; }
</style>
</head>
<body>
<header>
  <div class="eyebrow">AI 教育管家 · 学情报告</div>
  <h1>${escapeHtml(reportTitle || '学情报告')}</h1>
  <p>学生：${escapeHtml(studentName || '未命名学生')}　导出时间：${escapeHtml(generatedAt || new Date().toLocaleString('zh-CN'))}</p>
</header>
<main>${markdownToHtml(markdown)}</main>
</body>
</html>`;
}

module.exports = {
  exportBaseCandidates,
  exportDirectoryWithFallback,
  learningReportHtml,
  markdownToHtml,
  safeExportStem,
  writeFileWithFallback,
};
