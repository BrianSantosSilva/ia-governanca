param(
  [Parameter(Mandatory = $true)]
  [string]$Path,
  [string]$Database = 'ai_spend'
)

$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))

if ($Database -notmatch '^[A-Za-z0-9_]+$') {
  throw 'Database must contain only ASCII letters, numbers, and underscores.'
}
$dumpPath = (Resolve-Path -LiteralPath $Path).Path
$tables = docker compose exec -T postgres psql -U app -d $Database -tAc "SELECT COUNT(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')"
if ($LASTEXITCODE -ne 0) {
  throw "Could not inspect target database '$Database'. Create an empty database first."
}
if ([int]($tables.Trim()) -ne 0) {
  throw "Target database '$Database' is not empty. Restore only into an empty database; this script never drops existing objects."
}

$containerPath = "/tmp/ai-spend-restore-$([guid]::NewGuid().ToString('N')).dump"
docker compose cp $dumpPath "postgres:$containerPath"
if ($LASTEXITCODE -ne 0) {
  throw 'Copying the backup into the PostgreSQL container failed.'
}

try {
  docker compose exec -T postgres pg_restore -U app -d $Database --exit-on-error --no-owner --role=app $containerPath
  if ($LASTEXITCODE -ne 0) {
    throw 'pg_restore failed. The target database may be partially restored; inspect it before retrying.'
  }
} finally {
  docker compose exec -T postgres rm -f -- $containerPath | Out-Null
}

Write-Output "Restore completed into empty database '$Database'."
