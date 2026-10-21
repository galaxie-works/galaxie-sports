import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import type { Database } from './client.js';
import { eventContext } from './schema/index.js';

/** Tipos de texto gerado por evento (docs/07 §2.3). */
export type EventContextKind = 'scenario' | 'recap';
export const EVENT_CONTEXT_KINDS: readonly EventContextKind[] = ['scenario', 'recap'];

/** Fonte citada por um texto gerado (core, regulamento, base semântica, citação do LLM). */
export interface EventContextSource {
  kind: 'core' | 'rules' | 'knowledge' | 'llm';
  ref: string;
  url?: string;
}

/** Campos mínimos do `content` gravado pelos agentes de cenário/resumo (`services/ai-agents`). */
export interface EventContextContentBase {
  text: string;
  sentences: string[];
  origin: 'llm' | 'fallback';
  generatedAt: string;
  /** Superfícies em que o texto cabe (tv, mobile, web). */
  fits: Record<string, boolean>;
}

export interface EventContextRow<C extends EventContextContentBase = EventContextContentBase> {
  eventId: string;
  locale: string;
  kind: string;
  content: C;
  sources: EventContextSource[];
  model: string;
  confidence: number | null;
  reviewStatus: string;
  createdAt: Date;
}

/**
 * Versão mais recente por (tipo, locale) do cenário/resumo de um evento em `enrich.event_context`,
 * ignorando as linhas `rejected` pela revisão editorial. Leitura compartilhada pelos agentes
 * (não regenerar o que não mudou) e pela API (`GET /v1/events/{id}/context`).
 */
export async function readEventContext<C extends EventContextContentBase = EventContextContentBase>(
  db: Pick<Database, 'select'>,
  eventId: string,
  options: { kinds?: readonly string[]; locales?: readonly string[] } = {},
): Promise<EventContextRow<C>[]> {
  const filters = [eq(eventContext.eventId, eventId), ne(eventContext.reviewStatus, 'rejected')];
  if (options.kinds?.length) filters.push(inArray(eventContext.kind, [...options.kinds]));
  if (options.locales?.length) filters.push(inArray(eventContext.locale, [...options.locales]));
  const rows = await db
    .select()
    .from(eventContext)
    .where(and(...filters))
    .orderBy(desc(eventContext.createdAt));
  const latest = new Map<string, EventContextRow<C>>();
  for (const r of rows) {
    const key = `${r.kind}|${r.locale}`;
    if (latest.has(key)) continue;
    latest.set(key, {
      eventId: r.eventId,
      locale: r.locale,
      kind: r.kind,
      content: r.content as C,
      sources: r.sources as EventContextSource[],
      model: r.model,
      confidence: r.confidence === null ? null : Number(r.confidence),
      reviewStatus: r.reviewStatus,
      createdAt: r.createdAt,
    });
  }
  return [...latest.values()].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.locale.localeCompare(b.locale),
  );
}
