# Tarefa 5.5 — Criar Teste de Integração Ponta a Ponta do Gateway

- **Épico:** Épico 05 — Implementar o Gateway LLM
- **Fase:** 5 (Gateway LLM Local)
- **Dependências:** [Tarefa 5.1](./tarefa-5.1-definir-api-inferencia.md), [Tarefa 5.2](./tarefa-5.2-implementar-adaptador-ollama.md), [Tarefa 5.3](./tarefa-5.3-criar-chaves-virtuais.md), [Tarefa 5.4](./tarefa-5.4-registrar-eventos-uso.md)
- **Módulos Afetados:** `tests/integration/`, `apps/gateway`, `apps/api`
- **Guia de Teste Manual:** [teste-manual-5.1-a-5.5-gateway-llm.md](./testes-manuais/teste-manual-5.1-a-5.5-gateway-llm.md)

## 1. Objetivo
Validar o fluxo completo do Gateway LLM integrando chave virtual, PostgreSQL e Ollama local, garantindo que uma chamada real de inferência percorra toda a arquitetura e deixe um registro rastreável.

## 2. Fluxo do Teste de Integração
Enviar uma chamada HTTP a `POST /v1/chat/completions` no gateway usando uma chave virtual válida e confirmar que:
1. A requisição é autenticada e chega ao **Ollama** local.
2. O modelo retorna uma resposta válida.
3. O gateway extrai os metadados de uso (tokens de entrada, tokens de saída e duração).
4. O evento é persistido corretamente na tabela `usage_events` no **PostgreSQL**.
5. O endpoint de consulta da API administrativa (que abastece o dashboard) consegue recuperar o evento registrado para a respectiva organização e projeto.

## 3. Atividades Passo a Passo
- [x] Criar o arquivo de teste `tests/integration/gateway-ollama.test.ts`.
- [x] Preparar seed de teste com organização, projeto e chave virtual ativa.
- [x] Disparar requisição real contra o `apps/gateway` integrado ao Ollama (`llama3.2`).
- [x] Verificar a resposta HTTP (`200 OK`), o registro persistido em `usage_events` no banco e o retorno da API de listagem de consumo.

## 4. Critérios de Conclusão (Fechamento do Épico 05)
- [x] A chamada percorre o gateway inteiro e deixa um registro rastreável no PostgreSQL.
- [x] Os metadados de tokens e latência reais do Ollama estão gravados em `usage_events`.
- [x] A API de consulta retorna o evento filtrando corretamente pelo tenant.
