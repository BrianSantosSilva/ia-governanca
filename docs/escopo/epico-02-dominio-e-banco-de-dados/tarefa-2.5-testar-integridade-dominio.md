# Tarefa 2.5 — Testes de Integridade do Domínio e Isolamento

- **Épico:** Épico 02 — Implementar o Domínio e o Banco de Dados
- **Fase:** 2 (Banco de Dados e Domínio)
- **Dependências:** [Tarefa 2.1](./tarefa-2.1-organizacoes-e-identidade.md), [Tarefa 2.2](./tarefa-2.2-conectores-e-ingestao.md), [Tarefa 2.3](./tarefa-2.3-licencas.md), [Tarefa 2.4](./tarefa-2.4-gateway-e-financas.md)
- **Módulos Afetados:** `tests/integration/`, `packages/database`
- **Guia de Teste Manual:** [teste-manual-2.1-a-2.5-migracoes-e-integridade.md](./testes-manuais/teste-manual-2.1-a-2.5-migracoes-e-integridade.md)

## 1. Objetivo
Validar com testes automatizados contra uma instância real do PostgreSQL que todas as regras de integridade referencial, isolamento multi-tenant, preservação histórica e reprodutibilidade das migrações funcionam conforme especificado.

## 2. Cenários de Teste Obrigatórios
1. **Criação de Organização e Projeto:** Criar uma organização e um projeto vinculado a ela com sucesso.
2. **Associação de Equipe ao Projeto:** Criar uma equipe na mesma organização e associá-la ao projeto.
3. **Criação de Usuário e Membership:** Criar um usuário e associá-lo à organização com um papel válido.
4. **Bloqueio Cross-Tenant (Equipe/Usuário):** Tentar associar um usuário ou projeto a uma equipe pertencente a outra organização e confirmar que o banco rejeita a operação.
5. **Bloqueio Cross-Tenant (Chave Virtual):** Tentar criar/vincular uma chave virtual de uma organização a um projeto de outro tenant e confirmar que a constraint impede a operação.
6. **Preservação do Histórico Financeiro:** Garantir que a remoção lógica (ou desativação) de um usuário/chave virtual não apague os registros em `usage_events` e `cost_records`.
7. **Reprodutibilidade de Migrações:** Reexecutar o ciclo completo de migrações em um banco de dados vazio (ou schema de teste limpo) e verificar que o schema final é idêntico e íntegro.

## 3. Atividades Passo a Passo
- [x] Configurar suíte de testes de integração de banco em `tests/integration/database-integrity.test.ts`.
- [x] Implementar cada um dos 7 cenários de teste usando transações reais no PostgreSQL.
- [x] Executar `npm test` e garantir 100% de aprovação.

## 4. Critérios de Conclusão (Fechamento do Épico 02)
- [x] O domínio básico pode ser criado e consultado por meio de transações reais no PostgreSQL.
- [x] Todos os 7 cenários de integridade e isolamento multi-tenant passam nos testes automatizados.
