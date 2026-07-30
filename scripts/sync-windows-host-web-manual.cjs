const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'docs', 'delivery', 'Windows主机版操作手册.md');
const targetPaths = [
  path.join(root, 'release', '网站文件', 'windows-host-manual.html'),
  path.join(root, 'release', '网站文件', 'windows-manual.html'),
];

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderInline(value) {
  return value
    .split('`')
    .map((part, index) => {
      const escaped = escapeHtml(part);
      if (index % 2 === 1) {
        return `<code>${escaped}</code>`;
      }
      return escaped.replace(/\*\*(.+?)\*\*/gu, '<strong>$1</strong>');
    })
    .join('');
}

function renderMarkdown(markdown) {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const html = [];
  const toc = [];
  let paragraph = [];
  let listType = null;
  let listItems = [];
  let sectionNumber = 0;

  function flushParagraph() {
    if (paragraph.length === 0) return;
    html.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
    paragraph = [];
  }

  function flushList() {
    if (!listType) return;
    html.push(`<${listType}>${listItems.map((item) => `<li>${renderInline(item)}</li>`).join('')}</${listType}>`);
    listType = null;
    listItems = [];
  }

  function flushBlocks() {
    flushParagraph();
    flushList();
  }

  for (const line of lines) {
    if (!line.trim()) {
      flushBlocks();
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/u.exec(line);
    if (heading) {
      flushBlocks();
      const level = heading[1].length;
      const label = heading[2];
      if (level === 2) {
        sectionNumber += 1;
        const id = `section-${sectionNumber}`;
        toc.push({ id, label });
        html.push(`<h2 id="${id}">${renderInline(label)}</h2>`);
      } else {
        html.push(`<h${level}>${renderInline(label)}</h${level}>`);
      }
      continue;
    }

    const quote = /^>\s+(.+)$/u.exec(line);
    if (quote) {
      flushBlocks();
      html.push(`<blockquote>${renderInline(quote[1])}</blockquote>`);
      continue;
    }

    const unordered = /^-\s+(.+)$/u.exec(line);
    const ordered = /^\d+\.\s+(.+)$/u.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      const nextType = unordered ? 'ul' : 'ol';
      if (listType && listType !== nextType) flushList();
      listType = nextType;
      listItems.push((unordered || ordered)[1]);
      continue;
    }

    flushList();
    if (/^\*\*.+\*\*$/u.test(line.trim())) {
      flushParagraph();
      html.push(`<p>${renderInline(line.trim())}</p>`);
      continue;
    }
    paragraph.push(line.trim());
  }

  flushBlocks();
  return {
    article: html.join(''),
    toc: toc.map(({ id, label }) => `<a href="#${id}">${renderInline(label)}</a>`).join(''),
  };
}

const source = fs.readFileSync(sourcePath, 'utf8');
const rendered = renderMarkdown(source);

for (const targetPath of targetPaths) {
  const target = fs.readFileSync(targetPath, 'utf8');
  if (!/<aside class="toc">[\s\S]*?<\/aside>/u.test(target) || !/<article>[\s\S]*?<\/article>/u.test(target)) {
    throw new Error(`${path.relative(root, targetPath)} did not contain replaceable TOC and article regions.`);
  }
  const next = target
    .replace(
      /<aside class="toc">[\s\S]*?<\/aside>/u,
      `<aside class="toc"><strong>本页目录</strong>${rendered.toc}</aside>`,
    )
    .replace(
      /<article>[\s\S]*?<\/article>/u,
      `<article>${rendered.article}</article>`,
    );

  if (next !== target) {
    fs.writeFileSync(targetPath, next, 'utf8');
  }

  console.log(`Synced ${path.relative(root, sourcePath)} -> ${path.relative(root, targetPath)}`);
}
