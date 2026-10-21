import type { LlmCitation, LlmClient, LlmJsonRequest, LlmResult, LlmUsage } from '../llm/types.js';

/**
 * Cliente LLM falso para testes (nunca chama provedor real). Responde com uma fila de respostas
 * ou com uma função; uma resposta `Error` é lançada (simula falha/orçamento estourado).
 */
export type FakeResponse = unknown;
export type FakeResponder = (req: LlmJsonRequest, call: number) => FakeResponse | Promise<FakeResponse>;

export interface FakeLlmOptions {
  model?: string;
  usage?: LlmUsage;
  citations?: LlmCitation[];
}

export class FakeLlmClient implements LlmClient {
  readonly requests: LlmJsonRequest[] = [];
  private readonly queue: FakeResponse[];

  constructor(
    private readonly responder: FakeResponder | FakeResponse[],
    private readonly options: FakeLlmOptions = {},
  ) {
    this.queue = Array.isArray(responder) ? [...responder] : [];
  }

  get calls(): number {
    return this.requests.length;
  }

  async generateJson<T>(req: LlmJsonRequest): Promise<LlmResult<T>> {
    this.requests.push(req);
    const n = this.requests.length;
    let data: FakeResponse;
    if (typeof this.responder === 'function') data = await this.responder(req, n);
    else {
      if (!this.queue.length) throw new Error('FakeLlmClient: fila de respostas vazia.');
      data = this.queue.length > 1 ? this.queue.shift() : this.queue[0];
    }
    if (data instanceof Error) throw data;
    return {
      data: structuredClone(data) as T,
      citations: this.options.citations ?? [],
      usage: this.options.usage ?? { inputTokens: 1000, outputTokens: 200, costUsd: 0.002 },
      provider: 'fake',
      model: this.options.model ?? 'fake-standard',
    };
  }
}
