# Tarefa 4.1 — Definir o Contrato de Conectores

- **Épico:** Épico 04 — Criar o Framework de Conectores
- **Fase:** 4 (Framework de Conectores e Ingestão)
- **Dependências:** [Tarefa 2.2](../epico-02-dominio-e-banco-de-dados/tarefa-2.2-conectores-e-ingestao.md)
- **Módulos Afetados:** `packages/connectors`, `packages/contracts`
- **Guia de Teste Manual:** [teste-manual-4.1-a-4.4-conectores-e-ingestao-csv.md](./testes-manuais/teste-manual-4.1-a-4.4-conectores-e-ingestao-csv.md)

## 1. Objetivo
Definir a interface TypeScript padronizada e os contratos Zod para qualquer conector de dados externos (APIs oficiais ou importadores de arquivos), desacoplando a coleta/extração da persistência no banco de dados.

## 2. Especificação da Interface do Conector
A interface TypeScript em `packages/connectors` deve contemplar obrigatoriamente:
1. **Identificação do provedor:** Nome/slug do provedor e versão do conector.
2. **Datasets suportados:** Tipos de dados coletados (ex.: `api_costs`, `usage_records`, `license_assignments`).
3. **Validação de conexão:** Método `validateConnection()` para verificar credenciais ou estrutura da fonte antes de iniciar a coleta.
4. **Método de coleta paginada:** Iterador assíncrono ou método paginado que recebe período (`periodStart`, `periodEnd`) e checkpoint anterior.
5. **Checkpoints:** Estrutura opaca/tipada de cursor ou página para permitir retomada incremental.
6. **Avisos e erros:** Retorno estruturado de warnings e erros de validação/coleta por lote ou registro.
7. **Identificadores externos:** Preservação obrigatória de `externalId`, período de referência e metadados de proveniência em cada item retornado.

> [!IMPORTANT]
> **Regra de Arquitetura:** O conector **não deve gravar diretamente no banco de dados**. O serviço de ingestão/worker será o único responsável pela persistência transacional.

## 3. Atividades Passo a Passo
- [x] Definir schemas Zod para registros normalizados de entrada (`NormalizedCostRecord`, `NormalizedLicenseAssignment`, `ConnectorCheckpoint`, `ConnectorWarning`, `ConnectorError`) em `packages/contracts`.
- [x] Criar a interface `DataConnector` e tipos associados em `packages/connectors`.
- [x] Criar um registry de conectores para resolução dinâmica pelo tipo de provedor.

## 4. Critérios de Conclusão
- [x] Interface `DataConnector` e contratos Zod definidos e exportados sem erros de compilação.
- [x] Nenhum acoplamento direto com `pg` / `packages/database` dentro dos conectores puros.
