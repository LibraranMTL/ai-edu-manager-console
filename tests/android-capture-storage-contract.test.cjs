const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

test('Android capture sessions are stored below a student-specific directory', () => {
  const service = read('android-tablet-terminal/src/com/qxmatrix/eduterminal/CaptureProjectionService.java')
  const storage = read('android-tablet-terminal/src/com/qxmatrix/eduterminal/CaptureStorage.java')
  assert.match(service, /new File\(CaptureStorage\.studentDir\(this, studentId\), sessionId\)/)
  assert.match(storage, /static String studentKey\(String studentId\)/)
  assert.match(storage, /clean \+ "-" \+ Integer\.toHexString\(source\.hashCode\(\)\)/)
  assert.match(storage, /static boolean isInside\(File child, File parent\)/)
})

test('Android capture session and image metadata retain student and project attribution', () => {
  const service = read('android-tablet-terminal/src/com/qxmatrix/eduterminal/CaptureProjectionService.java')
  assert.match(service, /edu-manager\.android-capture-session\.v1/)
  assert.match(service, /metadata\.put\("studentId", studentId\)/)
  assert.match(service, /metadata\.put\("projectId", projectId\)/)
  assert.match(service, /metadata\.put\("status", status\)/)
  assert.match(service, /writeSessionMetadata\(status\)/)
})

test('Android capture manager only exposes current-student files and preserves unuploaded captures', () => {
  const activity = read('android-tablet-terminal/src/com/qxmatrix/eduterminal/MainActivity.java')
  assert.match(activity, /查看与清理采集资料/)
  assert.match(activity, /showCaptureManager\(\)/)
  assert.match(activity, /CaptureStorage\.studentDir\(this, selectedStudent\.id\)/)
  assert.match(activity, /清理当前学生已上传图片/)
  assert.match(activity, /prefs\.getStringSet\("uploaded_paths"/)
  assert.match(activity, /CaptureStorage\.isInside\(image, allowedRoot\)/)
  assert.match(activity, /isActiveCaptureSession\(session\)/)
  assert.match(activity, /旧采集会话。为避免串档，这里不显示其中内容/)
})

test('Android build includes capture storage helper', () => {
  const build = read('android-tablet-terminal/build.ps1')
  assert.match(build, /CaptureStorage\.java/)
})
