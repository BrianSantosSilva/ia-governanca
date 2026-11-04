# Tarefa 8.1 — Implementar as Páginas do Dashboard

- **Épico:** Épico 08 — Construir o Dashboard
- **Fase:** 8 (Dashboard Administrativo)
- **Dependências:** [Épico 03](../epico-03-autenticacao-e-autorizacao/tarefa-3.3-implementar-autorizacao-rbac.md), [Épico 05](../epico-05-gateway-llm/tarefa-5.5-teste-integracao-gateway.md), [Épico 06](../epico-06-custos-e-orcamento/tarefa-6.4-implementar-politicas-orcamento.md)
- **Módulos Afetados:** `apps/web`, `apps/api`

## 1. Objetivo
Construir a estrutura de navegação e as 9 páginas funcionais do Dashboard em React (`apps/web`), conectadas aos endpoints autenticados da API administrativa (`apps/api`).

> [!IMPORTANT]
> Não avançar para o dashboard antes de validar o registro de uma chamada real no ledger.

## 2. Páginas Obrigatórias do Dashboard
1. **Visão Geral (`/overview`):** Resumo executivo de custos, consumo, orçamentos, licenças ociosas e saúde das sincronizações.
2. **Consumo de APIs (`/usage`):** Histórico de chamadas (`usage_events`), tokens de entrada/saída, latência, provedores, modelos e estados.
3. **Custos (`/costs`):** Detalhamento financeiro separando custo estimado pelo gateway, custo reportado pelos fornecedores, custo de licenças, ajustes, simulações e itens pendentes de reconciliação.
4. **Licenças e Assentos (`/licenses`):** Contratos ativos, assentos atribuídos vs. contratados, assentos sem atividade recente e identidades externas pendentes de revisão.
5. **Projetos e Equipes (`/projects`):** Gestão de projetos, equipes e membros da organização.
6. **Chaves Virtuais (`/virtual-keys`):** Criação (exibição única do segredo), listagem por prefixo, escopos, limites e revogação de chaves virtuais.
7. **Orçamentos (`/budgets`):** Configuração e acompanhamento de políticas de orçamento (`observe`, `alert`, `block`) por organização, projeto e chave virtual.
8. **Conectores e Sincronizações (`/connectors`):** Gestão de conectores, importação CSV (com opção de `dry run`), histórico de `sync_runs` e status da última sincronização.
9. **Auditoria (`/audit`):** Trilha de eventos administrativos (`audit_events`) filtrável por ação, usuário e período.

## 3. Atividades Passo a Passo
- [x] Configurar roteamento (React Router), layout base autenticado via OIDC e seletor de Organização ativa em `apps/web`.
- [x] Implementar cada uma das 9 páginas consumindo os dados reais da `apps/api`.
- [x] Adaptar a exibição de ações de escrita conforme o papel RBAC do usuário logado (lembrando que o bloqueio real permanece obrigatório no backend).

## 4. Critérios de Conclusão
- [x] As 9 páginas estão implementadas, navegáveis e integradas à API administrativa.
- [x] Fluxos interativos (criar projeto, gerar chave virtual, configurar orçamento, importar CSV) funcionam pela interface web.
