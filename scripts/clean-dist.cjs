const fs = require('node:fs');
const path = require('node:path');

function removeTree(target) {
  if (!fs.existsSync(target)) return;
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fs.unlinkSync(target);
    return;
  }
  for (const entry of fs.readdirSync(target)) removeTree(path.join(target, entry));
  fs.rmdirSync(target);
}

const projectRoot = path.resolve(__dirname, '..');
const distPath = path.resolve(projectRoot, 'dist');
if (path.dirname(distPath) !== projectRoot || path.basename(distPath) !== 'dist') {
  throw new Error(`Refusing to clean unexpected path: ${distPath}`);
}
removeTree(distPath);

module.exports = { removeTree };
