import { ChatCompletionRequestSchema, CreateVirtualKeyInputSchema } from '@ia-governanca/contracts';
import {
  extractKeyPrefix,
  generateVirtualKey,
  hashVirtualKey,
  verifyVirtualKey,
} from '@ia-governanca/identity';
import {
  evaluateBudgetPolicy,
  evaluateRateLimit,
  evaluateVirtualKeyPolicy,
} from '@ia-governanca/policies';
import { describe, expect, it } from 'vitest';
import { OllamaAdapter } from '../../apps/gateway/src/adapters/ollama-adapter.js';
import { ProviderAdapterError } from '../../apps/gateway/src/types.js';

describe('Épico 05 — Chaves virtuais, políticas e adaptador Ollama (unitário)', () => {
  it('exige exatamente um alvo compatível com o escopo da chave virtual', () => {
    const projectId = '00000000-0000-4000-8000-000000000003';
    const teamId = '00000000-0000-4000-8000-000000000004';
    const userId = '00000000-0000-4000-8000-000000000005';
    expect(CreateVirtualKeyInputSchema.safeParse({ name: 'Projeto', scopeType: 'project', projectId }).success).toBe(true);
    expect(CreateVirtualKeyInputSchema.safeParse({ name: 'Equipe', scopeType: 'team', teamId }).success).toBe(true);
    expect(CreateVirtualKeyInputSchema.safeParse({ name: 'Pessoa', scopeType: 'user', userId }).success).toBe(true);
    expect(CreateVirtualKeyInputSchema.safeParse({ name: 'Inválida', scopeType: 'team', teamId, projectId }).success).toBe(false);
    expect(CreateVirtualKeyInputSchema.safeParse({ name: 'Sem alvo', scopeType: 'user' }).success).toBe(false);
  });

  it('deve gerar chave com prefixo visível, persistir apenas hash e comparar em tempo constante', () => {
    const generated = generateVirtualKey();

    expect(generated.apiKey.startsWith('aisp_live_')).toBe(true);
    expect(generated.keyPrefix).toBe(extractKeyPrefix(generated.apiKey));
    expect(generated.keyHash).toBe(hashVirtualKey(generated.apiKey));
    expect(generated.keyHash).toHaveLength(64);
    expect(generated.keyHash).not.toContain(generated.apiKey);

    expect(verifyVirtualKey(generated.apiKey, generated.keyHash)).toBe(true);
    expect(verifyVirtualKey(`${generated.apiKey}x`, generated.keyHash)).toBe(false);
    expect(verifyVirtualKey('', generated.keyHash)).toBe(false);
  });

  it('deve rejeitar payload de chat inválido e aceitar o contrato OpenAI básico', () => {
    const invalid = ChatCompletionRequestSchema.safeParse({
      model: '',
      messages: [],
      stream: true,
    });
    expect(invalid.success).toBe(false);

    const valid = ChatCompletionRequestSchema.safeParse({
      model: 'llama3.2',
      messages: [{ role: 'user', content: 'olá' }],
      temperature: 0.2,
      max_tokens: 32,
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(valid.success).toBe(true);
  });

  it('deve validar o protocolo de chamada de ferramentas', () => {
    const tools = [
      { type: 'function', function: { name: 'ler_arquivo', parameters: { type: 'object' } } },
    ];
    const call = { id: 'call_1', type: 'function', function: { name: 'ler_arquivo', arguments: '{}' } };
    const base = { model: 'm', tools, tool_choice: 'auto' };

    const valid = ChatCompletionRequestSchema.safeParse({
      ...base,
      messages: [
        { role: 'user', content: 'leia' },
        { role: 'assistant', content: null, tool_calls: [call] },
        { role: 'tool', tool_call_id: 'call_1', content: 'conteúdo' },
      ],
    });
    expect(valid.success).toBe(true);

    const orphanResult = ChatCompletionRequestSchema.safeParse({
      ...base,
      messages: [
        { role: 'user', content: 'leia' },
        { role: 'tool', tool_call_id: 'call_x', content: 'x' },
      ],
    });
    expect(orphanResult.success).toBe(false);

    const emptyAssistant = ChatCompletionRequestSchema.safeParse({
      model: 'm',
      messages: [{ role: 'assistant', content: null }],
    });
    expect(emptyAssistant.success).toBe(false);

    const choiceWithoutTools = ChatCompletionRequestSchema.safeParse({
      model: 'm',
      messages: [{ role: 'user', content: 'oi' }],
      tool_choice: 'auto',
    });
    expect(choiceWithoutTools.success).toBe(false);

    const unknownChoice = ChatCompletionRequestSchema.safeParse({
      ...base,
      tool_choice: { type: 'function', function: { name: 'outra' } },
      messages: [{ role: 'user', content: 'oi' }],
    });
    expect(unknownChoice.success).toBe(false);
  });

  it('deve bloquear chaves revogadas, expiradas ou fora de escopo/modelo/provedor', () => {
    const baseKey = {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'dev-key',
      organizationId: '00000000-0000-0000-0000-000000000002',
      projectId: '00000000-0000-0000-0000-000000000003',
      allowedProviders: ['ollama'],
      allowedModels: ['llama3.2'],
      scopes: ['chat:completions'],
      expiresAt: null as Date | null,
      revokedAt: null as Date | null,
    };

    expect(
      evaluateVirtualKeyPolicy(baseKey, {
        provider: 'ollama',
        model: 'llama3.2',
        requiredScope: 'chat:completions',
      }).allowed,
    ).toBe(true);

    expect(
      evaluateVirtualKeyPolicy(
        { ...baseKey, revokedAt: new Date() },
        { provider: 'ollama', model: 'llama3.2' },
      ).reason,
    ).toBe('revoked');

    expect(
      evaluateVirtualKeyPolicy(
        { ...baseKey, expiresAt: new Date(Date.now() - 1000) },
        { provider: 'ollama', model: 'llama3.2' },
      ).reason,
    ).toBe('expired');

    expect(
      evaluateVirtualKeyPolicy(baseKey, { provider: 'gemini', model: 'llama3.2' }).reason,
    ).toBe('provider_not_allowed');

    expect(
      evaluateVirtualKeyPolicy(baseKey, { provider: 'ollama', model: 'gpt-4o' }).reason,
    ).toBe('model_not_allowed');

    expect(
      evaluateVirtualKeyPolicy(baseKey, {
        provider: 'ollama',
        model: 'llama3.2',
        requiredScope: 'embeddings',
      }).reason,
    ).toBe('scope_not_allowed');
  });

  it('deve aplicar rate limit da chave e deixar o orçamento autorizado no Épico 05', () => {
    expect(evaluateRateLimit(4, 5).allowed).toBe(true);
    expect(evaluateRateLimit(5, 5).reason).toBe('rate_limit_exceeded');
    expect(evaluateRateLimit(99, null).allowed).toBe(true);
    expect(evaluateBudgetPolicy().allowed).toBe(true);
  });

  it('deve converter payload/resposta do Ollama e extrair tokens e duração', async () => {
    const adapter = new OllamaAdapter({
      baseUrl: 'http://ollama.test',
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            model: 'llama3.2',
            message: { role: 'assistant', content: 'ok' },
            done: true,
            total_duration: 2_500_000_000,
            prompt_eval_count: 12,
            eval_count: 4,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    });

    const result = await adapter.executeChatCompletion({
      model: 'llama3.2',
      messages: [{ role: 'user', content: 'ping' }],
      stream: false,
    });

    expect(result.content).toBe('ok');
    expect(result.inputTokens).toBe(12);
    expect(result.outputTokens).toBe(4);
    expect(result.durationMs).toBe(2500);
  });

  it('deve emitir chunks Ollama progressivos e conservar o uso final do stream', async () => {
    let outgoingPayload: { stream?: boolean } | undefined;
    const encoder = new TextEncoder();
    const adapter = new OllamaAdapter({
      baseUrl: 'http://ollama.test',
      fetchFn: async (_url, init) => {
        outgoingPayload = JSON.parse(String(init?.body)) as { stream?: boolean };
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('{"message":{"content":"olá "},"done":false}\n'));
              controller.enqueue(
                encoder.encode(
                  '{"message":{"content":"mundo"},"done":true,"prompt_eval_count":8,"eval_count":2,"done_reason":"stop"}\n',
                ),
              );
              controller.close();
            },
          }),
          { status: 200 },
        );
      },
    });

    const stream = await adapter.openChatCompletionStream({
      model: 'llama3.2',
      messages: [{ role: 'user', content: 'ping' }],
      stream: true,
    });
    const chunks = [];
    for await (const chunk of stream.chunks) chunks.push(chunk);

    expect(outgoingPayload?.stream).toBe(true);
    expect(chunks.map((chunk) => chunk.content)).toEqual(['olá ', 'mundo']);
    expect(chunks[1]).toMatchObject({
      done: true,
      inputTokens: 8,
      outputTokens: 2,
      finishReason: 'stop',
    });
  });

  it('deve classificar timeout do Ollama como estado incerto', async () => {
    const adapter = new OllamaAdapter({
      baseUrl: 'http://ollama.test',
      fetchFn: async (_url, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const abortErr = new Error('aborted');
            abortErr.name = 'AbortError';
            reject(abortErr);
          });
        }),
    });

    await expect(
      adapter.executeChatCompletion(
        {
          model: 'llama3.2',
          messages: [{ role: 'user', content: 'ping' }],
          stream: false,
        },
        { timeoutMs: 20 },
      ),
    ).rejects.toMatchObject({
      code: 'TIMEOUT_UNCERTAIN',
      isUncertain: true,
    } satisfies Partial<ProviderAdapterError>);
  });

  it('deve classificar modelo inexistente como erro determinístico do provedor', async () => {
    const adapter = new OllamaAdapter({
      baseUrl: 'http://ollama.test',
      fetchFn: async () => new Response('model not found', { status: 404 }),
    });

    await expect(
      adapter.executeChatCompletion({
        model: 'modelo-inexistente',
        messages: [{ role: 'user', content: 'ping' }],
        stream: false,
      }),
    ).rejects.toMatchObject({
      code: 'OLLAMA_ERROR',
      statusCode: 404,
      isUncertain: false,
    });
  });
});
