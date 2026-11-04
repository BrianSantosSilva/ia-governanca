import type {
  ChatCompletionRequest,
  ChatCompletionToolCall,
} from '@ia-governanca/contracts';
import crypto from 'node:crypto';

type OllamaToolCall = { function?: { name?: string; arguments?: unknown } };

/** Converte o histórico no formato OpenAI para o formato do Ollama, incluindo ferramentas. */
export function toOllamaMessages(messages: ChatCompletionRequest['messages']) {
  const toolNames = new Map<string, string>();
  return messages.map((message) => {
    if (message.role === 'assistant') {
      const toolCalls = message.tool_calls?.map((call) => {
        toolNames.set(call.id, call.function.name);
        let args: unknown = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {
          args = {};
        }
        return { function: { name: call.function.name, arguments: args } };
      });
      return {
        role: 'assistant',
        content: message.content ?? '',
        ...(toolCalls ? { tool_calls: toolCalls } : {}),
      };
    }
    if (message.role === 'tool') {
      return {
        role: 'tool',
        content: message.content,
        tool_name: toolNames.get(message.tool_call_id),
      };
    }
    return { role: message.role, content: message.content };
  });
}

/** Converte chamadas de ferramenta do Ollama (sem id) para o formato OpenAI. */
export function fromOllamaToolCalls(calls: OllamaToolCall[] | undefined): ChatCompletionToolCall[] {
  return (calls ?? [])
    .filter((call) => typeof call.function?.name === 'string')
    .map((call) => ({
      id: `call_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`,
      type: 'function' as const,
      function: {
        name: call.function!.name!,
        arguments:
          typeof call.function!.arguments === 'string'
            ? call.function!.arguments
            : JSON.stringify(call.function!.arguments ?? {}),
      },
    }));
}
