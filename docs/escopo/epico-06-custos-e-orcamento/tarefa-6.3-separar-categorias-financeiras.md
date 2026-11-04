# Tarefa 6.3 — Separar as Categorias Financeiras e Reconciliação

- **Épico:** Épico 06 — Implementar Custos e Orçamento
- **Fase:** 6 (Ledger Financeiro e Políticas de Orçamento)
- **Dependências:** [Tarefa 6.2 — Implementar Motor de Cálculo de Custos](./tarefa-6.2-calcular-custos.md)
- **Módulos Afetados:** `packages/finance`, `packages/database`, `apps/api`

## 1. Objetivo
Garantir na camada de domínio financeiro (`packages/finance`) e nas consultas da API a separação rigorosa das categorias de custo e o mecanismo de reconciliação entre o que o gateway estimou e o que o fornecedor reportou.

## 2. Categorias Financeiras Obrigatórias
O sistema e o dashboard deverão distinguir explicitamente:
1. **Custo estimado pelo gateway** (`gateway_estimated` / separar também estimativas de simulação local).
2. **Custo reportado pelo fornecedor** (`provider_reported`, vindo de API oficial ou CSV de fatura).
3. **Custo contratado de licenças** (`license_contracted`).
4. **Ajustes financeiros** (`financial_adjustment`, créditos, descontos ou correções manuais auditadas).
5. **Registros ainda não reconciliados** (`unreconciled`).

> [!CAUTION]
> **Regra de Ouro:** **NUNCA somar automaticamente um custo estimado pelo gateway ao custo reportado pelo fornecedor referente à mesma utilização**, pois isso causaria dupla contagem financeira.

## 3. Reconciliação (`reconciliation_matches`)
- Implementar o serviço de reconciliação em `packages/finance` que compara os custos reportados pelos fornecedores (`source_records` / `cost_records` externos) com os custos estimados internamente pelo gateway no mesmo período, projeto, provedor e modelo.
- Registrar o resultado em `reconciliation_matches`, apontando correspondências exatas, divergências de valor (delta) e itens órfãos/pendentes de reconciliação.

## 4. Atividades Passo a Passo
- [ ] Estruturar os tipos e queries de agregação financeira em `packages/finance` separando estritamente as 5 categorias e valores simulados.
- [ ] Implementar o motor de reconciliação gerando registros em `reconciliation_matches`.
- [ ] Criar testes unitários e de integração comprovando que custos estimados, custos simulados (Ollama) e custos reportados nunca são somados indevidamente como se fossem a mesma grandeza.

## 5. Critérios de Conclusão
- [ ] As 5 categorias financeiras são armazenadas e consultadas separadamente.
- [ ] Valores simulados (ex.: Ollama) nunca aparecem misturados como custos reais de faturamento.
- [ ] Não ocorre dupla contagem entre custo estimado e custo reportado da mesma utilização.
- [ ] Divergências e itens não reconciliados são identificados por `reconciliation_matches`.
