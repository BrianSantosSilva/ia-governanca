export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiRequest<T>(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'message' in payload
      ? String(payload.message)
      : `Falha na API (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return payload as T;
}

export async function apiStream(
  path: string,
  token: string,
  body: unknown,
  onContent: (content: string) => void,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as unknown;
    const message = payload && typeof payload === 'object' && 'message' in payload
      ? String(payload.message)
      : `Falha na API (${response.status})`;
    throw new ApiError(message, response.status);
  }
  if (!response.body) throw new ApiError('O Gateway não retornou um fluxo de resposta', response.status);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const events = pending.split(/\r?\n\r?\n/);
      pending = events.pop() ?? '';
      for (const event of events) {
        const data = event.split(/\r?\n/).find((line) => line.startsWith('data:'))?.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        const chunk = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
          error?: { message?: string };
        };
        if (chunk.error) throw new ApiError(chunk.error.message ?? 'Falha durante a geração', response.status);
        const content = chunk.choices?.[0]?.delta?.content;
        if (content) onContent(content);
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

export function withQuery(base: string, search: URLSearchParams, extras: Record<string, string | undefined> = {}) {
  const params = new URLSearchParams();
  for (const key of [
    'organizationId', 'startDate', 'endDate', 'projectId', 'teamId', 'userId',
    'provider', 'model', 'costCategory', 'dataSource',
  ]) {
    const value = search.get(key);
    if (value) params.set(key, value);
  }
  for (const [key, value] of Object.entries(extras)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

export function jsonBody(body: unknown): RequestInit {
  return { method: 'POST', body: JSON.stringify(body) };
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatMoney(value: string | number | null | undefined, currency?: string): string {
  if (value == null || value === '') return 'Dados não disponíveis';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Dados não disponíveis';
  return currency
    ? new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency,
        maximumFractionDigits: 8,
      }).format(amount)
    : amount.toLocaleString('pt-BR');
}
