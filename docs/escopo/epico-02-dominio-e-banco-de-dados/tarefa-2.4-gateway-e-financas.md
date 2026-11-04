# Tarefa 2.4 — Migração: Gateway, Ledger Financeiro e Orçamentos

- **Épico:** Épico 02 — Implementar o Domínio e o Banco de Dados
- **Fase:** 2 (Banco de Dados e Domínio)
- **Dependências:** [Tarefa 2.1](./tarefa-2.1-organizacoes-e-identidade.md), [Tarefa 2.2](./tarefa-2.2-conectores-e-ingestao.md), [Tarefa 2.3](./tarefa-2.3-licencas.md)
- **Módulos Afetados:** `migrations/`, `packages/database`, `packages/contracts`
- **Guia de Teste Manual:** [teste-manual-2.1-a-2.5-migracoes-e-integridade.md](./testes-manuais/teste-manual-2.1-a-2.5-migracoes-e-integridade.md)

## 1. Objetivo
Criar as tabelas centrais de operação do Gateway LLM, catálogo versionado de preços, ledger financeiro, reconciliação de custos, políticas/reservas de orçamento e trilha de auditoria.

## 2. Tabelas a Criar
1. `virtual_keys`
2. `usage_events`
3. `model_prices`
4. `cost_records`
5. `reconciliation_matches`
6. `budget_policies`
7. `budget_reservations`
8. `audit_events`

## 3. Regras Obrigatórias de Modelagem
- **Valores Monetários:** Utilizar sempre `numeric` (nunca `float`/`real`) para preços, custos, limites de orçamento e reservas.
- **Datas e Fuso Horário:** Utilizar `timestamptz` em todos os registros temporais.
- **Moeda Original:** Preservar a coluna de moeda original em `model_prices`, `cost_records`, `budget_policies` e `budget_reservations`.
- **Versionamento de Preços (`model_prices`):** Registrar início e fim de validade (`effective_from`, `effective_to`), origem do preço e tipo (ex.: tarifa oficial vs. estimativa interna/simulação para Ollama).
- **Separação de Categorias de Custo (`cost_records`):** Separar explicitamente custos estimados pelo gateway, custos reportados pelo fornecedor, custos de licenças e ajustes financeiros. Referenciar a versão de preço (`model_price_id`) quando calculado internamente.
- **Segurança de Chaves Virtuais (`virtual_keys`):** Nunca armazenar a chave virtual em texto puro; armazenar apenas o `key_hash` e o `key_prefix` de identificação, além de escopos, expiração, limite e `project_id`.
- **Isolamento Cross-Tenant:** Impedir referências cruzadas entre organizações por meio de chaves estrangeiras compostas `(id, organization_id)` e constraints em todas as tabelas.
- **Auditoria (`audit_events`):** Registrar ações administrativas relevantes (quem, quando, organização, ação, recurso alvo e metadados sem segredos).

## 4. Atividades Passo a Passo
- [x] Escrever a migração SQL contemplando as 8 tabelas e todas as chaves estrangeiras compostas e constraints de tenant.
- [x] Criar índices de consulta para dashboard e reconciliação (por `organization_id`, `project_id`, período, provedor, modelo e categoria de custo).
- [x] Atualizar `packages/contracts` e `packages/database` com os tipos correspondentes.
- [x] Validar a aplicação da migração no PostgreSQL.

## 5. Critérios de Conclusão
- [x] Todas as 8 tabelas criadas com `numeric`, `timestamptz` e FKs compostas de tenant.
- [x] Nenhuma coluna armazena chaves virtuais em texto puro.
- [x] Schema suporta versionamento de preços, separação de custos estimados vs. reportados e reservas de orçamento.
