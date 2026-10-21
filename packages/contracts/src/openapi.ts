import * as z from 'zod';
import {
  createDocument,
  type ZodOpenApiObject,
  type ZodOpenApiOperationObject,
  type ZodOpenApiResponsesObject,
} from 'zod-openapi';
import {
  Competition,
  CompetitionParams,
  CompetitionsQuery,
  CompetitionSummary,
  Country,
  IdParams,
  Sport,
  Standings,
  StandingsParams,
  Venue,
} from './catalog.js';
import { LocaleQuery, list, page, Problem } from './common.js';
import { Event, TeamSummary } from './events.js';
import { MIRROR_SOURCES, MirrorEnvelope, MirrorParams } from './mirror.js';
import { RealtimeChange, StreamQuery } from './realtime.js';

const problemContent = { 'application/problem+json': { schema: Problem } };

const errorResponses = (...statuses: (400 | 401 | 403 | 404 | 429 | 503)[]): ZodOpenApiResponsesObject => {
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

function getOp(
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

export interface OpenApiOptions {
  /** URL base anunciada em `servers` (ex.: http://localhost:8080). */
  serverUrl?: string;
  version?: string;
}

/** Documento OpenAPI 3.1 da API pública, gerado a partir dos schemas Zod deste pacote. */
export function buildOpenApiDocument(options: OpenApiOptions = {}): ReturnType<typeof createDocument> {
  const doc: ZodOpenApiObject = {
    openapi: '3.1.0',
    info: {
      title: 'Galaxie Sports API',
      version: options.version ?? '0.1.0',
      description:
        'API de dados esportivos para a América Latina: espelho compatível (`/mirror`) e API canônica (`/v1`). ' +
        'Autentique com o header `x-galaxie-key`. Erros seguem a RFC 9457.',
    },
    ...(options.serverUrl ? { servers: [{ url: options.serverUrl }] } : {}),
    security: [{ galaxieKey: [] }],
    tags: [
      { name: 'Catálogo', description: 'Esportes, países, competições, tabelas e venues (docs/05 §3.1).' },
      { name: 'Espelho', description: 'Espelho compatível com a api-sports (docs/05 §2).' },
      { name: 'Tempo real', description: 'SSE e webhooks assinados (docs/05 §5).' },
    ],
    paths: {
      '/v1/sports': {
        get: getOp('Esportes disponíveis e cobertura', 'Catálogo', list(Sport), { query: LocaleQuery }),
      },
      '/v1/countries': { get: getOp('Países', 'Catálogo', list(Country), { query: LocaleQuery }) },
      '/v1/competitions': {
        get: getOp('Competições (paginado por cursor)', 'Catálogo', page(CompetitionSummary), {
          query: CompetitionsQuery,
        }),
      },
      '/v1/competitions/{id}': {
        get: getOp(
          'Detalhe da competição com temporadas',
          'Catálogo',
          Competition,
          { path: CompetitionParams, query: LocaleQuery },
          [400, 401, 403, 404, 429],
        ),
      },
      '/v1/competitions/{id}/seasons/{season}/standings': {
        get: getOp(
          'Tabela/grupos da temporada',
          'Catálogo',
          Standings,
          { path: StandingsParams, query: LocaleQuery },
          [400, 401, 403, 404, 429],
        ),
      },
      '/v1/venues/{id}': {
        get: getOp(
          'Estádio/circuito/arena',
          'Catálogo',
          Venue,
          { path: IdParams, query: LocaleQuery },
          [400, 401, 403, 404, 429],
        ),
      },
      '/v1/stream': {
        get: {
          summary: 'Mudanças em tempo real (Server-Sent Events)',
          description:
            'Stream `text/event-stream`: cada mensagem tem `id` (use no `Last-Event-ID` para retomar), ' +
            '`event` (o tópico) e `data` (RealtimeChange). Heartbeat por comentário a cada 15 s. ' +
            'Autentique com `x-galaxie-key` ou `?key=` (EventSource). Detalhes em docs/05 §5.',
          tags: ['Tempo real'],
          requestParams: {
            query: StreamQuery,
            header: z.object({
              'last-event-id': z.string().optional().meta({ description: 'Retoma após esta mudança.' }),
            }),
          },
          responses: {
            '200': {
              description: 'Stream SSE de RealtimeChange',
              content: { 'text/event-stream': { schema: RealtimeChange } },
            },
            ...errorResponses(400, 401, 403, 429, 503),
          },
        },
      },
      '/mirror/{sport}/{endpoint}': {
        get: {
          summary: 'Espelho compatível com a api-sports',
          description:
            'Mesma URL relativa, parâmetros e envelope do fornecedor (o endpoint pode conter barras, ex.: ' +
            '`fixtures/headtohead`). Nunca chama o fornecedor em tempo real: sem dado, responde `results: 0` ' +
            'com `x-galaxie-source: miss` e agenda o backfill (prioridade ADHOC).',
          tags: ['Espelho'],
          requestParams: { path: MirrorParams },
          responses: {
            '200': {
              description: 'Envelope da api-sports',
              headers: z.object({
                'x-galaxie-source': z.enum(MIRROR_SOURCES),
                'x-galaxie-fetched-at': z
                  .string()
                  .optional()
                  .meta({ description: 'Quando o dado foi obtido do fornecedor.' }),
                'x-galaxie-asset-base': z.string().optional(),
                etag: z.string(),
                'cache-control': z.string(),
              }),
              content: { 'application/json': { schema: MirrorEnvelope } },
            },
            '304': { description: 'Não modificado (If-None-Match)' },
            ...errorResponses(400, 401, 403, 404, 429),
          },
        },
      },
    },
    components: {
      securitySchemes: {
        galaxieKey: { type: 'apiKey', in: 'header', name: 'x-galaxie-key' },
      },
      // Placeholders de #31/#32 — já disponíveis para tipagem do demo.
      schemas: { Event, TeamSummary },
    },
  };
  return createDocument(doc);
}
