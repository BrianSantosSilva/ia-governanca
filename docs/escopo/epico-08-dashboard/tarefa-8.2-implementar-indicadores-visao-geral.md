# Tarefa 8.2 — Implementar os Indicadores da Visão Geral

- **Épico:** Épico 08 — Construir o Dashboard
- **Fase:** 8 (Dashboard Administrativo)
- **Dependências:** [Tarefa 8.1 — Implementar as Páginas do Dashboard](./tarefa-8.1-implementar-paginas-dashboard.md)
- **Módulos Afetados:** `apps/web`, `apps/api`, `packages/finance`

## 1. Objetivo
Implementar os indicadores consolidados (KPIs e gráficos/tabelas) na página de Visão Geral do dashboard, garantindo transparência sobre período, moeda, origem dos dados e ausência de preenchimento enganoso com zeros.

## 2. Indicadores Obrigatórios na Visão Geral
A visão geral deverá apresentar:
1. **Custo estimado no período** (separando claramente valores simulados de tarifas comerciais).
2. **Custo reportado pelos fornecedores.**
3. **Custo de licenças.**
4. **Consumo por provedor e modelo.**
5. **Consumo por projeto e equipe.**
6. **Percentual de utilização dos orçamentos** (com destaque visual para limites em alerta ou bloqueados).
7. **Licenças atribuídas e sem atividade observada** no período.
8. **Fontes desatualizadas** (conectores cuja última sincronização falhou ou ultrapassou a janela esperada).
9. **Custos pendentes de reconciliação.**

## 3. Regras de Exibição Financeira e Integridade Visual
- **Período e Moeda Explícitos:** Todos os indicadores deverão informar explicitamente o **período de referência** e a **moeda original** (não somar moedas distintas sem indicação).
- **Dados Ausentes ≠ Zero Consumo:**
  > [!WARNING]
  > **NÃO preencher dados ausentes com `0` (`R$ 0,00` ou `0 tokens`)** quando isso puder indicar incorretamente que não houve consumo (ex.: fonte ainda não sincronizada, chamada em estado `uncertain` ou conector sem suporte a métrica). Exibir estado explícito como *"Dados não disponíveis"* / *"Aguardando sincronização"*.

## 4. Atividades Passo a Passo
- [x] Criar endpoint agregador de indicadores da Visão Geral em `apps/api` consumindo `packages/finance`.
- [x] Implementar os componentes de cards e visualizações dos 9 indicadores em `apps/web`.
- [x] Garantir exibição de badges de moeda, período e origem do dado (`Estimado`, `Simulado`, `Reportado`, `Contratado`).
- [x] Validar o tratamento visual de dados ausentes (`null` / não sincronizados) versus consumo real zero (`0`).

## 5. Critérios de Conclusão
- [x] Todos os 9 indicadores obrigatórios estão visíveis e funcionais na Visão Geral.
- [x] Todos os valores exibem período e moeda.
- [x] Dados ausentes não são mascarados com zero.
