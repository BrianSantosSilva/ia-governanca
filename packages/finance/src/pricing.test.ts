import { describe, expect, it } from 'vitest';
import { calculateTokenCost } from './pricing.js';

describe('cálculo decimal de custos', () => {
  it('preserva frações inferiores a um centavo sem usar ponto flutuante', () => {
    expect(
      calculateTokenCost({
        inputTokens: 1,
        outputTokens: 1,
        inputPricePerMillion: '0.10000000',
        outputPricePerMillion: '0.20000000',
      }),
    ).toBe('0.00000030');
  });

  it('calcula grandes volumes com precisão decimal exata', () => {
    expect(
      calculateTokenCost({
        inputTokens: 1_000_000_000,
        outputTokens: 500_000_000,
        inputPricePerMillion: '0.12345678',
        outputPricePerMillion: '0.87654321',
      }),
    ).toBe('561.72838500');
  });

  it('arredonda meio quantum para cima na escala persistida pelo banco', () => {
    expect(
      calculateTokenCost({
        inputTokens: 1,
        outputTokens: 0,
        inputPricePerMillion: '0.00500000',
        outputPricePerMillion: '0',
      }),
    ).toBe('0.00000001');
  });

  it('rejeita contagens de tokens inválidas', () => {
    expect(() =>
      calculateTokenCost({
        inputTokens: -1,
        outputTokens: 0,
        inputPricePerMillion: '1',
        outputPricePerMillion: '1',
      }),
    ).toThrow('inteiro não negativo');
  });
});
