# Tarefa 4.3 — Criar o Importador CSV e Fixtures

- **Épico:** Épico 04 — Criar o Framework de Conectores
- **Fase:** 4 (Framework de Conectores e Ingestão)
- **Dependências:** [Tarefa 4.1](./tarefa-4.1-definir-contrato-conectores.md), [Tarefa 4.2](./tarefa-4.2-implementar-worker-sincronizacao.md)
- **Módulos Afetados:** `packages/connectors`, `fixtures/csv/`, `apps/api`
- **Guia de Teste Manual:** [teste-manual-4.1-a-4.4-conectores-e-ingestao-csv.md](./testes-manuais/teste-manual-4.1-a-4.4-conectores-e-ingestao-csv.md)

## 1. Objetivo
Implementar o importador de arquivos CSV seguindo o contrato de conectores, permitindo ingerir dados financeiros e de licenças sem depender imediatamente de credenciais de APIs externas pagas.

## 2. Formatos Iniciais Suportados
1. **Custos de APIs (`api_costs`):**
   - Campos esperados: identificador externo da linha/fatura, provedor, modelo, período (início/fim), quantidade de consumo (tokens/unidades), moeda, valor monetário reportado, projeto/identificador externo opcional.
2. **Atribuições de Licenças (`license_assignments`):**
   - Campos esperados: identificador externo da atribuição, provedor/ferramenta, identificador do contrato/plano, e-mail ou handle externo do usuário, estado do assento, custo unitário, moeda, data de atribuição e data da última atividade observada.

## 3. Regras de Validação e Modo Dry Run
- **Validações Estritas:**
  - Validar formato de datas ISO / fuso horário.
  - Validar códigos de moedas ISO 4217 (ex.: `USD`, `BRL`).
  - Validar valores monetários como decimais válidos não corrompidos (`numeric`).
  - Validar presença de todos os campos obrigatórios e reportar linha e coluna exatas em caso de erro.
- **Modo `dryRun`:**
  - Quando executado com `dryRun: true`, o importador deve percorrer e validar todo o arquivo CSV, retornar o resumo de registros válidos e a lista detalhada de erros, **sem persistir nenhum dado no banco**.
- **Fixtures Sintéticas:**
  - Criar arquivos de exemplo válidos e inválidos em `fixtures/csv/` para ambos os formatos.

## 4. Atividades Passo a Passo
- [x] Implementar parser e validador CSV para **Custos de APIs** e **Atribuições de Licenças** em `packages/connectors`.
- [x] Implementar suporte ao parâmetro `dryRun: boolean`.
- [x] Criar fixtures em `fixtures/csv/` (ex.: `api-costs-valid.csv`, `api-costs-invalid.csv`, `licenses-valid.csv`, `licenses-invalid.csv`).
- [x] Expor endpoint administrativo em `apps/api` para upload/importação de CSV (com opção de `dryRun`).

## 5. Critérios de Conclusão
- [x] CSV válido de custos e de licenças é processado e persistido mantendo a origem.
- [x] CSV inválido retorna erros compreensíveis indicando linha e motivo da falha.
- [x] O modo `dryRun` valida o arquivo inteiro e não persiste registros no PostgreSQL.
- [x] Fixtures criadas em `fixtures/csv/`.
