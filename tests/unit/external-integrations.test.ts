import type { ChatCompletionRequest } from '@ia-governanca/contracts';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decryptConnectorCredentials, encryptConnectorCredentials } from '../../apps/api/src/credential-vault.js';
import { GeminiAdapter } from '../../apps/gateway/src/adapters/gemini-adapter.js';
import {
  GitHubCopilotSeatsConnector,
  OpenAICostsConnector,
} from '@ia-governanca/connectors';

const fixture = <T>(name: string): T =>
  JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'fixtures/json', name), 'utf8')) as T;

describe('conectores e adaptador externos do épico 07', () => {
  it('coleta custos OpenAI em páginas, preservando o valor decimal e o cursor', async () => {
    const responses = [
      fixture('openai-costs-page-1.json'),
      fixture('openai-costs-page-2.json'),
    ];
    const requested: URL[] = [];
    const connector = new OpenAICostsConnector({
      fetchFn: async (input, init) => {
        requested.push(new URL(String(input)));
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-token');
        return new Response(JSON.stringify(responses.shift()), { status: 200 });
      },
    });
    const range = {
      dataset: 'api_costs' as const,
      periodStart: new Date('2026-10-31T00:00:00Z'),
      periodEnd: new Date('2026-11-02T00:00:00Z'),
      config: { apiKey: 'synthetic-token' },
    };

    const first = await connector.collectBatch(range);
    expect(first.records).toHaveLength(1);
    expect(first.records[0]?.amount).toBe('12.34567890');
    expect(first.records[0]?.provider).toBe('openai');
    expect(first.hasMore).toBe(true);

    const second = await connector.collectBatch({
      ...range,
      checkpoint: first.nextCheckpoint,
    });
    expect(second.records[0]?.amount).toBe('0.00000123');
    expect(second.hasMore).toBe(false);
    expect(requested[1]?.searchParams.get('page')).toBe('page_synthetic_2');
  });

  it('não expõe credenciais em falhas de autenticação ou de limite de taxa', async () => {
    const unauthorized = new OpenAICostsConnector({
      fetchFn: async () => new Response('secret should not appear', { status: 401 }),
    });
    const validation = await unauthorized.validateConnection({ apiKey: 'sensitive-key' });
    expect(validation.valid).toBe(false);
    expect(validation.message).not.toContain('sensitive-key');

    const rateLimited = new OpenAICostsConnector({
      fetchFn: async () =>
        new Response(JSON.stringify(fixture('external-api-errors.json').rate_limited), {
          status: 429,
          headers: { 'retry-after': '2' },
        }),
    });
    await expect(
      rateLimited.collectBatch({
        dataset: 'api_costs',
        periodStart: new Date('2026-10-01T00:00:00Z'),
        periodEnd: new Date('2026-10-02T00:00:00Z'),
        config: { apiKey: 'sensitive-key' },
      }),
    ).rejects.toMatchObject({ statusCode: 429, retryAfterSeconds: 2 });
  });

  it('importa assentos GitHub sem inventar custo e preserva atividade e identidade externa', async () => {
    const calls: string[] = [];
    const connector = new GitHubCopilotSeatsConnector({
      fetchFn: async (input) => {
        calls.push(String(input));
        const headers = calls.length === 1
          ? { link: '<https://api.github.com/orgs/synthetic/copilot/billing/seats?per_page=100&page=2>; rel="next"' }
          : {};
        return new Response(
          JSON.stringify(fixture('github-copilot-seats-page-1.json')),
          { status: 200, headers },
        );
      },
    });
    const first = await connector.collectBatch({
      dataset: 'license_assignments',
      config: { token: 'synthetic-token', organization: 'synthetic' },
    });
    expect(first.records).toHaveLength(2);
    expect(first.records[0]).toMatchObject({
      provider: 'github-copilot',
      userExternalId: '123456',
      seatCost: null,
      currency: null,
      lastActivityAt: new Date('2026-10-30T12:15:00Z'),
    });
    expect(first.hasMore).toBe(true);
    expect(first.nextCheckpoint?.page).toBe(2);
    expect(calls[0]).not.toContain('synthetic-token');
  });

  it('converte a resposta Gemini e lê suas métricas de tokens', async () => {
    let requestBody: Record<string, unknown> | null = null;
    const adapter = new GeminiAdapter({
      apiKey: 'synthetic-gemini-key',
      fetchFn: async (input, init) => {
        expect(String(input)).not.toContain('synthetic-gemini-key');
        expect(new Headers(init?.headers).get('x-goog-api-key')).toBe('synthetic-gemini-key');
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ text: 'resposta sintética' }] }, finishReason: 'STOP' },
            ],
            usageMetadata: {
              promptTokenCount: 17,
              candidatesTokenCount: 5,
              totalTokenCount: 22,
            },
          }),
          { status: 200 },
        );
      },
    });
    const result = await adapter.executeChatCompletion({
      model: 'gemini-2.0-flash',
      messages: [
        { role: 'system', content: 'dados não sensíveis' },
        { role: 'user', content: 'diga ok' },
        { role: 'assistant', content: 'certo' },
      ],
      max_tokens: 32,
    } as ChatCompletionRequest);

    expect(result).toMatchObject({
      content: 'resposta sintética',
      inputTokens: 17,
      outputTokens: 5,
      finishReason: 'STOP',
    });
    expect(requestBody?.systemInstruction).toBeDefined();
  });

  it('criptografa credenciais em repouso e autentica o ciphertext', () => {
    const previousKey = process.env.CONNECTOR_CREDENTIALS_KEY;
    process.env.CONNECTOR_CREDENTIALS_KEY = 'ab'.repeat(32);
    try {
      const encrypted = encryptConnectorCredentials({ apiKey: 'do-not-log-this' });
      expect(encrypted).not.toContain('do-not-log-this');
      expect(decryptConnectorCredentials(encrypted)).toEqual({ apiKey: 'do-not-log-this' });
      expect(() => decryptConnectorCredentials(`${encrypted.slice(0, -2)}aa`)).toThrow();
    } finally {
      if (previousKey === undefined) delete process.env.CONNECTOR_CREDENTIALS_KEY;
      else process.env.CONNECTOR_CREDENTIALS_KEY = previousKey;
    }
  });
});
