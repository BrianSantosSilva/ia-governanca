# Guia de Teste Manual — Tarefa 0.1: Softwares Base e Docker

- **Épico:** Épico 00 — Pré-requisitos e Validação da LLM Local
- **Tarefa Relacionada:** [Tarefa 0.1 — Instalação e Validação dos Softwares Base](../tarefa-0.1-instalacao-softwares-base.md)
- **Ambiente:** Windows (PowerShell ou Terminal do VS Code / Antigravity)

---

## Objetivo deste Guia
Permitir que você valide manualmente, a qualquer momento, se todas as ferramentas obrigatórias do ambiente base (**Git**, **Node.js**, **npm**, **Docker CLI**, **Docker Compose** e o motor do **Docker Desktop**) estão instaladas e respondendo.

---

## 1. Testar o Git

Execute no PowerShell:
```powershell
git --version
```

- **Resultado esperado:** Deve exibir a versão instalada (ex.: `git version 2.49.0.windows.1`).
- **Se falhar:** Verifique se o Git está no `PATH` do Windows ou instale via `winget install --id Git.Git -e`.

---

## 2. Testar o Node.js LTS e o npm

Execute no PowerShell:
```powershell
node -v
npm -v
```

- **Resultado esperado:**
  - `node -v`: Versão LTS igual ou superior à `v20.x` / `v22.x` (ex.: `v22.13.1`).
  - `npm -v`: Versão do gerenciador de pacotes com suporte a *workspaces* (ex.: `10.9.2`).

---

## 3. Testar a instalação do Docker e Docker Compose

Execute no PowerShell:
```powershell
docker --version
docker compose version
```

- **Resultado esperado:**
  - `Docker version 28.x.x...`
  - `Docker Compose version v2.x.x...`

---

## 4. Testar se o Motor (Daemon) do Docker Desktop está Rodando

Mesmo com o Docker instalado, o serviço em segundo plano precisa estar ativo para subir o PostgreSQL e o Keycloak. Execute:

```powershell
docker info --format "Server Version: {{.ServerVersion}} | OS: {{.OperatingSystem}} | Containers Running: {{.ContainersRunning}}"
```

- **Resultado esperado:**
  ```text
  Server Version: 28.0.4 | OS: Docker Desktop | Containers Running: 0
  ```
- **Se aparecer o erro `open //./pipe/dockerDesktopLinuxEngine: O sistema não pode encontrar o arquivo especificado`:**
  1. Abra o aplicativo **Docker Desktop** pelo Menu Iniciar do Windows.
  2. Aguarde o ícone da baleia na bandeja do sistema ficar estável (*Engine running*).
  3. Execute o comando novamente.

---

## 5. Comando Único de Verificação Rápida (Tudo em Um)

Caso queira validar todos os itens da Tarefa 0.1 de uma só vez no PowerShell, copie e cole:

```powershell
Write-Host "1. Git:" -ForegroundColor Cyan; git --version
Write-Host "`n2. Node.js & npm:" -ForegroundColor Cyan; node -v; npm -v
Write-Host "`n3. Docker & Compose:" -ForegroundColor Cyan; docker --version; docker compose version
Write-Host "`n4. Status do Daemon Docker:" -ForegroundColor Cyan; docker info --format "Server Version: {{.ServerVersion}} | OS: {{.OperatingSystem}}"
```
