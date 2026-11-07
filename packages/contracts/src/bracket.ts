import 'zod-openapi';
import * as z from 'zod';
import { ParticipantRef, SeasonRef, StandingsParams } from './catalog.js';
import { EVENT_STATUSES } from './events.js';

// ─── chaveamento do mata-mata (#829) ─────────────────────────────────────────────────────────────

export const BracketParams = StandingsParams;

const ScorePair = z.object({ home: z.number().int().nullable(), away: z.number().int().nullable() });

export const BracketLeg = z
  .object({
    event_id: z.uuid(),
    leg: z.number().int().meta({ description: 'Ordem da partida no confronto (1 = ida ou jogo 1).' }),
    starts_at: z.string().meta({ description: 'ISO 8601 no fuso pedido (`tz`).' }),
    status: z.enum(EVENT_STATUSES),
    home_id: z.uuid().nullable().meta({ description: 'Quem jogou em casa nesta partida.' }),
    score: ScorePair,
    penalty: ScorePair.nullable().meta({
      description: 'Disputa de pênaltis (shootout) da partida, se houve.',
    }),
  })
  .meta({ id: 'BracketLeg' });

export const BracketTie = z
  .object({
    id: z.string().meta({ description: 'Chave estável do confronto (fase + os dois participantes).' }),
    home: ParticipantRef.nullable().meta({
      description: 'Quem fez a primeira partida em casa (o mandante da ida). Null enquanto não definido.',
    }),
    away: ParticipantRef.nullable(),
    format: z.enum(['single', 'two_legs', 'series']).meta({
      description:
        '`single`: jogo único; `two_legs`: ida e volta (soma dos placares); `series`: série melhor de N (playoffs do basquete, beisebol, hóquei, vôlei), decidida por vitórias.',
    }),
    legs: z.array(BracketLeg),
    aggregate: ScorePair.nullable().meta({
      description: 'Ida e volta: soma das partidas já iniciadas, do ponto de vista de `home`/`away`.',
    }),
    wins: ScorePair.nullable().meta({ description: 'Série: vitórias de cada lado.' }),
    penalties: ScorePair.nullable().meta({
      description:
        'Pênaltis que decidiram o confronto (da última partida), do ponto de vista de `home`/`away`.',
    }),
    winner_id: z.uuid().nullable(),
    status: z.enum(['scheduled', 'in_progress', 'decided']),
  })
  .meta({ id: 'BracketTie' });

export const BracketRound = z
  .object({
    stage_id: z.uuid(),
    kind: z.string().meta({
      description:
        'Fase canônica (`round_of_16`, `quarter_final`, `semi_final`, `third_place`, `final`, `playoff`, `knockout_round`…).',
      example: 'quarter_final',
    }),
    name: z.string().meta({ description: 'Nome da fase no idioma pedido.', example: 'Quartas de final' }),
    ties: z.array(BracketTie).meta({
      description:
        'Confrontos na ordem do chaveamento: os vencedores dos confrontos 1 e 2 se cruzam na fase seguinte, e assim por diante (quando a fase seguinte já está definida); senão, pela data.',
    }),
  })
  .meta({ id: 'BracketRound' });

export const Bracket = z
  .object({
    competition_id: z.uuid(),
    sport: z.string().meta({ example: 'football' }),
    season: SeasonRef,
    rounds: z.array(BracketRound).meta({ description: 'Fases de mata-mata em ordem, da primeira à final.' }),
    updated_at: z.string().nullable().meta({ description: 'Última atualização de um jogo do chaveamento.' }),
  })
  .meta({ id: 'Bracket', description: 'Chaveamento do mata-mata da temporada (#829).' });
export type Bracket = z.infer<typeof Bracket>;
export type BracketTie = z.infer<typeof BracketTie>;
