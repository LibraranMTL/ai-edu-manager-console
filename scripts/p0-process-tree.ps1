function Get-P0DescendantProcessIds {
  param(
    [Parameter(Mandatory = $true)][object[]]$Processes,
    [Parameter(Mandatory = $true)][int]$RootProcessId
  )

  $selected = [System.Collections.Generic.HashSet[int]]::new()
  [void]$selected.Add($RootProcessId)
  do {
    $changed = $false
    foreach ($process in $Processes) {
      $processId = [int]$process.ProcessId
      $parentProcessId = [int]$process.ParentProcessId
      if ($selected.Contains($parentProcessId) -and $selected.Add($processId)) { $changed = $true }
    }
  } while ($changed)
  @($selected | Sort-Object)
}
