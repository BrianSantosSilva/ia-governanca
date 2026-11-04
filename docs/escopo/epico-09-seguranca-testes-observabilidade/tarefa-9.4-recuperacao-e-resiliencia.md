# Tarefa 9.4 — Testes de Recuperação, Resiliência e Backup

- **Épico:** Épico 09 — Segurança, Testes e Observabilidade
- **Fase:** 9 (Hardening, Segurança, Observabilidade e Testes Finais)
- **Dependências:** [Tarefa 9.3 — Criar Suíte de Testes Automatizados](./tarefa-9.3-testes-automatizados-e2e.md)
- **Módulos Afetados:** `tests/integration/`, `apps/gateway`, `apps/worker`, `packages/database`, `README.md`

## 1. Objetivo
Testar e validar o comportamento do sistema diante de falhas de infraestrutura e comunicação, garantindo recuperação limpa sem corrupção de estado e sem duplicação silenciosa de registros financeiros.

## 2. Cenários de Falha e Recuperação Obrigatórios
Testar e documentar:
1. **Reinicialização do banco de dados:** Reconexão automática do pool PostgreSQL após queda/restart do contêiner.
2. **Interrupção de um worker:** Identificação de `sync_runs` interrompidas e retomada segura a partir do último checkpoint.
3. **Falha de um conector:** Tratamento de erro HTTP `5xx` / payload malformado registrando estado `failed` auditável em `sync_runs`.
4. **Timeout da LLM:** Comportamento do gateway quando o Ollama demora além do limite configurado (marcação do evento como `uncertain` sem fabricar métricas de tokens e tratamento seguro da reserva de orçamento).
5. **Erro na persistência do ledger:** Tratamento e log crítico estruturado caso ocorra falha ao persistir o evento após a inferência.
6. **Retomada de sincronizações:** Reexecução sem duplicar `source_records` ou `cost_records`.
7. **Backup e restauração do banco:** Procedimento testado de dump (`pg_dump`) e restore (`pg_restore` / `psql`) preservando a integridade de todo o ledger financeiro.

## 3. Atividades Passo a Passo
- [x] Implementar testes automatizados de resiliência simulando timeout da LLM, falha de conector, interrupção de worker e erro de persistência.
- [x] Criar e testar scripts/comandos de backup e restauração do PostgreSQL local.
- [x] Atualizar o `README.md` na raiz do projeto com instruções completas de inicialização do ambiente, execução de migrações e testes/backup/restore.
- [ ] Validar o checklist final de aceitação do protótipo completo (Seção 14 do `ProjetoA.yaml`).

## 4. Critérios de Conclusão (Fechamento do Épico 09 e do Protótipo)
- [x] O sistema identifica sincronizações interrompidas, preserva checkpoints e usa upsert/idempotência ao retomar.
- [x] Procedimento de backup e restauração do banco validado em banco descartável; contagens do ledger coincidiram.
- [ ] O checklist completo de aceitação do protótipo (Seção 14) ainda precisa de validação manual.
