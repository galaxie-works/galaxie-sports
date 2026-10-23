import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { list, LocaleQuery, page } from './common.js';
import {
  EqAthleteDetail,
  EqAthleteSummary,
  EqAthletesQuery,
  EqChampionship,
  EqChampionshipParams,
  EqCompetitionDetail,
  EqCompetitionSummary,
  EqCompetitionsQuery,
  EqHorseDetail,
  EqHorseSummary,
  EqHorsesQuery,
  EqIdParams,
  EqOverview,
  EqRankingObservation,
  EqResult,
  EqResultsQuery,
} from './equestrian.js';
import { getOp } from './openapi-ops.js';

const withDescription = <T extends object>(op: T, description: string) => ({ ...op, description });
const TAG = 'Hipismo';
const e404 = [400, 401, 403, 404, 429] as (400 | 401 | 403 | 404 | 429)[];
const RULES =
  ' Classificação geral e rodada são registros distintos; `null` é "não publicado" (nunca zero); cada linha traz ' +
  '`source`. A categoria está fora da oferta comercial enquanto o licenciamento não é concluído (`notice`).';

/** Hipismo (docs/13-hipismo.md §5) — módulo `core_data`. */
export function equestrianPaths(): ZodOpenApiPathsObject {
  return {
    '/v1/equestrian/overview': {
      get: withDescription(
        getOp('Resumo do hipismo: cobertura, destaques e provas recentes', TAG, EqOverview, {
          query: LocaleQuery,
        }),
        'Cobertura por país e por tipo de histórico, destaques da América Latina, provas recentes e campeonatos com ' +
          'rodadas documentadas.' +
          RULES,
      ),
    },
    '/v1/equestrian/athletes': {
      get: withDescription(
        getOp('Cavaleiros e amazonas', TAG, page(EqAthleteSummary), { query: EqAthletesQuery }),
        'Busca por nome ou ID FEI, filtro por país (representação atual) e por cobertura do histórico.' +
          RULES,
      ),
    },
    '/v1/equestrian/athletes/{id}': {
      get: getOp(
        'Perfil do atleta, cavalos, rankings e cobertura',
        TAG,
        EqAthleteDetail,
        { path: EqIdParams, query: LocaleQuery },
        e404,
      ),
    },
    '/v1/equestrian/horses': {
      get: getOp('Cavalos', TAG, page(EqHorseSummary), { query: EqHorsesQuery }),
    },
    '/v1/equestrian/horses/{id}': {
      get: getOp(
        'Ficha do cavalo, proprietários e cavaleiros',
        TAG,
        EqHorseDetail,
        { path: EqIdParams, query: LocaleQuery },
        e404,
      ),
    },
    '/v1/equestrian/results': {
      get: withDescription(
        getOp('Histórico de resultados (classificações gerais)', TAG, page(EqResult), {
          query: EqResultsQuery,
        }),
        'Filtros por atleta, cavalo, prova, país do conjunto ou do concurso, período, nível e status. Ordenado do mais ' +
          'recente para o mais antigo.' +
          RULES,
      ),
    },
    '/v1/equestrian/competitions': {
      get: getOp('Provas', TAG, page(EqCompetitionSummary), { query: EqCompetitionsQuery }),
    },
    '/v1/equestrian/competitions/{id}': {
      get: withDescription(
        getOp(
          'Prova e classificação',
          TAG,
          EqCompetitionDetail,
          { path: EqIdParams, query: LocaleQuery },
          e404,
        ),
        'Classificação da prova. Quando a lista completa não foi lida, só os conjuntos presentes na base aparecem e ' +
          '`completeness.all_entries_observed` é false.',
      ),
    },
    '/v1/equestrian/championships/{key}': {
      get: withDescription(
        getOp(
          'Rodadas documentadas e equipes de um campeonato',
          TAG,
          EqChampionship,
          {
            path: EqChampionshipParams,
            query: LocaleQuery,
          },
          e404,
        ),
        'Rodadas/etapas observadas em documentos oficiais (ex.: athens_2004_jumping, jerez_2002_jumping), equipes e ' +
          'divergências entre fontes.',
      ),
    },
    '/v1/equestrian/rankings': {
      get: withDescription(
        getOp('Posições observadas em rankings', TAG, list(EqRankingObservation), { query: LocaleQuery }),
        'Observações pontuais (sem edição inferida quando a fonte não a mostra); não é o ranking completo.',
      ),
    },
  };
}
