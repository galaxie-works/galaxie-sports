import { standingsTableOf } from '../config/parse.js';
import type { CompetitionRules, StandingsTableRule } from '../config/types.js';
import { unknownRoundPhase } from '../standings/tables.js';
import type { Fixture } from './league.js';
import { pickGroupTable } from './result.js';

/**
 * Escolha da tabela de um jogo de pontos corridos pelo regulamento (`tables:`): a fase do jogo vem do rótulo
 * da rodada, e a tabela e a matemática (times, jogos, zonas) são as da fase. Sem isso, entre a zona do
 * Clausura, a anual e os promedios da mesma temporada, ficaria a de mais jogos somados (os promedios). Usada
 * pelos stakes do motor (`computeEventStakes`) e pela API (montador de eventos).
 */

/** Tipos de estágio que só podem ser de tabela (rodada fora do regulamento ainda tem tabela). */
export const TABLE_STAGE_KINDS: ReadonlySet<string> = new Set(['group', 'league_phase']);

export interface LeagueTableRow {
  group: string;
  participantId: string;
  rank: number;
  played: number;
  updatedAt?: Date | null;
}

export type LeagueTableChoice<R extends LeagueTableRow> =
  | {
      /** Fase do jogo; null quando o regulamento não tem fases (tabela única ou grupos do fornecedor). */
      phase: StandingsTableRule | null;
      /** Regulamento com a matemática da fase por cima da competição. */
      rules: CompetitionRules;
      /** Tabela do grupo dos dois times, na ordem de classificação. */
      table: R[];
      reason?: undefined;
    }
  | { phase?: undefined; rules: CompetitionRules; table?: undefined; reason: string };

/**
 * Tabela de um jogo de pontos corridos entre as linhas de `core.standing` da temporada.
 * - Regulamento com fases: a fase cujo `rounds` casa com o rótulo da rodada. Rodada desconhecida em estágio
 *   de grupo ou fase de liga: a fase inequívoca pelos grupos (`unknownRoundPhase`); em estágio "regular",
 *   nenhuma (pode ser mata-mata rotulado como rodada, como a Liguilla).
 * - Entre os grupos da fase com os dois times, o de mais jogos (dois rótulos da mesma tabela, um velho).
 */
export function pickLeagueTable<R extends LeagueTableRow>(
  competitionRules: CompetitionRules,
  stage: { kind: string; label: string | null } | null,
  rows: readonly R[],
  homeId: string,
  awayId: string,
): LeagueTableChoice<R> {
  const phases = competitionRules.tables.filter((t) => t.kind === 'phase' && t.rounds);
  const found: StandingsTableRule | null | undefined = !phases.length
    ? null
    : stage
      ? phases.find((t) => t.rounds!.test(stage.label ?? ''))
      : undefined;
  if (found === undefined && !TABLE_STAGE_KINDS.has(stage?.kind ?? ''))
    return { rules: competitionRules, reason: 'rodada fora das fases do regulamento' };
  const phase = found === undefined ? unknownRoundPhase(competitionRules, rows, homeId, awayId) : found;
  if (found === undefined && !phase)
    return {
      rules: competitionRules,
      reason: 'rodada fora das fases do regulamento, sem fase inequívoca para os dois times',
    };
  const rules = phase?.league ? { ...competitionRules, league: phase.league } : competitionRules;
  const scoped = phase ? rows.filter((r) => standingsTableOf(rules, r.group)?.key === phase.key) : rows;
  if (!scoped.some((r) => r.participantId === homeId) || !scoped.some((r) => r.participantId === awayId))
    return { rules, reason: 'times fora da tabela da temporada' };
  const groups = new Map<string, R[]>();
  for (const r of scoped) groups.set(r.group, [...(groups.get(r.group) ?? []), r]);
  const picked = pickGroupTable(groups.values(), homeId, awayId);
  if (!picked) return { rules, reason: 'times em grupos diferentes' };
  return { phase: phase ?? null, rules, table: [...picked].sort((x, y) => x.rank - y.rank) };
}

/** Resultado com o rótulo da rodada e o tipo do estágio (`loadLeagueResults`). */
export interface PhaseResultInput {
  homeId: string;
  awayId: string;
  roundLabel: string | null;
  stageKind: string;
}

/**
 * Os resultados que o recálculo soma na tabela da fase: os das rodadas dela (`rounds`) e os de rodada que
 * nenhuma fase reconhece, em estágio de grupo ou fase de liga, adotados nela por serem inequívocos
 * (`unknownRoundPhase`, a mesma regra do recálculo). Sem fase, ou fase sem `rounds`, todos. A tabela de antes
 * de um jogo encerrado só fecha com exatamente esses jogos.
 */
export function phaseResults<M extends PhaseResultInput>(
  rules: Pick<CompetitionRules, 'tables'>,
  phase: StandingsTableRule | null,
  results: readonly M[],
  rows: readonly Pick<LeagueTableRow, 'group' | 'participantId'>[],
): M[] {
  if (!phase?.rounds) return [...results];
  const rounds = rules.tables.filter((t) => t.kind === 'phase' && t.rounds).map((t) => t.rounds!);
  return results.filter((m) => {
    const label = m.roundLabel ?? '';
    if (phase.rounds!.test(label)) return true;
    if (rounds.some((re) => re.test(label)) || !TABLE_STAGE_KINDS.has(m.stageKind)) return false;
    return unknownRoundPhase(rules, rows, m.homeId, m.awayId)?.key === phase.key;
  });
}

/**
 * Jogos da rodada para o "nesta rodada", só entre times da tabela. Numa tabela que soma jogos contra
 * times de fora (`cross_group_matches`), um jogo da rodada com um só lado nela deixaria esse time como
 * se não jogasse: aí a rodada fica desconhecida (todos podem pontuar), que é o limite seguro.
 */
export function roundWithin(
  round: readonly Fixture[],
  ids: ReadonlySet<string>,
  crossGroup: boolean,
): Fixture[] | undefined {
  const sides = (f: Fixture) => Number(ids.has(f.homeId)) + Number(ids.has(f.awayId));
  if (crossGroup && round.some((f) => sides(f) === 1)) return undefined;
  return round.filter((f) => sides(f) === 2);
}
