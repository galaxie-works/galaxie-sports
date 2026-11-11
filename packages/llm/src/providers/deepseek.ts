/**
 * LlmClient (saída JSON com schema) para a DeepSeek: Chat Completions compatível com a da OpenAI
 * (`https://api.deepseek.com`, `DEEPSEEK_API_KEY`) no modo JSON (`response_format: json_object`). A API
 * não aceita JSON Schema: o schema vai nas instruções e a resposta é validada aqui (fora do schema,
 * tenta de novo, como nos outros provedores). Sem busca na web: agente que pede busca recebe erro de
 * configuração (escolha outro provedor para ele).
 * Docs (conferidas em 2026-11-11): api-docs.deepseek.com e .../guides/json_mode.
 */
import { DeepSeekCompletionClient } from '../completion/openai-compatible.js';
import { DEFAULT_MAX_OUTPUT_TOKENS } from '../estimate.js';
import { LlmError } from '../errors.js';
import type { FetchLike } from '../http.js';
import { assertMatchesSchema, parseJsonOutput } from '../json-schema.js';
import { estimateCostUsd } from '../pricing.js';
import { withRetry, type RetryOptions } from '../retry.js';
import type { LlmClient, LlmJsonRequest, LlmResult, LlmTier } from '../types.js';
import { splitMessages, UsageMeter, withUsage } from './common.js';

export interface DeepSeekClientOptions {
  apiKey?: string;
  models: Record<LlmTier, string>;
  maxRetries?: number;
  timeoutMs?: number;
  /** Raiz da API (padrão https://api.deepseek.com). */
  baseUrl?: string;
  /** fetch injetado (testes). */
  fetch?: FetchLike;
  retry?: Partial<RetryOptions>;
}

/** Instrução do formato: o modo JSON da DeepSeek exige a palavra "json" no pedido e não recebe o schema. */
export function jsonSchemaNote(schemaName: string, schema: Record<string, unknown>): string {
  return [
    `Responda só com um objeto JSON válido (${schemaName}), sem texto fora dele, que siga exatamente este JSON Schema:`,
    JSON.stringify(schema),
  ].join('\n');
}

export class DeepSeekLlmClient implements LlmClient {
  private readonly text: DeepSeekCompletionClient;

  constructor(private readonly options: DeepSeekClientOptions) {
    if (!options.fetch && !options.apiKey)
      throw new LlmError('DEEPSEEK_API_KEY ausente (provedor deepseek).', 'config', false);
    this.text = new DeepSeekCompletionClient({
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
      timeoutMs: options.timeoutMs ?? 180_000,
      // as retentativas ficam aqui, com a conferência do orçamento antes de cada uma
      maxRetries: 0,
    });
  }

  async generateJson<T>(req: LlmJsonRequest): Promise<LlmResult<T>> {
    if (req.webSearch)
      throw new LlmError(
        'deepseek: sem busca na web; escolha outro provedor para este agente.',
        'config',
        false,
      );
    const model = req.model ?? this.options.models[req.tier];
    const { system, dialog } = splitMessages(req);
    const meter = new UsageMeter();
    const cost = () =>
      estimateCostUsd(
        model,
        {
          inputTokens: meter.inputTokens,
          outputTokens: meter.outputTokens,
          cachedInputTokens: meter.cachedInputTokens,
        },
        0,
        0,
        'deepseek',
      );
    try {
      return await withRetry(
        async () => {
          const r = await this.text.complete({
            model,
            system: [system, jsonSchemaNote(req.schemaName, req.schema)].join('\n\n'),
            messages: dialog,
            json: true,
            maxOutputTokens: req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
            ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
            purpose: req.purpose,
          });
          // a resposta foi paga mesmo fora do schema
          meter.add({
            input: r.usage.inputTokens,
            output: r.usage.outputTokens,
            cached: r.usage.cachedInputTokens,
          });
          if (r.finishReason === 'length')
            throw new LlmError('deepseek: resposta incompleta (max_tokens).', 'incomplete', false);
          if (r.finishReason === 'content_filter')
            throw new LlmError('deepseek: resposta bloqueada pelo filtro de conteúdo.', 'refusal', false);
          const data = assertMatchesSchema<T>(
            req.schema,
            parseJsonOutput(r.text, req.schemaName),
            req.schemaName,
          );
          return {
            data,
            citations: [],
            usage: { ...meter.toUsage(cost()), cachedInputTokens: meter.cachedInputTokens },
            provider: 'deepseek' as const,
            model,
          };
        },
        {
          retries: this.options.maxRetries ?? 3,
          ...this.options.retry,
          beforeRetry: () => req.budgetCheck?.(meter.spent(cost())),
        },
      );
    } catch (err) {
      throw withUsage(err, meter.toUsage(cost()));
    }
  }
}
