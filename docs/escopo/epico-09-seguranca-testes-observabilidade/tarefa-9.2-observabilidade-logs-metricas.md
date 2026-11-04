# Tarefa 9.2 — Implementar Observabilidade (Logs Estruturados e Métricas)

- **Épico:** Épico 09 — Segurança, Testes e Observabilidade
- **Fase:** 9 (Hardening, Segurança, Observabilidade e Testes Finais)
- **Dependências:** [Tarefa 9.1 — Implementar e Validar Controles de Segurança](./tarefa-9.1-seguranca-e-protecao-dados.md)
- **Módulos Afetados:** `apps/gateway`, `apps/api`, `apps/worker`

## 1. Objetivo
Implementar logs estruturados em JSON e coleta de métricas operacionais para permitir o diagnóstico rápido de falhas, latência e gargalos no gateway e nos workers.

## 2. Campos Obrigatórios nos Logs Estruturados
Todo log operacional relevante deve ser emitido em formato estruturado contendo:
1. `request_id` (identificador único de correlação da requisição/job)
2. **Organização** (`organization_id`)
3. **Projeto** (`project_id`)
4. **Provedor** (`provider`)
5. **Estado da operação** (`status`)
6. **Duração** (`duration_ms`)
7. **Código de erro** (`error_code`, quando houver falha)

## 3. Métricas Operacionais Obrigatórias
Instrumentar e expor métricas para:
- **Taxa e contagem de falhas do gateway** (por provedor, modelo e tipo de erro).
- **Latência das chamadas** do gateway e do provedor LLM.
- **Volume de chamadas** (total de requisições e tokens processados).
- **Execução dos workers** (sincronizações iniciadas, concluídas, falhas, duração e registros ingeridos).

## 4. Atividades Passo a Passo
- [x] Padronizar o logger estruturado (Pino no Fastify e JSON no worker) com contexto (`request_id`, `organization_id`, `project_id`, `provider`, `status`, `duration_ms`, `error_code`).
- [x] Implementar endpoint de métricas e healthchecks (`/health`, `/metrics`) em `apps/gateway`, `apps/api` e `apps/worker`.
- [x] Validar por testes que erros operacionais geram resultados/contadores rastreáveis pelo `request_id`.

## 5. Critérios de Conclusão
- [x] Logs estruturados incluem todos os 7 atributos obrigatórios.
- [x] Métricas de falha do gateway, latência, volume de chamadas e execução dos workers estão ativas e consultáveis.
