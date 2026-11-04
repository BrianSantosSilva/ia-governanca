# Tarefa 2.3 — Migração: Licenças e Assentos

- **Épico:** Épico 02 — Implementar o Domínio e o Banco de Dados
- **Fase:** 2 (Banco de Dados e Domínio)
- **Dependências:** [Tarefa 2.1](./tarefa-2.1-organizacoes-e-identidade.md), [Tarefa 2.2](./tarefa-2.2-conectores-e-ingestao.md)
- **Módulos Afetados:** `migrations/`, `packages/database`, `packages/contracts`
- **Guia de Teste Manual:** [teste-manual-2.1-a-2.5-migracoes-e-integridade.md](./testes-manuais/teste-manual-2.1-a-2.5-migracoes-e-integridade.md)

## 1. Objetivo
Modelar e criar no banco de dados as tabelas de contratos de licenças corporativas de IA e as atribuições de assentos aos usuários/identidades externas.

## 2. Tabelas a Criar
1. `license_contracts`
2. `license_assignments`

## 3. Regras de Negócio e Constraints Obrigatórias
- **Separação Contrato vs. Assento:** Distinguir claramente o valor total de um contrato (`total_contract_value`), a quantidade de assentos contratados (`contracted_seats`) e o custo unitário por assento (`cost_per_seat`).
- **Contratado ≠ Atribuído ≠ Utilizado:** Uma licença contratada não significa necessariamente que esteja atribuída a alguém ou que esteja sendo efetivamente utilizada. O modelo deve permitir identificar assentos ociosos (não atribuídos ou atribuídos sem atividade observada).
- **Precisão Financeira e Temporal:**
  - Utilizar `numeric` para todos os valores monetários.
  - Preservar a moeda original (`currency`, ex.: `USD`, `BRL`).
  - Utilizar `timestamptz` para vigência do contrato e datas de atribuição/revogação de assento e última atividade observada (`last_activity_at`).
- **Isolamento Multi-tenant:** Garantir que `license_assignments` só possa vincular contratos, usuários ou identidades externas pertencentes à mesma `organization_id`.

## 4. Atividades Passo a Passo
- [x] Criar migração SQL para `license_contracts` e `license_assignments`.
- [x] Configurar constraints de integridade (moeda, valores não negativos, FKs compostas por `organization_id`).
- [x] Definir contratos TypeScript/Zod em `packages/contracts`.
- [x] Executar e validar a migração no PostgreSQL.

## 5. Critérios de Conclusão
- [x] Tabelas `license_contracts` e `license_assignments` criadas e validadas.
- [x] Diferenciação clara entre assentos contratados, atribuídos e com atividade recente suportada pelo schema.
