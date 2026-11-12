/**
 * Texto livre pela Messages API da Anthropic (`POST {base}/v1/messages`), inteiro ou em streaming
 * (`message_start` traz a entrada, `message_delta` a saída acumulada, `message_stop` fecha). A entrada da
 * API não inclui o cache: aqui `inputTokens` soma `input_tokens`, `cache_read_input_tokens` e
 * `cache_creation_input_tokens` (gravação, cobrada a 1,25× a entrada).
 */
import { classifyProviderError } from '../errors.js';
import { ProviderHttpError, type SseEvent } from '../http.js';
import type { CompletionFinishReason, CompletionRequest, LlmProviderId } from '../types.js';
import {
  DEFAULT_COMPLETION_MAX_TOKENS,
  eventJson,
  HttpCompletionClient,
  lastUserIndex,
  n,
  splitCompletion,
  type CompletionClientOptions,
  type ParsedEvent,
  type ParsedResult,
  type RawUsage,
  type StreamState,
  type WireRequest,
} from './base.js';

export const ANTHROPIC_API_BASE = 'https://api.anthropic.com';
export const ANTHROPIC_VERSION = '2023-06-01';

interface AnthropicUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

interface AnthropicMessage {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string | null;
  usage?: AnthropicUsage;
}

interface AnthropicEvent {
  type: string;
  message?: AnthropicMessage;
  delta?: { type?: string; text?: string; stop_reason?: string | null };
  usage?: AnthropicUsage;
  error?: { type?: string; message?: string };
}

/** Uso da Anthropic → uso com a entrada inteira (cache lido e gravado incluídos). */
export function anthropicUsage(
  u: AnthropicUsage | undefined,
  base: RawUsage = { input: 0, cached: 0, cacheWrite: 0, output: 0 },
): RawUsage {
  if (!u) return base;
  const fresh = u.input_tokens ?? null;
  const cached = u.cache_read_input_tokens ?? null;
  const write = u.cache_creation_input_tokens ?? null;
  // no message_delta só vêm os campos que mudaram: o que não veio fica como estava
  const cachedN = cached === null ? base.cached : n(cached);
  const writeN = write === null ? base.cacheWrite : n(write);
  const freshN = fresh === null ? base.input - base.cached - base.cacheWrite : n(fresh);
  return {
    input: freshN + cachedN + writeN,
    cached: cachedN,
    cacheWrite: writeN,
    output: u.output_tokens === null || u.output_tokens === undefined ? base.output : n(u.output_tokens),
  };
}

export function anthropicFinishReason(reason: string | null | undefined): CompletionFinishReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'length';
    case 'tool_use':
      return 'tool_calls';
    case 'refusal':
      return 'content_filter';
    default:
      return 'other';
  }
}

/** Status HTTP equivalente de um evento de erro no meio do stream. */
const ERROR_STATUS: Record<string, number> = {
  rate_limit_error: 429,
  overloaded_error: 529,
  api_error: 500,
  authentication_error: 401,
  permission_error: 403,
  invalid_request_error: 400,
  request_too_large: 413,
};

export class AnthropicCompletionClient extends HttpCompletionClient {
  readonly provider: LlmProviderId = 'anthropic';

  constructor(options: CompletionClientOptions) {
    super(options, 'ANTHROPIC_API_KEY');
  }

  wire(req: CompletionRequest, stream: boolean): WireRequest {
    const { system, dialog } = splitCompletion(req);
    const files = req.attachments ?? [];
    const attachAt = files.length ? lastUserIndex(dialog) : -1;
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxOutputTokens ?? DEFAULT_COMPLETION_MAX_TOKENS,
      messages: dialog.map((m, i) =>
        i === attachAt
          ? {
              role: m.role,
              content: [
                // PDF vira `document`; imagem, `image` (os dois em base64, antes do texto)
                ...files.map((f) => ({
                  type: f.mediaType === 'application/pdf' ? 'document' : 'image',
                  source: { type: 'base64', media_type: f.mediaType, data: f.data },
                })),
                { type: 'text', text: m.content },
              ],
            }
          : { role: m.role, content: m.content },
      ),
    };
    if (system) body.system = system;
    // modo JSON não existe na Messages API: o pedido diz o formato nas instruções
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (stream) body.stream = true;
    const base = (this.options.baseUrl ?? ANTHROPIC_API_BASE).replace(/\/+$/, '');
    return {
      url: `${base}/v1/messages`,
      headers: { 'x-api-key': this.options.apiKey ?? '', 'anthropic-version': ANTHROPIC_VERSION },
      body,
    };
  }

  protected parseResult(json: unknown): ParsedResult {
    const res = json as AnthropicMessage;
    return {
      text: (res.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join(''),
      usage: anthropicUsage(res.usage),
      finishReason: anthropicFinishReason(res.stop_reason),
    };
  }

  protected parseEvent(ev: SseEvent, state: StreamState): ParsedEvent[] {
    const data = eventJson<AnthropicEvent>(ev, this.provider);
    switch (data.type) {
      case 'message_start':
        state.usage = anthropicUsage(data.message?.usage);
        return [{ type: 'usage' }];
      case 'content_block_delta':
        return data.delta?.type === 'text_delta' && data.delta.text
          ? [{ type: 'text', delta: data.delta.text }]
          : [];
      case 'message_delta':
        state.usage = anthropicUsage(data.usage, state.usage);
        if (data.delta?.stop_reason) state.finishReason = anthropicFinishReason(data.delta.stop_reason);
        return [];
      case 'message_stop':
        state.done = true;
        return [];
      case 'error': {
        const type = data.error?.type ?? 'api_error';
        throw classifyProviderError(
          new ProviderHttpError(data.error?.message ?? type, ERROR_STATUS[type] ?? 500, undefined, type),
          this.provider,
        );
      }
      default:
        return [];
    }
  }
}
