import { describe, expect, it } from 'vitest';
import { AzureOpenAIAdapter } from '../../apps/gateway/src/adapters/azure-openai-adapter.js';

describe('AzureOpenAIAdapter', () => {
  it('chama o endpoint v1 com implantação, credencial e uso de tokens', async () => {
    let requestUrl = '';
    let requestHeaders: Headers | undefined;
    let requestBody: Record<string, unknown> | undefined;
    const adapter = new AzureOpenAIAdapter({
      endpoint: 'https://foundry.example.services.ai.azure.com/openai/v1/',
      apiKey: 'synthetic-azure-key',
      fetchFn: async (input, init) => {
        requestUrl = String(input);
        requestHeaders = new Headers(init?.headers);
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'resposta do Foundry' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 12, completion_tokens: 4 },
          }),
          { status: 200 },
        );
      },
    });

    const result = await adapter.executeChatCompletion({
      model: 'Phi-4-mini-instruct',
      messages: [{ role: 'user', content: 'diga oi' }],
      max_tokens: 32,
    });

    expect(requestUrl).toBe('https://foundry.example.services.ai.azure.com/openai/v1/chat/completions');
    expect(requestHeaders?.get('authorization')).toBe('Bearer synthetic-azure-key');
    expect(requestBody).toMatchObject({
      model: 'Phi-4-mini-instruct',
      stream: false,
      max_tokens: 32,
    });
    expect(result).toMatchObject({
      content: 'resposta do Foundry',
      inputTokens: 12,
      outputTokens: 4,
      finishReason: 'stop',
    });
  });

  it('converte SSE do Foundry em chunks e métricas de uso', async () => {
    const adapter = new AzureOpenAIAdapter({
      endpoint: 'https://foundry.example.services.ai.azure.com/openai/v1',
      apiKey: 'synthetic-azure-key',
      fetchFn: async () => new Response(
        [
          'data: {"choices":[{"delta":{"content":"stream "}}]}',
          'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}',
          'data: {"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":2}}',
          'data: [DONE]',
          '',
        ].join('\n\n'),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ),
    });
    const stream = await adapter.openChatCompletionStream({
      model: 'Phi-4-mini-instruct',
      messages: [{ role: 'user', content: 'diga oi' }],
    });
    const chunks = [];
    for await (const chunk of stream.chunks) chunks.push(chunk);

    expect(chunks).toMatchObject([
      { content: 'stream ', done: false },
      { content: 'ok', done: true, finishReason: 'stop' },
      { content: '', done: false, inputTokens: 8, outputTokens: 2 },
    ]);
  });

  it('não inclui credenciais em erros de autenticação', async () => {
    const adapter = new AzureOpenAIAdapter({
      endpoint: 'https://foundry.example.services.ai.azure.com/openai/v1',
      apiKey: 'synthetic-azure-key',
      fetchFn: async () => new Response('secret details', { status: 401 }),
    });

    await expect(
      adapter.executeChatCompletion({
        model: 'Phi-4-mini-instruct',
        messages: [{ role: 'user', content: 'diga oi' }],
      }),
    ).rejects.toMatchObject({ code: 'AZURE_OPENAI_AUTH_ERROR', statusCode: 401 });
  });
});
