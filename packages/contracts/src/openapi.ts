import * as z from 'zod';
import { createDocument, type ZodOpenApiObject } from 'zod-openapi';
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
import { LocaleQuery, list, page } from './common.js';
import { Event, TeamSummary } from './events.js';
import { MIRROR_SOURCES, MirrorEnvelope, MirrorParams } from './mirror.js';
import { errorResponses, getOp } from './openapi-ops.js';
import { multisportPaths, semanticPaths } from './openapi-semantic.js';

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
      {
        name: 'Semântica',
        description: 'Clássicos, identidade do time, rivais, glossário e copy (docs/06 §5).',
      },
      { name: 'Multiesporte', description: 'Olimpíadas e Pan-Americanos (docs/08 §4).' },
    ],
    paths: {
      ...semanticPaths(),
      ...multisportPaths(),
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
