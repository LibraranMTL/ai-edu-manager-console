import React, { memo, useEffect, useMemo, useRef, useState } from 'react';

export type MarkdownViewProps = {
  content: string;
  onMermaidNodeClick?: (nodeId: string) => boolean | void;
};

function renderInlineMarkdown(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;
    if (token.startsWith('`')) nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith('**')) nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith('*')) nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    else {
      const label = token.replace(/\]\(.+$/, '').slice(1);
      nodes.push(<a href={match[2]} key={key} rel="noreferrer" target="_blank">{label}</a>);
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function buildMarkdownBlocks(content: string, onMermaidNodeClick?: MarkdownViewProps['onMermaidNodeClick']) {
  const lines = content.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let codeBuffer: string[] = [];
  let codeLanguage = '';
  let inCode = false;
  let listBuffer: Array<{ ordered: boolean; text: string }> = [];
  let tableBuffer: string[][] = [];
  let tableHasHeader = false;
  const normalizeTableLine = (value: string) => value.replace(/\uFEFF/g, '').replace(/｜/g, '|');
  const splitTableRow = (value: string) => {
    let text = normalizeTableLine(value).trim();
    if (!text.includes('|')) return null;
    if (text.startsWith('|')) text = text.slice(1);
    if (text.endsWith('|')) text = text.slice(0, -1);
    const cells = text.split('|').map(cell => cell.trim());
    return cells.length >= 2 ? cells : null;
  };
  const isTableSeparatorRow = (row: string[]) => row.length >= 2 && row.every(cell => /^:?-{1,}:?$/.test(cell.replace(/\s+/g, '')));
  const hasTableShape = (value: string) => {
    const text = normalizeTableLine(value).trim();
    const pipeCount = (text.match(/\|/g) || []).length;
    return pipeCount >= 2 || (pipeCount >= 1 && (text.startsWith('|') || text.endsWith('|')));
  };
  const flushList = (key: string) => {
    if (!listBuffer.length) return;
    const ordered = listBuffer.every(item => item.ordered);
    const children = listBuffer.map((item, index) => <li key={`${key}-${index}`}>{renderInlineMarkdown(item.text, `${key}-${index}`)}</li>);
    blocks.push(ordered ? <ol key={key}>{children}</ol> : <ul key={key}>{children}</ul>);
    listBuffer = [];
  };
  const flushTable = (key: string) => {
    if (!tableBuffer.length) return;
    const rows = tableBuffer.filter(row => !isTableSeparatorRow(row));
    if (rows.length) {
      const maxCells = Math.max(...rows.map(row => row.length));
      const normalizedRows = rows.map(row => [...row, ...Array(Math.max(0, maxCells - row.length)).fill('')]);
      const headerRows = tableHasHeader ? normalizedRows.slice(0, 1) : [];
      const bodyRows = tableHasHeader ? normalizedRows.slice(1) : normalizedRows;
      blocks.push(<div className="md-table-wrap" key={key}>
        <div className="md-table-grid" role="table" style={{ '--md-table-columns': Array(maxCells).fill('minmax(120px, 1fr)').join(' ') } as React.CSSProperties}>
          {headerRows.length > 0 && <div className="md-table-head-group" role="rowgroup">{headerRows.map((row, rowIndex) => <div className="md-table-row md-table-head-row" key={`${key}-head-${rowIndex}`} role="row">{row.map((cell, cellIndex) => <div className="md-table-cell md-table-head" key={`${key}-head-${rowIndex}-${cellIndex}`} role="columnheader">{renderInlineMarkdown(cell, `${key}-head-${rowIndex}-${cellIndex}`)}</div>)}</div>)}</div>}
          <div className="md-table-body-group" role="rowgroup">{bodyRows.map((row, rowIndex) => <div className="md-table-row" key={`${key}-body-${rowIndex}`} role="row">{row.map((cell, cellIndex) => <div className="md-table-cell" key={`${key}-body-${rowIndex}-${cellIndex}`} role="cell">{renderInlineMarkdown(cell, `${key}-body-${rowIndex}-${cellIndex}`)}</div>)}</div>)}</div>
        </div>
      </div>);
    }
    tableBuffer = [];
    tableHasHeader = false;
  };
  const flushFlow = (key: string) => { flushList(`${key}-list`); flushTable(`${key}-table`); };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim().startsWith('```')) {
      flushFlow(`flow-${index}`);
      if (inCode) {
        const source = codeBuffer.join('\n');
        blocks.push(codeLanguage.trim().toLowerCase() === 'mermaid'
          ? <MermaidBlock key={`mermaid-${index}`} source={source} onNodeClick={onMermaidNodeClick} />
          : <pre className="md-code" key={`code-${index}`}>{source}</pre>);
        codeBuffer = [];
        codeLanguage = '';
        inCode = false;
      } else {
        codeLanguage = line.trim().slice(3).trim().split(/\s+/)[0] || '';
        inCode = true;
      }
      index += 1;
      continue;
    }
    if (inCode) { codeBuffer.push(line); index += 1; continue; }
    if (!line.trim()) { flushFlow(`flow-${index}`); blocks.push(<div className="md-space" key={`space-${index}`} />); index += 1; continue; }
    const tableCells = splitTableRow(line);
    const nextLine = lines[index + 1] || '';
    const nextTableCells = splitTableRow(nextLine);
    const hasExplicitSeparator = Boolean(nextTableCells && isTableSeparatorRow(nextTableCells));
    const hasAdjacentPipeRows = Boolean(tableCells && nextTableCells && !isTableSeparatorRow(nextTableCells)
      && hasTableShape(line) && hasTableShape(nextLine) && Math.min(tableCells.length, nextTableCells.length) >= 2);
    if (tableCells && (hasExplicitSeparator || hasAdjacentPipeRows)) {
      flushList(`list-before-table-${index}`);
      tableBuffer = [tableCells];
      tableHasHeader = hasExplicitSeparator;
      index += hasExplicitSeparator ? 2 : 1;
      while (index < lines.length) {
        const rowCells = splitTableRow(lines[index] || '');
        if (!rowCells || !hasTableShape(lines[index] || '')) break;
        if (!isTableSeparatorRow(rowCells)) tableBuffer.push(rowCells);
        index += 1;
      }
      flushTable(`table-${index}`);
      continue;
    }
    flushTable(`table-before-${index}`);
    if (line.startsWith('# ')) { flushList(`list-before-h1-${index}`); blocks.push(<h1 key={index}>{renderInlineMarkdown(line.slice(2), `h1-${index}`)}</h1>); index += 1; continue; }
    if (line.startsWith('## ')) { flushList(`list-before-h2-${index}`); blocks.push(<h2 key={index}>{renderInlineMarkdown(line.slice(3), `h2-${index}`)}</h2>); index += 1; continue; }
    if (line.startsWith('### ')) { flushList(`list-before-h3-${index}`); blocks.push(<h3 key={index}>{renderInlineMarkdown(line.slice(4), `h3-${index}`)}</h3>); index += 1; continue; }
    if (line.startsWith('> ')) { flushList(`list-before-quote-${index}`); blocks.push(<blockquote key={index}>{renderInlineMarkdown(line.slice(2), `quote-${index}`)}</blockquote>); index += 1; continue; }
    const listMatch = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/);
    if (listMatch) { listBuffer.push({ ordered: /^\d/.test(listMatch[2]), text: listMatch[3] }); index += 1; continue; }
    flushList(`list-before-p-${index}`);
    blocks.push(<p key={index}>{renderInlineMarkdown(line, `p-${index}`)}</p>);
    index += 1;
  }
  flushFlow('tail-flow');
  if (codeBuffer.length) {
    const source = codeBuffer.join('\n');
    blocks.push(codeLanguage.trim().toLowerCase() === 'mermaid'
      ? <MermaidBlock key="mermaid-tail" source={source} onNodeClick={onMermaidNodeClick} />
      : <pre className="md-code" key="code-tail">{source}</pre>);
  }
  return blocks;
}

export const MarkdownView = memo(function MarkdownView({ content, onMermaidNodeClick }: MarkdownViewProps) {
  const blocks = useMemo(() => buildMarkdownBlocks(content, onMermaidNodeClick), [content, onMermaidNodeClick]);
  return <article className="markdown-content">{blocks}</article>;
});

const MermaidBlock = memo(function MermaidBlock({ source, onNodeClick }: { source: string; onNodeClick?: MarkdownViewProps['onMermaidNodeClick'] }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const renderId = useMemo(() => `mermaid-${Math.random().toString(36).slice(2)}`, []);
  const [visible, setVisible] = useState(false);
  const [result, setResult] = useState({ loading: true, svg: '', error: '' });
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragState, setDragState] = useState<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);

  useEffect(() => {
    const element = rootRef.current;
    if (!element || visible) return;
    if (!('IntersectionObserver' in window)) { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '240px 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const renderGraph = async () => {
      const graph = source.trim();
      if (!graph) { setResult({ loading: false, svg: '', error: 'Mermaid 图表内容为空。' }); return; }
      try {
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: {
          primaryColor: '#edf8f4', primaryTextColor: '#152522', primaryBorderColor: '#62bdae', lineColor: '#66847f',
          secondaryColor: '#fff4fb', tertiaryColor: '#f7fbff', fontFamily: '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif',
        } });
        const rendered = await mermaid.render(renderId, graph);
        if (!cancelled) setResult({ loading: false, svg: rendered.svg, error: '' });
      } catch (error) {
        if (!cancelled) setResult({ loading: false, svg: '', error: error instanceof Error ? error.message : String(error) });
      }
    };
    void renderGraph();
    return () => { cancelled = true; };
  }, [renderId, source, visible]);

  const clampScale = (value: number) => Math.max(0.45, Math.min(2.4, Number(value.toFixed(2))));
  const zoomGraph = (delta: number) => setScale(current => clampScale(current + delta));
  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 500);
  };
  const exportPng = () => {
    const url = URL.createObjectURL(new Blob([result.svg], { type: 'image/svg+xml;charset=utf-8' }));
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas'); canvas.width = Math.max(image.naturalWidth || image.width || 1200, 1200); canvas.height = Math.max(image.naturalHeight || image.height || 800, 800);
      const context = canvas.getContext('2d');
      if (!context) { URL.revokeObjectURL(url); return; }
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0);
      canvas.toBlob(blob => { if (blob) downloadBlob(blob, `knowledge-graph-${Date.now()}.png`); URL.revokeObjectURL(url); }, 'image/png');
    };
    image.onerror = () => URL.revokeObjectURL(url); image.src = url;
  };
  const handleGraphClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!onNodeClick) return;
    let element = event.target instanceof Element ? event.target : null;
    while (element && element !== event.currentTarget) {
      const elementId = element.getAttribute('id');
      if (elementId && onNodeClick(elementId)) return;
      element = element.parentElement;
    }
  };

  if (!visible || result.loading) return <div ref={rootRef} className="md-mermaid"><div className="md-mermaid-status">{visible ? '正在渲染关系图...' : '关系图进入可视区域后加载'}</div></div>;
  if (result.error || !result.svg) return <div ref={rootRef} className="md-mermaid md-mermaid-failed"><div className="md-mermaid-status">Mermaid 图渲染失败，已回退显示源码。</div>{result.error && <small>{result.error}</small>}<pre className="md-code">{source}</pre></div>;
  return <div ref={rootRef} className="md-mermaid">
    <div className="md-mermaid-toolbar"><span>关系图视图：{Math.round(scale * 100)}%</span><button type="button" onClick={() => zoomGraph(-0.12)}>缩小</button><button type="button" onClick={() => zoomGraph(0.12)}>放大</button><button type="button" onClick={() => { setScale(1); setPan({ x: 0, y: 0 }); }}>重置</button><button type="button" onClick={() => downloadBlob(new Blob([result.svg], { type: 'image/svg+xml;charset=utf-8' }), `knowledge-graph-${Date.now()}.svg`)}>导出 SVG</button><button type="button" onClick={exportPng}>导出 PNG</button></div>
    <div className={dragState ? 'md-mermaid-viewport dragging' : 'md-mermaid-viewport'}
      onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); setDragState({ pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: pan.x, originY: pan.y }); }}
      onPointerMove={event => { if (dragState?.pointerId === event.pointerId) setPan({ x: dragState.originX + event.clientX - dragState.startX, y: dragState.originY + event.clientY - dragState.startY }); }}
      onPointerUp={event => { if (dragState?.pointerId === event.pointerId) { event.currentTarget.releasePointerCapture(event.pointerId); setDragState(null); } }}
      onPointerCancel={() => setDragState(null)} onClick={handleGraphClick}
      onWheel={event => { if (!event.ctrlKey && !event.shiftKey) return; event.preventDefault(); zoomGraph(event.deltaY > 0 ? -0.08 : 0.08); }}>
      <div className="md-mermaid-canvas" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }} dangerouslySetInnerHTML={{ __html: result.svg }} />
    </div>
  </div>;
});
