# Tarefa 11.2 — Repassar Ferramentas nos Adaptadores e no Streaming

- **Épico:** Épico 11 — Compatibilidade do Gateway com Clientes Agentes
- **Fase:** Evolução funcional após a validação da POC
- **Dependências:** Tarefa 11.1 e tarefa 10.6
- **Módulos Afetados:** `apps/gateway/src/adapters`, `apps/gateway`, `tests/`

## 1. Contexto e Objetivo

Os adaptadores atuais tratam apenas texto. Para que o Copilot CLI funcione, `tools` deve chegar ao provedor e as chamadas de ferramenta devem voltar ao cliente, tanto em JSON quanto em SSE.

## 2. Regras

1. O adaptador Foundry/Azure OpenAI repassa `tools`, `tool_choice`, `tool_calls` e mensagens `tool` no formato Chat Completions, mantendo erros sem vazar chaves.
2. O adaptador Ollama traduz o formato quando o modelo oferecer suporte e declara quando não oferecer; resultados de ferramenta e `tool_calls` não podem ser descartados.
3. O adaptador Gemini só é incluído se houver tradução completa de `functionCall`/`functionResponse`; caso contrário, recusa `tools` explicitamente. Essa decisão é documentada.
4. No streaming, deltas `delta.tool_calls` (índice, `id`, nome e fragmentos de `arguments`) são repassados na ordem recebida, com `finish_reason: "tool_calls"` quando aplicável.
5. Argumentos fragmentados são preservados sem alteração; o Gateway não reconstrói nem executa ferramentas.
6. Uso de tokens continua reconciliado no ledger; quando indisponível, não são inventados valores.
7. Cancelamento do cliente e timeout continuam cancelando a chamada ao provedor.

## 3. Atividades Passo a Passo

- [x] Implementar passagem de ferramentas no adaptador Foundry/Azure OpenAI.
- [x] Implementar tradução e declaração de capacidade no Ollama.
- [x] Decidir e documentar o suporte do Gemini.
- [x] Repassar deltas de `tool_calls` no SSE e tratar `finish_reason`.
- [ ] Criar testes com respostas simuladas de ferramenta, argumentos fragmentados e falha no meio do stream.

## 4. Critérios de Conclusão

- [ ] Um ciclo completo (requisição com `tools` → `tool_calls` → mensagem `tool` → resposta final) funciona no Foundry, em modo JSON e SSE.
- [ ] Argumentos fragmentados chegam ao cliente completos e na ordem original.
- [x] Provedores sem suporte recusam `tools` antes da chamada.
- [ ] Ledger, custo e reservas permanecem corretos nas chamadas com ferramentas.

## 5. Status da implementação

- Foundry/Azure OpenAI e Ollama declaram `supportsTools` e repassam `tools`/`tool_choice`; o Ollama traduz o histórico (`arguments` string↔objeto, `tool_name`) e gera `id` `call_<uuid>`.
- Gemini **não** suporta ferramentas nesta versão: sem `supportsTools`, o Gateway responde 400 `tools_not_supported` antes da chamada.
- Cobertos por testes unitários (JSON, SSE com argumentos fragmentados, tradução Ollama). **Não validado:** ciclo completo contra Foundry/Ollama reais e falha no meio do stream com ferramentas. Integração com adaptador simulado (JSON, SSE, recusa sem suporte) passa.


