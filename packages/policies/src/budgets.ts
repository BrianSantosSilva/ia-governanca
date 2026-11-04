import type pg from 'pg';
import type { BudgetMode } from './index.js';

export interface BudgetReservationDecision {
  allowed: boolean;
  mode: BudgetMode | null;
  reservationIds: string[];
  exceededPolicyIds: string[];
  alertPolicyIds: string[];
  reason?: 'budget_exceeded' | 'budget_currency_mismatch';
}

export async function reserveBudget(
  pool: pg.Pool,
  input: {
    organizationId: string;
    projectId: string | null;
    teamId?: string | null;
    userId?: string | null;
    virtualKeyId: string;
    requestId: string;
    currency: string;
    estimatedAmount: string;
    expiresAt: Date;
  },
): Promise<BudgetReservationDecision> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const policyResult = await client.query<{
      id: string;
      mode: BudgetMode;
      scope_type: 'organization' | 'project' | 'virtual_key' | 'team' | 'user';
      currency: string;
      limit_amount: string;
      alert_threshold_percent: string;
      period_start: Date;
      period_end: Date;
    }>(
      `SELECT id, mode, scope_type, currency, limit_amount::text, alert_threshold_percent::text,
              period_start, period_end
       FROM budget_policies
       WHERE organization_id = $1 AND is_active
         AND period_start <= NOW() AND period_end > NOW()
         AND (
           (scope_type = 'organization')
           OR (scope_type = 'project' AND project_id = $2)
           OR (scope_type = 'virtual_key' AND virtual_key_id = $3)
           OR (scope_type = 'team' AND team_id = $4)
           OR (scope_type = 'user' AND user_id = $5)
         )
       ORDER BY id
       FOR UPDATE`,
      [input.organizationId, input.projectId, input.virtualKeyId, input.teamId ?? null, input.userId ?? null],
    );

    const exceededPolicyIds: string[] = [];
    const alertPolicyIds: string[] = [];
    for (const policy of policyResult.rows) {
      if (policy.currency.trim() !== input.currency) {
        if (policy.mode === 'block') {
          await client.query('ROLLBACK');
          return {
            allowed: false,
            mode: policy.mode,
            reservationIds: [],
            exceededPolicyIds: [policy.id],
            alertPolicyIds: [],
            reason: 'budget_currency_mismatch',
          };
        }
        continue;
      }

      await client.query(
        `UPDATE budget_reservations
         SET status = 'expired', updated_at = NOW()
         WHERE budget_policy_id = $1 AND status = 'reserved' AND expires_at <= NOW()`,
        [policy.id],
      );
      const usageResult = await client.query<{ used: string; would_exceed: boolean; alert_reached: boolean }>(
        `SELECT used::text,
                (used + $9::numeric > $10::numeric) AS would_exceed,
                ((used + $9::numeric) / $10::numeric * 100 >= $11::numeric) AS alert_reached
         FROM (
           SELECT (
           COALESCE((
             SELECT SUM(cr.amount)
             FROM cost_records cr
             LEFT JOIN projects cp
               ON cp.id = cr.project_id AND cp.organization_id = cr.organization_id
             LEFT JOIN usage_events ue
               ON ue.id = cr.usage_event_id AND ue.organization_id = cr.organization_id
             WHERE cr.organization_id = $1
               AND cr.currency = $2
               AND cr.period_start >= $3::timestamptz
               AND cr.period_start < $4::timestamptz
               AND cr.cost_category IN ('gateway_estimated', 'guardrail_evaluation')
               AND (
                 ($5::text = 'organization')
                 OR ($5::text = 'project' AND cr.project_id = $6)
                 OR ($5::text = 'virtual_key' AND EXISTS (
                   SELECT 1 FROM usage_events ue
                   WHERE ue.id = cr.usage_event_id AND ue.virtual_key_id = $7
                 ))
                 OR ($5::text = 'team' AND COALESCE(cr.team_id, ue.team_id, cp.team_id) = $12)
                 OR ($5::text = 'user' AND cr.user_id = $13)
               )
           ), 0)
           +
           COALESCE((
             SELECT SUM(br.reserved_amount)
             FROM budget_reservations br
             WHERE br.budget_policy_id = $8 AND br.currency = $2
               AND br.status IN ('reserved', 'uncertain')
           ), 0)
           )::numeric AS used
         ) AS usage`,
        [
          input.organizationId,
          policy.currency.trim(),
          policy.period_start,
          policy.period_end,
          policy.scope_type,
          input.projectId,
          input.virtualKeyId,
          policy.id,
          input.estimatedAmount,
          policy.limit_amount,
          policy.alert_threshold_percent,
          input.teamId ?? null,
          input.userId ?? null,
        ],
      );
      const wouldExceed = usageResult.rows[0]?.would_exceed ?? false;
      if (wouldExceed && policy.mode === 'block') exceededPolicyIds.push(policy.id);
      if (policy.mode === 'alert' && usageResult.rows[0]?.alert_reached) {
        alertPolicyIds.push(policy.id);
      }
    }

    if (exceededPolicyIds.length > 0) {
      await client.query('COMMIT');
      return {
        allowed: false,
        mode: 'block',
        reservationIds: [],
        exceededPolicyIds,
        alertPolicyIds,
        reason: 'budget_exceeded',
      };
    }

    const reservationIds: string[] = [];
    for (const policy of policyResult.rows) {
      if (policy.currency.trim() !== input.currency) continue;
      const reservation = await client.query<{ id: string }>(
        `INSERT INTO budget_reservations (
           organization_id, budget_policy_id, request_id, currency,
           reserved_amount, status, expires_at
         )
         VALUES ($1, $2, $3, $4, $5, 'reserved', $6)
         ON CONFLICT (organization_id, budget_policy_id, request_id)
         DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [
          input.organizationId,
          policy.id,
          input.requestId,
          input.currency,
          input.estimatedAmount,
          input.expiresAt,
        ],
      );
      reservationIds.push(reservation.rows[0]!.id);
    }

    await client.query('COMMIT');
    return {
      allowed: true,
      mode: policyResult.rows.some((p) => p.mode === 'alert')
        ? 'alert'
        : policyResult.rows.some((p) => p.mode === 'observe')
          ? 'observe'
          : policyResult.rows.length > 0
            ? 'block'
            : null,
      reservationIds,
      exceededPolicyIds: [],
      alertPolicyIds,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function settleBudgetReservations(
  pool: pg.Pool,
  params: {
    organizationId: string;
    requestId: string;
    usageEventId: string;
    settledAmount: string | null;
    status: 'settled' | 'released' | 'uncertain';
  },
): Promise<void> {
  await pool.query(
    `UPDATE budget_reservations
     SET usage_event_id = $3,
         settled_amount = CASE WHEN $4 = 'settled' THEN $5::numeric ELSE NULL END,
         status = $4,
         updated_at = NOW()
     WHERE organization_id = $1 AND request_id = $2 AND status = 'reserved'`,
    [
      params.organizationId,
      params.requestId,
      params.usageEventId,
      params.status,
      params.settledAmount,
    ],
  );
}

export async function expireStaleBudgetReservations(pool: pg.Pool): Promise<number> {
  const result = await pool.query(
    `UPDATE budget_reservations
     SET status = 'expired', updated_at = NOW()
     WHERE status = 'reserved' AND expires_at <= NOW()`,
  );
  return result.rowCount ?? 0;
}

export interface BudgetPolicyInput {
  organizationId: string;
  scopeType: 'organization' | 'project' | 'virtual_key' | 'team' | 'user';
  projectId?: string;
  teamId?: string;
  userId?: string;
  virtualKeyId?: string;
  name: string;
  mode: BudgetMode;
  currency: string;
  limitAmount: string;
  alertThresholdPercent?: string;
  periodStart: Date;
  periodEnd: Date;
  isActive?: boolean;
}

export async function createBudgetPolicy(pool: pg.Pool, input: BudgetPolicyInput) {
  if (
    !input.name.trim() ||
    !['organization', 'project', 'virtual_key', 'team', 'user'].includes(input.scopeType) ||
    !['observe', 'alert', 'block'].includes(input.mode) ||
    (input.scopeType === 'organization' && (input.projectId || input.virtualKeyId || input.teamId || input.userId)) ||
    (input.scopeType === 'project' && (!input.projectId || input.virtualKeyId || input.teamId || input.userId)) ||
    (input.scopeType === 'virtual_key' && (!input.virtualKeyId || input.projectId || input.teamId || input.userId)) ||
    (input.scopeType === 'team' && (!input.teamId || input.projectId || input.virtualKeyId || input.userId)) ||
    (input.scopeType === 'user' && (!input.userId || input.projectId || input.virtualKeyId || input.teamId)) ||
    input.periodEnd <= input.periodStart ||
    !/^[A-Z]{3}$/.test(input.currency) ||
    !/^\d{1,12}(?:\.\d{1,6})?$/.test(input.limitAmount) ||
    Number(input.limitAmount) <= 0 ||
    (input.alertThresholdPercent != null &&
      (!/^\d{1,3}(?:\.\d{1,2})?$/.test(input.alertThresholdPercent) ||
        Number(input.alertThresholdPercent) <= 0 ||
        Number(input.alertThresholdPercent) > 100))
  ) {
    throw new Error('Política de orçamento inválida');
  }
  const result = await pool.query(
    `INSERT INTO budget_policies (
       organization_id, scope_type, project_id, virtual_key_id, team_id, user_id, name, mode,
       currency, limit_amount, alert_threshold_percent, period_start, period_end
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      input.organizationId,
      input.scopeType,
      input.projectId ?? null,
      input.virtualKeyId ?? null,
      input.teamId ?? null,
      input.userId ?? null,
      input.name,
      input.mode,
      input.currency,
      input.limitAmount,
      input.alertThresholdPercent ?? '80',
      input.periodStart,
      input.periodEnd,
    ],
  );
  return result.rows[0];
}

export async function updateBudgetPolicy(
  pool: pg.Pool,
  params: { organizationId: string; policyId: string; fields: Partial<Pick<BudgetPolicyInput, 'name' | 'mode' | 'limitAmount' | 'alertThresholdPercent' | 'periodStart' | 'periodEnd' | 'isActive'>> },
) {
  const fields = params.fields;
  if (
    (fields.name !== undefined && !fields.name.trim()) ||
    (fields.limitAmount !== undefined &&
      (!/^\d{1,12}(?:\.\d{1,6})?$/.test(fields.limitAmount) ||
        Number(fields.limitAmount) <= 0)) ||
    (fields.alertThresholdPercent !== undefined &&
      (!/^\d{1,3}(?:\.\d{1,2})?$/.test(fields.alertThresholdPercent) ||
        Number(fields.alertThresholdPercent) <= 0 ||
        Number(fields.alertThresholdPercent) > 100)) ||
    (fields.periodStart !== undefined &&
      fields.periodEnd !== undefined &&
      fields.periodEnd <= fields.periodStart)
  ) {
    throw new Error('Atualização da política de orçamento inválida');
  }
  const result = await pool.query(
    `UPDATE budget_policies
     SET name = COALESCE($3, name),
         mode = COALESCE($4, mode),
         limit_amount = COALESCE($5::numeric, limit_amount),
         alert_threshold_percent = COALESCE($6::numeric, alert_threshold_percent),
         period_start = COALESCE($7::timestamptz, period_start),
         period_end = COALESCE($8::timestamptz, period_end),
         is_active = COALESCE($9::boolean, is_active),
         updated_at = NOW()
     WHERE id = $1 AND organization_id = $2
     RETURNING *`,
    [
      params.policyId,
      params.organizationId,
      fields.name ?? null,
      fields.mode ?? null,
      fields.limitAmount ?? null,
      fields.alertThresholdPercent ?? null,
      fields.periodStart ?? null,
      fields.periodEnd ?? null,
      fields.isActive ?? null,
    ],
  );
  return result.rows[0] ?? null;
}
