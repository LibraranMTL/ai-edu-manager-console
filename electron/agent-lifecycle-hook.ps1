param(
  [Parameter(Mandatory = $true)][string]$Descriptor,
  [Parameter(Mandatory = $true)][ValidateSet('codex', 'qclaw', 'workbuddy', 'openclaw', 'claude-code', 'hermes')][string]$SourceAgent,
  [Parameter(Mandatory = $false)][string]$ManagedMarker = ''
)

$ErrorActionPreference = 'Stop'

try {
  if (-not (Test-Path -LiteralPath $Descriptor)) { exit 0 }
  $descriptorValue = Get-Content -LiteralPath $Descriptor -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($descriptorValue.lifecycleCapture.enabled -ne $true) { exit 0 }
  if ([string]::IsNullOrWhiteSpace([string]$descriptorValue.lifecycleCapture.captureEpoch)) { exit 0 }
  if (@($descriptorValue.lifecycleCapture.allowedAgents) -notcontains $SourceAgent) { exit 0 }

  [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
  $raw = [Console]::In.ReadToEnd()
  if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }
  $payload = $raw | ConvertFrom-Json
  $queueDir = [string]$descriptorValue.lifecycleCapture.queueDir
  if ([string]::IsNullOrWhiteSpace($queueDir)) { exit 0 }
  [System.IO.Directory]::CreateDirectory($queueDir) | Out-Null

  $capturedAt = [DateTime]::UtcNow.ToString('o')
  $envelope = [ordered]@{
    schema = 'edu-manager.agent-lifecycle-event.v1'
    sourceAgent = $SourceAgent
    scopeId = [string]$descriptorValue.defaults.scopeId
    grantId = [string]$descriptorValue.authentication.grantId
    captureEpoch = [string]$descriptorValue.lifecycleCapture.captureEpoch
    capturedAt = $capturedAt
    payload = $payload
  }
  $stamp = [DateTime]::UtcNow.ToString('yyyyMMddHHmmssfffffff')
  $id = [Guid]::NewGuid().ToString('N')
  $target = Join-Path $queueDir "$stamp-$id.json"
  $temp = "$target.tmp"
  [System.IO.File]::WriteAllText($temp, ($envelope | ConvertTo-Json -Depth 30 -Compress), [System.Text.UTF8Encoding]::new($false))
  [System.IO.File]::Move($temp, $target)
} catch {
  # Lifecycle collection must never block or alter the Agent conversation.
} finally {
  # Codex Stop requires JSON stdout, including when a path with spaces uses this fallback.
  if ($SourceAgent -eq 'codex') { [Console]::Out.WriteLine('{}') }
}

exit 0
