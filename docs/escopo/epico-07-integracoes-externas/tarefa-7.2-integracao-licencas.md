# Tarefa 7.2 — Integração de Licenças e Assentos Corporativos

- **Épico:** Épico 07 — Implementar Integrações Externas
- **Fase:** 7 (Integrações Externas)
- **Dependências:** [Tarefa 2.3](../epico-02-dominio-e-banco-de-dados/tarefa-2.3-licencas.md), [Tarefa 4.2](../epico-04-framework-conectores/tarefa-4.2-implementar-worker-sincronizacao.md)
- **Módulos Afetados:** `packages/connectors`, `apps/worker`, `apps/api`, `fixtures/json/`

## 1. Objetivo
Implementar um conector para uma plataforma que disponibilize informações sobre assentos/licenças atribuídas (ex.: GitHub Copilot, ChatGPT Enterprise/Team, Cursor ou fixture equivalente) e relacionar os registros com as identidades corporativas da organização.

## 2. Regras de Negócio e Mapeamento de Identidade
- **Preservação do Identificador Externo:** O conector deverá preservar sempre o identificador externo do assento/usuário (`external_identities` e `source_records`).
- **Relacionamento com Identidade Corporativa:** Tentar relacionar o identificador externo com o usuário corporativo correspondente (`users` / `memberships` da mesma organização) usando chave determinística confiável (ex.: e-mail corporativo verificado ou vínculo explícito já cadastrado em `external_identities`).
- **Proibição de Associação por Aproximação:**
  > [!WARNING]
  > Registros sem correspondência exata devem ser **marcados com estado pendente de revisão (`pending_review`)**, em vez de serem associados automaticamente a uma pessoa por aproximação (fuzzy matching de nome ou heurística incerta).
- **Detecção de Assentos Sem Atividade:** Preservar `last_activity_at` (quando fornecido pela fonte) para permitir que o dashboard aponte licenças atribuídas e sem atividade observada no período.

## 3. Atividades Passo a Passo
- [ ] Implementar o conector de licenças/assentos em `packages/connectors` e respectivas fixtures em `fixtures/json/`.
- [ ] Implementar o serviço de resolução de `external_identities` com marcação `pending_review` para identidades não mapeadas.
- [ ] Criar endpoint em `apps/api` para listar identidades pendentes de revisão e permitir associação manual auditada por um administrador.
- [ ] Testar a ingestão repetida garantindo idempotência.

## 4. Critérios de Conclusão
- [ ] Assentos e atribuições de licenças são ingeridos preservando o identificador externo.
- [ ] Identidades sem correspondência exata ficam marcadas para revisão (`pending_review`) sem associação automática por aproximação.
- [ ] Dados de última atividade observada são preservados para análise de ociosidade.
