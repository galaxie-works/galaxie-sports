/**
 * LlmClient para a Anthropic — Messages API com saída JSON via ferramenta (`submit_<schema>`, cujo
 * `input_schema` é o JSON Schema pedido) e a ferramenta de servidor `web_search_20250305`
 * (com `allowed_domains`). Sem busca, a ferramenta de saída é forçada (`tool_choice`); com busca,
 * o modelo pesquisa e termina chamando a ferramenta de saída (se não chamar, pedimos uma vez).
 * Turnos pausados (`pause_turn`) são continuados reenviando o conteúdo do assistente.
 * Docs: platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool.
 */
import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_MAX_OUTPUT_TOKENS } from '../budget.js';
import { classifyProviderError, LlmError } from '../errors.js';
import { assertMatchesSchema, strictSchemaProblems } from '../json-schema.js';
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

interface Block {
  type: string;
  name?: string;
  input?: unknown;
  text?: string;
  citations?: Array<{ type: string; url?: string; title?: string | null }> | null;
  content?: unknown;
}

interface MessageOutput {
  content: Block[];
  stop_reason: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number | null;
    server_tool_use?: { web_search_requests?: number } | null;
  };
}

export interface AnthropicMessagesApi {
  messages: { create(params: Record<string, unknown>): Promise<unknown> };
}

export interface AnthropicClientOptions {
  apiKey?: string;
  models: Record<LlmTier, string>;
  maxRetries?: number;
  timeoutMs?: number;
  /** Máximo de buscas por requisição (max_uses). */
  maxSearches?: number;
  sdk?: AnthropicMessagesApi;
  retry?: Partial<RetryOptions>;
}

/** Continuações (pause_turn / pedido da ferramenta de saída) por chamada. */
const MAX_TURNS = 4;

export class AnthropicLlmClient implements LlmClient {
  private readonly sdk: AnthropicMessagesApi;

  constructor(private readonly options: AnthropicClientOptions) {
    if (!options.sdk && !options.apiKey)
      throw new LlmError('ANTHROPIC_API_KEY ausente (AI_PROVIDER=anthropic).', 'config', false);
    this.sdk =
      options.sdk ??
      (new Anthropic({
        apiKey: options.apiKey,
        maxRetries: 0,
        timeout: options.timeoutMs ?? 180_000,
      }) as unknown as AnthropicMessagesApi);
  }

  submitToolName(req: LlmJsonRequest): string {
    return safeName(req.schemaName, 'submit_');
  }

  buildTools(req: LlmJsonRequest): Record<string, unknown>[] {
    const tools: Record<string, unknown>[] = [];
    if (req.webSearch) {
      const country = countryFromPurpose(req.purpose);
      tools.push({
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: this.options.maxSearches ?? 6,
        ...(req.allowedDomains?.length ? { allowed_domains: req.allowedDomains } : {}),
        ...(country ? { user_location: { type: 'approximate', country } } : {}),
      });
    }
    tools.push({
      name: this.submitToolName(req),
      description:
        'Entrega a resposta final estruturada. Chame exatamente uma vez, ao terminar, com todos os campos do schema.',
      input_schema: req.schema,
      ...(strictSchemaProblems(req.schema).length ? {} : { strict: true }),
    });
    return tools;
  }

  async generateJson<T>(req: LlmJsonRequest): Promise<LlmResult<T>> {
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
      return await withRetry(() => this.once<T>(req, model, meter, cost), {
        retries: this.options.maxRetries ?? 3,
        ...this.options.retry,
      });
    } catch (err) {
      throw withUsage(err, meter.toUsage(cost()));
    }
  }

  private async once<T>(
    req: LlmJsonRequest,
    model: string,
    meter: UsageMeter,
    cost: () => number | undefined,
  ): Promise<LlmResult<T>> {
    const { system, dialog } = splitMessages(req);
    const submit = this.submitToolName(req);
    const tools = this.buildTools(req);
    const messages: { role: 'user' | 'assistant'; content: unknown }[] = dialog.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));
    const citations: LlmCitation[] = [];
    let force = !req.webSearch;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      let res: MessageOutput;
      try {
        res = (await this.sdk.messages.create({
          model,
          max_tokens: req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          system,
          messages,
          tools,
          tool_choice: force ? { type: 'tool', name: submit } : { type: 'auto' },
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        })) as MessageOutput;
      } catch (err) {
        throw classifyProviderError(err, 'anthropic');
      }
      meter.add({
        input: res.usage?.input_tokens,
        output: res.usage?.output_tokens,
        cached: res.usage?.cache_read_input_tokens ?? 0,
        searches: res.usage?.server_tool_use?.web_search_requests ?? 0,
      });
      for (const b of res.content) {
        for (const c of b.citations ?? [])
          if (c.type === 'web_search_result_location' && c.url)
            citations.push({ url: c.url, ...(c.title ? { title: c.title } : {}) });
        if (b.type === 'web_search_tool_result' && Array.isArray(b.content))
          for (const r of b.content as Array<{ type?: string; url?: string; title?: string }>)
            if (r.type === 'web_search_result' && r.url)
              citations.push({ url: r.url, ...(r.title ? { title: r.title } : {}) });
      }

      const call = res.content.find((b) => b.type === 'tool_use' && b.name === submit);
      if (call) {
        const data = assertMatchesSchema<T>(req.schema, call.input, req.schemaName);
        return {
          data,
          citations: dedupeCitations(citations),
          usage: meter.toUsage(cost()),
          provider: 'anthropic',
          model,
        };
      }
      if (res.stop_reason === 'refusal')
        throw new LlmError('anthropic: o modelo recusou a tarefa.', 'refusal', false);
      if (res.stop_reason === 'max_tokens')
        throw new LlmError('anthropic: resposta cortada por max_tokens.', 'incomplete', false);
      messages.push({ role: 'assistant', content: res.content });
      if (res.stop_reason !== 'pause_turn') {
        // Terminou sem a ferramenta de saída: pede a entrega estruturada (forçada).
        messages.push({
          role: 'user',
          content: `Entregue agora a resposta final chamando a ferramenta ${submit}.`,
        });
        force = true;
      }
    }
    throw new LlmError('anthropic: o modelo não entregou a saída estruturada.', 'schema', true);
  }
}
