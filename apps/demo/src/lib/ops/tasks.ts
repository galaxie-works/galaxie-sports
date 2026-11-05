/**
 * Tarefas da fila no painel (Ajustes → Sistema → Tarefas), só no servidor: lista, detalhe e os tipos para o
 * formulário, pelas mesmas funções da CLI `gs tarefa` (`@galaxie/db/queue-admin`), com um cliente Drizzle pequeno
 * só para elas (como o do Builder). Tudo sai serializável (datas em ISO) e sem as chaves reservadas dos params.
 */
import { createDb, type Database } from '@galaxie/db/client';
import {
  awaitingApproval,
  getTask,
  listTasks,
  taskState,
  type TaskDetail,
  type TaskRow,
} from '@galaxie/db/queue-admin';
import {
  ownParams,
  paramFields,
  paramsMeta,
  readLog,
  readPreview,
  readProgress,
  TASK_TYPES,
  taskType,
} from '@galaxie/db/queue-types';

import type { OpsTasks, TaskDetailView, TaskListItem, TaskTypeView } from './types';

declare global {
  var __galaxieOpsQueueDb: Database | undefined;
}

const url = process.env.DEMO_DATABASE_URL ?? process.env.DATABASE_URL;

/** Conexão das operações da fila (uma por processo; o dev server recarrega módulos). */
export function queueDb(): Database {
  if (!url) throw new Error('DEMO_DATABASE_URL/DATABASE_URL não definido: a fila precisa do banco.');
  globalThis.__galaxieOpsQueueDb ??= createDb(url, {
    max: 2,
    profile: 'api',
    applicationName: 'galaxie-demo-tasks',
  });
  return globalThis.__galaxieOpsQueueDb;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Quantas o painel lista (as mais recentes); o resto, `gs tarefa listar`. */
export const TASKS_LIMIT = 100;

export function toTaskItem(row: TaskRow): TaskListItem {
  const meta = paramsMeta(row.params);
  const progress = readProgress(row.checkpoint);
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    state: taskState(row),
    previa: meta.previa,
    awaitingApproval: awaitingApproval(row),
    previaId: meta.previaId,
    reprocessaDe: meta.reprocessaDe,
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    lockedBy: row.lockedBy,
    lockedUntil: iso(row.lockedUntil),
    requestedBy: row.requestedBy,
    requestedAt: row.requestedAt.toISOString(),
    finishedAt: iso(row.finishedAt),
    progress: progress
      ? { feitos: progress.feitos, total: progress.total ?? null, lote: progress.lote ?? null }
      : null,
    detail: row.detail,
    lastError: row.lastError,
  };
}

const link = (l: TaskDetail['approvals'][number]) => ({
  id: l.id,
  status: l.status,
  requestedBy: l.requestedBy,
  requestedAt: l.requestedAt.toISOString(),
});

export function toTaskDetail(task: TaskDetail): TaskDetailView {
  const item = toTaskItem(task);
  const preview = readPreview(task.checkpoint);
  return {
    ...item,
    destrutiva: taskType(task.type)?.destrutiva ?? false,
    params: ownParams(task.params),
    checkpoint: task.checkpoint,
    preview: preview
      ? { resumo: preview.resumo ?? null, contagens: preview.contagens, amostra: preview.amostra }
      : null,
    log: readLog(task.checkpoint),
    runs: task.runs.map((r) => {
      const stats = r.stats && typeof r.stats === 'object' ? (r.stats as Record<string, unknown>) : {};
      return {
        id: r.id,
        status: r.status,
        startedAt: r.startedAt.toISOString(),
        finishedAt: iso(r.finishedAt),
        error: r.error,
        resumed: Boolean(r.resumedFrom),
        worker: typeof stats.worker === 'string' ? stats.worker : null,
      };
    }),
    approvals: task.approvals.map(link),
    reprocesses: task.reprocesses.map(link),
  };
}

export function taskTypesView(): TaskTypeView[] {
  return TASK_TYPES.map((d) => ({
    type: d.type,
    descricao: d.descricao,
    previa: d.previa,
    destrutiva: d.destrutiva,
    fields: paramFields(d),
  }));
}

/**
 * A lista do painel (a prévia já aprovada vem marcada pela consulta, `approved`). Sem as colunas da fila (migration
 * pendente), null: o resto do painel continua.
 */
export async function readTasks(db: Database = queueDb()): Promise<Omit<OpsTasks, 'workers'> | null> {
  let rows: TaskRow[];
  try {
    rows = await listTasks(db, { limit: TASKS_LIMIT });
  } catch (err) {
    const code =
      (err as { code?: string; cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;
    if (code === '42P01' || code === '42703') return null;
    throw err;
  }
  return { items: rows.map(toTaskItem), types: taskTypesView() };
}

/** Detalhe de uma tarefa (o painel pede ao abrir). */
export async function readTask(id: string, db: Database = queueDb()): Promise<TaskDetailView> {
  return toTaskDetail(await getTask(db, id));
}
