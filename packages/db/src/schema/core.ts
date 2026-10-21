import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { createdAt, i18n, pkUuidV7, updatedAt } from './_shared.js';
// Import circular (semantic também importa core) é seguro: a referência só é avaliada sob demanda.
import { derby } from './semantic.js';

export const core = pgSchema('core');

// ─── enums ───────────────────────────────────────────────────────────────────────────────────────

export const EVENT_STATUSES = [
  'scheduled',
  'starting',
  'live',
  'break',
  'finished',
  'postponed',
  'cancelled',
  'suspended',
  'abandoned',
] as const;
export const eventStatus = core.enum('event_status', EVENT_STATUSES);

export const competitionType = core.enum('competition_type', ['league', 'cup', 'tournament', 'multisport']);

export const participantKind = core.enum('participant_kind', [
  'club',
  'national_team',
  'athlete',
  'driver',
  'constructor',
  'fighter',
]);

export const assetKind = core.enum('asset_kind', [
  'flag',
  'league_logo',
  'team_logo',
  'venue',
  'player',
  'coach',
  'driver',
  'circuit',
  'fighter',
  'other',
]);

// ─── catálogo ────────────────────────────────────────────────────────────────────────────────────

export const sport = core.table('sport', {
  slug: text('slug').primaryKey(),
  name: i18n('name').notNull(),
  createdAt: createdAt(),
});

export const asset = core.table(
  'asset',
  {
    id: pkUuidV7(),
    kind: assetKind('kind').notNull(),
    sourceUrl: text('source_url').notNull(),
    storageKey: text('storage_key'),
    sha256: text('sha256'),
    width: integer('width'),
    height: integer('height'),
    bytes: integer('bytes'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('asset_source_url_uq').on(t.sourceUrl)],
);

export const country = core.table('country', {
  /** ISO 3166-1 alpha-2, com extensões da api-sports (ex.: GB-ENG); "WORLD" para competições internacionais. */
  code: text('code').primaryKey(),
  name: i18n('name').notNull(),
  /** Código do COI/Panam (BRA, CHI, URU...) — usado no módulo multiesportivo. */
  iocCode: text('ioc_code'),
  confederation: text('confederation'),
  flagAssetId: uuid('flag_asset_id').references(() => asset.id),
  createdAt: createdAt(),
});

export const competition = core.table(
  'competition',
  {
    id: pkUuidV7(),
    sport: text('sport')
      .notNull()
      .references(() => sport.slug),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    labels: i18n('labels'),
    countryCode: text('country_code').references(() => country.code),
    type: competitionType('type').notNull(),
    /** 1 = cobertura máxima (live + IA), 2 = completa sem live prioritário, 3 = apenas espelho. */
    tier: smallint('tier').notNull().default(3),
    livePriority: text('live_priority').notNull().default('none'),
    logoAssetId: uuid('logo_asset_id').references(() => asset.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('competition_sport_slug_uq').on(t.sport, t.slug),
    index('competition_tier_idx').on(t.tier),
  ],
);

export const season = core.table(
  'season',
  {
    id: pkUuidV7(),
    competitionId: uuid('competition_id')
      .notNull()
      .references(() => competition.id),
    /** Rótulo do fornecedor: "2026" ou "2026/27". */
    label: text('label').notNull(),
    year: integer('year').notNull(),
    startDate: date('start_date'),
    endDate: date('end_date'),
    current: boolean('current').notNull().default(false),
    /** Flags de cobertura informadas pelo provedor (eventos, escalações, estatísticas...). */
    coverage: jsonb('coverage'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('season_competition_year_uq').on(t.competitionId, t.year)],
);

export const stage = core.table(
  'stage',
  {
    id: pkUuidV7(),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => season.id),
    /** regular, group, round_of_16, quarter_final, semi_final, final, race_weekend... */
    kind: text('kind').notNull(),
    name: i18n('name').notNull(),
    /** Rótulo original do fornecedor (ex.: "Regular Season - 30"). */
    providerLabel: text('provider_label'),
    order: integer('order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('stage_season_label_uq').on(t.seasonId, t.providerLabel)],
);

export const venue = core.table('venue', {
  id: pkUuidV7(),
  name: text('name').notNull(),
  city: text('city'),
  countryCode: text('country_code').references(() => country.code),
  capacity: integer('capacity'),
  surface: text('surface'),
  imageAssetId: uuid('image_asset_id').references(() => asset.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const participant = core.table(
  'participant',
  {
    id: pkUuidV7(),
    sport: text('sport')
      .notNull()
      .references(() => sport.slug),
    kind: participantKind('kind').notNull(),
    name: text('name').notNull(),
    shortName: text('short_name'),
    code: text('code'),
    countryCode: text('country_code').references(() => country.code),
    founded: integer('founded'),
    homeVenueId: uuid('home_venue_id').references(() => venue.id),
    logoAssetId: uuid('logo_asset_id').references(() => asset.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('participant_sport_country_idx').on(t.sport, t.countryCode),
    index('participant_name_idx').on(t.name),
  ],
);

export const person = core.table('person', {
  id: pkUuidV7(),
  name: text('name').notNull(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  birthDate: date('birth_date'),
  nationality: text('nationality'),
  heightCm: integer('height_cm'),
  weightKg: integer('weight_kg'),
  photoAssetId: uuid('photo_asset_id').references(() => asset.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const roster = core.table(
  'roster',
  {
    participantId: uuid('participant_id')
      .notNull()
      .references(() => participant.id),
    personId: uuid('person_id')
      .notNull()
      .references(() => person.id),
    seasonId: uuid('season_id').references(() => season.id),
    /** player | coach | staff */
    role: text('role').notNull(),
    number: integer('number'),
    position: text('position'),
    validFrom: date('valid_from'),
    validTo: date('valid_to'),
  },
  (t) => [
    uniqueIndex('roster_uq').on(t.participantId, t.personId, t.role, t.seasonId),
    index('roster_person_idx').on(t.personId),
  ],
);

// ─── evento canônico ─────────────────────────────────────────────────────────────────────────────

export type EventScore = {
  home: number | null;
  away: number | null;
  halftime?: { home: number | null; away: number | null };
  extratime?: { home: number | null; away: number | null } | null;
  penalty?: { home: number | null; away: number | null } | null;
  aggregate?: { home: number; away: number } | null;
};

export type EventClock = { minute: number | null; extra: number | null; period: string | null };

/**
 * Entidade primária do produto: existe mesmo que ninguém a transmita.
 * Ver docs/04-modelo-de-dados.md §3 (máquina de estados e last-known-good).
 */
export const event = core.table(
  'event',
  {
    id: pkUuidV7(),
    sport: text('sport')
      .notNull()
      .references(() => sport.slug),
    competitionId: uuid('competition_id').references(() => competition.id),
    seasonId: uuid('season_id').references(() => season.id),
    stageId: uuid('stage_id').references(() => stage.id),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAtExpected: timestamp('ends_at_expected', { withTimezone: true }).notNull(),
    status: eventStatus('status').notNull().default('scheduled'),
    /** Código original do fornecedor (NS, 1H, HT, 2H, ET, P, FT, AET, PEN, PST...). */
    statusDetail: text('status_detail'),
    clock: jsonb('clock').$type<EventClock>(),
    score: jsonb('score').$type<EventScore>(),
    venueId: uuid('venue_id').references(() => venue.id),
    /** Última atualização válida recebida da fonte. */
    lastValidAt: timestamp('last_valid_at', { withTimezone: true }),
    /** true quando servimos last-known-good porque a fonte falhou. */
    isStale: boolean('is_stale').notNull().default(false),
    importance: integer('importance').notNull().default(0),
    /** Clássico detectado pelos participantes (semantic.derby); some se o clássico sair da base. */
    derbyId: uuid('derby_id').references((): AnyPgColumn => derby.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('event_starts_at_idx').on(t.startsAt),
    index('event_status_idx').on(t.status),
    index('event_competition_starts_idx').on(t.competitionId, t.startsAt),
    index('event_sport_starts_idx').on(t.sport, t.startsAt),
  ],
);

export const eventParticipant = core.table(
  'event_participant',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    participantId: uuid('participant_id')
      .notNull()
      .references(() => participant.id),
    /** home | away | lane | grid | corner_red | corner_blue */
    side: text('side').notNull(),
    position: integer('position'),
    result: jsonb('result'),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.participantId] }),
    index('event_participant_participant_idx').on(t.participantId),
  ],
);

export const eventStateLog = core.table(
  'event_state_log',
  {
    id: pkUuidV7(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    fromStatus: eventStatus('from_status'),
    toStatus: eventStatus('to_status').notNull(),
    /** provider | temporal_fallback | correction | editorial */
    reason: text('reason').notNull(),
    payload: jsonb('payload'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('event_state_log_event_idx').on(t.eventId, t.occurredAt)],
);

export const eventIncident = core.table(
  'event_incident',
  {
    id: pkUuidV7(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    minute: integer('minute'),
    extra: integer('extra'),
    /** goal | card | subst | var | period | penalty | ... */
    type: text('type').notNull(),
    detail: text('detail'),
    participantId: uuid('participant_id').references(() => participant.id),
    personId: uuid('person_id').references(() => person.id),
    assistPersonId: uuid('assist_person_id').references(() => person.id),
    /** Posição estável na timeline do fornecedor, para upsert idempotente. */
    sequence: integer('sequence').notNull(),
    data: jsonb('data'),
  },
  (t) => [uniqueIndex('event_incident_seq_uq').on(t.eventId, t.sequence)],
);

export const standing = core.table(
  'standing',
  {
    seasonId: uuid('season_id')
      .notNull()
      .references(() => season.id),
    group: text('group').notNull().default(''),
    participantId: uuid('participant_id')
      .notNull()
      .references(() => participant.id),
    rank: integer('rank').notNull(),
    points: integer('points').notNull(),
    played: integer('played').notNull().default(0),
    won: integer('won').notNull().default(0),
    drawn: integer('drawn').notNull().default(0),
    lost: integer('lost').notNull().default(0),
    goalsFor: integer('goals_for').notNull().default(0),
    goalsAgainst: integer('goals_against').notNull().default(0),
    form: text('form'),
    description: text('description'),
    /** provider | computed (calculada localmente a partir dos resultados) */
    source: text('source').notNull().default('provider'),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.seasonId, t.group, t.participantId] })],
);

// ─── mapeamento de provedores ────────────────────────────────────────────────────────────────────

/** Liga nossos IDs aos IDs de cada provedor (api-sports, sportmonks, provedor do cliente...). */
export const providerMap = core.table(
  'provider_map',
  {
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    provider: text('provider').notNull(),
    sport: text('sport').notNull(),
    providerId: text('provider_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.sport, t.entityType, t.providerId] }),
    index('provider_map_entity_idx').on(t.entityType, t.entityId),
  ],
);

// ─── específicos do futebol ──────────────────────────────────────────────────────────────────────

/** Espelho fiel da partida da api-sports v3 ligado ao evento canônico; detalhe completo em JSONB. */
export const footballFixture = core.table(
  'football_fixture',
  {
    eventId: uuid('event_id')
      .primaryKey()
      .references(() => event.id, { onDelete: 'cascade' }),
    providerFixtureId: integer('provider_fixture_id').notNull(),
    round: text('round'),
    referee: text('referee'),
    /** Objeto `fixture`/`league`/`teams`/`goals`/`score` do fornecedor. */
    summary: jsonb('summary').notNull(),
    /** Eventos, escalações, estatísticas e jogadores (de fixtures?id ou ids). */
    detail: jsonb('detail'),
    detailFetchedAt: timestamp('detail_fetched_at', { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('football_fixture_provider_uq').on(t.providerFixtureId)],
);
