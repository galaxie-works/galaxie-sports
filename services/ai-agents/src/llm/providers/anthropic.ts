/**
 * LlmClient para a Anthropic — Messages API com saída JSON via ferramenta (`submit_<schema>`, cujo
 * `input_schema` é o JSON Schema pedido, com `strict`) e a ferramenta de servidor `web_search_20250305`
 * (com `allowed_domains`). O modelo termina chamando a ferramenta de saída (instrução no system; se não
 * chamar, pedimos de novo). `tool_choice` fica sempre `auto` e `temperature` não vai: os modelos atuais
 * recusam com 400 o `tool_choice` forçado (`tool`/`any`) e o `temperature` fora do padrão.
 *
 * Teto de buscas: vale para a chamada inteira (tentativas e turnos), mas o `max_uses` da API vale por
 * requisição e a lista de ferramentas não pode mudar dentro da conversa (o raciocínio dos modelos atuais
 * fica preso a `system`, `tools` e histórico). Então cada conversa declara `max_uses` = metade do que
 * sobra do teto, o que deixa caber pelo menos uma continuação de `pause_turn` (ou um pedido de entrega)
 * depois de um turno que gastou tudo; uma requisição a mais só sai se o pior caso dela couber no teto.
 * Quando não cabe, a entrega sai numa conversa nova, sem busca, com o texto, as fontes e os trechos
 * citados da pesquisa já paga.
 * Docs (conferidas em 2026-10-25): platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
 * e .../tool-use/server-tools.
 */
import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_MAX_OUTPUT_TOKENS } from '../budget.js';
import { classifyProviderError, LlmError } from '../errors.js';
import { assertMatchesSchema, strictSchemaProblems } from '../json-schema.js';
import { estimateCostUsd, WEB_SEARCH_USD_PER_CALL } from '../pricing.js';
import { withRetry, type RetryOptions } from '../retry.js';
import type { LlmCitation, LlmClient, LlmJsonRequest, LlmMessage, LlmResult, LlmTier } from '../types.js';
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
  citations?: Array<{ type: string; url?: string; title?: string | null; cited_text?: string }> | null;
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
  /** Máximo de buscas por chamada quando o pedido não traz `maxSearches`. */
  maxSearches?: number;
  sdk?: AnthropicMessagesApi;
  retry?: Partial<RetryOptions>;
}

/** Requisições por tentativa (continuações de pause_turn, pedidos de entrega). */
const MAX_TURNS = 4;
/** Trechos citados por fonte que vão para a conversa de entrega (e o tamanho da entrada recusada). */
const MAX_QUOTES_PER_SOURCE = 4;
const MAX_REJECTED_CHARS = 4_000;

type Turn = { role: 'user' | 'assistant'; content: unknown };

/** O que a chamada já pagou e serve às tentativas seguintes. */
interface CallNotes {
  /** Texto do modelo nas conversas com busca. */
  texts: string[];
  citations: LlmCitation[];
  /** Trechos citados (`cited_text`) por URL. */
  quotes: Map<string, string[]>;
  /** Última entrega recusada pelo schema: vai para a próxima tentativa corrigir. */
  rejected?: { input: unknown; error: string };
}

/** `max_uses` de uma conversa: metade do que sobra do teto (mín. 1), para caber uma continuação. */
export function searchUsesFor(left: number): number {
  return left <= 0 ? 0 : Math.max(1, Math.floor(left / 2));
}

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

  /** Teto de buscas da chamada (AI_MAX_SEARCHES_PER_CALL, via orçamento); 0 sem busca. */
  searchCap(req: LlmJsonRequest): number {
    return req.webSearch ? (req.maxSearches ?? this.options.maxSearches ?? 6) : 0;
  }

  /**
   * Ferramentas de uma conversa: `searchUses` ≥ 1 declara a busca com esse `max_uses`; 0 deixa só a
   * ferramenta de saída. A lista não muda dentro de uma conversa (ver o cabeçalho).
   */
  buildTools(req: LlmJsonRequest, searchUses = this.searchCap(req)): Record<string, unknown>[] {
    const tools: Record<string, unknown>[] = [];
    if (req.webSearch && searchUses >= 1) {
      const country = countryFromPurpose(req.purpose);
      tools.push({
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: searchUses,
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
    // a pesquisa já paga vale para todas as tentativas, como o passo 1 do Gemini
    const notes: CallNotes = { texts: [], citations: [], quotes: new Map() };
    try {
      return await withRetry(() => this.once<T>(req, model, meter, cost, checkBudget, notes), {
        retries: this.options.maxRetries ?? 3,
        ...this.options.retry,
        beforeRetry: checkBudget,
      });
    } catch (err) {
      throw withUsage(err, meter.toUsage(cost()));
    }
  }

  /**
   * Uma tentativa: a conversa com busca (ou, se outra tentativa já pagou buscas, direto a de entrega).
   * Mais uma requisição na mesma conversa só sai se buscas feitas + `max_uses` couberem no teto.
   */
  private async once<T>(
    req: LlmJsonRequest,
    model: string,
    meter: UsageMeter,
    cost: () => number,
    checkBudget: () => void,
    notes: CallNotes,
  ): Promise<LlmResult<T>> {
    const { system, dialog } = splitMessages(req);
    const submit = this.submitToolName(req);
    const cap = this.searchCap(req);
    // sem busca paga, a tentativa nova refaz a conversa normal com o teto inteiro
    const researched = meter.webSearchCalls > 0 || notes.citations.length > 0;
    let delivery = req.webSearch === true && researched;
    let searchUses = delivery ? 0 : searchUsesFor(cap - meter.webSearchCalls);
    let messages: Turn[] = delivery
      ? deliveryMessages(dialog, notes)
      : withFeedback(dialogTurns(dialog), notes);

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (turn > 0) checkBudget();
      let res: MessageOutput;
      try {
        // `tool_choice` forçado (`tool`/`any`) dá 400 nos modelos atuais: `auto` + instrução no system,
        // `strict` na ferramenta de saída e, se o modelo não chamar, o pedido explícito abaixo
        res = (await this.sdk.messages.create({
          model,
          max_tokens: req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          system: [system, delivery ? deliveryNote(notes) : '', submitNote(submit)]
            .filter(Boolean)
            .join('\n\n'),
          messages,
          tools: this.buildTools(req, searchUses),
          tool_choice: { type: 'auto' },
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
      collect(res.content, notes, req.webSearch === true && !delivery);

      const call = res.content.find((b) => b.type === 'tool_use' && b.name === submit);
      if (call) {
        let data: T;
        try {
          data = assertMatchesSchema<T>(req.schema, call.input, req.schemaName);
        } catch (err) {
          notes.rejected = { input: call.input, error: err instanceof Error ? err.message : String(err) };
          throw err;
        }
        return {
          data,
          citations: dedupeCitations(notes.citations),
          usage: meter.toUsage(cost()),
          provider: 'anthropic',
          model,
        };
      }
      if (res.stop_reason === 'refusal')
        throw new LlmError('anthropic: o modelo recusou a tarefa.', 'refusal', false);
      if (res.stop_reason === 'max_tokens')
        throw new LlmError('anthropic: resposta cortada por max_tokens.', 'incomplete', false);
      if (searchUses > 0 && meter.webSearchCalls + searchUses > cap) {
        // mais uma requisição nesta conversa poderia passar do teto: entrega numa conversa nova, sem busca
        delivery = true;
        searchUses = 0;
        messages = deliveryMessages(dialog, notes);
        continue;
      }
      messages.push({ role: 'assistant', content: res.content });
      if (res.stop_reason !== 'pause_turn') {
        // Terminou sem a ferramenta de saída: pede a entrega estruturada.
        messages.push({
          role: 'user',
          content: `Entregue agora a resposta final chamando a ferramenta ${submit}.`,
        });
      }
    }
    // não retentável: outra tentativa repetiria requisições pagas sem motivo para dar diferente
    throw new LlmError('anthropic: o modelo não entregou a saída estruturada.', 'schema', false);
  }
}

/** Guarda fontes, trechos citados e (na conversa com busca) o texto do modelo. */
function collect(content: Block[], notes: CallNotes, keepText: boolean): void {
  for (const b of content) {
    if (keepText && b.type === 'text' && b.text?.trim()) notes.texts.push(b.text.trim());
    for (const c of b.citations ?? [])
      if (c.type === 'web_search_result_location' && c.url) {
        notes.citations.push({ url: c.url, ...(c.title ? { title: c.title } : {}) });
        const quote = c.cited_text?.replace(/\s+/g, ' ').trim();
        const list = notes.quotes.get(c.url) ?? [];
        if (quote && !list.includes(quote) && list.length < MAX_QUOTES_PER_SOURCE) list.push(quote);
        notes.quotes.set(c.url, list);
      }
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content))
      for (const r of b.content as Array<{ type?: string; url?: string; title?: string }>)
        if (r.type === 'web_search_result' && r.url)
          notes.citations.push({ url: r.url, ...(r.title ? { title: r.title } : {}) });
  }
}

const dialogTurns = (dialog: LlmMessage[]): Turn[] =>
  dialog.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

/** Recusa da entrega anterior (entrada e erro do schema), para a tentativa nova corrigir. */
function rejectedNote(notes: CallNotes): string {
  if (!notes.rejected) return '';
  const input = JSON.stringify(notes.rejected.input) ?? 'null';
  const shown = input.length > MAX_REJECTED_CHARS ? `${input.slice(0, MAX_REJECTED_CHARS)}…` : input;
  return `## Entrega anterior recusada\nA chamada anterior da ferramenta de saída não seguiu o schema (${notes.rejected.error}). Entrada recusada: ${shown}\nCorrija e entregue de novo.`;
}

function withFeedback(turns: Turn[], notes: CallNotes): Turn[] {
  const note = rejectedNote(notes);
  return note ? [...turns, { role: 'user', content: note }] : turns;
}

/** Instrução da conversa de entrega; "sem fonte não entra" só quando há fontes na lista. */
function deliveryNote(notes: CallNotes): string {
  const base =
    'A pesquisa na web desta tarefa já foi feita e não há mais busca disponível: use o resultado e as fontes da última mensagem.';
  return notes.citations.length
    ? `${base} Toda afirmação tirada da web precisa de uma fonte da lista; sem fonte, não entra.`
    : base;
}

/**
 * Conversa de entrega: o diálogo original (com os papéis, inclusive exemplos do assistente) e uma
 * mensagem com o texto da pesquisa já paga, as fontes com os trechos citados e a entrega recusada, se houver.
 */
function deliveryMessages(dialog: LlmMessage[], notes: CallNotes): Turn[] {
  const sources = dedupeCitations(notes.citations)
    .map((c) => {
      const quotes = (notes.quotes.get(c.url) ?? []).map((q) => `\n   - "${q}"`).join('');
      return `- ${c.url}${c.title ? ` (${c.title})` : ''}${quotes}`;
    })
    .join('\n');
  const content = [
    `## Resultado da pesquisa\n${notes.texts.join('\n\n') || '(o modelo não deixou texto da pesquisa)'}`,
    `## Fontes encontradas\n${sources || '(nenhuma)'}`,
    rejectedNote(notes),
  ]
    .filter(Boolean)
    .join('\n\n');
  return [...dialogTurns(dialog), { role: 'user', content }];
}

/** Instrução de entrega (substitui o `tool_choice` forçado, recusado pelos modelos atuais). */
function submitNote(submit: string): string {
  return `Ao terminar, entregue a resposta final chamando a ferramenta ${submit} exatamente uma vez, com todos os campos do schema; não responda em texto.`;
}
