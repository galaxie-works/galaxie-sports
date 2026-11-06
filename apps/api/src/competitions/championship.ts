/**
 * Consultas dos widgets do campeonato (épico #820): artilharia e líderes (#828) e galeria de campeões (#831).
 * Só leitura; a rota (`routes/v1/championship.ts`) cuida de cache, nomes de exibição e formato do contrato.
 */
import { sql } from 'drizzle-orm';
import type { Database } from '@galaxie/db';
import type { LeaderCategory } from '@galaxie/contracts';
import { logoIdSql } from '../assets/custom-logos.js';

// ─── líderes ─────────────────────────────────────────────────────────────────────────────────────

export interface LeaderDbRow {
  person_id: string;
  person_name: string;
  nationality: string | null;
  photo_key: string | null;
  photo_url: string | null;
  team_id: string | null;
  team_name: string | null;
  team_short: string | null;
  logo_key: string | null;
  logo_url: string | null;
  teams: number;
  appearances: number;
  minutes: number;
  goals: number;
  assists: number;
  yellow_cards: number;
  red_cards: number;
  updated_at: Date | string | null;
}

/** Número que ordena cada categoria (os vermelhos desempatam os cartões). */
export function leaderValue(
  row: Pick<LeaderDbRow, 'goals' | 'assists' | 'yellow_cards' | 'red_cards'>,
  category: LeaderCategory,
): number {
  switch (category) {
    case 'goals':
      return row.goals;
    case 'assists':
      return row.assists;
    case 'cards':
      return row.yellow_cards + row.red_cards;
  }
}

/**
 * Ordem e posição: maior número primeiro; nos cartões, mais vermelhos; depois menos minutos (fez em menos
 * tempo) e o nome em ordem alfabética pt-BR. Empatados no número da categoria (e nos vermelhos) dividem a
 * posição (1, 2, 2, 4). Quem tem zero na categoria fica de fora.
 */
export function rankLeaders<
  T extends Pick<LeaderDbRow, 'goals' | 'assists' | 'yellow_cards' | 'red_cards' | 'minutes' | 'person_name'>,
>(rows: readonly T[], category: LeaderCategory, limit: number): (T & { rank: number })[] {
  const tie = (r: T) => (category === 'cards' ? r.red_cards : 0);
  const sorted = rows
    .filter((r) => leaderValue(r, category) > 0)
    .sort(
      (a, b) =>
        leaderValue(b, category) - leaderValue(a, category) ||
        tie(b) - tie(a) ||
        a.minutes - b.minutes ||
        a.person_name.localeCompare(b.person_name, 'pt-BR'),
    );
  const out: (T & { rank: number })[] = [];
  sorted.forEach((r, i) => {
    const prev = sorted[i - 1];
    const same = prev && leaderValue(prev, category) === leaderValue(r, category) && tie(prev) === tie(r);
    out.push({ ...r, rank: same ? out[i - 1]!.rank : i + 1 });
  });
  return out.slice(0, limit);
}

/**
 * Estatísticas somadas por jogador na temporada (`core.person_season_stat`): quem trocou de time dentro da
 * competição conta uma vez, com o time em que mais jogou. Volta só os candidatos da categoria (número > 0),
 * os mais altos primeiro, com folga para o desempate em `rankLeaders`.
 */
export async function loadLeaderRows(
  db: Database,
  q: { seasonId: string; category: LeaderCategory; limit: number; customLogos: boolean },
): Promise<LeaderDbRow[]> {
  const order =
    q.category === 'goals'
      ? sql`a.goals desc`
      : q.category === 'assists'
        ? sql`a.assists desc`
        : sql`(a.yellow_cards + a.red_cards) desc, a.red_cards desc`;
  const value =
    q.category === 'goals'
      ? sql`a.goals`
      : q.category === 'assists'
        ? sql`a.assists`
        : sql`(a.yellow_cards + a.red_cards)`;
  // folga: empatados com o último da lista entram para o desempate e a posição saírem certos
  const rows = await db.execute<LeaderDbRow & Record<string, unknown>>(sql`
    with agg as (
      select p.person_id,
             sum(coalesce(p.goals, 0))::int as goals,
             sum(coalesce(p.assists, 0))::int as assists,
             sum(coalesce(p.yellow_cards, 0))::int as yellow_cards,
             sum(coalesce(p.red_cards, 0))::int as red_cards,
             sum(coalesce(p.appearances, 0))::int as appearances,
             sum(coalesce(p.minutes, 0))::int as minutes,
             (array_agg(p.participant_id order by coalesce(p.appearances, 0) desc, coalesce(p.minutes, 0) desc,
                        p.updated_at desc))[1] as team_id,
             count(distinct p.participant_id)::int as teams,
             max(p.updated_at) as updated_at
        from core.person_season_stat p
       where p.season_id = ${q.seasonId}::uuid
       group by p.person_id),
    top as (
      select a.* from agg a
       where ${value} > 0
         and ${value} >= coalesce((select ${value} from agg a where ${value} > 0 order by ${order}
                                    offset ${q.limit - 1} limit 1), 0)
    )
    select a.person_id::text, pe.name as person_name, pe.nationality,
           ph.storage_key as photo_key, ph.source_url as photo_url,
           pa.id::text as team_id, pa.name as team_name, pa.short_name as team_short,
           lg.storage_key as logo_key, lg.source_url as logo_url,
           a.teams, a.appearances, a.minutes, a.goals, a.assists, a.yellow_cards, a.red_cards, a.updated_at
      from top a
      join core.person pe on pe.id = a.person_id
      left join core.asset ph on ph.id = pe.photo_asset_id
      left join core.participant pa on pa.id = a.team_id
      left join core.asset lg on lg.id = ${logoIdSql('pa', q.customLogos)}
     order by ${order}, a.minutes, pe.name`);
  return [...rows];
}

/** Última atualização das estatísticas da temporada (todas as linhas, não só as listadas). */
export async function leadersUpdatedAt(db: Database, seasonId: string): Promise<Date | null> {
  const [row] = await db.execute<{ at: Date | string | null }>(sql`
    select max(updated_at) as at from core.person_season_stat where season_id = ${seasonId}::uuid`);
  return row?.at ? new Date(row.at) : null;
}

// ─── campeões ────────────────────────────────────────────────────────────────────────────────────

export interface ChampionDbRow {
  season_year: number;
  season_label: string;
  decided_on: string;
  champion_id: string | null;
  champion_name: string | null;
  champion_short: string | null;
  champion_logo_key: string | null;
  champion_logo_url: string | null;
  runner_id: string | null;
  runner_name: string | null;
  runner_short: string | null;
  runner_logo_key: string | null;
  runner_logo_url: string | null;
}

/**
 * Edições da competição (`core.competition_title`), da mais recente para trás, com o vice quando a temporada
 * está na base: nas copas, o outro time da final; nas ligas, o 2º da tabela em que o campeão foi o 1º. Uma
 * edição com mais de uma linha (o fornecedor listou dois vencedores) sai uma vez, pelo vencedor ligado.
 */
export async function loadChampionRows(
  db: Database,
  q: { competitionId: string; competitionType: string; customLogos: boolean },
): Promise<ChampionDbRow[]> {
  const league = q.competitionType === 'league';
  const rows = await db.execute<ChampionDbRow & Record<string, unknown>>(sql`
    with ed as (
      select distinct on (t.edition_qid) t.season_year, t.season_label, t.decided_on::text as decided_on,
             t.participant_id
        from core.competition_title t
       where t.competition_id = ${q.competitionId}::uuid
       order by t.edition_qid, (t.participant_id is null), t.decided_on
    ),
    runner as (
      select ed.season_year,
             ${
               league
                 ? sql`(select b.participant_id
                          from core.season s
                          join core.standing a on a.season_id = s.id and a.participant_id = ed.participant_id
                                              and a.rank = 1
                          join core.standing b on b.season_id = s.id and b.group = a.group and b.rank = 2
                         where s.competition_id = ${q.competitionId}::uuid and s.year = ed.season_year
                         order by a.played desc
                         limit 1)`
                 : sql`(select ep.participant_id
                          from core.season s
                          join core.event e on e.season_id = s.id
                          join core.stage st on st.id = e.stage_id and st.kind = 'final'
                          join core.event_participant ep on ep.event_id = e.id
                         where s.competition_id = ${q.competitionId}::uuid and s.year = ed.season_year
                           and ep.participant_id <> ed.participant_id
                           and exists (select 1 from core.event_participant x
                                        where x.event_id = e.id and x.participant_id = ed.participant_id)
                         order by e.starts_at desc
                         limit 1)`
             } as participant_id
        from ed
       where ed.participant_id is not null
    )
    select ed.season_year, ed.season_label, ed.decided_on,
           c.id::text as champion_id, c.name as champion_name, c.short_name as champion_short,
           cl.storage_key as champion_logo_key, cl.source_url as champion_logo_url,
           r.id::text as runner_id, r.name as runner_name, r.short_name as runner_short,
           rl.storage_key as runner_logo_key, rl.source_url as runner_logo_url
      from ed
      left join core.participant c on c.id = ed.participant_id
      left join core.asset cl on cl.id = ${logoIdSql('c', q.customLogos)}
      left join runner on runner.season_year = ed.season_year
      left join core.participant r on r.id = runner.participant_id
      left join core.asset rl on rl.id = ${logoIdSql('r', q.customLogos)}
     order by ed.season_year desc, ed.decided_on desc`);
  return [...rows];
}

export interface TitleCoverageRow {
  first_year: number | null;
  latest_year: number | null;
  complete_through: number | null;
}

export async function loadTitleCoverage(
  db: Database,
  competitionId: string,
): Promise<TitleCoverageRow | null> {
  const [row] = await db.execute<TitleCoverageRow & Record<string, unknown>>(sql`
    select first_year, latest_year, complete_through
      from core.competition_title_coverage where competition_id = ${competitionId}::uuid`);
  return row ?? null;
}

export interface TitleTally {
  teamId: string;
  titles: number;
  /** Rótulo da edição mais recente vencida. */
  last: string;
  lastYear: number;
}

/**
 * Títulos por time, do maior para o menor (empate: o título mais recente primeiro, depois o nome pt-BR). Só
 * quando a lista está completa até a edição mais recente (`complete_through >= latest_year`); senão, null: a
 * contagem de uma lista com ano faltando seria um palpite (mesma regra de `@galaxie/db` `loadTitleRecords`).
 */
export function titleRanking(
  rows: readonly Pick<ChampionDbRow, 'season_year' | 'season_label' | 'champion_id' | 'champion_name'>[],
  coverage: TitleCoverageRow | null,
): TitleTally[] | null {
  if (!coverage || coverage.complete_through === null || coverage.latest_year === null) return null;
  if (coverage.complete_through < coverage.latest_year) return null;
  const by = new Map<string, TitleTally & { name: string }>();
  for (const r of rows) {
    if (!r.champion_id) continue;
    const t = by.get(r.champion_id) ?? {
      teamId: r.champion_id,
      titles: 0,
      last: r.season_label,
      lastYear: r.season_year,
      name: r.champion_name ?? '',
    };
    t.titles += 1;
    if (r.season_year > t.lastYear) {
      t.lastYear = r.season_year;
      t.last = r.season_label;
    }
    by.set(r.champion_id, t);
  }
  return [...by.values()]
    .sort((a, b) => b.titles - a.titles || b.lastYear - a.lastYear || a.name.localeCompare(b.name, 'pt-BR'))
    .map(({ name: _name, ...t }) => t);
}
