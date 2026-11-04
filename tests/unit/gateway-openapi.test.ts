import pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { buildGatewayServer } from '../../apps/gateway/src/index.js';
import type { LLMProviderAdapter } from '../../apps/gateway/src/types.js';

describe('OpenAPI do Gateway', () => {
  let gateway: Awaited<ReturnType<typeof buildGatewayServer>> | undefined;
  let pool: pg.Pool | undefined;

  afterEach(async () => {
    await gateway?.close();
    await pool?.end();
    gateway = undefined;
    pool = undefined;
  });

  it('documenta JSON, SSE e a opção de incluir uso final', async () => {
    pool = new pg.Pool({ connectionString: 'postgres://test:test@localhost:5432/test' });
    const adapter: LLMProviderAdapter = {
      provider: 'ollama',
      async executeChatCompletion() {
        return {
          content: 'ok',
          inputTokens: 1,
          outputTokens: 1,
          durationMs: 1,
          finishReason: 'stop',
        };
      },
    };
    gateway = await buildGatewayServer({ pool, adapter });

    const response = await gateway.inject({ method: 'GET', url: '/docs/json' });
    expect(response.statusCode).toBe(200);
    const spec = JSON.parse(response.body) as {
      paths: Record<string, { post?: Record<string, unknown> }>;
    };
    const operation = spec.paths['/v1/chat/completions']?.post;

    expect(operation).toBeDefined();
    expect(JSON.stringify(operation)).toContain('text/event-stream');
    expect(JSON.stringify(operation)).toContain('stream_options');
    expect(JSON.stringify(operation)).toContain('include_usage');
  });
});
