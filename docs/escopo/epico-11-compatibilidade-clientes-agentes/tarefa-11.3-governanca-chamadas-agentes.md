# Tarefa 11.3 — Adaptar Governança, Guardrails e Privacidade a Chamadas de Agentes

- **Épico:** Épico 11 — Compatibilidade do Gateway com Clientes Agentes
- **Fase:** Evolução funcional após a validação da POC
- **Dependências:** Tarefas 11.1 e 11.2; tarefas 10.2 e 10.7
- **Módulos Afetados:** `apps/gateway`, `packages/policies`, `packages/finance`, `apps/api`, `apps/web`, `tests/`

## 1. Contexto e Objetivo

Clientes agentes enviam contextos longos e iteram várias vezes por tarefa, com resultados de ferramentas que podem conter código, segredos ou dados sensíveis. Orçamento, guardrails e captura de conteúdo precisam tratar esse perfil sem quebrar o protocolo.

## 2. Regras

1. Guardrails avaliam o conteúdo textual relevante, incluindo `tool_calls.function.arguments` e mensagens `tool`; a decisão sobre bloquear, alertar ou apenas registrar é documentada por regra. Bloqueio de uma chamada não pode produzir resposta que viole o protocolo (por exemplo, `tool_calls` incompleto).
2. Em streaming, guardrails síncronos só bloqueiam antes do início do fluxo; avaliação posterior permanece assíncrona e não interrompe uma chamada já iniciada, salvo decisão explícita em contrário.
3. A reserva de orçamento considera o tamanho do contexto, pois agentes reenviam todo o histórico a cada iteração.
4. Limites de tokens de prompt e de saída são validados por modelo antes da chamada.
5. O ledger distingue origem da chamada (por exemplo, cabeçalho ou metadado `client`: `copilot-cli`) sem exigir identificação confiável; o campo é informativo.
6. Captura opt-in de prompt/resposta (tarefa 10.2) segue regras próprias para conteúdo de ferramentas: tamanho máximo, mascaramento e retenção documentados. Logs continuam sem conteúdo.
7. Rate limit por chave considera rajadas de chamadas de agentes e é configurável.

## 3. Atividades Passo a Passo

- [x] Definir e documentar o tratamento dos guardrails para `tool_calls` e resultados `tool`.
- [x] Ajustar a estimativa de reserva e a validação de limites ao contexto longo.
- [x] Registrar a origem informada do cliente no ledger e exibi-la no dashboard.
- [x] Atualizar a captura opt-in e a mascaragem para conteúdo de ferramentas.
- [ ] Criar testes de guardrail, orçamento e privacidade com fluxos de agente.

## 4. Critérios de Conclusão

- [ ] Guardrails não quebram o protocolo de ferramentas nem produzem respostas inválidas.
- [ ] Orçamento e rate limit funcionam com contextos longos e múltiplas iterações.
- [x] A origem da chamada aparece no ledger/dashboard.
- [ ] Logs não contêm prompts, respostas nem resultados de ferramentas.

## 5. Status da implementação

- Guardrails continuam avaliando apenas a última mensagem `user`; `tool_calls` e mensagens `tool` não são avaliados (decisão desta versão), portanto não quebram o protocolo.
- A estimativa de reserva passa a incluir o schema de `tools` e os `tool_calls` do histórico.
- Origem do cliente: cabeçalho opcional `X-Client-Origin` (`^[a-z0-9][a-z0-9._-]{0,39}# Tarefa 11.3 — Adaptar Governança, Guardrails e Privacidade a Chamadas de Agentes

- **Épico:** Épico 11 — Compatibilidade do Gateway com Clientes Agentes
- **Fase:** Evolução funcional após a validação da POC
- **Dependências:** Tarefas 11.1 e 11.2; tarefas 10.2 e 10.7
- **Módulos Afetados:** `apps/gateway`, `packages/policies`, `packages/finance`, `apps/api`, `apps/web`, `tests/`

## 1. Contexto e Objetivo

Clientes agentes enviam contextos longos e iteram várias vezes por tarefa, com resultados de ferramentas que podem conter código, segredos ou dados sensíveis. Orçamento, guardrails e captura de conteúdo precisam tratar esse perfil sem quebrar o protocolo.

## 2. Regras

1. Guardrails avaliam o conteúdo textual relevante, incluindo `tool_calls.function.arguments` e mensagens `tool`; a decisão sobre bloquear, alertar ou apenas registrar é documentada por regra. Bloqueio de uma chamada não pode produzir resposta que viole o protocolo (por exemplo, `tool_calls` incompleto).
2. Em streaming, guardrails síncronos só bloqueiam antes do início do fluxo; avaliação posterior permanece assíncrona e não interrompe uma chamada já iniciada, salvo decisão explícita em contrário.
3. A reserva de orçamento considera o tamanho do contexto, pois agentes reenviam todo o histórico a cada iteração.
4. Limites de tokens de prompt e de saída são validados por modelo antes da chamada.
5. O ledger distingue origem da chamada (por exemplo, cabeçalho ou metadado `client`: `copilot-cli`) sem exigir identificação confiável; o campo é informativo.
6. Captura opt-in de prompt/resposta (tarefa 10.2) segue regras próprias para conteúdo de ferramentas: tamanho máximo, mascaramento e retenção documentados. Logs continuam sem conteúdo.
7. Rate limit por chave considera rajadas de chamadas de agentes e é configurável.

## 3. Atividades Passo a Passo

- [x] Definir e documentar o tratamento dos guardrails para `tool_calls` e resultados `tool`.
- [x] Ajustar a estimativa de reserva e a validação de limites ao contexto longo.
- [x] Registrar a origem informada do cliente no ledger e exibi-la no dashboard.
- [x] Atualizar a captura opt-in e a mascaragem para conteúdo de ferramentas.
- [ ] Criar testes de guardrail, orçamento e privacidade com fluxos de agente.

## 4. Critérios de Conclusão

- [ ] Guardrails não quebram o protocolo de ferramentas nem produzem respostas inválidas.
- [ ] Orçamento e rate limit funcionam com contextos longos e múltiplas iterações.
- [x] A origem da chamada aparece no ledger/dashboard.
- [ ] Logs não contêm prompts, respostas nem resultados de ferramentas.

## 5. Status da implementação

- Guardrails continuam avaliando apenas a última mensagem `user`; `tool_calls` e mensagens `tool` não são avaliados (decisão desta versão), portanto não quebram o protocolo.
- A estimativa de reserva passa a incluir o schema de `tools` e os `tool_calls` do histórico.
, ex.: `copilot-cli`) gravado em `usage_events.client_origin` (migration `010_client_origin.sql`) e exibido na coluna Origem do dashboard. É um valor **informado pelo cliente**, sem valor de segurança; se o CLI não permitir cabeçalhos customizados, o campo fica vazio (não verificado).
- Captura opt-in inclui `tool_calls`, `tool_call_id` e `response_tool_calls` com mascaragem de segredos conhecidos.
- **Pendentes:** testes de orçamento/privacidade com fluxo de agente (a migration 010, o ledger e o repasse de tool_calls JSON/SSE foram exercitados em teste de integração com adaptador simulado) e verificação de que logs não contêm conteúdo de ferramentas.



