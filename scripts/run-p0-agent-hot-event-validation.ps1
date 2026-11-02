param(
  [Parameter(Mandatory = $true)]
  [string]$CandidateExe,
  [Parameter(Mandatory = $true)]
  [string]$SourceUserData,
  [Parameter(Mandatory = $true)]
  [string]$OutputDir,
  [ValidateRange(1, 5)]
  [int]$HotEvents = 3,
  [ValidateRange(60, 600)]
  [int]$InitialTimeoutSeconds = 300,
  [ValidateRange(60, 600)]
  [int]$EventTimeoutSeconds = 240,
  [int]$RemoteDebuggingPort = 19880
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$CandidateExe = (Resolve-Path -LiteralPath $CandidateExe).Path
$SourceUserData = (Resolve-Path -LiteralPath $SourceUserData).Path
$OutputDir = [System.IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

$token = [Guid]::NewGuid().ToString('N').Substring(0, 8)
$fixture = Join-Path $env:TEMP "edu-p0-agent-hot-$token"
$stdoutPath = Join-Path $OutputDir 'candidate.stdout.log'
$stderrPath = Join-Path $OutputDir 'candidate.stderr.log'
$timelinePath = Join-Path $OutputDir 'timeline.json'
$summaryPath = Join-Path $OutputDir 'summary.json'
$readErrorsPath = Join-Path $OutputDir 'state-read-errors.log'
$candidateHash = (Get-FileHash -LiteralPath $CandidateExe -Algorithm SHA256).Hash

& node --no-warnings (Join-Path $repoRoot 'scripts\create-p0-runtime-fixture.cjs') `
  '--scenario=agent-project-task' `
  '--agent-provider=workbuddy' `
  "--output=$fixture" `
  "--source-user-data=$SourceUserData" | Out-Null

$database = Join-Path $fixture 'student-data\.edu-manager\task-center\task-state.sqlite3'
$timeline = [System.Collections.Generic.List[object]]::new()
$eventResults = [System.Collections.Generic.List[object]]::new()

function Read-State {
  if (-not (Test-Path -LiteralPath $database)) { return $null }
  try {
    $raw = & node --no-warnings (Join-Path $repoRoot 'scripts\read-p0-agent-queue-state.cjs') `
      "--database=$database" "--fixture=$fixture" 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $raw) { return $null }
    return ($raw | ConvertFrom-Json)
  } catch {
    "$(Get-Date -Format o) $($_.Exception.Message)" | Add-Content -LiteralPath $readErrorsPath -Encoding utf8
    return $null
  }
}

function Add-Sample([string]$phase, [object]$state) {
  if ($null -eq $state) { return }
  $timeline.Add([pscustomobject]@{
    at = (Get-Date).ToString('o')
    phase = $phase
    taskStatus = $state.task.status
    settlementState = $state.task.settlementState
    businessOutcome = $state.task.businessOutcome
    attemptCount = @($state.attempts).Count
    materialCount = [int]$state.registry.materialCount
    commitCount = [int]$state.registry.commitCount
    knowledgeCount = [int]$state.registry.knowledgeCount
    adapterId = $state.task.adapterId
  })
  $timeline | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $timelinePath -Encoding utf8
}

function Wait-ForClosure(
  [string]$phase,
  [int]$expectedAttempts,
  [int]$expectedMaterials,
  [int]$expectedCommits,
  [int]$timeoutSeconds,
  [datetimeoffset]$startedAt
) {
  $deadline = [datetimeoffset]::Now.AddSeconds($timeoutSeconds)
  $registeredAt = $null
  $claimedAt = $null
  $lastState = $null
  while ([datetimeoffset]::Now -lt $deadline) {
    if ($process.HasExited) {
      throw "candidate exited during $phase (exit code $($process.ExitCode))"
    }
    $state = Read-State
    if ($null -ne $state) {
      $lastState = $state
      Add-Sample $phase $state
      if ($null -eq $registeredAt -and [int]$state.registry.materialCount -ge $expectedMaterials) {
        $registeredAt = [datetimeoffset]::Now
      }
      if ($null -eq $claimedAt -and @($state.attempts).Count -ge $expectedAttempts) {
        $claimedAt = [datetimeoffset]::Now
      }
      $closed = $state.task.status -eq 'succeeded' `
        -and $state.task.settlementState -eq 'settled' `
        -and $state.task.businessOutcome -eq 'completed' `
        -and @($state.attempts).Count -eq $expectedAttempts `
        -and [int]$state.registry.materialCount -ge $expectedMaterials `
        -and [int]$state.registry.commitCount -ge $expectedCommits `
        -and $state.knowledgeHashesMatch
      if ($closed) {
        return [pscustomobject]@{
          state = $state
          durationMs = [int][Math]::Round(([datetimeoffset]::Now - $startedAt).TotalMilliseconds)
          registrationDelayMs = if ($null -eq $registeredAt) { $null } else { [int][Math]::Round(($registeredAt - $startedAt).TotalMilliseconds) }
          claimDelayMs = if ($null -eq $claimedAt) { $null } else { [int][Math]::Round(($claimedAt - $startedAt).TotalMilliseconds) }
        }
      }
    }
    Start-Sleep -Seconds 1
    $process.Refresh()
  }
  if ($null -ne $lastState) {
    $lastState | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath (Join-Path $OutputDir "$phase-timeout-state.json") -Encoding utf8
  }
  throw "$phase did not close within $timeoutSeconds seconds"
}

$process = Start-Process -FilePath $CandidateExe `
  -ArgumentList @("--user-data-dir=$fixture", '--qa-isolated', "--remote-debugging-port=$RemoteDebuggingPort") `
  -RedirectStandardOutput $stdoutPath `
  -RedirectStandardError $stderrPath `
  -PassThru

try {
  $initialStartedAt = [datetimeoffset]::Now
  $initial = Wait-ForClosure 'initial' 1 1 1 $InitialTimeoutSeconds $initialStartedAt
  $eventResults.Add([pscustomobject]@{
    sequence = 'initial'
    passed = $true
    durationMs = $initial.durationMs
    registrationDelayMs = $initial.registrationDelayMs
    claimDelayMs = $initial.claimDelayMs
    attemptCount = @($initial.state.attempts).Count
    materialCount = $initial.state.registry.materialCount
    commitCount = $initial.state.registry.commitCount
    knowledgeCount = $initial.state.registry.knowledgeCount
  })

  for ($index = 1; $index -le $HotEvents; $index += 1) {
    $sequence = '{0:d2}' -f $index
    $injectionRaw = & node --no-warnings (Join-Path $repoRoot 'scripts\inject-p0-agent-project-material.cjs') `
      "--fixture=$fixture" "--sequence=$sequence"
    if ($LASTEXITCODE -ne 0) { throw "hot event injection $sequence failed" }
    $injection = $injectionRaw | ConvertFrom-Json
    $eventStartedAt = [datetimeoffset]::Parse([string]$injection.createdAt)
    $result = Wait-ForClosure "hot-$sequence" ($index + 1) ($index + 1) ($index + 1) $EventTimeoutSeconds $eventStartedAt
    $eventResults.Add([pscustomobject]@{
      sequence = $sequence
      passed = $true
      injectedFile = $injection.file
      injectedAt = $injection.createdAt
      durationMs = $result.durationMs
      registrationDelayMs = $result.registrationDelayMs
      claimDelayMs = $result.claimDelayMs
      attemptCount = @($result.state.attempts).Count
      materialCount = $result.state.registry.materialCount
      commitCount = $result.state.registry.commitCount
      knowledgeCount = $result.state.registry.knowledgeCount
      knowledgeHashesMatch = $result.state.knowledgeHashesMatch
    })
  }

  $finalState = Read-State
  $distinctExecutions = @($finalState.attempts | Select-Object -ExpandProperty execution_id -Unique).Count
  $summary = [pscustomobject]@{
    schema = 1
    generatedAt = (Get-Date).ToString('o')
    candidateExe = $CandidateExe
    candidateSha256 = $candidateHash
    fixture = $fixture
    hotEventCount = $HotEvents
    allPassed = @($eventResults | Where-Object { -not $_.passed }).Count -eq 0 `
      -and @($finalState.attempts).Count -eq ($HotEvents + 1) `
      -and $distinctExecutions -eq ($HotEvents + 1) `
      -and [int]$finalState.registry.commitCount -eq ($HotEvents + 1) `
      -and $finalState.knowledgeHashesMatch
    duplicateExecutions = @($finalState.attempts).Count - $distinctExecutions
    results = $eventResults
    final = [pscustomobject]@{
      taskStatus = $finalState.task.status
      settlementState = $finalState.task.settlementState
      businessOutcome = $finalState.task.businessOutcome
      attemptCount = @($finalState.attempts).Count
      materialCount = $finalState.registry.materialCount
      commitCount = $finalState.registry.commitCount
      knowledgeCount = $finalState.registry.knowledgeCount
      knowledgeHashesMatch = $finalState.knowledgeHashesMatch
    }
  }
  $timeline | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $timelinePath -Encoding utf8
  $summary | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $summaryPath -Encoding utf8
  $summary | ConvertTo-Json -Depth 20
  if (-not $summary.allPassed) { exit 1 }
} finally {
  if (-not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    $process.WaitForExit(10000) | Out-Null
  }
}
