# Tarefa 5.4 — Registrar os Eventos de Uso no Ledger

- **Épico:** Épico 05 — Implementar o Gateway LLM
- **Fase:** 5 (Gateway LLM Local)
- **Dependências:** [Tarefa 2.4](../epico-02-dominio-e-banco-de-dados/tarefa-2.4-gateway-e-financas.md), [Tarefa 5.2](./tarefa-5.2-implementar-adaptador-ollama.md), [Tarefa 5.3](./tarefa-5.3-criar-chaves-virtuais.md)
- **Módulos Afetados:** `apps/gateway`, `packages/finance`, `packages/database`
- **Guia de Teste Manual:** [teste-manual-5.1-a-5.5-gateway-llm.md](./testes-manuais/teste-manual-5.1-a-5.5-gateway-llm.md)

## 1. Objetivo
Garantir que toda tentativa de chamada ao Gateway LLM seja registrada de forma estruturada e auditável na tabela `usage_events`, servindo como base imutável para o cálculo de custos e observabilidade.

## 2. Dados Obrigatórios por Tentativa (`usage_events`)
Para cada tentativa de inferência, registrar:
1. **Organização** (`organization_id`)
2. **Projeto** (`project_id`)
3. **Chave virtual** (`virtual_key_id`)
4. **Provedor** (`provider`, ex.: `ollama`)
5. **Modelo** (`model`, ex.: `llama3.2`)
6. **Tokens de entrada** (`input_tokens`)
7. **Tokens de saída** (`output_tokens`)
8. **Duração** (`duration_ms`)
9. **Estado** (`status`: ex. `succeeded`, `failed`, `blocked_policy`, `blocked_budget`, `uncertain`)
10. **Identificador da requisição** (`request_id`)
11. **Número da tentativa** (`attempt_number`)

## 3. Regras de Falha e Estado Incerto
- **Registro de Falhas:** Os eventos devem ser registrados **mesmo quando a chamada falhar** (ex.: erro de validação do provedor, bloqueio de política, erro 500), desde que o sistema consiga determinar o estado.
- **Estado Incerto (`uncertain`):** Quando ocorrer um timeout ou queda de conexão em que **não seja possível saber se o provedor executou a chamada**, o sistema deve marcar o resultado explicitamente como `uncertain` e **jamais inventar métricas de tokens** (`null` em vez de `0` falso).
- **Privacidade:** Não persistir o texto bruto dos prompts ou respostas sensíveis nos registros financeiros do ledger.

## 4. Atividades Passo a Passo
- [x] Implementar o serviço de gravação de `usage_events` em `packages/finance` / `packages/database`.
- [x] Integrar a gravação no ciclo de requisição do `apps/gateway` (tanto no caminho de sucesso quanto no tratamento de erros e timeouts).
- [x] Garantir que chamadas com timeout após o envio ao provedor recebam o estado `uncertain` sem métricas fabricadas.

## 5. Critérios de Conclusão
- [x] Chamadas bem-sucedidas gravam todos os 11 campos obrigatórios em `usage_events`.
- [x] Chamadas com falha ou bloqueadas também são registradas com o estado correspondente.
- [x] Falhas de comunicação de resultado indeterminado são marcadas como `uncertain` sem inventar métricas.
