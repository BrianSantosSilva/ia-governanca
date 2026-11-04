import type pg from 'pg';

export async function recordFinancialAdjustment(
  pool: pg.Pool,
  input: {
    organizationId: string;
    projectId?: string;
    provider?: string;
    model?: string;
    currency: string;
    amount: string;
    periodStart: Date;
    periodEnd: Date;
  },
) {
  if (
    !/^[A-Z]{3}$/.test(input.currency) ||
    !/^-?\d{1,10}(?:\.\d{1,8})?$/.test(input.amount) ||
    input.periodEnd < input.periodStart
  ) {
    throw new Error('Ajuste financeiro inválido');
  }
  const result = await pool.query(
    `INSERT INTO cost_records (
       organization_id, project_id, team_id, provider, model, cost_category,
       is_simulated, currency, amount, period_start, period_end
     )
     VALUES (
       $1, $2,
       (SELECT team_id FROM projects WHERE id = $2 AND organization_id = $1),
       $3, $4, 'financial_adjustment', FALSE, $5, $6, $7, $8
     )
     RETURNING id, organization_id, project_id, provider, model, cost_category,
               is_simulated, currency, amount, period_start, period_end, created_at`,
    [
      input.organizationId,
      input.projectId ?? null,
      input.provider?.trim() || 'manual',
      input.model?.trim() || null,
      input.currency,
      input.amount,
      input.periodStart,
      input.periodEnd,
    ],
  );
  return result.rows[0];
}
