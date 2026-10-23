const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function read(...segments) {
  return fs.readFileSync(path.join(root, ...segments), 'utf8');
}

const clients = [
  {
    name: 'student',
    root: 'android-tablet-terminal',
    packagePath: ['src', 'com', 'qxmatrix', 'eduterminal'],
    capturePlatform: 'android-student-terminal',
  },
  {
    name: 'teacher',
    root: 'android-teacher-terminal',
    packagePath: ['src', 'com', 'qxmatrix', 'eduteacher'],
    capturePlatform: 'android-teacher-terminal',
  },
];

test('Android student and teacher terminals schedule only consented capture sessions for background delivery', () => {
  for (const client of clients) {
    const manifest = read(client.root, 'AndroidManifest.xml');
    const activity = read(client.root, ...client.packagePath, 'MainActivity.java');
    const service = read(client.root, ...client.packagePath, 'CaptureProjectionService.java');
    const delivery = read(client.root, ...client.packagePath, 'CaptureAutoDeliveryJobService.java');

    assert.match(manifest, /CaptureAutoDeliveryJobService/u, client.name);
    assert.match(manifest, /android\.permission\.BIND_JOB_SERVICE/u, client.name);
    assert.match(activity, /PREF_CAPTURE_AUTO_DELIVERY_DEFAULT/u, client.name);
    assert.match(activity, client.name === 'student' ? /采集结束后自动收集/u : /采集结束后自动投递/u, client.name);
    assert.match(activity, /putExtra\("auto_delivery", pendingCaptureAutoDelivery\)/u, client.name);
    assert.match(service, /autoDelivery = intent\.getBooleanExtra\("auto_delivery", false\)/u, client.name);
    assert.match(service, /CaptureAutoDeliveryJobService\.schedule\(this, sessionDir\)/u, client.name);
    assert.match(service, /metadata\.put\("autoDelivery", autoDelivery\)/u, client.name);
    assert.match(service, /metadata\.put\("sequence", savedCount\)/u, client.name);
    assert.match(delivery, client.name === 'student'
      ? /setRequiredNetworkType\(JobInfo\.NETWORK_TYPE_NONE\)/u
      : /setRequiredNetworkType\(JobInfo\.NETWORK_TYPE_ANY\)/u, client.name);
    assert.match(delivery, /CaptureStorage\.isInside\(sessionDir, CaptureStorage\.studentDir\(context, studentId\)\)/u, client.name);
    if (client.name === 'student') {
      assert.match(delivery, /new StudentCollectionInbox/u, client.name);
      assert.match(delivery, /android_screen_capture/u, client.name);
    } else {
      assert.match(delivery, /android_screen_capture_auto/u, client.name);
      assert.match(delivery, new RegExp(`capturePlatform=${client.capturePlatform}`, 'u'), client.name);
      assert.match(delivery, /capture-sessions.*\/complete/u, client.name);
    }
    assert.match(delivery, /expectedItemCount/u, client.name);
    assert.match(delivery, /captureSequence/u, client.name);
    assert.match(delivery, /captureHighlighted/u, client.name);
    assert.match(delivery, /courseStartedAt/u, client.name);
    assert.match(delivery, /jobFinished\(params, retry\)/u, client.name);
  }
});

test('edge capture delivery retains scope and does not broaden Android conversation collection', () => {
  const host = read('electron', 'main.cjs');
  const attribution = read('electron', 'remote-capture-attribution.cjs');
  assert.match(attribution, /android-student-terminal/u);
  assert.match(attribution, /android-teacher-terminal/u);
  assert.match(host, /remoteCaptureAttribution\(url, student, project, request\.authContext\?\.deviceId\)/u);
  assert.match(host, /远端采集会话设备来源不一致/u);
  assert.match(host, /远端采集会话设备身份不一致/u);
  assert.match(host, /platform: String\(current\?\.platform \|\| incoming\.platform/u);
  for (const client of clients) {
    const activity = read(client.root, ...client.packagePath, 'MainActivity.java');
    const delivery = read(client.root, ...client.packagePath, 'CaptureAutoDeliveryJobService.java');
    assert.match(delivery, /"project"\.equals\(targetType\)/u, client.name);
    assert.match(delivery, /studentId/u, client.name);
    assert.match(activity, /intent\.getCharSequenceExtra\(Intent\.EXTRA_TEXT\)/u, client.name);
    if (client.name === 'student') {
      assert.match(activity, /previewConversationLink\(text\)/u, client.name);
      assert.match(activity, /\/api\/student-session\/conversation-link\/preview/u, client.name);
    } else {
      assert.match(activity, /当前分享只有链接，请复制对话正文后再粘贴/u, client.name);
    }
    assert.doesNotMatch(activity, /scanPrivateConversationDatabase|AccessibilityService|NotificationListenerService/u, client.name);
  }
});
