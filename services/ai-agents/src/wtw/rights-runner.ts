/**
 * Direitos por temporada (docs/07 §2.2, nível 1 — job `wtw-rights`): para cada (competição,
 * temporada) com jogos à frente, UMA chamada pesquisa os detentores em todos os mercados da
 * América Latina que ainda não têm direitos (curados ou pesquisados) — ou poucas chamadas, quando
 * a allowlist conjunta não cabe em 100 domínios. O resultado passa pelo validador de direitos e vai
 * para enrich.broadcast_rights. Reconfirmação mensal sem tokens (fetch das fontes); nova pesquisa
 * só se a fonte mudou.
 */
import { and, isNull, lte, ne } from 'drizzle-orm';
import { broadcastRights, type Database } from '@galaxie/db';
import {
  applyRightsResult,
  currentResearchedRights,
  markRightsVerified,
  validateRightsResearch,
  type BroadcastRightsRow,
  type CountryDirectory,
  type WtwConfig,
  curatedDecides,
} from '@galaxie/where-to-watch';
import { BudgetExceededError, LlmError } from '../llm/errors.js';
import type { UsageWithSearches } from '../llm/budget.js';
import type { LlmClient } from '../llm/types.js';
import { WhereToWatchAgent } from './agent.js';
import { recheckRightsRow, verifyRightsCandidate } from './evidence.js';
import { CachingPageFetcher, type PageFetcher } from './fetcher.js';
import { packMarkets } from './groups.js';
import { marketRelevance, wtwPolicyFromEnv, type WtwPolicy } from './relevance.js';
import { loadUpcomingEvents } from './scheduler.js';
import { estimateCallUsd, finishResearch, marketSpendToday, startResearch, withinCap } from './spend.js';

const DAY = 86_400_000;
/** Pesquisa sem resultado (ou com fonte que mudou) volta à fila depois de 30 dias. */
export const RIGHTS_RETRY_DAYS = 30;

export interface RightsNeed {
  competition: { slug: string; name: string };
  season: number;
  /** Mercados sem direitos, empacotados por chamada (allowlist ≤ 100 domínios). */
  chunks: string[][];
  /** Maior relevância de um jogo da competição nos mercados considerados (com ou sem direitos). */
  maxRelevance: number;
  firstStart: Date;
  events: number;
}

export interface PlanRightsOptions {
  now: Date;
  config: WtwConfig;
  /** Mercados considerados (padrão: todos os configurados — a chamada cobre a América Latina). */
  markets?: string[];
  horizonDays?: number;
  competition?: string;
  /** Inclui mercados com linha curada (comparar a pesquisa com a curadoria). */
  includeCurated?: boolean;
  /**
   * Só pesquisa competições com algum jogo de relevância ≥ este valor em algum mercado considerado
   * (`markets`) — inclusive os que já têm direitos: a chamada cobre todos os mercados sem direitos pelo
   * mesmo custo, então a liga que importa no próprio país (curado lá) também ganha direitos nos
   * vizinhos. Com `markets` restrito (--pais), a relevância de fora não conta.
   */
  minRelevance?: number;
}

/** O mercado já tem direitos pesquisados utilizáveis (ou uma tentativa recente)? */
function researchedRecently(row: BroadcastRightsRow | undefined, now: Date): boolean {
  if (!row) return false;
  if (row.flags.includes('source_changed')) return false;
  if (row.status === 'confirmed') return true;
  return now.getTime() - row.createdAt.getTime() < RIGHTS_RETRY_DAYS * DAY;
}

/** Quais (competição, temporada) precisam de pesquisa, e em quais mercados. */
export async function planRightsResearch(db: Database, opts: PlanRightsOptions): Promise<RightsNeed[]> {
  const events = await loadUpcomingEvents(db, {
    now: opts.now,
    horizonMs: (opts.horizonDays ?? 45) * DAY,
  });
  const scoped = opts.competition ? events.filter((e) => e.slug === opts.competition) : events;
  const comps = [...new Set(scoped.map((e) => e.slug))];
  const rows = comps.length ? await currentResearchedRights(db, { competitions: comps }) : [];
  const byKey = new Map(rows.map((r) => [`${r.competitionSlug}|${r.season}|${r.countryCode}`, r]));
  const markets = (opts.markets ?? opts.config.countries).filter((m) => opts.config.has(m));

  const groups = new Map<string, typeof scoped>();
  for (const e of scoped)
    groups.set(`${e.slug}|${e.season}`, [...(groups.get(`${e.slug}|${e.season}`) ?? []), e]);
  const needs: RightsNeed[] = [];
  for (const [, evs] of groups) {
    const first = evs[0]!;
    const lacking = markets.filter((m) => {
      const dir = opts.config.directory(m);
      // curadoria só com detentores incertos não bloqueia a pesquisa (é lacuna, não decisão)
      if (!opts.includeCurated && evs.some((e) => curatedDecides(dir.rightsFor(e.slug, e.startsAt))))
        return false;
      return !researchedRecently(byKey.get(`${first.slug}|${first.season}|${m}`), opts.now);
    });
    if (!lacking.length) continue;
    const dirs = lacking.map((m) => opts.config.directory(m));
    const maxRelevance = Math.max(
      ...evs.flatMap((e) =>
        // só os mercados pedidos (--pais): fora deles a relevância não justifica a chamada
        markets.map((m) =>
          marketRelevance(
            {
              importance: e.importance,
              participantCountries: e.participantCountries,
              competitionCountry: e.countryCode,
              competition: { sport: e.sport, slug: e.slug },
            },
            m,
          ),
        ),
      ),
    );
    if (opts.minRelevance !== undefined && maxRelevance < opts.minRelevance) continue;
    needs.push({
      competition: { slug: first.slug, name: first.name },
      season: first.season,
      chunks: packMarkets(dirs).map((c) => c.map((d) => d.country)),
      maxRelevance,
      firstStart: first.startsAt,
      events: evs.length,
    });
  }
  return needs.sort(
    (a, b) => b.maxRelevance - a.maxRelevance || a.firstStart.getTime() - b.firstStart.getTime(),
  );
}

export interface RightsJobDeps {
  db: Database;
  llm?: LlmClient | undefined;
  config: WtwConfig;
  fetcher: PageFetcher;
  policy?: WtwPolicy;
  now?: () => Date;
  log?: (m: string) => void;
}

export interface RightsCallOutcome {
  competition: string;
  season: number;
  markets: string[];
  status: 'done' | 'failed' | 'skipped';
  researchId: string | null;
  costUsd: number | null;
  byCountry: Record<string, { status: string; distribution: string; holders: string[]; action: string }>;
  error?: string;
}

export class RightsResearcher {
  private readonly now: () => Date;
  private readonly log: (m: string) => void;
  private readonly policy: WtwPolicy;
  private readonly fetcher: CachingPageFetcher;

  constructor(private readonly deps: RightsJobDeps) {
    this.now = deps.now ?? (() => new Date());
    this.log = deps.log ?? (() => {});
    this.policy = deps.policy ?? wtwPolicyFromEnv();
    this.fetcher = new CachingPageFetcher(deps.fetcher);
  }

  /** Reconfirmação (sem tokens) das linhas pesquisadas verificadas há mais de `olderThanDays`. */
  async revalidate(opts: { olderThanDays?: number; limit?: number } = {}): Promise<{
    checked: number;
    touched: number;
    changed: number;
  }> {
    const cutoff = new Date(this.now().getTime() - (opts.olderThanDays ?? 30) * DAY);
    const rows = await this.deps.db
      .select()
      .from(broadcastRights)
      .where(
        and(
          isNull(broadcastRights.supersededBy),
          ne(broadcastRights.status, 'retracted'),
          lte(broadcastRights.lastVerifiedAt, cutoff),
        ),
      )
      .limit(opts.limit ?? 50);
    let touched = 0;
    let changed = 0;
    for (const row of rows) {
      if (!this.deps.config.has(row.countryCode) || row.status !== 'confirmed') continue;
      const dir = this.deps.config.directory(row.countryCode);
      const check = await recheckRightsRow(row, dir, this.fetcher, this.now());
      const r = await markRightsVerified(this.deps.db, row, check, this.now());
      if (r === 'touched') touched++;
      else {
        changed++;
        this.log(`${row.competitionSlug} ${row.season} ${row.countryCode}: ${check.reasons.join('; ')}`);
      }
    }
    return { checked: rows.length, touched, changed };
  }

  /** Executa as pesquisas pendentes, até `maxCalls` chamadas, respeitando o teto por mercado. */
  async run(
    needs: RightsNeed[],
    opts: { maxCalls: number; requestedBy?: string },
  ): Promise<RightsCallOutcome[]> {
    const out: RightsCallOutcome[] = [];
    if (!this.deps.llm) {
      this.log('Sem cliente de LLM: pesquisa de direitos adiada.');
      return out;
    }
    const agent = new WhereToWatchAgent(this.deps.llm);
    const spend = await marketSpendToday(this.deps.db, this.now());
    const estimate = await estimateCallUsd(this.deps.db, 'rights');
    let calls = 0;
    for (const need of needs) {
      for (const chunk of need.chunks) {
        if (calls >= opts.maxCalls) return out;
        const { allowed } = withinCap(spend, chunk, estimate, this.policy.dailyUsdPerMarket);
        if (!allowed.length) {
          this.log(`${need.competition.slug} ${need.season}: teto diário dos mercados ${chunk.join(',')}`);
          continue;
        }
        const month = this.now().toISOString().slice(0, 7);
        const researchId = await startResearch(this.deps.db, {
          kind: 'rights',
          researchKey: `rights:${need.competition.slug}:${need.season}:${allowed.join(',')}:${month}`,
          competition: need.competition.slug,
          season: need.season,
          markets: allowed,
          requestedBy: opts.requestedBy ?? 'scheduler',
          now: this.now(),
        });
        if (!researchId) continue;
        calls++;
        out.push(await this.researchOne(agent, need, allowed, researchId, spend));
      }
    }
    return out;
  }

  private async researchOne(
    agent: WhereToWatchAgent,
    need: RightsNeed,
    markets: string[],
    researchId: string,
    spend: Map<string, number>,
  ): Promise<RightsCallOutcome> {
    const { db, config } = this.deps;
    const dirs: CountryDirectory[] = markets.map((m) => config.directory(m));
    const base = {
      competition: need.competition.slug,
      season: need.season,
      markets,
      researchId,
    };
    try {
      const res = await agent.researchRights({
        competition: need.competition,
        season: need.season,
        directories: dirs,
      });
      const usage = res.result.usage as UsageWithSearches;
      const byCountry: RightsCallOutcome['byCountry'] = {};
      let fetched = 0;
      for (const m of markets) {
        const dir = config.directory(m);
        const cand = res.markets.find((c) => c.country === m) ?? {
          country: m,
          distribution: 'to_confirm' as const,
          holders: [],
          notes: 'sem resultado na pesquisa',
        };
        const verified = await verifyRightsCandidate(cand, dir, this.fetcher, this.now());
        fetched += verified.fetched;
        const validated = validateRightsResearch(verified.candidate, { directory: dir, now: this.now() });
        if (!res.markets.some((c) => c.country === m)) validated.flags.push('not_found');
        const applied = await applyRightsResult(db, {
          competition: need.competition.slug,
          season: need.season,
          result: validated,
          researchId,
          now: this.now(),
        });
        byCountry[m] = {
          status: validated.status,
          distribution: validated.distribution,
          holders: validated.holders.map(
            (h) => `${h.broadcasterId ?? h.name}${h.status === 'confirmed' ? '' : '?'}`,
          ),
          action: applied.action,
        };
      }
      await finishResearch(db, researchId, {
        status: 'done',
        usage,
        model: { provider: res.result.provider, model: res.result.model },
        stats: { byCountry, fetched, citations: res.citations.length, notes: res.notes },
        now: this.now(),
      });
      const cost = usage.costUsd ?? null;
      if (cost !== null) for (const m of markets) spend.set(m, (spend.get(m) ?? 0) + cost / markets.length);
      this.log(
        `${need.competition.slug} ${need.season} [${markets.join(',')}]: US$ ${cost?.toFixed(4) ?? '?'}`,
      );
      return { ...base, status: 'done', costUsd: cost, byCountry };
    } catch (err) {
      const partial = (err as { usage?: UsageWithSearches }).usage;
      const message = err instanceof LlmError || err instanceof Error ? err.message : String(err);
      const status = err instanceof BudgetExceededError ? 'skipped' : 'failed';
      await finishResearch(db, researchId, {
        status,
        usage: partial,
        error: message.slice(0, 500),
        now: this.now(),
      });
      return { ...base, status, costUsd: partial?.costUsd ?? null, byCountry: {}, error: message };
    }
  }
}
