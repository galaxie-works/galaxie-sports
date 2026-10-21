import * as z from 'zod';
import type { ZodOpenApiOperationObject, ZodOpenApiResponsesObject } from 'zod-openapi';
import { Problem } from './common.js';

/** Blocos reutilizados pelas operações do OpenAPI (respostas de erro, headers e GET padrão). */

const problemContent = { 'application/problem+json': { schema: Problem } };

export const errorResponses = (
  ...statuses: (400 | 401 | 403 | 404 | 429 | 503)[]
): ZodOpenApiResponsesObject => {
  const descriptions = {
    400: 'Parâmetro inválido (INVALID_PARAMS)',
    401: 'Chave ausente ou inválida (INVALID_KEY)',
    403: 'Recurso fora do plano (MODULE_NOT_IN_PLAN / MARKET_NOT_IN_PLAN)',
    404: 'Entidade inexistente (NOT_FOUND)',
    429: 'Limite do tenant atingido (RATE_LIMITED)',
    503: 'Serviço degradado (DEGRADED)',
  } as const;
  return Object.fromEntries(
    statuses.map((s) => [String(s), { description: descriptions[s], content: problemContent }]),
  );
};

const okHeaders = z.object({
  etag: z.string().meta({ description: 'Validador para If-None-Match (304).' }),
  'cache-control': z.string().meta({ description: 'TTL por tipo de recurso (docs/05 §7).' }),
  'x-ratelimit-limit': z.string().meta({ description: 'Requisições por janela (por rota).' }),
  'x-ratelimit-remaining': z.string(),
  'x-ratelimit-reset': z.string().meta({ description: 'Segundos até a janela reiniciar.' }),
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
