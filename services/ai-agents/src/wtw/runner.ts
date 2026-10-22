/**
 * Executa as janelas do onde assistir (docs/07 §2.2):
 *
 *   rights (T-7d) e revalidate (T-3h, T-30min) — sem LLM: resposta da tabela de direitos (curada >
 *     pesquisada) + opções salvas com as evidências rebuscadas → validador → gravação versionada.
 *   allocate (T-48h) — agrupa as execuções por (competição, rodada) e faz UMA chamada para todos os
 *     jogos e mercados do grupo, só nos mercados cujos direitos dividem os jogos, com relevância ≥
 *     WTW_MIN_RELEVANCE e dentro do teto diário do mercado; os demais saem só dos direitos.
 *   full (manual) — reexecução editorial de um jogo: alocação restrita aos detentores (ou aberta,
 *     sem tabela de direitos).
 *
 * O LLM só propõe: tudo passa pelo validador determinístico antes de gravar.
 */
import { eq } from 'drizzle-orm';
import { wtwRun, type Database } from '@galaxie/db';
import {
  applyAgentResult,
  currentOptions,
  currentResearchedRights,
  effectiveRights,
  isEditorial,
  ResearchedRightsIndex,
  rightsAnswer,
  rightsCandidates,
  validateCandidates,
  type Candidate,
  type CountryDirectory,
  type RightsAnswer,
  type RightsEntry,
  type WtwConfig,
} from '@galaxie/where-to-watch';
import { BudgetExceededError, LlmError } from '../llm/errors.js';
import type { UsageWithSearches } from '../llm/budget.js';
import type { LlmClient } from '../llm/types.js';
import { WhereToWatchAgent, type AllocationResult } from './agent.js';
import { loadEventInfos, matchFacts, type EventInfo } from './event-info.js';
import { rowToCandidate, verifyCandidates } from './evidence.js';
import { CachingPageFetcher, type PageFetcher } from './fetcher.js';
import { groupKeyOf, roundKeyOf } from './groups.js';
import type { AllocationMarket } from './prompt.js';
import { marketRelevance, priorityOf, wtwPolicyFromEnv, type WtwPolicy } from './relevance.js';
import { claimRuns, requeueStale, type WtwRunRow } from './scheduler.js';
import { WTW_MAX_MATCHES_PER_CALL } from './schema.js';
import { estimateCallUsd, finishResearch, marketSpendToday, startResearch, withinCap } from './spend.js';

export interface WtwRunnerDeps {
  db: Database;
  /** Opcional: sem LLM, tudo sai só dos direitos (a alocação fica para depois). */
  llm?: LlmClient | undefined;
  config: WtwConfig;
  fetcher: PageFetcher;
  policy?: WtwPolicy;
  now?: () => Date;
  log?: (message: string) => void;
}

export interface RunOutcome {
  runId: string;
  eventId: string;
  country: string;
  window: string;
  status: 'done' | 'failed' | 'skipped';
  mode: WtwRunRow['mode'];
  stats: Record<string, unknown>;
  error?: string;
}

const ACTIVE = new Set(['confirmed', 'pending', 'omitted']);

interface RunCtx {
  run: WtwRunRow;
  info: EventInfo;
  directory: CountryDirectory;
  rights: RightsEntry | null;
  answer: RightsAnswer;
  relevance: number;
  group: string;
}

interface CallShare {
  researchId: string;
  usage: UsageWithSearches | undefined;
  model: { provider: string; model: string } | undefined;
  /** Execuções que dividem o custo da chamada. */
  runs: number;
}

export class WtwRunner {
  private readonly now: () => Date;
  private readonly log: (m: string) => void;
  private readonly policy: WtwPolicy;

  constructor(private readonly deps: WtwRunnerDeps) {
    this.now = deps.now ?? (() => new Date());
    this.log = deps.log ?? (() => {});
    this.policy = deps.policy ?? wtwPolicyFromEnv();
  }

  /**
   * Reserva e executa as execuções enfileiradas. `maxCalls` limita as chamadas ao LLM desta
   * rodada; grupos que ficarem sem chamada voltam para a fila (a próxima rodada do cron pega).
   */
  async runQueued(opts: {
    limit: number;
    maxCalls?: number;
    eventId?: string;
    country?: string;
  }): Promise<RunOutcome[]> {
    const { db } = this.deps;
    await requeueStale(db, this.now());
    const runs = await claimRuns(db, {
      now: this.now(),
      limit: opts.limit,
      ...(opts.eventId ? { eventId: opts.eventId } : {}),
      ...(opts.country ? { country: opts.country } : {}),
    });
    if (!runs.length) return [];
    const fetcher = new CachingPageFetcher(this.deps.fetcher);
    const infos = await loadEventInfos(db, [...new Set(runs.map((r) => r.eventId))]);
    const comps = [
      ...new Set([...infos.values()].flatMap((i) => (i.competition ? [i.competition.slug] : []))),
    ];
    const researched = new ResearchedRightsIndex(await currentResearchedRights(db, { competitions: comps }));
    const spend = await marketSpendToday(db, this.now());
    let callsLeft = opts.maxCalls ?? 3;

    const out: RunOutcome[] = [];
    const groups = new Map<string, RunCtx[]>();
    const ready: RunCtx[] = [];
    for (const run of runs) {
      const info = infos.get(run.eventId);
      const skip = this.skipReason(run, info);
      if (skip) {
        out.push(await this.finish(run, 'skipped', run.mode, {}, skip));
        continue;
      }
      const directory = this.deps.config.directory(run.countryCode);
      const rights = effectiveRights(
        directory.rightsFor(info!.competition?.slug, info!.startsAt),
        researched.get(info!.competition?.slug, info!.season, run.countryCode),
      );
      const s = (run.stats ?? {}) as Record<string, unknown>;
      const relevance =
        typeof s.relevance === 'number'
          ? s.relevance
          : marketRelevance(
              {
                importance: info!.importance ?? 0,
                participantCountries: info!.participantCountries ?? [],
                competitionCountry: info!.competition?.countryCode ?? null,
              },
              run.countryCode,
            );
      const group =
        typeof s.group === 'string'
          ? s.group
          : groupKeyOf(info!.competition?.slug, roundKeyOf(info!.round, info!.startsAt));
      const ctx: RunCtx = {
        run,
        info: info!,
        directory,
        rights,
        answer: rightsAnswer(rights, matchFacts(info!)),
        relevance,
        group,
      };
      // `full` só na reexecução manual; execuções `full` antigas do agendador (T-7d/T-24h do
      // desenho anterior) saem só dos direitos, sem LLM.
      const manual = run.mode === 'full' && run.window === 'manual';
      if (run.mode === 'allocate' || manual) {
        const key = manual ? `manual:${run.id}` : group;
        groups.set(key, [...(groups.get(key) ?? []), ctx]);
      } else ready.push(ctx);
    }

    for (const ctx of ready) out.push(await this.apply(ctx, fetcher, null, null));

    const ordered = [...groups.values()].sort(
      (a, b) => maxPriority(b, this.now()) - maxPriority(a, this.now()),
    );
    for (const group of ordered) {
      const res = await this.allocateGroup(group, spend, callsLeft);
      callsLeft -= res.calls;
      if (res.deferred) {
        await this.requeue(group.map((g) => g.run));
        this.log(`${group[0]!.group}: sem chamada disponível nesta rodada — volta para a fila`);
        continue;
      }
      for (const ctx of group) {
        const share = res.shares.get(ctx.run.id) ?? null;
        out.push(
          await this.apply(
            ctx,
            fetcher,
            res.byEvent.get(ctx.info.id)?.get(ctx.run.countryCode) ?? null,
            share,
            {
              allocation: res.reasons.get(ctx.run.countryCode) ?? res.reason,
              ...(res.notes ? { allocationNotes: res.notes } : {}),
            },
          ),
        );
      }
      if (res.retryLater) {
        await this.requeue(group.map((g) => g.run));
        this.log(
          `${group[0]!.group}: alocação adiada (${res.reasons.values().next().value ?? ''}) — volta para a fila`,
        );
      }
    }
    if (fetcher.hits)
      this.log(`cache de páginas: ${fetcher.size} URLs buscadas, ${fetcher.hits} reaproveitadas`);
    return out;
  }

  private skipReason(run: WtwRunRow, info: EventInfo | undefined): string | null {
    if (!info) return 'evento inexistente';
    if (!['scheduled', 'starting'].includes(info.status) || info.startsAt.getTime() <= this.now().getTime())
      return `evento já iniciado ou fora da agenda (${info.status})`;
    if (!this.deps.config.has(run.countryCode)) return `país sem dicionário: ${run.countryCode}`;
    return null;
  }

  private async requeue(runs: WtwRunRow[]): Promise<void> {
    for (const r of runs)
      await this.deps.db.update(wtwRun).set({ status: 'queued', startedAt: null }).where(eq(wtwRun.id, r.id));
  }

  /** Decide e faz as chamadas de alocação de um grupo (rodada × todos os mercados). */
  private async allocateGroup(
    group: RunCtx[],
    spend: Map<string, number>,
    callsLeft: number,
  ): Promise<{
    byEvent: AllocationResult['byEvent'];
    shares: Map<string, CallShare>;
    reasons: Map<string, string>;
    reason: string;
    notes: string | null;
    calls: number;
    deferred: boolean;
    /** Falha passageira na alocação: publica os direitos agora e devolve as execuções para a fila. */
    retryLater?: boolean;
  }> {
    const byEvent: AllocationResult['byEvent'] = new Map();
    const shares = new Map<string, CallShare>();
    const reasons = new Map<string, string>();
    const manual = group[0]!.run.mode === 'full' && group[0]!.run.window === 'manual';
    const empty = { byEvent, shares, reasons, notes: null, calls: 0, deferred: false };

    // mercados × jogos que precisam do LLM
    const need = group.filter((c) =>
      manual ? true : c.answer.needsAllocation && c.relevance >= this.policy.minRelevance,
    );
    for (const c of group)
      if (!need.includes(c))
        reasons.set(
          c.run.countryCode,
          reasons.get(c.run.countryCode) ??
            (c.answer.needsAllocation
              ? `relevância abaixo de ${this.policy.minRelevance}: detentores "a confirmar"`
              : 'direitos determinam o jogo (sem LLM)'),
        );
    if (!need.length) return { ...empty, reason: 'sem alocação necessária' };
    if (!this.deps.llm) return { ...empty, reason: 'sem cliente de LLM configurado' };

    let countries = [...new Set(need.map((c) => c.run.countryCode))];
    const estimate = await estimateCallUsd(this.deps.db, 'allocation');
    if (!manual) {
      const cap = withinCap(spend, countries, estimate, this.policy.dailyUsdPerMarket);
      for (const m of cap.blocked)
        reasons.set(m, 'teto diário do mercado atingido (WTW_DAILY_USD_PER_MARKET)');
      countries = cap.allowed;
    }
    const used = need.filter((c) => countries.includes(c.run.countryCode));
    if (!used.length) return { ...empty, reason: 'teto diário do mercado atingido' };

    const events = [...new Map(used.map((c) => [c.info.id, c.info])).values()].sort(
      (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
    );
    const chunks: EventInfo[][] = [];
    for (let i = 0; i < events.length; i += WTW_MAX_MATCHES_PER_CALL)
      chunks.push(events.slice(i, i + WTW_MAX_MATCHES_PER_CALL));
    if (chunks.length > callsLeft) return { ...empty, reason: 'adiado', deferred: true };

    const agent = new WhereToWatchAgent(this.deps.llm);
    const first = group[0]!;
    const comp = first.info.competition ?? { slug: 'sem-competicao', name: 'evento' };
    const round = roundKeyOf(first.info.round, first.info.startsAt);
    let notes: string | null = null;
    let calls = 0;
    // falha passageira (orçamento, conta sem crédito, limite de taxa, provedor fora): a rodada volta
    // para a fila em vez de fechar como "feita" só com os direitos — senão nunca mais é alocada
    let transient: string | null = null;
    let allocatedAny = false;
    for (const [i, chunk] of chunks.entries()) {
      const ids = new Set(chunk.map((e) => e.id));
      const inChunk = used.filter((c) => ids.has(c.info.id));
      const marketsHere = [...new Set(inChunk.map((c) => c.run.countryCode))].sort();
      const key = manual
        ? `alloc:manual:${first.run.id}`
        : `alloc:${first.group}:${i}:${marketsHere.join(',')}:${this.now().toISOString().slice(0, 10)}`;
      const researchId = await startResearch(this.deps.db, {
        kind: 'allocation',
        researchKey: key,
        competition: comp.slug,
        season: first.info.season ?? null,
        round,
        markets: marketsHere,
        requestedBy: manual ? first.run.requestedBy : 'scheduler',
        now: this.now(),
      });
      if (!researchId) {
        for (const m of marketsHere)
          reasons.set(m, 'rodada já pesquisada hoje (opções salvas reaproveitadas)');
        continue;
      }
      const markets: AllocationMarket[] = marketsHere.map((m) => {
        const ctxs = inChunk.filter((c) => c.run.countryCode === m);
        const any = ctxs[0]!;
        return {
          directory: any.directory,
          holders: manual
            ? (any.rights?.holders ?? [])
            : [...new Set(ctxs.flatMap((c) => c.answer.toAllocate))],
          known: manual ? [] : [...new Set(ctxs.flatMap((c) => c.answer.deterministic))],
          matches: chunk.flatMap((e, j) => (ctxs.some((c) => c.info.id === e.id) ? [`J${j + 1}`] : [])),
        };
      });
      calls++;
      try {
        const res = await agent.allocate({ competition: comp, round, events: chunk, markets });
        allocatedAny = true;
        for (const [ev, perCountry] of res.byEvent) byEvent.set(ev, perCountry);
        notes = res.notes;
        const usage = res.result.usage as UsageWithSearches;
        const model = { provider: res.result.provider, model: res.result.model };
        await finishResearch(this.deps.db, researchId, {
          status: 'done',
          usage,
          model,
          stats: {
            events: chunk.length,
            markets: marketsHere,
            assignments: [...res.byEvent.values()].reduce(
              (s, m) => s + [...m.values()].reduce((t, l) => t + l.length, 0),
              0,
            ),
            ignored: res.ignored,
            citations: res.citations.length,
            notes: res.notes,
          },
          now: this.now(),
        });
        const cost = usage.costUsd ?? 0;
        for (const m of marketsHere) spend.set(m, (spend.get(m) ?? 0) + cost / marketsHere.length);
        for (const c of inChunk) shares.set(c.run.id, { researchId, usage, model, runs: inChunk.length });
        for (const m of marketsHere) reasons.set(m, `alocação por rodada (${researchId})`);
      } catch (err) {
        const partial = (err as { usage?: UsageWithSearches }).usage;
        const message = err instanceof LlmError || err instanceof Error ? err.message : String(err);
        await finishResearch(this.deps.db, researchId, {
          status: err instanceof BudgetExceededError ? 'skipped' : 'failed',
          usage: partial,
          error: message.slice(0, 500),
          now: this.now(),
        });
        for (const m of marketsHere) reasons.set(m, `alocação falhou: ${message.slice(0, 200)}`);
        if (isTransient(err)) transient ??= message.slice(0, 200);
      }
    }
    // os direitos saem agora (como antes); a alocação fica para a próxima rodada do agendador
    const retryLater = !!transient && !allocatedAny && !manual;
    return {
      byEvent,
      shares,
      reasons,
      reason: 'alocação por rodada',
      notes,
      calls,
      deferred: false,
      retryLater,
    };
  }

  /** Monta as candidatas (alocação + direitos + opções salvas), valida e grava. */
  private async apply(
    ctx: RunCtx,
    fetcher: CachingPageFetcher,
    allocated: Candidate[] | null,
    share: CallShare | null,
    extra: Record<string, unknown> = {},
  ): Promise<RunOutcome> {
    const { db } = this.deps;
    const { run, info, directory, rights, answer } = ctx;
    const stats: Record<string, unknown> = {
      ...((run.stats as Record<string, unknown> | null) ?? {}),
      rights: rights ? { origin: rights.origin, distribution: rights.distribution } : null,
      deterministic: answer.deterministic,
      toAllocate: answer.toAllocate,
      ...extra,
    };
    try {
      const current = await currentOptions(db, run.eventId, run.countryCode);
      const saved = current
        .filter((r) => ACTIVE.has(r.status) && !isEditorial(r))
        .map(rowToCandidate)
        .filter((c) => c.evidence.length > 0);
      const proposed = [...(allocated ?? []), ...saved];
      // O validador decide: "a confirmar" só fica se nenhuma fonte publicar aquele detentor.
      const fromRights = rightsCandidates(answer, directory, { includeToConfirm: true });
      const verified = await verifyCandidates(proposed, directory, fetcher, this.now());
      const report = validateCandidates([...verified.candidates, ...fromRights], {
        directory,
        competitionSlug: info.competition?.slug ?? null,
        eventStartsAt: info.startsAt,
        now: this.now(),
        rights,
        match: matchFacts(info),
      });
      // Com o jogo confirmado por fonte (não só pela tabela), some o "a confirmar".
      const confirmedBySource = report.options.some(
        (o) => o.status === 'confirmed' && o.evidence.some((e) => e.sourceKind !== 'rights'),
      );
      const options = confirmedBySource
        ? report.options.filter((o) => o.status !== 'probable')
        : report.options;
      const applied = await applyAgentResult(db, {
        eventId: run.eventId,
        country: run.countryCode,
        options,
        retractMissing: true,
        runId: run.id,
        now: this.now(),
      });
      Object.assign(stats, {
        allocated: allocated?.length ?? 0,
        reconsidered: saved.length,
        fromRights: fromRights.length,
        fetched: verified.fetched,
        fetchFailed: verified.failed,
        byStatus: countBy(options, (o) => o.status),
        discarded: countBy(report.discarded, (d) => d.reason),
        inserted: applied.inserted,
        touched: applied.touched,
        retracted: applied.retracted,
        lockedByEditorial: applied.lockedByEditorial,
        publicChanged: applied.publicChanged,
      });
      return await this.finish(run, 'done', run.mode, stats, undefined, share);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.finish(run, 'failed', run.mode, stats, message.slice(0, 500), share);
    }
  }

  private async finish(
    run: WtwRunRow,
    status: RunOutcome['status'],
    mode: RunOutcome['mode'],
    stats: Record<string, unknown>,
    error?: string,
    share?: CallShare | null,
  ): Promise<RunOutcome> {
    const n = Math.max(1, share?.runs ?? 1);
    const usage = share?.usage;
    await this.deps.db
      .update(wtwRun)
      .set({
        status,
        mode,
        finishedAt: this.now(),
        stats: share ? { ...stats, researchId: share.researchId, costShareOf: n } : stats,
        error: error ?? null,
        ...(usage
          ? {
              inputTokens: Math.round(usage.inputTokens / n),
              outputTokens: Math.round(usage.outputTokens / n),
              costUsd: usage.costUsd === undefined ? null : (usage.costUsd / n).toFixed(6),
            }
          : {}),
        ...(share?.model ? { provider: share.model.provider, model: share.model.model } : {}),
      })
      .where(eq(wtwRun.id, run.id));
    this.log(
      `${run.window} ${run.eventId} ${run.countryCode}: ${status} (${mode})${error ? ` — ${error}` : ''}`,
    );
    return {
      runId: run.id,
      eventId: run.eventId,
      country: run.countryCode,
      window: run.window,
      status,
      mode,
      stats,
      ...(error ? { error } : {}),
    };
  }
}

function maxPriority(group: RunCtx[], now: Date): number {
  return Math.max(...group.map((c) => priorityOf(c.relevance, c.info.startsAt, now)));
}

function countBy<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[key(i)] = (out[key(i)] ?? 0) + 1;
  return out;
}

/** Falhas que passam sozinhas (orçamento do dia, crédito, limite de taxa, provedor): vale tentar de novo. */
function isTransient(err: unknown): boolean {
  if (err instanceof BudgetExceededError) return true;
  return (
    err instanceof LlmError && ['budget', 'quota', 'rate_limit', 'timeout', 'provider'].includes(err.kind)
  );
}
