# Tarefa 4.2 — Implementar o Worker de Sincronização

- **Épico:** Épico 04 — Criar o Framework de Conectores
- **Fase:** 4 (Framework de Conectores e Ingestão)
- **Dependências:** [Tarefa 4.1 — Definir o Contrato de Conectores](./tarefa-4.1-definir-contrato-conectores.md)
- **Módulos Afetados:** `apps/worker`, `packages/connectors`, `packages/database`
- **Guia de Teste Manual:** [teste-manual-4.1-a-4.4-conectores-e-ingestao-csv.md](./testes-manuais/teste-manual-4.1-a-4.4-conectores-e-ingestao-csv.md)

## 1. Objetivo
Implementar o motor de execução em background (`apps/worker`) responsável por orquestrar solicitações de sincronização, consultar os conectores, normalizar e persistir os registros com idempotência e resiliência a falhas.

## 2. Fluxo de Execução do Worker
Para cada solicitação de sincronização, o worker deverá:
1. **Receber a solicitação de sincronização** (contendo `organization_id`, `provider_connection_id` ou fonte CSV, dataset e período).
2. **Criar um registro em `sync_runs`** com estado inicial `running` e timestamp de início.
3. **Consultar o conector** paginando pelos lotes a partir do último checkpoint salvo (quando aplicável).
4. **Validar e normalizar os dados** contra os schemas de `packages/contracts`.
5. **Persistir os registros com idempotência** em `source_records` (e tabelas de domínio correspondentes como `cost_records` ou `license_assignments`).
6. **Atualizar o checkpoint** ao final de cada página/lote processado com sucesso.
7. **Registrar erros sem incluir segredos** (sanitizar headers, API keys e tokens antes de salvar mensagens de erro em `sync_runs`).
8. **Finalizar a execução com estado apropriado** (`completed`, `partial` ou `failed`), atualizando contadores e timestamp de término.

## 3. Requisitos de Resiliência
- **Timeouts:** Configurar timeout explícito por chamada externa.
- **Retries com Backoff Exponencial:** Repetir automaticamente falhas transitórias (ex.: `502`, `503`, timeouts de rede).
- **Respeito a Rate Limits:** Tratar respostas `429 Too Many Requests` (incluindo cabeçalho `Retry-After`).

## 4. Atividades Passo a Passo
- [x] Implementar o serviço de orquestração de sincronização em `apps/worker`.
- [x] Implementar utilitário de retry com backoff exponencial, timeout e tratamento de rate limit.
- [x] Implementar sanitizador de erros para garantir que credenciais nunca vazem para `sync_runs` ou logs.
- [x] Implementar persistência transacional por lote com atualização de checkpoint.

## 5. Critérios de Conclusão
- [x] O worker registra início, progresso (checkpoints), métricas de registros e término em `sync_runs`.
- [x] Timeouts, retries com backoff e limites de taxa estão implementados e testados.
- [x] Erros são registrados de forma auditável e sem vazamento de segredos.
