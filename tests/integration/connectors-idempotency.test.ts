import {
  applyMigrations,
  closePool,
  getPool,
} from '@ia-governanca/database';
import { resetTestDatabase } from '../helpers/reset-test-database.js';
import { executeSync } from '@ia-governanca/worker';
import type { DataConnector } from '@ia-governanca/connectors';
import type { ConnectorBatchResult, DatasetType, NormalizedCostRecord } from '@ia-governanca/contracts';
import { generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApiServer } from '../../apps/api/src/index.js';

describe('Épico 04 — Framework de Conectores, Ingestão CSV, Idempotência e Retomada', () => {
  const pool = getPool();
  const ISSUER = 'http://localhost:8080/realms/ai-spend';
  const AUDIENCE = 'ia-governanca-web';

  let privateKey: CryptoKey;
  let publicKey: CryptoKey;

  const validApiCostsCsv = fs.readFileSync(
    path.resolve(process.cwd(), 'fixtures/csv/api-costs-valid.csv'),
    'utf8',
  );
  const invalidApiCostsCsv = fs.readFileSync(
    path.resolve(process.cwd(), 'fixtures/csv/api-costs-invalid.csv'),
    'utf8',
  );
  const validLicensesCsv = fs.readFileSync(
    path.resolve(process.cwd(), 'fixtures/csv/licenses-valid.csv'),
    'utf8',
  );
  const invalidLicensesCsv = fs.readFileSync(
    path.resolve(process.cwd(), 'fixtures/csv/licenses-invalid.csv'),
    'utf8',
  );

  async function issueToken(params: {
    sub: string;
    email: string;
    name: string;
  }): Promise<string> {
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

  it('Cenário 1: deve importar CSV de custos e garantir estrita idempotência na reexecução', async () => {
    // 1. Criar organização de teste
    const orgRes = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ('FinOps Org', 'finops-org') RETURNING id`,
    );
    const orgId = orgRes.rows[0]!.id;

    // 2. Primeira execução do CSV de custos
    const firstRun = await executeSync(pool, {
      organizationId: orgId,
      provider: 'csv',
      dataset: 'api_costs',
      connectorConfig: {
        csvContent: validApiCostsCsv,
      },
    });

    expect(firstRun.status).toBe('completed');
    expect(firstRun.recordsProcessed).toBe(5);
    expect(firstRun.recordsCreated).toBe(5);
    expect(firstRun.recordsUpdated).toBe(0);
    expect(firstRun.recordsFailed).toBe(0);

    // Validar estado no banco após a 1ª execução
    const srcCountRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM source_records WHERE organization_id = $1`,
      [orgId],
    );
    expect(Number(srcCountRes.rows[0]!.count)).toBe(5);

    const costCountRes = await pool.query<{ count: string; total: string }>(
      `SELECT COUNT(*), SUM(amount) AS total FROM cost_records WHERE organization_id = $1`,
      [orgId],
    );
    expect(Number(costCountRes.rows[0]!.count)).toBe(5);
    const initialTotal = parseFloat(costCountRes.rows[0]!.total);
    expect(initialTotal).toBeGreaterThan(0);

    // 3. Segunda execução com exatamente os mesmos dados (reimportação / retry)
    const secondRun = await executeSync(pool, {
      organizationId: orgId,
      provider: 'csv',
      dataset: 'api_costs',
      connectorConfig: {
        csvContent: validApiCostsCsv,
      },
    });

    expect(secondRun.status).toBe('completed');
    expect(secondRun.recordsProcessed).toBe(5);
    expect(secondRun.recordsCreated).toBe(0); // Nenhum novo registro criado
    expect(secondRun.recordsUpdated).toBe(5); // Todos os 5 atualizados idempotentemente
    expect(secondRun.recordsFailed).toBe(0);

    // Validar que o banco não duplicou nenhum registro
    const srcAfterRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM source_records WHERE organization_id = $1`,
      [orgId],
    );
    expect(Number(srcAfterRes.rows[0]!.count)).toBe(5);

    const costAfterRes = await pool.query<{ count: string; total: string }>(
      `SELECT COUNT(*), SUM(amount) AS total FROM cost_records WHERE organization_id = $1`,
      [orgId],
    );
    expect(Number(costAfterRes.rows[0]!.count)).toBe(5);
    expect(parseFloat(costAfterRes.rows[0]!.total)).toBe(initialTotal);
  });

  it('Cenário 2: deve importar CSV de licenças com idempotência e mapeamento de identidades externas', async () => {
    const orgRes = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ('Licensing Org', 'licensing-org') RETURNING id`,
    );
    const orgId = orgRes.rows[0]!.id;

    const matchedUser = await pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name)
       VALUES ('ana.silva@empresa.com.br', 'Ana Silva')
       RETURNING id`,
    );
    await pool.query(
      `INSERT INTO memberships (organization_id, user_id, role)
       VALUES ($1, $2, 'viewer')`,
      [orgId, matchedUser.rows[0]!.id],
    );

    // 1ª importação de licenças
    const run1 = await executeSync(pool, {
      organizationId: orgId,
      provider: 'csv',
      dataset: 'license_assignments',
      connectorConfig: {
        csvContent: validLicensesCsv,
      },
    });

    expect(run1.status).toBe('completed');
    expect(run1.recordsProcessed).toBe(5);
    expect(run1.recordsCreated).toBe(5);
    expect(run1.recordsUpdated).toBe(0);

    const licCountRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM license_assignments WHERE organization_id = $1`,
      [orgId],
    );
    expect(Number(licCountRes.rows[0]!.count)).toBe(5);

    const extIdRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM external_identities WHERE organization_id = $1`,
      [orgId],
    );
    expect(Number(extIdRes.rows[0]!.count)).toBe(5);
    const pendingIdentityCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM external_identities
       WHERE organization_id = $1 AND match_status = 'pending_review'`,
      [orgId],
    );
    expect(Number(pendingIdentityCount.rows[0]!.count)).toBe(4);
    const exactMatch = await pool.query<{ user_id: string; match_status: string }>(
      `SELECT ei.user_id, ei.match_status
       FROM external_identities ei
       WHERE ei.organization_id = $1 AND ei.external_email = 'ana.silva@empresa.com.br'`,
      [orgId],
    );
    expect(exactMatch.rows[0]).toEqual({
      user_id: matchedUser.rows[0]!.id,
      match_status: 'matched',
    });

    // 2ª importação de licenças
    const run2 = await executeSync(pool, {
      organizationId: orgId,
      provider: 'csv',
      dataset: 'license_assignments',
      connectorConfig: {
        csvContent: validLicensesCsv,
      },
    });

    expect(run2.status).toBe('completed');
    expect(run2.recordsProcessed).toBe(5);
    expect(run2.recordsCreated).toBe(0);
    expect(run2.recordsUpdated).toBe(5);

    const licAfterRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM license_assignments WHERE organization_id = $1`,
      [orgId],
    );
    expect(Number(licAfterRes.rows[0]!.count)).toBe(5);

    const licenseCostCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM cost_records
       WHERE organization_id = $1 AND cost_category = 'license_contracted'`,
      [orgId],
    );
    expect(Number(licenseCostCount.rows[0]!.count)).toBe(5);
  });

  it('Cenário 3: validação de modo dryRun não deve gravar nada no PostgreSQL', async () => {
    const orgRes = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ('DryRun Org', 'dryrun-org') RETURNING id`,
    );
    const orgId = orgRes.rows[0]!.id;

    const dryRunResult = await executeSync(pool, {
      organizationId: orgId,
      provider: 'csv',
      dataset: 'api_costs',
      dryRun: true,
      connectorConfig: {
        csvContent: validApiCostsCsv,
      },
    });

    expect(dryRunResult.status).toBe('dry_run');
    expect(dryRunResult.recordsProcessed).toBe(5);

    // Nenhuma linha deve existir em source_records ou cost_records
    const srcCheck = await pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM source_records WHERE organization_id = $1`,
      [orgId],
    );
    expect(Number(srcCheck.rows[0]!.count)).toBe(0);

    const costCheck = await pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM cost_records WHERE organization_id = $1`,
      [orgId],
    );
    expect(Number(costCheck.rows[0]!.count)).toBe(0);

    // O sync_run deve estar registrado com status dry_run
    const syncRunCheck = await pool.query<{ status: string }>(
      `SELECT status FROM sync_runs WHERE id = $1`,
      [dryRunResult.syncRunId],
    );
    expect(syncRunCheck.rows[0]!.status).toBe('dry_run');
  });

  it('Cenário 4: CSVs inválidos devem retornar erros estruturados indicando linha e motivo', async () => {
    const orgRes = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ('Invalid CSV Org', 'invalid-csv-org') RETURNING id`,
    );
    const orgId = orgRes.rows[0]!.id;

    // Testar CSV de custos inválido
    const costResult = await executeSync(pool, {
      organizationId: orgId,
      provider: 'csv',
      dataset: 'api_costs',
      connectorConfig: {
        csvContent: invalidApiCostsCsv,
      },
    });

    expect(costResult.recordsFailed).toBeGreaterThan(0);
    expect(costResult.errorDetails.length).toBeGreaterThan(0);
    expect(costResult.errorDetails.some((e) => e.line === 2)).toBe(true);
    expect(costResult.errorDetails.some((e) => e.line === 3)).toBe(true);

    // Testar CSV de licenças inválido
    const licResult = await executeSync(pool, {
      organizationId: orgId,
      provider: 'csv',
      dataset: 'license_assignments',
      connectorConfig: {
        csvContent: invalidLicensesCsv,
      },
    });

    expect(licResult.recordsFailed).toBeGreaterThan(0);
    expect(licResult.errorDetails.some((e) => e.line === 2)).toBe(true);
  });

  it('Cenário 5: simulação de falha parcial e retomada com sucesso via Checkpoint', async () => {
    const orgRes = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ('Resumption Org', 'resumption-org') RETURNING id`,
    );
    const orgId = orgRes.rows[0]!.id;

    // Conector Mock que falha propositalmente no 2º lote
    const mockRecords: NormalizedCostRecord[] = [
      {
        externalId: 'mock-cost-01',
        provider: 'mock-llm',
        model: 'model-a',
        periodStart: new Date('2026-10-01'),
        periodEnd: new Date('2026-10-02'),
        currency: 'USD',
        amount: 10.0,
        provenance: {},
        rawPayload: {},
      },
      {
        externalId: 'mock-cost-02',
        provider: 'mock-llm',
        model: 'model-a',
        periodStart: new Date('2026-10-02'),
        periodEnd: new Date('2026-10-03'),
        currency: 'USD',
        amount: 15.0,
        provenance: {},
        rawPayload: {},
      },
      {
        externalId: 'mock-cost-03',
        provider: 'mock-llm',
        model: 'model-a',
        periodStart: new Date('2026-10-03'),
        periodEnd: new Date('2026-10-04'),
        currency: 'USD',
        amount: 20.0,
        provenance: {},
        rawPayload: {},
      },
    ];

    let failOnBatch2 = true;

    const mockConnector: DataConnector<NormalizedCostRecord> = {
      provider: 'mock-llm',
      version: '1.0.0',
      supportedDatasets: ['api_costs'],
      async validateConnection() {
        return { valid: true };
      },
      async collectBatch(params): Promise<ConnectorBatchResult<NormalizedCostRecord>> {
        const offset = params.checkpoint?.offset ?? 0;
        if (offset === 0) {
          // Lote 1: retorna 1 registro e checkpoint offset 1
          return {
            records: [mockRecords[0]!],
            warnings: [],
            errors: [],
            hasMore: true,
            nextCheckpoint: { offset: 1 },
          };
        } else if (offset === 1) {
          if (failOnBatch2) {
            // Simular erro transitório no 2º lote
            return {
              records: [],
              warnings: [],
              errors: [
                {
                  code: 'UPSTREAM_API_TIMEOUT',
                  message: 'Timeout ao consultar API upstream',
                  isFatal: true,
                },
              ],
              hasMore: false,
              nextCheckpoint: { offset: 1 },
            };
          } else {
            // Retomada: retorna os outros 2 registros
            return {
              records: [mockRecords[1]!, mockRecords[2]!],
              warnings: [],
              errors: [],
              hasMore: false,
              nextCheckpoint: null,
            };
          }
        }

        return {
          records: [],
          warnings: [],
          errors: [],
          hasMore: false,
          nextCheckpoint: null,
        };
      },
    };

    // 1ª execução com falha no lote 2
    const failRun = await executeSync(pool, {
      organizationId: orgId,
      provider: 'mock-llm',
      dataset: 'api_costs',
      connector: mockConnector,
    });

    expect(failRun.status).toBe('partial');
    expect(failRun.recordsCreated).toBe(1);
    expect(failRun.checkpoint).toEqual({ offset: 1 });

    // 2ª execução: Retomada a partir do checkpoint salvo
    failOnBatch2 = false; // API externa voltou ao normal

    const resumeRun = await executeSync(pool, {
      organizationId: orgId,
      provider: 'mock-llm',
      dataset: 'api_costs',
      connector: mockConnector,
      checkpoint: failRun.checkpoint, // Passa o checkpoint salvo
    });

    expect(resumeRun.status).toBe('completed');
    expect(resumeRun.recordsCreated).toBe(2);

    // Validação final: todos os 3 registros devem estar persistidos exatamente uma vez
    const totalRecords = await pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM source_records WHERE organization_id = $1 AND provider = 'mock-llm'`,
      [orgId],
    );
    expect(Number(totalRecords.rows[0]!.count)).toBe(3);
  });

  it('Cenário 6: deve validar o endpoint HTTP POST /v1/organizations/:orgId/connectors/import-csv com RBAC e auditoria', async () => {
    const app = await buildApiServer({
      pool,
      oidcOptions: {
        issuer: ISSUER,
        audience: AUDIENCE,
        customKeyOrJwks: publicKey,
      },
    });

    // 1. Criar organização e membros com diferentes papéis
    const orgRes = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ('RBAC Import Org', 'rbac-import-org') RETURNING id`,
    );
    const orgId = orgRes.rows[0]!.id;

    // FinOps user (tem permissão connectors:manage)
    const finopsUser = await pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name, oidc_subject)
       VALUES ('finops@empresa.com', 'FinOps Specialist', 'oidc-finops-1')
       RETURNING id`,
    );
    await pool.query(
      `INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'finops')`,
      [orgId, finopsUser.rows[0]!.id],
    );
    const finopsToken = await issueToken({
      sub: 'oidc-finops-1',
      email: 'finops@empresa.com',
      name: 'FinOps Specialist',
    });

    // Developer user (NÃO tem connectors:manage)
    const devUser = await pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name, oidc_subject)
       VALUES ('dev@empresa.com', 'Developer User', 'oidc-dev-1')
       RETURNING id`,
    );
    await pool.query(
      `INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'developer')`,
      [orgId, devUser.rows[0]!.id],
    );
    const devToken = await issueToken({
      sub: 'oidc-dev-1',
      email: 'dev@empresa.com',
      name: 'Developer User',
    });

    // 2. Requisição sem token -> 401 Unauthorized
    const unauthRes = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${orgId}/connectors/import-csv`,
      payload: {
        dataset: 'api_costs',
        csvContent: validApiCostsCsv,
      },
    });
    expect(unauthRes.statusCode).toBe(401);

    // 3. Requisição de desenvolvedor -> 403 Insufficient Role
    const forbiddenRes = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${orgId}/connectors/import-csv`,
      headers: { authorization: `Bearer ${devToken}` },
      payload: {
        dataset: 'api_costs',
        csvContent: validApiCostsCsv,
      },
    });
    expect(forbiddenRes.statusCode).toBe(403);
    expect(JSON.parse(forbiddenRes.body).error).toBe('insufficient_role');

    // 4. Requisição de FinOps com dryRun: true -> 200 OK
    const dryRunHttpRes = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${orgId}/connectors/import-csv`,
      headers: { authorization: `Bearer ${finopsToken}` },
      payload: {
        dataset: 'api_costs',
        csvContent: validApiCostsCsv,
        dryRun: true,
      },
    });
    expect(dryRunHttpRes.statusCode).toBe(200);
    const dryRunBody = JSON.parse(dryRunHttpRes.body);
    expect(dryRunBody.status).toBe('dry_run');
    expect(dryRunBody.recordsProcessed).toBe(5);

    // 5. Requisição de FinOps persistente -> 201 Created
    const importHttpRes = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${orgId}/connectors/import-csv`,
      headers: { authorization: `Bearer ${finopsToken}` },
      payload: {
        dataset: 'api_costs',
        csvContent: validApiCostsCsv,
        dryRun: false,
      },
    });
    expect(importHttpRes.statusCode).toBe(201);
    const importBody = JSON.parse(importHttpRes.body);
    expect(importBody.status).toBe('completed');
    expect(importBody.recordsCreated).toBe(5);

    // 6. Consultar histórico de sync_runs via endpoint HTTP (permissão connectors:read)
    const syncRunsHttpRes = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${orgId}/connectors/sync-runs`,
      headers: { authorization: `Bearer ${finopsToken}` },
    });
    expect(syncRunsHttpRes.statusCode).toBe(200);
    const runsList = JSON.parse(syncRunsHttpRes.body);
    expect(runsList.items.length).toBeGreaterThanOrEqual(2);

    // 7. Validar registro na trilha de auditoria
    const auditRes = await pool.query<{ action: string }>(
      `SELECT action FROM audit_events WHERE organization_id = $1 AND target_type = 'sync_run'`,
      [orgId],
    );
    const actions = auditRes.rows.map((r) => r.action);
    expect(actions).toContain('connector.csv_dry_run');
    expect(actions).toContain('connector.csv_imported');

    await app.close();
  });
});
