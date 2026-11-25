[CmdletBinding(SupportsShouldProcess = $true)]
param()
$ErrorActionPreference='Stop'
$repoPath=Split-Path -Parent $PSScriptRoot
$publishPath=Join-Path $repoPath 'artifacts/android-139-promotion/publish'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'deploy-android-139.py') -Destination (Join-Path $publishPath 'deploy-android-139.py') -WhatIf:$false
$parameters=@{InstanceId='i-m5e6r68cl11nbh2y0o6z';Region='cn-qingdao';RemoteDirectory='/tmp/edu-android-139-20261125-r1';LocalPath=@(Get-ChildItem -LiteralPath $publishPath -File | Select-Object -ExpandProperty FullName);RetryCount=2}
$uploadScript='C:/Users/bxw00/.codex/skills/aliyun-ecs-file-update/scripts/Invoke-WorkbenchUploadBatch.ps1'
if($WhatIfPreference){& $uploadScript @parameters -WhatIf -SkipConnectionCheck}else{& $uploadScript @parameters}
