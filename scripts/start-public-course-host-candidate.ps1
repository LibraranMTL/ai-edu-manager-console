[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory)]
  [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
  [string]$CandidateExe,

  [Parameter(Mandatory)]
  [string]$UserDataDir,

  [ValidateRange(1024, 65535)]
  [int]$RemoteDebuggingPort = 9231,

  [string]$PublicContentBaseUrl = 'https://www.greatbg.com/edu-cloud-candidate'
)

$ErrorActionPreference = 'Stop'

$resolvedExe = (Resolve-Path -LiteralPath $CandidateExe).Path
$resolvedUserData = [System.IO.Path]::GetFullPath($UserDataDir)
if ($resolvedUserData -eq [System.IO.Path]::GetPathRoot($resolvedUserData)) {
  throw 'UserDataDir 必须是非根目录的隔离候选目录。'
}

$uri = [Uri]$PublicContentBaseUrl
if ($uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or $uri.Host -ne 'www.greatbg.com' -or $uri.AbsolutePath.TrimEnd('/') -ne '/edu-cloud-candidate') {
  throw 'PublicContentBaseUrl 仅允许候选 HTTPS 基址 https://www.greatbg.com/edu-cloud-candidate。'
}

$arguments = @(
  "--user-data-dir=$resolvedUserData",
  '--qa-isolated',
  "--remote-debugging-port=$RemoteDebuggingPort"
)
$environment = @{
  EDU_PUBLIC_CONTENT_BASE_URL = $uri.AbsoluteUri.TrimEnd('/')
  EDU_DISABLE_TASK_SCHEDULER = '1'
}

$plan = [pscustomobject]@{
  candidateExe = $resolvedExe
  userDataDir = $resolvedUserData
  publicContentBaseUrl = $environment.EDU_PUBLIC_CONTENT_BASE_URL
  remoteDebuggingPort = $RemoteDebuggingPort
  arguments = $arguments
  isolated = $true
}

if ($WhatIfPreference) {
  $plan
  return
}

if ($PSCmdlet.ShouldProcess($resolvedExe, "以隔离目录和候选课程基址启动 (port $RemoteDebuggingPort)")) {
  # Windows PowerShell 5.1 has no Start-Process -Environment parameter. Set
  # only this launcher process's environment long enough for the child to
  # inherit it, then restore it even if the process fails to start.
  $previousEnvironment = @{}
  try {
    foreach ($entry in $environment.GetEnumerator()) {
      $previousEnvironment[$entry.Key] = [Environment]::GetEnvironmentVariable($entry.Key, 'Process')
      [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
    }
    Start-Process -FilePath $resolvedExe -ArgumentList $arguments -PassThru -WindowStyle Normal
  }
  finally {
    foreach ($entry in $previousEnvironment.GetEnumerator()) {
      [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
    }
  }
}
