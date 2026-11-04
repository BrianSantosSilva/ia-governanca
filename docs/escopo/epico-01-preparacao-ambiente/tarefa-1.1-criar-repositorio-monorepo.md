# Tarefa 1.1 — Criar o Repositório e Estrutura de Monorepo

- **Épico:** Épico 01 — Preparar o Ambiente
- **Fase:** 1 (Ambiente Local e Estrutura)
- **Dependências:** [Tarefa 0.1](../epico-00-pre-requisitos/tarefa-0.1-instalacao-softwares-base.md)
- **Diretórios Afetados:** Raiz do projeto, `apps/*`, `packages/*`, `migrations/`, `fixtures/`, `tests/`
- **Guia de Teste Manual:** [teste-manual-1.1-e-1.2-monorepo-e-build.md](./testes-manuais/teste-manual-1.1-e-1.2-monorepo-e-build.md)

## 1. Objetivo
Inicializar o repositório Git e estruturar o monorepo utilizando **npm workspaces** para compartilhar pacotes internos de domínio, contratos, políticas, finanças e banco de dados entre as aplicações.

## 2. Estrutura do Monorepo a Criar

```text
ia-governanca/
├── apps/
│   ├── api/
│   │   └── src/
│   ├── gateway/
│   │   └── src/
│   ├── worker/
│   │   └── src/
│   └── web/
│       └── src/
├── packages/
│   ├── contracts/
│   ├── database/
│   ├── connectors/
│   ├── identity/
│   ├── policies/
│   └── finance/
├── migrations/
├── fixtures/
│   ├── csv/
│   └── json/
├── tests/
│   ├── integration/
│   ├── security/
│   └── e2e/
├── docker-compose.yml
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## 3. Responsabilidades de cada Módulo
- `apps/api`: Endpoints administrativos (organizações, usuários, projetos, conectores).
- `apps/gateway`: Inferência, autenticação de chaves virtuais e registro de utilização.
- `apps/worker`: Execução de sincronizações e importações em background.
- `apps/web`: Interface de usuário (dashboard administrativo).
- `packages/contracts`: Contratos TypeScript e validações compartilhadas.
- `packages/database`: Acesso ao PostgreSQL e migrações.
- `packages/connectors`: Integrações externas e importadores CSV.
- `packages/identity`: Autenticação e autorização.
- `packages/policies`: Limites, orçamentos e regras de acesso.
- `packages/finance`: Preços, custos e reconciliação.
- `fixtures`: Dados sintéticos para testes reproduzíveis.

## 4. Atividades Passo a Passo
- [x] Inicializar o repositório Git (`git init`) e `package.json` raiz (`npm init -y`).
- [x] Configurar `workspaces: ["apps/*", "packages/*"]` no `package.json` raiz.
- [x] Criar os diretórios e `package.json` individuais para cada app em `apps/*` e pacote em `packages/*`.
- [x] Criar as pastas `migrations/`, `fixtures/csv/`, `fixtures/json/`, `tests/integration/`, `tests/security/` e `tests/e2e/`.
- [x] Criar arquivo `.gitignore` (ignorando `node_modules`, `dist`, `.env`, etc.) e `README.md` inicial.

## 5. Critérios de Conclusão
- [x] O repositório Git foi inicializado.
- [x] Toda a árvore de diretórios do monorepo foi criada.
- [x] O `npm workspaces` reconhece todos os pacotes em `apps/*` e `packages/*`.
