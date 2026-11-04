# Tarefa 8.3 — Criar Filtros Globais e Garantir Autorização na API

- **Épico:** Épico 08 — Construir o Dashboard
- **Fase:** 8 (Dashboard Administrativo)
- **Dependências:** [Tarefa 8.1](./tarefa-8.1-implementar-paginas-dashboard.md), [Tarefa 8.2](./tarefa-8.2-implementar-indicadores-visao-geral.md)
- **Módulos Afetados:** `apps/web`, `apps/api`, `packages/contracts`

## 1. Objetivo
Implementar filtros multidimensionais consistentes entre o frontend (`apps/web`) e o backend (`apps/api`), assegurando que toda consulta aplique autorização multi-tenant e RBAC antes de retornar qualquer dado.

## 2. Filtros Obrigatórios
Implementar filtragem combinada por:
1. **Período** (`startDate`, `endDate`)
2. **Organização** (`organizationId`)
3. **Projeto** (`projectId`)
4. **Equipe** (`teamId`)
5. **Provedor** (`provider`)
6. **Modelo** (`model`)
7. **Categoria de custo** (`costCategory`: estimado, simulado, reportado, licença, ajuste, não reconciliado)
8. **Origem do dado** (`dataSource`: gateway local, CSV, API oficial)

## 3. Regra de Segurança na Filtragem
> [!IMPORTANT]
> A API deve aplicar a **autorização e o isolamento de organização antes de executar as queries e retornar resultados**. Um usuário nunca pode obter dados de outra organização ou de um recurso não autorizado manipulando query params na URL.

## 4. Atividades Passo a Passo
- [x] Definir o schema Zod compartilhado de filtros (`DashboardQueryFilters`) em `packages/contracts`.
- [x] Implementar a aplicação segura dos 8 filtros nas queries de `packages/finance` e `apps/api`, sempre ancorada no `organization_id` autorizado da sessão.
- [x] Implementar a barra de filtros persistente na URL (search params) em `apps/web`.
- [x] Testar combinações de filtros garantindo que dados reais, estimados e sintéticos/simulados sejam claramente diferenciados e filtráveis.

## 5. Critérios de Conclusão (Fechamento do Épico 08)
- [x] Todos os 8 filtros funcionam no dashboard e na API.
- [x] O dashboard consegue mostrar os eventos gerados pelo gateway e os custos importados, **sem misturar dados reais, estimados e sintéticos**.
- [x] A API valida autorização e tenant antes de retornar qualquer resultado filtrado.
