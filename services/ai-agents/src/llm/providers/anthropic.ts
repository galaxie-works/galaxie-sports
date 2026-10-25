/**
 * LlmClient para a Anthropic — Messages API com saída JSON via ferramenta (`submit_<schema>`, cujo
 * `input_schema` é o JSON Schema pedido, com `strict`) e a ferramenta de servidor `web_search_20250305`
 * (com `allowed_domains`). O modelo termina chamando a ferramenta de saída (instrução no system; se não
 * chamar, pedimos de novo). `tool_choice` fica sempre `auto` e `temperature` não vai: os modelos atuais
 * recusam com 400 o `tool_choice` forçado (`tool`/`any`) e o `temperature` fora do padrão.
 * Turnos pausados (`pause_turn`) são continuados reenviando o conteúdo do assistente, com o teto de
 * buscas repartido entre os turnos (o `max_uses` vale por requisição).
 * Docs (conferidas em 2026-10-25): platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
 * e .../tool-use/server-tools.
 */
import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_MAX_OUTPUT_TOKENS } from '../budget.js';
import { classifyProviderError, LlmError } from '../errors.js';
import { assertMatchesSchema, strictSchemaProblems } from '../json-schema.js';
import { estimateCostUsd, WEB_SEARCH_USD_PER_CALL } from '../pricing.js';
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
  id?: string;
  tool_use_id?: string;
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

  /**
   * Ferramentas de um turno. `searchesLeft` é o que sobra do teto de buscas da chamada: o `max_uses` da API
   * vale por requisição e cada continuação (`pause_turn`) é uma requisição nova, então o teto é repartido
   * entre os turnos. Esgotado, a busca sai da lista — exceto se o turno pausado deixou uma busca pendente
   * (`server_tool_use` sem resultado): a API exige a mesma ferramenta na continuação, que roda só essa.
   */
  buildTools(req: LlmJsonRequest, searchesLeft?: number, pendingSearch = false): Record<string, unknown>[] {
    const tools: Record<string, unknown>[] = [];
    const cap = req.maxSearches ?? this.options.maxSearches ?? 6;
    const left = Math.min(cap, searchesLeft ?? cap);
    if (req.webSearch && (left > 0 || pendingSearch)) {
      const country = countryFromPurpose(req.purpose);
      tools.push({
        type: 'web_search_20250305',
        name: 'web_search',
        // teto de buscas da chamada (AI_MAX_SEARCHES_PER_CALL, via orçamento), menos o já gasto nos turnos
        max_uses: Math.max(1, left),
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
        WEB_SEARCH_USD_PER_CALL,
        'anthropic',
      );
    // cada retentativa e cada continuação são pagas de novo: o orçamento confere o gasto parcial antes
    const checkBudget = () => req.budgetCheck?.(meter.spent(cost()));
    try {
      return await withRetry(() => this.once<T>(req, model, meter, cost, checkBudget), {
        retries: this.options.maxRetries ?? 3,
        ...this.options.retry,
        beforeRetry: checkBudget,
      });
    } catch (err) {
      throw withUsage(err, meter.toUsage(cost()));
    }
  }

  private async once<T>(
    req: LlmJsonRequest,
    model: string,
    meter: UsageMeter,
    cost: () => number,
    checkBudget: () => void,
  ): Promise<LlmResult<T>> {
    const { system, dialog } = splitMessages(req);
    const submit = this.submitToolName(req);
    const messages: { role: 'user' | 'assistant'; content: unknown }[] = dialog.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));
    const citations: LlmCitation[] = [];
    const cap = req.maxSearches ?? this.options.maxSearches ?? 6;
    let searches = 0;
    let pendingSearch = false;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (turn > 0) checkBudget();
      let res: MessageOutput;
      try {
        // `tool_choice` forçado (`tool`/`any`) dá 400 nos modelos atuais: `auto` + instrução no system,
        // `strict` na ferramenta de saída e, se o modelo não chamar, o pedido explícito abaixo
        res = (await this.sdk.messages.create({
          model,
          max_tokens: req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          system: [system, submitNote(submit)].filter(Boolean).join('\n\n'),
          messages,
          tools: this.buildTools(req, cap - searches, pendingSearch),
          tool_choice: { type: 'auto' },
        })) as MessageOutput;
      } catch (err) {
        throw classifyProviderError(err, 'anthropic');
      }
      const turnSearches = res.usage?.server_tool_use?.web_search_requests ?? 0;
      searches += turnSearches;
      meter.add({
        input: res.usage?.input_tokens,
        output: res.usage?.output_tokens,
        cached: res.usage?.cache_read_input_tokens ?? 0,
        searches: turnSearches,
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
      pendingSearch = res.stop_reason === 'pause_turn' && hasPendingServerTool(res.content);
      if (res.stop_reason !== 'pause_turn') {
        // Terminou sem a ferramenta de saída: pede a entrega estruturada.
        messages.push({
          role: 'user',
          content: `Entregue agora a resposta final chamando a ferramenta ${submit}.`,
        });
      }
    }
    throw new LlmError('anthropic: o modelo não entregou a saída estruturada.', 'schema', true);
  }
}

/** Instrução de entrega (substitui o `tool_choice` forçado, recusado pelos modelos atuais). */
function submitNote(submit: string): string {
  return `Ao terminar, entregue a resposta final chamando a ferramenta ${submit} exatamente uma vez, com todos os campos do schema; não responda em texto.`;
}

/** O turno pausado terminou com uma chamada de ferramenta de servidor ainda sem resultado. */
function hasPendingServerTool(content: Block[]): boolean {
  const done = new Set(content.filter((b) => b.tool_use_id).map((b) => b.tool_use_id));
  return content.some((b) => b.type === 'server_tool_use' && !(b.id && done.has(b.id)));
}
