/**
 * Executores dos tipos de tarefa da fila (`@galaxie/db/queue-types` declara; aqui roda) e `runTask`, que leva uma
 * tomada do `takeNext` até o `finish`: confere a regra (`checkRunnable` e, na destrutiva, a aprovação no banco com `checkApproval`), renova a concessão enquanto o executor
 * trabalha e para sem gravar nada se a tomada perder a tarefa. O laço do worker (#542) toma e chama `runTask`.
 */
import { checkpoint, finish, release, renew, QUEUE_RENEW_MS, type QueueTask } from '@galaxie/db/queue';
import {
  appendLog,
  checkRunnable,
  ownParams,
  paramsMeta,
  readProgress,
  TASK_TYPES,
  type TaskRegistry,
} from '@galaxie/db/queue-types';
import type { Database } from '@galaxie/db';
import { checkApproval } from '@galaxie/db/queue-admin';
import { acervoImportar } from './acervo.js';
import { TaskInterruptedError, TaskRefusedError } from './errors.js';
import { backfillNormalizar, backfillTabelas } from './backfill.js';
import { cargaHistorica } from './carga.js';
import { assetsEspelhar } from './espelho.js';

export { TaskInterruptedError, TaskRefusedError };

/** A tomada perdeu a tarefa (concessão vencida e outro worker retomou): parar sem gravar mais nada. */
export class TaskLeaseLostError extends Error {
  constructor(id: string) {
    super(`tarefa ${id}: a concessão foi perdida`);
    this.name = 'TaskLeaseLostError';
  }
}

export interface TaskContext {
  db: Database;
  task: QueueTask;
  /** Os params do tipo (sem as chaves reservadas), já validados pelo schema. */
  params: Record<string, unknown>;
  /** Rodar em prévia: contar e amostrar o que mudaria, sem mudar nada; o plano vai em `checkpoint.previa`. */
  previa: boolean;
  /** Execução aprovada: id da prévia que a autorizou. */
  previaId: string | null;
  /** Checkpoint da tomada anterior (null na primeira). */
  checkpoint: unknown;
  /** Grava o progresso (substitui o anterior). Lança TaskLeaseLostError se a tomada perdeu a tarefa. */
  save: (data: unknown) => Promise<void>;
  /** Encerramento do worker (SIGTERM): o executor confere entre os lotes. */
  signal: AbortSignal;
  /** Entre dois lotes: lança TaskInterruptedError se o worker está encerrando. */
  checkStop: () => void;
}

export interface TaskOutcome {
  detail?: string;
  stats?: Record<string, unknown>;
  /**
   * A tarefa não acabou e só continua depois deste instante (cota do dia esgotada, CDN pedindo pausa): volta à fila
   * com o checkpoint, sem gastar tentativa e sem falhar.
   */
  runAfter?: Date;
}

export type TaskHandler = (ctx: TaskContext) => Promise<TaskOutcome>;

/** Exemplo (`exemplo.eco`): um lote por repetição, checkpoint a cada lote; retoma do último lote gravado. */
export const exemploEco: TaskHandler = async ({ params, previa, checkpoint: from, save }) => {
  const mensagem = String(params.mensagem);
  const repeticoes = Number(params.repeticoes);
  if (previa) {
    await save({
      previa: {
        resumo: `Devolveria "${mensagem}" em ${repeticoes} lote(s). Nenhum dado muda.`,
        contagens: { lotes: repeticoes },
        amostra: [mensagem],
      },
      log: [`prévia: ${repeticoes} lote(s)`],
    });
    return { detail: 'prévia pronta', stats: { lotes: repeticoes } };
  }
  let cp = from;
  for (let i = readProgress(cp)?.feitos ?? 0; i < repeticoes; i++) {
    const next = {
      progresso: { feitos: i + 1, total: repeticoes, lote: `lote ${i + 1}` },
      log: appendLog(cp, `lote ${i + 1}/${repeticoes}: ${mensagem}`),
    };
    await save(next);
    cp = next;
  }
  return { detail: `eco: ${mensagem} (${repeticoes} lote(s))`, stats: { lotes: repeticoes } };
};

export const TASK_HANDLERS: Readonly<Record<string, TaskHandler>> = {
  'exemplo.eco': exemploEco,
  'acervo.importar': acervoImportar(),
  'assets.espelhar': assetsEspelhar(),
  'carga.historica': cargaHistorica(),
  'backfill.normalizar': backfillNormalizar(),
  'backfill.tabelas': backfillTabelas(),
};

/** Os tipos que este worker sabe rodar (o `types` do `takeNext`). */
export const handledTypes = (handlers: Readonly<Record<string, TaskHandler>> = TASK_HANDLERS) =>
  Object.keys(handlers);

/**
 * Roda uma tomada até o fim. Recusa (tipo sem executor, destrutiva sem prévia, params que não conferem) encerra em
 * erro na hora, sem nova tentativa: repetir não muda a resposta. Devolve o destino do `finish` (`deferred` quando o
 * executor pediu para continuar depois), `released` quando o `signal` interrompeu entre dois lotes, ou null se a
 * tomada perdeu a tarefa no caminho.
 */
export async function runTask(
  db: Database,
  task: QueueTask,
  options: {
    handlers?: Readonly<Record<string, TaskHandler>>;
    registry?: TaskRegistry;
    renewMs?: number;
    /** Encerramento do worker (SIGTERM): o executor para entre os lotes e a tarefa volta à fila. */
    signal?: AbortSignal;
  } = {},
): Promise<'done' | 'retry' | 'error' | 'deferred' | 'released' | null> {
  const handlers = options.handlers ?? TASK_HANDLERS;
  const handler = handlers[task.type];
  const registry = options.registry ?? TASK_TYPES;
  const refused =
    checkRunnable(task, registry) ??
    (await checkApproval(db, task, registry)) ??
    (handler ? null : `este worker não roda ${task.type}`);
  if (refused) return finish(db, { ...task, attempts: task.maxAttempts }, 'error', refused);

  let lost = false;
  const timer = setInterval(() => {
    renew(db, task)
      .then((ok) => {
        if (!ok) lost = true;
      })
      .catch(() => {});
  }, options.renewMs ?? QUEUE_RENEW_MS);
  const signal = options.signal ?? new AbortController().signal;
  try {
    const meta = paramsMeta(task.params);
    const outcome = await handler!({
      db,
      task,
      params: ownParams(task.params),
      previa: meta.previa,
      previaId: meta.previaId,
      checkpoint: task.checkpoint,
      save: async (data) => {
        if (lost || !(await checkpoint(db, task, data))) throw new TaskLeaseLostError(task.id);
      },
      signal,
      checkStop: () => {
        if (signal.aborted) throw new TaskInterruptedError(task.id);
      },
    });
    if (lost) return null;
    return finish(db, task, 'ok', outcome.detail ?? null, {
      ...(outcome.stats ? { stats: outcome.stats } : {}),
      ...(outcome.runAfter ? { runAfter: outcome.runAfter } : {}),
    });
  } catch (err) {
    if (err instanceof TaskLeaseLostError || lost) return null;
    // o encerramento interrompeu entre dois lotes (ou o executor parou no meio de um, pelo signal): devolve sem culpa
    if (err instanceof TaskInterruptedError || signal.aborted)
      return (await release(db, task)) ? 'released' : null;
    if (err instanceof TaskRefusedError)
      return finish(db, { ...task, attempts: task.maxAttempts }, 'error', err.message);
    return finish(db, task, 'error', err instanceof Error ? err.message : String(err));
  } finally {
    clearInterval(timer);
  }
}
