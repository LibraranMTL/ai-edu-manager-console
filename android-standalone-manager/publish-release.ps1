param(
  [string]$KeystorePath = '',
  [string]$KeyAlias = '',
  [string]$DeviceSerial = '',
  [string]$OutputDirectory = '',
  [switch]$ResetSigningLocation
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$repositoryRoot = Split-Path -Parent $projectRoot
$localConfigRoot = Join-Path $env:LOCALAPPDATA 'QxMatrix\EduManager'
$localConfigPath = Join-Path $localConfigRoot 'android-signing-location.json'
$releaseScript = Join-Path $projectRoot 'sign-release.ps1'
$environmentNames = @(
  'EDU_ANDROID_KEYSTORE',
  'EDU_ANDROID_KEYSTORE_PASSWORD',
  'EDU_ANDROID_KEY_ALIAS',
  'EDU_ANDROID_KEY_PASSWORD'
)
$configuredKeystore = [Environment]::GetEnvironmentVariable('EDU_ANDROID_KEYSTORE', 'Process')
$configuredAlias = [Environment]::GetEnvironmentVariable('EDU_ANDROID_KEY_ALIAS', 'Process')

function ConvertFrom-SecureInput {
  param([Security.SecureString]$Value)
  $pointer = [IntPtr]::Zero
  try {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    if ($pointer -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
  }
}

function Assert-SigningLocation {
  param([string]$PathValue, [string]$AliasValue)
  if ([string]::IsNullOrWhiteSpace($PathValue)) { throw 'Keystore path cannot be empty.' }
  if ([string]::IsNullOrWhiteSpace($AliasValue)) { throw 'Key alias cannot be empty.' }
  $absolutePath = [IO.Path]::GetFullPath($PathValue)
  if (-not (Test-Path -LiteralPath $absolutePath -PathType Leaf)) { throw "Keystore does not exist: $absolutePath" }
  $repositoryPrefix = [IO.Path]::GetFullPath($repositoryRoot).TrimEnd('\') + '\'
  if ($absolutePath.StartsWith($repositoryPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The release keystore must not be stored inside the source repository.'
  }
  return [pscustomobject]@{ keystorePath = $absolutePath; keyAlias = $AliasValue.Trim() }
}

if ($ResetSigningLocation -and (Test-Path -LiteralPath $localConfigPath)) {
  Remove-Item -LiteralPath $localConfigPath -Force
}

$location = $null
if (-not [string]::IsNullOrWhiteSpace($KeystorePath) -or -not [string]::IsNullOrWhiteSpace($KeyAlias)) {
  $location = Assert-SigningLocation -PathValue $KeystorePath -AliasValue $KeyAlias
} elseif (-not [string]::IsNullOrWhiteSpace($configuredKeystore) -and -not [string]::IsNullOrWhiteSpace($configuredAlias)) {
  $location = Assert-SigningLocation -PathValue $configuredKeystore -AliasValue $configuredAlias
} elseif (Test-Path -LiteralPath $localConfigPath -PathType Leaf) {
  $saved = Get-Content -LiteralPath $localConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $location = Assert-SigningLocation -PathValue ([string]$saved.keystorePath) -AliasValue ([string]$saved.keyAlias)
} else {
  Write-Host 'First use: only the non-secret keystore path and alias are saved. Passwords are never written to disk.'
  $inputPath = Read-Host 'Android Release keystore full path'
  $inputAlias = Read-Host 'Android Release key alias'
  $location = Assert-SigningLocation -PathValue $inputPath -AliasValue $inputAlias
}

if (-not (Test-Path -LiteralPath $localConfigRoot -PathType Container)) {
  New-Item -ItemType Directory -Path $localConfigRoot -Force | Out-Null
}
$locationJson = [ordered]@{
  schema = 'edu-manager.android-signing-location.v1'
  keystorePath = $location.keystorePath
  keyAlias = $location.keyAlias
} | ConvertTo-Json
[IO.File]::WriteAllText($localConfigPath, $locationJson + "`n", [Text.UTF8Encoding]::new($false))

$storeSecure = $null
$keySecure = $null
$storePassword = [Environment]::GetEnvironmentVariable('EDU_ANDROID_KEYSTORE_PASSWORD', 'Process')
$keyPassword = [Environment]::GetEnvironmentVariable('EDU_ANDROID_KEY_PASSWORD', 'Process')
if ([string]::IsNullOrEmpty($storePassword)) {
  $storeSecure = Read-Host 'Keystore password (used only for this release)' -AsSecureString
  $storePassword = ConvertFrom-SecureInput $storeSecure
}
if ([string]::IsNullOrEmpty($keyPassword)) {
  $keySecure = Read-Host 'Key password (press Enter to reuse the keystore password)' -AsSecureString
  $keyPassword = ConvertFrom-SecureInput $keySecure
}
if ([string]::IsNullOrEmpty($storePassword)) { throw 'Keystore password cannot be empty.' }
if ([string]::IsNullOrEmpty($keyPassword)) { $keyPassword = $storePassword }

$previousEnvironment = @{}
foreach ($name in $environmentNames) {
  $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

try {
  [Environment]::SetEnvironmentVariable('EDU_ANDROID_KEYSTORE', $location.keystorePath, 'Process')
  [Environment]::SetEnvironmentVariable('EDU_ANDROID_KEYSTORE_PASSWORD', $storePassword, 'Process')
  [Environment]::SetEnvironmentVariable('EDU_ANDROID_KEY_ALIAS', $location.keyAlias, 'Process')
  [Environment]::SetEnvironmentVariable('EDU_ANDROID_KEY_PASSWORD', $keyPassword, 'Process')

  $releaseArguments = @{}
  if (-not [string]::IsNullOrWhiteSpace($DeviceSerial)) { $releaseArguments.DeviceSerial = $DeviceSerial }
  if (-not [string]::IsNullOrWhiteSpace($OutputDirectory)) { $releaseArguments.OutputDirectory = $OutputDirectory }
  & $releaseScript @releaseArguments
  if ($LASTEXITCODE -ne 0) { throw "Android release signing failed with exit code $LASTEXITCODE" }
} finally {
  foreach ($name in $environmentNames) {
    [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
  }
  $storePassword = $null
  $keyPassword = $null
  $storeSecure = $null
  $keySecure = $null
  [GC]::Collect()
}
