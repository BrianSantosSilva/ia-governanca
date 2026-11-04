# Tarefa 2.1 — Migração: Organizações e Identidade

- **Épico:** Épico 02 — Implementar o Domínio e o Banco de Dados
- **Fase:** 2 (Banco de Dados e Domínio)
- **Dependências:** [Tarefa 1.4](../epico-01-preparacao-ambiente/tarefa-1.4-subir-banco-dados-postgresql.md)
- **Módulos Afetados:** `migrations/`, `packages/database`, `packages/contracts`
- **Guia de Teste Manual:** [teste-manual-2.1-a-2.5-migracoes-e-integridade.md](./testes-manuais/teste-manual-2.1-a-2.5-migracoes-e-integridade.md)

## 1. Objetivo
Criar a primeira migração SQL com as entidades fundamentais de multi-tenancy (organizações), identidade de usuários, equipes e projetos, garantindo isolamento estrito entre organizações diretamente no banco de dados.

## 2. Tabelas a Criar
1. `organizations`
2. `users`
3. `memberships` (associação usuário ↔ organização com papel)
4. `teams`
5. `team_memberships` (associação usuário ↔ equipe)
6. `projects`

## 3. Regras de Negócio e Constraints Obrigatórias
- **Multi-organização:** Usuários podem pertencer a diferentes organizações por meio de `memberships`.
- **Papel explícito:** Cada associação (`memberships`) possui um papel explícito (`owner`, `admin`, `finops`, `security`, `developer`, `viewer`).
- **Pertencimento ao Tenant:** Equipes (`teams`) e projetos (`projects`) pertencem obrigatoriamente a uma única organização (`organization_id`).
- **Isolamento Cross-Tenant via FK Composta:** Um projeto não pode referenciar uma equipe de outra organização. Utilize chaves únicas/primárias compostas `(id, organization_id)` e chaves estrangeiras compostas para garantir essa regra no nível do PostgreSQL.
- **Preservação Histórica:** A remoção de usuários (soft delete / desativação ou revogação de membership) não deve apagar o histórico financeiro nem violar integridade referencial de eventos passados.
- **Datas:** Utilizar `timestamptz` para todas as colunas de data/hora (`created_at`, `updated_at`, `deleted_at`).

## 4. Atividades Passo a Passo
- [x] Escrever a migração SQL (`up` e `down`) criando as tabelas `organizations`, `users`, `memberships`, `teams`, `team_memberships` e `projects`.
- [x] Adicionar índices, constraints `UNIQUE` e chaves estrangeiras compostas de isolamento por `organization_id`.
- [x] Definir os schemas Zod e tipos TypeScript correspondentes em `packages/contracts`.
- [x] Aplicar a migração no banco local e validar o rollback/reaplicação.

## 5. Critérios de Conclusão
- [x] Migração executa sem erros em banco limpo.
- [x] Constraints impedem a vinculação de projetos e equipes de organizações distintas.
- [x] Tipos e repositórios básicos disponíveis em `packages/database`.
