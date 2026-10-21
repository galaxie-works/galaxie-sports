import 'zod-openapi';
import * as z from 'zod';
import { COMPETITION_TYPES, CompetitionParams, ParticipantRef, SeasonRef } from './catalog.js';
import { LocaleQuery } from './common.js';
import { EVENT_STATUSES, Event, EventCompetitionRef } from './events.js';

/** Formatos de regulamento (config/rules, docs/rules). */
export const COMPETITION_FORMATS = ['league', 'cup', 'league_phase', 'groups_and_knockout'] as const;

export const ZONE_KINDS = [
  'qualification',
  'promotion',
  'playoff',
  'relegation_playoff',
  'relegation',
  'elimination',
] as const;

export const ContextQuery = LocaleQuery.extend({
  season: z
    .string()
    .regex(/^(\d{4}|current)$/, 'use o ano (ex.: 2026) ou "current"')
    .default('current')
    .meta({ description: 'Ano da temporada ou `current` (padrão).' }),
});

export const ContextParams = CompetitionParams;

const ContextTeam = z.object({
  rank: z.number().int(),
  points: z.number().int(),
  played: z.number().int(),
  participant: ParticipantRef,
});

const TieLeg = z.object({
  event_id: z.uuid(),
  leg: z.number().int().nullable(),
  starts_at: z.string(),
  status: z.enum(EVENT_STATUSES),
  home_id: z.uuid().nullable(),
  score: z.object({ home: z.number().int().nullable(), away: z.number().int().nullable() }),
});

export const CompetitionContext = z
  .object({
    competition: EventCompetitionRef.extend({ type: z.enum(COMPETITION_TYPES) }),
    season: SeasonRef.nullable(),
    format: z.enum(COMPETITION_FORMATS).nullable().meta({ description: 'null sem regulamento próprio.' }),
    groups: z.array(
      z.object({
        name: z.string().nullable(),
        leader: ContextTeam.nullable(),
        zones: z.array(
          z.object({
            id: z.string().meta({ example: 'libertadores_group_stage' }),
            kind: z.enum(ZONE_KINDS),
            label: z.string().meta({ example: 'a fase de grupos da Libertadores' }),
            from: z.number().int(),
            to: z.number().int(),
            teams: z.array(ContextTeam),
          }),
        ),
      }),
    ),
    bracket: z.array(
      z.object({
        stage: z.object({ kind: z.string(), name: z.string().nullable() }),
        ties: z.array(
          z.object({
            participants: z.array(ParticipantRef),
            legs: z.array(TieLeg),
            aggregate: z
              .array(z.object({ participant_id: z.uuid(), goals: z.number().int() }))
              .nullable()
              .meta({ description: 'Soma das partidas já iniciadas (ida e volta).' }),
            winner_id: z.uuid().nullable(),
            status: z.enum(['scheduled', 'in_progress', 'decided']),
          }),
        ),
      }),
    ),
    decisive_events: z
      .array(Event)
      .meta({ description: 'Próximos jogos com algo em jogo (stakes decisivos), por importância.' }),
  })
  .meta({ id: 'CompetitionContext', description: 'O que está em jogo na competição (docs/05 §3.1).' });
export type CompetitionContext = z.infer<typeof CompetitionContext>;
