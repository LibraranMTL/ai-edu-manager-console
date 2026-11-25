$ErrorActionPreference = 'Stop'
$repoPath = Split-Path -Parent $PSScriptRoot
$promotionPath = Join-Path $repoPath 'artifacts/windows-0244-promotion'
$inventory = Get-Content -LiteralPath (Join-Path $promotionPath 'publish/inventory.json') -Raw | ConvertFrom-Json
$verifiedPath = Join-Path $promotionPath 'public'
New-Item -ItemType Directory -Force -Path $verifiedPath | Out-Null
$results = foreach ($entry in $inventory) {
    $url = 'https://www.greatbg.com/' + $entry.target
    if ($entry.bytes -gt 5MB) {
        $response = Invoke-WebRequest -Uri ($url + '?release=20261125-0244') -Method Head -TimeoutSec 60
        $bytes = [long]($response.Headers['Content-Length'] | Select-Object -First 1)
        if ($response.StatusCode -ne 200 -or $bytes -ne $entry.bytes) { throw "Public HEAD mismatch: $url" }
        [pscustomobject]@{url=$url;status=200;bytes=$bytes;expectedSha256=$entry.sha256;method='HEAD; remote full SHA256 verified'}
    } else {
        $fileName = $entry.target.Replace('/','-')
        $filePath = Join-Path $verifiedPath $fileName
        Invoke-WebRequest -Uri ($url + '?release=20261125-0244') -OutFile $filePath -TimeoutSec 60
        $digest = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash
        if ($digest -ne $entry.sha256) { throw "Public body hash mismatch: $url" }
        [pscustomobject]@{url=$url;status=200;bytes=(Get-Item -LiteralPath $filePath).Length;sha256=$digest;method='GET full body hash'}
    }
}
$rollback = foreach ($ext in @('-Setup.exe','.exe','.zip')) {
    $url='https://www.greatbg.com/download/AI-edu-manager-console-Windows-0.24.3'+$ext
    $response=Invoke-WebRequest -Uri $url -Method Head -TimeoutSec 60
    if ($response.StatusCode -ne 200) {throw "Rollback URL unavailable: $url"}
    [pscustomobject]@{url=$url;status=200;bytes=[long]($response.Headers['Content-Length'] | Select-Object -First 1)}
}
$result=@{passed=$true;checkedAt=(Get-Date).ToUniversalTime().ToString('o');files=@($results);rollback=@($rollback)}
[IO.File]::WriteAllText((Join-Path $promotionPath 'public-verification.json'),($result | ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
$result | ConvertTo-Json -Depth 6
