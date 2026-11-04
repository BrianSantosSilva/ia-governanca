export const BUDGET_MODES = ['observe', 'alert', 'block'] as const;
export type BudgetMode = (typeof BUDGET_MODES)[number];

export interface VirtualKeyPolicyTarget {
  id: string;
  name: string;
  organizationId: string;
  projectId: string | null;
  allowedProviders: string[];
  allowedModels: string[];
  scopes: string[];
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export type PolicyDenialReason =
  | 'revoked'
  | 'expired'
  | 'provider_not_allowed'
  | 'model_not_allowed'
  | 'scope_not_allowed'
  | 'rate_limit_exceeded'
  | 'budget_exceeded';

export interface PolicyEvaluationResult {
  allowed: boolean;
  reason?: PolicyDenialReason;
  message?: string;
}

export function evaluateVirtualKeyPolicy(
  key: VirtualKeyPolicyTarget,
  context: {
    provider: string;
    model: string;
    requiredScope?: string;
  },
): PolicyEvaluationResult {
  if (key.revokedAt) {
    return {
      allowed: false,
      reason: 'revoked',
      message: `A chave virtual '${key.name}' foi revogada em ${key.revokedAt.toISOString()}`,
    };
  }

  if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) {
    return {
      allowed: false,
      reason: 'expired',
      message: `A chave virtual '${key.name}' expirou em ${key.expiresAt.toISOString()}`,
    };
  }

  if (context.requiredScope && key.scopes.length > 0 && !key.scopes.includes(context.requiredScope)) {
    return {
      allowed: false,
      reason: 'scope_not_allowed',
      message: `Escopo '${context.requiredScope}' não autorizado para esta chave virtual`,
    };
  }

  if (key.allowedProviders.length > 0 && !key.allowedProviders.includes(context.provider.toLowerCase())) {
    return {
      allowed: false,
      reason: 'provider_not_allowed',
      message: `Provedor '${context.provider}' não está na lista de provedores autorizados da chave`,
    };
  }

  if (key.allowedModels.length > 0 && !key.allowedModels.includes(context.model)) {
    return {
      allowed: false,
      reason: 'model_not_allowed',
      message: `Modelo '${context.model}' não está na lista de modelos autorizados da chave`,
    };
  }

  return { allowed: true };
}

export function evaluateRateLimit(
  requestsInLastMinute: number,
  maxRequestsPerMinute: number | null,
): PolicyEvaluationResult {
  if (maxRequestsPerMinute == null) {
    return { allowed: true };
  }

  if (requestsInLastMinute >= maxRequestsPerMinute) {
    return {
      allowed: false,
      reason: 'rate_limit_exceeded',
      message: `Limite de ${maxRequestsPerMinute} requisições por minuto excedido para esta chave virtual`,
    };
  }

  return { allowed: true };
}

/**
 * Reserva de orçamento (Épico 06). No Épico 05 o passo existe no pipeline e sempre autoriza.
 */
export function evaluateBudgetPolicy(): PolicyEvaluationResult {
  return { allowed: true };
}

export * from './budgets.js';
