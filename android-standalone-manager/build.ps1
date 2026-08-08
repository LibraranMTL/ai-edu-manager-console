param(
  [ValidateSet('test', 'check', 'lintDebug', 'assembleDebug', 'assembleRelease')]
  [string]$Task = 'check'
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$repositoryRoot = Split-Path -Parent $projectRoot
$gradleVersion = '8.7'
$gradleCache = Join-Path $projectRoot '.gradle-dist'
$gradleRoot = Join-Path $gradleCache "gradle-$gradleVersion"
$gradleBat = Join-Path $gradleRoot 'bin\gradle.bat'
$gradleZip = Join-Path $gradleCache "gradle-$gradleVersion-bin.zip"
$gradlePart = "$gradleZip.part"
$jdkHome = Join-Path $repositoryRoot '.android-tools\jdk\jdk-21.0.11+10'
$androidSdk = Join-Path $repositoryRoot '.android-tools\sdk'

function Test-GradleArchive {
  param([string]$ArchivePath)
  if (-not (Test-Path -LiteralPath $ArchivePath)) { return $false }
  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
      return $null -ne ($archive.Entries | Where-Object { $_.FullName -eq "gradle-$gradleVersion/bin/gradle.bat" } | Select-Object -First 1)
    } finally {
      $archive.Dispose()
    }
  } catch {
    return $false
  }
}

function Receive-GradleArchive {
  param([string]$Uri, [string]$TargetPath)
  Add-Type -AssemblyName System.Net.Http
  $handler = [System.Net.Http.HttpClientHandler]::new()
  $handler.AllowAutoRedirect = $true
  $client = [System.Net.Http.HttpClient]::new($handler)
  $client.Timeout = [TimeSpan]::FromMinutes(15)
  try {
    for ($attempt = 1; $attempt -le 5; $attempt += 1) {
      $existingLength = if (Test-Path -LiteralPath $TargetPath) { (Get-Item -LiteralPath $TargetPath).Length } else { 0L }
      $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, $Uri)
      if ($existingLength -gt 0) {
        $request.Headers.Range = [System.Net.Http.Headers.RangeHeaderValue]::new($existingLength, $null)
      }
      try {
        $response = $client.SendAsync($request, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        $response.EnsureSuccessStatusCode() | Out-Null
        $append = $existingLength -gt 0 -and $response.StatusCode -eq [System.Net.HttpStatusCode]::PartialContent
        $mode = if ($append) { [System.IO.FileMode]::Append } else { [System.IO.FileMode]::Create }
        $source = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $target = [System.IO.FileStream]::new($TargetPath, $mode, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        try {
          $source.CopyTo($target)
        } finally {
          $target.Dispose()
          $source.Dispose()
          $response.Dispose()
          $request.Dispose()
        }
        if (Test-GradleArchive -ArchivePath $TargetPath) { return }
      } catch {
        $request.Dispose()
        if ($attempt -eq 5) { throw }
      }
      Start-Sleep -Seconds ([Math]::Min(10, $attempt * 2))
    }
    throw 'Gradle archive remained incomplete after five attempts.'
  } finally {
    $client.Dispose()
    $handler.Dispose()
  }
}

if (-not (Test-Path -LiteralPath $jdkHome)) {
  throw "Bundled JDK not found: $jdkHome"
}
if (-not (Test-Path -LiteralPath (Join-Path $androidSdk 'platforms\android-34\android.jar'))) {
  throw "Bundled Android 34 SDK not found: $androidSdk"
}

New-Item -ItemType Directory -Force -Path $gradleCache | Out-Null
if (-not (Test-Path -LiteralPath $gradleBat)) {
  if (-not (Test-GradleArchive -ArchivePath $gradleZip)) {
    if ((Test-Path -LiteralPath $gradleZip) -and -not (Test-Path -LiteralPath $gradlePart)) {
      Move-Item -LiteralPath $gradleZip -Destination $gradlePart
    }
    Receive-GradleArchive -Uri "https://services.gradle.org/distributions/gradle-$gradleVersion-bin.zip" -TargetPath $gradlePart
    Move-Item -LiteralPath $gradlePart -Destination $gradleZip -Force
  }
  Expand-Archive -LiteralPath $gradleZip -DestinationPath $gradleCache -Force
}

$mappedDrive = @('T:', 'U:', 'V:', 'W:', 'X:') |
  Where-Object { -not (Test-Path -LiteralPath "$_\") } |
  Select-Object -First 1
if (-not $mappedDrive) {
  throw 'No free drive letter is available for the ASCII-only Android build path.'
}

$previousJavaHome = $env:JAVA_HOME
$previousAndroidHome = $env:ANDROID_HOME
$previousAndroidSdkRoot = $env:ANDROID_SDK_ROOT
$previousPath = $env:PATH

& subst $mappedDrive $repositoryRoot
if ($LASTEXITCODE -ne 0) {
  throw "Unable to map repository root to $mappedDrive"
}

try {
  $mappedRepositoryRoot = "$mappedDrive\"
  $mappedProjectRoot = Join-Path $mappedRepositoryRoot 'android-standalone-manager'
  $mappedJdkHome = Join-Path $mappedRepositoryRoot '.android-tools\jdk\jdk-21.0.11+10'
  $mappedAndroidSdk = Join-Path $mappedRepositoryRoot '.android-tools\sdk'
  $mappedGradleBat = Join-Path $mappedProjectRoot ".gradle-dist\gradle-$gradleVersion\bin\gradle.bat"

  $env:JAVA_HOME = $mappedJdkHome
  $env:ANDROID_HOME = $mappedAndroidSdk
  $env:ANDROID_SDK_ROOT = $mappedAndroidSdk
  $env:PATH = "$(Join-Path $mappedJdkHome 'bin');$env:PATH"

  & $mappedGradleBat --no-daemon --stacktrace --project-dir $mappedProjectRoot clean $Task
  if ($LASTEXITCODE -ne 0) {
    throw "Gradle task '$Task' failed with exit code $LASTEXITCODE"
  }
} finally {
  & subst $mappedDrive /D | Out-Null
  $env:JAVA_HOME = $previousJavaHome
  $env:ANDROID_HOME = $previousAndroidHome
  $env:ANDROID_SDK_ROOT = $previousAndroidSdkRoot
  $env:PATH = $previousPath
}
