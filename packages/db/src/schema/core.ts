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
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { createdAt, i18n, pkUuidV7, updatedAt } from './_shared.js';
import { sameName } from './names.js';
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

/**
 * Paleta extraída do escudo (team_logo) pelo espelho de mídia — base das "cores do time" e do
 * gradiente sugerido expostos na API. `version` permite recalcular quando o algoritmo mudar.
 */
export type AssetPalette = {
  version: 1;
  /** Cor predominante (#rrggbb); cinza-escuro neutro quando o escudo é monocromático. */
  dominant: string;
  /** Segunda cor, com matiz distinto da predominante; null quando não há. */
  secondary: string | null;
  /** Escudo essencialmente preto/branco/cinza (ex.: Corinthians, Botafogo, Vasco). */
  monochrome: boolean;
};

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
    /** Só para team_logo em PNG; preenchido no espelho ou pelo backfill `assets:palette`. */
    palette: jsonb('palette').$type<AssetPalette>(),
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

/**
 * Nome curado do estádio, vindo da base semântica (`stadium` do time em data/knowledge) e gravado
 * pela reconciliação do seed (`pnpm db:seed:semantic`). O nome cru do fornecedor continua em
 * `venue.name` (a ingestão só escreve lá); quem exibe usa `venueDisplay` para dar prioridade a este.
 */
export interface VenueCuration {
  /** Nome atual/canônico (ex.: "Nubank Parque"). */
  name: string;
  city: string | null;
  nicknames: string[];
  /** Nomes anteriores; `until` é o último dia (ISO) em que o nome valeu. */
  former_names: { name: string; until: string }[];
  /** Perfis da base semântica que descrevem este estádio (estádio compartilhado = mais de um). */
  team_slugs: string[];
  /** Como a linha foi ligada: ID do estádio na api-sports (`api_sports_venue_id`) ou nome + cidade. */
  matched_by: 'provider_id' | 'name';
}

export const venue = core.table('venue', {
  id: pkUuidV7(),
  /** Nome como o fornecedor manda (pode estar desatualizado após venda de naming rights). */
  name: text('name').notNull(),
  city: text('city'),
  countryCode: text('country_code').references(() => country.code),
  capacity: integer('capacity'),
  surface: text('surface'),
  imageAssetId: uuid('image_asset_id').references(() => asset.id),
  /**
   * Data do jogo (início) em que `name` foi visto. O bloco `venue` de `/teams` não tem data e
   * fica para trás após uma troca de nome; o nome do jogo mais recente vence (null = só `/teams`).
   */
  nameSeenAt: timestamp('name_seen_at', { withTimezone: true }),
  /** Nome curado da base semântica; null = sem curadoria (vale o do fornecedor). */
  curated: jsonb('curated').$type<VenueCuration>(),
  /** Nomes anteriores derivados dos jogos do fornecedor (`pnpm --filter @galaxie/ingestor names:derive`). */
  providerFormerNames: jsonb('provider_former_names').$type<ProviderFormerName[]>(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Nome anterior derivado do histórico de jogos do fornecedor: cada jogo grava o nome do estádio/time
 * como estava no dia. `from`/`until` são a primeira e a última data (ISO) em que o nome apareceu.
 */
export interface ProviderFormerName {
  name: string;
  from: string;
  until: string;
}

/**
 * Nome e cidade para exibição: a curadoria da base semântica vence o fornecedor. Jogos anteriores
 * a uma troca de nome também usam o nome atual (os antigos ficam em `curated.former_names`).
 */
export function venueDisplay(v: { name: string; city: string | null; curated?: VenueCuration | null }): {
  name: string;
  city: string | null;
} {
  return { name: v.curated?.name ?? v.name, city: v.curated?.city ?? v.city };
}

export interface FormerName {
  name: string;
  /** Primeiro dia (ISO) em que o nome valeu; null quando a fonte não diz (curadoria). */
  from: string | null;
  until: string;
  origin: 'curated' | 'provider';
}

/**
 * Nomes anteriores do estádio: os da curadoria (base semântica) primeiro e, depois, os derivados do
 * fornecedor que a curadoria não cobre (mesmo nome atual ou já listado = a curadoria vence).
 */
export function venueFormerNames(v: {
  name: string;
  curated?: VenueCuration | null;
  providerFormerNames?: ProviderFormerName[] | null;
}): FormerName[] {
  const current = venueDisplay({ ...v, city: null }).name;
  const curated: FormerName[] = (v.curated?.former_names ?? []).map((f) => ({
    name: f.name,
    from: null,
    until: f.until,
    origin: 'curated',
  }));
  // nome atual, apelidos e nomes anteriores da curadoria cobrem as grafias do fornecedor
  const taken = [current, ...(v.curated?.nicknames ?? []), ...curated.map((f) => f.name)];
  const provider: FormerName[] = (v.providerFormerNames ?? [])
    .filter((f) => !taken.some((t) => sameName(t, f.name, v.curated?.city)))
    .map((f) => ({ name: f.name, from: f.from, until: f.until, origin: 'provider' }));
  return [...curated, ...provider].sort((a, b) => b.until.localeCompare(a.until));
}

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
    /** Nomes anteriores derivados dos jogos do fornecedor (`names:derive`); null = sem troca aceita. */
    providerFormerNames: jsonb('provider_former_names').$type<ProviderFormerName[]>(),
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
    // NULLS NOT DISTINCT: o elenco atual (season_id nulo) também é único por participante/pessoa/papel,
    // o que permite upsert idempotente de players/squads e coachs.
    unique('roster_uq').on(t.participantId, t.personId, t.role, t.seasonId).nullsNotDistinct(),
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
  /** Parciais por período (quartos, sets, tempos, entradas) nos esportes além do futebol. */
  periods?: Record<string, { home: number | null; away: number | null }> | null;
  /** Detalhe do placar por lado (AFL: goals/behinds; beisebol: hits/errors). */
  breakdown?: { home: Record<string, number | null>; away: Record<string, number | null> } | null;
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
    /** De onde veio o status atual: provider (dado do fornecedor) | temporal (inferido pelo horário). */
    statusSource: text('status_source').notNull().default('provider'),
    /** Provedor dono do estado atual (precedência entre provedores, docs/03 §8). */
    sourceProvider: text('source_provider'),
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
    /** provider | temporal | temporal_fallback | correction | editorial */
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

// ─── demais esportes ─────────────────────────────────────────────────────────────────────────────

/**
 * Espelho genérico do jogo/corrida/luta da api-sports nos 11 esportes além do futebol (issue #25),
 * ligado ao evento canônico: o item do fornecedor em `summary` (games, races, fights) e as partes
 * vindas de endpoints auxiliares (F1 `rankings/races`/`startinggrid`, MMA `fights/results`) em `detail`.
 */
export const sportEventDetail = core.table(
  'sport_event_detail',
  {
    eventId: uuid('event_id')
      .primaryKey()
      .references(() => event.id, { onDelete: 'cascade' }),
    sport: text('sport')
      .notNull()
      .references(() => sport.slug),
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    /** game | race | fight */
    kind: text('kind').notNull(),
    summary: jsonb('summary').notNull(),
    detail: jsonb('detail'),
    detailFetchedAt: timestamp('detail_fetched_at', { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('sport_event_detail_provider_uq').on(t.provider, t.sport, t.providerEventId)],
);
