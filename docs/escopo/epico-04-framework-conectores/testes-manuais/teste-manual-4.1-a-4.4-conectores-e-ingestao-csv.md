# Guia de Teste Manual — Tarefas 4.1 a 4.4: Framework de Conectores, Ingestão CSV, Idempotência e Retomada

- **Épico:** Épico 04 — Criar o Framework de Conectores
- **Tarefas Relacionadas:**
  - [Tarefa 4.1 — Definir o Contrato de Conectores](../tarefa-4.1-definir-contrato-conectores.md)
  - [Tarefa 4.2 — Implementar o Worker de Sincronização](../tarefa-4.2-implementar-worker-sincronizacao.md)
  - [Tarefa 4.3 — Criar o Importador CSV e Fixtures](../tarefa-4.3-criar-importador-csv.md)
  - [Tarefa 4.4 — Testar Idempotência e Retomada de Execução](../tarefa-4.4-testar-idempotencia-e-retomada.md)
- **Ambiente:** Windows (PowerShell na raiz `C:\Projetos\EstudoIA\ia-governanca`)

---

## 1. Inspecionar as Fixtures Sintéticas de Teste

Verifique se os 4 arquivos de exemplo CSV estão presentes em `fixtures/csv/`:

```powershell
Get-ChildItem -Path .\fixtures\csv
```

### Arquivos esperados:
- `api-costs-valid.csv`: 5 registros válidos com provedores variados (`openai`, `anthropic`, `cohere`, `ollama`), moedas ISO 4217 (`USD`, `BRL`) e períodos.
- `api-costs-invalid.csv`: registros corrompidos com moeda inválida (`INVALID_CURRENCY`), valor negativo e datas mal formatadas.
- `licenses-valid.csv`: 5 assentos válidos (`github`, `openai`, `cursor`), custos e e-mails de usuários.
- `licenses-invalid.csv`: assentos sem usuário identificado, status inválido e custos negativos.

---

## 2. Testar Manualmente a Validação em Modo Dry Run (Sem Efeito Colateral no Banco)

O modo `dryRun` permite inspecionar um arquivo CSV antes de persistir no PostgreSQL.

Execute um comando direto no Node.js via PowerShell usando o motor do worker:

```powershell
npx tsx -e "
import { getPool } from './packages/database/src/index.js';
import { executeSync } from './apps/worker/src/index.js';
import fs from 'node:fs';

async function testDryRun() {
  const pool = getPool();
  const org = await pool.query('SELECT id FROM organizations LIMIT 1');
  const orgId = org.rows[0]?.id;
  if (!orgId) {
    console.log('Nenhuma organização encontrada. Crie uma ou execute npm test primeiro.');
    process.exit(1);
  }

  const csv = fs.readFileSync('./fixtures/csv/api-costs-valid.csv', 'utf8');
  const res = await executeSync(pool, {
    organizationId: orgId,
    provider: 'csv',
    dataset: 'api_costs',
    dryRun: true,
    connectorConfig: { csvContent: csv }
  });

  console.log('Resultado do Dry Run:');
  console.log({
    status: res.status,
    recordsProcessed: res.recordsProcessed,
    recordsCreated: res.recordsCreated,
    recordsFailed: res.recordsFailed
  });
  process.exit(0);
}
testDryRun();
"
```

### Resultado esperado:
```text
Resultado do Dry Run:
{ status: 'dry_run', recordsProcessed: 5, recordsCreated: 5, recordsFailed: 0 }
```

---

## 3. Testar a Ingestão Real e Idempotência Estrita

Execute o script de ingestão real duas vezes seguidas para verificar que nenhuma linha é duplicada:

```powershell
npx tsx -e "
import { getPool } from './packages/database/src/index.js';
import { executeSync } from './apps/worker/src/index.js';
import fs from 'node:fs';

async function testIdempotency() {
  const pool = getPool();
  const org = await pool.query('SELECT id FROM organizations LIMIT 1');
  const orgId = org.rows[0].id;
  const csv = fs.readFileSync('./fixtures/csv/api-costs-valid.csv', 'utf8');

  console.log('--- 1ª Execução (Inserção Inicial) ---');
  const run1 = await executeSync(pool, {
    organizationId: orgId,
    provider: 'csv',
    dataset: 'api_costs',
    connectorConfig: { csvContent: csv }
  });
  console.log({ status: run1.status, created: run1.recordsCreated, updated: run1.recordsUpdated });

  console.log('--- 2ª Execução (Reimportação Idêntica) ---');
  const run2 = await executeSync(pool, {
    organizationId: orgId,
    provider: 'csv',
    dataset: 'api_costs',
    connectorConfig: { csvContent: csv }
  });
  console.log({ status: run2.status, created: run2.recordsCreated, updated: run2.recordsUpdated });

  process.exit(0);
}
testIdempotency();
"
```

### Resultado esperado:
```text
--- 1ª Execução (Inserção Inicial) ---
{ status: 'completed', created: 5, updated: 0 }
--- 2ª Execução (Reimportação Idêntica) ---
{ status: 'completed', created: 0, updated: 5 }
```
*(Na 2ª execução, `created: 0` e `updated: 5`, provando a idempotência exata sem duplicatas).*

---

## 4. Consultar os Registros Persistidos Diretamente no PostgreSQL (`psql`)

Abra o terminal do PostgreSQL para auditar os dados gravados nas tabelas de proveniência e de custos:

```powershell
docker compose exec postgres psql -U app -d ai_spend -c "
SELECT provider, dataset, external_id, ingested_at
FROM source_records
ORDER BY ingested_at DESC LIMIT 5;
"
```

### Inspecionar os custos associados e valores reportados:
```powershell
docker compose exec postgres psql -U app -d ai_spend -c "
SELECT provider, model, cost_category, currency, amount
FROM cost_records
ORDER BY created_at DESC LIMIT 5;
"
```

- Verifique que `cost_category` está registrado como `'provider_reported'`.
- Verifique que os valores em `amount` utilizam representação decimal exata (`numeric(18,8)`).

### Conferir a trilha das execuções em `sync_runs`:
```powershell
docker compose exec postgres psql -U app -d ai_spend -c "
SELECT id, dataset, status, records_processed, records_created, records_updated, records_failed, started_at, finished_at
FROM sync_runs
ORDER BY started_at DESC LIMIT 3;
"
```

---

## 5. Testar Rejeição de CSV Inválido e Rastreamento de Erros por Linha

Execute a importação do arquivo inválido para conferir as mensagens estruturadas:

```powershell
npx tsx -e "
import { getPool } from './packages/database/src/index.js';
import { executeSync } from './apps/worker/src/index.js';
import fs from 'node:fs';

async function testInvalid() {
  const pool = getPool();
  const org = await pool.query('SELECT id FROM organizations LIMIT 1');
  const orgId = org.rows[0].id;
  const invalidCsv = fs.readFileSync('./fixtures/csv/api-costs-invalid.csv', 'utf8');

  const res = await executeSync(pool, {
    organizationId: orgId,
    provider: 'csv',
    dataset: 'api_costs',
    connectorConfig: { csvContent: invalidCsv }
  });

  console.log('Status da Execução:', res.status);
  console.log('Falhas registradas:', res.recordsFailed);
  console.log('Detalhes dos Erros:');
  res.errorDetails.forEach(e => console.log(' -> Linha ' + e.line + ' [' + e.code + ']: ' + e.message));
  process.exit(0);
}
testInvalid();
"
```

### Resultado esperado:
- `Status`: `failed` ou `partial`
- Mensagens de erro contendo o número da linha exata onde a moeda ou data inválida foi detectada.

---

## 6. Executar a Suíte Completa Automatizada do Épico 04

Para rodar todos os testes de integração do framework de conectores, idempotência e endpoint HTTP:

```powershell
npm test -- tests/integration/connectors-idempotency.test.ts
```

### O que esta suíte valida automaticamente:
1. **Cenário 1:** Ingestão de custos via CSV e validação estrita de idempotência (mesma soma financeira após repetição).
2. **Cenário 2:** Ingestão de licenças com mapeamento automático de identidades externas (`external_identities`) e contratos (`license_contracts`).
3. **Cenário 3:** Validação em modo `dryRun` assegurando zero inserções em `source_records` e `cost_records`.
4. **Cenário 4:** Erros estruturados em CSV inválido indicando linha e motivo.
5. **Cenário 5:** Simulação de falha no 2º lote e retomada com sucesso via checkpoint (`offset: 1`), sem duplicações.
6. **Cenário 6:** Validação do endpoint HTTP `POST /v1/organizations/:orgId/connectors/import-csv` com controle de acesso RBAC (`401` sem token, `403` para papel sem permissão e `200`/`201` para FinOps) e registro do evento em `audit_events`.
