param(
  [Parameter(Mandatory = $true)][string]$CandidateExe,
  [Parameter(Mandatory = $true)][string]$SourceUserData,
  [Parameter(Mandatory = $true)][string]$OutputRoot,
  [Parameter(Mandatory = $true)][string]$ProvenancePath,
  [string]$SourceWorkBuddyAuth = '',
  [string]$FixtureRoot = '',
  [int]$DurationSeconds = 120,
  [int]$WarmupSeconds = 120,
  [int]$Repeats = 3,
  [string[]]$Scenarios = @('idle-unknown','normal-task','backlog-recovery'),
  [string]$EvidenceKind = 'internal_runtime_probe',
  [switch]$ProjectQueryStress,
  [switch]$VisibleInteractions,
  [int]$BaseDebugPort = 19470
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'p0-process-tree.ps1')
$output = [IO.Path]::GetFullPath($OutputRoot)
New-Item -ItemType Directory -Force -Path $output | Out-Null
$fixtureBase = if ($FixtureRoot) { [IO.Path]::GetFullPath($FixtureRoot) } else { Join-Path $output 'fixtures' }
New-Item -ItemType Directory -Force -Path $fixtureBase | Out-Null
$results = [Collections.Generic.List[object]]::new()
$runNumber = 0
$allowedScenarios = @('idle-unknown','normal-task','backlog-recovery','agent-workbuddy','agent-codex','agent-backlog-workbuddy','agent-research-codex')
foreach ($requestedScenario in @($Scenarios)) {
  if ($requestedScenario -notin $allowedScenarios) {
    throw "invalid_performance_scenario:$requestedScenario"
  }
}

function Add-IdleUnknownFixture([string]$Fixture) {
  $studentBase = Join-Path $Fixture 'student-data'
  $studentRoot = Join-Path $studentBase 'synthetic-unknown'
  $raw = Join-Path $studentRoot '原始资料'
  New-Item -ItemType Directory -Force -Path $raw | Out-Null
  Set-Content -LiteralPath (Join-Path $raw 'fixture-note.md') -Value "# Synthetic unknown fixture`n`nNo student data.`n" -Encoding utf8
  $students = @([ordered]@{
    id='p0-synthetic-unknown'; name='P0合成未知结果'; loginId='P0-UNKNOWN'; status='inactive';
    activityStatus='inactive'; active=$false; archived=$false; rootPath=$studentRoot; rawPath=$raw;
    agentTool='workbuddy'; automaticTasksPaused=$true
  })
  $students | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $Fixture 'students.json') -Encoding utf8
  $taskFile = Join-Path $studentBase '.edu-manager\task-center\tasks.json'
  $taskState = Get-Content -LiteralPath $taskFile -Raw -Encoding utf8 | ConvertFrom-Json
  $now = [DateTimeOffset]::Now.ToString('o')
  $taskState.tasks = @([ordered]@{
    id='p0-idle-unknown'; title='P0合成未知结果保护'; kind='student_digest'; sourceType='student';
    sourceId='p0-synthetic-unknown'; sourceName='P0合成未知结果'; status='cancelled'; trigger='event';
    executor='workbuddy'; requestedExecutor='workbuddy'; executionMode='automatic'; automaticExecution=$true;
    workKey='student_digest:p0-synthetic-unknown:fixture-v1'; sourceVersion='fixture-v1';
    pipelineVersion='p0-runtime-fixture-v1'; executionId='p0-unknown-execution'; recoveryState='unknown';
    recoveryPlan=[ordered]@{ nextCheckAt=[DateTimeOffset]::Now.AddHours(1).ToString('o'); checks=1; maxChecks=3 };
    createdAt=$now; updatedAt=$now
  })
  $taskState | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $taskFile -Encoding utf8
}

function Resolve-ElectronMainProcess([int]$LauncherProcessId, [string]$UserDataDir) {
  $rows = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine)
  $ids = @(Get-P0DescendantProcessIds -Processes $rows -RootProcessId $LauncherProcessId)
  $normalized = [IO.Path]::GetFullPath($UserDataDir)
  $matches = @($rows | Where-Object {
    $ids -contains [int]$_.ProcessId -and
    [string]$_.Name -eq 'AI Education Manager Console.exe' -and
    [string]$_.CommandLine -notmatch '--type=' -and
    [string]$_.CommandLine -like "*$normalized*"
  })
  if ($matches.Count -ne 1) { throw "electron_main_process_not_unique:$($matches.Count)" }
  $matches[0]
}

function Restore-P0CandidateWindow([int]$MainProcessId) {
  if (-not ('P0WindowNative' -as [type])) {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class P0WindowNative {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
}
'@
  }
  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    $handle = (Get-Process -Id $MainProcessId -ErrorAction Stop).MainWindowHandle
    if ($handle -ne [IntPtr]::Zero) {
      [P0WindowNative]::ShowWindowAsync($handle, 9) | Out-Null
      [P0WindowNative]::SetForegroundWindow($handle) | Out-Null
      Start-Sleep -Milliseconds 100
      if ([P0WindowNative]::IsWindowVisible($handle) -and -not [P0WindowNative]::IsIconic($handle)) { return }
    }
    Start-Sleep -Milliseconds 250
  }
  throw 'candidate_main_window_not_ready'
}

foreach ($scenario in @($Scenarios)) {
  for ($repeat = 1; $repeat -le $Repeats; $repeat += 1) {
    $runNumber += 1
    $fixtureScenario = if ($scenario -eq 'agent-backlog-workbuddy') { 'agent-backlog-workbuddy' } elseif ($scenario -eq 'agent-research-codex') { 'agent-research-codex' } elseif ($scenario -match '^agent-') { 'agent-project-task' } elseif ($scenario -eq 'idle-unknown') { 'idle' } else { $scenario }
    $agentProvider = if ($scenario -in @('agent-workbuddy','agent-backlog-workbuddy')) { 'workbuddy' } elseif ($scenario -in @('agent-codex','agent-research-codex')) { 'codex' } else { '' }
    $runEvidenceKind = if ($agentProvider) { 'real_agent_runtime' } else { $EvidenceKind }
    $fixture = Join-Path $fixtureBase ("edu-p0-r12-{0}-{1}-{2}" -f $scenario,$repeat,[guid]::NewGuid().ToString('n').Substring(0,8))
    $runId = "r12-$scenario-$repeat"
    $runDir = Join-Path $output $runId
    New-Item -ItemType Directory -Force -Path $runDir | Out-Null
    $fixtureArguments = @(
      (Join-Path $PSScriptRoot 'create-p0-runtime-fixture.cjs'),
      "--scenario=$fixtureScenario", "--output=$fixture", "--allowed-root=$fixtureBase", "--source-user-data=$SourceUserData"
    )
    if ($agentProvider) { $fixtureArguments += "--agent-provider=$agentProvider" }
    if ($agentProvider -eq 'workbuddy') {
      if (-not $SourceWorkBuddyAuth) { throw 'source_workbuddy_auth_required' }
      $fixtureArguments += "--source-workbuddy-auth=$SourceWorkBuddyAuth"
    } elseif ($scenario -eq 'agent-research-codex' -and $SourceWorkBuddyAuth) {
      $fixtureArguments += "--source-workbuddy-auth=$SourceWorkBuddyAuth"
    }
    & node @fixtureArguments | Set-Content -LiteralPath (Join-Path $runDir 'fixture-create.log') -Encoding utf8
    if ($LASTEXITCODE -ne 0) { throw "fixture_create_failed:$LASTEXITCODE" }
    if ($scenario -eq 'idle-unknown') { Add-IdleUnknownFixture $fixture }
    $studentBase = Join-Path $fixture 'student-data'
    if ($scenario -eq 'agent-research-codex' -and $SourceWorkBuddyAuth) {
      $taskFile = Join-Path $studentBase '.edu-manager\task-center\tasks.json'
      & node (Join-Path $PSScriptRoot 'prepare-p0-workbuddy-research-qualification.cjs') `
        "--descriptor=$SourceWorkBuddyAuth" "--tasks=$taskFile" `
        "--evidence=$(Join-Path $runDir 'workbuddy-research-qualification.json')" |
        Set-Content -LiteralPath (Join-Path $runDir 'workbuddy-research-qualification.log') -Encoding utf8
      if ($LASTEXITCODE -ne 0) { throw "workbuddy_research_qualification_failed:$LASTEXITCODE" }
      # The qualification is a real WorkBuddy process. Keep the production
      # minimum gap before the candidate may start its fallback workload.
      Start-Sleep -Seconds 30
    }
    $database = Join-Path $studentBase '.edu-manager\task-center\task-state.sqlite3'
    $port = $BaseDebugPort + $runNumber
    $process = $null
    $renderer = $null
    $cadenceSampler = $null
    $queryStress = $null
    $visibleInteractionProcess = $null
    try {
      $process = Start-Process -FilePath $CandidateExe -ArgumentList @("--user-data-dir=$fixture",'--qa-isolated',"--remote-debugging-port=$port") -PassThru
      $deadline = [DateTimeOffset]::Now.AddSeconds(45)
      while ([DateTimeOffset]::Now -lt $deadline) {
        if ($process.HasExited) { throw "candidate_exited_during_startup:$($process.ExitCode)" }
        try {
          $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 1
          if (@($targets | Where-Object type -eq 'page').Count -gt 0 -and (Test-Path -LiteralPath $database)) { break }
        } catch {}
        Start-Sleep -Milliseconds 500
      }
      if (-not (Test-Path -LiteralPath $database)) { throw 'task_database_not_ready' }
      $mainProcess = Resolve-ElectronMainProcess -LauncherProcessId $process.Id -UserDataDir $fixture
      $mainProcessId = [int]$mainProcess.ProcessId
      Start-Sleep -Seconds $WarmupSeconds
      & node (Join-Path $PSScriptRoot 'hash-p0-task-semantics.cjs') $database (Join-Path $runDir 'task-semantics-before.json') | Out-Null
      $renderer = Start-Process -FilePath (Get-Command node).Source -ArgumentList @(
        "`"$repo\artifacts\p0-minimal-patch-20261026\monitor-renderer-latency.cjs`"",
        [string]$port, "`"$(Join-Path $runDir 'renderer-latency.json')`"", [string]$DurationSeconds, '250'
      ) -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runDir 'renderer.stdout.log') -RedirectStandardError (Join-Path $runDir 'renderer.stderr.log')
      $cadenceSampler = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$(Join-Path $PSScriptRoot 'sample-p0-file-cadence.ps1')`"",
        '-Root', "`"$fixture`"", '-OutputPath', "`"$(Join-Path $runDir 'file-cadence.json')`"",
        '-DurationSeconds', [string]$DurationSeconds, '-IntervalSeconds', '5'
      ) -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runDir 'cadence.stdout.log') -RedirectStandardError (Join-Path $runDir 'cadence.stderr.log')
      if ($ProjectQueryStress) {
        $queryStress = Start-Process -FilePath (Get-Command node).Source -ArgumentList @(
          "`"$(Join-Path $PSScriptRoot 'benchmark-project-state.cjs')`"", '30000', '100000',
          "--output=`"$(Join-Path $runDir 'project-query-stress.json')`"", '--assert-targets'
        ) -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runDir 'project-query-stress.stdout.log') -RedirectStandardError (Join-Path $runDir 'project-query-stress.stderr.log')
      }
      if ($VisibleInteractions) {
        Restore-P0CandidateWindow -MainProcessId $mainProcessId
        $visibleInteractionProcess = Start-Process -FilePath (Get-Command node).Source -ArgumentList @(
          "`"$(Join-Path $PSScriptRoot 'run-p0-visible-interactions.cjs')`"", [string]$port,
          "`"$(Join-Path $runDir 'visible-interactions.json')`"", '--task-center', '--native-window-visible'
        ) -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runDir 'visible-interactions.stdout.log') -RedirectStandardError (Join-Path $runDir 'visible-interactions.stderr.log')
      }
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'sample-p0-live-runtime.ps1') `
        -DurationSeconds $DurationSeconds -IntervalMilliseconds 500 -Scenario $scenario -RunId $runId `
        -OutputPath (Join-Path $runDir 'runtime.json') -ProvenancePath $ProvenancePath `
        -MainProcessId $mainProcessId -UserDataDir $fixture -StudentBaseDir $studentBase | Set-Content -LiteralPath (Join-Path $runDir 'sampler.log') -Encoding utf8
      if (-not $renderer.HasExited) { $renderer.WaitForExit(15000) | Out-Null }
      if (-not $cadenceSampler.HasExited) { $cadenceSampler.WaitForExit(15000) | Out-Null }
      if ($queryStress -and -not $queryStress.HasExited) { $queryStress.WaitForExit(120000) | Out-Null }
      if ($visibleInteractionProcess -and -not $visibleInteractionProcess.HasExited) { $visibleInteractionProcess.WaitForExit(30000) | Out-Null }
      $queryStressReport = if (Test-Path -LiteralPath (Join-Path $runDir 'project-query-stress.json')) { Get-Content -LiteralPath (Join-Path $runDir 'project-query-stress.json') -Raw -Encoding utf8 | ConvertFrom-Json } else { $null }
      $visibleInteractionReport = if (Test-Path -LiteralPath (Join-Path $runDir 'visible-interactions.json')) { Get-Content -LiteralPath (Join-Path $runDir 'visible-interactions.json') -Raw -Encoding utf8 | ConvertFrom-Json } else { $null }
      $queryStressPassed = (-not $ProjectQueryStress) -or ($queryStressReport -and $queryStressReport.passed -eq $true)
      $visibleInteractionsPassed = (-not $VisibleInteractions) -or ($visibleInteractionReport -and $visibleInteractionReport.passed -eq $true)
      & node (Join-Path $PSScriptRoot 'hash-p0-task-semantics.cjs') $database (Join-Path $runDir 'task-semantics-after.json') | Out-Null
      $runtime = Get-Content -LiteralPath (Join-Path $runDir 'runtime.json') -Raw -Encoding utf8 | ConvertFrom-Json
      $latency = Get-Content -LiteralPath (Join-Path $runDir 'renderer-latency.json') -Raw -Encoding utf8 | ConvertFrom-Json
      $cadence = Get-Content -LiteralPath (Join-Path $runDir 'file-cadence.json') -Raw -Encoding utf8 | ConvertFrom-Json
      $before = Get-Content -LiteralPath (Join-Path $runDir 'task-semantics-before.json') -Raw -Encoding utf8 | ConvertFrom-Json
      $after = Get-Content -LiteralPath (Join-Path $runDir 'task-semantics-after.json') -Raw -Encoding utf8 | ConvertFrom-Json
      $businessEvidence = $null
      if ($agentProvider) {
        $businessResultScript = if ($scenario -eq 'agent-research-codex') {
          Join-Path $PSScriptRoot 'lib\agent-0228-research-result.cjs'
        } else { Join-Path $PSScriptRoot 'lib\agent-0228-business-result.cjs' }
        $businessEvidence = (& node $businessResultScript $fixture | ConvertFrom-Json)
        $businessEvidence | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $runDir 'business-result.json') -Encoding utf8
      }
      $agentBusinessCompleted = (-not $agentProvider) -or [bool]$businessEvidence.businessCompleted
      $researchBusinessCompleted = ($scenario -ne 'agent-research-codex') -or [bool]$businessEvidence.businessCompleted
      $tailIntervals = @($cadence.intervals | Select-Object -Last 12)
      $tailQuietIntervals = @($tailIntervals | Where-Object { [int]$_.changedCount -eq 0 }).Count
      $tailChangedIntervals = @($tailIntervals | Where-Object { [int]$_.changedCount -ne 0 }).Count
      $writeCadenceAccepted = (-not $cadence.continuousWriteDetected) -or ($agentProvider -and $tailQuietIntervals -ge 6 -and $tailChangedIntervals -le 1)
      $result = [ordered]@{
        runId=$runId; scenario=$scenario; repeat=$repeat; evidenceKind=$runEvidenceKind; measurementWindow='post_warmup'; warmupSeconds=$WarmupSeconds; passed=($runtime.summary.nonRespondingSamples -eq 0 -and $latency.failures.Count -eq 0 -and $latency.p95Ms -le 150 -and $latency.maximumMs -le 100 -and $writeCadenceAccepted -and $queryStressPassed -and $visibleInteractionsPassed -and ($scenario -ne "idle-unknown" -or $runtime.summary.mainCpuCoreEquivalentAveragePercent -lt 1) -and $agentBusinessCompleted);
        agentProvider=$agentProvider; agentBusinessCompleted=$agentBusinessCompleted; researchBusinessCompleted=$researchBusinessCompleted;
        businessEvidence=$businessEvidence;
        projectQueryStress=[ordered]@{ requested=[bool]$ProjectQueryStress; passed=$queryStressPassed; evidence=$(if($ProjectQueryStress){'project-query-stress.json'}else{''}) };
        visibleInteractions=[ordered]@{ requested=[bool]$VisibleInteractions; passed=$visibleInteractionsPassed; evidence=$(if($VisibleInteractions){'visible-interactions.json'}else{''}) };
        fixture=$fixture; launcherProcessId=$process.Id; mainProcessId=$mainProcessId; runtimeSummary=$runtime.summary;
        rendererSummary=[ordered]@{ sampleCount=$latency.sampleCount; p95Ms=$latency.p95Ms; maximumMs=$latency.maximumMs; failures=$latency.failures.Count };
        fileCadenceSummary=[ordered]@{ intervalCount=$cadence.intervalCount; intervalsWithChanges=$cadence.intervalsWithChanges; continuousWriteDetected=$cadence.continuousWriteDetected; tailQuietIntervals=$tailQuietIntervals; tailChangedIntervals=$tailChangedIntervals; accepted=$writeCadenceAccepted; continuousFiles=@($cadence.continuousFiles) };
        taskSemantic=[ordered]@{ before=$before.sha256; after=$after.sha256; changed=($before.sha256 -ne $after.sha256); beforeStatuses=$before.tasks; afterStatuses=$after.tasks }
      }
      $results.Add($result)
      $result | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $runDir 'summary.json') -Encoding utf8
      Write-Output ("COMPLETE {0} passed={1} cpu={2} latencyP95={3}" -f $runId,$result.passed,$runtime.summary.mainCpuCoreEquivalentAveragePercent,$latency.p95Ms)
    } finally {
      if ($renderer -and -not $renderer.HasExited) { Stop-Process -Id $renderer.Id -Force -ErrorAction SilentlyContinue }
      if ($cadenceSampler -and -not $cadenceSampler.HasExited) { Stop-Process -Id $cadenceSampler.Id -Force -ErrorAction SilentlyContinue }
      if ($queryStress -and -not $queryStress.HasExited) { Stop-Process -Id $queryStress.Id -Force -ErrorAction SilentlyContinue }
      if ($visibleInteractionProcess -and -not $visibleInteractionProcess.HasExited) { Stop-Process -Id $visibleInteractionProcess.Id -Force -ErrorAction SilentlyContinue }
      if ($process -and -not $process.HasExited) { & taskkill.exe /PID $process.Id /T /F | Out-Null }
    }
  }
}

$expectedRuns = @($Scenarios).Count * $Repeats
$report = [ordered]@{
  schema='edu.p0.host-performance.v1'; generatedAt=[DateTimeOffset]::Now.ToString('o'); candidateExe=[IO.Path]::GetFullPath($CandidateExe);
  durationSeconds=$DurationSeconds; warmupSeconds=$WarmupSeconds; measurementWindow='post_warmup'; scenarios=@($Scenarios); repeats=$Repeats; evidenceKind=$EvidenceKind; formalStudentDataTouched=$false; results=$results;
  passed=(@($results).Count -eq $expectedRuns -and @($results | Where-Object { -not $_.passed }).Count -eq 0)
}
$report | ConvertTo-Json -Depth 14 | Set-Content -LiteralPath (Join-Path $output 'performance-summary.json') -Encoding utf8
Write-Output ("OUTPUT={0}" -f (Join-Path $output 'performance-summary.json'))
if (-not $report.passed) { exit 1 }
