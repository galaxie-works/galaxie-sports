import * as z from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { Problem } from './common.js';
import { CommunityParams } from './communities.js';

/**
 * Enquetes (#947): motor único da Comunidade e da Sala do Jogo. O servidor do cliente cria e fecha (chave secreta);
 * o torcedor vota com o token `gft_` (13 a 17 também vota). Um voto por torcedor, resultado ao vivo. O craque do
 * jogo monta as opções com a escalação.
 */

export const COMMUNITY_POLL_KIND_VALUES = ['free', 'man_of_match'] as const;
export const COMMUNITY_POLL_SCOPE_VALUES = ['community', 'room'] as const;
export const COMMUNITY_VOTE_REFUSALS = ['closed', 'already_voted', 'not_member', 'bad_option'] as const;

export const PollParams = z.object({ pollId: z.uuid().meta({ description: 'ID da enquete.' }) });
export type PollParams = z.infer<typeof PollParams>;

export const RoomPollsParams = z.object({
  fixtureId: z.uuid().meta({ description: 'ID do jogo (o mesmo de /v1/events/{id}).' }),
});
export type RoomPollsParams = z.infer<typeof RoomPollsParams>;

export const PollsQuery = z.object({
  before: z.uuid().optional().meta({ description: 'Página seguinte: o `next` da página anterior.' }),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type PollsQuery = z.infer<typeof PollsQuery>;

export const CommunityPollOption = z
  .object({
    id: z.uuid(),
    label: z
      .string()
      .nullable()
      .meta({ description: 'Texto da opção; no craque do jogo, null (use `person`).' }),
    person: z.object({ id: z.uuid(), name: z.string().nullable() }).nullable(),
    team: z.object({ id: z.uuid(), name: z.string().nullable() }).nullable(),
    votes: z.number().int(),
    share: z.number().meta({ description: 'Fração dos votos (0 a 1), para a barra do resultado.' }),
  })
  .meta({ id: 'CommunityPollOption' });

export const CommunityPoll = z
  .object({
    id: z.uuid(),
    scope: z.enum(COMMUNITY_POLL_SCOPE_VALUES),
    community_id: z.uuid().nullable(),
    fixture_id: z.uuid().nullable(),
    kind: z.enum(COMMUNITY_POLL_KIND_VALUES),
    question: z
      .string()
      .nullable()
      .meta({ description: 'Pergunta; no craque do jogo, null (o texto sai no idioma da tela).' }),
    open: z.boolean(),
    closes_at: z.string().nullable(),
    total_votes: z.number().int(),
    my_option_id: z
      .uuid()
      .nullable()
      .meta({ description: 'Onde o torcedor votou; null sem token ou sem voto.' }),
    options: z.array(CommunityPollOption),
    created_at: z.string(),
  })
  .meta({ id: 'CommunityPoll' });
export type CommunityPoll = z.infer<typeof CommunityPoll>;

export const CommunityPollResponse = z.object({ data: CommunityPoll }).meta({ id: 'CommunityPollResponse' });
export type CommunityPollResponse = z.infer<typeof CommunityPollResponse>;

export const CommunityPollList = z
  .object({ data: z.array(CommunityPoll), next: z.uuid().nullable() })
  .meta({ id: 'CommunityPollList' });
export type CommunityPollList = z.infer<typeof CommunityPollList>;

export const CommunityPollCreateBody = z
  .strictObject({
    community_id: z
      .uuid()
      .optional()
      .meta({ description: 'Enquete da Comunidade. Sem ele, a enquete é da Sala do Jogo.' }),
    fixture_id: z
      .uuid()
      .optional()
      .meta({ description: 'Jogo: obrigatório na Sala do Jogo e no craque do jogo.' }),
    kind: z.enum(COMMUNITY_POLL_KIND_VALUES).default('free'),
    question: z.string().min(1).max(200).optional(),
    options: z
      .array(z.string().min(1).max(120))
      .min(2)
      .max(10)
      .optional()
      .meta({ description: 'Opções da enquete livre (2 a 10). O craque do jogo usa a escalação.' }),
    closes_at: z.iso.datetime({ offset: true }).optional(),
  })
  .meta({ id: 'CommunityPollCreateBody' });
export type CommunityPollCreateBody = z.infer<typeof CommunityPollCreateBody>;

export const CommunityPollPatchBody = z
  .strictObject({ closed: z.literal(true) })
  .meta({ id: 'CommunityPollPatchBody' });
export type CommunityPollPatchBody = z.infer<typeof CommunityPollPatchBody>;

export const CommunityVoteBody = z.strictObject({ option_id: z.uuid() }).meta({ id: 'CommunityVoteBody' });
export type CommunityVoteBody = z.infer<typeof CommunityVoteBody>;

const problem = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: Problem } },
});
const json = (schema: z.ZodType) => ({ 'application/json': { schema } });
const TAG = 'Comunidades';
const fanAuth = [{ galaxieFanToken: [] }];
const errors = {
  '401': problem('Chave ou token ausente, vencido ou inválido'),
  '403': problem('Módulo fora do plano (MODULE_NOT_IN_PLAN) ou faixa etária sem acesso'),
  '429': problem('Limite atingido (RATE_LIMITED)'),
};

/** Paths das enquetes para o documento OpenAPI. */
export const communityPollPaths: ZodOpenApiPathsObject = {
  '/v1/polls': {
    post: {
      summary: 'Criar enquete (servidor do cliente)',
      description:
        'Chave secreta. Com `community_id`, a enquete é da Comunidade (módulo `communities`); sem ele, da Sala do Jogo ' +
        '(módulo `live_chat`, `fixture_id` obrigatório). O craque do jogo (`man_of_match`) usa a escalação do jogo e é ' +
        'um só por jogo e lugar: repetir devolve o mesmo. Pergunta e opções passam pela base de regras.',
      tags: [TAG],
      requestBody: { content: json(CommunityPollCreateBody) },
      responses: {
        '201': { description: 'Criada', content: json(CommunityPollResponse) },
        '200': { description: 'Craque do jogo já existia', content: json(CommunityPollResponse) },
        '400': problem('Pergunta ou opção recusada, ou sem escalação (INVALID_PARAMS)'),
        '404': problem('Comunidade ou jogo não encontrado (NOT_FOUND)'),
        ...errors,
      },
    },
  },
  '/v1/polls/{pollId}': {
    get: {
      summary: 'Enquete com o resultado ao vivo',
      description:
        'Token do torcedor (membro, na enquete de Comunidade). Traz o voto dele em `my_option_id`.',
      tags: [TAG],
      security: fanAuth,
      requestParams: { path: PollParams },
      responses: {
        '200': { description: 'OK', content: json(CommunityPollResponse) },
        '404': problem('Não encontrada'),
        ...errors,
      },
    },
    patch: {
      summary: 'Fechar a votação (servidor do cliente)',
      tags: [TAG],
      requestParams: { path: PollParams },
      requestBody: { content: json(CommunityPollPatchBody) },
      responses: {
        '200': { description: 'OK', content: json(CommunityPollResponse) },
        '404': problem('Não encontrada'),
        ...errors,
      },
    },
  },
  '/v1/polls/{pollId}/votes': {
    post: {
      summary: 'Votar',
      description: `Um voto por torcedor, sem troca. 13 a 17 também vota. Recusa em \`409\` com \`${COMMUNITY_VOTE_REFUSALS.join('`, `')}\`.`,
      tags: [TAG],
      security: fanAuth,
      requestParams: { path: PollParams },
      requestBody: { content: json(CommunityVoteBody) },
      responses: {
        '201': { description: 'Voto contado', content: json(CommunityPollResponse) },
        '404': problem('Não encontrada'),
        '409': problem('Voto recusado (CONFLICT)'),
        ...errors,
      },
    },
  },
  '/v1/communities/{communityId}/polls': {
    get: {
      summary: 'Enquetes da Comunidade',
      description: 'Só para membros, da mais nova para a mais velha.',
      tags: [TAG],
      security: fanAuth,
      requestParams: { path: CommunityParams, query: PollsQuery },
      responses: { '200': { description: 'OK', content: json(CommunityPollList) }, ...errors },
    },
  },
  '/v1/chat/rooms/{fixtureId}/polls': {
    get: {
      summary: 'Enquetes da Sala do Jogo',
      description:
        'Chave do cliente (publicável no navegador), como a leitura da sala. Exige o módulo `live_chat`.',
      tags: [TAG],
      requestParams: { path: RoomPollsParams, query: PollsQuery },
      responses: { '200': { description: 'OK', content: json(CommunityPollList) }, ...errors },
    },
  },
};
