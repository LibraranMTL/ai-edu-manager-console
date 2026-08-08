const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'android-standalone-manager', 'app', 'src', 'main');

test('W15 Android standalone app uses the supplied Robogala launcher logo', () => {
  const manifest = fs.readFileSync(path.join(root, 'AndroidManifest.xml'), 'utf8');
  assert.match(manifest, /android:icon="@mipmap\/ic_launcher"/);
  assert.match(manifest, /android:roundIcon="@mipmap\/ic_launcher"/);

  const expectedSizes = new Map([
    ['mdpi', 48],
    ['hdpi', 72],
    ['xhdpi', 96],
    ['xxhdpi', 144],
    ['xxxhdpi', 192],
  ]);
  for (const [density, expectedSize] of expectedSizes) {
    const png = fs.readFileSync(path.join(root, 'res', `mipmap-${density}`, 'ic_launcher.png'));
    assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
    assert.equal(png.readUInt32BE(16), expectedSize);
    assert.equal(png.readUInt32BE(20), expectedSize);
    assert.equal(png[25], 6, `${density} launcher icon should retain RGBA transparency`);
  }
});
