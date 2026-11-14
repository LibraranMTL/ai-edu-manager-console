param(
  [int]$DurationSeconds = 30,
  [int]$IntervalMilliseconds = 500,
  [string]$Scenario = "unlabelled",
  [string]$RunId = "",
  [string]$OutputPath = "artifacts/p0-red-gate-20261025/p0-live-runtime-sample-v2.json",
  [string]$ProvenancePath = "artifacts/p0-red-gate-20261025/p0-candidate-provenance.json",
  [Alias('MainPid')][int]$MainProcessId = 0,
  [string]$UserDataDir = "",
  [string]$StudentBaseDir = ""
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'p0-process-tree.ps1')
$destination = if ([System.IO.Path]::IsPathRooted($OutputPath)) { $OutputPath } else { Join-Path $root $OutputPath }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
if (-not $RunId) { $RunId = [Guid]::NewGuid().ToString('n') }
$normalizedUserData = if ($UserDataDir) { [System.IO.Path]::GetFullPath($UserDataDir) } else { '' }
$normalizedStudentBase = if ($StudentBaseDir) { [System.IO.Path]::GetFullPath($StudentBaseDir) } else { '' }
if (-not [System.IO.Path]::IsPathRooted($normalizedUserData) -or -not [System.IO.Path]::IsPathRooted($normalizedStudentBase)) {
  throw 'P0 runtime sampling requires absolute -UserDataDir and -StudentBaseDir values.'
}
$userPrefix = $normalizedUserData.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $normalizedStudentBase.StartsWith($userPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'The sampled student root must be a child of the isolated user-data directory.'
}
$provenanceFile = if ([System.IO.Path]::IsPathRooted($ProvenancePath)) { $ProvenancePath } else { Join-Path $root $ProvenancePath }
$provenance = $null
if (Test-Path -LiteralPath $provenanceFile) {
  $provenanceReport = Get-Content -LiteralPath $provenanceFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $provenance = [ordered]@{
    workspaceCommit = [string]$provenanceReport.workspace.commit
    candidateSha256 = if ([string]$provenanceReport.chains.diagnosticCandidate.candidateSha256) {
      [string]$provenanceReport.chains.diagnosticCandidate.candidateSha256
    } else {
      [string]$provenanceReport.candidate.exe.sha256
    }
    mappingStatus = [string]$provenanceReport.mapping.status
    originalCandidateStatus = [string]$provenanceReport.chains.originalCandidate.status
    diagnosticCandidateStatus = [string]$provenanceReport.chains.diagnosticCandidate.status
  }
}

function Get-EduProcesses {
  Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -match 'edu-manager|AI Education Manager Console' -or
    $_.Name -match '^AI-edu-manager|^AI Education Manager Console'
  }
}

function Get-TargetRuntimeProcessIds([int]$RootProcessId) {
  $rows = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
  @(Get-P0DescendantProcessIds -Processes $rows -RootProcessId $RootProcessId)
}

function Get-TargetRuntimeProcesses([int[]]$ProcessIds) {
  @(Get-Process -Id $ProcessIds -ErrorAction SilentlyContinue)
}

function Get-Percentile([double[]]$Values, [double]$Ratio) {
  if (-not $Values -or $Values.Count -eq 0) { return 0 }
  $ordered = @($Values | Sort-Object)
  return $ordered[[Math]::Min($ordered.Count - 1, [Math]::Floor($ordered.Count * $Ratio))]
}

$inventory = @(Get-EduProcesses)
if ($MainProcessId -le 0) {
  $main = $inventory | Where-Object {
    $_.Name -eq 'AI Education Manager Console.exe' -and $_.CommandLine -notmatch '--type='
  } | Sort-Object CreationDate | Select-Object -First 1
  if (-not $main) { throw 'Running AI Education Manager main process was not found.' }
  $MainProcessId = [int]$main.ProcessId
}
$targetProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $MainProcessId" -ErrorAction SilentlyContinue
if (-not $targetProcess) { throw 'The sampled main process was not found.' }
$targetCommandLine = [string]$targetProcess.CommandLine
if ($targetCommandLine.IndexOf('--user-data-dir', [System.StringComparison]::OrdinalIgnoreCase) -lt 0 -or
    $targetCommandLine.IndexOf($normalizedUserData, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) {
  throw 'The sampled main process does not belong to the isolated user-data directory.'
}

$logicalProcessorCount = [Environment]::ProcessorCount
$previousCpu = @{}
$targetProcessIds = @(Get-TargetRuntimeProcessIds -RootProcessId $MainProcessId)
foreach ($process in @(Get-TargetRuntimeProcesses -ProcessIds $targetProcessIds)) { $previousCpu[[int]$process.Id] = [double]$process.CPU }
$clock = [Diagnostics.Stopwatch]::StartNew()
$previousElapsed = $clock.Elapsed.TotalSeconds
$samples = [System.Collections.Generic.List[object]]::new()
$iterations = [Math]::Max(1, [Math]::Ceiling(($DurationSeconds * 1000) / $IntervalMilliseconds))
$treeRefreshIterations = [Math]::Max(1, [Math]::Ceiling(10000 / $IntervalMilliseconds))
$startedAt = [DateTimeOffset]::Now

for ($index = 0; $index -lt $iterations; $index++) {
  Start-Sleep -Milliseconds $IntervalMilliseconds
  $elapsed = $clock.Elapsed.TotalSeconds
  $elapsedSeconds = [Math]::Max(0.001, $elapsed - $previousElapsed)
  if ($index -eq 0 -or ($index % $treeRefreshIterations) -eq 0) {
    $targetProcessIds = @(Get-TargetRuntimeProcessIds -RootProcessId $MainProcessId)
  }
  $processes = @(Get-TargetRuntimeProcesses -ProcessIds $targetProcessIds)
  $mainProcess = $processes | Where-Object { $_.Id -eq $MainProcessId } | Select-Object -First 1
  if (-not $mainProcess) { throw 'The sampled main process exited during collection.' }
  $treeCpuDelta = 0.0
  $mainCpuDelta = 0.0
  foreach ($process in $processes) {
    $pidValue = [int]$process.Id
    $currentCpu = [double]$process.CPU
    if ($previousCpu.ContainsKey($pidValue)) {
      $delta = [Math]::Max(0.0, $currentCpu - [double]$previousCpu[$pidValue])
      $treeCpuDelta += $delta
      if ($pidValue -eq $MainProcessId) { $mainCpuDelta = $delta }
    }
    $previousCpu[$pidValue] = $currentCpu
  }
  $treeCorePercent = ($treeCpuDelta / $elapsedSeconds) * 100
  $mainCorePercent = ($mainCpuDelta / $elapsedSeconds) * 100
  $samples.Add([ordered]@{
    at = [DateTimeOffset]::Now.ToString('o')
    actualIntervalMilliseconds = [Math]::Round($elapsedSeconds * 1000, 2)
    mainCpuCoreEquivalentPercent = [Math]::Round($mainCorePercent, 2)
    treeCpuCoreEquivalentPercent = [Math]::Round($treeCorePercent, 2)
    treeCpuWholeMachinePercent = [Math]::Round($treeCorePercent / $logicalProcessorCount, 2)
    mainWorkingSetBytes = [long]$mainProcess.WorkingSet64
    mainPrivateMemoryBytes = [long]$mainProcess.PrivateMemorySize64
    treeWorkingSetBytes = [long](($processes | Measure-Object WorkingSet64 -Sum).Sum)
    treePrivateMemoryBytes = [long](($processes | Measure-Object PrivateMemorySize64 -Sum).Sum)
    mainResponding = [bool]$mainProcess.Responding
    mainHandleCount = [int]$mainProcess.HandleCount
    mainThreadCount = [int]$mainProcess.Threads.Count
    treeProcessCount = $processes.Count
  })
  $previousElapsed = $elapsed
}

$clock.Stop()
$endingInventory = @(Get-EduProcesses)
$intervalValues = [double[]]@($samples | ForEach-Object { $_.actualIntervalMilliseconds })
$mainCpuValues = [double[]]@($samples | ForEach-Object { $_.mainCpuCoreEquivalentPercent })
$treeCpuValues = [double[]]@($samples | ForEach-Object { $_.treeCpuWholeMachinePercent })
$privateValues = [double[]]@($samples | ForEach-Object { $_.mainPrivateMemoryBytes })
$processCountValues = [double[]]@($samples | ForEach-Object { $_.treeProcessCount })
$report = [ordered]@{
  schema = 2
  readOnly = $true
  generatedAt = [DateTimeOffset]::Now.ToString('o')
  startedAt = $startedAt.ToString('o')
  scenario = $Scenario
  runId = $RunId
  provenance = $provenance
  isolation = [ordered]@{
    verified = $true
    userDataDir = $normalizedUserData
    studentBaseDir = $normalizedStudentBase
    taskDatabasePath = Join-Path $normalizedStudentBase '.edu-manager\task-center\task-state.sqlite3'
  }
  requestedDurationSeconds = $DurationSeconds
  actualDurationSeconds = [Math]::Round($clock.Elapsed.TotalSeconds, 3)
  requestedIntervalMilliseconds = $IntervalMilliseconds
  logicalProcessorCount = $logicalProcessorCount
  cpuUnit = 'core-equivalent: 100 percent equals one fully occupied logical processor; whole-machine divides by logicalProcessorCount'
  mainProcessId = $MainProcessId
  limitations = @(
    'This sampler does not measure renderer input latency or main-process event-loop delay.',
    'Task phase correlation, including auto_wake and receipt_reconcile decisions, requires the paired redacted task-state timeline.',
    'A single run is observational evidence, not a causal result.'
  )
  processInventory = [ordered]@{
    before = @($inventory | ForEach-Object { [ordered]@{ processId = $_.ProcessId; parentProcessId = $_.ParentProcessId; name = $_.Name; commandLine = $_.CommandLine } })
    after = @($endingInventory | ForEach-Object { [ordered]@{ processId = $_.ProcessId; parentProcessId = $_.ParentProcessId; name = $_.Name; commandLine = $_.CommandLine } })
  }
  summary = [ordered]@{
    sampleCount = $samples.Count
    actualIntervalAverageMilliseconds = [Math]::Round(($intervalValues | Measure-Object -Average).Average, 2)
    actualIntervalP95Milliseconds = [Math]::Round((Get-Percentile $intervalValues 0.95), 2)
    mainCpuCoreEquivalentAveragePercent = [Math]::Round(($mainCpuValues | Measure-Object -Average).Average, 2)
    mainCpuCoreEquivalentP95Percent = [Math]::Round((Get-Percentile $mainCpuValues 0.95), 2)
    treeCpuWholeMachineAveragePercent = [Math]::Round(($treeCpuValues | Measure-Object -Average).Average, 2)
    treeCpuWholeMachineP95Percent = [Math]::Round((Get-Percentile $treeCpuValues 0.95), 2)
    mainPrivateMemoryAverageBytes = [long](($privateValues | Measure-Object -Average).Average)
    mainPrivateMemoryP95Bytes = [long](Get-Percentile $privateValues 0.95)
    mainPrivateMemoryMaximumBytes = [long](($privateValues | Measure-Object -Maximum).Maximum)
    nonRespondingSamples = @($samples | Where-Object { -not $_.mainResponding }).Count
    minimumTreeProcessCount = [int](($processCountValues | Measure-Object -Minimum).Minimum)
    maximumTreeProcessCount = [int](($processCountValues | Measure-Object -Maximum).Maximum)
  }
  samples = $samples
}

$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $destination -Encoding UTF8
Write-Output ($report.summary | ConvertTo-Json -Compress)
Write-Output "OUTPUT=$destination"
