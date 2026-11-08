import 'zod-openapi';
import * as z from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { AssetUrl, LocaleQuery } from './common.js';
import { EventParams } from './events.js';
import { getOp } from './openapi-ops.js';
import { TeamParams } from './teams.js';

// ─── desfalques: lesionados e suspensos (issue #830) ─────────────────────────────────────────────

/** Por que o jogador está fora: lesão, suspensão (cartões), doença ou outro motivo (pessoal, opção técnica). */
export const SIDELINED_CATEGORIES = ['injury', 'suspension', 'illness', 'other'] as const;
export type SidelinedCategory = (typeof SIDELINED_CATEGORIES)[number];

/** `out` = fora do jogo; `doubtful` = dúvida (o fornecedor escreve "Questionable"). */
export const SIDELINED_STATUSES = ['out', 'doubtful'] as const;
export type SidelinedStatus = (typeof SIDELINED_STATUSES)[number];

/**
 * De onde veio o desfalque: `match` = a lista do fornecedor para aquele jogo (`injuries`); `history` = o histórico
 * de afastamentos do jogador (`sidelined`) ainda em aberto na data.
 */
export const SIDELINED_SOURCES = ['match', 'history'] as const;

const SidelinedTeamRef = z
  .object({
    id: z.uuid().nullable().meta({ description: 'null quando o time ainda não está no core.' }),
    name: z.string().nullable(),
    side: z.enum(['home', 'away']).nullable().meta({ description: 'Lado no jogo (só na rota do evento).' }),
    logo: AssetUrl,
  })
  .meta({ id: 'SidelinedTeamRef' });

export const SidelinedPlayer = z
  .object({
    person: z.object({
      id: z.uuid().nullable().meta({ description: 'null quando o jogador ainda não está no core.' }),
      name: z.string().meta({ example: 'Gabriel Barbosa' }),
      photo: AssetUrl,
    }),
    position: z.string().nullable().meta({ description: 'Posição no elenco atual.', example: 'Attacker' }),
    number: z.number().int().nullable().meta({ description: 'Camisa no elenco atual.' }),
    status: z.enum(SIDELINED_STATUSES),
    category: z.enum(SIDELINED_CATEGORIES),
    reason: z
      .string()
      .nullable()
      .meta({ description: 'Motivo como o fornecedor escreve.', example: 'Hamstring Injury' }),
    reason_label: z.string().nullable().meta({
      description: 'Motivo no locale pedido (os mais comuns traduzidos; o resto, a categoria).',
      example: 'Lesão na coxa (posterior)',
    }),
    since: z.iso.date().nullable().meta({ description: 'Início do afastamento, quando conhecido.' }),
    until: z.iso
      .date()
      .nullable()
      .meta({ description: 'Previsão de volta (fim do afastamento), quando o fornecedor informa.' }),
    source: z.enum(SIDELINED_SOURCES),
  })
  .meta({ id: 'SidelinedPlayer' });
export type SidelinedPlayer = z.infer<typeof SidelinedPlayer>;

export const EventSidelined = z
  .object({
    event_id: z.uuid(),
    available: z.boolean().meta({
      description:
        'false quando não há lista do fornecedor para o jogo nem histórico dos elencos (desfalques desconhecidos, ' +
        'não "nenhum desfalque").',
    }),
    teams: z.array(
      z.object({
        team: SidelinedTeamRef,
        players: z.array(SidelinedPlayer),
      }),
    ),
  })
  .meta({ id: 'EventSidelined' });
export type EventSidelined = z.infer<typeof EventSidelined>;

export const TeamSidelined = z
  .object({
    team: SidelinedTeamRef,
    as_of: z.iso.date().meta({ description: 'Data de referência (hoje, UTC).' }),
    available: z.boolean().meta({
      description:
        'false quando não há lista do fornecedor para o próximo jogo nem histórico do elenco (desfalques ' +
        'desconhecidos, não "nenhum desfalque").',
    }),
    next_event_id: z
      .uuid()
      .nullable()
      .meta({ description: 'Próximo jogo do time nos próximos 10 dias, cuja lista também entra.' }),
    players: z.array(SidelinedPlayer),
  })
  .meta({ id: 'TeamSidelined' });
export type TeamSidelined = z.infer<typeof TeamSidelined>;

export const SidelinedQuery = LocaleQuery;
export type SidelinedQuery = z.input<typeof SidelinedQuery>;

const RULES =
  ' Fora primeiro, depois as dúvidas; dentro de cada grupo, pela previsão de volta (a mais distante primeiro). ' +
  '`until` nulo = sem previsão. Hoje só no futebol.';

/** Rotas de desfalques (módulo `core_data`). */
export function sidelinedPaths(): ZodOpenApiPathsObject {
  const e404 = [400, 401, 403, 404, 429] as (400 | 401 | 403 | 404 | 429)[];
  return {
    '/v1/events/{id}/sidelined': {
      get: {
        ...getOp(
          'Desfalques do jogo: lesionados, suspensos e dúvidas de cada time',
          'Eventos',
          EventSidelined,
          { path: EventParams, query: SidelinedQuery },
          e404,
        ),
        description:
          'A lista do fornecedor para o jogo (`injuries`, sincronizada no dia) e, enquanto ela não sai, os ' +
          'afastamentos em aberto dos jogadores do elenco atual na data do jogo.' +
          RULES,
      },
    },
    '/v1/teams/{id}/sidelined': {
      get: {
        ...getOp(
          'Desfalques atuais do time',
          'Times e pessoas',
          TeamSidelined,
          { path: TeamParams, query: SidelinedQuery },
          e404,
        ),
        description:
          'Afastamentos em aberto hoje dos jogadores do elenco atual, somados à lista do fornecedor para o ' +
          'próximo jogo do time (até 10 dias).' +
          RULES,
      },
    },
  };
}
