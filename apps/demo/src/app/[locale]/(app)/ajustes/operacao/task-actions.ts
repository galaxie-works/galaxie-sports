'use server';

/**
 * Ações da seção Tarefas (Ajustes → Sistema): enfileirar, ver, cancelar, reprocessar e aprovar a prévia. Cada uma
 * revalida a sessão de admin no servidor (como as demais ações do painel) e confere a entrada com zod; os params
 * passam pelo schema do tipo (`@galaxie/db/queue-types`) e a regra da fila é a mesma da CLI
 * (`@galaxie/db/queue-admin`): tipo destrutivo só entra em prévia, e a execução de verdade sai da aprovação.
 */
import { approvePreview, cancelTask, reprocessTask, requestTask, TaskError } from '@galaxie/db/queue-admin';
import { coerceParams, taskType } from '@galaxie/db/queue-types';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireAdmin } from '@/lib/auth/admin';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';
import { queueDb, readTask } from '@/lib/ops/tasks';
import type { TaskDetailView } from '@/lib/ops/types';

export interface TaskActionResult {
  ok: boolean;
  error?: string;
  /** Problemas por campo, quando os params não conferem com o schema. */
  issues?: string[];
  /** Tarefa criada (enfileirar, reprocessar, aprovar). */
  id?: string;
  /** A criada é prévia. */
  previa?: boolean;
}

const PATH = '/ajustes/sistema';

const idInput = z.uuid();
const enqueueInput = z.object({
  type: z.string().trim().min(1).max(100),
  /** Em texto, como o formulário manda; o schema do tipo converte e confere. */
  params: z.record(z.string().max(100), z.string().max(10_000)).default({}),
  priority: z.number().int().min(-1000).max(1000).default(0),
  previa: z.boolean().default(false),
});
export type EnqueueTaskInput = z.input<typeof enqueueInput>;

async function texts() {
  return getDictionary(await getRequestLocale()).ops.tasks;
}

async function failure(err: unknown): Promise<TaskActionResult> {
  const t = await texts();
  if (err instanceof TaskError)
    return {
      ok: false,
      error: t.errors[err.code],
      ...(err.code === 'params_invalidos' ? { issues: err.details } : {}),
    };
  return { ok: false, error: err instanceof Error ? err.message : t.errors.unknown };
}

export async function enqueueTask(input: EnqueueTaskInput): Promise<TaskActionResult> {
  const me = await requireAdmin();
  const parsed = enqueueInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: (await texts()).errors.invalidInput };
  const { type, params, priority, previa } = parsed.data;
  const def = taskType(type);
  try {
    const created = await requestTask(queueDb(), {
      type,
      params: def ? coerceParams(def, params) : params,
      priority,
      previa,
      requestedBy: me.email,
    });
    revalidatePath(PATH);
    return { ok: true, ...created };
  } catch (err) {
    return failure(err);
  }
}

export async function loadTask(id: string): Promise<{ ok: true; task: TaskDetailView } | TaskActionResult> {
  await requireAdmin();
  if (!idInput.safeParse(id).success) return { ok: false, error: (await texts()).errors.nao_encontrada };
  try {
    return { ok: true, task: await readTask(id) };
  } catch (err) {
    return failure(err);
  }
}

export async function cancelTaskAction(id: string): Promise<TaskActionResult> {
  const me = await requireAdmin();
  if (!idInput.safeParse(id).success) return { ok: false, error: (await texts()).errors.nao_encontrada };
  try {
    await cancelTask(queueDb(), id, me.email);
    revalidatePath(PATH);
    return { ok: true, id };
  } catch (err) {
    return failure(err);
  }
}

export async function reprocessTaskAction(id: string): Promise<TaskActionResult> {
  const me = await requireAdmin();
  if (!idInput.safeParse(id).success) return { ok: false, error: (await texts()).errors.nao_encontrada };
  try {
    const created = await reprocessTask(queueDb(), id, me.email);
    revalidatePath(PATH);
    return { ok: true, ...created };
  } catch (err) {
    return failure(err);
  }
}

/** "Aprovar e executar": só admin; enfileira a execução de verdade apontando para a prévia. */
export async function approveTaskAction(previewId: string): Promise<TaskActionResult> {
  const me = await requireAdmin();
  if (!idInput.safeParse(previewId).success)
    return { ok: false, error: (await texts()).errors.nao_encontrada };
  try {
    const created = await approvePreview(queueDb(), previewId, me.email);
    revalidatePath(PATH);
    return { ok: true, id: created.id, previa: false };
  } catch (err) {
    return failure(err);
  }
}
