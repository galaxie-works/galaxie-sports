/**
 * LlmClient para a Anthropic — Messages API com saída JSON via ferramenta (`submit_<schema>`, cujo
 * `input_schema` é o JSON Schema pedido, com `strict`) e a ferramenta de servidor `web_search_20250305`
 * (com `allowed_domains`). O modelo termina chamando a ferramenta de saída (instrução no system; se não
 * chamar, pedimos de novo). `tool_choice` fica sempre `auto` e `temperature` não vai: os modelos atuais
 * recusam com 400 o `tool_choice` forçado (`tool`/`any`) e o `temperature` fora do padrão.
 * Turnos pausados (`pause_turn`) são continuados reenviando o conteúdo do assistente, enquanto o pior
 * caso da próxima requisição couber no teto de buscas da chamada (o `max_uses` vale por requisição e a
 * lista de ferramentas não muda dentro da conversa); senão a entrega sai numa conversa nova, sem busca.
 * Docs (conferidas em 2026-10-25): platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool,
 * .../tool-use/server-tools e .../api/messages/create (`max_uses` mínimo 1).
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
  /** Máximo de buscas por chamada quando o pedido não traz `maxSearches`. */
  maxSearches?: number;
  sdk?: AnthropicMessagesApi;
  retry?: Partial<RetryOptions>;
}

/** Requisições por tentativa (continuações de pause_turn, pedidos de entrega). */
const MAX_TURNS = 4;

/** Texto e fontes da pesquisa já paga (somados entre as tentativas). */
interface ResearchNotes {
  texts: string[];
  citations: LlmCitation[];
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
   * Ferramentas de uma conversa. `searchUses` (≥ 1) declara a busca com esse `max_uses` (o mínimo da
   * API é 1); 0 deixa só a ferramenta de saída. A lista não muda dentro de uma conversa: nos modelos
   * atuais o bloco de raciocínio fica preso ao `system`, às `tools` e ao histórico, e mudar as
   * ferramentas entre requisições da mesma conversa invalida os blocos já devolvidos (400).
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
    // a pesquisa já paga (texto e fontes) vale para todas as tentativas, como o passo 1 do Gemini
    const notes: ResearchNotes = { texts: [], citations: [] };
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
   * Uma tentativa. O teto de buscas vale para a chamada inteira (tentativas e turnos), o `max_uses` da
   * API vale por requisição e a lista de ferramentas não pode mudar dentro da conversa. Então a conversa
   * com busca declara `max_uses` = o que sobra do teto e só manda mais uma requisição (continuação de
   * `pause_turn` ou pedido de entrega) se o pior caso dela ainda couber no teto. Se não couber, ou se
   * outra tentativa já pesquisou, a entrega sai numa conversa nova sem busca, com o texto e as fontes da
   * pesquisa já paga.
   */
  private async once<T>(
    req: LlmJsonRequest,
    model: string,
    meter: UsageMeter,
    cost: () => number,
    checkBudget: () => void,
    notes: ResearchNotes,
  ): Promise<LlmResult<T>> {
    const { system, dialog } = splitMessages(req);
    const submit = this.submitToolName(req);
    const cap = this.searchCap(req);
    const researched = meter.webSearchCalls > 0 || notes.texts.length > 0 || notes.citations.length > 0;
    let delivery = req.webSearch === true && researched;
    let searchUses = delivery ? 0 : Math.max(0, cap - meter.webSearchCalls);
    let messages: { role: 'user' | 'assistant'; content: unknown }[] = delivery
      ? deliveryMessages(dialog, notes)
      : dialog.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (turn > 0) checkBudget();
      let res: MessageOutput;
      try {
        // `tool_choice` forçado (`tool`/`any`) dá 400 nos modelos atuais: `auto` + instrução no system,
        // `strict` na ferramenta de saída e, se o modelo não chamar, o pedido explícito abaixo
        res = (await this.sdk.messages.create({
          model,
          max_tokens: req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          system: [system, delivery ? DELIVERY_NOTE : '', submitNote(submit)].filter(Boolean).join('\n\n'),
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
      for (const b of res.content) {
        if (b.type === 'text' && b.text?.trim()) notes.texts.push(b.text.trim());
        for (const c of b.citations ?? [])
          if (c.type === 'web_search_result_location' && c.url)
            notes.citations.push({ url: c.url, ...(c.title ? { title: c.title } : {}) });
        if (b.type === 'web_search_tool_result' && Array.isArray(b.content))
          for (const r of b.content as Array<{ type?: string; url?: string; title?: string }>)
            if (r.type === 'web_search_result' && r.url)
              notes.citations.push({ url: r.url, ...(r.title ? { title: r.title } : {}) });
      }

      const call = res.content.find((b) => b.type === 'tool_use' && b.name === submit);
      if (call) {
        const data = assertMatchesSchema<T>(req.schema, call.input, req.schemaName);
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

/** Instrução da conversa de entrega (sem busca, sobre a pesquisa já feita). */
export const DELIVERY_NOTE =
  'A pesquisa na web desta tarefa já foi feita e não há mais busca disponível: use só o resultado e as fontes abaixo. Afirmação sem fonte da lista não entra.';

/** Conversa de entrega: o pedido original, o texto da pesquisa já paga e as fontes encontradas. */
function deliveryMessages(dialog: LlmMessage[], notes: ResearchNotes): { role: 'user'; content: string }[] {
  const sources = dedupeCitations(notes.citations)
    .map((c) => `- ${c.url}${c.title ? ` (${c.title})` : ''}`)
    .join('\n');
  const content = [
    dialog.map((m) => m.content).join('\n\n'),
    `## Resultado da pesquisa\n${notes.texts.join('\n\n') || '(sem texto)'}`,
    `## Fontes encontradas\n${sources || '(nenhuma)'}`,
  ].join('\n\n');
  return [{ role: 'user', content }];
}

/** Instrução de entrega (substitui o `tool_choice` forçado, recusado pelos modelos atuais). */
function submitNote(submit: string): string {
  return `Ao terminar, entregue a resposta final chamando a ferramenta ${submit} exatamente uma vez, com todos os campos do schema; não responda em texto.`;
}
