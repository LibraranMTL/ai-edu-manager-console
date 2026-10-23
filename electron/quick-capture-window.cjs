'use strict';

const ROUTES = Object.freeze({
  screen: 'screen-capture',
  photo: 'photo-upload',
  audio: 'audio-capture',
  import: 'materials-import',
  inbox: 'share-capture',
  conversation: 'conversation-collection',
  automatic: 'session-auto-capture',
  archive: 'learning-materials',
});

function routeForAction(action) {
  return ROUTES[String(action || '')] || '';
}

function normalizeQuickCaptureAction(action) {
  const value = String(action || '');
  return Object.prototype.hasOwnProperty.call(ROUTES, value) ? value : '';
}

function clampQuickCaptureBounds(workArea, bounds) {
  const width = Math.min(Math.max(Number(bounds.width) || 252, 252), Math.max(252, workArea.width));
  const height = Math.min(Math.max(Number(bounds.height) || 29, 29), Math.max(29, workArea.height));
  const requestedX = Number.isFinite(Number(bounds.x)) ? Number(bounds.x) : workArea.x;
  const requestedY = Number.isFinite(Number(bounds.y)) ? Number(bounds.y) : workArea.y;
  return {
    x: Math.round(Math.max(workArea.x, Math.min(requestedX, workArea.x + workArea.width - width))),
    y: Math.round(Math.max(workArea.y, Math.min(requestedY, workArea.y + workArea.height - height))),
    width,
    height,
  };
}

function locateQuickCaptureBounds(mainBounds, workArea, width = 252, height = 29) {
  const centeredX = Number(mainBounds?.x || 0) + Math.round((Number(mainBounds?.width || width) - width) / 2);
  const belowHeaderY = Number(mainBounds?.y || 0) + 72;
  return clampQuickCaptureBounds(workArea, { x: centeredX, y: belowHeaderY, width, height });
}

function publicQuickCaptureState({ student, session, visible, expanded, activeAction = '', pendingCount = 0, countStatus = 'unknown', companion = null }) {
  return {
    visible: Boolean(visible),
    expanded: Boolean(expanded),
    activeAction: normalizeQuickCaptureAction(activeAction),
    studentId: String(student?.id || ''),
    studentName: String(student?.name || '').slice(0, 24),
    capture: session ? {
      id: String(session.id || ''),
      studentId: String(session.studentId || ''),
      studentName: String(session.studentName || '').slice(0, 24),
      status: String(session.status || ''),
      screenshotCount: Number(session.screenshotCount) || 0,
      sourceName: String(session.sourceName || '').slice(0, 48),
    } : null,
    pendingCount: Math.max(0, Number(pendingCount) || 0),
    countStatus: String(countStatus || 'unknown'),
    companion: companion && typeof companion === 'object' ? companion : null,
  };
}

module.exports = { routeForAction, normalizeQuickCaptureAction, clampQuickCaptureBounds, locateQuickCaptureBounds, publicQuickCaptureState };
