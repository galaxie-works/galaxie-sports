import * as z from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { Problem } from './common.js';

/**
 * Comunidades (épico #936, #939): uma Comunidade por Âncora (esporte, campeonato, time ou atleta) em cada cliente. O
 * cliente liga o escopo no console; o torcedor nunca cria. Tudo exige o token `gft_` do torcedor: sem login não
 * aparece nada, e quem não é membro vê só a vitrine.
 */

export const COMMUNITY_ANCHOR_TYPE_VALUES = ['sport', 'competition', 'participant', 'person'] as const;
export const COMMUNITY_JOIN_MODE_VALUES = ['open', 'approval', 'closed'] as const;
export const COMMUNITY_MEMBERSHIP_VALUES = ['active', 'left', 'removed'] as const;
export const COMMUNITY_JOIN_RESULTS = ['joined', 'already_member', 'requested', 'already_requested'] as const;
export const COMMUNITY_JOIN_REFUSALS = [
  'not_active',
  'invite_required',
  'invite_invalid',
  'terms_required',
  'removed',
] as const;

export const CommunityParams = z.object({
  communityId: z.uuid().meta({ description: 'ID da Comunidade.' }),
});
export type CommunityParams = z.infer<typeof CommunityParams>;

export const CommunityTermsParams = CommunityParams.extend({
  version: z.coerce.number().int().min(1).meta({ description: 'Versão dos termos.' }),
});
export type CommunityTermsParams = z.infer<typeof CommunityTermsParams>;

export const CommunitySummary = z
  .object({
    id: z.uuid(),
    name: z
      .string()
      .nullable()
      .meta({ description: 'Nome da Âncora (nome de competição e de time não se traduz).' }),
    anchor: z.object({
      type: z.enum(COMMUNITY_ANCHOR_TYPE_VALUES),
      id: z.string().meta({ description: 'Slug do esporte ou ID da entidade (o mesmo das rotas de dados).' }),
      sport: z.string().nullable(),
    }),
    join_mode: z.enum(COMMUNITY_JOIN_MODE_VALUES),
    members: z.number().int(),
    terms_version: z
      .number()
      .int()
      .nullable()
      .meta({ description: 'Versão dos termos em vigor; null = só a regra de conduta da base.' }),
    me: z.object({
      membership: z.enum(COMMUNITY_MEMBERSHIP_VALUES).nullable(),
      pending_request: z.boolean(),
      accepted_terms_version: z.number().int().nullable(),
      needs_acceptance: z
        .boolean()
        .meta({
          description: 'Membro com termos mais novos que o último Aceite: lê, mas aceita antes de escrever.',
        }),
    }),
  })
  .meta({ id: 'CommunitySummary' });
export type CommunitySummary = z.infer<typeof CommunitySummary>;

export const CommunityList = z.object({ data: z.array(CommunitySummary) }).meta({ id: 'CommunityList' });
export type CommunityList = z.infer<typeof CommunityList>;

export const CommunityDetail = z
  .object({
    data: CommunitySummary.extend({
      features: z.object({
        member_posts: z.boolean(),
        chat: z.boolean().meta({ description: 'Chat da Comunidade ligado pelo cliente.' }),
      }),
    }),
  })
  .meta({ id: 'CommunityDetail' });
export type CommunityDetail = z.infer<typeof CommunityDetail>;

export const CommunityJoinBody = z
  .strictObject({
    accepted_terms_version: z
      .number()
      .int()
      .min(1)
      .nullish()
      .meta({
        description: 'Versão dos termos que o torcedor leu e aceitou (obrigatória quando há termos).',
      }),
    invite_code: z
      .string()
      .min(8)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/)
      .nullish()
      .meta({ description: 'Código do convite (entrada fechada, ou para pular a aprovação).' }),
  })
  .meta({ id: 'CommunityJoinBody' });
export type CommunityJoinBody = z.infer<typeof CommunityJoinBody>;

export const CommunityJoinResponse = z
  .object({ data: z.object({ result: z.enum(COMMUNITY_JOIN_RESULTS) }) })
  .meta({ id: 'CommunityJoinResponse' });
export type CommunityJoinResponse = z.infer<typeof CommunityJoinResponse>;

export const CommunityAcceptBody = z
  .strictObject({ version: z.number().int().min(1) })
  .meta({ id: 'CommunityAcceptBody' });
export type CommunityAcceptBody = z.infer<typeof CommunityAcceptBody>;

export const CommunityTerms = z
  .object({
    data: z.object({
      version: z.number().int(),
      text: z.string().meta({ description: 'Texto no idioma do torcedor (pt, es ou en).' }),
      published_at: z.string(),
    }),
  })
  .meta({ id: 'CommunityTerms' });
export type CommunityTerms = z.infer<typeof CommunityTerms>;

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

/** Paths das Comunidades para o documento OpenAPI. */
export const communityPaths: ZodOpenApiPathsObject = {
  '/v1/communities': {
    get: {
      summary: 'Comunidades do cliente',
      description:
        'As Comunidades ativas do cliente, em ordem alfabética do idioma do torcedor, com o que ele tem em cada uma. ' +
        'Exige o token do torcedor e o módulo `communities`.',
      tags: [TAG],
      security: fanAuth,
      responses: { '200': { description: 'OK', content: json(CommunityList) }, ...fanErrors },
    },
  },
  '/v1/communities/{communityId}': {
    get: {
      summary: 'Vitrine da Comunidade',
      description:
        'Nome, Âncora, membros, Modo de entrada e termos em vigor. Feed, Chat e Lista são só para membros.',
      tags: [TAG],
      security: fanAuth,
      requestParams: { path: CommunityParams },
      responses: {
        '200': { description: 'OK', content: json(CommunityDetail) },
        '404': problem('Comunidade não encontrada ou fora do ar (NOT_FOUND)'),
        ...fanErrors,
      },
    },
  },
  '/v1/communities/{communityId}/terms/{version}': {
    get: {
      summary: 'Termos da Comunidade',
      tags: [TAG],
      security: fanAuth,
      requestParams: { path: CommunityTermsParams },
      responses: {
        '200': { description: 'OK', content: json(CommunityTerms) },
        '404': problem('Versão não encontrada (NOT_FOUND)'),
        ...fanErrors,
      },
    },
  },
  '/v1/communities/{communityId}/join': {
    post: {
      summary: 'Entrar na Comunidade',
      description:
        'Aberta: entra direto. Com aprovação: abre um pedido na fila do cliente. Fechada: só com convite. Com termos ' +
        'em vigor, mande a versão aceita. Recusa em `409` com o motivo em `errors[].message` (`' +
        COMMUNITY_JOIN_REFUSALS.join('`, `') +
        '`).',
      tags: [TAG],
      security: fanAuth,
      requestParams: { path: CommunityParams },
      requestBody: { content: json(CommunityJoinBody) },
      responses: {
        '200': { description: 'OK', content: json(CommunityJoinResponse) },
        '404': problem('Comunidade não encontrada (NOT_FOUND)'),
        '409': problem('Entrada recusada (CONFLICT)'),
        ...fanErrors,
      },
    },
  },
  '/v1/communities/{communityId}/leave': {
    post: {
      summary: 'Sair da Comunidade',
      description: 'Sai (ou retira o pedido aberto). Repetir não dá erro.',
      tags: [TAG],
      security: fanAuth,
      requestParams: { path: CommunityParams },
      responses: {
        '204': { description: 'Saiu' },
        '404': problem('Comunidade não encontrada (NOT_FOUND)'),
        ...fanErrors,
      },
    },
  },
  '/v1/communities/{communityId}/accept': {
    post: {
      summary: 'Aceitar a versão nova dos termos',
      tags: [TAG],
      security: fanAuth,
      requestParams: { path: CommunityParams },
      requestBody: { content: json(CommunityAcceptBody) },
      responses: {
        '204': { description: 'Aceite registrado' },
        '404': problem('Comunidade ou versão não encontrada (NOT_FOUND)'),
        ...fanErrors,
      },
    },
  },
};
