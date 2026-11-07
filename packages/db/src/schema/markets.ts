import { boolean, index, jsonb, numeric, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pkUuidV7, updatedAt } from './_shared.js';
import { core, event, participant } from './core.js';

/**
 * Palpites e odds por jogo (docs/04 §2.4). O fornecedor entrega (`/predictions?fixture=`, `/odds?fixture=` e, nos
 * outros esportes, `/odds?game=`); aqui fica o dado na nossa organização: o jogo e os times pelos nossos IDs
 * (resolvidos pelo `provider_map`), mercados e seleções com chaves nossas, números como números.
 */

/** Lado e linha de um palpite de gols ("-2.5" do fornecedor = menos de 2,5). */
export interface GoalsLine {
  side: 'over' | 'under';
  line: number;
}

/** Comparação dos dois times, em pontos percentuais (0–100) para cada lado. */
export type PredictionComparisonKey = 'form' | 'attack' | 'defense' | 'poisson' | 'h2h' | 'goals' | 'total';
export type PredictionComparison = Partial<
  Record<PredictionComparisonKey, { home: number | null; away: number | null }>
>;

/** Retrospecto dos últimos jogos de um time, como o fornecedor resume no palpite (percentuais 0–100). */
export interface PredictionRecentForm {
  form: number | null;
  attack: number | null;
  defense: number | null;
  goalsFor: number | null;
  goalsAgainst: number | null;
  goalsForAverage: number | null;
  goalsAgainstAverage: number | null;
}

/**
 * Palpite do jogo: quem deve vencer (ou "vence ou empata"), as chances de cada resultado, a linha de gols e a
 * comparação dos times. Uma linha por jogo; a busca mais nova substitui a anterior. `advice` e `winner_comment`
 * são o texto livre do fornecedor, em inglês: ficam guardados, mas não saem na API (o texto é montado por nós
 * nos idiomas do cliente a partir dos campos estruturados).
 */
export const eventPrediction = core.table(
  'event_prediction',
  {
    eventId: uuid('event_id')
      .primaryKey()
      .references(() => event.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    winnerParticipantId: uuid('winner_participant_id').references(() => participant.id),
    winOrDraw: boolean('win_or_draw'),
    probHome: numeric('prob_home', { precision: 5, scale: 2, mode: 'number' }),
    probDraw: numeric('prob_draw', { precision: 5, scale: 2, mode: 'number' }),
    probAway: numeric('prob_away', { precision: 5, scale: 2, mode: 'number' }),
    /** Linhas de gols: total do jogo e de cada time. */
    goals: jsonb('goals').$type<{ total?: GoalsLine; home?: GoalsLine; away?: GoalsLine }>(),
    comparison: jsonb('comparison').$type<PredictionComparison>(),
    recentForm: jsonb('recent_form').$type<{ home?: PredictionRecentForm; away?: PredictionRecentForm }>(),
    advice: text('advice'),
    winnerComment: text('winner_comment'),
    /** Quando o fornecedor entregou este palpite (`fetched_at` do raw): uma resposta mais velha não sobrescreve. */
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [index('event_prediction_winner_idx').on(t.winnerParticipantId)],
);

/** Casa de apostas. O ID do fornecedor fica no `provider_map` (`entity_type = 'bookmaker'`, por esporte). */
export const bookmaker = core.table('bookmaker', {
  id: pkUuidV7(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Mercados com chave nossa (os demais ficam com `key: null` e o nome do fornecedor em `provider_bet`). */
export const ODDS_MARKETS = [
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
export type OddsMarketKey = (typeof ODDS_MARKETS)[number];

export interface OddsSelection {
  /** home, draw, away, home_draw, home_away, draw_away, over, under, yes, no, "2:1"… ou o valor do fornecedor. */
  key: string;
  /** Linha do mercado (gols, handicap), quando houver. */
  line: number | null;
  /** Odd decimal. */
  price: number;
}

export interface OddsMarket {
  key: OddsMarketKey | null;
  /** Mercado como o fornecedor chama, para os que não têm chave nossa e para auditoria. */
  providerBet: { id: number | null; name: string };
  selections: OddsSelection[];
}

/**
 * Odds pré-jogo de um jogo numa casa: a foto mais recente de todos os mercados que a casa oferece. A busca mais
 * nova do jogo substitui a anterior e tira as casas que deixaram de aparecer. O histórico fica no raw.
 */
export const eventOdds = core.table(
  'event_odds',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    bookmakerId: uuid('bookmaker_id')
      .notNull()
      .references(() => bookmaker.id),
    provider: text('provider').notNull(),
    markets: jsonb('markets').$type<OddsMarket[]>().notNull(),
    /** Última atualização das odds no fornecedor (`update`). */
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.bookmakerId] })],
);
