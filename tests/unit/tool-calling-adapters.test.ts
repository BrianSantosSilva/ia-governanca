import { describe, expect, it } from 'vitest';
import { ChatCompletionRequestSchema } from '@ia-governanca/contracts';
import { AzureOpenAIAdapter } from '../../apps/gateway/src/adapters/azure-openai-adapter.js';
import { OllamaAdapter } from '../../apps/gateway/src/adapters/ollama-adapter.js';

const tools = [
  {
    type: 'function' as const,
    function: { name: 'ler_arquivo', parameters: { type: 'object', properties: { caminho: { type: 'string' } } } },
  },
];
const messages = [{ role: 'user' as const, content: 'leia a.txt' }];

async function collect(stream: { chunks: AsyncIterable<unknown> }) {
  const chunks: Array<Record<string, unknown>> = [];
  for await (const chunk of stream.chunks) chunks.push(chunk as Record<string, unknown>);
  return chunks;
}

describe('tool calling nos adaptadores', () => {
  it('aceita ferramentas custom do Copilot CLI e as descarta antes do provedor', () => {
    const parsed = ChatCompletionRequestSchema.parse({
      model: 'm',
      messages,
      tools: [
        ...tools,
        { type: 'custom', custom: { name: 'apply_patch', format: { type: 'grammar' } } },
      ],
      tool_choice: { type: 'function', function: { name: 'ler_arquivo' } },
    });
    expect(parsed.tools).toEqual(tools);
    expect(parsed.droppedCustomTools).toBe(1);
    expect(parsed.tool_choice).toEqual({ type: 'function', function: { name: 'ler_arquivo' } });
  });

  it('Foundry repassa tools e devolve tool_calls com content nulo', async () => {
    let body: Record<string, unknown> | undefined;
    const adapter = new AzureOpenAIAdapter({
      endpoint: 'https://foundry.example.services.ai.azure.com/openai/v1',
      apiKey: 'synthetic-azure-key',
      fetchFn: async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    { id: 'call_1', type: 'function', function: { name: 'ler_arquivo', arguments: '{"caminho":"a.txt"}' } },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
          { status: 200 },
        );
      },
    });

    const result = await adapter.executeChatCompletion({
      model: 'Phi-4-mini-instruct',
      messages,
      tools,
      tool_choice: 'auto',
    });

    expect(adapter.supportsTools).toBe(true);
    expect(body).toMatchObject({ tools, tool_choice: 'auto' });
    expect(result.finishReason).toBe('tool_calls');
    expect(result.toolCalls).toEqual([
      { id: 'call_1', type: 'function', function: { name: 'ler_arquivo', arguments: '{"caminho":"a.txt"}' } },
    ]);
  });

  it('Foundry atende stream com tools por chamada única e emite tool_calls como deltas', async () => {
    let body: Record<string, unknown> | undefined;
    const adapter = new AzureOpenAIAdapter({
      endpoint: 'https://foundry.example.services.ai.azure.com/openai/v1',
      apiKey: 'synthetic-azure-key',
      fetchFn: async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    { id: 'call_1', type: 'function', function: { name: 'ler_arquivo', arguments: '{"caminho":"a.txt"}' } },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
            usage: { prompt_tokens: 8, completion_tokens: 2 },
          }),
          { status: 200 },
        );
      },
    });
    const stream = await adapter.openChatCompletionStream({ model: 'Phi-4-mini-instruct', messages, tools, stream: true });
    const chunks = await collect(stream);

    expect(body?.stream).toBe(false);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      done: true,
      finishReason: 'tool_calls',
      inputTokens: 8,
      outputTokens: 2,
      toolCallDeltas: [{ index: 0, id: 'call_1', name: 'ler_arquivo', arguments: '{"caminho":"a.txt"}' }],
    });
  });
  it('Ollama traduz o histórico de ferramentas e gera ids para tool_calls', async () => {
    let body: { messages: Array<Record<string, unknown>>; tools?: unknown } | undefined;
    const adapter = new OllamaAdapter({
      baseUrl: 'http://ollama.test',
      fetchFn: async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{ function: { name: 'ler_arquivo', arguments: { caminho: 'a.txt' } } }],
            },
            done: true,
            done_reason: 'stop',
            prompt_eval_count: 7,
            eval_count: 3,
          }),
          { status: 200 },
        );
      },
    });

    const result = await adapter.executeChatCompletion({
      model: 'llama3.1',
      messages: [
        ...messages,
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call_0', type: 'function', function: { name: 'ler_arquivo', arguments: '{"caminho":"b.txt"}' } },
          ],
        },
        { role: 'tool', tool_call_id: 'call_0', content: 'conteudo b' },
      ],
      tools,
    });

    expect(body?.tools).toEqual(tools);
    expect(body?.messages[1]).toMatchObject({
      role: 'assistant',
      tool_calls: [{ function: { name: 'ler_arquivo', arguments: { caminho: 'b.txt' } } }],
    });
    expect(body?.messages[2]).toMatchObject({ role: 'tool', tool_name: 'ler_arquivo', content: 'conteudo b' });
    expect(result.finishReason).toBe('tool_calls');
    expect(result.toolCalls?.[0]).toMatchObject({
      type: 'function',
      function: { name: 'ler_arquivo', arguments: '{"caminho":"a.txt"}' },
    });
    expect(result.toolCalls?.[0]?.id).toMatch(/^call_/);
  });
});
