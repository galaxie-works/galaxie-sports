import * as z from 'zod';
import { CompetitionParams, ParticipantRef } from './catalog.js';
import { AssetUrl, LocaleQuery } from './common.js';

// ─── galeria de campeões (`/v1/competitions/{id}/champions`, issue #831) ───────────────────────────

export const ChampionsParams = CompetitionParams;

export const ChampionsQuery = LocaleQuery.extend({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .meta({ description: 'Quantas edições, da mais recente para trás (1–200; padrão: todas).' }),
  runner_up: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional()
    .meta({
      description:
        'Inclui o vice de cada edição (`true`). Sai da final da temporada (mata-mata) ou do 2º lugar da tabela ' +
        'única (pontos corridos) quando o nosso banco tem a temporada e o campeão bate com ela; senão, null.',
    }),
});
export type ChampionsQuery = z.input<typeof ChampionsQuery>;

export const ChampionEdition = z
  .object({
    season_year: z.number().int().meta({ description: 'Ano da temporada ("2020–21" → 2020).' }),
    season_label: z.string().meta({ description: 'Rótulo da edição ("2021", "2020–21").', example: '2023' }),
    decided_on: z.string().meta({ description: 'Data (AAAA-MM-DD) em que o título foi decidido.' }),
    champion: ParticipantRef.nullable().meta({
      description: 'Campeão; null quando o vencedor não está no nosso catálogo de times.',
    }),
    runner_up: ParticipantRef.nullable().meta({
      description: 'Vice (só com `runner_up=true`); null quando não dá para afirmar.',
    }),
  })
  .meta({ id: 'ChampionEdition' });

export const ChampionRankingRow = z
  .object({
    rank: z.number().int().meta({ description: 'Posição (empatados dividem a posição).' }),
    participant: ParticipantRef,
    titles: z.number().int(),
    seasons: z.array(z.string()).meta({ description: 'Edições vencidas, da mais recente para trás.' }),
  })
  .meta({ id: 'ChampionRankingRow' });

export const CompetitionChampions = z
  .object({
    competition: z.object({
      id: z.uuid(),
      slug: z.string(),
      sport: z.string(),
      name: z.string(),
      logo: AssetUrl,
    }),
    editions: z
      .array(ChampionEdition)
      .meta({ description: 'Da mais recente para trás, cortada por `limit`.' }),
    total_editions: z.number().int().meta({ description: 'Edições conhecidas antes do corte de `limit`.' }),
    ranking: z.array(ChampionRankingRow).meta({
      description:
        'Quem tem mais títulos (todas as edições, não só as do `limit`): mais títulos, depois o título mais ' +
        'recente, depois o nome. Vazio quando a lista de campeões não está completa (`ranking_complete`).',
    }),
    ranking_complete: z.boolean().meta({
      description:
        'A lista de campeões não tem lacuna desde a primeira edição conhecida até a última e todo campeão está ' +
        'no catálogo de times, então a contagem de títulos é confiável.',
    }),
    coverage: z
      .object({
        first_year: z.number().int().nullable(),
        complete_through: z.number().int().nullable(),
      })
      .nullable()
      .meta({
        description: 'Período coberto sem lacunas; null quando a competição não tem lista de campeões.',
      }),
  })
  .meta({ id: 'CompetitionChampions' });
export type CompetitionChampions = z.infer<typeof CompetitionChampions>;
