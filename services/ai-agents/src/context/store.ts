import { createHash, randomUUID } from 'node:crypto';
import {
  eventContext,
  publishChange,
  readEventContext as readStoredContext,
  type Database,
  type EventContextRow,
} from '@galaxie/db';
import { UTC_BUDGET_DAY, budgetDayOf, type BudgetDay } from '@galaxie/runtime-config';
import { surfaceFit, type Surface } from '../guardrails/index.js';
import type { BudgetNeed, LlmUsage } from '../llm/types.js';
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
  /** `fallbackReason: 'budget'`: o que a chamada recusada pedia (unidade e estimativa). */
  budgetRefusal?: BudgetNeed;
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
  /** O que a chamada recusada pelo orçamento pedia (vai nas linhas `fallbackReason: 'budget'`). */
  budgetRefusal?: BudgetNeed;
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
    if (t.fallbackReason === 'budget' && input.budgetRefusal) content.budgetRefusal = input.budgetRefusal;
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

export type StoredContextRow = EventContextRow<StoredContextContent> & { sources: ContextSource[] };

/**
 * Versão mais recente por (tipo, locale) do evento — ignora linhas `rejected` pela revisão editorial.
 * A leitura mora em `@galaxie/db` (`readEventContext`), compartilhada com a rota
 * `GET /v1/events/{id}/context` da API; aqui o conteúdo vem tipado como os agentes o gravam.
 */
export async function readEventContext(
  db: Database,
  eventId: string,
  options: { kinds?: readonly ContextKind[]; locales?: readonly string[] } = {},
): Promise<StoredContextRow[]> {
  return readStoredContext<StoredContextContent>(db, eventId, options);
}

/**
 * O texto determinístico saiu porque o LLM falhou (erro de API, orçamento, timeout), não porque
 * reprovou nos guardrails: vale tentar de novo na próxima rodada, mesmo com os fatos iguais. Vale o
 * motivo gravado no próprio locale; os erros da execução inteira só decidem nas linhas antigas, sem ele
 * (um locale reprovado numa execução com erro em outra tentativa não é regerado a cada rodada).
 */
export function fellBackOnLlmError(content: StoredContextContent): boolean {
  if (content.origin !== 'fallback') return false;
  if (content.fallbackReason) return content.fallbackReason === 'llm_error';
  return content.run.llmCalls > 0 && content.run.errors.length > 0;
}

/** Quando o determinístico por orçamento volta a tentar o LLM: o dia de orçamento de agora e a virada. */
export interface BudgetRetry {
  now: Date;
  budgetDay?: BudgetDay;
  /**
   * A faixa (e os outros tetos) tem saldo agora para a chamada recusada? Com saldo (o operador subiu o
   * teto ou a faixa, ou sobrou da faixa), tenta de novo no mesmo dia; sem saldo, a linha fica.
   */
  hasRoom?: (need: BudgetNeed | undefined) => Promise<boolean>;
}

/**
 * O texto determinístico saiu porque o orçamento recusou, e o dia de orçamento em que foi gravado já
 * virou: vale tentar o LLM de novo. No mesmo dia, a linha fica (não regrava nem republica a cada rodada).
 */
export function budgetFallbackExpired(content: StoredContextContent, retry: BudgetRetry): boolean {
  if (content.origin !== 'fallback' || content.fallbackReason !== 'budget') return false;
  const day = retry.budgetDay ?? UTC_BUDGET_DAY;
  return budgetDayOf(new Date(content.generatedAt), day) !== budgetDayOf(retry.now, day);
}

/**
 * Hash dos fatos da geração mais recente por locale (para não regenerar o que não mudou). Fica de
 * fora o locale cujo texto caiu no determinístico por falha do LLM, para ser regerado, e o que caiu
 * por orçamento num dia de orçamento que já virou.
 */
export async function latestFactsHashes(
  db: Database,
  eventId: string,
  kind: ContextKind,
  retry: BudgetRetry = { now: new Date() },
): Promise<Map<string, string>> {
  const rows = await readEventContext(db, eventId, { kinds: [kind] });
  // a consulta ao saldo é uma só por evento (todas as linhas `budget` vêm da mesma recusa)
  let room: Promise<boolean> | undefined;
  const out = new Map<string, string>();
  for (const r of rows) {
    if (fellBackOnLlmError(r.content) || budgetFallbackExpired(r.content, retry)) continue;
    if (r.content.origin === 'fallback' && r.content.fallbackReason === 'budget' && retry.hasRoom) {
      room ??= retry.hasRoom(r.content.budgetRefusal);
      if (await room) continue;
    }
    out.set(r.locale, r.content.factsHash);
  }
  return out;
}

/**
 * Tira da gravação o determinístico por orçamento de um locale que já tem texto do LLM com os mesmos
 * fatos: a recusa nunca troca um texto bom pelo modelo (acontece com `--forcar` ou locale faltando).
 */
export function withoutBudgetDowngrade<T extends Pick<LocaleText, 'locale' | 'origin' | 'fallbackReason'>>(
  texts: readonly T[],
  previous: ReadonlyMap<string, Pick<StoredContextContent, 'origin' | 'factsHash'>>,
  factsHash: string,
): T[] {
  return texts.filter((t) => {
    if (t.origin !== 'fallback' || t.fallbackReason !== 'budget') return true;
    const prev = previous.get(t.locale);
    return !(prev && prev.origin === 'llm' && prev.factsHash === factsHash);
  });
}

/** Conteúdo mais recente por locale (origem e hash), para `withoutBudgetDowngrade`. */
export async function latestContents(
  db: Database,
  eventId: string,
  kind: ContextKind,
): Promise<Map<string, StoredContextContent>> {
  const rows = await readEventContext(db, eventId, { kinds: [kind] });
  return new Map(rows.map((r) => [r.locale, r.content]));
}
