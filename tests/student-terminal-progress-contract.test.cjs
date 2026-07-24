const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { studentTerminalProgress } = require('../electron/student-terminal-progress.cjs')

const root = path.resolve(__dirname, '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

function localIso(year, month, day, hour = 12) {
  return new Date(year, month - 1, day, hour).toISOString()
}

test('student terminal progress reports today, weekly trend, monthly frequency and processed knowledge count', () => {
  const records = [
    { uploadedAt: localIso(2026, 7, 23), status: 'pending_digest' },
    { uploadedAt: localIso(2026, 7, 22), status: 'processed' },
    { uploadedAt: localIso(2026, 7, 20), status: 'processed' },
    { uploadedAt: localIso(2026, 7, 12), status: 'processed' },
  ]
  const progress = studentTerminalProgress(records, { lastDigestAt: localIso(2026, 7, 21) }, {
    now: new Date(2026, 6, 23, 18),
    normalizeStatus: (value) => value,
  })
  assert.equal(progress.submittedTodayCount, 1)
  assert.equal(progress.recentUploadCount7, 3)
  assert.equal(progress.previousUploadCount7, 1)
  assert.equal(progress.recentTrend, 2)
  assert.equal(progress.activeDays30, 4)
  assert.equal(progress.knowledgeAssetCount, 3)
  assert.equal(progress.newSinceLastDigestCount, 2)
})

test('Windows and Android student homes show a gentle daily reminder with one-step upload', () => {
  const windows = read('src/terminal-main.tsx')
  const android = read('android-tablet-terminal/src/com/qxmatrix/eduterminal/MainActivity.java')
  assert.match(windows, /记得提交本日学习资料/)
  assert.match(windows, /onClick=\{uploadFiles\}/)
  assert.match(windows, /稍后再说/)
  assert.match(android, /今日学习资料提醒/)
  assert.match(android, /dailyReminderUploadButton/)
  assert.match(android, /pickMaterial\(\)/)
  assert.match(android, /daily_reminder_dismissed_/)
})

test('Windows and Android explain progress as processed materials instead of overstating generated knowledge files', () => {
  const windows = read('src/terminal-main.tsx')
  const android = read('android-tablet-terminal/src/com/qxmatrix/eduterminal/MainActivity.java')
  assert.match(windows, /已完成知识化/)
  assert.match(windows, /已消化资料数/)
  assert.match(android, /已完成知识化/)
  assert.match(android, /近 30 天活跃/)
})

test('host student-session payload exposes one versioned progress object', () => {
  const host = read('electron/main.cjs')
  assert.match(host, /buildStudentTerminalProgress/)
  assert.match(host, /progress,/)
  assert.match(host, /knowledgeAssetCount: progress\.knowledgeAssetCount/)
})
