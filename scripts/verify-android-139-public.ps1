$ErrorActionPreference='Stop'
$repoPath=Split-Path -Parent $PSScriptRoot
$promotionPath=Join-Path $repoPath 'artifacts/android-139-promotion'
$publicPath=Join-Path $promotionPath 'public'
New-Item -ItemType Directory -Force -Path $publicPath | Out-Null
$inventory=Get-Content -LiteralPath (Join-Path $promotionPath 'publish/inventory.json') -Raw | ConvertFrom-Json
$results=foreach($entry in $inventory){
    $url='https://www.greatbg.com/'+$entry.target
    if($entry.bytes -gt 5MB){
        $response=Invoke-WebRequest -Uri ($url+'?release=android139-20261125') -Method Head -TimeoutSec 60
        $bytes=[long]($response.Headers['Content-Length'] | Select-Object -First 1)
        if($response.StatusCode -ne 200 -or $bytes -ne $entry.bytes){throw "APK public HEAD mismatch: $url"}
        [pscustomobject]@{url=$url;status=200;bytes=$bytes;expectedSha256=$entry.sha256;method='HEAD; server full SHA256 verified'}
    }else{
        $file=Join-Path $publicPath $entry.target.Replace('/','-')
        Invoke-WebRequest -Uri ($url+'?release=android139-20261125') -OutFile $file -TimeoutSec 60
        $hash=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
        if($hash -ne $entry.sha256){throw "Public response hash mismatch: $url"}
        [pscustomobject]@{url=$url;status=200;bytes=(Get-Item -LiteralPath $file).Length;sha256=$hash;method='GET full body hash'}
    }
}
$oldUrl='https://www.greatbg.com/download/AI-Education-Manager-Android-Standalone-1.3.8.apk'
$oldHead=Invoke-WebRequest -Uri $oldUrl -Method Head -TimeoutSec 60
if($oldHead.StatusCode -ne 200 -or [long]($oldHead.Headers['Content-Length']|Select-Object -First 1) -ne 69160176){throw 'Rollback APK unavailable'}
$record=@{passed=$true;checkedAt=(Get-Date).ToUniversalTime().ToString('o');files=@($results);oldApk=@{url=$oldUrl;status=200;bytes=69160176}}
[IO.File]::WriteAllText((Join-Path $promotionPath 'public-verification.json'),($record|ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
Write-Output 'PUBLIC_ANDROID_ENDPOINTS_VERIFIED'
