# Guia de Teste Manual — Tarefas 7.1 a 7.3: Integrações Externas

- **Épico:** Épico 07 — Implementar Integrações Externas
- **Tarefas Relacionadas:**
  - [Tarefa 7.1 — Integração com API Oficial de Custos](../tarefa-7.1-integracao-api-oficial-custos.md)
  - [Tarefa 7.2 — Integração de Licenças e Assentos Corporativos](../tarefa-7.2-integracao-licencas.md)
  - [Tarefa 7.3 — Segundo Provedor de Inferência (Gemini)](../tarefa-7.3-segundo-provedor-inferencia-gemini.md)
- **Ambiente:** Windows (PowerShell na raiz `C:\Projetos\EstudoIA\ia-governanca`)

> [!WARNING]
> Use uma organização e um projeto descartáveis. Os testes de integração automatizados revertem todas as migrações; execute-os somente em um banco descartável. Chamadas às APIs OpenAI e GitHub exigem credenciais válidas e podem estar sujeitas a limites ou custos. Para Gemini, use exclusivamente conteúdo sintético ou não sensível e confira os termos aplicáveis antes de habilitar o provedor.

---

## 1. Pré-requisitos

- PostgreSQL local em execução, `.env` configurado e migrações aplicadas:

```powershell
npm run migrate:up
```

- API, Gateway e Worker disponíveis conforme o ambiente local.
- Token OIDC com permissão `connectors:manage` e `connectors:read`; para associação manual de identidade, use também um usuário com `members:manage`.
- Organização, projeto, usuário membro ativo e uma chave virtual de teste.
- Configure os valores de ambiente para as chamadas:

```powershell
$orgId = "<ORG_ID>"
$projectId = "<PROJECT_ID>"
$virtualKey = "<VIRTUAL_KEY>"
$oidcToken = "<OIDC_TOKEN>"
$api = "http://localhost:3001"
$gateway = "http://localhost:3002"
```

- Configure `CONNECTOR_CREDENTIALS_KEY` como uma chave hexadecimal de 64 caracteres (32 bytes) em `.env` antes de cadastrar conexões. Reinicie a API após alterar `.env`.

---

## 2. Cadastrar uma integração OpenAI e conferir a proteção da credencial

Leia a chave como entrada protegida. A credencial fica em memória apenas durante o teste e não deve ser impressa nem salva em histórico de comandos:

```powershell
$secureOpenAIKey = Read-Host "Chave administrativa OpenAI" -AsSecureString
$openAIKey = [System.Net.NetworkCredential]::new("", $secureOpenAIKey).Password
$openAIBody = @{
  provider = "openai"
  name = "OpenAI - teste manual"
  credentials = @{ apiKey = $openAIKey }
  configMetadata = @{}
} | ConvertTo-Json -Depth 5

$openAIConnection = Invoke-RestMethod -Method Post `
  -Uri "$api/v1/organizations/$orgId/provider-connections" `
  -Headers @{ Authorization = "******" } `
  -ContentType "application/json" `
  -Body $openAIBody
$openAIConnection
```

Resultado esperado: HTTP `201`, identificador da conexão e nenhum segredo no retorno. Consulte a listagem:

```powershell
Invoke-RestMethod -Uri "$api/v1/organizations/$orgId/provider-connections" `
  -Headers @{ Authorization = "******" } |
  ConvertTo-Json -Depth 5
```

Confirme que `encrypted_credentials` e a chave OpenAI não aparecem na resposta.

Sincronize um período autorizado:

```powershell
$openAISync = Invoke-RestMethod -Method Post `
  -Uri "$api/v1/organizations/$orgId/provider-connections/$($openAIConnection.id)/sync" `
  -Headers @{ Authorization = "******" } `
  -ContentType "application/json" `
  -Body (@{
    dataset = "api_costs"
    periodStart = "2026-10-01T00:00:00Z"
    periodEnd = "2026-11-01T00:00:00Z"
  } | ConvertTo-Json)
$openAISync
```

Resultado esperado: execução com estado e contagens, sem duplicação após repetir o mesmo período. Verifique a data da última tentativa e as execuções:

```powershell
Invoke-RestMethod -Uri "$api/v1/organizations/$orgId/provider-connections" `
  -Headers @{ Authorization = "******" } |
  ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri "$api/v1/organizations/$orgId/connectors/sync-runs" `
  -Headers @{ Authorization = "******" } |
  ConvertTo-Json -Depth 5
```

Os registros importados devem preservar provedor, identificador externo e período de origem. Consulte `/v1/organizations/$orgId/reconciliation-matches` e confirme que custos reportados sem par estimado continuam visíveis como não reconciliados.

---

## 3. Sincronizar assentos GitHub Copilot e revisar identidades

Informe um token com acesso administrativo aos assentos Copilot da organização GitHub:

```powershell
$secureGitHubToken = Read-Host "Token GitHub com acesso aos assentos Copilot" -AsSecureString
$gitHubToken = [System.Net.NetworkCredential]::new("", $secureGitHubToken).Password
$gitHubBody = @{
  provider = "github-copilot"
  name = "GitHub Copilot - teste manual"
  credentials = @{ token = $gitHubToken }
  configMetadata = @{ organization = "<GITHUB_ORG>" }
} | ConvertTo-Json -Depth 5

$gitHubConnection = Invoke-RestMethod -Method Post `
  -Uri "$api/v1/organizations/$orgId/provider-connections" `
  -Headers @{ Authorization = "******" } `
  -ContentType "application/json" `
  -Body $gitHubBody
```

Sincronize os assentos:

```powershell
$seatSync = Invoke-RestMethod -Method Post `
  -Uri "$api/v1/organizations/$orgId/provider-connections/$($gitHubConnection.id)/sync" `
  -Headers @{ Authorization = "******" } `
  -ContentType "application/json" `
  -Body (@{
    dataset = "license_assignments"
    periodStart = "2026-10-01T00:00:00Z"
    periodEnd = "2026-11-01T00:00:00Z"
  } | ConvertTo-Json)
$seatSync
```

Repita a sincronização e confirme que não são criadas atribuições duplicadas. O e-mail corporativo só deve associar automaticamente uma identidade quando houver correspondência exata com um membro ativo. Identidades sem essa correspondência devem ficar pendentes:

```powershell
$pending = Invoke-RestMethod `
  -Uri "$api/v1/organizations/$orgId/external-identities/pending-review" `
  -Headers @{ Authorization = "******" }
$pending | ConvertTo-Json -Depth 6
```

Para validar a associação manual, escolha um `id` retornado e o `userId` de um membro ativo da mesma organização:

```powershell
$identityId = "<EXTERNAL_IDENTITY_ID>"
$userId = "<ACTIVE_MEMBER_USER_ID>"
Invoke-RestMethod -Method Post `
  -Uri "$api/v1/organizations/$orgId/external-identities/$identityId/match" `
  -Headers @{ Authorization = "******" } `
  -ContentType "application/json" `
  -Body (@{ userId = $userId } | ConvertTo-Json)
```

Resultado esperado: `matchStatus = matched`, atribuições atualizadas e evento `external_identity.matched` na auditoria. A API GitHub não informa necessariamente preço contratado; quando preço ou moeda estiverem ausentes, o sistema não deve inventar custo de licença.

---

## 4. Validar o roteamento Gemini sem enviar dados sensíveis

Por padrão, Gemini deve permanecer desabilitado. Com `LLM_EXTERNAL_PROVIDERS_ENABLED=false` (ou sem configuração), uma chave virtual sem acesso ao Ollama que solicitar `gemini-2.0-flash` deve receber HTTP `503` com `provider_unavailable`.

Para habilitar o teste opcional, configure localmente `LLM_EXTERNAL_PROVIDERS_ENABLED=true` e `GEMINI_API_KEY`, reinicie o Gateway e confirme que a chave virtual permite o provedor `gemini` e o modelo `gemini-2.0-flash`. Não compartilhe nem registre a chave em logs ou neste roteiro. Use apenas uma mensagem sintética:

```powershell
$requestId = "epic7-gemini-manual-001"
Invoke-RestMethod -Method Post `
  -Uri "$gateway/v1/chat/completions" `
  -Headers @{
    Authorization = "******"
    "X-Request-Id" = $requestId
  } `
  -ContentType "application/json" `
  -Body (@{
    model = "gemini-2.0-flash"
    messages = @(@{ role = "user"; content = "Responda apenas: teste sintético" })
    max_tokens = 20
    stream = $false
  } | ConvertTo-Json -Depth 5)
```

Quando habilitado e com credenciais válidas, espera-se HTTP `200` e métricas de tokens. Confira que o `usage_events.provider` é `gemini` e que `cost_records` só é criado quando existe preço aplicável no catálogo do Épico 06. Desabilite a flag e reinicie o Gateway para confirmar que o uso local/Ollama continua independente da integração externa.

---

## 5. Testes automatizados relacionados (opcional)

Os testes de integração revertem e recriam as migrações. **Execute somente contra um banco descartável**:

```powershell
npm test -- tests/unit/external-integrations.test.ts tests/integration/external-integrations.test.ts tests/integration/connectors-idempotency.test.ts tests/integration/gateway-ollama.test.ts
```

### Critérios de conclusão do roteiro

- [ ] Segredos de integrações não são retornados pela API e ficam cifrados em repouso.
- [ ] Sincronizações OpenAI/GitHub preservam origem e período, registram execução e podem ser repetidas sem duplicação.
- [ ] Identidades sem correspondência exata ficam pendentes; associação manual exige membro ativo e gera auditoria.
- [ ] Ausência de preço de assento não gera custo inventado.
- [ ] Gemini permanece desabilitado por padrão e, quando habilitado, registra provedor, tokens e custo conforme o catálogo vigente.
- [ ] A operação local/Ollama não depende de credenciais nem chamadas externas.
