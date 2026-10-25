import * as z from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { Problem } from './common.js';

/** Autoatendimento do tenant: `/v1/account/*` (docs/05 §1.2). */

const Day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .meta({ example: '2026-10-21' });
const Instant = z.string().meta({ description: 'ISO 8601 (UTC).', example: '2026-10-21T12:00:00.000Z' });

export const AccountKey = z
  .object({
    id: z.string(),
    prefix: z.string().meta({ description: 'Parte pública da chave (12 hex).', example: '3f9a0c1b2d4e' }),
    env: z.enum(['live', 'test']),
    label: z.string().nullable(),
    scopes: z.array(z.string()).nullable().meta({ description: 'null = herda todos os módulos do tenant.' }),
    createdAt: Instant,
    expiresAt: Instant.nullable(),
    revokedAt: Instant.nullable(),
    lastUsedAt: Instant.nullable().meta({ description: 'Atualizado no máximo a cada 5 min.' }),
    status: z.enum(['active', 'expiring', 'expired', 'revoked']),
  })
  .meta({ id: 'AccountKey', description: 'Metadados da chave (nunca o segredo).' });

export const Account = z
  .object({
    tenant: z.object({
      id: z.string(),
      slug: z.string(),
      name: z.string(),
      plan: z.string().meta({ example: 'fan_experience' }),
      modules: z.array(z.string()).meta({ description: 'Módulos contratados pelo tenant.' }),
      markets: z.array(z.string()).meta({ description: 'Países ISO2; vazio = todos.' }),
      sports: z.array(z.string()).meta({ description: 'Esportes; vazio = todos.' }),
      rateLimitPerMinute: z.number().int(),
      dailyRequestQuota: z.number().int().nullable(),
    }),
    key: AccountKey.extend({
      effectiveModules: z.array(z.string()).meta({ description: 'Módulos do tenant ∩ escopos da chave.' }),
    }),
  })
  .meta({ id: 'Account' });

export const RotateKeyBody = z
  .object({
    graceSeconds: z.number().int().min(0).max(604_800).default(86_400).meta({
      description: 'Por quanto tempo a chave atual continua válida (0 = revoga já; máx. 7 dias).',
    }),
  })
  .meta({ id: 'RotateKeyBody' });

export const RotatedKey = z
  .object({
    key: z.object({
      id: z.string(),
      prefix: z.string(),
      key: z.string().meta({ description: 'Chave completa — exibida uma única vez.' }),
      notice: z.string(),
    }),
    previous: AccountKey,
  })
  .meta({ id: 'RotatedKey' });

export const UsageRangeQuery = z.object({
  from: Day.optional().meta({ description: 'Dia inicial (UTC, inclusivo). Padrão: 6 dias antes de `to`.' }),
  to: Day.optional().meta({
    description: 'Dia final (UTC, inclusivo). Padrão: hoje. Intervalo máx. 92 dias.',
  }),
});

export const UsageReport = z
  .object({
    from: Day,
    to: Day,
    dailyRequestQuota: z.number().int().nullable(),
    total: z.number().int(),
    days: z.array(
      z.object({
        day: Day,
        total: z.number().int(),
        routes: z.array(
          z.object({
            route: z.string().meta({ example: 'GET /v1/competitions/:id' }),
            requests: z.number().int(),
          }),
        ),
      }),
    ),
  })
  .meta({
    id: 'UsageReport',
    description: 'Requisições por dia e rota (contadores com atraso de até ~1 s).',
  });

const problem = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: Problem } },
});
const common = {
  '401': problem('Chave ausente ou inválida (INVALID_KEY)'),
  '429': problem('Limite do tenant atingido (RATE_LIMITED)'),
};
const json = (schema: z.ZodType) => ({ 'application/json': { schema } });

/** Paths do autoatendimento para o documento OpenAPI. */
export const accountPaths: ZodOpenApiPathsObject = {
  '/v1/account': {
    get: {
      summary: 'Plano, módulos, limites e a chave em uso',
      tags: ['Conta'],
      responses: { '200': { description: 'OK', content: json(Account) }, ...common },
    },
  },
  '/v1/account/keys': {
    get: {
      summary: 'Chaves do tenant (metadados, sem segredos)',
      tags: ['Conta'],
      responses: {
        '200': { description: 'OK', content: json(z.object({ data: z.array(AccountKey) })) },
        ...common,
      },
    },
  },
  '/v1/account/keys/rotate': {
    post: {
      summary: 'Rotaciona a chave usada na requisição',
      description:
        'Cria uma chave nova (mesmo rótulo, escopos, ambiente e validade) e mantém a atual válida por ' +
        '`graceSeconds`. A chave nova aparece só nesta resposta. Uma chave já rotacionada (no período de ' +
        'graça) não pode ser rotacionada de novo, e a rotação exige menos de 20 chaves válidas no tenant.',
      tags: ['Conta'],
      requestBody: { content: json(RotateKeyBody) },
      responses: {
        '201': { description: 'Chave criada', content: json(RotatedKey) },
        '400': problem('Parâmetro inválido (INVALID_PARAMS)'),
        '409': problem('Chave já rotacionada ou teto de chaves válidas do tenant atingido (CONFLICT)'),
        ...common,
      },
    },
  },
  '/v1/account/usage': {
    get: {
      summary: 'Uso por dia e rota',
      tags: ['Conta'],
      requestParams: { query: UsageRangeQuery },
      responses: {
        '200': { description: 'OK', content: json(UsageReport) },
        '400': problem('Parâmetro inválido (INVALID_PARAMS)'),
        ...common,
      },
    },
  },
};
