$ErrorActionPreference = 'Stop'

$realScriptRoot = $PSScriptRoot
$realProjectRoot = Split-Path -Parent $realScriptRoot

function Assert-LastExitCode {
  param([string]$Step)
  if ($LASTEXITCODE -ne 0) {
    throw "$Step failed with exit code $LASTEXITCODE"
  }
}

$drive = $null
$letters = @('T:', 'U:', 'V:', 'W:', 'X:')
foreach ($candidate in $letters) {
  if (-not (Test-Path -LiteralPath ($candidate + '\'))) {
    $drive = $candidate
    break
  }
}
if (-not $drive) { throw 'No free subst drive letter found for Android build.' }

cmd /c "subst $drive `"$realProjectRoot`""

try {
  $projectRoot = $drive + '\'
  $scriptRoot = Join-Path $projectRoot 'android-tablet-terminal'
  $toolRoot = Join-Path $projectRoot '.android-tools'
  $androidJar = Join-Path $toolRoot 'sdk\platforms\android-34\android.jar'
  $buildTools = Join-Path $toolRoot 'sdk\build-tools\34.0.0'
  $jdkHome = Join-Path $toolRoot 'jdk\jdk-21.0.11+10'
  $jdkBin = Join-Path $jdkHome 'bin'

  $env:JAVA_HOME = $jdkHome
  $env:PATH = "$jdkBin;$env:PATH"

  $aapt = Join-Path $buildTools 'aapt.exe'
  $d8 = Join-Path $buildTools 'd8.bat'
  $zipalign = Join-Path $buildTools 'zipalign.exe'
  $apksigner = Join-Path $buildTools 'apksigner.bat'
  $javac = Join-Path $jdkBin 'javac.exe'
  $jar = Join-Path $jdkBin 'jar.exe'
  $keytool = Join-Path $jdkBin 'keytool.exe'

  $buildDir = Join-Path $scriptRoot 'build'
  $genDir = Join-Path $buildDir 'gen'
  $classesDir = Join-Path $buildDir 'classes'
  $dexDir = Join-Path $buildDir 'dex'
  $classesJar = Join-Path $buildDir 'classes.jar'
  $zxingJar = Join-Path $scriptRoot 'libs\zxing-core-3.5.3.jar'
  $releaseDir = Join-Path $projectRoot 'release\tablet-terminal'
  $unsignedApk = Join-Path $buildDir 'tablet-terminal-unsigned.apk'
  $alignedApk = Join-Path $buildDir 'tablet-terminal-aligned.apk'
  $finalApk = Join-Path $releaseDir 'AI-edu-manager-tablet-terminal-0.6.12.apk'
  $keystore = Join-Path $scriptRoot 'debug.keystore'

  Remove-Item -LiteralPath $buildDir -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $genDir, $classesDir, $dexDir, $releaseDir | Out-Null

  & $aapt package -f -m `
    -J $genDir `
    -M (Join-Path $scriptRoot 'AndroidManifest.xml') `
    -S (Join-Path $scriptRoot 'res') `
    -I $androidJar
  Assert-LastExitCode 'aapt generate R.java'

  $javaFiles = @(
    (Join-Path $scriptRoot 'src\com\qxmatrix\eduterminal\MainActivity.java'),
    (Join-Path $scriptRoot 'src\com\qxmatrix\eduterminal\ApkFileProvider.java'),
    (Join-Path $scriptRoot 'src\com\qxmatrix\eduterminal\CaptureProjectionService.java'),
    (Join-Path $scriptRoot 'src\com\qxmatrix\eduterminal\CaptureStorage.java'),
    (Join-Path $scriptRoot 'src\com\qxmatrix\eduterminal\AutoDeliveryJobService.java'),
    (Join-Path $scriptRoot 'src\com\qxmatrix\eduterminal\CaptureTileService.java'),
    (Join-Path $genDir 'com\qxmatrix\eduterminal\R.java')
  )

  & $javac -encoding UTF-8 -g:none -parameters -source 8 -target 8 `
    -bootclasspath $androidJar `
    -classpath $zxingJar `
    -d $classesDir `
    $javaFiles
  Assert-LastExitCode 'javac'

  Push-Location $classesDir
  try {
    & $jar cf $classesJar .
    Assert-LastExitCode 'jar classes'
  } finally {
    Pop-Location
  }

  & $d8 --lib $androidJar --min-api 23 --output $dexDir $classesJar $zxingJar
  Assert-LastExitCode 'd8'

  & $aapt package -f `
    -M (Join-Path $scriptRoot 'AndroidManifest.xml') `
    -S (Join-Path $scriptRoot 'res') `
    -I $androidJar `
    -F $unsignedApk
  Assert-LastExitCode 'aapt package APK resources'

  Push-Location $dexDir
  try {
    & $aapt add $unsignedApk 'classes.dex'
    Assert-LastExitCode 'aapt add classes.dex'
  } finally {
    Pop-Location
  }

  & $zipalign -f 4 $unsignedApk $alignedApk
  Assert-LastExitCode 'zipalign'

  if (-not (Test-Path -LiteralPath $keystore)) {
    & $keytool -genkeypair `
      -keystore $keystore `
      -storepass android `
      -keypass android `
      -alias androiddebugkey `
      -keyalg RSA `
      -keysize 2048 `
      -validity 10000 `
      -dname 'CN=AI Education Tablet Terminal,O=QXMatrix,C=CN'
    Assert-LastExitCode 'keytool'
  }

  & $apksigner sign `
    --ks $keystore `
    --ks-pass pass:android `
    --key-pass pass:android `
    --out $finalApk `
    $alignedApk
  Assert-LastExitCode 'apksigner sign'

  & $apksigner verify --verbose $finalApk
  Assert-LastExitCode 'apksigner verify'

  $realReleaseDir = Join-Path $realProjectRoot 'release\tablet-terminal'
  New-Item -ItemType Directory -Force -Path $realReleaseDir | Out-Null
  $realFinalApk = Join-Path $realReleaseDir 'AI-edu-manager-tablet-terminal-0.6.12.apk'
  Get-Item -LiteralPath $realFinalApk | Format-List FullName,Length,LastWriteTime
} finally {
  cmd /c "subst $drive /d" | Out-Null
}

