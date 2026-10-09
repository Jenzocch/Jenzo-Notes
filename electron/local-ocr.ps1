param([string]$ImagePath, [string]$Language)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$ocr = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$languages = @($ocr::AvailableRecognizerLanguages | ForEach-Object { $_.LanguageTag })
if (!$ImagePath) { @{ languages = $languages; engine = 'windows-local-ocr' } | ConvertTo-Json -Compress; exit }
if ($languages -notcontains $Language) { throw 'ocr-language-unavailable' }
function Await($operation, $type) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
  $task = $method.MakeGenericMethod($type).Invoke($null, @($operation))
  $task.GetAwaiter().GetResult()
}
$file = Await ([Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime])
$stream = Await ($file.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType=WindowsRuntime])
try {
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime])
  if ($decoder.PixelWidth -gt $ocr::MaxImageDimension -or $decoder.PixelHeight -gt $ocr::MaxImageDimension) { throw 'ocr-image-too-large' }
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType=WindowsRuntime])
  try {
    $engine = $ocr::TryCreateFromLanguage((New-Object Windows.Globalization.Language($Language)))
    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType=WindowsRuntime])
    @{ text = ($result.Lines.Text -join "`n"); language = $Language; engine = 'windows-local-ocr' } | ConvertTo-Json -Compress
  } finally { $bitmap.Dispose() }
} finally { $stream.Dispose() }
