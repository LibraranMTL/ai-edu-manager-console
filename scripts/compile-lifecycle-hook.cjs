const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function align4(value) {
  return (value + 3) & ~3;
}

function normalizeManagedPeIdentity(outputPath, sourcePath) {
  const bytes = fs.readFileSync(outputPath);
  const peOffset = bytes.readUInt32LE(0x3c);
  if (bytes.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
    throw new Error('Lifecycle hook compilation produced an invalid PE executable.');
  }

  const digest = crypto.createHash('sha256')
    .update(fs.readFileSync(sourcePath))
    .update('\0/optimize+/target:exe/platform:x64')
    .digest();
  bytes.writeUInt32LE(digest.readUInt32LE(0), peOffset + 8);

  const sectionCount = bytes.readUInt16LE(peOffset + 6);
  const optionalHeaderSize = bytes.readUInt16LE(peOffset + 20);
  const optionalHeaderOffset = peOffset + 24;
  const optionalMagic = bytes.readUInt16LE(optionalHeaderOffset);
  const dataDirectoryOffset = optionalHeaderOffset + (optionalMagic === 0x20b ? 112 : 96);
  const cliHeaderRva = bytes.readUInt32LE(dataDirectoryOffset + (14 * 8));
  const sectionTableOffset = optionalHeaderOffset + optionalHeaderSize;
  const rvaToOffset = (rva) => {
    for (let index = 0; index < sectionCount; index += 1) {
      const sectionOffset = sectionTableOffset + (index * 40);
      const virtualSize = bytes.readUInt32LE(sectionOffset + 8);
      const virtualAddress = bytes.readUInt32LE(sectionOffset + 12);
      const rawSize = bytes.readUInt32LE(sectionOffset + 16);
      const rawOffset = bytes.readUInt32LE(sectionOffset + 20);
      if (rva >= virtualAddress && rva < virtualAddress + Math.max(virtualSize, rawSize)) {
        return rawOffset + (rva - virtualAddress);
      }
    }
    throw new Error(`Lifecycle hook PE contains an unmapped RVA: ${rva}.`);
  };

  const cliHeaderOffset = rvaToOffset(cliHeaderRva);
  const metadataOffset = rvaToOffset(bytes.readUInt32LE(cliHeaderOffset + 8));
  if (bytes.toString('ascii', metadataOffset, metadataOffset + 4) !== 'BSJB') {
    throw new Error('Lifecycle hook PE contains invalid CLR metadata.');
  }
  const versionLength = bytes.readUInt32LE(metadataOffset + 12);
  let streamCursor = align4(metadataOffset + 16 + versionLength);
  const streamCount = bytes.readUInt16LE(streamCursor + 2);
  streamCursor += 4;
  const streams = new Map();
  for (let index = 0; index < streamCount; index += 1) {
    const relativeOffset = bytes.readUInt32LE(streamCursor);
    const size = bytes.readUInt32LE(streamCursor + 4);
    let nameEnd = streamCursor + 8;
    while (bytes[nameEnd] !== 0) nameEnd += 1;
    const name = bytes.toString('ascii', streamCursor + 8, nameEnd);
    streams.set(name, { offset: metadataOffset + relativeOffset, size });
    streamCursor = align4(nameEnd + 1);
  }

  const tables = streams.get('#~') || streams.get('#-');
  const guidHeap = streams.get('#GUID');
  if (!tables || !guidHeap) throw new Error('Lifecycle hook PE is missing CLR tables or GUID metadata.');
  const heapSizes = bytes[tables.offset + 6];
  const validTables = bytes.readBigUInt64LE(tables.offset + 8);
  let rowCountCursor = tables.offset + 24;
  let moduleRows = 0;
  for (let table = 0; table < 64; table += 1) {
    if ((validTables & (1n << BigInt(table))) === 0n) continue;
    const rows = bytes.readUInt32LE(rowCountCursor);
    if (table === 0) moduleRows = rows;
    rowCountCursor += 4;
  }
  if (moduleRows !== 1) throw new Error(`Lifecycle hook PE has an unexpected Module table size: ${moduleRows}.`);
  const stringIndexSize = (heapSizes & 0x01) === 0 ? 2 : 4;
  const guidIndexSize = (heapSizes & 0x02) === 0 ? 2 : 4;
  const mvidIndexOffset = rowCountCursor + 2 + stringIndexSize;
  const mvidIndex = guidIndexSize === 2
    ? bytes.readUInt16LE(mvidIndexOffset)
    : bytes.readUInt32LE(mvidIndexOffset);
  if (mvidIndex < 1) throw new Error('Lifecycle hook PE has no module version identifier.');
  const mvidOffset = guidHeap.offset + ((mvidIndex - 1) * 16);
  if (mvidOffset + 16 > guidHeap.offset + guidHeap.size) {
    throw new Error('Lifecycle hook PE module version identifier is outside the GUID heap.');
  }
  const stableMvid = Buffer.from(digest.subarray(8, 24));
  stableMvid[6] = (stableMvid[6] & 0x0f) | 0x50;
  stableMvid[8] = (stableMvid[8] & 0x3f) | 0x80;
  stableMvid.copy(bytes, mvidOffset);
  fs.writeFileSync(outputPath, bytes);
}

function compileLifecycleHook(sourcePath, outputPath) {
  if (process.platform !== 'win32') throw new Error('The lifecycle hook executable requires Windows.');
  const windowsDir = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows';
  const framework = ['Framework64', 'Framework']
    .map((name) => path.join(windowsDir, 'Microsoft.NET', name, 'v4.0.30319'))
    .find((dir) => fs.existsSync(path.join(dir, 'csc.exe')));
  if (!framework) throw new Error('The Windows .NET Framework C# compiler is unavailable.');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const result = spawnSync(path.join(framework, 'csc.exe'), [
    '/nologo', '/optimize+', '/target:exe', '/platform:x64',
    `/out:${outputPath}`,
    sourcePath,
  ], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0 || !fs.existsSync(outputPath)) {
    throw new Error(`Lifecycle hook compilation failed: ${result.error?.message || result.stdout || result.stderr || result.status}`);
  }
  normalizeManagedPeIdentity(outputPath, sourcePath);
  return outputPath;
}

module.exports = { compileLifecycleHook };
