import * as z from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { Problem } from './common.js';

/**
 * Denúncia, bloqueio, punição e apelação do torcedor (#953, docs/05 §9). Tudo com o token `gft_` do torcedor; a
 * fila de moderação em si (denúncias, filtro, Cosmos e apelações) fica no painel do cliente.
 */

export const MODERATION_REPORT_TARGETS = [
  'message',
  'comment',
  'post',
  'profile',
  'community_name',
  'league_name',
  'behavior',
] as const;
export const MODERATION_REPORT_REASONS = [
  'hate',
  'harassment',
  'threat',
  'sexual',
  'spam',
  'betting',
  'personal_data',
  'other',
] as const;
export const MODERATION_MODULES = ['chat', 'communities', 'gamification', 'shopping', 'profile'] as const;

const Ref = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[\w.:@|-]+$/, 'use só letras, números e . _ : @ | -');

/** Corpo de `POST /v1/moderation/reports`. */
export const ModerationReportBody = z
  .strictObject({
    targetType: z.enum(MODERATION_REPORT_TARGETS),
    targetId: Ref.meta({ description: 'Id do conteúdo no módulo (mensagem, post) ou do Perfil.' }),
    targetProfileId: z.uuid().optional().meta({ description: 'Perfil autor do conteúdo, quando se sabe.' }),
    module: z.enum(MODERATION_MODULES),
    room: Ref.optional().meta({ description: 'Sala do Jogo, quando houver.' }),
    community: Ref.optional().meta({ description: 'Comunidade, quando houver.' }),
    reason: z.enum(MODERATION_REPORT_REASONS),
    note: z.string().trim().max(500).optional(),
  })
  .meta({ id: 'ModerationReportBody' });
export type ModerationReportBody = z.infer<typeof ModerationReportBody>;

export const ModerationReportResponse = z
  .object({
    data: z.object({
      case_id: z.uuid(),
      hidden: z.boolean().meta({ description: 'O conteúdo ficou oculto até a revisão.' }),
      duplicate: z.boolean().meta({ description: 'Este torcedor já tinha denunciado o mesmo conteúdo.' }),
    }),
  })
  .meta({ id: 'ModerationReportResponse' });
export type ModerationReportResponse = z.infer<typeof ModerationReportResponse>;

export const FanBlocks = z
  .object({
    data: z.array(
      z.object({ profile_id: z.uuid(), created_at: z.string().meta({ description: 'ISO 8601.' }) }),
    ),
  })
  .meta({ id: 'FanBlocks' });
export type FanBlocks = z.infer<typeof FanBlocks>;

export const FanBlockParams = z.object({ profileId: z.uuid() });

export const FanSanctions = z
  .object({
    data: z.array(
      z.object({
        id: z.uuid(),
        level: z.enum(['warning', 'mute', 'suspension', 'expulsion', 'ban']),
        scope: z.enum(['place', 'community', 'tenant']),
        scope_id: z.string().nullable(),
        reason: z.string(),
        starts_at: z.string(),
        ends_at: z.string().nullable(),
        revoked_at: z.string().nullable(),
        active: z.boolean(),
        appeals: z.array(
          z.object({
            id: z.uuid(),
            stage: z.number().int(),
            status: z.enum(['pending', 'upheld', 'overturned']),
            due_at: z.string(),
          }),
        ),
      }),
    ),
  })
  .meta({ id: 'FanSanctions' });
export type FanSanctions = z.infer<typeof FanSanctions>;

export const FanSanctionParams = z.object({ sanctionId: z.uuid() });

export const FanAppealBody = z
  .strictObject({ statement: z.string().trim().min(1).max(2000).optional() })
  .meta({ id: 'FanAppealBody' });
export type FanAppealBody = z.infer<typeof FanAppealBody>;

export const FanAppealResponse = z
  .object({
    data: z.object({
      appeal_id: z.uuid(),
      stage: z.number().int(),
      route: z.enum(['team', 'galaxie']).meta({
        description: '`team`: equipe do cliente; `galaxie`: segunda apelação, na fila da Galaxie.',
      }),
      due_at: z.string(),
    }),
  })
  .meta({ id: 'FanAppealResponse' });
export type FanAppealResponse = z.infer<typeof FanAppealResponse>;

const problem = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: Problem } },
});
const json = (schema: z.ZodType) => ({ 'application/json': { schema } });
const TAG = 'Torcedor';
const fanAuth = [{ galaxieFanToken: [] }];
const common = {
  '401': problem('Token ausente, inválido, vencido ou de Perfil excluído (INVALID_KEY)'),
  '403': problem('Faixa etária sem permissão (FAN_AGE_RESTRICTED)'),
  '429': problem('Limite atingido (RATE_LIMITED)'),
};

/** Paths da moderação do torcedor para o documento OpenAPI. */
export const moderationPaths: ZodOpenApiPathsObject = {
  '/v1/moderation/reports': {
    post: {
      summary: 'Denuncia um conteúdo ou Perfil',
      description:
        'O torcedor denuncia mensagem, comentário, post, Perfil, nome de Comunidade ou Liga, ou comportamento. ' +
        'Denunciar de novo o mesmo conteúdo não conta duas vezes (`duplicate`). Com denúncias de torcedores ' +
        'diferentes o conteúdo fica oculto até a revisão. Mais de 20 denúncias por hora: 429.',
      tags: [TAG],
      security: fanAuth,
      requestBody: { content: json(ModerationReportBody) },
      responses: {
        '201': { description: 'Denúncia na fila', content: json(ModerationReportResponse) },
        '400': problem('Campo inválido (INVALID_PARAMS)'),
        '409': problem('Denúncia do próprio conteúdo (CONFLICT)'),
        ...common,
      },
    },
  },
  '/v1/fans/me/blocks': {
    get: {
      summary: 'Perfis que o torcedor bloqueou',
      tags: [TAG],
      security: fanAuth,
      responses: { '200': { description: 'OK', content: json(FanBlocks) }, ...common },
    },
  },
  '/v1/fans/me/blocks/{profileId}': {
    put: {
      summary: 'Bloqueia um Perfil',
      description:
        'O bloqueio vale nos dois sentidos: nenhum dos dois vê o outro. Repetir responde 204 de novo.',
      tags: [TAG],
      security: fanAuth,
      requestParams: { path: FanBlockParams },
      responses: {
        '204': { description: 'Bloqueado' },
        '404': problem('Perfil não encontrado (NOT_FOUND)'),
        '409': problem('Bloquear o próprio Perfil (CONFLICT)'),
        ...common,
      },
    },
    delete: {
      summary: 'Desbloqueia um Perfil',
      tags: [TAG],
      security: fanAuth,
      requestParams: { path: FanBlockParams },
      responses: { '204': { description: 'Desbloqueado (ou não estava bloqueado)' }, ...common },
    },
  },
  '/v1/fans/me/sanctions': {
    get: {
      summary: 'Punições do torcedor',
      description: 'Advertências, silêncios, suspensões, expulsões e banimentos do Perfil, com as apelações.',
      tags: [TAG],
      security: fanAuth,
      responses: { '200': { description: 'OK', content: json(FanSanctions) }, ...common },
    },
  },
  '/v1/fans/me/sanctions/{sanctionId}/appeals': {
    post: {
      summary: 'Apela de uma punição',
      description:
        'Uma apelação por punição, julgada por quem não aplicou. Se a resposta veio da Cosmos, cabe uma segunda ' +
        'apelação, julgada por uma pessoa (ou pela Galaxie, se o cliente não tiver quem julgue).',
      tags: [TAG],
      security: fanAuth,
      requestParams: { path: FanSanctionParams },
      requestBody: { content: json(FanAppealBody) },
      responses: {
        '201': { description: 'Apelação na fila', content: json(FanAppealResponse) },
        '400': problem('Campo inválido (INVALID_PARAMS)'),
        '404': problem('Punição não encontrada (NOT_FOUND)'),
        '409': problem('Já apelou, apelação pendente ou sem segunda apelação (CONFLICT)'),
        ...common,
      },
    },
  },
};
