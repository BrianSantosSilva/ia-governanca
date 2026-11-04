import { GuardrailRuleInputSchema } from '@ia-governanca/contracts';
import { hasPermission } from '@ia-governanca/identity';
import { describe, expect, it } from 'vitest';
import { findGuardrailTerm, parseIntelligentGuardrailDecision } from '../../apps/gateway/src/guardrails.js';

describe('guardrail input and result validation', () => {
  it('limits third-party key testing and guardrail management to organization admins', () => {
    for (const role of ['owner', 'admin'] as const) {
      expect(hasPermission(role, 'virtual_keys:test')).toBe(true);
      expect(hasPermission(role, 'guardrails:manage')).toBe(true);
    }
    for (const role of ['finops', 'security', 'developer', 'viewer'] as const) {
      expect(hasPermission(role, 'virtual_keys:test')).toBe(false);
      expect(hasPermission(role, 'guardrails:manage')).toBe(false);
      expect(hasPermission(role, 'guardrails:read')).toBe(false);
    }
  });

  it('requires only terms for deterministic rules and evaluator settings for intelligent rules', () => {
    expect(GuardrailRuleInputSchema.safeParse({
      name: 'Blocked terms',
      ruleType: 'deterministic',
      mode: 'runtime',
      scopeType: 'organization',
      terms: ['secret phrase'],
    }).success).toBe(true);

    expect(GuardrailRuleInputSchema.safeParse({
      name: 'Intelligent check',
      ruleType: 'intelligent',
      mode: 'async',
      scopeType: 'organization',
      terms: [],
      evaluatorProvider: 'ollama',
      evaluatorModel: 'llama3.2',
      evaluatorPrompt: 'Check the message against policy.',
    }).success).toBe(true);

    expect(GuardrailRuleInputSchema.safeParse({
      name: 'Invalid rule',
      ruleType: 'intelligent',
      mode: 'runtime',
      scopeType: 'organization',
      terms: [],
    }).success).toBe(false);
  });

  it('matches configured terms case-insensitively and normalizes Unicode', () => {
    expect(findGuardrailTerm('This contains SECRET Phrase', ['secret phrase'])).toBe('secret phrase');
    expect(findGuardrailTerm('cafe\u0301', ['CAFÉ'])).toBe('CAFÉ');
    expect(findGuardrailTerm('safe text', ['unsafe'])).toBeNull();
  });

  it('fails closed when the evaluator does not return the required decision JSON', () => {
    expect(parseIntelligentGuardrailDecision('not json').decision).toBe('inconclusive');
    expect(parseIntelligentGuardrailDecision('{"decision":"allow","reason":"ok"}')).toEqual({
      decision: 'allow',
      reason: 'ok',
    });
    expect(parseIntelligentGuardrailDecision('{"decision":"block","reason":"policy"}').decision).toBe('block');
    expect(parseIntelligentGuardrailDecision('{"decision":"allow"}').decision).toBe('inconclusive');
    expect(parseIntelligentGuardrailDecision('{"decision":"ignore","reason":"ok"}').decision).toBe('inconclusive');
  });
});
