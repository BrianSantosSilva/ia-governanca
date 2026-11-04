# Tarefa 5.2 — Implementar o Adaptador Ollama

- **Épico:** Épico 05 — Implementar o Gateway LLM
- **Fase:** 5 (Gateway LLM Local)
- **Dependências:** [Tarefa 0.2](../epico-00-pre-requisitos/tarefa-0.2-validacao-llm-local-ollama.md), [Tarefa 5.1](./tarefa-5.1-definir-api-inferencia.md)
- **Módulos Afetados:** `apps/gateway`
- **Guia de Teste Manual:** [teste-manual-5.1-a-5.5-gateway-llm.md](./testes-manuais/teste-manual-5.1-a-5.5-gateway-llm.md)

## 1. Objetivo
Implementar o adaptador de inferência para o **Ollama**, conectando o Gateway LLM ao modelo local e extraindo as métricas reais de consumo de tokens e duração de geração.

## 2. Responsabilidades do Adaptador Ollama
O adaptador deve:
1. **Receber a requisição validada** do gateway.
2. **Converter o payload** do formato público do gateway para o formato da API do Ollama (`POST /api/chat` com `stream: false`).
3. **Executar a inferência local** utilizando `OLLAMA_BASE_URL` (padrão `http://localhost:11434`).
4. **Recuperar o conteúdo gerado e os metadados de uso** retornados pelo Ollama:
   - Tokens de entrada (`prompt_eval_count`).
   - Tokens de saída (`eval_count`).
   - Duração total / duração de avaliação (`total_duration`, convertendo de nanossegundos para milissegundos).
5. **Converter a resposta** para o formato público padronizado do gateway (`choices`, `usage: { prompt_tokens, completion_tokens, total_tokens }`).
6. **Retornar os metadados normalizados** para que o gateway registre o evento no ledger.

> [!IMPORTANT]
> Para a primeira versão, utilize exclusivamente **respostas sem streaming (`stream: false`)**. O suporte a streaming só deve ser considerado depois que todo o caminho síncrono e o cálculo financeiro estiverem validados.

## 3. Atividades Passo a Passo
- [x] Implementar a classe/módulo `OllamaAdapter` implementando `LLMProviderAdapter` em `apps/gateway`.
- [x] Mapear corretamente `prompt_eval_count` → `input_tokens` e `eval_count` → `output_tokens`.
- [x] Tratar erros de conectividade, modelo inexistente ou timeout do Ollama classificando se a chamada chegou a ser processada ou se o estado é incerto.
- [x] Criar testes unitários para a conversão de payload/resposta e tratamento de erros do adaptador.

## 4. Critérios de Conclusão
- [x] `OllamaAdapter` envia requisições reais ao Ollama local e converte a resposta para o contrato público do gateway.
- [x] Quantidade de tokens de entrada, tokens de saída e duração são extraídos com precisão da resposta do Ollama.
