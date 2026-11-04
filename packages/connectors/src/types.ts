import type {
  ConnectorBatchResult,
  ConnectorCheckpoint,
  DatasetType,
} from '@ia-governanca/contracts';

export interface ConnectionValidationResult {
  valid: boolean;
  message?: string;
  details?: Record<string, unknown>;
}

export interface CollectBatchParams {
  dataset: DatasetType;
  periodStart?: Date;
  periodEnd?: Date;
  checkpoint?: ConnectorCheckpoint | null;
  limit?: number;
  config?: unknown;
}

export interface DataConnector<TRecord = unknown, TConfig = unknown> {
  readonly provider: string;
  readonly version: string;
  readonly supportedDatasets: readonly DatasetType[];

  validateConnection(config?: TConfig): Promise<ConnectionValidationResult>;
  collectBatch(params: CollectBatchParams): Promise<ConnectorBatchResult<TRecord>>;
}
