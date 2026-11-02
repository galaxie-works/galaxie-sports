/**
 * Fila de tarefas no Postgres (ops.job_request com `type`): trabalho longo que precisa sobreviver à troca de
 * contêiner. Um worker toma a tarefa com uma concessão de prazo curto, renova enquanto trabalha e grava o
 * checkpoint; se morre, a concessão vence e outro worker retoma do checkpoint. Contrato e ciclo de vida:
 * packages/db/README.md.
 *
 * Cada tomada abre uma linha em ops.job_run, e o id dela é a prova da posse: `renew`, `checkpoint`, `finish` e
 * `release` só valem para a tomada corrente. O worker que travou, perdeu a concessão e voltou recebe `false`/`null`
 * e precisa parar, em vez de sobrescrever o trabalho de quem retomou.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { jobRequest, jobRun } from './schema/ops.js';

/** Prazo da concessão: sem renovar por este tempo, a tarefa fica livre para outro worker. */
export const QUEUE_LEASE_MS = 90_000;
/** Intervalo de renovação do worker (três renovações cabem no prazo: uma falha de rede não perde a tarefa). */
export const QUEUE_RENEW_MS = 30_000;

/**
 * Prefixo do `job` de uma tarefa da fila. A coluna continua obrigatória e é onde o scheduler procura os pedidos de
 * "rodar agora": com o prefixo, nem a expiração e o `claimJobRequests` nem o fechamento de órfãos da volta do
 * scheduler alcançam uma tarefa, mesmo que o `type` tenha o nome de um job agendado.
 */
export const QUEUE_JOB_PREFIX = 'fila:';

const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 3_600_000;

/** Espera até a próxima tentativa, depois de `attempts` tentativas: 30 s, 1 min, 2 min… até 1 h. */
export function queueBackoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(attempts - 1, 0), BACKOFF_MAX_MS);
}

export interface EnqueueInput {
  type: string;
  params?: unknown;
  /** Maior sai primeiro. Padrão 0. */
  priority?: number;
  /** Não tomar antes disto. Padrão: agora. */
  runAfter?: Date;
  /** Enquanto houver tarefa viva (pendente ou em execução) deste tipo com esta chave, não cria outra. */
  dedupeKey?: string;
  /** Padrão 3. Tarefa longa, que pode ser derrubada várias vezes sem culpa, pede mais. */
  maxAttempts?: number;
  /** Quem pediu (painel: e-mail do admin). Padrão `system`. */
  requestedBy?: string;
}

export interface EnqueueResult {
  id: string;
  /** false: já havia tarefa viva com a mesma chave, e `id` é a dela. */
  created: boolean;
}

/** Uma tomada: o que o worker recebe do `takeNext` e passa de volta em cada operação. */
export interface QueueTask {
  id: string;
  type: string;
  params: unknown;
  priority: number;
  /** Contando esta tentativa. */
  attempts: number;
  maxAttempts: number;
  /** Progresso da tomada anterior (null na primeira). */
  checkpoint: unknown;
  workerId: string;
  /** ops.job_run desta tomada: a prova da posse. */
  runId: string;
  /** ops.job_run interrompido que esta tomada retoma (null na primeira e na nova tentativa depois de um erro). */
  resumedFrom: string | null;
  lockedUntil: Date;
}

export type QueueLease = Pick<QueueTask, 'id' | 'runId' | 'attempts' | 'maxAttempts'>;

const lease = (ms: number) => sql`now() + make_interval(secs => ${ms / 1000}::double precision)`;

/** A tomada ainda é dona da tarefa: ninguém retomou, nem ela foi encerrada. */
const owned = (task: QueueLease) =>
  and(eq(jobRequest.id, task.id), eq(jobRequest.runId, task.runId), eq(jobRequest.status, 'running'));

/** Põe a tarefa na fila. Idempotente pela `dedupeKey`, quando há. */
export async function enqueue(
  db: Pick<Database, 'insert' | 'select'>,
  input: EnqueueInput,
): Promise<EnqueueResult> {
  const values = {
    job: `${QUEUE_JOB_PREFIX}${input.type}`,
    requestedBy: input.requestedBy ?? 'system',
    type: input.type,
    params: input.params ?? null,
    priority: input.priority ?? 0,
    maxAttempts: input.maxAttempts ?? 3,
    runAfter: input.runAfter ?? sql`now()`,
    dedupeKey: input.dedupeKey ?? null,
  };
  // a tarefa viva pode encerrar entre o conflito e a leitura: aí a chave ficou livre, e tenta de novo
  for (let i = 0; i < 3; i++) {
    const [row] = await db
      .insert(jobRequest)
      .values(values)
      .onConflictDoNothing({
        target: [jobRequest.type, jobRequest.dedupeKey],
        where: sql`dedupe_key is not null and status in ('pending', 'running')`,
      })
      .returning({ id: jobRequest.id });
    if (row) return { id: row.id, created: true };
    const [live] = await db
      .select({ id: jobRequest.id })
      .from(jobRequest)
      .where(
        and(
          eq(jobRequest.type, input.type),
          eq(jobRequest.dedupeKey, input.dedupeKey!),
          sql`${jobRequest.status} in ('pending', 'running')`,
        ),
      );
    if (live) return { id: live.id, created: false };
  }
  throw new Error(`Não consegui enfileirar a tarefa ${input.type} (${input.dedupeKey}).`);
}

const LEASE_LOST = 'concessão vencida na última tentativa';

/**
 * Concessões vencidas dos tipos deste worker: a execução fecha como `interrupted` e a tarefa volta a pendente com o
 * checkpoint. Só a tomada que já gastou a última tentativa encerra em erro: um worker que cai sempre na mesma tarefa
 * não pode derrubar a fila para sempre.
 */
const reclaimExpired = (types: readonly string[]) => sql`
  with expired as (
    select id, run_id, attempts >= max_attempts as exhausted
      from ops.job_request
     where status = 'running' and type in ${[...types]} and locked_until < now()
       for update skip locked
  ), reclaimed as (
    update ops.job_request r
       set status = case when e.exhausted then 'error' else 'pending' end,
           finished_at = case when e.exhausted then now() end,
           detail = case when e.exhausted then ${LEASE_LOST} else r.detail end,
           last_error = case when e.exhausted then ${LEASE_LOST} else r.last_error end,
           locked_by = null,
           locked_until = null,
           run_after = now()
      from expired e
     where r.id = e.id
    returning e.run_id, e.exhausted
  )
  update ops.job_run j
     set status = case when c.exhausted then 'error' else 'interrupted' end,
         error = case when c.exhausted then ${LEASE_LOST} end,
         finished_at = now(),
         stats = coalesce(j.stats, '{}'::jsonb) || '{"interrupted": true}'::jsonb
    from reclaimed c
   where j.id = c.run_id and j.status = 'running'`;

/**
 * Toma a próxima tarefa pronta dos `types`, por prioridade e `run_after`: SKIP LOCKED faz dois workers nunca
 * pegarem a mesma. Devolve null se não há nada. Abre a execução em ops.job_run (`job` = tipo da tarefa, para as
 * métricas e o alerta de falhas de job valerem aqui também).
 */
export async function takeNext(
  db: Pick<Database, 'transaction'>,
  workerId: string,
  types: readonly string[],
  options: { leaseMs?: number } = {},
): Promise<QueueTask | null> {
  if (!types.length) return null;
  return db.transaction(async (tx) => {
    await tx.execute(reclaimExpired(types));
    const [next] = await tx.execute<{
      id: string;
      type: string;
      params: unknown;
      priority: number;
      attempts: number;
      max_attempts: number;
      checkpoint: unknown;
      resumed_from: string | null;
    }>(sql`
      select r.id, r.type, r.params, r.priority, r.attempts, r.max_attempts, r.checkpoint,
             case when p.status = 'interrupted' then p.id end as resumed_from
        from ops.job_request r
        left join ops.job_run p on p.id = r.run_id
       where r.status = 'pending' and r.type is not null and r.type in ${[...types]} and r.run_after <= now()
       order by r.priority desc, r.run_after, r.id
       limit 1
         for update of r skip locked`);
    if (!next) return null;
    const attempts = next.attempts + 1;
    const [run] = await tx
      .insert(jobRun)
      .values({
        job: next.type,
        status: 'running',
        requestId: next.id,
        resumedFrom: next.resumed_from,
        stats: { worker: workerId, attempt: attempts },
      })
      .returning({ id: jobRun.id });
    const [taken] = await tx
      .update(jobRequest)
      .set({
        status: 'running',
        pickedAt: sql`now()`,
        attempts,
        lockedBy: workerId,
        lockedUntil: lease(options.leaseMs ?? QUEUE_LEASE_MS),
        runId: run!.id,
      })
      .where(eq(jobRequest.id, next.id))
      .returning({ lockedUntil: jobRequest.lockedUntil });
    return {
      id: next.id,
      type: next.type,
      params: next.params,
      priority: next.priority,
      attempts,
      maxAttempts: next.max_attempts,
      checkpoint: next.checkpoint,
      workerId,
      runId: run!.id,
      resumedFrom: next.resumed_from,
      lockedUntil: taken!.lockedUntil!,
    };
  });
}

/** Renova a concessão (a cada QUEUE_RENEW_MS). false: a tomada perdeu a tarefa, e o worker precisa parar. */
export async function renew(
  db: Pick<Database, 'update'>,
  task: QueueLease,
  options: { leaseMs?: number } = {},
): Promise<boolean> {
  const rows = await db
    .update(jobRequest)
    .set({ lockedUntil: lease(options.leaseMs ?? QUEUE_LEASE_MS) })
    .where(owned(task))
    .returning({ id: jobRequest.id });
  return rows.length > 0;
}

/** Grava o progresso (substitui o anterior). false: a tomada perdeu a tarefa, e o worker precisa parar. */
export async function checkpoint(
  db: Pick<Database, 'update'>,
  task: QueueLease,
  data: unknown,
): Promise<boolean> {
  const rows = await db
    .update(jobRequest)
    .set({ checkpoint: data })
    .where(owned(task))
    .returning({ id: jobRequest.id });
  return rows.length > 0;
}

/** Destino da tarefa depois do `finish`: `retry` volta a pendente com backoff; null, a tomada já tinha perdido a tarefa. */
export type QueueFinishResult = 'done' | 'retry' | 'error';

export interface QueueRunResult {
  callsSpent?: number;
  stats?: Record<string, unknown>;
}

/**
 * Encerra a tomada. `ok` conclui. `error` agenda nova tentativa com backoff, mantendo o checkpoint, ou encerra em
 * erro se era a última (`attempts` = `max_attempts`). A execução em ops.job_run fecha junto.
 */
export async function finish(
  db: Pick<Database, 'transaction'>,
  task: QueueLease,
  outcome: 'ok' | 'error',
  detail?: string | null,
  run: QueueRunResult = {},
): Promise<QueueFinishResult | null> {
  const message = detail ?? null;
  const result: QueueFinishResult =
    outcome === 'ok' ? 'done' : task.attempts >= task.maxAttempts ? 'error' : 'retry';
  return db.transaction(async (tx) => {
    const released = { lockedBy: null, lockedUntil: null };
    const rows = await tx
      .update(jobRequest)
      .set(
        result === 'retry'
          ? {
              ...released,
              status: 'pending',
              detail: message,
              lastError: message,
              runAfter: sql`now() + make_interval(secs => ${queueBackoffMs(task.attempts) / 1000}::double precision)`,
            }
          : {
              ...released,
              status: result,
              finishedAt: sql`now()`,
              detail: message,
              ...(outcome === 'error' ? { lastError: message } : {}),
            },
      )
      .where(owned(task))
      .returning({ id: jobRequest.id });
    if (!rows.length) return null;
    await tx
      .update(jobRun)
      .set({
        status: outcome,
        finishedAt: sql`now()`,
        error: outcome === 'error' ? message : null,
        ...(run.callsSpent !== undefined ? { callsSpent: run.callsSpent } : {}),
        ...(run.stats
          ? { stats: sql`coalesce(${jobRun.stats}, '{}'::jsonb) || ${JSON.stringify(run.stats)}::jsonb` }
          : {}),
      })
      .where(eq(jobRun.id, task.runId));
    return result;
  });
}

/**
 * Devolve a tarefa à fila sem culpa (SIGTERM do deploy): volta a pendente com o checkpoint e devolve a tentativa, e a
 * execução fecha como `interrupted`. O próximo worker pega na hora e retoma. false: a tomada já tinha perdido a tarefa.
 */
export async function release(db: Pick<Database, 'transaction'>, task: QueueLease): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(jobRequest)
      .set({
        status: 'pending',
        attempts: sql`greatest(${jobRequest.attempts} - 1, 0)`,
        lockedBy: null,
        lockedUntil: null,
        runAfter: sql`now()`,
      })
      .where(owned(task))
      .returning({ id: jobRequest.id });
    if (!rows.length) return false;
    await tx
      .update(jobRun)
      .set({
        status: 'interrupted',
        finishedAt: sql`now()`,
        stats: sql`coalesce(${jobRun.stats}, '{}'::jsonb) || '{"interrupted": true}'::jsonb`,
      })
      .where(eq(jobRun.id, task.runId));
    return true;
  });
}
