$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'docs\desenhos\arquitetura-tecnica.svg'
$outputDirectory = Join-Path $root 'docs\desenhos'
$edge = (Get-Command msedge.exe -ErrorAction SilentlyContinue).Source
if (-not $edge) {
  $candidates = @(
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
  )
  $edge = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $edge) {
  throw 'Microsoft Edge não encontrado; instale-o para exportar o diagrama.'
}

$tempDirectory = Join-Path $env:TEMP ("ia-governanca-diagram-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempDirectory | Out-Null
$tempPng = Join-Path $tempDirectory 'arquitetura-tecnica.png'
$tempJpg = Join-Path $tempDirectory 'arquitetura-tecnica.jpg'
$profile = Join-Path $tempDirectory 'edge-profile'
$sourceUri = ([Uri]$source).AbsoluteUri

try {
  & $edge --headless=new --disable-gpu --hide-scrollbars --window-size=1600,1080 `
    "--user-data-dir=$profile" "--screenshot=$tempPng" $sourceUri
  $renderDeadline = (Get-Date).AddSeconds(30)
  while (-not (Test-Path -LiteralPath $tempPng) -and (Get-Date) -lt $renderDeadline) {
    Start-Sleep -Milliseconds 250
  }
  if (-not (Test-Path -LiteralPath $tempPng) -or (Get-Item -LiteralPath $tempPng).Length -eq 0) {
    throw 'Falha ao exportar o diagrama SVG para PNG.'
  }

  Add-Type -AssemblyName System.Drawing
  $image = [System.Drawing.Image]::FromFile($tempPng)
  try {
    $image.Save($tempJpg, [System.Drawing.Imaging.ImageFormat]::Jpeg)
  }
  finally {
    $image.Dispose()
  }
  if (-not (Test-Path -LiteralPath $tempJpg)) {
    throw 'Falha ao exportar o diagrama PNG para JPG.'
  }

  Copy-Item -LiteralPath $tempPng -Destination (Join-Path $outputDirectory 'arquitetura-tecnica.png') -Force
  Copy-Item -LiteralPath $tempJpg -Destination (Join-Path $outputDirectory 'arquitetura-tecnica.jpg') -Force
}
finally {
  $profileDeadline = (Get-Date).AddSeconds(30)
  do {
    $rendererProcesses = Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" |
      Where-Object { $_.CommandLine -like "*$profile*" }
    if (-not $rendererProcesses) { break }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $profileDeadline)
  if ($rendererProcesses) {
    throw 'Edge ainda está usando o perfil temporário; feche o processo e limpe a pasta temporária indicada.'
  }
  Remove-Item -LiteralPath $tempDirectory -Recurse -Force
}
