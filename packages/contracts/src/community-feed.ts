import * as z from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { Problem } from './common.js';
import { CommunityParams } from './communities.js';

/**
 * Feed das Comunidades (#946): posts curtos com texto e card de jogo, time ou jogador anexado, comentários e
 * curtidas. Só membros leem; só `18plus` escreve (13 a 17 lê e curte). Texto passa pela base de regras (#969); loja
 * nunca aparece como post. Foto só de cargos da equipe, até a moderação de imagem do Feed.
 */

export const COMMUNITY_POST_AUTHOR_VALUES = ['system', 'staff', 'member'] as const;
export const COMMUNITY_POST_ATTACHMENT_VALUES = ['event', 'participant', 'person'] as const;
export const COMMUNITY_WRITE_REFUSALS = [
  'not_member',
  'member_posts_off',
  'terms_required',
  'sanctioned',
  'age_band',
] as const;

export const PostParams = z.object({ postId: z.uuid().meta({ description: 'ID do post.' }) });
export type PostParams = z.infer<typeof PostParams>;

export const FeedQuery = z.object({
  before: z.uuid().optional().meta({ description: 'Página seguinte: o `next` da página anterior.' }),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type FeedQuery = z.infer<typeof FeedQuery>;

export const CommentsQuery = z.object({
  after: z.uuid().optional().meta({ description: 'Comentários depois deste (o `next` da página anterior).' }),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type CommentsQuery = z.infer<typeof CommentsQuery>;

const Author = z.object({
  kind: z.enum(COMMUNITY_POST_AUTHOR_VALUES),
  profile_id: z.uuid().nullable(),
  nickname: z.string().nullable(),
  avatar_url: z.string().nullable(),
});

export const CommunityPost = z
  .object({
    id: z.uuid(),
    author: Author,
    body: z.string().nullable().meta({ description: 'Texto do post; null no post automático (use `auto`).' }),
    auto: z
      .object({ kind: z.string(), data: z.record(z.string(), z.unknown()) })
      .nullable()
      .meta({
        description: 'Post automático do jogo: o tipo e os dados (o texto sai no idioma de quem lê).',
      }),
    attachment: z.object({ type: z.enum(COMMUNITY_POST_ATTACHMENT_VALUES), id: z.uuid() }).nullable(),
    photo_url: z.string().nullable(),
    pinned: z.boolean(),
    status: z
      .enum(['published', 'held'])
      .meta({ description: '`held`: retido pela moderação, só o autor vê.' }),
    likes: z.number().int(),
    comments: z.number().int(),
    liked_by_me: z.boolean(),
    created_at: z.string(),
  })
  .meta({ id: 'CommunityPost' });
export type CommunityPost = z.infer<typeof CommunityPost>;

export const CommunityFeed = z
  .object({
    data: z.object({ pinned: z.array(CommunityPost), posts: z.array(CommunityPost) }),
    next: z.uuid().nullable(),
  })
  .meta({ id: 'CommunityFeed' });
export type CommunityFeed = z.infer<typeof CommunityFeed>;

export const CommunityPostBody = z
  .strictObject({
    body: z.string().min(1).max(5000),
    attachment: z.object({ type: z.enum(COMMUNITY_POST_ATTACHMENT_VALUES), id: z.uuid() }).nullish(),
  })
  .meta({ id: 'CommunityPostBody' });
export type CommunityPostBody = z.infer<typeof CommunityPostBody>;

export const CommunityPostResponse = z.object({ data: CommunityPost }).meta({ id: 'CommunityPostResponse' });
export type CommunityPostResponse = z.infer<typeof CommunityPostResponse>;

export const CommunityComment = z
  .object({
    id: z.uuid(),
    author: Author.omit({ kind: true }),
    body: z.string(),
    status: z.enum(['published', 'held']),
    created_at: z.string(),
  })
  .meta({ id: 'CommunityComment' });
export type CommunityComment = z.infer<typeof CommunityComment>;

export const CommunityComments = z
  .object({ data: z.array(CommunityComment), next: z.uuid().nullable() })
  .meta({ id: 'CommunityComments' });
export type CommunityComments = z.infer<typeof CommunityComments>;

export const CommunityCommentBody = z
  .strictObject({ body: z.string().min(1).max(2000) })
  .meta({ id: 'CommunityCommentBody' });
export type CommunityCommentBody = z.infer<typeof CommunityCommentBody>;

export const CommunityCommentResponse = z
  .object({ data: CommunityComment })
  .meta({ id: 'CommunityCommentResponse' });
export type CommunityCommentResponse = z.infer<typeof CommunityCommentResponse>;

export const CommunityReactionResponse = z
  .object({ data: z.object({ liked: z.boolean(), likes: z.number().int() }) })
  .meta({ id: 'CommunityReactionResponse' });
export type CommunityReactionResponse = z.infer<typeof CommunityReactionResponse>;

const problem = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: Problem } },
});
const json = (schema: z.ZodType) => ({ 'application/json': { schema } });
const TAG = 'Comunidades';
const fanAuth = [{ galaxieFanToken: [] }];
const fanErrors = {
  '401': problem('Token do torcedor ausente, vencido ou inválido'),
  '403': problem('Módulo communities fora do plano (MODULE_NOT_IN_PLAN) ou faixa etária sem acesso'),
  '429': problem('Limite atingido (RATE_LIMITED)'),
};
const refusals = `Recusa em \`409\` com o motivo em \`errors[].message\` (\`${COMMUNITY_WRITE_REFUSALS.join('`, `')}\`).`;

/** Paths do Feed das Comunidades para o documento OpenAPI. */
export const communityFeedPaths: ZodOpenApiPathsObject = {
  '/v1/communities/{communityId}/posts': {
    get: {
      summary: 'Feed da Comunidade',
      description: 'Só para membros. Do mais novo para o mais velho; os fixados vêm na primeira página.',
      tags: [TAG],
      security: fanAuth,
      requestParams: { path: CommunityParams, query: FeedQuery },
      responses: {
        '200': { description: 'OK', content: json(CommunityFeed) },
        '404': problem('Comunidade não encontrada (NOT_FOUND)'),
        '409': problem('Não é membro (CONFLICT)'),
        ...fanErrors,
      },
    },
    post: {
      summary: 'Publicar no Feed',
      description: `Só membro \`18plus\`, com o post de membro ligado e o Aceite dos termos em vigor. ${refusals}`,
      tags: [TAG],
      security: fanAuth,
      requestParams: { path: CommunityParams },
      requestBody: { content: json(CommunityPostBody) },
      responses: {
        '201': { description: 'Publicado ou retido', content: json(CommunityPostResponse) },
        '400': problem('Texto recusado pelas regras (INVALID_PARAMS)'),
        '409': problem('Envio recusado (CONFLICT)'),
        ...fanErrors,
      },
    },
  },
  '/v1/posts/{postId}/comments': {
    get: {
      summary: 'Comentários do post',
      tags: [TAG],
      security: fanAuth,
      requestParams: { path: PostParams, query: CommentsQuery },
      responses: {
        '200': { description: 'OK', content: json(CommunityComments) },
        '404': problem('Post não encontrado (NOT_FOUND)'),
        ...fanErrors,
      },
    },
    post: {
      summary: 'Comentar',
      description: `Só membro \`18plus\` com o Aceite dos termos em vigor. ${refusals}`,
      tags: [TAG],
      security: fanAuth,
      requestParams: { path: PostParams },
      requestBody: { content: json(CommunityCommentBody) },
      responses: {
        '201': { description: 'Publicado ou retido', content: json(CommunityCommentResponse) },
        '400': problem('Texto recusado pelas regras (INVALID_PARAMS)'),
        '404': problem('Post não encontrado (NOT_FOUND)'),
        '409': problem('Envio recusado (CONFLICT)'),
        ...fanErrors,
      },
    },
  },
  '/v1/posts/{postId}/like': {
    put: {
      summary: 'Curtir',
      description: 'Membro curte, inclusive de 13 a 17 anos. Repetir não duplica.',
      tags: [TAG],
      security: fanAuth,
      requestParams: { path: PostParams },
      responses: {
        '200': { description: 'OK', content: json(CommunityReactionResponse) },
        '404': problem('Post não encontrado (NOT_FOUND)'),
        ...fanErrors,
      },
    },
    delete: {
      summary: 'Descurtir',
      tags: [TAG],
      security: fanAuth,
      requestParams: { path: PostParams },
      responses: {
        '200': { description: 'OK', content: json(CommunityReactionResponse) },
        '404': problem('Post não encontrado (NOT_FOUND)'),
        ...fanErrors,
      },
    },
  },
};
