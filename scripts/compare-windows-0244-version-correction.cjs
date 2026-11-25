'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const base = path.join(process.env.LOCALAPPDATA, 'AI-Education-Manager/release-stage');
const oldRoot = path.join(base, '0.24.4-0.24.4-self-activation-r2');
const newRoot = path.join(base, '0.24.4-0.24.4-corrective-self-activation-release-r1');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function files(root, prefix = '') {
  return fs.readdirSync(path.join(root, prefix), {withFileTypes:true}).flatMap(item => {
    const relative = path.posix.join(prefix, item.name);
    return item.isDirectory() ? files(root, relative) : [relative];
  });
}
const moduleChanges = [];
const checked = [];
for (const dir of ['electron', 'shared', 'cloud-report-service']) {
  const oldFiles = files(path.join(oldRoot, dir));
  assert.deepEqual(files(path.join(newRoot, dir)), oldFiles, dir + ' file inventory');
  for (const name of oldFiles) {
    const relative = dir + '/' + name;
    if (hash(path.join(oldRoot, relative)) !== hash(path.join(newRoot, relative))) moduleChanges.push(relative);
    checked.push(relative);
  }
}
for (const relative of moduleChanges) {
  assert.equal(relative, 'electron/agent-lifecycle-hook.exe', 'unexpected business module change: ' + relative);
  assert.equal(hash(path.join(oldRoot,'electron/agent-lifecycle-hook.cs')), hash(path.join(newRoot,'electron/agent-lifecycle-hook.cs')));
}
const assetPath = value => value.replace(/-[A-Za-z0-9_-]{8}(?=\.(?:js|css)$)/g, '-HASH');
const normal = text => text.replace(/-[A-Za-z0-9_-]{8}(?=\.(?:js|css))/g, '-HASH');
const oldDist = files(path.join(oldRoot,'dist'));
const newDist = files(path.join(newRoot,'dist'));
const newMap = new Map(newDist.map(relative => [assetPath(relative),relative]));
assert.equal(newMap.size,newDist.length,'duplicate normalized asset paths');
assert.deepEqual([...newMap.keys()].sort(),oldDist.map(assetPath).sort(),'renderer file inventory');
const rendererChanges = [];
let oldVersionFound = false;
let newVersionFound = false;
for (const relative of oldDist) {
  const nextRelative = newMap.get(assetPath(relative));
  const a = fs.readFileSync(path.join(oldRoot,'dist',relative));
  const b = fs.readFileSync(path.join(newRoot,'dist',nextRelative));
  if (a.equals(b)) continue;
  assert.ok(/\.(?:js|html|css)$/.test(relative),'unexpected non-text resource change: '+relative);
  let oldText = normal(a.toString('utf8'));
  const newText = normal(b.toString('utf8'));
  if (/^assets\/index-/.test(relative)) {
    const pattern = /([A-Za-z_$][\w$]*=)282,([A-Za-z_$][\w$]*="0\.24\.4")/;
    oldVersionFound = pattern.test(oldText);
    oldText = oldText.replace(pattern,(_,prefix,suffix)=>prefix+'283,'+suffix);
    newVersionFound = /[A-Za-z_$][\w$]*=283,[A-Za-z_$][\w$]*="0\.24\.4"/.test(newText);
  }
  assert.equal(oldText,newText,'unexpected renderer behavior change: '+relative);
  rendererChanges.push({before:relative,after:nextRelative});
}
assert.ok(oldVersionFound && newVersionFound,'version-code correction not proven');
const a=JSON.parse(fs.readFileSync(path.join(oldRoot,'package.json'),'utf8'));
const b=JSON.parse(fs.readFileSync(path.join(newRoot,'package.json'),'utf8'));
delete a.build;delete b.build;assert.deepEqual(a,b,'runtime package identity/dependencies');
const report={passed:true,from:'0.24.4-self-activation-r2',to:'0.24.4-corrective-self-activation-release-r1',
  oldAsarSha256:hash(path.join(oldRoot,'out/win-unpacked/resources/app.asar')),
  newAsarSha256:hash(path.join(newRoot,'out/win-unpacked/resources/app.asar')),
  oldVersionCode:282,newVersionCode:283,checkedBusinessFiles:checked.length,
  businessSourceUnchanged:true,moduleChanges,rendererChanges,
  allowedDelta:'compiled update version constant, derived asset names/references, packaging metadata; helper source unchanged'};
const target=path.resolve(__dirname,'../artifacts/windows-0244-promotion/runtime-comparison.json');
fs.writeFileSync(target,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
