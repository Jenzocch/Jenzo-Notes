Add-Type -AssemblyName System.Drawing
$directory = Join-Path (Get-Location) 'qa-artifacts/image-ideas'
$font = New-Object System.Drawing.Font('Microsoft JhengHei',32)
foreach ($sample in @(@('zh','會議紀錄 ZT-82 週五下午三點'), @('id','Jadwal rapat ZT-82 hari Jumat pukul tiga'), @('blank',''))) {
  $bitmap = New-Object System.Drawing.Bitmap(1400,180)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.Clear([System.Drawing.Color]::White)
  $graphics.DrawString($sample[1], $font, [System.Drawing.Brushes]::Black, 30,50)
  $bitmap.Save((Join-Path $directory ($sample[0]+'.png')), [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose(); $bitmap.Dispose()
}
$font.Dispose()
