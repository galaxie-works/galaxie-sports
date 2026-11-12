/**
 * Gol anulado sem rastro na fonte. Quando o VAR anula um gol, a api-sports costuma só apagar o lance da
 * timeline e voltar o placar, sem mandar o evento `Var` / `Goal cancelled`. Como a timeline do core espelha
 * a do fornecedor, o gol sumia do lance a lance e dos momentos-chave sem deixar nada no lugar.
 *
 * Só que gol sumir da timeline, sozinho, quase nunca é anulação. Na medição do raw de 23/10 a 05/11 (279 quedas
 * em 213 jogos), a maioria se desfaz: lista `events: []` que volta em até 75 s, resposta atrasada de outro
 * endpoint, gol que a fonte reescreve. E o placar sozinho também oscila, às vezes por um gol que nunca entrou
 * na timeline. Anulação é o gol sair da timeline e ficar fora, com o placar do lado do gol tendo caído depois
 * dele: antes (mediana de 60 s, até 54 min), junto ou até 60 s depois.
 *
 * Por isso a decisão espera. Entre uma resposta e outra, a memória fica em `core.event.goal_watch`, fora de
 * `core.event_incident`: nada pendente sai por API, SSE, webhook ou change feed.
 * - `peak`: quanto do placar de cada lado ainda pode ser retirado. Sobe com o placar; desce quando uma retirada é
 *   confirmada ou quando o placar caiu sem gol nenhum para retirar.
 * - `pending`: gols que saíram da timeline, com o instante em que saíram.
 * - `usedVars`: VARs do fornecedor que já dispensaram um lance (cada VAR dispensa no máximo um).
 * - `clock`: o relógio mais adiantado já visto. Resposta com o relógio recuado é velha: não muda nada.
 *
 * O gol pendente vira lance de VAR inferido (`type = 'var'`, `detail = 'Goal cancelled'`, minuto, time e jogador do
 * gol) quando está fora há `RETRACTION_CONFIRM_MS` e `peak` do lado passa do placar. Sem a queda do placar, some sem
 * rastro depois de `RETRACTION_EXPIRE_MS`. Com o jogo encerrado não há mais o que esperar: a queda basta. O lance
 * fica numa faixa própria de `sequence` (a partir de `RETRACTED_GOAL_SEQUENCE_BASE`) e sobrevive às trocas seguintes
 * até que o fornecedor mande o próprio VAR daquele time e minuto (o dele vale) ou o gol volte para a timeline.
 *
 * Função pura: quem grava (upsert do core, armazenamento em memória dos testes) só aplica o resultado.
 */
import type { GoalWatch, GoalWatchPending, GoalWatchSide } from '@galaxie/db';

export type { GoalWatch, GoalWatchPending, GoalWatchSide };

/** Início da faixa de `sequence` dos lances inferidos (a timeline do fornecedor nunca chega perto). */
export const RETRACTED_GOAL_SEQUENCE_BASE = 100_000;
/** Detalhe do lance inferido: o mesmo que a api-sports usa no VAR de gol anulado. */
export const RETRACTED_GOAL_DETAIL = 'Goal cancelled';
/** Marca em `data.galaxie.inferred` do lance de VAR criado pela Galaxie. */
export const RETRACTED_GOAL_MARK = 'goal_retracted';
/** Tempo fora da timeline para o gol virar lance. */
export const RETRACTION_CONFIRM_MS = 45_000;
/** Sem queda do placar até aqui, o gol pendente é descartado (a queda que vem depois do gol leva até 60 s). */
export const RETRACTION_EXPIRE_MS = 90_000;
/** Relógio recuado por mais tempo que isto é correção da fonte, não resposta velha: passa a valer. */
const CLOCK_REGRESS_GRACE_MS = 10 * 60_000;
/**
 * Resposta velha recua poucos minutos (até 4 na medição). Recuo maior (de 12 a 56) é relógio errado num dos lados, às
 * vezes com a timeline certa: segurar a lista atrasaria gol novo. Não é resposta velha, e o relógio passa a valer.
 */
const CLOCK_REGRESS_MAX_MIN = 5;
/** Distância máxima (min) entre o gol e o VAR do fornecedor que o anula. */
const PROVIDER_VAR_WINDOW_MIN = 5;
/** Distância máxima (min) para dizer que é o mesmo gol: a fonte reescreve o minuto e o autor. */
const SAME_GOAL_WINDOW_MIN = 2;

const GOAL_TYPES = new Set(['goal', 'own_goal']);
/** Fase do jogo pelo código do fornecedor; a prorrogação e os intervalos dela se ordenam pelo minuto. */
const CLOCK_RANK: Readonly<Record<string, number>> = {
  '1H': 1,
  HT: 2,
  '2H': 3,
  BT: 4,
  ET: 4,
  P: 5,
  FT: 6,
  AET: 6,
  PEN: 6,
};

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

type Goal = Omit<IncidentRow, 'sequence'>;

export const isRetractedGoalRow = (i: Pick<IncidentRow, 'sequence'>) =>
  i.sequence >= RETRACTED_GOAL_SEQUENCE_BASE;

/** Gol que conta no placar (a cobrança da disputa de pênaltis fica de fora). */
function isGoal(i: Goal): boolean {
  if (!GOAL_TYPES.has(i.type)) return false;
  const comments = i.data?.comments;
  return !(typeof comments === 'string' && comments.trim().toLowerCase() === 'penalty shootout');
}

const clockOf = (i: Pick<Goal, 'minute' | 'extra'>) => (i.minute ?? 0) + (i.extra ?? 0) / 100;

const minuteGap = (a: Pick<Goal, 'minute'>, b: Pick<Goal, 'minute'>) =>
  a.minute == null || b.minute == null ? Infinity : Math.abs(a.minute - b.minute);

const sameTeam = (a: Pick<Goal, 'participantId'>, b: Pick<Goal, 'participantId'>) =>
  a.participantId == null || b.participantId == null || a.participantId === b.participantId;

const samePerson = (a: Pick<Goal, 'personId'>, b: Pick<Goal, 'personId'>) =>
  a.personId != null && a.personId === b.personId;

/**
 * Pode ser o mesmo gol: mesmo time e minuto perto, com o autor igual ou não (a fonte preenche e troca o autor). A
 * troca de gol por gol contra pode vir com o outro time, conforme a convenção do lance.
 */
function sameGoal(a: Goal, b: Goal): boolean {
  if (minuteGap(a, b) > SAME_GOAL_WINDOW_MIN) return false;
  return sameTeam(a, b) || (a.type !== b.type && samePerson(a, b));
}

/** Quanto maior, mais provável que `a` e `b` sejam o mesmo gol: autor igual e, depois, o minuto mais perto. */
const closeness = (a: Goal, b: Goal) =>
  (samePerson(a, b) ? 1000 : 0) + (a.type === b.type ? 100 : 0) - Math.abs(clockOf(a) - clockOf(b));

/** Pareamento um para um entre as duas listas: devolve o que sobrou de cada lado. */
function pairGoals<A extends Goal, B extends Goal>(
  as: readonly A[],
  bs: readonly B[],
): { onlyA: A[]; onlyB: B[] } {
  const pairs = as
    .flatMap((a, ai) => bs.flatMap((b, bi) => (sameGoal(a, b) ? [{ ai, bi, score: closeness(a, b) }] : [])))
    .sort((x, y) => y.score - x.score);
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  for (const { ai, bi } of pairs) {
    if (usedA.has(ai) || usedB.has(bi)) continue;
    usedA.add(ai);
    usedB.add(bi);
  }
  return { onlyA: as.filter((_, i) => !usedA.has(i)), onlyB: bs.filter((_, i) => !usedB.has(i)) };
}

const isProviderCancel = (v: IncidentRow) =>
  !isRetractedGoalRow(v) &&
  v.type === 'var' &&
  // a mesma regra de `isGoalCancellingVarDetail` (@galaxie/contracts) e do trigger da 0127
  /^goal (cancel+ed|disallowed)\b/i.test((v.detail ?? '').trim());

function inferredVar(goal: Goal, sequence: number): IncidentRow {
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

export interface GoalWatchInput {
  watch: GoalWatch | null;
  /** Timeline gravada (ao menos os gols do fornecedor e os lances inferidos). */
  previous: readonly IncidentRow[];
  /** Timeline da resposta; `null` quando ela não traz `events` (o placar ainda conta). */
  next: readonly IncidentRow[] | null;
  /** Placar do evento depois desta resposta. */
  score: { home: number | null; away: number | null } | null;
  /** Placar gravado antes desta resposta: de onde sai o `peak` de quem ainda não tem memória. */
  priorScore: { home: number | null; away: number | null } | null;
  /** Lado de cada time do evento. */
  sides: ReadonlyMap<string, GoalWatchSide>;
  /** Relógio da resposta: código do fornecedor (1H, HT...) e minuto. */
  clock: { code: string | null; minute: number | null } | null;
  /** O evento está encerrado: não há por que esperar a próxima resposta para confirmar. */
  finished: boolean;
  observedAt: Date;
}

export interface GoalWatchResult {
  /** Memória a gravar; `null` enquanto não há o que lembrar. */
  watch: GoalWatch | null;
  /** A timeline do fornecedor deve ser trocada pela da resposta. */
  replaceTimeline: boolean;
  /** Lances inferidos que ficam junto da timeline: os que continuam valendo e os confirmados agora. */
  retracted: IncidentRow[];
  /** Gols pendentes confirmados nesta resposta. */
  confirmed: GoalWatchPending[];
}

function clockMark(clock: GoalWatchInput['clock']) {
  const rank = clock?.code ? CLOCK_RANK[clock.code] : undefined;
  return rank == null ? null : { rank, minute: clock!.minute };
}

function clockWentBack(
  seen: GoalWatch['clock'],
  mark: ReturnType<typeof clockMark>,
  observedAt: number,
): boolean {
  if (!seen || !mark) return false;
  const lag = mark.minute != null && seen.minute != null ? seen.minute - mark.minute : null;
  if (lag != null && lag > CLOCK_REGRESS_MAX_MIN) return false;
  const back = mark.rank < seen.rank || (mark.rank === seen.rank && lag != null && lag > 0);
  return back && observedAt - Date.parse(seen.at) < CLOCK_REGRESS_GRACE_MS;
}

const OTHER_SIDE = { home: 'away', away: 'home' } as const;

/**
 * Lados que o gol pode somar. O gol contra pode vir com o time beneficiado (o padrão de `creditedSide`, em
 * `apps/api/src/events/timeline.ts`) ou com o do jogador que marcou contra; ao vivo não dá para saber qual, e é o
 * placar que decide. O lado padrão vem primeiro.
 */
function creditSides(goal: Goal, sides: ReadonlyMap<string, GoalWatchSide>): GoalWatchSide[] {
  const side = goal.participantId ? sides.get(goal.participantId) : undefined;
  if (!side) return [];
  return goal.type === 'own_goal' ? [side, OTHER_SIDE[side]] : [side];
}

/** Avança a memória com uma resposta do fornecedor e diz o que fazer com a timeline. */
export function advanceGoalWatch(input: GoalWatchInput): GoalWatchResult {
  const { watch, previous, sides, finished } = input;
  const inferred = previous.filter(isRetractedGoalRow);
  const at = input.observedAt.getTime();
  const iso = input.observedAt.toISOString();
  const mark = clockMark(input.clock);

  // resposta velha entre endpoints: o placar e a lista dela são de antes
  if (clockWentBack(watch?.clock ?? null, mark, at))
    return { watch, replaceTimeline: false, retracted: inferred, confirmed: [] };

  const score =
    input.score?.home != null && input.score.away != null
      ? { home: input.score.home, away: input.score.away }
      : null;
  const storedGoals = previous.filter((i) => !isRetractedGoalRow(i) && isGoal(i));

  // lista vazia com o placar dizendo que há gols é falha da fonte: ela volta (97 casos, nenhum deixou de voltar)
  const wiped = input.next?.length === 0 && storedGoals.length > 0 && (!score || score.home + score.away > 0);
  const list = wiped ? null : input.next;

  const peak = watch
    ? { ...watch.peak }
    : { home: input.priorScore?.home ?? 0, away: input.priorScore?.away ?? 0 };
  if (score) {
    peak.home = Math.max(peak.home, score.home);
    peak.away = Math.max(peak.away, score.away);
  }

  let pending = [...(watch?.pending ?? [])];
  const usedVars = [...(watch?.usedVars ?? [])];
  let kept = [...inferred];
  let goals: readonly Goal[] = storedGoals;

  if (list) {
    goals = list.filter((i) => !isRetractedGoalRow(i) && isGoal(i));
    const { onlyA: left, onlyB: arrived } = pairGoals(storedGoals, goals);

    // gol que volta cancela no máximo um pendente ou um lance já confirmado (o mais parecido)
    for (const goal of arrived) {
      const candidates: Goal[] = [
        ...pending.map((p) => p.goal).filter((g) => sameGoal(g, goal)),
        ...kept.filter((i) => sameGoal(i, goal)),
      ];
      const best = candidates.sort((a, b) => closeness(b, goal) - closeness(a, goal))[0];
      if (!best) continue;
      pending = pending.filter((p) => p.goal !== best);
      kept = kept.filter((i) => i !== best);
    }

    pending.push(...left.map(({ sequence: _sequence, ...goal }) => ({ since: iso, goal })));

    // cada VAR do fornecedor dispensa no máximo um: o gol pendente ou o lance mais perto dele
    const fresh = list.filter(isProviderCancel);
    for (const used of usedVars) {
      const twin = fresh.findIndex((v) => sameTeam(v, used) && minuteGap(v, used) <= SAME_GOAL_WINDOW_MIN);
      if (twin >= 0) fresh.splice(twin, 1);
    }
    for (const v of fresh) {
      const inRange = (g: Goal) => sameTeam(v, g) && minuteGap(v, g) <= PROVIDER_VAR_WINDOW_MIN;
      const candidates: Goal[] = [...pending.map((p) => p.goal).filter(inRange), ...kept.filter(inRange)];
      const best = candidates.sort((a, b) => minuteGap(v, a) - minuteGap(v, b))[0];
      if (!best) continue;
      pending = pending.filter((p) => p.goal !== best);
      kept = kept.filter((i) => i !== best);
      usedVars.push({ participantId: v.participantId, minute: v.minute });
    }
  }

  // o placar caiu sem gol para retirar (gol que nunca entrou na timeline): não deixa crédito para um falso depois
  if (score) {
    const claims = { home: 0, away: 0 };
    for (const g of [...goals, ...pending.map((p) => p.goal)]) {
      const credit = creditSides(g, sides);
      for (const side of credit.length ? credit : (['home', 'away'] as const)) claims[side] += 1;
    }
    peak.home = Math.min(peak.home, Math.max(score.home, claims.home));
    peak.away = Math.min(peak.away, Math.max(score.away, claims.away));
  }

  const confirmed: GoalWatchPending[] = [];
  const waiting: GoalWatchPending[] = [];
  for (const p of [...pending].sort((a, b) => Date.parse(a.since) - Date.parse(b.since))) {
    const age = at - Date.parse(p.since);
    const side = score ? creditSides(p.goal, sides).find((s) => peak[s] > score[s]) : undefined;
    if (side && (age >= RETRACTION_CONFIRM_MS || finished)) {
      peak[side] -= 1;
      confirmed.push(p);
    } else if (age < RETRACTION_EXPIRE_MS) waiting.push(p);
  }

  let sequence = Math.max(RETRACTED_GOAL_SEQUENCE_BASE - 1, ...kept.map((i) => i.sequence));
  const retracted = [
    ...kept,
    ...confirmed
      .map((p) => p.goal)
      .sort((a, b) => clockOf(a) - clockOf(b))
      .map((goal) => inferredVar(goal, (sequence += 1))),
  ];
  const replaceTimeline = list != null;

  // nada para lembrar: jogo sem gol ainda, ou carga de jogo já encerrado
  const idle = !waiting.length && !usedVars.length;
  if (!watch && idle && (finished || (peak.home === 0 && peak.away === 0)))
    return { watch: null, replaceTimeline, retracted, confirmed };

  const sameMark = mark && watch?.clock?.rank === mark.rank && watch.clock.minute === mark.minute;
  return {
    watch: {
      peak,
      pending: waiting,
      usedVars,
      clock: mark ? (sameMark ? watch!.clock : { ...mark, at: iso }) : (watch?.clock ?? null),
    },
    replaceTimeline,
    retracted,
    confirmed,
  };
}
