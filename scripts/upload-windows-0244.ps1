[CmdletBinding(SupportsShouldProcess = $true)]
param()
$ErrorActionPreference = 'Stop'
$repoPath = Split-Path -Parent $PSScriptRoot
$promotionPath = Join-Path $repoPath 'artifacts/windows-0244-promotion'
$publishPath = Join-Path $promotionPath 'publish'
$baselineMap = @{
    'download/edu-manager-version.json' = 'download-manifest.json'
    'education/edu-manager-version.json' = 'education-manifest.json'
    'education/download.html' = 'download.html'
    'education/windows-host-manual.html' = 'windows-host-manual.html'
}
$expectedBefore = @{}
foreach ($key in $baselineMap.Keys) {
    $expectedBefore[$key] = (Get-FileHash -LiteralPath (Join-Path $promotionPath ('before/' + $baselineMap[$key])) -Algorithm SHA256).Hash
}
[IO.File]::WriteAllText((Join-Path $publishPath 'expected-before.json'), ($expectedBefore | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'deploy-windows-0244.py') -Destination (Join-Path $publishPath 'deploy-windows-0244.py') -WhatIf:$false
$filesToUpload = Get-ChildItem -LiteralPath $publishPath -File | Select-Object -ExpandProperty FullName
$uploadParameters = @{
    InstanceId = 'i-m5e6r68cl11nbh2y0o6z'
    Region = 'cn-qingdao'
    RemoteDirectory = '/tmp/edu-windows-0244-20261125-r2'
    LocalPath = $filesToUpload
    RetryCount = 2
}
$uploadScript = 'C:/Users/bxw00/.codex/skills/aliyun-ecs-file-update/scripts/Invoke-WorkbenchUploadBatch.ps1'
if ($WhatIfPreference) { & $uploadScript @uploadParameters -WhatIf -SkipConnectionCheck }
else { & $uploadScript @uploadParameters }
