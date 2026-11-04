import {
  applyMigrations,
  closePool,
  getPool,
} from '@ia-governanca/database';
import { resetTestDatabase } from '../helpers/reset-test-database.js';
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('Épico 02 — Integridade do Domínio e Isolamento Multi-tenant no PostgreSQL', () => {
  const pool = getPool();

  beforeAll(async () => {
    await resetTestDatabase(pool);
    await applyMigrations(pool);
  });

  afterAll(async () => {
    await closePool();
  });

  it('Cenário 7: deve reexecutar todas as migrações em um banco limpo de forma reproduzível', async () => {
    await resetTestDatabase(pool);
    const applied = await applyMigrations(pool);

    expect(applied).toEqual([
      '001_organizations_and_identity.sql',
      '002_connectors_and_ingestion.sql',
      '003_licenses.sql',
      '004_gateway_and_finance.sql',
      '005_epic_06_finance_and_budgets.sql',
      '006_external_integrations.sql',
      '007_epic_10_governance_privacy.sql',
      '008_virtual_key_scopes.sql',
      '009_chat_guardrails.sql',
      '010_client_origin.sql',
      '011_guardrail_azure_evaluator.sql',
      '012_local_authentication.sql',
    ]);

    const tablesResult = await pool.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    const tableNames = tablesResult.rows.map((r) => r.table_name);
    expect(tableNames).toEqual(
      expect.arrayContaining([
        'organizations',
        'users',
        'memberships',
        'teams',
        'team_memberships',
        'projects',
        'provider_connections',
        'sync_runs',
        'source_records',
        'external_identities',
        'license_contracts',
        'license_assignments',
        'virtual_keys',
        'usage_events',
        'model_prices',
        'cost_records',
        'reconciliation_matches',
        'budget_policies',
        'budget_reservations',
        'audit_events',
        'guardrail_rules',
        'guardrail_evaluations',
        'guardrail_alerts',
        'guardrail_test_tickets',
      ]),
    );
  });

  it('Cenários 1, 2 e 3: deve criar organização, projeto, equipe associada, usuário e membership em transação real', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const orgRes = await client.query<{ id: string }>(
        `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
        ['Acme Corp', 'acme-corp'],
      );
      const orgId = orgRes.rows[0]!.id;

      const teamRes = await client.query<{ id: string }>(
        `INSERT INTO teams (organization_id, name, slug) VALUES ($1, $2, $3) RETURNING id`,
        [orgId, 'Engenharia IA', 'engenharia-ia'],
      );
      const teamId = teamRes.rows[0]!.id;

      const projRes = await client.query<{ id: string; team_id: string }>(
        `INSERT INTO projects (organization_id, team_id, name, slug) VALUES ($1, $2, $3, $4) RETURNING id, team_id`,
        [orgId, teamId, 'Assistente Interno', 'assistente-interno'],
      );
      expect(projRes.rows[0]!.team_id).toBe(teamId);

      const userRes = await client.query<{ id: string }>(
        `INSERT INTO users (email, full_name) VALUES ($1, $2) RETURNING id`,
        ['alice@acme.local', 'Alice Silva'],
      );
      const userId = userRes.rows[0]!.id;

      const memberRes = await client.query<{ id: string; role: string }>(
        `INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, $3) RETURNING id, role`,
        [orgId, userId, 'owner'],
      );
      expect(memberRes.rows[0]!.role).toBe('owner');

      const teamMemberRes = await client.query<{ id: string }>(
        `INSERT INTO team_memberships (organization_id, team_id, user_id) VALUES ($1, $2, $3) RETURNING id`,
        [orgId, teamId, userId],
      );
      expect(teamMemberRes.rows[0]!.id).toBeDefined();

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  it('Cenário 4: deve impedir associação de usuário ou projeto a uma equipe de outra organização', async () => {
    const orgARes = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
      ['Tenant A', 'tenant-a'],
    );
    const orgBRes = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
      ['Tenant B', 'tenant-b'],
    );
    const orgA = orgARes.rows[0]!.id;
    const orgB = orgBRes.rows[0]!.id;

    const teamBRes = await pool.query<{ id: string }>(
      `INSERT INTO teams (organization_id, name, slug) VALUES ($1, $2, $3) RETURNING id`,
      [orgB, 'Equipe B', 'equipe-b'],
    );
    const teamB = teamBRes.rows[0]!.id;

    const userARes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name) VALUES ($1, $2) RETURNING id`,
      ['bob@tenant-a.local', 'Bob Tenant A'],
    );
    const userA = userARes.rows[0]!.id;

    await pool.query(
      `INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, $3)`,
      [orgA, userA, 'developer'],
    );

    // 4.1: Projeto do Tenant A tentando referenciar Equipe do Tenant B
    await expect(
      pool.query(
        `INSERT INTO projects (organization_id, team_id, name, slug) VALUES ($1, $2, $3, $4)`,
        [orgA, teamB, 'Projeto Cruzado Inválido', 'projeto-cruzado'],
      ),
    ).rejects.toThrow();

    // 4.2: Usuário que pertence apenas ao Tenant A tentando entrar na Equipe do Tenant B
    await expect(
      pool.query(
        `INSERT INTO team_memberships (organization_id, team_id, user_id) VALUES ($1, $2, $3)`,
        [orgB, teamB, userA],
      ),
    ).rejects.toThrow();
  });

  it('Cenário 5: deve impedir uma chave virtual de referenciar ou registrar eventos em um projeto de outro tenant', async () => {
    const org1Res = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
      ['Org 1', 'org-1'],
    );
    const org2Res = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
      ['Org 2', 'org-2'],
    );
    const org1 = org1Res.rows[0]!.id;
    const org2 = org2Res.rows[0]!.id;

    const proj1Res = await pool.query<{ id: string }>(
      `INSERT INTO projects (organization_id, name, slug) VALUES ($1, $2, $3) RETURNING id`,
      [org1, 'Projeto Org 1', 'proj-org-1'],
    );
    const proj2Res = await pool.query<{ id: string }>(
      `INSERT INTO projects (organization_id, name, slug) VALUES ($1, $2, $3) RETURNING id`,
      [org2, 'Projeto Org 2', 'proj-org-2'],
    );
    const proj1 = proj1Res.rows[0]!.id;
    const proj2 = proj2Res.rows[0]!.id;

    const keyHashCross = crypto.createHash('sha256').update('secret-cross').digest('hex');

    // 5.1: Tentar criar chave virtual na Org 1 apontando para Projeto da Org 2
    await expect(
      pool.query(
        `INSERT INTO virtual_keys (organization_id, project_id, name, key_prefix, key_hash)
         VALUES ($1, $2, $3, $4, $5)`,
        [org1, proj2, 'Chave Inválida Cross-Tenant', 'aisp_live_bad1', keyHashCross],
      ),
    ).rejects.toThrow();

    // 5.2: Criar chave virtual válida na Org 1 + Proj 1 e tentar registrar usage_event apontando para Proj 2
    const keyHashValid = crypto.createHash('sha256').update('secret-valid-org1').digest('hex');
    const vkey1Res = await pool.query<{ id: string }>(
      `INSERT INTO virtual_keys (organization_id, project_id, name, key_prefix, key_hash)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [org1, proj1, 'Chave Válida Org 1', 'aisp_live_ok01', keyHashValid],
    );
    const vkey1 = vkey1Res.rows[0]!.id;

    await expect(
      pool.query(
        `INSERT INTO usage_events (organization_id, project_id, virtual_key_id, request_id, provider, model, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [org2, proj2, vkey1, 'req-cross-1', 'ollama', 'llama3.2', 'succeeded'],
      ),
    ).rejects.toThrow();
  });

  it('Cenário 6: deve garantir que a remoção lógica de usuário/chave virtual preserve todos os eventos financeiros', async () => {
    const orgRes = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
      ['FinOps Org', 'finops-org'],
    );
    const orgId = orgRes.rows[0]!.id;

    const userRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name) VALUES ($1, $2) RETURNING id`,
      ['carol@finops.local', 'Carol FinOps'],
    );
    const userId = userRes.rows[0]!.id;

    await pool.query(
      `INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, $3)`,
      [orgId, userId, 'admin'],
    );

    const projRes = await pool.query<{ id: string }>(
      `INSERT INTO projects (organization_id, name, slug) VALUES ($1, $2, $3) RETURNING id`,
      [orgId, 'Core LLM', 'core-llm'],
    );
    const projectId = projRes.rows[0]!.id;

    const keyHash = crypto.createHash('sha256').update('secret-finops-key').digest('hex');
    const vkeyRes = await pool.query<{ id: string }>(
      `INSERT INTO virtual_keys (organization_id, project_id, created_by_user_id, name, key_prefix, key_hash)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [orgId, projectId, userId, 'Key Prod', 'aisp_live_fin1', keyHash],
    );
    const vkeyId = vkeyRes.rows[0]!.id;

    const priceRes = await pool.query<{ id: string }>(
      `INSERT INTO model_prices (organization_id, provider, model, currency, input_price_per_million, output_price_per_million, price_source, price_type, effective_from)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() - INTERVAL '1 day') RETURNING id`,
      [orgId, 'ollama', 'llama3.2', 'USD', '0.10000000', '0.20000000', 'internal_simulation', 'simulation'],
    );
    const priceId = priceRes.rows[0]!.id;

    const usageRes = await pool.query<{ id: string }>(
      `INSERT INTO usage_events (organization_id, project_id, virtual_key_id, request_id, provider, model, input_tokens, output_tokens, duration_ms, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [orgId, projectId, vkeyId, 'req-fin-001', 'ollama', 'llama3.2', 1000, 500, 420, 'succeeded'],
    );
    const usageEventId = usageRes.rows[0]!.id;

    const costRes = await pool.query<{ id: string; amount: string }>(
      `INSERT INTO cost_records (organization_id, project_id, usage_event_id, model_price_id, provider, model, cost_category, is_simulated, currency, amount, period_start, period_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW()) RETURNING id, amount`,
      [
        orgId,
        projectId,
        usageEventId,
        priceId,
        'ollama',
        'llama3.2',
        'gateway_estimated',
        true,
        'USD',
        '0.00020000',
      ],
    );
    const costRecordId = costRes.rows[0]!.id;

    // Remoção lógica (soft delete) do usuário e revogação da chave virtual
    await pool.query(
      `UPDATE users SET is_active = FALSE, deleted_at = NOW() WHERE id = $1`,
      [userId],
    );
    await pool.query(
      `UPDATE memberships SET deleted_at = NOW() WHERE organization_id = $1 AND user_id = $2`,
      [orgId, userId],
    );
    await pool.query(`UPDATE virtual_keys SET revoked_at = NOW() WHERE id = $1`, [vkeyId]);

    // Verificar que os eventos financeiros continuam intactos
    const checkUsage = await pool.query<{ id: string }>(
      `SELECT id FROM usage_events WHERE id = $1 AND organization_id = $2`,
      [usageEventId, orgId],
    );
    const checkCost = await pool.query<{ id: string; amount: string }>(
      `SELECT id, amount FROM cost_records WHERE id = $1 AND organization_id = $2`,
      [costRecordId, orgId],
    );

    expect(checkUsage.rowCount).toBe(1);
    expect(checkCost.rowCount).toBe(1);
    expect(checkCost.rows[0]!.amount).toBe('0.00020000');

    // E verificar que tentativa de DELETE físico da chave virtual ou usuário é bloqueada por ON DELETE RESTRICT
    await expect(pool.query(`DELETE FROM virtual_keys WHERE id = $1`, [vkeyId])).rejects.toThrow();
    await expect(pool.query(`DELETE FROM users WHERE id = $1`, [userId])).rejects.toThrow();
  });
});
