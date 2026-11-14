param(
  [string]$DeviceSerial = '',
  [ValidateRange(1, 65535)]
  [int]$AdbServerPort = 5037,
  [string]$OutputDirectory = '',
  [string]$CandidateTag = '',
  [string]$PerformanceBaselinePath = '',
  [string]$PerformanceResultPath = '',
  [switch]$DeviceTestingOnly
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$repositoryRoot = Split-Path -Parent $projectRoot
$deliveryRoot = if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  Join-Path $projectRoot 'delivery'
} else {
  [IO.Path]::GetFullPath($OutputDirectory)
}
$candidateTagValue = $CandidateTag.Trim()
if (-not [string]::IsNullOrWhiteSpace($candidateTagValue) -and $candidateTagValue -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$') {
  throw 'CandidateTag must use 1-80 letters, digits, dots, underscores or hyphens.'
}
$jdkHome = Join-Path $repositoryRoot '.android-tools\jdk\jdk-21.0.11+10'
$buildTools = Join-Path $repositoryRoot '.android-tools\sdk\build-tools\34.0.0'
$apksigner = Join-Path $buildTools 'apksigner.bat'
$aapt = Join-Path $buildTools 'aapt.exe'
$performanceRoot = Join-Path $projectRoot 'delivery\verification\performance'
$resolvedPerformanceBaseline = if ([string]::IsNullOrWhiteSpace($PerformanceBaselinePath)) { Join-Path $performanceRoot 'baseline.json' } else { [IO.Path]::GetFullPath($PerformanceBaselinePath) }
$resolvedPerformanceResult = if ([string]::IsNullOrWhiteSpace($PerformanceResultPath)) { Join-Path $performanceRoot 'current.json' } else { [IO.Path]::GetFullPath($PerformanceResultPath) }
if ($DeviceTestingOnly -and [string]::IsNullOrWhiteSpace($candidateTagValue)) {
  throw 'DeviceTestingOnly requires CandidateTag so the artifact cannot be mistaken for a formal release.'
}
if (-not $DeviceTestingOnly) {
  & (Join-Path $projectRoot 'verify-performance-gate.ps1') -BaselinePath $resolvedPerformanceBaseline -ResultPath $resolvedPerformanceResult
}

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
  if ($LASTEXITCODE -ne 0 -or $signatureOutput -notmatch 'Verifies' -or $signatureOutput -notmatch 'Verified using v1 scheme \(JAR signing\): true' -or $signatureOutput -notmatch 'Verified using v2 scheme \(APK Signature Scheme v2\): true') {
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

  # Candidate output directories must still be checked against the original release identity.
  $previousReleaseMetadata = Get-ChildItem -LiteralPath (Join-Path $projectRoot 'delivery') -File -Filter 'AI-Education-Manager-Android-Standalone-*-release.json' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending
  foreach ($previousMetadataFile in $previousReleaseMetadata) {
    $previousMetadata = Get-Content -LiteralPath $previousMetadataFile.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([string]$previousMetadata.packageName -eq 'com.qxmatrix.edumanager.standalone' -and -not [string]::IsNullOrWhiteSpace([string]$previousMetadata.certificateSha256)) {
      $trustedCertificateSha256 = ([string]$previousMetadata.certificateSha256).ToUpperInvariant()
      if ($trustedCertificateSha256 -ne $certificateSha256) {
        throw "Release certificate does not match the previous formal Android standalone release ($($previousMetadataFile.Name)). Refusing an APK that would conflict with installed copies."
      }
      break
    }
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
  $artifactLabel = if ([string]::IsNullOrWhiteSpace($candidateTagValue)) { 'release' } else { $candidateTagValue }
  # Device-test candidates already live in a uniquely named candidate folder.
  # Always use a short artifact name so Unicode workspace paths stay safely
  # below the legacy Windows path limit during the final atomic copy.
  $fileArtifactLabel = if ($DeviceTestingOnly) { 'device-test' } else { $artifactLabel }
  $proposedFinalName = "AI-Education-Manager-Android-Standalone-$versionName-$fileArtifactLabel.apk"
  # Keep the full candidate tag in metadata, but avoid Windows/tooling failures
  # when a descriptive candidate directory and file name together approach
  # MAX_PATH. Candidate directories are already unique, so a short file label
  # remains unambiguous inside that directory.
  if ((Join-Path $deliveryRoot $proposedFinalName).Length -ge 240) {
    $fileArtifactLabel = 'candidate'
  }
  $finalName = "AI-Education-Manager-Android-Standalone-$versionName-$fileArtifactLabel.apk"
  $finalPath = Join-Path $deliveryRoot $finalName
  $stagedPath = Join-Path $deliveryRoot "$finalName.new"
  Copy-Item -LiteralPath $verificationApk -Destination $stagedPath -Force
  $verifiedSha256 = (Get-FileHash -LiteralPath $verificationApk -Algorithm SHA256).Hash
  if ((Get-FileHash -LiteralPath $stagedPath -Algorithm SHA256).Hash -ne $verifiedSha256) {
    throw 'The staged delivery APK does not match the verified APK.'
  }
  if (Test-Path -LiteralPath $finalPath) {
    throw "正式发布目标已存在，请先提升版本号，避免覆盖既有正式安装包：$finalPath"
  }
  # A same-directory rename and File.Copy have both failed intermittently on
  # long Unicode candidate paths. Stream the already-verified staged artifact
  # into a CreateNew destination, flush it to disk, verify it again, and only
  # then remove the staging file. A partial destination is removed on failure;
  # the verified .new file remains available for diagnosis and retry.
  $sourceStream = $null
  $destinationStream = $null
  try {
    $sourceStream = [IO.FileStream]::new(
      $stagedPath,
      [IO.FileMode]::Open,
      [IO.FileAccess]::Read,
      [IO.FileShare]::Read
    )
    $destinationStream = [IO.FileStream]::new(
      $finalPath,
      [IO.FileMode]::CreateNew,
      [IO.FileAccess]::Write,
      [IO.FileShare]::None
    )
    $sourceStream.CopyTo($destinationStream)
    $destinationStream.Flush($true)
  } catch {
    if ($null -ne $destinationStream) {
      $destinationStream.Dispose()
      $destinationStream = $null
    }
    if (Test-Path -LiteralPath $finalPath -PathType Leaf) {
      [IO.File]::Delete($finalPath)
    }
    throw "Unable to promote the verified staged APK: $($_.Exception.Message)"
  } finally {
    if ($null -ne $destinationStream) { $destinationStream.Dispose() }
    if ($null -ne $sourceStream) { $sourceStream.Dispose() }
  }
  if ((Get-FileHash -LiteralPath $finalPath -Algorithm SHA256).Hash -ne $verifiedSha256) {
    throw 'The final delivery APK does not match the verified staged APK.'
  }
  [IO.File]::Delete($stagedPath)

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
    releaseStatus = if ($DeviceTestingOnly) { 'device-test-candidate' } elseif ([string]::IsNullOrWhiteSpace($candidateTagValue)) { 'release' } else { 'candidate' }
    candidateTag = $candidateTagValue
    performanceGate = if ($DeviceTestingOnly) { 'pending-device-test-only' } else { 'passed' }
    builtAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  }
  $metadataPath = Join-Path $deliveryRoot "AI-Education-Manager-Android-Standalone-$versionName-$fileArtifactLabel.json"
  [IO.File]::WriteAllText($metadataPath, (($metadata | ConvertTo-Json -Depth 4) + "`n"), [Text.UTF8Encoding]::new($false))

  $deviceVerification = $null
  if (-not [string]::IsNullOrWhiteSpace($DeviceSerial)) {
    $deviceVerification = & (Join-Path $projectRoot 'verify-physical-device.ps1') -ApkPath $finalPath -DeviceSerial $DeviceSerial -AdbServerPort $AdbServerPort
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
