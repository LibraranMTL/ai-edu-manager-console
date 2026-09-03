function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function unescapeMarkdown(value) {
  return String(value ?? '').replace(/\\([\\`*_[\]()#|~>])/g, '$1');
}

function inlineMarkdown(value) {
  const tokens = [];
  const stash = (html) => {
    const token = `\u0000MDTOKEN${tokens.length}\u0000`;
    tokens.push(html);
    return token;
  };
  let output = unescapeMarkdown(value);
  output = output.replace(/`([^`]+)`/g, (_, code) => stash(`<code>${escapeHtml(code)}</code>`));
  output = output.replace(/(?<!!)\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) => (
    stash(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`)
  ));
  output = escapeHtml(output)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>')
    .replace(/(?<!_)_([^_\n]+)_(?!_)/g, '<em>$1</em>');
  return output.replace(/\u0000MDTOKEN(\d+)\u0000/g, (_, index) => tokens[Number(index)] || '');
}

function splitMarkdownTableRow(line) {
  let value = String(line ?? '').trim();
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1);
  const cells = [];
  let cell = '';
  let escaped = false;
  let inCode = false;
  for (const character of value) {
    if (escaped) {
      cell += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '`') {
      inCode = !inCode;
      cell += character;
    } else if (character === '|' && !inCode) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += character;
    }
  }
  if (escaped) cell += '\\';
  cells.push(cell.trim());
  return cells;
}

function isMarkdownTableDivider(line) {
  const cells = splitMarkdownTableRow(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')));
}

function tableAlignment(cell) {
  const value = String(cell || '').replace(/\s+/g, '');
  if (value.startsWith(':') && value.endsWith(':')) return 'center';
  if (value.endsWith(':')) return 'right';
  return 'left';
}

export function renderTerminalMarkdown(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const output = [];
  let paragraph = [];
  let listType = '';
  let inFrontmatter = lines[0]?.trim() === '---';
  let inFence = false;
  let fenceLanguage = '';
  let codeLines = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    output.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (!listType) return;
    output.push(`</${listType}>`);
    listType = '';
  };
  const flushCode = () => {
    const language = fenceLanguage ? ` class="language-${escapeHtml(fenceLanguage)}"` : '';
    output.push(`<pre><code${language}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
    codeLines = [];
    fenceLanguage = '';
  };

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();

    if (inFrontmatter) {
      if (index > 0 && trimmed === '---') inFrontmatter = false;
      continue;
    }

    const fence = /^```\s*([a-zA-Z0-9_-]*)\s*$/.exec(trimmed);
    if (fence) {
      flushParagraph();
      closeList();
      if (inFence) {
        flushCode();
        inFence = false;
      } else {
        inFence = true;
        fenceLanguage = fence[1] || '';
      }
      continue;
    }
    if (inFence) {
      codeLines.push(raw);
      continue;
    }

    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(trimmed);
    const unordered = /^[-*+]\s+(.+)$/.exec(trimmed);
    const ordered = /^\d+[.)]\s+(.+)$/.exec(trimmed);
    const quote = /^>\s?(.*)$/.exec(trimmed);
    const nextLine = lines[index + 1] || '';

    if (trimmed.includes('|') && isMarkdownTableDivider(nextLine)) {
      flushParagraph();
      closeList();
      const headers = splitMarkdownTableRow(trimmed);
      const alignments = splitMarkdownTableRow(nextLine).map(tableAlignment);
      output.push('<div class="markdown-table-wrap"><table><thead><tr>');
      headers.forEach((header, cellIndex) => output.push(`<th class="align-${alignments[cellIndex] || 'left'}">${inlineMarkdown(header)}</th>`));
      output.push('</tr></thead><tbody>');
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
        const cells = splitMarkdownTableRow(lines[index]);
        output.push('<tr>');
        headers.forEach((_, cellIndex) => output.push(`<td class="align-${alignments[cellIndex] || 'left'}">${inlineMarkdown(cells[cellIndex] || '')}</td>`));
        output.push('</tr>');
        index += 1;
      }
      index -= 1;
      output.push('</tbody></table></div>');
    } else if (heading) {
      flushParagraph();
      closeList();
      const level = Math.min(4, heading[1].length);
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
    } else if (unordered || ordered) {
      flushParagraph();
      const desiredType = unordered ? 'ul' : 'ol';
      if (listType !== desiredType) {
        closeList();
        listType = desiredType;
        output.push(`<${desiredType}>`);
      }
      const item = (unordered || ordered)[1];
      const task = /^\[([ xX])]\s+(.+)$/.exec(item);
      output.push(task
        ? `<li class="markdown-task"><input type="checkbox" disabled${task[1].toLowerCase() === 'x' ? ' checked' : ''}> <span>${inlineMarkdown(task[2])}</span></li>`
        : `<li>${inlineMarkdown(item)}</li>`);
    } else if (quote) {
      flushParagraph();
      closeList();
      output.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`);
    } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      closeList();
      output.push('<hr>');
    } else if (!trimmed) {
      flushParagraph();
      closeList();
    } else {
      closeList();
      paragraph.push(trimmed);
    }
  }

  if (inFence) flushCode();
  flushParagraph();
  closeList();
  return output.join('\n');
}

export const terminalMarkdownInternals = {
  escapeHtml,
  inlineMarkdown,
  splitMarkdownTableRow,
  isMarkdownTableDivider,
};
