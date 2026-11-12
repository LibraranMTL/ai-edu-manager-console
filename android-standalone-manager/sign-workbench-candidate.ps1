param(
  [string]$ToolsRoot = 'C:\Users\bxw00\android-build-deps',
  [string]$GradleRoot = 'C:\Users\bxw00\android-build-deps\gradle\gradle-8.10.2',
  [string]$KeystorePath = 'D:\AndroidSigning\AI-Education-Manager\ai-education-manager-release.jks',
  [string]$OutputDirectory = 'D:\AndroidCandidates\standalone-workbench-1.3.7-20261112-r11'
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
if (Test-Path -LiteralPath $OutputDirectory) { throw "Output directory already exists: $OutputDirectory" }
if (-not (Test-Path -LiteralPath $KeystorePath -PathType Leaf)) { throw 'Release keystore is unavailable.' }
foreach ($drive in @('X:', 'Y:', 'Z:')) { if (Test-Path "$drive\") { throw "Drive $drive is in use." } }
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
  & 'Z:\bin\gradle.bat' -p 'X:\android-standalone-manager' ':app:assembleRelease' '--no-daemon' '-PeduPublicContentBaseUrl=https://www.greatbg.com/edu-cloud-candidate'
  if ($LASTEXITCODE -ne 0) { throw 'Release candidate build failed.' }
  $app = 'X:\android-standalone-manager\app\build\outputs\apk\release\app-release.apk'
  if (-not (Test-Path -LiteralPath $app)) { throw 'Expected signed APK not found.' }
  $oldPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $verification = & 'Y:\android-sdk\build-tools\34.0.0\apksigner.bat' verify --print-certs $app 2>&1
  $verifyExit = $LASTEXITCODE
  $ErrorActionPreference = $oldPreference
  if ($verifyExit -ne 0 -or (($verification -join "`n") -notmatch '647087c196380bed06ff285a95b29617dc5a31c4977a0c04ddba895adc67164f')) { throw 'Release signature verification failed.' }
  $badging = & 'Y:\android-sdk\build-tools\34.0.0\aapt.exe' dump badging $app
  if ($LASTEXITCODE -ne 0 -or (($badging -join "`n") -notmatch "package: name='com\.qxmatrix\.edumanager\.standalone' versionCode='41' versionName='1\.3\.7'")) { throw 'Package or version verification failed.' }
  $buildConfig = Get-Content -Raw -LiteralPath 'X:\android-standalone-manager\app\build\generated\source\buildConfig\release\com\qxmatrix\edumanager\standalone\BuildConfig.java'
  if ($buildConfig -notmatch 'FAULT_HARNESS\s*=\s*false') { throw 'Fault harness is unexpectedly enabled.' }
  if ($buildConfig -notmatch 'PUBLIC_CONTENT_BASE_URL\s*=\s*"https://www\.greatbg\.com/edu-cloud-candidate"') { throw 'Candidate cloud endpoint binding is incorrect.' }
  New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
  $out = Join-Path $OutputDirectory 'AI-Education-Manager-Android-Standalone-1.3.7-workbench-candidate-r11.apk'
  Copy-Item -LiteralPath $app -Destination $out
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash
  $head = (& git -C $repo rev-parse HEAD).Trim()
  $dirty = [bool]((& git -C $repo status --porcelain) -join '')
  $sourceRoot = Join-Path $PSScriptRoot 'app\src'
  $sourceFiles = @(Get-ChildItem -LiteralPath $sourceRoot -File -Recurse | Sort-Object FullName | ForEach-Object {
    [ordered]@{ path=$_.FullName.Substring($repo.Length + 1); sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash }
  })
  $sourceFiles += [ordered]@{ path='android-standalone-manager\app\build.gradle.kts'; sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $PSScriptRoot 'app\build.gradle.kts')).Hash }
  $sourceFiles | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $OutputDirectory 'source-file-hashes.json')
  [ordered]@{ package='com.qxmatrix.edumanager.standalone'; version='1.3.7'; versionCode=41; sha256=$hash; signingCertificateSha256='647087c196380bed06ff285a95b29617dc5a31c4977a0c04ddba895adc67164f'; sourceHead=$head; sourceTreeDirty=$dirty; cloudBaseUrl='https://www.greatbg.com/edu-cloud-candidate'; faultHarness=$false; candidate=$true; deviceVerified=$false; released=$false } | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $OutputDirectory 'candidate-metadata.json')
  Write-Host "Signed candidate APK: $out"
  Write-Host "SHA-256: $hash"
} finally {
  & subst X: /D
  & subst Y: /D
  & subst Z: /D
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  $secret.Dispose()
  Remove-Item Env:EDU_ANDROID_KEYSTORE, Env:EDU_ANDROID_KEY_ALIAS, Env:EDU_ANDROID_KEYSTORE_PASSWORD, Env:EDU_ANDROID_KEY_PASSWORD -ErrorAction SilentlyContinue
}
