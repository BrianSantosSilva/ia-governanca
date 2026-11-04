import type pg from 'pg';

export async function purgeExpiredAuditEvents(
  pool: pg.Pool,
  retentionDays: number,
): Promise<number> {
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 36500) {
    throw new Error('retentionDays must be an integer between 1 and 36500');
  }
  const result = await pool.query(
    `DELETE FROM audit_events
     WHERE created_at < NOW() - ($1::int * INTERVAL '1 day')`,
    [retentionDays],
  );
  return result.rowCount ?? 0;
}

export async function purgeExpiredUsageEventContent(pool: pg.Pool): Promise<number> {
  const result = await pool.query(
    `DELETE FROM usage_event_content WHERE expires_at <= NOW()`,
  );
  return result.rowCount ?? 0;
}

export async function failInterruptedGuardrailEvaluations(
  pool: pg.Pool,
  organizationId: string,
): Promise<number> {
  const result = await pool.query(
    `WITH stale AS (
       UPDATE guardrail_evaluations e
       SET status = 'failed',
           reason = 'A análise assíncrona foi interrompida',
           error_code = 'GUARDRAIL_ASYNC_INTERRUPTED',
           updated_at = NOW()
       WHERE e.organization_id = $1 AND e.mode = 'async' AND e.status = 'pending'
         AND e.created_at < NOW() - INTERVAL '1 minute'
         AND e.expires_at > NOW()
       RETURNING e.organization_id, e.guardrail_rule_id, e.id, e.virtual_key_id,
                 e.request_id, e.usage_event_id, e.mode, e.reason, e.expires_at
     ),
     created AS (
       INSERT INTO guardrail_alerts (
         organization_id, guardrail_rule_id, guardrail_evaluation_id, virtual_key_id,
         request_id, usage_event_id, mode, outcome, severity, reason, expires_at
       )
       SELECT s.organization_id, s.guardrail_rule_id, s.id, s.virtual_key_id,
              s.request_id, s.usage_event_id, s.mode, 'failed', r.severity, s.reason,
              s.expires_at
       FROM stale s
       JOIN guardrail_rules r
         ON r.id = s.guardrail_rule_id AND r.organization_id = s.organization_id
       ON CONFLICT (organization_id, guardrail_rule_id, request_id) DO NOTHING
       RETURNING id, organization_id
     )
     INSERT INTO audit_events (organization_id, action, target_type, target_id, metadata)
     SELECT organization_id, 'guardrail.alert.created', 'guardrail_alert', id,
            jsonb_build_object('outcome', 'failed', 'errorCode', 'GUARDRAIL_ASYNC_INTERRUPTED')
     FROM created`,
    [organizationId],
  );
  return result.rowCount ?? 0;
}

export async function purgeExpiredGuardrailData(pool: pg.Pool): Promise<{
  alerts: number;
  evaluations: number;
  testTickets: number;
  interrupted: number;
}> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const interrupted = await client.query(
      `UPDATE guardrail_evaluations
       SET status = 'failed',
           reason = 'A análise assíncrona foi interrompida',
           error_code = 'GUARDRAIL_ASYNC_INTERRUPTED',
           updated_at = NOW()
       WHERE mode = 'async' AND status = 'pending'
         AND created_at < NOW() - INTERVAL '1 minute'
         AND expires_at > NOW()`,
    );
    await client.query(
      `INSERT INTO guardrail_alerts (
         organization_id, guardrail_rule_id, guardrail_evaluation_id, virtual_key_id,
         request_id, actor_user_id, usage_event_id, mode, outcome, severity, reason, expires_at
       )
       SELECT e.organization_id, e.guardrail_rule_id, e.id, e.virtual_key_id,
              e.request_id, NULL, e.usage_event_id, e.mode, 'failed', r.severity,
              e.reason, LEAST(e.expires_at, NOW() + INTERVAL '30 days')
       FROM guardrail_evaluations e
       JOIN guardrail_rules r
         ON r.id = e.guardrail_rule_id AND r.organization_id = e.organization_id
       WHERE e.error_code = 'GUARDRAIL_ASYNC_INTERRUPTED'
         AND e.updated_at >= NOW() - INTERVAL '2 minutes'
       ON CONFLICT (organization_id, guardrail_rule_id, request_id) DO NOTHING`,
    );
    const expiredAlerts = await client.query(
      `DELETE FROM guardrail_alerts WHERE expires_at <= NOW()`,
    );
    const expiredEvaluations = await client.query(
      `DELETE FROM guardrail_evaluations WHERE expires_at <= NOW()`,
    );
    const expiredTickets = await client.query(
      `DELETE FROM guardrail_test_tickets WHERE expires_at <= NOW()`,
    );
    await client.query('COMMIT');
    return {
      alerts: expiredAlerts.rowCount ?? 0,
      evaluations: expiredEvaluations.rowCount ?? 0,
      testTickets: expiredTickets.rowCount ?? 0,
      interrupted: interrupted.rowCount ?? 0,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
