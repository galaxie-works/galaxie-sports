import 'zod-openapi';
import * as z from 'zod';
import { CompetitionSummary, SeasonRef } from './catalog.js';
import { LocaleQuery } from './common.js';

// ─── estatísticas do time na temporada (#893) ────────────────────────────────────────────────────

export const TeamStatisticsQuery = LocaleQuery.extend({
  competition: z.string().min(1).max(120).optional().meta({
    description:
      'UUID ou slug da competição. Sem ele, a competição da temporada pedida (ou da mais recente) em que o time mais jogou.',
  }),
  season: z.coerce.number().int().min(1900).max(2100).optional().meta({
    description: 'Ano da temporada. Sem ele, a mais recente com estatísticas (da competição, se informada).',
    example: 2026,
  }),
});
export type TeamStatisticsQuery = z.input<typeof TeamStatisticsQuery>;

const count = z.number().int().nullable();

const HomeAwayTotal = z
  .object({ home: count, away: count, total: count })
  .meta({ id: 'HomeAwayTotal', description: 'Em casa, fora e no total (null: o dado não veio).' });

const HomeAwayAverage = z
  .object({ home: z.number().nullable(), away: z.number().nullable(), total: z.number().nullable() })
  .meta({ id: 'HomeAwayAverage', description: 'Média por jogo em casa, fora e no total.' });

const MinuteRange = z
  .object({
    from: z.number().int().nullable().meta({ description: 'Minuto inicial (null: minuto não informado).' }),
    to: z.number().int().nullable(),
    count: z.number().int(),
  })
  .meta({
    id: 'MinuteRange',
    description: 'Quantos numa faixa de minutos do jogo. Faixas sem nenhum ficam de fora.',
  });

const GoalLine = z
  .object({ line: z.number(), over: count, under: count })
  .meta({ id: 'GoalLine', description: 'Jogos acima e abaixo da linha de gols (0.5, 1.5, 2.5...).' });

const ScoreLine = z
  .object({ for: z.number().int(), against: z.number().int() })
  .meta({ id: 'ScoreLine', description: 'Placar visto pelo time: os gols dele e os do adversário.' });

const HomeAway = <T extends z.ZodType>(t: T) => z.object({ home: t.nullable(), away: t.nullable() });

export const TeamSeasonStatistics = z
  .object({
    competition: CompetitionSummary.pick({ id: true, slug: true, name: true, logo: true }),
    season: SeasonRef,
    form: z.string().nullable().meta({
      description:
        'Resultados da temporada (W vitória, D empate, L derrota), do mais recente ao mais antigo.',
      example: 'WWDLW',
    }),
    record: z
      .object({ played: HomeAwayTotal, won: HomeAwayTotal, drawn: HomeAwayTotal, lost: HomeAwayTotal })
      .meta({ description: 'Jogos, vitórias, empates e derrotas.' }),
    goals: z.object({
      scored: HomeAwayTotal,
      conceded: HomeAwayTotal,
      scored_average: HomeAwayAverage,
      conceded_average: HomeAwayAverage,
      scored_by_minute: z.array(MinuteRange),
      conceded_by_minute: z.array(MinuteRange),
      scored_lines: z
        .array(GoalLine)
        .meta({ description: 'Jogos acima e abaixo de cada linha de gols marcados.' }),
      conceded_lines: z.array(GoalLine),
    }),
    clean_sheets: HomeAwayTotal.meta({ description: 'Jogos sem sofrer gol.' }),
    failed_to_score: HomeAwayTotal.meta({ description: 'Jogos sem marcar.' }),
    streaks: z
      .object({ wins: count, draws: count, losses: count })
      .meta({ description: 'Maiores sequências da temporada.' }),
    biggest: z.object({
      win: HomeAway(ScoreLine).meta({ description: 'Maior vitória em casa e fora.' }),
      loss: HomeAway(ScoreLine).meta({ description: 'Maior derrota em casa e fora.' }),
      scored: HomeAway(z.number().int()).meta({ description: 'Mais gols marcados num jogo.' }),
      conceded: HomeAway(z.number().int()).meta({ description: 'Mais gols sofridos num jogo.' }),
    }),
    penalties: z.object({ scored: count, missed: count, total: count }),
    formations: z
      .array(z.object({ formation: z.string().meta({ example: '4-2-3-1' }), played: z.number().int() }))
      .meta({ description: 'Formações usadas, da mais usada para a menos.' }),
    cards: z.object({
      yellow: count.meta({ description: 'Amarelos na temporada (soma das faixas de minuto).' }),
      red: count,
      yellow_by_minute: z.array(MinuteRange),
      red_by_minute: z.array(MinuteRange),
    }),
    updated_at: z
      .string()
      .meta({ description: 'Quando o fornecedor entregou estes números (ISO 8601, UTC).' }),
  })
  .meta({ id: 'TeamSeasonStatistics' });
export type TeamSeasonStatistics = z.infer<typeof TeamSeasonStatistics>;

export const TeamStatistics = z
  .object({
    team_id: z.uuid(),
    sport: z.string().meta({ example: 'football' }),
    data: TeamSeasonStatistics.nullable().meta({
      description:
        'As estatísticas da competição e temporada escolhidas; null quando não há (o esporte ainda não tem o dado ou a temporada não foi coletada).',
    }),
    available: z
      .array(
        z.object({
          competition: CompetitionSummary.pick({ id: true, slug: true, name: true, logo: true }),
          season: SeasonRef,
        }),
      )
      .meta({
        description:
          'Todas as competições e temporadas com estatísticas do time, da mais recente à mais antiga (para seletores).',
      }),
  })
  .meta({ id: 'TeamStatistics' });
export type TeamStatistics = z.infer<typeof TeamStatistics>;
