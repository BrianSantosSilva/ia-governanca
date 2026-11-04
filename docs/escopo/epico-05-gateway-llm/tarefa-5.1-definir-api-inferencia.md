# Tarefa 5.1 — Definir a API de Inferência (`POST /v1/chat/completions`)

- **Épico:** Épico 05 — Implementar o Gateway LLM
- **Fase:** 5 (Gateway LLM Local)
- **Dependências:** [Tarefa 0.2](../epico-00-pre-requisitos/tarefa-0.2-validacao-llm-local-ollama.md), [Tarefa 2.4](../epico-02-dominio-e-banco-de-dados/tarefa-2.4-gateway-e-financas.md)
- **Módulos Afetados:** `apps/gateway`, `packages/contracts`
- **Guia de Teste Manual:** [teste-manual-5.1-a-5.5-gateway-llm.md](./testes-manuais/teste-manual-5.1-a-5.5-gateway-llm.md)

## 1. Objetivo
Definir o contrato e o endpoint HTTP principal do Gateway LLM para recebimento de chamadas de chat das aplicações clientes, autenticação por chave virtual e roteamento para o adaptador do provedor.

## 2. Especificação do Endpoint
- **Rota:** `POST /v1/chat/completions`
- **Compatibilidade de Formato:** Compatível com o payload básico da API de Chat Completions da OpenAI (`model`, `messages`, `temperature`, `max_tokens`, `stream: false`) para facilitar a integração futura de SDKs padrão.
- **Cabeçalhos:**
  - `Authorization: Bearer <virtual_key>`
  - `X-Request-Id` (opcional na entrada; gerado pelo gateway se ausente e sempre retornado no header de resposta).

> [!NOTE]
> A compatibilidade de formato na borda do gateway não significa que todos os provedores tenham comportamento idêntico; a interface de adaptadores internos deve tratar as diferenças específicas de cada provedor.

## 3. Atividades Passo a Passo
- [x] Definir os schemas Zod de request e response de `POST /v1/chat/completions` em `packages/contracts`.
- [x] Definir a interface interna `LLMProviderAdapter` para desacoplar o endpoint HTTP dos provedores específicos (Ollama, Gemini, etc.).
- [x] Configurar o servidor Fastify em `apps/gateway` com documentação OpenAPI e geração/propagação de `request_id`.
- [x] Implementar o pipeline do endpoint: validação de payload → autenticação de chave virtual → verificação de políticas/orçamento → chamada ao adaptador → registro no ledger → retorno ao cliente.

## 4. Critérios de Conclusão
- [x] Endpoint `POST /v1/chat/completions` registrado e documentado via OpenAPI em `apps/gateway`.
- [x] Payloads inválidos são rejeitados com `400 Bad Request` estruturado.
- [x] Interface `LLMProviderAdapter` pronta para receber implementações de provedores.
