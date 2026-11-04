# Tarefa 10.6 — Suportar Respostas em Streaming no Gateway

- **Épico:** Épico 10 — Melhorias Iniciais
- **Fase:** Evolução funcional após a validação da POC
- **Dependências:** Épicos 05 (contrato e adaptadores do Gateway), 06 (ledger e reservas de orçamento) e 09 (resiliência e observabilidade)
- **Módulos Afetados:** `apps/gateway`, `packages/contracts`, `packages/finance`, `packages/policies`, `tests/`

## 1. Contexto e Objetivo

O endpoint `POST /v1/chat/completions` atualmente aceita apenas `stream: false`. Clientes que esperam receber tokens progressivamente não conseguem usar o Gateway de forma compatível.

Esta tarefa adiciona suporte opcional a `stream: true`, preservando o formato de chunks Server-Sent Events (SSE) compatível com Chat Completions, sem perder autenticação, governança de orçamento, registro financeiro e tratamento de falhas.

## 2. Contrato e Regras de Streaming

1. `stream: false` mantém o comportamento JSON atual; `stream: true` retorna `Content-Type: text/event-stream` com eventos SSE compatíveis com o formato de Chat Completions.
2. Cada chunk inclui identificador de requisição, modelo, índice e conteúdo incremental quando disponível. O encerramento segue o contrato do endpoint, incluindo `finish_reason` e o marcador `[DONE]`.
3. Quando solicitado por `stream_options.include_usage` e suportado pelo Gateway, o uso final de tokens deve ser enviado no chunk final; caso o provedor não forneça contagens confiáveis, o sistema indica indisponibilidade em vez de inventar valores. Sem essa opção, o chunk final não inclui o campo de uso.
4. Autenticação por chave, políticas, rate limit e reserva de orçamento são verificadas antes de iniciar a resposta SSE. Não iniciar a transmissão antes da conclusão dessas verificações.
5. A reserva considera estimativa conservadora antes da chamada; após o término, o ledger e a reserva são reconciliados com uso real disponível, seguindo as regras de incerteza existentes.
6. Desconexão do cliente cancela a chamada ao provedor quando suportado. O evento financeiro deve refletir sucesso, falha parcial ou resultado incerto sem marcar automaticamente como concluída uma geração interrompida.
7. Erros ocorridos antes do início da transmissão retornam o status HTTP apropriado. Depois do envio dos headers/chunks, erros são representados no fluxo SSE conforme o contrato e registrados no ledger/log sem conteúdo de prompt ou resposta.
8. Backpressure e encerramento do socket devem ser tratados para evitar buffers sem limite, vazamento de recursos ou trabalho de inferência órfão.
9. Os logs continuam sem prompt e resposta; streaming não habilita captura nem persistência do conteúdo, que permanece regida pela tarefa 10.2.
10. Adaptadores podem implementar streaming nativo ou compatibilidade por buffering, mas a interface e a documentação devem declarar a semântica e as limitações de cada provedor. Não apresentar buffering como geração progressiva.

## 3. Atividades Passo a Passo

- [x] Estender os contratos de request/response e OpenAPI para descrever os dois modos de resposta.
- [x] Definir a interface de streaming dos adaptadores e implementar suporte progressivo no Ollama; documentar suporte dos demais provedores.
- [x] Implementar fluxo SSE em `apps/gateway`, incluindo cabeçalhos, chunks, finalização, `[DONE]`, cancelamento e backpressure.
- [x] Reutilizar o pipeline atual de autenticação, limites, reserva, ledger e custo, com reconciliação após a conclusão do stream.
- [x] Implementar estado explícito para desconexão, falha parcial, timeout e erro após headers, preservando comportamento financeiro seguro.
- [x] Garantir limpeza de timers e cancelamento do trabalho do provedor quando suportado.
- [ ] Completar testes automatizados de cancelamento do cliente e erro após início do stream; demais casos principais estão cobertos por testes unitários/de integração.
- [x] Documentar exemplos de consumo via cliente compatível, requisitos e limitações.

## 4. Critérios de Conclusão

- [x] Requisições com `stream: false` preservam contrato e comportamento atuais.
- [x] Requisições válidas com `stream: true` respondem com SSE e entregam conteúdo progressivamente para o adaptador nativo Ollama.
- [x] O stream termina corretamente com motivo de conclusão e marcador final; uso é enviado quando solicitado e confiável.
- [x] Orçamento excedido, chave inválida e rate limit são recusados antes de iniciar o stream.
- [x] Custos/reservas são reconciliados em sucesso; falhas incertas não inventam tokens nem sucesso financeiro.
- [ ] Testes automatizados específicos ainda devem cobrir desconexão do cliente e erro pós-início.
- [x] Prompts/respostas não são registrados em logs; captura opt-in da tarefa 10.2 é independente.
- [x] Testes automatizados de SSE e validação real com Ollama/modelo `llama3.2` passaram; roteiro manual documenta compatibilidade e limites.

## Situação da implementação — 2 de novembro de 2026

Implementação concluída para Ollama: streaming SSE progressivo, `stream_options.include_usage`, tratamento de uso indisponível, reservas/ledger, captura opt-in independente e documentação OpenAPI. Suíte automatizada completa passou (66 testes), incluindo inferência real com o Ollama local disponível. Cobertura específica de interrupção do cliente e falha depois do primeiro chunk segue pendente.

## 5. Decisões e Limites

- O modo streaming é opt-in por requisição e não muda o padrão não-streaming existente.
- A compatibilidade de formato não garante que qualquer cliente OpenAI seja compatível; clientes podem exigir recursos adicionais não implementados pelo Gateway.
- Um adaptador que apenas acumule a resposta e a envie no final não satisfaz o requisito de entrega progressiva.
- Streaming não altera a política de privacidade nem habilita armazenamento de prompts/respostas.
