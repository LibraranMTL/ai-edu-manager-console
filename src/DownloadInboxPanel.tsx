import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CaptureApi } from './CaptureInboxPanel';
const CaptureInboxPanel = React.lazy(() => import('./CaptureInboxPanel').then(module => ({ default: module.CaptureInboxPanel })));
type DownloadFile = { fileId: string; name: string; type: string; byteSize: number; modifiedAt: string; status: string; message: string; supported: boolean; selectable: boolean; targetName?: string; archivePath?: string };
type Result = { results: { ok: boolean; message?: string; status?: string }[]; canceled?: boolean };
export type DownloadInboxApi = CaptureApi & {
  getDownloadInboxSettings?: () => Promise<string>;
  configureDownloadInbox?: (action: 'choose' | 'disconnect') => Promise<string>;
  listDownloadInboxFiles?: () => Promise<string>;
  deliverDownloadInboxFiles?: (ids: string[], target: { studentId: string; type: 'student' | 'project'; id?: string }) => Promise<string>;
  trashDownloadInboxFiles?: (ids: string[]) => Promise<string>;
  openDownloadInboxFolder?: () => Promise<string>;
};
const labels: Record<string, string> = { pending: '待处理', preparing: '准备中', delivering: '投递中', interrupted: '上次未完成，可重试', failed: '投递失败，可重试', archive_pending: '已投递，原件待归档', delivered: '已投递并归档' };
async function unwrap<T>(work?: Promise<string>): Promise<T> {
  if (!work) throw Error('此功能需要更新后的 Windows 主机');
  const value = JSON.parse(await work); if (!value.ok) throw Error(value.message || '操作失败'); return value.data;
}
export function DownloadInboxPanel({ studentId, students, projects, api }: {
  studentId: string; students: { id: string; name: string }[];
  projects: { id: string; name: string; studentIds: string[]; status?: string }[]; api?: DownloadInboxApi;
}) {
  const [tab, setTab] = useState<'downloads' | 'shares'>('downloads');
  const [folder, setFolder] = useState(''), [files, setFiles] = useState<DownloadFile[]>([]), [skipped, setSkipped] = useState(0);
  const [selected, setSelected] = useState<string[]>([]), [targetStudent, setTargetStudent] = useState(''), [target, setTarget] = useState('student');
  const [search, setSearch] = useState(''), [filter, setFilter] = useState('pending'), [sort, setSort] = useState('latest'), [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const mounted = useRef(false), generation = useRef(0), running = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  useEffect(() => { setSelected([]); setTargetStudent(''); setTarget('student'); }, [studentId]);
  async function refresh() {
    const request = ++generation.current;
    const value = await unwrap<{ folder: string; files: DownloadFile[]; skipped: number }>(api?.listDownloadInboxFiles?.());
    if (mounted.current && request === generation.current) { setFolder(value.folder); setFiles(value.files); setSkipped(value.skipped); setSelected([]); }
  }
  useEffect(() => { void refresh().catch(error => { if (mounted.current) setMessage(error.message); }); }, []);
  async function run(work: () => Promise<void>) {
    if (running.current) return;
    running.current = true; setBusy(true); setMessage('');
    try { await work(); } catch (error) { if (mounted.current) setMessage((error as Error).message); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  const availableProjects = projects.filter(project => project.studentIds.map(String).includes(targetStudent) && !['sealed', 'archived'].includes(project.status || ''));
  const visible = useMemo(() => files.filter(file => (filter === 'all' || (filter === 'delivered' ? file.status === 'delivered' : file.status !== 'delivered'))
    && file.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : sort === 'size' ? b.byteSize - a.byteSize : b.modifiedAt.localeCompare(a.modifiedAt)), [files, filter, search, sort]);
  const pages = Math.max(1, Math.ceil(visible.length / 25)), activePage = Math.min(page, pages), rows = visible.slice((activePage - 1) * 25, activePage * 25);
  function select(id: string, checked: boolean) { setSelected(value => checked ? [...value.filter(item => item !== id), id] : value.filter(item => item !== id)); }
  async function configure(action: 'choose' | 'disconnect') {
    const result = await unwrap<{ folder: string; canceled?: boolean }>(api?.configureDownloadInbox?.(action));
    if (!result.canceled && mounted.current) { setSelected([]); setTargetStudent(''); setTarget('student'); setPage(1); await refresh(); }
  }
  async function process(action: 'deliver' | 'trash') {
    const ids = [...selected];
    const destination = { studentId: targetStudent, type: target === 'student' ? 'student' as const : 'project' as const, ...(target === 'student' ? {} : { id: target }) };
    const value = await unwrap<Result>(action === 'deliver' ? api?.deliverDownloadInboxFiles?.(ids, destination) : api?.trashDownloadInboxFiles?.(ids));
    if (value.canceled) { if (mounted.current) setMessage('已取消回收'); return; }
    await refresh();
    if (mounted.current) setMessage(`完成 ${value.results.filter(item => item.ok).length} 项；未完成 ${value.results.filter(item => !item.ok).length} 项。${value.results.filter(item => !item.ok).map(item => item.message).join('；')}`);
  }
  return <section className="panel" aria-label="资料收件箱">
    <div className="panel-heading"><div><h2>资料收件箱</h2><p>先归集，再选择学生与项目投递。浏览下载文件不会移动或上传原件。</p></div></div>
    <div className="actions" role="tablist" aria-label="资料收件箱来源">
      <button role="tab" aria-selected={tab === 'downloads'} className={tab === 'downloads' ? 'primary' : 'secondary'} onClick={() => setTab('downloads')}>下载文件</button>
      <button role="tab" aria-selected={tab === 'shares'} className={tab === 'shares' ? 'primary' : 'secondary'} onClick={() => setTab('shares')}>分享资料</button>
    </div>
    {tab === 'shares' ? studentId ? <React.Suspense fallback={<p>正在加载分享资料…</p>}><CaptureInboxPanel key={studentId} studentId={studentId} mode="share" api={api}
      projects={projects.filter(project => project.studentIds.map(String).includes(studentId) && !['sealed', 'archived'].includes(project.status || ''))} /></React.Suspense> : <p>请先选择或新建学生档案，分享资料按学生隔离。</p> : <>
      <section className="material-source-panel"><strong>下载文件收件箱</strong><p style={{ overflowWrap: 'anywhere' }}>{folder || '尚未关联文件夹'}</p>
        <div className="actions"><button className="primary" disabled={busy} onClick={() => void run(() => configure('choose'))}>{folder ? '更换文件夹' : '选择／新建文件夹'}</button>
          <button className="secondary" disabled={busy || !folder} onClick={() => void run(async () => { await unwrap(api?.openDownloadInboxFolder?.()); })}>打开文件夹</button>
          <button className="secondary" disabled={busy || !folder} onClick={() => void run(refresh)}>刷新</button>
          <button className="secondary" disabled={busy || !folder} onClick={() => void run(() => configure('disconnect'))}>断开关联</button></div>
        <p>在 WPS 的“另存为”或浏览器下载保存时选择此目录。可在资源管理器中右键文件夹，手动固定到“快速访问／主页”。本功能不改变其他软件的保存设置。</p>
        <p>只列出直接文件，不扫描子目录；成功投递后原件移入此目录下的“已投递”，失败保留原件。临时文件、链接或仍在写入的文件已跳过 {skipped} 项。</p>
      </section>
      {folder ? <>
        <div className="form-grid"><label>搜索文件<input aria-label="搜索下载文件" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label>
          <label>浏览状态<select value={filter} onChange={event => { setFilter(event.target.value); setPage(1); setSelected([]); }}><option value="pending">待处理</option><option value="delivered">已投递</option><option value="all">全部</option></select></label>
          <label>排序<select value={sort} onChange={event => { setSort(event.target.value); setPage(1); }}><option value="latest">最近修改优先</option><option value="name">文件名</option><option value="size">文件大小</option></select></label></div>
        <div className="form-grid"><label>投递学生<select aria-label="投递学生" disabled={busy || !studentId} value={targetStudent} onChange={event => { setTargetStudent(event.target.value); setTarget('student'); }}><option value="">请选择学生</option>{students.map(student => <option key={student.id} value={student.id}>{student.name}</option>)}</select></label>
          <label>投递位置<select aria-label="投递位置" disabled={busy || !targetStudent} value={target} onChange={event => setTarget(event.target.value)}><option value="student">学生原始资料库</option>{availableProjects.map(project => <option key={project.id} value={project.id}>{project.name} · 项目收件箱</option>)}</select></label></div>
        {!studentId ? <p>没有当前学生，可以浏览和回收下载文件；选择当前学生后才能投递。</p> : null}
        <div className="actions"><button className="secondary" disabled={busy || !rows.some(file => file.selectable)} onClick={() => setSelected(value => [...new Set([...value, ...rows.filter(file => file.selectable).map(file => file.fileId)])])}>全选当前页</button>
          <button className="secondary" disabled={busy || !selected.length} onClick={() => setSelected([])}>清空选择</button>
          <button className="primary" disabled={busy || !studentId || !targetStudent || !selected.length || selected.some(id => !files.find(file => file.fileId === id)?.supported)} onClick={() => void run(() => process('deliver'))}>投递选中资料／重试归档</button>
          <button className="secondary" disabled={busy || !selected.length} onClick={() => void run(() => process('trash'))}>移入 Windows 回收站</button></div>
        <p>共 {visible.length} 项 · 已选择 {selected.length} 项 · 每批最多 100 项{busy ? ' · 正在处理，请等待结果；后台目标不会随学生切换改变' : ''}</p>
        <div style={{ overflow: 'auto', maxHeight: 'min(45vh, 360px)' }}><table style={{ width: '100%', textAlign: 'left' }}><thead><tr><th>选择</th><th>文件名</th><th>类型／大小</th><th>修改时间</th><th>处理状态</th></tr></thead><tbody>{rows.map(file => <tr key={file.fileId}>
          <td><input type="checkbox" style={{ width: 18, height: 18, minHeight: 18, padding: 0 }} aria-label={`选择 ${file.name}`} disabled={busy || !file.selectable} checked={selected.includes(file.fileId)} onChange={event => select(file.fileId, event.target.checked)} /></td>
          <td style={{ maxWidth: 280, overflowWrap: 'anywhere' }}>{file.name}</td><td>{file.type || '未知'} · {(file.byteSize / 1024 / 1024).toFixed(2)} MiB</td><td>{new Date(file.modifiedAt).toLocaleString()}</td>
          <td>{labels[file.status] || file.status}{file.targetName ? <div>{file.targetName}</div> : null}{file.message ? <div>{file.message}</div> : null}{file.archivePath ? <div style={{ maxWidth: 280, overflowWrap: 'anywhere' }}>原件：{file.archivePath}</div> : null}</td>
        </tr>)}</tbody></table></div>
        {!rows.length ? <p>当前没有符合条件的文件。保存或下载到上述文件夹后，点击刷新。</p> : null}
        <div className="actions"><button className="secondary" disabled={activePage <= 1} onClick={() => setPage(activePage - 1)}>上一页</button><span>{activePage} / {pages}</span><button className="secondary" disabled={activePage >= pages} onClick={() => setPage(activePage + 1)}>下一页</button></div>
      </> : null}
    </>}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
