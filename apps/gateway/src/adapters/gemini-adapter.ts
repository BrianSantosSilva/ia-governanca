import type { ChatCompletionRequest } from '@ia-governanca/contracts';
import { ProviderAdapterError, type AdapterExecutionResult, type LLMProviderAdapter } from '../types.js';

export interface GeminiAdapterOptions {
  apiKey: string;
  fetchFn?: typeof fetch;
}

export class GeminiAdapter implements LLMProviderAdapter {
  readonly provider = 'gemini';
  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: GeminiAdapterOptions) {
    if (!options.apiKey.trim()) throw new Error('GEMINI_API_KEY ausente');
    this.apiKey = options.apiKey;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  async executeChatCompletion(
    req: ChatCompletionRequest,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<AdapterExecutionResult> {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 60_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abortFromCaller = () => controller.abort();
    options.signal?.addEventListener('abort', abortFromCaller, { once: true });
    const start = Date.now();

    try {
      const systemMessages = req.messages
        .filter((message) => message.role === 'system')
        .map((message) => ({ text: message.content }));
      const contents = req.messages
        .filter((message) => message.role !== 'system')
        .map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        }));
      const response = await this.fetchFn(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.apiKey,
          },
          body: JSON.stringify({
            contents,
            ...(systemMessages.length > 0
              ? { systemInstruction: { parts: systemMessages } }
              : {}),
            generationConfig: {
              ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
              ...(req.max_tokens !== undefined ? { maxOutputTokens: req.max_tokens } : {}),
            },
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const code =
          response.status === 401 || response.status === 403
            ? 'GEMINI_AUTH_ERROR'
            : response.status === 429
              ? 'GEMINI_RATE_LIMIT'
              : `GEMINI_HTTP_${response.status}`;
        throw new ProviderAdapterError('A API Gemini rejeitou a solicitação', {
          code,
          statusCode: response.status,
          isUncertain: false,
        });
      }

      const data = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
          finishReason?: string;
        }>;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
      };
      const candidate = data.candidates?.[0];
      if (!candidate) {
        throw new ProviderAdapterError('A resposta Gemini não contém candidates', {
          code: 'GEMINI_EMPTY_RESPONSE',
          isUncertain: false,
        });
      }
      const usage = data.usageMetadata;
      if (
        !Number.isSafeInteger(usage?.promptTokenCount) ||
        !Number.isSafeInteger(usage?.candidatesTokenCount)
      ) {
        throw new ProviderAdapterError('A resposta Gemini não contém métricas de tokens válidas', {
          code: 'GEMINI_USAGE_MISSING',
          isUncertain: false,
        });
      }
      return {
        content: (candidate.content?.parts ?? []).map((part) => part.text ?? '').join(''),
        inputTokens: usage!.promptTokenCount!,
        outputTokens: usage!.candidatesTokenCount!,
        durationMs: Date.now() - start,
        finishReason: candidate.finishReason ?? 'stop',
        rawResponse: data,
      };
    } catch (error) {
      if (controller.signal.aborted && !(error instanceof ProviderAdapterError)) {
        throw new ProviderAdapterError('Tempo limite ou cancelamento na API Gemini', {
          code: 'GEMINI_TIMEOUT_UNCERTAIN',
          isTimeout: true,
          isUncertain: true,
        });
      }
      throw error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abortFromCaller);
    }
  }
}
