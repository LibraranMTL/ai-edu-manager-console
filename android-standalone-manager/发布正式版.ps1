$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'publish-release.ps1') @args
