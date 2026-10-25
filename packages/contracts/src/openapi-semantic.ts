import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { list, LocaleQuery, page } from './common.js';
import {
  Delegation,
  GamesDetail,
  GamesEventParams,
  GamesListQuery,
  GamesNocParams,
  GamesParams,
  GamesSummary,
  MedalHistory,
  MedalHistoryQuery,
  MedalsQuery,
  MedalTable,
  MsEventDetail,
  NocToday,
  ScheduleQuery,
  ScheduleUnit,
  TodayQuery,
} from './multisport.js';
import { getOp } from './openapi-ops.js';
import { DriverEditorial } from './driver-profile.js';
import {
  CopyQuery,
  CopySuggestion,
  DerbiesQuery,
  Derby,
  DerbyParams,
  DerbySummary,
  Glossary,
  GlossaryQuery,
  ReviewQuery,
  SemanticTeamParams,
  TeamRivals,
  TeamSemantic,
  UpcomingDerbiesQuery,
  UpcomingDerby,
} from './semantic.js';

const REVIEW_NOTE =
  ' Itens abaixo do status editorial mínimo (`min_review_status`, piso do servidor `SEMANTIC_MIN_REVIEW_STATUS`) ' +
  'não são servidos.';

const withDescription = <T extends object>(op: T, description: string) => ({ ...op, description });

/** Rotas da camada semântica (docs/06 §5) — módulo `semantic`. */
export function semanticPaths(): ZodOpenApiPathsObject {
  return {
    '/v1/derbies': {
      get: withDescription(
        getOp('Clássicos', 'Semântica', list(DerbySummary), { query: DerbiesQuery }),
        'Clássicos da base semântica, filtráveis por país e por time (UUID ou slug).' + REVIEW_NOTE,
      ),
    },
    '/v1/derbies/upcoming': {
      get: withDescription(
        getOp('Clássicos dos próximos dias', 'Semântica', list(UpcomingDerby), {
          query: UpcomingDerbiesQuery,
        }),
        'Eventos com `derby_id` entre agora e `days` dias (padrão 7), em ordem de início. Lista vazia quando ' +
          'não há eventos sincronizados.',
      ),
    },
    '/v1/derbies/{slug}': {
      get: withDescription(
        getOp(
          'Clássico com retrospecto',
          'Semântica',
          Derby,
          { path: DerbyParams, query: ReviewQuery },
          [400, 401, 403, 404, 429],
        ),
        'Retrospecto (vitórias, empates, gols, maiores goleadas, últimos 5) calculado dos eventos encerrados ' +
          'no core — nunca consulta o provedor. Pênaltis não mudam o resultado. `origin` e `trivia` seguem ' +
          '`es-XX → es → original` (`text_locale`).',
      ),
    },
    '/v1/teams/{id}/semantic': {
      get: withDescription(
        getOp(
          'Cartão de identidade do time',
          'Semântica',
          TeamSemantic,
          { path: SemanticTeamParams, query: ReviewQuery },
          [400, 401, 403, 404, 429],
        ),
        'Apelidos, mascote, torcida, gritos, estádio, rivais, fatos e dicas de copy do mercado pedido. ' +
          '`{id}` aceita o UUID do participante ou o slug do perfil. Fatos, mascote, cores e torcida seguem ' +
          '`es-XX → es → original`, campo a campo; `text_locale` diz de onde vieram.' +
          REVIEW_NOTE,
      ),
    },
    '/v1/teams/{id}/rivals': {
      get: withDescription(
        getOp(
          'Rivais e clássicos do time',
          'Semântica',
          TeamRivals,
          { path: SemanticTeamParams, query: ReviewQuery },
          [400, 401, 403, 404, 429],
        ),
        'Mapeamento time → rivais/clássicos para segmentação (rivais declarados pelo time e clássicos que o ' +
          'incluem), por intensidade.',
      ),
    },
    '/v1/teams/{id}/editorial': {
      get: withDescription(
        getOp(
          'Perfil editorial do piloto de F1 (bio, estilo, pontos fortes, momentos e rivalidades, com fonte)',
          'Semântica',
          DriverEditorial,
          { path: SemanticTeamParams, query: ReviewQuery },
          [400, 401, 403, 404, 429],
        ),
        'Lendas (campeões e top 20 em vitórias ou em GPs) têm o perfil completo; regulares (vencedor de GP ou ' +
          '3 temporadas ou mais), a bio curta. Cada item traz a fonte da pesquisa; os números foram conferidos ' +
          'contra o F1DB antes da revisão. O texto segue `es-XX → es → pt-BR` (`text_locale`). Sem perfil: 404.' +
          REVIEW_NOTE,
      ),
    },
    '/v1/glossary': {
      get: withDescription(
        getOp('Glossário por mercado', 'Semântica', Glossary, { query: GlossaryQuery }),
        'Termos esportivos do locale (ex.: "secar", "hinchar por", "le voy al", "hacer fuerza"), com a ' +
          'restrição de uso do copy_permission. Sem glossário para o locale, cai para o idioma (es-XX → es).' +
          REVIEW_NOTE,
      ),
    },
    '/v1/copy': {
      get: withDescription(
        getOp('Copy contextual', 'Semântica', CopySuggestion, { query: CopyQuery }),
        'Microcopy do mercado escolhida por `selectCopy` respeitando o copy_permission: afinidade inferida ' +
          'só recebe copy informativa; rivalidade só com rival declarado. `team`/`rival` (UUID ou slug) ' +
          'preenchem os placeholders. Sem fallback entre locales.' +
          REVIEW_NOTE,
      ),
    },
  };
}

const QUALITY_NOTE =
  ' Quadros e rankings só saem com `medal_data_quality` complete ou partial; nos demais casos a resposta é ' +
  '200 com `publishable: false`, aviso localizado e lista vazia.';

/** Rotas do módulo multiesportivo (docs/08 §4) — módulo `multisport`. */
export function multisportPaths(): ZodOpenApiPathsObject {
  const e404 = [400, 401, 403, 404, 429] as (400 | 401 | 403 | 404 | 429)[];
  return {
    '/v1/multisport/games': {
      get: getOp('Edições dos Jogos', 'Multiesporte', list(GamesSummary), { query: GamesListQuery }),
    },
    '/v1/multisport/games/{slug}': {
      get: getOp(
        'Edição dos Jogos e torneios coletivos ligados',
        'Multiesporte',
        GamesDetail,
        { path: GamesParams, query: LocaleQuery },
        e404,
      ),
    },
    '/v1/multisport/games/{slug}/medals': {
      get: withDescription(
        getOp(
          'Quadro de medalhas',
          'Multiesporte',
          MedalTable,
          { path: GamesParams, query: MedalsQuery },
          e404,
        ),
        'Quadro derivado da tabela de medalhas (sem revogadas), por ouro ou por total.' + QUALITY_NOTE,
      ),
    },
    '/v1/multisport/games/{slug}/schedule': {
      get: withDescription(
        getOp(
          'Agenda por dia/modalidade/país',
          'Multiesporte',
          page(ScheduleUnit),
          { path: GamesParams, query: ScheduleQuery },
          e404,
        ),
        'Unidades (sessões/baterias/partidas) da edição. Vazia enquanto a agenda oficial não é carregada.',
      ),
    },
    '/v1/multisport/games/{slug}/events/{id}': {
      get: getOp(
        'Prova: fases, unidades, resultados e medalhas',
        'Multiesporte',
        MsEventDetail,
        { path: GamesEventParams, query: LocaleQuery },
        e404,
      ),
    },
    '/v1/multisport/games/{slug}/nocs/{noc}/athletes': {
      get: getOp('Delegação', 'Multiesporte', Delegation, { path: GamesNocParams, query: LocaleQuery }, e404),
    },
    '/v1/multisport/games/{slug}/today/{noc}': {
      get: withDescription(
        getOp(
          '"Brasil hoje" / "Argentina hoy"',
          'Multiesporte',
          NocToday,
          { path: GamesNocParams, query: TodayQuery },
          e404,
        ),
        'Unidades e medalhas do CON no dia.' + QUALITY_NOTE,
      ),
    },
    '/v1/multisport/history/medals': {
      get: withDescription(
        getOp('Histórico de medalhas por país', 'Multiesporte', MedalHistory, { query: MedalHistoryQuery }),
        'Medalhas por edição para um ou mais CONs.' + QUALITY_NOTE + ' Edições omitidas vêm em `withheld`.',
      ),
    },
  };
}
