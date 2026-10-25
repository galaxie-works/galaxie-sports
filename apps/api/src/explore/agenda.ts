/**
 * Agenda dos próximos dias (`/v1/explore/agenda`): os jogos que o resumo da home conta, com a mesma consulta
 * (`selectWindowEvents`), a mesma janela (`exploreWindow`) e as mesmas regras (`isUpcoming`, `involves`). Sem
 * filtro, o total é a soma de `upcoming` dos esportes do resumo; com `country`, o `upcoming` do país. As contas
 * são funções puras, testadas à parte; a rota só carrega as linhas e monta os eventos da página.
 */
import { and, gte, lt } from 'drizzle-orm';
import type { ExploreAgenda } from '@galaxie/contracts';
import { event } from '@galaxie/db';
import { buildEvents, type BuildContext } from '../events/builder.js';
import { applyRelevance, inMarket } from '../events/relevance.js';
import { OFF_CATALOG_SPORTS } from '../off-catalog.js';
import { UUID_RE } from '../util.js';
import { exploreWindow, involves, isUpcoming, selectWindowEvents, type WindowEvent } from './summary.js';

export interface AgendaFilters {
  sport?: string | undefined;
  country?: string | undefined;
  /** Slug ou UUID. */
  competition?: string | undefined;
}

/** Destaques por relevância no mercado. */
export const AGENDA_HIGHLIGHTS = 6;
/** Competições nas contagens do filtro (as de mais jogos). */
export const AGENDA_COMPETITIONS = 60;

const offCatalog = new Set<string>(OFF_CATALOG_SPORTS);

/** Dia civil do instante no fuso (`2026-10-25`). */
export function dayKey(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Todos os dias civis que a janela toca no fuso, em ordem. */
export function windowDays(window: { from: Date; to: Date }, tz: string): string[] {
  const out: string[] = [];
  const last = dayKey(new Date(window.to.getTime() - 1), tz);
  for (let t = window.from.getTime(); ; t += 3_600_000) {
    const key = dayKey(new Date(t), tz);
    if (out.at(-1) !== key) out.push(key);
    if (key === last) break;
  }
  return out;
}

const bySport = (f: AgendaFilters) => (e: WindowEvent) => !f.sport || e.sport === f.sport;
const byCountry = (f: AgendaFilters) => (e: WindowEvent) => !f.country || involves(e, f.country);
const byCompetition = (f: AgendaFilters) => (e: WindowEvent) =>
  !f.competition ||
  (UUID_RE.test(f.competition) ? e.competition?.id === f.competition : e.competition?.slug === f.competition);

export interface AgendaCounts {
  /** Jogos da janela com os filtros, por horário. */
  matching: WindowEvent[];
  total: number;
  days: ExploreAgenda['days'];
  facets: ExploreAgenda['facets'];
}

/**
 * Contagens da agenda. Conta como o resumo: esporte do catálogo, `isUpcoming` na janela e, por país, `involves`.
 * Cada contagem de filtro aplica os outros dois filtros (escolher um esporte mostra os países daquele esporte).
 */
export function agendaCounts(
  events: WindowEvent[],
  window: { from: Date; to: Date },
  filters: AgendaFilters,
  tz: string,
  countries: readonly string[],
): AgendaCounts {
  const base = events
    .filter((e) => !offCatalog.has(e.sport) && isUpcoming(e, window.from, window.to))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id));
  const matching = base.filter(
    (e) => bySport(filters)(e) && byCountry(filters)(e) && byCompetition(filters)(e),
  );

  const perDay = new Map<string, number>();
  for (const e of matching) perDay.set(dayKey(e.startsAt, tz), (perDay.get(dayKey(e.startsAt, tz)) ?? 0) + 1);

  const forSports = base.filter((e) => byCountry(filters)(e) && byCompetition(filters)(e));
  const sportCount = new Map<string, number>();
  for (const e of forSports) sportCount.set(e.sport, (sportCount.get(e.sport) ?? 0) + 1);

  const forCountries = base.filter((e) => bySport(filters)(e) && byCompetition(filters)(e));
  const forCompetitions = base.filter((e) => bySport(filters)(e) && byCountry(filters)(e));
  const comps = new Map<string, ExploreAgenda['facets']['competitions'][number]>();
  for (const e of forCompetitions) {
    const c = e.competition;
    if (!c?.id) continue;
    const prev = comps.get(c.id);
    if (prev) prev.count += 1;
    else comps.set(c.id, { id: c.id, slug: c.slug, sport: c.sport, name: c.name ?? c.slug, count: 1 });
  }

  return {
    matching,
    total: matching.length,
    days: windowDays(window, tz).map((date) => ({ date, count: perDay.get(date) ?? 0 })),
    facets: {
      sports: [...sportCount].map(([slug, count]) => ({ slug, count })).sort((a, b) => b.count - a.count),
      countries: countries.map((code) => ({
        code,
        count: forCountries.filter((e) => involves(e, code)).length,
      })),
      competitions: [...comps.values()]
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, AGENDA_COMPETITIONS),
    },
  };
}

/** Candidatos aos destaques: os mais importantes da janela e, com mercado, os mais importantes do país. */
export const HIGHLIGHT_POOL = 30;

/**
 * O jogo é do mercado? Pela mesma regra do bônus do mercado (`inMarket`): GB cobre GB-ENG, GB-SCT… O filtro de
 * país (`involves`) segue com o código exato, como `/v1/events?country=`.
 */
const ofMarket = (e: WindowEvent, market: string) =>
  inMarket(e.competition?.countryCode, market) || e.participantCountries.some((c) => inMarket(c, market));

export function highlightCandidates(matching: WindowEvent[], market: string | null): WindowEvent[] {
  const byImportance = (list: WindowEvent[]) =>
    [...list]
      .sort((a, b) => b.importance - a.importance || a.startsAt.getTime() - b.startsAt.getTime())
      .slice(0, HIGHLIGHT_POOL);
  const pool = [
    ...byImportance(matching),
    ...(market ? byImportance(matching.filter((e) => ofMarket(e, market))) : []),
  ];
  return [...new Map(pool.map((e) => [e.id, e])).values()];
}

/** Monta a agenda: contagens, os jogos do dia (por horário, paginados) e os destaques no mercado. */
export async function loadExploreAgenda(
  bctx: BuildContext,
  options: {
    sports: string[] | null;
    filters: AgendaFilters;
    countries: readonly string[];
    market: string | null;
    day?: string | undefined;
    limit: number;
    offset: number;
  },
): Promise<ExploreAgenda> {
  const window = exploreWindow(bctx.now);
  const rows = await selectWindowEvents(
    bctx,
    and(gte(event.startsAt, window.from), lt(event.startsAt, window.to)),
    options.sports,
  );
  const counts = agendaCounts(rows, window, options.filters, bctx.tz, options.countries);
  const day =
    options.day && counts.days.some((d) => d.date === options.day)
      ? options.day
      : (counts.days.find((d) => d.count > 0)?.date ?? null);
  const ofDay = day ? counts.matching.filter((e) => dayKey(e.startsAt, bctx.tz) === day) : [];
  const page = ofDay.slice(options.offset, options.offset + options.limit);

  // destaques: a relevância exata (`applyRelevance`) dos candidatos — os mais importantes da janela e os que
  // envolvem o país do mercado (o bônus do mercado é o que mais pesa). Ordenar a janela toda em SQL
  // (`relevanceSql`) levava mais de um minuto.
  const candidates = highlightCandidates(counts.matching, options.market);
  const built = await buildEvents(bctx, [
    ...new Set([...page.map((e) => e.id), ...candidates.map((e) => e.id)]),
  ]);
  const dtos = built.map((b) => b.dto);
  await applyRelevance(bctx, dtos, options.market);
  const byId = new Map(dtos.map((d) => [d.id, d]));
  const pick = (id: string) => byId.get(id);

  return {
    generated_at: bctx.now.toISOString(),
    window: { from: window.from.toISOString(), to: window.to.toISOString() },
    total: counts.total,
    days: counts.days,
    day,
    facets: counts.facets,
    highlights: candidates
      .flatMap((e) => (pick(e.id) ? [pick(e.id)!] : []))
      .sort(
        (a, b) =>
          (b.relevance?.score ?? b.importance) - (a.relevance?.score ?? a.importance) ||
          a.starts_at.localeCompare(b.starts_at),
      )
      .slice(0, AGENDA_HIGHLIGHTS),
    data: page.flatMap((e) => (pick(e.id) ? [pick(e.id)!] : [])),
    next_cursor:
      options.offset + options.limit < ofDay.length ? String(options.offset + options.limit) : null,
  };
}
