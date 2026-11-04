# Tarefa 6.1 — Criar o Catálogo de Preços Versionado

- **Épico:** Épico 06 — Implementar Custos e Orçamento
- **Fase:** 6 (Ledger Financeiro e Políticas de Orçamento)
- **Dependências:** [Tarefa 2.4](../epico-02-dominio-e-banco-de-dados/tarefa-2.4-gateway-e-financas.md)
- **Módulos Afetados:** `packages/finance`, `packages/database`, `apps/api`

## 1. Objetivo
Implementar o gerenciamento e a consulta do catálogo de preços versionado (`model_prices`), permitindo reproduzir fielmente o cálculo de custos em qualquer ponto do tempo e distinguir tarifas reais de estimativas de simulação.

## 2. Estrutura do Catálogo de Preços (`model_prices`)
Cada registro de preço deve identificar obrigatoriamente:
1. **Provedor** (`provider`, ex.: `ollama`, `google-gemini`, `openai`)
2. **Modelo** (`model`, ex.: `llama3.2`, `gemini-2.0-flash`)
3. **Moeda** (`currency`, ex.: `USD`, `BRL`)
4. **Preço por unidade de consumo** (ex.: preço por 1 milhão de tokens de entrada e por 1 milhão de tokens de saída, armazenado em `numeric`)
5. **Início e fim de validade** (`effective_from`, `effective_to` com `timestamptz`)
6. **Origem do preço** (`price_source`, ex.: `official_pricing_table`, `internal_simulation`, `custom_contract`)
7. **Tipo de preço** (`price_type`, ex.: `commercial_api_tariff`, `internal_estimate`, `simulation`)

> [!IMPORTANT]
> Os preços configurados para o **Ollama** serão classificados explicitamente como **estimativas internas ou dados de simulação (`internal_estimate` / `simulation`)**, e **nunca** como tarifas reais de API comercial.

## 3. Atividades Passo a Passo
- [ ] Implementar repositório e serviço de resolução de preço vigente por `(provider, model, timestamp)` em `packages/finance`.
- [ ] Impedir sobreposição de janelas de validade (`effective_from` / `effective_to`) conflitantes para o mesmo modelo, provedor e tipo de preço.
- [ ] Criar seed inicial com preços simulados para o modelo local do Ollama (`llama3.2`) e tabelas de referência para testes.
- [ ] Expor endpoints em `apps/api` para consulta e cadastro de versões de preços (restrito aos papéis `owner`, `admin` e `finops`).

## 4. Critérios de Conclusão
- [ ] Preços são versionados com vigência temporal (`effective_from` / `effective_to`).
- [ ] O serviço resolve de forma determinística qual versão de preço estava vigente no instante de um `usage_event`.
- [ ] Preços do Ollama estão classificados como simulação/estimativa interna.
