param(
  [string]$KeystorePath = 'D:\AndroidSigning\AI-Education-Manager\ai-education-manager-release.jks',
  [string]$KeyAlias = 'ai-education-manager',
  [string]$OutputDirectory = '',
  [string]$CandidateTag = 'architecture-aligned-signed-20261002'
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $KeystorePath -PathType Leaf)) { throw 'Release keystore not found.' }
$eduNames = @('EDU_ANDROID_KEYSTORE','EDU_ANDROID_KEYSTORE_PASSWORD','EDU_ANDROID_KEY_ALIAS','EDU_ANDROID_KEY_PASSWORD')
$eduPrevious = @{}
foreach ($eduName in $eduNames) { $eduPrevious[$eduName] = [Environment]::GetEnvironmentVariable($eduName) }
$eduSecret = Read-Host 'Release signing password (hidden; not saved)' -AsSecureString
$eduPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($eduSecret)
try {
  $env:EDU_ANDROID_KEYSTORE = [IO.Path]::GetFullPath($KeystorePath)
  $env:EDU_ANDROID_KEY_ALIAS = $KeyAlias
  $env:EDU_ANDROID_KEYSTORE_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($eduPointer)
  $env:EDU_ANDROID_KEY_PASSWORD = $env:EDU_ANDROID_KEYSTORE_PASSWORD
  $eduRepo = Split-Path -Parent $PSScriptRoot
  $eduKeytool = Join-Path $eduRepo '.android-tools\jdk\jdk-21.0.11+10\bin\keytool.exe'
  $eduCertOutput = (& $eduKeytool -exportcert -rfc -keystore $env:EDU_ANDROID_KEYSTORE -storepass:env EDU_ANDROID_KEYSTORE_PASSWORD -alias $KeyAlias 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) { throw 'Cannot read release certificate; password/alias needs verification.' }
  $eduMatch = [regex]::Match($eduCertOutput, '-----BEGIN CERTIFICATE-----\s*(.*?)\s*-----END CERTIFICATE-----', [Text.RegularExpressions.RegexOptions]::Singleline)
  if (-not $eduMatch.Success) { throw 'Release certificate extraction failed.' }
  $eduHasher = [Security.Cryptography.SHA256]::Create()
  try { $eduDigest = [BitConverter]::ToString($eduHasher.ComputeHash([Convert]::FromBase64String(($eduMatch.Groups[1].Value -replace '\s','')))).Replace('-','') } finally { $eduHasher.Dispose() }
  $eduBaselinePath = Join-Path $PSScriptRoot 'delivery\candidates\cloud-report-20260926\AI-Education-Manager-Android-Standalone-1.2.6-cloud-report-20260926.json'
  $eduBaseline = Get-Content -LiteralPath $eduBaselinePath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($eduDigest -ne $eduBaseline.certificateSha256) { throw 'Signing identity does not match recorded 1.2.6 baseline; refusing incompatible package.' }
  Write-Host "Certificate matches recorded 1.2.6 baseline: $eduDigest"
  & (Join-Path $PSScriptRoot 'sign-release.ps1') -OutputDirectory $OutputDirectory -CandidateTag $CandidateTag
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($eduPointer)
  $eduSecret.Dispose()
  foreach ($eduName in $eduNames) { [Environment]::SetEnvironmentVariable($eduName, $eduPrevious[$eduName]) }
}
