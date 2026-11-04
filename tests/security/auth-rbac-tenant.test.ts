import { applyMigrations, closePool, getPool } from '@ia-governanca/database';
import { resetTestDatabase } from '../helpers/reset-test-database.js';
import { hasPermission, ROLES } from '@ia-governanca/identity';
import { generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApiServer } from '../../apps/api/src/index.js';

describe('Épico 03 — Autenticação OIDC, Autorização RBAC e Isolamento Multi-tenant', () => {
  const pool = getPool();
  const ISSUER = 'http://localhost:8080/realms/ai-spend';
  const AUDIENCE = 'ia-governanca-web';

  let privateKey: CryptoKey;
  let publicKey: CryptoKey;

  async function issueTestToken(params: {
    sub: string;
    email: string;
    name: string;
    issuer?: string;
    audience?: string;
    expiresIn?: string;
  }): Promise<string> {
    return new SignJWT({
      email: params.email,
      name: params.name,
      preferred_username: params.email.split('@')[0],
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject(params.sub)
      .setIssuer(params.issuer ?? ISSUER)
      .setAudience(params.audience ?? AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(params.expiresIn ?? '15m')
      .sign(privateKey);
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

  it('deve validar a matriz RBAC para todos os 6 papéis do sistema', () => {
    expect(ROLES).toEqual(['owner', 'admin', 'finops', 'security', 'developer', 'viewer']);

    expect(hasPermission('owner', 'org:manage')).toBe(true);
    expect(hasPermission('admin', 'org:manage')).toBe(false);
    expect(hasPermission('admin', 'projects:manage')).toBe(true);
    expect(hasPermission('finops', 'prices:manage')).toBe(true);
    expect(hasPermission('admin', 'prices:manage')).toBe(true);
    expect(hasPermission('finops', 'costs:manage')).toBe(true);
    expect(hasPermission('finops', 'projects:manage')).toBe(false);
    expect(hasPermission('viewer', 'costs:manage')).toBe(false);
    expect(hasPermission('security', 'audit:read')).toBe(true);
    expect(hasPermission('security', 'budgets:manage')).toBe(false);
    expect(hasPermission('developer', 'virtual_keys:manage')).toBe(true);
    expect(hasPermission('developer', 'audit:read')).toBe(false);
    expect(hasPermission('viewer', 'projects:read')).toBe(true);
    expect(hasPermission('viewer', 'projects:manage')).toBe(false);
    expect(hasPermission('viewer', 'audit:read')).toBe(false);
  });

  it('deve rejeitar requisições sem token, com issuer inválido ou com audience inválida (401)', async () => {
    const app = await buildApiServer({
      pool,
      oidcOptions: {
        issuer: ISSUER,
        audience: AUDIENCE,
        customKeyOrJwks: publicKey,
      },
    });

    const noTokenRes = await app.inject({ method: 'GET', url: '/v1/me' });
    expect(noTokenRes.statusCode).toBe(401);

    const wrongIssuerToken = await issueTestToken({
      sub: 'sub-bad-iss',
      email: 'bad@acme.local',
      name: 'Bad Issuer',
      issuer: 'http://evil.local/realms/ai-spend',
    });
    const wrongIssuerRes = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${wrongIssuerToken}` },
    });
    expect(wrongIssuerRes.statusCode).toBe(401);

    const wrongAudToken = await issueTestToken({
      sub: 'sub-bad-aud',
      email: 'badaud@acme.local',
      name: 'Bad Audience',
      audience: 'wrong-client-id',
    });
    const wrongAudRes = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${wrongAudToken}` },
    });
    expect(wrongAudRes.statusCode).toBe(401);

    await app.close();
  });

  it('deve autenticar usuário OIDC, aplicar RBAC nos endpoints, isolar tenants e registrar auditoria', async () => {
    const app = await buildApiServer({
      pool,
      oidcOptions: {
        issuer: ISSUER,
        audience: AUDIENCE,
        customKeyOrJwks: publicKey,
      },
    });

    const ownerAToken = await issueTestToken({
      sub: 'kc-owner-a',
      email: 'owner-a@org-a.local',
      name: 'Alice Owner A',
    });
    const viewerAToken = await issueTestToken({
      sub: 'kc-viewer-a',
      email: 'viewer-a@org-a.local',
      name: 'Carla Viewer A',
    });
    const securityAToken = await issueTestToken({
      sub: 'kc-security-a',
      email: 'sec-a@org-a.local',
      name: 'Daniel Security A',
    });
    const ownerBToken = await issueTestToken({
      sub: 'kc-owner-b',
      email: 'owner-b@org-b.local',
      name: 'Bruno Owner B',
    });

    // 1. Owner A cria Organização A
    const createOrgARes = await app.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: { authorization: `Bearer ${ownerAToken}` },
      payload: { name: 'Organização Alpha', slug: 'org-alpha' },
    });
    expect(createOrgARes.statusCode).toBe(201);
    const orgA = createOrgARes.json<{ id: string }>();

    // 2. Owner B cria Organização B
    const createOrgBRes = await app.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: { authorization: `Bearer ${ownerBToken}` },
      payload: { name: 'Organização Beta', slug: 'org-beta' },
    });
    expect(createOrgBRes.statusCode).toBe(201);
    const orgB = createOrgBRes.json<{ id: string }>();

    // 3. Owner A adiciona Viewer A e Security A na Organização A
    const addViewerRes = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${orgA.id}/memberships`,
      headers: { authorization: `Bearer ${ownerAToken}` },
      payload: { email: 'viewer-a@org-a.local', fullName: 'Carla Viewer A', role: 'viewer' },
    });
    expect(addViewerRes.statusCode).toBe(201);

    const addSecRes = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${orgA.id}/memberships`,
      headers: { authorization: `Bearer ${ownerAToken}` },
      payload: { email: 'sec-a@org-a.local', fullName: 'Daniel Security A', role: 'security' },
    });
    expect(addSecRes.statusCode).toBe(201);

    // 4. Owner A cria um Projeto na Organização A (201)
    const createProjRes = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${orgA.id}/projects`,
      headers: { authorization: `Bearer ${ownerAToken}` },
      payload: { name: 'Chatbot Atendimento', slug: 'chatbot-atendimento' },
    });
    expect(createProjRes.statusCode).toBe(201);

    // 5. Viewer A consegue listar projetos da Organização A (200), mas NÃO pode criar projeto (403) nem ler auditoria (403)
    const viewerListProj = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${orgA.id}/projects`,
      headers: { authorization: `Bearer ${viewerAToken}` },
    });
    expect(viewerListProj.statusCode).toBe(200);
    expect(viewerListProj.json<{ items: unknown[] }>().items).toHaveLength(1);

    const viewerCreateProj = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${orgA.id}/projects`,
      headers: { authorization: `Bearer ${viewerAToken}` },
      payload: { name: 'Tentativa Viewer', slug: 'tentativa-viewer' },
    });
    expect(viewerCreateProj.statusCode).toBe(403);

    const viewerReadAudit = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${orgA.id}/audit-events`,
      headers: { authorization: `Bearer ${viewerAToken}` },
    });
    expect(viewerReadAudit.statusCode).toBe(403);

    // 6. Security A consegue ler a trilha de auditoria da Organização A (200)
    const secReadAudit = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${orgA.id}/audit-events`,
      headers: { authorization: `Bearer ${securityAToken}` },
    });
    expect(secReadAudit.statusCode).toBe(200);
    const auditEvents = secReadAudit.json<{ items: Array<{ action: string }> }>().items;
    expect(auditEvents.map((e) => e.action)).toEqual(
      expect.arrayContaining(['organization.created', 'membership.upserted', 'project.created']),
    );

    // 7. Isolamento Multi-tenant: Owner B tenta acessar projetos e auditoria da Organização A -> 403 Forbidden
    const crossTenantProjRes = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${orgA.id}/projects`,
      headers: { authorization: `Bearer ${ownerBToken}` },
    });
    expect(crossTenantProjRes.statusCode).toBe(403);
    expect(crossTenantProjRes.json<{ error: string }>().error).toBe('forbidden_tenant');

    // E Owner A tenta acessar projetos da Organização B -> 403 Forbidden
    const crossTenantOrgBRes = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${orgB.id}/projects`,
      headers: { authorization: `Bearer ${ownerAToken}` },
    });
    expect(crossTenantOrgBRes.statusCode).toBe(403);

    await app.close();
  });

  it('deve emitir um token OIDC real no Keycloak local (:8080) e autenticar em GET /v1/me via JWKS remoto', async () => {
    const tokenRes = await fetch(
      'http://localhost:8080/realms/ai-spend/protocol/openid-connect/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: 'ia-governanca-web',
          grant_type: 'password',
          username: 'owner@acme.local',
          password: 'owner_dev_123',
          scope: 'openid profile email',
        }),
      },
    );
    expect(tokenRes.status).toBe(200);
    const tokenData = (await tokenRes.json()) as { access_token: string };
    expect(tokenData.access_token).toBeDefined();

    // Testar servidor usando o JWKS remoto real do Keycloak (sem customKeyOrJwks)
    const liveApp = await buildApiServer({ pool });
    const meRes = await liveApp.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${tokenData.access_token}` },
    });

    expect(meRes.statusCode).toBe(200);
    const meBody = meRes.json<{ user: { email: string; fullName: string } }>();
    expect(meBody.user.email).toBe('owner@acme.local');

    await liveApp.close();
  });
});
