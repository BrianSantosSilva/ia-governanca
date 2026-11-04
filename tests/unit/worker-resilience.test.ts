import { describe, expect, it } from 'vitest';
import { isTransientError, withRetry, withTimeout } from '../../apps/worker/src/resilience.js';

describe('worker resilience helpers', () => {
  it('classifies connection and server errors as transient', () => {
    expect(isTransientError({ code: 'ECONNRESET' })).toBe(true);
    expect(isTransientError({ statusCode: 503 })).toBe(true);
    expect(isTransientError({ statusCode: 400 })).toBe(false);
  });

  it('retries transient errors and stops at the configured retry count', async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts += 1;
          if (attempts === 1) throw { code: 'ECONNRESET' };
          return 'ok';
        },
        { maxRetries: 1, initialDelayMs: 0, maxDelayMs: 0 },
      ),
    ).resolves.toBe('ok');
    expect(attempts).toBe(2);
  });

  it('times out a stalled operation with a recognizable network timeout code', async () => {
    await expect(withTimeout(new Promise(() => {}), 5, 'test operation')).rejects.toMatchObject({
      code: 'ETIMEDOUT',
    });
  });
});
