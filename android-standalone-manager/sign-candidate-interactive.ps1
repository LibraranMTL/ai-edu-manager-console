param(
  [string]$KeystorePath = 'D:\AndroidSigning\AI-Education-Manager\ai-education-manager-release.jks',
  [string]$KeyAlias = 'ai-education-manager',
  [string]$OutputDirectory = '',
  [string]$CandidateTag = 'architecture-aligned-signed-20261002',
  [switch]$DeviceTestingOnly
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $KeystorePath -PathType Leaf)) { throw 'Release keystore not found.' }
if ($DeviceTestingOnly -and [string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $PSScriptRoot "delivery\candidates\$CandidateTag"
}
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
  # sign-release.ps1 performs the authoritative APK signature, historical
  # certificate continuity and v1/v2 verification checks. Avoid a duplicate
  # keytool preflight here because Windows PowerShell 5.1 can convert harmless
  # native stderr diagnostics into a terminating NativeCommandError.
  & (Join-Path $PSScriptRoot 'sign-release.ps1') -OutputDirectory $OutputDirectory -CandidateTag $CandidateTag -DeviceTestingOnly:$DeviceTestingOnly
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($eduPointer)
  $eduSecret.Dispose()
  foreach ($eduName in $eduNames) { [Environment]::SetEnvironmentVariable($eduName, $eduPrevious[$eduName]) }
}
