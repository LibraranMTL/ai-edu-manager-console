const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const websiteRoot = path.join(root, 'release', '网站文件');
const manualSpecs = [
  {
    sourcePath: path.join(root, 'docs', 'delivery', 'Windows主机版操作手册.md'),
    targetPaths: [path.join(websiteRoot, 'windows-host-manual.html'), path.join(websiteRoot, 'windows-manual.html')],
    title: 'AI教育管家 Windows 主机端操作手册 - 群星矩阵',
    description: 'AI教育管家 Windows 主机端操作手册',
    currentHref: './windows-host-manual.html',
  },
  {
    sourcePath: path.join(root, 'docs', 'delivery', 'Windows学生终端操作手册.md'),
    targetPaths: [path.join(websiteRoot, 'windows-student-manual.html')],
    title: 'AI教育管家 Windows 学生端操作手册 - 群星矩阵',
    description: 'AI教育管家 Windows 学生端操作手册',
    currentHref: './windows-student-manual.html',
  },
  {
    sourcePath: path.join(root, 'docs', 'delivery', 'Android学生终端操作手册.md'),
    targetPaths: [path.join(websiteRoot, 'android-student-manual.html'), path.join(websiteRoot, 'tablet-manual.html')],
    title: 'AI教育管家 Android 学生端操作手册 - 群星矩阵',
    description: 'AI教育管家 Android 学生端操作手册',
    currentHref: './android-student-manual.html',
  },
  {
    sourcePath: path.join(root, 'docs', 'delivery', 'Android教师终端操作手册.md'),
    targetPaths: [path.join(websiteRoot, 'android-teacher-manual.html')],
    title: 'AI教育管家 Android 教师端操作手册 - 群星矩阵',
    description: 'AI教育管家 Android 教师端操作手册',
    currentHref: './android-teacher-manual.html',
  },
  {
    sourcePath: path.join(root, 'docs', 'delivery', 'Android单机版操作手册.md'),
    targetPaths: [path.join(websiteRoot, 'android-standalone-manual.html')],
    title: 'AI教育管家 Android 单机版操作手册 - 群星矩阵',
    description: 'AI教育管家 Android 单机版操作手册',
    currentHref: './android-standalone-manual.html',
  },
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

function manualMenu(currentHref) {
  return `<nav class="menu" aria-label="网站菜单">
      <a href="./download.html">软件下载</a>
      <a href="./windows-host-manual.html"${currentHref === './windows-host-manual.html' ? ' aria-current="page"' : ''}>Windows 主机端</a>
      <a href="./windows-student-manual.html"${currentHref === './windows-student-manual.html' ? ' aria-current="page"' : ''}>Windows 学生端</a>
      <a href="./android-student-manual.html"${currentHref === './android-student-manual.html' ? ' aria-current="page"' : ''}>Android 学生端</a>
      <a href="./android-teacher-manual.html"${currentHref === './android-teacher-manual.html' ? ' aria-current="page"' : ''}>Android 教师端</a>
      <a href="./android-standalone-manual.html">Android 单机版</a>
      <a href="./privacy.html">隐私政策</a>
      <a href="./agreement.html">用户协议</a>
    </nav>`;
}

const fallbackTemplatePath = path.join(websiteRoot, 'android-student-manual.html');

// Scoped releases must not regenerate manuals belonging to other products.
const selectedManualSpecs = process.argv.includes('--host-only')
  ? manualSpecs.slice(0, 1)
  : process.argv.includes('--android-clients-only')
    ? manualSpecs.filter(({ currentHref }) => [
      './android-student-manual.html',
      './android-teacher-manual.html',
    ].includes(currentHref))
  : process.argv.includes('--android-standalone-only')
    ? manualSpecs.filter(({ currentHref }) => currentHref === './android-standalone-manual.html')
    : process.argv.includes('--terminal-clients-only')
      ? manualSpecs.filter(({ currentHref }) => [
        './windows-student-manual.html',
        './android-student-manual.html',
        './android-teacher-manual.html',
      ].includes(currentHref))
    : manualSpecs;
for (const spec of selectedManualSpecs) {
  const source = fs.readFileSync(spec.sourcePath, 'utf8');
  const rendered = renderMarkdown(source);

  for (const targetPath of spec.targetPaths) {
    const target = fs.readFileSync(fs.existsSync(targetPath) ? targetPath : fallbackTemplatePath, 'utf8');
    if (!/<aside class="toc">[\s\S]*?<\/aside>/u.test(target) || !/<article>[\s\S]*?<\/article>/u.test(target)) {
      throw new Error(`${path.relative(root, targetPath)} did not contain replaceable TOC and article regions.`);
    }
    const next = target
      .replace(/<title>[\s\S]*?<\/title>/u, `<title>${escapeHtml(spec.title)}</title>`)
      .replace(/<meta name="description" content="[^"]*"\s*\/>/u, `<meta name="description" content="${escapeHtml(spec.description)}" />`)
      .replace(/<nav class="menu" aria-label="网站菜单">[\s\S]*?<\/nav>/u, manualMenu(spec.currentHref))
      .replace(
        /<aside class="toc">[\s\S]*?<\/aside>/u,
        `<aside class="toc"><strong>本页目录</strong>${rendered.toc}</aside>`,
      )
      .replace(
        /<article>[\s\S]*?<\/article>/u,
        `<article>${rendered.article}</article>`,
      );

    if (next !== target || !fs.existsSync(targetPath)) {
      fs.writeFileSync(targetPath, next, 'utf8');
    }

    console.log(`Synced ${path.relative(root, spec.sourcePath)} -> ${path.relative(root, targetPath)}`);
  }
}
