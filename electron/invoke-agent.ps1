param(
  [Parameter(Mandatory = $true)][string]$Executable,
  [Parameter(Mandatory = $true)][string]$ArgsBase64
)

$ErrorActionPreference = 'Stop'
$json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ArgsBase64))
$invokeArgs = @(ConvertFrom-Json $json)
& $Executable @invokeArgs
if ($null -ne $LASTEXITCODE) {
  exit $LASTEXITCODE
}
