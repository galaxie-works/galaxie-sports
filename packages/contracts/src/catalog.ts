import 'zod-openapi';
import * as z from 'zod';
import { AssetUrl, CountryRef, LocaleQuery, LogoCredit, LogoSource, PaginationQuery } from './common.js';
import { Photo, TeamLivery } from './racing.js';

// ─── esportes ────────────────────────────────────────────────────────────────────────────────────

export const Sport = z
  .object({
    slug: z.string().meta({ example: 'football' }),
    name: z.string().meta({ example: 'Futebol' }),
    competitions: z.number().int().meta({ description: 'Competições catalogadas.' }),
    mirror: z
      .string()
      .nullable()
      .meta({ description: 'Prefixo do espelho compatível, quando houver.', example: '/mirror/football' }),
  })
  .meta({ id: 'Sport' });
export type Sport = z.infer<typeof Sport>;

// ─── países ──────────────────────────────────────────────────────────────────────────────────────

export const Country = z
  .object({
    code: z
      .string()
      .meta({ description: 'ISO 3166-1 alpha-2 (ou extensão como GB-ENG; WORLD).', example: 'BR' }),
    name: z.string().meta({ example: 'Brasil' }),
    ioc_code: z.string().nullable().meta({ example: 'BRA' }),
    confederation: z.string().nullable().meta({ example: 'CONMEBOL' }),
    flag: AssetUrl,
  })
  .meta({ id: 'Country' });
export type Country = z.infer<typeof Country>;

// ─── competições ─────────────────────────────────────────────────────────────────────────────────

export const SeasonRef = z
  .object({ year: z.number().int().meta({ example: 2026 }), label: z.string().meta({ example: '2026' }) })
  .meta({ id: 'SeasonRef' });

export const Season = z
  .object({
    year: z.number().int().meta({ example: 2026 }),
    label: z.string().meta({ example: '2025/26' }),
    start_date: z.iso.date().nullable(),
    end_date: z.iso.date().nullable(),
    current: z.boolean(),
    coverage: z.unknown().nullable().meta({ description: 'Cobertura informada pelo provedor.' }),
  })
  .meta({ id: 'Season' });
export type Season = z.infer<typeof Season>;

export const COMPETITION_TYPES = ['league', 'cup', 'tournament', 'multisport'] as const;

export const CompetitionSummary = z
  .object({
    id: z.uuid(),
    slug: z.string().meta({ example: 'libertadores' }),
    sport: z.string().meta({ example: 'football' }),
    name: z.string().meta({ description: 'Nome localizado (ou o oficial).', example: 'Libertadores' }),
    official_name: z.string().meta({ example: 'CONMEBOL Libertadores' }),
    nicknames: z.array(z.string()).meta({ example: ['Glória Eterna', 'Liberta'] }),
    type: z.enum(COMPETITION_TYPES),
    tier: z.number().int().min(1).max(3).meta({ description: '1 = cobertura máxima; 3 = apenas espelho.' }),
    country: CountryRef.nullable(),
    level: z
      .enum(['national', 'regional'])
      .nullable()
      .optional()
      .meta({
        description:
          'Nível da doméstica: `national` (Série A a D, Copa do Brasil) ou `regional` (estaduais, Copa do ' +
          'Nordeste); null nas internacionais. Ausente nos blocos que não trazem o nível.',
        example: 'national',
      }),
    order: z
      .number()
      .int()
      .nullable()
      .optional()
      .meta({
        description:
          'Posição editorial da doméstica no país, dentro do nível (Série A 0, Copa do Brasil 1, Série B 2…; ' +
          'Paulista 0, Carioca 1… nas regionais); null sem posição (ordem por tier e nome).',
        example: 0,
      }),
    logo: AssetUrl,
    current_season: SeasonRef.nullable(),
  })
  .meta({ id: 'CompetitionSummary' });
export type CompetitionSummary = z.infer<typeof CompetitionSummary>;

export const Competition = CompetitionSummary.extend({
  logo_source: LogoSource,
  logo_credit: LogoCredit.nullable().meta({
    description:
      'Crédito do logo quando ele vem da Wikimedia Commons (`logo_source` = `commons`); null nos demais.',
  }),
  trophy_nickname: z.string().nullable(),
  external_ids: z
    .record(z.string(), z.string())
    .meta({ description: 'IDs nos provedores de dados.', example: { 'api-sports': '13' } }),
  seasons: z.array(Season),
}).meta({ id: 'Competition' });
export type Competition = z.infer<typeof Competition>;

export const CompetitionsQuery = LocaleQuery.extend(PaginationQuery.shape).extend({
  sport: z.string().max(40).optional().meta({ example: 'football' }),
  country: z
    .string()
    .max(20)
    .transform((v) => v.toUpperCase())
    .optional()
    .meta({ description: 'Código do país.', example: 'BR' }),
  tier: z.coerce.number().int().min(1).max(3).optional(),
  q: z.string().trim().min(2).max(80).optional().meta({ description: 'Busca por nome, slug ou apelido.' }),
});
export type CompetitionsQuery = z.input<typeof CompetitionsQuery>;

export const CompetitionParams = z.object({
  id: z
    .string()
    .min(1)
    .max(120)
    .meta({ description: 'UUID ou slug da competição.', example: 'libertadores' }),
});

export const StandingsParams = CompetitionParams.extend({
  season: z
    .string()
    .regex(/^(\d{4}|current)$/, 'use o ano (ex.: 2026) ou "current"')
    .meta({ description: 'Ano da temporada ou `current`.', example: '2026' }),
});

// ─── tabelas ─────────────────────────────────────────────────────────────────────────────────────

export const ParticipantRef = z
  .object({
    id: z.uuid(),
    name: z.string(),
    short_name: z.string().nullable(),
    logo: AssetUrl,
  })
  .meta({ id: 'ParticipantRef' });

export const StandingRow = z
  .object({
    rank: z.number().int(),
    participant: ParticipantRef,
    points: z.number().int(),
    played: z.number().int(),
    won: z.number().int(),
    drawn: z.number().int(),
    lost: z.number().int(),
    ot_won: z.number().int().nullable().meta({
      description:
        'Das vitórias (`won`), quantas foram na prorrogação ou nos pênaltis (hóquei); null nos outros esportes.',
    }),
    ot_lost: z.number().int().nullable().meta({
      description:
        'Das derrotas (`lost`), quantas foram na prorrogação ou nos pênaltis (hóquei); null nos outros esportes.',
    }),
    goals_for: z.number().int(),
    goals_against: z.number().int(),
    goal_diff: z.number().int(),
    form: z.string().nullable().meta({ example: 'WWDLW' }),
    description: z.string().nullable().meta({ example: 'Promotion - CONMEBOL Libertadores' }),
    photo: Photo.nullable().optional().meta({
      description:
        'Corridas (F1): retrato do piloto no acervo de licenças livres, com o crédito (o mesmo de `/v1/teams/{id}/photos`); null sem retrato. Ausente nos outros esportes.',
    }),
    season_team: z
      .object({
        id: z
          .uuid()
          .nullable()
          .meta({ description: 'A equipe no catálogo (`/v1/teams/{id}`), quando ligada.' }),
        name: z.string().meta({
          description: 'Nome da equipe naquela temporada (McLaren em 1988, não o nome de hoje).',
          example: 'McLaren',
        }),
        livery: TeamLivery.nullable(),
      })
      .nullable()
      .optional()
      .meta({
        description:
          'Corridas (F1): a equipe da temporada, com o nome de época e a pintura curada. No campeonato de pilotos, a equipe de mais corridas no ano; no de construtores, a própria. Ausente nos outros esportes.',
      }),
    podiums: z.number().int().nullable().optional().meta({
      description:
        'Corridas (F1): pódios na temporada (só Grandes Prêmios, sprints à parte). Ausente nos outros esportes.',
      example: 11,
    }),
  })
  .meta({ id: 'StandingRow' });

export const Standings = z
  .object({
    competition_id: z.uuid(),
    season: SeasonRef,
    groups: z.array(
      z.object({
        name: z.string().nullable().meta({ description: 'Grupo (null em liga de grupo único).' }),
        rows: z.array(StandingRow),
      }),
    ),
    source: z.enum(['provider', 'computed']).nullable(),
    updated_at: z.string().nullable().meta({ description: 'ISO 8601 no fuso pedido (`tz`).' }),
  })
  .meta({ id: 'Standings' });
export type Standings = z.infer<typeof Standings>;

// ─── venues ──────────────────────────────────────────────────────────────────────────────────────

export const FormerName = z
  .object({
    name: z.string().meta({ example: 'Allianz Parque' }),
    from: z.iso
      .date()
      .nullable()
      .meta({ description: 'Primeiro dia conhecido; null quando a fonte não diz.' }),
    until: z.iso
      .date()
      .meta({ description: 'Último dia em que o nome valeu (ou foi visto).', example: '2026-05-03' }),
    origin: z.enum(['curated', 'provider']).meta({
      description:
        '`curated` = base semântica (revisão editorial, vence o fornecedor); `provider` = derivado dos jogos do fornecedor (nome que cada partida trazia no dia).',
    }),
    confidence: z.enum(['high', 'low']).meta({
      description:
        '`high` = curadoria confirmada editorialmente; `low` = derivado do fornecedor: **pista** para busca e casamento de nomes, não fato confirmado (pode ser casa provisória ou nome de torneio). Para exibir ao usuário final, use só `high`.',
      example: 'high',
    }),
  })
  .meta({
    id: 'FormerName',
    description:
      'Nome anterior. Os de origem `provider` (confiança `low`) nunca substituem o nome atual e não devem ser exibidos como fato.',
  });
export type FormerName = z.infer<typeof FormerName>;

export const Venue = z
  .object({
    id: z.uuid(),
    name: z.string().meta({
      description:
        'Nome atual: o da curadoria (base semântica) quando existe, senão o do fornecedor. Jogos anteriores a uma troca de nome também usam o nome atual.',
      example: 'Nubank Parque',
    }),
    city: z.string().nullable(),
    country: CountryRef.nullable(),
    capacity: z.number().int().nullable(),
    surface: z.string().nullable(),
    image: AssetUrl,
    provider_name: z.string().meta({
      description: 'Nome como o fornecedor de dados manda (pode estar desatualizado).',
      example: 'Allianz Parque',
    }),
    former_names: z.array(FormerName).meta({
      description:
        'Nomes anteriores: os da curadoria (`confidence: high`) primeiro e depois as pistas do fornecedor (`low`), cada grupo do mais recente ao mais antigo.',
    }),
  })
  .meta({ id: 'Venue' });
export type Venue = z.infer<typeof Venue>;

export const IdParams = z.object({ id: z.uuid() });
