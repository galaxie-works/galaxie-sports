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
  'other',
] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

export type ParticipantKind = 'club' | 'national_team' | 'athlete' | 'driver' | 'constructor' | 'fighter';
export type AssetKind = 'team_logo' | 'league_logo' | 'venue' | 'player' | 'coach' | 'flag';

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
  }
  return out;
}

export type { EventClock, EventScore };
