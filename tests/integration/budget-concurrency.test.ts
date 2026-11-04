import { applyMigrations, closePool, getPool } from '@ia-governanca/database';
import { resetTestDatabase } from '../helpers/reset-test-database.js';
import { reserveBudget, createBudgetPolicy } from '@ia-governanca/policies';
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('Épico 06 — reserva atômica de orçamento', () => {
  const pool = getPool();
  const dimensionalOrganizationIds: string[] = [];

  beforeAll(async () => {
    await resetTestDatabase(pool);
    await applyMigrations(pool);
  });

  afterAll(async () => {
    if (dimensionalOrganizationIds.length > 0) {
      await pool.query(
        `DELETE FROM budget_reservations
         WHERE organization_id = ANY($1::uuid[])
           AND budget_policy_id IN (
             SELECT id FROM budget_policies
             WHERE organization_id = ANY($1::uuid[]) AND scope_type IN ('team', 'user')
           )`,
        [dimensionalOrganizationIds],
      );
      await pool.query(
        `DELETE FROM budget_policies
         WHERE organization_id = ANY($1::uuid[]) AND scope_type IN ('team', 'user')`,
        [dimensionalOrganizationIds],
      );
    }
    await closePool();
  });

  it('serializa chamadas concorrentes e bloqueia a que ultrapassaria o orçamento', async () => {
    const org = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug)
       VALUES ('Budget Test', 'budget-test-' || substr(gen_random_uuid()::text, 1, 8))
       RETURNING id`,
    );
    const organizationId = org.rows[0]!.id;
    const project = await pool.query<{ id: string }>(
      `INSERT INTO projects (organization_id, name, slug)
       VALUES ($1, 'Projeto Budget', 'project-budget')
       RETURNING id`,
      [organizationId],
    );
    const projectId = project.rows[0]!.id;
    const keyHash = crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex');
    const key = await pool.query<{ id: string }>(
      `INSERT INTO virtual_keys (organization_id, project_id, name, key_prefix, key_hash)
       VALUES ($1, $2, 'Budget test key', 'aisp_live_test', $3)
       RETURNING id`,
      [organizationId, projectId, keyHash],
    );
    await createBudgetPolicy(pool, {
      organizationId,
      scopeType: 'organization',
      name: 'Limite concorrente',
      mode: 'block',
      currency: 'USD',
      limitAmount: '0.000001',
      periodStart: new Date(Date.now() - 60_000),
      periodEnd: new Date(Date.now() + 60_000),
    });

    const reserve = (requestId: string) =>
      reserveBudget(pool, {
        organizationId,
        projectId,
        virtualKeyId: key.rows[0]!.id,
        requestId,
        currency: 'USD',
        estimatedAmount: '0.0000008',
        expiresAt: new Date(Date.now() + 60_000),
      });
    const decisions = await Promise.all([reserve('parallel-a'), reserve('parallel-b')]);

    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(1);
    expect(decisions.filter((decision) => !decision.allowed)).toHaveLength(1);
  });

  it('aplica cumulativamente políticas de organização, projeto, chave, equipe e pessoa', async () => {
    const org = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug)
       VALUES ('Dimensional Budget Test', 'dim-budget-' || substr(gen_random_uuid()::text, 1, 8))
       RETURNING id`,
    );
    const organizationId = org.rows[0]!.id;
    dimensionalOrganizationIds.push(organizationId);
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name)
       VALUES ($1, 'Pessoa Budget')
       RETURNING id`,
      [`budget-${crypto.randomUUID()}@example.test`],
    );
    const userId = user.rows[0]!.id;
    await pool.query(
      `INSERT INTO memberships (organization_id, user_id, role)
       VALUES ($1, $2, 'developer')`,
      [organizationId, userId],
    );
    const team = await pool.query<{ id: string }>(
      `INSERT INTO teams (organization_id, name, slug)
       VALUES ($1, 'Equipe Budget', 'team-' || substr(gen_random_uuid()::text, 1, 8))
       RETURNING id`,
      [organizationId],
    );
    const teamId = team.rows[0]!.id;
    const project = await pool.query<{ id: string }>(
      `INSERT INTO projects (organization_id, team_id, name, slug)
       VALUES ($1, $2, 'Projeto Budget Dimensional', 'project-' || substr(gen_random_uuid()::text, 1, 8))
       RETURNING id`,
      [organizationId, teamId],
    );
    const projectId = project.rows[0]!.id;
    const keyHash = crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex');
    const key = await pool.query<{ id: string }>(
      `INSERT INTO virtual_keys (
         organization_id, project_id, name, key_prefix, key_hash
       )
       VALUES ($1, $2, 'Dimensional budget key', 'aisp_live_dim', $3)
       RETURNING id`,
      [organizationId, projectId, keyHash],
    );
    const virtualKeyId = key.rows[0]!.id;
    const periodStart = new Date(Date.now() - 60_000);
    const periodEnd = new Date(Date.now() + 60_000);
    const policies = await Promise.all([
      createBudgetPolicy(pool, {
        organizationId,
        scopeType: 'organization',
        name: 'Org cumulative',
        mode: 'block',
        currency: 'USD',
        limitAmount: '0.000001',
        periodStart,
        periodEnd,
      }),
      createBudgetPolicy(pool, {
        organizationId,
        scopeType: 'project',
        projectId,
        name: 'Project cumulative',
        mode: 'block',
        currency: 'USD',
        limitAmount: '0.000001',
        periodStart,
        periodEnd,
      }),
      createBudgetPolicy(pool, {
        organizationId,
        scopeType: 'virtual_key',
        virtualKeyId,
        name: 'Key cumulative',
        mode: 'block',
        currency: 'USD',
        limitAmount: '0.000001',
        periodStart,
        periodEnd,
      }),
      createBudgetPolicy(pool, {
        organizationId,
        scopeType: 'team',
        teamId,
        name: 'Team cumulative',
        mode: 'block',
        currency: 'USD',
        limitAmount: '0.000001',
        periodStart,
        periodEnd,
      }),
    ]);
    const reserve = (requestId: string) =>
      reserveBudget(pool, {
        organizationId,
        projectId,
        teamId,
        virtualKeyId,
        requestId,
        currency: 'USD',
        estimatedAmount: '0.0000008',
        expiresAt: periodEnd,
      });

    expect((await reserve(`dimensional-first-${crypto.randomUUID()}`)).allowed).toBe(true);
    const second = await reserve(`dimensional-second-${crypto.randomUUID()}`);
    expect(second.allowed).toBe(false);
    expect(second.exceededPolicyIds).toHaveLength(4);
    expect(second.exceededPolicyIds).toEqual(
      expect.arrayContaining(policies.map((policy) => String(policy.id))),
    );
  });

  it('aplica orçamento de equipe e pessoa a uma chave pessoal sem projeto', async () => {
    const org = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug)
       VALUES ('Personal Budget Test', 'personal-budget-' || substr(gen_random_uuid()::text, 1, 8))
       RETURNING id`,
    );
    const organizationId = org.rows[0]!.id;
    dimensionalOrganizationIds.push(organizationId);
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name)
       VALUES ($1, 'Pessoa pessoal')
       RETURNING id`,
      [`personal-${crypto.randomUUID()}@example.test`],
    );
    const userId = user.rows[0]!.id;
    await pool.query(`INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'developer')`, [organizationId, userId]);
    const team = await pool.query<{ id: string }>(
      `INSERT INTO teams (organization_id, name, slug)
       VALUES ($1, 'Equipe pessoal', 'personal-team-' || substr(gen_random_uuid()::text, 1, 8))
       RETURNING id`,
      [organizationId],
    );
    const teamId = team.rows[0]!.id;
    await pool.query(
      `INSERT INTO team_memberships (organization_id, team_id, user_id) VALUES ($1, $2, $3)`,
      [organizationId, teamId, userId],
    );
    const keyHash = crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex');
    const key = await pool.query<{ id: string }>(
      `INSERT INTO virtual_keys (
         organization_id, scope_type, owner_user_id, name, key_prefix, key_hash
       )
       VALUES ($1, 'user', $2, 'Personal key', 'aisp_live_personal', $3)
       RETURNING id`,
      [organizationId, userId, keyHash],
    );
    const virtualKeyId = key.rows[0]!.id;
    const periodStart = new Date(Date.now() - 60_000);
    const periodEnd = new Date(Date.now() + 60_000);
    const policies = await Promise.all([
      createBudgetPolicy(pool, {
        organizationId, scopeType: 'team', teamId, name: 'Personal team budget',
        mode: 'block', currency: 'USD', limitAmount: '0.000001', periodStart, periodEnd,
      }),
      createBudgetPolicy(pool, {
        organizationId, scopeType: 'user', userId, name: 'Personal user budget',
        mode: 'block', currency: 'USD', limitAmount: '0.000001', periodStart, periodEnd,
      }),
    ]);
    const reserve = (requestId: string) => reserveBudget(pool, {
      organizationId, projectId: null, teamId, userId, virtualKeyId, requestId,
      currency: 'USD', estimatedAmount: '0.0000008', expiresAt: periodEnd,
    });
    expect((await reserve(`personal-first-${crypto.randomUUID()}`)).allowed).toBe(true);
    const second = await reserve(`personal-second-${crypto.randomUUID()}`);
    expect(second.allowed).toBe(false);
    expect(second.exceededPolicyIds).toEqual(expect.arrayContaining(policies.map((policy) => String(policy.id))));
  });
});
