# Tarefa 11.1 — Estender o Contrato do Gateway para Chamada de Ferramentas

- **Épico:** Épico 11 — Compatibilidade do Gateway com Clientes Agentes
- **Fase:** Evolução funcional após a validação da POC
- **Dependências:** Épico 05 (API de inferência), tarefa 10.6 (streaming SSE)
- **Módulos Afetados:** `apps/gateway`, `packages/contracts`, `tests/`

## 1. Contexto e Objetivo

O Gateway aceita apenas mensagens com papéis `system`, `user` e `assistant`, sem `tools`, `tool_calls`, `tool_call_id` nem o papel `tool`. Clientes agentes, como o GitHub Copilot CLI configurado como provedor BYOK, exigem esse protocolo para ler arquivos, executar comandos e continuar a conversa com os resultados.

Esta tarefa estende o contrato de `POST /v1/chat/completions`, mantendo compatibilidade com as chamadas de texto existentes.

## 2. Contrato e Regras

1. A requisição aceita `tools` (funções com nome, descrição e JSON Schema de parâmetros) e `tool_choice` (`auto`, `none`, `required` ou uma função específica).
2. Mensagens `assistant` aceitam `tool_calls` (com `id`, `type: "function"`, `function.name` e `function.arguments` como string JSON) e `content` nulo quando houver chamadas.
3. O papel `tool` é aceito com `tool_call_id` obrigatório e `content`. Resultado sem chamada correspondente anterior é rejeitado com `400`.
4. A resposta não-streaming retorna `message.tool_calls` e `finish_reason: "tool_calls"` quando o modelo solicitar ferramentas.
5. Limites configuráveis de quantidade de ferramentas, tamanho do schema e tamanho das mensagens evitam abuso; excedê-los retorna `400` ou `413` com erro no formato OpenAI.
6. Requisições sem `tools` mantêm o comportamento e os schemas atuais.
7. O OpenAPI e os schemas de `packages/contracts` documentam os novos campos.
8. Um modelo ou provedor sem suporte a ferramentas recusa a requisição antes da chamada com erro claro, em vez de ignorar `tools` silenciosamente.

## 3. Atividades Passo a Passo

- [x] Estender os schemas Zod/JSON Schema de request e response para `tools`, `tool_choice`, `tool_calls` e papel `tool`.
- [x] Validar consistência entre `tool_calls` e mensagens `tool` e definir limites de tamanho.
- [x] Declarar a capacidade de ferramentas por provedor/modelo e recusar explicitamente quando não houver suporte.
- [x] Atualizar a documentação OpenAPI (schemas Fastify do endpoint).
- [x] Criar testes unitários de validação e regressão do contrato sem ferramentas.

## 4. Critérios de Conclusão

- [ ] Requisições com ferramentas válidas passam pela validação; inválidas retornam erro estruturado.
- [ ] Chamadas existentes sem `tools` continuam funcionando sem alteração.
- [ ] Modelos sem suporte recusam `tools` explicitamente.
- [x] Testes automatizados cobrem os casos válidos, inválidos e de regressão.
