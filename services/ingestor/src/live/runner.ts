/**
 * Processo do ao vivo: a cada passo relê os candidatos do core e o uso de cota, refaz o plano do dia
 * (Live Scheduler), registra o orçamento LIVE no Quota Governor (`governor.plan`, protegendo o DAILY;
 * LIVE = 0 em dia sem jogo relevante, o que libera folga ao BOOTSTRAP) e decide entre chamar, esperar
 * ou encerrar. Relógio injetável: os testes simulam dias inteiros em milissegundos.
 */
import type { QuotaGovernor } from '@galaxie/apisports-client';
import { isInPlay, type SportsDataProvider } from '@galaxie/providers';
import { LivePoller, type TickReport } from './poller.js';
import {
  decideTick,
  liveOptions,
  planLiveDay,
  utcDayBounds,
  windowEnd,
  type LiveSchedulerOptions,
} from './schedule.js';
import type { LiveStore } from './store.js';
import type { LiveCandidate, LiveDayPlan, LivePrioritizer } from './types.js';

export interface LiveClock {
  now(): number;
  /** Dorme `ms` (ou até o `signal` abortar). */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const systemLiveClock: LiveClock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      if (signal?.aborted) return resolve();
      const timer = setTimeout(done, Math.max(0, ms));
      function done() {
        clearTimeout(timer);
        signal?.removeEventListener('abort', done);
        resolve();
      }
      signal?.addEventListener('abort', done, { once: true });
    }),
};

export interface LiveLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
}

const silent: LiveLogger = { info() {}, warn() {}, error() {}, debug() {} };

/** Espera antes de replanejar depois de um erro inesperado (banco, Governor, gancho do plano). */
export const PLAN_RETRY_MS = 30_000;

export interface LiveRunnerOptions extends LiveSchedulerOptions {
  /**
   * Encerra quando não há janela ativa e a próxima começa daqui a mais que isto (o scheduler do container
   * reinicia o processo periodicamente). `null` = fica no ar para sempre.
   */
  idleExitMs: number | null;
  /** Releitura periódica do core durante esperas longas (novos jogos, adiamentos). */
  replanEveryMs: number;
  /** Chamadas de confirmação de resultado por tick. */
  maxFinalizePerTick: number;
  /** Falhas seguidas da fonte a partir das quais o intervalo dobra (até 8×). */
  failureBackoffAfter: number;
  /** Só para testes/simulação: para neste instante. */
  until?: Date | undefined;
  /** Só para testes: máximo de ticks. */
  maxTicks?: number | undefined;
}

export const DEFAULT_RUNNER_OPTIONS: Omit<LiveRunnerOptions, keyof LiveSchedulerOptions> = {
  idleExitMs: 15 * 60_000,
  replanEveryMs: 5 * 60_000,
  maxFinalizePerTick: 5,
  failureBackoffAfter: 3,
};

export interface LiveHooks {
  onPlan?(plan: LiveDayPlan): void | Promise<void>;
  onTick?(report: TickReport, plan: LiveDayPlan): void | Promise<void>;
  onDetailFetched?(providerEventId: string, at: Date): void | Promise<void>;
}

/**
 * Releitura da configuração durante a execução (painel de Operação): a cada `everyMs`, `load` devolve as
 * opções efetivas; o que mudou passa a valer a partir do próximo plano/tick, sem reiniciar o processo.
 */
export interface LiveOptionsRefresh {
  everyMs: number;
  load(): Promise<Partial<LiveRunnerOptions>>;
}

export interface LiveRunnerDeps {
  sport: string;
  provider: SportsDataProvider;
  store: LiveStore;
  governor: Pick<QuotaGovernor, 'usage' | 'plan'>;
  clock?: LiveClock;
  log?: LiveLogger;
  /** Reordenação opcional (ex.: LLM leve) quando há mais jogos relevantes do que orçamento. */
  prioritize?: LivePrioritizer | undefined;
  hooks?: LiveHooks;
  options?: Partial<LiveRunnerOptions>;
  jobId?: string | undefined;
  refresh?: LiveOptionsRefresh | undefined;
}

export type LiveStopReason = 'idle' | 'aborted' | 'until' | 'max_ticks';

export interface LiveRunSummary {
  stoppedBy: LiveStopReason;
  ticks: number;
  calls: number;
  errors: number;
  changes: number;
  published: number;
  goals: number;
  finalized: number;
  /** Dias de cota percorridos e o plano final de cada um. */
  plans: Map<string, LiveDayPlan>;
  /** Intervalos efetivos entre ticks consecutivos (ms). */
  gaps: number[];
}

export class LiveRunner {
  private readonly clock: LiveClock;
  private readonly log: LiveLogger;
  private readonly options: LiveRunnerOptions;
  private readonly poller: LivePoller;
  private readonly halftimeSeenAt = new Map<string, Date>();
  private readonly sentPlans = new Map<string, string>();
  private lastTickAt: Date | null = null;
  private backoffUntil: Date | null = null;
  private consecutiveFailures = 0;
  private order: { key: string; ids: string[] } | null = null;
  private lastRefreshAt = -Infinity;

  constructor(private readonly deps: LiveRunnerDeps) {
    this.clock = deps.clock ?? systemLiveClock;
    this.log = deps.log ?? silent;
    this.options = { ...liveOptions(deps.options), ...DEFAULT_RUNNER_OPTIONS };
    for (const [k, v] of Object.entries(deps.options ?? {}))
      if (v !== undefined) (this.options as unknown as Record<string, unknown>)[k] = v;
    this.poller = new LivePoller(deps.provider, deps.store, {
      sport: deps.sport,
      jobId: deps.jobId,
      onDetailFetched: deps.hooks?.onDetailFetched?.bind(deps.hooks),
    });
  }

  get settings(): Readonly<LiveRunnerOptions> {
    return this.options;
  }

  private now(): Date {
    return new Date(this.clock.now());
  }

  /** Candidatos do dia de cota (com folga para jogos iniciados antes da meia-noite) e de amanhã. */
  private async loadCandidates(now: Date): Promise<LiveCandidate[]> {
    const { start, end } = utcDayBounds(now);
    const all = await this.deps.store.candidates(
      this.deps.sport,
      this.deps.provider.id,
      new Date(start.getTime() - 6 * 3_600_000),
      new Date(end.getTime() + 86_400_000),
    );
    for (const c of all) {
      if (c.statusDetail === 'HT') {
        if (!this.halftimeSeenAt.has(c.eventId)) this.halftimeSeenAt.set(c.eventId, c.lastValidAt ?? now);
      } else this.halftimeSeenAt.delete(c.eventId);
    }
    return all;
  }

  /** Aplica a configuração relida (quando chega a hora); falha na leitura mantém a atual. */
  async refreshOptions(): Promise<void> {
    const refresh = this.deps.refresh;
    if (!refresh) return;
    const nowMs = this.clock.now();
    if (nowMs - this.lastRefreshAt < refresh.everyMs) return;
    this.lastRefreshAt = nowMs;
    let next: Partial<LiveRunnerOptions>;
    try {
      next = await refresh.load();
    } catch (err) {
      this.log.warn({ err }, 'não foi possível reler a configuração do ao vivo; mantendo a atual');
      return;
    }
    const opts = this.options as unknown as Record<string, unknown>;
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    // chave presente com `undefined` = voltou a não ter valor (ex.: LIVE_PROTECT_DAILY apagado)
    for (const [k, v] of Object.entries(next)) {
      if (opts[k] === v) continue;
      changes[k] = { from: opts[k], to: v ?? null };
      if (v === undefined) delete opts[k];
      else opts[k] = v;
    }
    if (Object.keys(changes).length) {
      // o plano muda junto (ex.: destaque liga o detalhe do jogo principal e dobra o custo do tick)
      this.sentPlans.clear();
      this.log.info({ changes }, 'configuração do ao vivo atualizada');
    }
  }

  /** Refaz o plano do dia em `now` e registra o orçamento no Governor quando ele muda. */
  async plan(now: Date = this.now()): Promise<{ plan: LiveDayPlan; candidates: LiveCandidate[] }> {
    const candidates = await this.loadCandidates(now);
    const { day } = utcDayBounds(now);
    const usage = await this.deps.governor.usage(this.deps.sport, day);
    const hints = { halftimeSeenAt: this.halftimeSeenAt };
    const base = { sport: this.deps.sport, now, candidates, usage, options: this.options, hints };
    let plan = planLiveDay({ ...base, order: this.order?.ids });

    // mais jogos relevantes do que orçamento: o priorizador (ex.: LLM) pode reordenar; falhou → base
    if (this.deps.prioritize && plan.excluded.some((e) => e.reason === 'budget')) {
      const pool = [
        ...plan.included.map((i) => i.candidate.eventId),
        ...plan.excluded.filter((e) => e.reason === 'budget').map((e) => e.eventId),
      ].sort();
      const key = `${day}|${pool.join(',')}`;
      if (this.order?.key !== key) {
        const poolSet = new Set(pool);
        try {
          const ids = await this.deps.prioritize({
            sport: this.deps.sport,
            day,
            candidates: candidates.filter((c) => poolSet.has(c.eventId)),
            ticksAvailable: plan.budget.ticksLeft,
          });
          this.order = { key, ids: Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : [] };
        } catch (err) {
          this.log.warn({ err }, 'priorizador falhou; seguindo com a ordem determinística');
          this.order = { key, ids: [] };
        }
        plan = planLiveDay({ ...base, order: this.order.ids });
      }
    }

    // aumentos vão na hora; reduções (o orçamento útil encolhe com o passar do dia) só quando relevantes —
    // manter o LIVE um pouco acima do necessário é seguro e poupa escrita a cada tick
    const sent = this.sentPlans.get(day);
    const prev = sent ? (JSON.parse(sent) as LiveDayPlan['quotaPlan']) : null;
    const step = Math.max(5, Math.ceil(usage.dailyLimit * 0.02));
    if (
      !prev ||
      prev.DAILY !== plan.quotaPlan.DAILY ||
      plan.quotaPlan.LIVE > prev.LIVE ||
      prev.LIVE - plan.quotaPlan.LIVE >= step ||
      (plan.quotaPlan.LIVE === plan.budget.liveUsed && prev.LIVE !== plan.quotaPlan.LIVE)
    ) {
      await this.deps.governor.plan(this.deps.sport, day, plan.quotaPlan);
      this.sentPlans.set(day, JSON.stringify(plan.quotaPlan));
      this.log.info(
        {
          day,
          live_budget: plan.quotaPlan.LIVE,
          daily_protected: plan.quotaPlan.DAILY,
          included: plan.included.length,
          relevant: plan.relevant,
          window_minutes: plan.windowMinutes,
          interval_s: Number.isFinite(plan.nominalIntervalMs)
            ? Math.round(plan.nominalIntervalMs / 1000)
            : null,
          ticks_left: plan.budget.ticksLeft,
          featured: plan.featured,
        },
        plan.included.length
          ? 'plano ao vivo do dia'
          : 'dia sem jogos relevantes: LIVE = 0 (folga para o BOOTSTRAP)',
      );
    }
    await this.deps.hooks?.onPlan?.(plan);
    return { plan, candidates };
  }

  /** Primeiro início de janela depois do dia de cota atual (para decidir se vale ficar no ar). */
  private nextDayWindowStart(candidates: LiveCandidate[], plan: LiveDayPlan): Date | null {
    const tomorrow = planLiveDay({
      sport: this.deps.sport,
      now: plan.dayEnd,
      candidates,
      usage: {
        dailyLimit: Infinity,
        reserve: 0,
        used: { BOOTSTRAP: 0, DAILY: 0, LIVE: 0, ADHOC: 0 },
        budget: { BOOTSTRAP: 0, DAILY: 0, LIVE: 0, ADHOC: 0 },
        totalUsed: 0,
      },
      options: { ...this.options, maxIntervalMs: Infinity },
    });
    const starts = tomorrow.included.map((i) => i.window.start.getTime());
    return starts.length ? new Date(Math.min(...starts)) : null;
  }

  async run(signal?: AbortSignal): Promise<LiveRunSummary> {
    const summary: LiveRunSummary = {
      stoppedBy: 'idle',
      ticks: 0,
      calls: 0,
      errors: 0,
      changes: 0,
      published: 0,
      goals: 0,
      finalized: 0,
      plans: new Map(),
      gaps: [],
    };
    const opts = this.options;
    // com releitura de configuração, nenhuma espera passa do intervalo dela
    const refreshCap = this.deps.refresh?.everyMs ?? Infinity;
    const sleepUntil = async (until: Date, cap = Infinity) => {
      const ms = Math.min(until.getTime() - this.clock.now(), cap, refreshCap);
      await this.clock.sleep(Math.max(1_000, ms), signal);
    };

    for (;;) {
      if (signal?.aborted) {
        summary.stoppedBy = 'aborted';
        break;
      }
      const now = this.now();
      if (opts.until && now >= opts.until) {
        summary.stoppedBy = 'until';
        break;
      }
      if (opts.maxTicks !== undefined && summary.ticks >= opts.maxTicks) {
        summary.stoppedBy = 'max_ticks';
        break;
      }

      let step: { plan: LiveDayPlan; candidates: LiveCandidate[] };
      try {
        await this.refreshOptions();
        step = await this.plan(now);
      } catch (err) {
        // erro inesperado ao planejar (ex.: banco ou Governor fora): não derruba o processo; tenta de novo
        this.log.error({ err }, 'falha ao planejar o ao vivo; tentando de novo');
        summary.errors += 1;
        await sleepUntil(new Date(now.getTime() + PLAN_RETRY_MS), opts.replanEveryMs);
        continue;
      }
      const { plan, candidates } = step;
      summary.plans.set(plan.day, plan);
      const decision = decideTick(plan, now, this.lastTickAt, opts, { halftimeSeenAt: this.halftimeSeenAt });

      if (decision.kind === 'done') {
        const next = this.nextDayWindowStart(candidates, plan);
        const wake = next && next < plan.dayEnd ? next : plan.dayEnd;
        if (opts.idleExitMs !== null && (!next || next.getTime() - now.getTime() > opts.idleExitMs)) {
          this.log.info(
            { next_window: next?.toISOString() ?? null },
            'sem janelas ao vivo próximas; encerrando',
          );
          summary.stoppedBy = 'idle';
          break;
        }
        await sleepUntil(opts.until && opts.until < wake ? opts.until : wake, opts.replanEveryMs);
        continue;
      }

      if (decision.kind === 'wait') {
        if (
          !decision.active &&
          opts.idleExitMs !== null &&
          decision.until.getTime() - now.getTime() > opts.idleExitMs
        ) {
          this.log.info({ next_window: decision.until.toISOString() }, 'próxima janela distante; encerrando');
          summary.stoppedBy = 'idle';
          break;
        }
        const until =
          this.backoffUntil && this.backoffUntil > decision.until ? this.backoffUntil : decision.until;
        await sleepUntil(opts.until && opts.until < until ? opts.until : until, opts.replanEveryMs);
        continue;
      }

      if (this.backoffUntil && this.backoffUntil > now) {
        await sleepUntil(this.backoffUntil, opts.replanEveryMs);
        continue;
      }

      // ── tick ──
      const active = new Set(decision.eventIds);
      const tracked = plan.included.filter((m) => active.has(m.candidate.eventId)).map((m) => m.candidate);
      const featured = plan.featured
        ? (tracked.find((c) => isInPlay(c.status) && c.providerEventId) ?? null)
        : null;
      // nunca mais confirmações num tick do que o plano reservou
      const finalizeBudget = Math.min(opts.maxFinalizePerTick, plan.budget.finalizeReserve);
      let report: TickReport;
      try {
        report = await this.poller.tick({
          now,
          leagues: decision.leagues,
          tracked,
          featured,
          finalizeBudget,
        });
      } catch (err) {
        // erro inesperado (ex.: banco): não derruba o processo; tenta de novo no próximo intervalo
        this.log.error({ err }, 'falha no tick ao vivo');
        this.lastTickAt = now;
        summary.errors += 1;
        continue;
      }
      if (this.lastTickAt) summary.gaps.push(now.getTime() - this.lastTickAt.getTime());
      this.lastTickAt = now;
      summary.ticks += 1;
      summary.calls += report.calls;
      summary.changes += report.changes.length;
      summary.published += report.published;
      summary.goals += report.changes.filter((c) => c.goal).length;
      summary.finalized += report.finalized.length;

      if (report.outcome === 'error') {
        summary.errors += 1;
        this.consecutiveFailures += 1;
        if (report.error?.kind === 'quota') {
          this.backoffUntil = new Date(now.getTime() + opts.replanEveryMs);
        } else if (this.consecutiveFailures >= opts.failureBackoffAfter) {
          const factor = Math.min(8, 2 ** (this.consecutiveFailures - opts.failureBackoffAfter + 1));
          this.backoffUntil = new Date(now.getTime() + decision.intervalMs * factor);
        }
        this.log.warn(
          {
            leagues: report.leagues,
            error: report.error,
            consecutive_failures: this.consecutiveFailures,
            stale: report.staleMarked,
          },
          'tick ao vivo falhou; servindo o último estado válido',
        );
      } else {
        this.consecutiveFailures = 0;
        this.backoffUntil = null;
        this.log.debug(
          {
            leagues: report.leagues,
            events: report.events,
            changes: report.changes.length,
            goals: report.changes.filter((c) => c.goal).length,
            finalized: report.finalized.length,
            interval_s: Math.round(decision.intervalMs / 1000),
          },
          'tick ao vivo',
        );
      }
      try {
        await this.deps.hooks?.onTick?.(report, plan);
      } catch (err) {
        this.log.warn({ err }, 'falha no gancho do tick ao vivo; seguindo');
      }
    }
    return summary;
  }
}

/** Fim da última janela do plano (relatórios). */
export function lastWindowEnd(plan: LiveDayPlan): Date | null {
  const ends = plan.included.map((i) => windowEnd(i.window).getTime());
  return ends.length ? new Date(Math.max(...ends)) : null;
}
