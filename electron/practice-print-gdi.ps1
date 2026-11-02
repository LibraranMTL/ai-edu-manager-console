param(
  [Parameter(Mandatory=$true)][string]$ImagePath,
  [Parameter(Mandatory=$true)][string]$PrinterName,
  [Parameter(Mandatory=$true)][int]$Copies,
  [Parameter(Mandatory=$true)][ValidateSet('portrait','landscape')][string]$Orientation
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$resolvedImage = (Resolve-Path -LiteralPath $ImagePath).Path
$image = [System.Drawing.Image]::FromFile($resolvedImage)
$document = New-Object System.Drawing.Printing.PrintDocument
$document.DocumentName = 'AI Education Manager Learning Card'
$document.PrinterSettings.PrinterName = $PrinterName
if (-not $document.PrinterSettings.IsValid) { throw 'printer_not_available' }
if ($Copies -lt 1 -or $Copies -gt 99) { throw 'invalid_print_copies' }
$document.PrinterSettings.Copies = [int16]$Copies
$document.DefaultPageSettings.Landscape = $Orientation -eq 'landscape'
$document.PrintController = New-Object System.Drawing.Printing.StandardPrintController
$state = @{ Offset = 0 }
$handler = [System.Drawing.Printing.PrintPageEventHandler]{
  param($sender, $eventArgs)
  $bounds = $eventArgs.MarginBounds
  if ($bounds.Width -le 0 -or $bounds.Height -le 0) { throw 'invalid_printer_page_bounds' }
  $scale = [double]$bounds.Width / [double]$image.Width
  $sourceHeight = [Math]::Max(1, [Math]::Floor([double]$bounds.Height / $scale))
  $remaining = $image.Height - [int]$state.Offset
  $sliceHeight = [Math]::Min($sourceHeight, $remaining)
  $drawHeight = [Math]::Max(1, [Math]::Round($sliceHeight * $scale))
  $destination = New-Object System.Drawing.Rectangle($bounds.X, $bounds.Y, $bounds.Width, $drawHeight)
  $source = New-Object System.Drawing.Rectangle(0, [int]$state.Offset, $image.Width, $sliceHeight)
  $eventArgs.Graphics.DrawImage($image, $destination, $source, [System.Drawing.GraphicsUnit]::Pixel)
  $state.Offset = [int]$state.Offset + $sliceHeight
  $eventArgs.HasMorePages = [int]$state.Offset -lt $image.Height
}
$document.add_PrintPage($handler)
try {
  $document.Print()
  Write-Output '{"ok":true}'
} finally {
  $document.remove_PrintPage($handler)
  $document.Dispose()
  $image.Dispose()
}
