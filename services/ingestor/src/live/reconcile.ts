/**
 * Reconciliação do ao vivo — rede de segurança e "botão de pânico" do painel de Operação: confirma na
 * fonte os jogos que o core ainda dá como em andamento, ou que o relógio encerrou sem placar, sem depender
 * do plano do ao vivo. Corrige quem ficou preso em "ao vivo" porque o poller desistiu da confirmação,
 * porque o jogo não entrou no plano (prioridade baixa: o relógio marca `live` pelo horário) ou porque o
 * processo do ao vivo caiu. As mudanças vão para o change feed como as do poller.
 *
 * O que é conferido:
 * - `stale` (detalhe `fixtures?id=`, prioridade LIVE, até `max` por execução): jogo que o ao vivo acompanha,
 *   já visto depois do apito (`lastValidAt` ≥ `startsAt`) e sem observação válida há mais que
 *   `staleMinutes` (ou 2× o intervalo do plano, se maior). Com o orçamento LIVE esgotado, não confere;
 * - `forced` (idem): no modo forçado (`force`, o botão do painel), todo jogo em andamento, depois dos `stale`;
 * - `unconfirmed` (em lote, prioridade ADHOC — fora da fatia do ao vivo): jogo do catálogo (prioridade
 *   ao vivo ≠ none, ou clássico) que o relógio dos eventos encerrou em `ends_at_expected` sem dado fresco.
 *   Uma agenda `fixtures?date=` confirma de uma vez todos os devidos daquela data, no máximo uma por data a
 *   cada `LIST_EVERY_MS` (60 min) e só dentro da fatia ADHOC do dia (`adhocAvailable`: nunca pega folga
 *   emprestada); cada jogo tem até `UNCONFIRMED_MAX_ATTEMPTS` tentativas espaçadas. Lotes e tentativas
 *   ficam em ops.sync_cursor. O resto do mundo, e o que passar do teto, é confirmado pela agenda D-1 do
 *   sync diário.
 * Os jogos que o poller está atualizando não gastam cota de novo.
 */
import {
  emptyBatch,
  isInPlay,
  isPreMatch,
  type NormalizedBatch,
  type NormalizedEvent,
  type SportsDataProvider,
} from '@galaxie/providers';
import { attemptsOf, cursorId, type CursorRef, type CursorStore } from '../jobs/runtime/cursor-store.js';
import { diffSnapshot, isSignificant, type LiveChange } from './diff.js';
import { spent } from './poller.js';
import { isRelevant, priorityScore, type LiveSchedulerOptions } from './schedule.js';
import type { LiveStore } from './store.js';
import type { LiveCandidate } from './types.js';

const MIN = 60_000;

/** Sem observação válida há este tempo, um jogo acompanhado pelo ao vivo é suspeito (intervalo + tick longo cabem). */
export const DEFAULT_STALE_MINUTES = 30;
/**
 * Tentativas de confirmar um jogo encerrado pelo relógio: a 1ª no próximo lote da data; as seguintes pelo
 * menos 30 min e 2 h depois da anterior (na prática, no lote de hora em hora que vier depois).
 */
export const UNCONFIRMED_MAX_ATTEMPTS = 3;
export const UNCONFIRMED_RETRY_MS = [30 * MIN, 120 * MIN];
/** No máximo uma agenda `fixtures?date=` por data neste intervalo (o raw de hoje só vale 5 min). */
export const LIST_EVERY_MS = 60 * MIN;
/**
 * Folga nos intervalos acima: o cron roda a cada 10 min, mas o `now` de cada execução atrasa alguns
 * segundos; sem folga, 59:5x de espera empurra o lote para a execução seguinte (+70 min).
 */
export const SCHEDULE_SLACK_MS = 5 * MIN;
/**
 * Janela (horas desde o apito) dos encerrados pelo relógio: mais larga que a do em andamento para caber a
 * 3ª tentativa (encerrado em ~apito + 115 min, mais 1 h e 2 h de espera, mais o lote de hora em hora).
 */
export const UNCONFIRMED_LOOKBACK_HOURS = 8;
/**
 * Cursores em ops.sync_cursor: tentativas por jogo (chave `id=<jogo no provedor>@<horário do apito>` — um
 * jogo remarcado começa a contagem do zero) e último lote por data (chave `date=YYYY-MM-DD`).
 */
export const RECONCILE_CURSOR_ENDPOINT = 'live:reconcile';

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
 * Por que conferir o jogo: `stale` (o ao vivo deveria estar atualizando e não está), `forced` (modo
 * forçado) ou `unconfirmed` (encerrado pelo relógio, sem placar da fonte); `null` = não precisa.
 */
export type ReconcileReason = 'stale' | 'forced' | 'unconfirmed';

/** Encerrado pelo relógio dos eventos, sem a fonte confirmar o resultado. */
export function isClockFinished(c: LiveCandidate): boolean {
  return c.status === 'finished' && c.statusSource === 'temporal';
}

/** No catálogo: prioridade ao vivo definida ou clássico (o resto do mundo fica para a agenda D-1). */
function inCatalog(c: LiveCandidate): boolean {
  return c.livePriority !== 'none' || c.derby;
}

export function reconcileReason(
  c: LiveCandidate,
  now: Date,
  options: ReconcileTargetOptions = {},
): ReconcileReason | null {
  if (isClockFinished(c)) return inCatalog(c) ? 'unconfirmed' : null;
  if (!isInPlay(c.status) && c.status !== 'starting') return null;
  if (isStale(c, now, options)) return 'stale';
  return options.force ? 'forced' : null;
}

function isStale(c: LiveCandidate, now: Date, options: ReconcileTargetOptions): boolean {
  // fora do ao vivo: só o encerramento (o relógio o fecha em ends_at_expected e ele volta como `unconfirmed`)
  if (!isRelevant(c, options.minPriority) || options.liveBudgetExhausted) return false;
  // nunca visto depois do apito: idem (antes do apito, a última observação é a agenda do sync)
  if (!c.lastValidAt || c.lastValidAt.getTime() < c.startsAt.getTime()) return false;
  const staleMs = Math.max(
    (options.staleMinutes ?? DEFAULT_STALE_MINUTES) * MIN,
    2 * (options.planIntervalMs ?? 0),
  );
  return now.getTime() - c.lastValidAt.getTime() >= staleMs;
}

export interface ReconcileOptions extends ReconcileTargetOptions {
  sport: string;
  now: Date;
  /** Máximo de detalhes (= chamadas LIVE) por execução: `stale` primeiro, por prioridade (padrão: 60). */
  max?: number | undefined;
  jobId?: string | undefined;
  /** Tentativas por jogo e último lote por data dos encerrados pelo relógio (ops.sync_cursor no CLI). */
  cursors: CursorStore;
  /**
   * Agendas (ADHOC) que esta execução pode pedir sem passar da fatia ADHOC do dia — o CLI calcula pelo
   * Governor (orçamento − usado − margem). Sem valor = sem teto (testes).
   */
  adhocAvailable?: number | undefined;
  /** O detalhe confirmou um jogo encerrado (ex.: marcar o cursor para o sync diário não repetir). */
  onDetailFetched?: ((providerEventId: string, at: Date) => void | Promise<void>) | undefined;
}

export interface ReconcileReport {
  /** Jogos em andamento no core, ou encerrados pelo relógio sem confirmação (dentro da janela). */
  inPlay: number;
  /** Os que precisam de conferência agora: alvos do detalhe (antes do corte por `max`) e encerrados pelo
   * relógio com tentativa devida (os esgotados ou ainda espaçando não contam). */
  pending: number;
  /** Conferidos pelo detalhe. */
  checked: string[];
  /** Encerrados pelo relógio conferidos pela agenda do dia (`listed`: as datas buscadas). */
  confirmedByList: string[];
  listed: string[];
  /** Datas com jogo devido que ficaram sem agenda nesta execução por falta de cota (fatia ADHOC, plano). */
  listSkipped: {
    date: string;
    reason: 'adhoc_budget' | 'quota' | 'plan' | 'rate_limited';
    games: number;
  }[];
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
  const fromUnconfirmed = now.getTime() - candidatesLookbackHours(lookbackHours) * 3_600_000;
  return candidates
    .filter(
      (c) =>
        c.providerEventId &&
        c.startsAt.getTime() <= now.getTime() &&
        (isClockFinished(c)
          ? c.startsAt.getTime() >= fromUnconfirmed
          : (isInPlay(c.status) || c.status === 'starting') && c.startsAt.getTime() >= from),
    )
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** Horas de candidatos a ler do core: a janela do em andamento ou a dos encerrados pelo relógio. */
export function candidatesLookbackHours(lookbackHours = 6): number {
  return Math.max(lookbackHours, UNCONFIRMED_LOOKBACK_HOURS);
}

const REASON_ORDER: Record<ReconcileReason, number> = { stale: 0, forced: 1, unconfirmed: 2 };

/**
 * Jogos que vale confirmar na fonte, na ordem em que são atendidos: `stale` antes de `forced` (o teto
 * `max` nunca deixa um parado de fora por causa do botão de pânico), por prioridade e horário; os
 * `unconfirmed` (em lote, fora do teto) no fim.
 */
export function reconcileTargets(
  candidates: readonly LiveCandidate[],
  now: Date,
  options: ReconcileTargetOptions = {},
): LiveCandidate[] {
  return inPlayCandidates(candidates, now, options.lookbackHours)
    .map((c) => ({ c, reason: reconcileReason(c, now, options) }))
    .filter((x): x is { c: LiveCandidate; reason: ReconcileReason } => x.reason !== null)
    .sort(
      (a, b) =>
        REASON_ORDER[a.reason] - REASON_ORDER[b.reason] ||
        priorityScore(b.c) - priorityScore(a.c) ||
        a.c.startsAt.getTime() - b.c.startsAt.getTime(),
    )
    .map((x) => x.c);
}

function attemptRef(sport: string, c: LiveCandidate): CursorRef {
  return {
    sport,
    endpoint: RECONCILE_CURSOR_ENDPOINT,
    key: `id=${c.providerEventId}@${c.startsAt.toISOString()}`,
  };
}

function listRef(sport: string, date: string): CursorRef {
  return { sport, endpoint: RECONCILE_CURSOR_ENDPOINT, key: `date=${date}` };
}

/**
 * Agendas que ainda cabem na fatia ADHOC do dia sem pegar folga emprestada de outra prioridade, deixando
 * `margin` chamadas para o uso manual.
 */
export function adhocAllowance(
  usage: { used: Record<'ADHOC', number>; budget: Record<'ADHOC', number> },
  margin = 1,
): number {
  return Math.max(0, usage.budget.ADHOC - usage.used.ADHOC - margin);
}

/**
 * Datas puladas por falta de cota que merecem aviso no log: uma vez por data e por dia (cursor
 * `aviso=<data>@<dia>`), sem repetir a cada execução. `rate_limited` (429 ou a mesma agenda em voo noutro
 * processo) é passageiro: não avisa nem grava o cursor, para não esconder um aviso real mais tarde.
 */
export async function quotaSkipsToWarn(
  cursors: CursorStore,
  sport: string,
  skips: ReconcileReport['listSkipped'],
  now: Date,
): Promise<ReconcileReport['listSkipped']> {
  const day = now.toISOString().slice(0, 10);
  const quota = skips.filter((s) => s.reason !== 'rate_limited');
  const refs = quota.map((s) => ({
    sport,
    endpoint: RECONCILE_CURSOR_ENDPOINT,
    key: `aviso=${s.date}@${day}`,
  }));
  const warned = await cursors.load(refs);
  const out = quota.filter((_, i) => !warned.get(cursorId(refs[i]!))?.completedAt);
  const fresh = refs.filter((r) => !warned.get(cursorId(r))?.completedAt);
  if (fresh.length) await cursors.complete(fresh, { reason: 'quota' }, now);
  return out;
}

/** Encerrados pelo relógio com tentativa devida agora (o `--plan` usa o mesmo critério). */
export async function dueUnconfirmed(
  cursors: CursorStore,
  sport: string,
  unconfirmed: readonly LiveCandidate[],
  now: Date,
): Promise<LiveCandidate[]> {
  const states = await cursors.load(unconfirmed.map((c) => attemptRef(sport, c)));
  return unconfirmed.filter((c) => unconfirmedDue(states.get(cursorId(attemptRef(sport, c))), now));
}

/**
 * Quando sai o próximo lote de cada data (`null` = já pode sair): no máximo um a cada `LIST_EVERY_MS`
 * (com a folga de `SCHEDULE_SLACK_MS`). O `--plan` mostra a mesma espera.
 */
export async function nextListAt(
  cursors: CursorStore,
  sport: string,
  dates: readonly string[],
  now: Date,
): Promise<Map<string, Date | null>> {
  const last = await cursors.load(dates.map((d) => listRef(sport, d)));
  return new Map(
    dates.map((date) => {
      const at = last.get(cursorId(listRef(sport, date)))?.completedAt;
      const next = at ? at.getTime() + LIST_EVERY_MS - SCHEDULE_SLACK_MS : -Infinity;
      return [date, next > now.getTime() ? new Date(next) : null];
    }),
  );
}

/** Encerrado pelo relógio que pode ser conferido agora (tentativas restantes e espaçamento cumprido). */
export function unconfirmedDue(
  state: { completedAt: Date | null; cursor: Record<string, unknown> | null } | undefined,
  now: Date,
): boolean {
  if (state?.completedAt) return false;
  const n = attemptsOf(state);
  if (n >= UNCONFIRMED_MAX_ATTEMPTS) return false;
  if (n === 0) return true;
  const last = Date.parse(String(state?.cursor?.lastAttemptAt ?? ''));
  const wait = UNCONFIRMED_RETRY_MS[Math.min(n, UNCONFIRMED_RETRY_MS.length) - 1]!;
  return !Number.isFinite(last) || now.getTime() - last >= wait - SCHEDULE_SLACK_MS;
}

/** Só os eventos pedidos (e o que eles referenciam) de uma agenda do dia inteiro. */
function onlyEvents(batch: NormalizedBatch, events: NormalizedEvent[]): NormalizedBatch {
  const competitions = new Set(events.flatMap((e) => (e.competitionId ? [e.competitionId] : [])));
  const venues = new Set(events.flatMap((e) => (e.venueId ? [e.venueId] : [])));
  const participants = new Set(events.flatMap((e) => e.participants.map((p) => p.participantId)));
  const stages = new Set(events.flatMap((e) => (e.stageLabel ? [e.stageLabel] : [])));
  return {
    ...emptyBatch(batch.provider, batch.sport, batch.observedAt),
    competitions: batch.competitions.filter((c) => competitions.has(c.id)),
    stages: batch.stages.filter(
      (s) => competitions.has(s.season.competitionId) && stages.has(s.providerLabel),
    ),
    venues: batch.venues.filter((v) => venues.has(v.id)),
    participants: batch.participants.filter((p) => participants.has(p.id)),
    events,
  };
}

export async function reconcileLive(
  provider: SportsDataProvider,
  store: LiveStore,
  options: ReconcileOptions,
): Promise<ReconcileReport> {
  const { sport, now, cursors } = options;
  const lookbackHours = options.lookbackHours ?? 6;
  const candidates = await store.candidates(
    sport,
    provider.id,
    new Date(now.getTime() - candidatesLookbackHours(lookbackHours) * 3_600_000),
    now,
  );
  const inPlay = inPlayCandidates(candidates, now, lookbackHours);
  const targets = reconcileTargets(inPlay, now, options);
  const detailIds = targets
    .filter((c) => !isClockFinished(c))
    .slice(0, options.max ?? 60)
    .map((c) => c.providerEventId!);
  const due = await dueUnconfirmed(cursors, sport, targets.filter(isClockFinished), now);
  const dueByDate = new Map<string, LiveCandidate[]>();
  for (const c of due) {
    const date = c.startsAt.toISOString().slice(0, 10);
    dueByDate.set(date, [...(dueByDate.get(date) ?? []), c]);
  }
  // no máximo uma agenda por data a cada LIST_EVERY_MS: os devidos esperam o próximo lote
  const nextList = await nextListAt(cursors, sport, [...dueByDate.keys()], now);
  const byDate = new Map([...dueByDate].filter(([date]) => nextList.get(date) === null));
  const jobOptions = options.jobId ? { jobId: options.jobId } : {};
  const ids = [...detailIds, ...[...byDate.values()].flat().map((c) => c.providerEventId!)];

  const before = await store.snapshots(provider.id, sport, ids);
  let calls = 0;
  let errors = 0;
  for (const id of detailIds) {
    const detail = await provider.getEventDetail(sport, id, { priority: 'LIVE', ...jobOptions });
    calls += spent(detail);
    if (detail.status !== 'ok') {
      errors += detail.status === 'error' ? 1 : 0;
      continue;
    }
    await store.applyBatch(detail.batch);
    const ev = detail.batch.events.find((e) => e.id === id);
    if (ev?.observation.status === 'finished') await options.onDetailFetched?.(id, detail.fetchedAt);
  }

  // encerrados pelo relógio: uma agenda do dia confirma todos (ADHOC: não sai do saldo do ao vivo)
  const listed: string[] = [];
  const confirmedByList: string[] = [];
  const listSkipped: ReconcileReport['listSkipped'] = [];
  let adhocLeft = options.adhocAvailable ?? Infinity;
  for (const [date, games] of byDate) {
    // fatia ADHOC do dia no fim: não pega folga emprestada; os jogos ficam para o sync D-1
    if (adhocLeft <= 0) {
      listSkipped.push({ date, reason: 'adhoc_budget', games: games.length });
      continue;
    }
    const list = await provider.listEvents({ sport, date }, { priority: 'ADHOC', ...jobOptions });
    calls += spent(list);
    const refs = (gs: LiveCandidate[]) => gs.map((c) => attemptRef(sport, c));
    if (
      list.status === 'error' &&
      (list.error.kind === 'quota' || list.error.kind === 'plan' || list.error.kind === 'rate_limited')
    ) {
      // bloqueio local (cota, plano, a mesma agenda já em voo noutro processo) ou limite por minuto:
      // a fonte não respondeu a agenda — não conta tentativa nem lote
      listSkipped.push({ date, reason: list.error.kind, games: games.length });
      continue;
    }
    adhocLeft -= 1;
    await cursors.complete([listRef(sport, date)], { listedAt: now.toISOString() }, now);
    // erro da fonte, ou agenda mundial vazia (a fonte não devolveu o dia): tenta de novo, espaçado
    if (list.status !== 'ok') {
      errors += 1;
      const why = list.status === 'error' ? `${list.error.kind}: ${list.error.message}` : 'agenda vazia';
      await cursors.fail(refs(games), why, now);
      continue;
    }
    listed.push(date);
    const byId = new Map(list.batch.events.map((e) => [e.id, e]));
    const found = new Map(
      games.flatMap((c) => {
        const e = byId.get(c.providerEventId!);
        return e ? [[c, e] as const] : [];
      }),
    );
    // a fonte diz "não começou" (liga sem cobertura, NS travado): não reabre para `starting` quem o relógio
    // já encerrou — fica para a próxima tentativa. Remarcado (outro horário/data) é aplicado: o jogo volta
    // para a agenda nova
    const rescheduled = (c: LiveCandidate, e: NormalizedEvent) =>
      e.observation.startsAt.getTime() !== c.startsAt.getTime();
    const usable = [...found]
      .filter(([c, e]) => e.observation.status && (!isPreMatch(e.observation.status) || rescheduled(c, e)))
      .map(([, e]) => e);
    if (usable.length) await store.applyBatch(onlyEvents(list.batch, usable));
    const usableIds = new Set(usable.map((e) => e.id));
    confirmedByList.push(
      ...games.filter((c) => usableIds.has(c.providerEventId!)).map((c) => c.providerEventId!),
    );
    // fora da agenda: encerrado por ora, sem novas tentativas (o sync D-1 confere); confirmado: resolvido.
    // Remarcado não grava nada: com o horário novo, a chave do cursor é outra e a contagem recomeça se o
    // relógio o encerrar de novo
    const resolved = games.filter((c) => {
      const e = found.get(c);
      return !e || e.observation.status === 'finished';
    });
    const retry = games.filter((c) => !resolved.includes(c) && !rescheduled(c, found.get(c)!));
    await cursors.complete(refs(resolved), { source: 'live-reconcile', listedAt: now.toISOString() }, now);
    await cursors.fail(refs(retry), 'não confirmado pela agenda do dia', now);
  }

  const after = await store.snapshots(provider.id, sport, ids);
  const changes: LiveChange[] = [];
  const confirmed = new Set(confirmedByList);
  for (const [id, snap] of after) {
    const change = diffSnapshot(before.get(id), snap);
    if (!change) continue;
    // o relógio já o dava como encerrado, mas o resultado só agora veio da fonte: é o encerramento de fato
    // (change feed com `finished` e recálculo da tabela)
    if (confirmed.has(id) && snap.status === 'finished') change.finished = true;
    changes.push(change);
  }
  const published = await store.publish(changes.filter((c) => isSignificant(c)));
  const finished = changes.filter((c) => c.finished);
  if (finished.length) await store.onFinished?.(finished);

  return {
    inPlay: inPlay.length,
    pending: targets.filter((c) => !isClockFinished(c)).length + due.length,
    checked: detailIds,
    confirmedByList,
    listed,
    listSkipped,
    calls,
    errors,
    changes,
    published,
    finished: finished.map((c) => c.providerEventId),
  };
}
