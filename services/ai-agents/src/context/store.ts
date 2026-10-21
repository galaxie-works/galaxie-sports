import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { eventContext, publishChange, type Database } from '@galaxie/db';
import { surfaceFit, type Surface } from '../guardrails/index.js';
import type { LlmUsage } from '../llm/types.js';
import { confidenceOf, type LocaleText } from './writer.js';

/**
 * Persistência em `enrich.event_context` (histórico: uma linha por evento × locale × tipo ×
 * geração) e aviso no change feed (`event.context_published`) para purge de cache e webhooks.
 */

export type ContextKind = 'scenario' | 'recap';

/** Tópico do change feed / webhook (docs/05 §8). */
export const CONTEXT_PUBLISHED_TOPIC = 'event.context_published';

export interface ContextSource {
  /** core (dados do provedor normalizados), rules (regulamento), knowledge (base semântica), llm (citação). */
  kind: 'core' | 'rules' | 'knowledge' | 'llm';
  ref: string;
  url?: string;
}

export interface ContextRunInfo {
  id: string;
  llmCalls: number;
  usage: LlmUsage;
  model: string | null;
  errors: string[];
}

/** Conteúdo JSON de cada linha (o texto + rastreabilidade da geração). */
export interface StoredContextContent {
  text: string;
  sentences: string[];
  origin: LocaleText['origin'];
  attempts: number;
  /** Tentativas reprovadas: tipo e valor das violações (auditoria e métricas). */
  rejected: { attempt: number; violations: { kind: string; value: string }[] }[];
  fallbackReason?: string;
  /** Violações do próprio texto determinístico (deveria ser vazio; senão é bug do template). */
  fallbackViolations?: { kind: string; value: string }[];
  factsHash: string;
  generatedAt: string;
  fits: Record<Surface, boolean>;
  run: ContextRunInfo;
  /** Dados estruturados do tipo (stakes do cenário, placar do resumo). */
  data: Record<string, unknown>;
}

export const FALLBACK_MODEL: Record<ContextKind, string> = {
  scenario: 'template:scenario-rules-labels@v1',
  recap: 'template:recap-timeline@v1',
};

/** Hash estável (chaves ordenadas) dos fatos + versão do prompt: decide se precisa regenerar. */
export function factsHash(facts: unknown, version: string): string {
  const stable = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([, x]) => x !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => [k, stable(x)]),
      );
    return v;
  };
  return createHash('sha256')
    .update(`${version}\n${JSON.stringify(stable(facts))}`)
    .digest('hex')
    .slice(0, 32);
}

export function newRunInfo(partial: Omit<ContextRunInfo, 'id'>): ContextRunInfo {
  return { id: randomUUID(), ...partial };
}

export interface SaveContextInput {
  eventId: string;
  kind: ContextKind;
  texts: readonly LocaleText[];
  factsHash: string;
  sources: readonly ContextSource[];
  run: ContextRunInfo;
  data: Record<string, unknown>;
  /** Tags extras de cache para o purge. */
  tags?: readonly string[];
}

/** Grava as linhas (uma por locale) e publica `event.context_published`. Retorna o id do change feed. */
export async function saveEventContexts(db: Database, input: SaveContextInput): Promise<number> {
  const generatedAt = new Date();
  const rows = input.texts.map((t) => {
    const content: StoredContextContent = {
      text: t.text,
      sentences: t.sentences,
      origin: t.origin,
      attempts: t.attempts,
      rejected: t.rejected.map((r) => ({
        attempt: r.attempt,
        violations: r.violations.map((v) => ({ kind: v.kind, value: v.value })),
      })),
      factsHash: input.factsHash,
      generatedAt: generatedAt.toISOString(),
      fits: surfaceFit(t.text),
      run: input.run,
      data: input.data,
    };
    if (t.fallbackReason) content.fallbackReason = t.fallbackReason;
    if (t.fallbackViolations?.length)
      content.fallbackViolations = t.fallbackViolations.map((v) => ({ kind: v.kind, value: v.value }));
    return {
      eventId: input.eventId,
      locale: t.locale,
      kind: input.kind,
      content,
      sources: input.sources,
      model: t.origin === 'llm' ? (input.run.model ?? 'llm') : FALLBACK_MODEL[input.kind],
      confidence: confidenceOf(t).toFixed(2),
      reviewStatus: 'auto',
      createdAt: generatedAt,
    };
  });
  // Mesma transação e mesma entidade do trigger de captura (ops.capture_context_published): o
  // ops.publish_change funde as duas publicações numa única linha do change feed, unindo as tags.
  return db.transaction(async (tx) => {
    if (rows.length) await tx.insert(eventContext).values(rows);
    return publishChange(tx, {
      topic: CONTEXT_PUBLISHED_TOPIC,
      entityType: 'event_context',
      entityId: input.eventId,
      payload: {
        kind: input.kind,
        locales: input.texts.map((t) => t.locale),
        origins: Object.fromEntries(input.texts.map((t) => [t.locale, t.origin])),
        tags: [`event_context:${input.eventId}`, ...(input.tags ?? [])],
      },
    });
  });
}

export interface StoredContextRow {
  eventId: string;
  locale: string;
  kind: string;
  content: StoredContextContent;
  sources: ContextSource[];
  model: string;
  confidence: number | null;
  reviewStatus: string;
  createdAt: Date;
}

/**
 * Versão mais recente por (tipo, locale) do evento — ignora linhas `rejected` pela revisão editorial.
 * É a leitura que a rota `GET /v1/events/{id}/context` usa.
 */
export async function readEventContext(
  db: Database,
  eventId: string,
  options: { kinds?: readonly ContextKind[]; locales?: readonly string[] } = {},
): Promise<StoredContextRow[]> {
  const filters = [eq(eventContext.eventId, eventId)];
  if (options.kinds?.length) filters.push(inArray(eventContext.kind, [...options.kinds]));
  if (options.locales?.length) filters.push(inArray(eventContext.locale, [...options.locales]));
  const rows = await db
    .select()
    .from(eventContext)
    .where(and(...filters))
    .orderBy(desc(eventContext.createdAt));
  const latest = new Map<string, StoredContextRow>();
  for (const r of rows) {
    if (r.reviewStatus === 'rejected') continue;
    const key = `${r.kind}|${r.locale}`;
    if (latest.has(key)) continue;
    latest.set(key, {
      eventId: r.eventId,
      locale: r.locale,
      kind: r.kind,
      content: r.content as StoredContextContent,
      sources: r.sources as ContextSource[],
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

/** Hash dos fatos da geração mais recente por locale (para não regenerar o que não mudou). */
export async function latestFactsHashes(
  db: Database,
  eventId: string,
  kind: ContextKind,
): Promise<Map<string, string>> {
  const rows = await readEventContext(db, eventId, { kinds: [kind] });
  return new Map(rows.map((r) => [r.locale, r.content.factsHash]));
}
