/**
 * O resumo da home "Explorar" sem idioma, sem tenant e sem imagens: o que é escolha e conta (contadores por esporte e
 * por país, competições e clubes em destaque, liga principal, o jogo de maior relevância e os anunciados de cada
 * país). É a parte pesada (um ano de jogos para os clubes em destaque e as competições com jogos recentes), feita
 * pelo job `explore-summary` do ingestor e gravada em `core.explore_summary`; a API só junta nomes, logos e os
 * eventos dos destaques (por id). Sem o pré-calculado, a API faz a mesma conta na hora (`computeExploreSnapshot`).
 *
 * O recorte de esportes do plano do tenant entra depois, em `selectForScope`: os jogos de cada país ficam separados
 * por esporte, e somar os esportes do plano dá o mesmo que contar só os jogos deles.
 */
import { and, count, eq, gte, inArray, lt, lte, or, sql } from 'drizzle-orm';
import { competition, event, participant, sport, type Database } from '@galaxie/db';
import type { GeoConfig } from '@galaxie/geo';
import {
  ANNOUNCED_DAYS,
  announcedCandidates,
  compareHighlight,
  countryActivity,
  isUpcoming,
  MAIN_SPORT,
  pickAnnounced,
  pickMainCompetition,
  rankTopCompetitions,
  TOP_TEAMS,
  type CountryCandidate,
  type HighlightCandidate,
} from './choices.js';
import { IN_PLAY } from './live.js';
import { continentalSlugs } from './market.js';
import { DAY_MS, exploreWindow, selectWindowEvents } from './window.js';

/** Versão do formato gravado: muda quando o formato muda, e a API ignora (e recalcula) o que for de outra versão. */
export const EXPLORE_SNAPSHOT_VERSION = 1;

/** Números de um esporte. `upcoming` e `live` contam só os jogos do esporte; o resto é do catálogo. */
export interface SportEntry {
  competitions: number;
  participants: number;
  upcoming: number;
  live: number;
  /** Ids das competições em destaque, na ordem. */
  topCompetitions: string[];
}

/** O que do país não depende do plano: catálogo, liga principal e clubes em destaque (ids, na ordem). */
export interface CountryEntry {
  competitions: number;
  mainCompetition: string | null;
  topTeams: string[];
}

/** Os jogos do país num esporte. */
export interface CountrySportEntry {
  upcoming: number;
  live: number;
  highlight: HighlightCandidate | null;
  /** Os anunciados mais cedo (um a mais que o card mostra; ver `announcedCandidates`). */
  announced: CountryCandidate[];
}

export interface ExploreSnapshot {
  version: number;
  generatedAt: Date;
  window: { from: Date; to: Date };
  /** Por slug do esporte: os da tabela de esportes e os da navegação (config/geo). */
  sports: Record<string, SportEntry>;
  /** Por código dos países da navegação (config/geo). */
  countries: Record<string, CountryEntry>;
  /** País → esporte → jogos; só os pares com algum jogo. */
  countrySports: Record<string, Record<string, CountrySportEntry>>;
}

const EMPTY_COUNTRY: CountryEntry = { competitions: 0, mainCompetition: null, topTeams: [] };
const EMPTY_SPORT: SportEntry = {
  competitions: 0,
  participants: 0,
  upcoming: 0,
  live: 0,
  topCompetitions: [],
};

/**
 * Calcula o resumo inteiro em `now` (sem recorte de plano). Poucas consultas em lote, nenhuma por esporte ou por país;
 * as escolhas são as funções puras de `choices.ts`.
 */
export async function computeExploreSnapshot(
  db: Database,
  geo: GeoConfig,
  now: Date,
): Promise<ExploreSnapshot> {
  const window = exploreWindow(now);
  const recentFrom = new Date(now.getTime() - 365 * DAY_MS);
  const recentTo = new Date(now.getTime() + 30 * DAY_MS);
  const codes = geo.navigationCountries;
  const eventRows = (where: Parameters<typeof selectWindowEvents>[2]) =>
    selectWindowEvents(db, now, where, null);

  const [sportRows, participantCounts, catalogRows, recentRows, windowRows, teamRows, provisionalRows] =
    await Promise.all([
      db.select({ slug: sport.slug }).from(sport),
      db.select({ sport: participant.sport, n: count() }).from(participant).groupBy(participant.sport),
      db
        .select({
          id: competition.id,
          sport: competition.sport,
          slug: competition.slug,
          type: competition.type,
          tier: competition.tier,
          prestige: competition.prestige,
          countryCode: competition.countryCode,
        })
        .from(competition)
        .where(lte(competition.tier, 2)),
      db
        .select({ id: event.competitionId, n: count() })
        .from(event)
        .where(and(gte(event.startsAt, recentFrom), lt(event.startsAt, recentTo)))
        .groupBy(event.competitionId),
      // jogos da janela e os em andamento
      eventRows(
        or(
          and(gte(event.startsAt, window.from), lt(event.startsAt, window.to)),
          inArray(event.status, IN_PLAY),
        ),
      ),
      topTeams(db, codes, now, recentFrom),
      // anunciados: provisórios dos próximos meses (o fornecedor ainda não publicou)
      eventRows(
        and(
          eq(event.isProvisional, true),
          gte(event.startsAt, now),
          lt(event.startsAt, new Date(now.getTime() + ANNOUNCED_DAYS * DAY_MS)),
        ),
      ),
    ]);

  // ── catálogo: destaques por esporte, liga principal e contagem por país
  const recent = new Map(recentRows.map((r) => [r.id, Number(r.n)]));
  const catalog = catalogRows.map((r) => ({ ...r, recent: recent.get(r.id) ?? 0 }));
  const participantsBy = new Map(participantCounts.map((r) => [r.sport, Number(r.n)]));
  const bySport = <T extends { sport: string }>(list: T[]) => {
    const out = new Map<string, T[]>();
    for (const item of list) out.set(item.sport, [...(out.get(item.sport) ?? []), item]);
    return out;
  };
  const windowBySport = bySport(windowRows);
  const provisionalBySport = bySport(provisionalRows);

  const sports: Record<string, SportEntry> = {};
  const slugs = new Set([...sportRows.map((s) => s.slug), ...geo.navigationSports.map((s) => s.slug)]);
  for (const slug of slugs) {
    const own = catalog.filter((c) => c.sport === slug);
    const evs = windowBySport.get(slug) ?? [];
    sports[slug] = {
      competitions: own.length,
      participants: participantsBy.get(slug) ?? 0,
      upcoming: evs.filter((e) => isUpcoming(e, window.from, window.to)).length,
      live: evs.filter((e) => e.live).length,
      topCompetitions: rankTopCompetitions(own).map((c) => c.id),
    };
  }

  // ── países: catálogo e, por esporte, os jogos, o destaque e os anunciados
  const countries: Record<string, CountryEntry> = {};
  const countrySports: ExploreSnapshot['countrySports'] = {};
  const eventSports = new Set([...windowBySport.keys(), ...provisionalBySport.keys()]);
  for (const code of codes) {
    const main = pickMainCompetition(
      catalog.filter((c) => c.sport === MAIN_SPORT && c.countryCode === code),
      (s, slug) => geo.featuredOrder(s, slug),
    );
    const teams = teamRows.filter((t) => t.country_code === code).map((t) => t.id);
    countries[code] = {
      competitions: catalog.filter((c) => c.countryCode === code).length,
      mainCompetition: main?.id ?? null,
      topTeams: teams,
    };
    const continental = new Set(continentalSlugs(geo, code).map((c) => `${c.sport}|${c.slug}`));
    const prefer = { teams: new Set(teams), main: main ? { sport: main.sport, slug: main.slug } : null };
    const perSport: Record<string, CountrySportEntry> = {};
    for (const s of eventSports) {
      const activity = countryActivity(
        windowBySport.get(s) ?? [],
        code,
        window,
        continental,
        prefer,
        geo.audience,
      );
      const announced = announcedCandidates(
        provisionalBySport.get(s) ?? [],
        code,
        now,
        continental,
        geo.audience,
      );
      if (activity.upcoming || activity.live || activity.highlight || announced.length)
        perSport[s] = { ...activity, announced };
    }
    if (Object.keys(perSport).length) countrySports[code] = perSport;
  }

  return { version: EXPLORE_SNAPSHOT_VERSION, generatedAt: now, window, sports, countries, countrySports };
}

/** O país com o recorte do plano aplicado: números somados nos esportes do plano, destaque e anunciados escolhidos. */
export interface CountrySelection extends CountryEntry {
  upcoming: number;
  live: number;
  highlight: HighlightCandidate | null;
  announced: CountryCandidate[];
}

export interface ExploreSelection {
  generatedAt: Date;
  window: { from: Date; to: Date };
  sports: Map<string, SportEntry>;
  countries: Map<string, CountrySelection>;
}

/**
 * Aplica o recorte de esportes do plano (null = todos), como a consulta da janela fazia: fora do plano, nenhum jogo
 * conta nem vira destaque; o catálogo (competições, participantes, clubes) é o mesmo para todos.
 */
export function selectForScope(
  snapshot: ExploreSnapshot,
  codes: readonly string[],
  scope: readonly string[] | null,
): ExploreSelection {
  const inScope = (s: string) => !scope || scope.includes(s);
  const sports = new Map(
    Object.entries(snapshot.sports).map(([slug, entry]) => [
      slug,
      inScope(slug) ? entry : { ...entry, upcoming: 0, live: 0 },
    ]),
  );
  const countries = new Map<string, CountrySelection>();
  for (const code of codes) {
    const entries = Object.entries(snapshot.countrySports[code] ?? {})
      .filter(([s]) => inScope(s))
      .map(([, entry]) => entry);
    let highlight: HighlightCandidate | null = null;
    for (const e of entries)
      if (e.highlight && (!highlight || compareHighlight(e.highlight, highlight) < 0))
        highlight = e.highlight;
    countries.set(code, {
      ...(snapshot.countries[code] ?? EMPTY_COUNTRY),
      upcoming: entries.reduce((n, e) => n + e.upcoming, 0),
      live: entries.reduce((n, e) => n + e.live, 0),
      highlight,
      announced: pickAnnounced(
        entries.flatMap((e) => e.announced),
        highlight?.id ?? null,
      ),
    });
  }
  return { generatedAt: snapshot.generatedAt, window: snapshot.window, sports, countries };
}

/** Os números do esporte no recorte (zerados quando o esporte não está no resumo). */
export function sportOf(selection: ExploreSelection, slug: string): SportEntry {
  return selection.sports.get(slug) ?? EMPTY_SPORT;
}

/**
 * Clubes em destaque de cada país (no esporte da liga principal), numa consulta: os da base semântica primeiro (os
 * grandes, curados), depois a soma da importância dos jogos dos últimos 12 meses. É a consulta mais pesada do resumo
 * (um ano de jogos): o motivo de o resumo ser pré-calculado.
 */
async function topTeams(
  db: Database,
  codes: readonly string[],
  now: Date,
  from: Date,
): Promise<{ id: string; country_code: string }[]> {
  if (!codes.length) return [];
  const rows = await db.execute<{ id: string; country_code: string }>(sql`
    select r.id::text as id, r.country_code
      from (select p.id, p.country_code,
                   row_number() over (
                     partition by p.country_code
                     order by exists (select 1 from semantic.team_profile tp where tp.participant_id = p.id) desc,
                              sum(e.importance) desc, p.name) as rn
              from core.event e
              join core.event_participant ep on ep.event_id = e.id
              join core.participant p on p.id = ep.participant_id
             where e.starts_at >= ${from.toISOString()}::timestamptz
               and e.starts_at < ${now.toISOString()}::timestamptz
               and p.kind = 'club'
               and p.sport = ${MAIN_SPORT}
               and p.country_code in (${sql.join(
                 codes.map((c) => sql`${c}`),
                 sql`, `,
               )})
             group by p.id) r
     where r.rn <= ${TOP_TEAMS}
     order by r.country_code, r.rn`);
  return [...rows];
}
