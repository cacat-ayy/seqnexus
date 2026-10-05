# Serve SeqNexus from this folder at http://localhost:8080/app.html
#
# Opened straight from disk (file://), Chrome runs no module workers and lets
# the page load nothing from wasm/, so fastp, minimap2 and the MAFFT, MUSCLE
# and Kalign aligners cannot run. Served from here, everything works.
# Uses PowerShell's built-in web server: nothing to install. Ctrl+C stops it.

param([int]$Port = 8080, [switch]$NoBrowser)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript'; '.mjs' = 'text/javascript'
  '.css' = 'text/css'; '.json' = 'application/json'; '.wasm' = 'application/wasm'
  '.data' = 'application/octet-stream'; '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.ico' = 'image/x-icon'
}
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "SeqNexus: http://localhost:$Port/app.html  (Ctrl+C to stop)"
if (-not $NoBrowser) { Start-Process "http://localhost:$Port/app.html" }
try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if ($path -eq '') { $path = 'app.html' }
    $file = [System.IO.Path]::GetFullPath((Join-Path $root $path))
    $res = $ctx.Response
    if ($file.StartsWith($root) -and (Test-Path $file -PathType Leaf)) {
      $ext = [System.IO.Path]::GetExtension($file).ToLower()
      $res.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
      $bytes = [System.IO.File]::ReadAllBytes($file)
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $res.StatusCode = 404
    }
    $res.Close()
  }
} finally {
  $listener.Stop()
}
