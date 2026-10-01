import React, { useState } from 'react';
export type CustomSubject = { name: string; keywords: string[] };
type CustomTool = { id: string; name: string; kind: 'web' | 'exe'; target: string };
export type CustomOptionsApi = {
  getCustomSubjects?: (studentId: string) => Promise<string>;
  saveCustomSubjects?: (studentId: string, subjects: CustomSubject[]) => Promise<string>;
  listCustomAgentTools?: () => Promise<string>;
  addCustomAgentTool?: (tool: Omit<CustomTool, 'id'>) => Promise<string>;
  removeCustomAgentTool?: (id: string) => Promise<string>;
  openCustomAgentTool?: (id: string) => Promise<string>;
};
export async function customResult<T>(promise?: Promise<string>): Promise<T> {
  if (!promise) throw new Error('此功能需要 Windows 主机接口');
  const result = JSON.parse(await promise);
  if (!result.ok) throw new Error(result.message || '操作失败');
  return result.data as T;
}
export function CustomSubjectsEditor({ items, save }: { items: CustomSubject[]; save: (items: CustomSubject[]) => Promise<void> }) {
  const [name, setName] = useState(''), [words, setWords] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  async function change(next: CustomSubject[]) {
    setBusy(true); setMessage('');
    try { await save(next); setName(''); setWords(''); setMessage('已保存，仅影响当前学生的浏览分类，不移动或重命名文件。'); }
    catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  return <details className="panel"><summary>自定义学科／课程</summary>
    <p>例如 IB Economics、机器人课程。按文件名与路径中的关键词匹配，自定义分类优先于内置分类；支持中文或英文，不使用正则表达式。</p>
    <label>名称<input maxLength={60} value={name} onChange={event => setName(event.target.value)} /></label>
    <label>分类关键词（逗号分隔）<input value={words} onChange={event => setWords(event.target.value)} placeholder="经济, Economics, Econ" /></label>
    <button disabled={busy || !name.trim() || !words.trim()} onClick={() => void change([...items, { name: name.trim(), keywords: words.split(/[,，]/).map(word => word.trim()).filter(Boolean) }])}>添加学科／课程</button>
    {items.map((item, index) => <div key={item.name} className="actions"><span>{item.name} · {item.keywords.join('、')}</span><button disabled={busy} onClick={() => { if (window.confirm(`删除“${item.name}”浏览分类？原文件保留。`)) void change(items.filter((_, at) => at !== index)); }}>删除分类</button></div>)}
    {message && <p role="status">{message}</p>}
  </details>;
}
export function CustomAgentToolsPanel({ api }: { api?: CustomOptionsApi }) {
  const [items, setItems] = useState<CustomTool[]>([]), [name, setName] = useState(''), [target, setTarget] = useState('');
  const [kind, setKind] = useState<'web' | 'exe'>('web'), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  React.useEffect(() => { let active = true; void customResult<CustomTool[]>(api?.listCustomAgentTools?.()).then(value => { if (active) setItems(value); }).catch(error => { if (active) setMessage(error.message); }); return () => { active = false; }; }, [api]);
  async function run(work: () => Promise<void>) { setBusy(true); setMessage(''); try { await work(); } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); } }
  return <section className="panel"><h3>自定义 Agent 工具</h3>
    <p>添加网页或本机 EXE 启动入口。不会自动获得学生资料、成为默认任务执行器，或被视为支持联网研究；自动调用需另外适配并探测。</p>
    <label>名称<input value={name} maxLength={60} onChange={event => setName(event.target.value)} /></label>
    <label>类型<select value={kind} onChange={event => setKind(event.target.value as 'web' | 'exe')}><option value="web">HTTPS 网页</option><option value="exe">本机 EXE</option></select></label>
    <label>{kind === 'web' ? '网页地址' : 'EXE 完整路径'}<input value={target} onChange={event => setTarget(event.target.value)} placeholder={kind === 'web' ? 'https://...' : 'D:\\Apps\\Agent.exe'} /></label>
    <button disabled={busy || !name.trim() || !target.trim()} onClick={() => void run(async () => { setItems(await customResult<CustomTool[]>(api?.addCustomAgentTool?.({ name, kind, target }))); setName(''); setTarget(''); })}>添加工具</button>
    {items.map(item => <article className="agent-status-line" key={item.id}><div><strong>{item.name}</strong><p>{item.target}</p><small>手动启动 · 自动任务能力未验证</small></div><div className="actions"><button disabled={busy} onClick={() => void run(async () => { await customResult(api?.openCustomAgentTool?.(item.id)); setMessage('已请求打开工具；不代表联网研究可用。'); })}>打开</button><button disabled={busy} onClick={() => { if (window.confirm(`删除“${item.name}”入口？不卸载工具。`)) void run(async () => setItems(await customResult<CustomTool[]>(api?.removeCustomAgentTool?.(item.id)))); }}>删除入口</button></div></article>)}
    {message && <p role="status">{message}</p>}
  </section>;
}
