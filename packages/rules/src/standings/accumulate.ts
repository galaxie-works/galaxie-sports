import type { PointsRule } from '../config/types.js';
import type { BaselineRow, FormLetter, MatchResult, PointsAdjustment, TeamId, TeamRecord } from './types.js';

export class StandingsInputError extends Error {
  override readonly name = 'StandingsInputError';
}

export function emptyRecord(teamId: TeamId, group = ''): TeamRecord {
  return {
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
  };
}

export function basePoints(r: Pick<TeamRecord, 'won' | 'drawn' | 'lost'>, points: PointsRule): number {
  return r.won * points.win + r.drawn * points.draw + r.lost * points.loss;
}

export function totalPoints(r: TeamRecord, points: PointsRule): number {
  return basePoints(r, points) + r.pointsAdjustment;
}

function nonNegativeInt(value: number, field: string, who: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new StandingsInputError(`${who}: ${field} deve ser inteiro >= 0 (recebido ${String(value)}).`);
  }
  return value;
}

function parseForm(form: string | undefined): FormLetter[] {
  if (!form) return [];
  return [...form.toUpperCase()].filter((c): c is FormLetter => c === 'W' || c === 'D' || c === 'L');
}

/** Converte uma linha de tabela de partida em totais acumulados. */
export function recordFromBaseline(row: BaselineRow, points: PointsRule): TeamRecord {
  const who = `Tabela de partida (${row.teamId})`;
  const r = emptyRecord(row.teamId, row.group ?? '');
  r.played = nonNegativeInt(row.played, 'played', who);
  r.won = nonNegativeInt(row.won, 'won', who);
  r.drawn = nonNegativeInt(row.drawn, 'drawn', who);
  r.lost = nonNegativeInt(row.lost, 'lost', who);
  if (r.won + r.drawn + r.lost !== r.played) {
    throw new StandingsInputError(
      `${who}: V+E+D (${r.won + r.drawn + r.lost}) difere de jogos (${r.played}).`,
    );
  }
  r.goalsFor = nonNegativeInt(row.goalsFor, 'goalsFor', who);
  r.goalsAgainst = nonNegativeInt(row.goalsAgainst, 'goalsAgainst', who);
  r.awayGoalsFor = nonNegativeInt(row.awayGoalsFor ?? 0, 'awayGoalsFor', who);
  r.awayWon = nonNegativeInt(row.awayWon ?? 0, 'awayWon', who);
  r.yellowCards = nonNegativeInt(row.yellowCards ?? 0, 'yellowCards', who);
  r.redCards = nonNegativeInt(row.redCards ?? 0, 'redCards', who);
  r.form = parseForm(row.form);
  if (row.points !== undefined) r.pointsAdjustment = row.points - basePoints(r, points);
  return r;
}

/** Time de jogo entre grupos: o grupo dele já tem de estar em `teams` (ou na tabela de partida). */
function known(records: Map<TeamId, TeamRecord>, teamId: TeamId): TeamRecord {
  const r = records.get(teamId);
  if (!r) throw new StandingsInputError(`Jogo entre grupos com time ${teamId} sem grupo informado.`);
  return r;
}

function ensure(records: Map<TeamId, TeamRecord>, teamId: TeamId, group: string): TeamRecord {
  let r = records.get(teamId);
  if (!r) {
    r = emptyRecord(teamId, group);
    records.set(teamId, r);
  } else if (r.group !== group) {
    throw new StandingsInputError(
      `Time ${teamId} aparece no grupo "${r.group}" e no grupo "${group}"; um time pertence a um só grupo.`,
    );
  }
  return r;
}

export function validateMatch(m: MatchResult): void {
  const who = `Partida ${m.id ?? `${m.homeId} x ${m.awayId}`}`;
  if (!m.homeId || !m.awayId) throw new StandingsInputError(`${who}: mandante e visitante são obrigatórios.`);
  if (m.homeId === m.awayId) throw new StandingsInputError(`${who}: um time não joga contra si mesmo.`);
  nonNegativeInt(m.homeGoals, 'homeGoals', who);
  nonNegativeInt(m.awayGoals, 'awayGoals', who);
}

/** Aplica um resultado aos totais (muta `records`). */
export function applyMatch(records: Map<TeamId, TeamRecord>, m: MatchResult): void {
  validateMatch(m);
  const group = m.group ?? '';
  const home = m.crossGroup ? known(records, m.homeId) : ensure(records, m.homeId, group);
  const away = m.crossGroup ? known(records, m.awayId) : ensure(records, m.awayId, group);
  home.played++;
  away.played++;
  home.goalsFor += m.homeGoals;
  home.goalsAgainst += m.awayGoals;
  away.goalsFor += m.awayGoals;
  away.goalsAgainst += m.homeGoals;
  if (!m.neutral) away.awayGoalsFor += m.awayGoals;
  if (m.homeGoals > m.awayGoals) {
    home.won++;
    away.lost++;
    home.form.push('W');
    away.form.push('L');
  } else if (m.homeGoals < m.awayGoals) {
    away.won++;
    home.lost++;
    if (!m.neutral) away.awayWon++;
    home.form.push('L');
    away.form.push('W');
  } else {
    home.drawn++;
    away.drawn++;
    home.form.push('D');
    away.form.push('D');
  }
  home.yellowCards += m.cards?.home?.yellow ?? 0;
  home.redCards += m.cards?.home?.red ?? 0;
  away.yellowCards += m.cards?.away?.yellow ?? 0;
  away.redCards += m.cards?.away?.red ?? 0;
}

/** Ordena cronologicamente quando todas as partidas têm data; senão mantém a ordem recebida. */
export function chronological(matches: readonly MatchResult[]): MatchResult[] {
  const all = [...matches];
  if (all.every((m) => m.playedAt)) {
    return all
      .map((m, i) => ({ m, i }))
      .sort((a, b) => (a.m.playedAt! < b.m.playedAt! ? -1 : a.m.playedAt! > b.m.playedAt! ? 1 : a.i - b.i))
      .map((x) => x.m);
  }
  return all;
}

export interface AccumulateInput {
  points: PointsRule;
  matches: readonly MatchResult[];
  baseline?: readonly BaselineRow[];
  teams?: readonly { teamId: TeamId; group?: string }[];
  adjustments?: readonly PointsAdjustment[];
}

/** Totais por time: tabela de partida (opcional) + novos resultados + ajustes de pontos. */
export function accumulate(input: AccumulateInput): Map<TeamId, TeamRecord> {
  const records = new Map<TeamId, TeamRecord>();
  for (const row of input.baseline ?? []) {
    if (records.has(row.teamId)) {
      throw new StandingsInputError(`Tabela de partida: time ${row.teamId} repetido.`);
    }
    records.set(row.teamId, recordFromBaseline(row, input.points));
  }
  for (const t of input.teams ?? []) ensure(records, t.teamId, t.group ?? '');
  const ids = new Set<string>();
  for (const m of chronological(input.matches)) {
    if (m.id !== undefined) {
      if (ids.has(m.id)) throw new StandingsInputError(`Partida ${m.id} aplicada duas vezes.`);
      ids.add(m.id);
    }
    applyMatch(records, m);
  }
  for (const adj of input.adjustments ?? []) {
    const r = records.get(adj.teamId);
    if (!r) throw new StandingsInputError(`Ajuste de pontos para time desconhecido: ${adj.teamId}.`);
    r.pointsAdjustment += adj.points;
  }
  return records;
}

/** Últimos `n` resultados (mais antigo → mais recente), ex.: "WWDLW". */
export function formString(record: Pick<TeamRecord, 'form'>, n = 5): string {
  return record.form.slice(-n).join('');
}
