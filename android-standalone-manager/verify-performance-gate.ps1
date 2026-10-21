param(
  [Parameter(Mandatory = $true)]
  [string]$BaselinePath,
  [Parameter(Mandatory = $true)]
  [string]$ResultPath
)

$ErrorActionPreference = 'Stop'
$baselineFile = [IO.Path]::GetFullPath($BaselinePath)
$resultFile = [IO.Path]::GetFullPath($ResultPath)
foreach ($path in @($baselineFile, $resultFile)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Performance gate evidence is missing: $path"
  }
}

$baseline = Get-Content -LiteralPath $baselineFile -Raw -Encoding UTF8 | ConvertFrom-Json
$result = Get-Content -LiteralPath $resultFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ($baseline.schema -ne 'edu-manager.android-performance.v1' -or $result.schema -ne $baseline.schema) {
  throw 'Performance evidence schema must be edu-manager.android-performance.v1.'
}
if ($baseline.status -ne 'measured' -or $result.status -ne 'measured') {
  throw 'Template or pending performance evidence cannot release a candidate.'
}
if ([string]$baseline.deviceProfile -ne [string]$result.deviceProfile) {
  throw 'Baseline and current performance results must use the same device profile.'
}

$requiredMetrics = @(
  'cold_startup_ms',
  'warm_startup_ms',
  'switch_student_ms',
  'thousand_materials_ms',
  'thousand_reports_ms',
  'growth_snapshot_rebuild_ms',
  'pdf_ocr_import_ms',
  'background_sync_frame_ms',
  'low_memory_restore_ms'
)
$allowedRegressionPercent = if ($null -eq $baseline.allowedRegressionPercent) { 10.0 } else { [double]$baseline.allowedRegressionPercent }
$baselineMap = @{}
$resultMap = @{}
foreach ($metric in @($baseline.metrics)) { $baselineMap[[string]$metric.id] = [double]$metric.medianMs }
foreach ($metric in @($result.metrics)) { $resultMap[[string]$metric.id] = [double]$metric.medianMs }

$failures = @()
foreach ($id in $requiredMetrics) {
  if (-not $baselineMap.ContainsKey($id) -or -not $resultMap.ContainsKey($id)) {
    $failures += "$id is missing"
    continue
  }
  if ($baselineMap[$id] -le 0 -or $resultMap[$id] -le 0) {
    $failures += "$id must be a positive measured value"
    continue
  }
  $regression = (($resultMap[$id] - $baselineMap[$id]) / $baselineMap[$id]) * 100.0
  if ($regression -gt $allowedRegressionPercent) {
    $failures += ('{0} regressed by {1:N2}% (allowed {2:N2}%)' -f $id, $regression, $allowedRegressionPercent)
  }
}
if ($failures.Count -gt 0) {
  throw "Android performance gate failed:`n - $($failures -join "`n - ")"
}

[pscustomobject]@{
  Status = 'PASSED'
  DeviceProfile = [string]$result.deviceProfile
  AllowedRegressionPercent = $allowedRegressionPercent
  Metrics = $requiredMetrics.Count
} | Format-List
