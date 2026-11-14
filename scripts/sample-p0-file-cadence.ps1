param(
  [Parameter(Mandatory = $true)][string]$Root,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [int]$DurationSeconds = 600,
  [int]$IntervalSeconds = 5
)

$ErrorActionPreference = 'Stop'

function Get-FileSnapshot([string]$Path) {
  $snapshot = @{}
  Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $snapshot[$_.FullName] = "{0}|{1}" -f $_.Length,$_.LastWriteTimeUtc.Ticks
    } catch {}
  }
  return $snapshot
}

$rootPath = [IO.Path]::GetFullPath($Root)
$outputFile = [IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $outputFile
if ($outputDirectory) { New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null }

$previous = Get-FileSnapshot $rootPath
$changeCounts = @{}
$consecutiveChanges = @{}
$maxConsecutiveChanges = @{}
$intervals = [Collections.Generic.List[object]]::new()
$deadline = [DateTimeOffset]::Now.AddSeconds($DurationSeconds)

while ([DateTimeOffset]::Now -lt $deadline) {
  Start-Sleep -Seconds $IntervalSeconds
  $current = Get-FileSnapshot $rootPath
  $paths = @($previous.Keys + $current.Keys | Sort-Object -Unique)
  $changed = [Collections.Generic.List[string]]::new()
  foreach ($path in $paths) {
    $before = if ($previous.ContainsKey($path)) { $previous[$path] } else { $null }
    $after = if ($current.ContainsKey($path)) { $current[$path] } else { $null }
    if ($before -ne $after) { $changed.Add($path) }
  }

  $changedSet = @{}
  foreach ($path in $changed) {
    $changedSet[$path] = $true
    $changeCounts[$path] = 1 + [int]($changeCounts[$path])
    $consecutiveChanges[$path] = 1 + [int]($consecutiveChanges[$path])
    $maxConsecutiveChanges[$path] = [Math]::Max([int]($maxConsecutiveChanges[$path]), [int]($consecutiveChanges[$path]))
  }
  foreach ($path in @($consecutiveChanges.Keys)) {
    if (-not $changedSet.ContainsKey($path)) { $consecutiveChanges[$path] = 0 }
  }

  $intervals.Add([ordered]@{
    at = [DateTimeOffset]::Now.ToString('o')
    changedCount = $changed.Count
    changedFiles = @($changed | Select-Object -First 100)
  })
  $previous = $current
}

$files = foreach ($path in @($changeCounts.Keys | Sort-Object)) {
  [ordered]@{
    path = $path
    changeCount = [int]$changeCounts[$path]
    maxConsecutiveChanges = [int]$maxConsecutiveChanges[$path]
  }
}
$continuous = @($files | Where-Object { $_.maxConsecutiveChanges -ge 3 })
$report = [ordered]@{
  schema = 'edu.p0.file-cadence.v1'
  generatedAt = [DateTimeOffset]::Now.ToString('o')
  root = $rootPath
  durationSeconds = $DurationSeconds
  intervalSeconds = $IntervalSeconds
  intervalCount = $intervals.Count
  intervalsWithChanges = @($intervals | Where-Object { $_.changedCount -gt 0 }).Count
  continuousWriteDetected = ($continuous.Count -gt 0)
  continuousFiles = $continuous
  changedFiles = @($files)
  intervals = $intervals
}
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $outputFile -Encoding utf8
Write-Output ("OUTPUT={0}" -f $outputFile)
