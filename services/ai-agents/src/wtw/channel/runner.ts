/**
 * Job do canal do jogo (`wtw-channel`, docs/07 §2.2.4). Para cada grupo devido (competição × rodada ×
 * janela × dia):
 *
 *   1. importação (sem LLM): as opções salvas pelo agente com fonte de jogo (alocação por rodada,
 *      revalidação) passam pelo validador do canal com a página buscada de novo — o que ele aceitar
 *      vira canal do jogo (`window = import`);
 *   2. pesquisa: UMA chamada (Gemini com grounding) para os jogos × mercados que seguem sem canal
 *      oficial, dentro do teto diário do mercado e do orçamento global de tokens (ops.llm_usage);
 *   3. validação determinística (`validateMatchChannels`) com as páginas buscadas → gravação em
 *      enrich.match_channel. O que não passa fica "a confirmar".
 *
 * `dryRun` (prévia `--plan`): faz a importação e mostra o que gravaria, sem gravar e sem LLM.
 */
import { and, eq, inArray, isNull, like } from 'drizzle-orm';
import { broadcastOption, wtwResearch, type Database } from '@galaxie/db';
import {
  applyMatchChannels,
  isEditorial,
  teamNames,
  validateMatchChannels,
  type ChannelProposal,
  type ChannelValidationReport,
  type CountryDirectory,
  type FetchedPage,
  type WtwConfig,
} from '@galaxie/where-to-watch';
import { BudgetExceededError, LlmError } from '../../llm/errors.js';
import type { UsageWithSearches } from '../../llm/budget.js';
import type { LlmClient } from '../../llm/types.js';
import { loadEventInfos, type EventInfo } from '../event-info.js';
import { shouldFetch } from '../evidence.js';
import { CachingPageFetcher, type PageFetcher } from '../fetcher.js';
import type { WtwPolicy } from '../relevance.js';
import { WTW_MAX_MATCHES_PER_CALL } from '../schema.js';
import { estimateCallUsd, finishResearch, marketSpendToday, startResearch, withinCap } from '../spend.js';
import { MatchChannelAgent } from './agent.js';
import type { ChannelGroup, ChannelTarget } from './plan.js';
import type { ChannelMarket } from './prompt.js';

export interface ChannelRunnerDeps {
  db: Database;
  llm?: LlmClient | undefined;
  config: WtwConfig;
  fetcher: PageFetcher;
  policy: WtwPolicy;
  now?: () => Date;
  log?: (message: string) => void;
}

/** Resultado da validação de um jogo × país (o que gravou ou gravaria). */
export interface TargetOutcome {
  eventId: string;
  country: string;
  source: 'import' | 'research';
  report: ChannelValidationReport;
}

export type GroupStatus =
  | 'researched'
  | 'resolved_by_import'
  | 'already_researched'
  | 'deferred'
  | 'capped'
  | 'no_llm'
  | 'failed'
  | 'planned';

export interface GroupOutcome {
  key: string;
  window: string;
  events: number;
  markets: string[];
  status: GroupStatus;
  calls: number;
  researchIds: string[];
  costUsd: number;
  error?: string;
}

export interface ChannelRunReport {
  groups: GroupOutcome[];
  targets: TargetOutcome[];
  applied: { inserted: number; updated: number; retracted: number };
  /** Estimativa por chamada usada no teto (US$). */
  estimateUsd: number;
}

const ACTIVE_OPTION = new Set(['confirmed', 'pending', 'probable']);

export class MatchChannelRunner {
  private readonly now: () => Date;
  private readonly log: (m: string) => void;

  constructor(private readonly deps: ChannelRunnerDeps) {
    this.now = deps.now ?? (() => new Date());
    this.log = deps.log ?? (() => {});
  }

  async run(
    groups: ChannelGroup[],
    opts: { maxCalls: number; dryRun?: boolean; importSaved?: boolean },
  ): Promise<ChannelRunReport> {
    const { db } = this.deps;
    const dryRun = opts.dryRun ?? false;
    const fetcher = new CachingPageFetcher(this.deps.fetcher);
    const infos = await loadEventInfos(db, [
      ...new Set(groups.flatMap((g) => g.targets.map((t) => t.event.id))),
    ]);
    const estimateUsd = await estimateCallUsd(db, 'channel');
    const spend = await marketSpendToday(db, this.now());
    const report: ChannelRunReport = {
      groups: [],
      targets: [],
      applied: { inserted: 0, updated: 0, retracted: 0 },
      estimateUsd,
    };
    let callsLeft = opts.maxCalls;

    for (const group of groups) {
      const all = [...new Set(group.targets.map((t) => t.country))].sort();
      const out: GroupOutcome = {
        key: group.key,
        window: group.window.window,
        events: new Set(group.targets.map((t) => t.event.id)).size,
        markets: all,
        status: dryRun ? 'planned' : 'researched',
        calls: 0,
        researchIds: [],
        costUsd: 0,
      };
      report.groups.push(out);
      // pesquisa do grupo: uma vez por janela e mercado (a importação também não se repete). O mercado
      // cortado pelo teto não entra na chave de quem foi pesquisado: volta na próxima rodada.
      const base = `channel:${group.key}:${group.season}`;
      const covered = await this.researchedMarkets(base);
      const targets = group.targets.filter((t) => !covered.has(t.country));
      const markets = all.filter((m) => !covered.has(m));
      if (!targets.length) {
        out.status = 'already_researched';
        continue;
      }

      // 1. importação das opções salvas (sem LLM)
      let pending = targets;
      if (opts.importSaved ?? true) {
        const resolved = new Set<string>();
        for (const t of targets) {
          const res = await this.importSaved(t, infos.get(t.event.id), fetcher, group, dryRun, report);
          if (res === 'official') resolved.add(`${t.event.id}:${t.country}`);
        }
        pending = targets.filter((t) => !resolved.has(`${t.event.id}:${t.country}`));
        if (!pending.length) {
          out.status = 'resolved_by_import';
          if (!dryRun) {
            const id = await startResearch(db, {
              kind: 'channel',
              researchKey: `${base}:${markets.join(',')}:import`,
              competition: group.competition.slug,
              season: group.season,
              round: group.round,
              markets,
              now: this.now(),
            });
            if (id)
              await finishResearch(db, id, {
                status: 'done',
                stats: { window: group.window.window, resolvedByImport: targets.length },
                now: this.now(),
              });
          }
          continue;
        }
      }
      if (dryRun) continue;
      if (!this.deps.llm) {
        out.status = 'no_llm';
        continue;
      }

      // 2. pesquisa: uma chamada por pedaço de até 12 jogos, todos os mercados do pedaço
      const cap = withinCap(spend, markets, estimateUsd, this.policy.dailyUsdPerMarket);
      if (!cap.allowed.length) {
        out.status = 'capped';
        continue;
      }
      pending = pending.filter((t) => cap.allowed.includes(t.country));
      const events = [...new Map(pending.map((t) => [t.event.id, t.event])).values()].sort(
        (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
      );
      const chunks: (typeof events)[] = [];
      for (let i = 0; i < events.length; i += WTW_MAX_MATCHES_PER_CALL)
        chunks.push(events.slice(i, i + WTW_MAX_MATCHES_PER_CALL));
      if (chunks.length > callsLeft) {
        out.status = 'deferred';
        continue;
      }
      let any = false;
      for (const [i, chunk] of chunks.entries()) {
        const ids = new Set(chunk.map((e) => e.id));
        // o teto vale a cada chamada: o gasto dos pedaços anteriores já conta
        const capHere = withinCap(
          spend,
          [...new Set(pending.filter((t) => ids.has(t.event.id)).map((t) => t.country))].sort(),
          estimateUsd,
          this.policy.dailyUsdPerMarket,
        );
        if (capHere.blocked.length)
          this.log(`${group.key}: teto diário de ${capHere.blocked.join(',')} — fica para depois`);
        const inChunk = pending.filter((t) => ids.has(t.event.id) && capHere.allowed.includes(t.country));
        if (!inChunk.length) {
          if (!any) out.status = 'capped';
          continue;
        }
        const here = [...new Set(inChunk.map((t) => t.country))].sort();
        const games = chunk.filter((e) => inChunk.some((t) => t.event.id === e.id));
        const researchId = await startResearch(db, {
          kind: 'channel',
          researchKey: `${base}:${here.join(',')}:${i}`,
          competition: group.competition.slug,
          season: group.season,
          round: group.round,
          markets: here,
          now: this.now(),
        });
        if (!researchId) {
          out.status = any ? out.status : 'already_researched';
          continue;
        }
        callsLeft--;
        out.calls++;
        out.researchIds.push(researchId);
        any = true;
        if (out.status === 'capped') out.status = 'researched';
        try {
          const cost = await this.research(group, games, inChunk, infos, fetcher, researchId, report);
          out.costUsd += cost;
          for (const m of here) spend.set(m, (spend.get(m) ?? 0) + cost / here.length);
        } catch (err) {
          const partial = (err as { usage?: UsageWithSearches }).usage;
          const message = err instanceof LlmError || err instanceof Error ? err.message : String(err);
          await finishResearch(db, researchId, {
            status: err instanceof BudgetExceededError ? 'skipped' : 'failed',
            usage: partial,
            error: message.slice(0, 500),
            now: this.now(),
          });
          out.status = 'failed';
          out.error = message.slice(0, 200);
          this.log(`${group.key}: pesquisa falhou — ${out.error}`);
        }
      }
    }
    if (fetcher.hits) this.log(`cache de páginas: ${fetcher.size} URLs, ${fetcher.hits} reaproveitadas`);
    return report;
  }

  /** Mercados do grupo já pesquisados (ou sendo pesquisados) nesta janela. */
  private async researchedMarkets(base: string): Promise<Set<string>> {
    const rows = await this.deps.db
      .select({ markets: wtwResearch.markets })
      .from(wtwResearch)
      .where(
        and(
          like(wtwResearch.researchKey, `${base.replace(/[\\%_]/g, '\\$&')}:%`),
          inArray(wtwResearch.status, ['done', 'running']),
        ),
      );
    return new Set(rows.flatMap((r) => r.markets));
  }

  private get policy(): WtwPolicy {
    return this.deps.policy;
  }

  /** Uma chamada ao modelo para um pedaço da rodada; valida e grava cada jogo × país. */
  private async research(
    group: ChannelGroup,
    chunk: ChannelTarget['event'][],
    targets: ChannelTarget[],
    infos: Map<string, EventInfo>,
    fetcher: CachingPageFetcher,
    researchId: string,
    report: ChannelRunReport,
  ): Promise<number> {
    const { db, config } = this.deps;
    const events = chunk.map((e) => infos.get(e.id)).filter((i): i is EventInfo => !!i);
    const codeOf = new Map(events.map((e, j) => [e.id, `J${j + 1}`]));
    const countries = [...new Set(targets.map((t) => t.country))].sort();
    const markets: ChannelMarket[] = countries.map((c) => {
      const ts = targets.filter((t) => t.country === c);
      return {
        directory: config.directory(c),
        holders: [...new Set(ts.flatMap((t) => t.holders))],
        matches: ts.flatMap((t) => (codeOf.has(t.event.id) ? [codeOf.get(t.event.id)!] : [])),
      };
    });
    const agent = new MatchChannelAgent(this.deps.llm!);
    const res = await agent.research({
      competition: group.competition,
      season: group.season,
      round: group.round,
      phase: group.window.phase,
      window: group.window.window,
      events,
      markets,
    });
    const usage = res.result.usage as UsageWithSearches;
    const accepted: Record<string, number> = {};
    const rejected: Record<string, number> = {};
    let assignments = 0;
    for (const t of targets) {
      const proposals = res.byEvent.get(t.event.id)?.get(t.country) ?? [];
      assignments += proposals.length;
      if (!proposals.length) continue;
      const info = infos.get(t.event.id);
      if (!info) continue;
      const directory = config.directory(t.country);
      const pages = await this.fetchPages(proposals, directory, fetcher);
      const r = validateMatchChannels(proposals, {
        directory,
        rights: t.rights,
        teams: teamsOf(info),
        eventStartsAt: info.startsAt,
        now: this.now(),
        groundedUrls: res.groundedUrls,
        pages,
        // provedor sem grounding garantido: só com a página conferida
        requirePageVerified: res.groundedUrls === null,
      });
      report.targets.push({ eventId: t.event.id, country: t.country, source: 'research', report: r });
      for (const a of r.accepted) accepted[a.sourceKind] = (accepted[a.sourceKind] ?? 0) + 1;
      for (const x of r.rejected) rejected[x.reason] = (rejected[x.reason] ?? 0) + 1;
      if (r.accepted.length) {
        const applied = await applyMatchChannels(db, {
          eventId: t.event.id,
          country: t.country,
          accepted: r.accepted,
          phase: group.window.phase,
          window: group.window.window,
          researchId,
          now: this.now(),
        });
        report.applied.inserted += applied.inserted;
        report.applied.updated += applied.updated;
        report.applied.retracted += applied.retracted;
      }
    }
    await finishResearch(db, researchId, {
      status: 'done',
      usage,
      model: { provider: res.result.provider, model: res.result.model },
      stats: {
        window: group.window.window,
        phase: group.window.phase,
        events: events.length,
        markets: countries,
        assignments,
        ignored: res.ignored,
        accepted,
        rejected,
        grounded: res.groundedUrls?.length ?? null,
        notes: res.notes,
      },
      now: this.now(),
    });
    this.log(
      `${group.key} [${countries.join(',')}]: ${assignments} proposta(s), aceitas ${JSON.stringify(accepted)}, recusadas ${JSON.stringify(rejected)}`,
    );
    return usage.costUsd ?? 0;
  }

  /**
   * Importa as opções salvas pelo agente (com fonte do jogo) para o canal do jogo, com a página buscada
   * de novo. Devolve `official` quando o jogo × país ficou com canal de fonte oficial.
   */
  private async importSaved(
    t: ChannelTarget,
    info: EventInfo | undefined,
    fetcher: CachingPageFetcher,
    group: ChannelGroup,
    dryRun: boolean,
    report: ChannelRunReport,
  ): Promise<'official' | 'press' | null> {
    if (!info) return null;
    const { db, config } = this.deps;
    const rows = await db
      .select()
      .from(broadcastOption)
      .where(
        and(
          eq(broadcastOption.eventId, t.event.id),
          eq(broadcastOption.countryCode, t.country),
          isNull(broadcastOption.supersededBy),
        ),
      );
    const proposals: ChannelProposal[] = rows
      .filter((r) => ACTIVE_OPTION.has(r.status) && !isEditorial(r) && r.broadcasterId)
      .map((r) => ({
        broadcasterId: r.broadcasterId!,
        channel: r.channelName,
        evidence: r.evidence
          .filter((e) => e.stance !== 'denies' && e.sourceKind !== 'rights' && e.sourceKind !== 'editorial')
          .map((e) => ({ url: e.url, excerpt: e.excerpt, publishedAt: e.publishedAt ?? null })),
      }))
      .filter((p) => p.evidence.length > 0);
    if (!proposals.length) return null;
    const directory = config.directory(t.country);
    const pages = await this.fetchPages(proposals, directory, fetcher);
    const r = validateMatchChannels(proposals, {
      directory,
      rights: t.rights,
      teams: teamsOf(info),
      eventStartsAt: info.startsAt,
      now: this.now(),
      pages,
      requirePageVerified: true,
    });
    report.targets.push({ eventId: t.event.id, country: t.country, source: 'import', report: r });
    if (!r.accepted.length) return null;
    if (!dryRun) {
      const applied = await applyMatchChannels(db, {
        eventId: t.event.id,
        country: t.country,
        accepted: r.accepted,
        // a fonte das opções salvas é a escala de antes do jogo
        phase: 'pre',
        window: 'import',
        researchId: null,
        now: this.now(),
      });
      report.applied.inserted += applied.inserted;
      report.applied.updated += applied.updated;
      report.applied.retracted += applied.retracted;
    }
    return r.accepted.some((a) => a.sourceKind === 'official') ? 'official' : 'press';
  }

  private async fetchPages(
    proposals: ChannelProposal[],
    directory: CountryDirectory,
    fetcher: CachingPageFetcher,
  ): Promise<Map<string, FetchedPage>> {
    const urls = [
      ...new Set(
        proposals.flatMap((p) => p.evidence.map((e) => e.url)).filter((u) => shouldFetch(directory, u)),
      ),
    ];
    const pages = new Map<string, FetchedPage>();
    for (const u of urls) {
      const r = await fetcher.fetch(u);
      pages.set(u, { ok: r.ok, text: r.text });
    }
    return pages;
  }
}

/** Nomes dos dois times (com o nome curto) para conferir o trecho e a página. */
export function teamsOf(info: EventInfo): [ReturnType<typeof teamNames>, ReturnType<typeof teamNames>] {
  const home = info.home ?? info.participants[0] ?? '';
  const away = info.away ?? info.participants[1] ?? '';
  return [teamNames(home, info.homeShort), teamNames(away, info.awayShort)];
}
