# Tarefa 7.1 — Integração com API Oficial de Custos

- **Épico:** Épico 07 — Implementar Integrações Externas
- **Fase:** 7 (Integrações Externas)
- **Dependências:** [Épico 04](../epico-04-framework-conectores/tarefa-4.4-testar-idempotencia-e-retomada.md), [Épico 05](../epico-05-gateway-llm/tarefa-5.5-teste-integracao-gateway.md), [Épico 06](../epico-06-custos-e-orcamento/tarefa-6.4-implementar-politicas-orcamento.md)
- **Módulos Afetados:** `packages/connectors`, `apps/worker`, `fixtures/json/`

## 1. Objetivo
Implementar um conector para coleta de dados administrativos de uso/custos de um provedor externo (ou validação completa via fixture realista gravada quando não houver conta comercial autorizada no ambiente local).

> [!IMPORTANT]
> Esta etapa só deve ocorrer depois que o gateway e o ledger financeiro estiverem funcionando localmente e validados com dados sintéticos.

## 2. Requisitos do Conector de Custos Externos
Implementar no conector:
1. **Configuração de credenciais** (armazenadas de forma segura, nunca em texto puro nos logs ou retornos da API).
2. **Verificação de acesso** (`validateConnection`).
3. **Coleta por período** (`periodStart`, `periodEnd`).
4. **Paginação** completa.
5. **Persistência da origem** (`source_records` com `external_id` e metadados do provedor).
6. **Atualização incremental** por meio de checkpoints em `sync_runs`.
7. **Tratamento de limites de taxa** (`429` / backoff).
8. **Acionamento da reconciliação** com os registros internos do gateway.

> [!NOTE]
> Não presumir que uma API externa de uso ofereça sempre o custo final faturado, os identificadores de usuários individuais ou todos os períodos históricos. Essas capacidades variam por provedor e plano contratado, e o conector deve lidar com campos opcionais sem fabricar dados.

## 3. Atividades Passo a Passo
- [ ] Implementar o conector de API oficial de custos em `packages/connectors`.
- [ ] Criar fixtures JSON realistas em `fixtures/json/` representando respostas paginadas, erros de autenticação (`401`/`403`) e rate limit (`429`) da API externa.
- [ ] Integrar a execução do conector ao `apps/worker` e ao fluxo de reconciliação (`packages/finance`).
- [ ] Validar reexecução sem duplicação de registros.

## 4. Critérios de Conclusão
- [ ] Conector implementado com suporte a paginação, checkpoint incremental, rate limit e reconciliação.
- [ ] Proveniência e período original são preservados em `source_records` e `cost_records`.
