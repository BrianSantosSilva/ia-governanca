# Guia de Teste Manual — Tarefa 10.6: Streaming do Gateway

- **Épico:** Épico 10 — Melhorias Iniciais
- **Tarefa Relacionada:** [Tarefa 10.6 — Suportar Respostas em Streaming no Gateway](../tarefa-10.6-suporte-streaming-gateway.md)
- **Ambiente:** Windows (PowerShell na raiz `C:\Projetos\EstudoIA\ia-governanca`)

> [!WARNING]
> Use uma chave virtual de teste e prompts sintéticos. Não compartilhe chaves. Não execute testes automatizados que reconstroem o schema no banco com dados que deseja preservar.

## 1. Pré-requisitos

- Ambiente iniciado conforme o `README.md`; Gateway, PostgreSQL e Ollama estão saudáveis.
- Chave virtual ativa autorizada para o modelo de teste.
- Modelo local disponível e um cliente HTTP capaz de ler uma conexão SSE sem bufferizar toda a resposta.
- Streaming nativo está disponível para Ollama; provedores sem adaptador de stream retornam `501 streaming_not_supported` antes de abrir o fluxo.

## 2. Confirmar que o modo não-streaming continua funcionando

Envie uma chamada ao endpoint `POST http://localhost:3002/v1/chat/completions` com `stream = $false`, usando a chave de teste e uma mensagem sintética. Confirme:

- resposta JSON completa;
- texto em `choices[0].message.content`;
- campos de uso quando fornecidos pelo modelo;
- registro de uso e custo no dashboard/ledger.

## 3. Validar o fluxo SSE

Envie a mesma chamada com `stream = $true` usando um cliente que não acumule a resposta inteira. Para uma validação manual, pode-se usar `curl.exe` do Windows:

```powershell
curl.exe -N "http://localhost:3002/v1/chat/completions" `
  -H "Authorization: Bearer <CHAVE_VIRTUAL_DE_TESTE>" `
  -H "Content-Type: application/json" `
  -H "Accept: text/event-stream" `
  -d "{\"model\":\"llama3.2\",\"messages\":[{\"role\":\"user\",\"content\":\"Escreva uma frase curta, palavra por palavra.\"}],\"max_tokens\":40,\"stream\":true,\"stream_options\":{\"include_usage\":true}}"
```

Confirme que os dados chegam em múltiplos eventos `data:` antes da geração terminar, o tipo de conteúdo é `text/event-stream`, os chunks usam o formato documentado e o fluxo encerra com o marcador `[DONE]`. O chunk final deve incluir os tokens porque a chamada solicita `stream_options.include_usage`; sem essa opção, o Gateway não envia o campo de uso. Se os chunks só aparecerem todos juntos no final, a resposta está bufferizada e o critério de streaming progressivo não foi atendido.

## 4. Validar governança e falhas

1. Crie uma política de orçamento `block` com limite abaixo do custo de reserva esperado e faça uma chamada em streaming. Ela deve ser rejeitada com HTTP `429` antes de abrir o fluxo SSE.
2. Repita com chave revogada/inválida; a requisição deve ser negada antes de qualquer chunk.
3. Inicie uma geração longa e encerre a conexão do cliente. Confirme que o Gateway cancela o provedor quando possível e que o evento/reserva termina em estado consistente, sem marcar sucesso completo indevidamente.
4. Simule timeout ou indisponibilidade do Ollama. Confirme que o ledger registra falha/incerteza corretamente e que o servidor libera recursos.
5. Confira logs do Gateway e API: nenhum prompt ou resposta deve aparecer. A política de captura da tarefa 10.2 deve continuar independente do streaming; quando habilitada, `store: true` autoriza captura e o chunk final informa `content_capture`.

## 5. Conferir uso e custos

Após uma resposta completa, abra **Consumo de APIs** e **Custos**. Compare tokens, status e custo com os metadados finais fornecidos pelo Ollama. Se a contagem final não estiver disponível, confirme que o sistema a marca como indisponível/incerta em vez de inventar valores.

### Critérios de conclusão do roteiro

- [ ] `stream: false` mantém o comportamento JSON existente.
- [ ] `stream: true` retorna SSE progressivo e termina corretamente com `[DONE]`.
- [ ] Autenticação, rate limit e orçamento são aplicados antes do início da transmissão.
- [ ] Desconexão e timeout não produzem sucesso financeiro falso nem deixam reservas órfãs.
- [ ] Uso/custo final é reconciliado com metadados confiáveis.
- [ ] Logs não contêm prompt ou resposta.
