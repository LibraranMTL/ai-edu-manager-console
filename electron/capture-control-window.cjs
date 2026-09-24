function captureControlBounds(workArea, width, height) {
  const margin = 20;
  return {
    width,
    height,
    x: Math.round(workArea.x + Math.max(0, workArea.width - width - margin)),
    y: Math.round(workArea.y + Math.max(0, workArea.height - height - margin)),
  };
}

function loadVisibleCaptureControlWindow(window, html, isCurrent, onError = console.warn) {
  const reveal = () => {
    if (!isCurrent() || window.isDestroyed()) return;
    if (!window.isVisible()) window.showInactive();
    window.setAlwaysOnTop(true, 'floating');
  };
  let loading;
  try {
    loading = window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  } catch (error) {
    onError(error);
  }
  // A hidden transparent window must not depend solely on ready-to-show firing.
  reveal();
  if (loading) Promise.resolve(loading).then(reveal, onError);
}

module.exports = { captureControlBounds, loadVisibleCaptureControlWindow };
