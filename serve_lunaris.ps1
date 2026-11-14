# LUNARIS local server - uses only Windows PowerShell, no install needed.
# Serves web\dist on http://localhost:5173/ (local machine only).
$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot 'web\dist'
$port = 5173
$types = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript'; '.css'='text/css'; '.json'='application/json';
  '.svg'='image/svg+xml'; '.png'='image/png'; '.jpg'='image/jpeg'; '.bin'='application/octet-stream'; '.txt'='text/plain' }
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:$port/")
$l.Start()
Write-Host "LUNARIS is running at http://localhost:$port/  (close this window to stop)"
Start-Process "http://localhost:$port/"
while ($l.IsListening) {
  $c = $l.GetContext()
  try {
    $p = [Uri]::UnescapeDataString($c.Request.Url.AbsolutePath).TrimStart('/')
    if ($p -eq '') { $p = 'index.html' }
    $f = [IO.Path]::GetFullPath((Join-Path $root $p))
    if (-not $f.StartsWith([IO.Path]::GetFullPath($root)) -or -not (Test-Path $f -PathType Leaf)) { $f = Join-Path $root 'index.html' }
    $b = [IO.File]::ReadAllBytes($f)
    $ext = [IO.Path]::GetExtension($f).ToLower()
    $c.Response.ContentType = $(if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' })
    $c.Response.ContentLength64 = $b.Length
    $c.Response.OutputStream.Write($b, 0, $b.Length)
  } catch { $c.Response.StatusCode = 500 }
  finally { $c.Response.OutputStream.Close() }
}
