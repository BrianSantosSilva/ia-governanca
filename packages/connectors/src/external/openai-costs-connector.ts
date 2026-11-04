import {
  NormalizedCostRecordSchema,
  type ConnectorBatchResult,
  type DatasetType,
  type NormalizedCostRecord,
} from '@ia-governanca/contracts';
import type {
  CollectBatchParams,
  ConnectionValidationResult,
  DataConnector,
} from '../types.js';

export interface OpenAICostsConnectorConfig {
  apiKey?: string;
  fetchFn?: typeof fetch;
}

interface OpenAICostBucket {
  start_time: number;
  end_time: number;
  results: Array<{
    amount?: { value?: string | number; currency?: string };
    line_item?: string;
    project_id?: string;
    model?: string;
  }>;
}

interface OpenAICostResponse {
  data?: OpenAICostBucket[];
  has_more?: boolean;
  next_page?: string | null;
}

export class OpenAICostsConnector implements DataConnector<NormalizedCostRecord, OpenAICostsConnectorConfig> {
  readonly provider = 'openai';
  readonly version = '1.0.0';
  readonly supportedDatasets: readonly DatasetType[] = ['api_costs'];
  private readonly fetchFn: typeof fetch;

  constructor(options: { fetchFn?: typeof fetch } = {}) {
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  async validateConnection(config?: OpenAICostsConnectorConfig): Promise<ConnectionValidationResult> {
    if (!config?.apiKey?.trim()) return { valid: false, message: 'Credencial OpenAI ausente' };
    try {
      await this.fetchPage(config.apiKey, new URLSearchParams({
        start_time: '1704067200',
        end_time: '1704153600',
        bucket_width: '1d',
        limit: '1',
      }));
      return { valid: true, message: 'Credencial OpenAI validada' };
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      return {
        valid: false,
        message:
          status === 401 || status === 403
            ? 'A credencial OpenAI não tem acesso à API administrativa de custos'
            : 'Não foi possível validar a conexão OpenAI',
      };
    }
  }

  async collectBatch(params: CollectBatchParams): Promise<ConnectorBatchResult<NormalizedCostRecord>> {
    const config = params.config as OpenAICostsConnectorConfig | undefined;
    if (!config?.apiKey?.trim()) return failed('OPENAI_CREDENTIALS_MISSING', 'Credencial OpenAI ausente');
    if (params.dataset !== 'api_costs' || !params.periodStart || !params.periodEnd) {
      return failed('OPENAI_COST_PERIOD_REQUIRED', 'Custos OpenAI exigem dataset api_costs e período explícito');
    }

    const query = new URLSearchParams({
      start_time: Math.floor(params.periodStart.getTime() / 1000).toString(),
      end_time: Math.floor(params.periodEnd.getTime() / 1000).toString(),
      bucket_width: '1d',
      limit: String(Math.min(Math.max(params.limit ?? 100, 1), 100)),
    });
    const page = params.checkpoint?.cursor;
    if (page) query.set('page', page);

    const response = await this.fetchPage(config.apiKey, query);
    const records: NormalizedCostRecord[] = [];
    for (const bucket of response.data ?? []) {
      for (let index = 0; index < bucket.results.length; index++) {
        const result = bucket.results[index]!;
        if (result.amount?.value == null || !result.amount.currency) continue;
        const amount = String(result.amount.value);
        const candidate = NormalizedCostRecordSchema.safeParse({
          externalId: [
            bucket.start_time,
            bucket.end_time,
            result.project_id ?? 'all-projects',
            result.line_item ?? 'cost',
            result.model ?? 'all-models',
            index,
          ].join(':'),
          provider: 'openai',
          model: result.model ?? undefined,
          periodStart: new Date(bucket.start_time * 1000),
          periodEnd: new Date(bucket.end_time * 1000),
          currency: result.amount.currency.toUpperCase(),
          amount,
          projectId: undefined,
          provenance: { source: 'openai_organization_costs', lineItem: result.line_item ?? null },
          rawPayload: { bucket, result },
        });
        if (candidate.success) records.push(candidate.data);
      }
    }
    return {
      records,
      warnings: [],
      errors: [],
      hasMore: response.has_more === true && Boolean(response.next_page),
      nextCheckpoint:
        response.has_more === true && response.next_page
          ? { cursor: response.next_page }
          : null,
    };
  }

  private async fetchPage(apiKey: string, query: URLSearchParams): Promise<OpenAICostResponse> {
    const response = await this.fetchFn(
      `https://api.openai.com/v1/organization/costs?${query.toString()}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (response.status === 429 || response.status >= 500) {
      const error = new Error('OpenAI API temporariamente indisponível') as Error & {
        statusCode: number;
        retryAfterSeconds?: number;
      };
      error.statusCode = response.status;
      const retryAfter = response.headers.get('retry-after');
      if (retryAfter && Number.isFinite(Number(retryAfter))) {
        error.retryAfterSeconds = Number(retryAfter);
      }
      throw error;
    }
    if (!response.ok) {
      const error = new Error('Falha na API administrativa OpenAI') as Error & { statusCode: number };
      error.statusCode = response.status;
      throw error;
    }
    return (await response.json()) as OpenAICostResponse;
  }
}

function failed(code: string, message: string): ConnectorBatchResult<NormalizedCostRecord> {
  return {
    records: [],
    warnings: [],
    errors: [{ code, message, isFatal: true }],
    hasMore: false,
    nextCheckpoint: null,
  };
}
