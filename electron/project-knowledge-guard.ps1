param()
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$heldSources = New-Object System.Collections.ArrayList
$heldTargets = New-Object System.Collections.ArrayList
$wasWritten = $false
$wasFinalized = $false
$readySent = $false

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class EduKnowledgeDisposition {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern SafeFileHandle CreateFile(string file, uint access, uint share, IntPtr security, uint creation, uint attributes, IntPtr template);
  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool SetFileInformationByHandle(SafeFileHandle handle, int infoClass, ref byte info, uint size);
  public static void SetDelete(SafeFileHandle handle, bool delete) {
    byte flag = delete ? (byte)1 : (byte)0;
    if (!SetFileInformationByHandle(handle, 4, ref flag, 1)) throw new Win32Exception(Marshal.GetLastWin32Error());
  }
  public static FileStream OpenNew(string file) {
    // GENERIC_READ | GENERIC_WRITE | DELETE, no sharing, CREATE_NEW. DELETE
    // access allows aborting the exact open object without a path-based race.
    SafeFileHandle handle = CreateFile(file, 0xC0010000u, 0, IntPtr.Zero, 1, 0x80, IntPtr.Zero);
    if (handle.IsInvalid) { int error = Marshal.GetLastWin32Error(); handle.Dispose(); throw new Win32Exception(error); }
    return new FileStream(handle, FileAccess.ReadWrite);
  }
}
'@

function Send-Message($message) {
  [Console]::Out.WriteLine(($message | ConvertTo-Json -Depth 16 -Compress))
  [Console]::Out.Flush()
}

function Get-StreamHash([System.IO.Stream]$stream) {
  $stream.Position = 0
  $hash = [System.Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($hash.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
  finally { $hash.Dispose(); $stream.Position = 0 }
}

function Get-BytesHash([byte[]]$bytes) {
  $hash = [System.Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
  finally { $hash.Dispose() }
}

function Write-BytesDurable([string]$file, [byte[]]$bytes) {
  $stream = [System.IO.File]::Open($file, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) }
  finally { $stream.Dispose() }
}

function Assert-SafeFile([string]$root, [string]$file) {
  $base = [System.IO.Path]::GetFullPath($root).TrimEnd('\')
  $target = [System.IO.Path]::GetFullPath($file)
  if (-not $target.StartsWith($base + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'PATH_OUTSIDE_ROOT' }
  $current = $target
  while ($current.Length -ge $base.Length) {
    if ([System.IO.File]::Exists($current) -or [System.IO.Directory]::Exists($current)) {
      if (([System.IO.File]::GetAttributes($current) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'LINKED_PATH' }
    }
    if ($current -eq $base) { break }
    $current = [System.IO.Path]::GetDirectoryName($current)
  }
}

try {
  $request = [Console]::In.ReadLine() | ConvertFrom-Json
  $archiveMode = $request.profile -eq 'project-archive-v1'
  $maxTargets = if ($archiveMode) { 2000 } else { 200 }
  $maxFileBytes = if ($archiveMode) { 67108864 } else { 2097152 }
  $maxTotalBytes = if ($archiveMode) { 268435456 } else { 16777216 }
  if ($request.schema -ne 'edu-manager.knowledge-guard.v1' -or $request.targets.Count -lt 1 -or $request.targets.Count -gt $maxTargets) { throw 'INVALID_REQUEST' }
  if ($archiveMode -and @($request.allowedTargetRoots).Count -eq 0) { throw 'INVALID_TARGET_ROOTS' }
  $uniqueTargets = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  $totalBytes = 0
  $totalBaselineBytes = 0
  foreach ($source in $request.sources) {
    Assert-SafeFile $source.root $source.path
    $stream = [System.IO.File]::Open($source.path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
    [void]$heldSources.Add($stream)
    if ((Get-StreamHash $stream) -ne $source.sha256) { throw 'SOURCE_CHANGED' }
  }
  foreach ($target in $request.targets) {
    if ($archiveMode) {
      if ($request.allowedTargetRoots -notcontains $target.root) { throw 'PATH_OUTSIDE_ROOT' }
      Assert-SafeFile $target.root $target.path
    } else { Assert-SafeFile $request.knowledgeRoot $target.path }
    Assert-SafeFile $request.backupRoot $target.backupPath
    if (-not $uniqueTargets.Add($target.path)) { throw 'DUPLICATE_TARGET' }
    $bytes = [Convert]::FromBase64String($target.contentBase64)
    $totalBytes += $bytes.Length
    if ((-not $archiveMode -and $bytes.Length -eq 0) -or $bytes.Length -gt $maxFileBytes -or $totalBytes -gt $maxTotalBytes) { throw 'OUTPUT_LIMIT' }
    if ((Get-BytesHash $bytes) -ne $target.sha256) { throw 'OUTPUT_CHANGED' }
    $isNew = $null -eq $target.baselineHash
    $mode = if ($isNew) { [System.IO.FileMode]::CreateNew } else { [System.IO.FileMode]::Open }
    if ($isNew) {
      $stream = [EduKnowledgeDisposition]::OpenNew($target.path)
    } else {
      $stream = [System.IO.File]::Open($target.path, $mode, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    }
    $entry = [pscustomobject]@{ stream = $stream; path = $target.path; isNew = $isNew; before = $null; after = $bytes; changed = $false }
    [void]$heldTargets.Add($entry)
    if (-not $isNew) {
      if ($stream.Length -gt $maxFileBytes) { throw 'BASELINE_LIMIT' }
      $totalBaselineBytes += $stream.Length
      if ($totalBaselineBytes -gt $maxTotalBytes) { throw 'BASELINE_LIMIT' }
      if ((Get-StreamHash $stream) -ne $target.baselineHash) { throw 'KNOWLEDGE_CONFLICT' }
      $memory = New-Object System.IO.MemoryStream
      try { $stream.CopyTo($memory); $entry.before = $memory.ToArray(); $stream.Position = 0 }
      finally { $memory.Dispose() }
      # Each attempt has its own backup names. Never overwrite a prior backup.
      Write-BytesDurable $target.backupPath $entry.before
    }
  }
  Send-Message @{ state = 'ready'; count = $heldTargets.Count }
  $readySent = $true
  $command = [Console]::In.ReadLine()
  if ($command -ne 'commit') { throw 'ABORTED' }
  foreach ($entry in $heldTargets) {
    $entry.changed = $true
    $entry.stream.Position = 0
    $entry.stream.SetLength(0)
    $entry.stream.Write($entry.after, 0, $entry.after.Length)
    $entry.stream.Flush($true)
  }
  $wasWritten = $true
  Send-Message @{ state = 'written'; count = $heldTargets.Count }
  $command = [Console]::In.ReadLine()
  if ($command -ne 'finalize') { throw 'ABORTED' }
  $wasFinalized = $true
  Send-Message @{ state = 'finalized' }
} catch {
  $message = $_.Exception.Message
  Send-Message @{ state = 'error'; message = $message; phase = $(if ($wasWritten) { 'written' } elseif ($readySent) { 'ready' } else { 'opening' }) }
} finally {
  $rollbackFailures = New-Object System.Collections.ArrayList
  foreach ($entry in $heldTargets) {
    try {
      if (-not $wasFinalized -and $entry.isNew) {
        # Delete the still-open file object, not a path that another editor
        # could replace between closing our handle and a later File.Delete.
        [EduKnowledgeDisposition]::SetDelete($entry.stream.SafeFileHandle, $true)
      }
      if (-not $wasFinalized -and -not $entry.isNew -and $entry.changed) {
        $entry.stream.Position = 0
        $entry.stream.SetLength(0)
        $entry.stream.Write($entry.before, 0, $entry.before.Length)
        $entry.stream.Flush($true)
      }
    } catch { [void]$rollbackFailures.Add($entry.path) }
    finally { $entry.stream.Dispose() }
  }
  foreach ($stream in $heldSources) { $stream.Dispose() }
  if (-not $wasFinalized) {
    Send-Message @{ state = 'aborted'; rollbackFailures = @($rollbackFailures) }
    exit 1
  }
}
