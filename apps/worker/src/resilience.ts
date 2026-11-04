export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

export function isTransientError(error: unknown): boolean {
  if (!error) return false;

  const errObj = error as { code?: string; status?: number; statusCode?: number; message?: string };
  const status = errObj.status ?? errObj.statusCode;

  // Rate limit (429) ou Erros de servidor transitórios (502, 503, 504)
  if (status === 429 || status === 502 || status === 503 || status === 504) {
    return true;
  }

  // Erros comuns de rede e timeout Node.js
  const transientCodes = ['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT'];
  if (errObj.code && transientCodes.includes(errObj.code)) {
    return true;
  }

  return false;
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operationName = 'Operação',
): Promise<T> {
  let timer: NodeJS.Timeout | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${operationName} excedeu o timeout de ${timeoutMs}ms`);
      (err as unknown as { code: string }).code = 'ETIMEDOUT';
      reject(err);
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 100;
  const maxDelayMs = options.maxDelayMs ?? 5000;
  const backoffFactor = options.backoffFactor ?? 2;
  const shouldRetry = options.shouldRetry ?? isTransientError;

  let attempt = 0;

  while (true) {
    try {
      return await operation(attempt);
    } catch (error) {
      attempt++;
      if (attempt > maxRetries || !shouldRetry(error)) {
        throw error;
      }

      // Verifica se há cabeçalho ou propriedade Retry-After
      const errObj = error as { retryAfterSeconds?: number; headers?: Record<string, string> };
      let delayMs = Math.min(maxDelayMs, initialDelayMs * Math.pow(backoffFactor, attempt - 1));

      const retryAfterHeader = errObj.headers?.['retry-after'];
      if (retryAfterHeader) {
        const seconds = parseInt(retryAfterHeader, 10);
        if (!isNaN(seconds) && seconds > 0) {
          delayMs = seconds * 1000;
        }
      } else if (errObj.retryAfterSeconds && errObj.retryAfterSeconds > 0) {
        delayMs = errObj.retryAfterSeconds * 1000;
      }

      if (options.onRetry) {
        options.onRetry(attempt, error, delayMs);
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
