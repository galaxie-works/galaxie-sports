import type { LlmCitation, LlmJsonRequest, LlmMessage } from '../types.js';
import type { UsageWithSearches } from '../budget.js';

/** Acumula o uso de várias chamadas (retries, continuações) — tudo é cobrado. */
export class UsageMeter {
  inputTokens = 0;
  outputTokens = 0;
  cachedInputTokens = 0;
  webSearchCalls = 0;

  add(u: {
    input?: number | undefined;
    output?: number | undefined;
    cached?: number | undefined;
    searches?: number | undefined;
  }): void {
    this.inputTokens += u.input ?? 0;
    this.outputTokens += u.output ?? 0;
    this.cachedInputTokens += u.cached ?? 0;
    this.webSearchCalls += u.searches ?? 0;
  }

  toUsage(costUsd: number | undefined): UsageWithSearches {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      ...(costUsd !== undefined ? { costUsd } : {}),
      webSearchCalls: this.webSearchCalls,
    };
  }
}

/** Anexa o uso já cobrado ao erro (o orçamento registra mesmo quando a chamada falha). */
export function withUsage<E>(err: E, usage: UsageWithSearches): E {
  if (err && typeof err === 'object') Object.assign(err, { usage });
  return err;
}

/** Nome aceito pelos provedores (a-z, A-Z, 0-9, _ e -, até 64). */
export function safeName(name: string, prefix = ''): string {
  return `${prefix}${name}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

/** Separa mensagens de sistema extras (vão para as instruções) do diálogo. */
export function splitMessages(req: LlmJsonRequest): { system: string; dialog: LlmMessage[] } {
  const extra = req.messages.filter((m) => m.role === 'system').map((m) => m.content);
  return {
    system: [req.system, ...extra].filter(Boolean).join('\n\n'),
    dialog: req.messages.filter((m) => m.role !== 'system'),
  };
}

/**
 * País para localizar a busca: convenção `purpose` terminando em `:<ISO2>` (ex.: `wtw:event:<id>:BR`).
 * Nunca envia dado pessoal — só o país do mercado.
 */
export function countryFromPurpose(purpose: string): string | null {
  const m = /:([A-Z]{2})$/.exec(purpose);
  return m ? m[1]! : null;
}

export function dedupeCitations(list: LlmCitation[]): LlmCitation[] {
  const seen = new Set<string>();
  const out: LlmCitation[] = [];
  for (const c of list) {
    if (!c.url || seen.has(c.url)) continue;
    seen.add(c.url);
    out.push(c);
  }
  return out;
}
