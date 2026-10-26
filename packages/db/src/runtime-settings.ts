/**
 * Leitura e escrita da configuração em tempo de execução (ops.runtime_setting e companhia) pelos
 * serviços. O painel da demo grava pelo próprio pool (pg); aqui ficam o que os schedulers, o ao vivo e
 * a API usam, e as escritas que os testes de integração precisam.
 */
import { and, eq, inArray, lt, notInArray, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  jobRequest,
  jobRun,
  runtimeCheck,
  runtimeEnv,
  runtimeSetting,
  runtimeSettingLog,
} from './schema/index.js';

/** Sobrescritas gravadas no painel, por chave (sem validar: quem aplica valida pelo registro). */
export async function readRuntimeOverrides(db: Pick<Database, 'select'>): Promise<Map<string, string>> {
  const rows = await db.select({ key: runtimeSetting.key, value: runtimeSetting.value }).from(runtimeSetting);
  return new Map(rows.map((r) => [r.key, r.value]));
}

export interface RuntimeSettingState {
  /** Sobrescrita gravada (sem validar); null = sem sobrescrita. */
  value: string | null;
  /** Última mudança registrada no histórico (gravação ou volta ao padrão); null = nunca mudou. */
  changedAt: Date | null;
}

/**
 * Sobrescrita de uma chave e quando ela mudou pela última vez. A API usa o instante da mudança como
 * versão da flag na chave do cache: duas instâncias que leem o mesmo banco chegam à mesma versão.
 */
export async function readRuntimeSettingState(
  db: Pick<Database, 'select'>,
  key: string,
): Promise<RuntimeSettingState> {
  const [row] = await db
    .select({
      value: sql<
        string | null
      >`(select ${runtimeSetting.value} from ${runtimeSetting} where ${runtimeSetting.key} = ${key})`,
      changedAt: sql<
        string | null
      >`(select max(${runtimeSettingLog.changedAt}) from ${runtimeSettingLog} where ${runtimeSettingLog.key} = ${key})`,
    })
    .from(sql`(select 1) as one`);
  return { value: row?.value ?? null, changedAt: row?.changedAt ? new Date(row.changedAt) : null };
}

export interface RuntimeSettingWrite {
  key: string;
  /** `null` = voltar ao padrão (apaga a sobrescrita). */
  value: string | null;
  valueType: string;
  by: string;
}

/** Grava (ou apaga) uma sobrescrita e registra no histórico, numa transação. */
export async function writeRuntimeSetting(db: Database, input: RuntimeSettingWrite): Promise<void> {
  await db.transaction(async (tx) => {
    const [prev] = await tx
      .select({ value: runtimeSetting.value })
      .from(runtimeSetting)
      .where(eq(runtimeSetting.key, input.key))
      .for('update');
    if (input.value === null) {
      if (!prev) return;
      await tx.delete(runtimeSetting).where(eq(runtimeSetting.key, input.key));
    } else {
      if (prev?.value === input.value) return;
      await tx
        .insert(runtimeSetting)
        .values({ key: input.key, value: input.value, valueType: input.valueType, updatedBy: input.by })
        .onConflictDoUpdate({
          target: runtimeSetting.key,
          set: { value: input.value, valueType: input.valueType, updatedBy: input.by, updatedAt: new Date() },
        });
    }
    await tx.insert(runtimeSettingLog).values({
      key: input.key,
      action: input.value === null ? 'reset' : 'set',
      oldValue: prev?.value ?? null,
      newValue: input.value,
      changedBy: input.by,
    });
  });
}

export interface RuntimeEnvRow {
  key: string;
  value: string | null;
  configured: boolean;
}

/** Substitui o relatório de env de um serviço (as chaves que saíram do registro somem do painel). */
export async function reportRuntimeEnv(
  db: Database,
  service: string,
  rows: readonly RuntimeEnvRow[],
): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    if (rows.length)
      await tx
        .insert(runtimeEnv)
        .values(
          rows.map((r) => ({
            service,
            key: r.key,
            value: r.value,
            configured: r.configured,
            reportedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: [runtimeEnv.service, runtimeEnv.key],
          set: { value: sql`excluded.value`, configured: sql`excluded.configured`, reportedAt: now },
        });
    await tx.delete(runtimeEnv).where(
      and(
        eq(runtimeEnv.service, service),
        rows.length
          ? notInArray(
              runtimeEnv.key,
              rows.map((r) => r.key),
            )
          : sql`true`,
      ),
    );
  });
}

/** Sinal de vida: atualiza `reported_at` do relatório do serviço sem reescrever os valores. */
export async function touchRuntimeEnv(db: Pick<Database, 'update'>, service: string): Promise<void> {
  await db.update(runtimeEnv).set({ reportedAt: new Date() }).where(eq(runtimeEnv.service, service));
}

/** Pedidos pendentes há mais que isto expiram (o scheduler do perfil estava fora do ar). */
export const JOB_REQUEST_TTL_MS = 15 * 60_000;

export interface ClaimedJobRequest {
  id: string;
  job: string;
  requestedBy: string;
}

/**
 * Pega os pedidos pendentes de "rodar agora" para os jobs deste scheduler (marca como `running`), com
 * SKIP LOCKED para dois processos do mesmo perfil não pegarem o mesmo pedido. Antes, expira os velhos.
 */
export async function claimJobRequests(
  db: Database,
  jobs: readonly string[],
  now: Date = new Date(),
): Promise<ClaimedJobRequest[]> {
  if (!jobs.length) return [];
  await db
    .update(jobRequest)
    .set({ status: 'expired', finishedAt: now, detail: 'scheduler não pegou o pedido a tempo' })
    .where(
      and(
        eq(jobRequest.status, 'pending'),
        inArray(jobRequest.job, [...jobs]),
        lt(jobRequest.requestedAt, new Date(now.getTime() - JOB_REQUEST_TTL_MS)),
      ),
    );
  const rows = await db.execute<{ id: string; job: string; requested_by: string }>(sql`
    update ops.job_request set status = 'running', picked_at = ${now.toISOString()}::timestamptz
     where id in (
       select id from ops.job_request
        where status = 'pending' and job in ${[...jobs]}
        order by requested_at
        for update skip locked)
    returning id, job, requested_by`);
  return [...rows].map((r) => ({ id: r.id, job: r.job, requestedBy: r.requested_by }));
}

export async function finishJobRequest(
  db: Pick<Database, 'update'>,
  id: string,
  result: { status: 'done' | 'error' | 'skipped'; runId?: string | undefined; detail?: string | null },
): Promise<void> {
  await db
    .update(jobRequest)
    .set({
      status: result.status,
      finishedAt: new Date(),
      runId: result.runId ?? null,
      detail: result.detail ?? null,
    })
    .where(eq(jobRequest.id, id));
}

/** Grava o resultado de uma checagem (ex.: crédito da conta de IA). */
export async function saveRuntimeCheck(
  db: Pick<Database, 'insert'>,
  input: { service: string; name: string; status: 'pass' | 'warn' | 'fail'; detail: string | null },
): Promise<void> {
  const checkedAt = new Date();
  await db
    .insert(runtimeCheck)
    .values({ ...input, checkedAt })
    .onConflictDoUpdate({
      target: [runtimeCheck.service, runtimeCheck.name],
      set: { status: input.status, detail: input.detail, checkedAt },
    });
}

/**
 * Soma estatísticas do próprio job à linha dele em ops.job_run (o scheduler passa o id em
 * GALAXIE_SCHEDULER_RUN_ID). As chaves novas entram por cima das antigas; o scheduler soma as dele no fim.
 */
export async function mergeJobRunStats(
  db: Pick<Database, 'update'>,
  runId: string,
  stats: Record<string, unknown>,
): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return;
  await db
    .update(jobRun)
    .set({ stats: sql`coalesce(${jobRun.stats}, '{}'::jsonb) || ${JSON.stringify(stats)}::jsonb` })
    .where(eq(jobRun.id, runId));
}
