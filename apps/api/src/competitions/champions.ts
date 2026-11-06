import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  competitionTitle,
  competitionTitleCoverage,
  event,
  eventParticipant,
  season,
  stage,
  standing,
  type Database,
} from '@galaxie/db';

/**
 * Galeria de campeões de uma competição (`/v1/competitions/{id}/champions`, issue #831), a partir de
 * `core.competition_title` (importado do Wikidata e conferido, ver packages/db/src/titles.ts).
 *
 * Estrita como a contagem de títulos do "o que está em jogo": o ranking de quem tem mais títulos só sai
 * quando a lista de campeões está completa (sem ano faltando) até a última edição, e o vice só sai quando
 * o nosso banco tem a temporada e o campeão bate com ela.
 */

export interface TitleRow {
  seasonYear: number;
  seasonLabel: string;
  decidedOn: string;
  editionQid: string;
  participantId: string | null;
}

export interface TitleCoverage {
  firstYear: number | null;
  completeThrough: number | null;
}

export interface ChampionEditionRow {
  seasonYear: number;
  seasonLabel: string;
  decidedOn: string;
  championId: string | null;
  runnerUpId: string | null;
}

export interface ChampionRankingEntry {
  rank: number;
  participantId: string;
  titles: number;
  /** Edições vencidas, da mais recente para trás. */
  seasons: string[];
}

/** Edições únicas (uma por edição do Wikidata), da mais recente para trás. */
export function editionsOf(rows: readonly TitleRow[]): TitleRow[] {
  const seen = new Set<string>();
  const out: TitleRow[] = [];
  const sorted = [...rows].sort(
    (a, b) =>
      b.decidedOn.localeCompare(a.decidedOn) ||
      b.seasonYear - a.seasonYear ||
      a.editionQid.localeCompare(b.editionQid),
  );
  for (const r of sorted) {
    if (seen.has(r.editionQid)) continue;
    seen.add(r.editionQid);
    out.push(r);
  }
  return out;
}

/**
 * A contagem de títulos é confiável? A cobertura gravada pelo importador precisa ir sem lacuna até a
 * temporada da última edição conhecida, e todo vencedor precisa estar ligado a um time do catálogo (um
 * vencedor sem time some da contagem e mudaria totais e posições).
 */
export function rankingComplete(editions: readonly TitleRow[], coverage: TitleCoverage | null): boolean {
  if (!editions.length || coverage?.completeThrough == null) return false;
  if (editions.some((e) => !e.participantId)) return false;
  const latest = Math.max(...editions.map((e) => e.seasonYear));
  return coverage.completeThrough >= latest;
}

/**
 * Quem tem mais títulos: mais títulos, depois o título mais recente, depois o nome (`nameOf`, ordem
 * alfabética pt-BR). Empatados em títulos e no título mais recente dividem a posição.
 */
export function rankChampions(
  editions: readonly TitleRow[],
  nameOf: (id: string) => string,
): ChampionRankingEntry[] {
  const by = new Map<string, { titles: number; seasons: string[]; last: string }>();
  for (const e of editions) {
    if (!e.participantId) continue;
    const cur = by.get(e.participantId) ?? { titles: 0, seasons: [], last: '' };
    cur.titles += 1;
    cur.seasons.push(e.seasonLabel);
    if (e.decidedOn > cur.last) cur.last = e.decidedOn;
    by.set(e.participantId, cur);
  }
  const collator = new Intl.Collator('pt-BR', { sensitivity: 'base' });
  const sorted = [...by].sort(
    ([ia, a], [ib, b]) =>
      b.titles - a.titles || b.last.localeCompare(a.last) || collator.compare(nameOf(ia), nameOf(ib)),
  );
  const out: ChampionRankingEntry[] = [];
  sorted.forEach(([id, r], i) => {
    const prev = out[i - 1];
    const prevRow = i > 0 ? by.get(sorted[i - 1]![0])! : null;
    const tied = prevRow && prevRow.titles === r.titles && prevRow.last === r.last;
    out.push({
      rank: tied && prev ? prev.rank : i + 1,
      participantId: id,
      titles: r.titles,
      seasons: r.seasons,
    });
  });
  return out;
}

/** Os dois finalistas de uma temporada (todos os jogos da fase `final`, ida e volta inclusive). */
export interface FinalOf {
  participants: readonly string[];
}

/** 1º e 2º de uma temporada com tabela única (pontos corridos). */
export interface LeagueTopOf {
  groups: number;
  first: string | null;
  second: string | null;
}

/**
 * Vice da edição: o outro finalista quando a final teve exatamente dois times e o campeão é um deles; sem
 * final, o 2º da tabela única quando o 1º é o campeão. Fora disso, null (não dá para afirmar).
 */
export function runnerUpOf(
  championId: string | null,
  final: FinalOf | undefined,
  league: LeagueTopOf | undefined,
): string | null {
  if (!championId) return null;
  if (final && final.participants.length) {
    const teams = [...new Set(final.participants)];
    return teams.length === 2 && teams.includes(championId) ? teams.find((t) => t !== championId)! : null;
  }
  if (league && league.groups === 1 && league.first === championId) return league.second;
  return null;
}

/** Títulos e cobertura da competição. */
export async function loadTitles(
  db: Database,
  competitionId: string,
): Promise<{ rows: TitleRow[]; coverage: TitleCoverage | null }> {
  const rows = await db
    .select({
      seasonYear: competitionTitle.seasonYear,
      seasonLabel: competitionTitle.seasonLabel,
      decidedOn: competitionTitle.decidedOn,
      editionQid: competitionTitle.editionQid,
      participantId: competitionTitle.participantId,
    })
    .from(competitionTitle)
    .where(eq(competitionTitle.competitionId, competitionId));
  const [cov] = await db
    .select({
      firstYear: competitionTitleCoverage.firstYear,
      completeThrough: competitionTitleCoverage.completeThrough,
    })
    .from(competitionTitleCoverage)
    .where(eq(competitionTitleCoverage.competitionId, competitionId));
  return { rows, coverage: cov ?? null };
}

/** Vice de cada edição pedida, pelas temporadas do nosso banco (ano da temporada → id do vice ou null). */
export async function loadRunnerUps(
  db: Database,
  competitionId: string,
  editions: readonly TitleRow[],
): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>();
  const years = [...new Set(editions.map((e) => e.seasonYear))];
  if (!years.length) return out;
  const seasons = await db
    .select({ id: season.id, year: season.year })
    .from(season)
    .where(and(eq(season.competitionId, competitionId), inArray(season.year, years)));
  if (!seasons.length) return out;
  const seasonIds = seasons.map((s) => s.id);
  const finals = await db
    .select({ seasonId: event.seasonId, participantId: eventParticipant.participantId })
    .from(event)
    .innerJoin(stage, eq(stage.id, event.stageId))
    .innerJoin(eventParticipant, eq(eventParticipant.eventId, event.id))
    .where(and(inArray(event.seasonId, seasonIds), eq(stage.kind, 'final'), eq(event.status, 'finished')));
  const finalBy = new Map<string, string[]>();
  for (const f of finals) {
    if (!f.seasonId) continue;
    finalBy.set(f.seasonId, [...(finalBy.get(f.seasonId) ?? []), f.participantId]);
  }
  const noFinal = seasonIds.filter((id) => !finalBy.has(id));
  const table = noFinal.length
    ? await db
        .select({
          seasonId: standing.seasonId,
          group: standing.group,
          rank: standing.rank,
          participantId: standing.participantId,
        })
        .from(standing)
        .where(inArray(standing.seasonId, noFinal))
        .orderBy(asc(standing.rank))
    : [];
  const leagueBy = new Map<string, LeagueTopOf>();
  const groupsBy = new Map<string, Set<string>>();
  for (const r of table) {
    groupsBy.set(r.seasonId, (groupsBy.get(r.seasonId) ?? new Set()).add(r.group));
    const cur = leagueBy.get(r.seasonId) ?? { groups: 0, first: null, second: null };
    if (r.rank === 1 && !cur.first) cur.first = r.participantId;
    else if (r.rank === 2 && !cur.second) cur.second = r.participantId;
    leagueBy.set(r.seasonId, cur);
  }
  for (const [id, g] of groupsBy) leagueBy.get(id)!.groups = g.size;
  const seasonByYear = new Map(seasons.map((s) => [s.year, s.id]));
  for (const e of editions) {
    const sid = seasonByYear.get(e.seasonYear);
    if (!sid) continue;
    const final = finalBy.get(sid);
    out.set(
      e.seasonYear,
      runnerUpOf(e.participantId, final ? { participants: final } : undefined, leagueBy.get(sid)),
    );
  }
  return out;
}
