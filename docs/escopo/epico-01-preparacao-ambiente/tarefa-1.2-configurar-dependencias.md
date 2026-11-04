# Tarefa 1.2 — Configurar as Dependências Base

- **Épico:** Épico 01 — Preparar o Ambiente
- **Fase:** 1 (Ambiente Local e Estrutura)
- **Dependências:** [Tarefa 1.1 — Criar o Repositório e Estrutura de Monorepo](./tarefa-1.1-criar-repositorio-monorepo.md)
- **Diretórios Afetados:** `package.json`, `tsconfig.json`, `apps/*`, `packages/*`
- **Guia de Teste Manual:** [teste-manual-1.1-e-1.2-monorepo-e-build.md](./testes-manuais/teste-manual-1.1-e-1.2-monorepo-e-build.md)

## 1. Objetivo
Instalar e configurar as bibliotecas principais de backend, frontend, banco de dados, validação, documentação de API e testes automatizados, garantindo que o TypeScript compile em todo o monorepo.

## 2. Stack e Bibliotecas Obrigatórias
- **Fastify:** Para os serviços HTTP (`apps/api` e `apps/gateway`).
- **TypeScript:** Para tipagem estática no backend, pacotes e frontend.
- **React e Vite:** Para o frontend (`apps/web`).
- **Zod:** Para validação de contratos em `packages/contracts` e entradas de API.
- **Driver PostgreSQL (`pg`):** Para conexão com o banco em `packages/database`.
- **Ferramenta de migrações SQL (`node-pg-migrate`):** Para gerenciamento evolutivo do schema.
- **Vitest:** Biblioteca de testes unitários, de integração e E2E.
- **OpenAPI (`@fastify/swagger` / `@fastify/swagger-ui`):** Para documentar os endpoints HTTP.

## 3. Atividades Passo a Passo
- [x] Configurar `tsconfig.base.json` na raiz e `tsconfig.json` nos pacotes e apps.
- [x] Instalar Fastify, Zod, `pg`, `node-pg-migrate`, Vitest e plugins OpenAPI nos respectivos workspaces.
- [x] Configurar React + Vite + TypeScript em `apps/web`.
- [x] Adicionar scripts padronizados no `package.json` raiz (`build`, `typecheck`, `test`, `migrate:up`, `migrate:down`, `dev`).
- [x] Garantir que as dependências estejam instaladas e fixadas no `package-lock.json`.

## 4. Critérios de Conclusão
- [x] Todas as dependências estão instaladas e fixadas no `package-lock.json`.
- [x] O comando de compilação/verificação TypeScript (`npm run build` / `npm run typecheck`) executa sem erros em todos os workspaces.
- [x] O runner de testes (Vitest) executa um teste de fumaça inicial com sucesso.
