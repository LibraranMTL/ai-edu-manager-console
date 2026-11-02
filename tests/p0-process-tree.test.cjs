'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('P0 runtime sampling selects only the requested process tree', () => {
  const helper = path.resolve(__dirname, '../scripts/p0-process-tree.ps1').replaceAll("'", "''");
  const command = [
    `. '${helper}'`,
    '$rows=@(',
    "[pscustomobject]@{ProcessId=100;ParentProcessId=1},",
    "[pscustomobject]@{ProcessId=101;ParentProcessId=100},",
    "[pscustomobject]@{ProcessId=102;ParentProcessId=101},",
    "[pscustomobject]@{ProcessId=200;ParentProcessId=1},",
    "[pscustomobject]@{ProcessId=201;ParentProcessId=200}",
    ')',
    '@(Get-P0DescendantProcessIds -Processes $rows -RootProcessId 100) | ConvertTo-Json -Compress',
  ].join('\n');

  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' }).trim();
  const ids = JSON.parse(output);
  assert.deepEqual(ids.sort((left, right) => left - right), [100, 101, 102]);
});
