import {
  defaultConnectorRegistry,
  type CollectBatchParams,
  type DataConnector,
} from '@ia-governanca/connectors';
import type {
  ConnectorCheckpoint,
  ConnectorError,
  DatasetType,
  NormalizedCostRecord,
  NormalizedLicenseAssignment,
  SyncRunSummary,
  SyncStatus,
} from '@ia-governanca/contracts';
import type pg from 'pg';
import { MetricsRegistry } from '@ia-governanca/observability';
import { withRetry, withTimeout } from './resilience.js';
import { sanitizeError } from './sanitizer.js';

export const workerMetrics = new MetricsRegistry();

export interface InterruptedSyncRun {
  id: string;
  organizationId: string;
  providerConnectionId: string | null;
  dataset: DatasetType;
  periodStart: Date | null;
  periodEnd: Date | null;
  checkpoint: ConnectorCheckpoint | null;
  startedAt: Date;
}

export async function recoverInterruptedSyncRuns(
  pool: pg.Pool,
  staleAfterMs = 5 * 60_000,
  organizationId?: string,
): Promise<InterruptedSyncRun[]> {
  if (!Number.isInteger(staleAfterMs) || staleAfterMs < 1_000) {
    throw new Error('staleAfterMs must be an integer of at least 1000ms');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<{
      id: string;
      organization_id: string;
      provider_connection_id: string | null;
      provider: string | null;
      dataset: DatasetType;
      period_start: Date | null;
      period_end: Date | null;
      checkpoint: ConnectorCheckpoint | null;
      started_at: Date;
    }>(
      `WITH stale AS (
        SELECT sr.id, sr.organization_id, pc.provider
        FROM sync_runs sr
        LEFT JOIN provider_connections pc
          ON pc.id = sr.provider_connection_id AND pc.organization_id = sr.organization_id
        WHERE sr.status = 'running'
          AND sr.started_at < NOW() - ($1::bigint * INTERVAL '1 millisecond')
          AND ($2::uuid IS NULL OR sr.organization_id = $2)
        ORDER BY sr.started_at
        LIMIT 100
        FOR UPDATE OF sr SKIP LOCKED
       )
       UPDATE sync_runs sr
       SET status = 'failed',
           records_failed = sr.records_failed + 1,
           error_details = sr.error_details || jsonb_build_array(
             jsonb_build_object('code', 'WORKER_INTERRUPTED', 'message', 'Worker interrompido; checkpoint preservado')
           ),
           finished_at = NOW()
       FROM stale
       WHERE sr.id = stale.id AND sr.organization_id = stale.organization_id
       RETURNING sr.id, sr.organization_id, sr.provider_connection_id, sr.dataset,
                 stale.provider, sr.period_start, sr.period_end, sr.checkpoint, sr.started_at`,
      [staleAfterMs, organizationId ?? null],
    );
    await client.query('COMMIT');

    for (const row of result.rows) {
      workerMetrics.increment('worker_sync_runs_recovered_total', {
        provider: row.provider ?? 'unknown',
        dataset: row.dataset,
      });
      process.stdout.write(
        `${JSON.stringify({
          request_id: row.id,
          organization_id: row.organization_id,
          project_id: null,
          provider: row.provider,
          status: 'failed',
          duration_ms: Date.now() - row.started_at.getTime(),
          error_code: 'WORKER_INTERRUPTED',
        })}\n`,
      );
    }

    return result.rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      providerConnectionId: row.provider_connection_id,
      dataset: row.dataset,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      checkpoint: row.checkpoint,
      startedAt: row.started_at,
    }));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export interface ExecuteSyncOptions {
  organizationId: string;
  providerConnectionId?: string | null;
  provider: string;
  dataset: DatasetType;
  periodStart?: Date;
  periodEnd?: Date;
  dryRun?: boolean;
  checkpoint?: ConnectorCheckpoint | null;
  batchSize?: number;
  timeoutMs?: number;
  connector?: DataConnector<unknown, unknown>;
  connectorConfig?: unknown;
  defaultContractId?: string;
}

export async function executeSync(
  pool: pg.Pool,
  options: ExecuteSyncOptions,
): Promise<SyncRunSummary> {
  const isDryRun = options.dryRun ?? false;
  const timeoutMs = options.timeoutMs ?? 30000;
  const initialStatus: SyncStatus = isDryRun ? 'dry_run' : 'running';
  const operationStartedAt = Date.now();
  workerMetrics.increment('worker_sync_started_total', {
    provider: options.provider,
    dataset: options.dataset,
  });

  // 1. Criar registro inicial na tabela sync_runs
  const syncRunRes = await pool.query<{ id: string; started_at: Date }>(
    `INSERT INTO sync_runs (
       organization_id, provider_connection_id, dataset, status,
       period_start, period_end, checkpoint, started_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
     RETURNING id, started_at`,
    [
      options.organizationId,
      options.providerConnectionId ?? null,
      options.dataset,
      initialStatus,
      options.periodStart ?? null,
      options.periodEnd ?? null,
      options.checkpoint ? JSON.stringify(options.checkpoint) : null,
    ],
  );

  const syncRunId = syncRunRes.rows[0]!.id;
  const startedAt = syncRunRes.rows[0]!.started_at;
  const recordMetrics = (status: SyncStatus, processed: number, created: number, errorCode?: string) => {
    const durationMs = Date.now() - operationStartedAt;
    const labels = { provider: options.provider, dataset: options.dataset, status };
    workerMetrics.increment('worker_sync_runs_total', labels);
    workerMetrics.increment('worker_records_ingested_total', {
      provider: options.provider,
      dataset: options.dataset,
    }, created);
    workerMetrics.observe('worker_sync_duration_ms', labels, durationMs, [10, 50, 100, 500, 1000, 5000, 30000, 60000]);
    process.stdout.write(
      `${JSON.stringify({
        request_id: syncRunId,
        organization_id: options.organizationId,
        project_id: null,
        provider: options.provider,
        status,
        duration_ms: durationMs,
        error_code: errorCode ?? null,
        records_processed: processed,
      })}\n`,
    );
  };

  const errorDetails: ConnectorError[] = [];
  let recordsProcessed = 0;
  let recordsCreated = 0;
  let recordsUpdated = 0;
  let recordsFailed = 0;
  let currentCheckpoint: ConnectorCheckpoint | null = options.checkpoint ?? null;

  // 2. Resolver conector
  const connector =
    options.connector ?? defaultConnectorRegistry.get(options.provider);

  if (!connector) {
    const error: ConnectorError = {
      code: 'CONNECTOR_NOT_FOUND',
      message: `Conector para o provedor '${options.provider}' não está registrado`,
      isFatal: true,
    };
    errorDetails.push(error);

    await pool.query(
      `UPDATE sync_runs
       SET status = 'failed',
           records_failed = 1,
           error_details = $1::jsonb,
           finished_at = NOW()
       WHERE id = $2 AND organization_id = $3`,
      [JSON.stringify([sanitizeError(error)]), syncRunId, options.organizationId],
    );

    recordMetrics('failed', 0, 0, error.code);
    return {
      syncRunId,
      organizationId: options.organizationId,
      providerConnectionId: options.providerConnectionId ?? null,
      dataset: options.dataset,
      status: 'failed',
      periodStart: options.periodStart ?? null,
      periodEnd: options.periodEnd ?? null,
      recordsProcessed: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsFailed: 1,
      checkpoint: null,
      errorDetails,
      startedAt,
      finishedAt: new Date(),
    };
  }

  // 3. Validar conexão da fonte
  try {
    const validation = await withTimeout(
      connector.validateConnection(options.connectorConfig),
      timeoutMs,
      `Validação de conexão do conector ${options.provider}`,
    );

    if (!validation.valid) {
      const error: ConnectorError = {
        code: 'CONNECTION_INVALID',
        message: validation.message ?? 'Falha na validação de conexão do conector',
        details: validation.details,
        isFatal: true,
      };
      errorDetails.push(error);

      await pool.query(
        `UPDATE sync_runs
         SET status = 'failed',
             records_failed = 1,
             error_details = $1::jsonb,
             finished_at = NOW()
         WHERE id = $2 AND organization_id = $3`,
        [JSON.stringify([sanitizeError(error)]), syncRunId, options.organizationId],
      );

      recordMetrics('failed', 0, 0, error.code);
      return {
        syncRunId,
        organizationId: options.organizationId,
        providerConnectionId: options.providerConnectionId ?? null,
        dataset: options.dataset,
        status: 'failed',
        periodStart: options.periodStart ?? null,
        periodEnd: options.periodEnd ?? null,
        recordsProcessed: 0,
        recordsCreated: 0,
        recordsUpdated: 0,
        recordsFailed: 1,
        checkpoint: null,
        errorDetails,
        startedAt,
        finishedAt: new Date(),
      };
    }
  } catch (err) {
    const sanitized = sanitizeError(err);
    const error: ConnectorError = {
      code: 'CONNECTION_ERROR',
      message: (sanitized.message as string) || 'Erro ao validar conexão do conector',
      isFatal: true,
      details: sanitized,
    };
    errorDetails.push(error);

    await pool.query(
      `UPDATE sync_runs
       SET status = 'failed',
           records_failed = 1,
           error_details = $1::jsonb,
           finished_at = NOW()
       WHERE id = $2 AND organization_id = $3`,
      [JSON.stringify([sanitized]), syncRunId, options.organizationId],
    );

    recordMetrics('failed', 0, 0, 'CONNECTION_ERROR');
    return {
      syncRunId,
      organizationId: options.organizationId,
      providerConnectionId: options.providerConnectionId ?? null,
      dataset: options.dataset,
      status: 'failed',
      periodStart: options.periodStart ?? null,
      periodEnd: options.periodEnd ?? null,
      recordsProcessed: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsFailed: 1,
      checkpoint: null,
      errorDetails,
      startedAt,
      finishedAt: new Date(),
    };
  }

  // 4. Paginação e coleta em lote
  let hasMore = true;
  let fatalEncountered = false;

  while (hasMore) {
    try {
      const batchParams: CollectBatchParams = {
        dataset: options.dataset,
        periodStart: options.periodStart,
        periodEnd: options.periodEnd,
        checkpoint: currentCheckpoint,
        limit: options.batchSize ?? 100,
        config: options.connectorConfig,
      };

      const batchResult = await withRetry(
        () =>
          withTimeout(
            connector.collectBatch(batchParams),
            timeoutMs,
            `Coleta de lote do conector ${options.provider}`,
          ),
        { maxRetries: 3, initialDelayMs: 150 },
      );

      // Tratar erros do lote
      if (batchResult.errors.length > 0) {
        for (const err of batchResult.errors) {
          errorDetails.push(err);
          recordsFailed++;
          if (err.isFatal) {
            fatalEncountered = true;
          }
        }
      }

      if (fatalEncountered) {
        break;
      }

      // Processar registros válidos
      const rawRecords = batchResult.records as Array<
        NormalizedCostRecord | NormalizedLicenseAssignment
      >;

      if (isDryRun) {
        // Modo Dry Run: nenhuma alteração no banco de dados
        for (const _rec of rawRecords) {
          recordsProcessed++;
          recordsCreated++;
        }
      } else if (rawRecords.length > 0) {
        // Modo Persistente: transação atômica por lote
        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          for (const item of rawRecords) {
            recordsProcessed++;

            if (options.dataset === 'api_costs') {
              const cost = item as NormalizedCostRecord;

              // Upsert em source_records
              const srcRes = await client.query<{ id: string; is_created: boolean }>(
                `INSERT INTO source_records (
                   organization_id, sync_run_id, provider_connection_id,
                   provider, dataset, external_id, period_start, period_end,
                   raw_payload, provenance
                 )
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)
                 ON CONFLICT (organization_id, provider, dataset, external_id)
                 DO UPDATE SET
                   sync_run_id = EXCLUDED.sync_run_id,
                   period_start = EXCLUDED.period_start,
                   period_end = EXCLUDED.period_end,
                   raw_payload = EXCLUDED.raw_payload,
                   provenance = EXCLUDED.provenance,
                   ingested_at = NOW()
                 RETURNING id, (xmax = 0) AS is_created`,
                [
                  options.organizationId,
                  syncRunId,
                  options.providerConnectionId ?? null,
                  cost.provider,
                  'api_costs',
                  cost.externalId,
                  cost.periodStart,
                  cost.periodEnd,
                  JSON.stringify(cost.rawPayload ?? {}),
                  JSON.stringify(cost.provenance ?? {}),
                ],
              );

              const srcRecord = srcRes.rows[0]!;
              const isCreated = srcRecord.is_created;

              if (isCreated) {
                recordsCreated++;
                await client.query(
                  `INSERT INTO cost_records (
                     organization_id, project_id, source_record_id,
                     provider, model, team_id, cost_category, is_simulated,
                     currency, amount, period_start, period_end
                   )
                   VALUES ($1, $2, $3, $4, $5,
                     (SELECT team_id FROM projects WHERE id = $2 AND organization_id = $1),
                     'provider_reported', FALSE, $6, $7, $8, $9)`,
                  [
                    options.organizationId,
                    cost.projectId ?? null,
                    srcRecord.id,
                    cost.provider,
                    cost.model ?? null,
                    cost.currency,
                    cost.amount,
                    cost.periodStart,
                    cost.periodEnd,
                  ],
                );
              } else {
                recordsUpdated++;
                const updateRes = await client.query(
                  `UPDATE cost_records
                   SET project_id = COALESCE($2, cost_records.project_id),
                       team_id = (SELECT team_id FROM projects
                                  WHERE id = COALESCE($2, cost_records.project_id)
                                    AND organization_id = $1),
                       provider = $3,
                       model = COALESCE($4, cost_records.model),
                       currency = $5,
                       amount = $6,
                       period_start = $7,
                       period_end = $8
                   WHERE organization_id = $1 AND source_record_id = $9`,
                  [
                    options.organizationId,
                    cost.projectId ?? null,
                    cost.provider,
                    cost.model ?? null,
                    cost.currency,
                    cost.amount,
                    cost.periodStart,
                    cost.periodEnd,
                    srcRecord.id,
                  ],
                );

                if (updateRes.rowCount === 0) {
                  await client.query(
                    `INSERT INTO cost_records (
                       organization_id, project_id, source_record_id,
                       provider, model, team_id, cost_category, is_simulated,
                       currency, amount, period_start, period_end
                     )
                     VALUES ($1, $2, $3, $4, $5,
                       (SELECT team_id FROM projects WHERE id = $2 AND organization_id = $1),
                       'provider_reported', FALSE, $6, $7, $8, $9)`,
                    [
                      options.organizationId,
                      cost.projectId ?? null,
                      srcRecord.id,
                      cost.provider,
                      cost.model ?? null,
                      cost.currency,
                      cost.amount,
                      cost.periodStart,
                      cost.periodEnd,
                    ],
                  );
                }
              }
            } else if (options.dataset === 'license_assignments') {
              const lic = item as NormalizedLicenseAssignment;

              // Localizar ou criar contrato caso não especificado
              let contractId = lic.contractId ?? options.defaultContractId;
              if (!contractId && lic.currency && lic.seatCost != null) {
                const contractLookup = await client.query<{ id: string }>(
                  `SELECT id FROM license_contracts
                   WHERE organization_id = $1 AND provider = $2 AND status = 'active'
                   ORDER BY created_at DESC LIMIT 1`,
                  [options.organizationId, lic.provider],
                );

                if (contractLookup.rows.length > 0) {
                  contractId = contractLookup.rows[0]!.id;
                } else {
                  const newContract = await client.query<{ id: string }>(
                    `INSERT INTO license_contracts (
                       organization_id, provider, product_name, contracted_seats,
                       currency, total_contract_value, cost_per_seat, starts_at, status
                     )
                     VALUES ($1, $2, $3, 100, $4, 0, 0, NOW(), 'active')
                     RETURNING id`,
                    [
                      options.organizationId,
                      lic.provider,
                      `${lic.provider} Contract (Auto-Imported)`,
                      lic.currency,
                    ],
                  );
                  contractId = newContract.rows[0]!.id;
                }
              }

              // Localizar ou registrar identidade externa
              let externalIdentityId: string | null = null;
              const extUserId = lic.userExternalId || lic.externalId;
              let matchedUserId: string | null = null;
              if (lic.userEmail) {
                const exactMatch = await client.query<{ id: string }>(
                  `SELECT u.id
                   FROM users u
                   JOIN memberships m ON m.user_id = u.id
                   WHERE m.organization_id = $1 AND m.deleted_at IS NULL
                     AND u.is_active AND u.deleted_at IS NULL
                     AND lower(u.email) = lower($2)
                   LIMIT 2`,
                  [options.organizationId, lic.userEmail],
                );
                if (exactMatch.rows.length === 1) matchedUserId = exactMatch.rows[0]!.id;
              }

              const extIdRes = await client.query<{ id: string; user_id: string | null }>(
                `INSERT INTO external_identities (
                   organization_id, provider, external_user_id, external_email,
                   display_name, user_id, match_status
                 )
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (organization_id, provider, external_user_id)
                 DO UPDATE SET
                   external_email = COALESCE(EXCLUDED.external_email, external_identities.external_email),
                   display_name = COALESCE(EXCLUDED.display_name, external_identities.display_name),
                   user_id = COALESCE(external_identities.user_id, EXCLUDED.user_id),
                   match_status = CASE
                     WHEN external_identities.user_id IS NOT NULL THEN external_identities.match_status
                     ELSE EXCLUDED.match_status
                   END,
                   updated_at = NOW()
                 RETURNING id, user_id`,
                [
                  options.organizationId,
                  lic.provider,
                  extUserId,
                  lic.userEmail ?? null,
                  lic.displayName ?? null,
                  matchedUserId,
                  matchedUserId ? 'matched' : 'pending_review',
                ],
              );
              externalIdentityId = extIdRes.rows[0]!.id;
              matchedUserId = extIdRes.rows[0]!.user_id;

              // Upsert em source_records
              const srcRes = await client.query<{ id: string; is_created: boolean }>(
                `INSERT INTO source_records (
                   organization_id, sync_run_id, provider_connection_id,
                   provider, dataset, external_id, period_start, period_end,
                   raw_payload, provenance
                 )
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)
                 ON CONFLICT (organization_id, provider, dataset, external_id)
                 DO UPDATE SET
                   sync_run_id = EXCLUDED.sync_run_id,
                   period_start = EXCLUDED.period_start,
                   period_end = EXCLUDED.period_end,
                   raw_payload = EXCLUDED.raw_payload,
                   provenance = EXCLUDED.provenance,
                   ingested_at = NOW()
                 RETURNING id, (xmax = 0) AS is_created`,
                [
                  options.organizationId,
                  syncRunId,
                  options.providerConnectionId ?? null,
                  lic.provider,
                  'license_assignments',
                  lic.externalId,
                  lic.assignedAt,
                  null,
                  JSON.stringify(lic.rawPayload ?? {}),
                  JSON.stringify(lic.provenance ?? {}),
                ],
              );

              const srcRecord = srcRes.rows[0]!;
              const isCreated = srcRecord.is_created;

              if (isCreated) {
                recordsCreated++;
                await client.query(
                  `INSERT INTO license_assignments (
                     organization_id, contract_id, user_id, external_identity_id,
                     source_record_id, status, currency, seat_cost,
                     assigned_at, revoked_at, last_activity_at
                   )
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                  [
                    options.organizationId,
                    contractId ?? null,
                    matchedUserId,
                    externalIdentityId,
                    srcRecord.id,
                    lic.status,
                    lic.currency,
                    lic.seatCost,
                    lic.assignedAt,
                    lic.revokedAt ?? null,
                    lic.lastActivityAt ?? null,
                  ],
                );
              } else {
                recordsUpdated++;
                const updateRes = await client.query(
                  `UPDATE license_assignments
                   SET contract_id = $2,
                       user_id = COALESCE(user_id, $3),
                       external_identity_id = $4,
                       status = $5,
                       currency = $6,
                       seat_cost = $7,
                       assigned_at = $8,
                       revoked_at = $9,
                       last_activity_at = $10,
                       updated_at = NOW()
                   WHERE organization_id = $1 AND source_record_id = $11`,
                  [
                    options.organizationId,
                    contractId ?? null,
                    matchedUserId,
                    externalIdentityId,
                    lic.status,
                    lic.currency,
                    lic.seatCost,
                    lic.assignedAt,
                    lic.revokedAt ?? null,
                    lic.lastActivityAt ?? null,
                    srcRecord.id,
                  ],
                );

                if (updateRes.rowCount === 0) {
                  await client.query(
                    `INSERT INTO license_assignments (
                       organization_id, contract_id, user_id, external_identity_id,
                       source_record_id, status, currency, seat_cost,
                       assigned_at, revoked_at, last_activity_at
                     )
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                    [
                      options.organizationId,
                      contractId ?? null,
                      matchedUserId,
                      externalIdentityId,
                      srcRecord.id,
                      lic.status,
                      lic.currency,
                      lic.seatCost,
                      lic.assignedAt,
                      lic.revokedAt ?? null,
                      lic.lastActivityAt ?? null,
                    ],
                  );
                }
              }

              const assignment = await client.query<{
                id: string;
                provider: string;
                currency: string | null;
                seat_cost: string | null;
                assigned_at: Date;
                revoked_at: Date | null;
              }>(
                `SELECT la.id, COALESCE(lc.provider, $3) AS provider,
                        la.currency, la.seat_cost::text,
                        la.assigned_at, la.revoked_at
                 FROM license_assignments la
                 LEFT JOIN license_contracts lc
                   ON lc.id = la.contract_id AND lc.organization_id = la.organization_id
                 WHERE la.organization_id = $1 AND la.source_record_id = $2`,
                [options.organizationId, srcRecord.id, lic.provider],
              );
              const assignedSeat = assignment.rows[0];
              if (!assignedSeat) {
                throw new Error('Atribuição de licença não foi persistida');
              }
              if (assignedSeat.seat_cost != null && assignedSeat.currency != null) {
                await client.query(
                `INSERT INTO cost_records (
                   organization_id, license_assignment_id, provider, model,
                   cost_category, is_simulated, currency, amount, period_start, period_end
                 )
                 VALUES ($1, $2, $3, $4, 'license_contracted', FALSE, $5, $6, $7, $8)
                 ON CONFLICT (organization_id, license_assignment_id)
                   WHERE cost_category = 'license_contracted' AND license_assignment_id IS NOT NULL
                 DO UPDATE SET provider = EXCLUDED.provider,
                               model = EXCLUDED.model,
                               currency = EXCLUDED.currency,
                               amount = EXCLUDED.amount,
                               period_start = EXCLUDED.period_start,
                               period_end = EXCLUDED.period_end`,
                [
                  options.organizationId,
                  assignedSeat.id,
                  assignedSeat.provider,
                  lic.externalPlanId ?? null,
                  assignedSeat.currency,
                  assignedSeat.seat_cost,
                  assignedSeat.assigned_at,
                  assignedSeat.revoked_at && assignedSeat.revoked_at > assignedSeat.assigned_at
                    ? assignedSeat.revoked_at
                    : assignedSeat.assigned_at,
                ],
                );
              }
            }
          }

          // Atualizar checkpoint e contadores parciais
          await client.query(
            `UPDATE sync_runs
             SET checkpoint = $1::jsonb,
                 records_processed = $2,
                 records_created = $3,
                 records_updated = $4,
                 records_failed = $5
             WHERE id = $6 AND organization_id = $7`,
            [
              batchResult.nextCheckpoint ? JSON.stringify(batchResult.nextCheckpoint) : null,
              recordsProcessed,
              recordsCreated,
              recordsUpdated,
              recordsFailed,
              syncRunId,
              options.organizationId,
            ],
          );

          await client.query('COMMIT');
        } catch (txError) {
          await client.query('ROLLBACK');
          throw txError;
        } finally {
          client.release();
        }
      }

      currentCheckpoint = batchResult.nextCheckpoint;
      hasMore = batchResult.hasMore;
    } catch (err) {
      const sanitized = sanitizeError(err);
      errorDetails.push({
        code: 'BATCH_PROCESSING_FAILED',
        message: (sanitized.message as string) || 'Erro durante processamento de lote',
        isFatal: true,
        details: sanitized,
      });
      recordsFailed++;
      break;
    }
  }

  // 5. Determinar status final
  let finalStatus: SyncStatus;
  if (isDryRun) {
    finalStatus = 'dry_run';
  } else if (errorDetails.length > 0 && recordsProcessed > 0) {
    finalStatus = 'partial';
  } else if (errorDetails.length > 0 && recordsProcessed === 0) {
    finalStatus = 'failed';
  } else {
    finalStatus = 'completed';
  }

  // Sanitizar lista de erros antes de salvar no banco
  const cleanErrors = errorDetails.map((e) => sanitizeError(e));

  await pool.query(
    `UPDATE sync_runs
     SET status = $1,
         records_processed = $2,
         records_created = $3,
         records_updated = $4,
         records_failed = $5,
         checkpoint = $6::jsonb,
         error_details = $7::jsonb,
         finished_at = NOW()
     WHERE id = $8 AND organization_id = $9`,
    [
      finalStatus,
      recordsProcessed,
      recordsCreated,
      recordsUpdated,
      recordsFailed,
      currentCheckpoint ? JSON.stringify(currentCheckpoint) : null,
      JSON.stringify(cleanErrors),
      syncRunId,
      options.organizationId,
    ],
  );

  if (options.providerConnectionId && !isDryRun) {
    await pool.query(
      `UPDATE provider_connections
       SET last_synced_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND organization_id = $2`,
      [options.providerConnectionId, options.organizationId],
    );
  }

  recordMetrics(finalStatus, recordsProcessed, recordsCreated, errorDetails[0]?.code);
  return {
    syncRunId,
    organizationId: options.organizationId,
    providerConnectionId: options.providerConnectionId ?? null,
    dataset: options.dataset,
    status: finalStatus,
    periodStart: options.periodStart ?? null,
    periodEnd: options.periodEnd ?? null,
    recordsProcessed,
    recordsCreated,
    recordsUpdated,
    recordsFailed,
    checkpoint: currentCheckpoint,
    errorDetails,
    startedAt,
    finishedAt: new Date(),
  };
}
