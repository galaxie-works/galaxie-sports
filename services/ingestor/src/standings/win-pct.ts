/**
 * Tabela por aproveitamento (vitórias ÷ jogos decididos), usada no beisebol quando o fornecedor não tem
 * `standings` da liga (LMB, LMP, LIDOM, LVBP… no plano free). Não há pontos: `points` = vitórias, como na
 * tabela do fornecedor, e a ordem é pct → vitórias → saldo de corridas → corridas pró.
 */
import type { FormLetter, MatchResult, StandingRow, StandingsTable } from '@galaxie/rules';

const DAY = 86_400_000;

/**
 * Fim da fase regular quando o fornecedor não separa o mata-mata seguinte (round robin da LIDOM e da
 * LVBP, primeira rodada de playoff da LMB vêm sem fase): os eliminados param de jogar e os classificados
 * seguem dias depois. Devolve o instante do último jogo desse grupo que parou primeiro, ou null se todos
 * terminam juntos. Depois do corte sobra pouco (o mata-mata); se sobra muito, o time que parou cedo
 * desistiu no meio da temporada e não há corte.
 */
export function regularSeasonCutoff(matches: readonly MatchResult[]): string | null {
  const last = new Map<string, number>();
  for (const m of matches) {
    const at = Date.parse(m.playedAt ?? '');
    if (Number.isNaN(at)) continue;
    for (const id of [m.homeId, m.awayId]) last.set(id, Math.max(last.get(id) ?? at, at));
  }
  if (last.size < 3) return null;
  const first = Math.min(...last.values());
  const early = [...last].filter(([, at]) => at - first <= 2 * DAY);
  if (early.length === last.size) return null;
  const cutoff = Math.max(...early.map(([, at]) => at));
  // folga para jogos do mesmo dia que começam mais tarde (horário noturno nas Américas já é o dia seguinte em UTC)
  const until = cutoff + 18 * 3_600_000;
  const after = matches.filter((m) => Date.parse(m.playedAt ?? '') > until).length;
  if (after > 0.3 * (matches.length - after)) return null;
  return new Date(until).toISOString();
}

/** Vitórias ÷ (vitórias + derrotas); empate (raro, jogo suspenso) fica fora do denominador. */
export function winPct(won: number, lost: number): number {
  return won + lost === 0 ? 0 : won / (won + lost);
}

export function winPctTables(matches: readonly MatchResult[]): StandingsTable[] {
  const byGroup = new Map<string, Map<string, StandingRow>>();
  const row = (group: string, teamId: string) => {
    let rows = byGroup.get(group);
    if (!rows) byGroup.set(group, (rows = new Map()));
    let r = rows.get(teamId);
    if (!r) {
      r = {
        teamId,
        group,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        awayGoalsFor: 0,
        awayWon: 0,
        yellowCards: 0,
        redCards: 0,
        pointsAdjustment: 0,
        form: [],
        rank: 0,
        points: 0,
        goalDifference: 0,
        zone: null,
        unresolvedTieWith: [],
        decidedBy: null,
      };
      rows.set(teamId, r);
    }
    return r;
  };
  const ordered = [...matches].sort((a, b) => (a.playedAt ?? '').localeCompare(b.playedAt ?? ''));
  for (const m of ordered) {
    const group = m.group ?? '';
    const sides: [StandingRow, number, number, boolean][] = [
      [row(group, m.homeId), m.homeGoals, m.awayGoals, false],
      [row(group, m.awayId), m.awayGoals, m.homeGoals, true],
    ];
    for (const [r, runsFor, runsAgainst, away] of sides) {
      const result: FormLetter = runsFor > runsAgainst ? 'W' : runsFor < runsAgainst ? 'L' : 'D';
      r.played++;
      r.goalsFor += runsFor;
      r.goalsAgainst += runsAgainst;
      if (away) r.awayGoalsFor += runsFor;
      if (result === 'W') {
        r.won++;
        if (away) r.awayWon++;
      } else if (result === 'L') r.lost++;
      else r.drawn++;
      r.form.push(result);
    }
  }
  return [...byGroup.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, rows]) => {
      const list = [...rows.values()].map((r) => ({
        ...r,
        points: r.won,
        goalDifference: r.goalsFor - r.goalsAgainst,
      }));
      list.sort(
        (a, b) =>
          winPct(b.won, b.lost) - winPct(a.won, a.lost) ||
          b.won - a.won ||
          b.goalDifference - a.goalDifference ||
          b.goalsFor - a.goalsFor ||
          a.teamId.localeCompare(b.teamId),
      );
      list.forEach((r, i) => (r.rank = i + 1));
      return { group, rows: list };
    });
}
