param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\backups')
)

$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

$dumpName = "ai-spend-$((Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ'))-$([guid]::NewGuid().ToString('N').Substring(0, 8)).dump"
$containerPath = "/tmp/$dumpName"
$outputPath = Join-Path (Resolve-Path $OutputDirectory) $dumpName

docker compose exec -T postgres pg_dump -U app -d ai_spend --format=custom --file=$containerPath
if ($LASTEXITCODE -ne 0) {
  throw 'pg_dump failed; no backup was copied to the host.'
}

try {
  docker compose cp "postgres:$containerPath" $outputPath
  if ($LASTEXITCODE -ne 0) {
    throw 'Copying the PostgreSQL dump from the container failed.'
  }
} finally {
  docker compose exec -T postgres rm -f -- $containerPath | Out-Null
}

Write-Output "Backup created: $outputPath"
