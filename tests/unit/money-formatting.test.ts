import { describe, expect, it } from 'vitest';
import { formatMoney } from '../../apps/web/src/api.js';

describe('formatação de valores financeiros', () => {
  it('preserva valores fracionários pequenos em moedas', () => {
    const formatted = formatMoney('0.00000550', 'USD');

    expect(formatted).toMatch(/0,\d{3,}/);
  });

  it('mantém a formatação monetária usual para valores maiores', () => {
    expect(formatMoney('12.5', 'USD')).toContain('12,50');
  });
});
