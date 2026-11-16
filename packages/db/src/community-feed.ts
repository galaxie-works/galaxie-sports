/**
 * Feed das Comunidades (#946): posts, comentários e curtidas. O Feed é por Comunidade, sem linha do tempo por pessoa;
 * a ordem é o id (uuid v7). Só membros leem; o que a moderação reteve (`shadow`) só o autor vê; o tirado do ar
 * (`hidden`) e o de Perfil excluído não aparecem.
 *
 * As regras (quem escreve, filtro de texto, punições) ficam nas rotas e em `@galaxie/engage`; aqui a leitura e a
 * gravação, sempre filtradas pelo tenant.
 */
import { and, desc, eq, isNotNull, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { fanAvatarPublicUrl } from './fan-avatar-public.js';
import {
  communityAcceptance,
  communityComment,
  communityCommunity,
  communityMembership,
  communityPost,
  communityReaction,
  type CommunityContentVisibility,
  type CommunityPostAttachment,
  type CommunityPostAuthor,
} from './schema/community.js';
import { fanProfile } from './schema/fan.js';

/** Vínculo do torcedor e o último Aceite, para as rotas de escrita e leitura do Feed. */
export async function memberStanding(
  db: Database,
  tenantId: string,
  communityId: string,
  profileId: string,
): Promise<{ member: boolean; acceptedTermsVersion: number | null }> {
  const [m] = await db
    .select({ state: communityMembership.state })
    .from(communityMembership)
    .where(
      and(
        eq(communityMembership.tenantId, tenantId),
        eq(communityMembership.communityId, communityId),
        eq(communityMembership.profileId, profileId),
      ),
    )
    .limit(1);
  const [a] = await db
    .select({ v: sql<number | null>`max(${communityAcceptance.version})::int` })
    .from(communityAcceptance)
    .where(
      and(
        eq(communityAcceptance.tenantId, tenantId),
        eq(communityAcceptance.communityId, communityId),
        eq(communityAcceptance.profileId, profileId),
      ),
    );
  return { member: m?.state === 'active', acceptedTermsVersion: a?.v ?? null };
}

export interface CommunityPostRow {
  id: string;
  communityId: string;
  author: CommunityPostAuthor;
  profileId: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  body: string | null;
  autoKind: string | null;
  data: Record<string, unknown> | null;
  attachmentType: CommunityPostAttachment | null;
  attachmentId: string | null;
  photoUrl: string | null;
  visibility: CommunityContentVisibility;
  pinned: boolean;
  likes: number;
  comments: number;
  likedByMe: boolean;
  createdAt: Date;
}

const visibleTo = (
  col: { visibility: typeof communityPost.visibility; profileId: typeof communityPost.profileId },
  viewer: string,
) => or(eq(col.visibility, 'public'), and(eq(col.visibility, 'shadow'), eq(col.profileId, viewer)));

const postCols = (viewer: string) => ({
  id: communityPost.id,
  communityId: communityPost.communityId,
  author: communityPost.author,
  profileId: communityPost.profileId,
  nickname: fanProfile.nickname,
  avatarUrl: fanAvatarPublicUrl(),
  avatarVisibility: sql<string | undefined>`${fanProfile.visibility}->>'avatar'`,
  body: communityPost.body,
  autoKind: communityPost.autoKind,
  data: communityPost.data,
  attachmentType: communityPost.attachmentType,
  attachmentId: communityPost.attachmentId,
  photoUrl: communityPost.photoUrl,
  visibility: communityPost.visibility,
  pinnedAt: communityPost.pinnedAt,
  createdAt: communityPost.createdAt,
  likes: sql<number>`(select count(*)::int from ${communityReaction} r
    where r.tenant_id = ${communityPost.tenantId} and r.post_id = ${communityPost.id})`,
  comments: sql<number>`(select count(*)::int from ${communityComment} c
    join fan.profile cp on cp.tenant_id = c.tenant_id and cp.id = c.profile_id and cp.deleted_at is null
    where c.tenant_id = ${communityPost.tenantId} and c.post_id = ${communityPost.id} and c.visibility = 'public')`,
  likedByMe: sql<boolean>`exists (select 1 from ${communityReaction} r
    where r.tenant_id = ${communityPost.tenantId} and r.post_id = ${communityPost.id} and r.profile_id = ${viewer})`,
});

type RawPost = Awaited<ReturnType<typeof selectPosts>>[number];

function selectPosts(db: Database, viewer: string) {
  return db
    .select(postCols(viewer))
    .from(communityPost)
    .leftJoin(
      fanProfile,
      and(eq(fanProfile.tenantId, communityPost.tenantId), eq(fanProfile.id, communityPost.profileId)),
    );
}

const toPost = (r: RawPost): CommunityPostRow => ({
  id: r.id,
  communityId: r.communityId,
  author: r.author,
  profileId: r.profileId,
  nickname: r.author === 'member' ? r.nickname : null,
  avatarUrl: r.author === 'member' && r.avatarVisibility !== 'private' ? r.avatarUrl : null,
  body: r.body,
  autoKind: r.autoKind,
  data: r.data,
  attachmentType: r.attachmentType,
  attachmentId: r.attachmentId,
  photoUrl: r.photoUrl,
  visibility: r.visibility,
  pinned: r.pinnedAt !== null,
  likes: r.likes,
  comments: r.comments,
  likedByMe: r.likedByMe,
  createdAt: r.createdAt,
});

/** Perfil do autor ainda existe (ou o post não é de membro). */
const authorAlive = or(isNull(communityPost.profileId), isNull(fanProfile.deletedAt));

/**
 * Uma página do Feed, do mais novo para o mais velho, e os fixados (até 3) na primeira página. `since` corta pela
 * janela de exibição da Comunidade.
 */
export async function listFeed(
  db: Database,
  input: {
    tenantId: string;
    communityId: string;
    viewerProfileId: string;
    before?: string | null;
    limit: number;
    since?: Date | null;
  },
): Promise<{ pinned: CommunityPostRow[]; posts: CommunityPostRow[] }> {
  const { tenantId, communityId, viewerProfileId: viewer } = input;
  const base = and(
    eq(communityPost.tenantId, tenantId),
    eq(communityPost.communityId, communityId),
    visibleTo(communityPost, viewer),
    authorAlive,
    input.since ? sql`${communityPost.createdAt} >= ${input.since}` : undefined,
  );
  const [posts, pinned] = await Promise.all([
    selectPosts(db, viewer)
      .where(and(base, input.before ? lt(communityPost.id, input.before) : undefined))
      .orderBy(desc(communityPost.id))
      .limit(Math.min(Math.max(input.limit, 1), 50)),
    input.before
      ? Promise.resolve([])
      : selectPosts(db, viewer)
          .where(and(base, isNotNull(communityPost.pinnedAt)))
          .orderBy(desc(communityPost.pinnedAt))
          .limit(3),
  ]);
  return { pinned: pinned.map(toPost), posts: posts.map(toPost) };
}

/** Um post visível ao torcedor (com a Comunidade dele), senão null. */
export async function readPost(
  db: Database,
  tenantId: string,
  postId: string,
  viewerProfileId: string,
): Promise<CommunityPostRow | null> {
  const [row] = await selectPosts(db, viewerProfileId)
    .where(
      and(
        eq(communityPost.tenantId, tenantId),
        eq(communityPost.id, postId),
        visibleTo(communityPost, viewerProfileId),
        authorAlive,
      ),
    )
    .limit(1);
  return row ? toPost(row) : null;
}

export async function insertPost(
  db: Database,
  input: {
    tenantId: string;
    communityId: string;
    author: CommunityPostAuthor;
    profileId: string | null;
    staffBy?: string | null;
    body: string;
    attachment: { type: CommunityPostAttachment; id: string } | null;
    photoUrl?: string | null;
    visibility: CommunityContentVisibility;
    flags: string[];
    purgeAt: Date;
  },
): Promise<{ id: string; createdAt: Date }> {
  const [row] = await db
    .insert(communityPost)
    .values({
      tenantId: input.tenantId,
      communityId: input.communityId,
      author: input.author,
      profileId: input.profileId,
      staffBy: input.staffBy ?? null,
      body: input.body,
      attachmentType: input.attachment?.type ?? null,
      attachmentId: input.attachment?.id ?? null,
      photoUrl: input.photoUrl ?? null,
      visibility: input.visibility,
      flags: input.flags,
      purgeAt: input.purgeAt,
    })
    .returning({ id: communityPost.id, createdAt: communityPost.createdAt });
  return row!;
}

/** Quando o torcedor publicou por último na Comunidade (post ou comentário): o intervalo mínimo entre envios. */
export async function lastWriteAt(
  db: Database,
  tenantId: string,
  communityId: string,
  profileId: string,
): Promise<Date | null> {
  const [row] = await db.execute<{ at: Date | null }>(sql`
    select greatest(
      (select max(p.created_at) from community.post p
        where p.tenant_id = ${tenantId} and p.community_id = ${communityId} and p.profile_id = ${profileId}),
      (select max(c.created_at) from community.comment c
        join community.post p on p.tenant_id = c.tenant_id and p.id = c.post_id
        where c.tenant_id = ${tenantId} and p.community_id = ${communityId} and c.profile_id = ${profileId})
    ) as at`);
  const at = row?.at;
  return at ? new Date(at) : null;
}

export interface CommunityCommentRow {
  id: string;
  postId: string;
  profileId: string;
  nickname: string | null;
  avatarUrl: string | null;
  body: string;
  visibility: CommunityContentVisibility;
  createdAt: Date;
}

/** Comentários do post, do mais velho para o mais novo, depois de `after` (paginação para frente). */
export async function listComments(
  db: Database,
  input: { tenantId: string; postId: string; viewerProfileId: string; after?: string | null; limit: number },
): Promise<CommunityCommentRow[]> {
  const rows = await db
    .select({
      id: communityComment.id,
      postId: communityComment.postId,
      profileId: communityComment.profileId,
      nickname: fanProfile.nickname,
      avatarUrl: fanAvatarPublicUrl(),
      avatarVisibility: sql<string | undefined>`${fanProfile.visibility}->>'avatar'`,
      body: communityComment.body,
      visibility: communityComment.visibility,
      createdAt: communityComment.createdAt,
    })
    .from(communityComment)
    .innerJoin(
      fanProfile,
      and(eq(fanProfile.tenantId, communityComment.tenantId), eq(fanProfile.id, communityComment.profileId)),
    )
    .where(
      and(
        eq(communityComment.tenantId, input.tenantId),
        eq(communityComment.postId, input.postId),
        isNull(fanProfile.deletedAt),
        or(
          eq(communityComment.visibility, 'public'),
          and(
            eq(communityComment.visibility, 'shadow'),
            eq(communityComment.profileId, input.viewerProfileId),
          ),
        ),
        input.after ? sql`${communityComment.id} > ${input.after}` : undefined,
      ),
    )
    .orderBy(communityComment.id)
    .limit(Math.min(Math.max(input.limit, 1), 100));
  return rows.map(({ avatarVisibility, ...r }) => ({
    ...r,
    avatarUrl: avatarVisibility === 'private' ? null : r.avatarUrl,
  }));
}

export async function insertComment(
  db: Database,
  input: {
    tenantId: string;
    postId: string;
    profileId: string;
    body: string;
    visibility: CommunityContentVisibility;
    flags: string[];
    purgeAt: Date;
  },
): Promise<{ id: string; createdAt: Date }> {
  const [row] = await db
    .insert(communityComment)
    .values(input)
    .returning({ id: communityComment.id, createdAt: communityComment.createdAt });
  return row!;
}

/** Curte (repetir não duplica) ou descurte. Devolve o total de curtidas do post. */
export async function setReaction(
  db: Database,
  input: { tenantId: string; postId: string; profileId: string; on: boolean },
): Promise<number> {
  if (input.on)
    await db
      .insert(communityReaction)
      .values({ tenantId: input.tenantId, postId: input.postId, profileId: input.profileId, kind: 'like' })
      .onConflictDoNothing();
  else
    await db
      .delete(communityReaction)
      .where(
        and(
          eq(communityReaction.tenantId, input.tenantId),
          eq(communityReaction.postId, input.postId),
          eq(communityReaction.profileId, input.profileId),
        ),
      );
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(communityReaction)
    .where(and(eq(communityReaction.tenantId, input.tenantId), eq(communityReaction.postId, input.postId)));
  return row?.n ?? 0;
}

// ---------------------------------------------------------------- moderação (console)

/** Fixa ou desafixa (até 3 fixados por Comunidade; o mais antigo sai quando entra o quarto). */
export async function pinPost(
  db: Database,
  input: { tenantId: string; postId: string; pinned: boolean; actor: string },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [post] = await tx
      .update(communityPost)
      .set(
        input.pinned ? { pinnedAt: new Date(), pinnedBy: input.actor } : { pinnedAt: null, pinnedBy: null },
      )
      .where(and(eq(communityPost.tenantId, input.tenantId), eq(communityPost.id, input.postId)))
      .returning({ communityId: communityPost.communityId });
    if (!post) return false;
    if (input.pinned) {
      const keep = await tx
        .select({ id: communityPost.id })
        .from(communityPost)
        .where(
          and(
            eq(communityPost.tenantId, input.tenantId),
            eq(communityPost.communityId, post.communityId),
            isNotNull(communityPost.pinnedAt),
          ),
        )
        .orderBy(desc(communityPost.pinnedAt))
        .limit(3);
      await tx
        .update(communityPost)
        .set({ pinnedAt: null, pinnedBy: null })
        .where(
          and(
            eq(communityPost.tenantId, input.tenantId),
            eq(communityPost.communityId, post.communityId),
            isNotNull(communityPost.pinnedAt),
            notInArray(
              communityPost.id,
              keep.map((k) => k.id),
            ),
          ),
        );
    }
    return true;
  });
}

/** Tira do ar (`hidden`) ou devolve (`public`) um post ou comentário. Nada é apagado. */
export async function setContentVisibility(
  db: Database,
  input: {
    tenantId: string;
    kind: 'post' | 'comment';
    id: string;
    visibility: 'public' | 'hidden';
    actor: string;
  },
): Promise<boolean> {
  const table = input.kind === 'post' ? communityPost : communityComment;
  const rows = await db
    .update(table)
    .set({ visibility: input.visibility, moderatedBy: input.actor })
    .where(and(eq(table.tenantId, input.tenantId), eq(table.id, input.id)))
    .returning({ id: table.id });
  return rows.length > 0;
}

/** Posts e comentários vencidos pelo relógio de conteúdo da ficha (#954). Apaga em lotes; devolve quantos saíram. */
export async function purgeCommunityContent(db: Database, now: Date, batch = 1000): Promise<number> {
  const comments = await db.execute<{ n: number }>(sql`
    with gone as (
      delete from community.comment where ctid in (
        select ctid from community.comment where purge_at <= ${now} limit ${batch})
      returning 1)
    select count(*)::int as n from gone`);
  const posts = await db.execute<{ n: number }>(sql`
    with gone as (
      delete from community.post where ctid in (
        select ctid from community.post where purge_at <= ${now} limit ${batch})
      returning 1)
    select count(*)::int as n from gone`);
  return (comments[0]?.n ?? 0) + (posts[0]?.n ?? 0);
}

/** A Comunidade do post, se o post é do tenant. */
export async function communityOfPost(
  db: Database,
  tenantId: string,
  postId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: communityPost.communityId })
    .from(communityPost)
    .innerJoin(
      communityCommunity,
      and(
        eq(communityCommunity.tenantId, communityPost.tenantId),
        eq(communityCommunity.id, communityPost.communityId),
      ),
    )
    .where(and(eq(communityPost.tenantId, tenantId), eq(communityPost.id, postId)))
    .limit(1);
  return row?.id ?? null;
}
