import type { UsageEventStatus } from '@ia-governanca/contracts';
import type pg from 'pg';

export interface RecordUsageEventInput {
  organizationId: string;
  projectId: string | null;
  virtualKeyId: string;
  teamId?: string | null;
  userId?: string | null;
  requestId: string;
  attemptNumber?: number;
  provider: string;
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  durationMs?: number | null;
  status: UsageEventStatus;
  errorCode?: string | null;
  source?: 'gateway' | 'dashboard_test';
  testActorUserId?: string | null;
  clientOrigin?: string | null;
}

export interface RecordedUsageEvent {
  id: string;
  organizationId: string;
  projectId: string | null;
  projectName?: string | null;
  virtualKeyId: string;
  teamId: string | null;
  userId: string | null;
  teamName?: string | null;
  userName?: string | null;
  source: 'gateway' | 'dashboard_test';
  testActorUserId: string | null;
  clientOrigin: string | null;
  testActorName?: string | null;
  requestId: string;
  attemptNumber: number;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
  status: UsageEventStatus;
  errorCode: string | null;
  contentCaptured?: boolean;
  createdAt: Date;
}

/**
 * Registra formalmente um evento de tentativa ou conclusão de inferência no ledger imutável.
 * Para eventos com status 'uncertain', os tokens de entrada e saída são estritamente forçados a null.
 */
export async function recordUsageEvent(
  pool: pg.Pool,
  params: RecordUsageEventInput,
): Promise<RecordedUsageEvent> {
  const isUncertain = params.status === 'uncertain';
  const finalInputTokens = isUncertain ? null : (params.inputTokens ?? null);
  const finalOutputTokens = isUncertain ? null : (params.outputTokens ?? null);
  const attemptNumber = params.attemptNumber ?? 1;

  const result = await pool.query<{
    id: string;
    organization_id: string;
    project_id: string | null;
    virtual_key_id: string;
    team_id: string | null;
    user_id: string | null;
    request_id: string;
    attempt_number: number;
    provider: string;
    model: string;
    input_tokens: number | null;
    output_tokens: number | null;
    duration_ms: number | null;
    status: UsageEventStatus;
    error_code: string | null;
    source: 'gateway' | 'dashboard_test';
    test_actor_user_id: string | null;
    client_origin?: string | null;
    content_captured?: boolean;
    created_at: Date;
  }>(
    `INSERT INTO usage_events (
       organization_id, project_id, virtual_key_id, request_id, attempt_number,
       provider, model, input_tokens, output_tokens, duration_ms,
       status, error_code, team_id, user_id, created_at, source, test_actor_user_id, client_origin
     )
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
            COALESCE($13::uuid, vk.team_id, p.team_id, tm.team_id),
            COALESCE($14::uuid, vk.owner_user_id), NOW(), $15, $16, $17
     FROM virtual_keys vk
     LEFT JOIN projects p ON p.id = $2 AND p.organization_id = $1
     LEFT JOIN team_memberships tm
       ON tm.organization_id = $1 AND tm.user_id = COALESCE($14::uuid, vk.owner_user_id)
     WHERE vk.id = $3 AND vk.organization_id = $1
       AND (vk.scope_type <> 'project' OR vk.project_id = $2)
       AND ($2::uuid IS NULL OR p.id IS NOT NULL)
     ON CONFLICT (organization_id, request_id, attempt_number)
     DO UPDATE SET
       status = EXCLUDED.status,
       input_tokens = EXCLUDED.input_tokens,
       output_tokens = EXCLUDED.output_tokens,
       duration_ms = EXCLUDED.duration_ms,
       error_code = EXCLUDED.error_code
     RETURNING *`,
    [
      params.organizationId,
      params.projectId,
      params.virtualKeyId,
      params.requestId,
      attemptNumber,
      params.provider,
      params.model,
      finalInputTokens,
      finalOutputTokens,
      params.durationMs ?? null,
      params.status,
      params.errorCode ?? null,
      params.teamId ?? null,
      params.userId ?? null,
      params.source ?? 'gateway',
      params.testActorUserId ?? null,
      params.clientOrigin ?? null,
    ],
  );

  const row = result.rows[0]!;
  return mapUsageEventRow(row);
}

export interface ListUsageEventsQuery {
  organizationId: string;
  projectId?: string;
  teamId?: string;
  userId?: string;
  status?: UsageEventStatus;
  provider?: string;
  model?: string;
  startDate?: Date;
  endDate?: Date;
  costCategory?: string;
  dataSource?: string;
  limit?: number;
}

export async function listUsageEvents(
  pool: pg.Pool,
  query: ListUsageEventsQuery,
): Promise<RecordedUsageEvent[]> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const result = await pool.query<{
    id: string;
    organization_id: string;
    project_id: string | null;
    virtual_key_id: string;
    team_id: string | null;
    user_id: string | null;
    request_id: string;
    attempt_number: number;
    provider: string;
    model: string;
    input_tokens: number | null;
    output_tokens: number | null;
    duration_ms: number | null;
    status: UsageEventStatus;
    error_code: string | null;
    source: 'gateway' | 'dashboard_test';
    test_actor_user_id: string | null;
    client_origin?: string | null;
    project_name: string | null;
    team_name: string | null;
    user_name: string | null;
    content_captured: boolean;
    created_at: Date;
  }>(
    `SELECT ue.id, ue.organization_id, ue.project_id, ue.virtual_key_id, ue.request_id, ue.attempt_number,
            ue.team_id, ue.user_id, ue.provider, ue.model, ue.input_tokens, ue.output_tokens, ue.duration_ms,
            ue.status, ue.error_code, ue.created_at, ue.source, ue.test_actor_user_id, ue.client_origin,
            ta.full_name AS test_actor_name, p.name AS project_name,
            t.name AS team_name, u.full_name AS user_name,
            EXISTS (
              SELECT 1 FROM usage_event_content uec
              WHERE uec.usage_event_id = ue.id
                AND uec.organization_id = ue.organization_id
                AND uec.expires_at > NOW()
            ) AS content_captured
     FROM usage_events ue
     LEFT JOIN projects p ON p.id = ue.project_id AND p.organization_id = ue.organization_id
     LEFT JOIN teams t ON t.id = ue.team_id AND t.organization_id = ue.organization_id
     LEFT JOIN users u ON u.id = ue.user_id
     LEFT JOIN users ta ON ta.id = ue.test_actor_user_id
     WHERE ue.organization_id = $1
       AND ($2::uuid IS NULL OR ue.project_id = $2)
       AND ($3::uuid IS NULL OR ue.team_id = $3)
       AND ($4::uuid IS NULL OR ue.user_id = $4)
       AND ($5::text IS NULL OR ue.status = $5)
       AND ($6::text IS NULL OR ue.provider = $6)
       AND ($7::text IS NULL OR ue.model = $7)
       AND ($8::timestamptz IS NULL OR ue.created_at >= $8)
       AND ($9::timestamptz IS NULL OR ue.created_at < $9)
       AND ($10::text IS NULL OR $10 = 'gateway_local')
       AND ($11::text IS NULL OR EXISTS (
         SELECT 1 FROM cost_records cr
         WHERE cr.usage_event_id = ue.id AND cr.organization_id = ue.organization_id
           AND (cr.cost_category = $11 OR ($11 = 'simulated' AND cr.is_simulated))
       ))
     ORDER BY ue.created_at DESC
     LIMIT $12`,
    [
      query.organizationId,
      query.projectId ?? null,
      query.teamId ?? null,
      query.userId ?? null,
      query.status ?? null,
      query.provider ?? null,
      query.model ?? null,
      query.startDate ?? null,
      query.endDate ?? null,
      query.dataSource ?? null,
      query.costCategory ?? null,
      limit,
    ],
  );

  return result.rows.map(mapUsageEventRow);
}

function mapUsageEventRow(row: {
  id: string;
  organization_id: string;
  project_id: string | null;
  virtual_key_id: string;
  team_id: string | null;
  user_id: string | null;
  request_id: string;
  attempt_number: number;
  provider: string;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  duration_ms: number | null;
  status: UsageEventStatus;
  error_code: string | null;
  source: 'gateway' | 'dashboard_test';
  test_actor_user_id: string | null;
    client_origin?: string | null;
  content_captured?: boolean;
  project_name?: string | null;
  team_name?: string | null;
  user_name?: string | null;
  test_actor_name?: string | null;
  created_at: Date;
}): RecordedUsageEvent {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    projectName: row.project_name,
    virtualKeyId: row.virtual_key_id,
    teamId: row.team_id,
    userId: row.user_id,
    teamName: row.team_name ?? null,
    userName: row.user_name ?? null,
    source: row.source,
    testActorUserId: row.test_actor_user_id,
    clientOrigin: row.client_origin ?? null,
    testActorName: row.test_actor_name ?? null,
    requestId: row.request_id,
    attemptNumber: row.attempt_number,
    provider: row.provider,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    durationMs: row.duration_ms,
    status: row.status,
    errorCode: row.error_code,
    contentCaptured: row.content_captured ?? false,
    createdAt: row.created_at,
  };
}
