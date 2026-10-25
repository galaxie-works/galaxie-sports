/**
 * Lista de canais do cliente no banco (api.tenant_channel_list), uma por tenant. Quem casa os canais
 * com os direitos é `@galaxie/where-to-watch` (código antes, IA nas sobras, validador depois); aqui só
 * gravação e leitura:
 * - `saveChannelList`: lista nova ou reprocessada (o casamento volta para revisão; correções mantidas);
 * - `saveChannelListAi`: o job da IA grava o resultado validado, se a lista não mudou no meio (nem as
 *   correções do cliente: `revision`);
 * - `setChannelListOverrides` e `confirmChannelList`: o cliente corrige e confirma no portal;
 * - `getConfirmedChannelList`: o que a API serve no onde assistir.
 */
import { and, asc, eq, inArray, lte, or, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  tenantChannelList,
  type ChannelListAiStatus,
  type StoredChannelMatch,
  type StoredChannelOverride,
  type StoredClientChannel,
} from './schema/index.js';

export type TenantChannelList = typeof tenantChannelList.$inferSelect;

const sameNames = (a: StoredClientChannel[], b: StoredClientChannel[]) =>
  a.length === b.length && a.every((c, i) => c.name === b[i]!.name);

/** Mesmo casamento (tipo e canais por direito), sem olhar origem nem nota. */
export function sameMatches(a: StoredChannelMatch[], b: StoredChannelMatch[]): boolean {
  const key = (ms: StoredChannelMatch[]) =>
    ms
      .map((m) => `${m.country}:${m.broadcasterId}:${m.match}:${m.channels.join(',')}`)
      .sort()
      .join('|');
  return key(a) === key(b);
}

export async function getChannelList(db: Database, tenantId: string): Promise<TenantChannelList | null> {
  const [row] = await db.select().from(tenantChannelList).where(eq(tenantChannelList.tenantId, tenantId));
  return row ?? null;
}

export interface SaveChannelListInput {
  source: 'm3u' | 'text';
  defaultCountry: string | null;
  markets: string[];
  channels: StoredClientChannel[];
  proposed: StoredChannelMatch[];
  overrides: StoredChannelOverride[];
  aiStatus: ChannelListAiStatus;
  userId?: string | null;
  now?: Date;
}

/**
 * Grava a lista (nova ou reprocessada) com o casamento proposto: volta para `review` se algo mudou.
 * A versão confirmada continua servida pela API até o cliente confirmar de novo.
 */
export async function saveChannelList(
  db: Database,
  tenantId: string,
  input: SaveChannelListInput,
): Promise<TenantChannelList> {
  const now = input.now ?? new Date();
  // reprocessar sem mudança nenhuma (mesmos canais, mesmo casamento) não tira a confirmação
  const current = await getChannelList(db, tenantId);
  const unchanged =
    current?.status === 'confirmed' &&
    !!current.confirmed &&
    sameNames(current.confirmed.channels, input.channels) &&
    sameMatches(current.confirmed.matches, input.proposed);
  const values = {
    source: input.source,
    defaultCountry: input.defaultCountry,
    markets: input.markets,
    channels: input.channels,
    proposed: input.proposed,
    overrides: input.overrides,
    status: unchanged ? ('confirmed' as const) : ('review' as const),
    aiStatus: input.aiStatus,
    aiNote: null,
    processedAt: now,
    uploadedBy: input.userId ?? null,
    updatedAt: now,
  };
  const [row] = await db
    .insert(tenantChannelList)
    .values({ tenantId, ...values, createdAt: now })
    .onConflictDoUpdate({ target: tenantChannelList.tenantId, set: values })
    .returning();
  return row!;
}

/**
 * Resultado da IA (já validado). Só grava se a lista não foi reprocessada nem corrigida pelo cliente
 * depois que o job a leu (`processedAt` e `revision` iguais); devolve false quando ela mudou no meio.
 */
export async function saveChannelListAi(
  db: Database,
  tenantId: string,
  input: {
    processedAt: Date;
    revision: number;
    proposed: StoredChannelMatch[];
    /** `pending` = a rodada parou no teto de pedidos por lista; o próximo job continua. */
    aiStatus: Extract<ChannelListAiStatus, 'done' | 'failed' | 'pending'>;
    aiNote: string | null;
  },
): Promise<boolean> {
  const current = await getChannelList(db, tenantId);
  if (
    !current ||
    current.processedAt.getTime() !== input.processedAt.getTime() ||
    current.revision !== input.revision
  )
    return false;
  // casamento mudou depois da confirmação: volta para revisão (a API segue com a confirmada)
  const unchanged =
    current.status === 'confirmed' && sameMatches(current.confirmed?.matches ?? [], input.proposed);
  const rows = await db
    .update(tenantChannelList)
    .set({
      proposed: input.proposed,
      aiStatus: input.aiStatus,
      aiNote: input.aiNote,
      status: unchanged ? 'confirmed' : 'review',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(tenantChannelList.tenantId, tenantId),
        eq(tenantChannelList.processedAt, input.processedAt),
        eq(tenantChannelList.revision, input.revision),
      ),
    )
    .returning({ tenantId: tenantChannelList.tenantId });
  return rows.length > 0;
}

/**
 * Correções do cliente e o casamento recalculado com elas (volta para `review`). Sobe a `revision`:
 * o resultado da IA que estava em andamento é descartado e o job refaz com as correções novas.
 * `aiStatus: 'pending'` quando a correção deixa sobras que a IA ainda não conferiu (ex.: desfazer a
 * correção de uma emissora); sem ele, o `aiStatus` fica como está.
 */
export async function setChannelListOverrides(
  db: Database,
  tenantId: string,
  input: {
    overrides: StoredChannelOverride[];
    proposed: StoredChannelMatch[];
    aiStatus?: Extract<ChannelListAiStatus, 'pending'>;
  },
): Promise<TenantChannelList | null> {
  const [row] = await db
    .update(tenantChannelList)
    .set({
      overrides: input.overrides,
      proposed: input.proposed,
      status: 'review',
      revision: sql`${tenantChannelList.revision} + 1`,
      ...(input.aiStatus ? { aiStatus: input.aiStatus, aiNote: null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(tenantChannelList.tenantId, tenantId))
    .returning();
  return row ?? null;
}

/** O cliente confirma: o casamento proposto (e a lista daquele momento) passa a ser servido pela API. */
export async function confirmChannelList(
  db: Database,
  tenantId: string,
  userId: string | null,
  now: Date = new Date(),
): Promise<TenantChannelList | null> {
  const current = await getChannelList(db, tenantId);
  if (!current) return null;
  const [row] = await db
    .update(tenantChannelList)
    .set({
      confirmed: { channels: current.channels, matches: current.proposed },
      status: 'confirmed',
      confirmedAt: now,
      confirmedBy: userId,
      updatedAt: now,
    })
    .where(
      and(
        eq(tenantChannelList.tenantId, tenantId),
        eq(tenantChannelList.processedAt, current.processedAt),
        eq(tenantChannelList.revision, current.revision),
      ),
    )
    .returning();
  return row ?? null;
}

/** Remove a lista do tenant (o onde assistir deixa de trazer `client_channels`). */
export async function deleteChannelList(db: Database, tenantId: string): Promise<boolean> {
  const rows = await db
    .delete(tenantChannelList)
    .where(eq(tenantChannelList.tenantId, tenantId))
    .returning({ tenantId: tenantChannelList.tenantId });
  return rows.length > 0;
}

/** Intervalo mínimo desde a última tentativa antes de refazer uma lista que falhou. */
export const CHANNEL_LIST_FAILED_RETRY_MS = 30 * 60_000;

/**
 * Listas com sobras esperando a IA, as mais antigas primeiro; com `retryFailed`, as que falharam vêm
 * depois de todas as pendentes, pela tentativa mais antiga (`updatedAt`), e só depois de
 * `failedRetryAfterMs` desde ela: lista que falha sempre não trava a fila nem gasta toda rodada.
 */
export async function listChannelListsForAi(
  db: Database,
  opts: {
    limit?: number;
    retryFailed?: boolean;
    tenantIds?: string[];
    failedRetryAfterMs?: number;
    now?: Date;
  } = {},
): Promise<TenantChannelList[]> {
  const cutoff = new Date(
    (opts.now ?? new Date()).getTime() - (opts.failedRetryAfterMs ?? CHANNEL_LIST_FAILED_RETRY_MS),
  );
  const status = opts.retryFailed
    ? or(
        eq(tenantChannelList.aiStatus, 'pending'),
        and(eq(tenantChannelList.aiStatus, 'failed'), lte(tenantChannelList.updatedAt, cutoff)),
      )!
    : eq(tenantChannelList.aiStatus, 'pending');
  const conds = [status];
  if (opts.tenantIds?.length) conds.push(inArray(tenantChannelList.tenantId, opts.tenantIds));
  return db
    .select()
    .from(tenantChannelList)
    .where(and(...conds))
    .orderBy(
      asc(sql`${tenantChannelList.aiStatus} = 'failed'`),
      asc(
        sql`case when ${tenantChannelList.aiStatus} = 'failed' then ${tenantChannelList.updatedAt} else ${tenantChannelList.processedAt} end`,
      ),
    )
    .limit(opts.limit ?? 20);
}

/** A versão confirmada (o que a API serve) e quando foi confirmada; null = sem lista confirmada. */
export async function getConfirmedChannelList(
  db: Database,
  tenantId: string,
): Promise<{ confirmedAt: Date; channels: StoredClientChannel[]; matches: StoredChannelMatch[] } | null> {
  const [row] = await db
    .select({ confirmed: tenantChannelList.confirmed, confirmedAt: tenantChannelList.confirmedAt })
    .from(tenantChannelList)
    .where(eq(tenantChannelList.tenantId, tenantId));
  if (!row?.confirmed || !row.confirmedAt) return null;
  return { confirmedAt: row.confirmedAt, ...row.confirmed };
}
