import 'zod-openapi';
import * as z from 'zod';
import { LocaleQuery } from './common.js';
import { ParticipantRef } from './catalog.js';

// ─── palpite do jogo (/v1/events/{id}/predictions) ───────────────────────────────────────────────

export const GoalsLine = z
  .object({
    side: z.enum(['over', 'under']).meta({ description: '`over` = mais de; `under` = menos de.' }),
    line: z.number().meta({ example: 2.5 }),
  })
  .meta({ id: 'GoalsLine' });

export const PREDICTION_COMPARISON_KEYS = [
  'form',
  'attack',
  'defense',
  'poisson',
  'h2h',
  'goals',
  'total',
] as const;
export type PredictionComparisonKey = (typeof PREDICTION_COMPARISON_KEYS)[number];

export const PredictionRecentForm = z
  .object({
    form: z.number().nullable().meta({ description: 'Aproveitamento nos últimos 5 jogos (0–100).' }),
    attack: z.number().nullable().meta({ description: 'Força do ataque nos últimos 5 jogos (0–100).' }),
    defense: z.number().nullable().meta({ description: 'Força da defesa nos últimos 5 jogos (0–100).' }),
    goals_for: z.number().nullable(),
    goals_against: z.number().nullable(),
    goals_for_average: z.number().nullable(),
    goals_against_average: z.number().nullable(),
  })
  .meta({ id: 'PredictionRecentForm' });

export const Prediction = z
  .object({
    winner: z
      .object({
        side: z.enum(['home', 'away']),
        participant_id: z.uuid(),
        win_or_draw: z.boolean().meta({ description: '`true` = o palpite é "vence ou empata".' }),
      })
      .nullable()
      .meta({ description: 'Quem o palpite aponta; `null` quando não aponta ninguém.' }),
    probabilities: z
      .object({
        home: z.number().nullable(),
        draw: z.number().nullable(),
        away: z.number().nullable(),
      })
      .meta({ description: 'Chance de cada resultado, em pontos percentuais (0–100).' }),
    goals: z.object({
      total: GoalsLine.nullable().meta({ description: 'Linha de gols do jogo.' }),
      home: GoalsLine.nullable(),
      away: GoalsLine.nullable(),
    }),
    comparison: z
      .array(
        z.object({
          key: z.enum(PREDICTION_COMPARISON_KEYS).meta({
            description:
              '`form` = momento; `attack` / `defense` = ataque e defesa; `poisson` = distribuição de Poisson; `h2h` = confronto direto; `goals` = gols; `total` = soma de tudo.',
          }),
          home: z.number().nullable(),
          away: z.number().nullable(),
        }),
      )
      .meta({
        description: 'Comparação dos dois times, em pontos percentuais (0–100), na ordem fixa das chaves.',
      }),
    recent_form: z.object({ home: PredictionRecentForm.nullable(), away: PredictionRecentForm.nullable() }),
  })
  .meta({ id: 'Prediction' });
export type Prediction = z.infer<typeof Prediction>;

export const EventPredictions = z
  .object({
    event_id: z.uuid(),
    sport: z.string().meta({ example: 'football' }),
    home: ParticipantRef.nullable(),
    away: ParticipantRef.nullable(),
    prediction: Prediction.nullable().meta({
      description: 'Palpite estatístico do jogo; `null` enquanto não houver (sai até 2 dias antes do jogo).',
    }),
    updated_at: z.string().nullable().meta({
      description: 'Quando o palpite foi atualizado pela última vez (ISO 8601 no fuso pedido, `tz`).',
    }),
  })
  .meta({ id: 'EventPredictions' });
export type EventPredictions = z.infer<typeof EventPredictions>;

// ─── odds do jogo (/v1/events/{id}/odds) ─────────────────────────────────────────────────────────

export const ODDS_MARKET_KEYS = [
  'match_winner',
  'double_chance',
  'draw_no_bet',
  'both_teams_score',
  'goals_over_under',
  'first_half_winner',
  'second_half_winner',
  'exact_score',
  'asian_handicap',
  'handicap_result',
  'goals_over_under_first_half',
  'home_total_goals',
  'away_total_goals',
] as const;
export type OddsMarketKey = (typeof ODDS_MARKET_KEYS)[number];

const isMarket = (s: string): s is OddsMarketKey => (ODDS_MARKET_KEYS as readonly string[]).includes(s);

export const OddsQuery = LocaleQuery.extend({
  market: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v, ctx) => {
      if (v === undefined) return undefined;
      const list = (Array.isArray(v) ? v : [v])
        .flatMap((s) => s.split(','))
        .map((s) => s.trim())
        .filter(Boolean);
      const bad = list.filter((s) => !isMarket(s));
      if (bad.length) {
        ctx.addIssue({ code: 'custom', message: `mercado(s) inválido(s): ${bad.join(', ')}` });
        return z.NEVER;
      }
      return [...new Set(list)] as OddsMarketKey[];
    })
    .meta({
      description: `Só estes mercados, separados por vírgula (padrão: todos): ${ODDS_MARKET_KEYS.map((k) => `\`${k}\``).join(', ')}.`,
      example: 'match_winner,goals_over_under',
    }),
});
export type OddsQuery = z.input<typeof OddsQuery>;

const SelectionKey = z.string().meta({
  description:
    '`home`, `draw`, `away`, `home_draw`, `home_away`, `draw_away`, `over`, `under`, `yes`, `no` ou o placar (`2:1`).',
  example: 'home',
});

export const OddsConsensusSelection = z
  .object({
    key: SelectionKey,
    line: z.number().nullable().meta({ description: 'Linha (gols, handicap), quando o mercado tem.' }),
    average: z.number().meta({ description: 'Odd decimal média entre as casas.' }),
    best: z.number().meta({ description: 'Maior odd decimal entre as casas.' }),
    bookmakers: z.number().int().meta({ description: 'Quantas casas oferecem a seleção.' }),
  })
  .meta({ id: 'OddsConsensusSelection' });

export const OddsBookmakerSelection = z
  .object({ key: SelectionKey, line: z.number().nullable(), price: z.number() })
  .meta({ id: 'OddsBookmakerSelection' });

export const EventOdds = z
  .object({
    event_id: z.uuid(),
    sport: z.string().meta({ example: 'football' }),
    home: ParticipantRef.nullable(),
    away: ParticipantRef.nullable(),
    markets: z
      .array(z.object({ key: z.enum(ODDS_MARKET_KEYS), selections: z.array(OddsConsensusSelection) }))
      .meta({
        description: 'Consenso de cada mercado entre as casas: odd média, maior odd e quantas casas.',
      }),
    bookmakers: z
      .array(
        z.object({
          id: z.uuid(),
          name: z.string(),
          markets: z.array(
            z.object({ key: z.enum(ODDS_MARKET_KEYS), selections: z.array(OddsBookmakerSelection) }),
          ),
          updated_at: z.string().nullable(),
        }),
      )
      .meta({ description: 'Odds de cada casa.' }),
    updated_at: z.string().nullable().meta({
      description: 'Última atualização das odds (ISO 8601 no fuso pedido, `tz`).',
    }),
  })
  .meta({ id: 'EventOdds' });
export type EventOdds = z.infer<typeof EventOdds>;
