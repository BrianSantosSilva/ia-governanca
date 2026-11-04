import type pg from 'pg';

export async function reconcileReportedCost(
  pool: pg.Pool,
  params: { organizationId: string; reportedCostRecordId: string },
): Promise<{ id: string; status: 'matched' | 'divergent' | 'unreconciled'; deltaAmount: string }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const reportedResult = await client.query<CostRow>(
      `SELECT id, project_id, provider, model, currency, amount::text, period_start, period_end
       FROM cost_records
       WHERE id = $1 AND organization_id = $2
         AND cost_category IN ('provider_reported', 'unreconciled')
       FOR UPDATE`,
      [params.reportedCostRecordId, params.organizationId],
    );
    const reported = reportedResult.rows[0];
    if (!reported) throw new Error('Registro reportado não encontrado nesta organização');

    const estimatedResult = await client.query<CostRow>(
      `SELECT e.id, e.project_id, e.provider, e.model, e.currency, e.amount::text,
              e.period_start, e.period_end
       FROM cost_records e
       WHERE e.organization_id = $1
         AND e.cost_category = 'gateway_estimated'
         AND e.provider = $2
         AND e.model IS NOT DISTINCT FROM $3
         AND e.currency = $4
         AND e.project_id IS NOT DISTINCT FROM $5
         AND e.period_start <= $7 AND e.period_end >= $6
         AND NOT EXISTS (
           SELECT 1 FROM reconciliation_matches rm
           WHERE rm.organization_id = e.organization_id
             AND rm.estimated_cost_record_id = e.id
             AND rm.reported_cost_record_id IS DISTINCT FROM $8
         )
       ORDER BY ABS(EXTRACT(EPOCH FROM (e.period_start - $6))) ASC, e.created_at ASC
       LIMIT 1
       FOR UPDATE`,
      [
        params.organizationId,
        reported.provider,
        reported.model,
        reported.currency,
        reported.project_id,
        reported.period_start,
        reported.period_end,
        reported.id,
      ],
    );
    const estimated = estimatedResult.rows[0];
    const delta = estimated
      ? subtractDecimal(reported.amount, estimated.amount)
      : reported.amount;
    const status = !estimated ? 'unreconciled' : delta === '0.00000000' ? 'matched' : 'divergent';

    const result = await client.query<{ id: string; delta_amount: string }>(
      `INSERT INTO reconciliation_matches (
         organization_id, estimated_cost_record_id, reported_cost_record_id,
         status, currency, delta_amount, notes
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (organization_id, reported_cost_record_id)
         WHERE reported_cost_record_id IS NOT NULL
       DO UPDATE SET estimated_cost_record_id = EXCLUDED.estimated_cost_record_id,
                     status = EXCLUDED.status,
                     currency = EXCLUDED.currency,
                     delta_amount = EXCLUDED.delta_amount,
                     notes = EXCLUDED.notes,
                     reconciled_at = NOW()
       RETURNING id, delta_amount::text`,
      [
        params.organizationId,
        estimated?.id ?? null,
        reported.id,
        status,
        reported.currency,
        delta,
        estimated ? null : 'Nenhum custo estimado correspondente no período',
      ],
    );
    await client.query('COMMIT');
    return { id: result.rows[0]!.id, status, deltaAmount: result.rows[0]!.delta_amount };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

interface CostRow {
  id: string;
  project_id: string | null;
  provider: string;
  model: string | null;
  currency: string;
  amount: string;
  period_start: Date;
  period_end: Date;
}

function subtractDecimal(left: string, right: string): string {
  const toScaled = (value: string): bigint => {
    const [whole, fraction = ''] = value.split('.');
    const sign = whole!.startsWith('-') ? -1n : 1n;
    const absWhole = whole!.replace('-', '');
    return sign * (BigInt(absWhole) * 100_000_000n + BigInt(fraction.padEnd(8, '0')));
  };
  const scaled = toScaled(left) - toScaled(right);
  const sign = scaled < 0n ? '-' : '';
  const abs = scaled < 0n ? -scaled : scaled;
  return `${sign}${abs / 100_000_000n}.${(abs % 100_000_000n).toString().padStart(8, '0')}`;
}
