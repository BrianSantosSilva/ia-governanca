<#
.SYNOPSIS
  Prepara do zero uma maquina que acabou de clonar o projeto e sobe todo o ambiente.

.DESCRIPTION
  Nao usa winget nem instaladores do sistema. Se o Node.js estiver ausente, baixa o binario portatil
  oficial para .tools\node. Se nao houver Docker, usa um PostgreSQL embarcado (binarios via npm, dados
  em .data\postgres). Docker so e exigido para o Keycloak. Ollama ausente: avisa e segue sem ele.
  Cria o .env com segredos gerados, instala as dependencias (npm ci), aplica as migracoes, compila,
  cria o primeiro usuario local e inicia API, Gateway, worker e dashboard.

.PARAMETER Postgres
  Auto (padrao): usa o Docker se estiver disponivel; caso contrario, o PostgreSQL embarcado.
  Docker: exige Docker. Embedded: sempre usa o PostgreSQL embarcado (o Keycloak, se escolhido, continua em Docker).
  External: usa o PostgreSQL ja existente apontado por DATABASE_URL no .env (local, container ou remoto);
  nao sobe nada, apenas testa a conexao. O banco e o usuario precisam existir.

.PARAMETER Keycloak
  Sim: sobe o Keycloak e habilita SSO junto com login local (AUTH_MODE=both).
  Nao: nao instala nem sobe o Keycloak; somente login local por e-mail e senha (AUTH_MODE=local).
  Se omitido, o script pergunta.

.PARAMETER SkipOllama
  Nao inicia o Ollama nem baixa modelo (use se for usar apenas provedores externos).
  Tambem e assumido automaticamente quando o Ollama nao esta instalado.

.PARAMETER SeedDev
  Carrega os dados de desenvolvimento (organizacao, usuarios, chaves e precos de teste) com scripts/reset-db.ts.
  Os usuarios de teste ficam com a senha impressa ao final do reset.

.PARAMETER AdminEmail
  E-mail do primeiro usuario (owner). A senha e pedida sem eco. Ignorado com -SeedDev.

.PARAMETER NoStart
  Prepara tudo, mas nao abre os servicos (API, Gateway, worker e dashboard).

.EXAMPLE
  .\scripts\first-project-init.ps1 -Keycloak Nao -AdminEmail voce@empresa.com

.EXAMPLE
  .\scripts\first-project-init.ps1 -Keycloak Sim -SeedDev
#>
[CmdletBinding()]
param(
  [ValidateSet('Sim', 'Nao')][string]$Keycloak,
  [ValidateSet('Auto', 'Docker', 'Embedded', 'External')][string]$Postgres = 'Auto',
  [switch]$SkipOllama,
  [switch]$SeedDev,
  [string]$AdminEmail,
  [switch]$NoStart
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $projectRoot

function Write-Step {
  param([string]$Message)
  Write-Host ''
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$Description,
    [int[]]$AcceptedExitCodes = @(0)
  )

  $previous = $ErrorActionPreference
  try {
    # stderr nativo (avisos inofensivos) nao deve virar erro terminante.
    $ErrorActionPreference = 'Continue'
    & $FilePath @Arguments
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
  if ($AcceptedExitCodes -notcontains $exitCode) {
    throw "$Description falhou (codigo $exitCode)."
  }
}

function Update-SessionPath {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user"
}

function Test-Command {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

# Baixa o Node.js LTS portatil (zip oficial) para .tools\node, sem instalar no sistema.
function Install-PortableNode {
  $toolsDir = Join-Path $projectRoot '.tools'
  $nodeDir = Join-Path $toolsDir 'node'
  if (-not (Test-Path -LiteralPath (Join-Path $nodeDir 'node.exe'))) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
    $release = $index | Where-Object { $_.lts -and $_.files -contains 'win-x64-zip' } | Select-Object -First 1
    if (-not $release) { throw 'Nao foi possivel localizar uma versao LTS do Node.js para win-x64.' }
    $name = "node-$($release.version)-win-x64"
    $zip = Join-Path $env:TEMP "$name.zip"
    Write-Host "Baixando Node.js $($release.version) portatil..."
    Invoke-WebRequest -Uri "https://nodejs.org/dist/$($release.version)/$name.zip" -OutFile $zip -UseBasicParsing
    New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
    $extractDir = Join-Path $toolsDir "_extract"
    if (Test-Path -LiteralPath $extractDir) { Remove-Item -LiteralPath $extractDir -Recurse -Force }
    Expand-Archive -LiteralPath $zip -DestinationPath $extractDir -Force
    if (Test-Path -LiteralPath $nodeDir) { Remove-Item -LiteralPath $nodeDir -Recurse -Force }
    Move-Item -LiteralPath (Join-Path $extractDir $name) -Destination $nodeDir
    Remove-Item -LiteralPath $extractDir -Recurse -Force
    Remove-Item -LiteralPath $zip -Force
  }
  $env:Path = "$nodeDir;$env:Path"
}

function Wait-ForTcpPort {
  param([int]$Port, [string]$Description, [int]$TimeoutSeconds = 180)

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
      Write-Host "$Description pronto (porta $Port)."
      return
    }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  throw "Tempo esgotado aguardando $Description na porta $Port."
}

function Test-DockerReady {
  $previous = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & docker info *> $null
    return $LASTEXITCODE -eq 0
  } finally {
    $ErrorActionPreference = $previous
  }
}

function Get-EnvValue {
  param([string]$Name, [string]$DefaultValue = '')

  $line = Get-Content -LiteralPath (Join-Path $projectRoot '.env') |
    Where-Object { $_ -match "^\s*$Name\s*=" } |
    Select-Object -Last 1
  if (-not $line) { return $DefaultValue }
  return (($line -split '=', 2)[1].Trim()).Trim('"').Trim("'")
}

# Define NAME=valor no .env: substitui a linha (ativa ou comentada) ou acrescenta ao final.
function Set-EnvValue {
  param([string]$Name, [string]$Value)

  $path = Join-Path $projectRoot '.env'
  $lines = [System.Collections.Generic.List[string]]@(Get-Content -LiteralPath $path)
  $index = -1
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^\s*#?\s*$Name\s*=") { $index = $i }
  }
  if ($index -ge 0) { $lines[$index] = "$Name=$Value" } else { $lines.Add("$Name=$Value") }
  [System.IO.File]::WriteAllText($path, (($lines -join [Environment]::NewLine) + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding $false))
}

function New-RandomHex {
  param([int]$Bytes)
  $buffer = New-Object byte[] $Bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
  return (($buffer | ForEach-Object { $_.ToString('x2') }) -join '')
}

function New-RandomBase64 {
  param([int]$Bytes)
  $buffer = New-Object byte[] $Bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
  return [Convert]::ToBase64String($buffer)
}

function Wait-ForHttp {
  param([string]$Url, [string]$Description, [int]$TimeoutSeconds = 120)

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
  param([int]$Port)
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

# ---------------------------------------------------------------- 0. Escolha do Keycloak
if (-not $Keycloak) {
  if ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
    $answer = Read-Host 'Deseja instalar e usar o Keycloak (SSO) alem do login local? [s/N]'
    $Keycloak = if ($answer -match '^(s|sim|y|yes)$') { 'Sim' } else { 'Nao' }
  } else {
    $Keycloak = 'Nao'
  }
}
$useKeycloak = $Keycloak -eq 'Sim'
Write-Host "Keycloak (SSO): $Keycloak"

# ---------------------------------------------------------------- 1. Pre-requisitos
Write-Step 'Verificando pre-requisitos (Node.js, Docker, Ollama)'

$nodeOk = (Test-Command 'node') -and (Test-Command 'npm')
if ($nodeOk) {
  $nodeOk = [int]((node --version).TrimStart('v').Split('.')[0]) -ge 20
  if (-not $nodeOk) { Write-Host "Node.js $(node --version) e muito antigo (minimo 20); usando o Node.js portatil." }
}
if (-not $nodeOk) { Install-PortableNode }
Write-Host "Node.js $(node --version) / npm $(npm --version)"

$dockerAvailable = (Test-Command 'docker') -and (Test-DockerReady)
if (-not $dockerAvailable -and (Test-Command 'docker')) {
  $dockerDesktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if ((Test-Path -LiteralPath $dockerDesktop) -and ($useKeycloak -or $Postgres -eq 'Docker')) {
    Write-Host 'Iniciando o Docker Desktop (pode levar alguns minutos)...'
    Start-Process -FilePath $dockerDesktop | Out-Null
    $deadline = (Get-Date).AddSeconds(240)
    do {
      Start-Sleep -Seconds 3
      $dockerAvailable = Test-DockerReady
    } while (-not $dockerAvailable -and (Get-Date) -lt $deadline)
  }
}
if ($useKeycloak -and -not $dockerAvailable) {
  throw 'O Keycloak exige Docker, que nao esta disponivel. Instale/inicie o Docker Desktop ou execute com -Keycloak Nao.'
}
if ($Postgres -eq 'Docker' -and -not $dockerAvailable) {
  throw 'Docker nao esta disponivel. Use -Postgres Embedded ou -Postgres Auto.'
}
$useExternalPostgres = $Postgres -eq 'External'
$useEmbeddedPostgres = ($Postgres -eq 'Embedded') -or ($Postgres -eq 'Auto' -and -not $dockerAvailable)
Write-Host "PostgreSQL: $(if ($useExternalPostgres) { 'existente (DATABASE_URL)' } elseif ($useEmbeddedPostgres) { 'embarcado (binarios via npm)' } else { 'Docker' })"

if (-not $SkipOllama -and -not (Test-Command 'ollama')) {
  Write-Warning 'Ollama nao encontrado; seguindo sem Ollama (equivale a -SkipOllama). Para usar modelos locais, instale-o depois.'
  $SkipOllama = $true
}

# ---------------------------------------------------------------- 2. .env
Write-Step 'Configurando o arquivo .env'
if (-not (Test-Path -LiteralPath '.env')) {
  Copy-Item -LiteralPath '.env.example' -Destination '.env'
  Write-Host '.env criado a partir de .env.example.'
} else {
  Write-Host '.env ja existe; valores existentes serao preservados (apenas segredos vazios serao gerados).'
}

if (-not (Get-EnvValue 'AUTH_LOCAL_JWT_SECRET')) { Set-EnvValue 'AUTH_LOCAL_JWT_SECRET' (New-RandomBase64 48) }
if (-not (Get-EnvValue 'CONNECTOR_CREDENTIALS_KEY')) { Set-EnvValue 'CONNECTOR_CREDENTIALS_KEY' (New-RandomHex 32) }
if (-not (Get-EnvValue 'PROMPT_CONTENT_ENCRYPTION_KEY')) { Set-EnvValue 'PROMPT_CONTENT_ENCRYPTION_KEY' (New-RandomHex 32) }
Set-EnvValue 'AUTH_MODE' $(if ($useKeycloak) { 'both' } else { 'local' })
Write-Host "AUTH_MODE=$(Get-EnvValue 'AUTH_MODE')"

# ---------------------------------------------------------------- 3. Dependencias
Write-Step 'Instalando dependencias do projeto (npm ci)'
if (Test-Path -LiteralPath 'package-lock.json') {
  Invoke-CheckedCommand -FilePath 'npm' -Arguments @('ci') -Description 'Instalacao de dependencias'
} else {
  Invoke-CheckedCommand -FilePath 'npm' -Arguments @('install') -Description 'Instalacao de dependencias'
}

# ---------------------------------------------------------------- 4. Containers
Write-Step 'Subindo banco de dados e servicos de apoio'
$shell = (Get-Command 'powershell.exe' -ErrorAction Stop).Source
$escapedRoot = $projectRoot.Replace("'", "''")
$pathPrefix = ''
if (Test-Path -LiteralPath (Join-Path $projectRoot '.tools\node\node.exe')) {
  $pathPrefix = "`$env:Path = '$((Join-Path $projectRoot '.tools\node').Replace("'", "''"));' + `$env:Path; "
}

if ($useExternalPostgres) {
  $dbUrl = [Uri](Get-EnvValue 'DATABASE_URL' 'postgres://app:app_dev_password@localhost:5432/ai_spend')
  $dbPort = if ($dbUrl.Port -gt 0) { $dbUrl.Port } else { 5432 }
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $connect = $client.BeginConnect($dbUrl.Host, $dbPort, $null, $null)
    if (-not $connect.AsyncWaitHandle.WaitOne(5000) -or -not $client.Connected) {
      throw "Nao foi possivel conectar ao PostgreSQL em $($dbUrl.Host):$dbPort (DATABASE_URL no .env). Verifique se o container publica a porta e se o host esta correto."
    }
  } finally {
    $client.Close()
  }
  Write-Host "PostgreSQL existente acessivel em $($dbUrl.Host):$dbPort (o banco e o usuario devem existir)."
} elseif ($useEmbeddedPostgres) {
  $dbUrl = [Uri](Get-EnvValue 'DATABASE_URL' 'postgres://app:app_dev_password@localhost:5432/ai_spend')
  $dbPort = if ($dbUrl.Port -gt 0) { $dbUrl.Port } else { 5432 }
  if (Test-LocalPortInUse -Port $dbPort) {
    Write-Host "Porta $dbPort ja em uso; assumindo que ja ha um PostgreSQL ativo."
  } else {
    $command = "${pathPrefix}Set-Location -LiteralPath '$escapedRoot'; npm run db:embedded"
    Start-Process -FilePath $shell -ArgumentList @('-NoExit', '-NoProfile', '-Command', $command) | Out-Null
    Wait-ForTcpPort -Port $dbPort -Description 'PostgreSQL embarcado'
    Start-Sleep -Seconds 3
  }
} else {
  if ($useKeycloak) {
    Invoke-CheckedCommand -FilePath 'docker' -Arguments @('compose', '--profile', 'sso', 'up', '-d', 'postgres', 'keycloak') -Description 'Inicializacao dos containers'
  } else {
    Invoke-CheckedCommand -FilePath 'docker' -Arguments @('compose', 'up', '-d', 'postgres') -Description 'Inicializacao do PostgreSQL'
  }

  $databaseReady = $false
  $deadline = (Get-Date).AddSeconds(120)
  do {
    $previous = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'Continue'
      & docker compose exec -T postgres pg_isready -U app -d ai_spend *> $null
      $databaseReady = $LASTEXITCODE -eq 0
    } finally {
      $ErrorActionPreference = $previous
    }
    if (-not $databaseReady) { Start-Sleep -Seconds 2 }
  } while (-not $databaseReady -and (Get-Date) -lt $deadline)
  if (-not $databaseReady) { throw 'Tempo esgotado aguardando o PostgreSQL.' }
  Write-Host 'PostgreSQL pronto.'
}

if ($useKeycloak -and ($useEmbeddedPostgres -or $useExternalPostgres)) {
  Invoke-CheckedCommand -FilePath 'docker' -Arguments @('compose', '--profile', 'sso', 'up', '-d', 'keycloak') -Description 'Inicializacao do Keycloak'
}

if ($useKeycloak) {
  $realm = Get-EnvValue 'KEYCLOAK_REALM' 'ai-spend'
  Wait-ForHttp -Url "http://localhost:8080/realms/$realm/.well-known/openid-configuration" -Description 'Keycloak' -TimeoutSeconds 240
}

# ---------------------------------------------------------------- 5. Ollama
if (-not $SkipOllama) {
  Write-Step 'Preparando o Ollama'
  $ollamaBaseUrl = (Get-EnvValue 'OLLAMA_BASE_URL' 'http://localhost:11434').TrimEnd('/')
  $tagsUrl = "$ollamaBaseUrl/api/tags"
  try {
    Invoke-RestMethod -Uri $tagsUrl -TimeoutSec 3 | Out-Null
  } catch {
    Write-Host 'Iniciando o Ollama...'
    Start-Process -FilePath (Get-Command 'ollama').Source -ArgumentList 'serve' -WindowStyle Hidden | Out-Null
    Wait-ForHttp -Url $tagsUrl -Description 'Ollama'
  }
  $model = Get-EnvValue 'OLLAMA_MODEL' 'llama3.2'
  $installed = @((Invoke-RestMethod -Uri $tagsUrl -TimeoutSec 10).models | Where-Object {
    $_.name -eq $model -or $_.name -eq "${model}:latest"
  }).Count -gt 0
  if (-not $installed) {
    Write-Host "Baixando o modelo '$model' (pode levar varios minutos)..."
    Invoke-CheckedCommand -FilePath 'ollama' -Arguments @('pull', $model) -Description "Download do modelo $model"
  }
}

# ---------------------------------------------------------------- 6. Banco e build
Write-Step 'Aplicando migracoes e compilando'
Invoke-CheckedCommand -FilePath 'npm' -Arguments @('run', 'migrate:up') -Description 'Migracoes do banco'
Invoke-CheckedCommand -FilePath 'npm' -Arguments @('run', 'build') -Description 'Build do projeto'

# ---------------------------------------------------------------- 7. Primeiro usuario
Write-Step 'Criando o acesso inicial'
$firstLoginHint = ''
if ($SeedDev) {
  Invoke-CheckedCommand -FilePath 'npx' -Arguments @('tsx', 'scripts/reset-db.ts', '--yes') -Description 'Carga de dados de desenvolvimento'
  $firstLoginHint = 'Use os usuarios de teste impressos acima (owner@acme.local etc.).'
} else {
  $interactive = [Environment]::UserInteractive -and -not [Console]::IsInputRedirected
  if (-not $AdminEmail -and $interactive) { $AdminEmail = Read-Host 'E-mail do primeiro usuario (owner), ou Enter para pular' }
  if ($AdminEmail) {
    $secure = Read-Host 'Senha (minimo 12 caracteres)' -AsSecureString
    $plain = [System.Net.NetworkCredential]::new('', $secure).Password
    $previous = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'Continue'
      $plain | & npx tsx scripts/create-user.ts --email $AdminEmail --name $AdminEmail --role owner
      $exitCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previous
      $plain = $null
    }
    if ($exitCode -ne 0) { throw 'Nao foi possivel criar o primeiro usuario (verifique a politica de senha).' }
    $firstLoginHint = "Entre com $AdminEmail e a senha informada."
  } else {
    $firstLoginHint = 'Crie o primeiro usuario: npx tsx scripts/create-user.ts --email voce@empresa.com --name "Seu Nome" --role owner'
  }
}

# ---------------------------------------------------------------- 8. Servicos
if ($NoStart) {
  Write-Step 'Ambiente preparado (-NoStart): servicos nao iniciados'
  Write-Host 'Para subir: npm run dev:api / dev:gateway / dev:worker / dev:web (ou .\scripts\init-all.ps1).'
  Write-Host $firstLoginHint
  return
}

Write-Step 'Iniciando os servicos'
$busy = @(3000, 3001, 3002, 3003 | Where-Object { Test-LocalPortInUse -Port $_ })
if ($busy.Count -gt 0) {
  throw "Porta(s) ja em uso: $($busy -join ', '). Feche os servicos existentes e execute novamente (ou use -NoStart)."
}

$services = @(
  @{ Name = 'API'; Script = 'dev:api'; Url = 'http://localhost:3001/health' },
  @{ Name = 'Gateway'; Script = 'dev:gateway'; Url = 'http://localhost:3002/health' },
  @{ Name = 'Worker'; Script = 'dev:worker'; Url = 'http://localhost:3003/health' },
  @{ Name = 'Web'; Script = 'dev:web'; Url = 'http://localhost:3000/' }
)
foreach ($service in $services) {
  $command = "${pathPrefix}Set-Location -LiteralPath '$escapedRoot'; npm run $($service.Script)"
  Start-Process -FilePath $shell -ArgumentList @('-NoExit', '-NoProfile', '-Command', $command) | Out-Null
  Write-Host "$($service.Name) iniciado."
}
foreach ($service in $services) {
  Wait-ForHttp -Url $service.Url -Description $service.Name -TimeoutSeconds 120
}

Write-Host ''
Write-Host 'Ambiente pronto:' -ForegroundColor Green
Write-Host '  Dashboard: http://localhost:3000'
Write-Host '  API:       http://localhost:3001  (docs em /docs)'
Write-Host '  Gateway:   http://localhost:3002'
Write-Host '  Worker:    http://localhost:3003'
if ($useKeycloak) { Write-Host '  Keycloak:  http://localhost:8080 (SSO + login local)' } else { Write-Host '  Login:     local (e-mail e senha), sem Keycloak' }
Write-Host ''
Write-Host $firstLoginHint
