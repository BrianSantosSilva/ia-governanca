import {
  ACCESS_TOKEN_TTL_SECONDS,
  LOCKOUT_MINUTES,
  MAX_FAILED_LOGINS,
  SESSION_ABSOLUTE_TTL_SECONDS,
  burnPasswordVerification,
  generateRefreshToken,
  hashPassword,
  hashRefreshToken,
  signLocalAccessToken,
  validatePasswordPolicy,
  verifyPassword,
  type ResolvedAuthConfig,
} from '@ia-governanca/identity';
import type { Role } from '@ia-governanca/contracts';
import type { MetricsRegistry } from '@ia-governanca/observability';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import type pg from 'pg';

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

export interface LocalAuthDeps {
  pool: pg.Pool;
  authConfig: ResolvedAuthConfig;
  metrics: MetricsRegistry;
  authenticateRequest: Guard;
  requireOrgPermission: (permission: 'members:manage') => Guard;
}

const INVALID_CREDENTIALS = { error: 'invalid_credentials', message: 'E-mail ou senha inválidos' };
const INVALID_REFRESH = { error: 'invalid_refresh_token', message: 'Sessão inválida ou expirada' };
const authRateLimit = () => ({
  rateLimit: { max: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 20), timeWindow: '1 minute' },
});

export function registerLocalAuthRoutes(app: FastifyInstance, deps: LocalAuthDeps): void {
  const { pool, authConfig, metrics } = deps;

  // audit_events exige organization_id: grava um evento por organização do usuário
  async function auditAuth(userId: string, action: string, metadata: Record<string, unknown> = {}, actorUserId = userId) {
    await pool.query(
      `INSERT INTO audit_events (organization_id, actor_user_id, action, target_type, target_id, metadata)
       SELECT m.organization_id, $2, $3, 'user', $5, $4::jsonb
       FROM memberships m
       WHERE m.user_id = $1::uuid AND m.deleted_at IS NULL`,
      [userId, actorUserId, action, JSON.stringify(metadata), userId],
    );
  }

  async function issueTokens(
    client: pg.Pool | pg.PoolClient,
    params: { userId: string; familyId: string; expiresAt: Date; rotatedFromId?: string; userAgent?: string },
  ) {
    const refresh = generateRefreshToken();
    await client.query(
      `INSERT INTO auth_sessions (family_id, user_id, refresh_token_hash, expires_at, rotated_from_id, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        params.familyId,
        params.userId,
        refresh.hash,
        params.expiresAt,
        params.rotatedFromId ?? null,
        params.userAgent?.slice(0, 255) ?? null,
      ],
    );
    const accessToken = await signLocalAccessToken(authConfig.localJwtSecret!, {
      userId: params.userId,
      familyId: params.familyId,
    });
    return { accessToken, refreshToken: refresh.token, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
  }

  function localOnly(reply: FastifyReply) {
    if (authConfig.localEnabled && authConfig.localJwtSecret) return false;
    reply.code(404).send({ error: 'not_found', message: 'Login local desabilitado' });
    return true;
  }

  app.get('/auth/config', async () => ({
    mode: authConfig.mode,
    localEnabled: authConfig.localEnabled,
    oidcEnabled: authConfig.oidcEnabled,
  }));

  app.post('/auth/login', { config: authRateLimit() }, async (request, reply) => {
    if (localOnly(reply)) return;
    reply.header('Cache-Control', 'no-store');
    const body = request.body as { email?: unknown; password?: unknown } | undefined;
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!email || email.length > 320 || !password || password.length > 128) {
      await burnPasswordVerification(password.slice(0, 128));
      metrics.increment('api_auth_logins_total', { result: 'invalid' });
      return reply.code(401).send(INVALID_CREDENTIALS);
    }

    const res = await pool.query<{
      id: string;
      password_hash: string | null;
      is_active: boolean;
      deleted_at: Date | null;
      locked: boolean;
    }>(
      `SELECT id, password_hash, is_active, deleted_at, (locked_until IS NOT NULL AND locked_until > NOW()) AS locked
       FROM users WHERE lower(email) = $1`,
      [email],
    );
    const user = res.rows[0];
    const usable = user && user.password_hash && user.is_active && user.deleted_at === null && !user.locked;
    if (!usable) {
      await burnPasswordVerification(password);
      metrics.increment('api_auth_logins_total', { result: user?.locked ? 'locked' : 'invalid' });
      if (user) await auditAuth(user.id, 'auth.login.failed', { reason: user.locked ? 'locked' : 'unavailable' });
      return reply.code(401).send(INVALID_CREDENTIALS);
    }

    if (!(await verifyPassword(password, user.password_hash))) {
      const upd = await pool.query<{ failed_login_attempts: number }>(
        `UPDATE users
         SET failed_login_attempts = CASE WHEN failed_login_attempts + 1 >= $2 THEN 0 ELSE failed_login_attempts + 1 END,
             locked_until = CASE WHEN failed_login_attempts + 1 >= $2
                                 THEN NOW() + make_interval(mins => $3) ELSE locked_until END
         WHERE id = $1
         RETURNING failed_login_attempts`,
        [user.id, MAX_FAILED_LOGINS, LOCKOUT_MINUTES],
      );
      await auditAuth(user.id, 'auth.login.failed', { reason: 'bad_password' });
      if (upd.rows[0]?.failed_login_attempts === 0) {
        await auditAuth(user.id, 'auth.account.locked', { minutes: LOCKOUT_MINUTES });
        metrics.increment('api_auth_logins_total', { result: 'lockout' });
      } else {
        metrics.increment('api_auth_logins_total', { result: 'invalid' });
      }
      return reply.code(401).send(INVALID_CREDENTIALS);
    }

    const userState = await pool.query<{ must_change_password: boolean }>(
      `UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1 RETURNING must_change_password`,
      [user.id],
    );
    const tokens = await issueTokens(pool, {
      userId: user.id,
      familyId: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + SESSION_ABSOLUTE_TTL_SECONDS * 1000),
      userAgent: request.headers['user-agent'],
    });
    await auditAuth(user.id, 'auth.login.succeeded');
    metrics.increment('api_auth_logins_total', { result: 'success' });
    return { ...tokens, mustChangePassword: userState.rows[0]?.must_change_password ?? false };
  });

  app.post('/auth/refresh', { config: authRateLimit() }, async (request, reply) => {
    if (localOnly(reply)) return;
    reply.header('Cache-Control', 'no-store');
    const body = request.body as { refreshToken?: unknown } | undefined;
    if (typeof body?.refreshToken !== 'string' || body.refreshToken.length > 200) {
      return reply.code(401).send(INVALID_REFRESH);
    }
    const hash = hashRefreshToken(body.refreshToken);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const sessRes = await client.query<{
        id: string;
        family_id: string;
        user_id: string;
        expires_at: Date;
        revoked_at: Date | null;
        revoked_reason: string | null;
        active: boolean;
        must_change_password: boolean;
      }>(
        `SELECT s.id, s.family_id, s.user_id, s.expires_at, s.revoked_at, s.revoked_reason,
                (u.is_active AND u.deleted_at IS NULL) AS active, u.must_change_password
         FROM auth_sessions s JOIN users u ON u.id = s.user_id
         WHERE s.refresh_token_hash = $1
         FOR UPDATE OF s`,
        [hash],
      );
      const sess = sessRes.rows[0];
      if (!sess) {
        await client.query('ROLLBACK');
        return reply.code(401).send(INVALID_REFRESH);
      }
      if (sess.revoked_at !== null) {
        if (sess.revoked_reason === 'rotated') {
          await client.query(
            `UPDATE auth_sessions SET revoked_at = NOW(), revoked_reason = 'reuse_detected'
             WHERE family_id = $1 AND revoked_at IS NULL`,
            [sess.family_id],
          );
          await client.query('COMMIT');
          await auditAuth(sess.user_id, 'auth.refresh.reuse_detected');
          metrics.increment('api_auth_logins_total', { result: 'reuse_detected' });
        } else {
          await client.query('ROLLBACK');
        }
        return reply.code(401).send(INVALID_REFRESH);
      }
      if (sess.expires_at.getTime() <= Date.now() || !sess.active) {
        await client.query('ROLLBACK');
        return reply.code(401).send(INVALID_REFRESH);
      }
      await client.query(`UPDATE auth_sessions SET revoked_at = NOW(), revoked_reason = 'rotated' WHERE id = $1`, [sess.id]);
      const tokens = await issueTokens(client, {
        userId: sess.user_id,
        familyId: sess.family_id,
        expiresAt: sess.expires_at,
        rotatedFromId: sess.id,
        userAgent: request.headers['user-agent'],
      });
      await client.query('COMMIT');
      return { ...tokens, mustChangePassword: sess.must_change_password };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });

  app.post('/auth/logout', { config: authRateLimit() }, async (request, reply) => {
    if (localOnly(reply)) return;
    const body = request.body as { refreshToken?: unknown } | undefined;
    let userId: string | undefined;
    if (typeof body?.refreshToken === 'string' && body.refreshToken.length <= 200) {
      const res = await pool.query<{ user_id: string }>(
        `UPDATE auth_sessions SET revoked_at = NOW(), revoked_reason = 'logout'
         WHERE family_id = (SELECT family_id FROM auth_sessions WHERE refresh_token_hash = $1)
           AND revoked_at IS NULL
         RETURNING user_id`,
        [hashRefreshToken(body.refreshToken)],
      );
      userId = res.rows[0]?.user_id;
    } else {
      await deps.authenticateRequest(request, reply);
      if (reply.sent || !request.authUser) return;
      if (request.authUser.familyId) {
        await pool.query(
          `UPDATE auth_sessions SET revoked_at = NOW(), revoked_reason = 'logout'
           WHERE family_id = $1 AND revoked_at IS NULL`,
          [request.authUser.familyId],
        );
        userId = request.authUser.id;
      }
    }
    if (userId) await auditAuth(userId, 'auth.logout');
    return reply.code(204).send();
  });

  app.post(
    '/auth/change-password',
    { config: authRateLimit(), preHandler: [deps.authenticateRequest] },
    async (request, reply) => {
      const user = request.authUser!;
      if (user.authSource !== 'local' || !user.familyId) {
        return reply.code(400).send({ error: 'bad_request', message: 'Conta SSO: altere a senha no provedor de identidade' });
      }
      const body = request.body as { currentPassword?: unknown; newPassword?: unknown } | undefined;
      const current = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
      const next = body?.newPassword;
      const policyError = validatePasswordPolicy(next);
      if (policyError) return reply.code(400).send({ error: 'weak_password', message: policyError });
      const hashRes = await pool.query<{ password_hash: string | null }>(
        `SELECT password_hash FROM users WHERE id = $1`,
        [user.id],
      );
      if (!current || !(await verifyPassword(current, hashRes.rows[0]?.password_hash))) {
        return reply.code(401).send({ error: 'invalid_credentials', message: 'Senha atual inválida' });
      }
      if (current === next) {
        return reply.code(400).send({ error: 'weak_password', message: 'A nova senha deve ser diferente da atual' });
      }
      await pool.query(
        `UPDATE users SET password_hash = $2, password_changed_at = NOW(), must_change_password = FALSE,
                failed_login_attempts = 0, locked_until = NULL, updated_at = NOW()
         WHERE id = $1`,
        [user.id, await hashPassword(next as string)],
      );
      await pool.query(
        `UPDATE auth_sessions SET revoked_at = NOW(), revoked_reason = 'password_changed'
         WHERE user_id = $1 AND family_id <> $2 AND revoked_at IS NULL`,
        [user.id, user.familyId],
      );
      await auditAuth(user.id, 'auth.password.changed');
      return reply.code(204).send();
    },
  );

  app.post(
    '/v1/organizations/:orgId/users/:userId/password',
    { config: authRateLimit(), preHandler: [deps.requireOrgPermission('members:manage')] },
    async (request, reply) => {
      const { orgId, userId } = request.params as { orgId: string; userId: string };
      const actor = request.authUser!;
      if (!authConfig.localEnabled) {
        return reply.code(404).send({ error: 'not_found', message: 'Login local desabilitado' });
      }
      if (userId === actor.id) {
        return reply.code(400).send({ error: 'bad_request', message: 'Use a troca de senha da própria conta' });
      }
      const body = request.body as { newPassword?: unknown } | undefined;
      const policyError = validatePasswordPolicy(body?.newPassword);
      if (policyError) return reply.code(400).send({ error: 'weak_password', message: policyError });

      const targetRes = await pool.query<{ role: Role; other_orgs: boolean }>(
        `SELECT m.role,
                EXISTS (SELECT 1 FROM memberships o
                        WHERE o.user_id = m.user_id AND o.organization_id <> m.organization_id AND o.deleted_at IS NULL) AS other_orgs
         FROM memberships m
         WHERE m.organization_id = $1 AND m.user_id = $2 AND m.deleted_at IS NULL`,
        [orgId, userId],
      );
      const target = targetRes.rows[0];
      if (!target) return reply.code(404).send({ error: 'not_found', message: 'Membro não encontrado' });
      if (target.other_orgs) {
        return reply.code(403).send({ error: 'forbidden', message: 'Usuário pertence a outras organizações' });
      }
      if (request.membershipRole !== 'owner' && (target.role === 'owner' || target.role === 'admin')) {
        return reply.code(403).send({ error: 'insufficient_role', message: 'Somente owner redefine senha de owner/admin' });
      }

      await pool.query(
        `UPDATE users SET password_hash = $2, password_changed_at = NOW(), must_change_password = TRUE,
                failed_login_attempts = 0, locked_until = NULL, updated_at = NOW()
         WHERE id = $1`,
        [userId, await hashPassword(body!.newPassword as string)],
      );
      await pool.query(
        `UPDATE auth_sessions SET revoked_at = NOW(), revoked_reason = 'password_reset'
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );
      await auditAuth(userId, 'auth.password.reset', { organizationId: orgId }, actor.id);
      return reply.code(204).send();
    },
  );
}
