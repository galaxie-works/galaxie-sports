import * as z from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { Problem } from './common.js';

/**
 * Identidade do torcedor (#937, docs/05 §9): o servidor do cliente pede um token curto (`gft_`) com a chave
 * secreta e o entrega ao widget ou app. Só ids do cliente (pseudônimos), Apelido, avatar, faixa etária, país e
 * idioma. Campos fora da lista são recusados: nunca e-mail, documento, telefone, senha ou data de nascimento.
 */

/** Faixas do token (#1105). `13_17` é a faixa larga de antes: ainda aceita, vale como `13` (a mais restritiva). */
export const FAN_TOKEN_AGE_BANDS = ['under13', '13', '14_15', '16_17', '18plus', '13_17'] as const;
/** Faixa larga (a que as rotas e os widgets de hoje leem). */
export const FAN_AGE_BANDS_COARSE = ['under13', '13_17', '18plus'] as const;
export const FAN_AGE_BANDS_DETAIL = ['under13', '13', '14_15', '16_17', '18plus'] as const;
export const FAN_AGE_ASSURANCE_METHODS = ['self', 'estimated', 'verified'] as const;
export const FAN_GUARDIAN_STATUSES = ['none', 'pending', 'granted', 'revoked'] as const;
export const FAN_AGE_STATUSES = [
  'blocked',
  'needs_guardian',
  'needs_verification',
  'read_only',
  'can_write',
] as const;

const ExternalId = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[\w.:@|-]+$/, 'use só letras, números e . _ : @ | -');

const Country = z
  .string()
  .regex(/^[A-Za-z]{2}$/)
  .transform((s) => s.toUpperCase())
  .meta({ description: 'País do torcedor, ISO 3166-1 alfa-2.', example: 'BR' });

const Locale = z
  .string()
  .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
  .meta({ description: 'Idioma (BCP 47 curto).', example: 'pt-BR' });

const Nickname = z
  .string()
  .trim()
  .min(2)
  .max(32)
  .refine(
    (s) => ![...s].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127),
    'sem caracteres de controle',
  )
  .meta({ description: 'Apelido mostrado aos outros torcedores.', example: 'Tricolor_77' });

const HttpsUrl = z
  .url()
  .max(500)
  .refine((s) => s.startsWith('https://'), 'só https')
  .meta({ description: 'Avatar em https.' });

/** Corpo de `POST /v1/fans/tokens`. Estrito: campo desconhecido é 400. */
export const FanTokenBody = z
  .strictObject({
    externalAccountId: ExternalId.meta({
      description: 'Id da Conta no seu sistema (o Titular). Nunca e-mail ou documento.',
      example: 'acc_8f2c1d',
    }),
    externalProfileId: ExternalId.meta({
      description: 'Id do Perfil no seu sistema. Uma Conta pode ter vários Perfis.',
      example: 'prof_3a9b',
    }),
    nickname: Nickname,
    avatarUrl: HttpsUrl.optional(),
    ageBand: z.enum(FAN_TOKEN_AGE_BANDS).meta({
      description:
        'Faixa etária do Perfil, informada pela sua plataforma (nunca a data de nascimento). `under13` recebe ' +
        'token, mas toda rota social responde 403; de `13` a `16_17` lê e palpita, não escreve nem resgata; ' +
        '`18plus` tudo, conforme a ficha do país. `13_17` (faixa antiga) ainda é aceito e vale como `13`.',
    }),
    ageAssurance: z
      .strictObject({
        method: z.enum(FAN_AGE_ASSURANCE_METHODS).meta({
          description: '`self` = declarada; `estimated` = estimativa de idade; `verified` = verificação.',
        }),
        at: z
          .union([z.iso.date(), z.iso.datetime({ offset: true })])
          // comprovação no futuro não existe (um dia de folga para fuso e relógio)
          .refine((v) => Date.parse(v) <= Date.now() + 86_400_000, 'data no futuro')
          .meta({ description: 'Quando a idade foi comprovada (ISO 8601).', example: '2026-11-01' }),
        provider: z
          .string()
          .trim()
          .min(1)
          .max(64)
          .regex(/^[\w .:-]+$/, 'use só letras, números, espaço e . _ : -')
          .optional()
          .meta({ description: 'Quem estimou ou verificou. Nunca o documento nem a foto.' }),
      })
      .optional()
      .meta({ description: 'Como a idade foi comprovada. Sem o bloco, vale `self`.' }),
    guardian: z
      .strictObject({
        status: z.enum(FAN_GUARDIAN_STATUSES),
        consentId: ExternalId.optional().meta({
          description:
            'Id da autorização guardada no Galaxie. Sem ele, a prova da autorização fica com você (contrato).',
        }),
        linkedAccount: z
          .boolean()
          .optional()
          .meta({ description: 'A conta do menor está vinculada à do responsável no seu sistema.' }),
      })
      .optional()
      .meta({ description: 'Autorização do responsável legal. Sem o bloco, `none`.' }),
    country: Country,
    locale: Locale,
    holderAdult: z.enum(['yes', 'no', 'unknown']).default('unknown').meta({
      description:
        'O Titular da Conta é adulto? Sem `yes`, o Prêmio de um Perfil desta Conta fica pendente com você.',
    }),
    surface: z.enum(['web', 'store_app']).default('web').meta({
      description: '`store_app` = app de loja (Apple ou Google), onde bloquear torcedor é obrigatório.',
    }),
    favoriteTeamId: z.uuid().optional().meta({ description: 'Time do coração (id do Galaxie).' }),
  })
  .meta({ id: 'FanTokenBody' });
export type FanTokenBody = z.infer<typeof FanTokenBody>;

export const FanTokenResponse = z
  .object({
    data: z.object({
      token: z.string().meta({
        description:
          'Vai em `Authorization: Bearer` nas rotas do torcedor. Não guarde: peça outro ao vencer.',
        example: 'gft_eyJ2IjoxLCJraWQiOi….Zm9v',
      }),
      expires_at: z.iso.datetime(),
      expires_in: z.number().int().meta({ example: 900 }),
      profile_id: z.uuid().meta({ description: 'Id do Perfil no Galaxie.' }),
    }),
  })
  .meta({ id: 'FanToken' });
export type FanTokenResponse = z.infer<typeof FanTokenResponse>;

const Visibility = z.enum(['public', 'private']);
export const FanVisibilityBody = z.strictObject({
  avatar: Visibility.optional(),
  favorite_team: Visibility.optional(),
  level: Visibility.optional(),
  badges: Visibility.optional(),
});

export const FanMe = z
  .object({
    data: z.object({
      profile_id: z.uuid(),
      nickname: z.string(),
      avatar_url: z.string().nullable(),
      age_band: z.enum(FAN_AGE_BANDS_COARSE),
      age_band_detail: z
        .enum(FAN_AGE_BANDS_DETAIL)
        .nullable()
        .meta({ description: 'Faixa fina; null em Perfil gravado antes dela, só com a faixa larga.' }),
      age_assurance: z.object({
        method: z.enum(FAN_AGE_ASSURANCE_METHODS),
        at: z.string().nullable().meta({ description: 'ISO 8601.' }),
      }),
      guardian: z.object({
        status: z.enum(FAN_GUARDIAN_STATUSES),
        linked_account: z.boolean(),
      }),
      age_status: z.enum(FAN_AGE_STATUSES).meta({
        description:
          'O que falta para o Perfil usar os recursos sociais no país dele: `blocked`, `needs_guardian`, ' +
          '`needs_verification`, `read_only` ou `can_write`.',
      }),
      country: z.string(),
      locale: z.string(),
      favorite_team_id: z.uuid().nullable(),
      visibility: FanVisibilityBody,
      capabilities: z.array(z.enum(['read', 'predict', 'write', 'redeem'])).meta({
        description: 'O que a faixa permite, para o widget esconder o que o Perfil não pode usar.',
      }),
      holder_adult: z.enum(['yes', 'no', 'unknown']),
    }),
  })
  .meta({ id: 'FanMe' });
export type FanMe = z.infer<typeof FanMe>;

/** Corpo de `PATCH /v1/fans/me`: o torcedor muda só a visibilidade e o time do coração. */
export const FanMePatchBody = z
  .strictObject({
    favoriteTeamId: z.uuid().nullable().optional(),
    visibility: FanVisibilityBody.optional(),
  })
  .refine((b) => b.favoriteTeamId !== undefined || b.visibility !== undefined, 'nada para mudar')
  .meta({ id: 'FanMePatchBody' });
export type FanMePatchBody = z.infer<typeof FanMePatchBody>;

/** `GET /v1/fans/me/wallet`: Pontos e Saldo do Perfil, um item por país de programa (#938). */
export const FanWallet = z
  .object({
    data: z.array(
      z.object({
        program_country: z
          .string()
          .meta({ description: 'País do programa (Pontos e Ranking são por cliente e país).' }),
        points: z.number().int().meta({ description: 'Pontos: só sobem; definem Nível e Ranking.' }),
        balance: z.number().int().meta({ description: 'Saldo: o que se pode gastar no resgate (só 18+).' }),
      }),
    ),
  })
  .meta({ id: 'FanWallet' });
export type FanWallet = z.infer<typeof FanWallet>;

export const FAN_LEDGER_REASONS = [
  'prediction',
  'achievement',
  'presence',
  'poll',
  'trivia',
  'adjustment',
  'redeem',
  'revert',
] as const;

/** Query de `GET /v1/fans/me/wallet/ledger`. */
export const FanLedgerQuery = z.object({
  country: Country.optional().meta({
    description: 'País do programa. Padrão: o país do Perfil.',
    example: 'BR',
  }),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.uuid().optional().meta({ description: 'Cursor: `next_before` da página anterior.' }),
});
export type FanLedgerQuery = z.infer<typeof FanLedgerQuery>;

export const FanLedger = z
  .object({
    data: z.array(
      z.object({
        id: z.uuid(),
        reason: z.enum(FAN_LEDGER_REASONS),
        points_delta: z.number().int(),
        balance_delta: z.number().int(),
        points_after: z.number().int(),
        balance_after: z.number().int(),
        reverts_id: z.uuid().nullable(),
        note: z.string().nullable(),
        created_at: z.string().meta({ description: 'ISO 8601.' }),
      }),
    ),
    program_country: z.string(),
    next_before: z.uuid().nullable().meta({ description: 'Cursor da próxima página; null na última.' }),
  })
  .meta({ id: 'FanLedger' });
export type FanLedger = z.infer<typeof FanLedger>;

export const FanProfileParams = z.object({
  externalAccountId: ExternalId,
  externalProfileId: ExternalId,
});

const problem = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: Problem } },
});
const json = (schema: z.ZodType) => ({ 'application/json': { schema } });
const TAG = 'Torcedor';
const fanAuth = [{ galaxieFanToken: [] }];

/** Paths da identidade do torcedor para o documento OpenAPI. */
export const fanPaths: ZodOpenApiPathsObject = {
  '/v1/fans/tokens': {
    post: {
      summary: 'Token do torcedor',
      description:
        'Chamado pelo seu servidor, com a chave secreta. Cria ou atualiza a Conta e o Perfil e devolve um token de ' +
        '15 minutos para o widget ou app. Exige um módulo de engajamento no plano. A chave publicável nunca emite ' +
        'token. Campos fora da lista são recusados (400).',
      tags: [TAG],
      requestBody: { content: json(FanTokenBody) },
      responses: {
        '201': { description: 'Token emitido', content: json(FanTokenResponse) },
        '400': problem('Campo inválido ou desconhecido (INVALID_PARAMS)'),
        '401': problem('Chave ausente ou inválida (INVALID_KEY)'),
        '403': problem('Nenhum módulo de engajamento no plano (MODULE_NOT_IN_PLAN) ou chave publicável'),
        '429': problem('Limite do tenant atingido (RATE_LIMITED)'),
        '503': problem('Tokens do torcedor não configurados (DEGRADED)'),
      },
    },
  },
  '/v1/fans/me': {
    get: {
      summary: 'Perfil do torcedor do token',
      tags: [TAG],
      security: fanAuth,
      responses: {
        '200': { description: 'OK', content: json(FanMe) },
        '401': problem('Token ausente, inválido, vencido ou de Perfil excluído (INVALID_KEY)'),
        '429': problem('Limite atingido (RATE_LIMITED)'),
      },
    },
    patch: {
      summary: 'Muda a visibilidade e o time do coração',
      description:
        'Apelido e avatar vêm do seu servidor, no pedido do token. `under13` recebe 403 (FAN_AGE_RESTRICTED).',
      tags: [TAG],
      security: fanAuth,
      requestBody: { content: json(FanMePatchBody) },
      responses: {
        '200': { description: 'OK', content: json(FanMe) },
        '400': problem('Campo inválido (INVALID_PARAMS)'),
        '401': problem('Token ausente, inválido ou vencido (INVALID_KEY)'),
        '403': problem('Faixa etária sem permissão (FAN_AGE_RESTRICTED)'),
        '429': problem('Limite atingido (RATE_LIMITED)'),
      },
    },
  },
  '/v1/fans/me/wallet': {
    get: {
      summary: 'Carteira de pontos do torcedor',
      description:
        'Pontos e Saldo do Perfil do token, um item por país de programa. Pontos vêm de palpites, conquistas, ' +
        'presença, enquetes e trivia; compra nunca dá pontos. `under13` recebe 403 (FAN_AGE_RESTRICTED).',
      tags: [TAG],
      security: fanAuth,
      responses: {
        '200': { description: 'OK', content: json(FanWallet) },
        '401': problem('Token ausente, inválido, vencido ou de Perfil excluído (INVALID_KEY)'),
        '403': problem('Faixa etária sem permissão (FAN_AGE_RESTRICTED)'),
        '429': problem('Limite atingido (RATE_LIMITED)'),
      },
    },
  },
  '/v1/fans/me/wallet/ledger': {
    get: {
      summary: 'Extrato de pontos do torcedor',
      description:
        'Lançamentos do programa, do mais novo para o mais antigo, com o valor depois de cada um. Estornos ' +
        '(`revert`) apontam o lançamento estornado; o resgate (`redeem`) gasta só o Saldo.',
      tags: [TAG],
      security: fanAuth,
      requestParams: { query: FanLedgerQuery },
      responses: {
        '200': { description: 'OK', content: json(FanLedger) },
        '400': problem('Parâmetro inválido (INVALID_PARAMS)'),
        '401': problem('Token ausente, inválido, vencido ou de Perfil excluído (INVALID_KEY)'),
        '403': problem('Faixa etária sem permissão (FAN_AGE_RESTRICTED)'),
        '429': problem('Limite atingido (RATE_LIMITED)'),
      },
    },
  },
  '/v1/fans/{externalAccountId}/profiles/{externalProfileId}': {
    delete: {
      summary: 'Exclui o Perfil do torcedor',
      description:
        'Chamado pelo seu servidor, com a chave secreta, quando o torcedor pede a exclusão. Anonimiza o Perfil, ' +
        'invalida os tokens dele na hora e grava a exclusão para repetir depois de um restore. Repetir a chamada ' +
        'responde 204 de novo.',
      tags: [TAG],
      requestParams: { path: FanProfileParams },
      responses: {
        '204': { description: 'Excluído (ou já não existia)' },
        '401': problem('Chave ausente ou inválida (INVALID_KEY)'),
        '403': problem('Nenhum módulo de engajamento no plano (MODULE_NOT_IN_PLAN) ou chave publicável'),
        '429': problem('Limite do tenant atingido (RATE_LIMITED)'),
      },
    },
  },
};
