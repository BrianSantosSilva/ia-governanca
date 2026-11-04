# ia-governanca — AI Spend & Governance Platform

Protótipo funcional de plataforma unificada de governança financeira e operacional de Inteligência Artificial.

## Arquitetura e Documentação
- [Visão Geral, Arquitetura e Roadmap](./docs/escopo/00-visao-geral-arquitetura-e-roadmap.md)
- [Diagrama Técnico da Arquitetura](./docs/desenhos/arquitetura-tecnica.png)
- [Fonte vetorial do diagrama](./docs/desenhos/arquitetura-tecnica.svg) (fonte canônica; PNG e JPG são exports derivados, regenerados no Windows com `.\scripts\export-architecture-diagram.ps1`, que requer Microsoft Edge)

## Estrutura do Monorepo
- `apps/api`: Endpoints administrativos (Fastify + OpenAPI)
- `apps/gateway`: Gateway de inferência LLM, autenticação de chaves virtuais e telemetria
- `apps/worker`: Sincronizações em background e importação de dados
- `apps/web`: Dashboard administrativo (React + Vite)
- `packages/contracts`: Contratos TypeScript e validações Zod compartilhadas
- `packages/database`: Pool PostgreSQL (`pg`) e migrações
- `packages/identity`: Autenticação OIDC (Keycloak) e autorização RBAC
- `packages/policies`: Políticas de acesso e reservas atômicas de orçamento
- `packages/finance`: Catálogo de preços versionado, cálculo decimal de custos e reconciliação
- `packages/connectors`: Contratos de conectores, importador CSV e integrações externas

## Inicialização Rápida (Ambiente Local)

**Máquina limpa (só clonou o repositório):**
```powershell
.\scripts\first-project-init.ps1 -Keycloak Nao -AdminEmail voce@empresa.com
```
Parâmetros: `-Keycloak Sim|Nao` (pergunta se omitido), `-Postgres Auto|Docker|Embedded|External` (`External` usa o `DATABASE_URL` do `.env`, local ou remoto, e só testa a conexão; o banco e o usuário devem existir), `-SkipOllama`, `-SeedDev`, `-NoStart`. Não usa winget: se o Node.js faltar, baixa o binário portátil para `.tools\node`; sem Docker, usa PostgreSQL embarcado via npm (`npm run db:embedded`, dados em `.data\postgres`); sem Ollama, segue sem ele. O Keycloak exige Docker.

Para preparar e iniciar todo o ambiente de desenvolvimento no Windows, abra o PowerShell na raiz do projeto e execute:
```powershell
.\scripts\init-all.ps1
```
O script cria `.env` se necessário, verifica Docker/Node.js/Ollama, inicia PostgreSQL (e o Keycloak apenas quando `AUTH_MODE` é `oidc`/`both` ou `KEYCLOAK_BASE_URL` está definido), inicia o Ollama e baixa o modelo configurado se ainda não estiver instalado, aplica as migrações e abre API, Gateway, worker e dashboard em terminais separados. O primeiro download do modelo pode levar alguns minutos. Se Ollama não estiver instalado, instale-o em https://ollama.com/download antes de executar.

Para executar as etapas manualmente:
1. No PowerShell, copie as configurações locais e instale as dependências:
   ```powershell
   Copy-Item .env.example .env
   npm install
   ```
2. Defina `AUTH_LOCAL_JWT_SECRET` no `.env` (mínimo de 32 caracteres; ex.: `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`), inicie o PostgreSQL e aplique as migrações. O Keycloak é **opcional**:
   ```powershell
   docker compose up -d postgres
   npm run migrate:up
   # opcional, para SSO (profile "sso"; use AUTH_MODE=both ou oidc e KEYCLOAK_*):
   docker compose --profile sso up -d keycloak
   ```
   Crie o primeiro usuário local (a senha é lida sem eco; mínimo de 12 caracteres). Alternativas: `BOOTSTRAP_ADMIN_EMAIL`/`BOOTSTRAP_ADMIN_PASSWORD` no `.env` (exige troca de senha no primeiro login) ou `npx tsx scripts/reset-db.ts --yes` para o seed de desenvolvimento:
   ```powershell
   npx tsx scripts/create-user.ts --email voce@empresa.com --name "Seu Nome" --role owner
   ```
   Modos (`AUTH_MODE`): `local` (e-mail/senha, sem Keycloak; padrão sem `KEYCLOAK_BASE_URL`), `oidc` (somente SSO) e `both` (padrão com Keycloak e segredo local: SSO e senha lado a lado). Detalhes em `docs/escopo/epico-10-melhorias-iniciais/tarefa-10.8-login-local-sem-keycloak.md`.
3. Inicie API, Gateway, worker e dashboard em terminais separados:
   ```powershell
   npm run dev:api
   npm run dev:gateway
   npm run dev:worker
   npm run dev:web
   ```
   Endpoints: API `http://localhost:3001`, Gateway `http://localhost:3002`, worker `http://localhost:3003`, Web `http://localhost:3000`. Os serviços expõem `/health` e `/metrics`; restrinja o acesso a `/metrics` à rede operacional confiável em ambientes compartilhados.
4. Compile e execute a suíte. **Os testes de integração revertem e recriam todas as migrações; nunca use o banco de produção ou o banco local com dados que deseja preservar.** Crie um banco descartável e direcione `DATABASE_URL` a ele:
   ```powershell
   docker compose exec -T postgres createdb -U app ai_spend_test
   $env:DATABASE_URL = "postgres://app:app_dev_password@localhost:5432/ai_spend_test"
   npm run build
   npm test
   Remove-Item Env:DATABASE_URL
   docker compose exec -T postgres dropdb -U app ai_spend_test
   ```
   `npm run typecheck` também executa a verificação de referências TypeScript. O teste de fluxo E2E usa um adaptador LLM determinístico para não depender de Ollama ou de serviços externos.

## Rate limiting, métricas e retenção

Os limites padrão por endereço IP são 120 requisições/minuto na API e no Gateway. Configure `API_RATE_LIMIT_MAX` e `GATEWAY_RATE_LIMIT_MAX`; são limites em memória por processo e não substituem rate limiting distribuído em uma implantação com múltiplas réplicas. Requisições de inferência ainda respeitam o limite adicional por chave virtual.

Os endpoints `/metrics` expõem texto Prometheus; `/health` verifica a conexão com PostgreSQL. Os logs operacionais são JSON e incluem correlação/status/duração sem registrar o corpo das requisições, prompts ou segredos. Não publique métricas nem logs sem restringir o acesso.
As aplicações escrevem logs em `stdout`; retenção/rotação desses arquivos deve ser configurada no runtime que os coleta (por exemplo, driver de logs do container ou journald), mantendo a política alinhada aos prazos de auditoria.

`DATA_RETENTION_DAYS` controla por quanto tempo registros em `audit_events` são mantidos (padrão: 3650 dias). A captura opcional de prompts e respostas exige habilitação da organização, `store: true` por requisição e `PROMPT_CONTENT_ENCRYPTION_KEY` (64 caracteres hexadecimais); o conteúdo é cifrado e removido ao vencer a retenção configurada pela organização. A limpeza é explícita e pode ser executada com:
```powershell
npm run retention:prune
```
O comando remove auditoria expirada e conteúdo de inferência vencido; não remove o ledger financeiro (`usage_events`, `cost_records`), que deve ser preservado conforme as políticas de compliance aplicáveis.

## Backup e restauração PostgreSQL

Com o PostgreSQL do Compose em execução:
```powershell
.\scripts\backup-postgres.ps1
```
O dump custom-format é gravado em `backups\`. Para testar a restauração, crie um banco vazio separado; o script verifica que ele não contém tabelas e nunca limpa ou sobrescreve um banco existente:
```powershell
docker compose exec -T postgres createdb -U app ai_spend_restore_test
.\scripts\restore-postgres.ps1 -Path .\backups\<arquivo>.dump -Database ai_spend_restore_test
docker compose exec -T postgres pg_dump -U app -d ai_spend_restore_test --schema-only
```
Compare a estrutura e os totais do ledger restaurado com o banco de origem antes de aceitar o backup. Após validar, remova somente o banco descartável de restauração:
```powershell
docker compose exec -T postgres dropdb -U app ai_spend_restore_test
```
