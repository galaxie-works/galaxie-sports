/**
 * Reconciliação do ao vivo — rede de segurança e "botão de pânico" do painel de Operação: confirma pelo
 * detalhe (`fixtures?id=`) os jogos que o core ainda dá como em andamento, sem depender do plano do
 * ao vivo. Corrige quem ficou preso em "ao vivo" porque o poller desistiu da confirmação, porque o jogo
 * não entrou no plano (prioridade baixa: o relógio marca `live` pelo horário) ou porque o processo do ao
 * vivo caiu. As mudanças vão para o change feed como as do poller.
 *
 * A execução agendada só confere o que parece parado: jogo que o ao vivo acompanha sem observação válida
 * há `staleMinutes`, ou jogo fora do ao vivo que já passou do fim previsto. Os jogos que o poller está
 * atualizando não gastam cota de novo. O modo forçado (`force`, o botão do painel) confere todos.
 */
import { isInPlay, type SportsDataProvider } from '@galaxie/providers';
import { diffSnapshot, isSignificant, type LiveChange } from './diff.js';
import { spent } from './poller.js';
import { isRelevant, profileFor, type LiveSchedulerOptions } from './schedule.js';
import type { LiveStore } from './store.js';
import type { LiveCandidate } from './types.js';

/** Sem observação válida há este tempo, um jogo acompanhado pelo ao vivo é suspeito (intervalo + tick longo cabem). */
export const DEFAULT_STALE_MINUTES = 30;

export interface ReconcileTargetOptions {
  /** Até quantas horas antes de agora um jogo pode ter começado (padrão: 6). */
  lookbackHours?: number | undefined;
  /** Confere todo jogo em andamento (botão de pânico), não só os parados. */
  force?: boolean | undefined;
  /** Minutos sem observação válida (contados do apito, se nunca houve) que tornam o jogo suspeito (padrão: 30). */
  staleMinutes?: number | undefined;
  /** Menor `live_priority` que o ao vivo acompanha (LIVE_MIN_PRIORITY; padrão: medium). */
  minPriority?: LiveSchedulerOptions['minPriority'] | undefined;
}

/**
 * Por que conferir o jogo: `forced` (modo forçado), `stale` (o ao vivo deveria estar atualizando e não
 * está) ou `overdue` (fora do ao vivo e além do fim previsto); `null` = não precisa.
 */
export type ReconcileReason = 'forced' | 'stale' | 'overdue';

export function reconcileReason(
  c: LiveCandidate,
  now: Date,
  options: ReconcileTargetOptions = {},
): ReconcileReason | null {
  if (options.force) return 'forced';
  // nunca observado depois do apito: conta a partir do horário oficial (a agenda do sync é de antes)
  const seen = Math.max(c.lastValidAt?.getTime() ?? -Infinity, c.startsAt.getTime());
  if (now.getTime() - seen < (options.staleMinutes ?? DEFAULT_STALE_MINUTES) * 60_000) return null;
  if (isRelevant(c, options.minPriority)) return 'stale';
  const expectedEnd = c.startsAt.getTime() + profileFor(c.sport).afterMin * 60_000;
  return now.getTime() >= expectedEnd ? 'overdue' : null;
}

export interface ReconcileOptions extends ReconcileTargetOptions {
  sport: string;
  now: Date;
  /** Máximo de jogos (= chamadas) por execução, os mais antigos primeiro (padrão: 60). */
  max?: number | undefined;
  jobId?: string | undefined;
  /** O detalhe confirmou um jogo encerrado (ex.: marcar o cursor para o sync diário não repetir). */
  onDetailFetched?: ((providerEventId: string, at: Date) => void | Promise<void>) | undefined;
}

export interface ReconcileReport {
  /** Jogos em andamento no core (dentro da janela). */
  inPlay: number;
  /** Os que precisam de conferência (todos, no modo forçado), antes do corte por `max`. */
  pending: number;
  checked: string[];
  calls: number;
  errors: number;
  changes: LiveChange[];
  published: number;
  /** Encerrados pela reconciliação. */
  finished: string[];
}

/** Jogos que o core dá como em andamento (ou começando) dentro da janela, os mais antigos primeiro. */
export function inPlayCandidates(
  candidates: readonly LiveCandidate[],
  now: Date,
  lookbackHours = 6,
): LiveCandidate[] {
  const from = now.getTime() - lookbackHours * 3_600_000;
  return candidates
    .filter(
      (c) =>
        c.providerEventId &&
        (isInPlay(c.status) || c.status === 'starting') &&
        c.startsAt.getTime() <= now.getTime() &&
        c.startsAt.getTime() >= from,
    )
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** Jogos em andamento que vale confirmar na fonte (todos, no modo forçado). */
export function reconcileTargets(
  candidates: readonly LiveCandidate[],
  now: Date,
  options: ReconcileTargetOptions = {},
): LiveCandidate[] {
  return inPlayCandidates(candidates, now, options.lookbackHours).filter(
    (c) => reconcileReason(c, now, options) !== null,
  );
}

export async function reconcileLive(
  provider: SportsDataProvider,
  store: LiveStore,
  options: ReconcileOptions,
): Promise<ReconcileReport> {
  const { sport, now } = options;
  const lookbackHours = options.lookbackHours ?? 6;
  const candidates = await store.candidates(
    sport,
    provider.id,
    new Date(now.getTime() - lookbackHours * 3_600_000),
    now,
  );
  const inPlay = inPlayCandidates(candidates, now, lookbackHours);
  const targets = inPlay.filter((c) => reconcileReason(c, now, options) !== null);
  const ids = targets.slice(0, options.max ?? 60).map((c) => c.providerEventId!);
  const callOptions = { priority: 'LIVE' as const, ...(options.jobId ? { jobId: options.jobId } : {}) };

  const before = await store.snapshots(provider.id, sport, ids);
  let calls = 0;
  let errors = 0;
  for (const id of ids) {
    const detail = await provider.getEventDetail(sport, id, callOptions);
    calls += spent(detail);
    if (detail.status !== 'ok') {
      errors += detail.status === 'error' ? 1 : 0;
      continue;
    }
    await store.applyBatch(detail.batch);
    const ev = detail.batch.events.find((e) => e.id === id);
    if (ev?.observation.status === 'finished') await options.onDetailFetched?.(id, detail.fetchedAt);
  }

  const after = await store.snapshots(provider.id, sport, ids);
  const changes: LiveChange[] = [];
  for (const [id, snap] of after) {
    const change = diffSnapshot(before.get(id), snap);
    if (change) changes.push(change);
  }
  const published = await store.publish(changes.filter((c) => isSignificant(c)));
  const done = changes.filter((c) => c.finished);
  if (done.length) await store.onFinished?.(done);

  return {
    inPlay: inPlay.length,
    pending: targets.length,
    checked: ids,
    calls,
    errors,
    changes,
    published,
    finished: done.map((c) => c.providerEventId),
  };
}
