param(
  [Parameter(Mandatory = $true)][int[]]$RootProcessIds,
  [int]$DurationSeconds = 180,
  [int]$IntervalMilliseconds = 2000,
  [int]$StopWhenProcessIdExits = 0,
  [int]$TailSeconds = 3,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = 'Stop'

function Get-DescendantIds([object[]]$Rows, [int[]]$Roots) {
  $seen = [System.Collections.Generic.HashSet[int]]::new()
  $queue = [System.Collections.Generic.Queue[int]]::new()
  foreach ($root in $Roots) {
    [void]$seen.Add([int]$root)
    $queue.Enqueue([int]$root)
  }
  while ($queue.Count -gt 0) {
    $parent = $queue.Dequeue()
    foreach ($row in $Rows) {
      if ([int]$row.ParentProcessId -ne $parent) { continue }
      $id = [int]$row.ProcessId
      if ($seen.Add($id)) { $queue.Enqueue($id) }
    }
  }
  return @($seen)
}

function Get-ProcessRows([int[]]$Roots) {
  $cim = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, CreationDate, Name, ExecutablePath, CommandLine)
  $ids = @(Get-DescendantIds -Rows $cim -Roots $Roots)
  $byId = @{}
  foreach ($row in $cim) { $byId[[int]$row.ProcessId] = $row }
  $rows = @()
  foreach ($id in $ids) {
    $meta = $byId[$id]
    if (-not $meta) { continue }
    $live = Get-Process -Id $id -ErrorAction SilentlyContinue
    if (-not $live) { continue }
    $rows += [ordered]@{
      processId = $id
      parentProcessId = [int]$meta.ParentProcessId
      name = [string]$meta.Name
      executablePath = [string]$meta.ExecutablePath
      commandLine = [string]$meta.CommandLine
      creationDate = [string]$meta.CreationDate
      cpuSeconds = [double]$live.CPU
      privateMemoryBytes = [long]$live.PrivateMemorySize64
      workingSetBytes = [long]$live.WorkingSet64
      responding = [bool]$live.Responding
      threadCount = [int]$live.Threads.Count
      handleCount = [int]$live.HandleCount
    }
  }
  return $rows
}

$startedAt = [DateTimeOffset]::Now
$samples = [System.Collections.Generic.List[object]]::new()
$known = @{}
$previousCpu = @{}
$iterations = [Math]::Max(1, [Math]::Ceiling(($DurationSeconds * 1000) / $IntervalMilliseconds))
$stopObservedAt = $null

for ($index = 0; $index -lt $iterations; $index++) {
  Start-Sleep -Milliseconds $IntervalMilliseconds
  $rows = @(Get-ProcessRows -Roots $RootProcessIds)
  $treeCpuDelta = 0.0
  foreach ($row in $rows) {
    $id = [int]$row.processId
    $known[$id] = $row
    if ($previousCpu.ContainsKey($id)) {
      $treeCpuDelta += [Math]::Max(0.0, [double]$row.cpuSeconds - [double]$previousCpu[$id])
    }
    $previousCpu[$id] = [double]$row.cpuSeconds
  }
  $samples.Add([ordered]@{
    at = [DateTimeOffset]::Now.ToString('o')
    processCount = $rows.Count
    treeCpuCoreEquivalentPercent = [Math]::Round(($treeCpuDelta / [Math]::Max(0.001, $IntervalMilliseconds / 1000.0)) * 100, 2)
    treePrivateMemoryBytes = [long](($rows | ForEach-Object { [long]$_['privateMemoryBytes'] } | Measure-Object -Sum).Sum)
    nonRespondingProcessIds = @($rows | Where-Object { -not $_.responding } | ForEach-Object { $_.processId })
    rows = $rows
  })
  if ($StopWhenProcessIdExits -gt 0) {
    $watchedAlive = Get-Process -Id $StopWhenProcessIdExits -ErrorAction SilentlyContinue
    if (-not $watchedAlive -and -not $stopObservedAt) { $stopObservedAt = [DateTimeOffset]::Now }
    if ($stopObservedAt -and ([DateTimeOffset]::Now - $stopObservedAt).TotalSeconds -ge $TailSeconds) { break }
  }
}

$report = [ordered]@{
  schema = 'edu.p0.real-host-process-tree.v1'
  readOnly = $true
  startedAt = $startedAt.ToString('o')
  finishedAt = [DateTimeOffset]::Now.ToString('o')
  requestedRootProcessIds = $RootProcessIds
  requestedDurationSeconds = $DurationSeconds
  intervalMilliseconds = $IntervalMilliseconds
  stopWhenProcessIdExits = $StopWhenProcessIdExits
  tailSeconds = $TailSeconds
  cpuUnit = 'core-equivalent; 100 percent equals one fully occupied logical processor'
  observedProcesses = @($known.Values | Sort-Object processId)
  samples = $samples
}

$destination = [System.IO.Path]::GetFullPath($OutputPath)
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
$report | ConvertTo-Json -Depth 9 | Set-Content -LiteralPath $destination -Encoding UTF8
Write-Output "OUTPUT=$destination"
