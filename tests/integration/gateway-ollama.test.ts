import {
  applyMigrations,
  closePool,
  getPool,
  purgeExpiredUsageEventContent,
} from '@ia-governanca/database';
import { resetTestDatabase } from '../helpers/reset-test-database.js';
import { generateVirtualKey } from '@ia-governanca/identity';
import { decryptSensitiveContent } from '@ia-governanca/secure-content';
import { generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import crypto from 'node:crypto';
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApiServer } from '../../apps/api/src/index.js';
import { buildGatewayServer } from '../../apps/gateway/src/index.js';
import { ProviderAdapterError, type LLMProviderAdapter } from '../../apps/gateway/src/types.js';

const ISSUER = 'http://localhost:8080/realms/ai-spend';
const AUDIENCE = 'ia-governanca-web';
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2';

const mockAdapter: LLMProviderAdapter = {
  provider: 'ollama',
  async executeChatCompletion() {
    return {
      content: 'ambiente local funcionando',
      inputTokens: 34,
      outputTokens: 9,
      durationMs: 120,
      finishReason: 'stop',
    };
  },
};

const mockGeminiAdapter: LLMProviderAdapter = {
  provider: 'gemini',
  async executeChatCompletion() {
    return {
      content: 'resposta Gemini simulada',
      inputTokens: 17,
      outputTokens: 5,
      durationMs: 80,
      finishReason: 'STOP',
    };
  },
};

async function isOllamaReady(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL.replace(/\/$/, '')}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    return (data.models ?? []).some((model) => String(model.name ?? '').startsWith(OLLAMA_MODEL));
  } catch {
    return false;
  }
}

describe('Épico 05 — Gateway LLM, chaves virtuais, ledger e consulta administrativa', () => {
  const pool = getPool();
  let privateKey: CryptoKey;
  let publicKey: CryptoKey;

  async function issueToken(params: { sub: string; email: string; name: string }): Promise<string> {
    return new SignJWT({
      email: params.email,
      name: params.name,
      preferred_username: params.email.split('@')[0],
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject(params.sub)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(privateKey);
  }

  async function seedOrgProject() {
    const orgRes = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug)
       VALUES ('Gateway Org', 'gateway-org-' || substr(gen_random_uuid()::text, 1, 8))
       RETURNING id`,
    );
    const organizationId = orgRes.rows[0]!.id;
    const projectRes = await pool.query<{ id: string }>(
      `INSERT INTO projects (organization_id, name, slug)
       VALUES ($1, 'Assistente', 'assistente')
       RETURNING id`,
      [organizationId],
    );
    return { organizationId, projectId: projectRes.rows[0]!.id };
  }

  async function insertVirtualKey(params: {
    organizationId: string;
    projectId: string;
    ownerUserId?: string;
    allowedProviders?: string[];
    allowedModels?: string[];
    scopes?: string[];
    expiresAt?: Date | null;
    revokedAt?: Date | null;
    maxRequestsPerMinute?: number | null;
  }) {
    const generated = generateVirtualKey();
    const res = await pool.query<{ id: string }>(
      `INSERT INTO virtual_keys (
         organization_id, scope_type, project_id, name, key_prefix, key_hash,
         allowed_providers, allowed_models, scopes, max_requests_per_minute, expires_at, revoked_at,
         owner_user_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        params.organizationId,
        params.ownerUserId ? 'user' : 'project',
        params.ownerUserId ? null : params.projectId,
        'Chave de teste',
        generated.keyPrefix,
        generated.keyHash,
        params.allowedProviders ?? ['ollama'],
        params.allowedModels ?? ['llama3.2'],
        params.scopes ?? ['chat:completions'],
        params.maxRequestsPerMinute ?? null,
        params.expiresAt ?? null,
        params.revokedAt ?? null,
        params.ownerUserId ?? null,
      ],
    );
    return { id: res.rows[0]!.id, apiKey: generated.apiKey, keyPrefix: generated.keyPrefix };
  }

  beforeAll(async () => {
    const kp = await generateKeyPair('RS256');
    privateKey = kp.privateKey;
    publicKey = kp.publicKey;
    await resetTestDatabase(pool);
    await applyMigrations(pool);
  });

  afterAll(async () => {
    await closePool();
  });

  it('deve rejeitar payload inválido com 400 e documentar o endpoint no OpenAPI', async () => {
    const gateway = await buildGatewayServer({ pool, adapter: mockAdapter });

    const invalidRes = await gateway.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: { model: '', messages: [] },
    });
    expect(invalidRes.statusCode).toBe(400);

    const docsRes = await gateway.inject({ method: 'GET', url: '/docs/json' });
    expect(docsRes.statusCode).toBe(200);
    const openapi = JSON.parse(docsRes.body) as {
      paths: Record<string, Record<string, unknown>>;
    };
    expect(openapi.paths['/v1/chat/completions']?.post).toBeTruthy();

    await gateway.close();
  });

  it('deve criar, listar e revogar chaves virtuais sem persistir o segredo em texto puro', async () => {
    const api = await buildApiServer({
      pool,
      oidcOptions: { issuer: ISSUER, audience: AUDIENCE, customKeyOrJwks: publicKey },
    });

    const ownerToken = await issueToken({
      sub: 'kc-owner-gateway',
      email: 'owner-gateway@acme.local',
      name: 'Owner Gateway',
    });
    const viewerToken = await issueToken({
      sub: 'kc-viewer-gateway',
      email: 'viewer-gateway@acme.local',
      name: 'Viewer Gateway',
    });

    const orgRes = await api.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: 'Acme Gateway', slug: `acme-gw-${Date.now()}` },
    });
    expect(orgRes.statusCode).toBe(201);
    const org = JSON.parse(orgRes.body) as { id: string };

    await api.inject({
      method: 'POST',
      url: `/v1/organizations/${org.id}/memberships`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { email: 'viewer-gateway@acme.local', fullName: 'Viewer Gateway', role: 'viewer' },
    });

    const projectRes = await api.inject({
      method: 'POST',
      url: `/v1/organizations/${org.id}/projects`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: 'Chat Interno', slug: 'chat-interno' },
    });
    expect(projectRes.statusCode).toBe(201);
    const project = JSON.parse(projectRes.body) as { id: string };
    const team = await pool.query<{ id: string }>(
      `INSERT INTO teams (organization_id, name, slug)
       VALUES ($1, 'Equipe de teste', 'team-key-' || substr(gen_random_uuid()::text, 1, 8))
       RETURNING id`,
      [org.id],
    );
    const teamKeyRes = await api.inject({
      method: 'POST',
      url: `/v1/organizations/${org.id}/virtual-keys`,
      headers: { authorization: 'Bearer ' + ownerToken },
      payload: { name: 'chave-equipe', scopeType: 'team', teamId: team.rows[0]!.id },
    });
    expect(teamKeyRes.statusCode).toBe(201);
    expect(JSON.parse(teamKeyRes.body)).toMatchObject({
      scope_type: 'team',
      project_id: null,
      team_id: team.rows[0]!.id,
      owner_user_id: null,
    });

    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name) VALUES ($1, 'Pessoa sem equipe') RETURNING id`,
      [`personal-key-${Date.now()}@acme.local`],
    );
    await pool.query(
      `INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'developer')`,
      [org.id, user.rows[0]!.id],
    );
    const userKeyRes = await api.inject({
      method: 'POST',
      url: `/v1/organizations/${org.id}/virtual-keys`,
      headers: { authorization: 'Bearer ' + ownerToken },
      payload: { name: 'chave-pessoal', scopeType: 'user', userId: user.rows[0]!.id },
    });
    expect(userKeyRes.statusCode).toBe(201);
    expect(JSON.parse(userKeyRes.body)).toMatchObject({
      scope_type: 'user',
      project_id: null,
      team_id: null,
      owner_user_id: user.rows[0]!.id,
    });

    const forbiddenRes = await api.inject({
      method: 'POST',
      url: `/v1/organizations/${org.id}/virtual-keys`,
      headers: { authorization: `Bearer ${viewerToken}` },
      payload: { name: 'bloqueada', scopeType: 'project', projectId: project.id },
    });
    expect(forbiddenRes.statusCode).toBe(403);

    const createRes = await api.inject({
      method: 'POST',
      url: `/v1/organizations/${org.id}/virtual-keys`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: 'chave-prod',
        scopeType: 'project',
        projectId: project.id,
        allowedProviders: ['ollama'],
        allowedModels: ['llama3.2'],
        scopes: ['chat:completions'],
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = JSON.parse(createRes.body) as {
      id: string;
      api_key: string;
      key_prefix: string;
      key_hash?: string;
    };
    expect(created.api_key.startsWith('aisp_live_')).toBe(true);
    expect(created.key_hash).toBeUndefined();

    const stored = await pool.query<{ key_hash: string; key_prefix: string }>(
      `SELECT key_hash, key_prefix FROM virtual_keys WHERE id = $1`,
      [created.id],
    );
    expect(stored.rows[0]!.key_prefix).toBe(created.key_prefix);
    expect(stored.rows[0]!.key_hash).not.toBe(created.api_key);
    expect(stored.rows[0]!.key_hash).toHaveLength(64);

    const listRes = await api.inject({
      method: 'GET',
      url: `/v1/organizations/${org.id}/virtual-keys`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(listRes.statusCode).toBe(200);
    const listed = JSON.parse(listRes.body) as { items: Array<Record<string, unknown>> };
    expect(listed.items[0]?.api_key).toBeUndefined();
    expect(listed.items[0]?.key_hash).toBeUndefined();
    expect(listed.items[0]?.key_prefix).toBe(created.key_prefix);

    const revokeRes = await api.inject({
      method: 'POST',
      url: `/v1/organizations/${org.id}/virtual-keys/${created.id}/revoke`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(revokeRes.statusCode).toBe(200);

    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM audit_events WHERE organization_id = $1 AND target_type = 'virtual_key'`,
      [org.id],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining(['virtual_key.created', 'virtual_key.revoked']),
    );

    await api.close();
  });

  it('preserva os cabeçalhos CORS ao retransmitir o streaming do chat de teste', async () => {
    const api = await buildApiServer({
      pool,
      oidcOptions: { issuer: ISSUER, audience: AUDIENCE, customKeyOrJwks: publicKey },
    });
    const ownerToken = await issueToken({
      sub: `kc-cors-owner-${crypto.randomUUID()}`,
      email: `cors-owner-${crypto.randomUUID()}@acme.local`,
      name: 'CORS Owner',
    });
    const mockGateway = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      response.end('data: {"choices":[{"delta":{"content":"stream ok"}}]}\n\n');
    });
    const previousGatewayUrl = process.env.GATEWAY_INTERNAL_URL;
    await new Promise<void>((resolve, reject) => {
      mockGateway.once('error', reject);
      mockGateway.listen(0, '127.0.0.1', resolve);
    });
    const address = mockGateway.address();
    if (!address || typeof address === 'string') throw new Error('Mock Gateway did not bind to a TCP port');
    process.env.GATEWAY_INTERNAL_URL = `http://127.0.0.1:${address.port}`;

    try {
      const orgRes = await api.inject({
        method: 'POST',
        url: '/v1/organizations',
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { name: 'CORS test', slug: `cors-${crypto.randomUUID()}` },
      });
      expect(orgRes.statusCode).toBe(201);
      const org = orgRes.json() as { id: string };
      const projectRes = await api.inject({
        method: 'POST',
        url: `/v1/organizations/${org.id}/projects`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { name: 'CORS project', slug: `cors-project-${crypto.randomUUID()}` },
      });
      expect(projectRes.statusCode).toBe(201);
      const project = projectRes.json() as { id: string };
      const keyRes = await api.inject({
        method: 'POST',
        url: `/v1/organizations/${org.id}/virtual-keys`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          name: 'CORS test key',
          scopeType: 'project',
          projectId: project.id,
          allowedProviders: ['ollama'],
          allowedModels: ['llama3.2'],
        },
      });
      expect(keyRes.statusCode).toBe(201);
      const key = keyRes.json() as { id: string };
      const response = await api.inject({
        method: 'POST',
        url: `/v1/organizations/${org.id}/virtual-keys/${key.id}/test-chat`,
        headers: {
          authorization: `Bearer ${ownerToken}`,
          origin: 'http://localhost:3000',
        },
        payload: {
          model: 'llama3.2',
          messages: [{ role: 'user', content: 'hello' }],
          stream: true,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(response.headers['content-type']).toContain('text/event-stream');
      expect(response.body).toContain('stream ok');
    } finally {
      if (previousGatewayUrl === undefined) delete process.env.GATEWAY_INTERNAL_URL;
      else process.env.GATEWAY_INTERNAL_URL = previousGatewayUrl;
      await api.close();
      await new Promise<void>((resolve, reject) =>
        mockGateway.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('deve autenticar a chave, executar inferência, gravar o ledger e consultar o consumo por tenant', async () => {
    const { organizationId, projectId } = await seedOrgProject();
    const otherOrg = await seedOrgProject();
    const key = await insertVirtualKey({ organizationId, projectId });
    const otherKey = await insertVirtualKey({
      organizationId: otherOrg.organizationId,
      projectId: otherOrg.projectId,
    });

    const gateway = await buildGatewayServer({ pool, adapter: mockAdapter });
    const requestId = `req-e2e-${Date.now()}`;

    const unauthorized = await gateway.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: { model: 'llama3.2', messages: [{ role: 'user', content: 'oi' }] },
    });
    expect(unauthorized.statusCode).toBe(401);

    const okRes = await gateway.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: `Bearer ${key.apiKey}`,
        'x-request-id': requestId,
      },
      payload: {
        model: 'llama3.2',
        messages: [{ role: 'user', content: 'Responda apenas: ambiente local funcionando' }],
      },
    });
    expect(okRes.statusCode).toBe(200);
    expect(okRes.headers['x-request-id']).toBe(requestId);
    const body = JSON.parse(okRes.body) as {
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };
    expect(body.choices[0]?.message.content).toContain('ambiente local funcionando');
    expect(body.usage.prompt_tokens).toBe(34);
    expect(body.usage.completion_tokens).toBe(9);
    expect(body.usage.total_tokens).toBe(43);

    const stored = await pool.query<{
      organization_id: string;
      project_id: string;
      virtual_key_id: string;
      provider: string;
      model: string;
      input_tokens: number;
      output_tokens: number;
      duration_ms: number;
      status: string;
      request_id: string;
      attempt_number: number;
    }>(
      `SELECT organization_id, project_id, virtual_key_id, provider, model,
              input_tokens, output_tokens, duration_ms, status, request_id, attempt_number
       FROM usage_events
       WHERE request_id = $1`,
      [requestId],
    );
    expect(stored.rowCount).toBe(1);
    expect(stored.rows[0]).toMatchObject({
      organization_id: organizationId,
      project_id: projectId,
      virtual_key_id: key.id,
      provider: 'ollama',
      model: 'llama3.2',
      input_tokens: 34,
      output_tokens: 9,
      status: 'succeeded',
      request_id: requestId,
      attempt_number: 1,
    });
    expect(stored.rows[0]!.duration_ms).toBeGreaterThan(0);

    const cost = await pool.query<{
      cost_category: string;
      is_simulated: boolean;
      currency: string;
      amount: string;
      model_price_id: string;
    }>(
      `SELECT cost_category, is_simulated, currency, amount::text, model_price_id
       FROM cost_records WHERE usage_event_id = (
         SELECT id FROM usage_events WHERE request_id = $1 AND organization_id = $2
       )`,
      [requestId, organizationId],
    );
    expect(cost.rows).toHaveLength(1);
    expect(cost.rows[0]).toMatchObject({
      cost_category: 'gateway_estimated',
      is_simulated: true,
      currency: 'USD',
    });
    expect(cost.rows[0]!.model_price_id).toBeTruthy();

    const api = await buildApiServer({
      pool,
      oidcOptions: { issuer: ISSUER, audience: AUDIENCE, customKeyOrJwks: publicKey },
    });
    const ownerToken = await issueToken({
      sub: 'kc-finops-usage',
      email: `finops-usage-${Date.now()}@acme.local`,
      name: 'FinOps Usage',
    });
    const meRes = await api.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(meRes.statusCode).toBe(200);
    const me = JSON.parse(meRes.body) as { user: { id: string } };
    await pool.query(
      `INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'finops')`,
      [organizationId, me.user.id],
    );

    const usageRes = await api.inject({
      method: 'GET',
      url: `/v1/organizations/${organizationId}/usage-events?projectId=${projectId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(usageRes.statusCode).toBe(200);
    const usageBody = JSON.parse(usageRes.body) as {
      items: Array<{ requestId: string; organizationId: string }>;
    };
    expect(usageBody.items.some((item) => item.requestId === requestId)).toBe(true);
    expect(usageBody.items.every((item) => item.organizationId === organizationId)).toBe(true);

    const crossTenant = await api.inject({
      method: 'GET',
      url: `/v1/organizations/${otherOrg.organizationId}/usage-events`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(crossTenant.statusCode).toBe(403);

    const otherCall = await gateway.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${otherKey.apiKey}` },
      payload: { model: 'llama3.2', messages: [{ role: 'user', content: 'oi' }] },
    });
    expect(otherCall.statusCode).toBe(200);

    const isolated = await api.inject({
      method: 'GET',
      url: `/v1/organizations/${organizationId}/usage-events`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const isolatedBody = JSON.parse(isolated.body) as { items: Array<{ virtualKeyId: string }> };
    expect(isolatedBody.items.every((item) => item.virtualKeyId === key.id)).toBe(true);

    await gateway.close();
    await api.close();
  });

  it('deve transmitir chunks SSE e registrar o uso informado pelo adaptador', async () => {
    const { organizationId, projectId } = await seedOrgProject();
    const teamResult = await pool.query<{ id: string }>(
      `INSERT INTO teams (organization_id, name, slug)
       VALUES ($1, 'Equipe SSE', 'equipe-sse')
       RETURNING id`,
      [organizationId],
    );
    const teamId = teamResult.rows[0]!.id;
    await pool.query(`UPDATE projects SET team_id = $2 WHERE id = $1`, [projectId, teamId]);
    const userResult = await pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name)
       VALUES ($1, 'Pessoa SSE')
       RETURNING id`,
      [`sse-${Date.now()}@acme.local`],
    );
    const userId = userResult.rows[0]!.id;
    await pool.query(
      `INSERT INTO memberships (organization_id, user_id, role)
       VALUES ($1, $2, 'developer')`,
      [organizationId, userId],
    );
    await pool.query(
      `INSERT INTO team_memberships (organization_id, team_id, user_id)
       VALUES ($1, $2, $3)`,
      [organizationId, teamId, userId],
    );
    const key = await insertVirtualKey({ organizationId, projectId, ownerUserId: userId });
    await pool.query(
      `UPDATE organizations SET prompt_capture_enabled = TRUE WHERE id = $1`,
      [organizationId],
    );
    const streamAdapter: LLMProviderAdapter = {
      provider: 'ollama',
      async executeChatCompletion() {
        return {
          content: 'olá mundo',
          inputTokens: 8,
          outputTokens: 2,
          durationMs: 20,
          finishReason: 'stop',
        };
      },
      async openChatCompletionStream() {
        return {
          chunks: (async function* () {
            yield { content: 'olá ', done: false };
            yield {
              content: 'mundo',
              done: true,
              inputTokens: 8,
              outputTokens: 2,
              finishReason: 'stop',
            };
          })(),
          cancel() {},
        };
      },
    };
    const gateway = await buildGatewayServer({ pool, adapter: streamAdapter });
    const requestId = `req-sse-${Date.now()}`;
    const previousEncryptionKey = process.env.PROMPT_CONTENT_ENCRYPTION_KEY;
    process.env.PROMPT_CONTENT_ENCRYPTION_KEY = 'a'.repeat(64);
    let response: Awaited<ReturnType<typeof gateway.inject>>;
    try {
      response = await gateway.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: {
          authorization: `Bearer ${key.apiKey}`,
          'x-request-id': requestId,
        },
        payload: {
          model: 'llama3.2',
          messages: [{ role: 'user', content: 'diga olá' }],
          stream: true,
          stream_options: { include_usage: true },
          store: true,
        },
      });
    } finally {
      if (previousEncryptionKey === undefined) delete process.env.PROMPT_CONTENT_ENCRYPTION_KEY;
      else process.env.PROMPT_CONTENT_ENCRYPTION_KEY = previousEncryptionKey;
    }

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.body).toContain('"content":"olá "');
    expect(response.body).toContain('"content":"mundo"');
    expect(response.body).toContain('"prompt_tokens":8');
    expect(response.body).toContain('"content_capture":"captured"');
    expect(response.body).toContain('data: [DONE]');
    const ledger = await pool.query<{
      status: string;
      input_tokens: number;
      output_tokens: number;
      team_id: string;
      user_id: string;
    }>(
      `SELECT status, input_tokens, output_tokens, team_id, user_id FROM usage_events
       WHERE organization_id = $1 AND request_id = $2`,
      [organizationId, requestId],
    );
    expect(ledger.rows[0]).toMatchObject({
      status: 'succeeded',
      input_tokens: 8,
      output_tokens: 2,
      team_id: teamId,
      user_id: userId,
    });
    const content = await pool.query<{
      content_ciphertext: Buffer;
      nonce: Buffer;
      auth_tag: Buffer;
    }>(
      `SELECT content_ciphertext, nonce, auth_tag FROM usage_event_content
       WHERE usage_event_id = (
         SELECT id FROM usage_events WHERE organization_id = $1 AND request_id = $2
       )`,
      [organizationId, requestId],
    );
    expect(
      decryptSensitiveContent(
        {
          ciphertext: content.rows[0]!.content_ciphertext,
          nonce: content.rows[0]!.nonce,
          authTag: content.rows[0]!.auth_tag,
        },
        'a'.repeat(64),
      ),
    ).toContain('diga olá');
    const usageEvent = await pool.query<{ id: string }>(
      `SELECT id FROM usage_events WHERE organization_id = $1 AND request_id = $2`,
      [organizationId, requestId],
    );
    const api = await buildApiServer({
      pool,
      oidcOptions: { issuer: ISSUER, audience: AUDIENCE, customKeyOrJwks: publicKey },
    });
    const ownerEmail = `sse-owner-${Date.now()}@acme.local`;
    const ownerToken = await issueToken({
      sub: `kc-${ownerEmail}`,
      email: ownerEmail,
      name: 'SSE Owner',
    });
    const viewerEmail = `sse-viewer-${Date.now()}@acme.local`;
    const viewerToken = await issueToken({
      sub: `kc-${viewerEmail}`,
      email: viewerEmail,
      name: 'SSE Viewer',
    });
    try {
      const ownerMe = await api.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      const viewerMe = await api.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      const ownerId = (ownerMe.json() as { user: { id: string } }).user.id;
      const viewerId = (viewerMe.json() as { user: { id: string } }).user.id;
      await pool.query(
        `INSERT INTO memberships (organization_id, user_id, role)
         VALUES ($1, $2, 'owner'), ($1, $3, 'viewer')`,
        [organizationId, ownerId, viewerId],
      );
      const otherOrganization = await seedOrgProject();
      await pool.query(
        `INSERT INTO memberships (organization_id, user_id, role)
         VALUES ($1, $2, 'owner')`,
        [otherOrganization.organizationId, ownerId],
      );

      process.env.PROMPT_CONTENT_ENCRYPTION_KEY = 'a'.repeat(64);
      const contentUrl = `/v1/organizations/${organizationId}/usage-events/${usageEvent.rows[0]!.id}/content`;
      const contentResponse = await api.inject({
        method: 'GET',
        url: contentUrl,
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      expect(contentResponse.statusCode).toBe(200);
      expect(contentResponse.headers['cache-control']).toBe('no-store');
      expect(contentResponse.json()).toMatchObject({
        messages: [{ role: 'user', content: 'diga olá' }],
        response: 'olá mundo',
      });

      const forbiddenContent = await api.inject({
        method: 'GET',
        url: contentUrl,
        headers: { authorization: `Bearer ${viewerToken}` },
      });
      expect(forbiddenContent.statusCode).toBe(403);

      const crossTenantContent = await api.inject({
        method: 'GET',
        url: `/v1/organizations/${otherOrganization.organizationId}/usage-events/${usageEvent.rows[0]!.id}/content`,
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      expect(crossTenantContent.statusCode).toBe(404);

      const audit = await pool.query<{ action: string; target_id: string }>(
        `SELECT action, target_id FROM audit_events
         WHERE organization_id = $1 AND action = 'usage_event.content.read'`,
        [organizationId],
      );
      expect(audit.rows).toContainEqual({
        action: 'usage_event.content.read',
        target_id: usageEvent.rows[0]!.id,
      });
      const ownerCostAnalysis = await api.inject({
        method: 'GET',
        url: `/v1/organizations/${organizationId}/costs/by-model?teamId=${teamId}&userId=${userId}`,
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      expect(ownerCostAnalysis.statusCode).toBe(200);
      expect(ownerCostAnalysis.json()).toMatchObject({
        total: 1,
        items: [
          {
            team_id: teamId,
            user_id: userId,
            provider: 'ollama',
            model: 'llama3.2',
          },
        ],
      });

      await pool.query(
        `UPDATE usage_event_content SET expires_at = NOW() - INTERVAL '1 second'
         WHERE usage_event_id = $1 AND organization_id = $2`,
        [usageEvent.rows[0]!.id, organizationId],
      );
      expect(await purgeExpiredUsageEventContent(pool)).toBe(1);
      const retainedLedger = await pool.query<{ event_count: number; cost_count: number }>(
        `SELECT
           (SELECT COUNT(*)::int FROM usage_events WHERE id = $1 AND organization_id = $2) AS event_count,
           (SELECT COUNT(*)::int FROM cost_records WHERE usage_event_id = $1 AND organization_id = $2) AS cost_count`,
        [usageEvent.rows[0]!.id, organizationId],
      );
      expect(retainedLedger.rows[0]).toEqual({ event_count: 1, cost_count: 1 });
      const expiredContent = await api.inject({
        method: 'GET',
        url: contentUrl,
        headers: { authorization: `Bearer ${ownerToken}` },
      });
      expect(expiredContent.statusCode).toBe(404);
    } finally {
      if (previousEncryptionKey === undefined) delete process.env.PROMPT_CONTENT_ENCRYPTION_KEY;
      else process.env.PROMPT_CONTENT_ENCRYPTION_KEY = previousEncryptionKey;
      await api.close();
    }
    await gateway.close();
  });

  it('deve bloquear chaves revogadas, expiradas ou fora de escopo e registrar o ledger', async () => {
    const { organizationId, projectId } = await seedOrgProject();
    const revoked = await insertVirtualKey({
      organizationId,
      projectId,
      revokedAt: new Date(),
    });
    const expired = await insertVirtualKey({
      organizationId,
      projectId,
      expiresAt: new Date(Date.now() - 60_000),
    });
    const scoped = await insertVirtualKey({
      organizationId,
      projectId,
      allowedModels: ['llama3.2'],
    });

    const gateway = await buildGatewayServer({ pool, adapter: mockAdapter });

    const revokedRes = await gateway.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${revoked.apiKey}` },
      payload: { model: 'llama3.2', messages: [{ role: 'user', content: 'oi' }] },
    });
    expect(revokedRes.statusCode).toBe(403);

    const expiredRes = await gateway.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${expired.apiKey}` },
      payload: { model: 'llama3.2', messages: [{ role: 'user', content: 'oi' }] },
    });
    expect(expiredRes.statusCode).toBe(403);

    const scopeRes = await gateway.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${scoped.apiKey}` },
      payload: { model: 'gpt-4o', messages: [{ role: 'user', content: 'oi' }] },
    });
    expect(scopeRes.statusCode).toBe(403);

    const events = await pool.query<{ status: string; error_code: string; model: string }>(
      `SELECT status, error_code, model FROM usage_events
       WHERE virtual_key_id = ANY($1::uuid[])
       ORDER BY created_at`,
      [[revoked.id, expired.id, scoped.id]],
    );
    expect(events.rows).toHaveLength(3);
    expect(events.rows.every((row) => row.status === 'blocked_policy')).toBe(true);
    expect(events.rows.map((row) => row.error_code)).toEqual(
      expect.arrayContaining(['revoked', 'expired', 'model_not_allowed']),
    );

    await gateway.close();
  });

  it('deve registrar falha determinística e timeout incerto sem inventar tokens', async () => {
    const { organizationId, projectId } = await seedOrgProject();
    const key = await insertVirtualKey({ organizationId, projectId });

    const failingAdapter: LLMProviderAdapter = {
      provider: 'ollama',
      async executeChatCompletion() {
        throw new ProviderAdapterError('modelo ausente', {
          code: 'OLLAMA_ERROR',
          statusCode: 404,
        });
      },
    };
    const timeoutAdapter: LLMProviderAdapter = {
      provider: 'ollama',
      async executeChatCompletion() {
        throw new ProviderAdapterError('timeout', {
          code: 'TIMEOUT_UNCERTAIN',
          isTimeout: true,
          isUncertain: true,
        });
      },
    };

    const failingGateway = await buildGatewayServer({ pool, adapter: failingAdapter });
    const failedRes = await failingGateway.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${key.apiKey}`, 'x-request-id': 'req-failed-1' },
      payload: { model: 'llama3.2', messages: [{ role: 'user', content: 'oi' }] },
    });
    expect(failedRes.statusCode).toBe(502);
    await failingGateway.close();

    const timeoutGateway = await buildGatewayServer({ pool, adapter: timeoutAdapter });
    const timeoutRes = await timeoutGateway.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${key.apiKey}`, 'x-request-id': 'req-timeout-1' },
      payload: { model: 'llama3.2', messages: [{ role: 'user', content: 'oi' }] },
    });
    expect(timeoutRes.statusCode).toBe(504);
    await timeoutGateway.close();

    const rows = await pool.query<{
      request_id: string;
      status: string;
      input_tokens: number | null;
      output_tokens: number | null;
    }>(
      `SELECT request_id, status, input_tokens, output_tokens
       FROM usage_events
       WHERE request_id IN ('req-failed-1', 'req-timeout-1')
       ORDER BY request_id`,
    );
    expect(rows.rows).toEqual([
      {
        request_id: 'req-failed-1',
        status: 'failed',
        input_tokens: null,
        output_tokens: null,
      },
      {
        request_id: 'req-timeout-1',
        status: 'uncertain',
        input_tokens: null,
        output_tokens: null,
      },
    ]);
  });

  it('mantém Gemini desabilitado por padrão e registra uso e custo quando habilitado', async () => {
    const { organizationId, projectId } = await seedOrgProject();
    const key = await insertVirtualKey({
      organizationId,
      projectId,
      allowedProviders: ['gemini'],
      allowedModels: ['gemini-2.0-flash'],
    });
    await pool.query(
      `INSERT INTO model_prices (
         organization_id, provider, model, currency,
         input_price_per_million, output_price_per_million,
         price_source, price_type, effective_from
       )
       VALUES ($1, 'gemini', 'gemini-2.0-flash', 'USD', 1, 2,
               'internal_simulation', 'simulation', '2020-01-01T00:00:00Z')`,
      [organizationId],
    );

    const disabledGateway = await buildGatewayServer({
      pool,
      adapter: mockAdapter,
      adapters: [mockGeminiAdapter],
    });
    const disabled = await disabledGateway.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${key.apiKey}` },
      payload: { model: 'gemini-2.0-flash', messages: [{ role: 'user', content: 'oi' }] },
    });
    expect(disabled.statusCode).toBe(503);
    await disabledGateway.close();

    const gateway = await buildGatewayServer({
      pool,
      adapter: mockAdapter,
      adapters: [mockGeminiAdapter],
      externalProvidersEnabled: true,
    });
    const requestId = `req-gemini-${Date.now()}`;
    const response = await gateway.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: `Bearer ${key.apiKey}`,
        'x-request-id': requestId,
      },
      payload: { model: 'gemini-2.0-flash', messages: [{ role: 'user', content: 'oi' }] },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).usage).toMatchObject({
      prompt_tokens: 17,
      completion_tokens: 5,
      total_tokens: 22,
    });

    const usage = await pool.query<{
      provider: string;
      input_tokens: number;
      output_tokens: number;
    }>(
      `SELECT provider, input_tokens, output_tokens
       FROM usage_events WHERE organization_id = $1 AND request_id = $2`,
      [organizationId, requestId],
    );
    expect(usage.rows).toEqual([
      { provider: 'gemini', input_tokens: 17, output_tokens: 5 },
    ]);

    const cost = await pool.query<{
      provider: string;
      cost_category: string;
      model_price_id: string;
    }>(
      `SELECT provider, cost_category, model_price_id
       FROM cost_records WHERE organization_id = $1 AND usage_event_id = (
         SELECT id FROM usage_events WHERE organization_id = $1 AND request_id = $2
       )`,
      [organizationId, requestId],
    );
    expect(cost.rows).toHaveLength(1);
    expect(cost.rows[0]).toMatchObject({
      provider: 'gemini',
      cost_category: 'gateway_estimated',
    });
    expect(cost.rows[0]?.model_price_id).toBeTruthy();
    await gateway.close();
  });

  it('aplica guardrails runtime fail-closed, delega teste uma vez e processa análise assíncrona sem armazenar conteúdo', async () => {
    const { organizationId, projectId } = await seedOrgProject();
    const actor = await pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name) VALUES ($1, 'Guardrail Admin') RETURNING id`,
      [`guardrail-admin-${Date.now()}@acme.local`],
    );
    const actorId = actor.rows[0]!.id;
    await pool.query(
      `INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [organizationId, actorId],
    );
    const key = await insertVirtualKey({ organizationId, projectId });
    let targetCalls = 0;
    let runtimeEvaluatorCalls = 0;
    let asyncEvaluatorCalls = 0;
    const adapter: LLMProviderAdapter = {
      provider: 'ollama',
      async executeChatCompletion(request) {
        if (request.model === 'runtime-checker') {
          runtimeEvaluatorCalls++;
          return {
            content: 'not json',
            inputTokens: 10,
            outputTokens: 2,
            durationMs: 1,
            finishReason: 'stop',
          };
        }
        if (request.model === 'async-checker') {
          asyncEvaluatorCalls++;
          await new Promise((resolve) => setTimeout(resolve, 300));
          return {
            content: '{"decision":"block","reason":"contains user message"}',
            inputTokens: 10,
            outputTokens: 2,
            durationMs: 300,
            finishReason: 'stop',
          };
        }
        targetCalls++;
        return {
          content: 'test response',
          inputTokens: 4,
          outputTokens: 3,
          durationMs: 10,
          finishReason: 'stop',
        };
      },
      async openChatCompletionStream() {
        targetCalls++;
        return {
          async *chunks() {
            yield { content: 'test response', done: false };
            yield { content: '', done: true, finishReason: 'stop', inputTokens: 4, outputTokens: 3, durationMs: 10 };
          },
          cancel() {},
        };
      },
    };
    const deterministicRule = await pool.query<{ id: string }>(
      `INSERT INTO guardrail_rules (
         organization_id, name, rule_type, mode, scope_type, terms, created_by_user_id
       )
       VALUES ($1, 'Blocked phrase', 'deterministic', 'runtime', 'organization',
               ARRAY['blocked phrase'], $2)
       RETURNING id`,
      [organizationId, actorId],
    );
    const gateway = await buildGatewayServer({ pool, adapter });
    const headers = { authorization: `Bearer ${key.apiKey}` };
    const blocked = await gateway.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers,
      payload: {
        model: 'llama3.2',
        messages: [{ role: 'user', content: 'A BLOCKED PHRASE must not reach the LLM' }],
        stream: true,
      },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.headers['content-type']).not.toContain('text/event-stream');
    expect(JSON.parse(blocked.body)).toMatchObject({ error: 'guardrail_blocked', status: 'violation' });
    expect(targetCalls).toBe(0);
    const blockedLedger = await pool.query<{ status: string; error_code: string }>(
      `SELECT status, error_code FROM usage_events WHERE request_id = $1`,
      [JSON.parse(blocked.body).requestId],
    );
    expect(blockedLedger.rows[0]).toMatchObject({
      status: 'blocked_policy',
      error_code: 'guardrail_violation',
    });
    const blockedAlert = await pool.query<{ reason: string }>(
      `SELECT reason FROM guardrail_alerts WHERE guardrail_rule_id = $1`,
      [deterministicRule.rows[0]!.id],
    );
    expect(blockedAlert.rows[0]?.reason).not.toContain('BLOCKED PHRASE');

    const ticket = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO guardrail_test_tickets (
         organization_id, virtual_key_id, actor_user_id, token_hash, expires_at
       )
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '90 seconds')`,
      [
        organizationId,
        key.id,
        actorId,
        crypto.createHash('sha256').update(ticket).digest('hex'),
      ],
    );
    const testRequestId = `test-one-shot-${crypto.randomUUID()}`;
    const testRequest = await gateway.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'x-gateway-test-ticket': ticket, 'x-request-id': testRequestId },
      payload: {
        model: 'llama3.2',
        messages: [{ role: 'user', content: 'A safe test message' }],
        stream: false,
      },
    });
    expect(testRequest.statusCode).toBe(200);
    const testUsage = await pool.query<{ source: string; test_actor_user_id: string }>(
      `SELECT source, test_actor_user_id FROM usage_events WHERE request_id = $1`,
      [testRequestId],
    );
    expect(testUsage.rows[0]).toEqual({ source: 'dashboard_test', test_actor_user_id: actorId });
    const replay = await gateway.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'x-gateway-test-ticket': ticket },
      payload: { model: 'llama3.2', messages: [{ role: 'user', content: 'replay' }] },
    });
    expect(replay.statusCode).toBe(401);

    const runtimeRule = await pool.query<{ id: string }>(
      `INSERT INTO guardrail_rules (
         organization_id, name, rule_type, mode, scope_type, evaluator_provider,
         evaluator_model, evaluator_prompt, created_by_user_id
       )
       VALUES ($1, 'Runtime classifier', 'intelligent', 'runtime', 'organization',
               'ollama', 'runtime-checker', 'Classify the message.', $2)
       RETURNING id`,
      [organizationId, actorId],
    );
    const inconclusive = await gateway.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers,
      payload: { model: 'llama3.2', messages: [{ role: 'user', content: 'safe but evaluator output is invalid' }] },
    });
    expect(inconclusive.statusCode).toBe(403);
    expect(JSON.parse(inconclusive.body)).toMatchObject({ status: 'inconclusive' });
    expect(runtimeEvaluatorCalls).toBe(1);
    expect(targetCalls).toBe(1);
    await pool.query(`UPDATE guardrail_rules SET is_active = FALSE WHERE id = $1`, [runtimeRule.rows[0]!.id]);

    await pool.query(
      `INSERT INTO model_prices (
         organization_id, provider, model, currency, input_price_per_million,
         output_price_per_million, price_source, price_type, effective_from
       )
       VALUES ($1, 'ollama', 'async-checker', 'USD', 0.1, 0.2,
               'internal_simulation', 'simulation', NOW() - INTERVAL '1 day')`,
      [organizationId],
    );
    const asyncRule = await pool.query<{ id: string }>(
      `INSERT INTO guardrail_rules (
         organization_id, name, rule_type, mode, scope_type, evaluator_provider,
         evaluator_model, evaluator_prompt, created_by_user_id
       )
       VALUES ($1, 'Async classifier', 'intelligent', 'async', 'organization',
               'ollama', 'async-checker', 'Classify the message.', $2)
       RETURNING id`,
      [organizationId, actorId],
    );
    const asyncRequestId = `async-guardrail-${crypto.randomUUID()}`;
    const asyncResponse = await gateway.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { ...headers, 'x-request-id': asyncRequestId },
      payload: { model: 'llama3.2', messages: [{ role: 'user', content: 'inspect this asynchronously' }] },
    });
    expect(asyncResponse.statusCode).toBe(200);
    expect(asyncEvaluatorCalls).toBe(1);
    const pending = await pool.query<{ status: string }>(
      `SELECT status FROM guardrail_evaluations
       WHERE guardrail_rule_id = $1 AND request_id = $2`,
      [asyncRule.rows[0]!.id, asyncRequestId],
    );
    expect(pending.rows[0]?.status).toBe('pending');
    await new Promise((resolve) => setTimeout(resolve, 350));
    const asyncAlert = await pool.query<{ outcome: string; reason: string }>(
      `SELECT outcome, reason FROM guardrail_alerts
       WHERE guardrail_rule_id = $1 AND request_id = $2`,
      [asyncRule.rows[0]!.id, asyncRequestId],
    );
    expect(asyncAlert.rows[0]).toMatchObject({ outcome: 'violation', reason: 'Violação detectada pela regra inteligente' });
    expect(asyncAlert.rows[0]?.reason).not.toContain('inspect this asynchronously');
    const evaluatorCost = await pool.query<{ cost_category: string }>(
      `SELECT cost_category FROM cost_records
       WHERE source_guardrail_evaluation_id = (
         SELECT id FROM guardrail_evaluations
         WHERE guardrail_rule_id = $1 AND request_id = $2
       )`,
      [asyncRule.rows[0]!.id, asyncRequestId],
    );
    expect(evaluatorCost.rows[0]?.cost_category).toBe('guardrail_evaluation');
    await gateway.close();
  });

  it('deve percorrer o Ollama local de ponta a ponta quando o modelo estiver disponível', async () => {
    const ollamaReady = await isOllamaReady();
    if (!ollamaReady) {
      console.warn(
        `Ollama/modelo ${OLLAMA_MODEL} indisponível em ${OLLAMA_BASE_URL}; teste real será ignorado.`,
      );
      return;
    }

    const { organizationId, projectId } = await seedOrgProject();
    const key = await insertVirtualKey({ organizationId, projectId, allowedModels: [OLLAMA_MODEL] });
    const gateway = await buildGatewayServer({
      pool,
      ollamaBaseUrl: OLLAMA_BASE_URL,
      defaultTimeoutMs: 120000,
    });

    const requestId = `req-ollama-${Date.now()}`;
    const res = await gateway.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: `Bearer ${key.apiKey}`,
        'x-request-id': requestId,
      },
      payload: {
        model: OLLAMA_MODEL,
        messages: [{ role: 'user', content: 'Responda apenas: ambiente local funcionando' }],
        temperature: 0,
        max_tokens: 32,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };
    expect(body.choices[0]?.message.content.length).toBeGreaterThan(0);
    expect(body.usage.prompt_tokens).toBeGreaterThan(0);
    expect(body.usage.total_tokens).toBe(
      body.usage.prompt_tokens + body.usage.completion_tokens,
    );

    const stored = await pool.query<{
      status: string;
      input_tokens: number | null;
      output_tokens: number | null;
      duration_ms: number | null;
      provider: string;
      model: string;
    }>(
      `SELECT status, input_tokens, output_tokens, duration_ms, provider, model
       FROM usage_events
       WHERE request_id = $1 AND organization_id = $2`,
      [requestId, organizationId],
    );
    expect(stored.rows[0]).toMatchObject({
      status: 'succeeded',
      provider: 'ollama',
      model: OLLAMA_MODEL,
    });
    expect(stored.rows[0]!.input_tokens).toBe(body.usage.prompt_tokens);
    expect(stored.rows[0]!.output_tokens).toBe(body.usage.completion_tokens);
    expect(stored.rows[0]!.duration_ms).toBeGreaterThan(0);

    const streamRequestId = `req-ollama-sse-${Date.now()}`;
    const streamResponse = await gateway.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: `Bearer ${key.apiKey}`,
        'x-request-id': streamRequestId,
      },
      payload: {
        model: OLLAMA_MODEL,
        messages: [{ role: 'user', content: 'Responda apenas: streaming local funcionando' }],
        temperature: 0,
        max_tokens: 32,
        stream: true,
        stream_options: { include_usage: true },
      },
    });
    expect(streamResponse.statusCode).toBe(200);
    expect(streamResponse.headers['content-type']).toContain('text/event-stream');
    expect(streamResponse.body).toContain('"content":');
    expect(streamResponse.body).toContain('"prompt_tokens":');
    expect(streamResponse.body).toContain('data: [DONE]');
    const streamedLedger = await pool.query<{
      status: string;
      input_tokens: number | null;
      output_tokens: number | null;
    }>(
      `SELECT status, input_tokens, output_tokens FROM usage_events
       WHERE organization_id = $1 AND request_id = $2`,
      [organizationId, streamRequestId],
    );
    expect(streamedLedger.rows[0]?.status).toBe('succeeded');
    expect(streamedLedger.rows[0]?.input_tokens).toBeGreaterThan(0);
    expect(streamedLedger.rows[0]?.output_tokens).toBeGreaterThan(0);

    await gateway.close();
  }, 120000);

  it('Épico 11 — repassa tool_calls, recusa provedor sem suporte e registra a origem do cliente', async () => {
    const { organizationId, projectId } = await seedOrgProject();
    const key = await insertVirtualKey({ organizationId, projectId });
    const tools = [
      { type: 'function' as const, function: { name: 'ler_arquivo', parameters: { type: 'object' } } },
    ];
    const toolAdapter: LLMProviderAdapter = {
      provider: 'ollama',
      supportsTools: true,
      async executeChatCompletion() {
        return {
          content: '',
          toolCalls: [
            { id: 'call_1', type: 'function', function: { name: 'ler_arquivo', arguments: '{"a":1}' } },
          ],
          inputTokens: 10,
          outputTokens: 4,
          durationMs: 5,
          finishReason: 'tool_calls',
        };
      },
      async openChatCompletionStream() {
        return {
          chunks: (async function* () {
            yield {
              content: '',
              done: false,
              toolCallDeltas: [{ index: 0, id: 'call_1', name: 'ler_arquivo', arguments: '{"a"' }],
            };
            yield {
              content: '',
              done: true,
              toolCallDeltas: [{ index: 0, arguments: ':1}' }],
              inputTokens: 10,
              outputTokens: 4,
              finishReason: 'tool_calls',
            };
          })(),
          cancel() {},
        };
      },
    };
    const gateway = await buildGatewayServer({ pool, adapter: toolAdapter });
    const requestId = `req-tools-${Date.now()}`;
    const jsonResponse = await gateway.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${key.apiKey}`, 'x-request-id': requestId, 'x-client-origin': 'Copilot-CLI' },
      payload: { model: 'llama3.2', messages: [{ role: 'user', content: 'leia' }], tools },
    });
    expect(jsonResponse.statusCode).toBe(200);
    const message = jsonResponse.json().choices[0].message;
    expect(message.content).toBeNull();
    expect(message.tool_calls[0].function.name).toBe('ler_arquivo');
    expect(jsonResponse.json().choices[0].finish_reason).toBe('tool_calls');

    const streamResponse = await gateway.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${key.apiKey}` },
      payload: { model: 'llama3.2', messages: [{ role: 'user', content: 'leia' }], tools, stream: true },
    });
    expect(streamResponse.statusCode).toBe(200);
    expect(streamResponse.body).toContain('"tool_calls":[{"index":0,"id":"call_1","type":"function"');
    expect(streamResponse.body).toContain('"arguments":":1}"');
    expect(streamResponse.body).toContain('"finish_reason":"tool_calls"');

    const origin = await pool.query<{ client_origin: string | null }>(
      `SELECT client_origin FROM usage_events WHERE organization_id = $1 AND request_id = $2`,
      [organizationId, requestId],
    );
    expect(origin.rows[0]?.client_origin).toBe('copilot-cli');

    const unsupported = await buildGatewayServer({ pool, adapter: mockAdapter });
    const refused = await unsupported.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${key.apiKey}` },
      payload: { model: 'llama3.2', messages: [{ role: 'user', content: 'leia' }], tools },
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toBe('tools_not_supported');

    await gateway.close();
    await unsupported.close();
  }, 60000);
});
