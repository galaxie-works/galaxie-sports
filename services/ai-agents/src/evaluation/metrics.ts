import { and, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { broadcastOption, competition, event, eventContext, eventStateLog, type Database } from '@galaxie/db';
import type { StoredContextContent } from '../context/store.js';

/**
 * Avaliação contínua da IA (docs/07 §4, issue #60): métricas de qualidade e custo calculadas a
 * partir do que os agentes gravaram (enrich.event_context, enrich.broadcast_option) e do core.
 * É a base do "painel de custo e qualidade" (`pnpm --filter @galaxie/ai-agents eval:report`).
 */

export interface Ratio {
  numerator: number;
  denominator: number;
  /** null quando não há base (denominador 0). */
  value: number | null;
}

const ratio = (numerator: number, denominator: number): Ratio => ({
  numerator,
  denominator,
  value: denominator ? numerator / denominator : null,
});

export interface KindMetrics {
  texts: number;
  events: number;
  /** Aprovados pelo validador na 1ª tentativa do LLM / textos em que o LLM foi tentado. */
  llmFirstPass: Ratio;
  /** Aprovados na 2ª tentativa / textos em que o LLM foi tentado. */
  llmRetryPass: Ratio;
  /** Textos publicados com o fallback determinístico / total. */
  fallback: Ratio;
  fallbackReasons: Record<string, number>;
  /** Divergências barradas pelo validador antes de publicar, por tipo. */
  blockedViolations: Record<string, number>;
  /** Fidelidade: textos publicados sem divergência pelo validador / total. Meta: 100%. */
  fidelityValidator: Ratio;
  /** Amostra humana: revisados como corretos / (revisados + rejeitados). */
  fidelityHumanSample: Ratio;
}

export interface AiMetricsReport {
  window: { from: string; to: string };
  byKind: Record<'scenario' | 'recap', KindMetrics>;
  cost: {
    llmCalls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    eventsEnriched: number;
    costPerEventUsd: number | null;
  };
  coverage: {
    /** Jogos tier 1 com cenário publicado antes do início. */
    scenarioTier1: Ratio;
    /** Jogos tier 1 encerrados com resumo publicado em até 10 min do FT. */
    recapTier1Within10Min: Ratio & { medianMinutes: number | null };
    /** Jogos tier 1 com ≥ 1 opção `confirmed` de onde assistir até T-3h. */
    whereToWatchTier1ByT3h: Ratio;
  };
  targets: { metric: string; value: number | null; target: string; ok: boolean | null; note?: string }[];
}

function emptyKind(): KindMetrics {
  return {
    texts: 0,
    events: 0,
    llmFirstPass: ratio(0, 0),
    llmRetryPass: ratio(0, 0),
    fallback: ratio(0, 0),
    fallbackReasons: {},
    blockedViolations: {},
    fidelityValidator: ratio(0, 0),
    fidelityHumanSample: ratio(0, 0),
  };
}

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

export async function computeAiMetrics(
  db: Database,
  opts: { from: Date; to: Date },
): Promise<AiMetricsReport> {
  const rows = await db
    .select({
      eventId: eventContext.eventId,
      kind: eventContext.kind,
      content: eventContext.content,
      reviewStatus: eventContext.reviewStatus,
      createdAt: eventContext.createdAt,
    })
    .from(eventContext)
    .where(
      and(
        inArray(eventContext.kind, ['scenario', 'recap']),
        gte(eventContext.createdAt, opts.from),
        lte(eventContext.createdAt, opts.to),
      ),
    );

  const byKind = { scenario: emptyKind(), recap: emptyKind() };
  const tally = {
    scenario: { events: new Set<string>(), tried: 0, first: 0, retry: 0, fb: 0, clean: 0, ok: 0, bad: 0 },
    recap: { events: new Set<string>(), tried: 0, first: 0, retry: 0, fb: 0, clean: 0, ok: 0, bad: 0 },
  };
  const runs = new Map<string, StoredContextContent['run']>();
  const enriched = new Set<string>();
  for (const r of rows) {
    const kind = r.kind as 'scenario' | 'recap';
    const k = byKind[kind];
    const t = tally[kind];
    const c = r.content as StoredContextContent;
    k.texts++;
    t.events.add(r.eventId);
    enriched.add(r.eventId);
    if (c.attempts > 0) t.tried++;
    if (c.origin === 'llm' && c.attempts <= 1) t.first++;
    if (c.origin === 'llm' && c.attempts >= 2) t.retry++;
    if (c.origin === 'fallback') {
      t.fb++;
      const reason = c.fallbackReason ?? 'desconhecido';
      k.fallbackReasons[reason] = (k.fallbackReasons[reason] ?? 0) + 1;
    }
    for (const attempt of c.rejected ?? [])
      for (const v of attempt.violations)
        k.blockedViolations[v.kind] = (k.blockedViolations[v.kind] ?? 0) + 1;
    if (!c.fallbackViolations?.length) t.clean++;
    if (r.reviewStatus === 'reviewed') t.ok++;
    if (r.reviewStatus === 'rejected') t.bad++;
    if (c.run?.id) runs.set(c.run.id, c.run);
  }
  for (const kind of ['scenario', 'recap'] as const) {
    const k = byKind[kind];
    const t = tally[kind];
    k.events = t.events.size;
    k.llmFirstPass = ratio(t.first, t.tried);
    k.llmRetryPass = ratio(t.retry, t.tried);
    k.fallback = ratio(t.fb, k.texts);
    k.fidelityValidator = ratio(t.clean, k.texts);
    k.fidelityHumanSample = ratio(t.ok, t.ok + t.bad);
  }

  const cost = { llmCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  for (const run of runs.values()) {
    cost.llmCalls += run.llmCalls;
    cost.inputTokens += run.usage.inputTokens;
    cost.outputTokens += run.usage.outputTokens;
    cost.costUsd += run.usage.costUsd ?? 0;
  }

  // ─── cobertura (jogos tier 1 da janela) ──────────────────────────────────────────────────────
  const tier1 = await db
    .select({ id: event.id, startsAt: event.startsAt, status: event.status })
    .from(event)
    .innerJoin(competition, eq(competition.id, event.competitionId))
    .where(and(eq(competition.tier, 1), gte(event.startsAt, opts.from), lt(event.startsAt, opts.to)));
  const played = tier1.filter((e) => !['cancelled', 'postponed', 'abandoned'].includes(e.status));
  const ids = played.map((e) => e.id);

  const scenarioFirst = new Map<string, Date>();
  const recapFirst = new Map<string, Date>();
  const ftAt = new Map<string, Date>();
  const wtwFirst = new Map<string, Date>();
  if (ids.length) {
    const ctx = await db
      .select({
        eventId: eventContext.eventId,
        kind: eventContext.kind,
        first: sql<Date>`min(${eventContext.createdAt})`.mapWith((v) => new Date(v as string)),
      })
      .from(eventContext)
      .where(and(inArray(eventContext.eventId, ids), inArray(eventContext.kind, ['scenario', 'recap'])))
      .groupBy(eventContext.eventId, eventContext.kind);
    for (const c of ctx) (c.kind === 'scenario' ? scenarioFirst : recapFirst).set(c.eventId, c.first);
    const ft = await db
      .select({
        eventId: eventStateLog.eventId,
        at: sql<Date>`min(${eventStateLog.occurredAt})`.mapWith((v) => new Date(v as string)),
      })
      .from(eventStateLog)
      .where(and(inArray(eventStateLog.eventId, ids), eq(eventStateLog.toStatus, 'finished')))
      .groupBy(eventStateLog.eventId);
    for (const f of ft) ftAt.set(f.eventId, f.at);
    const wtw = await db
      .select({
        eventId: broadcastOption.eventId,
        first: sql<Date>`min(${broadcastOption.firstSeenAt})`.mapWith((v) => new Date(v as string)),
      })
      .from(broadcastOption)
      .where(and(inArray(broadcastOption.eventId, ids), eq(broadcastOption.status, 'confirmed')))
      .groupBy(broadcastOption.eventId);
    for (const w of wtw) wtwFirst.set(w.eventId, w.first);
  }
  const startedBefore = played.filter((e) => e.startsAt <= opts.to);
  const scenarioOk = startedBefore.filter((e) => {
    const at = scenarioFirst.get(e.id);
    return at !== undefined && at <= e.startsAt;
  }).length;
  const finished = played.filter((e) => e.status === 'finished' && ftAt.has(e.id));
  const latencies: number[] = [];
  let recapOk = 0;
  for (const e of finished) {
    const at = recapFirst.get(e.id);
    if (!at) continue;
    const minutes = (at.getTime() - ftAt.get(e.id)!.getTime()) / 60_000;
    latencies.push(Math.max(0, minutes));
    if (minutes <= 10) recapOk++;
  }
  const wtwOk = startedBefore.filter((e) => {
    const at = wtwFirst.get(e.id);
    return at !== undefined && at.getTime() <= e.startsAt.getTime() - 3 * 3_600_000;
  }).length;

  const report: AiMetricsReport = {
    window: { from: opts.from.toISOString(), to: opts.to.toISOString() },
    byKind,
    cost: {
      ...cost,
      eventsEnriched: enriched.size,
      costPerEventUsd: enriched.size ? cost.costUsd / enriched.size : null,
    },
    coverage: {
      scenarioTier1: ratio(scenarioOk, startedBefore.length),
      recapTier1Within10Min: { ...ratio(recapOk, finished.length), medianMinutes: median(latencies) },
      whereToWatchTier1ByT3h: ratio(wtwOk, startedBefore.length),
    },
    targets: [],
  };
  const target = (metric: string, value: number | null, min: number, label: string, note?: string) =>
    report.targets.push({
      metric,
      value,
      target: label,
      ok: value === null ? null : value >= min,
      ...(note ? { note } : {}),
    });
  target('Fidelidade do cenário (validador)', byKind.scenario.fidelityValidator.value, 1, '100%');
  target(
    'Fidelidade do cenário (amostra humana)',
    byKind.scenario.fidelityHumanSample.value,
    1,
    '100%',
    'review_status reviewed × rejected',
  );
  target('Fidelidade do resumo (validador)', byKind.recap.fidelityValidator.value, 1, '100%');
  target('Resumo tier 1 em ≤ 10 min do FT', report.coverage.recapTier1Within10Min.value, 0.95, '≥ 95%');
  target(
    'Cobertura do onde assistir (tier 1, até T-3h)',
    report.coverage.whereToWatchTier1ByT3h.value,
    0.95,
    '≥ 95%',
  );
  report.targets.push(
    {
      metric: 'Precisão do onde assistir',
      value: null,
      target: '≥ 98%',
      ok: null,
      note: 'amostra manual diária de 20 opções',
    },
    {
      metric: 'Cobertura ao vivo (tier 1)',
      value: null,
      target: '≥ 95%',
      ok: null,
      note: 'medida pelo live scheduler (ticks × plano)',
    },
  );
  return report;
}
