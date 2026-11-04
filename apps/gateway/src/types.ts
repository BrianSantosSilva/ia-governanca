import type { ChatCompletionRequest, ChatCompletionToolCall } from '@ia-governanca/contracts';

export interface AdapterExecutionResult {
  content: string;
  toolCalls?: ChatCompletionToolCall[];
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  finishReason: string;
  rawResponse?: unknown;
}

export interface AdapterToolCallDelta {
  index: number;
  id?: string;
  name?: string;
  arguments?: string;
}

export interface AdapterStreamChunk {
  content: string;
  toolCallDeltas?: AdapterToolCallDelta[];
  done: boolean;
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
}

export interface AdapterChatCompletionStream {
  chunks: AsyncIterable<AdapterStreamChunk>;
  cancel(): void;
}

export class ProviderAdapterError extends Error {
  readonly code: string;
  readonly statusCode?: number;
  readonly isTimeout: boolean;
  readonly isUncertain: boolean;

  constructor(
    message: string,
    options: {
      code: string;
      statusCode?: number;
      isTimeout?: boolean;
      isUncertain?: boolean;
    },
  ) {
    super(message);
    this.name = 'ProviderAdapterError';
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.isTimeout = options.isTimeout ?? false;
    this.isUncertain = options.isUncertain ?? options.isTimeout ?? false;
  }
}

export interface LLMProviderAdapter {
  readonly provider: string;
  readonly supportsTools?: boolean;
  executeChatCompletion(
    req: ChatCompletionRequest,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<AdapterExecutionResult>;
  openChatCompletionStream?(
    req: ChatCompletionRequest,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<AdapterChatCompletionStream>;
}
