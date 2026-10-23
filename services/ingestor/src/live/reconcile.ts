/**
 * Reconciliação do ao vivo — rede de segurança e "botão de pânico" do painel de Operação: confirma pelo
 * detalhe (`fixtures?id=`) cada jogo que o core ainda dá como em andamento, sem depender do plano do
 * ao vivo. Corrige quem ficou preso em "ao vivo" porque o poller desistiu da confirmação, porque o jogo
 * não entrou no plano (prioridade baixa: o relógio marca `live` pelo horário) ou porque o processo do ao
 * vivo caiu. As mudanças vão para o change feed como as do poller.
 */
import { isInPlay, type SportsDataProvider } from '@galaxie/providers';
import { diffSnapshot, isSignificant, type LiveChange } from './diff.js';
import { spent } from './poller.js';
import type { LiveStore } from './store.js';
import type { LiveCandidate } from './types.js';

export interface ReconcileOptions {
  sport: string;
  now: Date;
  /** Até quantas horas antes de agora um jogo pode ter começado (padrão: 6). */
  lookbackHours?: number | undefined;
  /** Máximo de jogos (= chamadas) por execução, os mais antigos primeiro (padrão: 60). */
  max?: number | undefined;
  jobId?: string | undefined;
  /** O detalhe confirmou um jogo encerrado (ex.: marcar o cursor para o sync diário não repetir). */
  onDetailFetched?: ((providerEventId: string, at: Date) => void | Promise<void>) | undefined;
}

export interface ReconcileReport {
  /** Jogos em andamento no core (dentro da janela), antes do corte por `max`. */
  pending: number;
  checked: string[];
  calls: number;
  errors: number;
  changes: LiveChange[];
  published: number;
  /** Encerrados pela reconciliação. */
  finished: string[];
}

/** Jogos que o core dá como em andamento (ou começando) e que vale confirmar na fonte. */
export function reconcileTargets(
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
  const targets = reconcileTargets(candidates, now, lookbackHours);
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
    pending: targets.length,
    checked: ids,
    calls,
    errors,
    changes,
    published,
    finished: done.map((c) => c.providerEventId),
  };
}
