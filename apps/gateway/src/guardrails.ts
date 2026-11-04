export type IntelligentGuardrailDecision =
  | { decision: 'allow' | 'block'; reason: string | null }
  | { decision: 'inconclusive'; reason: string };

export function findGuardrailTerm(content: string, terms: string[]): string | null {
  const normalizedContent = content.normalize('NFKC').toLocaleLowerCase();
  for (const term of terms) {
    const normalizedTerm = term.normalize('NFKC').toLocaleLowerCase();
    if (normalizedTerm && normalizedContent.includes(normalizedTerm)) return term;
  }
  return null;
}

export function parseIntelligentGuardrailDecision(content: string): IntelligentGuardrailDecision {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return { decision: 'inconclusive', reason: 'Resposta do avaliador não está em JSON válido' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { decision: 'inconclusive', reason: 'Resposta do avaliador não contém um objeto de decisão' };
  }
  const decision = (value as Record<string, unknown>).decision;
  const reason = (value as Record<string, unknown>).reason;
  if (decision !== 'allow' && decision !== 'block' && decision !== 'inconclusive') {
    return { decision: 'inconclusive', reason: 'Decisão do avaliador ausente ou inválida' };
  }
  if (typeof reason !== 'string' || reason.length > 500) {
    return { decision: 'inconclusive', reason: 'Justificativa do avaliador ausente ou inválida' };
  }
  if (decision === 'inconclusive') return { decision, reason: reason || 'Análise inconclusiva' };
  return { decision, reason: reason || null };
}
