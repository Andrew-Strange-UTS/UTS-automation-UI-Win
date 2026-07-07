# Standalone test for the built-in Windows OCR engine (Windows.Media.Ocr).
# Run it against an existing screenshot to see whether Windows OCR works on this
# machine and how good the result is, independent of Marvin.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-winocr.ps1 -Path .\02probe-calc.png
#
# It prints the available OCR languages, the full recognised text, and every word
# with its bounding box. If it errors, the error tells us exactly what to fix.

param([Parameter(Mandatory = $true)][string]$Path)

$ErrorActionPreference = 'Stop'
$Path = (Resolve-Path $Path).Path
Write-Host "Image: $Path"
Write-Host "PowerShell: $($PSVersionTable.PSVersion) ($($PSVersionTable.PSEdition))"

Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($op, $type) {
    $t = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
    $t.Wait(-1) | Out-Null
    $t.Result
}

[void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
[void][Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
[void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
[void][Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
[void][Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime]

Write-Host "`nAvailable OCR languages:"
foreach ($l in [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages) {
    Write-Host "  $($l.DisplayName) [$($l.LanguageTag)]"
}

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$bitmap = [Windows.Graphics.Imaging.SoftwareBitmap]::Convert($bitmap, [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied)

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { throw "TryCreateFromUserProfileLanguages returned null (no OCR language pack installed)" }

$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

Write-Host "`n--- FULL TEXT ---"
Write-Host $result.Text
Write-Host "`n--- WORDS (text @ x,y wxh) ---"
foreach ($line in $result.Lines) {
    foreach ($w in $line.Words) {
        $r = $w.BoundingRect
        Write-Host ("  '{0}' @ {1},{2} {3}x{4}" -f $w.Text, [int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height)
    }
}
