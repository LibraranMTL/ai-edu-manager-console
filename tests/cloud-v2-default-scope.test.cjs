const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const web = fs.readFileSync(path.join(root, 'cloud-report-web/src/main.tsx'), 'utf8');
const windows = fs.readFileSync(path.join(root, 'src/CloudDocumentsPanel.tsx'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'electron/cloud-report-runtime.cjs'), 'utf8');
const android = fs.readFileSync(path.join(root,
  'android-standalone-manager/app/src/main/java/com/qxmatrix/edumanager/standalone/CloudReportSync.kt'), 'utf8');

test('v2 defaults keep profile fields enabled but do not silently grant four new material categories', () => {
  assert.match(web, /downloadProfileFields[^\n]+profileFieldOptions\.map/);
  assert.match(web, /downloadCategories[^\n]+\['learning_report'\]/);
  assert.doesNotMatch(web, /downloadCategories[^\n]+materialCategoryOptions\.map/);

  assert.match(windows, /defaultMaterialCategories\s*=\s*\['learning_report'\]/);
  assert.match(runtime, /DEFAULT_MATERIAL_CATEGORIES\s*=\s*Object\.freeze\(\['learning_report'\]\)/);
  assert.match(runtime, /MATERIAL_CATEGORIES\s*=\s*Object\.freeze\(\['learning_report', 'learning_material', 'topic_suggestion', 'competition_recommendation', 'learning_card'\]\)/);

  assert.match(android, /defaultProfileFields\s*=\s*listOf\("displayName"/);
  assert.match(android, /defaultMaterialCategories\s*=\s*listOf\("learning_report"\)/);
  assert.doesNotMatch(android, /defaultMaterialCategories\s*=\s*listOf\([^\n]+"learning_material"/);
});

test('health records remain outside the default profile and material scopes', () => {
  assert.doesNotMatch(web.match(/profileFieldOptions\s*=\s*\[[\s\S]*?\] as const;/)?.[0] || '', /health/i);
  assert.doesNotMatch(web.match(/materialCategoryOptions\s*=\s*\[[\s\S]*?\] as const;/)?.[0] || '', /health/i);
  assert.doesNotMatch(android.match(/defaultProfileFields[^\n]*/)?.[0] || '', /health/i);
  assert.doesNotMatch(android.match(/defaultMaterialCategories[^\n]*/)?.[0] || '', /health/i);
});
