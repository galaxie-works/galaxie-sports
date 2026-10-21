/**
 * Orquestra uma execução do onde assistir para (evento, país):
 *
 *   revalidate (T-3h, T-30min): fetch + diff das URLs salvas → nada mudou: só renova `last_verified_at`
 *                               (zero tokens); mudou ou não há opção confirmada: vira busca completa.
 *   full (T-7d, T-24h, manual): agente (LLM + busca) → verificação HTTP das evidências (novas + salvas)
 *                               → validador determinístico → gravação versionada → change feed.
 */
import { eq } from 'drizzle-orm';
import { wtwRun, type Database } from '@galaxie/db';
import {
  applyAgentResult,
  currentOptions,
  isEditorial,
  touchVerified,
  validateCandidates,
  type ApplyResult,
  type Candidate,
  type WtwConfig,
} from '@galaxie/where-to-watch';
import { BudgetExceededError, LlmError } from '../llm/errors.js';
import type { LlmClient } from '../llm/types.js';
import type { UsageWithSearches } from '../llm/budget.js';
import { WhereToWatchAgent } from './agent.js';
import { loadEventInfo } from './event-info.js';
import { revalidateOptions, rowToCandidate, verifyCandidates } from './evidence.js';
import { CachingPageFetcher, type PageFetcher } from './fetcher.js';
import { claimRuns, requeueStale, type WtwRunRow } from './scheduler.js';

export interface WtwRunnerDeps {
  db: Database;
  /** Opcional: sem LLM, só revalida (buscas completas ficam `skipped`). */
  llm?: LlmClient | undefined;
  config: WtwConfig;
  fetcher: PageFetcher;
  now?: () => Date;
  log?: (message: string) => void;
}

export interface RunOutcome {
  runId: string;
  eventId: string;
  country: string;
  window: string;
  status: 'done' | 'failed' | 'skipped';
  mode: 'full' | 'revalidate';
  stats: Record<string, unknown>;
  error?: string;
}

const ACTIVE = new Set(['confirmed', 'pending', 'omitted']);

export class WtwRunner {
  private readonly now: () => Date;
  private readonly log: (m: string) => void;

  constructor(private readonly deps: WtwRunnerDeps) {
    this.now = deps.now ?? (() => new Date());
    this.log = deps.log ?? (() => {});
  }

  /** Reserva e executa as execuções enfileiradas (em série — o custo por execução domina). */
  async runQueued(opts: { limit: number; eventId?: string; country?: string }): Promise<RunOutcome[]> {
    await requeueStale(this.deps.db, this.now());
    const runs = await claimRuns(this.deps.db, { now: this.now(), ...opts });
    const out: RunOutcome[] = [];
    for (const run of runs) out.push(await this.execute(run));
    return out;
  }

  async execute(run: WtwRunRow): Promise<RunOutcome> {
    const base = { runId: run.id, eventId: run.eventId, country: run.countryCode, window: run.window };
    const stats: Record<string, unknown> = {};
    let usage: UsageWithSearches | undefined;
    let model: { provider: string; model: string } | undefined;
    const finish = async (status: RunOutcome['status'], mode: RunOutcome['mode'], error?: string) => {
      await this.deps.db
        .update(wtwRun)
        .set({
          status,
          mode,
          finishedAt: this.now(),
          stats,
          error: error ?? null,
          ...(usage
            ? {
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                costUsd: usage.costUsd === undefined ? null : usage.costUsd.toFixed(6),
              }
            : {}),
          ...(model ? { provider: model.provider, model: model.model } : {}),
        })
        .where(eq(wtwRun.id, run.id));
      const outcome: RunOutcome = { ...base, status, mode, stats, ...(error ? { error } : {}) };
      this.log(
        `${run.window} ${run.eventId} ${run.countryCode}: ${status} (${mode})${error ? ` — ${error}` : ''}`,
      );
      return outcome;
    };

    try {
      const info = await loadEventInfo(this.deps.db, run.eventId);
      if (!info) return await finish('skipped', run.mode, 'evento inexistente');
      if (!['scheduled', 'starting'].includes(info.status) || info.startsAt.getTime() <= this.now().getTime())
        return await finish('skipped', run.mode, `evento já iniciado ou fora da agenda (${info.status})`);
      if (!this.deps.config.has(run.countryCode))
        return await finish('skipped', run.mode, `país sem dicionário: ${run.countryCode}`);

      const directory = this.deps.config.directory(run.countryCode);
      const fetcher = new CachingPageFetcher(this.deps.fetcher);
      const current = await currentOptions(this.deps.db, run.eventId, run.countryCode);
      const agentRows = current.filter((r) => ACTIVE.has(r.status) && !isEditorial(r));

      let mode: RunOutcome['mode'] = run.mode;
      if (mode === 'revalidate') {
        const check = await revalidateOptions(agentRows, directory, fetcher, this.now());
        stats.revalidation = {
          fetched: check.fetched,
          changed: check.changed,
          reasons: check.reasons.slice(0, 20),
        };
        const hasConfirmed = current.some((r) => r.status === 'confirmed');
        if (!check.changed && hasConfirmed) {
          stats.touched = await touchVerified(this.deps.db, check.updates, this.now());
          return await finish('done', 'revalidate');
        }
        stats.escalated = check.changed ? 'mudança nas fontes salvas' : 'sem opção confirmada';
        mode = 'full';
      }

      if (!this.deps.llm) return await finish('skipped', mode, 'sem cliente de LLM configurado');
      const rights = directory.rightsFor(info.competition?.slug, info.startsAt);
      const agent = new WhereToWatchAgent(this.deps.llm);
      const research = await agent.research({
        info,
        directory,
        rights,
        previous: agentRows.map((r) => ({
          provider: r.providerName,
          channel: r.channelName,
          region: r.region,
          status: r.status,
          sources: r.evidence.map((e) => e.url).slice(0, 3),
        })),
      });
      usage = research.result.usage as UsageWithSearches;
      model = { provider: research.result.provider, model: research.result.model };

      // Opções salvas entram de novo como candidatas: sem isso, uma busca que "não achou" apagaria
      // opções boas. Elas só caem se as próprias fontes não se sustentarem mais.
      const candidates: Candidate[] = [...research.candidates, ...agentRows.map(rowToCandidate)];
      const verified = await verifyCandidates(candidates, directory, fetcher, this.now());
      const report = validateCandidates(verified.candidates, {
        directory,
        competitionSlug: info.competition?.slug ?? null,
        eventStartsAt: info.startsAt,
        now: this.now(),
      });
      const applied: ApplyResult = await applyAgentResult(this.deps.db, {
        eventId: run.eventId,
        country: run.countryCode,
        options: report.options,
        retractMissing: true,
        runId: run.id,
        now: this.now(),
      });
      Object.assign(stats, {
        candidates: research.candidates.length,
        reconsidered: agentRows.length,
        citations: research.citations.length,
        fetched: verified.fetched,
        fetchFailed: verified.failed,
        byStatus: countBy(report.options, (o) => o.status),
        discarded: countBy(report.discarded, (d) => d.reason),
        inserted: applied.inserted,
        touched: applied.touched,
        retracted: applied.retracted,
        lockedByEditorial: applied.lockedByEditorial,
        publicChanged: applied.publicChanged,
        notes: research.notes,
      });
      return await finish('done', mode);
    } catch (err) {
      const partial = (err as { usage?: UsageWithSearches }).usage;
      if (partial) usage = partial;
      if (err instanceof BudgetExceededError) return finish('skipped', run.mode, err.message);
      const message = err instanceof LlmError || err instanceof Error ? err.message : String(err);
      return finish('failed', run.mode, message.slice(0, 500));
    }
  }
}

function countBy<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[key(i)] = (out[key(i)] ?? 0) + 1;
  return out;
}
