# Tarefa 0.1 — Instalação e Validação dos Softwares Base

- **Épico:** Épico 00 — Pré-requisitos e Validação da LLM Local
- **Fase:** 0 (Pré-requisito de Ambiente)
- **Dependências:** Nenhuma
- **Guia de Teste Manual:** [teste-manual-0.1-softwares-base.md](./testes-manuais/teste-manual-0.1-softwares-base.md)

## 1. Objetivo
Garantir que todas as ferramentas obrigatórias de desenvolvimento local estejam instaladas e operacionais na máquina antes de iniciar a construção do monorepo e dos serviços.

## 2. Softwares Necessários

| Software | Finalidade | Obrigatório | Documentação Oficial |
| :--- | :--- | :---: | :--- |
| **Git** | Controle de versão | Sim | https://git-scm.com/doc |
| **Node.js LTS e npm** | Backend, frontend e ferramentas (workspaces) | Sim | https://nodejs.org/ |
| **Docker e Docker Compose** | PostgreSQL, Keycloak e serviços auxiliares | Sim | https://docs.docker.com/get-started/ |
| **PostgreSQL** | Persistência dos dados (via Docker inicialmente) | Sim | https://www.postgresql.org/docs/ |
| **Ollama** | Executar a LLM local | Sim | https://ollama.com/ |
| **Editor de código** | Desenvolvimento | Sim | — |
| **Navegador moderno** | Utilização do dashboard | Sim | — |
| **Conta em provedor LLM** | Integração externa opcional (Fase 7) | Não | https://ai.google.dev/gemini-api/docs/pricing |

## 3. Atividades Passo a Passo
- [x] Verificar instalação do Git (`git --version` -> `2.49.0.windows.1`).
- [x] Verificar instalação do Node.js LTS e npm (`node -v` -> `v22.13.1` e `npm -v` -> `10.9.2`).
- [x] Verificar instalação do Docker e Docker Compose (`Docker 28.0.4` e `Compose v2.34.0-desktop.1`).
- [x] Garantir que o daemon do Docker esteja ativo e capaz de subir contêineres locais (`Server Version: 28.0.4 | OS: Docker Desktop`).

## 4. Critérios de Conclusão
- [x] Git instalado e acessível no terminal.
- [x] Node.js LTS e npm instalados e acessíveis no terminal.
- [x] Docker e Docker Compose instalados e em execução.
