/**
 * Modelo normalizado neutro: o que qualquer provedor entrega depois de traduzir o próprio formato.
 *
 * Todas as referências entre entidades usam o **ID do provedor** (string) dentro do par
 * `(provider, sport)` do lote. A camada de persistência resolve esses IDs para os nossos UUIDs via
 * `core.provider_map` — por isso trocar ou somar provedores não muda o core nem a API /v1.
 *
 * Convenção: `null` significa "o provedor não informou"; a persistência nunca apaga um valor
 * conhecido por causa de um `null` (coalesce).
 */
import type { EventClock, EventScore, ValidObservation } from './event/state-machine.js';

export type I18nText = Partial<Record<string, string>>;

export const STAGE_KINDS = [
  'regular',
  'league_phase',
  'group',
  'qualifying',
  'relegation',
  'playoff',
  'knockout_round',
  'round_of_128',
  'round_of_64',
  'round_of_32',
  'round_of_16',
  'quarter_final',
  'semi_final',
  'third_place',
  'final',
  'friendly',
  /** Fim de semana de Grande Prêmio (F1): agrupa treinos, classificação, sprint e corrida. */
  'race_weekend',
  /** Card de MMA (noite de lutas de uma organização): agrupa o card principal e as preliminares. */
  'fight_card',
  'other',
] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

export type ParticipantKind = 'club' | 'national_team' | 'athlete' | 'driver' | 'constructor' | 'fighter';
export type AssetKind =
  'team_logo' | 'league_logo' | 'venue' | 'player' | 'coach' | 'flag' | 'driver' | 'fighter' | 'circuit';

/** Temporada de uma competição do provedor: `(competição, ano)` — o ano é o rótulo de busca (ex.: 2025 = 2025/26). */
export interface SeasonRef {
  competitionId: string;
  year: number;
}

export interface NormalizedCompetition {
  id: string;
  name: string;
  type: 'league' | 'cup' | 'tournament';
  countryName: string | null;
  countryCode: string | null;
  logoUrl: string | null;
  /** Anos conhecidos (pelo menos o da temporada referenciada). */
  seasons: { year: number; label: string | null; startDate: string | null; endDate: string | null }[];
}

export interface NormalizedStage {
  season: SeasonRef;
  /** Rótulo original do provedor (chave de idempotência por temporada). */
  providerLabel: string;
  kind: StageKind;
  name: I18nText;
  order: number;
}

export interface NormalizedVenue {
  id: string;
  name: string;
  city: string | null;
  countryName: string | null;
  countryCode: string | null;
  capacity: number | null;
  surface: string | null;
  imageUrl: string | null;
  /**
   * Data do jogo em que `name` foi visto (estádio citado numa partida). O bloco `venue` de `/teams`
   * não tem data e fica para trás numa troca de nome: o nome datado mais recente vence.
   */
  nameSeenAt?: Date | null;
  /**
   * `true` quando a entidade só aparece como referência (time numa partida, jogador numa escalação):
   * preenche lacunas, mas não sobrescreve dados vindos do endpoint próprio da entidade.
   */
  reference?: boolean;
}

export interface NormalizedParticipant {
  id: string;
  /** `null` = o provedor não diz (ex.: time vindo de uma lista de partidas): mantém o que já existe. */
  kind: ParticipantKind | null;
  name: string;
  shortName: string | null;
  code: string | null;
  countryName: string | null;
  countryCode: string | null;
  founded: number | null;
  venueId: string | null;
  logoUrl: string | null;
  /** Tipo do asset da imagem (padrão `team_logo`; pilotos e lutadores usam `driver`/`fighter`). */
  logoKind?: AssetKind;
  /**
   * `true` quando a entidade só aparece como referência (time numa partida, jogador numa escalação):
   * preenche lacunas, mas não sobrescreve dados vindos do endpoint próprio da entidade.
   */
  reference?: boolean;
}

export interface NormalizedPerson {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  birthDate: string | null;
  nationality: string | null;
  heightCm: number | null;
  weightKg: number | null;
  /** Local e país de nascimento; ausente = o endpoint não informa (não apaga o conhecido). */
  birthPlace?: string | null;
  birthCountry?: string | null;
  photoUrl: string | null;
  photoKind: 'player' | 'coach';
  /**
   * `true` quando a entidade só aparece como referência (time numa partida, jogador numa escalação):
   * preenche lacunas, mas não sobrescreve dados vindos do endpoint próprio da entidade.
   */
  reference?: boolean;
}

export interface NormalizedEventParticipant {
  participantId: string;
  /** home | away | lane | grid... */
  side: string;
  position: number | null;
  result: Record<string, unknown> | null;
}

export interface NormalizedIncident {
  /** Posição estável na timeline do provedor (0, 1, 2...). */
  sequence: number;
  minute: number | null;
  extra: number | null;
  /** goal | own_goal | penalty_missed | card | subst | var | other */
  type: string;
  detail: string | null;
  participantId: string | null;
  personId: string | null;
  assistPersonId: string | null;
  data: Record<string, unknown> | null;
}

/** Espelho fiel da partida de futebol da api-sports (tabela `core.football_fixture`). */
export interface FootballFixtureMirror {
  providerFixtureId: number;
  round: string | null;
  referee: string | null;
  /** Objetos `fixture`/`league`/`teams`/`goals`/`score` do fornecedor. */
  summary: Record<string, unknown>;
  /** Partes do detalhe presentes nesta resposta (events, lineups, statistics, players); `null` = nenhuma. */
  detail: Record<string, unknown> | null;
}

/**
 * Espelho genérico do jogo/corrida/luta da api-sports para os esportes além do futebol
 * (tabela `core.sport_event_detail`): o item do fornecedor em `summary` e as partes de detalhe
 * vindas de endpoints auxiliares (resultados, grid) em `detail`.
 */
export interface SportEventMirror {
  /** ID do fornecedor (o mesmo do `NormalizedEvent.id`). */
  providerEventId: string;
  /** game | race | fight */
  kind: 'game' | 'race' | 'fight';
  /** Item do fornecedor como veio (games, races, fights). */
  summary: Record<string, unknown>;
  detail: Record<string, unknown> | null;
}

export interface NormalizedEvent {
  id: string;
  competitionId: string | null;
  season: SeasonRef | null;
  stageLabel: string | null;
  venueId: string | null;
  /** Estado, placar, relógio e horários observados. */
  observation: ValidObservation;
  participants: NormalizedEventParticipant[];
  /** Timeline completa quando a resposta a traz; `undefined` = não veio nesta resposta (mantém a atual). */
  incidents?: NormalizedIncident[];
  footballFixture?: FootballFixtureMirror;
  sportEvent?: SportEventMirror;
}

/**
 * Complemento de um evento já conhecido vindo de um endpoint auxiliar que não descreve o estado
 * (F1 `rankings/races` e `rankings/startinggrid`, MMA `fights/results`). Não passa pela máquina de
 * estados: os participantes são mesclados (nunca removidos) e o detalhe é somado ao espelho.
 */
export interface NormalizedEventSupplement {
  /** ID do evento no provedor. */
  eventId: string;
  /** Participantes a mesclar: `result` é somado ao existente e `position` nula não apaga a conhecida. */
  participants: NormalizedEventParticipant[];
  /** Partes de detalhe a somar em `core.sport_event_detail.detail` (ex.: `{ results: [...] }`). */
  detail: Record<string, unknown> | null;
}

export interface NormalizedRoster {
  participantId: string;
  personId: string;
  /** `null` = elenco atual, sem temporada. */
  season: SeasonRef | null;
  role: 'player' | 'coach' | 'staff';
  number: number | null;
  position: string | null;
  validFrom: string | null;
  validTo: string | null;
}

/** Estatísticas de uma pessoa por time e temporada de competição (players?league&season). */
export interface NormalizedPersonSeasonStat {
  personId: string;
  participantId: string;
  season: SeasonRef;
  position: string | null;
  number: number | null;
  captain: boolean | null;
  appearances: number | null;
  lineups: number | null;
  minutes: number | null;
  rating: number | null;
  goals: number | null;
  assists: number | null;
  conceded: number | null;
  saves: number | null;
  yellowCards: number | null;
  redCards: number | null;
  /** O bloco `statistics[]` inteiro do fornecedor. */
  stats: Record<string, unknown>;
}

/** Transferência de uma pessoa; times fora da base ficam só com o nome. */
export interface NormalizedTransfer {
  personId: string;
  date: string | null;
  type: string | null;
  fromParticipantId: string | null;
  toParticipantId: string | null;
  fromName: string | null;
  toName: string | null;
}

/** Título de uma pessoa. `personId` é o id do fornecedor; a pessoa precisa já existir no core. */
export interface NormalizedTrophy {
  personId: string;
  league: string;
  country: string | null;
  season: string | null;
  place: string | null;
}

/** Afastamento (lesão, suspensão) de uma pessoa que já existe no core. */
export interface NormalizedSidelined {
  personId: string;
  type: string;
  startDate: string | null;
  endDate: string | null;
}

/** Fotografia do elenco atual de um participante: o que não estiver nela sai do elenco atual. */
export interface RosterSnapshot {
  participantId: string;
  role: 'player' | 'coach' | 'staff';
}

export interface NormalizedStanding {
  season: SeasonRef;
  group: string;
  participantId: string;
  rank: number;
  points: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  form: string | null;
  description: string | null;
}

/** Tudo o que uma resposta de provedor descreve, pronto para o upsert idempotente no core. */
export interface NormalizedBatch {
  provider: string;
  sport: string;
  /** Quando o provedor entregou estes dados (ex.: `fetched_at` do raw). */
  observedAt: Date;
  competitions: NormalizedCompetition[];
  stages: NormalizedStage[];
  venues: NormalizedVenue[];
  participants: NormalizedParticipant[];
  persons: NormalizedPerson[];
  events: NormalizedEvent[];
  rosters: NormalizedRoster[];
  rosterSnapshots: RosterSnapshot[];
  standings: NormalizedStanding[];
  /** Complementos de eventos já conhecidos (resultados, grid de largada). */
  eventSupplements: NormalizedEventSupplement[];
  personSeasonStats: NormalizedPersonSeasonStat[];
  transfers: NormalizedTransfer[];
  trophies: NormalizedTrophy[];
  sidelined: NormalizedSidelined[];
}

export function emptyBatch(provider: string, sport: string, observedAt: Date): NormalizedBatch {
  return {
    provider,
    sport,
    observedAt,
    competitions: [],
    stages: [],
    venues: [],
    participants: [],
    persons: [],
    events: [],
    rosters: [],
    rosterSnapshots: [],
    standings: [],
    eventSupplements: [],
    personSeasonStats: [],
    transfers: [],
    trophies: [],
    sidelined: [],
  };
}

/** Une lotes do mesmo provedor/esporte; em IDs repetidos, a última ocorrência prevalece. */
export function mergeBatches(batches: NormalizedBatch[]): NormalizedBatch | null {
  const first = batches[0];
  if (!first) return null;
  const out = emptyBatch(first.provider, first.sport, first.observedAt);
  for (const b of batches) {
    if (b.provider !== first.provider || b.sport !== first.sport)
      throw new Error('mergeBatches: lotes de provedores ou esportes diferentes');
    if (b.observedAt > out.observedAt) out.observedAt = b.observedAt;
    out.competitions.push(...b.competitions);
    out.stages.push(...b.stages);
    out.venues.push(...b.venues);
    out.participants.push(...b.participants);
    out.persons.push(...b.persons);
    out.events.push(...b.events);
    out.rosters.push(...b.rosters);
    out.rosterSnapshots.push(...b.rosterSnapshots);
    out.standings.push(...b.standings);
    out.eventSupplements.push(...b.eventSupplements);
    out.personSeasonStats.push(...b.personSeasonStats);
    out.transfers.push(...b.transfers);
    out.trophies.push(...b.trophies);
    out.sidelined.push(...b.sidelined);
  }
  return out;
}

export type { EventClock, EventScore };
