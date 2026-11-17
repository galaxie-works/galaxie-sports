/**
 * Fila do job `channel-lists`: as listas de canais com sobras para a IA. Módulo leve de propósito (só a consulta do
 * banco): o scheduler usa `hasPendingChannelLists` antes de subir o job (idleCheck), e a CLI decide se há trabalho
 * antes de importar o Onde Assistir e o modelo.
 */
import { listChannelListsForAi, type TenantChannelList } from '@galaxie/db/channel-lists';
import type { Database } from '@galaxie/db/client';

export interface PendingChannelListOptions {
  max?: number;
  tenantIds?: string[];
  retryFailed?: boolean;
}

/**
 * Listas que o job pegaria (sem chamar o modelo). Com `--tenant`, a falha volta na hora (sem o
 * intervalo mínimo entre tentativas do job agendado).
 */
export function pendingChannelLists(
  db: Database,
  opts: PendingChannelListOptions = {},
): Promise<TenantChannelList[]> {
  return listChannelListsForAi(db, {
    limit: opts.max ?? 10,
    retryFailed: opts.retryFailed ?? false,
    ...(opts.tenantIds?.length ? { tenantIds: opts.tenantIds, failedRetryAfterMs: 0 } : {}),
  });
}

/** Há lista para o job agendado (`--repetir-falhas`: a pendente e a que falhou há mais que o intervalo)? */
export async function hasPendingChannelLists(db: Database): Promise<boolean> {
  return (await pendingChannelLists(db, { max: 1, retryFailed: true })).length > 0;
}
