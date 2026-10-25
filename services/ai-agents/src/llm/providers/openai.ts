/**
 * LlmClient para a OpenAI — Responses API com saídas estruturadas (`text.format` json_schema estrito)
 * e a ferramenta nativa `web_search` (com `filters.allowed_domains`, até 100 domínios).
 * Docs: developers.openai.com/api/docs/guides/structured-outputs e .../tools-web-search.
 */
import OpenAI from 'openai';
import { DEFAULT_MAX_OUTPUT_TOKENS } from '../budget.js';
import { classifyProviderError, LlmError } from '../errors.js';
import { assertMatchesSchema, parseJsonOutput, strictSchemaProblems } from '../json-schema.js';
import { estimateCostUsd } from '../pricing.js';
import { withRetry, type RetryOptions } from '../retry.js';
import type { LlmCitation, LlmClient, LlmJsonRequest, LlmResult, LlmTier } from '../types.js';
import {
  countryFromPurpose,
  dedupeCitations,
  safeName,
  splitMessages,
  UsageMeter,
  withUsage,
} from './common.js';

/** Subconjunto da resposta da Responses API que usamos (robusto a campos novos). */
interface ResponsesOutput {
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output_text?: string;
  output?: Array<{
    type: string;
    content?: Array<{
      type: string;
      text?: string;
      refusal?: string;
      annotations?: Array<{ type: string; url?: string; title?: string }>;
    }>;
    action?: { sources?: Array<{ type?: string; url?: string }> };
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
  } | null;
}

/** O mínimo do SDK que usamos (permite injetar um falso nos testes). */
export interface OpenAiResponsesApi {
  responses: { create(params: Record<string, unknown>): Promise<unknown> };
}

export interface OpenAiClientOptions {
  apiKey?: string;
  models: Record<LlmTier, string>;
  maxRetries?: number;
  timeoutMs?: number;
  /** SDK injetado (testes). */
  sdk?: OpenAiResponsesApi;
  retry?: Partial<RetryOptions>;
}

export const OPENAI_MAX_ALLOWED_DOMAINS = 100;

/** A API recusou `temperature` para o modelo (os modelos de raciocínio não aceitam o parâmetro). */
function rejectsTemperature(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /unsupported parameter:\s*'?temperature/i.test(message);
}

export class OpenAiLlmClient implements LlmClient {
  private readonly sdk: OpenAiResponsesApi;
  /** Modelos que já recusaram `temperature` neste processo: as chamadas seguintes saem sem ele. */
  private readonly withoutTemperature = new Set<string>();

  constructor(private readonly options: OpenAiClientOptions) {
    if (!options.sdk && !options.apiKey)
      throw new LlmError('OPENAI_API_KEY ausente (AI_PROVIDER=openai).', 'config', false);
    this.sdk =
      options.sdk ??
      (new OpenAI({
        apiKey: options.apiKey,
        maxRetries: 0, // retries com backoff ficam na nossa camada (withRetry)
        timeout: options.timeoutMs ?? 180_000,
      }) as unknown as OpenAiResponsesApi);
  }

  /** Monta os parâmetros da Responses API (exposto para teste). */
  buildParams(req: LlmJsonRequest, model: string): Record<string, unknown> {
    const { system, dialog } = splitMessages(req);
    const params: Record<string, unknown> = {
      model,
      instructions: system,
      input: dialog.map((m) => ({ role: m.role, content: m.content })),
      text: {
        format: { type: 'json_schema', name: safeName(req.schemaName), schema: req.schema, strict: true },
      },
      max_output_tokens: req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      store: false,
    };
    if (req.temperature !== undefined && !this.withoutTemperature.has(model))
      params.temperature = req.temperature;
    if (req.webSearch) {
      const country = countryFromPurpose(req.purpose);
      const tool: Record<string, unknown> = {
        type: 'web_search',
        // sem país, `approximate` vazio evita o padrão "EUA" do provedor
        user_location: country ? { type: 'approximate', country } : { type: 'approximate' },
      };
      if (req.allowedDomains?.length)
        tool.filters = { allowed_domains: req.allowedDomains.slice(0, OPENAI_MAX_ALLOWED_DOMAINS) };
      params.tools = [tool];
      params.tool_choice = 'auto';
      // teto de buscas da chamada (AI_MAX_SEARCHES_PER_CALL, via orçamento): a única ferramenta embutida
      // é a busca, então max_tool_calls limita as buscas
      if (req.maxSearches !== undefined) params.max_tool_calls = req.maxSearches;
      params.include = ['web_search_call.action.sources'];
    }
    return params;
  }

  async generateJson<T>(req: LlmJsonRequest): Promise<LlmResult<T>> {
    const problems = strictSchemaProblems(req.schema);
    if (problems.length)
      throw new LlmError(
        `Schema ${req.schemaName} incompatível com o modo estrito: ${problems.join('; ')}`,
        'config',
        false,
      );
    const model = req.model ?? this.options.models[req.tier];
    const meter = new UsageMeter();
    const cost = () =>
      estimateCostUsd(
        model,
        {
          inputTokens: meter.inputTokens,
          outputTokens: meter.outputTokens,
          cachedInputTokens: meter.cachedInputTokens,
        },
        meter.webSearchCalls,
      );
    try {
      return await withRetry(
        async () => {
          const res = await this.create(this.buildParams(req, model), model);
          const output = res.output ?? [];
          meter.add({
            input: res.usage?.input_tokens,
            output: res.usage?.output_tokens,
            cached: res.usage?.input_tokens_details?.cached_tokens,
            searches: output.filter((o) => o.type === 'web_search_call').length,
          });
          const refusal = output.flatMap((o) => o.content ?? []).find((c) => c.type === 'refusal');
          if (refusal)
            throw new LlmError(`openai: o modelo recusou (${refusal.refusal ?? ''}).`, 'refusal', false);
          if (res.status === 'incomplete')
            throw new LlmError(
              `openai: resposta incompleta (${res.incomplete_details?.reason ?? 'desconhecido'}).`,
              'incomplete',
              false,
            );
          const text =
            res.output_text ??
            output
              .flatMap((o) => o.content ?? [])
              .filter((c) => c.type === 'output_text')
              .map((c) => c.text ?? '')
              .join('');
          const data = assertMatchesSchema<T>(
            req.schema,
            parseJsonOutput(text, req.schemaName),
            req.schemaName,
          );
          const citations: LlmCitation[] = [];
          for (const o of output) {
            for (const c of o.content ?? [])
              for (const a of c.annotations ?? [])
                if (a.type === 'url_citation' && a.url)
                  citations.push({ url: a.url, ...(a.title ? { title: a.title } : {}) });
          }
          for (const o of output)
            for (const s of o.action?.sources ?? []) if (s.url) citations.push({ url: s.url });
          return {
            data,
            citations: dedupeCitations(citations),
            usage: meter.toUsage(cost()),
            provider: 'openai' as const,
            model,
          };
        },
        { retries: this.options.maxRetries ?? 3, ...this.options.retry },
      );
    } catch (err) {
      throw withUsage(err, meter.toUsage(cost()));
    }
  }

  /** Chama a API; se o modelo recusar `temperature`, repete na hora sem o parâmetro e lembra do modelo. */
  private async create(params: Record<string, unknown>, model: string): Promise<ResponsesOutput> {
    try {
      return (await this.sdk.responses.create(params)) as ResponsesOutput;
    } catch (err) {
      if (!('temperature' in params) || !rejectsTemperature(err)) throw classifyProviderError(err, 'openai');
      this.withoutTemperature.add(model);
      const { temperature: _dropped, ...rest } = params;
      try {
        return (await this.sdk.responses.create(rest)) as ResponsesOutput;
      } catch (retryErr) {
        throw classifyProviderError(retryErr, 'openai');
      }
    }
  }
}
