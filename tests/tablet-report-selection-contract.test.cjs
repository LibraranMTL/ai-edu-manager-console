const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.resolve(__dirname, '..', 'android-tablet-terminal', 'src', 'com', 'qxmatrix', 'eduterminal', 'MainActivity.java'),
  'utf8',
);

test('tablet report buttons track and render the selected report', () => {
  assert.match(source, /String selectedReportId = "profile"/);
  assert.match(source, /selectedReportId = reportId;\s+updateReportButtonSelection\(\)/);
  assert.match(source, /styleSelectableButton\(reportDailyButton, "daily"\.equals\(selectedReportId\)\)/);
  assert.match(source, /styleSelectableButton\(reportChangesButton, "changes"\.equals\(selectedReportId\)\)/);
  assert.match(source, /styleSelectableButton\(reportStageButton, "stage"\.equals\(selectedReportId\)\)/);
  assert.match(source, /target\.setTextColor\(selected \? Color\.WHITE : accentColor\(\)\)/);
  assert.match(source, /target\.setBackgroundColor\(selected \? accentColor\(\) : accentLightColor\(\)\)/);
});
