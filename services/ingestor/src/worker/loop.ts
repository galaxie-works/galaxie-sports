/**
 * O laço do worker da fila (#542): toma a próxima tarefa dos tipos com vaga, roda cada uma num processo filho com
 * heap fixo (o `runTask` mora no filho, como o CLI de um job do scheduler), renova a concessão daqui do pai a cada
 * 30 s e, no SIGTERM, drena: para de tomar, deixa o lote em andamento fechar (prazo WORKER_DRAIN_S), manda SIGTERM ao
 * filho que não fechou e devolve a tarefa à fila (`release`) com o checkpoint. Contrato da fila: packages/db/README.md.
 *
 * O pai é dono da concessão e o filho, do trabalho: o filho grava o checkpoint e encerra a tomada (`finish` ou
 * `release`, dentro do `runTask`); o pai só encerra quando o filho sai sem dizer o destino (heap estourado, banco fora
 * no fim) e nunca escreve depois de a concessão ter sido perdida. A renovação no pai continua mesmo com o event loop
 * do filho ocupado num lote pesado.
 */
import { QUEUE_LEASE_MS, QUEUE_RENEW_MS, type QueueFinishResult, type QueueTask } from '@galaxie/db/queue';
import type { Logger } from '@galaxie/observability';

/** O destino que o `runTask` do filho devolveu (null: a tomada perdeu a tarefa no caminho). */
export type TaskRunResult = QueueFinishResult | 'released' | null;

/** Mensagens do pai para o filho (IPC). */
export type ParentMessage = { type: 'run'; task: QueueTask } | { type: 'stop' } | { type: 'lease-lost' };

/** Mensagens do filho para o pai (IPC). */
export type ChildMessage = { type: 'result'; result: TaskRunResult } | { type: 'failed'; message: string };

export interface TaskProcessExit {
  /** O que o filho informou; ausente: saiu sem informar (o pai encerra a tomada). */
  result?: TaskRunResult;
  /** O `runTask` do filho lançou (banco fora no `finish`, por exemplo). */
  error?: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

/** O processo filho de uma tarefa, visto do pai. */
export interface TaskProcess {
  /** Resolve quando o filho sai (com o canal IPC fechado: o resultado já chegou). */
  done: Promise<TaskProcessExit>;
  /** Drenagem: o executor para entre dois lotes e o filho devolve a tarefa à fila. */
  stop(): void;
  /** A concessão foi perdida: o filho para no próximo `save`, sem gravar. */
  leaseLost(): void;
  kill(signal: NodeJS.Signals): void;
}

export interface WorkerDeps {
  take(types: readonly string[]): Promise<QueueTask | null>;
  renew(task: QueueTask): Promise<boolean>;
  release(task: QueueTask): Promise<boolean>;
  /** Encerra em erro a tomada cujo filho saiu sem dizer o destino (nova tentativa com backoff). */
  fail(task: QueueTask, detail: string): Promise<QueueFinishResult | null>;
  spawn(task: QueueTask): TaskProcess;
  log: Logger;
  /** Fim de cada tomada, para `worker_task_duration_seconds`. */
  observe?: (type: string, result: string, seconds: number) => void;
  now?: () => number;
}

export interface WorkerOptions {
  workerId: string;
  /** Vagas por tipo; só estes tipos são tomados. */
  concurrency: Readonly<Record<string, number>>;
  maxTasks: number;
  drainMs: number;
  renewMs?: number;
  /** Depois do SIGTERM ao filho, quanto esperar antes do SIGKILL. */
  killGraceMs?: number;
  /** Espera sem tarefa: começa em `idleMinMs` e dobra até `idleMaxMs`. */
  idleMinMs?: number;
  idleMaxMs?: number;
  /** Espera depois de uma falha ao tomar (banco fora). */
  errorBackoffMs?: number;
}

/** Uma tarefa em andamento, como o /health e o painel a descrevem. */
export interface RunningTaskView {
  id: string;
  type: string;
  attempt: number;
  resumedFrom: string | null;
  startedAt: string;
  runningSeconds: number;
  /** Última renovação da concessão bem-sucedida (ou a tomada). */
  lastRenewAt: string;
  lockedUntil: string;
}

export interface WorkerState {
  worker: string;
  idle: boolean;
  draining: boolean;
  /** A primeira tarefa em andamento (o caso comum, uma por vez), ou null. */
  task: RunningTaskView | null;
  tasks: RunningTaskView[];
}

interface Slot {
  task: QueueTask;
  proc: TaskProcess;
  startedAt: number;
  lastRenewAt: number;
  lockedUntil: number;
  /** Renovação devolveu false: outro worker pode ter retomado. O pai não escreve mais nada. */
  lost: boolean;
  /** Pedido de parada já enviado (drenagem). */
  stopped: boolean;
  renewing: boolean;
  timer: NodeJS.Timeout | undefined;
  done: Promise<void>;
}

/**
 * Espera `ms` ou até `wake` ser chamado. O timer segura o processo no ar de propósito: sem tarefa, é a única coisa que
 * segura (o /health tem `unref` e a conexão do banco vence em 30 a 60 min). Sem ele, o Node sai com código 0 e sem log.
 */
function interruptibleSleep(ms: number): { promise: Promise<void>; wake: () => void } {
  let wake = () => {};
  const promise = new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    wake = () => {
      clearTimeout(t);
      resolve();
    };
  });
  return { promise, wake };
}

const settledAll = (ps: Promise<unknown>[]) => Promise.allSettled(ps).then(() => undefined);

export class TaskWorker {
  private readonly slots = new Map<string, Slot>();
  private draining = false;
  private wakeLoop: (() => void) | null = null;
  private loop: Promise<void> | null = null;
  private drained: Promise<void> | null = null;
  private readonly now: () => number;
  private readonly log: Logger;

  constructor(
    private readonly options: WorkerOptions,
    private readonly deps: WorkerDeps,
  ) {
    this.now = deps.now ?? Date.now;
    this.log = deps.log;
  }

  /** Tipos que este worker toma (vaga > 0). */
  get types(): string[] {
    return Object.keys(this.options.concurrency);
  }

  /** Inicia o laço; resolve quando ele para (depois do SIGTERM). Chamar uma vez. */
  start(): Promise<void> {
    this.loop ??= this.run();
    return this.loop;
  }

  get isDraining(): boolean {
    return this.draining;
  }

  /** Tarefas em execução por tipo (os tipos sem nenhuma com 0), para `worker_tasks_running`. */
  runningByType(): Record<string, number> {
    const out: Record<string, number> = Object.fromEntries(this.types.map((t) => [t, 0]));
    for (const s of this.slots.values()) out[s.task.type] = (out[s.task.type] ?? 0) + 1;
    return out;
  }

  state(): WorkerState {
    const tasks = [...this.slots.values()].map((s) => this.view(s));
    return {
      worker: this.options.workerId,
      idle: tasks.length === 0,
      draining: this.draining,
      task: tasks[0] ?? null,
      tasks,
    };
  }

  private view(s: Slot): RunningTaskView {
    return {
      id: s.task.id,
      type: s.task.type,
      attempt: s.task.attempts,
      resumedFrom: s.task.resumedFrom,
      startedAt: new Date(s.startedAt).toISOString(),
      runningSeconds: Math.round((this.now() - s.startedAt) / 1000),
      lastRenewAt: new Date(s.lastRenewAt).toISOString(),
      lockedUntil: new Date(s.lockedUntil).toISOString(),
    };
  }

  /** Tipos com vaga agora (vazio: o teto geral está cheio). */
  private freeTypes(): string[] {
    if (this.slots.size >= this.options.maxTasks) return [];
    const running = this.runningByType();
    return this.types.filter((t) => (running[t] ?? 0) < this.options.concurrency[t]!);
  }

  private async pause(ms: number): Promise<void> {
    if (this.draining) return;
    const { promise, wake } = interruptibleSleep(ms);
    this.wakeLoop = wake;
    await promise;
    this.wakeLoop = null;
  }

  private async run(): Promise<void> {
    const idleMin = this.options.idleMinMs ?? 1000;
    const idleMax = this.options.idleMaxMs ?? 10_000;
    let idle = idleMin;
    while (!this.draining) {
      const types = this.freeTypes();
      if (!types.length) {
        // vagas cheias: acorda quando uma tarefa terminar (ou no SIGTERM)
        await this.pause(idleMax);
        continue;
      }
      let task: QueueTask | null;
      try {
        task = await this.deps.take(types);
      } catch (err) {
        this.log.warn({ err }, 'não foi possível tomar tarefa da fila; tentando de novo');
        await this.pause(this.options.errorBackoffMs ?? 5000);
        continue;
      }
      if (!task) {
        // sem NOTIFY para a fila: espera curta, dobrando até o teto
        await this.pause(idle);
        idle = Math.min(idle * 2, idleMax);
        continue;
      }
      idle = idleMin;
      if (this.draining) {
        // o SIGTERM chegou durante a tomada: devolve na hora, sem começar
        await this.deps
          .release(task)
          .catch((err: unknown) =>
            this.log.warn({ err, task: task.id }, 'não foi possível devolver a tarefa'),
          );
        break;
      }
      this.begin(task);
    }
  }

  private begin(task: QueueTask): void {
    const startedAt = this.now();
    const proc = this.deps.spawn(task);
    const slot: Slot = {
      task,
      proc,
      startedAt,
      lastRenewAt: startedAt,
      lockedUntil: task.lockedUntil.getTime(),
      lost: false,
      stopped: false,
      renewing: false,
      timer: undefined,
      done: Promise.resolve(),
    };
    slot.timer = setInterval(() => void this.renew(slot), this.options.renewMs ?? QUEUE_RENEW_MS);
    slot.timer.unref?.();
    slot.done = proc.done
      .then((exit) => {
        clearInterval(slot.timer);
        return this.settle(slot, exit);
      })
      .catch((err: unknown) => this.log.error({ err, task: task.id }, 'falha ao encerrar a tomada da tarefa'))
      .finally(() => {
        clearInterval(slot.timer);
        this.slots.delete(task.id);
        this.wakeLoop?.();
      });
    this.slots.set(task.id, slot);
    this.log.info(
      {
        task: task.id,
        type: task.type,
        attempt: task.attempts,
        resumed_from: task.resumedFrom,
        retoma: task.checkpoint !== null && task.checkpoint !== undefined,
      },
      'tarefa tomada',
    );
    // drenagem começou entre a tomada e aqui: o filho já nasce parando
    if (this.draining) this.stopSlot(slot);
  }

  private async renew(slot: Slot): Promise<void> {
    if (slot.lost || slot.renewing) return;
    slot.renewing = true;
    try {
      if (await this.deps.renew(slot.task)) {
        slot.lastRenewAt = this.now();
        slot.lockedUntil = slot.lastRenewAt + QUEUE_LEASE_MS;
        return;
      }
      slot.lost = true;
      this.log.warn(
        { task: slot.task.id, type: slot.task.type },
        'concessão da tarefa perdida (outro worker pode ter retomado); parando o processo dela sem gravar',
      );
      slot.proc.leaseLost();
      slot.proc.kill('SIGTERM');
    } catch (err) {
      // a concessão dura 90 s: duas renovações perdidas ainda cabem
      this.log.warn({ err, task: slot.task.id }, 'não foi possível renovar a concessão; tentando de novo');
    } finally {
      slot.renewing = false;
    }
  }

  /** O filho saiu: registra o destino e, se ele não encerrou a tomada, encerra daqui. */
  private async settle(slot: Slot, exit: TaskProcessExit): Promise<void> {
    const { task } = slot;
    let result: string;
    if (exit.result !== undefined) {
      result = exit.result ?? 'lost';
    } else if (slot.lost) {
      result = 'lost';
    } else if (this.draining || slot.stopped) {
      // cortado na drenagem: volta à fila com o checkpoint, sem gastar tentativa
      result = (await this.deps.release(task)) ? 'released' : 'lost';
    } else {
      const why =
        exit.error ??
        `o processo da tarefa terminou sem resultado (código ${exit.exitCode ?? '-'}${exit.signal ? `, sinal ${exit.signal}` : ''})`;
      result = (await this.deps.fail(task, why)) ?? 'lost';
    }
    const seconds = (this.now() - slot.startedAt) / 1000;
    this.deps.observe?.(task.type, result, seconds);
    const fields = {
      task: task.id,
      type: task.type,
      result,
      duration_s: Math.round(seconds),
      exit_code: exit.exitCode,
      ...(exit.signal ? { signal: exit.signal } : {}),
      ...(exit.error ? { error: exit.error } : {}),
    };
    if (result === 'done' || result === 'deferred') this.log.info(fields, 'tarefa encerrada');
    else if (result === 'released') this.log.info(fields, 'tarefa devolvida à fila com o checkpoint');
    else this.log.warn(fields, 'tarefa encerrada sem concluir');
  }

  private stopSlot(slot: Slot): void {
    if (slot.stopped) return;
    slot.stopped = true;
    slot.proc.stop();
  }

  /**
   * SIGTERM: para de tomar, pede ao filho que pare entre dois lotes (o lote em andamento fecha e ele devolve a tarefa)
   * e espera até `drainMs`. Passado o prazo, SIGTERM no filho, SIGKILL depois de `killGraceMs`, e o `release` daqui.
   * Resolve com tudo devolvido ou encerrado e o laço parado.
   */
  drain(): Promise<void> {
    this.drained ??= this.doDrain();
    return this.drained;
  }

  private async doDrain(): Promise<void> {
    this.draining = true;
    this.wakeLoop?.();
    const running = [...this.slots.values()];
    this.log.info(
      {
        worker: this.options.workerId,
        prazo_s: Math.round(this.options.drainMs / 1000),
        tasks: running.map((s) => ({ id: s.task.id, type: s.task.type })),
      },
      running.length
        ? 'drenando: sem tomar tarefas novas; o lote em andamento fecha e a tarefa volta à fila com o checkpoint'
        : 'drenando: sem tarefa em andamento',
    );
    for (const s of running) this.stopSlot(s);
    const pending = () => [...this.slots.values()].map((s) => s.done);
    if (this.slots.size) {
      const deadline = interruptibleSleep(this.options.drainMs);
      await Promise.race([settledAll(pending()), deadline.promise]);
      deadline.wake();
    }
    if (this.slots.size) {
      this.log.warn(
        { tasks: [...this.slots.keys()] },
        'prazo da drenagem acabou com lote em andamento: SIGTERM no processo da tarefa, que volta à fila do último checkpoint',
      );
      for (const s of this.slots.values()) s.proc.kill('SIGTERM');
      const grace = interruptibleSleep(this.options.killGraceMs ?? 5000);
      await Promise.race([settledAll(pending()), grace.promise]);
      grace.wake();
      for (const s of this.slots.values()) s.proc.kill('SIGKILL');
      await settledAll(pending());
    }
    await this.loop;
    this.log.info({ worker: this.options.workerId }, 'drenado: nenhuma tarefa em andamento');
  }
}
