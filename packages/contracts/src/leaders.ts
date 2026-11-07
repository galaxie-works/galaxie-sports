import 'zod-openapi';
import * as z from 'zod';
import { AssetUrl, LocaleQuery } from './common.js';
import { ParticipantRef, SeasonRef } from './catalog.js';

// ─── artilharia e líderes do campeonato (#828) ───────────────────────────────────────────────────

export const LEADER_CATEGORIES = ['goals', 'assists', 'cards'] as const;
export type LeaderCategory = (typeof LEADER_CATEGORIES)[number];

export const LeadersQuery = LocaleQuery.extend({
  category: z.enum(LEADER_CATEGORIES).default('goals').meta({
    description:
      '`goals` = artilharia; `assists` = assistências; `cards` = cartões (amarelos + vermelhos; na mesma posição, mais vermelhos vêm antes).',
    example: 'goals',
  }),
  limit: z.coerce.number().int().min(1).max(50).default(10).meta({
    description:
      'Até que posição (1–50). Quem empata com o último também entra, então a lista pode passar do `limit`; o teto é 50 linhas, sem partir uma posição (só a 1ª, se sozinha passar de 50, vem cortada em 50).',
  }),
});
export type LeadersQuery = z.input<typeof LeadersQuery>;

export const LeaderRow = z
  .object({
    rank: z
      .number()
      .int()
      .meta({ description: 'Posição; empatados no valor dividem a mesma posição (1, 2, 2, 4).' }),
    person: z.object({
      id: z.uuid(),
      name: z.string(),
      photo: AssetUrl,
    }),
    team: ParticipantRef.nullable().meta({
      description:
        'Time pelo qual o jogador mais jogou no campeonato (quem trocou de clube no meio da temporada soma os dois). Empate em jogos e minutos tem desempate estável.',
    }),
    value: z.number().int().meta({ description: 'O número da categoria (gols, assistências ou cartões).' }),
    appearances: z.number().int(),
    minutes: z.number().int(),
    goals: z.number().int(),
    assists: z.number().int(),
    yellow_cards: z.number().int(),
    red_cards: z.number().int(),
  })
  .meta({ id: 'LeaderRow' });
export type LeaderRow = z.infer<typeof LeaderRow>;

export const CompetitionLeaders = z
  .object({
    competition_id: z.uuid(),
    sport: z.string().meta({ example: 'football' }),
    season: SeasonRef,
    category: z.enum(LEADER_CATEGORIES),
    data: z.array(LeaderRow).meta({
      description:
        'Do maior para o menor. Na mesma posição: nos cartões, mais vermelhos primeiro; depois menos jogos e menos minutos. Só quem tem valor maior que zero.',
    }),
    updated_at: z.string().nullable().meta({
      description: 'Última atualização dos números da temporada (ISO 8601 no fuso pedido, `tz`).',
    }),
  })
  .meta({ id: 'CompetitionLeaders' });
export type CompetitionLeaders = z.infer<typeof CompetitionLeaders>;
