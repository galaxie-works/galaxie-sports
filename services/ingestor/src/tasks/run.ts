/**
 * Executores dos tipos de tarefa da fila (`@galaxie/db/queue-types` declara; aqui roda) e `runTask`, que leva uma
 * tomada do `takeNext` até o `finish`: confere a regra (`checkRunnable`), renova a concessão enquanto o executor
 * trabalha e para sem gravar nada se a tomada perder a tarefa. O laço do worker (#542) toma e chama `runTask`.
 */
import { checkpoint, finish, renew, QUEUE_RENEW_MS, type QueueTask } from '@galaxie/db/queue';
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

/** A tomada perdeu a tarefa (concessão vencida e outro worker retomou): parar sem gravar mais nada. */
export class TaskLeaseLostError extends Error {
  constructor(id: string) {
    super(`tarefa ${id}: a concessão foi perdida`);
    this.name = 'TaskLeaseLostError';
  }
}

export interface TaskContext {
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
}

export interface TaskOutcome {
  detail?: string;
  stats?: Record<string, unknown>;
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
};

/** Os tipos que este worker sabe rodar (o `types` do `takeNext`). */
export const handledTypes = (handlers: Readonly<Record<string, TaskHandler>> = TASK_HANDLERS) =>
  Object.keys(handlers);

/**
 * Roda uma tomada até o fim. Recusa (tipo sem executor, destrutiva sem prévia, params que não conferem) encerra em
 * erro na hora, sem nova tentativa: repetir não muda a resposta. Devolve o destino do `finish`, ou null se a tomada
 * perdeu a tarefa no caminho.
 */
export async function runTask(
  db: Database,
  task: QueueTask,
  options: {
    handlers?: Readonly<Record<string, TaskHandler>>;
    registry?: TaskRegistry;
    renewMs?: number;
  } = {},
): Promise<'done' | 'retry' | 'error' | null> {
  const handlers = options.handlers ?? TASK_HANDLERS;
  const handler = handlers[task.type];
  const refused =
    checkRunnable(task, options.registry ?? TASK_TYPES) ??
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
  try {
    const meta = paramsMeta(task.params);
    const outcome = await handler!({
      task,
      params: ownParams(task.params),
      previa: meta.previa,
      previaId: meta.previaId,
      checkpoint: task.checkpoint,
      save: async (data) => {
        if (lost || !(await checkpoint(db, task, data))) throw new TaskLeaseLostError(task.id);
      },
    });
    if (lost) return null;
    return finish(db, task, 'ok', outcome.detail ?? null, outcome.stats ? { stats: outcome.stats } : {});
  } catch (err) {
    if (err instanceof TaskLeaseLostError || lost) return null;
    return finish(db, task, 'error', err instanceof Error ? err.message : String(err));
  } finally {
    clearInterval(timer);
  }
}
