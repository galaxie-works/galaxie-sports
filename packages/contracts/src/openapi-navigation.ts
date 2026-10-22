import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { LocaleQuery } from './common.js';
import { EXPLORE_WINDOW_DAYS, ExploreSummary, ExploreSummaryQuery } from './explore.js';
import {
  CountryCompetitions,
  CountryCompetitionsQuery,
  CountryDetail,
  CountryParams,
  Navigation,
} from './navigation.js';
import { getOp } from './openapi-ops.js';

const withDescription = <T extends object>(op: T, description: string) => ({ ...op, description });

/** Navegação por país e menu de esportes (docs/05 §3.1.1) — módulo `core_data`. */
export function navigationPaths(): ZodOpenApiPathsObject {
  return {
    '/v1/navigation': {
      get: withDescription(
        getOp('Menu da navegação: esportes e países', 'Catálogo', Navigation, { query: LocaleQuery }),
        'Modelo do menu lateral em uma chamada: os 12 esportes (competições, eventos e `has_data`) e os países ' +
          'da navegação com bandeira e confederação (config/geo/confederations.yaml).',
      ),
    },
    '/v1/explore/summary': {
      get: withDescription(
        getOp('Resumo da home: esportes e países com contadores', 'Catálogo', ExploreSummary, {
          query: ExploreSummaryQuery,
        }),
        'Tudo o que a vitrine inicial precisa em uma chamada, sem N+1: por esporte, competições do catálogo, ' +
          `participantes, jogos nos próximos ${EXPLORE_WINDOW_DAYS} dias, ao vivo agora e as 4 competições em ` +
          'destaque; por país (os da navegação, agrupados por confederação), competições domésticas, liga ' +
          'principal, os 5 clubes mais importantes, jogos e ao vivo (competição do país ou participante do país, ' +
          'como `/v1/events?country=`) e o próximo jogo de maior relevância no mercado do país. Cache de 60 s.',
      ),
    },
    '/v1/countries/{code}': {
      get: getOp(
        'País com confederação e bandeira',
        'Catálogo',
        CountryDetail,
        { path: CountryParams, query: LocaleQuery },
        [400, 401, 403, 404, 429],
      ),
    },
    '/v1/countries/{code}/competitions': {
      get: withDescription(
        getOp(
          'Competições do país por esporte e escopo',
          'Catálogo',
          CountryCompetitions,
          { path: CountryParams, query: CountryCompetitionsQuery },
          [400, 401, 403, 404, 429],
        ),
        'Por esporte (futebol primeiro), em grupos: domésticas (ligas, copas, estaduais), copas continentais de ' +
          'clubes, seleções e mundiais de clubes. As internacionais vêm de config/geo/competition-scope.yaml: o ' +
          'país aparece quando é membro de uma confederação participante (Libertadores e Sul-Americana para os ' +
          'dez da CONMEBOL) ou está listado como participante. Ordem: tier, posição editorial e nome.',
      ),
    },
  };
}
