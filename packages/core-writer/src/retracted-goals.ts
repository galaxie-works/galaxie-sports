/**
 * Gol anulado sem rastro na fonte. Quando o VAR anula um gol, a api-sports costuma só apagar o lance da
 * timeline e voltar o placar, sem mandar o evento `Var` / `Goal cancelled`. Como a timeline do core espelha
 * a do fornecedor, o gol sumia do lance a lance e dos momentos-chave sem deixar nada no lugar.
 *
 * Aqui, ao trocar a timeline, o gol que a fonte retirou vira um lance de VAR inferido (`type = 'var'`,
 * `detail = 'Goal cancelled'`) com o minuto, o time e o jogador do gol. Esses lances ficam numa faixa própria
 * de `sequence` (a partir de `RETRACTED_GOAL_SEQUENCE_BASE`), fora da faixa da timeline do fornecedor, e
 * sobrevivem às trocas seguintes até que:
 * - o fornecedor mande o próprio VAR de gol anulado para aquele time e minuto (o dele vale, o inferido sai); ou
 * - o gol volte para a timeline (anulação revertida ou lance removido por engano).
 *
 * Função pura: quem grava (upsert do core, armazenamento em memória dos testes) só aplica o resultado.
 */

/** Início da faixa de `sequence` dos lances inferidos (a timeline do fornecedor nunca chega perto). */
export const RETRACTED_GOAL_SEQUENCE_BASE = 100_000;
/** Detalhe do lance inferido: o mesmo que a api-sports usa no VAR de gol anulado. */
export const RETRACTED_GOAL_DETAIL = 'Goal cancelled';
/** Marca em `data.galaxie.inferred` do lance de VAR criado pela Galaxie. */
export const RETRACTED_GOAL_MARK = 'goal_retracted';
/** Distância máxima (min) entre o gol e o VAR do fornecedor que o anula. */
const PROVIDER_VAR_WINDOW_MIN = 5;

const GOAL_TYPES = new Set(['goal', 'own_goal']);

export interface IncidentRow {
  sequence: number;
  minute: number | null;
  extra: number | null;
  type: string;
  detail: string | null;
  participantId: string | null;
  personId: string | null;
  assistPersonId: string | null;
  data: Record<string, unknown> | null;
}

export const isRetractedGoalRow = (i: Pick<IncidentRow, 'sequence'>) =>
  i.sequence >= RETRACTED_GOAL_SEQUENCE_BASE;

/** Gol que conta no placar (a cobrança da disputa de pênaltis fica de fora). */
function isGoal(i: IncidentRow): boolean {
  if (!GOAL_TYPES.has(i.type)) return false;
  const comments = i.data?.comments;
  return !(typeof comments === 'string' && comments.trim().toLowerCase() === 'penalty shootout');
}

const clockOf = (i: Pick<IncidentRow, 'minute' | 'extra'>) => (i.minute ?? 0) + (i.extra ?? 0) / 100;

/** VAR do próprio fornecedor anulando gol daquele time perto daquele minuto. */
function providerCancels(next: readonly IncidentRow[], goal: IncidentRow): boolean {
  return next.some(
    (v) =>
      !isRetractedGoalRow(v) &&
      v.type === 'var' &&
      /goal (cancelled|disallowed)/i.test(v.detail ?? '') &&
      (v.participantId == null || goal.participantId == null || v.participantId === goal.participantId) &&
      v.minute != null &&
      goal.minute != null &&
      Math.abs(v.minute - goal.minute) <= PROVIDER_VAR_WINDOW_MIN,
  );
}

/**
 * Pareia os gols novos com os antigos (mesmo time, depois mesmo jogador, mesmo tipo e o minuto mais perto)
 * e devolve os antigos que ficaram sem par. Reatribuir autor ou trocar gol por gol contra não deixa sobra.
 */
function unmatchedGoals(before: readonly IncidentRow[], after: readonly IncidentRow[]): IncidentRow[] {
  const pool = [...before];
  for (const g of after) {
    let best = -1;
    let bestScore = -Infinity;
    pool.forEach((o, idx) => {
      const score =
        (o.participantId != null && o.participantId === g.participantId ? 400 : 0) +
        (o.personId != null && o.personId === g.personId ? 200 : 0) +
        (o.type === g.type ? 100 : 0) -
        Math.min(99, Math.abs(clockOf(o) - clockOf(g)));
      if (score > bestScore) {
        bestScore = score;
        best = idx;
      }
    });
    if (best >= 0) pool.splice(best, 1);
  }
  return pool;
}

function inferredVar(goal: IncidentRow, sequence: number): IncidentRow {
  const raw = goal.data ?? {};
  return {
    sequence,
    minute: goal.minute,
    extra: goal.extra,
    type: 'var',
    detail: RETRACTED_GOAL_DETAIL,
    participantId: goal.participantId,
    personId: goal.personId,
    assistPersonId: null,
    data: {
      ...raw,
      type: 'Var',
      detail: RETRACTED_GOAL_DETAIL,
      comments: null,
      assist: null,
      galaxie: { inferred: RETRACTED_GOAL_MARK, goal: { type: goal.type, detail: goal.detail } },
    },
  };
}

/**
 * Lances de gol anulado que devem ficar junto da timeline nova do fornecedor (`next`), a partir da timeline
 * gravada antes (`previous`: a do fornecedor e os inferidos que já existiam). Os inferidos que continuam valendo
 * mantêm a `sequence`; os novos vêm depois do maior já usado.
 */
export function retractedGoals(
  previous: readonly IncidentRow[],
  next: readonly IncidentRow[],
): IncidentRow[] {
  const prevGoals = previous.filter((i) => !isRetractedGoalRow(i) && isGoal(i));
  const nextGoals = next.filter((i) => !isRetractedGoalRow(i) && isGoal(i));

  // inferidos de antes: saem se o fornecedor mandou o VAR dele ou se o gol voltou (o total de gols subiu e um
  // gol novo do mesmo time e jogador apareceu perto do minuto)
  const returned = unmatchedGoals(nextGoals, prevGoals);
  const kept = previous.filter(
    (i) =>
      isRetractedGoalRow(i) &&
      !providerCancels(next, i) &&
      !returned.some(
        (g) =>
          g.participantId === i.participantId &&
          g.personId === i.personId &&
          g.minute != null &&
          i.minute != null &&
          Math.abs(g.minute - i.minute) <= 1,
      ),
  );
  if (nextGoals.length >= prevGoals.length) return kept;

  let seq = Math.max(RETRACTED_GOAL_SEQUENCE_BASE - 1, ...kept.map((i) => i.sequence));
  const added = unmatchedGoals(prevGoals, nextGoals)
    .filter((g) => !providerCancels(next, g))
    .filter(
      (g) =>
        !kept.some(
          (k) => k.participantId === g.participantId && k.personId === g.personId && k.minute === g.minute,
        ),
    )
    .sort((a, b) => clockOf(a) - clockOf(b))
    .map((g) => inferredVar(g, (seq += 1)));
  return [...kept, ...added];
}
