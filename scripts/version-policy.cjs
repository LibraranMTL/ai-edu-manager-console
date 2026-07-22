const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

function parseVersion(value) {
  const match = VERSION_PATTERN.exec(String(value || '').trim());
  if (!match) throw new Error(`无效版本号：${value}`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function validateWindowsVersion(value) {
  const version = parseVersion(value);
  if (version.patch < 1 || version.patch > 10) {
    throw new Error(`Windows 版本修订号必须为 1-10：${value}`);
  }
  return version;
}

function nextWindowsVersion(value) {
  const version = validateWindowsVersion(value);
  if (version.patch < 10) return `${version.major}.${version.minor}.${version.patch + 1}`;
  return `${version.major}.${version.minor + 1}.1`;
}

module.exports = { parseVersion, validateWindowsVersion, nextWindowsVersion };

if (require.main === module) {
  const current = process.argv[2];
  process.stdout.write(`${nextWindowsVersion(current)}\n`);
}
