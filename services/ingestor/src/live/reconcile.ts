/**
 * Reconciliação do ao vivo — rede de segurança e "botão de pânico" do painel de Operação: confirma pelo
 * detalhe (`fixtures?id=`) os jogos que o core ainda dá como em andamento, sem depender do plano do
 * ao vivo. Corrige quem ficou preso em "ao vivo" porque o poller desistiu da confirmação, porque o jogo
 * não entrou no plano (prioridade baixa: o relógio marca `live` pelo horário) ou porque o processo do ao
 * vivo caiu. As mudanças vão para o change feed como as do poller.
 *
 * A execução agendada só confere o que parece errado:
 * - `unconfirmed`: encerrado pelo relógio dos eventos (sem dado fresco em `ends_at_expected`), ainda sem o
 *   placar da fonte — qualquer prioridade, inclusive o que o ao vivo não acompanha. Custa 1 chamada por
 *   jogo: confirmado, o status passa a vir da fonte (ou volta a `live`, se o jogo ainda não acabou);
 * - `stale`: jogo que o ao vivo acompanha, já visto depois do apito e sem observação válida há mais que
 *   `staleMinutes` (ou 2× o intervalo do plano, se maior). Com o orçamento LIVE esgotado, não confere.
 * Os jogos que o poller está atualizando não gastam cota de novo. O modo forçado (`force`, o botão do
 * painel) confere todos os em andamento.
 */
import { isInPlay, type SportsDataProvider } from '@galaxie/providers';
import { diffSnapshot, isSignificant, type LiveChange } from './diff.js';
import { spent } from './poller.js';
import { isRelevant, type LiveSchedulerOptions } from './schedule.js';
import type { LiveStore } from './store.js';
import type { LiveCandidate } from './types.js';

/** Sem observação válida há este tempo, um jogo acompanhado pelo ao vivo é suspeito (intervalo + tick longo cabem). */
export const DEFAULT_STALE_MINUTES = 30;

export interface ReconcileTargetOptions {
  /** Até quantas horas antes de agora um jogo pode ter começado (padrão: 6). */
  lookbackHours?: number | undefined;
  /** Confere todo jogo em andamento (botão de pânico), não só os parados. */
  force?: boolean | undefined;
  /** Minutos sem observação válida que tornam suspeito um jogo acompanhado pelo ao vivo (padrão: 30). */
  staleMinutes?: number | undefined;
  /** Menor `live_priority` que o ao vivo acompanha (LIVE_MIN_PRIORITY; padrão: medium). */
  minPriority?: LiveSchedulerOptions['minPriority'] | undefined;
  /**
   * Intervalo atual do plano do ao vivo (ms): com cota apertada ele passa de `staleMinutes`, e um jogo só
   * é suspeito depois de 2× esse intervalo sem observação.
   */
  planIntervalMs?: number | null | undefined;
  /** O plano do ao vivo está sem ticks (orçamento LIVE esgotado): não gasta com jogo "parado". */
  liveBudgetExhausted?: boolean | undefined;
}

/**
 * Por que conferir o jogo: `unconfirmed` (encerrado pelo relógio, sem placar da fonte), `forced` (modo
 * forçado) ou `stale` (o ao vivo deveria estar atualizando e não está); `null` = não precisa.
 */
export type ReconcileReason = 'unconfirmed' | 'forced' | 'stale';

/** Encerrado pelo relógio dos eventos, sem a fonte confirmar o resultado. */
export function isClockFinished(c: LiveCandidate): boolean {
  return c.status === 'finished' && c.statusSource === 'temporal';
}

export function reconcileReason(
  c: LiveCandidate,
  now: Date,
  options: ReconcileTargetOptions = {},
): ReconcileReason | null {
  if (isClockFinished(c)) return 'unconfirmed';
  if (!isInPlay(c.status) && c.status !== 'starting') return null;
  if (options.force) return 'forced';
  // fora do ao vivo: só o encerramento (o relógio o fecha em ends_at_expected e ele volta como `unconfirmed`)
  if (!isRelevant(c, options.minPriority) || options.liveBudgetExhausted) return null;
  // nunca visto depois do apito: idem (antes do apito, a última observação é a agenda do sync)
  if (!c.lastValidAt || c.lastValidAt.getTime() < c.startsAt.getTime()) return null;
  const staleMs = Math.max(
    (options.staleMinutes ?? DEFAULT_STALE_MINUTES) * 60_000,
    2 * (options.planIntervalMs ?? 0),
  );
  return now.getTime() - c.lastValidAt.getTime() >= staleMs ? 'stale' : null;
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
  /** Jogos em andamento no core, ou encerrados pelo relógio sem confirmação (dentro da janela). */
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

/**
 * Jogos que o core dá como em andamento (ou começando), ou que o relógio encerrou sem confirmação, dentro
 * da janela; os mais antigos primeiro.
 */
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
        (isInPlay(c.status) || c.status === 'starting' || isClockFinished(c)) &&
        c.startsAt.getTime() <= now.getTime() &&
        c.startsAt.getTime() >= from,
    )
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** Jogos que vale confirmar na fonte (todos os em andamento, no modo forçado). */
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
