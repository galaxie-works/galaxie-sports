import 'zod-openapi';
import * as z from 'zod';
import { LocaleQuery, PaginationQuery } from './common.js';

/*
 * Contratos do módulo multiesportivo (Olimpíadas e Pan-Americanos — docs/08 §4, issues #75 e #78).
 * Regra de qualidade: quadro/ranking de medalhas só é publicado com `medal_data_quality` complete ou
 * partial; nos demais casos a resposta vem sinalizada (`publishable: false`) e sem linhas.
 */

export const MS_GAMES_TYPES = ['OG', 'YOG', 'PAN', 'PARAPAN', 'PAN_JR'] as const;
export const MS_GAMES_SEASONS = ['summer', 'winter'] as const;
export const MS_GAMES_STATUSES = ['completed', 'in_progress', 'upcoming'] as const;
export const MEDAL_DATA_QUALITIES = ['complete', 'partial', 'insufficient', 'unknown'] as const;

const typeList = z
  .string()
  .transform((v) =>
    v
      .toUpperCase()
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.enum(MS_GAMES_TYPES)).min(1))
  .meta({
    description: 'Um ou mais tipos separados por vírgula (OG, PAN, YOG, PARAPAN, PAN_JR).',
    example: 'OG,PAN',
  });

const nocCode = z
  .string()
  .regex(/^[A-Za-z0-9]{3}$/, 'código COI de 3 caracteres')
  .transform((v) => v.toUpperCase())
  .meta({ example: 'BRA' });

const nocList = z
  .string()
  .transform((v) =>
    v
      .toUpperCase()
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .pipe(
    z
      .array(z.string().regex(/^[A-Z0-9]{3}$/, 'código COI de 3 caracteres'))
      .min(1)
      .max(50),
  )
  .meta({ description: 'Códigos COI separados por vírgula.', example: 'BRA,ARG' });

const isoDate = z.iso.date().meta({ example: '2024-08-01' });

// ─── edições ─────────────────────────────────────────────────────────────────────────────────────

export const MedalDataQuality = z
  .object({
    level: z.enum(MEDAL_DATA_QUALITIES).nullable().meta({ description: 'Selo de qualidade do quadro.' }),
    coverage: z
      .number()
      .nullable()
      .meta({ description: 'Medalhas carregadas ÷ medalhas distribuídas (0–1), quando há referência.' }),
    publishable: z.boolean().meta({
      description: 'true só com complete ou partial (docs/08 §6.4). Sem isso, nada de quadro/ranking.',
    }),
    notice: z
      .string()
      .nullable()
      .meta({ description: 'Aviso localizado (cobertura parcial ou dados insuficientes).' }),
  })
  .meta({ id: 'MedalDataQuality' });
export type MedalDataQuality = z.infer<typeof MedalDataQuality>;

export const GamesSummary = z
  .object({
    slug: z.string().meta({ example: 'og-summer-2024' }),
    type: z.enum(MS_GAMES_TYPES),
    season: z.enum(MS_GAMES_SEASONS),
    year: z.number().int(),
    edition: z.number().int().nullable(),
    name: z.string().meta({ example: 'Jogos Olímpicos Paris 2024' }),
    host_city: z.string(),
    host_noc: z.string().nullable(),
    start_date: isoDate,
    end_date: isoDate,
    tz: z.string().meta({ description: 'Fuso IANA da sede.', example: 'Europe/Paris' }),
    status: z.enum(MS_GAMES_STATUSES),
    medal_data_quality: MedalDataQuality,
  })
  .meta({ id: 'GamesSummary' });
export type GamesSummary = z.infer<typeof GamesSummary>;

export const GamesDetail = GamesSummary.extend({
  competitions: z
    .array(
      z.object({
        id: z.uuid(),
        slug: z.string(),
        name: z.string(),
        sport: z.string().meta({ example: 'football' }),
        gender: z.string().meta({ description: 'M | W | X | O' }),
        season: z.object({ year: z.number().int(), label: z.string() }).nullable(),
        provider_league_id: z.string(),
      }),
    )
    .meta({
      description:
        'Torneios coletivos da edição já presentes no core (ex.: futebol olímpico da api-sports); seus jogos ' +
        'estão em /v1/events.',
    }),
}).meta({ id: 'GamesDetail' });
export type GamesDetail = z.infer<typeof GamesDetail>;

export const GamesListQuery = LocaleQuery.extend({
  type: typeList.optional(),
  year: z.coerce.number().int().min(1890).max(2100).optional(),
  season: z.enum(MS_GAMES_SEASONS).optional(),
  status: z.enum(MS_GAMES_STATUSES).optional(),
});
export type GamesListQuery = z.input<typeof GamesListQuery>;

export const GamesParams = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug inválido')
    .max(60)
    .meta({ example: 'og-summer-2024' }),
});

export const SourceAttribution = z
  .object({
    source: z.string().meta({ example: 'wikidata' }),
    license: z.string().nullable().meta({ example: 'CC0-1.0' }),
    url: z.string().nullable(),
  })
  .meta({ id: 'SourceAttribution' });

// ─── quadro de medalhas ──────────────────────────────────────────────────────────────────────────

export const NocRef = z
  .object({
    code: z.string().meta({ example: 'BRA' }),
    name: z.string().meta({ example: 'Brasil' }),
    iso2: z.string().nullable().meta({ example: 'BR' }),
  })
  .meta({ id: 'NocRef' });

export const MedalCounts = z.object({
  gold: z.number().int(),
  silver: z.number().int(),
  bronze: z.number().int(),
  total: z.number().int(),
});

export const MedalTableRow = MedalCounts.extend({
  rank: z.number().int().meta({ description: 'Posição no critério pedido (`sort`); empates dividem.' }),
  noc: NocRef,
  rank_by_gold: z.number().int(),
  rank_by_total: z.number().int(),
}).meta({ id: 'MedalTableRow' });

export const MedalsQuery = LocaleQuery.extend({
  sort: z.enum(['gold', 'total']).default('gold'),
  region: z
    .enum(['latam'])
    .optional()
    .meta({ description: 'latam = só CONs da América Latina (posições continuam as globais).' }),
  noc: nocList.optional(),
});
export type MedalsQuery = z.input<typeof MedalsQuery>;

export const MedalTable = z
  .object({
    games: GamesSummary,
    sort: z.enum(['gold', 'total']),
    data_quality: MedalDataQuality,
    sources: z.array(SourceAttribution),
    data: z.array(MedalTableRow).meta({ description: 'Vazio quando `data_quality.publishable` é false.' }),
  })
  .meta({ id: 'MedalTable' });
export type MedalTable = z.infer<typeof MedalTable>;

// ─── agenda e provas ─────────────────────────────────────────────────────────────────────────────

export const DisciplineRef = z
  .object({
    code: z.string().meta({ example: 'SWM' }),
    name: z.string().meta({ example: 'Natação' }),
    sport: z.object({ code: z.string(), name: z.string() }),
  })
  .meta({ id: 'DisciplineRef' });

export const MsEventRef = z
  .object({
    id: z.uuid(),
    name: z.string(),
    gender: z.enum(['M', 'W', 'X', 'O']),
    is_team: z.boolean(),
    discipline: DisciplineRef.nullable(),
  })
  .meta({ id: 'MsEventRef' });

export const ScheduleUnit = z
  .object({
    id: z.uuid(),
    name: z.string().nullable(),
    starts_at: z.string().nullable().meta({ description: 'ISO 8601 no fuso pedido (`tz`).' }),
    ends_at: z.string().nullable(),
    status: z.enum(['scheduled', 'live', 'finished', 'delayed', 'cancelled']),
    venue: z.string().nullable(),
    is_medal_unit: z.boolean(),
    core_event_id: z.uuid().nullable().meta({ description: 'Evento canônico (/v1/events) quando existir.' }),
    phase: z.object({ code: z.string(), name: z.string() }),
    event: MsEventRef,
  })
  .meta({ id: 'ScheduleUnit' });
export type ScheduleUnit = z.infer<typeof ScheduleUnit>;

export const ScheduleQuery = LocaleQuery.extend(PaginationQuery.shape).extend({
  date: isoDate.optional().meta({ description: 'Dia local (no `tz` pedido; sem `tz`, no fuso da sede).' }),
  sport: z
    .string()
    .max(10)
    .transform((v) => v.toUpperCase())
    .optional()
    .meta({ description: 'Código do esporte ou da disciplina (ODF).', example: 'ATH' }),
  noc: nocCode.optional(),
  medal_only: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type ScheduleQuery = z.input<typeof ScheduleQuery>;

export const GamesEventParams = GamesParams.extend({ id: z.uuid() });

export const MsResult = z
  .object({
    participant: z.object({
      id: z.uuid(),
      kind: z.enum(['athlete', 'team']),
      name: z.string(),
      noc: z.string(),
    }),
    rank: z.number().int().nullable(),
    value: z.string().nullable(),
    type: z.string().nullable(),
    irm: z.string().nullable(),
    records: z.array(z.string()),
  })
  .meta({ id: 'MsResult' });

export const MsMedal = z
  .object({
    medal: z.enum(['G', 'S', 'B']),
    noc: NocRef,
    participant: z.object({
      id: z.uuid(),
      kind: z.enum(['athlete', 'team']),
      name: z.string(),
      members: z.array(z.string()).meta({ description: 'Integrantes (provas por equipe).' }),
    }),
    awarded_at: isoDate.nullable(),
    revoked: z.boolean(),
  })
  .meta({ id: 'MsMedal' });

export const MsEventDetail = MsEventRef.extend({
  games: z.object({ slug: z.string(), name: z.string() }),
  event_date: isoDate.nullable(),
  phases: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      units: z.array(ScheduleUnit.omit({ event: true, phase: true }).extend({ results: z.array(MsResult) })),
    }),
  ),
  medals: z.array(MsMedal).meta({ description: 'Medalhas da prova, inclusive revogadas (`revoked`).' }),
}).meta({ id: 'MsEventDetail' });
export type MsEventDetail = z.infer<typeof MsEventDetail>;

// ─── delegações e "hoje" ─────────────────────────────────────────────────────────────────────────

export const GamesNocParams = GamesParams.extend({ noc: nocCode });

export const DelegationAthlete = z
  .object({
    person_id: z.uuid(),
    name: z.string(),
    gender: z.string().nullable(),
    birth_date: isoDate.nullable(),
    medals: MedalCounts,
    events: z.array(z.object({ id: z.uuid(), name: z.string(), medal: z.enum(['G', 'S', 'B']).nullable() })),
  })
  .meta({ id: 'DelegationAthlete' });

export const Delegation = z
  .object({
    games: GamesSummary,
    noc: NocRef,
    basis: z.enum(['medals_and_results']).meta({
      description: 'Delegação derivada de medalhas e resultados (lista de inscritos ainda não carregada).',
    }),
    data: z.array(DelegationAthlete),
  })
  .meta({ id: 'Delegation' });
export type Delegation = z.infer<typeof Delegation>;

export const TodayQuery = LocaleQuery.extend({
  date: isoDate.optional().meta({ description: 'Dia local (padrão: hoje no `tz` ou no fuso da sede).' }),
});

export const NocToday = z
  .object({
    games: GamesSummary,
    noc: NocRef,
    date: isoDate,
    tz: z.string(),
    units: z.array(ScheduleUnit).meta({ description: 'Unidades do dia com participação do CON.' }),
    medals: z
      .array(MsMedal.extend({ event: MsEventRef }))
      .meta({ description: 'Medalhas conquistadas no dia (vazio quando o quadro não é publicável).' }),
    medal_data_quality: MedalDataQuality,
    medal_chances: z.null().meta({ description: 'Reservado: projeções rotuladas (ainda não disponível).' }),
    where_to_watch: z
      .null()
      .meta({ description: 'Reservado: onde assistir por unidade (via core_event_id).' }),
  })
  .meta({ id: 'NocToday' });
export type NocToday = z.infer<typeof NocToday>;

// ─── histórico ───────────────────────────────────────────────────────────────────────────────────

export const MedalHistoryQuery = LocaleQuery.extend({
  noc: nocList,
  type: typeList.default(['OG', 'PAN']),
  season: z.enum(MS_GAMES_SEASONS).optional(),
});
export type MedalHistoryQuery = z.input<typeof MedalHistoryQuery>;

export const MedalHistoryRow = MedalCounts.extend({
  games: z.object({
    slug: z.string(),
    type: z.enum(MS_GAMES_TYPES),
    season: z.enum(MS_GAMES_SEASONS),
    year: z.number().int(),
    name: z.string(),
  }),
  noc: z.string(),
  rank_by_gold: z.number().int(),
  rank_by_total: z.number().int(),
  data_quality: MedalDataQuality,
}).meta({ id: 'MedalHistoryRow' });

export const MedalHistory = z
  .object({
    nocs: z.array(NocRef),
    data: z.array(MedalHistoryRow).meta({ description: 'Só edições com quadro publicável.' }),
    totals: z
      .array(MedalCounts.extend({ noc: z.string() }))
      .meta({ description: 'Soma das edições publicadas.' }),
    withheld: z
      .array(
        z.object({
          slug: z.string(),
          name: z.string(),
          data_quality: MedalDataQuality,
        }),
      )
      .meta({
        description:
          'Edições já iniciadas do filtro (tipo, temporada) sem quadro publicável (`insufficient`, `unknown`), ' +
          'com ou sem medalha do CON carregada: o cliente distingue "retida" de "sem participação" (edição ' +
          'publicada sem o CON em `data`). Edições futuras não entram. Só as 10 mais recentes, em ordem ' +
          'cronológica; o total está em `withheld_total`.',
      }),
    withheld_total: z.number().int().min(0).meta({
      description: 'Quantas edições do filtro estão retidas (`withheld` traz só as 10 mais recentes).',
    }),
    sources: z.array(SourceAttribution),
  })
  .meta({ id: 'MedalHistory' });
export type MedalHistory = z.infer<typeof MedalHistory>;
