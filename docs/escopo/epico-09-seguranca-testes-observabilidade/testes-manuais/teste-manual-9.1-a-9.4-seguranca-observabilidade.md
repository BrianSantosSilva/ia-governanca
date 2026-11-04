# Guia de Teste Manual — Tarefas 9.1 a 9.4: Segurança, Observabilidade e Recuperação

- **Épico:** Épico 09 — Segurança, Testes e Observabilidade
- **Tarefas Relacionadas:**
  - [Tarefa 9.1 — Segurança e Proteção de Dados](../tarefa-9.1-seguranca-e-protecao-dados.md)
  - [Tarefa 9.2 — Logs Estruturados e Métricas](../tarefa-9.2-observabilidade-logs-metricas.md)
  - [Tarefa 9.3 — Testes Automatizados e E2E](../tarefa-9.3-testes-automatizados-e2e.md)
  - [Tarefa 9.4 — Recuperação, Resiliência e Backup](../tarefa-9.4-recuperacao-e-resiliencia.md)
- **Ambiente:** Windows (PowerShell na raiz `C:\Projetos\EstudoIA\ia-governanca`)

> [!CAUTION]
> Execute migrações e testes destrutivos somente em bancos descartáveis. Não interrompa PostgreSQL, restaure dump ou altere limites em ambiente compartilhado/produção sem autorização. Nunca cole tokens, chaves ou prompts em evidências de teste.

---

## 1. Subir os serviços e validar saúde

Configure `.env`, instale dependências e inicie os serviços:

```powershell
Copy-Item .env.example .env
npm install
docker compose up -d postgres keycloak
npm run migrate:up
```

Inicie API, Gateway, worker e Web em quatro terminais:

```powershell
npm run dev:api
npm run dev:gateway
npm run dev:worker
npm run dev:web
```

Confirme o status saudável e a disponibilidade dos endpoints de métricas:

```powershell
Invoke-RestMethod http://localhost:3001/health
Invoke-RestMethod http://localhost:3002/health
Invoke-RestMethod http://localhost:3003/health
Invoke-WebRequest http://localhost:3001/metrics
Invoke-WebRequest http://localhost:3002/metrics
Invoke-WebRequest http://localhost:3003/metrics
```

API, Gateway e worker devem responder com saúde do PostgreSQL. Os endpoints de métricas retornam texto Prometheus; verifique contadores e histogramas depois de executar chamadas e sincronizações. Restrinja esses endpoints à rede operacional.

---

## 2. Validar proteção de dados e limitação de requisições

Inspecione os logs JSON do terminal API/Gateway ao realizar uma chamada autenticada, uma chamada inválida e uma chamada de inferência. Confirme que cada entrada operacional inclui `request_id`, `organization_id`, `project_id`, `provider`, `status`, `duration_ms` e `error_code` quando aplicável. O token Authorization, credenciais, mensagens/prompt e segredos não podem aparecer.

Para validar 429 somente no ambiente local, configure limites temporariamente baixos no `.env` e reinicie os serviços:

```text
API_RATE_LIMIT_MAX=2
GATEWAY_RATE_LIMIT_MAX=2
```

Envie três chamadas seguidas ao mesmo endpoint local, por exemplo `GET /v1/me` sem token na API e `POST /v1/chat/completions` no Gateway. As chamadas iniciais devem alcançar o fluxo normal (por exemplo, 401 sem credencial); a chamada excedente deve retornar 429. O Gateway também mantém a limitação por chave virtual. Restaure os valores padrão `120` depois do teste.

Confirme que operações de criação/revogação continuam registrando auditoria e que chaves virtuais e credenciais de conectores permanecem armazenadas apenas em hash/forma criptografada, nunca em texto puro.

---

## 3. Executar testes automatizados

Use um PostgreSQL descartável: os testes de integração reconstroem o schema.

```powershell
docker compose exec -T postgres createdb -U app ai_spend_epic9_test
$env:DATABASE_URL = "postgres://app:app_dev_password@localhost:5432/ai_spend_epic9_test"
npm run build
npm test
Remove-Item Env:DATABASE_URL
```

O caso E2E automatizado cria organização, projeto e chave, executa uma inferência pelo Gateway, confere ledger/custo/dashboard, aplica orçamento bloqueante e verifica a tentativa bloqueada. Usa adaptador LLM determinístico para não depender de serviços externos. Após conferir que o banco criado é descartável:

```powershell
docker compose exec -T postgres dropdb -U app ai_spend_epic9_test
```

---

## 4. Recuperar uma sincronização interrompida

Com uma conta autorizada a gerenciar conectores, faça uma requisição autenticada à rota:

```text
POST /v1/organizations/<ORG_ID>/connectors/sync-runs/recover
```

O endpoint identifica execuções com status `running` há mais de cinco minutos, marca-as como `failed` com erro auditável `WORKER_INTERRUPTED` e preserva o último `checkpoint`. Confirme o estado e o checkpoint no histórico de sincronizações antes de solicitar nova sincronização. A execução repetida usa os identificadores externos/idempotência do conector para não duplicar registros. Não invoque essa recuperação enquanto houver um worker ativo processando há mais de cinco minutos.

---

## 5. Validar política de retenção

`DATA_RETENTION_DAYS` define o prazo de retenção de eventos de auditoria; o valor padrão é 3650 dias. Execute a limpeza explicitamente e leia o resumo JSON:

```powershell
npm run retention:prune
```

Registros financeiros (`usage_events` e `cost_records`) não são removidos por essa rotina. Ajuste o prazo apenas com aprovação de compliance.

---

## 6. Validar backup e restauração sem sobrescrever dados

Gere um dump custom-format:

```powershell
.\scripts\backup-postgres.ps1
```

Crie um banco vazio dedicado e restaure nele:

```powershell
docker compose exec -T postgres createdb -U app ai_spend_epic9_restore
.\scripts\restore-postgres.ps1 -Path .\backups\<arquivo>.dump -Database ai_spend_epic9_restore
```

Compare pelo menos o número de `usage_events`, `cost_records` e `sync_runs` com a origem. O script de restauração recusa bancos que já tenham tabelas e não remove objetos existentes. Depois da validação, elimine somente o banco descartável de restauração:

```powershell
docker compose exec -T postgres dropdb -U app ai_spend_epic9_restore
```

### Critérios de conclusão do roteiro

- [ ] Saúde e métricas respondem nos três serviços.
- [ ] Logs não contêm token, chave, credencial nem prompt; rate limit excedido retorna HTTP 429.
- [ ] Testes unitários, segurança, integração e E2E passam com banco descartável.
- [ ] Sincronização interrompida é identificada, marcada como falha e mantém checkpoint para retomada.
- [ ] Backup pode ser restaurado em banco vazio e os totais financeiros permanecem íntegros.
