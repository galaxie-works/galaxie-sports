/**
 * Classificação da NBA calculada a partir dos jogos do core. O `/standings` da NBA v2 vem como foto
 * defasada (vitórias e derrotas de alguns jogos antes do fim) e com `conference.rank` que não bate com a
 * campanha. Os jogos encerrados da temporada regular são a fonte confiável: a tabela é recalculada com eles
 * e gravada com `source = 'computed'`, nas conferências que o fornecedor deu (mesmos grupos em core.standing).
 *
 * Ordem: aproveitamento; empate desfeito pelo confronto direto entre os empatados e depois pelo saldo de
 * pontos (simplificação dos critérios oficiais, que também olham líder de divisão e campanha na conferência).
 * A final da NBA Cup tem fase própria no normalizador e não entra, como na tabela oficial.
 */
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { competition, publishChange, season, stage, standing, type Database } from '@galaxie/db';
import type { MatchResult, StandingRow, StandingsTable } from '@galaxie/rules';
import { loadSeasonResults, writeComputedStandings } from '@galaxie/rules/db';

interface TeamLine {
  teamId: string;
  played: number;
  won: number;
  lost: number;
  pointsFor: number;
  pointsAgainst: number;
  awayWon: number;
  form: ('W' | 'L')[];
}

const pct = (won: number, played: number) => (played ? won / played : 0);

/** Zonas da tabela: 1º–6º direto nos playoffs, 7º–10º no play-in (texto no padrão do api-basketball). */
export function nbaZone(rank: number): string | null {
  if (rank <= 6) return 'Promotion - NBA (Playoffs)';
  if (rank <= 10) return 'NBA Play-in';
  return null;
}

/** Tabela por conferência; `groupOf` diz a conferência de cada time (jogo entre conferências conta para os dois). */
export function rankNbaStandings(
  matches: readonly MatchResult[],
  groupOf: ReadonlyMap<string, string>,
): StandingsTable[] {
  const records = new Map<string, TeamLine>();
  const rec = (teamId: string) => {
    let r = records.get(teamId);
    if (!r) {
      r = { teamId, played: 0, won: 0, lost: 0, pointsFor: 0, pointsAgainst: 0, awayWon: 0, form: [] };
      records.set(teamId, r);
    }
    return r;
  };
  for (const id of groupOf.keys()) rec(id);
  const sorted = [...matches].sort((a, b) => (a.playedAt ?? '').localeCompare(b.playedAt ?? ''));
  for (const m of sorted) {
    if (m.homeGoals === m.awayGoals) continue;
    for (const [teamId, pf, pa, away] of [
      [m.homeId, m.homeGoals, m.awayGoals, false],
      [m.awayId, m.awayGoals, m.homeGoals, true],
    ] as const) {
      if (!groupOf.has(teamId)) continue;
      const r = rec(teamId);
      const won = pf > pa;
      r.played += 1;
      r.pointsFor += pf;
      r.pointsAgainst += pa;
      if (won) {
        r.won += 1;
        if (away) r.awayWon += 1;
      } else r.lost += 1;
      r.form.push(won ? 'W' : 'L');
    }
  }

  // aproveitamento no confronto direto entre os times de `tied`
  const h2h = (tied: ReadonlySet<string>) => {
    const out = new Map<string, { won: number; played: number }>();
    for (const id of tied) out.set(id, { won: 0, played: 0 });
    for (const m of matches) {
      if (m.homeGoals === m.awayGoals || !tied.has(m.homeId) || !tied.has(m.awayId)) continue;
      const winner = m.homeGoals > m.awayGoals ? m.homeId : m.awayId;
      for (const id of [m.homeId, m.awayId]) {
        const s = out.get(id)!;
        s.played += 1;
        if (id === winner) s.won += 1;
      }
    }
    return out;
  };

  const groups = new Map<string, TeamLine[]>();
  for (const r of records.values()) {
    const g = groupOf.get(r.teamId);
    if (g === undefined) continue;
    groups.set(g, [...(groups.get(g) ?? []), r]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, teams]) => {
      const byPct = [...teams].sort((a, b) => pct(b.won, b.played) - pct(a.won, a.played));
      const ordered: { r: TeamLine; decidedBy: string | null; tiedWith: string[] }[] = [];
      for (let i = 0; i < byPct.length;) {
        let j = i + 1;
        while (
          j < byPct.length &&
          pct(byPct[j]!.won, byPct[j]!.played) === pct(byPct[i]!.won, byPct[i]!.played)
        )
          j++;
        const block = byPct.slice(i, j);
        if (block.length === 1)
          ordered.push({ r: block[0]!, decidedBy: i ? 'win_percentage' : null, tiedWith: [] });
        else {
          const direct = h2h(new Set(block.map((r) => r.teamId)));
          const h = (r: TeamLine) => pct(direct.get(r.teamId)!.won, direct.get(r.teamId)!.played);
          const diff = (r: TeamLine) => r.pointsFor - r.pointsAgainst;
          block.sort((a, b) => h(b) - h(a) || diff(b) - diff(a) || a.teamId.localeCompare(b.teamId));
          block.forEach((r, k) => {
            const prev = block[k - 1];
            const decidedBy = !prev
              ? i
                ? 'win_percentage'
                : null
              : h(prev) !== h(r)
                ? 'h2h_win_percentage'
                : diff(prev) !== diff(r)
                  ? 'point_difference'
                  : 'team_id';
            const tiedWith = block
              .filter((o) => o !== r && h(o) === h(r) && diff(o) === diff(r))
              .map((o) => o.teamId);
            ordered.push({ r, decidedBy, tiedWith });
          });
        }
        i = j;
      }
      const rows: StandingRow[] = ordered.map(({ r, decidedBy, tiedWith }, k) => ({
        teamId: r.teamId,
        group,
        played: r.played,
        won: r.won,
        drawn: 0,
        lost: r.lost,
        goalsFor: r.pointsFor,
        goalsAgainst: r.pointsAgainst,
        awayGoalsFor: 0,
        awayWon: r.awayWon,
        yellowCards: 0,
        redCards: 0,
        pointsAdjustment: 0,
        form: r.form,
        rank: k + 1,
        // a coluna de pontos da tabela é o número de vitórias (como no /standings normalizado)
        points: r.won,
        goalDifference: r.pointsFor - r.pointsAgainst,
        zone: nbaZone(k + 1),
        unresolvedTieWith: tiedWith,
        decidedBy,
      }));
      return { group, rows };
    });
}

export interface NbaStandingsReport {
  seasonId: string;
  year: number;
  results: number;
  rows: number;
}

/**
 * Recalcula a tabela das temporadas da NBA que têm classificação do fornecedor (é ela que dá as conferências)
 * e jogos encerrados na temporada regular. Zero chamadas ao fornecedor.
 */
export async function recomputeNbaStandings(
  db: Database,
  options: { publish?: boolean } = {},
): Promise<NbaStandingsReport[]> {
  const seasons = await db
    .selectDistinct({ id: season.id, year: season.year, competitionId: competition.id })
    .from(standing)
    .innerJoin(season, eq(season.id, standing.seasonId))
    .innerJoin(competition, eq(competition.id, season.competitionId))
    .where(eq(competition.sport, 'nba'))
    .orderBy(season.year);
  const out: NbaStandingsReport[] = [];
  for (const s of seasons) {
    const regular = await db
      .select({ id: stage.id })
      .from(stage)
      .where(and(eq(stage.seasonId, s.id), eq(stage.kind, 'regular')));
    if (!regular.length) continue;
    const current = await db
      .select({ participantId: standing.participantId, group: standing.group, source: standing.source })
      .from(standing)
      .where(eq(standing.seasonId, s.id));
    // conferências: as do fornecedor quando houver (a nossa tabela repete as dele); senão, as já calculadas
    const provider = current.filter((r) => r.source === 'provider');
    const groupOf = new Map((provider.length ? provider : current).map((r) => [r.participantId, r.group]));
    const matches = (await loadSeasonResults(db, s.id, { stageIds: regular.map((r) => r.id) })).filter(
      (m) => groupOf.has(m.homeId) && groupOf.has(m.awayId),
    );
    if (!matches.length) continue;
    const tables = rankNbaStandings(matches, groupOf);
    const rows = await writeComputedStandings(db, s.id, tables, { mode: 'replace' });
    // a tabela inteira é a calculada: linha antiga (outro nome de grupo) não fica para trás
    const keep = tables.flatMap((t) => t.rows.map((r) => `${t.group}|${r.teamId}`));
    await db
      .delete(standing)
      .where(
        and(
          eq(standing.seasonId, s.id),
          notInArray(sql<string>`${standing.group} || '|' || ${standing.participantId}::text`, keep),
        ),
      );
    if (options.publish !== false && rows > 0) {
      await publishChange(db, {
        topic: 'standings',
        entityType: 'season',
        entityId: s.id,
        payload: {
          source: 'computed',
          rows,
          groups: tables.map((t) => t.group),
          tags: [`competition:${s.competitionId}`, 'standing'],
        },
      });
    }
    out.push({ seasonId: s.id, year: s.year, results: matches.length, rows });
  }
  return out;
}
