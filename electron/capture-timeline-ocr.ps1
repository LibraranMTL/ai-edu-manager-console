param(
  [Parameter(Mandatory = $true)][string]$ImagePath,
  [Parameter(Mandatory = $false)][string]$ThumbnailPath = '',
  [Parameter(Mandatory = $false)][string]$LanguageTag = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

function ConvertTo-JsonResult {
  param([hashtable]$Value)
  $Value | ConvertTo-Json -Depth 6 -Compress
}

function Await-WinRt {
  param(
    [Parameter(Mandatory = $true)]$Operation,
    [Parameter(Mandatory = $true)][Type]$ResultType
  )
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } |
    Select-Object -First 1
  if (-not $method) { throw 'Windows Runtime async bridge is unavailable.' }
  $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  $task.Wait()
  return $task.Result
}

try {
  $resolvedImage = [System.IO.Path]::GetFullPath($ImagePath)
  if (-not [System.IO.File]::Exists($resolvedImage)) { throw 'Image file does not exist.' }

  if ($ThumbnailPath) {
    try {
      Add-Type -AssemblyName System.Drawing
      $resolvedThumbnail = [System.IO.Path]::GetFullPath($ThumbnailPath)
      $thumbnailDirectory = [System.IO.Path]::GetDirectoryName($resolvedThumbnail)
      [System.IO.Directory]::CreateDirectory($thumbnailDirectory) | Out-Null
      $source = [System.Drawing.Image]::FromFile($resolvedImage)
      try {
        $width = 360
        $height = [Math]::Max(1, [int][Math]::Round($source.Height * ($width / [double]$source.Width)))
        $bitmap = New-Object System.Drawing.Bitmap($width, $height)
        try {
          $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
          try {
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.DrawImage($source, 0, 0, $width, $height)
          } finally {
            $graphics.Dispose()
          }
          $bitmap.Save($resolvedThumbnail, [System.Drawing.Imaging.ImageFormat]::Jpeg)
        } finally {
          $bitmap.Dispose()
        }
      } finally {
        $source.Dispose()
      }
    } catch {
      # Thumbnail failure does not prevent OCR or semantic processing.
    }
  }

  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  [void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  [void][Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime]
  [void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
  [void][Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
  [void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  [void][Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]

  $file = Await-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($resolvedImage)) ([Windows.Storage.StorageFile])
  $stream = Await-WinRt ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  try {
    $decoder = Await-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    if ([long]$decoder.PixelWidth * [long]$decoder.PixelHeight -gt 25000000 -or
        $decoder.PixelWidth -gt [Windows.Media.Ocr.OcrEngine]::MaxImageDimension -or
        $decoder.PixelHeight -gt [Windows.Media.Ocr.OcrEngine]::MaxImageDimension) {
      throw 'Image dimensions exceed the safe OCR limit.'
    }
    $bitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    try {
      $languageFallback = $false
      $availableLanguages = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages)
      if ($LanguageTag) {
        [void][Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
        $language = New-Object Windows.Globalization.Language($LanguageTag)
        $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
        if (-not $engine) {
          $primaryLanguage = $LanguageTag.Split('-')[0]
          $compatibleLanguage = $availableLanguages | Where-Object { $_.LanguageTag.Split('-')[0] -eq $primaryLanguage } | Select-Object -First 1
          if ($compatibleLanguage) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($compatibleLanguage) }
        }
      } else {
        $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
      }
      if (-not $engine -and $availableLanguages.Count -gt 0) {
        $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($availableLanguages[0])
        $languageFallback = $true
      }
      if (-not $engine) { throw 'No Windows OCR language is installed.' }
      $result = Await-WinRt ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
      ConvertTo-JsonResult @{
        ok = $true
        text = [string]$result.Text
        language = [string]$engine.RecognizerLanguage.LanguageTag
        requestedLanguage = $LanguageTag
        languageFallback = $languageFallback
        thumbnailAvailable = [bool]($ThumbnailPath -and [System.IO.File]::Exists([System.IO.Path]::GetFullPath($ThumbnailPath)))
      }
    } finally {
      if ($bitmap -is [System.IDisposable]) { $bitmap.Dispose() }
    }
  } finally {
    if ($stream -is [System.IDisposable]) { $stream.Dispose() }
  }
} catch {
  ConvertTo-JsonResult @{
    ok = $false
    text = ''
    error = [string]$_.Exception.Message
    thumbnailAvailable = [bool]($ThumbnailPath -and [System.IO.File]::Exists([System.IO.Path]::GetFullPath($ThumbnailPath)))
  }
  exit 0
}
