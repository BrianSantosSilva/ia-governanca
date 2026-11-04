# Tarefa 2.2 — Migração: Conectores e Ingestão

- **Épico:** Épico 02 — Implementar o Domínio e o Banco de Dados
- **Fase:** 2 (Banco de Dados e Domínio)
- **Dependências:** [Tarefa 2.1 — Migração: Organizações e Identidade](./tarefa-2.1-organizacoes-e-identidade.md)
- **Módulos Afetados:** `migrations/`, `packages/database`, `packages/contracts`
- **Guia de Teste Manual:** [teste-manual-2.1-a-2.5-migracoes-e-integridade.md](./testes-manuais/teste-manual-2.1-a-2.5-migracoes-e-integridade.md)

## 1. Objetivo
Criar as tabelas responsáveis pelo armazenamento das conexões com provedores externos, histórico de execuções de sincronização (`sync_runs`), registros brutos/normalizados de origem (`source_records`) e mapeamento de identidades externas (`external_identities`).

## 2. Tabelas a Criar
1. `provider_connections`
2. `sync_runs`
3. `source_records`
4. `external_identities`

## 3. Regras de Negócio e Constraints Obrigatórias
- **Rastreabilidade de Execução (`sync_runs`):** Cada execução deve registrar:
  - Estado da sincronização (ex.: `running`, `completed`, `failed`, `partial`).
  - Período consultado (`period_start`, `period_end` com `timestamptz`).
  - Quantidade de registros processados, inseridos/atualizados e com falha.
  - Checkpoints/cursores para retomada incremental.
  - Erros encontrados (sem expor segredos ou tokens).
- **Proveniência e Idempotência (`source_records`):**
  - Os registros externos devem preservar o identificador único do fornecedor (`external_id`), o tipo de dataset, a origem (`provider_connection_id` / arquivo CSV) e a proveniência completa.
  - Constraint de unicidade por organização + fonte + identificador externo para garantir idempotência.
- **Identidades Externas (`external_identities`):**
  - Relaciona identificadores de usuários em ferramentas externas (ex.: e-mail/handle externo ou ID de assento) a um usuário interno (`users`), permitindo estados pendentes de revisão quando não houver correspondência exata.

## 4. Atividades Passo a Passo
- [x] Escrever a migração SQL criando `provider_connections`, `sync_runs`, `source_records` e `external_identities`.
- [x] Garantir chaves estrangeiras compostas vinculadas a `organization_id`.
- [x] Criar índices para busca por período, estado de sincronização e chave de idempotência.
- [x] Validar a migração antes de avançar para a próxima etapa.

## 5. Critérios de Conclusão
- [x] Tabelas criadas no PostgreSQL com isolamento multi-tenant.
- [x] Suporte a checkpoints, contagem de registros, proveniência e idempotência garantido pelo schema.
