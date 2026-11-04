# Tarefa 6.4 — Implementar Políticas e Reservas Atômicas de Orçamento

- **Épico:** Épico 06 — Implementar Custos e Orçamento
- **Fase:** 6 (Ledger Financeiro e Políticas de Orçamento)
- **Dependências:** [Tarefa 6.2](./tarefa-6.2-calcular-custos.md), [Tarefa 6.3](./tarefa-6.3-separar-categorias-financeiras.md)
- **Módulos Afetados:** `packages/policies`, `packages/finance`, `apps/gateway`, `apps/api`, `tests/integration/`

## 1. Objetivo
Implementar o controle de políticas de orçamento (`budget_policies`) e reservas atômicas (`budget_reservations`) para impedir que chamadas concorrentes ultrapassem os limites financeiros configurados.

## 2. Escopos e Modos de Orçamento

### Escopos de Limite:
1. **Organização** (`organization_id`)
2. **Projeto** (`project_id`)
3. **Chave virtual** (`virtual_key_id`)

### Modos de Operação:
- `observe`: Registra o consumo e o percentual do orçamento sem alertar nem bloquear.
- `alert`: Sinaliza/emite alerta quando o limiar configurado é atingido, mas permite a chamada.
- `block`: **Bloqueia novas chamadas** (`HTTP 429` / `403` com código de erro de orçamento excedido) quando o limite aplicável for atingido.

## 3. Atomicidade e Concorrência (`budget_reservations`)
> [!IMPORTANT]
> As reservas de orçamento precisam ser **atômicas no banco de dados**. Uma simples leitura (`SELECT`) seguida de uma gravação independente (`INSERT`) permite condições de corrida (*race conditions*) onde requisições concorrentes ultrapassam o limite.

Definir e implementar explicitamente o comportamento para:
1. **Chamadas em andamento:** Antes de encaminhar a requisição ao provedor LLM, adquirir uma reserva atômica (`budget_reservations`) com lock transacional (`SELECT ... FOR UPDATE` na política de orçamento ou constraint equivalente).
2. **Liquidação após a chamada:** Quando a chamada termina com sucesso, converter/ajustar a reserva para o custo real calculado; se a chamada falhar comprovadamente antes de consumir tokens no provedor, liberar a reserva.
3. **Custos incertos (`uncertain`):** Definir tratamento conservador para reservas cujas chamadas terminaram em estado incerto (ex.: manter sinalizada para revisão/reconciliação).
4. **Reservas expiradas:** Limpar ou expirar reservas órfãs de processos que sofreram crash após um TTL configurável.

## 4. Atividades Passo a Passo
- [ ] Implementar o serviço de avaliação e reserva atômica de orçamento em `packages/policies` / `packages/finance`.
- [ ] Integrar a verificação pré-inferência e liquidação pós-inferência no `apps/gateway`.
- [ ] Criar endpoints administrativos em `apps/api` para criar/editar `budget_policies`.
- [ ] Criar teste de concorrência em `tests/integration/budget-concurrency.test.ts` disparando múltiplas chamadas simultâneas contra um orçamento no modo `block` e provando que o limite não é ultrapassado.

## 5. Critérios de Conclusão (Fechamento do Épico 06)
- [ ] O custo calculado pode ser reproduzido.
- [ ] Os preços são versionados.
- [ ] Valores simulados não aparecem como custos reais.
- [ ] O limite bloqueia chamadas conforme a política (`observe`, `alert`, `block`) nos níveis de Organização, Projeto e Chave Virtual.
- [ ] Testes concorrentes comprovam que requisições paralelas não ultrapassam o orçamento por falha de sincronização.
