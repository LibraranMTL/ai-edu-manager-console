const fs = require('node:fs/promises');
const path = require('node:path');

// Dashboard counts do not need file contents or hashes. Keep this separate from
// collectProjectRawFiles, whose SHA-1 values are required by import/dedup flows.
async function countProjectFiles(root) {
  if (!root) return 0;
  const pending = [root];
  let count = 0;
  while (pending.length) {
    const dir = pending.pop();
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name !== '.edu-manager' && entry.name !== 'node_modules') {
          pending.push(path.join(dir, entry.name));
        }
      } else if (entry.isFile()) {
        count += 1;
      }
    }
  }
  return count;
}

module.exports = { countProjectFiles };
