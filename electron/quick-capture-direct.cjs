'use strict';
const { randomUUID } = require('node:crypto');

// Owns short-lived setup contexts. Renderers cannot choose another student's identity.
function createQuickCaptureDirect({ currentStudent, findStudent, projects, sources, startScreen, receivePhoto, takeScreenshot, receiveScreenshot }) {
  let screenContext = null;
  let generation = 0;
  let starting = false;
  let shot = null;
  const photos = new Map();
  function student() {
    const value = findStudent(String(currentStudent() || ''));
    if (!value) throw Error('请先选择有效学生。');
    return { id: String(value.id), name: String(value.name || '') };
  }
  function invalidateScreen() { generation++; screenContext = null; shot = null; }
  function assertScreen(token) {
    if (!screenContext || screenContext.token !== token || student().id !== screenContext.student.id) {
      throw Error('学生或采集设置已变化，请重新打开屏幕采集。');
    }
  }
  function assertProject(owner, projectId) {
    if (projectId && !projects().some(p => String(p.id) === projectId && (p.studentIds || []).map(String).includes(owner.id) && !['sealed', 'archived'].includes(p.status))) {
      throw Error('项目未关联当前学生或已封存，请重新选择。');
    }
  }
  return {
    invalidateScreen,
    async prepareScreen() {
      const revision = ++generation;
      screenContext = null; shot = null;
      const owner = student();
      const available = await sources();
      if (revision !== generation || student().id !== owner.id) throw Error('学生已切换，请重新打开屏幕采集。');
      screenContext = { token: randomUUID(), student: owner };
      return { ...screenContext, sources: available,
        projects: projects().filter(p => (p.studentIds || []).map(String).includes(owner.id) && !['sealed', 'archived'].includes(p.status))
          .map(p => ({ id: String(p.id), name: String(p.name || '') })) };
    },
    async screenshot(input = {}) {
      if (starting) throw Error('屏幕采集正在执行，请稍候。');
      assertScreen(input.token);
      const owner = screenContext.student, sourceId = String(input.sourceId || ''), projectId = String(input.projectId || '');
      if (!sourceId) throw Error('请选择要截取的屏幕或窗口。');
      assertProject(owner, projectId);
      starting = true; shot = null;
      try {
        const result = await takeScreenshot(sourceId, () => { assertScreen(input.token); assertProject(owner, projectId); });
        assertScreen(input.token); assertProject(owner, projectId);
        if (!Buffer.isBuffer(result.bytes) || result.bytes.length < 8 || result.bytes.length > 20 * 1024 * 1024 || result.bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw Error('截图无效或超过 20 MiB，请选择较小窗口。');
        shot = { id: randomUUID(), token: input.token, owner, projectId, ...result };
        return { ok: true, shotId: shot.id, preview: `data:image/png;base64,${shot.bytes.toString('base64')}`, student: owner, projectId, capturedAt: shot.capturedAt };
      } finally { starting = false; }
    },
    async saveScreenshot(input = {}) {
      assertScreen(input.token);
      const current = shot;
      if (!current || current.id !== input.shotId || current.token !== input.token) throw Error('截图预览已失效，请重新截取。');
      assertProject(current.owner, current.projectId);
      // Keep the same submission ID and bytes after a failed/uncertain save.
      return receiveScreenshot(current.owner.id, { name: `截屏-${current.id}.png`, bytes: current.bytes, sourceChannel: 'screen',
        sourceEventId: `quick-screen:${current.id}`, captureSourceName: current.sourceName, capturedAt: current.capturedAt,
        suggestedTarget: current.projectId ? { type: 'project', id: current.projectId } : { type: 'student' } });
    },
    async start(input = {}) {
      if (starting) throw Error('屏幕采集正在启动，请稍候。');
      assertScreen(input.token);
      const owner = screenContext.student;
      const sourceId = String(input.sourceId || '');
      if (!sourceId) throw Error('请选择要采集的屏幕或窗口。');
      const projectId = String(input.projectId || '');
      if (projectId && !projects().some(p => String(p.id) === projectId && (p.studentIds || []).map(String).includes(owner.id) && !['sealed', 'archived'].includes(p.status))) {
        throw Error('项目未关联当前学生或已封存，请重新选择。');
      }
      const durationMinutes = Number(input.durationMinutes);
      if (![15, 30, 60, 90, 120].includes(durationMinutes) || !['smart', 'change', 'interval'].includes(input.mode)) throw Error('请选择有效的采集时长和策略。');
      starting = true;
      try {
        const result = await startScreen({ studentId: owner.id, sourceId, projectId, durationMinutes, mode: input.mode }, () => assertScreen(input.token));
        if (result.ok) invalidateScreen();
        return result;
      } finally { starting = false; }
    },
    createPhotoSession() {
      const context = { token: randomUUID(), student: student() };
      photos.set(context.token, context);
      return context;
    },
    closePhoto(token) { photos.delete(token); },
    async savePhoto(token, input = {}) {
      const context = photos.get(token);
      if (!context || !findStudent(context.student.id)) throw Error('拍照会话或学生已失效，请重新打开拍照窗。');
      if (!/^[a-f0-9-]{36}$/i.test(String(input.shotId || ''))) throw Error('照片提交编号无效。');
      if (typeof input.base64 !== 'string' || input.base64.length > 28 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64)) throw Error('照片数据无效或超过 20 MiB。');
      const bytes = Buffer.from(input.base64, 'base64');
      if (bytes.length < 4 || bytes.length > 20 * 1024 * 1024 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw Error('照片须为有效的 JPEG，且不超过 20 MiB。');
      return receivePhoto(context.student.id, { name: `照片-${input.shotId}.jpg`, bytes, sourceChannel: 'photo', sourceEventId: `quick-photo:${token}:${input.shotId}` });
    },
  };
}
module.exports = { createQuickCaptureDirect };
