const SENSITIVE_KEY_REGEX = /(authorization|token|secret|password|api[_-]?key|credentials|private[_-]?key)/i;
const SENSITIVE_VALUE_REGEX = /(Bearer\s+[A-Za-z0-9._~+/-]+=*|sk-[a-zA-Z0-9_-]{16,}|ghp_[a-zA-Z0-9]{20,})/g;

export function sanitizeString(val: string): string {
  return val.replace(SENSITIVE_VALUE_REGEX, '[REDACTED_CREDENTIAL]');
}

export function sanitizeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const sanitizedMsg = sanitizeString(err.message);
    const sanitizedStack = err.stack ? sanitizeString(err.stack) : undefined;
    return {
      name: err.name,
      message: sanitizedMsg,
      stack: sanitizedStack,
    };
  }

  if (typeof err === 'object' && err !== null) {
    const clean: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(err as Record<string, unknown>)) {
      if (SENSITIVE_KEY_REGEX.test(key)) {
        clean[key] = '[REDACTED_SECRET]';
      } else if (typeof val === 'string') {
        clean[key] = sanitizeString(val);
      } else if (typeof val === 'object' && val !== null) {
        clean[key] = sanitizeError(val);
      } else {
        clean[key] = val;
      }
    }
    return clean;
  }

  return { message: sanitizeString(String(err)) };
}
