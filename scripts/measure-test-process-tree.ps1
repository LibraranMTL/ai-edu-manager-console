param([Parameter(Mandatory=$true)][int]$RootProcessId,
      [Parameter(Mandatory=$true)][string]$ReportPath,
      [ValidateRange(250,5000)][int]$IntervalMs = 2000)
$ErrorActionPreference = 'Stop'
# Read-only sampling of this synthetic test's descendants. Never logs command
# lines, environments, prompts or credentials and never terminates a process.
$rows = @{}
$started = [DateTime]::UtcNow.ToString('o')
$samples = 0
$peakTreeRssBytes = 0L
$rootIdentity = (Get-Process -Id $RootProcessId -ErrorAction Stop).StartTime
while (Get-Process -Id $RootProcessId -ErrorAction SilentlyContinue) {
  if ((Get-Process -Id $RootProcessId -ErrorAction SilentlyContinue).StartTime -ne $rootIdentity) { break }
  $inventory = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CreationDate,CommandLine)
  $byId = @{}; foreach ($entry in $inventory) { $byId[[int]$entry.ProcessId] = $entry }
  $owned = [System.Collections.Generic.HashSet[int]]::new()
  [void]$owned.Add($RootProcessId)
  do {
    $added = $false
    foreach ($entry in $inventory) {
      $parent = $byId[[int]$entry.ParentProcessId]
      # Windows can reuse an exited parent's PID. An older process with that
      # numeric parent ID is not this test's descendant.
      if ($parent -and $entry.CreationDate -ge $parent.CreationDate -and $owned.Contains([int]$entry.ParentProcessId) -and $owned.Add([int]$entry.ProcessId)) { $added = $true }
    }
  } while ($added)
  $treeRssBytes = 0L
  foreach ($entry in $inventory) {
    if (-not $owned.Contains([int]$entry.ProcessId)) { continue }
    $current = Get-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue
    if (-not $current) { continue }
    $treeRssBytes += $current.WorkingSet64
    $key = [string]$entry.ProcessId + ':' + $entry.CreationDate.ToUniversalTime().ToString('o')
    if (-not $rows.ContainsKey($key)) {
      $role = if ($entry.ProcessId -eq $RootProcessId) { 'test-host' }
        elseif ($entry.CommandLine -match 'project-material-image-ocr|project-material-ocr|capture-image-ocr|capture-timeline-ocr') { 'ocr-helper' }
        elseif ($entry.CommandLine -match 'project-knowledge-guard') { 'commit-guard' }
        elseif ($entry.CommandLine -match 'codebuddy') { 'external-agent-cli' }
        else { 'runtime-helper' }
      $rows[$key] = @{ pid=$entry.ProcessId; parentPid=$entry.ParentProcessId; name=$entry.Name; role=$role;
        creationAt=$entry.CreationDate.ToUniversalTime().ToString('o');
        firstAt=[DateTime]::UtcNow.ToString('o'); peakRssBytes=0L; peakPrivateBytes=0L; peakHandles=0; cpuSeconds=0.0 }
    }
    $row = $rows[$key]
    $row.lastAt = [DateTime]::UtcNow.ToString('o')
    $row.peakRssBytes = [Math]::Max($row.peakRssBytes, $current.WorkingSet64)
    $row.peakPrivateBytes = [Math]::Max($row.peakPrivateBytes, $current.PrivateMemorySize64)
    $row.peakHandles = [Math]::Max($row.peakHandles, $current.HandleCount)
    $row.cpuSeconds = [Math]::Max($row.cpuSeconds, [double]$current.CPU)
  }
  $peakTreeRssBytes = [Math]::Max($peakTreeRssBytes, $treeRssBytes)
  $samples++
  @{ scope='owned synthetic test processes only; sampled peaks, not cloud inference resources'; lineage='parent PID plus creation time';
    startedAt=$started; measuredAt=[DateTime]::UtcNow.ToString('o'); samples=$samples; peakTreeRssBytes=$peakTreeRssBytes; intervalMs=$IntervalMs; processes=@($rows.Values) } |
    ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
  Start-Sleep -Milliseconds $IntervalMs
}
$survivors = @()
foreach ($row in $rows.Values) {
  $remaining = Get-Process -Id $row.pid -ErrorAction SilentlyContinue
  if ($remaining -and [Math]::Abs(($remaining.StartTime.ToUniversalTime() - [DateTime]::Parse($row.creationAt).ToUniversalTime()).TotalMilliseconds) -lt 1) { $survivors += $row.pid }
}
@{ scope='owned synthetic test processes only; sampled peaks, not cloud inference resources'; lineage='parent PID plus creation time';
  startedAt=$started; finishedAt=[DateTime]::UtcNow.ToString('o'); samples=$samples; survivors=$survivors; peakTreeRssBytes=$peakTreeRssBytes; intervalMs=$IntervalMs; processes=@($rows.Values) } |
  ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
