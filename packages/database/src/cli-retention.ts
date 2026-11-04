import { loadEnvConfig } from '@ia-governanca/contracts';
import {
  closePool,
  getPool,
  purgeExpiredAuditEvents,
  purgeExpiredGuardrailData,
  purgeExpiredUsageEventContent,
} from './index.js';

async function pruneExpiredAuditEvents(): Promise<void> {
  const config = loadEnvConfig();
  const deleted = await purgeExpiredAuditEvents(getPool(), config.DATA_RETENTION_DAYS);
  const deletedContent = await purgeExpiredUsageEventContent(getPool());
  const guardrailRetention = await purgeExpiredGuardrailData(getPool());
  process.stdout.write(
    `${JSON.stringify({
      operation: 'retention',
      audit_retention_days: config.DATA_RETENTION_DAYS,
      deleted_audit_events: deleted,
      deleted_usage_event_content: deletedContent,
      guardrail_retention: guardrailRetention,
    })}\n`,
  );
}

pruneExpiredAuditEvents()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Audit retention failed'}\n`);
    process.exitCode = 1;
  })
  .finally(closePool);
