import * as z from 'zod';
import { CompetitionParams, ParticipantRef, StandingsParams } from './catalog.js';
import { AssetUrl, LocaleQuery } from './common.js';

// ─── líderes do campeonato (artilharia, assistências, cartões) ──────────────────────────────────

export const LEADER_CATEGORIES = ['assists', 'cards', 'goals'] as const;
export type LeaderCategory = (typeof LEADER_CATEGORIES)[number];

export const LeadersParams = StandingsParams;

export const LeadersQuery = LocaleQuery.extend({
  category: z.enum(LEADER_CATEGORIES).default('goals').meta({
    description:
      '`goals` = artilharia; `assists` = assistências; `cards` = cartões (amarelos + vermelhos, os vermelhos desempatam).',
  }),
  limit: z.coerce.number().int().min(1).max(50).default(10).meta({ description: 'Jogadores (1–50).' }),
});
export type LeadersQuery = z.input<typeof LeadersQuery>;

export const LeaderPerson = z
  .object({
    id: z.uuid(),
    name: z.string().meta({ example: 'Pedro' }),
    photo: AssetUrl,
    nationality: z.string().nullable().meta({ description: 'Como o fornecedor manda.', example: 'Brazil' }),
  })
  .meta({ id: 'LeaderPerson' });

export const LeaderRow = z
  .object({
    rank: z
      .number()
      .int()
      .meta({ description: 'Posição; empatados no número da categoria dividem a posição.' }),
    person: LeaderPerson,
    team: ParticipantRef.nullable().meta({
      description: 'Time em que o jogador mais jogou na temporada da competição.',
    }),
    teams: z
      .number()
      .int()
      .meta({ description: 'Quantos times ele defendeu nesta temporada da competição.' }),
    appearances: z.number().int(),
    minutes: z.number().int(),
    goals: z.number().int(),
    assists: z.number().int(),
    yellow_cards: z.number().int(),
    red_cards: z.number().int(),
  })
  .meta({ id: 'LeaderRow' });
export type LeaderRow = z.infer<typeof LeaderRow>;

export const Leaders = z
  .object({
    competition_id: z.uuid(),
    sport: z.string().meta({ example: 'football' }),
    season: z.object({ year: z.number().int(), label: z.string() }),
    category: z.enum(LEADER_CATEGORIES),
    data: z.array(LeaderRow).meta({
      description:
        'Só quem tem número na categoria (artilharia sem gol fica de fora). Vazio quando o esporte ou a temporada não tem estatística de jogador.',
    }),
    updated_at: z
      .string()
      .nullable()
      .meta({ description: 'Última atualização das estatísticas (ISO 8601, `tz`).' }),
  })
  .meta({ id: 'Leaders' });
export type Leaders = z.infer<typeof Leaders>;

// ─── galeria de campeões ─────────────────────────────────────────────────────────────────────────

export const ChampionsParams = CompetitionParams;

export const ChampionsQuery = LocaleQuery.extend({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .meta({ description: 'Edições, das mais recentes (1–100).' }),
});
export type ChampionsQuery = z.input<typeof ChampionsQuery>;

export const ChampionEdition = z
  .object({
    season_year: z.number().int().meta({ example: 2025 }),
    season_label: z.string().meta({ description: 'Rótulo da edição ("2025", "2024–25").', example: '2025' }),
    decided_on: z.iso.date().meta({ description: 'Dia em que o título foi decidido.' }),
    champion: ParticipantRef.nullable().meta({
      description: 'null quando o vencedor da edição ainda não está ligado a um time da base.',
    }),
    runner_up: ParticipantRef.nullable().meta({
      description:
        'Vice: o outro finalista (copas) ou o 2º da tabela em que o campeão foi 1º (ligas). null quando a temporada não está na base.',
    }),
  })
  .meta({ id: 'ChampionEdition' });
export type ChampionEdition = z.infer<typeof ChampionEdition>;

export const TitleCount = z
  .object({
    team: ParticipantRef,
    titles: z.number().int(),
    last: z.string().meta({ description: 'Rótulo da edição mais recente vencida.', example: '2025' }),
  })
  .meta({ id: 'TitleCount' });

export const Champions = z
  .object({
    competition_id: z.uuid(),
    sport: z.string(),
    data: z.array(ChampionEdition).meta({ description: 'Edições da mais recente para trás (até `limit`).' }),
    editions: z
      .number()
      .int()
      .meta({ description: 'Edições guardadas da competição (todas, não só as listadas).' }),
    ranking: z.array(TitleCount).nullable().meta({
      description:
        'Títulos por time, do maior para o menor. null quando a lista de campeões não está completa até a edição mais recente (ano faltando ou edição recusada na importação): sem ela a contagem seria um palpite.',
    }),
    coverage: z
      .object({
        first_year: z.number().int().nullable(),
        complete_through: z
          .number()
          .int()
          .nullable()
          .meta({ description: 'Último ano com a lista completa.' }),
        unidentified: z.number().int().meta({
          description:
            'Edições cujo campeão ainda não está ligado a um time da base (não contam no ranking).',
        }),
      })
      .nullable(),
  })
  .meta({ id: 'Champions' });
export type Champions = z.infer<typeof Champions>;
