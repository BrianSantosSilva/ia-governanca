# Tarefa 11.4 — Integrar o GitHub Copilot CLI como Cliente BYOK do Gateway

- **Épico:** Épico 11 — Compatibilidade do Gateway com Clientes Agentes
- **Fase:** Evolução funcional após a validação da POC
- **Dependências:** Tarefas 11.1, 11.2 e 11.3
- **Módulos Afetados:** `apps/gateway`, `docs/`, `tests/`

## 1. Contexto e Objetivo

O Copilot CLI permite configurar um provedor próprio (BYOK) em `providers.json`, com `baseUrl`, chave e modelos. O Gateway pode atuar como esse provedor, governando e registrando as chamadas aos modelos configurados.

## 2. Regras e Limites

1. O CLI usa um provedor `openai` com `baseUrl` apontando para o Gateway e chave virtual própria, de escopo restrito. Modelos são expostos por `id` e, quando necessário, `wireModel`/`modelId`.
2. O endpoint precisa suportar streaming e tool calling; `maxPromptTokens` e `maxOutputTokens` do modelo no `providers.json` devem refletir os limites reais.
3. O Gateway pode governar somente os modelos configurados como BYOK. Chamadas feitas aos modelos hospedados pelo GitHub Copilot não passam pelo Gateway; isso deve estar explícito na documentação.
4. O `providers.json` armazena a chave em texto simples; o guia orienta mantê-lo privado, fora de repositórios, e usar chaves revogáveis com orçamento.
5. Se o CLI exigir endpoints adicionais (por exemplo, listagem de modelos), a necessidade é verificada e documentada; endpoints só são implementados quando confirmados em teste real.
6. Compatibilidade com outros clientes OpenAI não é garantida por esta tarefa.

## 3. Atividades Passo a Passo

- [x] Verificar, com teste real, os requisitos de requisição e resposta do CLI e registrar lacunas.
- [x] Documentar a configuração do `providers.json` para o Gateway e a seleção por `copilot --model <provedor>/<modelo>`.
- [x] Criar a chave virtual de teste com modelo, orçamento e escopo mínimos.
- [x] Executar uma tarefa real do CLI com leitura de arquivo e execução de ferramenta passando pelo Gateway.
- [ ] Validar uso, custo, origem e guardrails no dashboard.
- [x] Documentar limitações conhecidas e política de uso recomendada.

## 4. Critérios de Conclusão

- [x] O CLI conclui um ciclo com ferramentas usando um modelo servido pelo Gateway.
- [x] A chamada aparece no ledger com tokens, custo e origem.
- [x] Orçamento e revogação da chave bloqueiam novas chamadas.
- [x] A documentação explica claramente o que o Gateway governa e o que não governa.

## 5. Guia de configuração

`~/.copilot/providers.json` (mantenha privado, fora de repositórios):

```json
{
  "providers": {
    "gateway": {
      "type": "openai",
      "baseUrl": "http://localhost:3000/v1",
      "apiKey": "<chave virtual de escopo restrito>",
      "models": [{ "id": "Phi-4-mini-instruct", "maxPromptTokens": 32000, "maxOutputTokens": 4096 }]
    }
  }
}
```

Uso: `copilot --model gateway/Phi-4-mini-instruct`. O `id` deve coincidir com o nome usado pelo Gateway para escolher o provedor (deployment do Foundry ou modelo Ollama).

**Limitações:** o formato exato do `providers.json` deve ser conferido na documentação do CLI instalado; Gemini não suporta ferramentas; modelos hospedados pelo GitHub Copilot **não** passam pelo Gateway; origem do cliente no ledger está pendente (11.3). Política: usar chave dedicada, orçamento baixo e revogável.

## 6. Resultado do teste real (Copilot CLI 1.0.105, 04/11/2026)

**Configuração real:** o CLI 1.0.105 configura BYOK por **variáveis de ambiente**, não por `providers.json` (corrige a seção 5): `COPILOT_PROVIDER_BASE_URL=http://localhost:3002/v1`, `COPILOT_PROVIDER_TYPE=openai`, `COPILOT_PROVIDER_API_KEY`, `COPILOT_MODEL`, `COPILOT_PROVIDER_MAX_PROMPT_TOKENS` e `COPILOT_PROVIDER_MAX_OUTPUT_TOKENS`. `COPILOT_PROVIDER_HEADERS='X-Client-Origin: copilot-cli'` envia a origem ao Gateway. Com `maxPromptTokens` de 8000 o CLI recusa (contexto estático excede o limite); 128000 funcionou.

**Validado:** o CLI autentica com a chave virtual e completa requisições no Gateway; o ledger registra tokens e `client_origin=copilot-cli`. Chamada direta com `tools` ao Ollama (llama3.2) devolveu `tool_calls` estruturado.

**Ciclo real com ferramenta concluído (Foundry `gpt-4.1-mini`, deployment com 100 mil TPM/100 RPM):** o CLI leu um arquivo com a ferramenta `view` e respondeu o conteúdo correto via Gateway (3 s, ~25 mil tokens de entrada). O ledger registrou 2 chamadas `succeeded`, `client_origin=copilot-cli`, custo `gateway_estimated` (~USD 0,005 por chamada). Após revogar a chave, a chamada seguinte retornou `403 policy_blocked` (`revoked`). Suíte completa: 83 testes passando.

**Ajustes necessários para o CLI:** o CLI envia ferramentas `type: "custom"` (`apply_patch`, gramática lark) que Foundry/Ollama não suportam; o contrato aceita e **descarta** essas ferramentas (e o `tool_choice` que apontar para elas) antes do provedor. O modelo usa as demais ferramentas de edição.

**Orçamento:** com a chave `dev00006` (política `block`, limite USD 0,0002), uma requisição grande retornou `429 budget_blocked`, e uma chave sem limite continuou funcionando (testado por `curl`; o CLI usa o mesmo endpoint). **Ollama:** `qwen2.5:7b` chamou ferramenta corretamente em CPU pura (`OLLAMA_NUM_GPU=0`, `OLLAMA_NUM_CTX=32768`), ~193 s para um prompt de ~14,5 mil tokens; o ciclo completo do CLI com Ollama ainda não foi executado. **Ambiente de teste:** `npx tsx scripts/reset-db.ts --yes` recria o banco com chaves e preços fictícios fixos.

**Pendências:** ciclo do CLI com Ollama; validação visual no dashboard; preço do `gpt-4.1-mini` em `model_prices` é **estimado** (USD 0,40/1,60 por milhão) e deve ser confirmado; ciclo de edição/execução mais longo não testado. Os resultados abaixo (Phi-4-mini e llama3.2) são do teste anterior.

**Não validado / limitações encontradas (Phi-4-mini e llama3.2):**
- Ciclo com ferramenta **não concluído** nesses dois modelos. O CLI envia por chamada cerca de 87 KB (39 ferramentas, ~22 mil tokens); com `--disable-builtin-mcps`, ~60 KB (21 ferramentas, ~15 mil tokens).
- **Foundry/Phi-4-mini-instruct (deployment atual):**
  - Cota do deployment: **20 requisições/min e 20 mil tokens/min** (cabeçalhos `x-ratelimit-*`). O prompt padrão do CLI excede a cota e gera 429 (`AZURE_OPENAI_RATE_LIMIT`); prompts de ~7,5 mil tokens passam e de ~20 mil tokens retornam 429. Mesmo com ~15 mil tokens, só cabe uma chamada por minuto.
  - Em modo stream, o Foundry **não emite `tool_calls` nem `finish_reason`** (só o uso e `[DONE]`). Correção feita: o adaptador atende pedidos com `tools` e `stream` por uma chamada única (sem stream) e emite o resultado como SSE.
  - Em chamada direta curta com uma ferramenta, o modelo devolveu `tool_calls` estruturado (às vezes com o `name` errado, usando a descrição) e em outra tentativa devolveu texto `functools[...]`. Com o prompt real do CLI, gerou texto degenerado. Conclusão: o Phi-4-mini não é adequado para o CLI; seria preciso outro modelo (com tool calling confirmado) e maior cota de TPM.
- **Ollama/llama3.2 (3B):** recusou a tarefa e, em outro prompt, respondeu sem chamar a ferramenta; o `num_ctx` padrão (4096) trunca o prompt do CLI (~2 mil tokens vistos no ledger contra 15–22 mil enviados). Precisa de modelo maior e `num_ctx` ampliado.
- Orçamento e revogação da chave pelo CLI não foram testados. As chaves de teste foram revogadas.