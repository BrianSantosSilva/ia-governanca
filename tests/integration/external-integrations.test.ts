import { applyMigrations, closePool, getPool } from '@ia-governanca/database';
import { resetTestDatabase } from '../helpers/reset-test-database.js';
import { generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApiServer } from '../../apps/api/src/index.js';

const ISSUER = 'http://localhost:8080/realms/ai-spend';
const AUDIENCE = 'ia-governanca-web';

describe('Épico 07 — configurações externas e revisão de identidades', () => {
  const pool = getPool();
  let privateKey: CryptoKey;
  let publicKey: CryptoKey;

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
    await resetTestDatabase(pool);
    await applyMigrations(pool);
  });

  afterAll(async () => {
    await closePool();
  });

  async function createApiAndOrganization() {
    const api = await buildApiServer({
      pool,
      oidcOptions: { issuer: ISSUER, audience: AUDIENCE, customKeyOrJwks: publicKey },
    });
    const email = `owner-${crypto.randomUUID()}@example.test`;
    const token = await new SignJWT({ email, name: 'Owner de teste' })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject(crypto.randomUUID())
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(privateKey);
    const organization = await api.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'External test', slug: `external-${crypto.randomUUID().slice(0, 8)}` },
    });
    expect(organization.statusCode).toBe(201);
    return {
      api,
      token,
      organizationId: (JSON.parse(organization.body) as { id: string }).id,
    };
  }

  it('armazena segredo de integração cifrado e nunca o retorna na listagem', async () => {
    const previousKey = process.env.CONNECTOR_CREDENTIALS_KEY;
    process.env.CONNECTOR_CREDENTIALS_KEY = 'cd'.repeat(32);
    const { api, token, organizationId } = await createApiAndOrganization();
    try {
      const secret = 'synthetic-openai-admin-secret';
      const invalidMetadata = await api.inject({
        method: 'POST',
        url: `/v1/organizations/${organizationId}/provider-connections`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          provider: 'openai',
          name: 'OpenAI com metadata inválida',
          credentials: { apiKey: secret },
          configMetadata: { apiKey: secret },
        },
      });
      expect(invalidMetadata.statusCode).toBe(400);

      const created = await api.inject({
        method: 'POST',
        url: `/v1/organizations/${organizationId}/provider-connections`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          provider: 'openai',
          name: 'OpenAI de teste',
          credentials: { apiKey: secret },
          configMetadata: {},
        },
      });
      expect(created.statusCode).toBe(201);
      expect(created.body).not.toContain(secret);
      const connectionId = (JSON.parse(created.body) as { id: string }).id;

      const unsupportedDataset = await api.inject({
        method: 'POST',
        url: `/v1/organizations/${organizationId}/provider-connections/${connectionId}/sync`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          dataset: 'license_assignments',
          periodStart: '2026-10-01T00:00:00Z',
          periodEnd: '2026-11-01T00:00:00Z',
        },
      });
      expect(unsupportedDataset.statusCode).toBe(400);
      expect(unsupportedDataset.json()).toMatchObject({ error: 'unsupported_dataset' });

      const stored = await pool.query<{ encrypted_credentials: string }>(
        `SELECT encrypted_credentials FROM provider_connections WHERE organization_id = $1`,
        [organizationId],
      );
      expect(stored.rows[0]!.encrypted_credentials).not.toContain(secret);

      const listed = await api.inject({
        method: 'GET',
        url: `/v1/organizations/${organizationId}/provider-connections`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(listed.statusCode).toBe(200);
      expect(listed.body).not.toContain(secret);
      expect(listed.body).not.toContain('encrypted_credentials');
    } finally {
      await api.close();
      if (previousKey === undefined) delete process.env.CONNECTOR_CREDENTIALS_KEY;
      else process.env.CONNECTOR_CREDENTIALS_KEY = previousKey;
    }
  });

  it('lista identidades pendentes e associa apenas a membro explícito da organização', async () => {
    const { api, token, organizationId } = await createApiAndOrganization();
    try {
      const member = await pool.query<{ id: string }>(
        `INSERT INTO users (email, full_name) VALUES ($1, 'Membro explícito') RETURNING id`,
        [`member-${crypto.randomUUID()}@example.test`],
      );
      await pool.query(
        `INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'developer')`,
        [organizationId, member.rows[0]!.id],
      );
      const identity = await pool.query<{ id: string }>(
        `INSERT INTO external_identities (
           organization_id, provider, external_user_id, external_email, match_status
         )
         VALUES ($1, 'github-copilot', 'synthetic-seat-42', NULL, 'pending_review')
         RETURNING id`,
        [organizationId],
      );

      const pending = await api.inject({
        method: 'GET',
        url: `/v1/organizations/${organizationId}/external-identities/pending-review`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(pending.statusCode).toBe(200);
      expect(pending.body).toContain('synthetic-seat-42');

      const matched = await api.inject({
        method: 'POST',
        url: `/v1/organizations/${organizationId}/external-identities/${identity.rows[0]!.id}/match`,
        headers: { authorization: `Bearer ${token}` },
        payload: { userId: member.rows[0]!.id },
      });
      expect(matched.statusCode).toBe(200);

      const persisted = await pool.query<{ user_id: string; match_status: string }>(
        `SELECT user_id, match_status FROM external_identities WHERE id = $1`,
        [identity.rows[0]!.id],
      );
      expect(persisted.rows[0]).toEqual({
        user_id: member.rows[0]!.id,
        match_status: 'matched',
      });
    } finally {
      await api.close();
    }
  });

  it('agrega indicadores por período e rejeita filtros de outro tenant ou inválidos', async () => {
    const { api, token, organizationId } = await createApiAndOrganization();
    try {
      const overview = await api.inject({
        method: 'GET',
        url: `/v1/organizations/${organizationId}/dashboard/overview?startDate=2026-10-01&endDate=2026-10-31&dataSource=gateway_local`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(overview.statusCode).toBe(200);
      expect(overview.json()).toMatchObject({
        period: {
          startDate: '2026-10-01T00:00:00.000Z',
          endDate: '2026-10-31T00:00:00.000Z',
        },
        costsByCategory: [],
        consumptionByProviderModel: [],
        consumptionByProject: [],
        consumptionByTeam: [],
        budgets: [],
        licenses: [],
        sources: [],
        pendingReconciliation: [],
      });

      const filterQuery = 'startDate=2026-10-01&endDate=2026-10-31&projectId=6a988983-07e6-40da-a1a6-640da5f2b792&teamId=faac7e3a-6c8c-4600-92a1-8fe1ab95045c&provider=github-copilot&model=gemini-2.0-flash&costCategory=simulated&dataSource=csv';
      for (const route of [
        'licenses',
        'budget-policies',
        'connectors/sync-runs',
        'audit-events',
        'reconciliation-matches',
      ]) {
        const filtered = await api.inject({
          method: 'GET',
          url: `/v1/organizations/${organizationId}/${route}?${filterQuery}`,
          headers: { authorization: `Bearer ${token}` },
        });
        expect(filtered.statusCode, `${route} should accept valid tenant filters`).toBe(200);
      }

      const crossTenant = await api.inject({
        method: 'GET',
        url: `/v1/organizations/${organizationId}/costs/summary?organizationId=aa3cb5eb-cbf5-4bab-9dd4-529bb69466ce`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(crossTenant.statusCode).toBe(403);

      const invalidPeriod = await api.inject({
        method: 'GET',
        url: `/v1/organizations/${organizationId}/dashboard/overview?startDate=2026-11-01&endDate=2026-10-31`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(invalidPeriod.statusCode).toBe(400);

      const cors = await api.inject({
        method: 'OPTIONS',
        url: `/v1/organizations/${organizationId}/dashboard/overview`,
        headers: {
          origin: 'http://localhost:3000',
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'authorization',
        },
      });
      expect(cors.statusCode).toBe(204);
      expect(cors.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    } finally {
      await api.close();
    }
  });
});
