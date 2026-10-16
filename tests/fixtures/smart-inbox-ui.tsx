import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DownloadInboxPanel } from '../../src/DownloadInboxPanel';
import '../../src/styles.css';
const api = {
  smartInboxAction: async (action: string, input: unknown) => (await fetch('/__smart_inbox_test', { method: 'POST', body: JSON.stringify({ action, input }), headers: { 'Content-Type': 'application/json' } })).text(),
  listDownloadInboxFiles: async () => JSON.stringify({ ok: true, data: { folder: '', files: [], skipped: 0 } }),
};
function Fixture() {
  const [id, setId] = useState('test-a');
  return <main style={{ maxWidth: 1100, padding: 20, margin: 'auto', '--accent': '#0f766e', '--accent-dark': '#0f5e58', '--accent-rgb': '15,118,110', '--accent-soft': '#e6f4ef', '--accent-softer': '#f3faf8', '--accent-border': '#b9d9d2', '--panel-border': '#dbe5e1' } as React.CSSProperties}><p>隔离验收：虚构学生、临时资料、测试分类器</p><label>验收学生<select value={id} onChange={e => setId(e.target.value)}><option value="test-a">虚构学生甲</option><option value="test-b">虚构学生乙</option></select></label>
    <DownloadInboxPanel studentId={id} students={[{ id: 'test-a', name: '虚构学生甲' }, { id: 'test-b', name: '虚构学生乙' }]} projects={[{ id: 'project-physics', name: '物理研究', studentIds: ['test-a', 'test-b'] }]} api={api} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
