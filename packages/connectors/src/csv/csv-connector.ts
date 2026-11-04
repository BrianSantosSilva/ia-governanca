import {
  NormalizedCostRecordSchema,
  NormalizedLicenseAssignmentSchema,
  type ConnectorBatchResult,
  type ConnectorError,
  type ConnectorWarning,
  type DatasetType,
  type NormalizedCostRecord,
  type NormalizedLicenseAssignment,
} from '@ia-governanca/contracts';
import type {
  CollectBatchParams,
  ConnectionValidationResult,
  DataConnector,
} from '../types.js';
import { parseCsvString, type CsvParseResult } from './parser.js';

export interface CsvConnectorConfig {
  csvContent?: string;
  defaultProvider?: string;
}

export class CsvConnector implements DataConnector<NormalizedCostRecord | NormalizedLicenseAssignment, CsvConnectorConfig> {
  readonly provider = 'csv';
  readonly version = '1.0.0';
  readonly supportedDatasets: readonly DatasetType[] = ['api_costs', 'license_assignments'] as const;

  private cachedParseResult?: { content: string; result: CsvParseResult };

  private getParseResult(csvContent: string): CsvParseResult {
    if (this.cachedParseResult && this.cachedParseResult.content === csvContent) {
      return this.cachedParseResult.result;
    }
    const result = parseCsvString(csvContent);
    this.cachedParseResult = { content: csvContent, result };
    return result;
  }

  async validateConnection(config?: CsvConnectorConfig): Promise<ConnectionValidationResult> {
    if (!config?.csvContent || config.csvContent.trim().length === 0) {
      return {
        valid: false,
        message: 'Conteúdo CSV vazio ou não fornecido',
      };
    }

    const { headers, totalLines } = this.getParseResult(config.csvContent);

    if (totalLines <= 1) {
      return {
        valid: false,
        message: 'O arquivo CSV não possui linhas de dados para processamento',
        details: { totalLines, headers },
      };
    }

    return {
      valid: true,
      message: `CSV válido com ${headers.length} colunas e ${totalLines - 1} registros encontrados`,
      details: { headers, rowCount: totalLines - 1 },
    };
  }

  async collectBatch(
    params: CollectBatchParams,
  ): Promise<ConnectorBatchResult<NormalizedCostRecord | NormalizedLicenseAssignment>> {
    const config = (params.config ?? {}) as CsvConnectorConfig;
    const csvContent = config.csvContent ?? '';
    const defaultProvider = config.defaultProvider ?? 'csv';

    if (!csvContent) {
      return {
        records: [],
        warnings: [],
        errors: [
          {
            code: 'CSV_CONTENT_MISSING',
            message: 'Nenhum conteúdo CSV fornecido para coleta',
            isFatal: true,
          },
        ],
        hasMore: false,
        nextCheckpoint: null,
      };
    }

    const parsed = this.getParseResult(csvContent);
    const offset = Number(params.checkpoint?.offset ?? 0);
    const limit = params.limit ?? 100;
    const allRows = parsed.rows;
    const slice = allRows.slice(offset, offset + limit);

    const records: Array<NormalizedCostRecord | NormalizedLicenseAssignment> = [];
    const warnings: ConnectorWarning[] = [];
    const errors: ConnectorError[] = [];

    for (const row of slice) {
      const data = row.data;
      const rowExternalId = data.external_id || `line-${row.lineNumber}`;

      if (params.dataset === 'api_costs') {
        const candidate = {
          externalId: data.external_id,
          provider: data.provider || defaultProvider,
          model: data.model || undefined,
          periodStart: data.period_start,
          periodEnd: data.period_end,
          usageQuantity: data.usage_quantity ? Number(data.usage_quantity) : undefined,
          currency: data.currency ? data.currency.toUpperCase() : undefined,
          amount: data.amount,
          projectId: data.project_id || undefined,
          externalProjectId: data.external_project_id || undefined,
          provenance: {
            source: 'csv_import',
            lineNumber: row.lineNumber,
            importedAt: new Date().toISOString(),
          },
          rawPayload: data,
        };

        const parsedCost = NormalizedCostRecordSchema.safeParse(candidate);
        if (parsedCost.success) {
          records.push(parsedCost.data);
        } else {
          for (const issue of parsedCost.error.issues) {
            errors.push({
              code: 'INVALID_COST_RECORD',
              message: `Linha ${row.lineNumber}: [${issue.path.join('.')}] ${issue.message}`,
              recordId: rowExternalId,
              line: row.lineNumber,
              isFatal: false,
              details: { field: issue.path.join('.'), received: issue },
            });
          }
        }
      } else if (params.dataset === 'license_assignments') {
        const candidate = {
          externalId: data.external_id,
          provider: data.provider || defaultProvider,
          contractId: data.contract_id || undefined,
          externalPlanId: data.external_plan_id || data.plan_id || undefined,
          userEmail: data.user_email || undefined,
          userExternalId: data.user_external_id || undefined,
          status: data.status || 'assigned',
          seatCost: data.seat_cost,
          currency: data.currency ? data.currency.toUpperCase() : undefined,
          assignedAt: data.assigned_at,
          revokedAt: data.revoked_at || undefined,
          lastActivityAt: data.last_activity_at || undefined,
          provenance: {
            source: 'csv_import',
            lineNumber: row.lineNumber,
            importedAt: new Date().toISOString(),
          },
          rawPayload: data,
        };

        const parsedLicense = NormalizedLicenseAssignmentSchema.safeParse(candidate);
        if (parsedLicense.success) {
          records.push(parsedLicense.data);
        } else {
          for (const issue of parsedLicense.error.issues) {
            errors.push({
              code: 'INVALID_LICENSE_RECORD',
              message: `Linha ${row.lineNumber}: [${issue.path.join('.')}] ${issue.message}`,
              recordId: rowExternalId,
              line: row.lineNumber,
              isFatal: false,
              details: { field: issue.path.join('.'), received: issue },
            });
          }
        }
      } else {
        errors.push({
          code: 'UNSUPPORTED_DATASET',
          message: `Dataset '${params.dataset}' não é suportado pelo CsvConnector`,
          line: row.lineNumber,
          isFatal: true,
        });
        break;
      }
    }

    const nextOffset = offset + slice.length;
    const hasMore = nextOffset < allRows.length;

    return {
      records,
      warnings,
      errors,
      hasMore,
      nextCheckpoint: hasMore
        ? {
            offset: nextOffset,
            metadata: { totalRows: allRows.length, processedSoFar: nextOffset },
          }
        : null,
    };
  }
}
