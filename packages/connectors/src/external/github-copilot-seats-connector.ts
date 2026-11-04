import {
  NormalizedLicenseAssignmentSchema,
  type ConnectorBatchResult,
  type DatasetType,
  type NormalizedLicenseAssignment,
} from '@ia-governanca/contracts';
import type {
  CollectBatchParams,
  ConnectionValidationResult,
  DataConnector,
} from '../types.js';

export interface GitHubCopilotSeatsConfig {
  token?: string;
  organization?: string;
  fetchFn?: typeof fetch;
}

interface GitHubSeat {
  assignee?: { id?: number; login?: string };
  plan?: string;
  created_at?: string;
  pending_cancellation_date?: string | null;
  last_activity_at?: string | null;
}

export class GitHubCopilotSeatsConnector implements DataConnector<
  NormalizedLicenseAssignment,
  GitHubCopilotSeatsConfig
> {
  readonly provider = 'github-copilot';
  readonly version = '1.0.0';
  readonly supportedDatasets: readonly DatasetType[] = ['license_assignments'];
  private readonly fetchFn: typeof fetch;

  constructor(options: { fetchFn?: typeof fetch } = {}) {
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  async validateConnection(config?: GitHubCopilotSeatsConfig): Promise<ConnectionValidationResult> {
    if (!config?.token?.trim() || !config.organization?.trim()) {
      return { valid: false, message: 'Token e organização GitHub são obrigatórios' };
    }
    try {
      await this.fetchPage(config, 1);
      return { valid: true, message: 'Acesso às licenças GitHub Copilot validado' };
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      return {
        valid: false,
        message:
          status === 401 || status === 403
            ? 'Token sem permissão para consultar as licenças GitHub Copilot'
            : 'Não foi possível validar a conexão GitHub Copilot',
      };
    }
  }

  async collectBatch(
    params: CollectBatchParams,
  ): Promise<ConnectorBatchResult<NormalizedLicenseAssignment>> {
    const config = params.config as GitHubCopilotSeatsConfig | undefined;
    if (!config?.token?.trim() || !config.organization?.trim()) {
      return failed('GITHUB_CREDENTIALS_MISSING', 'Token e organização GitHub são obrigatórios');
    }
    if (params.dataset !== 'license_assignments') {
      return failed('GITHUB_DATASET_UNSUPPORTED', 'Conector GitHub Copilot aceita license_assignments');
    }
    const page = Math.max(Number(params.checkpoint?.page ?? 1), 1);
    const { seats, hasMore } = await this.fetchPage(config, page);
    const records = seats.flatMap((seat) => {
      const externalUserId = seat.assignee?.id == null ? null : String(seat.assignee.id);
      if (!externalUserId || !seat.created_at) return [];
      const assignedAt = new Date(seat.created_at);
      const revokedAt = seat.pending_cancellation_date
        ? new Date(seat.pending_cancellation_date)
        : null;
      const candidate = NormalizedLicenseAssignmentSchema.safeParse({
        externalId: `copilot-seat:${externalUserId}`,
        userExternalId: externalUserId,
        provider: 'github-copilot',
        externalPlanId: seat.plan,
        status: revokedAt ? 'revoked' : 'assigned',
        seatCost: null,
        currency: null,
        assignedAt,
        revokedAt,
        lastActivityAt: seat.last_activity_at ? new Date(seat.last_activity_at) : null,
        provenance: { source: 'github_copilot_billing_seats' },
        rawPayload: seat,
      });
      return candidate.success ? [candidate.data] : [];
    });
    return {
      records,
      warnings: [],
      errors: [],
      hasMore,
      nextCheckpoint: hasMore ? { page: page + 1 } : null,
    };
  }

  private async fetchPage(
    config: GitHubCopilotSeatsConfig,
    page: number,
  ): Promise<{ seats: GitHubSeat[]; hasMore: boolean }> {
    const organization = encodeURIComponent(config.organization!);
    const response = await this.fetchFn(
      `https://api.github.com/orgs/${organization}/copilot/billing/seats?per_page=100&page=${page}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${config.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (response.status === 429 || response.status >= 500) {
      const error = new Error('GitHub API temporariamente indisponível') as Error & {
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
      const error = new Error('Falha na API de licenças GitHub Copilot') as Error & {
        statusCode: number;
      };
      error.statusCode = response.status;
      throw error;
    }
    const data = (await response.json()) as { seats?: GitHubSeat[] };
    return {
      seats: data.seats ?? [],
      hasMore: /<[^>]*[?&]page=\d+[^>]*>;\s*rel="next"/.test(response.headers.get('link') ?? ''),
    };
  }
}

function failed(
  code: string,
  message: string,
): ConnectorBatchResult<NormalizedLicenseAssignment> {
  return {
    records: [],
    warnings: [],
    errors: [{ code, message, isFatal: true }],
    hasMore: false,
    nextCheckpoint: null,
  };
}
