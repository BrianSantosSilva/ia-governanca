# Tarefa 0.2 — Instalação e Validação da LLM Local (Ollama)

- **Épico:** Épico 00 — Pré-requisitos e Validação da LLM Local
- **Fase:** 0 (Pré-requisito Obrigatório)
- **Dependências:** [Tarefa 0.1 — Instalação e Validação dos Softwares Base](./tarefa-0.1-instalacao-softwares-base.md)
- **Guia de Teste Manual:** [teste-manual-0.2-ollama-llm-local.md](./testes-manuais/teste-manual-0.2-ollama-llm-local.md)

## 1. Objetivo
Instalar e validar o Ollama localmente com um modelo funcional antes de implementar o gateway. O protótipo utilizará a LLM local para gerar chamadas reais, receber metadados de uso (tokens de entrada/saída e duração) e validar o fluxo financeiro sem pagar por tokens.

> [!IMPORTANT]
> Não avance para a implementação do gateway enquanto esta validação não estiver concluída.

## 2. Procedimento Técnico

1. Acesse https://ollama.com/download e instale a versão correspondente ao sistema operacional.
2. Abra um terminal e baixe o modelo inicial:
   ```bash
   ollama pull llama3.2
   ```
   *(Observação: Caso o hardware não suporte confortavelmente o modelo escolhido, selecione um modelo menor disponível no catálogo do Ollama).*
3. Execute o modelo interativamente e faça uma pergunta simples para validar:
   ```bash
   ollama run llama3.2
   ```
4. Saia da sessão interativa e teste a API HTTP local:
   ```bash
   curl http://localhost:11434/api/chat \
     -H "Content-Type: application/json" \
     -d '{
       "model": "llama3.2",
       "messages": [
         {
           "role": "user",
           "content": "Responda apenas: ambiente local funcionando"
         }
       ],
       "stream": false
     }'
   ```
5. Inspecione o retorno JSON da API e confirme a presença das métricas de uso (`prompt_eval_count`, `eval_count`, `total_duration`, etc.), conforme documentação oficial: https://github.com/ollama/ollama/blob/main/docs/api.md.

## 3. Critérios de Conclusão
- [x] O Ollama está instalado (`v0.40.5`).
- [x] O modelo (`llama3.2`) foi baixado (2.0 GB verificados).
- [x] A inferência funciona localmente.
- [x] A API local responde em `http://localhost:11434`.
- [x] A resposta JSON inclui os metadados de uso esperados (`prompt_eval_count: 34`, `eval_count: 9`, `total_duration: 35544711200`).
