import { checkDatabaseConnection, failInterruptedGuardrailEvaluations, getPool } from '@ia-governanca/database';
import {
  createModelPrice,
  closeModelPrice,
  listUsageEvents,
  recordFinancialAdjustment,
  reconcileReportedCost,
  summarizeCosts,
} from '@ia-governanca/finance';
import {
  createBudgetPolicy,
  updateBudgetPolicy,
  type BudgetPolicyInput,
} from '@ia-governanca/policies';
import {
  generateVirtualKey,
  hasPermission,
  verifyOidcToken,
  LOCAL_ISSUER,
  peekTokenIssuer,
  resolveAuthConfig,
  verifyLocalAccessToken,
  type AuthMode,
  type OidcVerifierOptions,
  type Permission,
} from '@ia-governanca/identity';
import {
  ChatCompletionRequestSchema,
  CreateVirtualKeyInputSchema,
  DashboardQueryFiltersSchema,
  GuardrailRuleInputSchema,
  loadEnvConfig,
  UsageEventStatusSchema,
  type DatasetType,
  type Role,
} from '@ia-governanca/contracts';
import { MetricsRegistry } from '@ia-governanca/observability';
import { decryptSensitiveContent } from '@ia-governanca/secure-content';
import { executeSync, recoverInterruptedSyncRuns, workerMetrics } from '@ia-governanca/worker';
import rateLimit from '@fastify/rate-limit';
import { decryptConnectorCredentials, encryptConnectorCredentials } from './credential-vault.js';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import type pg from 'pg';
import { registerLocalAuthRoutes } from './local-auth-routes.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  oidcSubject: string | null;
  authSource: 'oidc' | 'local';
  familyId?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthenticatedUser;
    membershipRole?: Role;
    metricsStartedAt?: number;
  }
}

export interface BuildApiServerOptions {
  pool?: pg.Pool;
  oidcOptions?: OidcVerifierOptions;
  authMode?: AuthMode;
  localJwtSecret?: string;
  rateLimitMax?: number;
  rateLimitTimeWindow?: number | string;
}

export async function recordAuditEvent(
  pool: pg.Pool,
  params: {
    organizationId: string;
    actorUserId: string;
    action: string;
    targetType: string;
    targetId: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO audit_events (organization_id, actor_user_id, action, target_type, target_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      params.organizationId,
      params.actorUserId,
      params.action,
      params.targetType,
      params.targetId,
      JSON.stringify(params.metadata ?? {}),
    ],
  );
}

async function writeProxyChunk(reply: FastifyReply, chunk: Uint8Array): Promise<void> {
  if (reply.raw.destroyed) throw new Error('Dashboard client disconnected');
  if (reply.raw.write(chunk)) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      reply.raw.off('drain', onDrain);
      reply.raw.off('close', onClose);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new Error('Dashboard client disconnected'));
    };
    reply.raw.once('drain', onDrain);
    reply.raw.once('close', onClose);
  });
}

export async function buildApiServer(options: BuildApiServerOptions = {}) {
  const pool = options.pool ?? getPool();
  const metrics = new MetricsRegistry();
  const authConfig = resolveAuthConfig(process.env, {
    mode: options.authMode,
    localJwtSecret: options.localJwtSecret,
  });
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.password',
        'req.body.secret',
        'req.body.api_key',
        'req.body.access_token',
        'req.body.refresh_token',
        'req.body.messages',
        'body.password',
        'body.secret',
        'body.api_key',
        'body.access_token',
        'body.refresh_token',
        'body.credentials',
        'body.encrypted_credentials',
        'body.messages',
        'body.prompt',
      ],
    },
  });

  await app.register(rateLimit, {
    global: true,
    max: options.rateLimitMax ?? Number(process.env.API_RATE_LIMIT_MAX ?? 120),
    timeWindow: options.rateLimitTimeWindow ?? '1 minute',
  });

  app.addHook('onRequest', async (request) => {
    request.metricsStartedAt = Date.now();
  });
  app.addHook('onResponse', async (request, reply) => {
    const durationMs = Date.now() - (request.metricsStartedAt ?? Date.now());
    const route = request.routeOptions.url ?? 'unmatched';
    const labels = { method: request.method, route, status: reply.statusCode };
    metrics.increment('api_http_requests_total', labels);
    metrics.observe('api_http_request_duration_ms', labels, durationMs, [5, 10, 25, 50, 100, 250, 500, 1000, 5000]);
    const params = request.params as { orgId?: string; projectId?: string };
    const body = request.body as { projectId?: string; provider?: string } | undefined;
    const query = request.query as { provider?: string } | undefined;
    request.log.info(
      {
        request_id: request.id,
        organization_id: params.orgId ?? null,
        project_id: params.projectId ?? body?.projectId ?? null,
        provider: body?.provider ?? query?.provider ?? null,
        status: reply.statusCode < 400 ? 'succeeded' : 'failed',
        duration_ms: durationMs,
        error_code: reply.statusCode >= 400 ? `http_${reply.statusCode}` : null,
      },
      'HTTP request completed',
    );
  });

  await app.register(cors, {
    origin: process.env.APP_BASE_URL ?? 'http://localhost:3000',
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'ia-governanca — API Administrativa',
        version: '1.0.0',
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

  app.get('/health', { config: { rateLimit: false } }, async (request, reply) => {
    try {
      await checkDatabaseConnection(pool);
      return { status: 'ok', database: true };
    } catch {
      request.log.warn(
        {
          request_id: request.id,
          organization_id: null,
          project_id: null,
          provider: null,
          status: 'degraded',
          duration_ms: Date.now() - (request.metricsStartedAt ?? Date.now()),
          error_code: 'database_unavailable',
        },
        'API health check failed',
      );
      return reply.code(503).send({ status: 'degraded', database: false });
    }
  });

  app.get('/metrics', { config: { rateLimit: false } }, async (_request, reply) =>
    reply.type('text/plain; version=0.0.4; charset=utf-8').send(metrics.render() + workerMetrics.render()),
  );

  async function authenticateRequest(request: FastifyRequest, reply: FastifyReply) {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Missing Bearer token' });
    }

    const token = authHeader.slice('Bearer '.length).trim();
    try {
      if (peekTokenIssuer(token) === LOCAL_ISSUER) {
        if (!authConfig.localEnabled || !authConfig.localJwtSecret) {
          return reply.code(401).send({ error: 'unauthorized', message: 'Invalid or expired token' });
        }
        const localClaims = await verifyLocalAccessToken(authConfig.localJwtSecret, token);
        const localRes = await pool.query<{
          id: string;
          email: string;
          full_name: string;
          oidc_subject: string | null;
          is_active: boolean;
          deleted_at: Date | null;
          must_change_password: boolean;
        }>(
          `SELECT u.id, u.email, u.full_name, u.oidc_subject, u.is_active, u.deleted_at, u.must_change_password
           FROM users u
           WHERE u.id = $1
             AND EXISTS (
               SELECT 1 FROM auth_sessions s
               WHERE s.family_id = $2 AND s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > NOW()
             )`,
          [localClaims.userId, localClaims.familyId],
        );
        const localUser = localRes.rows[0];
        if (!localUser) return reply.code(401).send({ error: 'unauthorized', message: 'Invalid or expired token' });
        if (!localUser.is_active || localUser.deleted_at !== null) {
          return reply.code(403).send({ error: 'forbidden', message: 'User account is disabled' });
        }
        const routeUrl = request.routeOptions.url ?? '';
        if (localUser.must_change_password && !['/auth/change-password', '/auth/logout'].includes(routeUrl)) {
          return reply.code(403).send({ error: 'password_change_required', message: 'É necessário trocar a senha' });
        }
        request.authUser = {
          id: localUser.id,
          email: localUser.email,
          fullName: localUser.full_name,
          oidcSubject: localUser.oidc_subject,
          authSource: 'local',
          familyId: localClaims.familyId,
        };
        return;
      }

      if (!authConfig.oidcEnabled) {
        return reply.code(401).send({ error: 'unauthorized', message: 'Invalid or expired token' });
      }
      const claims = await verifyOidcToken(token, options.oidcOptions);

      // Upsert ou localizar usuário pelo oidc_subject ou email
      const userRes = await pool.query<{
        id: string;
        email: string;
        full_name: string;
        oidc_subject: string;
        is_active: boolean;
        deleted_at: Date | null;
      }>(
        `INSERT INTO users (email, full_name, oidc_subject)
         VALUES ($1, $2, $3)
         ON CONFLICT (email) DO UPDATE
           SET oidc_subject = COALESCE(users.oidc_subject, EXCLUDED.oidc_subject),
               updated_at = NOW()
         RETURNING id, email, full_name, oidc_subject, is_active, deleted_at`,
        [claims.email, claims.fullName, claims.sub],
      );

      const user = userRes.rows[0];
      if (!user || !user.is_active || user.deleted_at !== null) {
        return reply.code(403).send({ error: 'forbidden', message: 'User account is disabled' });
      }

      request.authUser = {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        oidcSubject: user.oidc_subject,
        authSource: 'oidc',
      };
    } catch {
      return reply.code(401).send({ error: 'unauthorized', message: 'Invalid or expired token' });
    }
  }

  function requireOrgPermission(permission: Permission) {
    return async function orgPermissionGuard(request: FastifyRequest, reply: FastifyReply) {
      await authenticateRequest(request, reply);
      if (reply.sent || !request.authUser) return;

      const params = request.params as { orgId?: string };
      const orgId = params.orgId;
      if (!orgId) {
        return reply.code(400).send({ error: 'bad_request', message: 'Missing organization ID' });
      }

      const memberRes = await pool.query<{ role: Role }>(
        `SELECT m.role
         FROM memberships m
         JOIN organizations o ON o.id = m.organization_id
         WHERE m.organization_id = $1
           AND m.user_id = $2
           AND m.deleted_at IS NULL
           AND o.deleted_at IS NULL`,
        [orgId, request.authUser.id],
      );

      const membership = memberRes.rows[0];
      if (!membership) {
        return reply
          .code(403)
          .send({ error: 'forbidden_tenant', message: 'User does not belong to this organization' });
      }

      if (!hasPermission(membership.role, permission)) {
        return reply.code(403).send({
          error: 'insufficient_role',
          message: `Role '${membership.role}' does not have permission '${permission}'`,
        });
      }

      request.membershipRole = membership.role;
    };
  }

  registerLocalAuthRoutes(app, {
    pool,
    authConfig,
    metrics,
    authenticateRequest,
    requireOrgPermission,
  });

  // Perfil e organizações do usuário autenticado
  app.get('/v1/me', { preHandler: [authenticateRequest] }, async (request) => {
    const user = request.authUser!;
    const membershipsRes = await pool.query<{
      organization_id: string;
      organization_name: string;
      organization_slug: string;
      role: Role;
    }>(
      `SELECT m.organization_id, o.name AS organization_name, o.slug AS organization_slug, m.role
       FROM memberships m
       JOIN organizations o ON o.id = m.organization_id
       WHERE m.user_id = $1 AND m.deleted_at IS NULL AND o.deleted_at IS NULL
       ORDER BY o.name`,
      [user.id],
    );

    return {
      user: { id: user.id, email: user.email, fullName: user.fullName, oidcSubject: user.oidcSubject },
      memberships: membershipsRes.rows,
    };
  });

  app.get(
    '/v1/organizations/:orgId/privacy-settings',
    { preHandler: [requireOrgPermission('prompts:read')] },
    async (request) => {
      const { orgId } = request.params as { orgId: string };
      const result = await pool.query<{
        prompt_capture_enabled: boolean;
        prompt_capture_retention_days: number;
      }>(
        `SELECT prompt_capture_enabled, prompt_capture_retention_days
         FROM organizations WHERE id = $1 AND deleted_at IS NULL`,
        [orgId],
      );
      return result.rows[0] ?? { prompt_capture_enabled: false, prompt_capture_retention_days: 7 };
    },
  );

  app.patch(
    '/v1/organizations/:orgId/privacy-settings',
    { preHandler: [requireOrgPermission('prompts:manage')] },
    async (request, reply) => {
      const { orgId } = request.params as { orgId: string };
      const actor = request.authUser!;
      const body = request.body as {
        promptCaptureEnabled?: boolean;
        promptCaptureRetentionDays?: number;
      } | undefined;
      if (
        !body ||
        typeof body.promptCaptureEnabled !== 'boolean' ||
        !Number.isInteger(body.promptCaptureRetentionDays) ||
        body.promptCaptureRetentionDays! < 1 ||
        body.promptCaptureRetentionDays! > 365
      ) {
        return reply.code(400).send({
          error: 'bad_request',
          message: 'Informe promptCaptureEnabled e promptCaptureRetentionDays entre 1 e 365',
        });
      }
      const result = await pool.query(
        `UPDATE organizations
         SET prompt_capture_enabled = $2,
             prompt_capture_retention_days = $3,
             updated_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING prompt_capture_enabled, prompt_capture_retention_days`,
        [orgId, body.promptCaptureEnabled, body.promptCaptureRetentionDays],
      );
      if (!result.rows[0]) {
        return reply.code(404).send({ error: 'organization_not_found' });
      }
      await recordAuditEvent(pool, {
        organizationId: orgId,
        actorUserId: actor.id,
        action: 'organization.privacy_settings.updated',
        targetType: 'organization',
        targetId: orgId,
        metadata: {
          promptCaptureEnabled: body.promptCaptureEnabled,
          promptCaptureRetentionDays: body.promptCaptureRetentionDays,
        },
      });
      return result.rows[0];
    },
  );

  // Criar organização (usuário autenticado torna-se owner e gera auditoria)
  app.post('/v1/organizations', { preHandler: [authenticateRequest] }, async (request, reply) => {
    const user = request.authUser!;
    const body = request.body as { name?: string; slug?: string } | undefined;
    if (!body?.name || !body?.slug) {
      return reply.code(400).send({ error: 'bad_request', message: 'name and slug are required' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const orgRes = await client.query<{ id: string; name: string; slug: string }>(
        `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id, name, slug`,
        [body.name, body.slug],
      );
      const org = orgRes.rows[0]!;

      await client.query(
        `INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner')`,
        [org.id, user.id],
      );

      await client.query(
        `INSERT INTO audit_events (organization_id, actor_user_id, action, target_type, target_id, metadata)
         VALUES ($1, $2, 'organization.created', 'organization', $3, $4::jsonb)`,
        [org.id, user.id, org.id, JSON.stringify({ name: org.name, slug: org.slug })],
      );

      await client.query('COMMIT');
      return reply.code(201).send(org);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // Listar projetos da organização (requer permissão projects:read na organização)
  app.get(
    '/v1/organizations/:orgId/projects',
    { preHandler: [requireOrgPermission('projects:read')] },
    async (request) => {
      const { orgId } = request.params as { orgId: string };
      const res = await pool.query(
        `SELECT id, organization_id, team_id, name, slug, description, created_at
         FROM projects
         WHERE organization_id = $1 AND deleted_at IS NULL
         ORDER BY created_at DESC`,
        [orgId],
      );
      return { items: res.rows };
    },
  );

  // Criar projeto na organização (requer projects:manage: owner ou admin)
  app.post(
    '/v1/organizations/:orgId/projects',
    { preHandler: [requireOrgPermission('projects:manage')] },
    async (request, reply) => {
      const { orgId } = request.params as { orgId: string };
      const user = request.authUser!;
      const body = request.body as { name?: string; slug?: string; teamId?: string; description?: string } | undefined;
      if (!body?.name || !body?.slug) {
        return reply.code(400).send({ error: 'bad_request', message: 'name and slug are required' });
      }

      const projRes = await pool.query<{
        id: string;
        organization_id: string;
        team_id: string | null;
        name: string;
        slug: string;
      }>(
        `INSERT INTO projects (organization_id, team_id, name, slug, description)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, organization_id, team_id, name, slug`,
        [orgId, body.teamId ?? null, body.name, body.slug, body.description ?? null],
      );
      const project = projRes.rows[0]!;

      await recordAuditEvent(pool, {
        organizationId: orgId,
        actorUserId: user.id,
        action: 'project.created',
        targetType: 'project',
        targetId: project.id,
        metadata: { name: project.name, slug: project.slug },
      });

      return reply.code(201).send(project);
    },
  );

  app.get(
    '/v1/organizations/:orgId/teams',
    { preHandler: [requireOrgPermission('teams:read')] },
    async (request) => {
      const { orgId } = request.params as { orgId: string };
      const result = await pool.query(
        `SELECT id, organization_id, name, slug, created_at
         FROM teams
         WHERE organization_id = $1 AND deleted_at IS NULL
         ORDER BY name`,
        [orgId],
      );
      return { items: result.rows };
    },
  );

  app.get(
    '/v1/organizations/:orgId/teams/:teamId/memberships',
    { preHandler: [requireOrgPermission('teams:read')] },
    async (request, reply) => {
      const { orgId, teamId } = request.params as { orgId: string; teamId: string };
      const result = await pool.query(
        `SELECT tm.id, tm.team_id, tm.user_id, u.email, u.full_name
         FROM team_memberships tm
         JOIN teams t ON t.id = tm.team_id AND t.organization_id = tm.organization_id
         JOIN users u ON u.id = tm.user_id
         WHERE tm.organization_id = $1 AND tm.team_id = $2
           AND t.deleted_at IS NULL AND u.is_active = TRUE AND u.deleted_at IS NULL
         ORDER BY u.full_name`,
        [orgId, teamId],
      );
      return { items: result.rows };
    },
  );

  app.post(
    '/v1/organizations/:orgId/teams/:teamId/memberships',
    { preHandler: [requireOrgPermission('members:manage')] },
    async (request, reply) => {
      const { orgId, teamId } = request.params as { orgId: string; teamId: string };
      const actor = request.authUser!;
      const body = request.body as { userId?: string } | undefined;
      if (!body?.userId) {
        return reply.code(400).send({ error: 'bad_request', message: 'userId é obrigatório' });
      }
      const result = await pool.query(
        `INSERT INTO team_memberships (organization_id, team_id, user_id)
         SELECT $1, t.id, m.user_id
         FROM teams t
         JOIN memberships m ON m.organization_id = t.organization_id
         JOIN users u ON u.id = m.user_id AND u.is_active = TRUE AND u.deleted_at IS NULL
         WHERE t.organization_id = $1 AND t.id = $2 AND t.deleted_at IS NULL
           AND m.user_id = $3 AND m.deleted_at IS NULL
         ON CONFLICT DO NOTHING
         RETURNING id, organization_id, team_id, user_id`,
        [orgId, teamId, body.userId],
      );
      if (!result.rows[0]) {
        const valid = await pool.query(
          `SELECT 1 FROM teams t
           JOIN memberships m ON m.organization_id = t.organization_id
           JOIN users u ON u.id = m.user_id
           WHERE t.organization_id = $1 AND t.id = $2 AND t.deleted_at IS NULL
             AND m.user_id = $3 AND m.deleted_at IS NULL
             AND u.is_active = TRUE AND u.deleted_at IS NULL`,
          [orgId, teamId, body.userId],
        );
        if (!valid.rowCount) {
          return reply.code(404).send({
            error: 'team_or_member_not_found',
            message: 'Equipe ou membro ativo não encontrado nesta organização',
          });
        }
        const existingMembership = await pool.query<{ team_id: string }>(
          `SELECT team_id FROM team_memberships
           WHERE organization_id = $1 AND user_id = $2`,
          [orgId, body.userId],
        );
        if (existingMembership.rows[0] && existingMembership.rows[0].team_id !== teamId) {
          return reply.code(409).send({
            error: 'member_already_assigned',
            message: 'Cada pessoa pode pertencer a apenas uma equipe nesta organização',
          });
        }
      }
      const membership = result.rows[0] ?? {
        team_id: teamId,
        user_id: body.userId,
      };
      await recordAuditEvent(pool, {
        organizationId: orgId,
        actorUserId: actor.id,
        action: 'team_membership.upserted',
        targetType: 'team_membership',
        targetId: String(membership.id ?? `${teamId}:${body.userId}`),
        metadata: { teamId, userId: body.userId },
      });
      return reply.code(201).send(membership);
    },
  );

  app.get(
    '/v1/organizations/:orgId/memberships',
    { preHandler: [requireOrgPermission('members:manage')] },
    async (request) => {
      const { orgId } = request.params as { orgId: string };
      const result = await pool.query(
        `SELECT m.id, m.organization_id, m.user_id, m.role, m.created_at,
                u.email, u.full_name
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         WHERE m.organization_id = $1 AND m.deleted_at IS NULL
           AND u.is_active = TRUE AND u.deleted_at IS NULL
         ORDER BY u.full_name`,
        [orgId],
      );
      return { items: result.rows };
    },
  );

  app.get(
    '/v1/organizations/:orgId/licenses',
    { preHandler: [requireOrgPermission('connectors:read')] },
    async (request, reply) => {
      const { orgId } = request.params as { orgId: string };
      const filters = DashboardQueryFiltersSchema.safeParse(request.query);
      if (!filters.success) {
        return reply.code(400).send({
          error: 'bad_request',
          message: 'Filtros inválidos',
          issues: filters.error.issues,
        });
      }
      if (filters.data.organizationId && filters.data.organizationId !== orgId) {
        return reply.code(403).send({ error: 'forbidden_tenant', message: 'Organização não autorizada' });
      }
      const { projectId, teamId, provider, dataSource } = filters.data;
      const result = await pool.query(
        `SELECT lc.id, lc.organization_id, lc.provider, lc.product_name, lc.contracted_seats,
                lc.currency, lc.total_contract_value, lc.cost_per_seat, lc.billing_cycle,
                lc.starts_at, lc.ends_at, lc.status,
                COUNT(DISTINCT la.id) FILTER (WHERE la.status = 'assigned')::int AS assigned_seats,
                COUNT(DISTINCT la.id) FILTER (
                  WHERE la.status = 'assigned'
                    AND la.last_activity_at >= COALESCE($2::timestamptz, NOW() - INTERVAL '30 days')
                    AND ($7::timestamptz IS NULL OR la.last_activity_at < $7)
                )::int AS active_seats,
                COUNT(DISTINCT la.id) FILTER (
                  WHERE la.status = 'assigned'
                    AND (la.last_activity_at < COALESCE($2::timestamptz, NOW() - INTERVAL '30 days')
                      OR ($7::timestamptz IS NOT NULL AND la.last_activity_at >= $7))
                )::int AS idle_seats,
                COUNT(DISTINCT la.id) FILTER (
                  WHERE la.status = 'assigned' AND la.last_activity_at IS NULL
                )::int AS unknown_activity_seats
         FROM license_contracts lc
         LEFT JOIN license_assignments la
           ON la.contract_id = lc.id AND la.organization_id = lc.organization_id
         LEFT JOIN external_identities ei
           ON ei.id = la.external_identity_id AND ei.organization_id = la.organization_id
         LEFT JOIN source_records sr
           ON sr.id = la.source_record_id AND sr.organization_id = la.organization_id
         LEFT JOIN provider_connections pc
           ON pc.id = sr.provider_connection_id AND pc.organization_id = sr.organization_id
         LEFT JOIN team_memberships tm
           ON tm.user_id = COALESCE(la.user_id, ei.user_id)
          AND tm.organization_id = la.organization_id
         WHERE lc.organization_id = $1
           AND ($3::uuid IS NULL OR tm.team_id = $3)
           AND ($4::text IS NULL OR lc.provider = $4)
           AND ($5::text IS NULL OR
             ($5 = 'csv' AND COALESCE(pc.connection_type, 'csv') = 'csv') OR
             ($5 = 'official_api' AND pc.connection_type = 'api') OR
             ($5 = 'gateway_local' AND FALSE))
           AND ($6::uuid IS NULL OR EXISTS (
             SELECT 1 FROM cost_records cr
             WHERE cr.license_assignment_id = la.id AND cr.organization_id = la.organization_id
               AND cr.project_id = $6
           ))
         GROUP BY lc.id
         ORDER BY lc.starts_at DESC`,
        [
          orgId,
          filters.data.startDate ? new Date(`${filters.data.startDate}T00:00:00.000Z`) : null,
          teamId ?? null,
          provider ?? null,
          dataSource ?? null,
          projectId ?? null,
          filters.data.endDate
            ? new Date(new Date(`${filters.data.endDate}T00:00:00.000Z`).getTime() + 86_400_000)
            : null,
        ],
      );
      const pending = await pool.query(
        `SELECT ei.id, ei.provider, ei.external_user_id, ei.external_email,
                ei.display_name, ei.match_status, ei.created_at
         FROM external_identities ei
         WHERE ei.organization_id = $1 AND ei.match_status = 'pending_review'
           AND ($2::text IS NULL OR ei.provider = $2)
         ORDER BY ei.created_at DESC`,
        [orgId, provider ?? null],
      );
      return { contracts: result.rows, pendingIdentities: pending.rows };
    },
  );

  // Criar equipe na organização (requer teams:manage: owner ou admin)
  app.post(
    '/v1/organizations/:orgId/teams',
    { preHandler: [requireOrgPermission('teams:manage')] },
    async (request, reply) => {
      const { orgId } = request.params as { orgId: string };
      const user = request.authUser!;
      const body = request.body as { name?: string; slug?: string } | undefined;
      if (!body?.name || !body?.slug) {
        return reply.code(400).send({ error: 'bad_request', message: 'name and slug are required' });
      }

      const teamRes = await pool.query<{ id: string; organization_id: string; name: string; slug: string }>(
        `INSERT INTO teams (organization_id, name, slug) VALUES ($1, $2, $3) RETURNING id, organization_id, name, slug`,
        [orgId, body.name, body.slug],
      );
      const team = teamRes.rows[0]!;

      await recordAuditEvent(pool, {
        organizationId: orgId,
        actorUserId: user.id,
        action: 'team.created',
        targetType: 'team',
        targetId: team.id,
        metadata: { name: team.name, slug: team.slug },
      });

      return reply.code(201).send(team);
    },
  );

  // Associar membro à organização com papel explícito (requer members:manage: owner ou admin)
  app.post(
    '/v1/organizations/:orgId/memberships',
    { preHandler: [requireOrgPermission('members:manage')] },
    async (request, reply) => {
      const { orgId } = request.params as { orgId: string };
      const actor = request.authUser!;
      const body = request.body as { email?: string; fullName?: string; role?: Role } | undefined;
      if (!body?.email || !body?.role) {
        return reply.code(400).send({ error: 'bad_request', message: 'email and role are required' });
      }

      const targetUserRes = await pool.query<{ id: string }>(
        `INSERT INTO users (email, full_name)
         VALUES ($1, $2)
         ON CONFLICT (email) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [body.email, body.fullName ?? body.email],
      );
      const targetUserId = targetUserRes.rows[0]!.id;

      const memberRes = await pool.query<{ id: string; organization_id: string; user_id: string; role: Role }>(
        `INSERT INTO memberships (organization_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (organization_id, user_id) DO UPDATE
           SET role = EXCLUDED.role, deleted_at = NULL, updated_at = NOW()
         RETURNING id, organization_id, user_id, role`,
        [orgId, targetUserId, body.role],
      );
      const membership = memberRes.rows[0]!;

      await recordAuditEvent(pool, {
        organizationId: orgId,
        actorUserId: actor.id,
        action: 'membership.upserted',
        targetType: 'membership',
        targetId: membership.id,
        metadata: { targetUserId, email: body.email, role: body.role },
      });

      return reply.code(201).send(membership);
    },
  );

  // Consultar trilha de auditoria (requer audit:read: owner, admin ou security)
  app.get(
    '/v1/organizations/:orgId/audit-events',
    { preHandler: [requireOrgPermission('audit:read')] },
    async (request, reply) => {
      const { orgId } = request.params as { orgId: string };
      const filters = DashboardQueryFiltersSchema.safeParse(request.query);
      if (!filters.success) {
        return reply.code(400).send({ error: 'bad_request', message: 'Filtros inválidos' });
      }
      if (filters.data.organizationId && filters.data.organizationId !== orgId) {
        return reply.code(403).send({ error: 'forbidden_tenant', message: 'Organização não autorizada' });
      }
      const startDate = filters.data.startDate
        ? new Date(`${filters.data.startDate}T00:00:00.000Z`)
        : null;
      const endDate = filters.data.endDate
        ? new Date(new Date(`${filters.data.endDate}T00:00:00.000Z`).getTime() + 86_400_000)
        : null;
      const res = await pool.query(
        `SELECT ae.id, ae.organization_id, ae.actor_user_id, u.email AS actor_email,
                ae.action, ae.target_type, ae.target_id, ae.metadata, ae.created_at
         FROM audit_events ae
         LEFT JOIN users u ON u.id = ae.actor_user_id
         WHERE ae.organization_id = $1
           AND ($2::timestamptz IS NULL OR ae.created_at >= $2)
           AND ($3::timestamptz IS NULL OR ae.created_at < $3)
           AND ($4::uuid IS NULL OR ae.metadata ->> 'projectId' = $4::text)
           AND ($5::uuid IS NULL OR EXISTS (
             SELECT 1 FROM projects p
             WHERE p.id::text = ae.metadata ->> 'projectId'
               AND p.organization_id = ae.organization_id AND p.team_id = $5
           ))
           AND ($6::text IS NULL OR ae.metadata ->> 'provider' = $6)
           AND ($7::text IS NULL OR ae.metadata ->> 'model' = $7)
           AND ($8::text IS NULL OR ae.metadata ->> 'costCategory' = $8)
           AND ($9::text IS NULL OR ae.metadata ->> 'dataSource' = $9)
         ORDER BY ae.created_at DESC
         LIMIT 500`,
        [
          orgId, startDate, endDate, filters.data.projectId ?? null, filters.data.teamId ?? null,
          filters.data.provider ?? null, filters.data.model ?? null, filters.data.costCategory ?? null,
          filters.data.dataSource ?? null,
        ],
      );
      return { items: res.rows };
    },
  );

  // Importar arquivo CSV com dados financeiros ou licenças (requer connectors:manage: owner, admin ou finops)
  app.post(
    '/v1/organizations/:orgId/connectors/import-csv',
    { preHandler: [requireOrgPermission('connectors:manage')] },
    async (request, reply) => {
      const { orgId } = request.params as { orgId: string };
      const actor = request.authUser!;
      const body = request.body as
        | {
            dataset?: DatasetType;
            csvContent?: string;
            dryRun?: boolean;
            provider?: string;
            providerConnectionId?: string;
            contractId?: string;
          }
        | undefined;

      if (!body?.dataset || !body?.csvContent) {
        return reply.code(400).send({
          error: 'bad_request',
          message: 'Campos dataset e csvContent são obrigatórios',
        });
      }

      const summary = await executeSync(pool, {
        organizationId: orgId,
        provider: body.provider || 'csv',
        dataset: body.dataset,
        dryRun: Boolean(body.dryRun),
        providerConnectionId: body.providerConnectionId,
        defaultContractId: body.contractId,
        connectorConfig: {
          csvContent: body.csvContent,
          defaultProvider: body.provider || 'csv',
        },
      });

      await recordAuditEvent(pool, {
        organizationId: orgId,
        actorUserId: actor.id,
        action: body.dryRun ? 'connector.csv_dry_run' : 'connector.csv_imported',
        targetType: 'sync_run',
        targetId: summary.syncRunId,
        metadata: {
          dataset: summary.dataset,
          status: summary.status,
          recordsProcessed: summary.recordsProcessed,
          recordsCreated: summary.recordsCreated,
          recordsUpdated: summary.recordsUpdated,
          recordsFailed: summary.recordsFailed,
          dryRun: Boolean(body.dryRun),
        },
      });

      const statusCode = body.dryRun ? 200 : 201;
      return reply.code(statusCode).send(summary);
    },
  );

  // Listar execuções de sincronização da organização (requer connectors:read: owner, admin, finops, viewer)
  app.get(
    '/v1/organizations/:orgId/connectors/sync-runs',
    { preHandler: [requireOrgPermission('connectors:read')] },
    async (request, reply) => {
      const { orgId } = request.params as { orgId: string };
      const filters = DashboardQueryFiltersSchema.safeParse(request.query);
      if (!filters.success) {
        return reply.code(400).send({ error: 'bad_request', message: 'Filtros inválidos' });
      }
      if (filters.data.organizationId && filters.data.organizationId !== orgId) {
        return reply.code(403).send({ error: 'forbidden_tenant', message: 'Organização não autorizada' });
      }
      const startDate = filters.data.startDate
        ? new Date(`${filters.data.startDate}T00:00:00.000Z`)
        : null;
      const endDate = filters.data.endDate
        ? new Date(new Date(`${filters.data.endDate}T00:00:00.000Z`).getTime() + 86_400_000)
        : null;
      const res = await pool.query(
        `SELECT sr.id, sr.organization_id, sr.provider_connection_id, sr.dataset, sr.status,
                sr.period_start, sr.period_end, sr.records_processed, sr.records_created,
                sr.records_updated, sr.records_failed, sr.checkpoint, sr.error_details,
                sr.started_at, sr.finished_at
         FROM sync_runs sr
         LEFT JOIN provider_connections pc
           ON pc.id = sr.provider_connection_id AND pc.organization_id = sr.organization_id
         WHERE sr.organization_id = $1
           AND ($2::timestamptz IS NULL OR sr.started_at >= $2)
           AND ($3::timestamptz IS NULL OR sr.started_at < $3)
           AND ($4::text IS NULL OR pc.provider = $4)
           AND ($5::text IS NULL OR
             ($5 = 'csv' AND COALESCE(pc.connection_type, 'csv') = 'csv') OR
             ($5 = 'official_api' AND pc.connection_type = 'api') OR
             ($5 = 'gateway_local' AND FALSE))
           AND ($6::uuid IS NULL OR EXISTS (
             SELECT 1 FROM source_records srce
             LEFT JOIN cost_records cr
               ON cr.source_record_id = srce.id AND cr.organization_id = srce.organization_id
             LEFT JOIN projects p ON p.id = cr.project_id AND p.organization_id = cr.organization_id
             WHERE srce.sync_run_id = sr.id AND srce.organization_id = sr.organization_id
               AND cr.project_id = $6
           ))
           AND ($7::uuid IS NULL OR EXISTS (
             SELECT 1 FROM source_records srce
             LEFT JOIN cost_records cr
               ON cr.source_record_id = srce.id AND cr.organization_id = srce.organization_id
             JOIN projects p ON p.id = cr.project_id AND p.organization_id = cr.organization_id
             WHERE srce.sync_run_id = sr.id AND srce.organization_id = sr.organization_id
               AND p.team_id = $7
           ))
           AND ($8::text IS NULL OR EXISTS (
             SELECT 1 FROM source_records srce
             LEFT JOIN cost_records cr
               ON cr.source_record_id = srce.id AND cr.organization_id = srce.organization_id
             WHERE srce.sync_run_id = sr.id AND srce.organization_id = sr.organization_id
               AND cr.provider = $8
           ))
           AND ($9::text IS NULL OR EXISTS (
             SELECT 1 FROM source_records srce
             LEFT JOIN cost_records cr
               ON cr.source_record_id = srce.id AND cr.organization_id = srce.organization_id
             WHERE srce.sync_run_id = sr.id AND srce.organization_id = sr.organization_id
               AND cr.model = $9
           ))
           AND ($10::text IS NULL OR EXISTS (
             SELECT 1 FROM source_records srce
             LEFT JOIN cost_records cr
               ON cr.source_record_id = srce.id AND cr.organization_id = srce.organization_id
             WHERE srce.sync_run_id = sr.id AND srce.organization_id = sr.organization_id
               AND (cr.cost_category = $10 OR ($10 = 'simulated' AND cr.is_simulated))
           ))
         ORDER BY sr.started_at DESC LIMIT 500`,
        [
          orgId, startDate, endDate, filters.data.provider ?? null, filters.data.dataSource ?? null,
          filters.data.projectId ?? null, filters.data.teamId ?? null,
          filters.data.provider ?? null, filters.data.model ?? null, filters.data.costCategory ?? null,
        ],
      );

      return { items: res.rows };
    },
  );

  app.post(
    '/v1/organizations/:orgId/connectors/sync-runs/recover',
    { preHandler: [requireOrgPermission('connectors:manage')] },
    async (request) => {
      const { orgId } = request.params as { orgId: string };
      const recovered = await recoverInterruptedSyncRuns(pool, 5 * 60_000, orgId);
      if (recovered.length > 0) {
        await recordAuditEvent(pool, {
          organizationId: orgId,
          actorUserId: request.authUser!.id,
          action: 'sync_runs.interrupted_recovered',
          targetType: 'sync_run',
          targetId: recovered[0]!.id,
          metadata: { recoveredCount: recovered.length },
        });
      }
      return { items: recovered };
    },
  );

  app.get(
    '/v1/organizations/:orgId/provider-connections',
    { preHandler: [requireOrgPermission('connectors:read')] },
    async (request) => {
      const { orgId } = request.params as { orgId: string };
      const result = await pool.query(
        `SELECT id, organization_id, provider, name, connection_type, status,
                config_metadata, last_synced_at, created_at, updated_at
         FROM provider_connections
         WHERE organization_id = $1
         ORDER BY created_at DESC`,
        [orgId],
      );
      return { items: result.rows };
    },
  );

  app.post(
    '/v1/organizations/:orgId/provider-connections',
    { preHandler: [requireOrgPermission('connectors:manage')] },
    async (request, reply) => {
      const { orgId } = request.params as { orgId: string };
      const actor = request.authUser!;
      const body = request.body as {
        provider?: string;
        name?: string;
        credentials?: Record<string, unknown>;
        configMetadata?: Record<string, unknown>;
      } | undefined;
      if (
        !body?.name?.trim() ||
        !body.provider ||
        !body.credentials ||
        !['openai', 'github-copilot'].includes(body.provider) ||
        (body.provider === 'openai' &&
          Object.keys(body.configMetadata ?? {}).length > 0) ||
        (body.provider === 'openai' &&
          (typeof body.credentials.apiKey !== 'string' || !body.credentials.apiKey.trim())) ||
        (body.provider === 'github-copilot' &&
          (typeof body.credentials.token !== 'string' ||
            !body.credentials.token.trim() ||
            typeof body.configMetadata?.organization !== 'string' ||
            !body.configMetadata.organization.trim() ||
            Object.keys(body.configMetadata).some((key) => key !== 'organization')))
      ) {
        return reply.code(400).send({ error: 'bad_request', message: 'Configuração de integração inválida' });
      }

      let encryptedCredentials: string;
      try {
        encryptedCredentials = encryptConnectorCredentials(body.credentials);
      } catch {
        return reply.code(503).send({
          error: 'credential_encryption_unavailable',
          message: 'Configure CONNECTOR_CREDENTIALS_KEY antes de cadastrar integrações externas',
        });
      }

      const connection = await pool.query<{
        id: string;
        organization_id: string;
        provider: string;
        name: string;
        connection_type: string;
        status: string;
        config_metadata: Record<string, unknown>;
        created_at: Date;
      }>(
        `INSERT INTO provider_connections (
           organization_id, provider, name, connection_type, config_metadata, encrypted_credentials
         )
         VALUES ($1, $2, $3, 'api', $4::jsonb, $5)
         RETURNING id, organization_id, provider, name, connection_type, status,
                   config_metadata, created_at`,
        [
          orgId,
          body.provider,
          body.name.trim(),
          JSON.stringify(body.configMetadata ?? {}),
          encryptedCredentials,
        ],
      );
      const created = connection.rows[0]!;
      await recordAuditEvent(pool, {
        organizationId: orgId,
        actorUserId: actor.id,
        action: 'provider_connection.created',
        targetType: 'provider_connection',
        targetId: created.id,
        metadata: { provider: created.provider, name: created.name },
      });
      return reply.code(201).send(created);
    },
  );

  app.post(
    '/v1/organizations/:orgId/provider-connections/:connectionId/sync',
    { preHandler: [requireOrgPermission('connectors:manage')] },
    async (request, reply) => {
      const { orgId, connectionId } = request.params as { orgId: string; connectionId: string };
      const actor = request.authUser!;
      const body = request.body as {
        dataset?: DatasetType;
        periodStart?: string;
        periodEnd?: string;
        dryRun?: boolean;
      } | undefined;
      if (
        !body?.dataset ||
        !body.periodStart ||
        !body.periodEnd ||
        Number.isNaN(Date.parse(body.periodStart)) ||
        Number.isNaN(Date.parse(body.periodEnd)) ||
        Date.parse(body.periodEnd) <= Date.parse(body.periodStart)
      ) {
        return reply.code(400).send({ error: 'bad_request', message: 'Informe dataset e período válido' });
      }
      const connection = await pool.query<{
        id: string;
        provider: string;
        config_metadata: Record<string, unknown>;
        encrypted_credentials: string | null;
        status: string;
      }>(
        `SELECT id, provider, config_metadata, encrypted_credentials, status
         FROM provider_connections
         WHERE id = $1 AND organization_id = $2 AND connection_type = 'api'`,
        [connectionId, orgId],
      );
      const selected = connection.rows[0];
      if (!selected) {
        return reply.code(404).send({ error: 'provider_connection_not_found', message: 'Integração não encontrada' });
      }
      if (
        (selected.provider === 'openai' && body.dataset !== 'api_costs') ||
        (selected.provider === 'github-copilot' && body.dataset !== 'license_assignments')
      ) {
        return reply.code(400).send({
          error: 'unsupported_dataset',
          message: 'Dataset não suportado por esta integração',
        });
      }
      if (selected.status !== 'active' || !selected.encrypted_credentials) {
        return reply.code(409).send({ error: 'provider_connection_inactive', message: 'Integração desativada ou sem credenciais' });
      }
      let credentials: Record<string, unknown>;
      try {
        credentials = decryptConnectorCredentials(selected.encrypted_credentials);
      } catch {
        return reply.code(503).send({
          error: 'credential_decryption_failed',
          message: 'Não foi possível descriptografar as credenciais da integração',
        });
      }
      const connectorConfig =
        selected.provider === 'github-copilot'
          ? {
              token: credentials.token as string,
              organization: selected.config_metadata.organization as string,
            }
          : { apiKey: credentials.apiKey as string };
      const summary = await executeSync(pool, {
        organizationId: orgId,
        providerConnectionId: connectionId,
        provider: selected.provider,
        dataset: body.dataset,
        periodStart: new Date(body.periodStart),
        periodEnd: new Date(body.periodEnd),
        dryRun: Boolean(body.dryRun),
        connectorConfig,
      });

      let reconciliationCount = 0;
      if (!body.dryRun && body.dataset === 'api_costs') {
        const reported = await pool.query<{ id: string }>(
          `SELECT cr.id
           FROM cost_records cr
           JOIN source_records sr
             ON sr.id = cr.source_record_id AND sr.organization_id = cr.organization_id
           WHERE sr.sync_run_id = $1 AND sr.organization_id = $2
             AND cr.cost_category = 'provider_reported'
           ORDER BY cr.created_at`,
          [summary.syncRunId, orgId],
        );
        for (const cost of reported.rows) {
          await reconcileReportedCost(pool, {
            organizationId: orgId,
            reportedCostRecordId: cost.id,
          });
          reconciliationCount++;
        }
      }
      await recordAuditEvent(pool, {
        organizationId: orgId,
        actorUserId: actor.id,
        action: 'provider_connection.synced',
        targetType: 'sync_run',
        targetId: summary.syncRunId,
        metadata: {
          provider: selected.provider,
          dataset: summary.dataset,
          status: summary.status,
          recordsProcessed: summary.recordsProcessed,
          reconciliationCount,
        },
      });
      return { ...summary, reconciliationCount };
    },
  );

  app.get(
    '/v1/organizations/:orgId/external-identities/pending-review',
    { preHandler: [requireOrgPermission('connectors:read')] },
    async (request) => {
      const { orgId } = request.params as { orgId: string };
      const result = await pool.query(
        `SELECT ei.id, ei.provider, ei.external_user_id, ei.external_email,
                ei.display_name, ei.match_status, ei.created_at, ei.updated_at,
                COALESCE(
                  jsonb_agg(
                    jsonb_build_object(
                      'id', la.id,
                      'status', la.status,
                      'lastActivityAt', la.last_activity_at,
                      'seatCost', la.seat_cost,
                      'currency', la.currency
                    )
                  ) FILTER (WHERE la.id IS NOT NULL),
                  '[]'::jsonb
                ) AS assignments
         FROM external_identities ei
         LEFT JOIN license_assignments la
           ON la.external_identity_id = ei.id AND la.organization_id = ei.organization_id
         WHERE ei.organization_id = $1 AND ei.match_status = 'pending_review'
         GROUP BY ei.id
         ORDER BY ei.created_at`,
        [orgId],
      );
      return { items: result.rows };
    },
  );

  app.post(
    '/v1/organizations/:orgId/external-identities/:identityId/match',
    { preHandler: [requireOrgPermission('members:manage')] },
    async (request, reply) => {
      const { orgId, identityId } = request.params as { orgId: string; identityId: string };
      const actor = request.authUser!;
      const body = request.body as { userId?: string } | undefined;
      if (!body?.userId) {
        return reply.code(400).send({ error: 'bad_request', message: 'userId é obrigatório' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const identity = await client.query<{ id: string; match_status: string }>(
          `SELECT id, match_status
           FROM external_identities
           WHERE id = $1 AND organization_id = $2
           FOR UPDATE`,
          [identityId, orgId],
        );
        if (!identity.rows[0]) {
          await client.query('ROLLBACK');
          return reply.code(404).send({
            error: 'external_identity_not_found',
            message: 'Identidade externa não encontrada nesta organização',
          });
        }
        const user = await client.query<{ id: string }>(
          `SELECT u.id
           FROM users u
           JOIN memberships m ON m.user_id = u.id
           WHERE u.id = $1 AND m.organization_id = $2
             AND m.deleted_at IS NULL AND u.is_active AND u.deleted_at IS NULL`,
          [body.userId, orgId],
        );
        if (!user.rows[0]) {
          await client.query('ROLLBACK');
          return reply.code(404).send({
            error: 'organization_member_not_found',
            message: 'Usuário ativo não encontrado como membro desta organização',
          });
        }
        await client.query(
          `UPDATE external_identities
           SET user_id = $3, match_status = 'matched', updated_at = NOW()
           WHERE id = $1 AND organization_id = $2`,
          [identityId, orgId, body.userId],
        );
        await client.query(
          `UPDATE license_assignments
           SET user_id = $3, updated_at = NOW()
           WHERE external_identity_id = $1 AND organization_id = $2`,
          [identityId, orgId, body.userId],
        );
        await client.query(
          `INSERT INTO audit_events (
             organization_id, actor_user_id, action, target_type, target_id, metadata
           )
           VALUES ($1, $2, 'external_identity.matched', 'external_identity', $3, $4::jsonb)`,
          [orgId, actor.id, identityId, JSON.stringify({ userId: body.userId })],
        );
        await client.query('COMMIT');
        return { id: identityId, userId: body.userId, matchStatus: 'matched' };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  );

  app.post(
    '/v1/organizations/:orgId/virtual-keys',
    { preHandler: [requireOrgPermission('virtual_keys:manage')] },
    async (request, reply) => {
      const { orgId } = request.params as { orgId: string };
      const actor = request.authUser!;
      const parsed = CreateVirtualKeyInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'bad_request',
          message: 'Payload de chave virtual inválido',
          issues: parsed.error.issues,
        });
      }

      const input = parsed.data;
      const targetQuery = input.scopeType === 'project'
        ? await pool.query(
            `SELECT id FROM projects WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
            [input.projectId, orgId],
          )
        : input.scopeType === 'team'
          ? await pool.query(
              `SELECT id FROM teams WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
              [input.teamId, orgId],
            )
          : await pool.query(
          `SELECT 1
           FROM memberships m
           JOIN users u ON u.id = m.user_id
           WHERE m.organization_id = $1 AND m.user_id = $2
             AND m.deleted_at IS NULL AND u.is_active AND u.deleted_at IS NULL`,
          [orgId, input.userId],
        );
      if (!targetQuery.rowCount) {
        return reply.code(404).send({
          error: 'invalid_key_scope_target',
          message: 'Projeto, equipe ou pessoa não encontrado nesta organização',
        });
      }

      const generated = generateVirtualKey();
      const keyRes = await pool.query<{
        id: string;
        organization_id: string;
        scope_type: 'project' | 'team' | 'user';
        project_id: string | null;
        team_id: string | null;
        owner_user_id: string | null;
        name: string;
        key_prefix: string;
        allowed_providers: string[];
        allowed_models: string[];
        scopes: string[];
        max_requests_per_minute: number | null;
        expires_at: Date | null;
        revoked_at: Date | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `INSERT INTO virtual_keys (
           organization_id, scope_type, project_id, team_id, created_by_user_id, name, key_prefix, key_hash,
           allowed_providers, allowed_models, scopes, max_requests_per_minute, expires_at, owner_user_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING id, organization_id, scope_type, project_id, team_id, name, key_prefix, allowed_providers,
                   allowed_models, scopes, max_requests_per_minute, owner_user_id, expires_at, revoked_at,
                   created_at, updated_at`,
        [
          orgId,
          input.scopeType,
          input.projectId ?? null,
          input.teamId ?? null,
          actor.id,
          input.name,
          generated.keyPrefix,
          generated.keyHash,
          input.allowedProviders,
          input.allowedModels,
          input.scopes,
          input.maxRequestsPerMinute ?? null,
          input.expiresAt ?? null,
          input.userId ?? null,
        ],
      );
      const created = keyRes.rows[0]!;

      await recordAuditEvent(pool, {
        organizationId: orgId,
        actorUserId: actor.id,
        action: 'virtual_key.created',
        targetType: 'virtual_key',
        targetId: created.id,
        metadata: {
          name: created.name,
          keyPrefix: created.key_prefix,
          scopeType: created.scope_type,
          projectId: created.project_id,
          teamId: created.team_id,
          userId: created.owner_user_id,
          allowedProviders: created.allowed_providers,
          allowedModels: created.allowed_models,
          scopes: created.scopes,
        },
      });

      return reply.code(201).send({
        ...created,
        api_key: generated.apiKey,
      });
    },
  );

  app.get(
    '/v1/organizations/:orgId/virtual-keys',
    { preHandler: [requireOrgPermission('virtual_keys:read')] },
    async (request) => {
      const { orgId } = request.params as { orgId: string };
      const res = await pool.query(
        `SELECT vk.id, vk.organization_id, vk.scope_type, vk.project_id, vk.team_id, vk.owner_user_id,
                vk.name, vk.key_prefix, vk.allowed_providers, vk.allowed_models, vk.scopes,
                vk.max_requests_per_minute, vk.expires_at, vk.revoked_at, vk.created_at, vk.updated_at,
                p.name AS project_name, t.name AS team_name, u.full_name AS user_name
         FROM virtual_keys vk
         LEFT JOIN projects p ON p.id = vk.project_id AND p.organization_id = vk.organization_id
         LEFT JOIN teams t ON t.id = vk.team_id AND t.organization_id = vk.organization_id
         LEFT JOIN users u ON u.id = vk.owner_user_id
         WHERE vk.organization_id = $1
         ORDER BY vk.created_at DESC`,
        [orgId],
      );
      return { items: res.rows };
    },
  );

  app.get(
    '/v1/organizations/:orgId/virtual-keys/owners',
    { preHandler: [requireOrgPermission('virtual_keys:manage')] },
    async (request) => {
      const { orgId } = request.params as { orgId: string };
      const res = await pool.query(
        `SELECT u.id AS user_id, u.email, u.full_name
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         WHERE m.organization_id = $1 AND m.deleted_at IS NULL
           AND u.is_active AND u.deleted_at IS NULL
         ORDER BY u.full_name, u.email`,
        [orgId],
      );
      return { items: res.rows };
    },
  );

  app.post(
    '/v1/organizations/:orgId/virtual-keys/:keyId/revoke',
    { preHandler: [requireOrgPermission('virtual_keys:manage')] },
    async (request, reply) => {
      const { orgId, keyId } = request.params as { orgId: string; keyId: string };
      const actor = request.authUser!;

      const revokeRes = await pool.query<{
        id: string;
        key_prefix: string;
        revoked_at: Date | null;
      }>(
        `UPDATE virtual_keys
         SET revoked_at = COALESCE(revoked_at, NOW()), updated_at = NOW()
         WHERE id = $1 AND organization_id = $2
         RETURNING id, key_prefix, revoked_at`,
        [keyId, orgId],
      );
      const revoked = revokeRes.rows[0];
      if (!revoked) {
        return reply.code(404).send({
          error: 'virtual_key_not_found',
          message: 'Chave virtual não encontrada nesta organização',
        });
      }

      await recordAuditEvent(pool, {
        organizationId: orgId,
        actorUserId: actor.id,
        action: 'virtual_key.revoked',
        targetType: 'virtual_key',
        targetId: revoked.id,
        metadata: { keyPrefix: revoked.key_prefix },
      });

      return reply.code(200).send(revoked);
    },
  );

  app.post(
    '/v1/organizations/:orgId/virtual-keys/:keyId/test-chat',
    { preHandler: [requireOrgPermission('virtual_keys:test')] },
    async (request, reply) => {
      const { orgId, keyId } = request.params as { orgId: string; keyId: string };
      const actor = request.authUser!;
      const parsed = ChatCompletionRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'bad_request',
          message: 'Requisição de teste inválida',
          issues: parsed.error.issues,
        });
      }

      const key = await pool.query<{ id: string }>(
        `SELECT id FROM virtual_keys WHERE id = $1 AND organization_id = $2`,
        [keyId, orgId],
      );
      if (!key.rows[0]) {
        return reply.code(404).send({
          error: 'virtual_key_not_found',
          message: 'Chave virtual não encontrada nesta organização',
        });
      }

      const requestId = `test-${crypto.randomUUID()}`;
      const ticket = crypto.randomBytes(32).toString('hex');
      const ticketHash = crypto.createHash('sha256').update(ticket).digest('hex');
      await pool.query(
        `INSERT INTO guardrail_test_tickets (
           organization_id, virtual_key_id, actor_user_id, token_hash, expires_at
         )
         VALUES ($1, $2, $3, $4, NOW() + INTERVAL '90 seconds')`,
        [orgId, keyId, actor.id, ticketHash],
      );
      await recordAuditEvent(pool, {
        organizationId: orgId,
        actorUserId: actor.id,
        action: 'virtual_key.test_chat.started',
        targetType: 'virtual_key',
        targetId: keyId,
        metadata: { requestId },
      });

      const gatewayUrl = (
        process.env.GATEWAY_INTERNAL_URL ?? process.env.GATEWAY_BASE_URL ?? 'http://localhost:3002'
      ).replace(/\/+$/, '');
      const abortController = new AbortController();
      const onClientClose = () => {
        if (!reply.raw.writableEnded) abortController.abort();
      };
      reply.raw.once('close', onClientClose);
      let upstream: Response;
      try {
        upstream = await fetch(`${gatewayUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-gateway-test-ticket': ticket,
            'x-request-id': requestId,
          },
          body: JSON.stringify(parsed.data),
          signal: abortController.signal,
        });
      } catch {
        reply.raw.off('close', onClientClose);
        await pool.query(
          `UPDATE guardrail_test_tickets
           SET expires_at = NOW()
           WHERE token_hash = $1 AND used_at IS NULL`,
          [ticketHash],
        );
        request.log.warn(
          { request_id: requestId, organization_id: orgId, error_code: 'TEST_GATEWAY_UNAVAILABLE' },
          'Virtual key test could not reach the Gateway',
        );
        return reply.code(502).send({
          error: 'test_gateway_unavailable',
          message: 'Não foi possível concluir o teste porque o Gateway está indisponível',
        });
      }

      const contentType = upstream.headers.get('content-type') ?? 'application/json';
      if (contentType.includes('text/event-stream') && upstream.body) {
        const corsHeaders: Record<string, string> = {};
        for (const name of [
          'access-control-allow-origin',
          'access-control-allow-credentials',
          'access-control-expose-headers',
          'vary',
        ]) {
          const value = reply.getHeader(name);
          if (typeof value === 'string') corsHeaders[name] = value;
          else if (Array.isArray(value)) corsHeaders[name] = value.join(', ');
        }
        reply.hijack();
        reply.raw.writeHead(upstream.status, {
          ...corsHeaders,
          'Content-Type': contentType,
          'Cache-Control': upstream.headers.get('cache-control') ?? 'no-cache, no-transform',
          'X-Request-Id': requestId,
          'X-Accel-Buffering': 'no',
        });
        const reader = upstream.body.getReader();
        const onStreamClose = () => {
          if (!reply.raw.writableEnded) {
            abortController.abort();
            void reader.cancel().catch(() => undefined);
          }
        };
        reply.raw.once('close', onStreamClose);
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            await writeProxyChunk(reply, chunk.value);
          }
        } finally {
          reply.raw.off('close', onStreamClose);
          reply.raw.off('close', onClientClose);
          reply.raw.end();
          reader.releaseLock();
        }
        return reply;
      }

      const responseText = await upstream.text().finally(() => {
        reply.raw.off('close', onClientClose);
      });
      let responseBody: unknown = null;
      if (responseText) {
        try {
          responseBody = JSON.parse(responseText) as unknown;
        } catch {
          responseBody = {
            error: 'invalid_gateway_response',
            message: 'O Gateway retornou uma resposta inválida',
          };
        }
      }
      return reply
        .header('X-Request-Id', requestId)
        .code(upstream.status)
        .send(responseBody);
    },
  );

  app.get(
    '/v1/organizations/:orgId/guardrail-rules',
    { preHandler: [requireOrgPermission('guardrails:read')] },
    async (request) => {
      const { orgId } = request.params as { orgId: string };
      const result = await pool.query(
        `SELECT id, name, description, rule_type, mode, scope_type, scope_id, terms,
                evaluator_provider, evaluator_model, evaluator_prompt, severity, is_active,
                created_at, updated_at
         FROM guardrail_rules
         WHERE organization_id = $1
         ORDER BY created_at DESC`,
        [orgId],
      );
      return { items: result.rows };
    },
  );

  app.post(
    '/v1/organizations/:orgId/guardrail-rules',
    { preHandler: [requireOrgPermission('guardrails:manage')] },
    async (request, reply) => {
      const { orgId } = request.params as { orgId: string };
      const actor = request.authUser!;
      const parsed = GuardrailRuleInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'bad_request',
          message: 'Regra de guardrail inválida',
          issues: parsed.error.issues,
        });
      }
      const input = parsed.data;
      if (input.scopeId) {
        const tableByScope = {
          project: 'projects',
          team: 'teams',
          user: 'memberships',
          virtual_key: 'virtual_keys',
        } as const;
        const table = tableByScope[input.scopeType as keyof typeof tableByScope];
        const target = table === 'memberships'
          ? await pool.query(
              `SELECT 1 FROM memberships m
               JOIN users u ON u.id = m.user_id
               WHERE m.user_id = $1 AND m.organization_id = $2
                 AND m.deleted_at IS NULL AND u.is_active AND u.deleted_at IS NULL`,
              [input.scopeId, orgId],
            )
          : table === 'projects' || table === 'teams'
            ? await pool.query(
                `SELECT 1 FROM ${table} WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
                [input.scopeId, orgId],
              )
            : await pool.query(
                `SELECT 1 FROM virtual_keys WHERE id = $1 AND organization_id = $2`,
                [input.scopeId, orgId],
              );
        if (!target.rowCount) {
          return reply.code(404).send({
            error: 'invalid_guardrail_scope',
            message: 'O alvo da regra não existe ou não pertence à organização',
          });
        }
      }

      const created = await pool.query(
        `INSERT INTO guardrail_rules (
           organization_id, name, description, rule_type, mode, scope_type, scope_id,
           terms, evaluator_provider, evaluator_model, evaluator_prompt, severity, created_by_user_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id, name, description, rule_type, mode, scope_type, scope_id, terms,
                   evaluator_provider, evaluator_model, evaluator_prompt, severity, is_active,
                   created_at, updated_at`,
        [
          orgId,
          input.name,
          input.description ?? null,
          input.ruleType,
          input.mode,
          input.scopeType,
          input.scopeId ?? null,
          input.terms,
          input.evaluatorProvider ?? null,
          input.evaluatorModel ?? null,
          input.evaluatorPrompt ?? null,
          input.severity,
          actor.id,
        ],
      );
      const rule = created.rows[0]!;
      await recordAuditEvent(pool, {
        organizationId: orgId,
        actorUserId: actor.id,
        action: 'guardrail_rule.created',
        targetType: 'guardrail_rule',
        targetId: rule.id,
        metadata: { ruleType: input.ruleType, mode: input.mode, scopeType: input.scopeType },
      });
      return reply.code(201).send(rule);
    },
  );

  app.patch(
    '/v1/organizations/:orgId/guardrail-rules/:ruleId',
    { preHandler: [requireOrgPermission('guardrails:manage')] },
    async (request, reply) => {
      const { orgId, ruleId } = request.params as { orgId: string; ruleId: string };
      const actor = request.authUser!;
      const body = request.body as { isActive?: boolean } | undefined;
      if (!body || typeof body.isActive !== 'boolean') {
        return reply.code(400).send({ error: 'bad_request', message: 'isActive deve ser booleano' });
      }
      const updated = await pool.query(
        `UPDATE guardrail_rules
         SET is_active = $3, updated_at = NOW()
         WHERE id = $1 AND organization_id = $2
         RETURNING id, is_active`,
        [ruleId, orgId, body.isActive],
      );
      if (!updated.rows[0]) {
        return reply.code(404).send({ error: 'guardrail_rule_not_found', message: 'Regra não encontrada' });
      }
      await recordAuditEvent(pool, {
        organizationId: orgId,
        actorUserId: actor.id,
        action: 'guardrail_rule.updated',
        targetType: 'guardrail_rule',
        targetId: ruleId,
        metadata: { isActive: body.isActive },
      });
      return updated.rows[0];
    },
  );

  app.get(
    '/v1/organizations/:orgId/guardrail-alerts',
    { preHandler: [requireOrgPermission('guardrails:read')] },
    async (request) => {
      const { orgId } = request.params as { orgId: string };
      await failInterruptedGuardrailEvaluations(pool, orgId);
      const result = await pool.query(
        `SELECT a.id, a.guardrail_rule_id, r.name AS rule_name, a.guardrail_evaluation_id,
                a.virtual_key_id, vk.name AS virtual_key_name, a.request_id, a.actor_user_id,
                u.full_name AS actor_name, a.usage_event_id, a.mode, a.outcome, a.severity,
                a.status, a.reason, a.created_at, a.expires_at
         FROM guardrail_alerts a
         JOIN guardrail_rules r ON r.id = a.guardrail_rule_id AND r.organization_id = a.organization_id
         JOIN virtual_keys vk ON vk.id = a.virtual_key_id AND vk.organization_id = a.organization_id
         LEFT JOIN users u ON u.id = a.actor_user_id
         WHERE a.organization_id = $1 AND a.expires_at > NOW()
         ORDER BY a.created_at DESC
         LIMIT 200`,
        [orgId],
      );
      return { items: result.rows };
    },
  );

  app.patch(
    '/v1/organizations/:orgId/guardrail-alerts/:alertId',
    { preHandler: [requireOrgPermission('guardrails:manage')] },
    async (request, reply) => {
      const { orgId, alertId } = request.params as { orgId: string; alertId: string };
      const actor = request.authUser!;
      const body = request.body as { status?: string } | undefined;
      if (!body || !['acknowledged', 'resolved'].includes(body.status ?? '')) {
        return reply.code(400).send({
          error: 'bad_request',
          message: 'status deve ser acknowledged ou resolved',
        });
      }
      const updated = await pool.query(
        `UPDATE guardrail_alerts
         SET status = $3, updated_at = NOW()
         WHERE id = $1 AND organization_id = $2 AND expires_at > NOW()
         RETURNING id, status`,
        [alertId, orgId, body.status],
      );
      if (!updated.rows[0]) {
        return reply.code(404).send({ error: 'guardrail_alert_not_found', message: 'Alerta não encontrado' });
      }
      await recordAuditEvent(pool, {
        organizationId: orgId,
        actorUserId: actor.id,
        action: 'guardrail_alert.updated',
        targetType: 'guardrail_alert',
        targetId: alertId,
        metadata: { status: body.status },
      });
      return updated.rows[0];
    },
  );

  app.get(
    '/v1/organizations/:orgId/usage-events',
    { preHandler: [requireOrgPermission('costs:read')] },
    async (request, reply) => {
      const { orgId } = request.params as { orgId: string };
      const query = request.query as Record<string, string | undefined>;
      const filters = DashboardQueryFiltersSchema.safeParse(query);
      if (!filters.success) {
        return reply.code(400).send({
          error: 'bad_request',
          message: 'Filtros inválidos',
          issues: filters.error.issues,
        });
      }
      if (filters.data.organizationId && filters.data.organizationId !== orgId) {
        return reply.code(403).send({ error: 'forbidden_tenant', message: 'Organização não autorizada' });
      }

      const statusParsed = query.status ? UsageEventStatusSchema.safeParse(query.status) : null;
      if (statusParsed && !statusParsed.success) {
        return reply.code(400).send({
          error: 'bad_request',
          message: 'Parâmetro status inválido',
        });
      }

      const limit = query.limit === undefined ? undefined : Number(query.limit);
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 200)) {
        return reply.code(400).send({ error: 'bad_request', message: 'Parâmetro limit inválido' });
      }
      const endDate = filters.data.endDate
        ? new Date(new Date(`${filters.data.endDate}T00:00:00.000Z`).getTime() + 86_400_000)
        : undefined;
      const items = await listUsageEvents(pool, {
        organizationId: orgId,
        projectId: filters.data.projectId,
        teamId: filters.data.teamId,
        userId: filters.data.userId,
        status: statusParsed?.success ? statusParsed.data : undefined,
        provider: filters.data.provider,
        model: filters.data.model,
        startDate: filters.data.startDate ? new Date(`${filters.data.startDate}T00:00:00.000Z`) : undefined,
        endDate,
        costCategory: filters.data.costCategory,
        dataSource: filters.data.dataSource,
        limit,
      });

      return { items };
    },
  );

  app.get(
    '/v1/organizations/:orgId/usage-events/:eventId/content',
    { preHandler: [requireOrgPermission('prompts:read')] },
    async (request, reply) => {
      const { orgId, eventId } = request.params as { orgId: string; eventId: string };
      const actor = request.authUser!;
      const content = await pool.query<{
        content_ciphertext: Buffer;
        nonce: Buffer;
        auth_tag: Buffer;
        expires_at: Date;
      }>(
        `SELECT c.content_ciphertext, c.nonce, c.auth_tag, c.expires_at
         FROM usage_event_content c
         JOIN usage_events ue
           ON ue.id = c.usage_event_id AND ue.organization_id = c.organization_id
         WHERE c.organization_id = $1 AND c.usage_event_id = $2
           AND c.expires_at > NOW()`,
        [orgId, eventId],
      );
      if (!content.rows[0]) {
        return reply.code(404).send({
          error: 'content_unavailable',
          message: 'Conteúdo não armazenado ou já expirado',
        });
      }

      const encryptionKey = loadEnvConfig().PROMPT_CONTENT_ENCRYPTION_KEY;
      if (!encryptionKey) {
        return reply.code(503).send({
          error: 'content_encryption_unavailable',
          message: 'Chave de criptografia de conteúdo indisponível',
        });
      }

      let payload: { messages: Array<{ role: string; content: string }>; response: string };
      try {
        const row = content.rows[0];
        payload = JSON.parse(
          decryptSensitiveContent(
            { ciphertext: row.content_ciphertext, nonce: row.nonce, authTag: row.auth_tag },
            encryptionKey,
          ),
        ) as typeof payload;
      } catch {
        request.log.error(
          { organization_id: orgId, event_id: eventId, error_code: 'CONTENT_DECRYPTION_FAILED' },
          'Unable to decrypt stored inference content',
        );
        return reply.code(503).send({
          error: 'content_decryption_failed',
          message: 'Não foi possível descriptografar o conteúdo armazenado',
        });
      }

      await recordAuditEvent(pool, {
        organizationId: orgId,
        actorUserId: actor.id,
        action: 'usage_event.content.read',
        targetType: 'usage_event',
        targetId: eventId,
        metadata: { expiresAt: content.rows[0].expires_at.toISOString() },
      });
      reply.header('Cache-Control', 'no-store');
      return payload;
    },
  );

  app.get(
    '/v1/organizations/:orgId/model-prices',
    { preHandler: [requireOrgPermission('costs:read')] },
    async (request) => {
      const { orgId } = request.params as { orgId: string };
      const result = await pool.query(
        `SELECT id, organization_id, provider, model, currency,
                input_price_per_million, output_price_per_million,
                price_source, price_type, effective_from, effective_to, created_at
         FROM model_prices
         WHERE organization_id = $1 OR organization_id IS NULL
         ORDER BY provider, model, effective_from DESC`,
        [orgId],
      );
      return { items: result.rows };
    },
  );

  app.post(
    '/v1/organizations/:orgId/model-prices',
    { preHandler: [requireOrgPermission('prices:manage')] },
    async (request, reply) => {
      const { orgId } = request.params as { orgId: string };
      const actor = request.authUser!;
      const body = request.body as {
        provider?: string;
        model?: string;
        currency?: string;
        inputPricePerMillion?: string;
        outputPricePerMillion?: string;
        priceSource?: 'official_pricing_table' | 'internal_simulation' | 'custom_contract';
        priceType?: 'commercial_api_tariff' | 'internal_estimate' | 'simulation';
        effectiveFrom?: string;
        effectiveTo?: string | null;
      } | undefined;
      if (
        !body?.provider ||
        !body.model ||
        !body.currency ||
        !body.inputPricePerMillion ||
        !body.outputPricePerMillion ||
        !body.priceSource ||
        !body.priceType ||
        !body.effectiveFrom ||
        Number.isNaN(Date.parse(body.effectiveFrom)) ||
        (body.effectiveTo != null && Number.isNaN(Date.parse(body.effectiveTo)))
      ) {
        return reply.code(400).send({ error: 'bad_request', message: 'Payload de preço inválido' });
      }

      try {
        const price = await createModelPrice(pool, {
          organizationId: orgId,
          provider: body.provider,
          model: body.model,
          currency: body.currency.trim().toUpperCase(),
          inputPricePerMillion: body.inputPricePerMillion,
          outputPricePerMillion: body.outputPricePerMillion,
          priceSource: body.priceSource,
          priceType: body.priceType,
          effectiveFrom: new Date(body.effectiveFrom),
          effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : null,
        });
        await recordAuditEvent(pool, {
          organizationId: orgId,
          actorUserId: actor.id,
          action: 'model_price.created',
          targetType: 'model_price',
          targetId: price.id,
          metadata: { provider: price.provider, model: price.model, priceType: price.priceType },
        });
        return reply.code(201).send(price);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === '23P01' || code === '23505') {
          return reply.code(409).send({ error: 'price_period_conflict', message: 'Janela de preço sobreposta' });
        }
        if (code === '23514') {
          return reply.code(400).send({ error: 'bad_request', message: 'Preço incompatível com as regras do catálogo' });
        }
        if (error instanceof Error && !('code' in error)) {
          return reply.code(400).send({ error: 'bad_request', message: error.message });
        }
        throw error;
      }
    },
  );

  app.patch(
    '/v1/organizations/:orgId/model-prices/:priceId/close',
    { preHandler: [requireOrgPermission('prices:manage')] },
    async (request, reply) => {
      const { orgId, priceId } = request.params as { orgId: string; priceId: string };
      const actor = request.authUser!;
      const body = request.body as { effectiveTo?: string } | undefined;
      if (!body?.effectiveTo || Number.isNaN(Date.parse(body.effectiveTo))) {
        return reply.code(400).send({ error: 'bad_request', message: 'effectiveTo inválido' });
      }
      try {
        const price = await closeModelPrice(pool, {
          organizationId: orgId,
          priceId,
          effectiveTo: new Date(body.effectiveTo),
        });
        if (!price) {
          return reply.code(404).send({
            error: 'price_not_found_or_invalid_range',
            message: 'Preço não encontrado ou effectiveTo não posterior ao início da vigência',
          });
        }
        await recordAuditEvent(pool, {
          organizationId: orgId,
          actorUserId: actor.id,
          action: 'model_price.closed',
          targetType: 'model_price',
          targetId: priceId,
          metadata: { effectiveTo: price.effectiveTo?.toISOString() },
        });
        return price;
      } catch (error) {
        if ((error as { code?: string }).code === '23P01') {
          return reply.code(409).send({ error: 'price_period_conflict', message: 'Janela de preço sobreposta' });
        }
        throw error;
      }
    },
  );

  app.get(
    '/v1/organizations/:orgId/dashboard/overview',
    { preHandler: [requireOrgPermission('costs:read')] },
    async (request, reply) => {
      const { orgId } = request.params as { orgId: string };
      const parsedFilters = DashboardQueryFiltersSchema.safeParse(request.query);
      if (!parsedFilters.success) {
        return reply.code(400).send({
          error: 'bad_request',
          message: 'Filtros inválidos',
          issues: parsedFilters.error.issues,
        });
      }
      const filters = parsedFilters.data;
      if (filters.organizationId && filters.organizationId !== orgId) {
        return reply.code(403).send({ error: 'forbidden_tenant', message: 'Organização não autorizada' });
      }
      const periodEndDate = filters.endDate
        ? new Date(`${filters.endDate}T00:00:00.000Z`)
        : new Date();
      const periodStartDate = filters.startDate
        ? new Date(`${filters.startDate}T00:00:00.000Z`)
        : new Date(periodEndDate.getTime() - 29 * 86_400_000);
      const periodEndExclusive = filters.endDate
        ? new Date(periodEndDate.getTime() + 86_400_000)
        : periodEndDate;
      const queryValues = [
        orgId,
        periodStartDate,
        periodEndExclusive,
        filters.projectId ?? null,
        filters.teamId ?? null,
        filters.provider ?? null,
        filters.model ?? null,
        filters.costCategory ?? null,
        filters.dataSource ?? null,
        filters.userId ?? null,
      ];
      const costConditions = `
        cr.organization_id = $1
        AND cr.period_end >= $2 AND cr.period_start < $3
        AND ($4::uuid IS NULL OR cr.project_id = $4)
        AND ($5::uuid IS NULL OR COALESCE(cr.team_id, p.team_id) = $5)
        AND ($10::uuid IS NULL OR cr.user_id = $10)
        AND ($6::text IS NULL OR cr.provider = $6)
        AND ($7::text IS NULL OR cr.model = $7)
        AND ($8::text IS NULL OR cr.cost_category = $8 OR ($8 = 'simulated' AND cr.is_simulated))
        AND ($9::text IS NULL OR
          ($9 = 'gateway_local' AND cr.usage_event_id IS NOT NULL) OR
          ($9 = 'csv' AND cr.source_record_id IS NOT NULL AND COALESCE(pc.connection_type, 'csv') = 'csv') OR
          ($9 = 'official_api' AND cr.source_record_id IS NOT NULL AND pc.connection_type = 'api'))`;
      const usageConditions = `
        ue.organization_id = $1 AND ue.created_at >= $2 AND ue.created_at < $3
        AND ($4::uuid IS NULL OR ue.project_id = $4)
        AND ($5::uuid IS NULL OR COALESCE(ue.team_id, p.team_id) = $5)
        AND ($10::uuid IS NULL OR ue.user_id = $10)
        AND ($6::text IS NULL OR ue.provider = $6)
        AND ($7::text IS NULL OR ue.model = $7)
        AND ($8::text IS NULL OR EXISTS (
          SELECT 1 FROM cost_records event_cost
          WHERE event_cost.usage_event_id = ue.id AND event_cost.organization_id = ue.organization_id
            AND (event_cost.cost_category = $8 OR ($8 = 'simulated' AND event_cost.is_simulated))
        ))
        AND ($9::text IS NULL OR $9 = 'gateway_local')`;

      const [
        costs,
        usageByProviderModel,
        usageByProject,
        usageByTeam,
        budgets,
        licenses,
        sources,
        reconciliation,
      ] = await Promise.all([
        pool.query(
          `SELECT cr.cost_category, cr.currency, cr.is_simulated,
                  SUM(cr.amount)::text AS amount, COUNT(*)::int AS record_count
           FROM cost_records cr
           LEFT JOIN projects p ON p.id = cr.project_id AND p.organization_id = cr.organization_id
           LEFT JOIN source_records sr ON sr.id = cr.source_record_id AND sr.organization_id = cr.organization_id
           LEFT JOIN provider_connections pc ON pc.id = sr.provider_connection_id AND pc.organization_id = sr.organization_id
           WHERE ${costConditions}
           GROUP BY cr.cost_category, cr.currency, cr.is_simulated
           ORDER BY cr.cost_category, cr.currency, cr.is_simulated`,
          queryValues,
        ),
        pool.query(
          `SELECT ue.provider, ue.model, COUNT(*)::int AS request_count,
                  SUM(ue.input_tokens)::text AS input_tokens,
                  SUM(ue.output_tokens)::text AS output_tokens,
                  SUM(ue.duration_ms)::text AS duration_ms
           FROM usage_events ue
           LEFT JOIN projects p ON p.id = ue.project_id AND p.organization_id = ue.organization_id
           WHERE ${usageConditions}
           GROUP BY ue.provider, ue.model
           ORDER BY ue.provider, ue.model`,
          queryValues,
        ),
        pool.query(
          `SELECT p.id AS project_id, p.name AS project_name, p.team_id,
                  COUNT(ue.id)::int AS request_count,
                  SUM(ue.input_tokens)::text AS input_tokens,
                  SUM(ue.output_tokens)::text AS output_tokens
           FROM usage_events ue
           LEFT JOIN projects p ON p.id = ue.project_id AND p.organization_id = ue.organization_id
           WHERE ${usageConditions} AND ue.project_id IS NOT NULL
           GROUP BY p.id, p.name, p.team_id
           ORDER BY request_count DESC, p.name`,
          queryValues,
        ),
        pool.query(
          `SELECT t.id AS team_id, t.name AS team_name,
                  COUNT(ue.id)::int AS request_count,
                  SUM(ue.input_tokens)::text AS input_tokens,
                  SUM(ue.output_tokens)::text AS output_tokens
           FROM usage_events ue
           LEFT JOIN projects p ON p.id = ue.project_id AND p.organization_id = ue.organization_id
           JOIN teams t ON t.id = COALESCE(ue.team_id, p.team_id) AND t.organization_id = ue.organization_id
           WHERE ${usageConditions}
           GROUP BY t.id, t.name
           ORDER BY request_count DESC, t.name`,
          queryValues,
        ),
        pool.query(
          `SELECT bp.id, bp.name, bp.scope_type, bp.mode, bp.currency,
                  bp.limit_amount::text AS limit_amount, bp.period_start, bp.period_end,
                  spent.amount::text AS spent_amount,
                  CASE WHEN bp.limit_amount > 0 AND spent.amount IS NOT NULL
                    THEN ROUND(spent.amount * 100 / bp.limit_amount, 2)
                    ELSE NULL END AS utilization_percent
           FROM budget_policies bp
           LEFT JOIN LATERAL (
             SELECT SUM(cr.amount) AS amount
             FROM cost_records cr
             LEFT JOIN projects p ON p.id = cr.project_id AND p.organization_id = cr.organization_id
             LEFT JOIN source_records sr ON sr.id = cr.source_record_id AND sr.organization_id = cr.organization_id
             LEFT JOIN provider_connections pc ON pc.id = sr.provider_connection_id AND pc.organization_id = sr.organization_id
             LEFT JOIN usage_events ue ON ue.id = cr.usage_event_id AND ue.organization_id = cr.organization_id
             WHERE cr.organization_id = bp.organization_id AND cr.currency = bp.currency
               AND cr.period_start < bp.period_end AND cr.period_end >= bp.period_start
               AND (bp.scope_type = 'organization'
                 OR (bp.scope_type = 'project' AND bp.project_id = cr.project_id)
                 OR (bp.scope_type = 'virtual_key' AND bp.virtual_key_id = ue.virtual_key_id)
                 OR (bp.scope_type = 'team' AND bp.team_id = COALESCE(cr.team_id, ue.team_id, p.team_id))
                 OR (bp.scope_type = 'user' AND bp.user_id = COALESCE(cr.user_id, ue.user_id)))
               AND ($4::uuid IS NULL OR cr.project_id = $4)
               AND ($5::uuid IS NULL OR COALESCE(cr.team_id, ue.team_id, p.team_id) = $5)
               AND ($10::uuid IS NULL OR COALESCE(cr.user_id, ue.user_id) = $10)
               AND ($6::text IS NULL OR cr.provider = $6)
               AND ($7::text IS NULL OR cr.model = $7)
               AND ($8::text IS NULL OR cr.cost_category = $8 OR ($8 = 'simulated' AND cr.is_simulated))
               AND ($9::text IS NULL OR
                 ($9 = 'gateway_local' AND cr.usage_event_id IS NOT NULL) OR
                 ($9 = 'csv' AND cr.source_record_id IS NOT NULL AND COALESCE(pc.connection_type, 'csv') = 'csv') OR
                 ($9 = 'official_api' AND cr.source_record_id IS NOT NULL AND pc.connection_type = 'api'))
           ) spent ON TRUE
           WHERE bp.organization_id = $1 AND bp.is_active
             AND bp.period_start < $3 AND bp.period_end >= $2
           ORDER BY bp.period_end, bp.name`,
          queryValues,
        ),
        pool.query(
          `SELECT lc.id, lc.provider, lc.product_name, lc.contracted_seats, lc.currency,
                  COUNT(DISTINCT la.id) FILTER (WHERE la.status = 'assigned')::int AS assigned_seats,
                  COUNT(DISTINCT la.id) FILTER (
                    WHERE la.status = 'assigned'
                      AND (la.last_activity_at < $2 OR la.last_activity_at >= $3)
                  )::int AS idle_seats,
                  COUNT(DISTINCT la.id) FILTER (
                    WHERE la.status = 'assigned' AND la.last_activity_at IS NULL
                  )::int AS unknown_activity_seats
           FROM license_contracts lc
           LEFT JOIN license_assignments la
             ON la.contract_id = lc.id AND la.organization_id = lc.organization_id
           LEFT JOIN external_identities ei
             ON ei.id = la.external_identity_id AND ei.organization_id = la.organization_id
           LEFT JOIN team_memberships tm
             ON tm.user_id = COALESCE(la.user_id, ei.user_id)
            AND tm.organization_id = la.organization_id
           LEFT JOIN source_records sr
             ON sr.id = la.source_record_id AND sr.organization_id = la.organization_id
           LEFT JOIN provider_connections pc
             ON pc.id = sr.provider_connection_id AND pc.organization_id = sr.organization_id
           WHERE lc.organization_id = $1 AND lc.status = 'active'
             AND ($5::uuid IS NULL OR tm.team_id = $5 OR la.id IS NULL)
             AND ($6::text IS NULL OR lc.provider = $6)
             AND ($7::text IS NULL OR
               ($7 = 'csv' AND COALESCE(pc.connection_type, 'csv') = 'csv') OR
               ($7 = 'official_api' AND pc.connection_type = 'api'))
             AND ($4::uuid IS NULL OR EXISTS (
               SELECT 1 FROM cost_records cr
               WHERE cr.license_assignment_id = la.id AND cr.organization_id = la.organization_id
                 AND cr.project_id = $4
             ) OR la.id IS NULL)
           GROUP BY lc.id
           ORDER BY lc.provider, lc.product_name`,
          [
            orgId,
            periodStartDate,
            periodEndExclusive,
            filters.projectId ?? null,
            filters.teamId ?? null,
            filters.provider ?? null,
            filters.dataSource ?? null,
          ],
        ),
        pool.query(
          `SELECT pc.id, pc.provider, pc.name, pc.connection_type, pc.status,
                  pc.last_synced_at, latest.status AS last_run_status, latest.started_at AS last_run_at,
                  (pc.last_synced_at IS NULL OR pc.last_synced_at < NOW() - INTERVAL '7 days'
                    OR pc.status <> 'active' OR latest.status = 'failed') AS is_stale
           FROM provider_connections pc
           LEFT JOIN LATERAL (
             SELECT sr.status, sr.started_at FROM sync_runs sr
             WHERE sr.provider_connection_id = pc.id AND sr.organization_id = pc.organization_id
             ORDER BY sr.started_at DESC LIMIT 1
           ) latest ON TRUE
           WHERE pc.organization_id = $1
             AND ($2::text IS NULL OR pc.provider = $2)
             AND ($3::text IS NULL OR
               ($3 = 'csv' AND pc.connection_type = 'csv') OR
               ($3 = 'official_api' AND pc.connection_type = 'api') OR
               ($3 = 'gateway_local' AND FALSE))
           ORDER BY pc.last_synced_at NULLS FIRST, pc.name`,
          [orgId, filters.provider ?? null, filters.dataSource ?? null],
        ),
        pool.query(
          `SELECT COUNT(*)::int AS record_count, cr.currency, SUM(cr.amount)::text AS amount
           FROM cost_records cr
           LEFT JOIN projects p ON p.id = cr.project_id AND p.organization_id = cr.organization_id
           LEFT JOIN source_records sr ON sr.id = cr.source_record_id AND sr.organization_id = cr.organization_id
           LEFT JOIN provider_connections pc ON pc.id = sr.provider_connection_id AND pc.organization_id = sr.organization_id
           WHERE ${costConditions}
             AND (
               cr.cost_category = 'unreconciled'
               OR (cr.cost_category = 'provider_reported' AND NOT EXISTS (
                 SELECT 1 FROM reconciliation_matches rm
                 WHERE rm.organization_id = cr.organization_id
                   AND rm.reported_cost_record_id = cr.id
                   AND rm.status <> 'unreconciled'
               ))
             )
           GROUP BY cr.currency
           ORDER BY cr.currency`,
          [orgId, periodStartDate, periodEndExclusive, filters.projectId ?? null,
            filters.teamId ?? null, filters.provider ?? null, filters.model ?? null,
            null, filters.dataSource ?? null, filters.userId ?? null],
        ),
      ]);

      return {
        period: { startDate: periodStartDate.toISOString(), endDate: periodEndDate.toISOString() },
        currencyNote: 'Valores financeiros agrupados pela moeda original; moedas diferentes não são somadas.',
        costsByCategory: costs.rows,
        consumptionByProviderModel: usageByProviderModel.rows,
        consumptionByProject: usageByProject.rows,
        consumptionByTeam: usageByTeam.rows,
        budgets: budgets.rows,
        licenses: licenses.rows,
        sources: sources.rows,
        pendingReconciliation: reconciliation.rows,
      };
    },
  );

  app.get(
    '/v1/organizations/:orgId/costs/summary',
    { preHandler: [requireOrgPermission('costs:read')] },
    async (request, reply) => {
      const { orgId } = request.params as { orgId: string };
      const filters = DashboardQueryFiltersSchema.safeParse(request.query);
      if (!filters.success) {
        return reply.code(400).send({
          error: 'bad_request',
          message: 'Filtros inválidos',
          issues: filters.error.issues,
        });
      }
      if (filters.data.organizationId && filters.data.organizationId !== orgId) {
        return reply.code(403).send({ error: 'forbidden_tenant', message: 'Organização não autorizada' });
      }
      const endDate = filters.data.endDate
        ? new Date(new Date(`${filters.data.endDate}T00:00:00.000Z`).getTime() + 86_400_000)
        : undefined;
      return {
        items: await summarizeCosts(pool, {
          organizationId: orgId,
          projectId: filters.data.projectId,
          teamId: filters.data.teamId,
          userId: filters.data.userId,
          provider: filters.data.provider,
          model: filters.data.model,
          costCategory: filters.data.costCategory,
          dataSource: filters.data.dataSource,
          startDate: filters.data.startDate
            ? new Date(`${filters.data.startDate}T00:00:00.000Z`)
            : undefined,
          endDate,
        }),
      };
    },
  );

  app.get(
    '/v1/organizations/:orgId/costs/by-model',
    { preHandler: [requireOrgPermission('costs:read')] },
    async (request, reply) => {
      const { orgId } = request.params as { orgId: string };
      const query = request.query as Record<string, string | undefined>;
      const filters = DashboardQueryFiltersSchema.safeParse(request.query);
      if (!filters.success) {
        return reply.code(400).send({ error: 'bad_request', message: 'Filtros inválidos', issues: filters.error.issues });
      }
      if (filters.data.organizationId && filters.data.organizationId !== orgId) {
        return reply.code(403).send({ error: 'forbidden_tenant', message: 'Organização não autorizada' });
      }
      const limit = query.limit === undefined ? 100 : Number(query.limit);
      const offset = query.offset === undefined ? 0 : Number(query.offset);
      if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0 || offset > 1_000_000) {
        return reply.code(400).send({ error: 'bad_request', message: 'Parâmetros de paginação inválidos' });
      }
      const endDate = filters.data.endDate
        ? new Date(new Date(`${filters.data.endDate}T00:00:00.000Z`).getTime() + 86_400_000)
        : null;
      const result = await pool.query(
        `SELECT cr.provider, cr.model, cr.cost_category, cr.is_simulated, cr.currency,
                SUM(cr.amount)::text AS amount, COUNT(*)::int AS record_count,
                cr.project_id, p.name AS project_name,
                COALESCE(cr.team_id, ue.team_id, p.team_id) AS team_id,
                t.name AS team_name,
                COALESCE(cr.user_id, ue.user_id) AS user_id,
                u.full_name AS user_name,
                COUNT(*) OVER()::int AS total_count
         FROM cost_records cr
         LEFT JOIN projects p ON p.id = cr.project_id AND p.organization_id = cr.organization_id
         LEFT JOIN usage_events ue
           ON ue.id = cr.usage_event_id AND ue.organization_id = cr.organization_id
         LEFT JOIN teams t
           ON t.id = COALESCE(cr.team_id, ue.team_id, p.team_id)
          AND t.organization_id = cr.organization_id
         LEFT JOIN users u
           ON u.id = COALESCE(cr.user_id, ue.user_id)
         LEFT JOIN source_records sr ON sr.id = cr.source_record_id AND sr.organization_id = cr.organization_id
         LEFT JOIN provider_connections pc ON pc.id = sr.provider_connection_id AND pc.organization_id = sr.organization_id
         WHERE cr.organization_id = $1
           AND cr.cost_category IN ('gateway_estimated', 'guardrail_evaluation', 'provider_reported')
           AND ($2::uuid IS NULL OR cr.project_id = $2)
           AND ($3::uuid IS NULL OR COALESCE(cr.team_id, ue.team_id, p.team_id) = $3)
           AND ($4::uuid IS NULL OR COALESCE(cr.user_id, ue.user_id) = $4)
           AND ($5::text IS NULL OR cr.provider = $5)
           AND ($6::text IS NULL OR cr.model = $6)
           AND ($7::text IS NULL OR cr.cost_category = $7 OR ($7 = 'simulated' AND cr.is_simulated))
           AND ($8::text IS NULL OR
             ($8 = 'gateway_local' AND (cr.usage_event_id IS NOT NULL OR cr.source_guardrail_evaluation_id IS NOT NULL)) OR
             ($8 = 'csv' AND cr.source_record_id IS NOT NULL AND COALESCE(pc.connection_type, 'csv') = 'csv') OR
             ($8 = 'official_api' AND cr.source_record_id IS NOT NULL AND pc.connection_type = 'api'))
           AND ($9::timestamptz IS NULL OR cr.period_end >= $9)
           AND ($10::timestamptz IS NULL OR cr.period_start < $10)
         GROUP BY cr.provider, cr.model, cr.cost_category, cr.is_simulated, cr.currency,
                  cr.project_id, p.name, COALESCE(cr.team_id, ue.team_id, p.team_id), t.name,
                  COALESCE(cr.user_id, ue.user_id), u.full_name
         ORDER BY cr.provider, cr.model NULLS LAST, cr.currency, p.name NULLS LAST,
                  COALESCE(cr.team_id, ue.team_id, p.team_id), COALESCE(cr.user_id, ue.user_id),
                  cr.cost_category, cr.is_simulated
         LIMIT $11 OFFSET $12`,
        [
          orgId,
          filters.data.projectId ?? null,
          filters.data.teamId ?? null,
          filters.data.userId ?? null,
          filters.data.provider ?? null,
          filters.data.model ?? null,
          filters.data.costCategory ?? null,
          filters.data.dataSource ?? null,
          filters.data.startDate ? new Date(`${filters.data.startDate}T00:00:00.000Z`) : null,
          endDate,
          limit,
          offset,
        ],
      );
      return {
        items: result.rows,
        total: Number(result.rows[0]?.total_count ?? 0),
        limit,
        offset,
      };
    },
  );

  app.get(
    '/v1/organizations/:orgId/costs/dimensions',
    { preHandler: [requireOrgPermission('costs:read')] },
    async (request) => {
      const { orgId } = request.params as { orgId: string };
      const users = await pool.query<{ id: string; full_name: string }>(
        `SELECT u.id, u.full_name
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         WHERE m.organization_id = $1 AND m.deleted_at IS NULL
           AND u.is_active AND u.deleted_at IS NULL
         ORDER BY u.full_name`,
        [orgId],
      );
      return { users: users.rows };
    },
  );

  app.post(
    '/v1/organizations/:orgId/costs/adjustments',
    { preHandler: [requireOrgPermission('costs:manage')] },
    async (request, reply) => {
      const { orgId } = request.params as { orgId: string };
      const actor = request.authUser!;
      const body = request.body as {
        projectId?: string;
        provider?: string;
        model?: string;
        currency?: string;
        amount?: string;
        periodStart?: string;
        periodEnd?: string;
        reason?: string;
      } | undefined;
      if (
        !body?.currency ||
        body.amount == null ||
        !body.periodStart ||
        !body.periodEnd ||
        !body.reason?.trim() ||
        Number.isNaN(Date.parse(body.periodStart)) ||
        Number.isNaN(Date.parse(body.periodEnd))
      ) {
        return reply.code(400).send({ error: 'bad_request', message: 'Ajuste financeiro inválido' });
      }
      try {
        const adjustment = await recordFinancialAdjustment(pool, {
          organizationId: orgId,
          projectId: body.projectId,
          provider: body.provider,
          model: body.model,
          currency: body.currency.trim().toUpperCase(),
          amount: body.amount,
          periodStart: new Date(body.periodStart),
          periodEnd: new Date(body.periodEnd),
        });
        await recordAuditEvent(pool, {
          organizationId: orgId,
          actorUserId: actor.id,
          action: 'financial_adjustment.created',
          targetType: 'cost_record',
          targetId: String(adjustment.id),
          metadata: {
            amount: body.amount,
            currency: body.currency.toUpperCase(),
            reason: body.reason.trim(),
            projectId: body.projectId ?? null,
          },
        });
        return reply.code(201).send(adjustment);
      } catch (error) {
        if (error instanceof Error && !('code' in error)) {
          return reply.code(400).send({ error: 'bad_request', message: error.message });
        }
        throw error;
      }
    },
  );

  app.post(
    '/v1/organizations/:orgId/costs/:costId/reconcile',
    { preHandler: [requireOrgPermission('costs:read')] },
    async (request, reply) => {
      const { orgId, costId } = request.params as { orgId: string; costId: string };
      try {
        return await reconcileReportedCost(pool, {
          organizationId: orgId,
          reportedCostRecordId: costId,
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes('não encontrado')) {
          return reply.code(404).send({ error: 'cost_record_not_found', message: error.message });
        }
        throw error;
      }
    },
  );

  app.get(
    '/v1/organizations/:orgId/reconciliation-matches',
    { preHandler: [requireOrgPermission('costs:read')] },
    async (request, reply) => {
      const { orgId } = request.params as { orgId: string };
      const filters = DashboardQueryFiltersSchema.safeParse(request.query);
      if (!filters.success) {
        return reply.code(400).send({ error: 'bad_request', message: 'Filtros inválidos' });
      }
      if (filters.data.organizationId && filters.data.organizationId !== orgId) {
        return reply.code(403).send({ error: 'forbidden_tenant', message: 'Organização não autorizada' });
      }
      const startDate = filters.data.startDate
        ? new Date(`${filters.data.startDate}T00:00:00.000Z`)
        : null;
      const endDate = filters.data.endDate
        ? new Date(new Date(`${filters.data.endDate}T00:00:00.000Z`).getTime() + 86_400_000)
        : null;
      const result = await pool.query(
        `SELECT rm.id, rm.organization_id, rm.estimated_cost_record_id, rm.reported_cost_record_id,
                rm.status, rm.currency, rm.delta_amount, rm.notes, rm.reconciled_at
         FROM reconciliation_matches rm
         LEFT JOIN cost_records reported
           ON reported.id = rm.reported_cost_record_id AND reported.organization_id = rm.organization_id
         LEFT JOIN cost_records estimated
           ON estimated.id = rm.estimated_cost_record_id AND estimated.organization_id = rm.organization_id
         LEFT JOIN projects p
           ON p.id = COALESCE(reported.project_id, estimated.project_id)
          AND p.organization_id = rm.organization_id
         LEFT JOIN source_records sr
           ON sr.id = COALESCE(reported.source_record_id, estimated.source_record_id)
          AND sr.organization_id = rm.organization_id
         LEFT JOIN provider_connections pc
           ON pc.id = sr.provider_connection_id AND pc.organization_id = sr.organization_id
         WHERE rm.organization_id = $1
           AND ($2::timestamptz IS NULL OR COALESCE(reported.period_end, estimated.period_end, rm.reconciled_at) >= $2)
           AND ($3::timestamptz IS NULL OR COALESCE(reported.period_start, estimated.period_start, rm.reconciled_at) < $3)
           AND ($4::uuid IS NULL OR COALESCE(reported.project_id, estimated.project_id) = $4)
           AND ($5::uuid IS NULL OR COALESCE(reported.team_id, estimated.team_id, p.team_id) = $5)
           AND ($6::uuid IS NULL OR COALESCE(reported.user_id, estimated.user_id) = $6)
           AND ($7::text IS NULL OR COALESCE(reported.provider, estimated.provider) = $7)
           AND ($8::text IS NULL OR COALESCE(reported.model, estimated.model) = $8)
           AND ($9::text IS NULL OR
             ($9 = 'unreconciled' AND rm.status = 'unreconciled') OR
             ($9 = 'simulated' AND (reported.is_simulated OR estimated.is_simulated)) OR
             reported.cost_category = $9 OR estimated.cost_category = $9)
           AND ($10::text IS NULL OR
             ($10 = 'gateway_local' AND (reported.usage_event_id IS NOT NULL OR estimated.usage_event_id IS NOT NULL)) OR
             ($10 = 'csv' AND sr.id IS NOT NULL AND COALESCE(pc.connection_type, 'csv') = 'csv') OR
             ($10 = 'official_api' AND sr.id IS NOT NULL AND pc.connection_type = 'api'))
         ORDER BY rm.reconciled_at DESC
         LIMIT 500`,
        [
          orgId, startDate, endDate, filters.data.projectId ?? null, filters.data.teamId ?? null,
          filters.data.userId ?? null, filters.data.provider ?? null, filters.data.model ?? null,
          filters.data.costCategory ?? null, filters.data.dataSource ?? null,
        ],
      );
      return { items: result.rows };
    },
  );

  app.get(
    '/v1/organizations/:orgId/budget-policies',
    { preHandler: [requireOrgPermission('budgets:read')] },
    async (request, reply) => {
      const { orgId } = request.params as { orgId: string };
      const filters = DashboardQueryFiltersSchema.safeParse(request.query);
      if (!filters.success) {
        return reply.code(400).send({ error: 'bad_request', message: 'Filtros inválidos' });
      }
      if (filters.data.organizationId && filters.data.organizationId !== orgId) {
        return reply.code(403).send({ error: 'forbidden_tenant', message: 'Organização não autorizada' });
      }
      const result = await pool.query(
        `SELECT bp.id, bp.organization_id, bp.scope_type, bp.project_id, bp.virtual_key_id,
                bp.team_id, bp.user_id, bp.name, bp.mode,
                bp.currency, bp.limit_amount, bp.alert_threshold_percent, bp.period_start, bp.period_end,
                bp.is_active, bp.created_at, bp.updated_at
         FROM budget_policies bp
         LEFT JOIN projects p ON p.id = bp.project_id AND p.organization_id = bp.organization_id
         LEFT JOIN virtual_keys vk ON vk.id = bp.virtual_key_id AND vk.organization_id = bp.organization_id
         LEFT JOIN projects key_project ON key_project.id = vk.project_id AND key_project.organization_id = vk.organization_id
         LEFT JOIN team_memberships key_tm
           ON key_tm.organization_id = vk.organization_id AND key_tm.user_id = vk.owner_user_id
         WHERE bp.organization_id = $1
           AND ($2::uuid IS NULL OR bp.scope_type = 'organization'
             OR bp.project_id = $2 OR key_project.id = $2)
           AND ($3::uuid IS NULL OR bp.scope_type = 'organization'
             OR p.team_id = $3 OR key_project.team_id = $3 OR vk.team_id = $3
             OR key_tm.team_id = $3 OR bp.team_id = $3)
           AND ($4::timestamptz IS NULL OR bp.period_end >= $4)
           AND ($5::timestamptz IS NULL OR bp.period_start < $5)
           AND ($6::uuid IS NULL OR bp.scope_type = 'organization' OR bp.user_id = $6)
         ORDER BY bp.created_at DESC`,
        [
          orgId, filters.data.projectId ?? null, filters.data.teamId ?? null,
          filters.data.startDate ? new Date(`${filters.data.startDate}T00:00:00.000Z`) : null,
          filters.data.endDate
            ? new Date(new Date(`${filters.data.endDate}T00:00:00.000Z`).getTime() + 86_400_000)
            : null,
          filters.data.userId ?? null,
        ],
      );
      return { items: result.rows };
    },
  );

  app.post(
    '/v1/organizations/:orgId/budget-policies',
    { preHandler: [requireOrgPermission('budgets:manage')] },
    async (request, reply) => {
      const { orgId } = request.params as { orgId: string };
      const actor = request.authUser!;
      const body = request.body as Omit<BudgetPolicyInput, 'organizationId' | 'periodStart' | 'periodEnd'> & {
        periodStart?: string;
        periodEnd?: string;
      } | undefined;
      if (
        !body?.name ||
        !body.scopeType ||
        !body.mode ||
        !body.currency ||
        !body.limitAmount ||
        !body.periodStart ||
        !body.periodEnd ||
        Number.isNaN(Date.parse(body.periodStart)) ||
        Number.isNaN(Date.parse(body.periodEnd))
      ) {
        return reply.code(400).send({ error: 'bad_request', message: 'Payload de orçamento inválido' });
      }
      if (body.scopeType === 'team') {
        const team = await pool.query(
          `SELECT 1 FROM teams
           WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
          [body.teamId, orgId],
        );
        if (!team.rowCount) {
          return reply.code(400).send({ error: 'invalid_budget_team', message: 'Equipe inválida para esta organização' });
        }
      }
      if (body.scopeType === 'user') {
        const user = await pool.query(
          `SELECT 1 FROM memberships m
           JOIN users u ON u.id = m.user_id
           WHERE m.user_id = $1 AND m.organization_id = $2
             AND m.deleted_at IS NULL AND u.is_active AND u.deleted_at IS NULL`,
          [body.userId, orgId],
        );
        if (!user.rowCount) {
          return reply.code(400).send({ error: 'invalid_budget_user', message: 'Usuário inválido para esta organização' });
        }
      }
      try {
        const policy = await createBudgetPolicy(pool, {
          ...body,
          organizationId: orgId,
          currency: body.currency.trim().toUpperCase(),
          periodStart: new Date(body.periodStart),
          periodEnd: new Date(body.periodEnd),
        });
        await recordAuditEvent(pool, {
          organizationId: orgId,
          actorUserId: actor.id,
          action: 'budget_policy.created',
          targetType: 'budget_policy',
          targetId: String(policy.id),
          metadata: { scopeType: body.scopeType, mode: body.mode, limitAmount: body.limitAmount },
        });
        return reply.code(201).send(policy);
      } catch (error) {
        if (error instanceof Error && !('code' in error)) {
          return reply.code(400).send({ error: 'bad_request', message: error.message });
        }
        throw error;
      }
    },
  );

  app.patch(
    '/v1/organizations/:orgId/budget-policies/:policyId',
    { preHandler: [requireOrgPermission('budgets:manage')] },
    async (request, reply) => {
      const { orgId, policyId } = request.params as { orgId: string; policyId: string };
      const actor = request.authUser!;
      const body = request.body as Record<string, unknown> | undefined;
      if (!body || Object.keys(body).length === 0) {
        return reply.code(400).send({ error: 'bad_request', message: 'Informe os campos para atualizar' });
      }
      const fields: Parameters<typeof updateBudgetPolicy>[1]['fields'] = {};
      if (typeof body.name === 'string') fields.name = body.name;
      if (body.mode === 'observe' || body.mode === 'alert' || body.mode === 'block') fields.mode = body.mode;
      if (typeof body.limitAmount === 'string') fields.limitAmount = body.limitAmount;
      if (typeof body.alertThresholdPercent === 'string') {
        fields.alertThresholdPercent = body.alertThresholdPercent;
      }
      if (typeof body.periodStart === 'string' && !Number.isNaN(Date.parse(body.periodStart))) {
        fields.periodStart = new Date(body.periodStart);
      }
      if (typeof body.periodEnd === 'string' && !Number.isNaN(Date.parse(body.periodEnd))) {
        fields.periodEnd = new Date(body.periodEnd);
      }
      if (typeof body.isActive === 'boolean') fields.isActive = body.isActive;
      if (Object.keys(fields).length !== Object.keys(body).length) {
        return reply.code(400).send({ error: 'bad_request', message: 'Um ou mais campos são inválidos' });
      }
      let policy;
      try {
        policy = await updateBudgetPolicy(pool, { organizationId: orgId, policyId, fields });
      } catch (error) {
        if (error instanceof Error && !('code' in error)) {
          return reply.code(400).send({ error: 'bad_request', message: error.message });
        }
        if ((error as { code?: string }).code === '23514') {
          return reply.code(400).send({ error: 'bad_request', message: 'Período de orçamento inválido' });
        }
        throw error;
      }
      if (!policy) {
        return reply.code(404).send({ error: 'budget_policy_not_found', message: 'Política não encontrada' });
      }
      await recordAuditEvent(pool, {
        organizationId: orgId,
        actorUserId: actor.id,
        action: 'budget_policy.updated',
        targetType: 'budget_policy',
        targetId: policyId,
        metadata: fields,
      });
      return policy;
    },
  );

  return app;
}
