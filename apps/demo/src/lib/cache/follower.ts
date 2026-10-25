/**
 * Seguidor do `ops.change_feed` que mantém o cache da demo (`'use cache'`) em dia: cada mudança vira as
 * mesmas tags que a API purga (`tagsForChange`), e a demo revalida as entradas marcadas com elas.
 *
 * - Acorda pelo NOTIFY `ops_change_feed` (com uma pausa curta, `settleMs`, que junta rajadas e dá tempo de
 *   a API purgar o Valkey antes de a demo buscar de novo) e varre a cada `pollIntervalMs` mesmo sem NOTIFY.
 * - Lê com a marca d'água tolerante a lacunas (`GapCursor`, a mesma do SSE e dos webhooks): uma transação
 *   lenta que publica um ID menor depois de um maior não se perde.
 * - Uma linha só conta como processada depois que a revalidação deu certo; se a rota falhar, as mesmas
 *   linhas voltam na próxima varredura.
 * - Uma segunda passada (`confirmMs`) revalida de novo as tags que expiram na hora: cobre a corrida em
 *   que a demo buscou a API antes de a API purgar o próprio cache (sem ela, o dado velho ficaria horas).
 * - Retoma do último ID salvo depois de reinício ou queda, desde que recente (`resumeMaxAgeMs` e
 *   `resumeMaxLag`); na primeira subida, ou depois de muito tempo parado, começa do ID mais recente — o
 *   histórico não é reprocessado.
 * - Nunca derruba o servidor: toda falha vira aviso no log e nova tentativa.
 */
import { GapCursor, tagsForChange } from '@galaxie/db/change-feed';

import { BUSY_TAGS } from './tags';

export interface FeedRow {
  id: number;
  entityType: string;
  entityId: string;
  payload: unknown;
}

export interface SavedCursor {
  lastId: number;
  updatedAt: Date;
}

/** Acesso ao change feed (Postgres em produção; memória nos testes). */
export interface FeedStore {
  latestId(): Promise<number>;
  /** Linhas com id > floor, fora de `skip`, em ordem de id. */
  readAfter(floor: number, skip: readonly number[], limit: number): Promise<FeedRow[]>;
  /** Assina o NOTIFY; devolve a função que cancela. */
  listen(onChange: () => void): Promise<() => Promise<void>>;
  loadCursor(name: string): Promise<SavedCursor | null>;
  saveCursor(name: string, lastId: number): Promise<void>;
}

/** Revalida as tags no servidor Next (rota interna); rejeita se não conseguiu. */
export type Revalidate = (tags: string[]) => Promise<void>;

interface Logger {
  info(msg: string, data?: object): void;
  warn(msg: string, data?: object): void;
}

export interface FollowerOptions {
  /** Nome do cursor salvo (uma linha por consumidor). */
  name?: string;
  pollIntervalMs?: number;
  settleMs?: number;
  confirmMs?: number;
  batch?: number;
  /** Tags por chamada da rota de revalidação. */
  chunk?: number;
  gapTimeoutMs?: number;
  resumeMaxAgeMs?: number;
  resumeMaxLag?: number;
  retryStartMs?: number;
  saveEveryMs?: number;
  /** Intervalo mínimo entre avisos repetidos de falha na revalidação. */
  warnEveryMs?: number;
  logger?: Logger;
  now?: () => number;
}

const silent: Logger = { info: () => {}, warn: () => {} };

export class ChangeFeedFollower {
  readonly name: string;
  private readonly o: Required<Omit<FollowerOptions, 'name' | 'logger' | 'now'>>;
  private readonly log: Logger;
  private readonly now: () => number;
  private cursor: GapCursor | undefined;
  private savedFloor: number | undefined;
  private savedAt = 0;
  private lastWarnAt = Number.NEGATIVE_INFINITY;
  private interval: ReturnType<typeof setInterval> | undefined;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly confirmTimers = new Set<ReturnType<typeof setTimeout>>();
  private unlisten: (() => Promise<void>) | undefined;
  private running: Promise<void> | undefined;
  private pending = false;
  private stopped = true;

  constructor(
    private readonly store: FeedStore,
    private readonly revalidate: Revalidate,
    options: FollowerOptions = {},
  ) {
    this.name = options.name ?? 'demo-cache';
    this.log = options.logger ?? silent;
    this.now = options.now ?? Date.now;
    this.o = {
      pollIntervalMs: options.pollIntervalMs ?? 5_000,
      settleMs: options.settleMs ?? 1_000,
      confirmMs: options.confirmMs ?? 10_000,
      batch: options.batch ?? 500,
      chunk: options.chunk ?? 200,
      gapTimeoutMs: options.gapTimeoutMs ?? 10_000,
      resumeMaxAgeMs: options.resumeMaxAgeMs ?? 24 * 3_600_000,
      resumeMaxLag: options.resumeMaxLag ?? 50_000,
      retryStartMs: options.retryStartMs ?? 30_000,
      saveEveryMs: options.saveEveryMs ?? 5_000,
      warnEveryMs: options.warnEveryMs ?? 60_000,
    };
  }

  /** Piso atual (todos os IDs até ele já foram revalidados). */
  get floor(): number | undefined {
    return this.cursor?.floor;
  }

  /** Começa a seguir; se o banco estiver fora, tenta de novo depois (nunca rejeita). */
  async start(): Promise<void> {
    this.stopped = false;
    this.retryTimer = undefined;
    try {
      await this.open();
    } catch (err) {
      this.log.warn('change feed fora do ar; nova tentativa logo mais', { err: String(err) });
      if (!this.stopped) {
        this.retryTimer = setTimeout(() => void this.start(), this.o.retryStartMs);
        this.retryTimer.unref?.();
      }
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const t of [this.interval, this.settleTimer, this.retryTimer]) if (t) clearTimeout(t);
    this.interval = this.settleTimer = this.retryTimer = undefined;
    for (const t of this.confirmTimers) clearTimeout(t);
    this.confirmTimers.clear();
    await this.unlisten?.().catch(() => {});
    this.unlisten = undefined;
    await this.running;
    await this.persist(true);
  }

  /** NOTIFY recebido: varre depois de `settleMs` (notificações dentro da janela viram uma varredura). */
  notify(): void {
    if (this.stopped || this.settleTimer) return;
    this.settleTimer = setTimeout(() => {
      this.settleTimer = undefined;
      void this.poll();
    }, this.o.settleMs);
    this.settleTimer.unref?.();
  }

  /** Processa as mudanças novas; chamadas concorrentes são coalescidas. */
  poll(): Promise<void> {
    if (this.stopped || !this.cursor) return Promise.resolve();
    if (this.running) {
      this.pending = true;
      return this.running;
    }
    this.running = this.drain()
      .catch((err) =>
        this.warnThrottled('falha ao revalidar o cache; o lote volta na varredura seguinte', err),
      )
      .finally(() => {
        this.running = undefined;
        if (this.pending && !this.stopped) {
          this.pending = false;
          void this.poll();
        }
      });
    return this.running;
  }

  private async open(): Promise<void> {
    const latest = await this.store.latestId();
    const saved = await this.store.loadCursor(this.name).catch((err: unknown) => {
      this.log.warn('erro ao ler o cursor salvo; parto do ID mais recente', { err: String(err) });
      return null;
    });
    const resumable =
      saved !== null &&
      saved.lastId <= latest &&
      this.now() - saved.updatedAt.getTime() <= this.o.resumeMaxAgeMs &&
      latest - saved.lastId <= this.o.resumeMaxLag;
    const floor = resumable ? saved.lastId : latest;
    this.cursor = new GapCursor(floor, { gapTimeoutMs: this.o.gapTimeoutMs, now: this.now });
    this.savedFloor = saved?.lastId;
    this.log.info(resumable ? 'retomando o change feed' : 'seguindo o change feed', {
      floor,
      latest,
      ...(saved ? { saved: saved.lastId } : {}),
    });
    if (this.stopped) return;
    try {
      this.unlisten = await this.store.listen(() => this.notify());
    } catch (err) {
      this.log.warn('LISTEN falhou; sigo pela varredura', { err: String(err) });
    }
    this.interval = setInterval(() => void this.poll(), this.o.pollIntervalMs);
    this.interval.unref?.();
    // retomada: o que mudou enquanto a demo estava fora já entra agora; primeira subida: grava o ponto de partida
    if (resumable && floor < latest) void this.poll();
    else await this.persist(true);
  }

  private async drain(): Promise<void> {
    const cursor = this.cursor!;
    for (;;) {
      const rows = await this.store.readAfter(cursor.floor, cursor.seenIds, this.o.batch);
      const fresh = rows.filter((r) => cursor.isNew(r.id));
      const tags = [...new Set(fresh.flatMap(tagsForChange))];
      if (tags.length) {
        await this.send(tags);
        this.log.info('cache revalidado', { changes: fresh.length, tags: tags.length });
        this.scheduleConfirm(tags);
      }
      cursor.mark(rows.map((r) => r.id));
      if (rows.length < this.o.batch) break;
    }
    cursor.advance();
    await this.persist(false);
  }

  private async send(tags: string[]): Promise<void> {
    for (let i = 0; i < tags.length; i += this.o.chunk)
      await this.revalidate(tags.slice(i, i + this.o.chunk));
  }

  /** Segunda passada das tags que expiram na hora (as coleções do ao vivo já revalidam em segundo plano). */
  private scheduleConfirm(tags: string[]): void {
    const again = tags.filter((t) => !BUSY_TAGS.has(t));
    if (!again.length || this.o.confirmMs <= 0) return;
    const timer = setTimeout(() => {
      this.confirmTimers.delete(timer);
      if (this.stopped) return;
      this.send(again).catch((err) =>
        this.warnThrottled('falha ao revalidar de novo (segunda passada)', err),
      );
    }, this.o.confirmMs);
    timer.unref?.();
    this.confirmTimers.add(timer);
  }

  /** Grava o piso (no máximo a cada `saveEveryMs`, salvo `force`); falha só avisa. */
  private async persist(force: boolean): Promise<void> {
    const floor = this.cursor?.floor;
    if (floor === undefined || floor === this.savedFloor) return;
    if (!force && this.now() - this.savedAt < this.o.saveEveryMs) return;
    try {
      await this.store.saveCursor(this.name, floor);
      this.savedFloor = floor;
      this.savedAt = this.now();
    } catch (err) {
      this.warnThrottled('falha ao salvar o cursor do change feed', err);
    }
  }

  private warnThrottled(msg: string, err: unknown): void {
    const t = this.now();
    if (t - this.lastWarnAt < this.o.warnEveryMs) return;
    this.lastWarnAt = t;
    this.log.warn(msg, { err: String(err) });
  }
}
