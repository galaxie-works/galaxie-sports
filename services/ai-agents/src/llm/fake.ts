/**
 * Cliente falso para testes: nenhuma chamada real a provedor. Responde a partir de uma fila de
 * respostas ou de uma função, valida a saída contra o schema (como os provedores reais) e
 * registra as requisições recebidas.
 */
import type { UsageWithSearches } from './budget.js';
import { assertMatchesSchema } from './json-schema.js';
import type { LlmCitation, LlmClient, LlmJsonRequest, LlmResult } from './types.js';

export interface FakeResponse {
  data: unknown;
  citations?: LlmCitation[];
  usage?: Partial<UsageWithSearches>;
  model?: string;
  /** Simula o provedor que garante as URLs da busca (Gemini em dois passos). */
  groundedUrls?: string[];
}

export type FakeReply = FakeResponse | Error;
export type FakeHandler = (req: LlmJsonRequest, call: number) => FakeReply | Promise<FakeReply>;

export class FakeLlmClient implements LlmClient {
  readonly calls: LlmJsonRequest[] = [];
  private readonly queue: FakeReply[];
  private readonly handler: FakeHandler | undefined;

  constructor(
    replies: FakeReply[] | FakeHandler = [],
    private readonly options: { validate?: boolean } = {},
  ) {
    this.queue = Array.isArray(replies) ? [...replies] : [];
    this.handler = Array.isArray(replies) ? undefined : replies;
  }

  /** Enfileira mais respostas. */
  push(...replies: FakeReply[]): this {
    this.queue.push(...replies);
    return this;
  }

  async generateJson<T>(req: LlmJsonRequest): Promise<LlmResult<T>> {
    const call = this.calls.length;
    this.calls.push(req);
    const reply = this.queue.length
      ? this.queue.shift()!
      : this.handler
        ? await this.handler(req, call)
        : undefined;
    if (!reply) throw new Error(`FakeLlmClient: sem resposta para a chamada ${call} (${req.purpose}).`);
    if (reply instanceof Error) throw reply;
    const data =
      this.options.validate === false
        ? (reply.data as T)
        : assertMatchesSchema<T>(req.schema, reply.data, req.schemaName);
    const promptChars = req.system.length + req.messages.reduce((s, m) => s + m.content.length, 0);
    const usage: UsageWithSearches = {
      inputTokens: reply.usage?.inputTokens ?? Math.ceil(promptChars / 4),
      outputTokens: reply.usage?.outputTokens ?? Math.ceil(JSON.stringify(reply.data).length / 4),
      ...(reply.usage?.costUsd !== undefined ? { costUsd: reply.usage.costUsd } : {}),
      webSearchCalls: reply.usage?.webSearchCalls ?? (req.webSearch ? 1 : 0),
    };
    return {
      data,
      citations: reply.citations ?? [],
      usage,
      provider: 'fake',
      model: reply.model ?? req.model ?? `fake-${req.tier}`,
      ...(reply.groundedUrls ? { groundedUrls: reply.groundedUrls } : {}),
    };
  }
}
