# Tarefa 4.4 — Testar Idempotência e Retomada de Execução

- **Épico:** Épico 04 — Criar o Framework de Conectores
- **Fase:** 4 (Framework de Conectores e Ingestão)
- **Dependências:** [Tarefa 4.2](./tarefa-4.2-implementar-worker-sincronizacao.md), [Tarefa 4.3](./tarefa-4.3-criar-importador-csv.md)
- **Módulos Afetados:** `tests/integration/`, `packages/connectors`, `apps/worker`
- **Guia de Teste Manual:** [teste-manual-4.1-a-4.4-conectores-e-ingestao-csv.md](./testes-manuais/teste-manual-4.1-a-4.4-conectores-e-ingestao-csv.md)

## 1. Objetivo
Garantir por meio de testes automatizados de integração que a repetição de importações ou falhas no meio de uma sincronização não gerem duplicação de custos ou perda de rastreabilidade.

## 2. Cenários de Teste Obrigatórios
1. **Idempotência de Importação Dupla:**
   - Importar o mesmo arquivo CSV válido duas vezes seguidas para a mesma organização.
   - Confirmar que os registros em `source_records`, `cost_records` e `license_assignments` **não são duplicados** e que o total financeiro permanece exato.
2. **Simulação de Falha e Retomada via Checkpoint:**
   - Simular uma falha no meio do processamento de múltiplos lotes/linhas durante uma sincronização.
   - Verificar que `sync_runs` registra o erro e preserva o último checkpoint válido.
   - Reexecutar/retomar a sincronização a partir do checkpoint e validar que ao final todos os registros foram processados exatamente uma vez.
3. **Validação de Dry Run e Erros:**
   - Executar importação de CSV válido em modo `dryRun` e confirmar `0` registros inseridos no banco.
   - Executar importação de CSV inválido e confirmar que os erros são auditáveis e compreensíveis.

## 3. Atividades Passo a Passo
- [x] Criar suíte de testes `tests/integration/connectors-idempotency.test.ts`.
- [x] Implementar teste de importação duplicada dos arquivos de `fixtures/csv/`.
- [x] Implementar conector mock/simulador de falha parcial para testar retomada por checkpoint no worker.
- [x] Validar todos os critérios de conclusão da Etapa 4.

## 4. Critérios de Conclusão (Fechamento do Épico 04)
- [x] CSV válido é processado com sucesso.
- [x] CSV inválido retorna erros compreensíveis.
- [x] O modo de validação (`dryRun`) não persiste registros.
- [x] Uma execução interrompida pode ser retomada sem duplicar dados.
- [x] Os registros mantêm sua origem (`source_records`) e os erros são auditáveis em `sync_runs`.
