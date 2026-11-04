import { applyMigrations, closePool, getPool } from '@ia-governanca/database';
import { hashPassword, hashRefreshToken, resolveAuthConfig, validatePasswordPolicy, verifyPassword } from '@ia-governanca/identity';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApiServer } from '../../apps/api/src/index.js';
import { bootstrapLocalAdmin } from '../../apps/api/src/bootstrap-admin.js';
import { resetTestDatabase } from '../helpers/reset-test-database.js';

process.env.AUTH_RATE_LIMIT_MAX = '1000';
const SECRET = 'local-test-secret-with-at-least-32-chars!!';
const PASSWORD = 'Correct-Horse-Battery-42';

describe('Tarefa 10.8 — login local sem Keycloak', () => {
  const pool = getPool();
  let api: Awaited<ReturnType<typeof buildApiServer>>;
  let orgA = '';
  let orgB = '';
  const ids: Record<string, string> = {};

  async function createUser(key: string, email: string, org: string | null, role = 'developer') {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name, password_hash) VALUES ($1, $1, $2) RETURNING id`,
      [email, await hashPassword(PASSWORD)],
    );
    ids[key] = res.rows[0]!.id;
    if (org) await pool.query(`INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, $3)`, [org, ids[key], role]);
  }

  async function login(email: string, password = PASSWORD) {
    return api.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  }

  beforeAll(async () => {
    await resetTestDatabase(pool);
    await applyMigrations(pool);
    orgA = (await pool.query(`INSERT INTO organizations (name, slug) VALUES ('A','org-a') RETURNING id`)).rows[0].id;
    orgB = (await pool.query(`INSERT INTO organizations (name, slug) VALUES ('B','org-b') RETURNING id`)).rows[0].id;
    await createUser('owner', 'owner@a.local', orgA, 'owner');
    await createUser('admin', 'admin@a.local', orgA, 'admin');
    await createUser('dev', 'dev@a.local', orgA, 'developer');
    await createUser('lock', 'lock@a.local', orgA, 'developer');
    await createUser('other', 'other@b.local', orgB, 'developer');
    await createUser('shared', 'shared@ab.local', orgA, 'developer');
    await pool.query(`INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'viewer')`, [orgB, ids.shared]);
    await pool.query(`UPDATE users SET is_active = FALSE WHERE false`);
    api = await buildApiServer({ pool, authMode: 'local', localJwtSecret: SECRET });
  });

  afterAll(async () => {
    await api.close();
    await closePool();
  });

  it('aplica política de senha e hash scrypt verificável', async () => {
    expect(validatePasswordPolicy('curta')).not.toBeNull();
    expect(validatePasswordPolicy('password1234')).not.toBeNull();
    expect(validatePasswordPolicy(PASSWORD)).toBeNull();
    const hash = await hashPassword(PASSWORD);
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyPassword('outra-senha-qualquer', hash)).toBe(false);
  });

  it('expõe /auth/config e resolve modos', async () => {
    const cfg = await api.inject({ method: 'GET', url: '/auth/config' });
    expect(cfg.json()).toEqual({ mode: 'local', localEnabled: true, oidcEnabled: false });
    expect(resolveAuthConfig({}, { localJwtSecret: SECRET }).mode).toBe('local');
    expect(resolveAuthConfig({ KEYCLOAK_BASE_URL: 'http://k' }, { localJwtSecret: SECRET }).mode).toBe('both');
    expect(resolveAuthConfig({ KEYCLOAK_BASE_URL: 'http://k' }).mode).toBe('oidc');
    expect(() => resolveAuthConfig({ AUTH_MODE: 'local' })).toThrow();
  });

  it('autentica, usa o token, e responde igual para usuário inexistente e senha errada', async () => {
    const ok = await login('Owner@A.local');
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['cache-control']).toBe('no-store');
    const { accessToken, refreshToken, mustChangePassword } = ok.json();
    expect(mustChangePassword).toBe(false);
    const me = await api.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${accessToken}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('owner@a.local');

    const wrong = await login('owner@a.local', 'senha-errada-123456');
    const ghost = await login('ninguem@a.local');
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual(ghost.json());
    expect(JSON.stringify(ok.json())).not.toContain('scrypt$');
    const stored = await pool.query(`SELECT refresh_token_hash FROM auth_sessions WHERE user_id = $1`, [ids.owner]);
    expect(stored.rows[0].refresh_token_hash).toBe(hashRefreshToken(refreshToken));
    expect(stored.rows[0].refresh_token_hash).not.toBe(refreshToken);
  });

  it('bloqueia após 5 falhas, mesmo com a senha correta', async () => {
    for (let i = 0; i < 5; i += 1) expect((await login('lock@a.local', 'errada-errada-1234')).statusCode).toBe(401);
    const blocked = await login('lock@a.local');
    expect(blocked.statusCode).toBe(401);
    expect(blocked.json().error).toBe('invalid_credentials');
    const audit = await pool.query(`SELECT 1 FROM audit_events WHERE action = 'auth.account.locked' AND target_id = $1`, [ids.lock]);
    expect(audit.rowCount).toBe(1);
  });

  it('rotaciona refresh, detecta reuso e revoga a família; logout invalida o access token', async () => {
    const first = (await login('dev@a.local')).json();
    const refreshed = await api.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: first.refreshToken } });
    expect(refreshed.statusCode).toBe(200);
    const second = refreshed.json();
    expect(second.refreshToken).not.toBe(first.refreshToken);

    const reuse = await api.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: first.refreshToken } });
    expect(reuse.statusCode).toBe(401);
    const afterReuse = await api.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${second.accessToken}` } });
    expect(afterReuse.statusCode).toBe(401);

    const third = (await login('dev@a.local')).json();
    const out = await api.inject({ method: 'POST', url: '/auth/logout', headers: { authorization: `Bearer ${third.accessToken}` } });
    expect(out.statusCode).toBe(204);
    const afterLogout = await api.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${third.accessToken}` } });
    expect(afterLogout.statusCode).toBe(401);
    const refreshAfter = await api.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: third.refreshToken } });
    expect(refreshAfter.statusCode).toBe(401);
  });

  it('troca de senha exige a atual e revoga as demais sessões', async () => {
    const a = (await login('admin@a.local')).json();
    const b = (await login('admin@a.local')).json();
    const headers = { authorization: `Bearer ${a.accessToken}` };
    const bad = await api.inject({ method: 'POST', url: '/auth/change-password', headers, payload: { currentPassword: 'x'.repeat(14), newPassword: 'Nova-Senha-Forte-77' } });
    expect(bad.statusCode).toBe(401);
    const weak = await api.inject({ method: 'POST', url: '/auth/change-password', headers, payload: { currentPassword: PASSWORD, newPassword: 'curta' } });
    expect(weak.statusCode).toBe(400);
    const ok = await api.inject({ method: 'POST', url: '/auth/change-password', headers, payload: { currentPassword: PASSWORD, newPassword: 'Nova-Senha-Forte-77' } });
    expect(ok.statusCode).toBe(204);
    expect((await api.inject({ method: 'GET', url: '/v1/me', headers })).statusCode).toBe(200);
    expect((await api.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${b.accessToken}` } })).statusCode).toBe(401);
    expect((await login('admin@a.local', 'Nova-Senha-Forte-77')).statusCode).toBe(200);
    expect((await login('admin@a.local')).statusCode).toBe(401);
  });

  it('redefinição por owner/admin respeita org, hierarquia e força troca de senha', async () => {
    const owner = (await login('owner@a.local')).json();
    const dev = (await login('dev@a.local')).json();
    const ownerH = { authorization: `Bearer ${owner.accessToken}` };
    const path = (u: string) => `/v1/organizations/${orgA}/users/${ids[u]}/password`;
    const payload = { newPassword: 'Temporaria-Segura-55' };

    expect((await api.inject({ method: 'POST', url: path('dev'), headers: { authorization: `Bearer ${dev.accessToken}` }, payload })).statusCode).toBe(403);
    expect((await api.inject({ method: 'POST', url: path('shared'), headers: ownerH, payload })).statusCode).toBe(403);
    expect((await api.inject({ method: 'POST', url: `/v1/organizations/${orgA}/users/${ids.other}/password`, headers: ownerH, payload })).statusCode).toBe(404);
    expect((await api.inject({ method: 'POST', url: path('owner'), headers: ownerH, payload })).statusCode).toBe(400);

    const adminTok = (await login('admin@a.local', 'Nova-Senha-Forte-77')).json();
    const adminOnOwner = await api.inject({ method: 'POST', url: path('owner'), headers: { authorization: `Bearer ${adminTok.accessToken}` }, payload });
    expect(adminOnOwner.statusCode).toBe(403);

    const reset = await api.inject({ method: 'POST', url: path('dev'), headers: ownerH, payload });
    expect(reset.statusCode).toBe(204);
    expect((await api.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${dev.accessToken}` } })).statusCode).toBe(401);
    const again = (await login('dev@a.local', payload.newPassword)).json();
    expect(again.mustChangePassword).toBe(true);
    const blocked = await api.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${again.accessToken}` } });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error).toBe('password_change_required');
    const change = await api.inject({
      method: 'POST', url: '/auth/change-password', headers: { authorization: `Bearer ${again.accessToken}` },
      payload: { currentPassword: payload.newPassword, newPassword: 'Definitiva-Segura-88' },
    });
    expect(change.statusCode).toBe(204);
    expect((await api.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${again.accessToken}` } })).statusCode).toBe(200);
  });

  it('desativação do usuário bloqueia o token existente', async () => {
    const tok = (await login('other@b.local')).json();
    await pool.query(`UPDATE users SET is_active = FALSE WHERE id = $1`, [ids.other]);
    expect((await api.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${tok.accessToken}` } })).statusCode).toBe(403);
    expect((await login('other@b.local')).statusCode).toBe(401);
  });

  it('modo oidc rejeita token local; modo local rejeita token de outro emissor', async () => {
    const tok = (await login('owner@a.local')).json();
    const oidcOnly = await buildApiServer({ pool, authMode: 'oidc', localJwtSecret: SECRET });
    const res = await oidcOnly.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${tok.accessToken}` } });
    expect(res.statusCode).toBe(401);
    expect((await oidcOnly.inject({ method: 'POST', url: '/auth/login', payload: { email: 'owner@a.local', password: PASSWORD } })).statusCode).toBe(404);
    await oidcOnly.close();
    const foreign = 'eyJhbGciOiJub25lIn0.eyJpc3MiOiJodHRwOi8vZXZpbC5sb2NhbCJ9.';
    expect((await api.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${foreign}` } })).statusCode).toBe(401);
  });

  it('bootstrap cria o primeiro admin só uma vez', async () => {
    await pool.query(`UPDATE users SET password_hash = NULL`);
    const env = { AUTH_LOCAL_JWT_SECRET: SECRET, BOOTSTRAP_ADMIN_EMAIL: 'First@Boot.local', BOOTSTRAP_ADMIN_PASSWORD: 'Primeiro-Acesso-99' };
    expect(await bootstrapLocalAdmin(env, pool)).toBe('created');
    expect(await bootstrapLocalAdmin(env, pool)).toBe('skipped');
    const row = await pool.query(`SELECT must_change_password FROM users WHERE email = 'first@boot.local'`);
    expect(row.rows[0].must_change_password).toBe(true);
    expect((await login('first@boot.local', 'Primeiro-Acesso-99')).json().mustChangePassword).toBe(true);
  });
});
