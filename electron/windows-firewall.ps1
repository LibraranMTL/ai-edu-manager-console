param(
  [ValidateSet('Inspect','Repair','Apply')][string]$Action = 'Inspect',
  [ValidateRange(1,65535)][int]$TcpPort = 18777,
  [ValidateRange(1,65535)][int]$DiscoveryPort = 18778,
  [string]$ResultPath = ''
)

$ErrorActionPreference = 'Stop'
$ruleGroup = 'AI Education Manager Host'
$specs = @(
  @{ Name='AI-Education-Manager-Host-TCP-Private'; DisplayName='AI教育管家 主机服务（专用网络）'; Protocol='TCP'; LocalPort=$TcpPort },
  @{ Name='AI-Education-Manager-Discovery-UDP-Private'; DisplayName='AI教育管家 局域网发现（专用网络）'; Protocol='UDP'; LocalPort=$DiscoveryPort }
)

function Write-Result([object]$Value) {
  $json = $Value | ConvertTo-Json -Depth 8 -Compress
  if ($ResultPath) { [IO.File]::WriteAllText($ResultPath, $json, [Text.UTF8Encoding]::new($false)) }
  Write-Output $json
}

function Read-Rule([hashtable]$Spec) {
  $items = @(Get-NetFirewallRule -Name $Spec.Name -ErrorAction SilentlyContinue)
  foreach ($item in $items) {
    $port = $item | Get-NetFirewallPortFilter
    $address = $item | Get-NetFirewallAddressFilter
    $protocol = if ([string]$port.Protocol -eq '6') { 'TCP' } elseif ([string]$port.Protocol -eq '17') { 'UDP' } else { [string]$port.Protocol }
    [pscustomobject]@{
      name=$item.Name; displayName=$item.DisplayName; group=$item.Group; direction=[string]$item.Direction
      action=[string]$item.Action; enabled=([string]$item.Enabled -eq 'True'); profile=[string]$item.Profile
      remoteAddress=(@($address.RemoteAddress) -join ','); protocol=$protocol; localPort=[int]$port.LocalPort
      instanceId=[string]$item.InstanceID
    }
  }
}

function Inspect-Rules {
  $rules = @($specs | ForEach-Object { Read-Rule $_ })
  $stableNames = @($specs | ForEach-Object { $_.Name })
  $legacy = @(Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object {
    ($_.DisplayName -like '*AI*教育*管家*' -or $_.DisplayName -like '*AI Education Manager*') -and $_.Name -notin $stableNames
  } | Select-Object Name,DisplayName,Enabled,Profile,Direction,Action)
  $profiles = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object IPv4Connectivity -ne 'Disconnected' | ForEach-Object { [string]$_.NetworkCategory } | Sort-Object -Unique)
  [pscustomobject]@{ ok=$true; networkProfiles=$profiles; rules=$rules; legacyRules=$legacy; deletedRuleCount=0 }
}

if ($Action -eq 'Inspect') { Write-Result (Inspect-Rules); exit 0 }

if ($Action -eq 'Repair') {
  if (-not $ResultPath) { throw 'ResultPath is required for repair.' }
  $argumentList = @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"' + $PSCommandPath + '"'),'-Action','Apply','-TcpPort',[string]$TcpPort,'-DiscoveryPort',[string]$DiscoveryPort,'-ResultPath',('"' + $ResultPath + '"'))
  try {
    $process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList $argumentList
    if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $ResultPath)) { Write-Result ([pscustomobject]@{ ok=$false; changed=$false; requiresElevation=$true; code='repair_not_completed' }); exit 1 }
    Get-Content -LiteralPath $ResultPath -Raw
    exit 0
  } catch {
    Write-Result ([pscustomobject]@{ ok=$false; changed=$false; requiresElevation=$true; code='uac_cancelled'; message=$_.Exception.Message })
    exit 0
  }
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Administrator privileges are required.' }
foreach ($spec in $specs) {
  Get-NetFirewallRule -Name $spec.Name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -Name $spec.Name -DisplayName $spec.DisplayName -Group $ruleGroup -Direction Inbound -Action Allow -Enabled True -Profile Private -RemoteAddress LocalSubnet -Protocol $spec.Protocol -LocalPort $spec.LocalPort | Out-Null
}
Write-Result ([pscustomobject]@{ ok=$true; changed=$true; requiresElevation=$false; code='repaired'; inspection=(Inspect-Rules) })
