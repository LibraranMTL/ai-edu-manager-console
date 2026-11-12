param(
  [string]$ToolsRoot = 'C:\Users\bxw00\android-build-deps',
  [string]$GradleRoot = 'C:\Users\bxw00\android-build-deps\gradle\gradle-8.10.2',
  [string]$KeystorePath = 'D:\AndroidSigning\AI-Education-Manager\ai-education-manager-release.jks',
  [string]$OutputDirectory = 'D:\AndroidCandidates\standalone-fault-harness-r18-scope-20261112'
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
if (Test-Path -LiteralPath $OutputDirectory) { throw "Output directory already exists: $OutputDirectory" }
if (-not (Test-Path -LiteralPath $KeystorePath -PathType Leaf)) { throw 'Release keystore is unavailable.' }
foreach ($drive in @('X:', 'Y:', 'Z:')) { if (Test-Path "$drive\") { throw "Drive $drive is in use; select unused drives before continuing." } }
$secret = Read-Host 'Release signing password (hidden)' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
  $env:EDU_ANDROID_KEYSTORE = $KeystorePath
  $env:EDU_ANDROID_KEY_ALIAS = 'ai-education-manager'
  $env:EDU_ANDROID_KEYSTORE_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  $env:EDU_ANDROID_KEY_PASSWORD = $env:EDU_ANDROID_KEYSTORE_PASSWORD
  & subst X: $repo
  & subst Y: $ToolsRoot
  & subst Z: $GradleRoot
  $env:JAVA_HOME = 'Y:\jdk17\jdk-17.0.19+10'
  $env:ANDROID_HOME = 'Y:\android-sdk'
  $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
  & 'Z:\bin\gradle.bat' -p 'X:\android-standalone-manager' -PeduFaultHarness=true ':app:assembleFaultTest' ':app:assembleFaultTestAndroidTest' --no-daemon
  if ($LASTEXITCODE -ne 0) { throw 'Fault test build failed.' }
  $app = 'X:\android-standalone-manager\app\build\outputs\apk\faultTest\app-faultTest.apk'
  $test = 'X:\android-standalone-manager\app\build\outputs\apk\androidTest\faultTest\app-faultTest-androidTest.apk'
  if (-not (Test-Path -LiteralPath $app) -or -not (Test-Path -LiteralPath $test)) { throw 'Expected signed build outputs not found.' }
  New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
  $signer = 'Y:\android-sdk\build-tools\34.0.0\apksigner.bat'
  foreach ($entry in @(@($app, 'fault-app.apk'), @($test, 'fault-instrumentation.apk'))) {
    $out = Join-Path $OutputDirectory $entry[1]
    $verification = & $signer verify --print-certs $entry[0] 2>$null
    if ($LASTEXITCODE -ne 0 -or (($verification -join "`n") -notmatch '647087c196380bed06ff285a95b29617dc5a31c4977a0c04ddba895adc67164f')) { throw "Signature verification failed: $($entry[1])" }
    Copy-Item -LiteralPath $entry[0] -Destination $out
    Get-FileHash -Algorithm SHA256 -LiteralPath $out | Format-List Path,Hash
  }
  Write-Host "Signed isolated test APKs are ready in $OutputDirectory"
} finally {
  & subst X: /D
  & subst Y: /D
  & subst Z: /D
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  $secret.Dispose()
  Remove-Item Env:EDU_ANDROID_KEYSTORE, Env:EDU_ANDROID_KEY_ALIAS, Env:EDU_ANDROID_KEYSTORE_PASSWORD, Env:EDU_ANDROID_KEY_PASSWORD -ErrorAction SilentlyContinue
}
