import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
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
import { sql } from 'drizzle-orm';
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
  'broadcaster_logo',
  'other',
]);

/**
 * De onde veio a imagem: `provider` = a fonte dos dados (api-sports, Wikidata, emissoras…), espelhada
 * pelo `assets:mirror`; `acervo` = acervo customizado de logos importado pelo `assets:acervo`, que só
 * aparece na API com a flag ASSETS_CUSTOM_LOGOS ligada (docs/runbooks/acervo-de-logos.md).
 */
export const ASSET_ORIGINS = ['provider', 'acervo'] as const;
export type AssetOrigin = (typeof ASSET_ORIGINS)[number];
export const assetOrigin = core.enum('asset_origin', ASSET_ORIGINS);

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
    origin: assetOrigin('origin').notNull().default('provider'),
    /** Id do acervo (manifesto em config/assets/acervo/<id>.yaml) quando origin = acervo. */
    acervo: text('acervo'),
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
    /**
     * Prestígio editorial (0–10) somado à importância dos eventos: copas continentais e torneios de
     * seleções (config/competitions/<esporte>.yaml, campo `prestige`). docs/06 §3.
     */
    prestige: smallint('prestige').notNull().default(0),
    logoAssetId: uuid('logo_asset_id').references(() => asset.id),
    /** Logo do acervo customizado (assets:acervo); vale no lugar do logo_asset_id com ASSETS_CUSTOM_LOGOS=on. */
    customLogoAssetId: uuid('custom_logo_asset_id').references(() => asset.id),
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
  /**
   * `high` = curadoria editorial; `low` = derivado dos jogos do fornecedor. Os derivados são pistas
   * (busca, casamento de nomes), não fato confirmado: casa provisória (Camp Nou × Lluís Companys) e
   * nome de torneio (Atlanta Stadium na Copa) passam pelas regras. Nunca viram o nome atual.
   */
  confidence: 'high' | 'low';
}

/** Nome anterior derivado do fornecedor no formato da API (sempre `origin: provider`, `confidence: low`). */
export function providerFormerName(f: ProviderFormerName): FormerName {
  return { name: f.name, from: f.from, until: f.until, origin: 'provider', confidence: 'low' };
}

/**
 * Nomes anteriores do estádio: os da curadoria (base semântica) primeiro e, depois, os derivados do
 * fornecedor que a curadoria não cobre (mesmo nome atual ou já listado = a curadoria vence). Cada
 * grupo vai do mais recente ao mais antigo.
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
    confidence: 'high',
  }));
  // nome atual, apelidos e nomes anteriores da curadoria cobrem as grafias do fornecedor
  const taken = [current, ...(v.curated?.nicknames ?? []), ...curated.map((f) => f.name)];
  const provider: FormerName[] = (v.providerFormerNames ?? [])
    .filter((f) => !taken.some((t) => sameName(t, f.name, v.curated?.city)))
    .map(providerFormerName);
  const recentFirst = (a: FormerName, b: FormerName) => b.until.localeCompare(a.until);
  return [...curated.sort(recentFirst), ...provider.sort(recentFirst)];
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
    /** Escudo do acervo customizado (assets:acervo); vale no lugar do logo_asset_id com ASSETS_CUSTOM_LOGOS=on. */
    customLogoAssetId: uuid('custom_logo_asset_id').references(() => asset.id),
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
  /** Local e país de nascimento (`players`: birth.place / birth.country). */
  birthPlace: text('birth_place'),
  birthCountry: text('birth_country'),
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

/**
 * Estatísticas de uma pessoa por time e temporada de competição (`players?league&season`). As colunas são
 * os números mais usados; `stats` guarda o bloco `statistics[]` inteiro do fornecedor (chutes, passes,
 * desarmes, duelos, dribles, faltas, pênaltis, substituições).
 */
export const personSeasonStat = core.table(
  'person_season_stat',
  {
    personId: uuid('person_id')
      .notNull()
      .references(() => person.id),
    participantId: uuid('participant_id')
      .notNull()
      .references(() => participant.id),
    seasonId: uuid('season_id')
      .notNull()
      .references(() => season.id),
    position: text('position'),
    number: integer('number'),
    captain: boolean('captain'),
    appearances: integer('appearances'),
    lineups: integer('lineups'),
    minutes: integer('minutes'),
    rating: numeric('rating', { precision: 4, scale: 2 }),
    goals: integer('goals'),
    assists: integer('assists'),
    conceded: integer('conceded'),
    saves: integer('saves'),
    yellowCards: integer('yellow_cards'),
    redCards: integer('red_cards'),
    stats: jsonb('stats').$type<Record<string, unknown>>().notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.personId, t.participantId, t.seasonId] }),
    index('person_season_stat_season_idx').on(t.seasonId),
  ],
);

/** Transferências de uma pessoa (`transfers?team`/`transfers?player`). Times fora da base ficam nulos. */
export const personTransfer = core.table(
  'person_transfer',
  {
    id: pkUuidV7(),
    personId: uuid('person_id')
      .notNull()
      .references(() => person.id),
    date: date('date'),
    /** Como veio do fornecedor: "Loan", "Free", "€ 2.5M", "N/A"... */
    type: text('type'),
    fromParticipantId: uuid('from_participant_id').references(() => participant.id),
    toParticipantId: uuid('to_participant_id').references(() => participant.id),
    /** Nomes como vieram, para quando o time não está na base. */
    fromName: text('from_name'),
    toName: text('to_name'),
  },
  (t) => [
    unique('person_transfer_uq')
      .on(t.personId, t.date, t.fromParticipantId, t.toParticipantId, t.type)
      .nullsNotDistinct(),
  ],
);

/** Títulos de uma pessoa (`trophies?players`). `season` nulo é a linha-resumo do fornecedor. */
export const personTrophy = core.table(
  'person_trophy',
  {
    id: pkUuidV7(),
    personId: uuid('person_id')
      .notNull()
      .references(() => person.id),
    league: text('league').notNull(),
    country: text('country'),
    season: text('season'),
    /** "Winner", "2nd Place"... */
    place: text('place'),
  },
  (t) => [
    unique('person_trophy_uq').on(t.personId, t.league, t.country, t.season, t.place).nullsNotDistinct(),
  ],
);

/** Afastamentos de uma pessoa (`sidelined?players`): lesões, suspensões, doenças. */
export const personSidelined = core.table(
  'person_sidelined',
  {
    id: pkUuidV7(),
    personId: uuid('person_id')
      .notNull()
      .references(() => person.id),
    type: text('type').notNull(),
    startDate: date('start_date'),
    endDate: date('end_date'),
  },
  (t) => [unique('person_sidelined_uq').on(t.personId, t.type, t.startDate).nullsNotDistinct()],
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
 * Componentes do score de importância (docs/06 §3), gravados junto com `importance`.
 * `flags` = sinais decisivos que entraram na conta; `stake_flags` = os vindos da tabela (motor de regras),
 * calculados pelo recálculo periódico e preservados pelo upsert da normalização.
 */
export type EventImportanceBreakdown = {
  tier: number;
  phase: number;
  derby: number;
  decisive: number;
  prestige: number;
  /** Perna do confronto de ida e volta (1 = ida, 2 = volta); null em jogo único ou pontos corridos. */
  leg: 1 | 2 | null;
  flags: string[];
  stake_flags: string[];
};

/** Fonte citada por um jogo provisório (comunicado oficial, página de ingressos...). */
export type EventProvisionalSource = { name: string; url: string; checkedAt: string | null };

/**
 * Jogo provisório (`config/fixtures/provisional.yaml`): anunciado oficialmente e ainda não publicado pelo
 * fornecedor. Continua gravado depois da junção com o oficial (`mergedAt`), como registro e para a CLI não
 * recriar o jogo; quem diz se o evento ainda é provisório é `core.event.is_provisional`.
 */
export type EventProvisional = {
  /** Chave estável da curadoria (única entre os eventos). */
  key: string;
  /** curated (YAML revisado por gente) | agent (proposto por agente, depois de revisado). */
  origin: 'curated' | 'agent';
  /** Quem anunciou data e local (ex.: "Conmebol"). */
  announcedBy: string | null;
  /** `false`: só a data é oficial; `starts_at` guarda o meio-dia no fuso do local. */
  timeConfirmed: boolean;
  sources: EventProvisionalSource[];
  /** Observação editorial livre, por idioma. */
  note: Record<string, string> | null;
  /** Quando o fornecedor publicou o jogo e o evento virou oficial (ISO 8601). */
  mergedAt?: string | null;
  /** Provedor e ID do jogo oficial que assumiu o evento. */
  mergedProvider?: string | null;
  mergedProviderEventId?: string | null;
};

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
    /** Componentes do score de importância (null em eventos gravados antes da revisão de 2026-10). */
    importanceBreakdown: jsonb('importance_breakdown').$type<EventImportanceBreakdown>(),
    /** Clássico detectado pelos participantes (semantic.derby); some se o clássico sair da base. */
    derbyId: uuid('derby_id').references((): AnyPgColumn => derby.id, { onDelete: 'set null' }),
    /** Jogo anunciado que o fornecedor ainda não publicou; vira `false` na junção com o oficial. */
    isProvisional: boolean('is_provisional').notNull().default(false),
    /** Dados da curadoria do jogo provisório (fica depois da junção, com `mergedAt`). */
    provisional: jsonb('provisional').$type<EventProvisional>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('event_starts_at_idx').on(t.startsAt),
    index('event_status_idx').on(t.status),
    index('event_competition_starts_idx').on(t.competitionId, t.startsAt),
    index('event_sport_starts_idx').on(t.sport, t.startsAt),
    uniqueIndex('event_provisional_key_uq').on(sql`(${t.provisional}->>'key')`),
    index('event_provisional_idx')
      .on(t.competitionId, t.seasonId)
      .where(sql`${t.isProvisional}`),
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
  (t) => [
    uniqueIndex('event_incident_seq_uq').on(t.eventId, t.sequence),
    // perfil do jogador: os times em que ele marcou, levou cartão ou foi substituído
    index('event_incident_person_idx').on(t.personId),
  ],
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
    /** Das vitórias/derrotas, quantas foram na prorrogação ou nos pênaltis (hóquei); null nos outros esportes. */
    otWon: integer('ot_won'),
    otLost: integer('ot_lost'),
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
