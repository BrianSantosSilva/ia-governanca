# Guia de Teste Manual — Tarefas 6.1 a 6.4: Custos, Preços, Reconciliação e Orçamentos

- **Épico:** Épico 06 — Implementar Custos e Orçamento
- **Tarefas Relacionadas:**
  - [Tarefa 6.1 — Criar o Catálogo de Preços Versionado](../tarefa-6.1-criar-catalogo-precos.md)
  - [Tarefa 6.2 — Implementar o Motor de Cálculo de Custos](../tarefa-6.2-calcular-custos.md)
  - [Tarefa 6.3 — Separar as Categorias Financeiras e Reconciliação](../tarefa-6.3-separar-categorias-financeiras.md)
  - [Tarefa 6.4 — Implementar Políticas e Reservas Atômicas de Orçamento](../tarefa-6.4-implementar-politicas-orcamento.md)
- **Ambiente:** Windows (PowerShell na raiz `C:\Projetos\EstudoIA\ia-governanca`)

> [!WARNING]
> Este roteiro altera o banco e cria dados de teste. Use uma organização e projeto descartáveis. Não execute os testes de integração ao final contra um banco que contenha dados importantes: eles revertem todas as migrações antes de recriá-las.

---

## 1. Pré-requisitos

- PostgreSQL local em execução e `.env` configurado.
- Migrações aplicadas:

```powershell
npm run migrate:up
```

- Gateway e API em terminais separados:

```powershell
npm run dev:api
```

```powershell
npm run dev:gateway
```

- Ollama disponível em `http://localhost:11434` e modelo `llama3.2` instalado.
- Organização, projeto e chave virtual válidos criados conforme o [guia manual do Épico 05](../../epico-05-gateway-llm/testes-manuais/teste-manual-5.1-a-5.5-gateway-llm.md).
- Um token OIDC de `owner`, `admin` ou `finops` para a organização. O usuário `finops` pode gerenciar preços e orçamentos.

Configure os dados usados nos comandos abaixo. Substitua os valores de exemplo pelos IDs e credenciais do seu ambiente:

```powershell
$orgId = "<ORG_ID>"
$projectId = "<PROJECT_ID>"
$virtualKey = "<VIRTUAL_KEY>"
$oidcToken = "<OIDC_TOKEN>"
$api = "http://localhost:3001"
$gateway = "http://localhost:3002"
```

---

## 2. Cadastrar e consultar um preço versionado

Cadastre um preço específico da organização para `ollama/llama3.2`. O Ollama deve permanecer marcado como simulação/estimativa interna:

```powershell
$price = Invoke-RestMethod -Method Post `
  -Uri "$api/v1/organizations/$orgId/model-prices" `
  -Headers @{ Authorization = "Bearer $oidcToken" } `
  -ContentType "application/json" `
  -Body (@{
    provider = "ollama"
    model = "llama3.2"
    currency = "USD"
    inputPricePerMillion = "0.10000000"
    outputPricePerMillion = "0.20000000"
    priceSource = "internal_simulation"
    priceType = "internal_estimate"
    effectiveFrom = "2020-01-01T00:00:00Z"
  } | ConvertTo-Json)

$price
```

### Resultado esperado:

- HTTP `201`, com um `id` e os valores informados.
- `priceSource = internal_simulation` e `priceType = internal_estimate`.

Consulte o catálogo:

```powershell
Invoke-RestMethod -Uri "$api/v1/organizations/$orgId/model-prices" `
  -Headers @{ Authorization = "Bearer $oidcToken" } |
  ConvertTo-Json -Depth 5
```

Confirme também no banco:

```powershell
docker compose exec postgres psql -U app -d ai_spend -c "
SELECT provider, model, currency, input_price_per_million, output_price_per_million,
       price_source, price_type, effective_from, effective_to
FROM model_prices
WHERE organization_id = '$orgId'
ORDER BY effective_from DESC
LIMIT 5;
"
```

### Verificar validações do catálogo

Tente cadastrar um segundo preço do mesmo provedor, modelo, organização e tipo com período sobreposto. Espera-se HTTP `409` (`price_period_conflict`). Tente também classificar Ollama como `commercial_api_tariff`; espera-se HTTP `400`.

---

## 3. Fazer uma chamada e auditar o cálculo do custo

Faça uma inferência com identificador novo:

```powershell
$requestId = "epic6-manual-001"
Invoke-RestMethod -Method Post `
  -Uri "$gateway/v1/chat/completions" `
  -Headers @{
    Authorization = "Bearer $virtualKey"
    "X-Request-Id" = $requestId
  } `
  -ContentType "application/json" `
  -Body (@{
    model = "llama3.2"
    messages = @(@{ role = "user"; content = "Responda apenas: teste financeiro" })
    max_tokens = 20
    stream = $false
  } | ConvertTo-Json -Depth 5)
```

### Resultado esperado:

- HTTP `200` e contagens de tokens na resposta.
- Um evento `succeeded` em `usage_events`.
- Um custo ligado ao evento e à versão de preço usada, marcado como `gateway_estimated` e `is_simulated = true`.

Confira os dados:

```powershell
docker compose exec postgres psql -U app -d ai_spend -c "
SELECT ue.request_id, ue.status, ue.input_tokens, ue.output_tokens,
       cr.cost_category, cr.is_simulated, cr.currency, cr.amount, cr.model_price_id
FROM usage_events ue
JOIN cost_records cr
  ON cr.usage_event_id = ue.id AND cr.organization_id = ue.organization_id
WHERE ue.organization_id = '$orgId' AND ue.request_id = '$requestId';
"
```

O custo esperado segue `(tokens de entrada × preço de entrada + tokens de saída × preço de saída) / 1.000.000`; a coluna `amount` deve manter precisão decimal, sem arredondamento para centavos.

Repita uma chamada com outro `X-Request-Id` e confira que há um custo por evento. Reutilize um identificador já utilizado: espera-se HTTP `409` (`duplicate_request_id`).

---

## 4. Conferir categorias financeiras separadas

Consulte o resumo da organização:

```powershell
Invoke-RestMethod -Uri "$api/v1/organizations/$orgId/costs/summary" `
  -Headers @{ Authorization = "Bearer $oidcToken" } |
  ConvertTo-Json -Depth 5
```

Os resultados são agrupados por categoria, moeda e indicador de simulação. O custo do gateway deve aparecer como `gateway_estimated` simulado, não como custo reportado. Nenhum endpoint deve somar automaticamente essas duas categorias.

Também é possível consultar os registros diretamente:

```powershell
docker compose exec postgres psql -U app -d ai_spend -c "
SELECT cost_category, is_simulated, currency, SUM(amount) AS total, COUNT(*) AS registros
FROM cost_records
WHERE organization_id = '$orgId'
GROUP BY cost_category, is_simulated, currency
ORDER BY cost_category, currency;
"
```

### Registrar um ajuste financeiro auditado

```powershell
Invoke-RestMethod -Method Post `
  -Uri "$api/v1/organizations/$orgId/costs/adjustments" `
  -Headers @{ Authorization = "Bearer $oidcToken" } `
  -ContentType "application/json" `
  -Body (@{
    projectId = $projectId
    provider = "manual"
    currency = "USD"
    amount = "0.00000100"
    periodStart = (Get-Date).ToUniversalTime().ToString("o")
    periodEnd = (Get-Date).ToUniversalTime().ToString("o")
    reason = "Ajuste de validação do épico 6"
  } | ConvertTo-Json)
```

Espera-se HTTP `201`, categoria `financial_adjustment` e evento `financial_adjustment.created` em `audit_events`. O motivo deve estar na metadata de auditoria.

---

## 5. Reconciliar um custo reportado com o estimado

Escolha o custo de teste criado na seção 3. Insira um registro reportado com o mesmo projeto, provedor, modelo, moeda e período. O `amount` abaixo é de exemplo; altere-o para verificar igualdade ou divergência:

```powershell
docker compose exec postgres psql -U app -d ai_spend -c "
INSERT INTO cost_records (
  organization_id, project_id, provider, model, cost_category, is_simulated,
  currency, amount, period_start, period_end
)
SELECT organization_id, project_id, provider, model, 'provider_reported', FALSE,
       currency, amount, period_start, period_end
FROM cost_records
WHERE organization_id = '$orgId'
  AND cost_category = 'gateway_estimated'
  AND project_id = '$projectId'
ORDER BY created_at DESC
LIMIT 1
RETURNING id;
"
```

Copie o `id` retornado e solicite a reconciliação:

```powershell
$reportedCostId = "<REPORTED_COST_RECORD_ID>"
Invoke-RestMethod -Method Post `
  -Uri "$api/v1/organizations/$orgId/costs/$reportedCostId/reconcile" `
  -Headers @{ Authorization = "Bearer $oidcToken" }
```

### Resultado esperado:

- Se os valores forem iguais: `status = matched` e `deltaAmount = 0`.
- Se os valores forem diferentes: `status = divergent` e `deltaAmount` igual a reportado menos estimado.
- Sem custo estimado correspondente: `status = unreconciled`, com o item reportado preservado na categoria `unreconciled`.

Consulte a trilha:

```powershell
Invoke-RestMethod -Uri "$api/v1/organizations/$orgId/reconciliation-matches" `
  -Headers @{ Authorization = "Bearer $oidcToken" } |
  ConvertTo-Json -Depth 5
```

---

## 6. Validar políticas e bloqueio de orçamento no Gateway

Use uma organização/projeto/chave de teste sem políticas anteriores que interfiram. Crie uma política `block` com limite deliberadamente menor que o custo estimado da chamada:

```powershell
$start = (Get-Date).ToUniversalTime().AddMinutes(-5).ToString("o")
$end = (Get-Date).ToUniversalTime().AddHours(1).ToString("o")

$policy = Invoke-RestMethod -Method Post `
  -Uri "$api/v1/organizations/$orgId/budget-policies" `
  -Headers @{ Authorization = "Bearer $oidcToken" } `
  -ContentType "application/json" `
  -Body (@{
    scopeType = "organization"
    name = "Bloqueio manual épico 6"
    mode = "block"
    currency = "USD"
    limitAmount = "0.00000001"
    periodStart = $start
    periodEnd = $end
  } | ConvertTo-Json)
```

Faça uma nova chamada com um identificador distinto:

```powershell
Invoke-WebRequest -Method Post `
  -Uri "$gateway/v1/chat/completions" `
  -Headers @{
    Authorization = "Bearer $virtualKey"
    "X-Request-Id" = "epic6-budget-block-001"
  } `
  -ContentType "application/json" `
  -Body (@{
    model = "llama3.2"
    messages = @(@{ role = "user"; content = "Teste de bloqueio" })
    max_tokens = 20
    stream = $false
  } | ConvertTo-Json -Depth 5)
```

O PowerShell pode apresentar exceção para respostas HTTP não-2xx; nesse caso confira `Exception.Response.StatusCode`. O esperado é HTTP `429`, erro `budget_blocked`, e evento `blocked_budget` em `usage_events`. Não deve haver chamada ao Ollama para essa requisição.

Verifique a reserva e o evento:

```powershell
docker compose exec postgres psql -U app -d ai_spend -c "
SELECT bp.scope_type, bp.mode, bp.limit_amount, br.request_id, br.status, br.reserved_amount
FROM budget_policies bp
LEFT JOIN budget_reservations br
  ON br.budget_policy_id = bp.id AND br.organization_id = bp.organization_id
WHERE bp.organization_id = '$orgId'
ORDER BY bp.created_at DESC;

SELECT request_id, status, error_code
FROM usage_events
WHERE organization_id = '$orgId' AND request_id = 'epic6-budget-block-001';
"
```

Para validar os outros modos, edite a política pela rota `PATCH /v1/organizations/:orgId/budget-policies/:policyId` com `mode = observe` ou `mode = alert` e repita com novo `X-Request-Id`. `observe` deve permitir a chamada sem alerta; `alert` deve permitir e registrar `budget.threshold_reached` em `audit_events` quando o limiar configurado for atingido. O comportamento é igual para escopos `project` e `virtual_key`, selecionando o alvo correspondente ao criar a política.

---

## 7. Validar custo contratado de licenças (opcional)

Importe uma fixture de licenças válida por `POST /v1/organizations/:orgId/connectors/import-csv`, conforme o roteiro manual do Épico 04. Confira que as atribuições foram contabilizadas sem duplicação após reimportar:

```powershell
docker compose exec postgres psql -U app -d ai_spend -c "
SELECT la.id, la.status, la.seat_cost, la.currency,
       cr.cost_category, cr.amount, cr.period_start, cr.period_end
FROM license_assignments la
JOIN cost_records cr
  ON cr.license_assignment_id = la.id AND cr.organization_id = la.organization_id
WHERE la.organization_id = '$orgId'
ORDER BY la.created_at DESC
LIMIT 10;
"
```

Espera-se um custo `license_contracted` por atribuição importada, sem criar um segundo custo ao reimportar o mesmo CSV.

---

## 8. Testes automatizados relacionados (opcional)

Os testes automatizados verificam precisão decimal, integração do gateway, importação de licenças e concorrência. **Execute somente contra um banco descartável**, pois as suítes de integração revertem e recriam todas as migrações:

```powershell
npm test -- packages/finance/src/pricing.test.ts tests/integration/gateway-ollama.test.ts tests/integration/connectors-idempotency.test.ts tests/integration/budget-concurrency.test.ts
```

### Critério de conclusão do roteiro

- [ ] Preços são resolvidos por vigência e versões conflitantes são rejeitadas.
- [ ] Ollama aparece somente como simulação/estimativa interna.
- [ ] O custo estimado é decimal, rastreável ao evento e à versão do preço.
- [ ] Ajustes, custos reportados e licenças permanecem em categorias separadas.
- [ ] Reconciliação identifica correspondência, divergência e itens não reconciliados sem dupla contagem.
- [ ] Políticas `observe`, `alert` e `block` são aplicadas e a reserva impede ultrapassar o limite sob concorrência.
