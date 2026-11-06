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
$userDataRoot = [System.IO.Path]::GetPathRoot($resolvedUserData)
if ($resolvedUserData -eq $userDataRoot) {
  throw 'UserDataDir must be a non-root isolated candidate directory.'
}

$canonicalCandidateBaseUrl = 'https://www.greatbg.com/edu-cloud-candidate'
switch ([string]$PublicContentBaseUrl) {
  'https://www.greatbg.com/edu-cloud-candidate' { break }
  'https://www.greatbg.com/edu-cloud-candidate/' { break }
  default {
    throw "PublicContentBaseUrl must be $canonicalCandidateBaseUrl."
  }
}
if ([string]::IsNullOrWhiteSpace($PublicContentBaseUrl)) {
  throw 'PublicContentBaseUrl must be the candidate HTTPS base URL.'
}

$arguments = @(
  "--user-data-dir=$resolvedUserData",
  '--qa-isolated',
  "--remote-debugging-port=$RemoteDebuggingPort"
)
$environment = @{
  EDU_PUBLIC_CONTENT_BASE_URL = $canonicalCandidateBaseUrl
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

if ($PSCmdlet.ShouldProcess($resolvedExe, "Start with isolated user data and candidate course base URL (port $RemoteDebuggingPort)")) {
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
