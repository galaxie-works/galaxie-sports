import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { competition, event as coreEvent, season } from './core.js';
import { createdAt, i18n, pkUuidV7, updatedAt } from './_shared.js';

/**
 * Módulo multiesportivo (Olimpíadas, Pan-Americanos...): modelo inspirado no ODF (padrão oficial de dados olímpicos).
 * Ver docs/08-olimpiadas-e-panamericano.md e docs/research/olimpiadas-e-panamericano.md §3.2.
 */
export const multisport = pgSchema('multisport');

// ─── enums ───────────────────────────────────────────────────────────────────────────────────────

/** OG = Jogos Olímpicos, YOG = Olímpicos da Juventude, PAN = Pan-Americanos, PARAPAN, PAN_JR = Pan Júnior. */
export const GAMES_TYPES = ['OG', 'YOG', 'PAN', 'PARAPAN', 'PAN_JR'] as const;
export const gamesType = multisport.enum('games_type', GAMES_TYPES);

export const GAMES_SEASONS = ['summer', 'winter'] as const;
export const gamesSeason = multisport.enum('games_season', GAMES_SEASONS);

export const GAMES_STATUSES = ['completed', 'in_progress', 'upcoming'] as const;
export const gamesStatus = multisport.enum('games_status', GAMES_STATUSES);

/** M = masculino, W = feminino, X = misto, O = aberto (ODF). */
export const EVENT_GENDERS = ['M', 'W', 'X', 'O'] as const;
export const eventGender = multisport.enum('event_gender', EVENT_GENDERS);

export const UNIT_STATUSES = ['scheduled', 'live', 'finished', 'delayed', 'cancelled'] as const;
export const unitStatus = multisport.enum('unit_status', UNIT_STATUSES);

export const MS_PARTICIPANT_KINDS = ['athlete', 'team'] as const;
export const msParticipantKind = multisport.enum('participant_kind', MS_PARTICIPANT_KINDS);

export const MEDAL_TYPES = ['G', 'S', 'B'] as const;
export type MedalType = (typeof MEDAL_TYPES)[number];
export const medalType = multisport.enum('medal_type', MEDAL_TYPES);

export const RESULT_TYPES = ['time', 'points', 'distance', 'score', 'rank'] as const;
export const resultType = multisport.enum('result_type', RESULT_TYPES);

// ─── edições e países ────────────────────────────────────────────────────────────────────────────

export const games = multisport.table(
  'games',
  {
    id: pkUuidV7(),
    /** Ex.: og-summer-2016, og-winter-2026, pan-2027. */
    slug: text('slug').notNull(),
    type: gamesType('type').notNull(),
    season: gamesSeason('season').notNull(),
    /** Ano do nome oficial (Tóquio 2020 = 2020, ainda que disputado em 2021). */
    year: integer('year').notNull(),
    /** Número da edição (ex.: XXXI para Rio 2016 → 31). */
    edition: integer('edition'),
    name: i18n('name').notNull(),
    hostCity: text('host_city').notNull(),
    hostNoc: text('host_noc').references(() => noc.code),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    /** Fuso IANA da sede — datas em UTC, conversão na borda. */
    tz: text('tz').notNull(),
    status: gamesStatus('status').notNull(),
    wikidataQid: text('wikidata_qid'),
    /** Medalhas carregadas ÷ medalhas distribuídas (quando há referência confiável). */
    medalCoverage: numeric('medal_coverage', { precision: 5, scale: 4 }),
    /**
     * complete (≥ 99%) | partial (≥ 75%: exibir com aviso) | insufficient (não publicar quadro/ranking) |
     * unknown (sem referência para medir). Atualizado a cada carga/QA.
     */
    medalDataQuality: text('medal_data_quality'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('games_slug_uq').on(t.slug),
    uniqueIndex('games_type_season_year_uq').on(t.type, t.season, t.year),
    uniqueIndex('games_wikidata_uq').on(t.wikidataQid),
  ],
);

/**
 * Comitês olímpicos nacionais (códigos do COI/Panam Sports, não ISO) + códigos especiais (AIN, EOR, ZZX...)
 * e históricos (URS, GDR, TCH...). A equivalência com ISO cruza com o resto da API (futebol, onde assistir).
 */
export const noc = multisport.table(
  'noc',
  {
    /** Código COI (BRA, CHI, URU...). */
    code: text('code').primaryKey(),
    iso3: text('iso3'),
    iso2: text('iso2'),
    name: i18n('name').notNull(),
    /** noc = CON ativo | special = código especial (neutros, refugiados, equipes mistas) | historic = extinto. */
    kind: text('kind').notNull().default('noc'),
    iocMember: boolean('ioc_member').notNull().default(false),
    panamMember: boolean('panam_member').notNull().default(false),
    /** Sucessor para códigos históricos (ex.: URS → RUS é apenas referência, nunca soma automática). */
    successorCode: text('successor_code'),
    flagUrl: text('flag_url'),
    wikidataQid: text('wikidata_qid'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('noc_iso2_idx').on(t.iso2), index('noc_iso3_idx').on(t.iso3)],
);

// ─── programa esportivo ──────────────────────────────────────────────────────────────────────────

/** Esporte no sentido ODF (ex.: AQU = Aquáticos). */
export const msSport = multisport.table('sport', {
  code: text('code').primaryKey(),
  name: i18n('name').notNull(),
  createdAt: createdAt(),
});

/** Disciplina ODF (ex.: SWM = Natação, DIV = Saltos ornamentais). */
export const discipline = multisport.table(
  'discipline',
  {
    code: text('code').primaryKey(),
    sportCode: text('sport_code')
      .notNull()
      .references(() => msSport.code),
    name: i18n('name').notNull(),
    /** Disciplinas de luta concedem dois bronzes (judô, boxe, taekwondo, wrestling...). */
    twoBronzes: boolean('two_bronzes').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('discipline_sport_idx').on(t.sportCode)],
);

/** Prova que distribui medalhas (ex.: 100 m rasos masculino em Rio 2016). */
export const msEvent = multisport.table(
  'event',
  {
    id: pkUuidV7(),
    gamesId: uuid('games_id')
      .notNull()
      .references(() => games.id),
    disciplineCode: text('discipline_code').references(() => discipline.code),
    gender: eventGender('gender').notNull().default('O'),
    name: i18n('name').notNull(),
    odfCode: text('odf_code'),
    isTeam: boolean('is_team').notNull().default(false),
    /** Medalhas esperadas por cor quando conhecidas (ex.: {"G":1,"S":1,"B":2}). */
    medalSlots: jsonb('medal_slots').$type<Partial<Record<MedalType, number>>>(),
    eventDate: date('event_date'),
    wikidataQid: text('wikidata_qid'),
    /** Rótulo/ID do esporte na fonte quando ainda não mapeado para uma disciplina. */
    sourceSport: text('source_sport'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ms_event_wikidata_uq').on(t.wikidataQid),
    uniqueIndex('ms_event_odf_uq').on(t.gamesId, t.odfCode),
    index('ms_event_games_idx').on(t.gamesId, t.disciplineCode),
  ],
);

export const phase = multisport.table(
  'phase',
  {
    id: pkUuidV7(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => msEvent.id, { onDelete: 'cascade' }),
    /** Código ODF da fase (HEAT, SFNL, FNL, GP A...). */
    code: text('code').notNull(),
    name: i18n('name').notNull(),
    order: integer('order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('phase_event_code_uq').on(t.eventId, t.code)],
);

/** Unidade (sessão/bateria/partida). Ao vivo, cada unidade vira também um core.event. */
export const unit = multisport.table(
  'unit',
  {
    id: pkUuidV7(),
    phaseId: uuid('phase_id')
      .notNull()
      .references(() => phase.id, { onDelete: 'cascade' }),
    /** Código ODF bruto (disciplina + gênero + evento + fase + unidade). */
    odfRsc: text('odf_rsc'),
    name: i18n('name'),
    startUtc: timestamp('start_utc', { withTimezone: true }),
    endUtc: timestamp('end_utc', { withTimezone: true }),
    venue: text('venue'),
    status: unitStatus('status').notNull().default('scheduled'),
    isMedalUnit: boolean('is_medal_unit').notNull().default(false),
    coreEventId: uuid('core_event_id').references(() => coreEvent.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('unit_odf_rsc_uq').on(t.odfRsc), index('unit_start_idx').on(t.startUtc)],
);

// ─── pessoas e participantes ─────────────────────────────────────────────────────────────────────

export const msPerson = multisport.table(
  'person',
  {
    id: pkUuidV7(),
    fullName: text('full_name').notNull(),
    givenName: text('given_name'),
    familyName: text('family_name'),
    birthDate: date('birth_date'),
    /** M | F | X */
    gender: text('gender'),
    wikidataQid: text('wikidata_qid'),
    olympediaId: text('olympedia_id'),
    worldAthleticsId: text('world_athletics_id'),
    fibaId: text('fiba_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('ms_person_wikidata_uq').on(t.wikidataQid), index('ms_person_name_idx').on(t.fullName)],
);

/** Atleta (pessoa × CON) ou equipe que disputa uma prova. */
export const msParticipant = multisport.table(
  'participant',
  {
    id: pkUuidV7(),
    kind: msParticipantKind('kind').notNull(),
    nocCode: text('noc_code')
      .notNull()
      .references(() => noc.code),
    personId: uuid('person_id').references(() => msPerson.id),
    teamName: text('team_name'),
    /** Chave natural para upsert idempotente (ex.: "athlete:Q1189:JAM", "team:<event_id>:BRA"). */
    externalKey: text('external_key').notNull(),
    wikidataQid: text('wikidata_qid'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ms_participant_key_uq').on(t.externalKey),
    index('ms_participant_noc_idx').on(t.nocCode),
    index('ms_participant_person_idx').on(t.personId),
  ],
);

export const teamMember = multisport.table(
  'team_member',
  {
    teamParticipantId: uuid('team_participant_id')
      .notNull()
      .references(() => msParticipant.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => msPerson.id),
  },
  (t) => [primaryKey({ columns: [t.teamParticipantId, t.personId] })],
);

export const result = multisport.table(
  'result',
  {
    unitId: uuid('unit_id')
      .notNull()
      .references(() => unit.id, { onDelete: 'cascade' }),
    participantId: uuid('participant_id')
      .notNull()
      .references(() => msParticipant.id),
    rank: integer('rank'),
    resultValue: text('result_value'),
    resultType: resultType('result_type'),
    /** Invalid Result Mark do ODF: DNS, DNF, DSQ, DQB... */
    irm: text('irm'),
    qualifiedMark: text('qualified_mark'),
    /** WR, OR, PR, NR... */
    records: text('records').array(),
    raw: jsonb('raw'),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.unitId, t.participantId] })],
);

// ─── medalhas ────────────────────────────────────────────────────────────────────────────────────

/**
 * Uma linha = uma medalha no quadro (equipe conta 1 por CON; lutas têm 2 bronzes; empates geram linhas extras).
 * O quadro é sempre derivado desta tabela. Medalhas realocadas não são apagadas: recebem `revoked_at`.
 */
export const medal = multisport.table(
  'medal',
  {
    id: pkUuidV7(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => msEvent.id, { onDelete: 'cascade' }),
    participantId: uuid('participant_id')
      .notNull()
      .references(() => msParticipant.id),
    nocCode: text('noc_code')
      .notNull()
      .references(() => noc.code),
    medal: medalType('medal').notNull(),
    awardedAt: date('awarded_at'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    /** wikidata | editorial | feed:<nome> */
    source: text('source').notNull(),
    /** Chave natural na fonte (upsert idempotente), ex.: "wikidata:Q25397537:athlete:Q1189:JAM:G". */
    sourceKey: text('source_key').notNull(),
    /** Confiança na atribuição (ex.: CON inferido pela cidadania tem confiança menor). */
    confidence: numeric('confidence', { precision: 3, scale: 2 }),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('medal_source_key_uq').on(t.sourceKey),
    index('medal_event_idx').on(t.eventId),
    index('medal_noc_idx').on(t.nocCode),
  ],
);

/** Quadro de medalhas materializado (recalculado quando uma unidade de medalha fecha ou após cargas). */
export const medalTableSnapshot = multisport.table(
  'medal_table_snapshot',
  {
    gamesId: uuid('games_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    nocCode: text('noc_code')
      .notNull()
      .references(() => noc.code),
    gold: integer('gold').notNull(),
    silver: integer('silver').notNull(),
    bronze: integer('bronze').notNull(),
    total: integer('total').notNull(),
    rankByGold: integer('rank_by_gold').notNull(),
    rankByTotal: integer('rank_by_total').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.gamesId, t.nocCode] })],
);

/**
 * Quadro derivado ao vivo da tabela `medal` (sem revogadas). Padrão COI: ouro → prata → bronze;
 * alternativa por total (desempate por ouro, prata, bronze). Empates exatos dividem a posição.
 */
export const medalTable = multisport
  .view('medal_table', {
    gamesId: uuid('games_id').notNull(),
    nocCode: text('noc_code').notNull(),
    gold: integer('gold').notNull(),
    silver: integer('silver').notNull(),
    bronze: integer('bronze').notNull(),
    total: integer('total').notNull(),
    rankByGold: integer('rank_by_gold').notNull(),
    rankByTotal: integer('rank_by_total').notNull(),
  })
  .as(
    sql`with counts as (
      select e.games_id, m.noc_code,
        count(*) filter (where m.medal = 'G')::int as gold,
        count(*) filter (where m.medal = 'S')::int as silver,
        count(*) filter (where m.medal = 'B')::int as bronze,
        count(*)::int as total
      from multisport.medal m
      join multisport.event e on e.id = m.event_id
      where m.revoked_at is null
      group by e.games_id, m.noc_code
    )
    select games_id, noc_code, gold, silver, bronze, total,
      (rank() over (partition by games_id order by gold desc, silver desc, bronze desc))::int as rank_by_gold,
      (rank() over (partition by games_id order by total desc, gold desc, silver desc, bronze desc))::int as rank_by_total
    from counts`,
  );

/**
 * Totais de referência usados só no controle de qualidade (nunca alimentam o quadro):
 * agregados das delegações no Wikidata e números conferidos manualmente na Wikipedia.
 */
export const medalReference = multisport.table(
  'medal_reference',
  {
    gamesId: uuid('games_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    nocCode: text('noc_code')
      .notNull()
      .references(() => noc.code),
    /** wikidata-delegation | wikipedia */
    source: text('source').notNull(),
    gold: integer('gold').notNull(),
    silver: integer('silver').notNull(),
    bronze: integer('bronze').notNull(),
    url: text('url'),
    retrievedAt: timestamp('retrieved_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.gamesId, t.nocCode, t.source] })],
);

// ─── proveniência e ligações ─────────────────────────────────────────────────────────────────────

/** De onde veio cada entidade do módulo, com licença (Wikidata = CC0). */
export const sourceRef = multisport.table(
  'source_ref',
  {
    /** games | event | person | participant | medal | noc */
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    source: text('source').notNull(),
    sourceId: text('source_id').notNull(),
    url: text('url'),
    license: text('license'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.entityType, t.entityId, t.source, t.sourceId] }),
    index('source_ref_source_idx').on(t.source, t.sourceId),
  ],
);

/**
 * Ligas dos esportes coletivos que correspondem a torneios dos Jogos na api-sports (catálogo de ganchos):
 * futebol já existe no core; basquete, vôlei, handebol, hóquei e rúgbi entram quando seus catálogos forem carregados.
 */
export const gamesProviderLeague = multisport.table(
  'games_provider_league',
  {
    gamesType: gamesType('games_type').notNull(),
    gamesSeason: gamesSeason('games_season').notNull().default('summer'),
    /** Slug do esporte em core.sport (football, basketball, volleyball...). */
    sport: text('sport').notNull(),
    /** M | W | X | O */
    gender: text('gender').notNull(),
    provider: text('provider').notNull().default('api-sports'),
    providerLeagueId: text('provider_league_id').notNull(),
    label: text('label').notNull(),
    notes: text('notes'),
  },
  (t) => [primaryKey({ columns: [t.provider, t.sport, t.providerLeagueId] })],
);

/** Edição dos Jogos ↔ competição/temporada do core (ex.: Rio 2016 ↔ Olympics Men 2016 da api-sports). */
export const gamesCompetition = multisport.table(
  'games_competition',
  {
    gamesId: uuid('games_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    competitionId: uuid('competition_id')
      .notNull()
      .references(() => competition.id),
    seasonId: uuid('season_id').references(() => season.id),
    sport: text('sport').notNull(),
    gender: text('gender').notNull(),
    provider: text('provider').notNull(),
    providerLeagueId: text('provider_league_id').notNull(),
    /** date_overlap | year */
    matchedBy: text('matched_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.gamesId, t.competitionId] }),
    index('games_competition_competition_idx').on(t.competitionId),
  ],
);

/** Licença de cada fonte usada no módulo (gravada em source_ref). */
export const MEDAL_SOURCE_LICENSES = { wikidata: 'CC0-1.0' } as const;

/** Prioridade de ordenação regional padrão para a América Latina. */
export const LATAM_NOCS = [
  'BRA',
  'ARG',
  'MEX',
  'COL',
  'CHI',
  'PER',
  'URU',
  'ECU',
  'CUB',
  'DOM',
  'VEN',
  'PUR',
  'PAR',
  'BOL',
  'GUA',
  'CRC',
  'PAN',
  'ESA',
  'HON',
  'NCA',
] as const;
