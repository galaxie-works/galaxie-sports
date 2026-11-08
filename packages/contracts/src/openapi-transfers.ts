import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { CompetitionParams } from './catalog.js';
import { getOp } from './openapi-ops.js';
import { TeamParams } from './teams.js';
import { TransferList, TransfersQuery } from './transfers.js';

const TAG = 'Times e pessoas';
const e404 = [400, 401, 403, 404, 429] as (400 | 401 | 403 | 404 | 429)[];
const RULES =
  ' Transferências normalizadas do fornecedor (`transfers`), da mais recente para trás, com o clube de origem e o ' +
  'de destino (clube fora do catálogo vem com `id` nulo e o nome como o fornecedor escreve). Cache de 1 hora.';

/** Vai e vem do mercado (#832) — módulo `core_data`. */
export function transferPaths(): ZodOpenApiPathsObject {
  return {
    '/v1/teams/{id}/transfers': {
      get: {
        ...getOp(
          'Contratações e saídas do time',
          TAG,
          TransferList,
          { path: TeamParams, query: TransfersQuery },
          e404,
        ),
        description: 'Quem chegou e quem saiu do time no período.' + RULES,
      },
    },
    '/v1/competitions/{id}/transfers': {
      get: {
        ...getOp(
          'Contratações e saídas dos times de um campeonato',
          TAG,
          TransferList,
          { path: CompetitionParams, query: TransfersQuery },
          e404,
        ),
        description:
          'As transferências que envolvem os times da temporada atual do campeonato (ou da mais recente). ' +
          '`direction` é do ponto de vista do campeonato.' +
          RULES,
      },
    },
  };
}
