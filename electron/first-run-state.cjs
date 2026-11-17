'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { writeJsonAtomic } = require('./project-materials.cjs');

const SCHEMA = 'edu-manager.first-run.v1';
const STEPS = ['welcome', 'agent', 'consent', 'connection', 'student', 'material', 'complete'];

function inspectStudentIndex(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(value)) throw Error('学生索引格式无效');
    return { status: 'ready', count: value.length };
  } catch (error) {
    if (error.code === 'ENOENT') return { status: 'missing', count: 0 };
    return { status: 'error', message: '学生档案读取失败，请检查或恢复原有数据。' };
  }
}

function inspectFirstRun({ studentIndex, policyFiles, stateFile, ready }) {
  if (!ready) return { status: 'waiting' };
  const students = inspectStudentIndex(studentIndex);
  if (students.status === 'error') return { status: 'error', message: students.message };
  let state;
  try {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (state.schema !== SCHEMA || !STEPS.includes(state.step)) throw Error('invalid state');
  } catch (error) {
    if (error.code !== 'ENOENT') return { status: 'error', message: '首次引导状态读取失败，请检查本机数据。' };
  }
  if (state) return { status: state.step === 'complete' ? 'complete' : state.paused ? 'paused' : 'resume', state, students };
  if (students.count || policyFiles.some(file => fs.existsSync(file))) return { status: 'existing', students };
  return { status: 'new', students };
}

async function saveFirstRun(stateFile, input) {
  if (!STEPS.includes(input.step)) throw Error('无效的引导步骤');
  if (input.provider !== undefined && !['workbuddy', 'codex'].includes(input.provider)) throw Error('无效的 Agent');
  const state = { schema: SCHEMA, step: input.step,
    ...(input.provider ? { provider: input.provider } : {}), paused: input.paused === true, updatedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  await writeJsonAtomic(stateFile, state);
  return state;
}

module.exports = { SCHEMA, STEPS, inspectStudentIndex, inspectFirstRun, saveFirstRun };
