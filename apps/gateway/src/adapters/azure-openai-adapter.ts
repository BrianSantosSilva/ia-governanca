import type { ChatCompletionRequest } from '@ia-governanca/contracts';
import {
  ProviderAdapterError,
  type AdapterChatCompletionStream,
  type AdapterExecutionResult,
  type LLMProviderAdapter,
} from '../types.js';

export interface AzureOpenAIAdapterOptions {
  endpoint: string;
  apiKey: string;
  fetchFn?: typeof fetch;
}

type AzureToolCall = {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
};

type AzureChatCompletionResponse = {
  choices?: Array<{
    message?: { content?: string | null; tool_calls?: AzureToolCall[] };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

function toolFields(req: ChatCompletionRequest) {
  return {
    ...(req.tools ? { tools: req.tools } : {}),
    ...(req.tool_choice !== undefined ? { tool_choice: req.tool_choice } : {}),
  };
}

export class AzureOpenAIAdapter implements LLMProviderAdapter {
  readonly provider = 'azure-openai';
  readonly supportsTools = true;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: AzureOpenAIAdapterOptions) {
    if (!options.endpoint.trim()) throw new Error('AZURE_OPENAI_ENDPOINT ausente');
    if (!options.apiKey.trim()) throw new Error('AZURE_OPENAI_API_KEY ausente');
    const endpoint = options.endpoint.replace(/\/+$/, '');
    this.endpoint = endpoint.endsWith('/openai/v1') ? endpoint : `${endpoint}/openai/v1`;
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
      const response = await this.fetchFn(`${this.endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: req.model,
          messages: req.messages,
          stream: false,
          ...toolFields(req),
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          ...(req.max_tokens !== undefined ? { max_tokens: req.max_tokens } : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new ProviderAdapterError('Microsoft Foundry rejeitou a solicitação', {
          code: response.status === 401 || response.status === 403
            ? 'AZURE_OPENAI_AUTH_ERROR'
            : response.status === 429
              ? 'AZURE_OPENAI_RATE_LIMIT'
              : `AZURE_OPENAI_HTTP_${response.status}`,
          statusCode: response.status,
          isUncertain: false,
        });
      }

      const data = (await response.json()) as AzureChatCompletionResponse;
      const choice = data.choices?.[0];
      const toolCalls = (choice?.message?.tool_calls ?? []).filter(
        (call): call is Required<Pick<AzureToolCall, 'id'>> & AzureToolCall =>
          typeof call.id === 'string' && typeof call.function?.name === 'string',
      );
      if (
        !choice ||
        (typeof choice.message?.content !== 'string' && toolCalls.length === 0) ||
        !Number.isSafeInteger(data.usage?.prompt_tokens) ||
        !Number.isSafeInteger(data.usage?.completion_tokens)
      ) {
        throw new ProviderAdapterError('Microsoft Foundry retornou uma resposta sem conteúdo ou uso válido', {
          code: 'AZURE_OPENAI_INVALID_RESPONSE',
          isUncertain: false,
        });
      }
      return {
        content: choice.message?.content ?? '',
        ...(toolCalls.length > 0
          ? {
              toolCalls: toolCalls.map((call) => ({
                id: call.id,
                type: 'function' as const,
                function: { name: call.function!.name!, arguments: call.function!.arguments ?? '' },
              })),
            }
          : {}),
        inputTokens: data.usage!.prompt_tokens!,
        outputTokens: data.usage!.completion_tokens!,
        durationMs: Date.now() - start,
        finishReason: choice.finish_reason ?? 'stop',
        rawResponse: data,
      };
    } catch (error) {
      if (controller.signal.aborted && !(error instanceof ProviderAdapterError)) {
        throw new ProviderAdapterError('Tempo limite ou cancelamento na solicitação ao Microsoft Foundry', {
          code: 'AZURE_OPENAI_TIMEOUT_UNCERTAIN',
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

  async openChatCompletionStream(
    req: ChatCompletionRequest,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<AdapterChatCompletionStream> {
    // O Foundry (Phi-4-mini) não emite tool_calls nem finish_reason em modo stream; usa-se chamada única.
    if (req.tools && req.tools.length > 0) {
      const result = await this.executeChatCompletion(req, options);
      return {
        chunks: (async function* () {
          if (result.content) yield { content: result.content, done: false };
          yield {
            content: '',
            done: true,
            ...(result.toolCalls?.length
              ? {
                  toolCallDeltas: result.toolCalls.map((call, index) => ({
                    index,
                    id: call.id,
                    name: call.function.name,
                    arguments: call.function.arguments,
                  })),
                }
              : {}),
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            finishReason: result.toolCalls?.length ? 'tool_calls' : result.finishReason,
          };
        })(),
        cancel() {},
      };
    }
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 60_000;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const abortFromCaller = () => controller.abort();
    options.signal?.addEventListener('abort', abortFromCaller, { once: true });
    const start = Date.now();

    try {
      const response = await this.fetchFn(`${this.endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: req.model,
          messages: req.messages,
          stream: true,
          stream_options: { include_usage: true },
          ...toolFields(req),
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          ...(req.max_tokens !== undefined ? { max_tokens: req.max_tokens } : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new ProviderAdapterError('Microsoft Foundry rejeitou a solicitação', {
          code: response.status === 401 || response.status === 403
            ? 'AZURE_OPENAI_AUTH_ERROR'
            : response.status === 429
              ? 'AZURE_OPENAI_RATE_LIMIT'
              : `AZURE_OPENAI_HTTP_${response.status}`,
          statusCode: response.status,
          isUncertain: false,
        });
      }
      if (!response.body) {
        throw new ProviderAdapterError('Microsoft Foundry não retornou um corpo de stream', {
          code: 'AZURE_OPENAI_STREAM_MISSING',
          isUncertain: true,
        });
      }

      const body = response.body;
      const chunks = (async function* () {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let pending = '';
        try {
          while (true) {
            const { done, value } = await reader.read();
            pending += decoder.decode(value, { stream: !done });
            const events = pending.split(/\r?\n\r?\n/);
            pending = events.pop() ?? '';
            for (const event of events) {
              const dataLine = event.split(/\r?\n/).find((line) => line.startsWith('data:'));
              const data = dataLine?.slice(5).trim();
              if (!data || data === '[DONE]') continue;
              const item = JSON.parse(data) as {
                choices?: Array<{
                  delta?: {
                    content?: string | null;
                    tool_calls?: Array<{
                      index?: number;
                      id?: string;
                      function?: { name?: string; arguments?: string };
                    }>;
                  };
                  finish_reason?: string | null;
                }>;
                usage?: { prompt_tokens?: number; completion_tokens?: number };
              };
              const choice = item.choices?.[0];
              const usage = item.usage;
              const toolCallDeltas = (choice?.delta?.tool_calls ?? []).map((call, position) => ({
                index: call.index ?? position,
                ...(call.id ? { id: call.id } : {}),
                ...(call.function?.name ? { name: call.function.name } : {}),
                ...(call.function?.arguments !== undefined
                  ? { arguments: call.function.arguments }
                  : {}),
              }));
              if (
                choice?.delta?.content ||
                toolCallDeltas.length > 0 ||
                choice?.finish_reason ||
                usage
              ) {
                yield {
                  content: choice?.delta?.content ?? '',
                  ...(toolCallDeltas.length > 0 ? { toolCallDeltas } : {}),
                  done: Boolean(choice?.finish_reason),
                  ...(choice?.finish_reason
                    ? { finishReason: choice.finish_reason, durationMs: Date.now() - start }
                    : {}),
                  ...(Number.isSafeInteger(usage?.prompt_tokens)
                    ? { inputTokens: usage!.prompt_tokens }
                    : {}),
                  ...(Number.isSafeInteger(usage?.completion_tokens)
                    ? { outputTokens: usage!.completion_tokens }
                    : {}),
                };
              }
            }
            if (done) break;
          }
        } catch (error) {
          if (timedOut) {
            throw new ProviderAdapterError(
              `Microsoft Foundry excedeu o tempo limite de ${timeoutMs}ms durante o stream`,
              { code: 'AZURE_OPENAI_TIMEOUT_UNCERTAIN', isTimeout: true, isUncertain: true },
            );
          }
          if (controller.signal.aborted) {
            throw new ProviderAdapterError('Stream do Microsoft Foundry cancelado após envio', {
              code: 'AZURE_OPENAI_STREAM_CANCELLED_UNCERTAIN',
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
      return { chunks, cancel: () => controller.abort() };
    } catch (error) {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abortFromCaller);
      if (timedOut) {
        throw new ProviderAdapterError(
          `Microsoft Foundry excedeu o tempo limite de ${timeoutMs}ms aguardando o stream`,
          { code: 'AZURE_OPENAI_TIMEOUT_UNCERTAIN', isTimeout: true, isUncertain: true },
        );
      }
      throw error;
    }
  }
}
