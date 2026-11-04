# Guia de Teste Manual — Tarefas 2.1 a 2.5: Migrações, Domínio e Isolamento no PostgreSQL

- **Épico:** Épico 02 — Implementar o Domínio e o Banco de Dados
- **Tarefas Relacionadas:**
  - [Tarefa 2.1 — Migração: Organizações e Identidade](../tarefa-2.1-organizacoes-e-identidade.md)
  - [Tarefa 2.2 — Migração: Conectores e Ingestão](../tarefa-2.2-conectores-e-ingestao.md)
  - [Tarefa 2.3 — Migração: Licenças e Assentos](../tarefa-2.3-licencas.md)
  - [Tarefa 2.4 — Migração: Gateway, Ledger Financeiro e Orçamentos](../tarefa-2.4-gateway-e-financas.md)
  - [Tarefa 2.5 — Testes de Integridade do Domínio e Isolamento](../tarefa-2.5-testar-integridade-dominio.md)
- **Ambiente:** Windows (PowerShell na raiz `C:\Projetos\EstudoIA\ia-governanca`)

---

## 1. Testar Aplicação e Reversão das Migrações (`migrate:up` e `migrate:down`)

Para reverter todas as migrações e reaplicá-las em ordem a partir de um banco limpo:

```powershell
npm run migrate:down
npm run migrate:up
```

### Resultado esperado:
```text
Migrations aplicadas: [
  '001_organizations_and_identity.sql',
  '002_connectors_and_ingestion.sql',
  '003_licenses.sql',
  '004_gateway_and_finance.sql'
]
```

---

## 2. Listar Todas as 20 Tabelas Criadas no PostgreSQL

Execute no PowerShell:

```powershell
docker compose exec postgres psql -U app -d ai_spend -c "\dt"
```

### Resultado esperado:
Deve listar as 20 tabelas do domínio (`audit_events`, `budget_policies`, `budget_reservations`, `cost_records`, `external_identities`, `license_assignments`, `license_contracts`, `memberships`, `model_prices`, `organizations`, `projects`, `provider_connections`, `reconciliation_matches`, `source_records`, `sync_runs`, `team_memberships`, `teams`, `usage_events`, `users`, `virtual_keys`) mais a tabela de controle `schema_migrations`.

---

## 3. Inspecionar Colunas Monetárias (`numeric`) e Datas (`timestamptz`)

Para conferir que os valores financeiros usam `numeric` e as datas usam `timestamp with time zone` (`timestamptz`):

```powershell
docker compose exec postgres psql -U app -d ai_spend -c "\d cost_records"
docker compose exec postgres psql -U app -d ai_spend -c "\d virtual_keys"
```

- Verifique que em `cost_records` a coluna `amount` é `numeric(18,8)` e `currency` é `character(3)`.
- Verifique que em `virtual_keys` existe apenas `key_prefix` e `key_hash` (com constraint `length(key_hash) >= 64`), sem coluna de chave em texto puro.

---

## 4. Testar Manualmente o Bloqueio Cross-Tenant via SQL

Você pode tentar associar um projeto da Organização A a uma equipe da Organização B diretamente no `psql` para ver o PostgreSQL bloquear a tentativa pela chave estrangeira composta (`fk_projects_team_org`):

```powershell
npm test -- tests/integration/database-integrity.test.ts
```

- **Resultado esperado:** Todos os 5 blocos de teste (cobrindo os 7 cenários de integridade, bloqueio cross-tenant, preservação financeira em remoção lógica e reprodutibilidade de migrações) devem passar (`5 passed`).
