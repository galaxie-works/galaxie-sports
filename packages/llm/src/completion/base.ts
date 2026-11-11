/**
 * Base dos clientes de texto livre (CompletionClient) que falam HTTP direto com a API do provedor:
 * resposta inteira com retentativas e streaming por Server-Sent Events, com o uso de tokens (inclusive
 * cache) e o custo estimado pela tabela de preços (@galaxie/ai-ledger, com AI_MODEL_PRICES por cima).
 */
import { classifyProviderError, LlmError } from '../errors.js';
import { callSignal, postJson, readSse, type FetchLike, type SseEvent } from '../http.js';
import { estimateCostUsd } from '../pricing.js';
import { withRetry, type RetryOptions } from '../retry.js';
import type {
  CompletionClient,
  CompletionFinishReason,
  CompletionRequest,
  CompletionResult,
  CompletionStreamEvent,
  CompletionUsage,
  LlmMessage,
  LlmProviderId,
} from '../types.js';

export interface CompletionClientOptions {
  apiKey?: string;
  /** Raiz da API (cada provedor tem o seu padrão). */
  baseUrl?: string;
  /** Tempo máximo de cada tentativa (padrão 120 s); o pedido pode sobrescrever. */
  timeoutMs?: number;
  /** Tentativas extras em erros transitórios (429, 5xx, timeout, conexão). Padrão 2. */
  maxRetries?: number;
  retry?: Partial<RetryOptions>;
  /** fetch injetado (testes). */
  fetch?: FetchLike;
}

export const DEFAULT_COMPLETION_TIMEOUT_MS = 120_000;
export const DEFAULT_COMPLETION_MAX_RETRIES = 2;
/** Teto de saída quando o pedido não diz (a Anthropic exige o campo). */
export const DEFAULT_COMPLETION_MAX_TOKENS = 1_024;

/** Uso cru de uma chamada: `input` é a entrada inteira (inclui cache lido e gravado). */
export interface RawUsage {
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
}

export const ZERO_USAGE: RawUsage = { input: 0, cached: 0, cacheWrite: 0, output: 0 };

export interface WireRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface ParsedResult {
  text: string;
  usage: RawUsage;
  finishReason: CompletionFinishReason;
}

/** Estado do stream que o provedor atualiza a cada evento. */
export interface StreamState {
  usage: RawUsage;
  finishReason?: CompletionFinishReason;
  /** O provedor sinalizou o fim (ex.: `[DONE]`, `message_stop`). */
  done: boolean;
}

/** O que um evento do provedor produz: pedaço de texto ou "o uso mudou" (evento de uso parcial). */
export type ParsedEvent = { type: 'text'; delta: string } | { type: 'usage' };

/** Instruções de sistema (as do pedido e as mensagens `system`) e o diálogo. */
export function splitCompletion(req: CompletionRequest): { system: string; dialog: LlmMessage[] } {
  const extra = req.messages.filter((m) => m.role === 'system').map((m) => m.content);
  return {
    system: [req.system, ...extra].filter(Boolean).join('\n\n'),
    dialog: req.messages.filter((m) => m.role !== 'system'),
  };
}

export abstract class HttpCompletionClient implements CompletionClient {
  abstract readonly provider: LlmProviderId;
  protected readonly fetch: FetchLike;

  constructor(
    protected readonly options: CompletionClientOptions,
    keyEnv: string,
  ) {
    if (!options.fetch && !options.apiKey) throw new LlmError(`${keyEnv} ausente.`, 'config', false);
    this.fetch = options.fetch ?? ((url, init) => fetch(url, init));
  }

  /** URL, cabeçalhos e corpo da chamada (exposto para teste). */
  abstract wire(req: CompletionRequest, stream: boolean): WireRequest;
  protected abstract parseResult(json: unknown): ParsedResult;
  /** Um evento do stream; atualiza `state` e lança LlmError em evento de erro. */
  protected abstract parseEvent(ev: SseEvent, state: StreamState): ParsedEvent[];

  /** Uso normalizado com o custo estimado (tabela de preços + AI_MODEL_PRICES). */
  usageOf(model: string, raw: RawUsage): CompletionUsage {
    const usage = {
      inputTokens: raw.input,
      cachedInputTokens: raw.cached,
      cacheWriteTokens: raw.cacheWrite,
      outputTokens: raw.output,
    };
    return { ...usage, costUsd: estimateCostUsd(model, usage, 0, 0, this.provider) };
  }

  private retryOptions(): RetryOptions {
    return { retries: this.options.maxRetries ?? DEFAULT_COMPLETION_MAX_RETRIES, ...this.options.retry };
  }

  private post(req: CompletionRequest, stream: boolean): Promise<Response> {
    const w = this.wire(req, stream);
    const timeoutMs = req.timeoutMs ?? this.options.timeoutMs ?? DEFAULT_COMPLETION_TIMEOUT_MS;
    return postJson(this.fetch, w.url, w.headers, w.body, callSignal(timeoutMs, req.signal), this.provider);
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    return withRetry(async () => {
      const res = await this.post(req, false);
      let json: unknown;
      try {
        json = await res.json();
      } catch (err) {
        throw classifyProviderError(err, this.provider);
      }
      const r = this.parseResult(json);
      return {
        text: r.text,
        usage: this.usageOf(req.model, r.usage),
        final: true as const,
        finishReason: r.finishReason,
        provider: this.provider,
        model: req.model,
      };
    }, this.retryOptions());
  }

  async *stream(req: CompletionRequest): AsyncGenerator<CompletionStreamEvent> {
    // retentativa só até a resposta abrir: depois do primeiro pedaço, repetir duplicaria o texto
    const res = await withRetry(() => this.post(req, true), this.retryOptions());
    if (!res.body) throw new LlmError(`${this.provider}: resposta sem corpo no streaming.`, 'provider', true);
    const state: StreamState = { usage: { ...ZERO_USAGE }, done: false };
    try {
      for await (const ev of readSse(res.body)) {
        for (const out of this.parseEvent(ev, state)) {
          if (out.type === 'text') {
            if (out.delta) yield out;
          } else yield { type: 'usage', usage: this.usageOf(req.model, state.usage), final: false };
        }
        if (state.done) break;
      }
      if (!state.finishReason)
        throw new LlmError(
          `${this.provider}: o streaming terminou antes do fim da resposta.`,
          'provider',
          true,
        );
    } catch (err) {
      // o uso já cobrado vai junto do erro (quem registra o gasto conta mesmo na falha)
      throw Object.assign(classifyProviderError(err, this.provider), {
        usage: this.usageOf(req.model, state.usage),
      });
    }
    yield {
      type: 'usage',
      usage: this.usageOf(req.model, state.usage),
      final: true,
      finishReason: state.finishReason,
    };
  }
}

/** JSON de um evento `data:`; evento fora de JSON é erro do provedor. */
export function eventJson<T>(ev: SseEvent, provider: string): T {
  try {
    return JSON.parse(ev.data) as T;
  } catch {
    throw new LlmError(`${provider}: evento do streaming fora de JSON.`, 'provider', false);
  }
}

/** Número ≥ 0 (campos de uso ausentes ou nulos viram 0). */
export const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
