/**
 * Texto livre pelo Gemini (`models/{modelo}:generateContent` e `:streamGenerateContent?alt=sse`). Cada
 * pedaço do stream traz `usageMetadata` acumulado; a saída soma a resposta e o raciocínio
 * (`thoughtsTokenCount`), cobrados como saída. Cache: `cachedContentTokenCount` (dentro de
 * `promptTokenCount`); gravação no cache não é cobrada por chamada.
 */
import { classifyProviderError } from '../errors.js';
import { ProviderHttpError, type SseEvent } from '../http.js';
import type { CompletionFinishReason, CompletionRequest, LlmProviderId } from '../types.js';
import {
  eventJson,
  HttpCompletionClient,
  n,
  splitCompletion,
  type CompletionClientOptions,
  type ParsedEvent,
  type ParsedResult,
  type RawUsage,
  type StreamState,
  type WireRequest,
} from './base.js';

export const GEMINI_GENERATE_BASE = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: GeminiUsage;
  error?: { code?: number; message?: string; status?: string };
}

export function geminiUsage(u: GeminiUsage | undefined): RawUsage {
  const input = n(u?.promptTokenCount);
  return {
    input,
    cached: Math.min(n(u?.cachedContentTokenCount), input),
    cacheWrite: 0,
    output: n(u?.candidatesTokenCount) + n(u?.thoughtsTokenCount),
  };
}

export function geminiFinishReason(reason: string | undefined): CompletionFinishReason {
  switch (reason) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
    case 'RECITATION':
    case 'BLOCKLIST':
    case 'PROHIBITED_CONTENT':
    case 'SPII':
    case 'IMAGE_SAFETY':
      return 'content_filter';
    default:
      return 'other';
  }
}

export class GeminiCompletionClient extends HttpCompletionClient {
  readonly provider: LlmProviderId = 'gemini';

  constructor(options: CompletionClientOptions) {
    super(options, 'GEMINI_API_KEY');
  }

  wire(req: CompletionRequest, stream: boolean): WireRequest {
    const { system, dialog } = splitCompletion(req);
    const generationConfig: Record<string, unknown> = {};
    if (req.maxOutputTokens !== undefined) generationConfig.maxOutputTokens = req.maxOutputTokens;
    if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
    if (req.json) generationConfig.responseMimeType = 'application/json';
    const body: Record<string, unknown> = {
      contents: dialog.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;
    const base = (this.options.baseUrl ?? GEMINI_GENERATE_BASE).replace(/\/+$/, '');
    const method = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
    return {
      url: `${base}/models/${encodeURIComponent(req.model)}:${method}`,
      headers: { 'x-goog-api-key': this.options.apiKey ?? '' },
      body,
    };
  }

  /** Texto (sem os pedaços de raciocínio) e motivo do fim de uma resposta ou pedaço. */
  private read(res: GeminiResponse): { text: string; finishReason?: CompletionFinishReason } {
    if (res.error)
      throw classifyProviderError(
        new ProviderHttpError(res.error.message ?? 'erro do Gemini', res.error.code ?? 500, res.error.status),
        this.provider,
      );
    const c = res.candidates?.[0];
    const text = (c?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? '')
      .join('');
    // pedido bloqueado antes de gerar: sem candidato, com o motivo no promptFeedback
    if (!c && res.promptFeedback?.blockReason) return { text, finishReason: 'content_filter' };
    return { text, ...(c?.finishReason ? { finishReason: geminiFinishReason(c.finishReason) } : {}) };
  }

  protected parseResult(json: unknown): ParsedResult {
    const res = json as GeminiResponse;
    const r = this.read(res);
    return { text: r.text, usage: geminiUsage(res.usageMetadata), finishReason: r.finishReason ?? 'other' };
  }

  protected parseEvent(ev: SseEvent, state: StreamState): ParsedEvent[] {
    const res = eventJson<GeminiResponse>(ev, this.provider);
    const r = this.read(res);
    if (res.usageMetadata) state.usage = geminiUsage(res.usageMetadata);
    if (r.finishReason) state.finishReason = r.finishReason;
    return r.text ? [{ type: 'text', delta: r.text }] : [];
  }
}
