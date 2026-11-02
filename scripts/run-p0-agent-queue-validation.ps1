param(
  [Parameter(Mandatory = $true)]
  [string]$CandidateExe,
  [Parameter(Mandatory = $true)]
  [string]$SourceUserData,
  [Parameter(Mandatory = $true)]
  [string]$OutputDir,
  [ValidateRange(1, 10)]
  [int]$Runs = 3,
  [ValidateRange(30, 600)]
  [int]$TimeoutSeconds = 300,
  [int]$RemoteDebuggingPortBase = 19700,
  [switch]$UseSourceWorkBuddyAuth
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$CandidateExe = (Resolve-Path -LiteralPath $CandidateExe).Path
$SourceUserData = (Resolve-Path -LiteralPath $SourceUserData).Path
$OutputDir = [System.IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

$candidateHash = (Get-FileHash -LiteralPath $CandidateExe -Algorithm SHA256).Hash
$results = @()

for ($run = 1; $run -le $Runs; $run += 1) {
  $token = [Guid]::NewGuid().ToString('N').Substring(0, 8)
  $fixture = Join-Path $env:TEMP "edu-p0-agent-repeat-$run-$token"
  $runDir = Join-Path $OutputDir "run-$('{0:d2}' -f $run)"
  New-Item -ItemType Directory -Path $runDir -Force | Out-Null
  $manifestPath = Join-Path $fixture 'p0-fixture-manifest.json'
  $stdoutPath = Join-Path $runDir 'candidate.stdout.log'
  $stderrPath = Join-Path $runDir 'candidate.stderr.log'
  $statePath = Join-Path $runDir 'final-state.json'

  $fixtureArguments = @(
    (Join-Path $repoRoot 'scripts\create-p0-runtime-fixture.cjs'),
    '--scenario=agent-project-task',
    '--agent-provider=workbuddy',
    "--output=$fixture",
    "--source-user-data=$SourceUserData"
  )
  if ($UseSourceWorkBuddyAuth) {
    $fixtureArguments += "--source-workbuddy-auth=$(Join-Path $SourceUserData 'classification-auth\workbuddy.json')"
  }
  & node --no-warnings @fixtureArguments | Out-Null

  $port = $RemoteDebuggingPortBase + $run
  $startedAt = [DateTimeOffset]::Now
  $process = Start-Process -FilePath $CandidateExe `
    -ArgumentList @("--user-data-dir=$fixture", '--qa-isolated', "--remote-debugging-port=$port") `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -PassThru

  $database = Join-Path $fixture 'student-data\.edu-manager\task-center\task-state.sqlite3'
  $finalState = $null
  $deadline = [DateTimeOffset]::Now.AddSeconds($TimeoutSeconds)
  try {
    while ([DateTimeOffset]::Now -lt $deadline) {
      if ($process.HasExited) {
        throw "candidate exited before terminal task state (exit code $($process.ExitCode))"
      }
      if (Test-Path -LiteralPath $database) {
        try {
          $raw = & node --no-warnings (Join-Path $repoRoot 'scripts\read-p0-agent-queue-state.cjs') `
            "--database=$database" "--fixture=$fixture" 2>$null
          if ($LASTEXITCODE -eq 0 -and $raw) {
            $state = $raw | ConvertFrom-Json
            if ($state.task.status -in @('succeeded', 'failed', 'cancelled', 'archived', 'manual')) {
              $finalState = $state
              break
            }
          }
        } catch {
          # The database can exist before the migration and import transaction finishes.
        }
      }
      Start-Sleep -Seconds 2
      $process.Refresh()
    }

    if ($null -eq $finalState) {
      throw "task did not reach a terminal state within $TimeoutSeconds seconds"
    }
    $finalState | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $statePath -Encoding utf8
    $durationMs = [int][Math]::Round(([DateTimeOffset]::Now - $startedAt).TotalMilliseconds)
    $passed = $finalState.task.status -eq 'succeeded' `
      -and $finalState.task.settlementState -eq 'settled' `
      -and $finalState.task.businessOutcome -eq 'completed' `
      -and $finalState.attempts.Count -eq 1 `
      -and $finalState.attempts[0].phase -eq 'settled' `
      -and $finalState.attempts[0].result_kind -eq 'completed' `
      -and $finalState.task.adapterId -eq 'workbuddy' `
      -and $finalState.registry.commitCount -eq 1 `
      -and $finalState.registry.knowledgeCount -gt 0 `
      -and $finalState.knowledgeHashesMatch
    $results += [pscustomobject]@{
      run = $run
      fixture = $fixture
      fixtureManifestSha256 = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash
      durationMs = $durationMs
      passed = $passed
      taskStatus = $finalState.task.status
      settlementState = $finalState.task.settlementState
      businessOutcome = $finalState.task.businessOutcome
      adapterId = $finalState.task.adapterId
      attemptCount = $finalState.attempts.Count
      knowledgeCount = $finalState.registry.knowledgeCount
      knowledgeHashesMatch = $finalState.knowledgeHashesMatch
      stateFile = $statePath
    }
  } finally {
    if (-not $process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      $process.WaitForExit(10000) | Out-Null
    }
  }
}

$summary = [pscustomobject]@{
  schema = 1
  generatedAt = (Get-Date).ToString('o')
  candidateExe = $CandidateExe
  candidateSha256 = $candidateHash
  runCount = $Runs
  passedCount = @($results | Where-Object passed).Count
  allPassed = @($results | Where-Object { -not $_.passed }).Count -eq 0
  expectedAdapterId = 'workbuddy'
  sourceWorkBuddyAuthorizationDescriptor = [bool]$UseSourceWorkBuddyAuth
  results = $results
}
$summaryPath = Join-Path $OutputDir 'summary.json'
$summary | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $summaryPath -Encoding utf8
$summary | ConvertTo-Json -Depth 10
if (-not $summary.allPassed) { exit 1 }

