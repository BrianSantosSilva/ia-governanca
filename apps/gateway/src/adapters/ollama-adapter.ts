import { loadEnvConfig, type ChatCompletionRequest } from '@ia-governanca/contracts';
import {
  ProviderAdapterError,
  type AdapterChatCompletionStream,
  type AdapterExecutionResult,
  type AdapterStreamChunk,
  type LLMProviderAdapter,
} from '../types.js';

import { fromOllamaToolCalls, toOllamaMessages } from './tool-calls.js';

function parseOllamaStreamLine(
  line: string,
  startTime: number,
  toolState: { nextIndex: number },
): AdapterStreamChunk {
  const data = JSON.parse(line) as {
    message?: {
      content?: string;
      tool_calls?: Array<{ function?: { name?: string; arguments?: unknown } }>;
    };
    done?: boolean;
    done_reason?: string;
    prompt_eval_count?: number;
    eval_count?: number;
    total_duration?: number;
  };
  const calls = fromOllamaToolCalls(data.message?.tool_calls);
  const toolCallDeltas = calls.map((call) => ({
    index: toolState.nextIndex++,
    id: call.id,
    name: call.function.name,
    arguments: call.function.arguments,
  }));
  const hasTools = toolCallDeltas.length > 0;
  return {
    content: data.message?.content ?? '',
    ...(hasTools ? { toolCallDeltas } : {}),
    done: data.done === true,
    ...(data.done
      ? {
          finishReason: toolState.nextIndex > 0 ? 'tool_calls' : (data.done_reason ?? 'stop'),
          ...(Number.isSafeInteger(data.prompt_eval_count)
            ? { inputTokens: data.prompt_eval_count }
            : {}),
          ...(Number.isSafeInteger(data.eval_count) ? { outputTokens: data.eval_count } : {}),
          durationMs: data.total_duration
            ? Math.round(data.total_duration / 1_000_000)
            : Date.now() - startTime,
        }
      : {}),
  };
}

function ollamaRuntimeOptions(): Record<string, number> {
  const out: Record<string, number> = {};
  const ctx = Number(process.env.OLLAMA_NUM_CTX);
  if (Number.isInteger(ctx) && ctx > 0) out.num_ctx = ctx;
  const gpu = process.env.OLLAMA_NUM_GPU;
  if (gpu !== undefined && gpu !== '' && Number.isInteger(Number(gpu)) && Number(gpu) >= 0) {
    out.num_gpu = Number(gpu);
  }
  return out;
}

export interface OllamaAdapterOptions {
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

export class OllamaAdapter implements LLMProviderAdapter {
  readonly provider = 'ollama';
  readonly supportsTools = true;
  private baseUrl: string;
  private fetchFn: typeof fetch;

  constructor(options: OllamaAdapterOptions = {}) {
    let defaultBaseUrl = 'http://localhost:11434';
    try {
      defaultBaseUrl = loadEnvConfig().OLLAMA_BASE_URL;
    } catch {
      // Usa fallback caso .env nÃ£o esteja carregado
    }

    this.baseUrl = (options.baseUrl ?? defaultBaseUrl).replace(/\/$/, '');
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  async executeChatCompletion(
    req: ChatCompletionRequest,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<AdapterExecutionResult> {
    const timeoutMs = options.timeoutMs ?? 60000;
    const controller = new AbortController();
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    if (options.signal) {
      options.signal.addEventListener('abort', () => controller.abort());
    }

    const startTime = Date.now();

    try {
      const ollamaPayload = {
        model: req.model,
        messages: toOllamaMessages(req.messages),
        ...(req.tools ? { tools: req.tools } : {}),
        stream: false,
        options: {
          temperature: req.temperature,
          num_predict: req.max_tokens,
          ...ollamaRuntimeOptions(),
        },
      };

      const response = await this.fetchFn(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(ollamaPayload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new ProviderAdapterError(
          `Ollama API retornou status HTTP ${response.status}: ${errorText || response.statusText}`,
          { code: 'OLLAMA_ERROR', statusCode: response.status, isUncertain: false },
        );
      }

      const data = (await response.json()) as {
        model?: string;
        message?: {
          role?: string;
          content?: string;
          tool_calls?: Array<{ function?: { name?: string; arguments?: unknown } }>;
        };
        done?: boolean;
        total_duration?: number;
        prompt_eval_count?: number;
        eval_count?: number;
      };

      const durationMs =
        data.total_duration && data.total_duration > 0
          ? Math.round(data.total_duration / 1_000_000)
          : Date.now() - startTime;

      const inputTokens = data.prompt_eval_count ?? 0;
      const outputTokens = data.eval_count ?? 0;
      const content = data.message?.content ?? '';
      const toolCalls = fromOllamaToolCalls(data.message?.tool_calls);

      return {
        content,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
        inputTokens,
        outputTokens,
        durationMs,
        finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
        rawResponse: data,
      };
    } catch (err: unknown) {
      if (timedOut) {
        throw new ProviderAdapterError(
          `Ollama excedeu o tempo limite de ${timeoutMs}ms aguardando resposta`,
          { code: 'TIMEOUT_UNCERTAIN', isTimeout: true, isUncertain: true },
        );
      }

      const errObj = err as { name?: string; code?: string; cause?: { code?: string } };
      const networkCode = errObj.code ?? errObj.cause?.code;
      const connectionDropped =
        errObj.name === 'AbortError' ||
        networkCode === 'ECONNRESET' ||
        networkCode === 'UND_ERR_SOCKET' ||
        networkCode === 'ETIMEDOUT';

      if (connectionDropped) {
        throw new ProviderAdapterError(
          'ConexÃ£o com o Ollama foi interrompida apÃ³s o envio da requisiÃ§Ã£o; resultado indeterminado',
          { code: 'CONNECTION_DROPPED_UNCERTAIN', isUncertain: true },
        );
      }

      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async openChatCompletionStream(
      req: ChatCompletionRequest,
      options: { signal?: AbortSignal; timeoutMs?: number } = {},
    ): Promise<AdapterChatCompletionStream> {
      const timeoutMs = options.timeoutMs ?? 60_000;
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const abortFromCaller = () => controller.abort();
      options.signal?.addEventListener('abort', abortFromCaller, { once: true });

      try {
        const startTime = Date.now();
        const response = await this.fetchFn(`${this.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: req.model,
            messages: toOllamaMessages(req.messages),
            ...(req.tools ? { tools: req.tools } : {}),
            stream: true,
            options: {
              temperature: req.temperature,
              num_predict: req.max_tokens,
              ...ollamaRuntimeOptions(),
            },
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          throw new ProviderAdapterError(
            `Ollama API retornou status HTTP ${response.status}: ${errorText || response.statusText}`,
            { code: 'OLLAMA_ERROR', statusCode: response.status, isUncertain: false },
          );
        }
        if (!response.body) {
          throw new ProviderAdapterError('Ollama nÃ£o retornou um corpo de stream', {
            code: 'OLLAMA_STREAM_MISSING',
            isUncertain: true,
          });
        }

        const body = response.body;
        const chunks = (async function* () {
          const reader = body.getReader();
          const decoder = new TextDecoder();
          let pending = '';
          const toolState = { nextIndex: 0 };
          try {
            while (true) {
              const { done, value } = await reader.read();
              pending += decoder.decode(value, { stream: !done });
              const lines = pending.split(/\r?\n/);
              pending = lines.pop() ?? '';
              for (const line of lines) {
                if (!line.trim()) continue;
                yield parseOllamaStreamLine(line, startTime, toolState);
              }
              if (done) break;
            }
            if (pending.trim()) {
              yield parseOllamaStreamLine(pending, startTime, toolState);
            }
          } catch (error) {
            if (timedOut) {
              throw new ProviderAdapterError(
                `Ollama excedeu o tempo limite de ${timeoutMs}ms durante o stream`,
                { code: 'TIMEOUT_UNCERTAIN', isTimeout: true, isUncertain: true },
              );
            }
            if (controller.signal.aborted) {
              throw new ProviderAdapterError('Stream do Ollama cancelado apÃ³s envio da requisiÃ§Ã£o', {
                code: 'STREAM_CANCELLED_UNCERTAIN',
                isUncertain: true,
              });
            }
            throw error;
          } finally {
            reader.releaseLock();
            clearTimeout(timer);
            options.signal?.removeEventListener('abort', abortFromCaller);
          }
        })();
        return {
          chunks,
          cancel: () => controller.abort(),
        };
      } catch (error) {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abortFromCaller);
        if (timedOut) {
          throw new ProviderAdapterError(
            `Ollama excedeu o tempo limite de ${timeoutMs}ms aguardando o stream`,
            { code: 'TIMEOUT_UNCERTAIN', isTimeout: true, isUncertain: true },
          );
        }
        throw error;
    }
  }
}
