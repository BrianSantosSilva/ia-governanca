# Tarefa 9.3 — Criar Suíte de Testes Automatizados (Unitários, Integração e E2E)

- **Épico:** Épico 09 — Segurança, Testes e Observabilidade
- **Fase:** 9 (Hardening, Segurança, Observabilidade e Testes Finais)
- **Dependências:** [Tarefa 9.1](./tarefa-9.1-seguranca-e-protecao-dados.md), [Tarefa 9.2](./tarefa-9.2-observabilidade-logs-metricas.md)
- **Módulos Afetados:** `packages/*`, `tests/integration/`, `tests/security/`, `tests/e2e/`

## 1. Objetivo
Consolidar a pirâmide de testes automatizados do projeto (unitários, integração e ponta a ponta), comprovando de forma reproduzível que o fluxo completo de governança e controle de gastos funciona do início ao fim.

## 2. Escopo da Suíte de Testes

### 2.1. Testes Unitários
- Cálculos financeiros determinísticos com aritmética decimal (`packages/finance`).
- Resolução de versão de preços (`model_prices`).
- Regras de autorização RBAC e avaliação de políticas (`packages/identity` e `packages/policies`).
- Validação de contratos e parsers CSV (`packages/contracts` e `packages/connectors`).

### 2.2. Testes de Integração (`tests/integration/`)
- Integridade e constraints multi-tenant no PostgreSQL.
- Conectores, importador CSV (incluindo `dry run` e idempotência) e worker (`sync_runs`).
- Gateway LLM com Ollama e persistência em `usage_events`.
- Reservas atômicas e concorrência de orçamento (`budget_policies` / `budget_reservations`).

### 2.3. Teste de Ponta a Ponta (`tests/e2e/`)
Implementar o fluxo E2E completo verificando na sequência:
1. **Criar um projeto** (dentro de uma organização autenticada).
2. **Criar uma chave virtual** associada ao projeto.
3. **Fazer uma chamada à LLM local (Ollama)** através do Gateway usando a chave virtual.
4. **Registrar o evento** em `usage_events`.
5. **Calcular o custo** a partir do catálogo versionado e gravar em `cost_records`.
6. **Exibir o evento e o custo no dashboard** (via consulta autenticada).
7. **Aplicar um limite de orçamento** no modo `block` cujo valor já tenha sido atingido pelo consumo.
8. **Confirmar o bloqueio da próxima chamada** no Gateway e o registro da tentativa bloqueada.

## 3. Atividades Passo a Passo
- [x] Revisar e completar os testes unitários nos pacotes internos.
- [x] Revisar e completar os testes de integração em `tests/integration/`.
- [x] Implementar o teste E2E completo em `tests/e2e/full-governance-flow.e2e.test.ts`.
- [x] Garantir execução limpa via script único (`npm test`).

## 4. Critérios de Conclusão
- [x] Testes unitários, de integração e de segurança passam sem falhas.
- [x] O teste E2E de 8 etapas executa de ponta a ponta com sucesso usando o ambiente local (adaptador determinístico; sem serviços externos).
