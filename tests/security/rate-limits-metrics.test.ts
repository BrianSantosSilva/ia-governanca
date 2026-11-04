import { closePool, getPool } from '@ia-governanca/database';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApiServer } from '../../apps/api/src/index.js';
import { buildGatewayServer } from '../../apps/gateway/src/index.js';

describe('Épico 09 — rate limiting e métricas dos serviços HTTP', () => {
  afterAll(async () => {
    await closePool();
  });

  it('limita requisições administrativas e expõe métricas sem autenticação', async () => {
    const api = await buildApiServer({ pool: getPool(), rateLimitMax: 1 });
    const first = await api.inject({ method: 'GET', url: '/v1/me' });
    const second = await api.inject({ method: 'GET', url: '/v1/me' });
    const metrics = await api.inject({ method: 'GET', url: '/metrics' });

    expect(first.statusCode).toBe(401);
    expect(second.statusCode).toBe(429);
    expect(metrics.statusCode).toBe(200);
    expect(metrics.headers['content-type']).toContain('text/plain');
    expect(metrics.body).toContain('api_http_requests_total');

    await api.close();
  });

  it('limita chamadas ao Gateway e contabiliza falhas com provedor/modelo', async () => {
    const gateway = await buildGatewayServer({ pool: getPool(), rateLimitMax: 1 });
    const request = {
      method: 'POST' as const,
      url: '/v1/chat/completions',
      headers: { authorization: 'Bearer test-virtual-key' },
      payload: { model: 'test-model', messages: [{ role: 'user', content: 'sensitive prompt' }] },
    };
    const first = await gateway.inject(request);
    const second = await gateway.inject(request);
    const metrics = await gateway.inject({ method: 'GET', url: '/metrics' });

    expect(first.statusCode).toBe(401);
    expect(second.statusCode).toBe(429);
    expect(metrics.statusCode).toBe(200);
    expect(metrics.body).toContain('gateway_requests_total');
    expect(metrics.body).toContain('gateway_failures_total');
    expect(metrics.body).not.toContain('sensitive prompt');

    await gateway.close();
  });

  it('responde degradado quando o PostgreSQL está indisponível', async () => {
    const unavailablePool = new pg.Pool({
      connectionString: 'postgres://invalid:invalid@127.0.0.1:1/unavailable',
      connectionTimeoutMillis: 100,
    });
    const api = await buildApiServer({ pool: unavailablePool });
    const health = await api.inject({ method: 'GET', url: '/health' });

    expect(health.statusCode).toBe(503);
    expect(health.json()).toMatchObject({ status: 'degraded', database: false });

    await api.close();
    await unavailablePool.end();
  });
});
