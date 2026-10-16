import katex from 'katex';
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
function math(source, displayMode) {
  try { return `<span class="${displayMode ? 'card-math-block' : 'card-math-inline'}">${katex.renderToString(source, { displayMode, throwOnError: true, trust: false, strict: 'error', output: 'htmlAndMathml', maxExpand: 500, maxSize: 20 })}</span>`; }
  catch { return `<code class="card-math-error">${escapeHtml(source)}</code>`; }
}
function inline(text) {
  // Escape by construction. No raw HTML, remote images, event handlers, links
  // or imported styles are accepted from student/Agent/package content.
  const pattern = /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|(?<!\\)\$[^\n$]+?\$|`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
  return text.split(pattern).map(part => {
    if (part.startsWith('$$') && part.endsWith('$$')) return math(part.slice(2,-2), true);
    if (part.startsWith('\\[') && part.endsWith('\\]')) return math(part.slice(2,-2), true);
    if (part.startsWith('\\(') && part.endsWith('\\)')) return math(part.slice(2,-2), false);
    if (part.startsWith('$') && part.endsWith('$') && part.length > 2) return math(part.slice(1,-1), false);
    if (part.startsWith('`') && part.endsWith('`')) return `<code>${escapeHtml(part.slice(1,-1))}</code>`;
    if (part.startsWith('**') && part.endsWith('**')) return `<strong>${escapeHtml(part.slice(2,-2))}</strong>`;
    return escapeHtml(part).replace(/\n/g, '<br>');
  }).join('');
}
export function renderPracticeMarkdown(value) {
  const source = String(value ?? '').slice(0, 60000).replace(/\r\n/g, '\n');
  // Use a prefix absent from the source, so literal input cannot forge a math
  // placeholder. Fenced code remains literal (including dollar delimiters).
  const blocks = [];
  let prefix='CARDMATH';while(source.includes(prefix))prefix+='X';
  const text = source.replace(/```[\s\S]*?```|\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]/g, (all, a, b, offset) => {
    if(all.startsWith('```'))return all;
    const token = `${prefix}${offset}TOKEN`; blocks.push([token, math(a ?? b, true)]); return `\n\n${token}\n\n`;
  });
  const rows = text.split('\n'), output = []; let index = 0;
  while (index < rows.length) {
    const row = rows[index]; if (!row.trim()) { index++; continue; }
    const block = blocks.find(([token]) => token === row.trim());
    if (block) { output.push(block[1]); index++; continue; }
    if (/^\s*```/.test(row)) { const code = []; index++; while (index < rows.length && !/^\s*```/.test(rows[index])) code.push(rows[index++]); index++; output.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`); continue; }
    const heading = /^(#{1,4})\s+(.+)$/.exec(row);
    if (heading) { output.push(`<h${heading[1].length + 1}>${inline(heading[2])}</h${heading[1].length + 1}>`); index++; continue; }
    if (row.includes('|') && /^\s*\|?\s*:?-{3,}/.test(rows[index + 1] || '')) {
      const cells = line => line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|');
      const head = cells(row); index += 2; const body = [];
      while (index < rows.length && rows[index].includes('|')) body.push(`<tr>${cells(rows[index++]).map(c => `<td>${inline(c.trim())}</td>`).join('')}</tr>`);
      output.push(`<div class="card-table-scroll"><table><thead><tr>${head.map(c => `<th>${inline(c.trim())}</th>`).join('')}</tr></thead><tbody>${body.join('')}</tbody></table></div>`); continue;
    }
    const list = /^\s*(?:[-*]|\d+[.)])\s+/.exec(row);
    if (list) { const ordered = /\d/.test(list[0]), items = []; const re = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/; while (index < rows.length && re.test(rows[index])) items.push(`<li>${inline(rows[index++].replace(re, ''))}</li>`); output.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`); continue; }
    output.push(`<p>${inline(row)}</p>`); index++;
  }
  return output.join('\n');
}
export const practiceRichCss = `.card-rich{line-height:1.85;overflow-wrap:anywhere;max-width:76ch}.card-rich p{margin:.55em 0}.card-rich table{border-collapse:collapse;width:100%}.card-rich td,.card-rich th{border:1px solid #cad5df;padding:8px;text-align:left}.card-math-block,.card-table-scroll{display:block;overflow-x:auto;max-width:100%;padding:8px 0}.card-math-block .katex-display{margin:.3em 0}.card-rich pre{overflow:auto;background:#f5f7fa;padding:12px}.card-math-error{white-space:pre-wrap;color:#8a4b18}.card-rich li{margin:.3em 0}@media print{.card-rich{max-width:none}.card-math-block{overflow:visible;font-size:.85em}.card-rich h2,.card-rich h3{break-after:avoid}.card-rich tr{break-inside:avoid}}`;
