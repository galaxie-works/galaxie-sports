/**
 * Texto livre pela Chat Completions API (`POST {base}/chat/completions`), o formato da OpenAI que a
 * DeepSeek também fala. Streaming com `stream_options.include_usage`: o último pedaço traz o uso.
 * Cache: a OpenAI informa `prompt_tokens_details.cached_tokens`; a DeepSeek, `prompt_cache_hit_tokens`
 * e `prompt_cache_miss_tokens` (a soma é `prompt_tokens`). Nenhuma das duas cobra gravação no cache.
 *
 * Limitação: no streaming, o uso só chega no último pedaço. Stream cortado no meio sobe com `err.usage`
 * zerado (0 tokens, US$ 0); quem precisa cobrar a chamada estima a entrada pelo prompt (ex.:
 * `estimateRequestTokens`, ~4 caracteres por token) e a saída pelo texto já recebido.
 */
import { classifyProviderError, LlmError } from '../errors.js';
import { ProviderHttpError, type SseEvent } from '../http.js';
import type { CompletionFinishReason, CompletionRequest, LlmProviderId } from '../types.js';
import {
  eventJson,
  HttpCompletionClient,
  attachmentIndex,
  n,
  splitCompletion,
  type CompletionClientOptions,
  type ParsedEvent,
  type ParsedResult,
  type RawUsage,
  type StreamState,
  type WireRequest,
} from './base.js';

/** Uso da Chat Completions (campos da OpenAI e da DeepSeek). */
export interface ChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

interface ChatError {
  message?: string;
  code?: string | number;
  type?: string;
}

interface ChatCompletion {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
  usage?: ChatUsage | null;
  error?: ChatError;
}

interface ChatChunk {
  choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
  usage?: ChatUsage | null;
  error?: ChatError;
}

export function chatUsage(u: ChatUsage | null | undefined): RawUsage {
  const hit = u?.prompt_cache_hit_tokens ?? u?.prompt_tokens_details?.cached_tokens;
  const input = n(u?.prompt_tokens) || n(u?.prompt_cache_hit_tokens) + n(u?.prompt_cache_miss_tokens);
  return { input, cached: Math.min(n(hit), input), cacheWrite: 0, output: n(u?.completion_tokens) };
}

export function chatFinishReason(reason: string | null | undefined): CompletionFinishReason {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'content_filter':
      return 'content_filter';
    case 'tool_calls':
    case 'function_call':
      return 'tool_calls';
    default:
      return 'other';
  }
}

export interface OpenAiCompatibleOptions extends CompletionClientOptions {
  /** Nome do teto de saída: a OpenAI usa `max_completion_tokens`; a DeepSeek, `max_tokens`. */
  maxTokensParam?: 'max_tokens' | 'max_completion_tokens';
}

export abstract class OpenAiCompatibleCompletionClient extends HttpCompletionClient {
  protected abstract readonly defaultBaseUrl: string;

  constructor(
    protected override readonly options: OpenAiCompatibleOptions,
    keyEnv: string,
  ) {
    super(options, keyEnv);
  }

  /** O provedor lê PDF e imagem junto da mensagem? */
  protected readonly acceptsAttachments: boolean = true;

  wire(req: CompletionRequest, stream: boolean): WireRequest {
    const { system, dialog } = splitCompletion(req);
    const files = req.attachments ?? [];
    if (files.length && !this.acceptsAttachments)
      throw new LlmError(
        `${this.provider} não lê arquivos (PDF ou imagem) junto do pedido.`,
        'config',
        false,
      );
    const attachAt = attachmentIndex(dialog, files, this.provider);
    const body: Record<string, unknown> = {
      model: req.model,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...dialog.map((m, i) =>
          i === attachAt
            ? {
                role: m.role,
                content: [
                  { type: 'text', text: m.content },
                  ...files.map((f, k) =>
                    f.mediaType === 'application/pdf'
                      ? {
                          type: 'file',
                          file: {
                            filename: f.name ?? `arquivo-${k + 1}.pdf`,
                            file_data: `data:${f.mediaType};base64,${f.data}`,
                          },
                        }
                      : { type: 'image_url', image_url: { url: `data:${f.mediaType};base64,${f.data}` } },
                  ),
                ],
              }
            : { role: m.role, content: m.content },
        ),
      ],
    };
    if (req.maxOutputTokens !== undefined)
      body[this.options.maxTokensParam ?? 'max_completion_tokens'] = req.maxOutputTokens;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.json) body.response_format = { type: 'json_object' };
    if (stream) {
      body.stream = true;
      body.stream_options = { include_usage: true };
    }
    const base = (this.options.baseUrl ?? this.defaultBaseUrl).replace(/\/+$/, '');
    return {
      url: `${base}/chat/completions`,
      headers: { authorization: `Bearer ${this.options.apiKey ?? ''}` },
      body,
    };
  }

  protected parseResult(json: unknown): ParsedResult {
    const res = json as ChatCompletion;
    if (res.error) throw this.errorOf(res.error);
    const choice = res.choices?.[0];
    return {
      text: choice?.message?.content ?? '',
      usage: chatUsage(res.usage),
      finishReason: chatFinishReason(choice?.finish_reason),
    };
  }

  protected parseEvent(ev: SseEvent, state: StreamState): ParsedEvent[] {
    if (ev.data.trim() === '[DONE]') {
      state.done = true;
      return [];
    }
    const chunk = eventJson<ChatChunk>(ev, this.provider);
    if (chunk.error) throw this.errorOf(chunk.error);
    const out: ParsedEvent[] = [];
    for (const c of chunk.choices ?? []) {
      if (c.delta?.content) out.push({ type: 'text', delta: c.delta.content });
      if (c.finish_reason) state.finishReason = chatFinishReason(c.finish_reason);
    }
    if (chunk.usage) {
      state.usage = chatUsage(chunk.usage);
      state.sawUsage = true;
    }
    return out;
  }

  /** O uso vem num pedaço próprio depois do `finish_reason`: sem ele (nem o `[DONE]`), o fim foi cortado. */
  protected override streamComplete(state: StreamState): boolean {
    return state.finishReason !== undefined && (state.done || state.sawUsage === true);
  }

  private errorOf(e: ChatError) {
    const status = typeof e.code === 'number' ? e.code : 500;
    return classifyProviderError(
      new ProviderHttpError(
        e.message ?? 'erro no streaming',
        status,
        typeof e.code === 'string' ? e.code : undefined,
        e.type,
      ),
      this.provider,
    );
  }
}

/** OpenAI pela Chat Completions (texto livre; os agentes internos usam a Responses API). */
export class OpenAiCompletionClient extends OpenAiCompatibleCompletionClient {
  readonly provider: LlmProviderId = 'openai';
  protected readonly defaultBaseUrl = 'https://api.openai.com/v1';

  constructor(options: OpenAiCompatibleOptions) {
    super(options, 'OPENAI_API_KEY');
  }
}

export const DEEPSEEK_API_BASE = 'https://api.deepseek.com';

/**
 * DeepSeek (API compatível com a da OpenAI, `DEEPSEEK_API_KEY`). Sem busca na web; o raciocínio do modo
 * thinking (`reasoning_content`) não entra no texto, mas conta na saída (`completion_tokens`).
 */
export class DeepSeekCompletionClient extends OpenAiCompatibleCompletionClient {
  readonly provider: LlmProviderId = 'deepseek';
  protected readonly defaultBaseUrl = DEEPSEEK_API_BASE;
  /** A API da DeepSeek só recebe texto. */
  protected override readonly acceptsAttachments = false;

  constructor(options: OpenAiCompatibleOptions) {
    super({ maxTokensParam: 'max_tokens', ...options }, 'DEEPSEEK_API_KEY');
  }
}
