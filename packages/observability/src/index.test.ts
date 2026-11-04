import { describe, expect, it } from 'vitest';
import { MetricsRegistry } from './index.js';

describe('MetricsRegistry', () => {
  it('renders labeled counters and cumulative histogram buckets safely', () => {
    const registry = new MetricsRegistry();
    registry.increment('requests_total', { model: 'model "one"' }, 3);
    registry.observe('duration_ms', { provider: 'local' }, 12, [10, 25]);
    registry.observe('duration_ms', { provider: 'local' }, 30, [25, 10]);

    expect(registry.render()).toContain('requests_total{model="model \\"one\\""} 3');
    expect(registry.render()).toContain('duration_ms_bucket{provider="local",le="10"} 0');
    expect(registry.render()).toContain('duration_ms_bucket{provider="local",le="25"} 1');
    expect(registry.render()).toContain('duration_ms_count{provider="local"} 2');
  });

  it('rejects invalid counter increments and histogram observations', () => {
    const registry = new MetricsRegistry();
    expect(() => registry.increment('requests_total', {}, -1)).toThrow();
    expect(() => registry.observe('duration_ms', {}, Number.NaN, [10])).toThrow();
  });
});
