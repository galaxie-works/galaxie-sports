import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { participant } from './core.js';
import { createdAt, pkUuidV7, updatedAt } from './_shared.js';

/**
 * Hipismo (esportes equestres): conjunto cavaleiro/amazona + cavalo, provas por artigo do regulamento,
 * classificação geral separada das rodadas e proveniência por linha. Ver docs/13-hipismo.md §4.
 *
 * Regras do modelo:
 * - **Classificação geral (`result`) e rodada (`round`) são registros distintos.** Uma observação de rodada
 *   pode registrar não participação ou eliminação; nunca vira linha de classificação.
 * - **Ausente não é zero:** colunas numéricas ficam `null` quando a fonte não publica o valor. O valor
 *   publicado é sempre preservado em `*_raw`.
 * - **Proveniência:** toda linha guarda `source_url`, `source_kind`, `observed_at` e a importação que a trouxe;
 *   divergências entre fontes ficam em `source_disagreement`, sem correção por suposição.
 * - **Idempotência:** `(source, source_key)` identifica a observação na fonte; reimportar atualiza a mesma linha.
 */
export const equestrian = pgSchema('equestrian');

/** Disciplinas FEI (Rédeas fica no modelo, mas não é mais disciplina FEI). */
export const EQUESTRIAN_DISCIPLINES = [
  'jumping',
  'dressage',
  'eventing',
  'endurance',
  'reining',
  'driving',
  'vaulting',
] as const;
export type EquestrianDiscipline = (typeof EQUESTRIAN_DISCIPLINES)[number];

/** Status publicado de uma classificação: `classified` ou os códigos FEI (EL, RET, WD, DSQ, NS...). */
export const RESULT_STATUSES = ['classified', 'EL', 'RET', 'WD', 'DSQ', 'NS', 'unknown'] as const;
export type EquestrianResultStatus = (typeof RESULT_STATUSES)[number];

/**
 * Cobertura do histórico de um atleta na base: `complete` = todas as páginas exibidas pela fonte foram lidas;
 * `partial` = só parte; `not_collected` = atleta conhecido apenas como participante de uma prova.
 */
export const HISTORY_COVERAGES = ['complete', 'partial', 'not_collected'] as const;
export type HistoryCoverage = (typeof HISTORY_COVERAGES)[number];

/** Uma carga de pacote/feed: permite reimportar sem duplicar e auditar de onde veio cada linha. */
export const eqImportRun = equestrian.table(
  'import_run',
  {
    id: pkUuidV7(),
    /** Fonte lógica (ex.: `fei-public-v3`). */
    source: text('source').notNull(),
    /** Licença declarada do lote (ex.: `fei_public_pages_unlicensed`, `licensed`, `athlete_provided`). */
    license: text('license').notNull(),
    packageName: text('package_name').notNull(),
    packageSha256: text('package_sha256').notNull(),
    schemaVersion: integer('schema_version'),
    counts: jsonb('counts').$type<Record<string, number>>(),
    notes: text('notes'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('import_run_source_idx').on(t.source, t.startedAt)],
);

/** Cavaleiro/amazona. `participant_id` liga ao core (busca, navegação, provider_map). */
export const eqAthlete = equestrian.table(
  'athlete',
  {
    id: pkUuidV7(),
    participantId: uuid('participant_id').references(() => participant.id),
    feiId: text('fei_id'),
    /** Nome como publicado (ex.: "WERTHEIN, Lucas"); `displayName` é a forma de exibição ("Lucas Werthein"). */
    nameAsPublished: text('name_as_published').notNull(),
    displayName: text('display_name').notNull(),
    firstName: text('first_name'),
    familyName: text('family_name'),
    gender: text('gender'),
    birthDate: date('birth_date'),
    birthDateRaw: text('birth_date_raw'),
    nationality: text('nationality'),
    /** Representação esportiva atual (código FEI/COI); não é cidadania nem a representação de cada resultado. */
    competingFor: text('competing_for'),
    registryStatusRaw: text('registry_status_raw'),
    historyCoverage: text('history_coverage').$type<HistoryCoverage>().notNull().default('not_collected'),
    /** Total exibido pela fonte (ex.: "2 Competition(s) / 1 Page(s)"). */
    displayedTotalRaw: text('displayed_total_raw'),
    collectedResults: integer('collected_results'),
    source: text('source').notNull(),
    sourceUrl: text('source_url'),
    observedAt: timestamp('observed_at', { withTimezone: true }),
    importRunId: uuid('import_run_id').references(() => eqImportRun.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('athlete_fei_id_uq').on(t.feiId),
    index('athlete_competing_for_idx').on(t.competingFor),
    index('athlete_display_name_idx').on(t.displayName),
  ],
);

/** Cavalo: entidade própria, com ficha (raça, idade, pedigree, criador) quando publicada. */
export const eqHorse = equestrian.table(
  'horse',
  {
    id: pkUuidV7(),
    feiId: text('fei_id'),
    name: text('name').notNull(),
    nameVariants: jsonb('name_variants').$type<string[]>(),
    birthName: text('birth_name'),
    completeName: text('complete_name'),
    birthDate: date('birth_date'),
    birthDateRaw: text('birth_date_raw'),
    /** mare | stallion | gelding | female | male (como publicado, normalizado em minúsculas). */
    gender: text('gender'),
    castrated: text('castrated'),
    color: text('color'),
    breed: text('breed'),
    studbook: text('studbook'),
    breeder: text('breeder'),
    sire: text('sire'),
    dam: text('dam'),
    damSire: text('dam_sire'),
    birthCountry: text('birth_country'),
    adminNf: text('admin_nf'),
    registryStatusRaw: text('registry_status_raw'),
    /** `detailed` = ficha lida na fonte; `pending` = só identificado em resultados. */
    profileStatus: text('profile_status').notNull().default('pending'),
    source: text('source').notNull(),
    sourceUrl: text('source_url'),
    observedAt: timestamp('observed_at', { withTimezone: true }),
    importRunId: uuid('import_run_id').references(() => eqImportRun.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('horse_fei_id_uq').on(t.feiId), index('horse_name_idx').on(t.name)],
);

/** Proprietário observado na ficha do cavalo (registro publicado, sem inferir data de fim). */
export const eqHorseOwner = equestrian.table(
  'horse_owner',
  {
    id: pkUuidV7(),
    horseId: uuid('horse_id')
      .notNull()
      .references(() => eqHorse.id, { onDelete: 'cascade' }),
    ownerName: text('owner_name').notNull(),
    nationality: text('nationality'),
    sinceRaw: text('since_raw'),
    percentageRaw: text('percentage_raw'),
    source: text('source').notNull(),
    sourceKey: text('source_key').notNull(),
    sourceUrl: text('source_url'),
    observedAt: timestamp('observed_at', { withTimezone: true }),
    importRunId: uuid('import_run_id').references(() => eqImportRun.id),
  },
  (t) => [
    uniqueIndex('horse_owner_source_uq').on(t.source, t.sourceKey),
    index('horse_owner_horse_idx').on(t.horseId),
  ],
);

/**
 * Prova (competition no vocabulário FEI): uma classe de um concurso, com nível, altura, artigo e premiação.
 * Também representa classificações finais de campeonatos (Jogos, Mundiais).
 */
export const eqCompetition = equestrian.table(
  'competition',
  {
    id: pkUuidV7(),
    source: text('source').notNull(),
    sourceKey: text('source_key').notNull(),
    discipline: text('discipline').$type<EquestrianDiscipline>().notNull().default('jumping'),
    name: text('name').notNull(),
    /** Nível/categoria do concurso como publicado (CSI2*, CSIYH1*, Olympic Games-S, WEG-S...). */
    level: text('level'),
    /** Estrelas (1–5) derivadas do nível quando explícitas. */
    stars: integer('stars'),
    /** csi | csio | cdi | cci | olympic_games | world_championship | continental_games | other */
    levelKind: text('level_kind'),
    date: date('date'),
    dateRaw: text('date_raw'),
    venue: text('venue'),
    /** Código do país do concurso como publicado (FEI/COI). */
    countryCode: text('country_code'),
    heightCm: integer('height_cm'),
    /** Artigo do regulamento (ex.: 220.2.1.2) e o texto publicado completo. */
    articleCode: text('article_code'),
    articleText: text('article_text'),
    /** faults_time | jump_off | two_phases | two_rounds | table_c | championship | other (derivado do artigo). */
    judging: text('judging'),
    isGrandPrix: boolean('is_grand_prix').notNull().default(false),
    scheduleNumber: text('schedule_number'),
    /** Agrupamento do concurso (local + datas) quando publicado; não é ID oficial. */
    showKey: text('show_key'),
    showStart: date('show_start'),
    showEnd: date('show_end'),
    prizeTotal: numeric('prize_total', { precision: 14, scale: 2 }),
    prizeCurrency: text('prize_currency'),
    prizeTotalRaw: text('prize_total_raw'),
    displayedEntries: integer('displayed_entries'),
    observedEntries: integer('observed_entries'),
    /** true = a classificação inteira foi lida; false = só os conjuntos da amostra. */
    allEntriesObserved: boolean('all_entries_observed').notNull().default(false),
    feiReferenceCode: text('fei_reference_code'),
    sourceUrl: text('source_url'),
    observedAt: timestamp('observed_at', { withTimezone: true }),
    importRunId: uuid('import_run_id').references(() => eqImportRun.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('competition_source_uq').on(t.source, t.sourceKey),
    index('competition_date_idx').on(t.date),
    index('competition_country_idx').on(t.countryCode, t.date),
  ],
);

/**
 * Classificação geral de um conjunto numa prova. Nunca representa uma rodada (ver `round`).
 * Valores ausentes ficam `null`; `score_raw` preserva o placar publicado.
 */
export const eqResult = equestrian.table(
  'result',
  {
    id: pkUuidV7(),
    source: text('source').notNull(),
    sourceKey: text('source_key').notNull(),
    /** athlete_performance_history | calendar_historical_classification | championship_classification | competition_entry */
    sourceKind: text('source_kind').notNull(),
    competitionId: uuid('competition_id').references(() => eqCompetition.id),
    athleteId: uuid('athlete_id').references(() => eqAthlete.id),
    athleteNameAsPublished: text('athlete_name_as_published').notNull(),
    horseId: uuid('horse_id').references(() => eqHorse.id),
    horseNameAsPublished: text('horse_name_as_published'),
    /** País como publicado nesta observação e o critério (`current_profile_representation`, `published_in_result`). */
    countryCode: text('country_code'),
    countryBasis: text('country_basis'),
    date: date('date'),
    position: integer('position'),
    positionRaw: text('position_raw'),
    status: text('status').$type<EquestrianResultStatus>().notNull().default('unknown'),
    scoreRaw: text('score_raw'),
    /** explicit_single_round | raw_preserved_requires_article_specific_parser | missing | not_published */
    scoreParseStatus: text('score_parse_status'),
    /** Só preenchidos quando o placar publicado é explícito (ex.: `8(8+0)/84.34`). */
    penalties: numeric('penalties', { precision: 8, scale: 2 }),
    penaltiesJumping: numeric('penalties_jumping', { precision: 8, scale: 2 }),
    penaltiesTime: numeric('penalties_time', { precision: 8, scale: 2 }),
    timeSeconds: numeric('time_seconds', { precision: 8, scale: 2 }),
    /** Partes do placar como publicadas (sequência, valor bruto, tipo), sem semântica inventada. */
    scoreParts: jsonb('score_parts').$type<ScorePart[]>(),
    /** Células por rodada como renderizadas na classificação completa (cabeçalho + células brutas). */
    roundCells: jsonb('round_cells').$type<RoundCells[]>(),
    /** Subtotais e posições parciais publicados no documento oficial (ex.: Jerez 2002: 1st, A+B, 1+2). */
    publishedBreakdown: jsonb('published_breakdown').$type<PublishedBreakdown[]>(),
    prizeAmount: numeric('prize_amount', { precision: 14, scale: 2 }),
    prizeCurrency: text('prize_currency'),
    prizeRaw: text('prize_raw'),
    qualityFlags: jsonb('quality_flags').$type<string[]>(),
    sourceUrl: text('source_url'),
    observedAt: timestamp('observed_at', { withTimezone: true }),
    importRunId: uuid('import_run_id').references(() => eqImportRun.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('result_source_uq').on(t.source, t.sourceKey),
    index('result_athlete_date_idx').on(t.athleteId, t.date),
    index('result_horse_date_idx').on(t.horseId, t.date),
    index('result_competition_idx').on(t.competitionId, t.position),
    index('result_country_date_idx').on(t.countryCode, t.date),
  ],
);

export type ScorePart = {
  sequence: number;
  raw: string;
  kind: string;
  value: number | null;
  penaltiesTotal: number | null;
  penaltiesJumping: number | null;
  penaltiesTime: number | null;
};

export type RoundCells = { header: string; cells: unknown; interpretation: string };

export type PublishedBreakdown = {
  label: string;
  value: string | null;
  rank: string | null;
  sourceUrl: string | null;
  sourcePdfPage: number | null;
};

/**
 * Observação de rodada/etapa documentada (ex.: qualificatórias de Atenas 2004, etapas de Jerez 2002).
 * Pode registrar não participação ou eliminação; não é classificação geral.
 */
export const eqRound = equestrian.table(
  'round',
  {
    id: pkUuidV7(),
    source: text('source').notNull(),
    sourceKey: text('source_key').notNull(),
    /** Chave do campeonato (ex.: `athens_2004_jumping`). */
    eventKey: text('event_key').notNull(),
    stage: text('stage').notNull(),
    date: date('date'),
    /** exact_stage_date | event_range_only */
    datePrecision: text('date_precision'),
    eventStart: date('event_start'),
    eventEnd: date('event_end'),
    athleteId: uuid('athlete_id').references(() => eqAthlete.id),
    athleteNameAsPublished: text('athlete_name_as_published').notNull(),
    horseId: uuid('horse_id').references(() => eqHorse.id),
    horseNameAsPublished: text('horse_name_as_published'),
    countryCode: text('country_code'),
    bib: text('bib'),
    rankRaw: text('rank_raw'),
    status: text('status'),
    penaltiesJumping: numeric('penalties_jumping', { precision: 8, scale: 2 }),
    penaltiesTime: numeric('penalties_time', { precision: 8, scale: 2 }),
    /** Valor publicado da etapa (penalidades ou pontuação do campeonato, ver `score_semantics`). */
    score: numeric('score', { precision: 8, scale: 2 }),
    scoreRaw: text('score_raw'),
    scoreSemantics: text('score_semantics'),
    timeSeconds: numeric('time_seconds', { precision: 8, scale: 2 }),
    sourceUrl: text('source_url'),
    sourcePdfPage: integer('source_pdf_page'),
    sourceDocumentSha256: text('source_document_sha256'),
    observedAt: timestamp('observed_at', { withTimezone: true }),
    importRunId: uuid('import_run_id').references(() => eqImportRun.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('round_source_uq').on(t.source, t.sourceKey),
    index('round_event_stage_idx').on(t.eventKey, t.stage),
    index('round_athlete_idx').on(t.athleteId),
  ],
);

/** Resultado por equipes publicado (país, posição, total) com os membros como publicados. */
export const eqTeamResult = equestrian.table(
  'team_result',
  {
    id: pkUuidV7(),
    source: text('source').notNull(),
    sourceKey: text('source_key').notNull(),
    eventKey: text('event_key').notNull(),
    countryCode: text('country_code').notNull(),
    position: integer('position'),
    positionRaw: text('position_raw'),
    scoreRaw: text('score_raw'),
    prizeRaw: text('prize_raw'),
    /** Membros: atleta, cavalo e posição individual como publicados. */
    members: jsonb('members').$type<TeamMember[]>(),
    /** Conferência aritmética publicada x recalculada, quando houver. */
    arithmetic: jsonb('arithmetic').$type<Record<string, unknown>>(),
    sourceUrl: text('source_url'),
    sourcePdfPage: integer('source_pdf_page'),
    observedAt: timestamp('observed_at', { withTimezone: true }),
    importRunId: uuid('import_run_id').references(() => eqImportRun.id),
  },
  (t) => [
    uniqueIndex('team_result_source_uq').on(t.source, t.sourceKey),
    index('team_result_event_idx').on(t.eventKey),
  ],
);

export type TeamMember = {
  athleteFeiId: string | null;
  athleteName: string | null;
  horseFeiId: string | null;
  horseName: string | null;
  individualPositionRaw: string | null;
  scores?: Record<string, string | null>;
};

/** Posição observada num ranking (sem inferir edição quando a fonte não a mostra). */
export const eqRankingObservation = equestrian.table(
  'ranking_observation',
  {
    id: pkUuidV7(),
    source: text('source').notNull(),
    sourceKey: text('source_key').notNull(),
    rankingName: text('ranking_name').notNull(),
    athleteId: uuid('athlete_id').references(() => eqAthlete.id),
    horseId: uuid('horse_id').references(() => eqHorse.id),
    horseNameAsPublished: text('horse_name_as_published'),
    rank: integer('rank'),
    rankRaw: text('rank_raw'),
    points: numeric('points', { precision: 10, scale: 2 }),
    pointsRaw: text('points_raw'),
    edition: text('edition'),
    coverage: text('coverage'),
    sourceUrl: text('source_url'),
    observedAt: timestamp('observed_at', { withTimezone: true }),
    importRunId: uuid('import_run_id').references(() => eqImportRun.id),
  },
  (t) => [
    uniqueIndex('ranking_observation_source_uq').on(t.source, t.sourceKey),
    index('ranking_observation_name_idx').on(t.rankingName, t.rank),
  ],
);

/** Divergência conhecida entre fontes (ou dentro do mesmo documento), preservada sem correção. */
export const eqSourceDisagreement = equestrian.table(
  'source_disagreement',
  {
    id: pkUuidV7(),
    source: text('source').notNull(),
    sourceKey: text('source_key').notNull(),
    athleteId: uuid('athlete_id').references(() => eqAthlete.id),
    eventKey: text('event_key'),
    field: text('field').notNull(),
    /** Cada valor com a fonte de onde veio: `[{ label, value, url, page }]`. */
    values: jsonb('values')
      .$type<{ label: string; value: string | null; url: string | null; page: number | null }[]>()
      .notNull(),
    resolution: text('resolution'),
    importRunId: uuid('import_run_id').references(() => eqImportRun.id),
  },
  (t) => [
    uniqueIndex('source_disagreement_source_uq').on(t.source, t.sourceKey),
    index('source_disagreement_athlete_idx').on(t.athleteId),
  ],
);
