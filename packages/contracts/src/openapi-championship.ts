import type { ZodOpenApiPathsObject } from 'zod-openapi';
import {
  Champions,
  ChampionsParams,
  ChampionsQuery,
  Leaders,
  LeadersParams,
  LeadersQuery,
} from './championship.js';
import { getOp } from './openapi-ops.js';

const TAG = 'Catálogo';
const e404 = [400, 401, 403, 404, 429] as (400 | 401 | 403 | 404 | 429)[];
const withDescription = <T extends object>(op: T, description: string) => ({ ...op, description });

/** Rotas do campeonato para os widgets do épico #820 (artilharia, campeões) — módulo `core_data`. */
export function championshipPaths(): ZodOpenApiPathsObject {
  return {
    '/v1/competitions/{id}/seasons/{season}/leaders': {
      get: withDescription(
        getOp(
          'Artilharia e líderes da temporada (gols, assistências, cartões)',
          TAG,
          Leaders,
          { path: LeadersParams, query: LeadersQuery },
          e404,
        ),
        'Soma as estatísticas de jogador da temporada da competição (um jogador que trocou de time dentro dela ' +
          'conta uma vez, com o time em que mais jogou). Empate no número divide a posição; menos minutos vem ' +
          'antes. Lista vazia onde o esporte não tem estatística de jogador. Cache de 1 hora.',
      ),
    },
    '/v1/competitions/{id}/champions': {
      get: withDescription(
        getOp(
          'Galeria de campeões: vencedor de cada edição e ranking de títulos',
          TAG,
          Champions,
          {
            path: ChampionsParams,
            query: ChampionsQuery,
          },
          e404,
        ),
        'Campeões por edição (fonte: Wikidata, com correções curadas), com o vice quando a temporada está na ' +
          'base. O ranking de títulos só sai quando a lista está completa até a edição mais recente. Cache de 24 horas.',
      ),
    },
  };
}
