import 'zod-openapi';
import * as z from 'zod';
import { REVIEW_STATUSES } from './semantic.js';

/*
 * Perfil do piloto de F1 além da carreira: os traços calculados do F1DB (sem IA, para todo piloto) e o perfil
 * editorial com fonte por item (lendas e regulares), revisado na base semântica. Critérios em
 * docs/runbooks/f1-perfil-editorial.md.
 */

/** Nível do piloto: o que o perfil editorial traz (lenda = completo; regular = bio curta; básico = só os traços). */
export const DRIVER_TIERS = ['legend', 'regular', 'basic'] as const;

/** Rótulo sábado × domingo. */
export const QUALI_RACE_LABELS = ['qualifier', 'racer', 'balanced'] as const;

/** Mínimo de duelos com companheiros (no grid e na corrida) para o rótulo sábado × domingo. */
export const QUALI_RACE_MIN_DUELS = 20;
/** Diferença mínima entre as taxas de vitória no duelo de grid e no de corrida para o rótulo (10 pontos). */
export const QUALI_RACE_GAP = 0.1;
/** Largadas mínimas no circuito para entrar nas pistas preferidas. */
export const FAVORITE_MIN_RACES = 2;

const DriverRef = z.object({ id: z.uuid(), name: z.string() });

const TraitRace = z.object({
  event_id: z.uuid(),
  name: z.string().meta({ example: 'European Grand Prix' }),
  year: z.number().int(),
});

const Duel = z
  .object({
    won: z.number().int().meta({ description: 'Vezes à frente do companheiro.' }),
    lost: z.number().int(),
  })
  .meta({ id: 'TeammateDuel' });

export const CircuitStat = z
  .object({
    circuit: z.object({
      id: z.string().nullable().meta({ description: 'Id do circuito no F1DB.', example: 'monaco' }),
      venue_id: z.uuid().nullable().meta({ description: 'O circuito em `/v1/venues/{id}`.' }),
      name: z.string().meta({ example: 'Circuit de Monaco' }),
    }),
    races: z.number().int().meta({ description: 'Largadas no circuito.' }),
    wins: z.number().int(),
    poles: z.number().int(),
    podiums: z.number().int(),
    best_finish: z.number().int().nullable(),
    avg_finish: z
      .number()
      .nullable()
      .meta({ description: 'Chegada média (só corridas com bandeirada), uma casa decimal.' }),
  })
  .meta({ id: 'CircuitStat' });
export type CircuitStat = z.infer<typeof CircuitStat>;

const Streak = z
  .object({
    length: z.number().int(),
    from: TraitRace.nullable(),
    to: TraitRace.nullable(),
  })
  .meta({ id: 'RaceStreak', description: 'Maior sequência de corridas seguidas (sem as sprints).' });

export const TeammateSeason = z
  .object({
    year: z.number().int(),
    teammate: DriverRef,
    team: z.object({ id: z.string(), name: z.string() }),
    races: z.number().int().meta({ description: 'Corridas juntos pela mesma equipe.' }),
    grid: Duel.meta({ description: 'Largou à frente (os dois com posição de largada).' }),
    race: Duel.meta({ description: 'Chegou à frente (os dois com bandeirada; abandono não entra).' }),
  })
  .meta({ id: 'TeammateSeason' });

export const DriverTraits = z
  .object({
    participant_id: z.uuid(),
    tier: z.enum(DRIVER_TIERS).meta({
      description:
        'legend = campeão mundial ou top 20 da história em vitórias ou em GPs; regular = vencedor de GP ou 3 temporadas ou mais; basic = os demais.',
    }),
    circuits: z.object({
      criterion: z.object({
        order: z
          .array(z.enum(['wins', 'podiums', 'poles', 'avg_finish']))
          .meta({ description: 'Ordem de desempate das pistas preferidas.' }),
        min_races: z.number().int().meta({ description: 'Largadas mínimas no circuito.' }),
      }),
      favorites: z.array(CircuitStat).meta({ description: 'As 3 melhores pelo critério.' }),
      all: z.array(CircuitStat).meta({ description: 'Todos os circuitos, na ordem do critério.' }),
    }),
    qualifying_vs_race: z.object({
      races: z.number().int().meta({ description: 'Largadas (GP), a base das taxas.' }),
      poles: z.number().int(),
      pole_rate: z.number().meta({ description: 'Poles por largada (0–1).' }),
      avg_grid: z.number().nullable().meta({ description: 'Posição média de largada.' }),
      avg_finish: z.number().nullable().meta({ description: 'Chegada média (só com bandeirada).' }),
      avg_positions_gained: z.number().nullable().meta({
        description:
          'Posições ganhas (positivo) ou perdidas (negativo) em média, da largada à bandeirada (só corridas com as duas).',
      }),
      label: z
        .enum(QUALI_RACE_LABELS)
        .nullable()
        .meta({
          description: `Comparado aos companheiros de equipe (o mesmo carro): qualifier = vence o duelo de grid ${QUALI_RACE_GAP * 100} pontos percentuais ou mais acima do de corrida; racer = o contrário; balanced = no meio. null com menos de ${QUALI_RACE_MIN_DUELS} duelos de cada.`,
        }),
      grid_duel_rate: z.number().nullable().meta({ description: 'Taxa de vitória no duelo de grid (0–1).' }),
      race_duel_rate: z
        .number()
        .nullable()
        .meta({ description: 'Taxa de vitória no duelo de corrida (0–1).' }),
    }),
    teammates: z.object({
      career: z.object({ grid: Duel, race: Duel }),
      by_teammate: z.array(
        z.object({
          teammate: DriverRef,
          seasons: z.array(z.number().int()),
          races: z.number().int(),
          grid: Duel,
          race: Duel,
        }),
      ),
      by_season: z.array(TeammateSeason).meta({ description: 'Da temporada mais recente à primeira.' }),
    }),
    consistency: z.object({
      races: z.number().int(),
      dnfs: z.number().int(),
      dnf_rate: z.number().meta({ description: 'Abandonos por largada (0–1).' }),
      points: z.number().meta({ description: 'Pontos das corridas (sem as sprints).' }),
      points_per_start: z.number(),
      streaks: z.object({ wins: Streak, podiums: Streak, points: Streak }),
    }),
  })
  .meta({
    id: 'DriverTraits',
    description:
      'Traços calculados do F1DB, sem IA. Corrida com chuva não é marcada na F1DB: o desempenho na chuva fica no perfil editorial (`/v1/teams/{id}/editorial`), com fonte.',
  });
export type DriverTraits = z.infer<typeof DriverTraits>;

// ─── perfil editorial (base semântica) ───────────────────────────────────────────────────────────

export const DRIVING_STYLES = [
  'aggressive',
  'smooth',
  'calculating',
  'precise',
  'instinctive',
  'complete',
  'consistent',
] as const;
export const DRIVER_STRENGTHS = [
  'qualifying',
  'wet_weather',
  'overtaking',
  'defending',
  'starts',
  'tyre_management',
  'car_control',
  'race_intelligence',
  'consistency',
  'technical_feedback',
  'street_circuits',
  'high_speed',
] as const;

const Source = z.url().meta({ description: 'Fonte consultada (a busca que sustentou o item).' });

export const DriverEditorial = z
  .object({
    participant_id: z.uuid(),
    slug: z.string().meta({ example: 'f1-ayrton-senna' }),
    locale: z.string(),
    text_locale: z.string().meta({ description: 'Idioma do texto servido (pt-BR ou es).' }),
    tier: z.enum(['legend', 'regular']),
    bio: z.object({ text: z.string(), sources: z.array(Source) }),
    style: z
      .object({ kind: z.enum(DRIVING_STYLES), text: z.string(), sources: z.array(Source) })
      .nullable()
      .meta({ description: 'Modo de pilotagem (só lenda).' }),
    strengths: z.array(z.object({ key: z.enum(DRIVER_STRENGTHS), text: z.string(), source: Source })),
    moments: z.array(
      z.object({
        year: z.number().int(),
        race: z.string(),
        event_id: z.uuid().nullable().meta({ description: 'A corrida na base (`/v1/events/{id}`).' }),
        wet: z.boolean().meta({ description: 'Corrida com chuva (pela fonte do momento).' }),
        text: z.string(),
        source: Source,
      }),
    ),
    rivalries: z.array(
      z.object({
        driver: z.object({
          id: z.uuid().nullable(),
          f1db_id: z.string(),
          name: z.string(),
        }),
        text: z.string(),
        source: Source,
      }),
    ),
    review_status: z.enum(REVIEW_STATUSES),
  })
  .meta({
    id: 'DriverEditorial',
    description:
      'Perfil editorial do piloto (bio, estilo, pontos fortes, momentos marcantes e rivalidades), cada item com fonte; os números foram conferidos contra o F1DB antes da revisão.',
  });
export type DriverEditorial = z.infer<typeof DriverEditorial>;
