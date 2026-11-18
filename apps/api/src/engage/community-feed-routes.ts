/**
 * Feed das Comunidades (#946), com o token `gft_`:
 *
 * - `GET /v1/communities/{id}/posts`: o Feed, só para membros (13 a 17 lê);
 * - `POST /v1/communities/{id}/posts`: o membro `18plus` publica, com o post de membro ligado e o Aceite em vigor;
 * - `GET` e `POST /v1/posts/{id}/comments`: comentários (escrever, só `18plus`);
 * - `PUT` e `DELETE /v1/posts/{id}/like`: curtir e descurtir (13 a 17 também curte).
 *
 * O texto passa pela base de regras (#969), que nunca desliga: o abuso fica retido (`held`, só o autor vê), o que a
 * regra barra volta para o autor com aviso. Suspensão e banimento no cliente, e silêncio na Comunidade, barram a
 * escrita. Foto no post só da equipe (console), até a moderação de imagem do Feed (#1025).
 */
import type { FastifyInstance } from 'fastify';
import {
  CommentsQuery,
  CommunityCommentBody,
  CommunityParams,
  CommunityPostBody,
  FeedQuery,
  PostParams,
  type CommunityComment,
  type CommunityCommentResponse,
  type CommunityComments,
  type CommunityFeed,
  type CommunityPost,
  type CommunityPostResponse,
  type CommunityReactionResponse,
} from '@galaxie/contracts';
import {
  activeSanctions,
  communityOfPost,
  hiddenProfilesFor,
  insertComment,
  insertPost,
  lastWriteAt,
  listComments,
  listFeed,
  memberStanding,
  purgeCommunityContent,
  readPost,
  setReaction,
  type CommunityCommentRow,
  type CommunityPostRow,
  type CommunityRow,
  type Database,
} from '@galaxie/db';
import { needsNewAcceptance, screen, screenNotice } from '@galaxie/engage';
import { ProblemError, problems } from '../errors.js';
import { parseInput } from '../util.js';
import { CommunityGate } from './community-routes.js';
import { readFan } from './fans.js';
import { clocksFor } from './moderation-routes.js';
import { ModerationLists } from './moderation.js';

export interface CommunityFeedRoutesDeps {
  db: Database | undefined;
  now?: (() => Date) | undefined;
}

const READ = { fan: true, age: 'read' } as const;
const WRITE = { fan: true, age: 'write' } as const;
const REACT = { fan: true, age: 'react' } as const;

/** Intervalo mínimo entre dois envios do mesmo torcedor na Comunidade (post ou comentário). */
const WRITE_INTERVAL_S = 10;
/** Padrão da janela de exibição do Feed, em dias (a Comunidade pode encurtar). */
const DEFAULT_HISTORY_DAYS = 730;

const refuse = (refusal: string, detail: string) =>
  new ProblemError(409, 'CONFLICT', 'Envio recusado', detail, {
    errors: [{ path: 'refusal', message: refusal }],
  });

export function postView(p: CommunityPostRow): CommunityPost {
  return {
    id: p.id,
    author: {
      kind: p.author,
      profile_id: p.author === 'member' ? p.profileId : null,
      nickname: p.nickname,
      avatar_url: p.avatarUrl,
    },
    body: p.body,
    auto: p.autoKind ? { kind: p.autoKind, data: p.data ?? {} } : null,
    attachment: p.attachmentType && p.attachmentId ? { type: p.attachmentType, id: p.attachmentId } : null,
    photo_url: p.photoUrl,
    pinned: p.pinned,
    status: p.visibility === 'public' ? 'published' : 'held',
    likes: p.likes,
    comments: p.comments,
    liked_by_me: p.likedByMe,
    created_at: p.createdAt.toISOString(),
  };
}

const commentView = (c: CommunityCommentRow): CommunityComment => ({
  id: c.id,
  author: { profile_id: c.profileId, nickname: c.nickname, avatar_url: c.avatarUrl },
  body: c.body,
  status: c.visibility === 'public' ? 'published' : 'held',
  created_at: c.createdAt.toISOString(),
});

/** Expurgo do conteúdo vencido pelo relógio da ficha (#954), de hora em hora; a primeira rodada sai logo depois de subir. */
export function startCommunityPurge(
  db: Database,
  log: { warn: (obj: object, msg: string) => void },
  everyMs = 3_600_000,
): () => void {
  const run = () => {
    purgeCommunityContent(db, new Date()).catch((err: unknown) =>
      log.warn({ err }, 'expurgo das Comunidades falhou'),
    );
  };
  const first = setTimeout(run, Math.floor(60_000 + Math.random() * 240_000));
  first.unref();
  const timer = setInterval(run, everyMs);
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

export async function communityFeedRoutes(
  app: FastifyInstance,
  deps: CommunityFeedRoutesDeps,
): Promise<void> {
  const gate = new CommunityGate(deps.db);
  const db = () => gate.db();
  const now = () => deps.now?.() ?? new Date();
  const moderation = deps.db ? new ModerationLists(deps.db) : null;

  /** A Comunidade ativa e o torcedor membro dela, senão 409 `not_member`. */
  async function asMember(
    fan: { tenantId: string; profileId: string; locale: string },
    communityId: string,
  ): Promise<{ c: CommunityRow; acceptedTermsVersion: number | null }> {
    await gate.requireModule(fan.tenantId);
    const c = await gate.activeCommunity(fan.tenantId, communityId, fan.locale);
    const standing = await memberStanding(db(), fan.tenantId, communityId, fan.profileId);
    if (!standing.member) throw refuse('not_member', 'Entre na Comunidade para ver e participar do Feed.');
    return { c, acceptedTermsVersion: standing.acceptedTermsVersion };
  }

  /** Início da janela de exibição da Comunidade. */
  const windowStart = (c: CommunityRow, at: Date) =>
    new Date(at.getTime() - (c.historyDays ?? DEFAULT_HISTORY_DAYS) * 86_400_000);

  /** O post visível ao torcedor e a Comunidade dele, com o torcedor membro. */
  async function memberPost(fan: { tenantId: string; profileId: string; locale: string }, postId: string) {
    await gate.requireModule(fan.tenantId);
    const communityId = await communityOfPost(db(), fan.tenantId, postId);
    if (!communityId) throw problems.notFound('Post');
    const member = await asMember(fan, communityId);
    const at = now();
    const post = await readPost(db(), fan.tenantId, postId, fan.profileId, {
      now: at,
      since: windowStart(member.c, at),
    });
    if (!post) throw problems.notFound('Post');
    return { ...member, post };
  }

  /**
   * Tudo o que vale antes de gravar um texto: faixa de idade do banco, Aceite em vigor, punições, intervalo e a base
   * de regras. Devolve o texto limpo, a visibilidade e o relógio de expurgo.
   */
  async function screenWrite(
    fan: { tenantId: string; profileId: string; accountId: string; locale: string },
    c: CommunityRow,
    acceptedTermsVersion: number | null,
    raw: string,
  ) {
    const database = db();
    if (needsNewAcceptance(c.termsVersion, acceptedTermsVersion))
      throw refuse('terms_required', 'Aceite a versão nova dos termos da Comunidade antes de escrever.');
    const at = now();
    const [profile, sanctions, last, lists] = await Promise.all([
      readFan(database, fan.tenantId, fan.profileId),
      activeSanctions(database, {
        tenantId: fan.tenantId,
        profileId: fan.profileId,
        accountId: fan.accountId,
        now: at,
      }),
      lastWriteAt(database, fan.tenantId, c.id, fan.profileId),
      moderation!.forTenant(fan.tenantId),
    ]);
    if (!profile) throw problems.invalidFanToken('Perfil excluído.');
    // a faixa do banco vale sobre a do token (mudou depois de o token sair)
    if (profile.ageBand !== '18plus')
      throw refuse('age_band', 'Só maiores de 18 anos escrevem nas Comunidades.');
    const here = (s: { scope: string; scopeId: string | null }) =>
      s.scope === 'tenant' || (s.scope === 'community' && s.scopeId === c.id);
    const blocking = sanctions.find(
      (s) => here(s) && (s.level === 'suspension' || s.level === 'ban' || (s.level === 'mute' && !s.hidden)),
    );
    if (blocking)
      throw refuse('sanctioned', 'Você não pode escrever agora. Veja suas punições no seu Perfil.');
    const shadowMuted = sanctions.some((s) => here(s) && s.level === 'mute' && s.hidden);
    const text = raw.trim();
    const screened = screen(
      text,
      {
        kind: 'wall_post',
        locale: fan.locale,
        rate: { intervalS: WRITE_INTERVAL_S, lastSentAt: last?.getTime() ?? null, now: at.getTime() },
      },
      lists,
    );
    if (screened.reasons.includes('slow_mode'))
      throw new ProblemError(
        429,
        'RATE_LIMITED',
        'Devagar',
        screenNotice(screened, fan.locale) ?? undefined,
        {
          headers: { 'retry-after': String(screened.retryAfterS ?? WRITE_INTERVAL_S) },
        },
      );
    if (screened.action === 'block')
      throw problems.invalidParams(
        [{ path: 'body', message: screenNotice(screened, fan.locale) ?? 'Texto não permitido.' }],
        'Texto recusado pelas regras da Comunidade.',
      );
    const visibility: 'public' | 'shadow' = screened.action === 'shadow' || shadowMuted ? 'shadow' : 'public';
    const flags = [
      ...screened.reasons,
      ...(screened.suspect ? ['suspect'] : []),
      ...(shadowMuted ? ['muted'] : []),
    ];
    const clocks = await clocksFor(database, fan.tenantId, profile.country, at);
    return { text, visibility, flags, purgeAt: clocks.contentPurgeAt, profile, at };
  }

  app.get(
    '/v1/communities/:communityId/posts',
    { config: READ },
    async (request, reply): Promise<CommunityFeed> => {
      const fan = request.fan!;
      const { communityId } = parseInput(CommunityParams, request.params);
      const q = parseInput(FeedQuery, request.query);
      const { c } = await asMember(fan, communityId);
      const at = now();
      const page = await listFeed(db(), {
        tenantId: fan.tenantId,
        communityId,
        viewerProfileId: fan.profileId,
        before: q.before ?? null,
        limit: q.limit,
        since: windowStart(c, at),
        now: at,
        // bloqueio vale nos dois sentidos (#953): quem bloqueou não vê, e quem foi bloqueado também não
        hiddenAuthors: await hiddenProfilesFor(db(), fan.tenantId, fan.profileId),
      });
      reply.header('x-robots-tag', 'noindex, nofollow');
      return {
        data: { pinned: page.pinned.map(postView), posts: page.posts.map(postView) },
        next: page.posts.length === q.limit ? page.posts[page.posts.length - 1]!.id : null,
      };
    },
  );

  app.post('/v1/communities/:communityId/posts', { config: WRITE }, async (request, reply) => {
    const fan = request.fan!;
    const { communityId } = parseInput(CommunityParams, request.params);
    const body = parseInput(CommunityPostBody, request.body);
    const { c, acceptedTermsVersion } = await asMember(fan, communityId);
    if (!c.memberPosts) throw refuse('member_posts_off', 'Nesta Comunidade, só a equipe publica no Feed.');
    const w = await screenWrite(fan, c, acceptedTermsVersion, body.body);
    const saved = await insertPost(db(), {
      tenantId: fan.tenantId,
      communityId,
      author: 'member',
      profileId: fan.profileId,
      body: w.text,
      attachment: body.attachment ? { type: body.attachment.type, id: body.attachment.id } : null,
      visibility: w.visibility,
      flags: w.flags,
      purgeAt: w.purgeAt,
    });
    const post = await readPost(db(), fan.tenantId, saved.id, fan.profileId, { now: w.at });
    const res: CommunityPostResponse = { data: postView(post!) };
    return reply.code(201).send(res);
  });

  app.get('/v1/posts/:postId/comments', { config: READ }, async (request): Promise<CommunityComments> => {
    const fan = request.fan!;
    const { postId } = parseInput(PostParams, request.params);
    const q = parseInput(CommentsQuery, request.query);
    await memberPost(fan, postId);
    const rows = await listComments(db(), {
      tenantId: fan.tenantId,
      postId,
      viewerProfileId: fan.profileId,
      after: q.after ?? null,
      limit: q.limit,
      now: now(),
      hiddenAuthors: await hiddenProfilesFor(db(), fan.tenantId, fan.profileId),
    });
    return { data: rows.map(commentView), next: rows.length === q.limit ? rows[rows.length - 1]!.id : null };
  });

  app.post('/v1/posts/:postId/comments', { config: WRITE }, async (request, reply) => {
    const fan = request.fan!;
    const { postId } = parseInput(PostParams, request.params);
    const body = parseInput(CommunityCommentBody, request.body);
    const { c, acceptedTermsVersion } = await memberPost(fan, postId);
    const w = await screenWrite(fan, c, acceptedTermsVersion, body.body);
    const saved = await insertComment(db(), {
      tenantId: fan.tenantId,
      postId,
      profileId: fan.profileId,
      body: w.text,
      visibility: w.visibility,
      flags: w.flags,
      purgeAt: w.purgeAt,
    });
    const res: CommunityCommentResponse = {
      data: commentView({
        id: saved.id,
        postId,
        profileId: fan.profileId,
        nickname: w.profile.nickname,
        avatarUrl: null,
        body: w.text,
        visibility: w.visibility,
        createdAt: saved.createdAt,
      }),
    };
    return reply.code(201).send(res);
  });

  for (const [method, on] of [
    ['PUT', true],
    ['DELETE', false],
  ] as const)
    app.route({
      method,
      url: '/v1/posts/:postId/like',
      config: REACT,
      handler: async (request): Promise<CommunityReactionResponse> => {
        const fan = request.fan!;
        const { postId } = parseInput(PostParams, request.params);
        const { post } = await memberPost(fan, postId);
        // o retido (só o autor vê) não recebe curtida de ninguém além do autor, e o próprio autor não precisa
        if (post.visibility !== 'public') throw problems.notFound('Post');
        // suspensão e banimento no cliente barram também a curtida (como a reação no chat); o silêncio só barra texto
        const sanctions = await activeSanctions(db(), {
          tenantId: fan.tenantId,
          profileId: fan.profileId,
          accountId: fan.accountId,
          now: now(),
        });
        if (sanctions.some((x) => x.scope === 'tenant' && (x.level === 'ban' || x.level === 'suspension')))
          throw refuse('sanctioned', 'Você não pode participar agora. Veja suas punições no seu Perfil.');
        const likes = await setReaction(db(), {
          tenantId: fan.tenantId,
          postId,
          profileId: fan.profileId,
          on,
        });
        return { data: { liked: on, likes } };
      },
    });
}
