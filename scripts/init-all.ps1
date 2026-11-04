$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $projectRoot

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$Description
  )

  $previousErrorActionPreference = $ErrorActionPreference
  try {
    # Windows PowerShell can turn native stderr (including harmless warnings) into
    # terminating errors when ErrorActionPreference is Stop.
    $ErrorActionPreference = 'Continue'
    & $FilePath @Arguments
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if ($exitCode -ne 0) {
    throw "$Description falhou (código $exitCode)."
  }
}

function Test-DockerReady {
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & docker info *> $null
    return $LASTEXITCODE -eq 0
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
}

function Get-EnvValue {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$DefaultValue
  )

  $line = Get-Content -LiteralPath (Join-Path $projectRoot '.env') |
    Where-Object { $_ -match "^\s*$Name\s*=" } |
    Select-Object -Last 1
  if (-not $line) {
    return $DefaultValue
  }

  $value = ($line -split '=', 2)[1].Trim()
  return $value.Trim('"').Trim("'")
}

function Wait-ForHttp {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$Description,
    [int]$TimeoutSeconds = 120
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
        Write-Host "$Description pronto: $Url"
        return
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  } while ((Get-Date) -lt $deadline)

  throw "Tempo esgotado aguardando $Description em $Url."
}

function Test-LocalPortInUse {
  param([Parameter(Mandatory = $true)][int]$Port)

  return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

foreach ($requiredCommand in @('docker', 'node', 'npm')) {
  if (-not (Get-Command $requiredCommand -ErrorAction SilentlyContinue)) {
    throw "Comando '$requiredCommand' não encontrado. Instale-o e tente novamente."
  }
}

if (-not (Test-Path -LiteralPath '.env')) {
  Copy-Item -LiteralPath '.env.example' -Destination '.env'
  Write-Host 'Arquivo .env criado a partir de .env.example.'
}

$appPorts = @(3000, 3001, 3002, 3003)
$busyPorts = @($appPorts | Where-Object { Test-LocalPortInUse -Port $_ })
if ($busyPorts.Count -gt 0) {
  throw "Porta(s) da aplicação já em uso: $($busyPorts -join ', '). Feche os serviços existentes antes de executar o init-all."
}

$ollamaCommand = Get-Command 'ollama' -ErrorAction SilentlyContinue
if (-not $ollamaCommand) {
  throw 'Ollama não encontrado no PATH. Instale-o em https://ollama.com/download e execute novamente.'
}

Write-Host 'Verificando o Docker...'
if (-not (Test-DockerReady)) {
  $dockerDesktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (-not (Test-Path -LiteralPath $dockerDesktop)) {
    throw 'Docker Desktop não está em execução e não foi encontrado no caminho padrão. Inicie Docker Desktop e execute novamente.'
  }

  Write-Host 'Iniciando Docker Desktop...'
  Start-Process -FilePath $dockerDesktop | Out-Null
  $dockerReady = $false
  $deadline = (Get-Date).AddSeconds(180)
  do {
    Start-Sleep -Seconds 3
    if (Test-DockerReady) {
      $dockerReady = $true
      break
    }
  } while ((Get-Date) -lt $deadline)
  if (-not $dockerReady) {
    throw 'Tempo esgotado aguardando o Docker Desktop iniciar.'
  }
}

if (-not (Test-Path -LiteralPath 'node_modules')) {
  Write-Host 'Instalando dependências do projeto...'
  Invoke-CheckedCommand -FilePath 'npm' -Arguments @('ci') -Description 'Instalação de dependências'
}

$authMode = Get-EnvValue -Name 'AUTH_MODE' -DefaultValue ''
$useSso = ($authMode -in @('oidc', 'both')) -or (-not $authMode -and (Get-EnvValue -Name 'KEYCLOAK_BASE_URL' -DefaultValue ''))
if ($useSso) {
  Write-Host 'Iniciando PostgreSQL e Keycloak (SSO)...'
  Invoke-CheckedCommand -FilePath 'docker' -Arguments @('compose', '--profile', 'sso', 'up', '-d', 'postgres', 'keycloak') -Description 'Inicialização dos containers'
} else {
  Write-Host 'Iniciando PostgreSQL (login local, sem Keycloak)...'
  Invoke-CheckedCommand -FilePath 'docker' -Arguments @('compose', 'up', '-d', 'postgres') -Description 'Inicialização dos containers'
}

$databaseReady = $false
$deadline = (Get-Date).AddSeconds(120)
do {
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & docker compose exec -T postgres pg_isready -U app -d ai_spend *> $null
    $postgresReady = $LASTEXITCODE -eq 0
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($postgresReady) {
    $databaseReady = $true
    break
  }
  Start-Sleep -Seconds 2
} while ((Get-Date) -lt $deadline)
if (-not $databaseReady) {
  throw 'Tempo esgotado aguardando PostgreSQL.'
}
Write-Host 'PostgreSQL pronto.'

$ollamaBaseUrl = (Get-EnvValue -Name 'OLLAMA_BASE_URL' -DefaultValue 'http://localhost:11434').TrimEnd('/')
$ollamaTagsUrl = "$ollamaBaseUrl/api/tags"
try {
  Invoke-RestMethod -Uri $ollamaTagsUrl -TimeoutSec 3 | Out-Null
} catch {
  Write-Host 'Iniciando Ollama...'
  Start-Process -FilePath $ollamaCommand.Source -ArgumentList 'serve' -WindowStyle Hidden | Out-Null
  Wait-ForHttp -Url $ollamaTagsUrl -Description 'Ollama'
}

$model = Get-EnvValue -Name 'OLLAMA_MODEL' -DefaultValue 'llama3.2'
$modelsResponse = Invoke-RestMethod -Uri $ollamaTagsUrl -TimeoutSec 10
$modelIsInstalled = @($modelsResponse.models | Where-Object {
  $_.name -eq $model -or $_.name -eq "${model}:latest"
}).Count -gt 0
if (-not $modelIsInstalled) {
  Write-Host "Baixando o modelo Ollama '$model' (o download pode levar alguns minutos)..."
  Invoke-CheckedCommand -FilePath $ollamaCommand.Source -Arguments @('pull', $model) -Description "Download do modelo $model"
}

if ($useSso) {
  $keycloakRealm = Get-EnvValue -Name 'KEYCLOAK_REALM' -DefaultValue 'ai-spend'
  Wait-ForHttp -Url "http://localhost:8080/realms/$keycloakRealm/.well-known/openid-configuration" -Description 'Keycloak' -TimeoutSeconds 180
}

Write-Host 'Aplicando migrações do banco...'
Invoke-CheckedCommand -FilePath 'npm' -Arguments @('run', 'migrate:up') -Description 'Migrações do banco'

$shell = (Get-Command 'powershell.exe' -ErrorAction Stop).Source
$escapedRoot = $projectRoot.Replace("'", "''")
$services = @(
  @{ Name = 'API'; Script = 'dev:api'; Url = 'http://localhost:3001/health' },
  @{ Name = 'Gateway'; Script = 'dev:gateway'; Url = 'http://localhost:3002/health' },
  @{ Name = 'Worker'; Script = 'dev:worker'; Url = 'http://localhost:3003/health' },
  @{ Name = 'Web'; Script = 'dev:web'; Url = 'http://localhost:3000/' }
)

foreach ($service in $services) {
  $command = "Set-Location -LiteralPath '$escapedRoot'; npm run $($service.Script)"
  Start-Process -FilePath $shell -ArgumentList @('-NoExit', '-NoProfile', '-Command', $command) | Out-Null
  Write-Host "$($service.Name) iniciado em $($service.Url)."
}

foreach ($service in $services) {
  Wait-ForHttp -Url $service.Url -Description $service.Name -TimeoutSeconds 90
}

Write-Host ''
Write-Host 'Ambiente pronto para testes:'
Write-Host '  Web:     http://localhost:3000'
Write-Host '  API:     http://localhost:3001'
Write-Host '  Gateway: http://localhost:3002'
Write-Host '  Worker:  http://localhost:3003'
Write-Host '  Ollama:  ' $ollamaBaseUrl
if ($useSso) { Write-Host '  Keycloak: http://localhost:8080' }
Write-Host ''
Write-Host 'Login local: crie o primeiro usuário com'
Write-Host '  npx tsx scripts/create-user.ts --email voce@empresa.com --name "Seu Nome" --role owner'
Write-Host '  (ou defina BOOTSTRAP_ADMIN_EMAIL/BOOTSTRAP_ADMIN_PASSWORD no .env; ou use npx tsx scripts/reset-db.ts --yes para o seed de dev)'
