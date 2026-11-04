import {
  applyMigrations,
  closePool,
  getPool,
  purgeExpiredAuditEvents,
} from '@ia-governanca/database';
import { resetTestDatabase } from '../helpers/reset-test-database.js';
import { generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApiServer } from '../../apps/api/src/index.js';
import { buildGatewayServer } from '../../apps/gateway/src/index.js';
import type { LLMProviderAdapter } from '../../apps/gateway/src/types.js';

const ISSUER = 'http://localhost:8080/realms/ai-spend';
const AUDIENCE = 'ia-governanca-web';

describe('Épico 09 — fluxo E2E de governança de gastos', () => {
  const pool = getPool();
  let privateKey: CryptoKey;
  let publicKey: CryptoKey;

  beforeAll(async () => {
    const keys = await generateKeyPair('RS256');
    privateKey = keys.privateKey;
    publicKey = keys.publicKey;
    await resetTestDatabase(pool);
    await applyMigrations(pool);
  });

  afterAll(async () => {
    await closePool();
  });

  it('cria projeto/chave, registra inferência e custo, consulta dashboard e bloqueia orçamento excedido', async () => {
    const token = await new SignJWT({
      email: 'epic9-owner@example.test',
      name: 'Epic 9 Owner',
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject('epic9-owner')
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(privateKey);

    const api = await buildApiServer({
      pool,
      oidcOptions: { issuer: ISSUER, audience: AUDIENCE, customKeyOrJwks: publicKey },
    });
    const auth = { authorization: `Bearer ${token}` };

    try {
      const docsResponse = await api.inject({ method: 'GET', url: '/docs/' });
      expect(docsResponse.statusCode).toBe(200);
      const orgResponse = await api.inject({
        method: 'POST',
        url: '/v1/organizations',
        headers: auth,
        payload: { name: 'Epic 9 Organization', slug: `epic9-${crypto.randomUUID()}` },
      });
      expect(orgResponse.statusCode).toBe(201);
      const organization = JSON.parse(orgResponse.body) as { id: string };

      const projectResponse = await api.inject({
        method: 'POST',
        url: `/v1/organizations/${organization.id}/projects`,
        headers: auth,
        payload: { name: 'E2E Project', slug: `e2e-${crypto.randomUUID()}` },
      });
      expect(projectResponse.statusCode).toBe(201);
      const project = JSON.parse(projectResponse.body) as { id: string };

      const staleSync = await pool.query<{ id: string }>(
        `INSERT INTO sync_runs (organization_id, dataset, status, checkpoint, started_at)
         VALUES ($1, 'api_costs', 'running', '{"page":3}'::jsonb, NOW() - INTERVAL '1 hour')
         RETURNING id`,
        [organization.id],
      );
      const recoveryResponse = await api.inject({
        method: 'POST',
        url: `/v1/organizations/${organization.id}/connectors/sync-runs/recover`,
        headers: auth,
      });
      expect(recoveryResponse.statusCode).toBe(200);
      expect(recoveryResponse.body).toContain(staleSync.rows[0]!.id);
      expect(recoveryResponse.body).toContain('"page":3');
      const workerMetricsResponse = await api.inject({ method: 'GET', url: '/metrics' });
      expect(workerMetricsResponse.body).toContain('worker_sync_runs_recovered_total');

      const priceResponse = await api.inject({
        method: 'POST',
        url: `/v1/organizations/${organization.id}/model-prices`,
        headers: auth,
        payload: {
          provider: 'ollama',
          model: 'epic9-e2e-model',
          currency: 'USD',
          inputPricePerMillion: '1000000',
          outputPricePerMillion: '1000000',
          priceSource: 'internal_simulation',
          priceType: 'simulation',
          effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
        },
      });
      expect(priceResponse.statusCode).toBe(201);

      const keyResponse = await api.inject({
        method: 'POST',
        url: `/v1/organizations/${organization.id}/virtual-keys`,
        headers: auth,
        payload: {
          name: 'E2E virtual key',
          scopeType: 'project',
          projectId: project.id,
          allowedProviders: ['ollama'],
          allowedModels: ['epic9-e2e-model'],
          scopes: ['chat:completions'],
        },
      });
      expect(keyResponse.statusCode).toBe(201);
      const key = JSON.parse(keyResponse.body) as { id: string; api_key: string };
      const persistedKey = await pool.query<{ key_hash: string }>(
        'SELECT key_hash FROM virtual_keys WHERE id = $1 AND organization_id = $2',
        [key.id, organization.id],
      );
      expect(persistedKey.rows[0]?.key_hash).not.toBe(key.api_key);

      const adapter: LLMProviderAdapter = {
        provider: 'ollama',
        async executeChatCompletion() {
          return {
            content: 'E2E reply',
            inputTokens: 10,
            outputTokens: 5,
            durationMs: 8,
            finishReason: 'stop',
          };
        },
      };
      const gateway = await buildGatewayServer({ pool, adapter });
      try {
        const successfulRequest = await gateway.inject({
          method: 'POST',
          url: '/v1/chat/completions',
          headers: { authorization: `Bearer ${key.api_key}`, 'x-request-id': 'epic9-e2e-success' },
          payload: { model: 'epic9-e2e-model', messages: [{ role: 'user', content: 'hello' }], max_tokens: 5 },
        });
        expect(successfulRequest.statusCode).toBe(200);
        const gatewayMetricsResponse = await gateway.inject({ method: 'GET', url: '/metrics' });
        expect(gatewayMetricsResponse.body).toContain('gateway_tokens_total');
        const usageResponse = await api.inject({
          method: 'GET',
          url: `/v1/organizations/${organization.id}/usage-events`,
          headers: auth,
        });
        expect(usageResponse.statusCode).toBe(200);
        expect(usageResponse.body).toContain('epic9-e2e-success');

        const costsResponse = await api.inject({
          method: 'GET',
          url: `/v1/organizations/${organization.id}/costs/summary`,
          headers: auth,
        });
        expect(costsResponse.statusCode).toBe(200);
        expect(costsResponse.body).toContain('gateway_estimated');

        const overviewResponse = await api.inject({
          method: 'GET',
          url: `/v1/organizations/${organization.id}/dashboard/overview`,
          headers: auth,
        });
        expect(overviewResponse.statusCode).toBe(200);
        expect(overviewResponse.body).toContain('epic9-e2e-model');

        await pool.query(`
          CREATE OR REPLACE FUNCTION epic9_fail_usage_insert() RETURNS trigger AS $$
          BEGIN
            RAISE EXCEPTION 'injected ledger persistence failure';
          END;
          $$ LANGUAGE plpgsql;
          CREATE TRIGGER epic9_fail_usage_insert
          BEFORE INSERT ON usage_events
          FOR EACH ROW EXECUTE FUNCTION epic9_fail_usage_insert();
        `);
        try {
          const persistenceFailure = await gateway.inject({
            method: 'POST',
            url: '/v1/chat/completions',
            headers: { authorization: `Bearer ${key.api_key}`, 'x-request-id': 'epic9-e2e-ledger-failure' },
            payload: { model: 'epic9-e2e-model', messages: [{ role: 'user', content: 'do not log' }], max_tokens: 5 },
          });
          expect(persistenceFailure.statusCode).toBe(500);
          expect(persistenceFailure.body).toContain('ledger_persistence_failed');
          const missingEvent = await pool.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM usage_events
             WHERE organization_id = $1 AND request_id = 'epic9-e2e-ledger-failure'`,
            [organization.id],
          );
          expect(Number(missingEvent.rows[0]?.count)).toBe(0);
        } finally {
          await pool.query(`
            DROP TRIGGER IF EXISTS epic9_fail_usage_insert ON usage_events;
            DROP FUNCTION IF EXISTS epic9_fail_usage_insert();
          `);
        }

        const now = Date.now();
        const budgetResponse = await api.inject({
          method: 'POST',
          url: `/v1/organizations/${organization.id}/budget-policies`,
          headers: auth,
          payload: {
            name: 'E2E blocking budget',
            scopeType: 'organization',
            mode: 'block',
            currency: 'USD',
            limitAmount: '0.000001',
            periodStart: new Date(now - 60_000).toISOString(),
            periodEnd: new Date(now + 3_600_000).toISOString(),
          },
        });
        expect(budgetResponse.statusCode).toBe(201);

        const blockedRequest = await gateway.inject({
          method: 'POST',
          url: '/v1/chat/completions',
          headers: { authorization: `Bearer ${key.api_key}`, 'x-request-id': 'epic9-e2e-blocked' },
          payload: { model: 'epic9-e2e-model', messages: [{ role: 'user', content: 'blocked' }], max_tokens: 5 },
        });
        expect(blockedRequest.statusCode).toBe(429);
        expect(blockedRequest.body).toContain('budget_blocked');
        const blockedUsage = await api.inject({
          method: 'GET',
          url: `/v1/organizations/${organization.id}/usage-events?status=blocked_budget`,
          headers: auth,
        });
        expect(blockedUsage.statusCode).toBe(200);
        expect(blockedUsage.body).toContain('epic9-e2e-blocked');

        await pool.query(
          `INSERT INTO audit_events (organization_id, action, target_type, target_id, created_at)
           VALUES ($1, 'retention.expired-test', 'test', 'old-event', NOW() - INTERVAL '4000 days')`,
          [organization.id],
        );
        expect(await purgeExpiredAuditEvents(pool, 3650)).toBeGreaterThanOrEqual(1);
        const preservedLedger = await pool.query<{ count: string }>(
          'SELECT COUNT(*)::text AS count FROM usage_events WHERE organization_id = $1',
          [organization.id],
        );
        expect(Number(preservedLedger.rows[0]?.count)).toBe(2);
      } finally {
        await gateway.close();
      }
    } finally {
      await api.close();
    }
  });
});
