param(
  [string]$DeviceSerial = '',
  [string]$OutputDirectory = ''
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$repositoryRoot = Split-Path -Parent $projectRoot
$deliveryRoot = if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  Join-Path $projectRoot 'delivery'
} else {
  [IO.Path]::GetFullPath($OutputDirectory)
}
$jdkHome = Join-Path $repositoryRoot '.android-tools\jdk\jdk-21.0.11+10'
$buildTools = Join-Path $repositoryRoot '.android-tools\sdk\build-tools\34.0.0'
$apksigner = Join-Path $buildTools 'apksigner.bat'
$aapt = Join-Path $buildTools 'aapt.exe'

$requiredEnvironment = @(
  'EDU_ANDROID_KEYSTORE',
  'EDU_ANDROID_KEYSTORE_PASSWORD',
  'EDU_ANDROID_KEY_ALIAS',
  'EDU_ANDROID_KEY_PASSWORD'
)
$missing = $requiredEnvironment | Where-Object { [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_)) }
if ($missing.Count -gt 0) {
  throw "Release signing environment is incomplete: $($missing -join ', '). Set secrets only in the local process environment."
}

$keystorePath = [IO.Path]::GetFullPath([Environment]::GetEnvironmentVariable('EDU_ANDROID_KEYSTORE'))
if (-not (Test-Path -LiteralPath $keystorePath -PathType Leaf)) {
  throw 'EDU_ANDROID_KEYSTORE does not point to an existing file.'
}
$repositoryPrefix = [IO.Path]::GetFullPath($repositoryRoot).TrimEnd('\') + '\'
if ($keystorePath.StartsWith($repositoryPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'The release keystore must not be stored inside the source repository.'
}
foreach ($tool in @($apksigner, $aapt, (Join-Path $jdkHome 'bin\java.exe'))) {
  if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) { throw "Required release tool does not exist: $tool" }
}

$previousJavaHome = $env:JAVA_HOME
$previousPath = $env:PATH
$verificationRoot = $null
try {
  $env:JAVA_HOME = $jdkHome
  $env:PATH = "$(Join-Path $jdkHome 'bin');$env:PATH"

  & (Join-Path $projectRoot 'build.ps1') assembleRelease
  if ($LASTEXITCODE -ne 0) { throw "Release build failed with exit code $LASTEXITCODE" }

  $builtApk = Join-Path $projectRoot 'app\build\outputs\apk\release\app-release.apk'
  $unsignedApk = Join-Path $projectRoot 'app\build\outputs\apk\release\app-release-unsigned.apk'
  if (-not (Test-Path -LiteralPath $builtApk -PathType Leaf) -or (Test-Path -LiteralPath $unsignedApk -PathType Leaf)) {
    throw 'A unique signed app-release.apk was not produced; unsigned candidates are rejected.'
  }

  $verificationRoot = Join-Path ([IO.Path]::GetTempPath()) ("edu-android-release-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $verificationRoot | Out-Null
  $verificationApk = Join-Path $verificationRoot 'app-release.apk'
  Copy-Item -LiteralPath $builtApk -Destination $verificationApk

  $signatureOutput = (& $apksigner verify --verbose --print-certs --print-certs-pem $verificationApk 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0 -or $signatureOutput -notmatch 'Verifies' -or $signatureOutput -notmatch 'Verified using v2 scheme \(APK Signature Scheme v2\): true') {
    throw 'APK signature verification failed or APK Signature Scheme v2 is not enabled.'
  }
  if ($signatureOutput -match 'Android Debug') {
    throw 'Android Debug certificate detected; refusing to create a household release.'
  }
  $certificatePem = [regex]::Match(
    $signatureOutput,
    '-----BEGIN CERTIFICATE-----\s*(.*?)\s*-----END CERTIFICATE-----',
    [Text.RegularExpressions.RegexOptions]::Singleline
  )
  if (-not $certificatePem.Success) {
    throw 'Unable to extract the release certificate for Unicode-safe identity verification.'
  }
  $certificateRaw = [Convert]::FromBase64String(($certificatePem.Groups[1].Value -replace '\s', ''))
  $certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($certificateRaw)
  try {
    $certificateDn = $certificate.Subject
  } finally {
    $certificate.Dispose()
  }
  $certificateSha256 = [regex]::Match($signatureOutput, 'Signer #1 certificate SHA-256 digest:\s*([a-fA-F0-9]{64})').Groups[1].Value.ToUpperInvariant()
  if ([string]::IsNullOrWhiteSpace($certificateDn) -or $certificateSha256.Length -ne 64) {
    throw 'Unable to read the release certificate identity or SHA-256 fingerprint.'
  }

  $badging = (& $aapt dump badging $verificationApk 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) { throw 'Unable to read Release APK package metadata.' }
  $packageMatch = [regex]::Match($badging, "package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'")
  if (-not $packageMatch.Success) { throw 'Release APK package metadata format is not recognized.' }
  $packageName = $packageMatch.Groups[1].Value
  $versionCode = $packageMatch.Groups[2].Value
  $versionName = $packageMatch.Groups[3].Value
  if ($packageName -ne 'com.qxmatrix.edumanager.standalone') {
    throw "Unexpected Release APK package name: $packageName"
  }

  New-Item -ItemType Directory -Force -Path $deliveryRoot | Out-Null
  $finalName = "AI-Education-Manager-Android-Standalone-$versionName-release.apk"
  $finalPath = Join-Path $deliveryRoot $finalName
  $stagedPath = Join-Path $deliveryRoot "$finalName.new"
  Copy-Item -LiteralPath $verificationApk -Destination $stagedPath -Force
  $verifiedSha256 = (Get-FileHash -LiteralPath $verificationApk -Algorithm SHA256).Hash
  if ((Get-FileHash -LiteralPath $stagedPath -Algorithm SHA256).Hash -ne $verifiedSha256) {
    throw 'The staged delivery APK does not match the verified APK.'
  }
  Move-Item -LiteralPath $stagedPath -Destination $finalPath -Force

  $artifact = Get-Item -LiteralPath $finalPath
  $artifactSha256 = (Get-FileHash -LiteralPath $finalPath -Algorithm SHA256).Hash
  $metadata = [ordered]@{
    schema = 'edu-manager.android-release.v1'
    packageName = $packageName
    versionName = $versionName
    versionCode = [int]$versionCode
    fileName = $artifact.Name
    bytes = $artifact.Length
    sha256 = $artifactSha256
    certificateDn = $certificateDn
    certificateSha256 = $certificateSha256
    signatureSchemes = @('v1', 'v2')
    builtAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  }
  $metadataPath = Join-Path $deliveryRoot "AI-Education-Manager-Android-Standalone-$versionName-release.json"
  [IO.File]::WriteAllText($metadataPath, (($metadata | ConvertTo-Json -Depth 4) + "`n"), [Text.UTF8Encoding]::new($false))

  $deviceVerification = $null
  if (-not [string]::IsNullOrWhiteSpace($DeviceSerial)) {
    $deviceVerification = & (Join-Path $projectRoot 'verify-physical-device.ps1') -ApkPath $finalPath -DeviceSerial $DeviceSerial
  }

  [pscustomobject]@{
    Apk = $finalPath
    Metadata = $metadataPath
    SHA256 = $artifactSha256
    CertificateSHA256 = $certificateSha256
    InstalledDevice = $DeviceSerial
    PhysicalEvidence = if ($null -eq $deviceVerification) { '' } else { $deviceVerification.Evidence }
    PhysicalChecklist = if ($null -eq $deviceVerification) { '' } else { $deviceVerification.Checklist }
  } | Format-List
} finally {
  if ($null -ne $verificationRoot -and (Test-Path -LiteralPath $verificationRoot)) {
    [IO.Directory]::Delete($verificationRoot, $true)
  }
  $env:JAVA_HOME = $previousJavaHome
  $env:PATH = $previousPath
}
