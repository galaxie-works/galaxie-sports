/**
 * Operação da fila por gente (CLI `gs tarefa` e painel Ajustes → Sistema → Tarefas): enfileirar validando pelo
 * registro de tipos, listar, ver, cancelar, reprocessar e aprovar a prévia. O worker usa `@galaxie/db/queue`; isto
 * aqui é o outro lado da fila, e as duas interfaces chamam as mesmas funções para a regra ser uma só.
 *
 * Prévia com aprovação (a ferramenta sinaliza, uma pessoa decide): a prévia é uma tarefa comum com `params.previa`;
 * o worker grava o plano em `checkpoint.previa`. Aprovar enfileira a execução de verdade com `params.previaId`.
 * Tipo `destrutiva` nunca entra direto: só em prévia.
 */
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { enqueue } from './queue.js';
import {
  RESERVED_PARAMS,
  TASK_TYPES,
  ownParams,
  paramsMeta,
  parseParams,
  readPreview,
  taskType,
  type TaskRegistry,
} from './queue-types.js';
import { jobRequest, jobRun } from './schema/ops.js';

/** Estados de uma tarefa no banco. `canceled` só vem do `cancelTask` (só pendente). */
export const TASK_STATUSES = ['pending', 'running', 'done', 'error', 'canceled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export type TaskErrorCode =
  | 'tipo_desconhecido'
  | 'params_invalidos'
  | 'param_reservado'
  | 'previa_obrigatoria'
  | 'sem_previa'
  | 'nao_encontrada'
  | 'nao_pendente'
  | 'nao_encerrada'
  | 'nao_e_previa'
  | 'previa_nao_concluida'
  | 'previa_sem_resultado'
  | 'ja_aprovada';

/** Recusa da operação. `message` em pt-BR para a CLI; o painel traduz pelo `code`. */
export class TaskError extends Error {
  constructor(
    readonly code: TaskErrorCode,
    message: string,
    /** params_invalidos: um problema por campo. ja_aprovada: id da execução que já existe. */
    readonly details: string[] = [],
  ) {
    super(message);
    this.name = 'TaskError';
  }
}

export interface TaskRow {
  id: string;
  type: string;
  status: string;
  params: unknown;
  priority: number;
  attempts: number;
  maxAttempts: number;
  checkpoint: unknown;
  lockedBy: string | null;
  lockedUntil: Date | null;
  runAfter: Date | null;
  requestedBy: string;
  requestedAt: Date;
  pickedAt: Date | null;
  finishedAt: Date | null;
  runId: string | null;
  detail: string | null;
  lastError: string | null;
}

export interface TaskRunRow {
  id: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  error: string | null;
  resumedFrom: string | null;
  stats: unknown;
}

export interface TaskDetail extends TaskRow {
  /** Tomadas desta tarefa (ops.job_run com `request_id`), da primeira à última. */
  runs: TaskRunRow[];
  /** Execuções aprovadas desta prévia (`params.previaId` = esta). */
  approvals: Pick<TaskRow, 'id' | 'status' | 'requestedBy' | 'requestedAt'>[];
  /** Tarefas que reprocessam esta (`params.reprocessaDe` = esta). */
  reprocesses: Pick<TaskRow, 'id' | 'status' | 'requestedBy' | 'requestedAt'>[];
}

/**
 * Estado para gente: o do banco, com a retomada separada. Pendente que já foi tomada (tem `run_id`) volta do
 * checkpoint: concessão vencida, `release` do deploy ou nova tentativa depois de erro.
 */
export type TaskState = 'pendente' | 'retomada' | 'rodando' | 'concluida' | 'falha' | 'cancelada' | 'outro';

export function taskState(row: Pick<TaskRow, 'status' | 'runId'>): TaskState {
  switch (row.status) {
    case 'pending':
      return row.runId ? 'retomada' : 'pendente';
    case 'running':
      return 'rodando';
    case 'done':
      return 'concluida';
    case 'error':
      return 'falha';
    case 'canceled':
      return 'cancelada';
    default:
      return 'outro';
  }
}

/** Prévia concluída, com plano gravado, esperando alguém aprovar (o painel destaca). */
export function awaitingApproval(row: Pick<TaskRow, 'status' | 'params' | 'checkpoint'>): boolean {
  return row.status === 'done' && paramsMeta(row.params).previa && readPreview(row.checkpoint) !== null;
}

const taskColumns = {
  id: jobRequest.id,
  type: jobRequest.type,
  status: jobRequest.status,
  params: jobRequest.params,
  priority: jobRequest.priority,
  attempts: jobRequest.attempts,
  maxAttempts: jobRequest.maxAttempts,
  checkpoint: jobRequest.checkpoint,
  lockedBy: jobRequest.lockedBy,
  lockedUntil: jobRequest.lockedUntil,
  runAfter: jobRequest.runAfter,
  requestedBy: jobRequest.requestedBy,
  requestedAt: jobRequest.requestedAt,
  pickedAt: jobRequest.pickedAt,
  finishedAt: jobRequest.finishedAt,
  runId: jobRequest.runId,
  detail: jobRequest.detail,
  lastError: jobRequest.lastError,
};

const asTask = (row: Omit<TaskRow, 'type'> & { type: string | null }): TaskRow => ({
  ...row,
  type: row.type!,
});

function definition(type: string, registry: TaskRegistry) {
  const def = taskType(type, registry);
  if (!def)
    throw new TaskError(
      'tipo_desconhecido',
      `Tipo de tarefa desconhecido: ${type}. Conhecidos: ${registry.map((d) => d.type).join(', ')}.`,
    );
  return def;
}

function validParams(type: string, params: unknown, registry: TaskRegistry) {
  const parsed = parseParams(definition(type, registry), params);
  if (!parsed.ok)
    throw new TaskError(
      'params_invalidos',
      `Parâmetros inválidos para ${type}: ${parsed.issues.join('; ')}.`,
      parsed.issues,
    );
  return parsed.value;
}

export interface RequestTaskInput {
  type: string;
  /** Só os do tipo (validados pelo schema); as chaves reservadas são recusadas. */
  params?: Record<string, unknown>;
  priority?: number;
  /** Roda em prévia: conta e amostra o que mudaria, sem mudar nada. Obrigatório no tipo destrutivo. */
  previa?: boolean;
  /** Quem pediu: e-mail do admin no painel, `cli:<usuário>` na CLI. */
  requestedBy: string;
}

/** Enfileira uma tarefa pedida por gente, validada pelo registro. Tipo destrutivo só em prévia. */
export async function requestTask(
  db: Database,
  input: RequestTaskInput,
  registry: TaskRegistry = TASK_TYPES,
): Promise<{ id: string; previa: boolean }> {
  const def = definition(input.type, registry);
  const reserved = Object.keys(input.params ?? {}).filter((k) =>
    (RESERVED_PARAMS as readonly string[]).includes(k),
  );
  if (reserved.length)
    throw new TaskError(
      'param_reservado',
      `${reserved.join(', ')} é preenchido pelo sistema: use --previa para a prévia e a aprovação para a execução.`,
    );
  const params = validParams(def.type, input.params ?? {}, registry);
  const previa = input.previa === true;
  if (def.destrutiva && !previa)
    throw new TaskError(
      'previa_obrigatoria',
      `${def.type} apaga, troca ou religa dados: enfileire em prévia (--previa) e aprove a execução depois.`,
    );
  if (previa && !def.previa) throw new TaskError('sem_previa', `${def.type} não tem modo prévia.`);
  const { id } = await enqueue(db, {
    type: def.type,
    params: previa ? { ...params, previa: true } : params,
    priority: input.priority ?? 0,
    requestedBy: input.requestedBy,
    ...(def.maxAttempts ? { maxAttempts: def.maxAttempts } : {}),
  });
  return { id, previa };
}

export interface ListTasksOptions {
  status?: readonly string[];
  type?: string;
  limit?: number;
}

/** Tarefas da fila, mais recentes primeiro. */
export async function listTasks(db: Database, options: ListTasksOptions = {}): Promise<TaskRow[]> {
  const rows = await db
    .select(taskColumns)
    .from(jobRequest)
    .where(
      and(
        isNotNull(jobRequest.type),
        options.status?.length ? inArray(jobRequest.status, [...options.status]) : undefined,
        options.type ? eq(jobRequest.type, options.type) : undefined,
      ),
    )
    .orderBy(desc(jobRequest.requestedAt), desc(jobRequest.id))
    .limit(options.limit ?? 50);
  return rows.map(asTask);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findTask(db: Database, id: string): Promise<TaskRow> {
  const [row] = UUID_RE.test(id)
    ? await db
        .select(taskColumns)
        .from(jobRequest)
        .where(and(eq(jobRequest.id, id), isNotNull(jobRequest.type)))
    : [];
  if (!row) throw new TaskError('nao_encontrada', `Tarefa ${id} não encontrada.`);
  return asTask(row);
}

const linkColumns = {
  id: jobRequest.id,
  status: jobRequest.status,
  requestedBy: jobRequest.requestedBy,
  requestedAt: jobRequest.requestedAt,
};

/** A tarefa com as tomadas, as aprovações (se é prévia) e os reprocessamentos. */
export async function getTask(db: Database, id: string): Promise<TaskDetail> {
  const task = await findTask(db, id);
  const linked = (key: 'previaId' | 'reprocessaDe') =>
    db
      .select(linkColumns)
      .from(jobRequest)
      .where(and(eq(jobRequest.type, task.type), sql`${jobRequest.params} ->> ${key} = ${id}`))
      .orderBy(asc(jobRequest.requestedAt));
  const [runs, approvals, reprocesses] = await Promise.all([
    db
      .select({
        id: jobRun.id,
        status: jobRun.status,
        startedAt: jobRun.startedAt,
        finishedAt: jobRun.finishedAt,
        error: jobRun.error,
        resumedFrom: jobRun.resumedFrom,
        stats: jobRun.stats,
      })
      .from(jobRun)
      .where(eq(jobRun.requestId, id))
      .orderBy(asc(jobRun.startedAt)),
    linked('previaId'),
    linked('reprocessaDe'),
  ]);
  return { ...task, runs, approvals, reprocesses };
}

/** Cancela a tarefa pendente (inclusive a que espera retomar). A que está rodando não: o worker é dono dela. */
export async function cancelTask(db: Database, id: string, by: string): Promise<void> {
  const task = await findTask(db, id);
  const rows = await db
    .update(jobRequest)
    .set({
      status: 'canceled',
      finishedAt: sql`now()`,
      detail: `cancelada por ${by}`,
      lockedBy: null,
      lockedUntil: null,
    })
    .where(and(eq(jobRequest.id, task.id), eq(jobRequest.status, 'pending')))
    .returning({ id: jobRequest.id });
  if (!rows.length)
    throw new TaskError(
      'nao_pendente',
      `Só a tarefa pendente pode ser cancelada (${id} está ${task.status}).`,
    );
}

/**
 * Tarefa nova com os mesmos params, ligada à original (`params.reprocessaDe`). Só de tarefa encerrada. A execução
 * aprovada de um tipo destrutivo volta como prévia: o plano antigo pode não valer mais, e a pessoa aprova de novo.
 */
export async function reprocessTask(
  db: Database,
  id: string,
  by: string,
  registry: TaskRegistry = TASK_TYPES,
): Promise<{ id: string; previa: boolean }> {
  const task = await findTask(db, id);
  if (task.status === 'pending' || task.status === 'running')
    throw new TaskError(
      'nao_encerrada',
      `A tarefa ${id} ainda está ${task.status}: espere encerrar ou cancele.`,
    );
  const def = definition(task.type, registry);
  const params = validParams(task.type, ownParams(task.params), registry);
  const meta = paramsMeta(task.params);
  const previa = meta.previa || def.destrutiva;
  const { id: created } = await enqueue(db, {
    type: task.type,
    params: { ...params, ...(previa ? { previa: true } : {}), reprocessaDe: task.id },
    priority: task.priority,
    requestedBy: by,
    ...(def.maxAttempts ? { maxAttempts: def.maxAttempts } : {}),
  });
  return { id: created, previa };
}

/**
 * Aprova a prévia concluída: enfileira a execução de verdade com os mesmos params e `previaId`. Uma aprovação por
 * prévia (duas pessoas clicando juntas criam uma só); para repetir, reprocesse.
 */
export async function approvePreview(
  db: Database,
  previewId: string,
  by: string,
  registry: TaskRegistry = TASK_TYPES,
): Promise<{ id: string }> {
  const preview = await findTask(db, previewId);
  if (!paramsMeta(preview.params).previa)
    throw new TaskError('nao_e_previa', `A tarefa ${previewId} não é uma prévia.`);
  if (preview.status !== 'done')
    throw new TaskError(
      'previa_nao_concluida',
      `A prévia ${previewId} está ${preview.status}: só a concluída pode ser aprovada.`,
    );
  if (!readPreview(preview.checkpoint))
    throw new TaskError(
      'previa_sem_resultado',
      `A prévia ${previewId} não gravou o plano (checkpoint.previa).`,
    );
  const [existing] = await db
    .select({ id: jobRequest.id })
    .from(jobRequest)
    .where(and(eq(jobRequest.type, preview.type), sql`${jobRequest.params} ->> 'previaId' = ${previewId}`))
    .limit(1);
  if (existing)
    throw new TaskError('ja_aprovada', `A prévia ${previewId} já foi aprovada (${existing.id}).`, [
      existing.id,
    ]);
  const def = definition(preview.type, registry);
  const params = validParams(preview.type, ownParams(preview.params), registry);
  const { id, created } = await enqueue(db, {
    type: preview.type,
    params: { ...params, previaId: preview.id },
    priority: preview.priority,
    requestedBy: by,
    dedupeKey: `previa:${preview.id}`,
    ...(def.maxAttempts ? { maxAttempts: def.maxAttempts } : {}),
  });
  if (!created) throw new TaskError('ja_aprovada', `A prévia ${previewId} já foi aprovada (${id}).`, [id]);
  return { id };
}
