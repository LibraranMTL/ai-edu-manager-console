param(
  [Parameter(Mandatory = $true)]
  [string]$ApkPath,
  [string]$DeviceSerial = '',
  [string]$EvidenceDirectory = ''
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$repositoryRoot = Split-Path -Parent $projectRoot
$adb = Join-Path $repositoryRoot '.android-tools\sdk\platform-tools\adb.exe'
$buildTools = Join-Path $repositoryRoot '.android-tools\sdk\build-tools\34.0.0'
$apksigner = Join-Path $buildTools 'apksigner.bat'
$aapt = Join-Path $buildTools 'aapt.exe'
$jdkHome = Join-Path $repositoryRoot '.android-tools\jdk\jdk-21.0.11+10'
$java = Join-Path $jdkHome 'bin\java.exe'
$packageName = 'com.qxmatrix.edumanager.standalone'
$launcherActivity = "$packageName/.MainActivity"

foreach ($tool in @($adb, $apksigner, $aapt, $java)) {
  if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) {
    throw "Required Android tool does not exist: $tool"
  }
}

$resolvedApk = [IO.Path]::GetFullPath($ApkPath)
if (-not (Test-Path -LiteralPath $resolvedApk -PathType Leaf)) {
  throw 'ApkPath does not point to an existing APK.'
}

function Invoke-AdbText {
  param([string[]]$CommandArgs)
  $commandOutput = (& $adb @CommandArgs 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) {
    throw "ADB command failed: adb $($CommandArgs -join ' ')`n$commandOutput"
  }
  return $commandOutput.Trim()
}

$verificationRoot = Join-Path ([IO.Path]::GetTempPath()) ("edu-physical-verify-" + [guid]::NewGuid().ToString('N'))
$remoteScreenshot = $null
$remoteUiDump = $null
$selectedSerial = $null
$previousJavaHome = $env:JAVA_HOME
$previousPath = $env:PATH
try {
  $env:JAVA_HOME = $jdkHome
  $env:PATH = "$(Join-Path $jdkHome 'bin');$env:PATH"
  New-Item -ItemType Directory -Path $verificationRoot | Out-Null
  $verificationApk = Join-Path $verificationRoot 'release.apk'
  Copy-Item -LiteralPath $resolvedApk -Destination $verificationApk

  $signatureOutput = (& $apksigner verify --verbose --print-certs $verificationApk 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0 -or $signatureOutput -notmatch 'Verified using v2 scheme \(APK Signature Scheme v2\): true') {
    throw 'The APK is not a valid v2-signed release candidate.'
  }
  if ($signatureOutput -match 'Android Debug') {
    throw 'Android Debug certificate detected; physical household acceptance requires the product Release certificate.'
  }
  $certificateDn = [regex]::Match($signatureOutput, 'Signer #1 certificate DN:\s*(.+)').Groups[1].Value.Trim()
  $certificateSha256 = [regex]::Match($signatureOutput, 'Signer #1 certificate SHA-256 digest:\s*([a-fA-F0-9]{64})').Groups[1].Value.ToUpperInvariant()
  if ([string]::IsNullOrWhiteSpace($certificateDn) -or $certificateSha256.Length -ne 64) {
    throw 'Unable to read the product Release certificate identity.'
  }

  $badging = (& $aapt dump badging $verificationApk 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) { throw 'Unable to read APK package metadata.' }
  $packageMatch = [regex]::Match($badging, "package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'")
  if (-not $packageMatch.Success -or $packageMatch.Groups[1].Value -ne $packageName) {
    throw "The APK package must be $packageName."
  }
  $expectedVersionCode = $packageMatch.Groups[2].Value
  $expectedVersionName = $packageMatch.Groups[3].Value

  $devicesOutput = Invoke-AdbText -CommandArgs @('devices', '-l')
  $readyLines = @($devicesOutput -split "`r?`n" | Where-Object { $_ -match '^\S+\s+device(?:\s|$)' })
  if ([string]::IsNullOrWhiteSpace($DeviceSerial)) {
    if ($readyLines.Count -ne 1) {
      throw "Exactly one ready physical Android device must be connected when DeviceSerial is omitted; found $($readyLines.Count)."
    }
    $selectedLine = $readyLines[0]
    $selectedSerial = ($selectedLine -split '\s+')[0]
  } else {
    $matchingLines = @($readyLines | Where-Object { $_ -match "^$([regex]::Escape($DeviceSerial))\s+device(?:\s|$)" })
    if ($matchingLines.Count -ne 1) {
      throw 'The specified Android device is not connected and ready.'
    }
    $selectedLine = $matchingLines[0]
    $selectedSerial = $DeviceSerial
  }

  $qemu = Invoke-AdbText -CommandArgs @('-s', $selectedSerial, 'shell', 'getprop', 'ro.kernel.qemu')
  $hardware = Invoke-AdbText -CommandArgs @('-s', $selectedSerial, 'shell', 'getprop', 'ro.hardware')
  $model = Invoke-AdbText -CommandArgs @('-s', $selectedSerial, 'shell', 'getprop', 'ro.product.model')
  $manufacturer = Invoke-AdbText -CommandArgs @('-s', $selectedSerial, 'shell', 'getprop', 'ro.product.manufacturer')
  $brand = Invoke-AdbText -CommandArgs @('-s', $selectedSerial, 'shell', 'getprop', 'ro.product.brand')
  $sdk = Invoke-AdbText -CommandArgs @('-s', $selectedSerial, 'shell', 'getprop', 'ro.build.version.sdk')
  $fingerprint = Invoke-AdbText -CommandArgs @('-s', $selectedSerial, 'shell', 'getprop', 'ro.build.fingerprint')
  $emulatorSignals = @(
    ($selectedSerial -match '^emulator-'),
    ($qemu -eq '1'),
    ($hardware -match '^(ranchu|goldfish)$'),
    ($model -match 'sdk_gphone|Android SDK built for'),
    ($fingerprint -match 'generic/.+/(generic|emulator)')
  )
  if ($emulatorSignals -contains $true) {
    throw "Emulator detected ($selectedSerial, $model); final household-tablet acceptance requires a physical device."
  }

  $installOutput = Invoke-AdbText -CommandArgs @('-s', $selectedSerial, 'install', '-r', $verificationApk)
  if ($installOutput -notmatch '(?m)^Success\s*$') {
    throw "APK installation did not report success: $installOutput"
  }
  Invoke-AdbText -CommandArgs @('-s', $selectedSerial, 'shell', 'am', 'force-stop', $packageName) | Out-Null
  $launchOutput = Invoke-AdbText -CommandArgs @('-s', $selectedSerial, 'shell', 'am', 'start', '-W', '-S', '-n', $launcherActivity)
  if ($launchOutput -notmatch '(?m)^Status:\s+ok\s*$') {
    throw "Cold launch did not report Status: ok: $launchOutput"
  }
  Start-Sleep -Seconds 2
  $appPid = Invoke-AdbText -CommandArgs @('-s', $selectedSerial, 'shell', 'pidof', $packageName)
  if ([string]::IsNullOrWhiteSpace($appPid)) { throw 'The Education Manager process is not running after cold launch.' }

  $packageDump = Invoke-AdbText -CommandArgs @('-s', $selectedSerial, 'shell', 'dumpsys', 'package', $packageName)
  $installedVersionName = [regex]::Match($packageDump, '(?m)^\s*versionName=([^\r\n]+)').Groups[1].Value.Trim()
  $installedVersionCode = [regex]::Match($packageDump, '(?m)^\s*versionCode=(\d+)').Groups[1].Value
  if ($installedVersionName -ne $expectedVersionName -or $installedVersionCode -ne $expectedVersionCode) {
    throw "Installed version $installedVersionName ($installedVersionCode) does not match APK $expectedVersionName ($expectedVersionCode)."
  }

  $timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
  $evidenceRoot = if ([string]::IsNullOrWhiteSpace($EvidenceDirectory)) {
    Join-Path (Join-Path $projectRoot 'delivery') "physical-acceptance-$timestamp"
  } else {
    [IO.Path]::GetFullPath($EvidenceDirectory)
  }
  New-Item -ItemType Directory -Force -Path $evidenceRoot | Out-Null
  $remoteScreenshot = "/sdcard/edu-manager-acceptance-$timestamp.png"
  $remoteUiDump = "/sdcard/edu-manager-acceptance-$timestamp.xml"
  Invoke-AdbText -CommandArgs @('-s', $selectedSerial, 'shell', 'screencap', '-p', $remoteScreenshot) | Out-Null
  Invoke-AdbText -CommandArgs @('-s', $selectedSerial, 'pull', $remoteScreenshot, (Join-Path $evidenceRoot 'cold-launch.png')) | Out-Null
  Invoke-AdbText -CommandArgs @('-s', $selectedSerial, 'shell', 'uiautomator', 'dump', $remoteUiDump) | Out-Null
  Invoke-AdbText -CommandArgs @('-s', $selectedSerial, 'pull', $remoteUiDump, (Join-Path $evidenceRoot 'cold-launch-ui.xml')) | Out-Null
  [IO.File]::WriteAllText((Join-Path $evidenceRoot 'package-dump.txt'), $packageDump + "`n", [Text.UTF8Encoding]::new($false))
  $appPidToken = ($appPid -split '\s+')[0]
  $rawLogOutput = Invoke-AdbText -CommandArgs @('-s', $selectedSerial, 'logcat', '-d', '-v', 'threadtime', '-t', '1000')
  $logOutput = (($rawLogOutput -split "`r?`n" | Where-Object { $_ -match "^\d\d-\d\d\s+\S+\s+$([regex]::Escape($appPidToken))\s+" }) -join "`n")
  [IO.File]::WriteAllText((Join-Path $evidenceRoot 'launch-logcat.txt'), $logOutput + "`n", [Text.UTF8Encoding]::new($false))

  $manualAcceptance = @(
    [ordered]@{ id = 'student-workspace'; status = 'pending'; evidence = ''; requirement = 'Create a student workspace and adopt an existing student directory with persistable SAF access.' },
    [ordered]@{ id = 'file-asset-ocr'; status = 'pending'; evidence = ''; requirement = 'Import a file asset, index it, and complete local OCR without uploading the source.' },
    [ordered]@{ id = 'project-knowledge'; status = 'pending'; evidence = ''; requirement = 'Create and adopt project knowledge bases while preserving the LLM Wiki and AGENT rules.' },
    [ordered]@{ id = 'course-learning'; status = 'pending'; evidence = ''; requirement = 'Import a Windows course-package v3 package and learn through the restricted course WebView.' },
    [ordered]@{ id = 'screen-capture'; status = 'pending'; evidence = ''; requirement = 'Grant MediaProjection explicitly and verify capture artifacts plus the course-capture.v1 record.' },
    [ordered]@{ id = 'backup-restore'; status = 'pending'; evidence = ''; requirement = 'Export an encrypted backup and restore it into an empty selected directory.' },
    [ordered]@{ id = 'reboot-persistence'; status = 'pending'; evidence = ''; requirement = 'Reboot the tablet and verify SAF access, indexes, students, projects, and courses remain usable.' }
  )
  $result = [ordered]@{
    schema = 'edu-manager.android-physical-acceptance.v1'
    overall = 'automated-ready-manual-pending'
    createdAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    apk = [ordered]@{
      path = $resolvedApk
      sha256 = (Get-FileHash -LiteralPath $resolvedApk -Algorithm SHA256).Hash
      packageName = $packageName
      versionName = $expectedVersionName
      versionCode = [int]$expectedVersionCode
      certificateDn = $certificateDn
      certificateSha256 = $certificateSha256
    }
    device = [ordered]@{
      serial = $selectedSerial
      manufacturer = $manufacturer
      brand = $brand
      model = $model
      sdk = [int]$sdk
      hardware = $hardware
      fingerprint = $fingerprint
      physicalDeviceVerified = $true
    }
    automatedChecks = [ordered]@{
      releaseSignature = 'passed'
      physicalDevice = 'passed'
      install = 'passed'
      coldLaunch = 'passed'
      processRunning = 'passed'
      installedVersion = 'passed'
      screenshotCaptured = 'passed'
      uiHierarchyCaptured = 'passed'
    }
    manualAcceptance = $manualAcceptance
  }
  $resultPath = Join-Path $evidenceRoot 'physical-acceptance.json'
  [IO.File]::WriteAllText($resultPath, (($result | ConvertTo-Json -Depth 8) + "`n"), [Text.UTF8Encoding]::new($false))

  [pscustomobject]@{
    Status = 'AUTOMATED READY; MANUAL ACCEPTANCE PENDING'
    Device = "$manufacturer $model ($selectedSerial)"
    ApkSHA256 = $result.apk.sha256
    Evidence = $evidenceRoot
    Checklist = $resultPath
  }
} finally {
  if (-not [string]::IsNullOrWhiteSpace($remoteScreenshot) -and -not [string]::IsNullOrWhiteSpace($selectedSerial)) {
    & $adb -s $selectedSerial shell rm -f $remoteScreenshot 2>$null | Out-Null
  }
  if (-not [string]::IsNullOrWhiteSpace($remoteUiDump) -and -not [string]::IsNullOrWhiteSpace($selectedSerial)) {
    & $adb -s $selectedSerial shell rm -f $remoteUiDump 2>$null | Out-Null
  }
  if (Test-Path -LiteralPath $verificationRoot) {
    [IO.Directory]::Delete($verificationRoot, $true)
  }
  $env:JAVA_HOME = $previousJavaHome
  $env:PATH = $previousPath
}
