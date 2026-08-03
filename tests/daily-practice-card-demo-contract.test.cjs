const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const demoRoot = path.join(root, 'prototypes', 'daily-practice-card-demo');
const html = fs.readFileSync(path.join(demoRoot, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(demoRoot, 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(demoRoot, 'styles.css'), 'utf8');
const plan = fs.readFileSync(path.join(root, 'docs', 'delivery', '每天10分钟提分卡片开发计划.md'), 'utf8');

test('daily practice card demo exposes image, monochrome, and long-card controls', () => {
  assert.match(html, /data-view="long">长卡片/);
  assert.match(html, /id="monochromeToggle"/);
  assert.match(html, /value="png">PNG 高清图片/);
  assert.match(html, /value="jpg">JPG 通用图片/);
  assert.match(html, /value="pdf">PDF 打印文件/);
  assert.match(html, /class="long-card-extension"/);
});

test('long card uses a bounded 1.7x mobile layout and monochrome has dedicated simplification rules', () => {
  assert.match(styles, /data-view="mobile"[\s\S]*?device-shell\s*\{\s*width:\s*344px/);
  assert.match(styles, /data-view="long"[\s\S]*?device-shell\s*\{\s*width:\s*344px/);
  assert.match(styles, /data-view="long"[\s\S]*?aspect-ratio:\s*9\s*\/\s*27/);
  assert.match(script, /mobile:\s*\[720,\s*1280\]/);
  assert.match(script, /long:\s*\[720,\s*2160\]/);
  assert.match(styles, /data-color="mono"[\s\S]*?background:\s*#fff\s*!important/);
  assert.match(styles, /data-color="mono"[\s\S]*?\.orbit[\s\S]*?display:\s*none/);
  assert.match(styles, /data-color="mono"[\s\S]*?answer-options button\.correct[\s\S]*?outline/);
});

test('demo exports PNG and JPG images while routing PDF to print preview', () => {
  assert.match(script, /canvas\.toBlob\(resolve, mimeType, quality\)/);
  assert.match(script, /link\.download = `今日提分卡-STU-2026-0051-\$\{activeView\}\.\$\{format\}`/);
  assert.match(script, /format === 'pdf'[\s\S]*?window\.print\(\)/);
  assert.match(script, /dataset\.color = isMonochrome \? 'mono' : 'color'/);
});

test('development plan carries the three new output requirements into contracts and QA', () => {
  assert.match(plan, /PNG、JPG 图片下载与 PDF 输出/);
  assert.match(plan, /长卡片高度为普通手机卡的 1\.5—2 倍/);
  assert.match(plan, /不能只做机械灰度转换/);
  assert.match(plan, /58 mm 和 80 mm 两种纸宽/);
  assert.match(plan, /`layoutProfile`/);
  assert.match(plan, /`colorMode`/);
});
