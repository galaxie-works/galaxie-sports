import 'zod-openapi';
import * as z from 'zod';
import { LocaleQuery, PaginationQuery } from './common.js';

/*
 * Contratos do hipismo (docs/13-hipismo.md §5). Regras que a API preserva e expõe:
 * - classificação geral (`EqResult`) e rodada (`EqRound`) são registros distintos;
 * - `null` significa "não publicado pela fonte", nunca zero; o valor bruto vem junto (`*_raw`);
 * - toda linha traz `source` (tipo, URL e data de observação) e as divergências conhecidas;
 * - cobertura parcial é sinalizada (`coverage`), nunca escondida.
 */

export const EQ_HISTORY_COVERAGES = ['complete', 'partial', 'not_collected'] as const;
export const EQ_RESULT_STATUSES = ['classified', 'EL', 'RET', 'WD', 'DSQ', 'NS', 'unknown'] as const;
export const EQ_RESULT_KINDS = [
  'athlete_performance_history',
  'competition_entry',
  'calendar_historical_classification',
  'championship_classification',
] as const;

const isoDate = z.iso.date().meta({ example: '2026-10-18' });

const codeList = z
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
      .array(z.string().regex(/^[A-Z]{3}$/, 'código FEI/COI de 3 letras'))
      .min(1)
      .max(20),
  )
  .meta({ description: 'Códigos FEI/COI separados por vírgula.', example: 'BRA,ARG' });

// ─── blocos comuns ───────────────────────────────────────────────────────────────────────────────

export const EqSource = z
  .object({
    provider: z.string().meta({ example: 'fei-public' }),
    kind: z
      .string()
      .nullable()
      .meta({ description: 'Tipo da observação na fonte.', example: 'athlete_performance_history' }),
    url: z.string().nullable(),
    observed_at: z.string().nullable().meta({ description: 'Quando a fonte foi lida (ISO 8601).' }),
    pdf_page: z.number().int().nullable().optional(),
  })
  .meta({ id: 'EqSource', description: 'Proveniência da linha.' });
export type EqSource = z.infer<typeof EqSource>;

export const EqCountry = z
  .object({
    code: z.string().meta({ description: 'Código FEI/COI como publicado.', example: 'ARG' }),
    iso2: z.string().nullable().meta({ example: 'AR' }),
    name: z.string().nullable(),
    flag_url: z.string().nullable(),
  })
  .meta({ id: 'EqCountry' });
export type EqCountry = z.infer<typeof EqCountry>;

export const EqAthleteRef = z
  .object({
    id: z.uuid(),
    fei_id: z.string().nullable().meta({ example: '10000380' }),
    name: z.string().meta({ example: 'Lucas Werthein' }),
    country: EqCountry.nullable(),
  })
  .meta({ id: 'EqAthleteRef' });

export const EqHorseRef = z
  .object({
    id: z.uuid(),
    fei_id: z.string().nullable().meta({ example: 'NED04702' }),
    name: z.string().meta({ example: 'WARREN' }),
    breed: z.string().nullable(),
    born_year: z.number().int().nullable(),
    age: z.number().int().nullable().meta({ description: 'Idade pelo ano de nascimento publicado.' }),
    profile: z.enum(['detailed', 'pending']).meta({ description: 'pending = sem ficha detalhada na base.' }),
  })
  .meta({ id: 'EqHorseRef' });

export const EqCompetitionRef = z
  .object({
    id: z.uuid(),
    name: z.string(),
    level: z.string().nullable().meta({ example: 'CSI5*-W' }),
    stars: z.number().int().nullable(),
    date: isoDate.nullable(),
    venue: z.string().nullable(),
    country: EqCountry.nullable(),
    height_cm: z.number().int().nullable(),
    is_grand_prix: z.boolean(),
  })
  .meta({ id: 'EqCompetitionRef' });

export const EqDataNotice = z
  .object({
    license: z.string().meta({ example: 'fei_public_pages_unlicensed' }),
    commercial: z
      .boolean()
      .meta({ description: 'false = categoria fora da oferta comercial (licenciamento em negociação).' }),
    message: z.string(),
  })
  .meta({ id: 'EqDataNotice' });
export type EqDataNotice = z.infer<typeof EqDataNotice>;

// ─── classificação e rodada ──────────────────────────────────────────────────────────────────────

export const EqScore = z
  .object({
    raw: z.string().nullable().meta({ example: '5(4+1)/78.15' }),
    parse_status: z
      .string()
      .nullable()
      .meta({
        description:
          'explicit_single_round = decomposto com segurança; raw_preserved_requires_article_specific_parser = ' +
          'só o bruto (formato depende do artigo); missing/not_published = sem placar na fonte.',
      }),
    penalties: z.number().nullable(),
    penalties_jumping: z.number().nullable(),
    penalties_time: z.number().nullable(),
    time_seconds: z.number().nullable(),
    parts: z
      .array(
        z.object({
          sequence: z.number().int(),
          raw: z.string(),
          kind: z.string(),
          value: z.number().nullable(),
        }),
      )
      .nullable()
      .meta({ description: 'Partes do placar como publicadas, sem semântica inventada.' }),
  })
  .meta({ id: 'EqScore' });

export const EqResult = z
  .object({
    id: z.uuid(),
    kind: z.enum(EQ_RESULT_KINDS),
    date: isoDate.nullable(),
    competition: EqCompetitionRef.nullable(),
    athlete: EqAthleteRef.nullable(),
    athlete_name_as_published: z.string(),
    horse: EqHorseRef.nullable(),
    horse_name_as_published: z.string().nullable(),
    country: EqCountry.nullable(),
    country_basis: z.string().nullable().meta({
      description: 'current_profile_representation (representação atual do perfil) ou published_in_result.',
    }),
    position: z.number().int().nullable(),
    position_raw: z.string().nullable(),
    status: z.enum(EQ_RESULT_STATUSES),
    score: EqScore,
    rounds_raw: z
      .array(z.object({ header: z.string(), cells: z.unknown(), interpretation: z.string() }))
      .nullable()
      .meta({ description: 'Células por rodada como renderizadas na lista completa da prova.' }),
    published_breakdown: z
      .array(
        z.object({
          label: z.string(),
          value: z.string().nullable(),
          rank: z.string().nullable(),
          source_url: z.string().nullable(),
          source_pdf_page: z.number().int().nullable(),
        }),
      )
      .nullable()
      .meta({ description: 'Subtotais publicados no documento oficial (ex.: Jerez 2002).' }),
    prize: z
      .object({ amount: z.number().nullable(), currency: z.string().nullable(), raw: z.string().nullable() })
      .nullable()
      .meta({ description: 'Prêmio publicado na classificação; não comprova pagamento.' }),
    quality_flags: z.array(z.string()).nullable(),
    source: EqSource,
  })
  .meta({ id: 'EqResult', description: 'Classificação geral de um conjunto numa prova.' });
export type EqResult = z.infer<typeof EqResult>;

export const EqRound = z
  .object({
    id: z.uuid(),
    event_key: z.string().meta({ example: 'athens_2004_jumping' }),
    stage: z.string().meta({ example: 'qualifier_1' }),
    date: isoDate.nullable(),
    date_precision: z.string().nullable(),
    athlete: EqAthleteRef.nullable(),
    athlete_name_as_published: z.string(),
    horse: EqHorseRef.nullable(),
    horse_name_as_published: z.string().nullable(),
    country: EqCountry.nullable(),
    bib: z.string().nullable(),
    rank_raw: z.string().nullable(),
    status: z.string().nullable().meta({ description: 'completed | EL | RET | NS... como publicado.' }),
    penalties_jumping: z.number().nullable(),
    penalties_time: z.number().nullable(),
    score: z.number().nullable(),
    score_raw: z.string().nullable(),
    score_semantics: z.string().nullable(),
    time_seconds: z.number().nullable(),
    source: EqSource,
  })
  .meta({ id: 'EqRound', description: 'Observação de rodada/etapa — nunca é classificação geral.' });
export type EqRound = z.infer<typeof EqRound>;

export const EqDisagreement = z
  .object({
    id: z.uuid(),
    event_key: z.string().nullable(),
    field: z.string(),
    athlete: EqAthleteRef.nullable(),
    values: z.array(
      z.object({
        label: z.string(),
        value: z.string().nullable(),
        url: z.string().nullable(),
        page: z.number().nullable(),
      }),
    ),
    resolution: z.string().nullable(),
  })
  .meta({
    id: 'EqDisagreement',
    description: 'Divergência conhecida entre fontes, preservada sem correção.',
  });

export const EqRankingObservation = z
  .object({
    id: z.uuid(),
    ranking: z.string().meta({ example: 'Longines Rankings' }),
    athlete: EqAthleteRef.nullable(),
    horse: EqHorseRef.nullable(),
    horse_name_as_published: z.string().nullable(),
    rank: z.number().int().nullable(),
    rank_raw: z.string().nullable(),
    points: z.number().nullable(),
    edition: z.string().nullable().meta({ description: 'null = a fonte não mostrou a edição.' }),
    coverage: z.string().nullable(),
    source: EqSource,
  })
  .meta({ id: 'EqRankingObservation' });
export type EqRankingObservation = z.infer<typeof EqRankingObservation>;

// ─── atletas e cavalos ───────────────────────────────────────────────────────────────────────────

export const EqCoverage = z
  .object({
    history: z.enum(EQ_HISTORY_COVERAGES).meta({
      description:
        'complete = todas as páginas exibidas pela fonte foram lidas; partial = parte; not_collected = só aparece ' +
        'como participante de provas.',
    }),
    displayed_total_raw: z.string().nullable().meta({ example: '2 Competition(s) / 1 Page(s)' }),
    collected_results: z.number().int().nullable(),
    results_in_base: z.number().int(),
    note: z.string(),
  })
  .meta({ id: 'EqCoverage' });

export const EqAthleteSummary = EqAthleteRef.extend({
  history_coverage: z.enum(EQ_HISTORY_COVERAGES),
  results: z.number().int(),
  first_result: isoDate.nullable(),
  last_result: isoDate.nullable(),
  horses: z.number().int(),
  wins: z.number().int(),
}).meta({ id: 'EqAthleteSummary' });
export type EqAthleteSummary = z.infer<typeof EqAthleteSummary>;

export const EqAthleteHorse = EqHorseRef.extend({
  results: z.number().int(),
  first: isoDate.nullable(),
  last: isoDate.nullable(),
  best_position: z.number().int().nullable(),
}).meta({ id: 'EqAthleteHorse' });

export const EqAthleteDetail = EqAthleteRef.extend({
  name_as_published: z.string(),
  gender: z.string().nullable(),
  birth_date: isoDate.nullable(),
  nationality: z.string().nullable(),
  registry_status: z.string().nullable(),
  coverage: EqCoverage,
  stats: z.object({
    results: z.number().int(),
    classified: z.number().int(),
    wins: z.number().int(),
    podiums: z.number().int(),
    first_result: isoDate.nullable(),
    last_result: isoDate.nullable(),
    by_year: z.array(z.object({ year: z.number().int(), results: z.number().int(), wins: z.number().int() })),
    prize_by_currency: z.array(
      z.object({ currency: z.string(), amount: z.number(), results: z.number().int() }),
    ),
  }),
  horses: z.array(EqAthleteHorse),
  rankings: z.array(EqRankingObservation),
  rounds: z.number().int().meta({ description: 'Observações de rodadas documentadas (ver /championships).' }),
  championships: z.array(z.object({ key: z.string(), name: z.string(), rounds: z.number().int() })),
  disagreements: z.array(EqDisagreement),
  source: EqSource,
  notice: EqDataNotice,
}).meta({ id: 'EqAthleteDetail' });
export type EqAthleteDetail = z.infer<typeof EqAthleteDetail>;

export const EqHorseSummary = EqHorseRef.extend({
  results: z.number().int(),
  riders: z.number().int(),
  last_result: isoDate.nullable(),
}).meta({ id: 'EqHorseSummary' });

export const EqHorseDetail = EqHorseRef.extend({
  birth_name: z.string().nullable(),
  birth_date: isoDate
    .nullable()
    .meta({ description: '01/01 costuma indicar só o ano: tratar como valor da fonte.' }),
  gender: z.string().nullable().meta({ description: 'mare | stallion | gelding | male' }),
  color: z.string().nullable(),
  studbook: z.string().nullable(),
  breeder: z.string().nullable(),
  sire: z.string().nullable(),
  dam: z.string().nullable(),
  dam_sire: z.string().nullable(),
  birth_country: z.string().nullable(),
  admin_nf: z.string().nullable(),
  owners: z.array(
    z.object({
      name: z.string(),
      nationality: z.string().nullable(),
      since_raw: z.string().nullable(),
      percentage_raw: z.string().nullable(),
    }),
  ),
  riders: z.array(
    EqAthleteRef.extend({ results: z.number().int(), first: isoDate.nullable(), last: isoDate.nullable() }),
  ),
  stats: z.object({ results: z.number().int(), wins: z.number().int(), podiums: z.number().int() }),
  rankings: z.array(EqRankingObservation),
  source: EqSource,
  notice: EqDataNotice,
}).meta({ id: 'EqHorseDetail' });
export type EqHorseDetail = z.infer<typeof EqHorseDetail>;

// ─── provas e campeonatos ────────────────────────────────────────────────────────────────────────

export const EqCompetitionSummary = EqCompetitionRef.extend({
  level_kind: z.string().nullable(),
  judging: z.string().nullable(),
  article: z.string().nullable(),
  show: z.object({ start: isoDate.nullable(), end: isoDate.nullable() }).nullable(),
  prize: z
    .object({ total: z.number().nullable(), currency: z.string().nullable(), raw: z.string().nullable() })
    .nullable(),
  entries_in_base: z.number().int(),
  latam_entries: z.number().int(),
  all_entries_observed: z.boolean(),
}).meta({ id: 'EqCompetitionSummary' });
export type EqCompetitionSummary = z.infer<typeof EqCompetitionSummary>;

export const EqTeamResult = z
  .object({
    id: z.uuid(),
    country: EqCountry,
    position: z.number().int().nullable(),
    position_raw: z.string().nullable(),
    score_raw: z.string().nullable(),
    members: z.array(
      z.object({
        athlete_fei_id: z.string().nullable(),
        athlete_name: z.string().nullable(),
        horse_fei_id: z.string().nullable(),
        horse_name: z.string().nullable(),
        individual_position_raw: z.string().nullable(),
        scores: z.record(z.string(), z.string().nullable()).optional(),
      }),
    ),
    arithmetic: z.record(z.string(), z.unknown()).nullable(),
    source: EqSource,
  })
  .meta({ id: 'EqTeamResult' });

export const EqCompetitionDetail = EqCompetitionSummary.extend({
  article_text: z.string().nullable(),
  schedule_number: z.string().nullable(),
  fei_reference_code: z.string().nullable(),
  completeness: z.object({
    all_entries_observed: z.boolean(),
    displayed_entries: z.number().int().nullable(),
    entries_in_base: z.number().int(),
    note: z.string(),
  }),
  standings: z.array(EqResult),
  championship_key: z.string().nullable(),
  source: EqSource,
  notice: EqDataNotice,
}).meta({ id: 'EqCompetitionDetail' });
export type EqCompetitionDetail = z.infer<typeof EqCompetitionDetail>;

export const EqChampionship = z
  .object({
    key: z.string().meta({ example: 'athens_2004_jumping' }),
    name: z.string(),
    start: isoDate.nullable(),
    end: isoDate.nullable(),
    competition_id: z
      .uuid()
      .nullable()
      .meta({ description: 'Classificação final (ver /competitions/{id}).' }),
    stages: z.array(
      z.object({ stage: z.string(), date: isoDate.nullable(), observations: z.number().int() }),
    ),
    rounds: z.array(EqRound),
    teams: z.array(EqTeamResult),
    disagreements: z.array(EqDisagreement),
    notice: EqDataNotice,
  })
  .meta({ id: 'EqChampionship', description: 'Rodadas documentadas e equipes de um campeonato.' });
export type EqChampionship = z.infer<typeof EqChampionship>;

export const EqOverview = z
  .object({
    notice: EqDataNotice,
    dataset: z.object({
      provider: z.string(),
      package: z.string().nullable(),
      package_sha256: z.string().nullable(),
      imported_at: z.string().nullable(),
    }),
    coverage: z.object({
      athletes: z.object({
        complete: z.number().int(),
        partial: z.number().int(),
        not_collected: z.number().int(),
      }),
      by_country: z.array(
        z.object({
          country: EqCountry,
          athletes: z.number().int(),
          results: z.number().int(),
          first: isoDate.nullable(),
          last: isoDate.nullable(),
        }),
      ),
      horses: z.object({ detailed: z.number().int(), pending: z.number().int() }),
      competitions: z.object({ total: z.number().int(), full_standings: z.number().int() }),
      results: z.number().int(),
      rounds: z.number().int(),
      note: z.string(),
    }),
    highlights: z.array(EqAthleteSummary),
    recent_competitions: z.array(EqCompetitionSummary),
    championships: z.array(
      z.object({ key: z.string(), name: z.string(), start: isoDate.nullable(), rounds: z.number().int() }),
    ),
    rankings: z.array(EqRankingObservation),
  })
  .meta({
    id: 'EqOverview',
    description: 'Resumo da página do esporte: cobertura, destaques e provas recentes.',
  });
export type EqOverview = z.infer<typeof EqOverview>;

// ─── consultas ───────────────────────────────────────────────────────────────────────────────────

export const EqIdParams = z.object({ id: z.uuid() });

export const EqChampionshipParams = z.object({
  key: z
    .string()
    .regex(/^[a-z0-9_]+$/, 'chave inválida')
    .max(60)
    .meta({ example: 'athens_2004_jumping' }),
});

export const EqAthletesQuery = LocaleQuery.extend(PaginationQuery.shape).extend({
  country: codeList.optional(),
  q: z.string().trim().min(2).max(80).optional().meta({ description: 'Nome do atleta ou ID FEI.' }),
  coverage: z.enum(EQ_HISTORY_COVERAGES).optional(),
});
export type EqAthletesQuery = z.input<typeof EqAthletesQuery>;

export const EqHorsesQuery = LocaleQuery.extend(PaginationQuery.shape).extend({
  q: z.string().trim().min(2).max(80).optional().meta({ description: 'Nome do cavalo ou ID FEI.' }),
  detailed: z.enum(['true', 'false']).optional().meta({ description: 'Só cavalos com ficha detalhada.' }),
});
export type EqHorsesQuery = z.input<typeof EqHorsesQuery>;

export const EqResultsQuery = LocaleQuery.extend(PaginationQuery.shape).extend({
  athlete: z.uuid().optional(),
  horse: z.uuid().optional(),
  competition: z.uuid().optional(),
  country: codeList.optional().meta({ description: 'País do conjunto (representação publicada).' }),
  event_country: codeList.optional().meta({ description: 'País do concurso.' }),
  from: isoDate.optional(),
  to: isoDate.optional(),
  level: z
    .string()
    .trim()
    .max(20)
    .optional()
    .meta({ description: 'Prefixo do nível (ex.: CSI5, CSIO).', example: 'CSI5' }),
  status: z.enum(EQ_RESULT_STATUSES).optional(),
  podium: z.enum(['true', 'false']).optional().meta({ description: 'Só posições 1–3.' }),
});
export type EqResultsQuery = z.input<typeof EqResultsQuery>;

export const EqCompetitionsQuery = LocaleQuery.extend(PaginationQuery.shape).extend({
  from: isoDate.optional(),
  to: isoDate.optional(),
  country: codeList.optional().meta({ description: 'País do concurso.' }),
  level: z.string().trim().max(20).optional(),
  full: z
    .enum(['true', 'false'])
    .optional()
    .meta({ description: 'Só provas com classificação completa na base.' }),
  latam: z
    .enum(['true', 'false'])
    .optional()
    .meta({ description: 'Só provas com conjuntos da América Latina.' }),
});
export type EqCompetitionsQuery = z.input<typeof EqCompetitionsQuery>;
