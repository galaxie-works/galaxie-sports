import * as z from 'zod';
import {
  createDocument,
  type ZodOpenApiObject,
  type ZodOpenApiOperationObject,
  type ZodOpenApiPathsObject,
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
import { accountPaths } from './account.js';
import { channelListPaths } from './channel-list.js';
import { LocaleQuery, list, page, Problem } from './common.js';
import { CompetitionContext, ContextParams, ContextQuery } from './context.js';
import {
  Event,
  EventLineups,
  EventParams,
  EventQuery,
  EventsQuery,
  EventStats,
  EventTimeline,
  H2hQuery,
  EventFightCard,
  HeadToHead,
  LiveEventsQuery,
  TeamSummary,
} from './events.js';
import { EventContext, EventContextQuery } from './event-context.js';
import { MIRROR_SOURCES, MirrorEnvelope, MirrorParams } from './mirror.js';
import {
  Broadcaster,
  BroadcasterParams,
  BroadcastersQuery,
  Platform,
  PlatformLineup,
  PlatformParams,
  PlatformsQuery,
  WhereToWatch,
  WhereToWatchParams,
  WhereToWatchQuery,
} from './where-to-watch.js';
import { RaceCareer, RaceLegends, RaceLegendsQuery, TeamPhotos, TeamPhotosQuery } from './racing.js';
import { DriverTraits } from './driver-profile.js';
import { RealtimeChange, StreamQuery, StreamToken } from './realtime.js';
import { RelatedContent, RelatedQuery, relatedPaths } from './related.js';
import { SearchQuery, SearchResponse } from './search.js';
import { multisportPaths, semanticPaths } from './openapi-semantic.js';
import { navigationPaths } from './openapi-navigation.js';
import { equestrianPaths } from './openapi-equestrian.js';
import {
  Person,
  PersonOverview,
  PersonOverviewQuery,
  Squad,
  SquadQuery,
  Team,
  TeamEventsQuery,
  TeamOverview,
  TeamOverviewQuery,
  TeamParams,
  TeamsQuery,
} from './teams.js';

const problemContent = { 'application/problem+json': { schema: Problem } };

const errorResponses = (...statuses: (400 | 401 | 403 | 404 | 429 | 503)[]): ZodOpenApiResponsesObject => {
  const descriptions = {
    400: 'Parâmetro inválido (INVALID_PARAMS)',
    401: 'Chave ausente ou inválida (INVALID_KEY)',
    403: 'Recurso fora do plano (MODULE_NOT_IN_PLAN / MARKET_NOT_IN_PLAN)',
    404: 'Entidade inexistente (NOT_FOUND)',
    429: 'Limite do tenant atingido (RATE_LIMITED) ou cota diária esgotada (QUOTA_EXCEEDED)',
    503: 'Serviço degradado (DEGRADED) ou em atualização (MAINTENANCE)',
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

/** Rotas `/v1` que só aceitam a chave secreta: conta do tenant e SSE (`assertPublishableRoute` na API). */
const SECRET_KEY_ONLY = ['/v1/account', '/v1/stream'];
/** Leitura de `/v1`: chave secreta ou, no navegador, a publicável (docs/05 §1.3). */
const READ_SECURITY = [{ galaxieKey: [] }, { galaxiePublishableKey: [] }];

/** Declara a chave publicável como alternativa nas operações GET/HEAD de `/v1` que a API aceita com ela. */
function withPublishableKey(paths: ZodOpenApiPathsObject): ZodOpenApiPathsObject {
  return Object.fromEntries(
    Object.entries(paths).map(([path, item]) => {
      const secretOnly =
        !path.startsWith('/v1/') || SECRET_KEY_ONLY.some((p) => path === p || path.startsWith(`${p}/`));
      if (secretOnly) return [path, item];
      const next = { ...item };
      for (const method of ['get', 'head'] as const) {
        const op = next[method];
        if (op && !op.security) next[method] = { ...op, security: READ_SECURITY };
      }
      return [path, next];
    }),
  );
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
        'Autentique com o header `x-galaxie-key`. Erros seguem a RFC 9457. ' +
        'Widgets no navegador usam a chave publicável (`x-galaxie-publishable-key`): só GET em `/v1`, ' +
        'só das origens cadastradas na chave e com rate limit próprio (docs/05 §1.3).\n\n' +
        '**Fontes e atribuição.** Histórico da Fórmula 1 (temporadas, GPs, sessões, resultados, grid, pit stops e ' +
        'campeonatos desde 1950): [F1DB](https://github.com/f1db/f1db), licenciado sob ' +
        '[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); os dados foram adaptados ao modelo da Galaxie ' +
        '(normalização, casamento com outras fontes e horários estimados antes de 2024). Ao redistribuir esses ' +
        'dados, mantenha este crédito.',
    },
    ...(options.serverUrl ? { servers: [{ url: options.serverUrl }] } : {}),
    security: [{ galaxieKey: [] }],
    tags: [
      { name: 'Catálogo', description: 'Esportes, países, competições, tabelas e venues (docs/05 §3.1).' },
      {
        name: 'Eventos',
        description: 'Agenda, ao vivo, detalhe, timeline, escalações, estatísticas (docs/05 §3.2).',
      },
      { name: 'Times e pessoas', description: 'Times, elencos e pessoas (docs/05 §3.3).' },
      {
        name: 'Busca',
        description: 'Busca global em times, competições, jogos, pessoas, estádios e países (docs/05 §3.6).',
      },
      { name: 'Espelho', description: 'Espelho compatível com a api-sports (docs/05 §2).' },
      { name: 'Onde assistir', description: 'Opções de transmissão por evento × país (docs/05 §4).' },
      {
        name: 'Conteúdo relacionado',
        description: 'Vídeos diretos por evento, classificados por tipo e formato (docs/12).',
      },
      { name: 'Tempo real', description: 'SSE e webhooks assinados (docs/05 §5).' },
      { name: 'Conta', description: 'Autoatendimento do tenant: chaves e uso (docs/05 §1.2).' },
      {
        name: 'Hipismo',
        description:
          'Atletas, cavalos, provas, classificações, rodadas documentadas e rankings observados (docs/13). ' +
          'Fora da oferta comercial enquanto o licenciamento com a FEI e as federações não é concluído.',
      },
    ],
    paths: withPublishableKey({
      ...semanticPaths(),
      ...multisportPaths(),
      ...navigationPaths(),
      ...equestrianPaths(),
      '/v1/sports': {
        get: getOp('Esportes disponíveis e cobertura', 'Catálogo', list(Sport), { query: LocaleQuery }),
      },
      '/v1/countries': { get: getOp('Países', 'Catálogo', list(Country), { query: LocaleQuery }) },
      '/v1/search': {
        get: {
          ...getOp('Busca global', 'Busca', SearchResponse, { query: SearchQuery }),
          description:
            'Uma chamada para a caixa de busca: times, competições, jogos (ao vivo e próximos 14 dias dos times ' +
            'encontrados), pessoas, estádios e países. Casa nome, apelidos e nomes da base semântica, siglas e ' +
            'nomes anteriores, sem diferença de caixa nem de acento ("verdao" acha o Palmeiras pelo apelido ' +
            'Verdão). Resultados numa lista só, do casamento exato para o trecho.',
        },
      },
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
      '/v1/competitions/{id}/context': {
        get: getOp(
          'O que está em jogo: líder, zonas, chaveamento e próximos jogos decisivos',
          'Catálogo',
          CompetitionContext,
          { path: ContextParams, query: ContextQuery },
          [400, 401, 403, 404, 429],
        ),
      },
      '/v1/events': {
        get: getOp('Agenda multiesporte (paginada por cursor)', 'Eventos', page(Event), {
          query: EventsQuery,
        }),
      },
      '/v1/events/live': {
        get: getOp('Eventos ao vivo', 'Eventos', list(Event), { query: LiveEventsQuery }),
      },
      '/v1/events/{id}': {
        get: getOp(
          'Evento completo',
          'Eventos',
          Event,
          { path: EventParams, query: EventQuery },
          [400, 401, 403, 404, 429],
        ),
      },
      '/v1/events/{id}/timeline': {
        get: getOp(
          'Momentos-chave (gols, cartões, VAR, substituições)',
          'Eventos',
          EventTimeline,
          { path: EventParams, query: LocaleQuery },
          [400, 401, 403, 404, 429],
        ),
      },
      '/v1/events/{id}/lineups': {
        get: getOp(
          'Escalações e formação',
          'Eventos',
          EventLineups,
          { path: EventParams, query: LocaleQuery },
          [400, 401, 403, 404, 429],
        ),
      },
      '/v1/events/{id}/stats': {
        get: getOp(
          'Estatísticas por time e jogador',
          'Eventos',
          EventStats,
          { path: EventParams, query: LocaleQuery },
          [400, 401, 403, 404, 429],
        ),
      },
      '/v1/events/{id}/context': {
        get: {
          ...getOp(
            'Cenário pré-jogo / resumo pós-jogo gerado por IA, com fontes',
            'Eventos',
            EventContext,
            { path: EventParams, query: EventContextQuery },
            [400, 401, 403, 404, 429],
          ),
          description:
            'Texto calculado a partir dos fatos (regulamento, tabela, timeline) e só redigido pela IA; todo texto ' +
            'passa pelos guardrails e, se reprovado, vira o texto determinístico (`origin: fallback`). Exige o ' +
            'módulo `live_intelligence`. Atualizações chegam pelo tópico `event.context_published` (SSE/webhook).',
        },
      },
      '/v1/events/{id}/h2h': {
        get: getOp(
          'Histórico do confronto (do core, sem chamada ao fornecedor)',
          'Eventos',
          HeadToHead,
          { path: EventParams, query: H2hQuery },
          [400, 401, 403, 404, 429],
        ),
      },
      '/v1/events/{id}/card': {
        get: {
          ...getOp(
            'Card de MMA da luta: card principal e preliminares',
            'Eventos',
            EventFightCard,
            { path: EventParams, query: LocaleQuery },
            [400, 401, 403, 404, 429],
          ),
          description:
            'A noite de lutas (fase `fight_card`) a que a luta pertence, com todas as lutas em ordem de exibição. ' +
            'Só para eventos de MMA; os demais esportes respondem 404.',
        },
      },
      '/v1/events/{id}.ics': {
        get: {
          summary: 'Arquivo de calendário (RFC 5545)',
          tags: ['Eventos'],
          requestParams: { path: EventParams, query: LocaleQuery, header: acceptLanguage },
          responses: {
            '200': {
              description: 'VCALENDAR com um VEVENT (horários em UTC)',
              headers: okHeaders,
              content: { 'text/calendar': { schema: z.string() } },
            },
            '304': { description: 'Não modificado (If-None-Match)' },
            ...errorResponses(400, 401, 403, 404, 429),
          },
        },
      },
      '/v1/teams': {
        get: getOp('Busca de times e seleções (paginada)', 'Times e pessoas', page(TeamSummary), {
          query: TeamsQuery,
        }),
      },
      '/v1/teams/{id}': {
        get: getOp(
          'Detalhe do time',
          'Times e pessoas',
          Team,
          { path: TeamParams, query: LocaleQuery },
          [400, 401, 403, 404, 429],
        ),
      },
      '/v1/teams/{id}/overview': {
        get: getOp(
          'Card do time: campanha nas competições, posição, forma, últimos resultados, ao vivo e próximo jogo — da temporada atual ou de um ano (`season`)',
          'Times e pessoas',
          TeamOverview,
          { path: TeamParams, query: TeamOverviewQuery },
          [400, 401, 403, 404, 429],
        ),
      },
      '/v1/teams/{id}/events': {
        get: getOp(
          'Jogos do time (paginado)',
          'Times e pessoas',
          page(Event),
          { path: TeamParams, query: TeamEventsQuery },
          [400, 401, 403, 404, 429],
        ),
      },
      '/v1/teams/{id}/photos': {
        get: getOp(
          'Fotos do piloto ou da equipe (acervo de licenças livres da Wikimedia Commons), cada uma com o crédito obrigatório',
          'Times e pessoas',
          TeamPhotos,
          { path: TeamParams, query: TeamPhotosQuery },
          [400, 401, 403, 404, 429],
        ),
      },
      '/v1/teams/{id}/career': {
        get: getOp(
          'Carreira na Fórmula 1 (piloto ou construtor): temporada a temporada (com top 10, abandonos, sprint, número do carro e a pintura da equipe na época), temporada atual, títulos, melhores resultados com a contagem, perfil do piloto (número permanente e nascimento), primeira e última corrida, equipes e companheiros',
          'Times e pessoas',
          RaceCareer,
          { path: TeamParams, query: LocaleQuery },
          [400, 401, 403, 404, 429],
        ),
      },
      '/v1/teams/{id}/traits': {
        get: getOp(
          'Traços do piloto de F1, calculados do F1DB: pistas preferidas (com o critério), sábado × domingo (pole, largada média, posições ganhas e o rótulo), duelo com os companheiros por temporada e na carreira, consistência (abandonos, pontos por largada e sequências) e o nível do perfil',
          'Times e pessoas',
          DriverTraits,
          { path: TeamParams, query: LocaleQuery },
          [400, 401, 403, 404, 429],
        ),
      },
      '/v1/sports/formula-1/legends': {
        get: getOp(
          'Lendas da Fórmula 1: as 10 da lista editorial (Senna, Schumacher, Hamilton, Fangio, Prost, Lauda, Piquet, Clark, Alonso e Verstappen), nessa ordem, cada uma com a temporada marcante (equipe, pintura da época, número e o carro ao fundo) e o retrato',
          'Times e pessoas',
          RaceLegends,
          { query: RaceLegendsQuery },
          [400, 401, 403, 429],
        ),
      },
      '/v1/teams/{id}/squad': {
        get: getOp(
          'Elenco e comissão técnica (atual ou de uma temporada, com jogos e gols)',
          'Times e pessoas',
          Squad,
          { path: TeamParams, query: SquadQuery },
          [400, 401, 403, 404, 429],
        ),
      },
      '/v1/people/{id}': {
        get: getOp(
          'Jogador, técnico ou piloto',
          'Times e pessoas',
          Person,
          { path: TeamParams, query: LocaleQuery },
          [400, 401, 403, 404, 429],
        ),
      },
      '/v1/people/{id}/overview': {
        get: getOp(
          'Perfil do jogador: time atual, números da temporada por competição, carreira, transferências e últimos jogos',
          'Times e pessoas',
          PersonOverview,
          { path: TeamParams, query: PersonOverviewQuery },
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
      '/v1/events/{id}/where-to-watch': {
        get: {
          ...getOp(
            'Onde assistir o evento num país',
            'Onde assistir',
            WhereToWatch,
            { path: WhereToWatchParams, query: WhereToWatchQuery },
            [400, 401, 403, 404, 429],
          ),
          description:
            'Só opções publicadas (confiança ≥ 0,7, sem conflito). Sem informação confiável: `status: unknown`, ' +
            '`options: []` e `message` localizada. Exige o módulo `where_to_watch` e o país nos mercados do tenant. ' +
            'Correções editoriais propagam em ≤ 5 min (purge de cache + webhook `where_to_watch.changed`). ' +
            '`availability` agrupa o mesmo jogo em TV aberta, canais pagos e plataformas (operadoras e streamings, ' +
            'com o plano e os streamings inclusos); para o tenant com operadora própria e `show_other_operators` ' +
            'desligado, `platforms` traz só a própria operadora e os streamings. Piso editorial da grade: ' +
            '`LINEUP_MIN_REVIEW_STATUS` (padrão `approved`). Com a lista de canais do tenant confirmada ' +
            '(`/v1/channel-list`), cada opção e cada item de `to_confirm` trazem `client_channels`: os canais da ' +
            'lista que levam a emissora no país.',
        },
      },
      '/v1/events/{id}/related': {
        get: {
          ...getOp(
            'Conteúdo relacionado: vídeos diretos classificados por tipo',
            'Conteúdo relacionado',
            RelatedContent,
            { path: EventParams, query: RelatedQuery },
            [400, 401, 403, 404, 429],
          ),
          description:
            'Links diretos e embed oficial de vídeos sobre o evento (melhores momentos, gols, pênaltis, coletiva, ' +
            'bastidores, reação da torcida, análise…), com canal, selo de fonte oficial, formato (short/long), ' +
            'proporção do quadro (filtro `aspect_ratio`: `16:9`, `9:16` ou os dois) e duração. Vídeos bloqueados no ' +
            'país (`country`) ou recusados pelo player (`POST /v1/related/playback-errors`) ficam de fora. Só metadados: nada é rehospedado. Exige o módulo `related_content`. Atualizações chegam ' +
            'pelo tópico `event.related_content_changed` (SSE/webhook).',
        },
      },
      '/v1/broadcasters': {
        get: {
          ...getOp('Biblioteca de emissoras e plataformas', 'Onde assistir', list(Broadcaster), {
            query: BroadcastersQuery,
          }),
          description:
            'Emissoras de TV aberta, TV paga e streaming usadas nas opções do onde assistir, com canais por país e ' +
            'logo (origem e licença informadas). Exige o módulo `where_to_watch`.',
        },
      },
      '/v1/broadcasters/{id}': {
        get: getOp(
          'Emissora ou plataforma',
          'Onde assistir',
          Broadcaster,
          { path: BroadcasterParams, query: LocaleQuery },
          [400, 401, 403, 404, 429],
        ),
      },
      '/v1/platforms': {
        get: {
          ...getOp('Operadoras e streamings da grade', 'Onde assistir', list(Platform), {
            query: PlatformsQuery,
          }),
          description:
            'Operadoras de TV paga, TV pela internet, pacotes de telefonia e streamings com grade de canais. ' +
            'Tenant com operadora própria e `show_other_operators` desligado: só a própria operadora e os ' +
            'streamings. Exige o módulo `where_to_watch`; piso editorial `LINEUP_MIN_REVIEW_STATUS`.',
        },
      },
      '/v1/platforms/{id}/lineup': {
        get: getOp(
          'Grade de canais e streamings de cada plano da plataforma',
          'Onde assistir',
          PlatformLineup,
          { path: PlatformParams, query: LocaleQuery },
          [400, 401, 403, 404, 429],
        ),
      },
      '/v1/stream': {
        get: {
          summary: 'Mudanças em tempo real (Server-Sent Events)',
          description:
            'Stream `text/event-stream`: cada mensagem tem `id` (use no `Last-Event-ID` para retomar), ' +
            '`event` (o tópico) e `data` (RealtimeChange). Heartbeat por comentário a cada 15 s. ' +
            'Autentique com `x-galaxie-key` ou, no navegador (`EventSource` não envia headers), com o token curto ' +
            'em `?token=` (`POST /v1/stream/token`). `?key=` é obsoleto: aceito até 27/12/2026 com os headers ' +
            '`Deprecation` e `Sunset`. Detalhes em docs/05 §5.',
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
      '/v1/stream/token': {
        post: {
          summary: 'Token curto para abrir o stream no navegador',
          description:
            'Troca a chave secreta (header `x-galaxie-key`, sempre no seu backend) por um token de 5 minutos para ' +
            'o `EventSource` do navegador abrir `/v1/stream?token=…`. O token vale só para abrir o stream do seu ' +
            'tenant; o stream aberto continua depois do prazo e encerra se a chave for revogada. Ao reconectar ' +
            'depois de um erro, peça outro token. Sem corpo. Trial não tem tempo real (403).',
          tags: ['Tempo real'],
          responses: {
            '201': {
              description: 'Token emitido (não guarde: peça um por conexão)',
              content: { 'application/json': { schema: StreamToken } },
            },
            ...errorResponses(401, 403, 429, 503),
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
      ...accountPaths,
      ...channelListPaths,
      ...relatedPaths,
    }),
    components: {
      securitySchemes: {
        galaxieKey: { type: 'apiKey', in: 'header', name: 'x-galaxie-key' },
        galaxiePublishableKey: {
          type: 'apiKey',
          in: 'header',
          name: 'x-galaxie-publishable-key',
          description: 'Chave publicável (gs_pk_live_...): leitura de /v1 a partir das origens permitidas.',
        },
      },
      schemas: { Event, EventContext, TeamSummary, Team, Person },
    },
  };
  return createDocument(doc);
}
