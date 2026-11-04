import type pg from 'pg';
import { calculateTokenCost, resolveModelPrice, type ModelPrice } from './pricing.js';

export async function recordGatewayEstimatedCost(
  pool: pg.Pool,
  params: {
    organizationId: string;
    projectId: string | null;
    usageEventId: string;
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    occurredAt: Date;
    price?: ModelPrice | null;
  },
): Promise<{ id: string; amount: string; currency: string; isSimulated: boolean } | null> {
  const price =
    params.price === undefined
      ? await resolveModelPrice(pool, {
          organizationId: params.organizationId,
          provider: params.provider,
          model: params.model,
          at: params.occurredAt,
        })
      : params.price;
  if (!price) return null;

  const amount = calculateTokenCost({
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    inputPricePerMillion: price.inputPricePerMillion,
    outputPricePerMillion: price.outputPricePerMillion,
  });
  const isSimulated = price.priceType !== 'commercial_api_tariff';
  const result = await pool.query<{ id: string; amount: string; currency: string }>(
    `INSERT INTO cost_records (
       organization_id, project_id, usage_event_id, model_price_id,
       provider, model, team_id, user_id, cost_category, is_simulated, currency, amount,
       period_start, period_end
     )
     SELECT $1, $2, $3, $4, $5, $6, ue.team_id, ue.user_id,
            'gateway_estimated', $7, $8, $9, $10, $10
     FROM usage_events ue
     WHERE ue.id = $3 AND ue.organization_id = $1
     ON CONFLICT (organization_id, usage_event_id)
       WHERE cost_category = 'gateway_estimated' AND usage_event_id IS NOT NULL
     DO UPDATE SET model_price_id = EXCLUDED.model_price_id,
                   is_simulated = EXCLUDED.is_simulated,
                   currency = EXCLUDED.currency,
                   amount = EXCLUDED.amount,
                   period_start = EXCLUDED.period_start,
                   period_end = EXCLUDED.period_end
     RETURNING id, amount::text, currency`,
    [
      params.organizationId,
      params.projectId,
      params.usageEventId,
      price.id,
      params.provider,
      params.model,
      isSimulated,
      price.currency,
      amount,
      params.occurredAt,
    ],
  );
  return { ...result.rows[0]!, currency: result.rows[0]!.currency.trim(), isSimulated };
}

export interface FinancialCategoryTotal {
  costCategory: string;
  currency: string;
  isSimulated: boolean;
  amount: string;
  recordCount: number;
}

export async function summarizeCosts(
  pool: pg.Pool,
  params: {
    organizationId: string;
    projectId?: string;
    teamId?: string;
    userId?: string;
    provider?: string;
    model?: string;
    costCategory?: string;
    dataSource?: string;
    startDate?: Date;
    endDate?: Date;
  },
): Promise<FinancialCategoryTotal[]> {
  const result = await pool.query<{
    cost_category: string;
    currency: string;
    is_simulated: boolean;
    amount: string;
    record_count: string;
  }>(
    `SELECT cr.cost_category, cr.currency, cr.is_simulated, SUM(cr.amount)::text AS amount,
            COUNT(*)::text AS record_count
     FROM cost_records cr
     LEFT JOIN projects p
       ON p.id = cr.project_id AND p.organization_id = cr.organization_id
     LEFT JOIN usage_events ue
       ON ue.id = cr.usage_event_id AND ue.organization_id = cr.organization_id
     LEFT JOIN source_records sr
       ON sr.id = cr.source_record_id AND sr.organization_id = cr.organization_id
     LEFT JOIN provider_connections pc
       ON pc.id = sr.provider_connection_id AND pc.organization_id = sr.organization_id
     WHERE cr.organization_id = $1
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
     GROUP BY cr.cost_category, cr.currency, cr.is_simulated
     ORDER BY cr.cost_category, cr.currency, cr.is_simulated`,
    [
      params.organizationId,
      params.projectId ?? null,
      params.teamId ?? null,
      params.userId ?? null,
      params.provider ?? null,
      params.model ?? null,
      params.costCategory ?? null,
      params.dataSource ?? null,
      params.startDate ?? null,
      params.endDate ?? null,
    ],
  );
  return result.rows.map((row) => ({
    costCategory: row.cost_category,
    currency: row.currency.trim(),
    isSimulated: row.is_simulated,
    amount: row.amount,
    recordCount: Number(row.record_count),
  }));
}
