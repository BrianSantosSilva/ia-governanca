# Tarefa 6.2 — Implementar Motor de Cálculo de Custos

- **Épico:** Épico 06 — Implementar Custos e Orçamento
- **Fase:** 6 (Ledger Financeiro e Políticas de Orçamento)
- **Dependências:** [Tarefa 5.4](../epico-05-gateway-llm/tarefa-5.4-registrar-eventos-uso.md), [Tarefa 6.1](./tarefa-6.1-criar-catalogo-precos.md)
- **Módulos Afetados:** `packages/finance`, `apps/gateway`

## 1. Objetivo
Implementar o motor determinístico de cálculo de custos em `packages/finance` utilizando aritmética decimal exata e vinculando cada registro de custo (`cost_records`) à versão exata do preço utilizada.

## 2. Regras de Cálculo Financeiro
- **Fórmula Básica para Modelos Tarifados por Tokens:**
  $$\text{custo} = \left(\frac{\text{tokens de entrada}}{1.000.000} \times \text{preço de entrada por 1M}\right) + \left(\frac{\text{tokens de saída}}{1.000.000} \times \text{preço de saída por 1M}\right)$$
- **Unidade Consistente:** Os preços devem ser expressos por unidade consistente (ex.: por milhão de tokens).
- **Aritmética Decimal:** O cálculo deve utilizar **aritmética decimal exata** (ex.: `decimal.js` / `big.js` no TypeScript e `numeric` no PostgreSQL), evitando erros de ponto flutuante IEEE 754 (`number` nativo do JS).
- **Rastreabilidade da Versão do Preço:** Cada registro gerado em `cost_records` deve gravar a chave estrangeira `model_price_id` correspondente à versão do preço utilizada no cálculo.
- **Recursos Adicionais (Cache, Imagens, Áudio, Ferramentas):** Quando o fornecedor cobrar por cache, imagens, áudio, ferramentas ou outros recursos, o cálculo deverá incluir essas categorias **somente quando os metadados necessários estiverem disponíveis** no evento.

## 3. Atividades Passo a Passo
- [ ] Implementar a função pura e determinística de cálculo de custo em `packages/finance` com aritmética decimal.
- [ ] Integrar a geração do registro em `cost_records` logo após o registro de `usage_events` no gateway.
- [ ] Garantir que o cálculo possa ser reexecutado/reproduzido a qualquer momento a partir do `usage_event` e do `model_price_id` associado.
- [ ] Criar bateria de testes unitários cobrindo valores pequenos (frações de centavo), grandes volumes de tokens e categorias adicionais.

## 4. Critérios de Conclusão
- [ ] O custo calculado utiliza aritmética decimal sem perda de precisão.
- [ ] Cada custo estimado registra a versão exata do preço (`model_price_id`) e a moeda original.
- [ ] O custo de qualquer evento pode ser integralmente reproduzido e auditado.
