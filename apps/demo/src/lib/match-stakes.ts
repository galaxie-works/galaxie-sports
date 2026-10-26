/**
 * Divisão dos stakes de um jogo entre os blocos de "O que está em jogo" (puro: servidor e testes): o que é
 * dos dois times, num bloco só, e o que fica no bloco de cada participante.
 */
import type { Event } from '@galaxie/contracts';

type Participant = Event['participants'][number];
export type Stake = Event['stakes'][number];
export type Phase = Stake['phase'];

/** Fase do stake; respostas antigas (sem `phase`) só tinham o pré-jogo. */
export const phaseOf = (s: Stake): Phase => s.phase ?? 'pre_match';

/** Stake do participante: pelo `team_id`; em respostas antigas, pelo lado. */
export const belongsTo = (s: Stake, p: Participant) => (s.team_id ? s.team_id === p.id : s.team === p.side);

/**
 * Chave de "mesmo stake" nos dois times: fase e código e, nos de histórico de títulos ("busca o tetra"), as
 * edições já vencidas. Dois times atrás do mesmo número de títulos têm temporadas diferentes: cada um fica no
 * próprio bloco, com as suas.
 */
const shareKey = (s: Stake) => `${phaseOf(s)}|${s.code}|${s.titles?.seasons.join(',') ?? ''}`;

/**
 * O mesmo stake nos dois times (ex.: os dois "ainda correm risco de rebaixamento") e os stakes `both`
 * aparecem uma vez só, em `shared`; o resto vai para o bloco do participante dele.
 */
export function splitStakes(
  stakes: Stake[],
  sides: Participant[],
): { shared: Stake[]; groups: { p: Participant; stakes: Stake[] }[] } {
  const owners = new Map<string, Set<string>>();
  for (const s of stakes) {
    if (s.team === 'both') continue;
    const owner = sides.find((p) => belongsTo(s, p))?.id;
    if (!owner) continue;
    owners.set(shareKey(s), (owners.get(shareKey(s)) ?? new Set()).add(owner));
  }
  const isShared = (s: Stake) =>
    s.team === 'both' || (sides.length === 2 && owners.get(shareKey(s))?.size === 2);
  const shared = stakes
    .filter(isShared)
    .filter((s, i, list) => list.findIndex((x) => shareKey(x) === shareKey(s)) === i);
  const groups = sides.map((p) => ({ p, stakes: stakes.filter((s) => !isShared(s) && belongsTo(s, p)) }));
  return { shared, groups };
}
