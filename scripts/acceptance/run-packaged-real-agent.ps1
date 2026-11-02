param(
  [Parameter(Mandatory = $true)][ValidateSet('workbuddy', 'codex')][string]$Provider,
  [Parameter(Mandatory = $true)][string]$RunName,
  [Parameter(Mandatory = $true)][string]$Resources,
  [Parameter(Mandatory = $true)][string]$OutputRoot,
  [Parameter(Mandatory = $true)][string]$CodexExecutable,
  [string]$WorkBuddyExecutable = 'D:\Program Files\WorkBuddy\WorkBuddy.exe',
  [switch]$SkipSampler,
  [ValidateRange(500, 10000)][int]$SamplerIntervalMilliseconds = 2000
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$resources = [IO.Path]::GetFullPath($Resources)
$acceptance = Join-Path $PSScriptRoot 'verify-packaged-agent-success.cjs'
$sampler = Join-Path $PSScriptRoot 'sample-process-tree.ps1'
$output = Join-Path ([IO.Path]::GetFullPath($OutputRoot)) $RunName
$electron = Join-Path $repo 'node_modules\electron\dist\electron.exe'
$codex = [IO.Path]::GetFullPath($CodexExecutable)
$workBuddy = [IO.Path]::GetFullPath($WorkBuddyExecutable)
$report = Join-Path $output 'result.json'
$tree = Join-Path $output 'process-tree.json'
$stdout = Join-Path $output "$RunName.stdout.log"
$stderr = Join-Path $output "$RunName.stderr.log"

New-Item -ItemType Directory -Path $output -Force | Out-Null
foreach ($required in @($resources, $acceptance, $sampler, $electron, $codex, $workBuddy)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Required path missing: $required" }
}

$info = [Diagnostics.ProcessStartInfo]::new()
$info.FileName = $electron
$info.UseShellExecute = $false
$info.CreateNoWindow = $true
$info.RedirectStandardOutput = $true
$info.RedirectStandardError = $true
foreach ($argument in @($acceptance, $resources, $report, $codex, $workBuddy, $Provider)) {
  [void]$info.ArgumentList.Add($argument)
}
$process = [Diagnostics.Process]::new()
$process.StartInfo = $info
if (-not $process.Start()) { throw 'Failed to start packaged real-Agent acceptance.' }
$stdoutRead = $process.StandardOutput.ReadToEndAsync()
$stderrRead = $process.StandardError.ReadToEndAsync()

$samplerProcess = $null
if (-not $SkipSampler) {
  $samplerProcess = Start-Process -FilePath 'pwsh.exe' -ArgumentList @(
    '-NoProfile', '-NonInteractive', '-File', "`"$sampler`"",
    '-RootProcessIds', $process.Id,
    '-DurationSeconds', 210,
    '-IntervalMilliseconds', $SamplerIntervalMilliseconds,
    '-StopWhenProcessIdExits', $process.Id,
    '-TailSeconds', 3,
    '-OutputPath', "`"$tree`""
  ) -PassThru -WindowStyle Hidden
}

$process.WaitForExit()
$stdoutRead.GetAwaiter().GetResult() | Set-Content -LiteralPath $stdout -Encoding utf8
$stderrRead.GetAwaiter().GetResult() | Set-Content -LiteralPath $stderr -Encoding utf8
if ($samplerProcess) {
  $samplerProcess.WaitForExit()
  if ($samplerProcess.ExitCode -ne 0) { throw "Process tree sampler failed: $($samplerProcess.ExitCode)" }
}
if ($process.ExitCode -ne 0) {
  Get-Content -LiteralPath $report -ErrorAction SilentlyContinue
  exit $process.ExitCode
}
Get-Content -LiteralPath $report
