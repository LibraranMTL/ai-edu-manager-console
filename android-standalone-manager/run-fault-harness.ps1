param(
  [Parameter(Mandatory=$true)][string]$Adb,
  [string]$Device = '88Y0219B28005238',
  [string]$PackageDirectory = 'D:\AndroidCandidates\standalone-fault-harness-20261112',
  [switch]$Resume,
  [switch]$ResumeReport
)
$ErrorActionPreference = 'Stop'
$appId = 'com.qxmatrix.edumanager.standalone.faulttest'
$runner = "$appId.test/androidx.test.runner.AndroidJUnitRunner"
$testClass = 'com.qxmatrix.edumanager.standalone.FaultRecoveryInstrumentationTest'
$app = Join-Path $PackageDirectory 'fault-app.apk'
$test = Join-Path $PackageDirectory 'fault-instrumentation.apk'
if ($ResumeReport) { $Resume = $true }
if (-not (Test-Path -LiteralPath $app) -or -not (Test-Path -LiteralPath $test)) { throw 'Signed isolated test packages are missing.' }
$deviceState = & $Adb -s $Device get-state 2>&1
if ($LASTEXITCODE -ne 0 -or "$deviceState".Trim() -ne 'device') { throw 'The selected test device is not ready.' }
$existing = & $Adb -s $Device shell pm path $appId 2>&1
if (-not $Resume -and ($existing -join "`n") -match '^package:') { throw 'The isolated fault package already exists. Existing data is preserved; inspect it before continuing.' }
if ($Resume -and ($existing -join "`n") -notmatch '^package:') { throw 'The isolated fault package is missing; cannot resume.' }
if ($Resume) { & $Adb -s $Device install -r $app } else { & $Adb -s $Device install $app }
if ($LASTEXITCODE -ne 0) { throw 'Isolated application installation failed.' }
if ($Resume) { & $Adb -s $Device install -r $test } else { & $Adb -s $Device install $test }
if ($LASTEXITCODE -ne 0) { throw 'Instrumentation installation failed; isolated application is retained.' }
function Invoke-Phase([string]$Phase, [bool]$ExpectCrash, [string]$Expected = '') {
  Write-Host "Running phase: $Phase"
  $adbArguments = @('-s', $Device, 'shell', 'am', 'instrument', '-w', '-r', '-e', 'class', $testClass, '-e', 'phase', $Phase)
  if ($Expected) { $adbArguments += @('-e', 'expected', $Expected) }
  $adbArguments += $runner
  $result = & $Adb @adbArguments 2>&1
  $result | ForEach-Object { Write-Host $_ }
  $output = $result -join "`n"
  if (-not $ExpectCrash -and ($LASTEXITCODE -ne 0 -or $output -notmatch 'OK \(1 test\)')) { throw "Phase failed: $Phase" }
  if ($ExpectCrash -and $output -notmatch 'shortMsg=Process crashed') { throw "Expected process termination was not observed: $Phase" }
}
if ($ResumeReport) {
  Invoke-Phase 'report_verify' $false
  Write-Host 'Report recovery verification finished; evidence remains in the isolated package.'
  return
} elseif ($Resume) {
  Invoke-Phase 'digest_repair' $false
} else {
  $smoke = & $Adb -s $Device shell am instrument -w -r -e class 'com.qxmatrix.edumanager.standalone.FaultHarnessSmokeTest' $runner 2>&1
  $smoke | ForEach-Object { Write-Host $_ }
  if (($smoke -join "`n") -notmatch 'OK \(1 test\)') { throw 'Synthetic workspace smoke test failed.' }
  Invoke-Phase 'bootstrap' $false
  Invoke-Phase 'import_abort' $true
  Invoke-Phase 'import_verify' $false
  Invoke-Phase 'digest_checkpoint_abort' $true
  Invoke-Phase 'digest_verify' $false 'digest_checkpoint'
}
Invoke-Phase 'knowledge_registered_abort' $true
Invoke-Phase 'digest_verify' $false 'knowledge_registered'
Invoke-Phase 'report_setup' $false
Invoke-Phase 'report_abort' $true
Invoke-Phase 'report_verify' $false
Write-Host 'Isolated synthetic fault phases finished; evidence remains in the isolated package.'
