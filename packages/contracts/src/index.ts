import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../.env'),
  path.resolve(process.cwd(), '../../.env'),
  path.resolve(process.cwd(), '../../../.env'),
];
const envPath = envCandidates.find((candidate) => fs.existsSync(candidate));
if (envPath) dotenv.config({ path: envPath });

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().min(1).default('llama3.2'),
  LLM_DEFAULT_PROVIDER: z.string().min(1).default('ollama'),
  LLM_EXTERNAL_PROVIDERS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((val) => val === 'true'),
  GEMINI_API_KEY: z.string().optional(),
  CONNECTOR_CREDENTIALS_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  PROMPT_CONTENT_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  DATA_RETENTION_DAYS: z.coerce.number().int().min(1).max(36500).default(3650),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  API_BASE_URL: z.string().url().default('http://localhost:3001'),
  KEYCLOAK_BASE_URL: z.string().url().default('http://localhost:8080'),
  KEYCLOAK_REALM: z.string().min(1).default('ai-spend'),
  KEYCLOAK_CLIENT_ID: z.string().min(1).default('ia-governanca-web'),
  AUTH_MODE: z.enum(['local', 'oidc', 'both']).optional(),
  AUTH_LOCAL_JWT_SECRET: z.string().min(32).optional(),
  AUTH_LOCAL_ALLOW_IN_PRODUCTION: z
    .enum(['true', 'false'])
    .default('false')
    .transform((val) => val === 'true'),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).max(128).optional(),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

export function loadEnvConfig(rawEnv: NodeJS.ProcessEnv = process.env): EnvConfig {
  return EnvSchema.parse(rawEnv);
}

// ==================== DOMÍNIO: ORGANIZAÇÕES E IDENTIDADE ====================

export const RoleSchema = z.enum(['owner', 'admin', 'finops', 'security', 'developer', 'viewer']);
export type Role = z.infer<typeof RoleSchema>;

export const OrganizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().min(1),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
  deleted_at: z.coerce.date().nullable(),
});
export type Organization = z.infer<typeof OrganizationSchema>;

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  full_name: z.string().min(1),
  oidc_subject: z.string().nullable(),
  is_active: z.boolean(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
  deleted_at: z.coerce.date().nullable(),
});
export type User = z.infer<typeof UserSchema>;

export const MembershipSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: RoleSchema,
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
  deleted_at: z.coerce.date().nullable(),
});
export type Membership = z.infer<typeof MembershipSchema>;

export const TeamSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().min(1),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
  deleted_at: z.coerce.date().nullable(),
});
export type Team = z.infer<typeof TeamSchema>;

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  team_id: z.string().uuid().nullable(),
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().nullable(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
  deleted_at: z.coerce.date().nullable(),
});
export type Project = z.infer<typeof ProjectSchema>;

// ==================== DOMÍNIO: CONECTORES, LICENÇAS E FINANÇAS ====================

export const DatasetTypeSchema = z.enum(['api_costs', 'usage_records', 'license_assignments']);
export type DatasetType = z.infer<typeof DatasetTypeSchema>;

export const SyncStatusSchema = z.enum(['running', 'completed', 'failed', 'partial', 'dry_run']);
export type SyncStatus = z.infer<typeof SyncStatusSchema>;

export const UsageEventStatusSchema = z.enum([
  'succeeded',
  'failed',
  'blocked_policy',
  'blocked_budget',
  'uncertain',
]);
export type UsageEventStatus = z.infer<typeof UsageEventStatusSchema>;

export const CostCategorySchema = z.enum([
  'gateway_estimated',
  'guardrail_evaluation',
  'provider_reported',
  'license_contracted',
  'financial_adjustment',
  'unreconciled',
]);
export type CostCategory = z.infer<typeof CostCategorySchema>;

export const DashboardCostCategoryFilterSchema = z.enum([
  ...CostCategorySchema.options,
  'simulated',
]);
export const DashboardDataSourceSchema = z.enum(['gateway_local', 'csv', 'official_api']);
export const DashboardQueryFiltersSchema = z
  .object({
    organizationId: z.string().uuid().optional(),
    startDate: z.string().date().optional(),
    endDate: z.string().date().optional(),
    projectId: z.string().uuid().optional(),
    teamId: z.string().uuid().optional(),
    userId: z.string().uuid().optional(),
    provider: z.string().trim().min(1).max(100).optional(),
    model: z.string().trim().min(1).max(200).optional(),
    costCategory: DashboardCostCategoryFilterSchema.optional(),
    dataSource: DashboardDataSourceSchema.optional(),
  })
  .refine(
    (filters) =>
      !filters.startDate || !filters.endDate || filters.startDate <= filters.endDate,
    { message: 'startDate deve ser anterior ou igual a endDate', path: ['endDate'] },
  );
export type DashboardQueryFilters = z.infer<typeof DashboardQueryFiltersSchema>;

export const BudgetModeSchema = z.enum(['observe', 'alert', 'block']);
export type BudgetMode = z.infer<typeof BudgetModeSchema>;

// ==================== SCHEMAS NORMALIZADOS DE CONECTORES (ÉPICO 04) ====================

export const CurrencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Moeda deve seguir o padrão ISO 4217 com 3 letras maiúsculas');

export const ConnectorCheckpointSchema = z.object({
  cursor: z.string().nullish(),
  offset: z.number().int().min(0).nullish(),
  page: z.number().int().positive().nullish(),
  lastTimestamp: z.string().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
});
export type ConnectorCheckpoint = z.infer<typeof ConnectorCheckpointSchema>;

export const ConnectorWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  recordId: z.string().nullish(),
  line: z.number().int().positive().nullish(),
  column: z.number().int().positive().nullish(),
  details: z.record(z.string(), z.unknown()).nullish(),
});
export type ConnectorWarning = z.infer<typeof ConnectorWarningSchema>;

export const ConnectorErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  recordId: z.string().nullish(),
  line: z.number().int().positive().nullish(),
  column: z.number().int().positive().nullish(),
  isFatal: z.boolean().default(false),
  details: z.record(z.string(), z.unknown()).nullish(),
});
export type ConnectorError = z.infer<typeof ConnectorErrorSchema>;

export const NormalizedCostRecordSchema = z.object({
  externalId: z.string().min(1, 'externalId é obrigatório'),
  provider: z.string().min(1, 'provider é obrigatório'),
  model: z.string().trim().nullish(),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  usageQuantity: z.coerce.number().min(0).nullish(),
  currency: CurrencyCodeSchema,
  amount: z.union([
    z.string().regex(/^\d{1,10}(?:\.\d{1,8})?$/, 'Valor monetário decimal inválido'),
    z.coerce.number().nonnegative('Valor monetário deve ser não-negativo'),
  ]),
  projectId: z.string().uuid().nullish(),
  externalProjectId: z.string().nullish(),
  provenance: z.record(z.string(), z.unknown()).default({}),
  rawPayload: z.record(z.string(), z.unknown()).default({}),
});
export type NormalizedCostRecord = z.infer<typeof NormalizedCostRecordSchema>;

export const NormalizedUsageRecordSchema = z.object({
  externalId: z.string().min(1, 'externalId é obrigatório'),
  provider: z.string().min(1, 'provider é obrigatório'),
  model: z.string().min(1, 'model é obrigatório'),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  inputTokens: z.coerce.number().int().min(0).nullish(),
  outputTokens: z.coerce.number().int().min(0).nullish(),
  totalTokens: z.coerce.number().int().min(0).nullish(),
  durationMs: z.coerce.number().int().min(0).nullish(),
  status: UsageEventStatusSchema.default('succeeded'),
  projectId: z.string().uuid().nullish(),
  provenance: z.record(z.string(), z.unknown()).default({}),
  rawPayload: z.record(z.string(), z.unknown()).default({}),
});
export type NormalizedUsageRecord = z.infer<typeof NormalizedUsageRecordSchema>;

export const NormalizedLicenseAssignmentSchema = z.object({
  externalId: z.string().min(1, 'externalId é obrigatório'),
  provider: z.string().min(1, 'provider é obrigatório'),
  contractId: z.string().uuid().nullish(),
  externalPlanId: z.string().nullish(),
  userEmail: z.string().email().nullish(),
  userExternalId: z.string().nullish(),
  displayName: z.string().nullish(),
  status: z.enum(['assigned', 'revoked', 'pending_review']).default('assigned'),
  seatCost: z.coerce.number().min(0, 'Custo do assento deve ser não-negativo').nullish(),
  currency: CurrencyCodeSchema.nullish(),
  assignedAt: z.coerce.date(),
  revokedAt: z.coerce.date().nullish(),
  lastActivityAt: z.coerce.date().nullish(),
  provenance: z.record(z.string(), z.unknown()).default({}),
  rawPayload: z.record(z.string(), z.unknown()).default({}),
}).refine((data) => data.userEmail || data.userExternalId, {
  message: 'Pelo menos um dentre userEmail ou userExternalId deve ser fornecido',
  path: ['userEmail'],
});
export type NormalizedLicenseAssignment = z.infer<typeof NormalizedLicenseAssignmentSchema>;

export interface ConnectorBatchResult<T = unknown> {
  records: T[];
  warnings: ConnectorWarning[];
  errors: ConnectorError[];
  hasMore: boolean;
  nextCheckpoint: ConnectorCheckpoint | null;
}

export interface SyncRunSummary {
  syncRunId: string;
  organizationId: string;
  providerConnectionId: string | null;
  dataset: DatasetType;
  status: SyncStatus;
  periodStart: Date | null;
  periodEnd: Date | null;
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsFailed: number;
  checkpoint: ConnectorCheckpoint | null;
  errorDetails: ConnectorError[];
  startedAt: Date;
  finishedAt: Date | null;
}

// ==================== CONTRATOS DO GATEWAY LLM E CHAVES VIRTUAIS (ÉPICO 05) ====================

export const ChatCompletionRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);
export type ChatCompletionRole = z.infer<typeof ChatCompletionRoleSchema>;

export const ChatCompletionToolCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal('function'),
  function: z.object({
    name: z.string().min(1),
    arguments: z.string(),
  }),
});
export type ChatCompletionToolCall = z.infer<typeof ChatCompletionToolCallSchema>;

export const ChatCompletionToolSchema = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, 'Nome de ferramenta inválido'),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
    strict: z.boolean().optional(),
  }),
});
export type ChatCompletionTool = z.infer<typeof ChatCompletionToolSchema>;

// Ferramentas "custom" (formato livre, ex.: apply_patch do Copilot CLI) são aceitas e descartadas antes do provedor.
const ChatCompletionCustomToolSchema = z.object({
  type: z.literal('custom'),
  custom: z.object({ name: z.string().min(1).max(128) }).passthrough(),
});
export const ChatCompletionToolChoiceSchema = z.union([
  z.enum(['auto', 'none', 'required']),
  z.object({
    type: z.literal('function'),
    function: z.object({ name: z.string().min(1) }),
  }),
]);
export type ChatCompletionToolChoice = z.infer<typeof ChatCompletionToolChoiceSchema>;

const TextMessageSchema = z.object({
  role: z.enum(['system', 'user']),
  content: z.string().min(1, 'Mensagem não pode ser vazia'),
});

const AssistantRequestMessageSchema = z
  .object({
    role: z.literal('assistant'),
    content: z.string().nullable().optional(),
    tool_calls: z.array(ChatCompletionToolCallSchema).min(1).optional(),
  })
  .refine((message) => Boolean(message.content) || Boolean(message.tool_calls), {
    message: 'Mensagem do assistente exige conteúdo ou tool_calls',
  });

const ToolResultMessageSchema = z.object({
  role: z.literal('tool'),
  tool_call_id: z.string().min(1),
  content: z.string(),
});

export const ChatCompletionRequestMessageSchema = z.union([
  TextMessageSchema,
  AssistantRequestMessageSchema,
  ToolResultMessageSchema,
]);
export type ChatCompletionRequestMessage = z.infer<typeof ChatCompletionRequestMessageSchema>;

export const ChatCompletionMessageSchema = z.object({
  role: ChatCompletionRoleSchema,
  content: z.string().nullable(),
  tool_calls: z.array(ChatCompletionToolCallSchema).optional(),
});
export type ChatCompletionMessage = z.infer<typeof ChatCompletionMessageSchema>;

/** Retorna o texto de uma mensagem de requisição ou string vazia quando não houver conteúdo. */
export function chatMessageText(message: ChatCompletionRequestMessage): string {
  return message.content ?? '';
}

/** Indica se a requisição usa qualquer elemento do protocolo de chamada de ferramentas. */
export function requestUsesTools(request: {
  tools?: unknown[];
  messages: ChatCompletionRequestMessage[];
}): boolean {
  return (
    (request.tools?.length ?? 0) > 0 ||
    request.messages.some(
      (message) => message.role === 'tool' || ('tool_calls' in message && Boolean(message.tool_calls)),
    )
  );
}

export const ChatCompletionRequestSchema = z
  .object({
    model: z.string().min(1, 'Model é obrigatório'),
    messages: z
      .array(ChatCompletionRequestMessageSchema)
      .min(1, 'Pelo menos uma mensagem é obrigatória'),
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().int().positive().optional(),
    stream: z.boolean().optional().default(false),
    stream_options: z.object({ include_usage: z.boolean().optional() }).optional(),
    store: z.boolean().optional().default(false),
    tools: z
      .array(z.union([ChatCompletionToolSchema, ChatCompletionCustomToolSchema]))
      .min(1)
      .optional(),
    tool_choice: ChatCompletionToolChoiceSchema.optional(),
  })
  .superRefine((request, ctx) => {
    const toolNames = new Set(
      request.tools?.map((tool) => (tool.type === 'function' ? tool.function.name : tool.custom.name)),
    );
    if (request.tools && toolNames.size !== request.tools.length) {
      ctx.addIssue({ code: 'custom', path: ['tools'], message: 'Nomes de ferramentas duplicados' });
    }
    if (request.tool_choice !== undefined && !request.tools) {
      ctx.addIssue({ code: 'custom', path: ['tool_choice'], message: 'tool_choice exige tools' });
    }
    if (
      typeof request.tool_choice === 'object' &&
      request.tools &&
      !toolNames.has(request.tool_choice.function.name)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['tool_choice'],
        message: 'tool_choice referencia uma ferramenta não declarada',
      });
    }

    const pendingCallIds = new Set<string>();
    request.messages.forEach((message, index) => {
      if (message.role === 'assistant') {
        pendingCallIds.clear();
        for (const call of message.tool_calls ?? []) {
          if (pendingCallIds.has(call.id)) {
            ctx.addIssue({
              code: 'custom',
              path: ['messages', index, 'tool_calls'],
              message: 'IDs de tool_calls duplicados',
            });
          }
          pendingCallIds.add(call.id);
        }
      } else if (message.role === 'tool') {
        if (!pendingCallIds.has(message.tool_call_id)) {
          ctx.addIssue({
            code: 'custom',
            path: ['messages', index, 'tool_call_id'],
            message: 'Resultado de ferramenta sem tool_call correspondente anterior',
          });
        }
      } else {
        pendingCallIds.clear();
      }
    });
  })
  .transform(({ tools, tool_choice: choice, ...request }) => {
    const functionTools = (tools ?? []).filter(
      (tool): tool is z.infer<typeof ChatCompletionToolSchema> => tool.type === 'function',
    );
    const droppedCustomTools = (tools?.length ?? 0) - functionTools.length;
    const choiceDropped =
      typeof choice === 'object' &&
      !functionTools.some((tool) => tool.function.name === choice.function.name);
    return {
      ...request,
      ...(functionTools.length > 0 ? { tools: functionTools } : {}),
      ...(functionTools.length > 0 && choice !== undefined && !choiceDropped
        ? { tool_choice: choice }
        : {}),
      droppedCustomTools,
    };
  });
export type ChatCompletionRequest = Omit<
  z.infer<typeof ChatCompletionRequestSchema>,
  'droppedCustomTools'
> & { droppedCustomTools?: number };

export const ChatCompletionChoiceSchema = z.object({
  index: z.number().int().min(0),
  message: ChatCompletionMessageSchema,
  finish_reason: z.string(),
});
export type ChatCompletionChoice = z.infer<typeof ChatCompletionChoiceSchema>;

export const ChatCompletionUsageSchema = z.object({
  prompt_tokens: z.number().int().min(0),
  completion_tokens: z.number().int().min(0),
  total_tokens: z.number().int().min(0),
});
export type ChatCompletionUsage = z.infer<typeof ChatCompletionUsageSchema>;

export const ChatCompletionResponseSchema = z.object({
  id: z.string(),
  object: z.literal('chat.completion'),
  created: z.number(),
  model: z.string(),
  choices: z.array(ChatCompletionChoiceSchema),
  usage: ChatCompletionUsageSchema,
  content_capture: z.enum(['captured', 'not_requested', 'unavailable']).optional(),
});
export type ChatCompletionResponse = z.infer<typeof ChatCompletionResponseSchema>;

export const GuardrailRuleInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  ruleType: z.enum(['deterministic', 'intelligent']),
  mode: z.enum(['runtime', 'async']),
  scopeType: z.enum(['organization', 'project', 'team', 'user', 'virtual_key']),
  scopeId: z.string().uuid().optional(),
  terms: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  evaluatorProvider: z.enum(['ollama', 'gemini', 'azure-openai']).optional(),
  evaluatorModel: z.string().trim().min(1).max(200).optional(),
  evaluatorPrompt: z.string().trim().min(1).max(4000).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
}).superRefine((rule, context) => {
  if ((rule.scopeType === 'organization') !== (rule.scopeId === undefined)) {
    context.addIssue({ code: 'custom', message: 'scopeId deve ser informado somente para escopos específicos', path: ['scopeId'] });
  }
  if (rule.ruleType === 'deterministic') {
    if (!rule.terms.length) context.addIssue({ code: 'custom', message: 'Informe ao menos um termo para a regra', path: ['terms'] });
    if (rule.evaluatorProvider || rule.evaluatorModel || rule.evaluatorPrompt) {
      context.addIssue({ code: 'custom', message: 'Regra determinística não aceita configuração de LLM', path: ['ruleType'] });
    }
  } else {
    if (rule.terms.length) context.addIssue({ code: 'custom', message: 'Regra inteligente não aceita termos fixos', path: ['terms'] });
    if (!rule.evaluatorProvider || !rule.evaluatorModel || !rule.evaluatorPrompt) {
      context.addIssue({ code: 'custom', message: 'Regra inteligente requer provedor, modelo e prompt avaliador', path: ['evaluatorModel'] });
    }
  }
});
export type GuardrailRuleInput = z.infer<typeof GuardrailRuleInputSchema>;

export const CreateVirtualKeyInputSchema = z.object({
  name: z.string().min(1, 'Nome da chave virtual é obrigatório'),
  scopeType: z.enum(['project', 'team', 'user']),
  projectId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  allowedProviders: z.array(z.string()).default(['ollama']),
  allowedModels: z.array(z.string()).default([]),
  scopes: z.array(z.string()).default(['chat:completions']),
  maxRequestsPerMinute: z.number().int().positive().nullish(),
  expiresAt: z.coerce.date().nullish(),
}).superRefine((input, context) => {
  const targets = { project: input.projectId, team: input.teamId, user: input.userId };
  for (const scope of ['project', 'team', 'user'] as const) {
    if (scope === input.scopeType && !targets[scope]) {
      context.addIssue({ code: 'custom', path: [`${scope === 'user' ? 'user' : scope}Id`], message: `Informe o alvo do escopo ${scope}` });
    } else if (scope !== input.scopeType && targets[scope]) {
      context.addIssue({ code: 'custom', path: [`${scope === 'user' ? 'user' : scope}Id`], message: `O escopo ${input.scopeType} não aceita alvo ${scope}` });
    }
  }
});
export type CreateVirtualKeyInput = z.infer<typeof CreateVirtualKeyInputSchema>;

export const VirtualKeySchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  scopeType: z.enum(['project', 'team', 'user']),
  projectId: z.string().uuid().nullish(),
  teamId: z.string().uuid().nullish(),
  userId: z.string().uuid().nullish(),
  name: z.string(),
  keyPrefix: z.string(),
  allowedProviders: z.array(z.string()),
  allowedModels: z.array(z.string()),
  scopes: z.array(z.string()),
  maxRequestsPerMinute: z.number().int().positive().nullish(),
  expiresAt: z.coerce.date().nullish(),
  revokedAt: z.coerce.date().nullish(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type VirtualKey = z.infer<typeof VirtualKeySchema>;

export interface VirtualKeyCreated extends VirtualKey {
  apiKey: string; // Exibida apenas uma vez na criação
}

export const UsageEventRecordSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  virtualKeyId: z.string().uuid(),
  requestId: z.string().min(1),
  attemptNumber: z.number().int().positive().default(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  inputTokens: z.number().int().min(0).nullish(),
  outputTokens: z.number().int().min(0).nullish(),
  durationMs: z.number().int().min(0).nullish(),
  status: UsageEventStatusSchema,
  errorCode: z.string().nullish(),
  createdAt: z.coerce.date(),
});
export type UsageEventRecord = z.infer<typeof UsageEventRecordSchema>;
