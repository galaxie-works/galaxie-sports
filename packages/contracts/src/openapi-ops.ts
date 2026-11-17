import * as z from 'zod';
import type { ZodOpenApiOperationObject, ZodOpenApiResponsesObject } from 'zod-openapi';
import { Problem } from './common.js';

/** Blocos reutilizados pelas operações do OpenAPI (respostas de erro, headers e GET padrão). */

const problemContent = { 'application/problem+json': { schema: Problem } };

/**
 * Respostas de erro de uma operação. Toda rota autenticada (401) também responde pelo estado do tenant (plataforma
 * comercial F3, docs/05 §6): 401 com `TENANT_PENDING_REVIEW`, `TENANT_REJECTED`, `TRIAL_EXPIRED` ou `TENANT_CANCELLED`,
 * e 402 `SUBSCRIPTION_SUSPENDED`; por isso o 402 entra junto com o 401.
 */
export const errorResponses = (
  ...statuses: (400 | 401 | 403 | 404 | 429 | 503)[]
): ZodOpenApiResponsesObject => {
  const descriptions = {
    400: 'Parâmetro inválido (INVALID_PARAMS)',
    401: 'Chave ausente ou inválida (INVALID_KEY), ou tenant sem acesso pelo estado (TENANT_PENDING_REVIEW, TENANT_REJECTED, TRIAL_EXPIRED com upgrade_url, TENANT_CANCELLED)',
    402: 'Assinatura suspensa (SUBSCRIPTION_SUSPENDED, com upgrade_url)',
    403: 'Recurso fora do plano (MODULE_NOT_IN_PLAN / MARKET_NOT_IN_PLAN)',
    404: 'Entidade inexistente (NOT_FOUND)',
    429: 'Limite do tenant atingido (RATE_LIMITED) ou cota diária esgotada (QUOTA_EXCEEDED)',
    503: 'Serviço degradado (DEGRADED) ou em atualização (MAINTENANCE)',
  } as const;
  const all: (keyof typeof descriptions)[] = statuses.includes(401) ? [...statuses, 402] : [...statuses];
  return Object.fromEntries(
    all
      .sort((a, b) => a - b)
      .map((s) => [String(s), { description: descriptions[s], content: problemContent }]),
  );
};

const okHeaders = z.object({
  etag: z.string().meta({ description: 'Validador para If-None-Match (304).' }),
  'cache-control': z.string().meta({ description: 'TTL por tipo de recurso (docs/05 §7).' }),
  'x-ratelimit-limit': z.string().meta({ description: 'Requisições por janela (por rota).' }),
  'x-ratelimit-remaining': z.string(),
  'x-ratelimit-reset': z.string().meta({ description: 'Segundos até a janela reiniciar.' }),
  'x-galaxie-quota-limit': z
    .string()
    .optional()
    .meta({ description: 'Cota diária de produção do plano (ausente = sem cota ou chave de teste).' }),
  'x-galaxie-quota-remaining': z
    .string()
    .optional()
    .meta({ description: 'Requisições restantes no dia UTC.' }),
  'x-galaxie-quota-warning': z
    .string()
    .optional()
    .meta({ description: 'Presente a partir de 80% da cota: quanto já foi usado (ex.: `85%`).' }),
});

const acceptLanguage = z.object({
  'accept-language': z.string().optional().meta({ description: 'Usado quando `?locale` não é informado.' }),
});

export function getOp(
  summary: string,
  tag: string,
  schema: z.ZodType,
  params: Pick<ZodOpenApiOperationObject, 'requestParams'>['requestParams'],
  errors: (400 | 401 | 403 | 404 | 429 | 503)[] = [400, 401, 403, 429],
): ZodOpenApiOperationObject {
  return {
    summary,
    tags: [tag],
    requestParams: { ...params, header: acceptLanguage },
    responses: {
      '200': { description: 'OK', headers: okHeaders, content: { 'application/json': { schema } } },
      '304': { description: 'Não modificado (If-None-Match)' },
      ...errorResponses(...errors),
    },
  };
}
