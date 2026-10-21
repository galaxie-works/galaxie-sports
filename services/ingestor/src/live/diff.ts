/**
 * Diff do ao vivo: compara o retrato de um evento no core antes e depois de aplicar um tick
 * (placar, status, relógio, incidentes, *last-known-good*). Função pura — a publicação no change feed
 * fica com quem chama.
 */
import type { EventClock, EventScore, EventStatus } from '@galaxie/providers';

export interface IncidentSnapshot {
  sequence: number;
  type: string;
  detail: string | null;
  minute: number | null;
  extra: number | null;
  participantId: string | null;
}

/** Retrato de um evento no core (ou no armazenamento em memória dos testes). */
export interface EventSnapshot {
  eventId: string;
  providerEventId: string;
  competitionId: string | null;
  seasonId: string | null;
  status: EventStatus;
  statusDetail: string | null;
  clock: EventClock | null;
  score: EventScore | null;
  isStale: boolean;
  lastValidAt: Date | null;
  /** Timeline em ordem de `sequence`. */
  incidents: IncidentSnapshot[];
}

export type ChangeKind = 'created' | 'status' | 'score' | 'clock' | 'incident' | 'stale' | 'recovered';

export interface LiveChange {
  eventId: string;
  providerEventId: string;
  competitionId: string | null;
  seasonId: string | null;
  kinds: ChangeKind[];
  status: EventStatus;
  statusDetail: string | null;
  score: EventScore | null;
  clock: EventClock | null;
  previous: { status: EventStatus; statusDetail: string | null; score: EventScore | null } | null;
  /** Incidentes novos ou alterados (ex.: gol, cartão, VAR). */
  incidents: IncidentSnapshot[];
  /** Incidentes que sumiram da timeline (ex.: gol anulado pelo VAR). */
  removedIncidents: number;
  /** O placar mudou ou entrou um gol na timeline. */
  goal: boolean;
  /** O evento passou a `finished` nesta mudança. */
  finished: boolean;
}

const GOAL_TYPES = new Set(['goal', 'own_goal', 'penalty']);

function pairKey(p: { home: number | null; away: number | null } | null | undefined): string {
  return p ? `${p.home ?? '-'}:${p.away ?? '-'}` : '';
}

/** Chave do placar que importa para o torcedor: tempo de jogo, prorrogação e pênaltis. */
export function scoreKey(s: EventScore | null): string {
  if (!s) return '';
  return [pairKey(s), pairKey(s.extratime), pairKey(s.penalty)].join('|');
}

function clockKey(c: EventClock | null): string {
  return c ? `${c.minute ?? '-'}+${c.extra ?? '-'}@${c.period ?? '-'}` : '';
}

function incidentKey(i: IncidentSnapshot): string {
  return `${i.type}|${i.detail ?? ''}|${i.minute ?? ''}|${i.extra ?? ''}|${i.participantId ?? ''}`;
}

/** Diferenças relevantes; `null` quando nada mudou. */
export function diffSnapshot(before: EventSnapshot | undefined, after: EventSnapshot): LiveChange | null {
  const kinds: ChangeKind[] = [];
  const prevIncidents = new Map((before?.incidents ?? []).map((i) => [i.sequence, i]));
  const changedIncidents = after.incidents.filter((i) => {
    const prev = prevIncidents.get(i.sequence);
    return !prev || incidentKey(prev) !== incidentKey(i);
  });
  const afterSeqs = new Set(after.incidents.map((i) => i.sequence));
  const removedIncidents = [...prevIncidents.keys()].filter((s) => !afterSeqs.has(s)).length;

  if (!before) kinds.push('created');
  else {
    if (before.status !== after.status || before.statusDetail !== after.statusDetail) kinds.push('status');
    if (scoreKey(before.score) !== scoreKey(after.score)) kinds.push('score');
    if (clockKey(before.clock) !== clockKey(after.clock)) kinds.push('clock');
    if (!before.isStale && after.isStale) kinds.push('stale');
    if (before.isStale && !after.isStale) kinds.push('recovered');
  }
  if (changedIncidents.length || removedIncidents) kinds.push('incident');
  if (!kinds.length) return null;

  // gol = o total de gols subiu (0 x 0 ao começar não é gol) ou entrou um gol novo na timeline
  const goals = (s: EventScore | null) => (s?.home ?? 0) + (s?.away ?? 0);
  const goal =
    before != null &&
    (goals(after.score) > goals(before.score) ||
      changedIncidents.some((i) => GOAL_TYPES.has(i.type) && !prevIncidents.has(i.sequence)));
  return {
    eventId: after.eventId,
    providerEventId: after.providerEventId,
    competitionId: after.competitionId,
    seasonId: after.seasonId,
    kinds,
    status: after.status,
    statusDetail: after.statusDetail,
    score: after.score,
    clock: after.clock,
    previous: before
      ? { status: before.status, statusDetail: before.statusDetail, score: before.score }
      : null,
    incidents: changedIncidents,
    removedIncidents,
    goal,
    finished: after.status === 'finished' && before?.status !== 'finished',
  };
}

/** Mudança que merece sinal para os clientes (relógio sozinho não: muda a cada tick). */
export function isSignificant(change: LiveChange): boolean {
  return change.kinds.some((k) => k !== 'clock');
}
