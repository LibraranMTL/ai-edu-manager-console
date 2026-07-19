const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'src', 'main.tsx'), 'utf8');

test('theme skin paths resolve from source and packaged asset stylesheets', () => {
  assert.match(ui, /blue:\s*'\.\.\/skins\/skin-blue\.jpg'/);
  assert.doesNotMatch(ui, /blue:\s*'\.\/skins\/skin-blue\.jpg'/);
  for (const name of ['blue', 'pink', 'green', 'purple', 'orange']) {
    assert.ok(fs.existsSync(path.join(root, 'public', 'skins', `skin-${name}.jpg`)));
  }
});
