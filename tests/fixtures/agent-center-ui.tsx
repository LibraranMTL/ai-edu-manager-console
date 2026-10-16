import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentControlCenter } from '../../src/AgentControlCenter';
import ExternalAgentConnector from '../../src/ExternalAgentConnector';
import '../../src/styles.css';
const students = [{ id: 'test-a', name: '合成学生甲' }, { id: 'test-b', name: '合成学生乙' }];
const projects = [{ id: 'project-a', name: '甲的合成项目', studentIds: ['test-a'] }];
const api = { agentControlAction: async (action: string, input: unknown) => (await fetch('/__agent_center_test', { method: 'POST', body: JSON.stringify({ action, input }) })).text() };
function App() { const [studentId, setStudentId] = useState('test-a'); return <main style={{ maxWidth: 1180, margin: '24px auto', padding: 16 }}><section className="panel"><h2>Agent连接管理</h2><button onClick={() => void api.agentControlAction('syntheticOpen', {})}>验收夹具：发起合成外部会话</button><ExternalAgentConnector api={api} /></section><AgentControlCenter key={studentId} api={api} studentId={studentId} students={students} projects={projects} onStudentChange={setStudentId} /></main>; }
createRoot(document.getElementById('root')!).render(<App />);
