import type pg from 'pg';

export type PriceSource = 'official_pricing_table' | 'internal_simulation' | 'custom_contract';
export type PriceType = 'commercial_api_tariff' | 'internal_estimate' | 'simulation';

export interface ModelPrice {
  id: string;
  organizationId: string | null;
  provider: string;
  model: string;
  currency: string;
  inputPricePerMillion: string;
  outputPricePerMillion: string;
  priceSource: PriceSource;
  priceType: PriceType;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export interface CreateModelPriceInput {
  organizationId?: string | null;
  provider: string;
  model: string;
  currency: string;
  inputPricePerMillion: string;
  outputPricePerMillion: string;
  priceSource: PriceSource;
  priceType: PriceType;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
}

const DECIMAL = /^\d{1,10}(?:\.\d{1,8})?$/;
const CURRENCY = /^[A-Z]{3}$/;

export async function createModelPrice(
  pool: pg.Pool,
  input: CreateModelPriceInput,
): Promise<ModelPrice> {
  if (!input.provider.trim() || !input.model.trim()) throw new Error('provider e model são obrigatórios');
  if (!CURRENCY.test(input.currency)) throw new Error('currency deve conter 3 letras maiúsculas');
  if (
    !['official_pricing_table', 'internal_simulation', 'custom_contract'].includes(input.priceSource) ||
    !['commercial_api_tariff', 'internal_estimate', 'simulation'].includes(input.priceType)
  ) {
    throw new Error('Origem ou tipo do preço inválido');
  }
  if (!DECIMAL.test(input.inputPricePerMillion) || !DECIMAL.test(input.outputPricePerMillion)) {
    throw new Error('Preços devem ser decimais não negativos com até 8 casas');
  }
  if (input.effectiveTo && input.effectiveTo <= input.effectiveFrom) {
    throw new Error('effectiveTo deve ser posterior a effectiveFrom');
  }
  if (
    input.provider.toLowerCase() === 'ollama' &&
    (input.priceSource !== 'internal_simulation' ||
      !['internal_estimate', 'simulation'].includes(input.priceType))
  ) {
    throw new Error('Preços Ollama devem ser classificados como simulação/estimativa interna');
  }

  const result = await pool.query<PriceRow>(
    `INSERT INTO model_prices (
       organization_id, provider, model, currency, input_price_per_million,
       output_price_per_million, price_source, price_type, effective_from, effective_to
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, organization_id, provider, model, currency,
               input_price_per_million, output_price_per_million,
               price_source, price_type, effective_from, effective_to`,
    [
      input.organizationId ?? null,
      input.provider.trim().toLowerCase(),
      input.model.trim(),
      input.currency,
      input.inputPricePerMillion,
      input.outputPricePerMillion,
      input.priceSource,
      input.priceType,
      input.effectiveFrom,
      input.effectiveTo ?? null,
    ],
  );
  return mapPrice(result.rows[0]!);
}

export async function resolveModelPrice(
  pool: pg.Pool,
  params: { organizationId: string; provider: string; model: string; at?: Date },
): Promise<ModelPrice | null> {
  const result = await pool.query<PriceRow>(
    `SELECT id, organization_id, provider, model, currency,
            input_price_per_million, output_price_per_million,
            price_source, price_type, effective_from, effective_to
     FROM model_prices
     WHERE (organization_id = $1 OR organization_id IS NULL)
       AND lower(provider) = lower($2)
       AND model = $3
       AND effective_from <= $4
       AND (effective_to IS NULL OR effective_to > $4)
     ORDER BY (organization_id = $1) DESC, effective_from DESC
     LIMIT 1`,
    [params.organizationId, params.provider, params.model, params.at ?? new Date()],
  );
  return result.rows[0] ? mapPrice(result.rows[0]) : null;
}

export async function closeModelPrice(
  pool: pg.Pool,
  params: { organizationId: string; priceId: string; effectiveTo: Date },
): Promise<ModelPrice | null> {
  const result = await pool.query<PriceRow>(
    `UPDATE model_prices
     SET effective_to = $3
     WHERE id = $1 AND organization_id = $2
       AND (effective_to IS NULL OR effective_to > $3)
       AND effective_from < $3
     RETURNING id, organization_id, provider, model, currency,
               input_price_per_million, output_price_per_million,
               price_source, price_type, effective_from, effective_to`,
    [params.priceId, params.organizationId, params.effectiveTo],
  );
  return result.rows[0] ? mapPrice(result.rows[0]) : null;
}

interface PriceRow {
  id: string;
  organization_id: string | null;
  provider: string;
  model: string;
  currency: string;
  input_price_per_million: string;
  output_price_per_million: string;
  price_source: PriceSource;
  price_type: PriceType;
  effective_from: Date;
  effective_to: Date | null;
}

function mapPrice(row: PriceRow): ModelPrice {
  return {
    id: row.id,
    organizationId: row.organization_id,
    provider: row.provider,
    model: row.model,
    currency: row.currency.trim(),
    inputPricePerMillion: row.input_price_per_million,
    outputPricePerMillion: row.output_price_per_million,
    priceSource: row.price_source,
    priceType: row.price_type,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  };
}

export function calculateTokenCost(input: {
  inputTokens: number;
  outputTokens: number;
  inputPricePerMillion: string;
  outputPricePerMillion: string;
}): string {
  if (
    !Number.isSafeInteger(input.inputTokens) ||
    input.inputTokens < 0 ||
    !Number.isSafeInteger(input.outputTokens) ||
    input.outputTokens < 0
  ) {
    throw new Error('Contagem de tokens deve ser um inteiro não negativo');
  }
  const inputPrice = parseScaledPrice(input.inputPricePerMillion);
  const outputPrice = parseScaledPrice(input.outputPricePerMillion);
  const scaledNumerator =
    BigInt(input.inputTokens) * inputPrice + BigInt(input.outputTokens) * outputPrice;
  const million = 1_000_000n;
  const rounded = (scaledNumerator + million / 2n) / million;
  const whole = rounded / 100_000_000n;
  const fraction = (rounded % 100_000_000n).toString().padStart(8, '0');
  return `${whole}.${fraction}`;
}

function parseScaledPrice(value: string): bigint {
  if (!DECIMAL.test(value)) throw new Error('Preço decimal inválido');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole!) * 100_000_000n + BigInt(fraction.padEnd(8, '0'));
}
