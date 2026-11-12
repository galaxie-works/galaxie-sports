/**
 * Conta e Perfil do torcedor (#937): o que o pedido de token grava, o que o torcedor lê e muda, e a exclusão.
 * Tudo filtrado pelo tenant; o Perfil aponta para a Conta por chave composta (o banco recusa mistura).
 */
import {
  erasePresence,
  eraseModerationContent,
  fanAccount,
  fanErasureLog,
  fanPointsRevokedEvent,
  fanProfile,
  fanWallet,
  type Database,
  type FanAgeBand,
  type FanHolderAdult,
  type FanVisibility,
} from '@galaxie/db';
import { and, eq, isNull, sql } from 'drizzle-orm';

export interface FanUpsert {
  tenantId: string;
  externalAccountId: string;
  externalProfileId: string;
  nickname: string;
  avatarUrl?: string | undefined;
  ageBand: FanAgeBand;
  country: string;
  locale: string;
  holderAdult: FanHolderAdult;
  favoriteTeamId?: string | undefined;
}

export interface FanProfileView {
  profileId: string;
  accountId: string;
  nickname: string;
  avatarUrl: string | null;
  ageBand: FanAgeBand;
  country: string;
  locale: string;
  favoriteTeamId: string | null;
  visibility: FanVisibility;
  holderAdult: FanHolderAdult;
}

/**
 * Cria ou atualiza a Conta e o Perfil com o que o servidor do cliente mandou. O cliente é a fonte da faixa,
 * do país, do idioma, do Apelido e do avatar; o time do coração só muda quando vem no pedido (o torcedor também
 * muda em PATCH /v1/fans/me).
 */
export async function upsertFan(
  db: Database,
  input: FanUpsert,
): Promise<{ accountId: string; profileId: string }> {
  return db.transaction(async (tx) => {
    const [account] = await tx
      .insert(fanAccount)
      .values({
        tenantId: input.tenantId,
        externalAccountId: input.externalAccountId,
        holderAdult: input.holderAdult,
      })
      .onConflictDoUpdate({
        target: [fanAccount.tenantId, fanAccount.externalAccountId],
        set: { holderAdult: input.holderAdult, updatedAt: sql`now()` },
      })
      .returning({ id: fanAccount.id });
    const accountId = account!.id;
    const [profile] = await tx
      .insert(fanProfile)
      .values({
        tenantId: input.tenantId,
        accountId,
        externalProfileId: input.externalProfileId,
        nickname: input.nickname,
        avatarUrl: input.avatarUrl ?? null,
        ageBand: input.ageBand,
        country: input.country,
        locale: input.locale,
        favoriteTeamId: input.favoriteTeamId ?? null,
      })
      .onConflictDoUpdate({
        target: [fanProfile.tenantId, fanProfile.accountId, fanProfile.externalProfileId],
        targetWhere: sql`${fanProfile.externalProfileId} is not null`,
        set: {
          nickname: input.nickname,
          avatarUrl: input.avatarUrl ?? null,
          ageBand: input.ageBand,
          country: input.country,
          locale: input.locale,
          ...(input.favoriteTeamId ? { favoriteTeamId: input.favoriteTeamId } : {}),
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: fanProfile.id });
    return { accountId, profileId: profile!.id };
  });
}

/** Apelido gravado do Perfil pelos ids do cliente (null se o Perfil ainda não existe ou foi excluído). */
export async function storedNickname(
  db: Database,
  tenantId: string,
  externalAccountId: string,
  externalProfileId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ nickname: fanProfile.nickname })
    .from(fanProfile)
    .innerJoin(
      fanAccount,
      and(eq(fanAccount.tenantId, fanProfile.tenantId), eq(fanAccount.id, fanProfile.accountId)),
    )
    .where(
      and(
        eq(fanProfile.tenantId, tenantId),
        eq(fanAccount.externalAccountId, externalAccountId),
        eq(fanProfile.externalProfileId, externalProfileId),
        isNull(fanProfile.deletedAt),
      ),
    );
  return row?.nickname ?? null;
}

/** Perfil ativo do token; null se foi excluído (ou nunca existiu neste tenant). */
export async function readFan(
  db: Database,
  tenantId: string,
  profileId: string,
): Promise<FanProfileView | null> {
  const [row] = await db
    .select({
      profileId: fanProfile.id,
      accountId: fanProfile.accountId,
      nickname: fanProfile.nickname,
      avatarUrl: fanProfile.avatarUrl,
      ageBand: fanProfile.ageBand,
      country: fanProfile.country,
      locale: fanProfile.locale,
      favoriteTeamId: fanProfile.favoriteTeamId,
      visibility: fanProfile.visibility,
      holderAdult: fanAccount.holderAdult,
    })
    .from(fanProfile)
    .innerJoin(
      fanAccount,
      and(eq(fanAccount.tenantId, fanProfile.tenantId), eq(fanAccount.id, fanProfile.accountId)),
    )
    .where(and(eq(fanProfile.tenantId, tenantId), eq(fanProfile.id, profileId), isNull(fanProfile.deletedAt)))
    .limit(1);
  if (!row || row.nickname === null) return null;
  return { ...row, nickname: row.nickname };
}

/** O torcedor muda a visibilidade campo a campo e o time do coração. */
export async function patchFan(
  db: Database,
  tenantId: string,
  profileId: string,
  patch: {
    favoriteTeamId?: string | null | undefined;
    visibility?: { [K in keyof FanVisibility]?: FanVisibility[K] | undefined } | undefined;
  },
): Promise<boolean> {
  const set: Partial<typeof fanProfile.$inferInsert> = {};
  if (patch.favoriteTeamId !== undefined) set.favoriteTeamId = patch.favoriteTeamId;
  const visibility = Object.fromEntries(
    Object.entries(patch.visibility ?? {}).filter(([, v]) => v !== undefined),
  );
  if (Object.keys(visibility).length) {
    // mescla com o que já estava: mandar só `avatar` não apaga a escolha dos outros campos
    set.visibility = sql`${fanProfile.visibility} || ${JSON.stringify(visibility)}::jsonb` as never;
  }
  const rows = await db
    .update(fanProfile)
    .set({ ...set, updatedAt: sql`now()` as never })
    .where(and(eq(fanProfile.tenantId, tenantId), eq(fanProfile.id, profileId), isNull(fanProfile.deletedAt)))
    .returning({ id: fanProfile.id });
  return rows.length > 0;
}

/**
 * Exclusão pedida pelo cliente: anonimiza o Perfil (some o id do cliente, o Apelido, o avatar e o time do
 * coração; a linha fica para o que o Perfil escreveu continuar apontando para "torcedor excluído") e grava o
 * registro para repetir depois de um restore. Repetir a chamada não faz nada. Devolve o Perfil excluído agora.
 *
 * A carteira de pontos (#938) sai junto; da moderação (#953) sai o conteúdo do torcedor e os bloqueios, e as decisões
 * ficam sem o conteúdo até o relógio da ficha do país. Os módulos que guardam conteúdo do torcedor (chat, comunidades, palpites,
 * conquistas) entram aqui quando
 * chegarem, na mesma transação, e o tópico `fan.profile.deleted` sai pelo outbox (#1023).
 */
export async function eraseFan(
  db: Database,
  input: { tenantId: string; externalAccountId: string; externalProfileId: string; requestedBy: string },
): Promise<{ profileId: string; accountId: string } | null> {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ profileId: fanProfile.id, accountId: fanProfile.accountId })
      .from(fanProfile)
      .innerJoin(
        fanAccount,
        and(eq(fanAccount.tenantId, fanProfile.tenantId), eq(fanAccount.id, fanProfile.accountId)),
      )
      .where(
        and(
          eq(fanProfile.tenantId, input.tenantId),
          eq(fanAccount.externalAccountId, input.externalAccountId),
          eq(fanProfile.externalProfileId, input.externalProfileId),
          isNull(fanProfile.deletedAt),
        ),
      )
      .for('update')
      .limit(1);
    if (!target) return null;
    await tx
      .update(fanProfile)
      .set({
        externalProfileId: null,
        nickname: null,
        avatarUrl: null,
        favoriteTeamId: null,
        visibility: {},
        deletedAt: sql`now()` as never,
        updatedAt: sql`now()` as never,
      })
      .where(and(eq(fanProfile.tenantId, input.tenantId), eq(fanProfile.id, target.profileId)));
    // a carteira e o extrato saem junto (o extrato cai em cascata): Perfil excluído não fica no Ranking
    await tx
      .delete(fanWallet)
      .where(and(eq(fanWallet.tenantId, input.tenantId), eq(fanWallet.profileId, target.profileId)));
    await tx
      .delete(fanPointsRevokedEvent)
      .where(
        and(
          eq(fanPointsRevokedEvent.tenantId, input.tenantId),
          eq(fanPointsRevokedEvent.profileId, target.profileId),
        ),
      );
    // presença ao vivo (#906): as janelas saem junto
    await erasePresence(tx, input.tenantId, target.profileId);
    await eraseModerationContent(tx, input.tenantId, target.profileId);
    await tx.insert(fanErasureLog).values({
      tenantId: input.tenantId,
      profileId: target.profileId,
      accountId: target.accountId,
      requestedBy: input.requestedBy,
    });
    return target;
  });
}
