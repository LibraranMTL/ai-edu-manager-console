param([ValidateSet('scan','close')][string]$Action)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$session = (Get-Process -Id $PID).SessionId
$protectedRoots = @($env:SystemRoot, (Join-Path $env:ProgramFiles 'QXMatrix')) | Where-Object { $_ }
function Eligible($p) {
  if (!$p -or $p.SessionId -ne $session -or !$p.Path) { return $false }
  foreach ($root in $protectedRoots) {
    if ($p.Path.StartsWith($root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { return $false }
  }
  $name = [IO.Path]::GetFileName($p.Path)
  return $name -notmatch '^(explorer|msedge|chrome|firefox|electron|powershell|pwsh|cmd|taskmgr|regedit|code|winword|excel|powerpnt|onenote|acad|teams|zoom|dingtalk|wechat|wxwork)\.exe$' -and $name -notmatch 'edu-manager|edumanager|eduterminal'
}
if ($Action -eq 'close') {
  $target = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $p = Get-Process -Id ([int]$target.id) -ErrorAction SilentlyContinue
  if (!$p -or $p.HasExited) { exit 0 }
  if (!(Eligible $p) -or $p.Path -cne $target.path -or $p.StartTime.ToUniversalTime().Ticks.ToString() -ne $target.start) { exit 2 }
  if ($p.CloseMainWindow() -and $p.WaitForExit(1500)) { exit 0 }
  if (!$p.HasExited) { $p.Kill() }
  if (!$p.WaitForExit(1500)) { exit 3 }
  exit 0
}
$details = @{}
while ($true) {
  $items = @(Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
    $p = $_
    try {
      if (!(Eligible $p)) { return }
      $file = Get-Item -LiteralPath $p.Path
      $stamp = $file.LastWriteTimeUtc.Ticks
      $meta = $details[$file.FullName]
      if ($null -eq $meta -or $meta.stamp -ne $stamp) {
        $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
        $meta = @{
          stamp = $stamp
          file = $file.Name.ToLowerInvariant()
          product = $file.VersionInfo.ProductName
          hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
          signatureValid = $signature.Status -eq 'Valid'
          signer = if ($signature.SignerCertificate) { $signature.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) } else { '' }
        }
        $details[$file.FullName] = $meta
      }
      $row = $meta.Clone()
      $row.id = $p.Id
      $row.path = $p.Path
      $row.start = $p.StartTime.ToUniversalTime().Ticks.ToString()
      $row
    } catch {}
  })
  [Console]::WriteLine((ConvertTo-Json -InputObject $items -Depth 4 -Compress))
  Start-Sleep -Seconds 2
}
