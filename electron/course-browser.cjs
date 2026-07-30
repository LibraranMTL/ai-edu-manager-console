const crypto = require('crypto');
const { safeCourseNavigation } = require('./course-catalog.cjs');

function coursePartition(courseId) {
  const suffix = crypto.createHash('sha256').update(String(courseId || '')).digest('hex').slice(0, 20);
  return `course-${suffix}`;
}

function secureCourseWebPreferences(partition) {
  return {
    partition,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    plugins: false,
  };
}

function installCourseGuards(webContents, course, courseSession, onBlocked = () => {}) {
  const allowedHosts = course.allowedHosts || [];
  const guard = (event, url) => {
    const result = safeCourseNavigation(url, allowedHosts);
    if (!result.ok) {
      event?.preventDefault?.();
      onBlocked({ url, ...result });
      return false;
    }
    return true;
  };
  webContents.setWindowOpenHandler(({ url }) => {
    if (guard(null, url)) void webContents.loadURL(url);
    return { action: 'deny' };
  });
  webContents.on('will-navigate', guard);
  webContents.on('will-redirect', guard);
  webContents.on('will-attach-webview', (event) => event.preventDefault());
  courseSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  courseSession.setPermissionCheckHandler(() => false);
  courseSession.removeAllListeners('will-download');
  courseSession.on('will-download', (event) => {
    event.preventDefault();
    onBlocked({ code: 'COURSE_DOWNLOAD_BLOCKED', message: '课程页面下载已阻止。' });
  });
  return guard;
}

module.exports = {
  coursePartition,
  installCourseGuards,
  secureCourseWebPreferences,
};
