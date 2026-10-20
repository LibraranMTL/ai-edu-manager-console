'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const endpoint = fs.readFileSync(path.join(root, 'android-standalone-manager/app/src/main/java/com/qxmatrix/edumanager/standalone/CloudServiceEndpoint.kt'), 'utf8');
const sync = fs.readFileSync(path.join(root, 'android-standalone-manager/app/src/main/java/com/qxmatrix/edumanager/standalone/CloudReportSync.kt'), 'utf8');
const activity = fs.readFileSync(path.join(root, 'android-standalone-manager/app/src/main/java/com/qxmatrix/edumanager/standalone/MainActivity.kt'), 'utf8');

test('Android standalone uses the public Alibaba Cloud reverse-proxy endpoint, never its loopback port', () => {
  assert.match(endpoint, /OFFICIAL_BASE_URL = "https:\/\/www\.greatbg\.com\/edu-cloud"/);
  assert.match(endpoint, /HEALTH_SERVICE_ID = "edu-cloud-documents"/);
  assert.match(sync, /enrollOfficial\(studentId: String, code: String\)/);
  assert.match(sync, /checkOfficialConnection\(\)/);
  assert.doesNotMatch(endpoint, /123\.56\.83\.50|127\.0\.0\.1:8755/);
});

test('ordinary Android enrollment fixes the service address and keeps legacy migration explicit', () => {
  assert.match(activity, /阿里云正式服务/);
  assert.match(activity, /enrollOfficial\(student\.id, value\)/);
  assert.match(activity, /切换到阿里云正式服务/);
  assert.match(activity, /本机报告不会删除/);
  assert.doesNotMatch(activity, /hint = "云端文档服务地址（HTTPS）"/);
  assert.match(sync, /fun switchToOfficialService\(\): Int/);
  assert.match(sync, /prefs\.edit\(\)\.clear\(\)\.putString\("server", CloudServiceEndpoint\.OFFICIAL_BASE_URL\)/);
});
