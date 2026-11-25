[CmdletBinding()]
param([string]$BackupDirectory = 'D:\AI-Education-Manager\activation-backups')
$ErrorActionPreference='Stop'
$instance='i-m5e6r68cl11nbh2y0o6z'
$region='cn-qingdao'
$workbench=(Get-Command workbench.exe -ErrorAction Stop).Source
$metadataText=& $workbench exec -i $instance -r $region -c 'cat /var/lib/edu-activation/backup-status.json'
if($LASTEXITCODE -ne 0){throw 'Unable to read activation backup status'}
$metadata=($metadataText -join "`n") | ConvertFrom-Json
if($metadata.file -notmatch '^activation-[0-9]+-[a-f0-9]{6}\.enc$' -or $metadata.sha256 -notmatch '^[a-f0-9]{64}$'){throw 'Invalid backup metadata'}
New-Item -ItemType Directory -Force -Path $BackupDirectory | Out-Null
$target=Join-Path $BackupDirectory $metadata.file
if(!(Test-Path -LiteralPath $target)){
  & $workbench download "/var/backups/edu-activation/$($metadata.file)" "$target.part" -i $instance -r $region -f
  if($LASTEXITCODE -ne 0){throw 'Encrypted backup transfer failed'}
  if((Get-FileHash -LiteralPath "$target.part" -Algorithm SHA256).Hash.ToLowerInvariant() -ne $metadata.sha256){throw 'Encrypted backup hash mismatch'}
  Move-Item -LiteralPath "$target.part" -Destination $target
}
if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $metadata.sha256){throw 'Existing encrypted backup hash mismatch'}
$metadata | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath "$target.json" -Encoding utf8
$hash=$metadata.sha256
# This fixed command carries only a validated hash; no credentials or private keys.
$ack="python3 -c 'import json,datetime; p=""/var/lib/edu-activation/offsite-status.json""; json.dump(dict(sha256=""$hash"",receivedAt=datetime.datetime.now(datetime.timezone.utc).isoformat()),open(p,""w""))'"
& $workbench exec -i $instance -r $region -c $ack
if($LASTEXITCODE -ne 0){throw 'Backup received locally but server acknowledgement failed'}
[pscustomobject]@{File=$target;SHA256=$hash;Bytes=(Get-Item -LiteralPath $target).Length;Verified=$true} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $BackupDirectory 'latest-verified.json') -Encoding utf8
Write-Output 'Encrypted offsite activation backup verified'
