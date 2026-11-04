# Guia de Teste Manual — Tarefas 5.1 a 5.5: Gateway LLM, Chaves Virtuais e Ledger de Uso

- **Épico:** Épico 05 — Implementar o Gateway LLM
- **Tarefas Relacionadas:**
  - [Tarefa 5.1 — Definir a API de Inferência](../tarefa-5.1-definir-api-inferencia.md)
  - [Tarefa 5.2 — Implementar o Adaptador Ollama](../tarefa-5.2-implementar-adaptador-ollama.md)
  - [Tarefa 5.3 — Criar Gestão e Validação de Chaves Virtuais](../tarefa-5.3-criar-chaves-virtuais.md)
  - [Tarefa 5.4 — Registrar os Eventos de Uso no Ledger](../tarefa-5.4-registrar-eventos-uso.md)
  - [Tarefa 5.5 — Criar Teste de Integração Ponta a Ponta do Gateway](../tarefa-5.5-teste-integracao-gateway.md)
- **Ambiente:** Windows (PowerShell na raiz `C:\Projetos\EstudoIA\ia-governanca`)

---

## 1. Pré-requisitos

- PostgreSQL no ar (`docker compose up -d postgres`)
- Ollama local respondendo em `http://localhost:11434` com o modelo `llama3.2` (`ollama pull llama3.2`)
- Variáveis de `.env` preenchidas a partir de `.env.example`

```powershell
npm test -- tests/unit/virtual-keys-and-adapter.test.ts tests/integration/gateway-ollama.test.ts
```

---

## 2. Inspecionar a documentação OpenAPI do Gateway

Com o gateway em execução:

```powershell
npm run dev:gateway
```

Abra `http://localhost:3002/docs` e confirme o endpoint `POST /v1/chat/completions`, ou:

```powershell
curl http://localhost:3002/docs/json
```

---

## 3. Criar uma chave virtual (segredo exibido uma única vez)

Este passo assume um token OIDC válido de um usuário `owner`, `admin` ou `developer` e um `projectId` existente.

```powershell
curl -X POST http://localhost:3001/v1/organizations/<ORG_ID>/virtual-keys `
  -H "Authorization: Bearer <OIDC_TOKEN>" `
  -H "Content-Type: application/json" `
  -d '{
    "name": "chave-manual",
    "projectId": "<PROJECT_ID>",
    "allowedProviders": ["ollama"],
    "allowedModels": ["llama3.2"],
    "scopes": ["chat:completions"]
  }'
```

### Resultado esperado:
- HTTP `201`
- Campo `api_key` no formato `aisp_live_<prefixo>_<segredo>`
- Campo `key_prefix` visível
- **Ausência** de `key_hash`

Confirme no PostgreSQL que somente o hash foi persistido:

```powershell
docker compose exec postgres psql -U app -d ai_spend -c "
SELECT key_prefix, length(key_hash) AS hash_len, key_hash = '' AS vazio
FROM virtual_keys
ORDER BY created_at DESC
LIMIT 1;
"
```

- `hash_len` deve ser `64`
- A coluna de segredo em texto puro não existe no schema

---

## 4. Chamada real de inferência pelo Gateway

Substitua `<VIRTUAL_KEY>` pela `api_key` retornada na criação:

```powershell
curl http://localhost:3002/v1/chat/completions `
  -H "Authorization: Bearer <VIRTUAL_KEY>" `
  -H "Content-Type: application/json" `
  -H "X-Request-Id: req-manual-001" `
  -d '{
    "model": "llama3.2",
    "messages": [
      { "role": "user", "content": "Responda apenas: ambiente local funcionando" }
    ],
    "stream": false
  }'
```

### Resultado esperado:
- HTTP `200`
- Header `X-Request-Id: req-manual-001`
- `choices[0].message.content` preenchido
- `usage.prompt_tokens`, `usage.completion_tokens` e `usage.total_tokens` presentes

---

## 5. Conferir o ledger em `usage_events`

```powershell
docker compose exec postgres psql -U app -d ai_spend -c "
SELECT request_id, provider, model, input_tokens, output_tokens, duration_ms, status, attempt_number
FROM usage_events
WHERE request_id = 'req-manual-001';
"
```

### Resultado esperado:
- `status = succeeded`
- `provider = ollama`
- `model = llama3.2`
- tokens e `duration_ms` reais (não inventados)
- nenhum texto de prompt/resposta persistido na tabela

---

## 6. Consultar o consumo pela API administrativa (isolamento de tenant)

```powershell
curl "http://localhost:3001/v1/organizations/<ORG_ID>/usage-events?projectId=<PROJECT_ID>" `
  -H "Authorization: Bearer <OIDC_TOKEN>"
```

### Resultado esperado:
- HTTP `200` com o evento `req-manual-001`
- Requisição para outra organização deve retornar `403 forbidden_tenant`

---

## 7. Bloqueio de chave revogada

```powershell
curl -X POST http://localhost:3001/v1/organizations/<ORG_ID>/virtual-keys/<KEY_ID>/revoke `
  -H "Authorization: Bearer <OIDC_TOKEN>"
```

Repita a chamada de inferência da seção 4.

### Resultado esperado:
- HTTP `403` com `error: policy_blocked` e `reason: revoked`
- Novo registro em `usage_events` com `status = blocked_policy`

---

## 8. Payload inválido e chave ausente

```powershell
curl http://localhost:3002/v1/chat/completions `
  -H "Content-Type: application/json" `
  -d '{ "model": "", "messages": [] }'
```

- Esperado: HTTP `400`

```powershell
curl http://localhost:3002/v1/chat/completions `
  -H "Content-Type: application/json" `
  -d '{ "model": "llama3.2", "messages": [{ "role": "user", "content": "oi" }] }'
```

- Esperado: HTTP `401`
