// ─── Modelo dos widgets Galaxie Sports ───────────────────────────────────────────────────────────
// Tipos, tema (CSS variables `--gs-*`), textos e utilitários sem React. Este arquivo e o `react.tsx`
// formam o `galaxie-core.tsx` que vai para o app da operadora pelo registry shadcn (scripts/embed-sources.mjs):
// não importe nada aqui.

// ─── configuração (mesmo formato salvo no banco pelo Builder) ───────────────────────────────────

export const WIDGET_KINDS = [
  'match_card',
  'match_timeline',
  'live_list',
  'score_ticker',
  'standings',
  'where_to_watch',
  'ai_context',
  'match_stakes',
  'related_videos',
  'head_to_head',
  'team_schedule',
  'team_card',
  'race_result',
  'race_weekend',
  'season_calendar',
  'athlete_profile',
  'fight_card',
  'equestrian_results',
  'equestrian_ranking',
  'equestrian_calendar',
  'rider_profile',
  'horse_profile',
  'medal_table',
  'country_today',
  'games_schedule',
  'country_athletes',
  'medal_history',
  'champions_gallery',
  'competition_leaders',
  'countdown',
  'team_squad',
  'player_profile',
  'lineups',
  'match_prediction',
  'match_odds',
  'team_stats',
  'transfer_market',
  'bracket',
] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

export const WIDGET_LOCALES = ['pt-BR', 'es', 'en'] as const;
export type WidgetLocale = (typeof WIDGET_LOCALES)[number];

export type WidgetDensity = 'compact' | 'comfortable';
export type WidgetMode = 'light' | 'dark';

export interface WidgetTheme {
  primary: string;
  background: string;
  surface: string;
  foreground: string;
  mutedForeground: string;
  border: string;
  /** Raio dos cantos, em px. */
  radius: number;
  fontFamily: string;
  density: WidgetDensity;
  mode: WidgetMode;
}

export interface WidgetDefaults {
  competitionId?: string | undefined;
  teamId?: string | undefined;
  eventId?: string | undefined;
  /** Jogador ou técnico (`/v1/people/{id}`), na ficha do jogador. */
  personId?: string | undefined;
  sport?: string | undefined;
}

/**
 * Faixas da tabela, uma cor por degrau: vaga direta (Libertadores, Champions, acesso), vaga pela fase
 * prévia, segunda copa continental (Sul-Americana, Europa League), terceira (Conference League), playoff
 * contra a queda e queda. As mesmas da tabela da demo.
 */
export const STANDINGS_ZONE_TONES = [
  'direct',
  'qualifying',
  'second',
  'third',
  'relegationPlayoff',
  'relegation',
] as const;
export type StandingsZoneTone = (typeof STANDINGS_ZONE_TONES)[number];
/** Cor de cada faixa (`#rrggbb` ou `#rrggbbaa`); o que faltar usa `DEFAULT_ZONE_COLORS`. */
export type StandingsZoneColors = Partial<Record<StandingsZoneTone, string>>;

/** Opções da tabela salvas no Builder. */
export interface StandingsOptions {
  /** Legenda das zonas embaixo da tabela (padrão: sim). */
  showLegend?: boolean | undefined;
  zoneColors?: StandingsZoneColors | undefined;
}

/** Dados extras que cada linha da lista de jogos pode mostrar (liga/desliga no Builder). */
export const LIVE_LIST_FIELDS = [
  'showCompetitionLogo',
  'showRound',
  'showVenue',
  'showCity',
  'showDerby',
  'showStakes',
  'showReferee',
  'showPenalties',
] as const;
export type LiveListField = (typeof LIVE_LIST_FIELDS)[number];

/** Padrão de cada dado extra: o logo do campeonato já aparecia; rodada, estádio e cidade entram ao ligar. */
export const LIVE_LIST_FIELD_DEFAULTS: Record<LiveListField, boolean> = {
  showCompetitionLogo: true,
  showRound: false,
  showVenue: false,
  showCity: false,
  showDerby: false,
  showStakes: false,
  showReferee: false,
  showPenalties: true,
};

/** Quais jogos entram: todos do dia, só ao vivo, só os que ainda vão começar ou só os encerrados. */
export const LIVE_LIST_MODES = ['all', 'live', 'upcoming', 'finished'] as const;
export type LiveListMode = (typeof LIVE_LIST_MODES)[number];

/** Dia da lista, no fuso do widget. */
export const LIVE_LIST_DAYS = ['yesterday', 'today', 'tomorrow'] as const;
export type LiveListDay = (typeof LIVE_LIST_DAYS)[number];

/** Ordem: horário (padrão) ou relevância no país do widget (importância do jogo + interesse do mercado). */
export const LIVE_LIST_ORDERS = ['time', 'relevance'] as const;
export type LiveListOrder = (typeof LIVE_LIST_ORDERS)[number];

/** Nome dos times: completo ou curto (cai no completo quando não há curto). */
export const LIVE_LIST_TEAM_NAMES = ['full', 'short'] as const;
export type LiveListTeamName = (typeof LIVE_LIST_TEAM_NAMES)[number];

/** Endereço modelo do link de cada jogo: só https, com `{eventId}`. */
const EVENT_LINK_MAX = 300;
export function isEventLinkTemplate(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > EVENT_LINK_MAX || !value.includes('{eventId}'))
    return false;
  if (/[\s"'<>`]/.test(value)) return false;
  try {
    const url = new URL(value.replaceAll('{eventId}', 'x'));
    return url.protocol === 'https:' && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/** Link de um jogo a partir do modelo salvo (o id vai codificado). */
export function eventLinkFor(template: string, eventId: string): string {
  return template.replaceAll('{eventId}', encodeURIComponent(eventId));
}

/** Limites do número de jogos da lista. */
export const LIVE_LIST_LIMIT = { min: 1, max: 200, default: 30 } as const;

/** Opções da lista de jogos salvas no Builder (mesmos nomes das props do `LiveList`). */
export interface LiveListOptions extends Partial<Record<LiveListField, boolean | undefined>> {
  /** Quais jogos entram (padrão: todos). */
  mode?: LiveListMode | undefined;
  /** Dia da lista (padrão: hoje; não vale no modo ao vivo). */
  day?: LiveListDay | undefined;
  /** Ordem dos jogos (padrão: horário). */
  order?: LiveListOrder | undefined;
  /** Só jogos com relevância no país a partir deste valor (0–100; padrão: todos). */
  minRelevance?: number | undefined;
  /** Só competições deste país (ISO2). */
  country?: string | undefined;
  /** Nome dos times (padrão: completo). */
  teamName?: LiveListTeamName | undefined;
  /** Link de cada jogo no site do cliente (`https://…{eventId}…`). */
  eventLink?: string | undefined;
  /** Abre o link do jogo em outra aba. */
  eventLinkNewTab?: boolean | undefined;
  /** Agrupa os jogos por campeonato (padrão: sim). */
  groupByCompetition?: boolean | undefined;
  /** Atualiza sozinho enquanto há jogo rolando (padrão: sim). */
  autoRefresh?: boolean | undefined;
  /** Máximo de jogos (padrão 30). */
  limit?: number | undefined;
}

/** Configuração salva do widget (mesmo formato do banco: locale e market obrigatórios). */
export interface WidgetConfig {
  theme: WidgetTheme;
  locale: WidgetLocale;
  /** País ISO2 (onde assistir, relevância e variante do espanhol). */
  market: string;
  defaults: WidgetDefaults;
  /** Só na tabela de classificação. */
  standings?: StandingsOptions | undefined;
  /** Só na lista de jogos. */
  liveList?: LiveListOptions | undefined;
}

// ─── respostas da API pública (o recorte que os widgets leem; ver @galaxie/contracts) ─────────────

export type GsEventStatus =
  | 'scheduled'
  | 'starting'
  | 'live'
  | 'break'
  | 'finished'
  | 'postponed'
  | 'cancelled'
  | 'suspended'
  | 'abandoned';

export interface GsSidePair {
  home: number | null;
  away: number | null;
}

export interface GsParticipant {
  side: string;
  id: string;
  name: string;
  short_name: string | null;
  logo: string | null;
  winner: boolean | null;
  /** Tags do torcedor ("Na briga pelo título"), por relevância. */
  fan_tags?: GsFanTag[] | undefined;
  /** Grito curto da torcida no mercado da resposta. */
  cheer?: { text: string } | null | undefined;
  /** Corridas (F1, lado `grid`): posição final na sessão. */
  position?: number | null | undefined;
  /** Corridas (F1): tempo, diferença, voltas, largada, paradas e a equipe. */
  result?: GsParticipantResult | null | undefined;
  /** Corridas (F1): retrato do piloto. */
  photo?: { url: string | null } | null | undefined;
}

export interface GsParticipantResult {
  time: string | null;
  gap: string | null;
  laps: number | null;
  grid: number | null;
  pits: number | null;
  team: { id: string | null; name: string; logo: string | null } | null;
}

/** Sessão do fim de semana de corrida (F1): o GP é a fase (`stage`), a sessão é o evento. */
export interface GsSession {
  type: 'practice' | 'qualifying' | 'sprint_qualifying' | 'sprint' | 'race';
  number: number | null;
  /** Nome no idioma da resposta ("Corrida", "Treino livre 2"). */
  name: string;
  laps: number | null;
  distance: string | null;
  fastest_lap: { participant_id: string | null; time: string | null } | null;
}

/** Luta de MMA: card, segmento, categoria e desfecho. */
export interface GsFight {
  card: { id: string; name: string } | null;
  segment: 'main_card' | 'prelims' | 'early_prelims';
  main_event: boolean;
  weight_class: { code: string; name: string } | null;
  result: {
    method: string;
    method_name: string;
    detail: string | null;
    round: number | null;
    time: string | null;
    scorecards: string[];
  } | null;
}

/** Card de MMA (`/v1/events/{id}/card`): a noite de lutas. */
export interface GsFightCard {
  card: { id: string; name: string; starts_at: string; ends_at: string };
  fights: GsEvent[];
}

/** Carreira na F1 (`/v1/teams/{id}/career`), só o que o perfil usa. */
export interface GsRaceCareer {
  participant_id: string;
  kind: 'driver' | 'constructor';
  profile: {
    first_name: string;
    last_name: string;
    number: number | null;
    birth_date: string | null;
    birth_country: { code: string; name: string; flag: string | null } | null;
  } | null;
  current_season: number | null;
  totals: {
    seasons: number;
    races: number;
    wins: number;
    poles: number;
    podiums: number;
    fastest_laps: number;
    points: number | null;
  };
  titles: number[];
  best_finish: number | null;
  teams: { id: string; name: string; logo: string | null; from: number; to: number }[];
  seasons: {
    year: number;
    position: number | null;
    final: boolean;
    points: number | null;
    races: number;
    wins: number;
    podiums: number;
    poles: number;
  }[];
  portrait: { url: string | null } | null;
}

/** Competição (`/v1/competitions/{id}`), só o que os widgets usam. */
export interface GsCompetition {
  id: string;
  slug: string;
  sport: string;
  name: string;
  logo: string | null;
  seasons?:
    | { year: number; label: string; start_date: string | null; end_date: string | null; current: boolean }[]
    | undefined;
}

// ─── hipismo (`/v1/equestrian/*`) ───────────────────────────────────────────────────────────────

export interface GsEqCountry {
  code: string;
  iso2: string | null;
  name: string | null;
  flag_url: string | null;
}

export interface GsEqAthleteRef {
  id: string;
  name: string;
  country: GsEqCountry | null;
}

export interface GsEqHorseRef {
  id: string;
  name: string;
  breed: string | null;
  born_year: number | null;
  age: number | null;
}

export interface GsEqCompetition {
  id: string;
  name: string;
  level: string | null;
  date: string | null;
  venue: string | null;
  country: GsEqCountry | null;
  height_cm: number | null;
  is_grand_prix: boolean;
  show?: { start: string | null; end: string | null } | null | undefined;
}

export interface GsEqResult {
  id: string;
  date: string | null;
  competition: GsEqCompetition | null;
  athlete: GsEqAthleteRef | null;
  athlete_name_as_published: string;
  horse: GsEqHorseRef | null;
  horse_name_as_published: string | null;
  country: GsEqCountry | null;
  position: number | null;
  position_raw: string | null;
  status: string;
  score: {
    raw: string | null;
    penalties: number | null;
    time_seconds: number | null;
  };
  prize: { amount: number | null; currency: string | null; raw: string | null } | null;
}

export interface GsEqCompetitionDetail extends GsEqCompetition {
  standings: GsEqResult[];
}

export interface GsEqRanking {
  id: string;
  ranking: string;
  athlete: GsEqAthleteRef | null;
  horse: GsEqHorseRef | null;
  horse_name_as_published: string | null;
  rank: number | null;
  points: number | null;
  edition: string | null;
}

export interface GsEqAthlete extends GsEqAthleteRef {
  stats: { results: number; classified: number; wins: number; podiums: number; last_result: string | null };
  horses: (GsEqHorseRef & { results: number; best_position: number | null })[];
  rankings: GsEqRanking[];
}

export interface GsEqHorse extends GsEqHorseRef {
  gender: string | null;
  color: string | null;
  studbook: string | null;
  sire: string | null;
  dam: string | null;
  dam_sire: string | null;
  riders: (GsEqAthleteRef & { results: number })[];
  stats: { results: number; wins: number; podiums: number };
}

export interface GsEqOverview {
  highlights: GsEqAthleteRef[];
  recent_competitions: GsEqCompetition[];
}

export interface GsPage<T> {
  data: T[];
  next_cursor?: string | null | undefined;
}

// ─── Olimpíadas e Pan (`/v1/multisport/*`) ──────────────────────────────────────────────────────

export interface GsGames {
  slug: string;
  type: string;
  season: string;
  year: number;
  name: string;
  host_city: string;
  start_date: string;
  end_date: string;
  tz: string;
  status: 'completed' | 'in_progress' | 'upcoming';
}

export interface GsNoc {
  code: string;
  name: string;
  iso2: string | null;
}

export interface GsMedalCounts {
  gold: number;
  silver: number;
  bronze: number;
  total: number;
}

export interface GsMedalQuality {
  level: string | null;
  publishable?: boolean | undefined;
}

export interface GsMedalTable {
  games: GsGames;
  data_quality: GsMedalQuality;
  data: (GsMedalCounts & { rank: number; noc: GsNoc })[];
}

export interface GsScheduleUnit {
  id: string;
  name: string | null;
  starts_at: string | null;
  status: 'scheduled' | 'live' | 'finished' | 'delayed' | 'cancelled';
  venue: string | null;
  is_medal_unit: boolean;
  phase: { code: string; name: string };
  event: {
    id: string;
    name: string;
    discipline: { code: string; name: string; sport: { code: string; name: string } } | null;
  };
}

export interface GsGamesMedal {
  medal: 'G' | 'S' | 'B';
  participant: { id: string; name: string };
  event?: { id: string; name: string } | undefined;
  revoked: boolean;
}

export interface GsNocToday {
  games: GsGames;
  noc: GsNoc;
  date: string;
  units: GsScheduleUnit[];
  medals: GsGamesMedal[];
}

export interface GsDelegation {
  games: GsGames;
  noc: GsNoc;
  data: {
    person_id: string;
    name: string;
    medals: GsMedalCounts;
    events: { id: string; name: string; medal: 'G' | 'S' | 'B' | null }[];
  }[];
}

export interface GsMedalHistory {
  nocs: GsNoc[];
  data: (GsMedalCounts & {
    games: { slug: string; type: string; season: string; year: number; name: string };
    noc: string;
    rank_by_gold: number;
  })[];
  totals: (GsMedalCounts & { noc: string })[];
  withheld: { slug: string; name: string }[];
}

/** Ficha da pessoa (`/v1/people/{id}/overview`), só o que a ficha do jogador usa. */
export interface GsPersonNumbers {
  appearances: number;
  starts: number;
  minutes: number;
  goals: number;
  assists: number;
  yellow_cards: number;
  red_cards: number;
  rating: number | null;
}

export interface GsTransferTeam {
  id: string | null;
  name: string;
  logo: string | null;
}

export interface GsPersonOverview {
  person: {
    id: string;
    name: string;
    birth_date: string | null;
    age: number | null;
    nationality: string | null;
    height_cm: number | null;
    photo: string | null;
  };
  /** País da nacionalidade (código ISO2, para a bandeira). */
  nationality_ref: { code: string; name: string } | null;
  role: string | null;
  position: string | null;
  number: number | null;
  current_team: { id: string; name: string; logo: string | null } | null;
  season: number | null;
  seasons: { year: number; appearances: number; goals: number }[];
  totals: GsPersonNumbers | null;
  career: {
    team: { id: string; name: string; logo: string | null };
    from: number;
    to: number;
    appearances: number;
    goals: number;
    current: boolean;
  }[];
  transfers: { date: string | null; type: string | null; from: GsTransferTeam; to: GsTransferTeam }[];
  trophies?: { league: string; country: string | null; season: string; place: string | null }[] | undefined;
}

/** Vai e vem do mercado (`/v1/teams|competitions/{id}/transfers`, #832). */
export type GsTransferKind = 'loan' | 'loan_return' | 'free' | 'fee' | 'transfer';
export interface GsTransferClub {
  id: string | null;
  name: string;
  logo: string | null;
}
export interface GsTransfer {
  person: { id: string; name: string; photo: string | null };
  date: string | null;
  direction: 'in' | 'out';
  kind: GsTransferKind | null;
  fee: string | null;
  type: string | null;
  from: GsTransferClub;
  to: GsTransferClub;
}
export interface GsTransferList {
  scope: { type: 'team' | 'competition'; id: string; name: string; logo: string | null };
  since: string;
  data: GsTransfer[];
}

/** Time ou atleta (`/v1/teams/{id}`), só o que o perfil usa. */
export interface GsTeam {
  id: string;
  sport: string;
  kind: string;
  name: string;
  short_name: string | null;
  logo: string | null;
  country_ref?: { code: string; name: string; flag: string | null } | null | undefined;
}

/** Posições do futebol na ordem do elenco (chave do fornecedor, em inglês). */
export const SQUAD_POSITIONS = ['Goalkeeper', 'Defender', 'Midfielder', 'Attacker'] as const;

/** Pessoa do elenco (`/v1/teams/{id}/squad`), só o que o widget usa. */
export interface GsSquadMember {
  person: {
    id: string;
    name: string;
    photo: string | null;
    nationality: string | null;
    nationality_ref: { code: string; name: string } | null;
    age: number | null;
  };
  number: number | null;
  position: string | null;
}

/** Elenco do time (`/v1/teams/{id}/squad`). */
export interface GsSquad {
  team_id: string;
  season: number | null;
  players: GsSquadMember[];
  coaches: GsSquadMember[];
}

/** Rótulo no locale da resposta (`{ "pt-BR": "…" }`). */
export type GsLocalizedText = Record<string, string>;

export interface GsFanTag {
  code: string;
  priority: number;
  text: GsLocalizedText;
}

/** O que está em jogo para cada time (motor de regras). */
export interface GsStake {
  team: 'home' | 'away' | 'both';
  team_id: string | null;
  code: string;
  text: GsLocalizedText;
  phase: 'pre_match' | 'result';
  salient: boolean;
}

/** AFL: gols (6 pontos) e behinds (1 ponto) de cada lado. */
export interface GsGoalsBehinds {
  home: { goals: number | null; behinds: number | null };
  away: { goals: number | null; behinds: number | null };
}

export interface GsEvent {
  id: string;
  sport: string;
  competition: {
    id: string;
    slug: string;
    name: string;
    logo: string | null;
    nickname?: string | null | undefined;
    country?: { code: string; name: string; flag: string | null } | null | undefined;
  } | null;
  stage: { name: string | null } | null;
  starts_at: string;
  status: GsEventStatus;
  clock: { minute: number | null; extra: number | null; period: string | null } | null;
  participants: GsParticipant[];
  score: GsSidePair & {
    penalty: GsSidePair | null;
    halftime?: GsSidePair | null | undefined;
    aggregate?: GsSidePair | null | undefined;
    periods?:
      | {
          code: string;
          home: number | null;
          away: number | null;
          goals_behinds?: GsGoalsBehinds | undefined;
        }[]
      | null
      | undefined;
    /** AFL: gols e behinds do placar final. */
    goals_behinds?: GsGoalsBehinds | undefined;
    /** Beisebol: rebatidas e erros (o H e o E do R/H/E). */
    hits_errors?:
      | {
          home: { hits: number | null; errors: number | null };
          away: { hits: number | null; errors: number | null };
        }
      | undefined;
  };
  venue: { name: string; city: string | null; timezone?: string | null | undefined } | null;
  /** Importância do jogo (0–100). */
  importance?: number | undefined;
  /** Relevância no mercado pedido (`market`). */
  relevance?: { market: string; score: number } | null | undefined;
  referee?: { name: string; country?: string | null | undefined } | null | undefined;
  derby?: { slug: string; name: string; intensity: number } | null | undefined;
  stakes?: GsStake[] | undefined;
  /** F1: a sessão do fim de semana. */
  session?: GsSession | null | undefined;
  /** MMA: card, categoria e desfecho da luta. */
  fight?: GsFight | null | undefined;
}

/** Lance do minuto a minuto (`/v1/events/{id}/timeline`), só o que os widgets usam. */
export interface GsTimelineIncident {
  sequence: number;
  kind: string;
  minute: number | null;
  extra: number | null;
  player: GsTimelinePerson | null;
  team: GsTimelineTeam | null;
  scoring_team?: GsTimelineTeam | null | undefined;
  /** Assistência (na substituição, quem entra: prefira `player_in`). */
  assist?: GsTimelinePerson | null | undefined;
  player_in?: GsTimelinePerson | null | undefined;
  player_out?: GsTimelinePerson | null | undefined;
  /** Texto do fornecedor ("Yellow Card", "Goal cancelled"…). */
  detail?: string | null | undefined;
  clock?: GsMatchClock | undefined;
  score_after?: { home: number; away: number } | null | undefined;
  key_moment?: boolean | undefined;
}

export interface GsTimelinePerson {
  id?: string | null | undefined;
  name: string;
  number?: number | null | undefined;
}

export interface GsTimelineTeam {
  id: string | null;
  side: string | null;
  name?: string | null | undefined;
  logo?: string | null | undefined;
}

/** Relógio de jogo do lance ou do marco: período, minuto e acréscimo. */
export interface GsMatchClock {
  period: string | null;
  minute: number | null;
  extra_minute: number | null;
  display: string | null;
}

/** Marco do jogo (início, intervalo, 2º tempo, prorrogação, pênaltis, fim). */
export interface GsTimelineMarker {
  kind: GsTimelineMarkerKind;
  clock: GsMatchClock;
}

export type GsTimelineMarkerKind =
  | 'kickoff'
  | 'halftime'
  | 'second_half'
  | 'end_of_regulation'
  | 'extra_time'
  | 'penalty_shootout'
  | 'full_time';

export interface GsTimeline {
  event_id: string;
  incidents: GsTimelineIncident[];
  /** Os campos abaixo vêm sempre da API; opcionais só para o placar, que usa só os lances. */
  status?: GsEventStatus | undefined;
  live?: boolean | undefined;
  clock?: GsMatchClock | null | undefined;
  score?: GsSidePair | undefined;
  markers?: GsTimelineMarker[] | undefined;
}

/** Estatísticas do jogo (`/v1/events/{id}/stats`): por time, com o código estável. */
export interface GsEventStats {
  event_id: string;
  available: boolean;
  teams: {
    team: { id: string | null; side: string | null };
    statistics: { code: string | null; value: number | string | null }[];
  }[];
}

/** Escalações (`/v1/events/{id}/lineups`): só a formação. */
export interface GsLineups {
  event_id: string;
  available: boolean;
  lineups: { team: { id: string | null; side?: string | null }; formation: string | null }[];
}

/** Lado e linha de gols do palpite (`over` = mais de, `under` = menos de). */
export interface GsGoalsLine {
  side: 'over' | 'under';
  line: number;
}

/** Chaves da comparação dos times no palpite, na ordem da API. */
export const PREDICTION_COMPARISON = [
  'form',
  'attack',
  'defense',
  'poisson',
  'h2h',
  'goals',
  'total',
] as const;
export type GsPredictionComparisonKey = (typeof PREDICTION_COMPARISON)[number];

/** Palpite do jogo (`/v1/events/{id}/predictions`), só o que o widget usa. */
export interface GsEventPredictions {
  event_id: string;
  sport: string;
  home: { id: string; name: string; short_name: string | null; logo: string | null } | null;
  away: { id: string; name: string; short_name: string | null; logo: string | null } | null;
  prediction: {
    winner: { side: 'home' | 'away'; participant_id: string; win_or_draw: boolean } | null;
    probabilities: { home: number | null; draw: number | null; away: number | null };
    goals: { total: GsGoalsLine | null; home: GsGoalsLine | null; away: GsGoalsLine | null };
    comparison: { key: GsPredictionComparisonKey; home: number | null; away: number | null }[];
  } | null;
  updated_at: string | null;
}

/** Mercados de odds que o widget mostra (chaves da API). */
export const ODDS_WIDGET_MARKETS = [
  'match_winner',
  'double_chance',
  'goals_over_under',
  'both_teams_score',
] as const;
export type GsOddsMarketKey = (typeof ODDS_WIDGET_MARKETS)[number];

/** Odds do jogo (`/v1/events/{id}/odds`): só o consenso entre as casas, sem identificá-las. */
export interface GsEventOdds {
  event_id: string;
  sport: string;
  home: { id: string; name: string; short_name: string | null; logo: string | null } | null;
  away: { id: string; name: string; short_name: string | null; logo: string | null } | null;
  markets: {
    key: string;
    selections: { key: string; line: number | null; average: number; best: number; bookmakers: number }[];
  }[];
  bookmakers: number;
  updated_at: string | null;
}

/** Situação do campeonato (`/v1/competitions/{id}/context`), só líder e jogos decisivos. */
export interface GsCompetitionContext {
  groups: {
    name: string | null;
    leader: {
      rank: number;
      points: number;
      participant: { id: string; name: string; short_name: string | null; logo: string | null };
    } | null;
  }[];
  decisive_events?: GsEvent[] | undefined;
}

/** Card do time (`/v1/teams/{id}/overview`): posição e forma. */
export interface GsTeamOverview {
  standings: { competition: { id: string; name: string }; rank: number | null }[];
  form: { event_id: string; result: 'W' | 'D' | 'L'; score: string }[];
  /** O time (escudo, país, estádio): o cartão do time usa; a agenda só lê a posição e a forma. */
  team?: GsTeamOverviewTeam | undefined;
  /** Campanha em cada competição da temporada atual (em disputa primeiro). */
  competitions?: GsTeamCompetition[] | undefined;
  live_event?: GsEvent | null | undefined;
  next_event?: GsEvent | null | undefined;
}

/** Em casa, fora e no total (`/v1/teams/{id}/statistics`); null = o dado não veio. */
export interface GsHomeAwayTotal {
  home: number | null;
  away: number | null;
  total: number | null;
}

/** Quantos numa faixa de minutos; `from`/`to` nulos = minuto não informado. */
export interface GsMinuteRange {
  from: number | null;
  to: number | null;
  count: number;
}

/** Placar visto pelo time. */
export interface GsScoreLine {
  for: number;
  against: number;
}

/** Estatísticas do time numa competição e temporada (`/v1/teams/{id}/statistics`, #893). */
export interface GsTeamSeasonStats {
  competition: { id: string; slug: string; name: string; logo: string | null };
  season: { year: number; label: string };
  /** W/D/L do mais recente ao mais antigo. */
  form: string | null;
  record: { played: GsHomeAwayTotal; won: GsHomeAwayTotal; drawn: GsHomeAwayTotal; lost: GsHomeAwayTotal };
  goals: {
    scored: GsHomeAwayTotal;
    conceded: GsHomeAwayTotal;
    scored_average: GsHomeAwayTotal;
    conceded_average: GsHomeAwayTotal;
    scored_by_minute: GsMinuteRange[];
    conceded_by_minute: GsMinuteRange[];
  };
  clean_sheets: GsHomeAwayTotal;
  failed_to_score: GsHomeAwayTotal;
  streaks: { wins: number | null; draws: number | null; losses: number | null };
  biggest: {
    win: { home: GsScoreLine | null; away: GsScoreLine | null };
    loss: { home: GsScoreLine | null; away: GsScoreLine | null };
  };
  penalties: { scored: number | null; missed: number | null; total: number | null };
  formations: { formation: string; played: number }[];
  cards: {
    yellow: number | null;
    red: number | null;
    yellow_by_minute: GsMinuteRange[];
    red_by_minute: GsMinuteRange[];
  };
  updated_at: string;
}

/** Resposta de `/v1/teams/{id}/statistics`: a temporada escolhida (ou null) e o que existe. */
export interface GsTeamStatistics {
  team_id: string;
  sport: string;
  data: GsTeamSeasonStats | null;
  available: { competition: { id: string; name: string }; season: { year: number; label: string } }[];
}

export interface GsTeamOverviewTeam extends GsTeam {
  founded?: number | null | undefined;
  venue?: { name: string; city: string | null } | null | undefined;
}

/** Competição que o time disputa, com a situação da campanha (`/v1/teams/{id}/overview`). */
export interface GsTeamCompetition {
  competition: { id: string; slug: string; name: string; logo: string | null };
  season: { year: number; label: string };
  campaign: { status: string; label: GsLocalizedText; ongoing: boolean; rank: number | null };
}

/** Cenário pré-jogo e resumo pós-jogo de IA (`/v1/events/{id}/context`). */
export interface GsEventContextText {
  kind: 'scenario' | 'recap';
  locale: string;
  text: string;
  origin: 'llm' | 'fallback';
  generated_at: string;
}

export interface GsEventContext {
  event_id: string;
  locale: string;
  data: GsEventContextText[];
}

/** Vídeo relacionado ao evento (`/v1/events/{id}/related`). */
export interface GsRelatedItem {
  id: string;
  url: string;
  embed_url: string | null;
  title: string;
  content_type: string;
  content_type_label: string;
  format: 'short' | 'long';
  aspect_ratio: '16:9' | '9:16' | '4:3' | '1:1';
  duration_seconds: number | null;
  published_at: string;
  thumbnail_url: string | null;
  channel: { title: string; source_tier: string };
}

export interface GsRelated {
  event_id: string;
  data: GsRelatedItem[];
  updated_at: string | null;
}

/** Confronto direto (`/v1/events/{id}/h2h`). */
export interface GsHeadToHead {
  event_id: string;
  participants: { id: string; name: string; logo: string | null }[];
  summary: {
    since: number | null;
    played: number;
    draws: number;
    teams: { id: string; wins: number; goals: number }[];
  };
  all_time: {
    derby: { slug: string; name: string } | null;
    matches: number;
    draws: number;
    teams: { id: string; wins: number; goals: number | null }[];
    as_of: string;
  } | null;
  events: GsEvent[];
}

export interface GsEventList {
  data: GsEvent[];
}

export interface GsStandingRow {
  rank: number;
  participant: { id: string; name: string; short_name: string | null; logo: string | null };
  points: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goal_diff: number;
  goals_for?: number | undefined;
  goals_against?: number | undefined;
  /** Hóquei: das vitórias/derrotas, as na prorrogação ou nos pênaltis. */
  ot_won?: number | null | undefined;
  ot_lost?: number | null | undefined;
  /** Corridas (F1): retrato do piloto, equipe da temporada e pódios. */
  photo?: { url: string | null } | null | undefined;
  season_team?: { id: string | null; name: string; livery: { primary: string } | null } | null | undefined;
  podiums?: number | null | undefined;
  form: string | null;
  description: string | null;
}

/** Categoria da artilharia e líderes (`/v1/competitions/{id}/seasons/{season}/leaders`). */
export const LEADER_CATEGORIES = ['goals', 'assists', 'cards'] as const;
export type GsLeaderCategory = (typeof LEADER_CATEGORIES)[number];

export interface GsLeaderRow {
  rank: number;
  person: { id: string; name: string; photo: string | null };
  team: { id: string; name: string; short_name: string | null; logo: string | null } | null;
  value: number;
  appearances: number;
  minutes: number;
  goals: number;
  assists: number;
  yellow_cards: number;
  red_cards: number;
}

export interface GsCompetitionLeaders {
  competition_id: string;
  sport: string;
  season: { year: number; label: string };
  category: GsLeaderCategory;
  data: GsLeaderRow[];
  updated_at: string | null;
}

export interface GsStandings {
  competition_id: string;
  /** Esporte da competição (ausente em respostas antigas = futebol). */
  sport?: string | undefined;
  season: { year: number; label: string };
  groups: {
    /** Nome do grupo no fornecedor ("Apertura - Group A", "annual"): chave, não texto para exibir. */
    name: string | null;
    /** Nome exibido no idioma pedido ("Apertura · Zona A", "Tabela anual", "Grupo A"). */
    display_name?: string | null;
    /** Papel da tabela pelo regulamento: `phase`, `annual`, `relegation_average`, `other` ou null. */
    table?: string | null | undefined;
    rows: GsStandingRow[];
  }[];
  updated_at: string | null;
}

/** Chaveamento do mata-mata (`/v1/competitions/{id}/seasons/{season}/bracket`, #829). */
export interface GsBracketPair {
  home: number | null;
  away: number | null;
}

export interface GsBracketTeam {
  id: string;
  name: string;
  short_name: string | null;
  logo: string | null;
}

export interface GsBracketTie {
  id: string;
  /** Mandante da ida (ou do jogo 1); null enquanto não definido. */
  home: GsBracketTeam | null;
  away: GsBracketTeam | null;
  format: 'single' | 'two_legs' | 'series';
  legs: {
    event_id: string;
    leg: number;
    starts_at: string;
    status: GsEventStatus;
    home_id: string | null;
    score: GsBracketPair;
    penalty: GsBracketPair | null;
  }[];
  aggregate: GsBracketPair | null;
  wins: GsBracketPair | null;
  penalties: GsBracketPair | null;
  winner_id: string | null;
  status: 'scheduled' | 'in_progress' | 'decided';
}

export interface GsBracketRound {
  stage_id: string;
  kind: string;
  name: string;
  ties: GsBracketTie[];
}

export interface GsBracket {
  competition_id: string;
  sport: string;
  season: { year: number; label: string };
  rounds: GsBracketRound[];
  updated_at: string | null;
}

/** Fases que o widget de chaveamento oferece como "a partir de", na ordem do torneio. */
export const BRACKET_PHASES = [
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
] as const;

/** Cor padrão de cada faixa; `null` = a cor primária do tema. */
export const DEFAULT_ZONE_COLORS: Record<StandingsZoneTone, string | null> = {
  direct: null,
  qualifying: '#38bdf8',
  second: '#f97316',
  third: '#22c55e',
  relegationPlayoff: '#eab308',
  relegation: '#ef4444',
};

/** Código da zona nas regras (`config/rules/*.yaml`, `zones[].id`) → faixa. */
const ZONE_TONE_BY_CODE: Record<string, StandingsZoneTone> = {
  libertadores: 'direct',
  libertadores_group_stage: 'direct',
  champions_league: 'direct',
  round_of_16: 'direct',
  round_of_32: 'direct',
  quarter_finals: 'direct',
  promotion: 'direct',
  playoffs: 'direct',
  liguilla: 'direct',
  quadrangulars: 'direct',
  libertadores_qualifying: 'qualifying',
  champions_league_qualifying: 'qualifying',
  knockout_playoff: 'qualifying',
  playoff: 'qualifying',
  play_in: 'qualifying',
  sudamericana: 'second',
  sudamericana_knockout_playoff: 'second',
  europa_league: 'second',
  europa_league_knockout_playoff: 'second',
  conference_league: 'third',
  relegation_playoff: 'relegationPlayoff',
  relegation: 'relegation',
  elimination: 'relegation',
};

/** Copa continental principal de cada confederação (e o Mundial de Clubes). */
const FIRST_CUP =
  /libertadores|\bchampions\b|club world cup|mundial de clubes|concacaf champions|afc champions league elite|ofc champions/;
/** Segunda copa: Sul-Americana, Europa League, Copa da Confederação da CAF, AFC Champions League Two… */
const SECOND_CUP =
  /sudamericana|sul-americana|europa league|uefa cup|confederation cup|afc cup|champions league two|leagues cup|concacaf league/;
/** Fase prévia / preliminar de uma copa (não a fase principal). */
const QUALIFYING =
  /qualif|prelim|clasificatoria|pre-?libertadores|pré-?libertadores|knockout round play|knockout play-?off|repechaje|repescagem|play[\s-]?in/;

/**
 * Faixa de uma zona, para qualquer campeonato. A tabela calculada traz o id da regra
 * (`libertadores_group_stage`); a do fornecedor traz texto livre, em geral no formato da api-sports:
 * "Promotion - Champions League (League phase: )", "Promotion - Copa Sudamericana (Group Stage: )",
 * "Promotion - Championship (Play Offs: )", "Relegation - 2. Bundesliga", "Bundesliga (Relegation: )",
 * "Liguilla", "Championship Round"… Ordem: queda, terceira e segunda copa, copa principal, acesso e
 * mata-mata da própria competição. Nada reconhecido → null (cor neutra).
 */
export function standingsZoneTone(description: string): StandingsZoneTone | null {
  const d = description.trim().toLowerCase();
  if (!d) return null;
  if (Object.hasOwn(ZONE_TONE_BY_CODE, d)) return ZONE_TONE_BY_CODE[d]!;
  if (/relegat|rebaix|descenso|descend|abstieg|retroced|eliminat|eliminad/.test(d)) {
    // "Relegation - Championship", "Descenso": cai; "Relegation Round", "Bundesliga (Relegation: )",
    // "Promotion - Relegation", "Relegation Play-off": ainda disputa
    const falls =
      /^(relegation|rebaixamento|rebaixado|descenso|descendido|eliminated|eliminado)\b/.test(d) &&
      !/play|round|ronda|liguilla|promotion|torneo|quadrangular|cuadrangular|repechaje/.test(d);
    return falls ? 'relegation' : 'relegationPlayoff';
  }
  if (/conference/.test(d)) return 'third';
  if (SECOND_CUP.test(d)) return 'second';
  if (FIRST_CUP.test(d)) return QUALIFYING.test(d) ? 'qualifying' : 'direct';
  if (QUALIFYING.test(d)) return 'qualifying';
  if (/^(promotion|ascenso|acesso|classifica|clasifica)/.test(d)) {
    // acesso pelo playoff ("Promotion - Championship (Play Offs: )") vs. mata-mata com fase dita
    // ("Promotion - Paulista (Play Offs: Quarter-finals)", que é vaga direta nas quartas)
    return /\(play ?-?offs?:\s*\)|playoff\)?$|play ?offs?\)?$/.test(d) ? 'qualifying' : 'direct';
  }
  if (
    /play ?-?offs?|liguilla|quadrangular|cuadrangular|championship round|championship group|final series|final round|next round|knockout|mata-mata|round of \d|1\/\d+-finals|quarter|semi-?final|octavos|cuartos|title|campe[aã]o|campeón/.test(
      d,
    )
  )
    return 'direct';
  return null;
}

/** `#rrggbb` ou, com transparência, `#rrggbbaa`. */
const ZONE_HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;

/** Cor CSS da faixa: a escolhida no Builder (`#rrggbb` ou `#rrggbbaa`), senão a padrão; zona desconhecida fica neutra. */
export function standingsZoneColor(
  tone: StandingsZoneTone | null,
  colors?: StandingsZoneColors | undefined,
): string {
  if (!tone) return 'var(--gs-muted-foreground)';
  const custom = colors?.[tone];
  if (custom && ZONE_HEX.test(custom)) return custom;
  return DEFAULT_ZONE_COLORS[tone] ?? 'var(--gs-primary)';
}

/**
 * Opções da tabela vindas de fora (banco, navegador, JSON do embed): só faixas conhecidas com `#rrggbb`/`#rrggbbaa`
 * (minúsculo) e `showLegend` booleano. Nada aproveitável → undefined.
 */
export function parseStandingsOptions(raw: unknown): StandingsOptions | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: StandingsOptions = {};
  if (typeof r.showLegend === 'boolean') out.showLegend = r.showLegend;
  if (r.zoneColors && typeof r.zoneColors === 'object') {
    const colors: StandingsZoneColors = {};
    for (const tone of STANDINGS_ZONE_TONES) {
      const value = (r.zoneColors as Record<string, unknown>)[tone];
      if (typeof value === 'string' && ZONE_HEX.test(value)) colors[tone] = value.toLowerCase();
    }
    if (Object.keys(colors).length) out.zoneColors = colors;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Opções da lista de jogos vindas de fora (banco, navegador, JSON do embed): só booleanos nas chaves
 * conhecidas e `limit` inteiro dentro dos limites. Nada aproveitável → undefined.
 */
export function parseLiveListOptions(raw: unknown): LiveListOptions | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: LiveListOptions = {};
  for (const key of ['groupByCompetition', 'autoRefresh', 'eventLinkNewTab', ...LIVE_LIST_FIELDS] as const)
    if (typeof r[key] === 'boolean') out[key] = r[key];
  const pick = <T extends string>(values: readonly T[], v: unknown) =>
    (values as readonly unknown[]).includes(v) ? (v as T) : undefined;
  const mode = pick(LIVE_LIST_MODES, r.mode) ?? (r.liveOnly === true ? 'live' : undefined);
  if (mode) out.mode = mode;
  const day = pick(LIVE_LIST_DAYS, r.day);
  if (day) out.day = day;
  const order = pick(LIVE_LIST_ORDERS, r.order);
  if (order) out.order = order;
  const teamName = pick(LIVE_LIST_TEAM_NAMES, r.teamName);
  if (teamName) out.teamName = teamName;
  if (
    typeof r.minRelevance === 'number' &&
    Number.isInteger(r.minRelevance) &&
    r.minRelevance >= 0 &&
    r.minRelevance <= 100
  )
    out.minRelevance = r.minRelevance;
  if (typeof r.country === 'string' && /^[A-Za-z]{2}$/.test(r.country)) out.country = r.country.toUpperCase();
  if (isEventLinkTemplate(r.eventLink)) out.eventLink = r.eventLink;
  if (
    typeof r.limit === 'number' &&
    Number.isInteger(r.limit) &&
    r.limit >= LIVE_LIST_LIMIT.min &&
    r.limit <= LIVE_LIST_LIMIT.max
  )
    out.limit = r.limit;
  return Object.keys(out).length ? out : undefined;
}

/**
 * Nome da zona na legenda, no idioma do widget sempre que dá: o código da regra pelo dicionário; texto do
 * fornecedor que só diz a queda ("Relegation - Serie B") vira "Rebaixamento"; "Promotion - X (Fase: )" vira
 * "X (Fase)", sem tirar o destino (um acesso ao Paulista não vira "Libertadores"). O resto fica como veio.
 */
export function standingsZoneLabel(description: string, labels: Record<string, string>): string {
  const text = description.trim();
  const lower = text.toLowerCase();
  const byCode = Object.hasOwn(labels, lower) ? labels[lower] : undefined;
  if (byCode) return byCode;
  const tone = standingsZoneTone(text);
  if (tone === 'relegation' && labels.relegation && /^(relegation|descenso)\b/.test(lower))
    return labels.relegation;
  if (tone === 'relegationPlayoff' && labels.relegation_playoff && /relegation/.test(lower))
    return labels.relegation_playoff;
  const promoted = /^promotion\s*-\s*(.+)$/i.exec(text);
  const core = (promoted ? promoted[1]! : text)
    .replace(/\(([^():]+):\s*\)/g, '($1)')
    .replace(/\s+/g, ' ')
    .trim();
  const words = core.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const BROADCAST_MEDIA = [
  'free_tv',
  'pay_tv',
  'streaming_svod',
  'streaming_free',
  'youtube',
  'official_app',
  'radio',
] as const;
export type GsBroadcastMedium = (typeof BROADCAST_MEDIA)[number];
export type GsAccessModel = 'free' | 'subscription' | 'ppv' | 'unknown';

export interface GsWatchOption {
  id: string;
  provider: string;
  /** Id da emissora na biblioteca (liga a opção aos canais do bloco `availability`). */
  provider_id?: string | null;
  channel: string | null;
  medium: GsBroadcastMedium;
  access_model: GsAccessModel;
  region: string | null;
  watch_url: string | null;
  logo: string | null;
  logo_dark: string | null;
}

export interface GsWatchToConfirm {
  provider: string;
  provider_id?: string | null;
  medium: GsBroadcastMedium;
  access_model: GsAccessModel;
  logo: string | null;
  logo_dark: string | null;
}

/** Canal ou streaming da biblioteca de emissoras (bloco `availability`). */
export interface GsAvailabilityLogo {
  id: string;
  name: string;
  logo: string | null;
  logo_dark: string | null;
}

export type GsPlanAccess = 'included' | 'addon';
export type GsPlatformKind = 'pay_tv_operator' | 'vmvpd' | 'telco_bundle' | 'streaming';

export interface GsPlatform {
  id: string;
  name: string;
  kind: GsPlatformKind;
  broadcaster_id: string | null;
  logo: string | null;
  logo_dark: string | null;
  /** Crédito do logo da Commons (null no acervo oficial); `text` pronto para exibir. */
  logo_credit?: { text: string; page_url: string; attribution_required: boolean } | null;
}

export interface GsAvailabilityPlan {
  id: string;
  name: string;
  access: GsPlanAccess;
  via_channels: (GsAvailabilityLogo & { access: GsPlanAccess })[];
  included_services: GsAvailabilityLogo[];
}

/** Complemento da plataforma (contratado à parte por qualquer plano), "a partir de" o menor preço. */
export interface GsPlatformAddon extends GsAvailabilityLogo {
  kind: 'service' | 'channel';
  channel: string | null;
  price_from: number | null;
  currency: string | null;
}

export interface GsPlatformAvailability {
  platform: GsPlatform;
  plans: GsAvailabilityPlan[];
  /** Ausente nas respostas antigas da API. */
  addons?: GsPlatformAddon[] | undefined;
}

/** Canal deste jogo por momento (antes, ao vivo, encerrado), com a melhor fonte. */
export interface GsMatchChannel {
  phase: 'pre' | 'live' | 'post';
  state: 'confirmed' | 'to_confirm' | 'not_confirmed';
  headline: string;
  hint: string | null;
  channels: {
    id: string;
    name: string;
    source: { publisher: string; url: string; kind: string } | null;
  }[];
}

/** Onde assistir agrupado: TV aberta, canais pagos e as plataformas ("disponível também em"). */
export interface GsAvailability {
  free_tv: GsAvailabilityLogo[];
  pay_tv_channels: GsAvailabilityLogo[];
  platforms: GsPlatformAvailability[];
  your_operator: GsPlatformAvailability | null;
  /** `to_confirm`: o canal do jogo não foi confirmado; os grupos são os dos detentores dos direitos. */
  channel_status?: 'confirmed' | 'to_confirm';
  /** Ausente nas respostas antigas da API. */
  match_channel?: GsMatchChannel | null;
}

export interface GsWhereToWatch {
  event_id: string;
  country: string;
  status: 'resolved' | 'unknown';
  message: string | null;
  options: GsWatchOption[];
  to_confirm: GsWatchToConfirm[];
  /** Ausente em respostas antigas (cópias em cache): o widget cai para a lista por mídia. */
  availability?: GsAvailability | null;
}

// ─── tema ────────────────────────────────────────────────────────────────────────────────────────

/** Header da chave publicável (a única credencial que vai para o navegador). */
export const PUBLISHABLE_KEY_HEADER = 'x-galaxie-publishable-key';

export const THEME_PRESET_IDS = ['dark', 'light', 'emerald', 'sunset'] as const;
export type ThemePresetId = (typeof THEME_PRESET_IDS)[number];

const SYSTEM_FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Presets do Builder: escuro e claro na linha da demo e duas marcas genéricas. */
export const DEFAULT_THEMES: Record<ThemePresetId, WidgetTheme> = {
  dark: {
    primary: '#7c6cff',
    background: '#0b0d12',
    surface: '#131722',
    foreground: '#f3f5fa',
    mutedForeground: '#8d95a8',
    border: '#252b39',
    radius: 12,
    fontFamily: SYSTEM_FONT,
    density: 'comfortable',
    mode: 'dark',
  },
  light: {
    primary: '#5b4bff',
    background: '#f6f7fb',
    surface: '#ffffff',
    foreground: '#10131a',
    mutedForeground: '#5f6779',
    border: '#e3e6ee',
    radius: 12,
    fontFamily: SYSTEM_FONT,
    density: 'comfortable',
    mode: 'light',
  },
  emerald: {
    primary: '#12b76a',
    background: '#06140e',
    surface: '#0c2219',
    foreground: '#eafbf2',
    mutedForeground: '#86a99a',
    border: '#1a3a2c',
    radius: 6,
    fontFamily: SYSTEM_FONT,
    density: 'compact',
    mode: 'dark',
  },
  sunset: {
    primary: '#f05a28',
    background: '#fff8f3',
    surface: '#ffffff',
    foreground: '#1f1410',
    mutedForeground: '#7a6258',
    border: '#f1e1d6',
    radius: 18,
    fontFamily: SYSTEM_FONT,
    density: 'comfortable',
    mode: 'light',
  },
};

export const THEME_PRESET_LABELS: Record<ThemePresetId, Record<WidgetLocale, string>> = {
  dark: { 'pt-BR': 'Escuro', es: 'Oscuro', en: 'Dark' },
  light: { 'pt-BR': 'Claro', es: 'Claro', en: 'Light' },
  emerald: { 'pt-BR': 'Marca esmeralda', es: 'Marca esmeralda', en: 'Emerald brand' },
  sunset: { 'pt-BR': 'Marca pôr do sol', es: 'Marca atardecer', en: 'Sunset brand' },
};

/** CSS variables do widget. As chaves são estáveis: o app da operadora pode sobrescrever qualquer uma. */
export type GsCssVars = Record<`--gs-${string}`, string>;

function parseHex(color: string): [number, number, number] | null {
  const hex = color.trim().replace(/^#/, '');
  const full =
    hex.length === 3 || hex.length === 4
      ? hex
          .slice(0, 3)
          .split('')
          .map((c) => c + c)
          .join('')
      : hex.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

/** Opacidade de um hex `#rgba`/`#rrggbbaa` (0–1); 1 para cor opaca ou outro formato. */
function hexAlpha(color: string): number {
  const hex = color.trim().replace(/^#/, '');
  const a = hex.length === 4 ? hex[3]! + hex[3]! : hex.length === 8 ? hex.slice(6) : null;
  if (!a || !/^[0-9a-f]{2}$/i.test(a)) return 1;
  return parseInt(a, 16) / 255;
}

/**
 * Texto legível sobre a cor primária (luminância relativa WCAG). Primária com transparência
 * (`#rrggbbaa`) é misturada sobre `backdrop` (o fundo do widget) antes do cálculo.
 */
export function readableOn(color: string, backdrop?: string): string {
  const rgb = parseHex(color);
  if (!rgb) return '#ffffff';
  const alpha = hexAlpha(color);
  const under = alpha < 1 && backdrop ? parseHex(backdrop) : null;
  const mixed = under
    ? (rgb.map((v, i) => v * alpha + under[i]! * (1 - alpha)) as [number, number, number])
    : rgb;
  const [r, g, b] = mixed.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? '#0b0d12' : '#ffffff';
}

/** Converte o tema salvo nas CSS variables `--gs-*` que os widgets usam. */
export function themeToCssVars(theme: WidgetTheme): GsCssVars {
  const compact = theme.density === 'compact';
  const radius = Number.isFinite(theme.radius) ? Math.min(Math.max(theme.radius, 0), 32) : 12;
  return {
    '--gs-primary': theme.primary,
    '--gs-primary-foreground': readableOn(theme.primary, theme.background),
    '--gs-background': theme.background,
    '--gs-surface': theme.surface,
    '--gs-foreground': theme.foreground,
    '--gs-muted-foreground': theme.mutedForeground,
    '--gs-border': theme.border,
    '--gs-live': theme.mode === 'dark' ? '#ff6b6b' : '#e5383b',
    '--gs-radius': `${radius}px`,
    '--gs-font-family': theme.fontFamily,
    '--gs-font-size': compact ? '13px' : '14px',
    '--gs-gap': compact ? '8px' : '12px',
    '--gs-pad': compact ? '12px' : '16px',
    '--gs-crest': compact ? '32px' : '44px',
  };
}

/** Folha de estilo dos widgets: só classes `gs-*` e as variables do tema, sem Tailwind. */
export const WIDGET_CSS = `
.gs-root{font-family:var(--gs-font-family);font-size:var(--gs-font-size);line-height:1.4;color:var(--gs-foreground);-webkit-font-smoothing:antialiased}
.gs-root[data-gs-mode=dark]{color-scheme:dark}.gs-root[data-gs-mode=light]{color-scheme:light}
.gs-root *,.gs-root *::before,.gs-root *::after{box-sizing:border-box}
.gs-card{display:flex;flex-direction:column;gap:var(--gs-gap);padding:var(--gs-pad);background:var(--gs-surface);border:1px solid var(--gs-border);border-radius:var(--gs-radius);min-width:0}
.gs-header{display:flex;align-items:center;gap:8px;min-width:0;color:var(--gs-muted-foreground);font-size:.85em}
.gs-title{margin:0;font-size:1em;font-weight:700;color:var(--gs-foreground)}
.gs-spacer{flex:1}
.gs-grow{flex:1;min-width:0}
.gs-muted{color:var(--gs-muted-foreground)}
.gs-small{font-size:.8em}
.gs-truncate{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gs-crest{flex:none;width:var(--gs-crest);height:var(--gs-crest);object-fit:contain}
.gs-crest[data-size=sm]{width:20px;height:20px}
.gs-crest[data-size=xs]{width:16px;height:16px}
.gs-crest[data-size=lg]{width:56px;height:56px;border-radius:calc(var(--gs-radius)/1.5)}
.gs-profile{display:flex;align-items:center;gap:var(--gs-gap)}
.gs-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(64px,1fr));gap:var(--gs-gap)}
.gs-list>[data-next],.gs-list>[data-live]{box-shadow:inset 3px 0 0 var(--gs-primary)}
.gs-initials{display:inline-grid;place-items:center;border-radius:calc(var(--gs-radius)/2);background:color-mix(in srgb,var(--gs-foreground) 9%,transparent);color:var(--gs-muted-foreground);font-weight:700;font-size:.8em;letter-spacing:.02em}
.gs-initials[data-size=sm],.gs-initials[data-size=xs]{font-size:8px}
.gs-match{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:var(--gs-gap)}
.gs-team{display:flex;flex-direction:column;align-items:center;gap:6px;min-width:0;text-align:center;font-weight:600}
.gs-team[data-lost]{color:var(--gs-muted-foreground)}
.gs-team[data-won]{font-weight:800}
.gs-score{display:flex;flex-direction:column;align-items:center;gap:2px;font-size:1.9em;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}
.gs-score[data-live]{color:var(--gs-primary)}
.gs-score small{font-size:.38em;font-weight:600;color:var(--gs-muted-foreground)}
.gs-versus{font-size:1.1em;font-weight:700;color:var(--gs-muted-foreground)}
.gs-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;color:var(--gs-muted-foreground);font-size:.85em}
.gs-badge{display:inline-flex;align-items:center;gap:6px;padding:2px 9px;border:1px solid var(--gs-border);border-radius:999px;font-size:.78em;font-weight:700;white-space:nowrap;color:var(--gs-muted-foreground)}
.gs-badge[data-tone=live]{color:var(--gs-live);border-color:color-mix(in srgb,var(--gs-live) 45%,transparent);background:color-mix(in srgb,var(--gs-live) 12%,transparent)}
.gs-badge[data-tone=done]{color:var(--gs-foreground);background:color-mix(in srgb,var(--gs-foreground) 7%,transparent);border-color:transparent}
.gs-badge[data-tone=warn]{color:#d97706;border-color:color-mix(in srgb,#d97706 45%,transparent)}
.gs-badge[data-tone=primary]{color:var(--gs-primary-foreground);background:var(--gs-primary);border-color:transparent}
.gs-dot{width:6px;height:6px;border-radius:50%;background:currentColor;animation:gs-pulse 1.4s ease-in-out infinite}
@keyframes gs-pulse{50%{opacity:.3}}
.gs-card[data-gs-widget=score_ticker]{padding:0;background:none;border:0;container-type:inline-size}
.gs-ticker{display:flex;align-items:stretch;min-width:0;overflow:hidden;background:var(--gs-surface);border:1px solid var(--gs-border);border-radius:var(--gs-radius);font-size:22px;line-height:1.25;font-weight:600}
@supports (font-size:clamp(16px,2cqw,44px)){.gs-ticker{font-size:calc(var(--gs-scale,1)*clamp(16px,2cqw,44px))}}
.gs-ticker[data-transparent]{background:transparent;border-color:transparent;text-shadow:0 1px 3px rgba(0,0,0,.55)}
.gs-ticker-label{flex:none;display:flex;align-items:center;gap:.4em;padding:.45em .7em;background:var(--gs-primary);color:var(--gs-primary-foreground);font-weight:800;letter-spacing:.03em;text-transform:uppercase;white-space:nowrap;text-shadow:none}
.gs-ticker-label .gs-dot{width:.4em;height:.4em}
.gs-ticker-viewport{flex:1;min-width:0;overflow:hidden;display:flex;align-items:center}
.gs-ticker-empty{flex:1;display:flex;align-items:center;padding:.45em .7em;color:var(--gs-muted-foreground)}
.gs-ticker-track{display:flex;width:max-content}
.gs-ticker-track[data-running]{animation:gs-ticker linear infinite;will-change:transform}
.gs-ticker-viewport:hover .gs-ticker-track,.gs-ticker-viewport:focus-within .gs-ticker-track{animation-play-state:paused}
.gs-ticker-viewport:focus-visible{outline:2px solid var(--gs-primary);outline-offset:-2px}
@keyframes gs-ticker{to{transform:translateX(-50%)}}
@media (prefers-reduced-motion:reduce){.gs-ticker-track[data-running]{animation:none}.gs-ticker-viewport{overflow-x:auto}}
.gs-ticker-items{display:flex;align-items:center;gap:1.2em;margin:0;padding:.45em 1.2em .45em .7em;list-style:none;white-space:nowrap}
.gs-ticker-group{display:flex;align-items:center;gap:1.2em}
.gs-ticker-competition{display:inline-flex;align-items:center;gap:.35em;padding:.1em .45em;border-radius:calc(var(--gs-radius)/2);background:color-mix(in srgb,var(--gs-foreground) 10%,transparent);color:var(--gs-muted-foreground);font-size:.72em;font-weight:800;letter-spacing:.05em;text-transform:uppercase}
.gs-ticker-item{display:inline-flex;align-items:center;gap:.45em;font-variant-numeric:tabular-nums}
.gs-ticker-status{font-size:.72em;font-weight:800;color:var(--gs-muted-foreground)}
.gs-ticker-item[data-live] .gs-ticker-status{color:var(--gs-live)}
.gs-ticker-team{display:inline-flex;align-items:center;gap:.35em}
.gs-ticker-team[data-lost]{color:var(--gs-muted-foreground)}
.gs-ticker-score{font-weight:800}
.gs-ticker-item[data-live] .gs-ticker-score{color:var(--gs-primary)}
.gs-ticker .gs-crest{width:1.15em;height:1.15em}
.gs-ticker .gs-initials{font-size:.45em;width:2.55em;height:2.55em}
.gs-list{display:flex;flex-direction:column;margin:0;padding:0;list-style:none}
.gs-group{display:flex;flex-direction:column;gap:4px}
.gs-group+.gs-group{margin-top:var(--gs-gap)}
.gs-group-title{display:flex;align-items:center;gap:6px;font-size:.72em;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--gs-muted-foreground)}
.gs-row{display:grid;grid-template-columns:64px 1fr;align-items:center;gap:var(--gs-gap);padding:calc(var(--gs-gap)*.7) 0;border-top:1px solid var(--gs-border)}
.gs-row:first-child{border-top:0}
.gs-row-status{display:flex;justify-content:flex-start;font-size:.85em;font-variant-numeric:tabular-nums;color:var(--gs-muted-foreground)}
.gs-row-teams{display:flex;flex-direction:column;gap:4px;min-width:0}
.gs-line{display:flex;align-items:center;gap:8px;min-width:0}
.gs-line[data-lost]{color:var(--gs-muted-foreground)}
.gs-row-meta{display:flex;flex-wrap:wrap;align-items:center;gap:2px 6px;min-width:0;font-size:.75em;color:var(--gs-muted-foreground)}
.gs-row-meta>span{display:inline-flex;align-items:center;gap:4px;min-width:0}
.gs-row-meta>span+span::before{content:'·';margin-right:2px}
.gs-row-tags{display:flex;flex-wrap:wrap;gap:4px}
.gs-row-tag{padding:1px 7px;border:1px solid var(--gs-border);border-radius:999px;font-size:.72em;color:var(--gs-muted-foreground)}
.gs-row-tag[data-tag=derby]{border-color:color-mix(in srgb,var(--gs-primary) 60%,transparent);color:var(--gs-primary);font-weight:700}
.gs-row[data-linked]{display:block;padding:0}
.gs-row-link{display:grid;grid-template-columns:64px 1fr;align-items:center;gap:var(--gs-gap);padding:calc(var(--gs-gap)*.7) 0;color:inherit;text-decoration:none;border-radius:calc(var(--gs-radius)/2);transition:background-color .15s}
.gs-row-link:hover,.gs-row-link:focus-visible{background:color-mix(in srgb,var(--gs-foreground) 5%,transparent)}
.gs-line-pen{font-size:.75em;font-weight:600;color:var(--gs-muted-foreground);margin-left:3px}
.gs-line-score{margin-left:auto;font-weight:700;font-variant-numeric:tabular-nums}
.gs-scroll{overflow-x:auto;margin:0 calc(var(--gs-pad)*-1);padding:0 var(--gs-pad)}
.gs-table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
.gs-table th{padding:4px 6px;border-bottom:1px solid var(--gs-border);font-size:.75em;font-weight:700;text-align:right;color:var(--gs-muted-foreground)}
.gs-table td{padding:calc(var(--gs-gap)*.55) 6px;border-bottom:1px solid var(--gs-border);text-align:right}
.gs-table tr:last-child td{border-bottom:0}
.gs-table .gs-left{text-align:left}
.gs-table .gs-strong{font-weight:800}
.gs-linescore th[scope=row]{font-size:1em;font-weight:600;color:var(--gs-foreground);border-bottom:1px solid var(--gs-border);max-width:9em}
.gs-linescore tr:last-child th{border-bottom:0}
.gs-rank{width:28px;color:var(--gs-muted-foreground)}
.gs-rank[data-zone]{box-shadow:inset 3px 0 0 var(--gs-zone,var(--gs-primary));color:var(--gs-foreground);font-weight:700}
.gs-legend{display:flex;flex-wrap:wrap;gap:4px 14px;margin:0;padding:0;list-style:none;font-size:.75em;color:var(--gs-muted-foreground)}
.gs-legend li{display:flex;align-items:center;gap:6px}
.gs-legend-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--gs-zone,var(--gs-primary))}
.gs-form{display:inline-flex;gap:2px}
.gs-form span{width:6px;height:6px;border-radius:50%;background:var(--gs-muted-foreground)}
.gs-form span[data-r=W]{background:#16a34a}.gs-form span[data-r=L]{background:var(--gs-live)}
.gs-watch{display:flex;align-items:center;gap:var(--gs-gap);padding:calc(var(--gs-gap)*.7) 0;border-top:1px solid var(--gs-border)}
.gs-watch:first-child{border-top:0}
.gs-logo{flex:none;width:72px;height:32px;object-fit:contain;object-position:left center}
.gs-logo.gs-initials{width:72px;height:32px}
.gs-watch-text{display:flex;flex-direction:column;min-width:0;flex:1}
.gs-link{display:inline-flex;align-items:center;padding:4px 12px;border-radius:999px;background:var(--gs-primary);color:var(--gs-primary-foreground);font-size:.82em;font-weight:700;text-decoration:none;white-space:nowrap}
.gs-link:hover{filter:brightness(1.08)}
.gs-link:focus-visible,.gs-button:focus-visible{outline:2px solid var(--gs-primary);outline-offset:2px}
.gs-state{display:flex;flex-direction:column;align-items:center;gap:10px;padding:calc(var(--gs-pad)*1.2) var(--gs-pad);text-align:center;color:var(--gs-muted-foreground)}
.gs-button{appearance:none;padding:4px 14px;border:1px solid var(--gs-border);border-radius:999px;background:transparent;color:var(--gs-foreground);font:inherit;font-size:.85em;font-weight:600;cursor:pointer}
.gs-button:hover{border-color:var(--gs-primary)}
.gs-skeleton{display:block;height:12px;border-radius:999px;background:linear-gradient(90deg,color-mix(in srgb,var(--gs-foreground) 6%,transparent) 0%,color-mix(in srgb,var(--gs-foreground) 13%,transparent) 50%,color-mix(in srgb,var(--gs-foreground) 6%,transparent) 100%);background-size:200% 100%;animation:gs-shimmer 1.3s linear infinite}
@keyframes gs-shimmer{to{background-position:-200% 0}}
@media (prefers-reduced-motion:reduce){.gs-dot,.gs-skeleton{animation:none}}
.gs-tiles{display:flex;flex-wrap:wrap;gap:8px;margin:0;padding:0;list-style:none}
.gs-tile{display:flex;flex-direction:column;align-items:center;gap:6px;width:96px;padding:8px;border:1px solid var(--gs-border);border-radius:calc(var(--gs-radius)*.75);text-align:center;font-size:.8em;font-weight:600;line-height:1.2;color:var(--gs-foreground);text-decoration:none}
.gs-tile[data-to-confirm]{border-style:dashed}
a.gs-tile:hover{border-color:var(--gs-primary)}
.gs-tile .gs-logo{width:72px;height:32px;object-position:center}
.gs-cards{display:flex;flex-direction:column;gap:8px}
.gs-platform{display:flex;flex-direction:column;gap:8px;padding:calc(var(--gs-pad)*.75);border:1px solid var(--gs-border);border-radius:calc(var(--gs-radius)*.75);min-width:0}
.gs-platform[data-mine]{border-color:color-mix(in srgb,var(--gs-primary) 55%,transparent);background:color-mix(in srgb,var(--gs-primary) 7%,transparent)}
.gs-platform-head{display:flex;flex-wrap:wrap;align-items:center;gap:var(--gs-gap);min-width:0}
.gs-platform-head .gs-watch-text{min-width:8em}
.gs-platform-name{overflow-wrap:break-word;line-height:1.2}
.gs-plan{display:flex;flex-direction:column;gap:6px;padding-top:8px;border-top:1px solid var(--gs-border)}
.gs-plan-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-weight:600}
.gs-pill{display:inline-flex;padding:1px 8px;border-radius:999px;font-size:.72em;font-weight:700;color:#15803d;background:color-mix(in srgb,#16a34a 14%,transparent)}
.gs-pill[data-access=addon]{color:#b45309;background:color-mix(in srgb,#d97706 15%,transparent)}
.gs-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none}
.gs-chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:3px 8px 3px 4px;border:1px solid var(--gs-border);border-radius:calc(var(--gs-radius)/2);font-size:.8em}
.gs-chip .gs-logo,.gs-chip .gs-logo.gs-initials{width:36px;height:20px;font-size:8px}
.gs-notice{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border:1px dashed var(--gs-border);border-radius:calc(var(--gs-radius)*.75);background:color-mix(in srgb,var(--gs-foreground) 4%,transparent)}
.gs-notice strong{font-size:.9em}
.gs-credit{font-size:.68em;color:var(--gs-muted-foreground);text-decoration:none}
.gs-credit:hover{text-decoration:underline}
.gs-sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);border:0}
.gs-prose{margin:0;line-height:1.55;overflow-wrap:break-word}
.gs-seg{display:inline-flex;gap:2px;padding:2px;border:1px solid var(--gs-border);border-radius:999px}
.gs-seg button{appearance:none;padding:2px 10px;border:0;border-radius:999px;background:transparent;color:var(--gs-muted-foreground);font:inherit;font-size:.78em;font-weight:700;cursor:pointer}
.gs-seg button[aria-pressed=true]{background:var(--gs-primary);color:var(--gs-primary-foreground)}
.gs-seg button:focus-visible,.gs-thumb:focus-visible{outline:2px solid var(--gs-primary);outline-offset:2px}
.gs-sides{display:flex;flex-wrap:wrap;gap:var(--gs-gap)}
.gs-side{display:flex;flex-direction:column;gap:8px;flex:1 1 12em;min-width:0;padding:calc(var(--gs-pad)*.75);border:1px solid var(--gs-border);border-radius:calc(var(--gs-radius)*.75)}
.gs-side-head{display:flex;align-items:center;gap:8px;min-width:0;font-weight:700}
.gs-tag{display:inline-flex;padding:2px 8px;border-radius:999px;font-size:.75em;font-weight:700;color:var(--gs-primary);background:color-mix(in srgb,var(--gs-primary) 13%,transparent)}
.gs-bullets{display:flex;flex-direction:column;gap:4px;margin:0;padding-left:1.1em}
.gs-cheer{margin:0;padding-left:10px;border-left:3px solid var(--gs-primary);font-style:italic;font-weight:600}
.gs-videos{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:var(--gs-gap);margin:0;padding:0;list-style:none}
.gs-video{display:flex;flex-direction:column;gap:6px;min-width:0}
.gs-thumb{position:relative;display:block;width:100%;aspect-ratio:16/9;padding:0;border:0;border-radius:calc(var(--gs-radius)*.6);overflow:hidden;background:color-mix(in srgb,var(--gs-foreground) 8%,transparent);cursor:pointer}
.gs-thumb img{display:block;width:100%;height:100%;object-fit:cover}
.gs-thumb-badge{position:absolute;right:6px;bottom:6px;padding:1px 6px;border-radius:4px;background:rgba(0,0,0,.75);color:#fff;font-size:.72em;font-weight:700}
.gs-thumb-type{position:absolute;left:6px;top:6px;padding:1px 6px;border-radius:4px;background:var(--gs-primary);color:var(--gs-primary-foreground);font-size:.68em;font-weight:700}
.gs-clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-weight:600;font-size:.85em;line-height:1.3}
.gs-player{display:block;width:100%;min-width:200px;min-height:200px;aspect-ratio:16/9;border:0;border-radius:calc(var(--gs-radius)*.6);background:#000}
.gs-player[data-vertical]{max-width:320px;aspect-ratio:9/16;margin:0 auto}
.gs-h2h{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:var(--gs-gap);text-align:center}
.gs-h2h[data-no-draws]{grid-template-columns:1fr 1fr}
.gs-stat{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0}
.gs-stat strong{font-size:1.6em;font-weight:800;line-height:1;font-variant-numeric:tabular-nums}
.gs-bar{display:flex;height:8px;border-radius:999px;overflow:hidden;background:color-mix(in srgb,var(--gs-foreground) 8%,transparent)}
.gs-bar span{display:block;height:100%}
.gs-bar [data-part=home]{background:var(--gs-primary)}.gs-bar [data-part=draw]{background:var(--gs-muted-foreground)}.gs-bar [data-part=away]{background:color-mix(in srgb,var(--gs-foreground) 40%,transparent)}
.gs-fixture{display:flex;align-items:center;gap:var(--gs-gap);padding:calc(var(--gs-gap)*.7) 0;border-top:1px solid var(--gs-border);min-width:0}
.gs-fixture:first-child{border-top:0}
.gs-meeting{display:flex;flex:1;align-items:center;justify-content:center;gap:6px;min-width:0}
.gs-meeting strong{flex:none;font-variant-numeric:tabular-nums}
.gs-meeting [data-lost]{color:var(--gs-muted-foreground)}
.gs-meeting [data-won]{font-weight:800}
.gs-bout{display:flex;flex-direction:column;gap:2px;padding:calc(var(--gs-gap)*.5) 0;border-bottom:1px solid var(--gs-border)}
.gs-bout:last-child{border-bottom:0}
.gs-bout>.gs-meta{text-align:center}
.gs-fixture-date{flex:none;width:6.5em;font-size:.8em;color:var(--gs-muted-foreground);font-variant-numeric:tabular-nums}
.gs-result{display:inline-grid;place-items:center;flex:none;min-width:22px;height:22px;padding:0 4px;border-radius:6px;font-size:.75em;font-weight:800;color:#fff;background:var(--gs-muted-foreground)}
.gs-result[data-r=W]{background:#16a34a}.gs-result[data-r=L]{background:var(--gs-live)}
.gs-extras{display:flex;flex-direction:column;gap:6px;font-size:.85em}
.gs-incidents{display:grid;grid-template-columns:1fr 1fr;gap:2px 12px;margin:0;padding:0;list-style:none;font-size:.85em}
.gs-incidents li{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gs-incidents [data-side=away]{grid-column:2;text-align:right}.gs-incidents [data-side=home]{grid-column:1}
.gs-card-red{display:inline-block;width:8px;height:11px;margin-right:4px;border-radius:2px;background:#dc2626;vertical-align:-1px}
.gs-card-yellow{display:inline-block;width:8px;height:11px;border-radius:2px;background:#facc15;vertical-align:-1px}
.gs-leader-team{display:flex;align-items:center;gap:4px;font-size:.85em;opacity:.75;min-width:0}
.gs-tl{display:flex;flex-direction:column;margin:0;padding:0;list-style:none}
.gs-tl-item{display:grid;grid-template-columns:3.2em 22px 1fr auto;align-items:start;gap:8px;padding:calc(var(--gs-gap)*.6) 0;border-top:1px solid var(--gs-border)}
.gs-tl-item:first-child,.gs-tl-marker+.gs-tl-item{border-top:0}
.gs-tl-item{padding-left:6px}
.gs-tl-item[data-key]{box-shadow:inset 3px 0 0 var(--gs-primary)}
.gs-tl-min{padding-top:2px;font-size:.85em;font-weight:700;font-variant-numeric:tabular-nums;color:var(--gs-muted-foreground);text-align:right}
.gs-tl-icon{display:inline-grid;place-items:center;width:22px;height:22px;border:1px solid var(--gs-border);border-radius:50%;font-size:.7em;font-weight:800;line-height:1;color:var(--gs-muted-foreground)}
.gs-tl-icon[data-icon=goal]{border-color:color-mix(in srgb,#16a34a 55%,transparent);color:#16a34a}
.gs-tl-icon[data-icon=goal]::before{content:'';width:8px;height:8px;border-radius:50%;background:currentColor}
.gs-tl-icon[data-icon=own_goal]{border-color:color-mix(in srgb,#d97706 55%,transparent);color:#d97706}
.gs-tl-icon[data-icon=own_goal]::before{content:'';width:8px;height:8px;border-radius:50%;background:currentColor}
.gs-tl-icon[data-icon=var]{font-size:.5em;letter-spacing:-.02em}
.gs-tl-icon[data-icon=miss]{border-color:color-mix(in srgb,var(--gs-live) 55%,transparent);color:var(--gs-live)}
.gs-tl-icon[data-icon=yellow]::before,.gs-tl-icon[data-icon=red]::before,.gs-tl-icon[data-icon=second_yellow]::before{content:'';width:8px;height:11px;border-radius:2px;background:#eab308}
.gs-tl-icon[data-icon=red]::before{background:#dc2626}
.gs-tl-icon[data-icon=second_yellow]::before{background:linear-gradient(135deg,#eab308 50%,#dc2626 50%)}
.gs-tl-body{display:flex;flex-direction:column;gap:2px;min-width:0}
.gs-tl-head{display:flex;align-items:center;gap:6px;min-width:0;font-size:.75em;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:var(--gs-muted-foreground)}
.gs-tl-who{font-weight:600;overflow-wrap:anywhere}
.gs-tl-score{padding-top:2px;font-weight:800;font-variant-numeric:tabular-nums}
.gs-tl-marker{display:flex;align-items:center;gap:8px;padding:6px 0;font-size:.72em;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--gs-muted-foreground)}
.gs-tl-marker::before,.gs-tl-marker::after{content:'';flex:1;height:1px;background:var(--gs-border)}
.gs-tl-match{display:flex;align-items:center;gap:8px;min-width:0;font-weight:700}
.gs-tl-match .gs-tl-score{padding:0 2px}
.gs-statrow{display:grid;grid-template-columns:3em 1fr 3em;align-items:center;gap:8px;font-size:.85em;font-variant-numeric:tabular-nums}
.gs-statrow>span:first-child{text-align:left}.gs-statrow>span:last-child{text-align:right}
.gs-statrow>span:nth-child(2){text-align:center;color:var(--gs-muted-foreground)}
.gs-form{display:inline-flex;gap:2px}
.gs-form .gs-result{min-width:16px;height:16px;font-size:.65em}
.gs-highlight td{background:color-mix(in srgb,var(--gs-primary) 12%,transparent)}
.gs-flag{font-size:1.1em;line-height:1}
.gs-medal{display:inline-grid;place-items:center;width:1.4em;height:1.4em;border-radius:999px;font-size:.75em;font-weight:800;color:#1a1a1a}
.gs-medal[data-medal=G]{background:#e6c24a}
.gs-medal[data-medal=S]{background:#c4c8cf}
.gs-medal[data-medal=B]{background:#cf8a52}
.gs-meta{color:var(--gs-muted-foreground);font-size:.8em}
.gs-shirt{flex:none;width:1.6em;text-align:right;font-size:.8em;font-weight:700;color:var(--gs-muted-foreground);font-variant-numeric:tabular-nums}
.gs-crest.gs-photo{border-radius:999px;object-fit:cover}
[data-gs-widget=team_squad] .gs-strong{font-weight:700}
[data-gs-widget=match_prediction] .gs-strong{font-weight:700;margin:0}
.gs-odds-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(5.5em,1fr));gap:6px}
.gs-odd{display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 4px;border:1px solid var(--gs-border);border-radius:calc(var(--gs-radius)*.6);min-width:0;text-align:center}
.gs-odd strong{font-size:1.15em;font-variant-numeric:tabular-nums}
.gs-odd .gs-truncate{max-width:100%}
[data-gs-widget=match_odds] .gs-odds-notice{margin:0;font-size:.8em;color:var(--gs-muted-foreground);border-top:1px solid var(--gs-border);padding-top:6px}
.gs-prediction-odds{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--gs-gap);text-align:center}
.gs-prediction-odds[data-no-draws]{grid-template-columns:repeat(2,1fr)}
.gs-prediction-odds strong{font-size:1.4em;font-variant-numeric:tabular-nums}
.gs-compare{display:grid;grid-template-columns:2.5em 1fr 2.5em;align-items:center;gap:6px;font-size:.85em;font-variant-numeric:tabular-nums}
.gs-compare>span:last-child{text-align:right}
.gs-compare-label{grid-column:1/-1;color:var(--gs-muted-foreground);font-size:.9em}
.gs-button[data-gs-calendar=compact]{flex:none;padding:2px 8px;font-size:.72em}
.gs-countdown{display:flex;flex-direction:column;align-items:center;gap:calc(var(--gs-scale,1)*6px)}
.gs-countdown-units{display:flex;justify-content:center;gap:calc(var(--gs-scale,1)*6px)}
.gs-countdown-unit{font-size:calc(var(--gs-scale,1)*1em);display:flex;flex-direction:column;align-items:center;min-width:3.2em;padding:calc(var(--gs-scale,1)*6px) calc(var(--gs-scale,1)*4px);border:1px solid var(--gs-border);border-radius:calc(var(--gs-radius)/2);background:var(--gs-background)}
.gs-countdown-unit strong{font-size:1.6em;font-weight:800;line-height:1.1;font-variant-numeric:tabular-nums}
.gs-countdown-unit small{font-size:.7em;color:var(--gs-muted-foreground)}
.gs-minutes{display:grid;grid-template-columns:auto 1fr 1fr;align-items:center;gap:4px 8px;font-size:.8em;font-variant-numeric:tabular-nums}
.gs-minutes>.gs-meta{white-space:nowrap}
.gs-mbar{display:flex;align-items:center;gap:4px;min-width:0}
.gs-mbar>span:first-child{display:block;height:8px;min-width:2px;border-radius:999px;background:var(--gs-primary)}
.gs-mbar[data-side=against]>span:first-child{background:color-mix(in srgb,var(--gs-foreground) 40%,transparent)}
.gs-mbar[data-side=yellow]>span:first-child{background:#eab308}.gs-mbar[data-side=red]>span:first-child{background:#dc2626}
.gs-mbar[data-zero]>span:first-child{opacity:.25}
.gs-kv{display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-top:1px solid var(--gs-border);font-size:.85em}
.gs-kv:first-child{border-top:0}.gs-kv>strong{font-variant-numeric:tabular-nums;white-space:nowrap}
.gs-transfer-dir{display:inline-grid;place-items:center;flex:none;width:22px;height:22px;border-radius:6px;font-size:.8em;font-weight:800;color:#fff;background:#16a34a}
.gs-transfer-dir[data-dir=out]{background:var(--gs-live)}
.gs-bracket{display:flex;align-items:stretch;gap:10px;overflow-x:auto;scroll-snap-type:x proximity;margin:0 calc(var(--gs-pad)*-1);padding:0 var(--gs-pad) 4px;-webkit-overflow-scrolling:touch}
.gs-bracket-round{display:flex;flex-direction:column;gap:6px;flex:0 0 min(210px,82%);min-width:0;scroll-snap-align:start}
.gs-bracket-ties{display:flex;flex-direction:column;justify-content:space-around;gap:8px;flex:1;margin:0;padding:0;list-style:none}
.gs-tie{display:flex;flex-direction:column;gap:3px;padding:6px 8px;border:1px solid var(--gs-border);border-radius:calc(var(--gs-radius)*.6);background:var(--gs-background);min-width:0}
.gs-tie[data-highlight]{border-color:color-mix(in srgb,var(--gs-primary) 60%,transparent);box-shadow:inset 3px 0 0 var(--gs-primary)}
.gs-tie[data-live]{border-color:color-mix(in srgb,var(--gs-live) 55%,transparent)}
.gs-tie-line{display:flex;align-items:center;gap:6px;min-width:0;font-size:.88em;font-weight:600}
.gs-tie-line[data-lost]{color:var(--gs-muted-foreground);font-weight:500}
.gs-tie-line[data-won]{font-weight:800}
.gs-tie-score{display:flex;align-items:baseline;gap:6px;margin-left:auto;flex:none;font-variant-numeric:tabular-nums}
.gs-tie-score small{font-size:.78em;font-weight:500;color:var(--gs-muted-foreground)}
.gs-tie-score strong{min-width:1.2em;text-align:right}
.gs-tie-meta{display:flex;flex-wrap:wrap;gap:2px 8px;font-size:.72em;color:var(--gs-muted-foreground);font-variant-numeric:tabular-nums}
.gs-bracket-list{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}
.gs-seg[data-gs-rounds]{max-width:100%;overflow-x:auto;border-radius:calc(var(--gs-radius)*.75)}
.gs-seg[data-gs-rounds] button{white-space:nowrap}
`;

// ─── textos ──────────────────────────────────────────────────────────────────────────────────────

export interface WidgetTexts {
  status: Record<GsEventStatus, string>;
  loading: string;
  error: string;
  notFound: string;
  missingKey: string;
  invalidKey: string;
  forbidden: string;
  retry: string;
  versus: string;
  penalties: string;
  emptyLive: string;
  emptyDay: string;
  emptyStandings: string;
  emptyWatch: string;
  liveNow: string;
  todayGames: string;
  games: string;
  results: string;
  tomorrowGames: string;
  yesterdayGames: string;
  upcomingGames: string;
  todayResults: string;
  yesterdayResults: string;
  referee: string;
  derby: string;
  standings: string;
  whereToWatch: string;
  toConfirm: string;
  watch: string;
  updated: string;
  columns: {
    team: string;
    points: string;
    played: string;
    won: string;
    drawn: string;
    lost: string;
    goalDiff: string;
  };
  /** Legenda da tabela pelo código da regra (`config/rules`); código desconhecido vira texto. */
  zones: Record<string, string>;
  media: Record<GsBroadcastMedium, string>;
  access: Record<GsAccessModel, string>;
  /** Onde assistir agrupado (bloco `availability`). */
  watchGroups: {
    freeTv: string;
    payTv: string;
    alsoOn: string;
    included: string;
    addon: string;
    includedServices: string;
    /** "Disponível como complemento" (contratado à parte). */
    addonsAvailable: string;
    /** "a partir de {price}". */
    priceFrom: string;
    /** Complemento de preço 0 (grátis). */
    free: string;
    yourOperator: string;
    notInYourOperator: string;
    toConfirmTitle: string;
    toConfirmHint: string;
    /** Sem a frase "sai mais perto da partida" (ao vivo). */
    toConfirmLiveHint: string;
    notConfirmedTitle: string;
    /** "Passa em {channels}", "Ao vivo em {channels}", "Transmitido por {channels}". */
    confirmedPre: string;
    confirmedLive: string;
    confirmedPost: string;
    /** "Fonte: {publisher}". */
    confirmedSource: string;
    kind: Record<GsPlatformKind, string>;
  };
  /** Contexto de IA: cenário antes do jogo e resumo depois. */
  context: { title: string; scenario: string; recap: string; empty: string; aiNote: string };
  /** O que está em jogo: stakes, tags do torcedor e o grito da torcida. */
  stakes: { title: string; empty: string; cheer: string; derby: string };
  /** Vídeos do jogo (conteúdo relacionado). "Assistir: {title}". */
  videos: { title: string; empty: string; play: string; close: string };
  /** Confronto direto. "{n} jogos desde {year}", "Histórico geral: {n} jogos". */
  h2h: {
    title: string;
    wins: string;
    draws: string;
    since: string;
    played: string;
    allTime: string;
    recent: string;
    empty: string;
  };
  /** Contagem regressiva para o jogo: "Começa em", "Vai começar" e as unidades (dias, horas…). */
  countdown: { startsIn: string; starting: string; units: { d: string; h: string; m: string; s: string } };
  /** Agenda do time: próximos jogos e últimos resultados (V/E/D). */
  schedule: {
    title: string;
    next: string;
    recent: string;
    empty: string;
    home: string;
    away: string;
    result: { W: string; D: string; L: string };
  };
  /** Cartão do time: escudo, forma recente, próximo jogo e campeonatos. */
  teamCard: {
    title: string;
    form: string;
    next: string;
    live: string;
    competitions: string;
    noNext: string;
  };
  /** Estatísticas do time na temporada (#893). "{n} jogos", "{x} por jogo". */
  teamStats: {
    title: string;
    summary: string;
    played: string;
    won: string;
    drawn: string;
    lost: string;
    goalsFor: string;
    goalsAgainst: string;
    perGame: string;
    form: string;
    homeAway: string;
    home: string;
    away: string;
    cleanSheets: string;
    failedToScore: string;
    goalsByMinute: string;
    scored: string;
    conceded: string;
    /** "{from}–{to}'" */
    minuteRange: string;
    unknownMinute: string;
    highlights: string;
    winStreak: string;
    drawStreak: string;
    lossStreak: string;
    biggestWin: string;
    biggestLoss: string;
    penalties: string;
    /** "{scored} de {total}" */
    penaltiesScored: string;
    formations: string;
    /** "{n} jogos" */
    games: string;
    cards: string;
    yellow: string;
    red: string;
    updated: string;
    empty: string;
  };
  /** Campos opcionais ligados no Builder (placar, tabela, agenda…). */
  extra: {
    referee: string;
    /** "1º T {home}–{away}". */
    halftime: string;
    /** "Agregado {home}–{away}". */
    aggregate: string;
    /** "Hora local: {time}". */
    venueTime: string;
    addToCalendar: string;
    /** Rótulo curto do botão nas linhas de jogo (o completo fica no aria-label). */
    calendarShort: string;
    ownGoal: string;
    penalty: string;
    possession: string;
    shots: string;
    onTarget: string;
    formation: string;
    goalsFor: string;
    goalsAgainst: string;
    form: string;
    percentage: string;
    leader: string;
    decisive: string;
    /** "{rank}º · {competition}". */
    position: string;
    /** "Escrito às {time}". */
    writtenAt: string;
    intensity: string;
  };
  /** Termos dos outros esportes (épico #731): parciais, colunas da tabela por unidade do placar. */
  sport: {
    /** Rótulo curto de cada parcial; `{n}` = número. q: quarto; s: set; h: tempo; p: período; i: entrada. */
    period: { q: string; s: string; h: string; p: string; i: string; ot: string; so: string; extra: string };
    /** Coluna do total na tabela de parciais. */
    total: string;
    /** Pró, contra e saldo pela unidade do placar (os gols usam `extra.goalsFor` e `columns.goalDiff`). */
    units: Record<'points' | 'runs' | 'sets', { for: string; against: string; diff: string }>;
    /** Derrotas na prorrogação ou nos pênaltis (hóquei). */
    otLosses: string;
    /** Aproveitamento por vitórias (basquete, beisebol, futebol americano). */
    winPct: string;
    /** Percentual da AFL (pontos pró ÷ contra × 100). */
    ratio: string;
    /** Beisebol: corridas, rebatidas e erros (R/H/E) no placar por entradas. */
    rhe: { r: string; h: string; e: string };
    /** Beisebol: jogos atrás do líder (GB). */
    gamesBehind: string;
  };
  /** Corridas (F1): resultado, fim de semana, classificação, calendário e perfil do piloto. */
  racing: {
    result: string;
    weekend: string;
    calendar: string;
    position: string;
    driver: string;
    team: string;
    time: string;
    grid: string;
    laps: string;
    pits: string;
    fastestLap: string;
    points: string;
    wins: string;
    podiums: string;
    poles: string;
    races: string;
    titles: string;
    drivers: string;
    constructors: string;
    empty: string;
    emptyCalendar: string;
    /** "Venceu: {name}". */
    winner: string;
    /** "{n}º no campeonato". */
    championship: string;
    /** "Temporada {year}". */
    season: string;
    career: string;
    bestFinish: string;
    next: string;
  };
  /** MMA: card do evento, resultado da luta, calendário e perfil do lutador. */
  fights: {
    card: string;
    mainEvent: string;
    segments: Record<'main_card' | 'prelims' | 'early_prelims', string>;
    /** "R{round} · {time}". */
    roundTime: string;
    /** "Cartões: {cards}". */
    scorecards: string;
    record: string;
    lastFights: string;
    upcoming: string;
    empty: string;
    emptyCalendar: string;
    /** "{w}-{l}-{d}" vitórias, derrotas, empates. */
    recordValue: string;
    win: string;
    loss: string;
    draw: string;
    /** "vs. {name}". */
    versus: string;
  };
  /** Lance a lance (`match_timeline`): tipos de lance, marcos do jogo e estados. */
  timeline: {
    title: string;
    kinds: Record<
      | 'goal'
      | 'own_goal'
      | 'penalty_goal'
      | 'penalty_missed'
      | 'yellow_card'
      | 'second_yellow'
      | 'red_card'
      | 'substitution'
      | 'var'
      | 'shootout_scored'
      | 'shootout_missed'
      | 'other',
      string
    >;
    markers: Record<GsTimelineMarkerKind, string>;
    /** Revisões do VAR pelo texto do fornecedor em minúsculas ("goal cancelled" → "Gol anulado"). */
    var: Record<string, string>;
    /** VAR sem texto conhecido. */
    varReview: string;
    /** "Assistência: {name}". */
    assist: string;
    playerIn: string;
    playerOut: string;
    empty: string;
    notStarted: string;
  };
  /** Hipismo: resultados, ranking, calendário e perfis do cavaleiro e do cavalo. */
  equestrian: {
    results: string;
    ranking: string;
    calendar: string;
    rider: string;
    horse: string;
    combination: string;
    faults: string;
    time: string;
    prize: string;
    points: string;
    starts: string;
    wins: string;
    podiums: string;
    horses: string;
    riders: string;
    recent: string;
    pedigree: string;
    sire: string;
    dam: string;
    damSire: string;
    /** "{age} anos". */
    age: string;
    gender: Record<'mare' | 'stallion' | 'gelding' | 'male', string>;
    grandPrix: string;
    empty: string;
    emptyCalendar: string;
    emptyRanking: string;
  };
  /** Artilharia e líderes do campeonato (#828). */
  /** Palpite do jogo: chances, quem deve vencer, linha de gols e comparação. "{team} vence", "{line}". */
  prediction: {
    title: string;
    home: string;
    draw: string;
    away: string;
    /** "{team} vence" / "{team} vence ou empata". */
    wins: string;
    winsOrDraws: string;
    /** Sem favorito apontado. */
    open: string;
    /** "Mais de {line} gols" / "Menos de {line} gols" (no jogo). */
    over: string;
    under: string;
    /** "{team}: mais de {line} gols". */
    teamOver: string;
    teamUnder: string;
    goals: string;
    comparisonTitle: string;
    comparison: Record<GsPredictionComparisonKey, string>;
    probabilities: string;
    /** Aviso de que é um palpite estatístico. */
    note: string;
    empty: string;
    updatedAt: string;
  };
  /** Odds do jogo (consenso entre as casas). "{n} casas", "{line}". */
  odds: {
    title: string;
    markets: Record<'match_winner' | 'double_chance' | 'goals_over_under' | 'both_teams_score', string>;
    home: string;
    draw: string;
    away: string;
    homeDraw: string;
    homeAway: string;
    drawAway: string;
    over: string;
    under: string;
    yes: string;
    no: string;
    /** "Maior {odd}". */
    best: string;
    /** "Média de {n} casas" (plural), no título do mercado quando todas as seleções têm a mesma conta. */
    bookmakers: PluralText;
    /** "{n} casas" (plural), em cada seleção quando as contas do mercado diferem. */
    bookmakersShort: PluralText;
    /** Aviso de jogo responsável. */
    notice: string;
    empty: string;
    updatedAt: string;
  };
  leaders: {
    goals: string;
    assists: string;
    cards: string;
    /** Cabeçalho da coluna do número (gols, assistências). */
    goalsCol: string;
    assistsCol: string;
    player: string;
    team: string;
    /** Abreviação de jogos na coluna. */
    appearances: string;
    appearancesLong: string;
    yellow: string;
    red: string;
    empty: string;
    /** Rodapé com a data da última atualização dos números. */
    updatedAt: string;
  };
  /** Olimpíadas e Pan: quadro de medalhas, o dia do país, programação, atletas e histórico. */
  olympics: {
    medals: string;
    /** "{country} hoje". */
    today: string;
    schedule: string;
    /** "Atletas · {country}". */
    athletes: string;
    history: string;
    edition: string;
    country: string;
    gold: string;
    silver: string;
    bronze: string;
    total: string;
    medalEvent: string;
    medalsToday: string;
    /** "Nenhuma prova de {country} neste dia." */
    noUnits: string;
    emptySchedule: string;
    noAthletes: string;
    withheld: string;
    /** "Soma de {n} edições". */
    totals: string;
  };
  /** Elenco do time (#825): grupos por posição e os técnicos. "{age} anos", "{n} jogadores". */
  squad: {
    title: string;
    /** Pela posição do fornecedor (`SQUAD_POSITIONS`). */
    positions: Record<string, string>;
    others: string;
    coaches: string;
    age: string;
    players: string;
    season: string;
    number: string;
    empty: string;
  };
  /** Ficha do jogador (futebol): números da temporada, clubes, temporadas, títulos e transferências. */
  player: {
    /** "Temporada {year}". */
    season: string;
    appearances: string;
    goals: string;
    assists: string;
    minutes: string;
    yellow: string;
    red: string;
    rating: string;
    clubs: string;
    seasons: string;
    trophies: string;
    transfers: string;
    current: string;
    coach: string;
    /** "{age} anos". */
    age: string;
    /** "{n} jogo(s)", com singular e plural (`pluralText`); técnico mostra só os jogos. */
    apps: PluralText;
    /** "{n} gol(s)", com singular e plural (`pluralText`); vem depois dos jogos na linha do clube e da temporada. */
    goalsCount: PluralText;
    /** "e mais {count}". */
    more: string;
    empty: string;
    positions: Record<'Goalkeeper' | 'Defender' | 'Midfielder' | 'Attacker', string>;
    places: Record<string, string>;
    transferTypes: Record<string, string>;
  };
  /** Vai e vem do mercado: contratações e saídas de um time ou de um campeonato. */
  transfers: {
    title: string;
    /** "Mercado · {name}". */
    titleOf: string;
    arrivals: string;
    departures: string;
    /** Rótulo curto de quem chegou e de quem saiu (o completo vai no aria-label). */
    in: string;
    out: string;
    /** "de {club}" / "para {club}". */
    from: string;
    to: string;
    kind: Record<'loan' | 'loan_return' | 'free' | 'fee' | 'transfer', string>;
    empty: string;
    /** Sem time nem campeonato escolhido. */
    pick: string;
  };
  /** Chaveamento do mata-mata. */
  bracket: {
    title: string;
    empty: string;
    /** Rótulo da escolha de fase no modo fase por fase. */
    rounds: string;
    aggregate: string;
    /** "Ida", "Volta" (ida e volta) e "Jogo {n}" (série). */
    firstLeg: string;
    secondLeg: string;
    game: string;
    /** Vitórias na série ("Série 3–1"). */
    series: string;
    /** Abreviação dos pênaltis, depois do número ("(4 pên.)"). */
    penaltiesShort: string;
    tbd: string;
    /** Quem avançou (leitor de tela). */
    advanced: string;
  };
}

const TEXTS: Record<WidgetLocale, WidgetTexts> = {
  'pt-BR': {
    status: {
      scheduled: 'Agendado',
      starting: 'Começando',
      live: 'Ao vivo',
      break: 'Intervalo',
      finished: 'Encerrado',
      postponed: 'Adiado',
      cancelled: 'Cancelado',
      suspended: 'Suspenso',
      abandoned: 'Abandonado',
    },
    loading: 'Carregando…',
    error: 'Não foi possível carregar os dados agora.',
    notFound: 'Não encontramos esse conteúdo.',
    missingKey: 'Configure a chave publicável da Galaxie Sports.',
    invalidKey: 'Chave publicável inválida ou revogada.',
    forbidden: 'Esta chave não libera este conteúdo. Confira o widget e o plano no portal Galaxie.',
    retry: 'Tentar de novo',
    versus: 'x',
    penalties: 'pên.',
    emptyLive: 'Nenhum jogo ao vivo agora.',
    emptyDay: 'Nenhum jogo nesta data.',
    emptyStandings: 'A tabela ainda não está disponível.',
    emptyWatch: 'Transmissão ainda não confirmada.',
    liveNow: 'Ao vivo agora',
    todayGames: 'Jogos do dia',
    games: 'Jogos',
    results: 'Resultados',
    tomorrowGames: 'Jogos de amanhã',
    yesterdayGames: 'Jogos de ontem',
    upcomingGames: 'Próximos jogos',
    todayResults: 'Resultados do dia',
    yesterdayResults: 'Resultados de ontem',
    referee: 'Árbitro',
    derby: 'Clássico',
    standings: 'Classificação',
    whereToWatch: 'Onde assistir',
    toConfirm: 'Canal a confirmar',
    watch: 'Assistir',
    updated: 'Atualizado',
    columns: { team: 'Time', points: 'P', played: 'J', won: 'V', drawn: 'E', lost: 'D', goalDiff: 'SG' },
    zones: {
      libertadores: 'Libertadores',
      libertadores_group_stage: 'Libertadores (fase de grupos)',
      libertadores_qualifying: 'Libertadores (pré-Libertadores)',
      sudamericana: 'Sul-Americana',
      sudamericana_knockout_playoff: 'Sul-Americana (playoffs)',
      champions_league: 'Champions League',
      champions_league_qualifying: 'Champions League (preliminares)',
      europa_league: 'Europa League',
      europa_league_knockout_playoff: 'Europa League (playoffs)',
      conference_league: 'Conference League',
      round_of_16: 'Oitavas de final',
      round_of_32: '16 avos de final',
      quarter_finals: 'Quartas de final',
      knockout_playoff: 'Playoffs do mata-mata',
      playoff: 'Playoffs',
      promotion: 'Acesso',
      relegation_playoff: 'Playoff contra o rebaixamento',
      relegation: 'Rebaixamento',
      elimination: 'Eliminação',
      playoffs: 'Playoffs',
      liguilla: 'Liguilla',
      quadrangulars: 'Quadrangulares',
      play_in: 'Play-in',
    },
    media: {
      free_tv: 'TV aberta',
      pay_tv: 'TV por assinatura',
      streaming_svod: 'Streaming',
      streaming_free: 'Streaming grátis',
      youtube: 'YouTube',
      official_app: 'App oficial',
      radio: 'Rádio',
    },
    access: { free: 'Grátis', subscription: 'Assinatura', ppv: 'Pay-per-view', unknown: '' },
    watchGroups: {
      freeTv: 'TV aberta',
      payTv: 'Canais pagos',
      alsoOn: 'Disponível também em',
      included: 'Incluso',
      addon: 'Adicional',
      includedServices: 'Streamings inclusos',
      addonsAvailable: 'Disponível como complemento',
      priceFrom: 'a partir de {price}',
      free: 'grátis',
      yourOperator: 'Sua operadora',
      notInYourOperator: 'Este jogo não está na grade da sua operadora.',
      toConfirmTitle: 'Canal deste jogo a confirmar',
      toConfirmHint:
        'Quem tem os direitos no país e onde esses canais estão. O canal do jogo sai mais perto da partida.',
      toConfirmLiveHint: 'Quem tem os direitos no país e onde esses canais estão.',
      notConfirmedTitle: 'Não confirmamos o canal deste jogo',
      confirmedPre: 'Passa em {channels}',
      confirmedLive: 'Ao vivo em {channels}',
      confirmedPost: 'Transmitido por {channels}',
      confirmedSource: 'Fonte: {publisher}',
      kind: {
        pay_tv_operator: 'Operadora de TV paga',
        vmvpd: 'TV paga pela internet',
        telco_bundle: 'Pacote de telefonia e TV',
        streaming: 'Streaming',
      },
    },
    context: {
      title: 'Contexto do jogo',
      scenario: 'Antes do jogo',
      recap: 'Depois do jogo',
      empty: 'O contexto deste jogo sai mais perto da partida.',
      aiNote: 'Texto gerado com IA a partir dos dados do jogo.',
    },
    stakes: {
      title: 'O que está em jogo',
      empty: 'Nada decisivo em jogo nesta partida.',
      cheer: 'Grito da torcida',
      derby: 'Clássico',
    },
    videos: {
      title: 'Vídeos do jogo',
      empty: 'Os vídeos deste jogo aparecem aqui assim que saírem.',
      play: 'Assistir: {title}',
      close: 'Fechar vídeo',
    },
    h2h: {
      title: 'Confronto direto',
      wins: 'Vitórias',
      draws: 'Empates',
      since: '{n} jogos desde {year}',
      played: '{n} jogos',
      allTime: 'Histórico geral: {n} jogos',
      recent: 'Últimos confrontos',
      empty: 'Os times ainda não se enfrentaram.',
    },
    countdown: {
      startsIn: 'Começa em',
      starting: 'Vai começar',
      units: { d: 'dias', h: 'horas', m: 'min', s: 'seg' },
    },
    schedule: {
      title: 'Agenda',
      next: 'Próximos jogos',
      recent: 'Últimos resultados',
      empty: 'Nenhum jogo nas próximas semanas.',
      home: 'Casa',
      away: 'Fora',
      result: { W: 'V', D: 'E', L: 'D' },
    },
    teamCard: {
      title: 'Cartão do time',
      form: 'Forma recente',
      next: 'Próximo jogo',
      live: 'Ao vivo',
      competitions: 'Campeonatos',
      noNext: 'Nenhum jogo marcado.',
    },
    teamStats: {
      title: 'Estatísticas do time',
      summary: 'Resumo da temporada',
      played: 'Jogos',
      won: 'Vitórias',
      drawn: 'Empates',
      lost: 'Derrotas',
      goalsFor: 'Gols pró',
      goalsAgainst: 'Gols contra',
      perGame: '{x} por jogo',
      form: 'Forma',
      homeAway: 'Casa e fora',
      home: 'Casa',
      away: 'Fora',
      cleanSheets: 'Sem sofrer gol',
      failedToScore: 'Sem marcar',
      goalsByMinute: 'Gols por faixa de minuto',
      scored: 'Marcados',
      conceded: 'Sofridos',
      minuteRange: "{from}–{to}'",
      unknownMinute: 'Sem minuto',
      highlights: 'Sequências e maiores placares',
      winStreak: 'Vitórias seguidas',
      drawStreak: 'Empates seguidos',
      lossStreak: 'Derrotas seguidas',
      biggestWin: 'Maior vitória',
      biggestLoss: 'Maior derrota',
      penalties: 'Pênaltis',
      penaltiesScored: '{scored} de {total}',
      formations: 'Formações mais usadas',
      games: '{n} jogos',
      cards: 'Cartões por faixa de minuto',
      yellow: 'Amarelos',
      red: 'Vermelhos',
      updated: 'Atualizado em {date}',
      empty: 'Sem estatísticas deste time para a temporada.',
    },
    extra: {
      referee: 'Árbitro',
      halftime: '1º T {home}–{away}',
      aggregate: 'Agregado {home}–{away}',
      venueTime: 'Hora local: {time}',
      addToCalendar: 'Adicionar ao calendário',
      calendarShort: '+ Calendário',
      ownGoal: 'contra',
      penalty: 'pên.',
      possession: 'Posse',
      shots: 'Finalizações',
      onTarget: 'No alvo',
      formation: 'Formação',
      goalsFor: 'GP',
      goalsAgainst: 'GC',
      form: 'Forma',
      percentage: '%',
      leader: 'Líder',
      decisive: 'Jogos decisivos',
      position: '{rank}º · {competition}',
      writtenAt: 'Escrito às {time}',
      intensity: 'Intensidade',
    },
    sport: {
      period: {
        q: '{n}Q',
        s: '{n}S',
        h: '{n}T',
        p: '{n}P',
        i: '{n}',
        ot: 'Prorr.',
        so: 'Pên.',
        extra: 'Extra',
      },
      total: 'Total',
      units: {
        points: { for: 'PP', against: 'PC', diff: 'SP' },
        runs: { for: 'CP', against: 'CC', diff: 'SC' },
        sets: { for: 'SV', against: 'SP', diff: 'SS' },
      },
      otLosses: 'DP',
      winPct: '%V',
      ratio: '%',
      rhe: { r: 'C', h: 'H', e: 'E' },
      gamesBehind: 'JA',
    },
    racing: {
      result: 'Resultado',
      weekend: 'Fim de semana do GP',
      calendar: 'Calendário',
      position: 'Pos.',
      driver: 'Piloto',
      team: 'Equipe',
      time: 'Tempo',
      grid: 'Larg.',
      laps: 'Voltas',
      pits: 'Paradas',
      fastestLap: 'Volta mais rápida',
      points: 'Pts',
      wins: 'Vitórias',
      podiums: 'Pódios',
      poles: 'Poles',
      races: 'Corridas',
      titles: 'Títulos',
      drivers: 'Pilotos',
      constructors: 'Construtores',
      empty: 'O resultado sai quando a sessão terminar.',
      emptyCalendar: 'Sem provas nesta temporada.',
      winner: 'Venceu: {name}',
      championship: '{n}º no campeonato',
      season: 'Temporada {year}',
      career: 'Carreira',
      bestFinish: 'Melhor resultado',
      next: 'Próxima',
    },
    fights: {
      card: 'Card do evento',
      mainEvent: 'Luta principal',
      segments: {
        main_card: 'Card principal',
        prelims: 'Preliminares',
        early_prelims: 'Preliminares iniciais',
      },
      roundTime: 'R{round} · {time}',
      scorecards: 'Juízes: {cards}',
      record: 'Cartel',
      lastFights: 'Últimas lutas',
      upcoming: 'Próximos eventos',
      empty: 'O card ainda não foi divulgado.',
      emptyCalendar: 'Sem eventos marcados.',
      recordValue: '{w}-{l}-{d}',
      win: 'V',
      loss: 'D',
      draw: 'E',
      versus: 'vs. {name}',
    },
    timeline: {
      title: 'Lance a lance',
      kinds: {
        goal: 'Gol',
        own_goal: 'Gol contra',
        penalty_goal: 'Gol de pênalti',
        penalty_missed: 'Pênalti perdido',
        yellow_card: 'Cartão amarelo',
        second_yellow: 'Segundo amarelo',
        red_card: 'Cartão vermelho',
        substitution: 'Substituição',
        var: 'VAR',
        shootout_scored: 'Pênalti convertido',
        shootout_missed: 'Pênalti perdido',
        other: 'Lance',
      },
      markers: {
        kickoff: 'Início do jogo',
        halftime: 'Intervalo',
        second_half: 'Segundo tempo',
        end_of_regulation: 'Fim do tempo normal',
        extra_time: 'Prorrogação',
        penalty_shootout: 'Disputa de pênaltis',
        full_time: 'Fim de jogo',
      },
      var: {
        'goal cancelled': 'Gol anulado',
        'goal confirmed': 'Gol confirmado',
        'goal disallowed': 'Gol anulado',
        'goal disallowed - offside': 'Gol anulado por impedimento',
        'goal disallowed - foul': 'Gol anulado por falta',
        'penalty confirmed': 'Pênalti confirmado',
        'penalty cancelled': 'Pênalti anulado',
        'penalty awarded': 'Pênalti marcado',
        'card upgrade': 'Cartão aumentado para vermelho',
        'card reviewed': 'Cartão revisado',
        'red card cancelled': 'Vermelho anulado',
      },
      varReview: 'Revisão',
      assist: 'Assistência: {name}',
      playerIn: 'Entra',
      playerOut: 'Sai',
      empty: 'Nenhum lance registrado neste jogo.',
      notStarted: 'Os lances aparecem aqui assim que o jogo começar.',
    },
    equestrian: {
      results: 'Resultados',
      ranking: 'Ranking',
      calendar: 'Calendário de provas',
      rider: 'Cavaleiro',
      horse: 'Cavalo',
      combination: 'Conjunto',
      faults: 'Faltas',
      time: 'Tempo',
      prize: 'Prêmio',
      points: 'Pts',
      starts: 'Provas',
      wins: 'Vitórias',
      podiums: 'Pódios',
      horses: 'Cavalos',
      riders: 'Cavaleiros',
      recent: 'Últimos resultados',
      pedigree: 'Pedigree',
      sire: 'Pai',
      dam: 'Mãe',
      damSire: 'Avô materno',
      age: '{age} anos',
      gender: { mare: 'Égua', stallion: 'Garanhão', gelding: 'Castrado', male: 'Macho' },
      grandPrix: 'GP',
      empty: 'Sem resultados nesta prova.',
      emptyCalendar: 'Nenhuma prova no período.',
      emptyRanking: 'Ranking indisponível.',
    },
    prediction: {
      title: 'Palpite do jogo',
      home: 'Vitória do mandante',
      draw: 'Empate',
      away: 'Vitória do visitante',
      wins: '{team} vence',
      winsOrDraws: '{team} vence ou empata',
      open: 'Jogo sem favorito',
      over: 'Mais de {line} gols',
      under: 'Menos de {line} gols',
      teamOver: '{team}: mais de {line} gols',
      teamUnder: '{team}: menos de {line} gols',
      goals: 'Gols',
      comparisonTitle: 'Comparação',
      comparison: {
        form: 'Momento',
        attack: 'Ataque',
        defense: 'Defesa',
        poisson: 'Probabilidade (Poisson)',
        h2h: 'Confronto direto',
        goals: 'Gols',
        total: 'Geral',
      },
      probabilities: 'Chances de cada resultado',
      note: 'Palpite estatístico, a partir do retrospecto dos times.',
      empty: 'Palpite ainda não disponível para este jogo.',
      updatedAt: 'Atualizado em',
    },
    odds: {
      title: 'Odds do jogo',
      markets: {
        match_winner: 'Resultado final',
        double_chance: 'Dupla chance',
        goals_over_under: 'Total de gols',
        both_teams_score: 'Ambos marcam',
      },
      home: 'Mandante',
      draw: 'Empate',
      away: 'Visitante',
      homeDraw: 'Mandante ou empate',
      homeAway: 'Mandante ou visitante',
      drawAway: 'Empate ou visitante',
      over: 'Mais de {line}',
      under: 'Menos de {line}',
      yes: 'Sim',
      no: 'Não',
      best: 'Maior {odd}',
      bookmakers: { one: 'Média de {n} casa', other: 'Média de {n} casas' },
      bookmakersShort: { one: '{n} casa', other: '{n} casas' },
      notice: '18+ · Aposte com responsabilidade.',
      empty: 'Odds ainda não disponíveis para este jogo.',
      updatedAt: 'Atualizado em',
    },
    leaders: {
      goals: 'Artilharia',
      assists: 'Assistências',
      cards: 'Cartões',
      goalsCol: 'Gols',
      assistsCol: 'Assist.',
      player: 'Jogador',
      team: 'Time',
      appearances: 'J',
      appearancesLong: 'Jogos',
      yellow: 'Amarelos',
      red: 'Vermelhos',
      empty: 'Os números dos jogadores deste campeonato ainda não estão disponíveis.',
      updatedAt: 'Atualizado em',
    },
    olympics: {
      medals: 'Quadro de medalhas',
      today: '{country} hoje',
      schedule: 'Programação',
      athletes: 'Atletas · {country}',
      history: 'Histórico de medalhas',
      edition: 'Edição',
      country: 'País',
      gold: 'Ouro',
      silver: 'Prata',
      bronze: 'Bronze',
      total: 'Total',
      medalEvent: 'Vale medalha',
      medalsToday: 'Medalhas do dia',
      noUnits: 'Nenhuma prova de {country} neste dia.',
      emptySchedule: 'Nenhuma prova neste dia.',
      noAthletes: 'Nenhum atleta encontrado.',
      withheld: 'Quadro em revisão: as medalhas desta edição ainda não estão completas.',
      totals: 'Soma de {n} edições',
    },
    squad: {
      title: 'Elenco',
      positions: {
        Goalkeeper: 'Goleiros',
        Defender: 'Defensores',
        Midfielder: 'Meio-campistas',
        Attacker: 'Atacantes',
      },
      others: 'Outros',
      coaches: 'Técnicos',
      age: '{age} anos',
      players: '{n} jogadores',
      season: 'Temporada {year}',
      number: 'Camisa {number}',
      empty: 'Elenco indisponível.',
    },
    player: {
      season: 'Temporada {year}',
      appearances: 'Jogos',
      goals: 'Gols',
      assists: 'Assistências',
      minutes: 'Minutos',
      yellow: 'Amarelos',
      red: 'Vermelhos',
      rating: 'Nota',
      clubs: 'Clubes',
      seasons: 'Por temporada',
      trophies: 'Títulos',
      transfers: 'Transferências',
      current: 'Atual',
      coach: 'Técnico',
      age: '{age} anos',
      apps: { one: '{n} jogo', other: '{n} jogos' },
      goalsCount: { one: '{n} gol', other: '{n} gols' },
      more: 'e mais {count}',
      empty: 'Sem jogos nesta temporada.',
      positions: {
        Goalkeeper: 'Goleiro',
        Defender: 'Defensor',
        Midfielder: 'Meio-campista',
        Attacker: 'Atacante',
      },
      places: { Winner: 'Campeão', '2nd Place': 'Vice', '3rd Place': '3º lugar', '4th Place': '4º lugar' },
      transferTypes: {
        Loan: 'Empréstimo',
        Free: 'Sem custo',
        'Back from Loan': 'Fim de empréstimo',
        Transfer: 'Transferência',
      },
    },
    transfers: {
      title: 'Vai e vem do mercado',
      titleOf: 'Mercado · {name}',
      arrivals: 'Chegadas',
      departures: 'Saídas',
      in: 'Chegou',
      out: 'Saiu',
      from: 'de {club}',
      to: 'para {club}',
      kind: {
        loan: 'Empréstimo',
        loan_return: 'Volta de empréstimo',
        free: 'Sem custo',
        fee: 'Compra',
        transfer: 'Definitiva',
      },
      empty: 'Nenhuma transferência no período.',
      pick: 'Escolha um time ou um campeonato.',
    },
    bracket: {
      title: 'Chaveamento',
      empty: 'Sem mata-mata nesta temporada (ainda).',
      rounds: 'Fases',
      aggregate: 'Agregado',
      firstLeg: 'Ida',
      secondLeg: 'Volta',
      game: 'Jogo {n}',
      series: 'Série',
      penaltiesShort: 'pên.',
      tbd: 'A definir',
      advanced: 'classificado',
    },
  },
  es: {
    status: {
      scheduled: 'Programado',
      starting: 'Por comenzar',
      live: 'En vivo',
      break: 'Entretiempo',
      finished: 'Finalizado',
      postponed: 'Aplazado',
      cancelled: 'Cancelado',
      suspended: 'Suspendido',
      abandoned: 'Abandonado',
    },
    loading: 'Cargando…',
    error: 'No pudimos cargar los datos ahora.',
    notFound: 'No encontramos este contenido.',
    missingKey: 'Configura la clave publicable de Galaxie Sports.',
    invalidKey: 'Clave publicable inválida o revocada.',
    forbidden: 'Esta clave no habilita este contenido. Revisa el widget y el plan en el portal Galaxie.',
    retry: 'Reintentar',
    versus: 'vs',
    penalties: 'pen.',
    emptyLive: 'No hay partidos en vivo ahora.',
    emptyDay: 'No hay partidos en esta fecha.',
    emptyStandings: 'La tabla aún no está disponible.',
    emptyWatch: 'Transmisión aún no confirmada.',
    liveNow: 'En vivo ahora',
    todayGames: 'Partidos del día',
    games: 'Partidos',
    results: 'Resultados',
    tomorrowGames: 'Partidos de mañana',
    yesterdayGames: 'Partidos de ayer',
    upcomingGames: 'Próximos partidos',
    todayResults: 'Resultados del día',
    yesterdayResults: 'Resultados de ayer',
    referee: 'Árbitro',
    derby: 'Clásico',
    standings: 'Posiciones',
    whereToWatch: 'Dónde ver',
    toConfirm: 'Canal por confirmar',
    watch: 'Ver',
    updated: 'Actualizado',
    columns: { team: 'Equipo', points: 'Pts', played: 'PJ', won: 'G', drawn: 'E', lost: 'P', goalDiff: 'DG' },
    zones: {
      libertadores: 'Libertadores',
      libertadores_group_stage: 'Libertadores (fase de grupos)',
      libertadores_qualifying: 'Libertadores (fase previa)',
      sudamericana: 'Sudamericana',
      sudamericana_knockout_playoff: 'Sudamericana (repechaje)',
      champions_league: 'Champions League',
      champions_league_qualifying: 'Champions League (fase previa)',
      europa_league: 'Europa League',
      europa_league_knockout_playoff: 'Europa League (repechaje)',
      conference_league: 'Conference League',
      round_of_16: 'Octavos de final',
      round_of_32: 'Dieciseisavos de final',
      quarter_finals: 'Cuartos de final',
      knockout_playoff: 'Repechaje de eliminación directa',
      playoff: 'Playoffs',
      promotion: 'Ascenso',
      relegation_playoff: 'Repechaje por el descenso',
      relegation: 'Descenso',
      elimination: 'Eliminación',
      playoffs: 'Playoffs',
      liguilla: 'Liguilla',
      quadrangulars: 'Cuadrangulares',
      play_in: 'Play-in',
    },
    media: {
      free_tv: 'TV abierta',
      pay_tv: 'TV paga',
      streaming_svod: 'Streaming',
      streaming_free: 'Streaming gratis',
      youtube: 'YouTube',
      official_app: 'App oficial',
      radio: 'Radio',
    },
    access: { free: 'Gratis', subscription: 'Suscripción', ppv: 'Pay-per-view', unknown: '' },
    watchGroups: {
      freeTv: 'TV abierta',
      payTv: 'Canales pagos',
      alsoOn: 'Disponible también en',
      included: 'Incluido',
      addon: 'Adicional',
      includedServices: 'Streamings incluidos',
      addonsAvailable: 'Disponible como adicional',
      priceFrom: 'desde {price}',
      free: 'gratis',
      yourOperator: 'Tu operadora',
      notInYourOperator: 'Este partido no está en la grilla de tu operadora.',
      toConfirmTitle: 'Canal de este partido a confirmar',
      toConfirmHint:
        'Quién tiene los derechos en el país y dónde están esos canales. El canal del partido se conoce más cerca del encuentro.',
      toConfirmLiveHint: 'Quién tiene los derechos en el país y dónde están esos canales.',
      notConfirmedTitle: 'No confirmamos el canal de este partido',
      confirmedPre: 'Se ve por {channels}',
      confirmedLive: 'En vivo por {channels}',
      confirmedPost: 'Transmitido por {channels}',
      confirmedSource: 'Fuente: {publisher}',
      kind: {
        pay_tv_operator: 'Operadora de TV paga',
        vmvpd: 'TV paga por internet',
        telco_bundle: 'Paquete de telefonía y TV',
        streaming: 'Streaming',
      },
    },
    context: {
      title: 'Contexto del partido',
      scenario: 'Antes del partido',
      recap: 'Después del partido',
      empty: 'El contexto de este partido se publica más cerca del encuentro.',
      aiNote: 'Texto generado con IA a partir de los datos del partido.',
    },
    stakes: {
      title: 'Qué está en juego',
      empty: 'Nada decisivo en juego en este partido.',
      cheer: 'Grito de la hinchada',
      derby: 'Clásico',
    },
    videos: {
      title: 'Videos del partido',
      empty: 'Los videos de este partido aparecen aquí apenas se publiquen.',
      play: 'Ver: {title}',
      close: 'Cerrar video',
    },
    h2h: {
      title: 'Historial',
      wins: 'Victorias',
      draws: 'Empates',
      since: '{n} partidos desde {year}',
      played: '{n} partidos',
      allTime: 'Historial completo: {n} partidos',
      recent: 'Últimos enfrentamientos',
      empty: 'Los equipos todavía no se enfrentaron.',
    },
    countdown: {
      startsIn: 'Empieza en',
      starting: 'Por comenzar',
      units: { d: 'días', h: 'horas', m: 'min', s: 'seg' },
    },
    schedule: {
      title: 'Agenda',
      next: 'Próximos partidos',
      recent: 'Últimos resultados',
      empty: 'No hay partidos en las próximas semanas.',
      home: 'Local',
      away: 'Visitante',
      result: { W: 'G', D: 'E', L: 'P' },
    },
    teamCard: {
      title: 'Ficha del equipo',
      form: 'Forma reciente',
      next: 'Próximo partido',
      live: 'En vivo',
      competitions: 'Competiciones',
      noNext: 'Ningún partido programado.',
    },
    teamStats: {
      title: 'Estadísticas del equipo',
      summary: 'Resumen de la temporada',
      played: 'Partidos',
      won: 'Victorias',
      drawn: 'Empates',
      lost: 'Derrotas',
      goalsFor: 'Goles a favor',
      goalsAgainst: 'Goles en contra',
      perGame: '{x} por partido',
      form: 'Racha',
      homeAway: 'Local y visitante',
      home: 'Local',
      away: 'Visitante',
      cleanSheets: 'Valla invicta',
      failedToScore: 'Sin marcar',
      goalsByMinute: 'Goles por tramo de minutos',
      scored: 'Marcados',
      conceded: 'Recibidos',
      minuteRange: "{from}–{to}'",
      unknownMinute: 'Sin minuto',
      highlights: 'Rachas y mayores resultados',
      winStreak: 'Victorias seguidas',
      drawStreak: 'Empates seguidos',
      lossStreak: 'Derrotas seguidas',
      biggestWin: 'Mayor victoria',
      biggestLoss: 'Mayor derrota',
      penalties: 'Penales',
      penaltiesScored: '{scored} de {total}',
      formations: 'Formaciones más usadas',
      games: '{n} partidos',
      cards: 'Tarjetas por tramo de minutos',
      yellow: 'Amarillas',
      red: 'Rojas',
      updated: 'Actualizado el {date}',
      empty: 'Sin estadísticas de este equipo para la temporada.',
    },
    extra: {
      referee: 'Árbitro',
      halftime: '1T {home}–{away}',
      aggregate: 'Global {home}–{away}',
      venueTime: 'Hora local: {time}',
      addToCalendar: 'Añadir al calendario',
      calendarShort: '+ Calendario',
      ownGoal: 'en contra',
      penalty: 'pen.',
      possession: 'Posesión',
      shots: 'Remates',
      onTarget: 'Al arco',
      formation: 'Formación',
      goalsFor: 'GF',
      goalsAgainst: 'GC',
      form: 'Racha',
      percentage: '%',
      leader: 'Líder',
      decisive: 'Partidos decisivos',
      position: '{rank}º · {competition}',
      writtenAt: 'Escrito a las {time}',
      intensity: 'Intensidad',
    },
    sport: {
      period: {
        q: 'C{n}',
        s: 'S{n}',
        h: '{n}T',
        p: 'P{n}',
        i: '{n}',
        ot: 'Prór.',
        so: 'Pen.',
        extra: 'Extra',
      },
      total: 'Total',
      units: {
        points: { for: 'PF', against: 'PC', diff: 'DIF' },
        runs: { for: 'CA', against: 'CR', diff: 'DIF' },
        sets: { for: 'SG', against: 'SP', diff: 'DIF' },
      },
      otLosses: 'PP',
      winPct: '%G',
      ratio: '%',
      rhe: { r: 'C', h: 'H', e: 'E' },
      gamesBehind: 'JD',
    },
    racing: {
      result: 'Resultado',
      weekend: 'Fin de semana del GP',
      calendar: 'Calendario',
      position: 'Pos.',
      driver: 'Piloto',
      team: 'Equipo',
      time: 'Tiempo',
      grid: 'Sal.',
      laps: 'Vueltas',
      pits: 'Paradas',
      fastestLap: 'Vuelta rápida',
      points: 'Pts',
      wins: 'Victorias',
      podiums: 'Podios',
      poles: 'Poles',
      races: 'Carreras',
      titles: 'Títulos',
      drivers: 'Pilotos',
      constructors: 'Constructores',
      empty: 'El resultado sale cuando termine la sesión.',
      emptyCalendar: 'Sin carreras en esta temporada.',
      winner: 'Ganó: {name}',
      championship: '{n}º en el campeonato',
      season: 'Temporada {year}',
      career: 'Carrera',
      bestFinish: 'Mejor resultado',
      next: 'Próxima',
    },
    fights: {
      card: 'Cartelera',
      mainEvent: 'Pelea estelar',
      segments: {
        main_card: 'Cartelera principal',
        prelims: 'Preliminares',
        early_prelims: 'Preliminares iniciales',
      },
      roundTime: 'R{round} · {time}',
      scorecards: 'Jueces: {cards}',
      record: 'Récord',
      lastFights: 'Últimas peleas',
      upcoming: 'Próximos eventos',
      empty: 'La cartelera aún no fue anunciada.',
      emptyCalendar: 'Sin eventos programados.',
      recordValue: '{w}-{l}-{d}',
      win: 'G',
      loss: 'P',
      draw: 'E',
      versus: 'vs. {name}',
    },
    timeline: {
      title: 'Minuto a minuto',
      kinds: {
        goal: 'Gol',
        own_goal: 'Gol en contra',
        penalty_goal: 'Gol de penal',
        penalty_missed: 'Penal errado',
        yellow_card: 'Tarjeta amarilla',
        second_yellow: 'Segunda amarilla',
        red_card: 'Tarjeta roja',
        substitution: 'Cambio',
        var: 'VAR',
        shootout_scored: 'Penal convertido',
        shootout_missed: 'Penal errado',
        other: 'Jugada',
      },
      markers: {
        kickoff: 'Inicio del partido',
        halftime: 'Entretiempo',
        second_half: 'Segundo tiempo',
        end_of_regulation: 'Fin del tiempo reglamentario',
        extra_time: 'Prórroga',
        penalty_shootout: 'Tanda de penales',
        full_time: 'Final del partido',
      },
      var: {
        'goal cancelled': 'Gol anulado',
        'goal confirmed': 'Gol confirmado',
        'goal disallowed': 'Gol anulado',
        'goal disallowed - offside': 'Gol anulado por offside',
        'goal disallowed - foul': 'Gol anulado por falta',
        'penalty confirmed': 'Penal confirmado',
        'penalty cancelled': 'Penal anulado',
        'penalty awarded': 'Penal sancionado',
        'card upgrade': 'Tarjeta cambiada a roja',
        'card reviewed': 'Tarjeta revisada',
        'red card cancelled': 'Roja anulada',
      },
      varReview: 'Revisión',
      assist: 'Asistencia: {name}',
      playerIn: 'Entra',
      playerOut: 'Sale',
      empty: 'No hay jugadas registradas en este partido.',
      notStarted: 'Las jugadas aparecen aquí apenas empiece el partido.',
    },
    equestrian: {
      results: 'Resultados',
      ranking: 'Ranking',
      calendar: 'Calendario de pruebas',
      rider: 'Jinete',
      horse: 'Caballo',
      combination: 'Binomio',
      faults: 'Faltas',
      time: 'Tiempo',
      prize: 'Premio',
      points: 'Pts',
      starts: 'Pruebas',
      wins: 'Victorias',
      podiums: 'Podios',
      horses: 'Caballos',
      riders: 'Jinetes',
      recent: 'Últimos resultados',
      pedigree: 'Pedigrí',
      sire: 'Padre',
      dam: 'Madre',
      damSire: 'Abuelo materno',
      age: '{age} años',
      gender: { mare: 'Yegua', stallion: 'Semental', gelding: 'Castrado', male: 'Macho' },
      grandPrix: 'GP',
      empty: 'Sin resultados en esta prueba.',
      emptyCalendar: 'Ninguna prueba en el período.',
      emptyRanking: 'Ranking no disponible.',
    },
    prediction: {
      title: 'Pronóstico del partido',
      home: 'Gana el local',
      draw: 'Empate',
      away: 'Gana el visitante',
      wins: 'Gana {team}',
      winsOrDraws: '{team} gana o empata',
      open: 'Partido sin favorito',
      over: 'Más de {line} goles',
      under: 'Menos de {line} goles',
      teamOver: '{team}: más de {line} goles',
      teamUnder: '{team}: menos de {line} goles',
      goals: 'Goles',
      comparisonTitle: 'Comparación',
      comparison: {
        form: 'Momento',
        attack: 'Ataque',
        defense: 'Defensa',
        poisson: 'Probabilidad (Poisson)',
        h2h: 'Historial',
        goals: 'Goles',
        total: 'General',
      },
      probabilities: 'Probabilidad de cada resultado',
      note: 'Pronóstico estadístico, a partir del historial de los equipos.',
      empty: 'Pronóstico aún no disponible para este partido.',
      updatedAt: 'Actualizado el',
    },
    odds: {
      title: 'Cuotas del partido',
      markets: {
        match_winner: 'Resultado final',
        double_chance: 'Doble oportunidad',
        goals_over_under: 'Total de goles',
        both_teams_score: 'Ambos marcan',
      },
      home: 'Local',
      draw: 'Empate',
      away: 'Visitante',
      homeDraw: 'Local o empate',
      homeAway: 'Local o visitante',
      drawAway: 'Empate o visitante',
      over: 'Más de {line}',
      under: 'Menos de {line}',
      yes: 'Sí',
      no: 'No',
      best: 'Máxima {odd}',
      bookmakers: { one: 'Promedio de {n} casa', other: 'Promedio de {n} casas' },
      bookmakersShort: { one: '{n} casa', other: '{n} casas' },
      notice: '+18 · Jugá con responsabilidad.',
      empty: 'Cuotas aún no disponibles para este partido.',
      updatedAt: 'Actualizado el',
    },
    leaders: {
      goals: 'Goleadores',
      assists: 'Asistencias',
      cards: 'Tarjetas',
      goalsCol: 'Goles',
      assistsCol: 'Asist.',
      player: 'Jugador',
      team: 'Equipo',
      appearances: 'PJ',
      appearancesLong: 'Partidos',
      yellow: 'Amarillas',
      red: 'Rojas',
      empty: 'Las estadísticas de jugadores de esta competición aún no están disponibles.',
      updatedAt: 'Actualizado el',
    },
    olympics: {
      medals: 'Medallero',
      today: '{country} hoy',
      schedule: 'Programación',
      athletes: 'Atletas · {country}',
      history: 'Historial de medallas',
      edition: 'Edición',
      country: 'País',
      gold: 'Oro',
      silver: 'Plata',
      bronze: 'Bronce',
      total: 'Total',
      medalEvent: 'Por medalla',
      medalsToday: 'Medallas del día',
      noUnits: 'Ninguna prueba de {country} este día.',
      emptySchedule: 'Ninguna prueba este día.',
      noAthletes: 'Ningún atleta encontrado.',
      withheld: 'Medallero en revisión: las medallas de esta edición aún no están completas.',
      totals: 'Suma de {n} ediciones',
    },
    squad: {
      title: 'Plantel',
      positions: {
        Goalkeeper: 'Arqueros',
        Defender: 'Defensores',
        Midfielder: 'Mediocampistas',
        Attacker: 'Delanteros',
      },
      others: 'Otros',
      coaches: 'Entrenadores',
      age: '{age} años',
      players: '{n} jugadores',
      season: 'Temporada {year}',
      number: 'Camiseta {number}',
      empty: 'Plantel no disponible.',
    },
    player: {
      season: 'Temporada {year}',
      appearances: 'Partidos',
      goals: 'Goles',
      assists: 'Asistencias',
      minutes: 'Minutos',
      yellow: 'Amarillas',
      red: 'Rojas',
      rating: 'Nota',
      clubs: 'Clubes',
      seasons: 'Por temporada',
      trophies: 'Títulos',
      transfers: 'Transferencias',
      current: 'Actual',
      coach: 'Entrenador',
      age: '{age} años',
      apps: { one: '{n} partido', other: '{n} partidos' },
      goalsCount: { one: '{n} gol', other: '{n} goles' },
      more: 'y {count} más',
      empty: 'Sin partidos en esta temporada.',
      positions: {
        Goalkeeper: 'Arquero',
        Defender: 'Defensor',
        Midfielder: 'Mediocampista',
        Attacker: 'Delantero',
      },
      places: {
        Winner: 'Campeón',
        '2nd Place': 'Subcampeón',
        '3rd Place': 'Tercer puesto',
        '4th Place': 'Cuarto puesto',
      },
      transferTypes: {
        Loan: 'Préstamo',
        Free: 'Libre',
        'Back from Loan': 'Fin de préstamo',
        Transfer: 'Transferencia',
      },
    },
    transfers: {
      title: 'Altas y bajas del mercado',
      titleOf: 'Mercado · {name}',
      arrivals: 'Llegadas',
      departures: 'Salidas',
      in: 'Llegó',
      out: 'Salió',
      from: 'de {club}',
      to: 'a {club}',
      kind: {
        loan: 'Préstamo',
        loan_return: 'Vuelta de préstamo',
        free: 'Libre',
        fee: 'Compra',
        transfer: 'Definitiva',
      },
      empty: 'Ningún fichaje en el período.',
      pick: 'Elige un equipo o una competición.',
    },
    bracket: {
      title: 'Llaves',
      empty: 'Sin eliminatorias en esta temporada (todavía).',
      rounds: 'Fases',
      aggregate: 'Global',
      firstLeg: 'Ida',
      secondLeg: 'Vuelta',
      game: 'Partido {n}',
      series: 'Serie',
      penaltiesShort: 'pen.',
      tbd: 'Por definir',
      advanced: 'clasificado',
    },
  },
  en: {
    status: {
      scheduled: 'Scheduled',
      starting: 'Starting',
      live: 'Live',
      break: 'Half-time',
      finished: 'Full time',
      postponed: 'Postponed',
      cancelled: 'Cancelled',
      suspended: 'Suspended',
      abandoned: 'Abandoned',
    },
    loading: 'Loading…',
    error: "We couldn't load the data right now.",
    notFound: "We couldn't find this content.",
    missingKey: 'Set your Galaxie Sports publishable key.',
    invalidKey: 'Invalid or revoked publishable key.',
    forbidden: "This key doesn't unlock this content. Check the widget and plan in the Galaxie portal.",
    retry: 'Try again',
    versus: 'vs',
    penalties: 'pens',
    emptyLive: 'No live games right now.',
    emptyDay: 'No games on this date.',
    emptyStandings: 'Standings are not available yet.',
    emptyWatch: 'Broadcast not confirmed yet.',
    liveNow: 'Live now',
    todayGames: "Today's games",
    games: 'Games',
    results: 'Results',
    tomorrowGames: "Tomorrow's games",
    yesterdayGames: "Yesterday's games",
    upcomingGames: 'Upcoming games',
    todayResults: "Today's results",
    yesterdayResults: "Yesterday's results",
    referee: 'Referee',
    derby: 'Derby',
    standings: 'Standings',
    whereToWatch: 'Where to watch',
    toConfirm: 'Channel to be confirmed',
    watch: 'Watch',
    updated: 'Updated',
    columns: { team: 'Team', points: 'Pts', played: 'P', won: 'W', drawn: 'D', lost: 'L', goalDiff: 'GD' },
    zones: {
      libertadores: 'Libertadores',
      libertadores_group_stage: 'Libertadores (group stage)',
      libertadores_qualifying: 'Libertadores (qualifying)',
      sudamericana: 'Sudamericana',
      sudamericana_knockout_playoff: 'Sudamericana (play-offs)',
      champions_league: 'Champions League',
      champions_league_qualifying: 'Champions League (qualifying)',
      europa_league: 'Europa League',
      europa_league_knockout_playoff: 'Europa League (play-offs)',
      conference_league: 'Conference League',
      round_of_16: 'Round of 16',
      round_of_32: 'Round of 32',
      quarter_finals: 'Quarter-finals',
      knockout_playoff: 'Knockout play-offs',
      playoff: 'Play-offs',
      promotion: 'Promotion',
      relegation_playoff: 'Relegation play-off',
      relegation: 'Relegation',
      elimination: 'Elimination',
      playoffs: 'Play-offs',
      liguilla: 'Liguilla',
      quadrangulars: 'Quadrangulars',
      play_in: 'Play-in',
    },
    media: {
      free_tv: 'Free-to-air TV',
      pay_tv: 'Pay TV',
      streaming_svod: 'Streaming',
      streaming_free: 'Free streaming',
      youtube: 'YouTube',
      official_app: 'Official app',
      radio: 'Radio',
    },
    access: { free: 'Free', subscription: 'Subscription', ppv: 'Pay-per-view', unknown: '' },
    watchGroups: {
      freeTv: 'Free-to-air TV',
      payTv: 'Pay TV channels',
      alsoOn: 'Also available on',
      included: 'Included',
      addon: 'Add-on',
      includedServices: 'Streaming included',
      addonsAvailable: 'Available as an add-on',
      priceFrom: 'from {price}',
      free: 'free',
      yourOperator: 'Your operator',
      notInYourOperator: 'This match is not in the lineup of your operator.',
      toConfirmTitle: 'Channel for this match to be confirmed',
      toConfirmHint:
        'Rights holders in this country and where those channels are. The match channel is announced closer to kick-off.',
      toConfirmLiveHint: 'Rights holders in this country and where those channels are.',
      notConfirmedTitle: "We couldn't confirm the channel for this match",
      confirmedPre: 'On {channels}',
      confirmedLive: 'Live on {channels}',
      confirmedPost: 'Broadcast on {channels}',
      confirmedSource: 'Source: {publisher}',
      kind: {
        pay_tv_operator: 'Pay TV operator',
        vmvpd: 'Live TV streaming',
        telco_bundle: 'Telecom bundle with TV',
        streaming: 'Streaming',
      },
    },
    context: {
      title: 'Match context',
      scenario: 'Before the match',
      recap: 'After the match',
      empty: 'The context for this match is published closer to kick-off.',
      aiNote: 'Text generated with AI from the match data.',
    },
    stakes: {
      title: "What's at stake",
      empty: 'Nothing decisive at stake in this match.',
      cheer: 'Fan chant',
      derby: 'Derby',
    },
    videos: {
      title: 'Match videos',
      empty: 'Videos of this match show up here as soon as they are out.',
      play: 'Watch: {title}',
      close: 'Close video',
    },
    h2h: {
      title: 'Head to head',
      wins: 'Wins',
      draws: 'Draws',
      since: '{n} matches since {year}',
      played: '{n} matches',
      allTime: 'All-time: {n} matches',
      recent: 'Recent meetings',
      empty: 'These teams have not met yet.',
    },
    countdown: {
      startsIn: 'Starts in',
      starting: 'Starting soon',
      units: { d: 'days', h: 'hrs', m: 'min', s: 'sec' },
    },
    schedule: {
      title: 'Schedule',
      next: 'Upcoming matches',
      recent: 'Recent results',
      empty: 'No matches in the coming weeks.',
      home: 'Home',
      away: 'Away',
      result: { W: 'W', D: 'D', L: 'L' },
    },
    teamCard: {
      title: 'Team card',
      form: 'Recent form',
      next: 'Next match',
      live: 'Live',
      competitions: 'Competitions',
      noNext: 'No match scheduled.',
    },
    teamStats: {
      title: 'Team statistics',
      summary: 'Season summary',
      played: 'Played',
      won: 'Won',
      drawn: 'Drawn',
      lost: 'Lost',
      goalsFor: 'Goals for',
      goalsAgainst: 'Goals against',
      perGame: '{x} per game',
      form: 'Form',
      homeAway: 'Home and away',
      home: 'Home',
      away: 'Away',
      cleanSheets: 'Clean sheets',
      failedToScore: 'Failed to score',
      goalsByMinute: 'Goals by minute',
      scored: 'Scored',
      conceded: 'Conceded',
      minuteRange: "{from}–{to}'",
      unknownMinute: 'No minute',
      highlights: 'Streaks and biggest results',
      winStreak: 'Wins in a row',
      drawStreak: 'Draws in a row',
      lossStreak: 'Defeats in a row',
      biggestWin: 'Biggest win',
      biggestLoss: 'Biggest defeat',
      penalties: 'Penalties',
      penaltiesScored: '{scored} of {total}',
      formations: 'Most used formations',
      games: '{n} games',
      cards: 'Cards by minute',
      yellow: 'Yellow',
      red: 'Red',
      updated: 'Updated {date}',
      empty: 'No statistics for this team this season.',
    },
    extra: {
      referee: 'Referee',
      halftime: 'HT {home}–{away}',
      aggregate: 'Agg. {home}–{away}',
      venueTime: 'Local time: {time}',
      addToCalendar: 'Add to calendar',
      calendarShort: '+ Calendar',
      ownGoal: 'og',
      penalty: 'pen.',
      possession: 'Possession',
      shots: 'Shots',
      onTarget: 'On target',
      formation: 'Formation',
      goalsFor: 'GF',
      goalsAgainst: 'GA',
      form: 'Form',
      percentage: '%',
      leader: 'Leader',
      decisive: 'Decisive games',
      position: '#{rank} · {competition}',
      writtenAt: 'Written at {time}',
      intensity: 'Intensity',
    },
    sport: {
      period: { q: 'Q{n}', s: 'S{n}', h: 'H{n}', p: 'P{n}', i: '{n}', ot: 'OT', so: 'SO', extra: 'Extra' },
      total: 'T',
      units: {
        points: { for: 'PF', against: 'PA', diff: 'DIFF' },
        runs: { for: 'RS', against: 'RA', diff: 'DIFF' },
        sets: { for: 'SW', against: 'SL', diff: 'DIFF' },
      },
      otLosses: 'OTL',
      winPct: 'PCT',
      ratio: '%',
      rhe: { r: 'R', h: 'H', e: 'E' },
      gamesBehind: 'GB',
    },
    racing: {
      result: 'Result',
      weekend: 'Grand Prix weekend',
      calendar: 'Calendar',
      position: 'Pos',
      driver: 'Driver',
      team: 'Team',
      time: 'Time',
      grid: 'Grid',
      laps: 'Laps',
      pits: 'Stops',
      fastestLap: 'Fastest lap',
      points: 'Pts',
      wins: 'Wins',
      podiums: 'Podiums',
      poles: 'Poles',
      races: 'Races',
      titles: 'Titles',
      drivers: 'Drivers',
      constructors: 'Constructors',
      empty: 'Results appear when the session ends.',
      emptyCalendar: 'No races this season.',
      winner: 'Won by {name}',
      championship: 'P{n} in the championship',
      season: '{year} season',
      career: 'Career',
      bestFinish: 'Best finish',
      next: 'Next',
    },
    fights: {
      card: 'Fight card',
      mainEvent: 'Main event',
      segments: { main_card: 'Main card', prelims: 'Prelims', early_prelims: 'Early prelims' },
      roundTime: 'R{round} · {time}',
      scorecards: 'Judges: {cards}',
      record: 'Record',
      lastFights: 'Recent fights',
      upcoming: 'Upcoming events',
      empty: 'The card has not been announced yet.',
      emptyCalendar: 'No events scheduled.',
      recordValue: '{w}-{l}-{d}',
      win: 'W',
      loss: 'L',
      draw: 'D',
      versus: 'vs. {name}',
    },
    timeline: {
      title: 'Play by play',
      kinds: {
        goal: 'Goal',
        own_goal: 'Own goal',
        penalty_goal: 'Penalty goal',
        penalty_missed: 'Missed penalty',
        yellow_card: 'Yellow card',
        second_yellow: 'Second yellow',
        red_card: 'Red card',
        substitution: 'Substitution',
        var: 'VAR',
        shootout_scored: 'Penalty scored',
        shootout_missed: 'Penalty missed',
        other: 'Incident',
      },
      markers: {
        kickoff: 'Kick-off',
        halftime: 'Half-time',
        second_half: 'Second half',
        end_of_regulation: 'End of regulation',
        extra_time: 'Extra time',
        penalty_shootout: 'Penalty shootout',
        full_time: 'Full time',
      },
      var: {
        'goal cancelled': 'Goal disallowed',
        'goal confirmed': 'Goal confirmed',
        'goal disallowed': 'Goal disallowed',
        'goal disallowed - offside': 'Goal disallowed for offside',
        'goal disallowed - foul': 'Goal disallowed for a foul',
        'penalty confirmed': 'Penalty confirmed',
        'penalty cancelled': 'Penalty overturned',
        'penalty awarded': 'Penalty awarded',
        'card upgrade': 'Card upgraded to red',
        'card reviewed': 'Card reviewed',
        'red card cancelled': 'Red card overturned',
      },
      varReview: 'Review',
      assist: 'Assist: {name}',
      playerIn: 'On',
      playerOut: 'Off',
      empty: 'No incidents recorded for this match.',
      notStarted: 'Incidents show up here as soon as the match starts.',
    },
    equestrian: {
      results: 'Results',
      ranking: 'Ranking',
      calendar: 'Competition calendar',
      rider: 'Rider',
      horse: 'Horse',
      combination: 'Combination',
      faults: 'Faults',
      time: 'Time',
      prize: 'Prize',
      points: 'Pts',
      starts: 'Starts',
      wins: 'Wins',
      podiums: 'Podiums',
      horses: 'Horses',
      riders: 'Riders',
      recent: 'Latest results',
      pedigree: 'Pedigree',
      sire: 'Sire',
      dam: 'Dam',
      damSire: 'Dam sire',
      age: '{age} years old',
      gender: { mare: 'Mare', stallion: 'Stallion', gelding: 'Gelding', male: 'Male' },
      grandPrix: 'GP',
      empty: 'No results for this competition.',
      emptyCalendar: 'No competitions in this period.',
      emptyRanking: 'Ranking unavailable.',
    },
    prediction: {
      title: 'Match prediction',
      home: 'Home win',
      draw: 'Draw',
      away: 'Away win',
      wins: '{team} to win',
      winsOrDraws: '{team} to win or draw',
      open: 'No clear favourite',
      over: 'Over {line} goals',
      under: 'Under {line} goals',
      teamOver: '{team}: over {line} goals',
      teamUnder: '{team}: under {line} goals',
      goals: 'Goals',
      comparisonTitle: 'Comparison',
      comparison: {
        form: 'Form',
        attack: 'Attack',
        defense: 'Defence',
        poisson: 'Probability (Poisson)',
        h2h: 'Head to head',
        goals: 'Goals',
        total: 'Overall',
      },
      probabilities: 'Chance of each result',
      note: 'Statistical prediction based on both teams’ record.',
      empty: 'Prediction not available for this match yet.',
      updatedAt: 'Updated',
    },
    odds: {
      title: 'Match odds',
      markets: {
        match_winner: 'Full time result',
        double_chance: 'Double chance',
        goals_over_under: 'Total goals',
        both_teams_score: 'Both teams to score',
      },
      home: 'Home',
      draw: 'Draw',
      away: 'Away',
      homeDraw: 'Home or draw',
      homeAway: 'Home or away',
      drawAway: 'Draw or away',
      over: 'Over {line}',
      under: 'Under {line}',
      yes: 'Yes',
      no: 'No',
      best: 'Best {odd}',
      bookmakers: { one: 'Average of {n} bookmaker', other: 'Average of {n} bookmakers' },
      bookmakersShort: { one: '{n} bookmaker', other: '{n} bookmakers' },
      notice: '18+ · Please gamble responsibly.',
      empty: 'Odds not available for this match yet.',
      updatedAt: 'Updated',
    },
    leaders: {
      goals: 'Top scorers',
      assists: 'Assists',
      cards: 'Cards',
      goalsCol: 'Goals',
      assistsCol: 'Assists',
      player: 'Player',
      team: 'Team',
      appearances: 'GP',
      appearancesLong: 'Games',
      yellow: 'Yellow cards',
      red: 'Red cards',
      empty: 'Player stats for this competition are not available yet.',
      updatedAt: 'Updated',
    },
    olympics: {
      medals: 'Medal table',
      today: '{country} today',
      schedule: 'Schedule',
      athletes: 'Athletes · {country}',
      history: 'Medal history',
      edition: 'Games',
      country: 'Country',
      gold: 'Gold',
      silver: 'Silver',
      bronze: 'Bronze',
      total: 'Total',
      medalEvent: 'Medal event',
      medalsToday: 'Medals today',
      noUnits: 'No {country} events on this day.',
      emptySchedule: 'No events on this day.',
      noAthletes: 'No athletes found.',
      withheld: 'Medal table under review: this edition is not complete yet.',
      totals: 'Total of {n} Games',
    },
    squad: {
      title: 'Squad',
      positions: {
        Goalkeeper: 'Goalkeepers',
        Defender: 'Defenders',
        Midfielder: 'Midfielders',
        Attacker: 'Forwards',
      },
      others: 'Others',
      coaches: 'Coaches',
      age: 'Age {age}',
      players: '{n} players',
      season: '{year} season',
      number: 'Shirt {number}',
      empty: 'Squad not available.',
    },
    player: {
      season: '{year} season',
      appearances: 'Apps',
      goals: 'Goals',
      assists: 'Assists',
      minutes: 'Minutes',
      yellow: 'Yellow cards',
      red: 'Red cards',
      rating: 'Rating',
      clubs: 'Clubs',
      seasons: 'By season',
      trophies: 'Trophies',
      transfers: 'Transfers',
      current: 'Current',
      coach: 'Head coach',
      age: '{age} years old',
      apps: { one: '{n} app', other: '{n} apps' },
      goalsCount: { one: '{n} goal', other: '{n} goals' },
      more: 'and {count} more',
      empty: 'No matches this season.',
      positions: {
        Goalkeeper: 'Goalkeeper',
        Defender: 'Defender',
        Midfielder: 'Midfielder',
        Attacker: 'Forward',
      },
      places: {
        Winner: 'Winner',
        '2nd Place': 'Runner-up',
        '3rd Place': 'Third place',
        '4th Place': 'Fourth place',
      },
      transferTypes: {
        Loan: 'Loan',
        Free: 'Free transfer',
        'Back from Loan': 'Loan return',
        Transfer: 'Transfer',
      },
    },
    transfers: {
      title: 'Transfer market',
      titleOf: 'Transfers · {name}',
      arrivals: 'Arrivals',
      departures: 'Departures',
      in: 'In',
      out: 'Out',
      from: 'from {club}',
      to: 'to {club}',
      kind: {
        loan: 'Loan',
        loan_return: 'Loan return',
        free: 'Free',
        fee: 'Fee',
        transfer: 'Permanent',
      },
      empty: 'No transfers in this period.',
      pick: 'Choose a team or a competition.',
    },
    bracket: {
      title: 'Bracket',
      empty: 'No knockout rounds this season (yet).',
      rounds: 'Rounds',
      aggregate: 'Aggregate',
      firstLeg: '1st leg',
      secondLeg: '2nd leg',
      game: 'Game {n}',
      series: 'Series',
      penaltiesShort: 'pens',
      tbd: 'TBD',
      advanced: 'advanced',
    },
  },
};

export function textsFor(locale: WidgetLocale): WidgetTexts {
  return TEXTS[locale] ?? TEXTS['pt-BR'];
}

// ─── locale, fuso e datas ────────────────────────────────────────────────────────────────────────

const SPANISH_MARKETS = ['AR', 'MX', 'CO', 'CL', 'PE', 'UY', 'EC'];

/** Locale pedido à API (`?locale`): o espanhol segue o mercado; em inglês a API devolve o padrão. */
export function apiLocale(locale: WidgetLocale, market?: string | undefined): string | undefined {
  if (locale === 'pt-BR') return 'pt-BR';
  if (locale === 'es') {
    const m = market?.toUpperCase() ?? '';
    return SPANISH_MARKETS.includes(m) ? `es-${m}` : 'es-AR';
  }
  return undefined;
}

/** Locale do `Intl` (datas e horas). */
export function intlLocale(locale: WidgetLocale, market?: string | undefined): string {
  return locale === 'es' ? (apiLocale(locale, market) ?? 'es') : locale;
}

/** Fuso do navegador (IANA); undefined fora do navegador. */
export function localTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** Dia civil (AAAA-MM-DD) num fuso. */
export function isoDate(date: Date, timeZone?: string | undefined): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

// ─── eventos ─────────────────────────────────────────────────────────────────────────────────────

export const LIVE_STATUSES: ReadonlySet<GsEventStatus> = new Set(['live', 'break']);
export const STARTED_STATUSES: ReadonlySet<GsEventStatus> = new Set([
  'live',
  'break',
  'finished',
  'suspended',
  'abandoned',
]);
export const PROBLEM_STATUSES: ReadonlySet<GsEventStatus> = new Set([
  'postponed',
  'cancelled',
  'suspended',
  'abandoned',
]);

export function sidesOf(event: Pick<GsEvent, 'participants'>): {
  home: GsParticipant | undefined;
  away: GsParticipant | undefined;
} {
  const home = event.participants.find((p) => p.side === 'home') ?? event.participants[0];
  const away = event.participants.find((p) => p.side === 'away') ?? event.participants[1];
  return { home, away };
}

/** Minuto do jogo como o torcedor lê: 45+2'. */
export function clockText(clock: GsEvent['clock']): string | null {
  if (!clock?.minute) return null;
  return clock.extra ? `${clock.minute}+${clock.extra}'` : `${clock.minute}'`;
}

// ─── esportes (épico #731) ───────────────────────────────────────────────────────────────────────

/** Unidade do placar: muda os rótulos de pró, contra e saldo na tabela. */
export type SportScoreUnit = 'goals' | 'points' | 'runs' | 'sets';

/**
 * Como cada esporte conta: se há empate, se a tabela tem coluna de pontos (no basquete, beisebol e
 * futebol americano a classificação é por vitórias), quanto vale a vitória (para o aproveitamento), se há
 * derrota na prorrogação à parte (hóquei) e se o placar mostra as parciais por padrão.
 */
export interface SportProfile {
  sport: string;
  draws: boolean;
  /** Coluna de pontos na tabela. */
  points: boolean;
  /** Aproveitamento: % dos pontos (`points`, com `pointsPerWin`), % de vitórias (`wins`) ou pró ÷ contra (`ratio`, AFL). */
  percentage: 'points' | 'wins' | 'ratio';
  pointsPerWin: number;
  overtimeLosses: boolean;
  unit: SportScoreUnit;
  /** Parciais (sets, quartos, entradas) no placar por padrão. */
  periods: boolean;
}

const FOOTBALL_PROFILE: SportProfile = {
  sport: 'football',
  draws: true,
  points: true,
  percentage: 'points',
  pointsPerWin: 3,
  overtimeLosses: false,
  unit: 'goals',
  periods: false,
};

const SPORT_PROFILES: Record<string, Omit<SportProfile, 'sport'>> = {
  football: FOOTBALL_PROFILE,
  basketball: {
    ...FOOTBALL_PROFILE,
    draws: false,
    points: false,
    percentage: 'wins',
    unit: 'points',
    periods: true,
  },
  nba: {
    ...FOOTBALL_PROFILE,
    draws: false,
    points: false,
    percentage: 'wins',
    unit: 'points',
    periods: true,
  },
  baseball: {
    ...FOOTBALL_PROFILE,
    draws: false,
    points: false,
    percentage: 'wins',
    unit: 'runs',
    periods: true,
  },
  'american-football': {
    ...FOOTBALL_PROFILE,
    points: false,
    percentage: 'wins',
    unit: 'points',
    periods: true,
  },
  volleyball: { ...FOOTBALL_PROFILE, draws: false, percentage: 'wins', unit: 'sets', periods: true },
  hockey: { ...FOOTBALL_PROFILE, draws: false, pointsPerWin: 2, overtimeLosses: true, periods: true },
  handball: { ...FOOTBALL_PROFILE, pointsPerWin: 2, periods: true },
  rugby: { ...FOOTBALL_PROFILE, percentage: 'wins', unit: 'points', periods: true },
  afl: { ...FOOTBALL_PROFILE, percentage: 'ratio', pointsPerWin: 4, unit: 'points', periods: true },
};

/** Esportes coletivos de placar (casa × fora) que os widgets de jogo e tabela atendem. */
export const TEAM_SPORTS = Object.keys(SPORT_PROFILES);

/** Perfil do esporte; desconhecido ou ausente = futebol (o comportamento de antes). */
export function sportProfile(sport: string | null | undefined): SportProfile {
  const known = sport ? SPORT_PROFILES[sport] : undefined;
  return known ? { ...known, sport: sport! } : FOOTBALL_PROFILE;
}

/** Rótulos de pró, contra e saldo da tabela na unidade do esporte. */
export function unitLabels(
  unit: SportScoreUnit,
  texts: WidgetTexts,
): { for: string; against: string; diff: string } {
  if (unit === 'goals')
    return { for: texts.extra.goalsFor, against: texts.extra.goalsAgainst, diff: texts.columns.goalDiff };
  return texts.sport.units[unit];
}

/**
 * Aproveitamento da linha da tabela, já formatado: % dos pontos disputados, % de vitórias (empate vale
 * meia, como na NFL) ou, na AFL, pontos pró ÷ contra × 100 com uma casa. null sem jogos.
 */
export function standingPercentage(
  row: Pick<GsStandingRow, 'points' | 'played' | 'won' | 'drawn' | 'goals_for' | 'goals_against'>,
  profile: SportProfile,
): string | null {
  if (profile.percentage === 'ratio') {
    const against = row.goals_against ?? 0;
    return against > 0 ? (((row.goals_for ?? 0) / against) * 100).toFixed(1) : null;
  }
  if (row.played <= 0) return null;
  const share =
    profile.percentage === 'wins'
      ? (row.won + row.drawn / 2) / row.played
      : row.points / (row.played * profile.pointsPerWin);
  return String(Math.round(share * 100));
}

/**
 * Jogos atrás do líder do grupo (beisebol, "GB"): ((V do líder − V) + (D − D do líder)) ÷ 2. O líder e
 * quem está empatado com ele: "–".
 */
export function gamesBehind(
  row: Pick<GsStandingRow, 'won' | 'lost'>,
  leader: Pick<GsStandingRow, 'won' | 'lost'> | undefined,
): string {
  if (!leader) return '–';
  const gb = (leader.won - row.won + (row.lost - leader.lost)) / 2;
  return gb <= 0 ? '–' : gb % 1 ? gb.toFixed(1) : String(gb);
}

/**
 * Código de parcial da API (`q1`, `s2`, `h1`, `p3`, `i7`, `ot`, `ot2`, `so`, `extra`) a partir do período
 * do relógio do fornecedor (`Q3`, `S2`, `1H`, `P1`, `IN5`, `OT`); null quando não é um período de jogo
 * (intervalo, encerrado) ou é o do futebol (`first_half`…), que tem minuto.
 */
export function periodCodeOf(raw: string | null | undefined): string | null {
  const p = (raw ?? '').trim().toUpperCase();
  let m = /^(Q|S|P)(\d)$/.exec(p);
  if (m) return `${m[1]!.toLowerCase()}${m[2]}`;
  m = /^IN(\d{1,2})$/.exec(p);
  if (m) return `i${Number(m[1])}`;
  m = /^([12])H$/.exec(p);
  if (m) return `h${m[1]}`;
  m = /^OT(\d)?$/.exec(p);
  if (m) return m[1] && m[1] !== '1' ? `ot${m[1]}` : 'ot';
  if (p === 'PT' || p === 'SO' || p === 'AP') return 'so';
  return null;
}

/** Rótulo curto de uma parcial ("2Q", "S3", "1T", "P1", "7", "Prorr."); código desconhecido sai como veio. */
export function periodLabel(code: string, texts: WidgetTexts): string {
  const t = texts.sport.period;
  const m = /^([qshpi])(\d{1,2})$/.exec(code);
  if (m) return fillText(t[m[1] as 'q' | 's' | 'h' | 'p' | 'i'], { n: Number(m[2]) });
  const ot = /^ot(\d)?$/.exec(code);
  if (ot) return ot[1] && ot[1] !== '1' ? `${t.ot} ${ot[1]}` : t.ot;
  if (code === 'so') return t.so;
  if (code === 'extra') return t.extra;
  return code.toUpperCase();
}

/**
 * Relógio ao vivo no selo: o minuto no futebol (`67'`); nos outros esportes, a parcial em andamento e o
 * minuto quando o fornecedor manda ("3Q", "P2 12'", "S4"). null sem relógio.
 */
export function liveClockText(
  event: Pick<GsEvent, 'clock'> & { sport?: string | undefined },
  texts: WidgetTexts,
): string | null {
  if (!event.sport || event.sport === 'football') return clockText(event.clock);
  const code = periodCodeOf(event.clock?.period);
  const minute = event.clock?.minute ? `${event.clock.minute}'` : null;
  return [code ? periodLabel(code, texts) : null, minute].filter(Boolean).join(' ') || null;
}

/** Placar da AFL "12.14 (86)": gols.behinds (pontos); null sem gols e behinds. */
export function aflScoreText(
  gb: GsGoalsBehinds | undefined,
  side: 'home' | 'away',
  points: number | null,
): string | null {
  const g = gb?.[side];
  if (!g || g.goals === null || g.behinds === null) return null;
  return `${g.goals}.${g.behinds}${points !== null ? ` (${points})` : ''}`;
}

export function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 3).toUpperCase();
  return words
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

const MINUTE = 60_000;
/** Teto do despertar de um jogo distante: o horário pode mudar (e a página fica aberta por dias). */
const SCHEDULED_WAKE_MAX_MS = 6 * 60 * MINUTE;
/** Antecipação máxima do despertar, para os widgets da mesma rodada não chamarem todos no mesmo segundo. */
const SCHEDULED_WAKE_JITTER_MS = 2 * MINUTE;

/** Antecipação estável por evento (hash FNV-1a do id): o mesmo jogo acorda sempre no mesmo instante. */
function wakeJitterMs(id: string | undefined): number {
  if (!id) return 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return (h >>> 0) % SCHEDULED_WAKE_JITTER_MS;
}

/**
 * Polling do placar: 30 s com bola rolando, 1 min perto do início, nada depois do fim. Jogo agendado
 * mais longe acorda quando entra na janela de 30 min (até 2 min antes, conforme o id; no máximo a cada
 * 6 h), para não ficar parado.
 */
export function eventRefreshMs(
  event: Pick<GsEvent, 'status' | 'starts_at'> & { id?: string | undefined },
  now = Date.now(),
): number | null {
  if (LIVE_STATUSES.has(event.status) || event.status === 'starting') return 30_000;
  if (event.status === 'scheduled') {
    const until = Date.parse(event.starts_at) - now;
    if (!Number.isFinite(until)) return null;
    if (until < 30 * MINUTE) return MINUTE;
    const wake = until - 30 * MINUTE - wakeJitterMs(event.id);
    return Math.min(Math.max(wake, MINUTE), SCHEDULED_WAKE_MAX_MS);
  }
  return null;
}

/** Onde assistir nas últimas 24 h: o canal costuma sair (ou mudar) perto do jogo. */
const WATCH_NEAR_MS = 5 * MINUTE;
/** A partir de quando o onde assistir passa a ser reconsultado de 5 em 5 minutos. */
const WATCH_NEAR_WINDOW_MS = 24 * 60 * MINUTE;
/** Teto do intervalo com o canal "a confirmar" e o jogo a mais de 24 h. */
const WATCH_TO_CONFIRM_MAX_MS = 60 * MINUTE;

/**
 * Próxima consulta do onde assistir da contagem (`countdown`), pela distância até o jogo: 5 min nas
 * últimas 24 h; antes disso, acorda quando entra nessa janela (até 2 min antes, conforme o id; no
 * máximo a cada 6 h, ou a cada hora com o canal "a confirmar"). "Vai começar": 5 min; jogo que começou: para.
 */
export function watchRefreshMs(
  event: Pick<GsEvent, 'status' | 'starts_at'> & { id?: string | undefined },
  toConfirm: boolean,
  now = Date.now(),
): number | null {
  if (event.status === 'starting') return WATCH_NEAR_MS;
  if (event.status !== 'scheduled') return null;
  const until = Date.parse(event.starts_at) - now;
  if (!Number.isFinite(until)) return null;
  if (until <= WATCH_NEAR_WINDOW_MS) return WATCH_NEAR_MS;
  const wake = until - WATCH_NEAR_WINDOW_MS - wakeJitterMs(event.id);
  const cap = toConfirm ? WATCH_TO_CONFIRM_MAX_MS : SCHEDULED_WAKE_MAX_MS;
  return Math.min(Math.max(wake, MINUTE), cap);
}

/**
 * Partes da contagem regressiva (widget `countdown`) para `ms` até o início. Arredonda para cima, para
 * zerar só na hora do jogo: com segundos, 1,5 s vira 2 s; sem eles, 30 s ainda é 1 min.
 */
export function countdownParts(
  ms: number,
  withSeconds = true,
): { days: number; hours: number; minutes: number; seconds: number } {
  const total = Math.max(0, withSeconds ? Math.ceil(ms / 1000) : Math.ceil(ms / MINUTE) * 60);
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

// ─── textos da API e modelos ─────────────────────────────────────────────────────────────────────

/** Rótulo de `{ "pt-BR": "…" }`: o locale pedido, senão o primeiro que vier (a API manda um só). */
export function localized(text: GsLocalizedText | null | undefined, locale?: string | undefined): string {
  if (!text) return '';
  return (locale && text[locale]) || Object.values(text)[0] || '';
}

/** Troca `{chave}` no modelo de texto. */
/** Escapa texto para uma linha de iCalendar (RFC 5545 §3.3.11). */
const icsText = (v: string) => v.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');
const icsDate = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

/**
 * Arquivo de calendário de um jogo (VCALENDAR com um VEVENT, horários em UTC), montado no navegador: o
 * `.ics` da API pede a chave no header, e um link de download não manda header. Duração estimada: 2 horas.
 */
export function eventIcs(event: GsEvent, now: Date = new Date()): string {
  const start = new Date(event.starts_at);
  const end = new Date(start.getTime() + 2 * 3_600_000);
  const names = event.participants.map((p) => p.name).join(' x ');
  const summary = event.competition ? `${names} (${event.competition.name})` : names;
  const location = event.venue ? [event.venue.name, event.venue.city].filter(Boolean).join(', ') : '';
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Galaxie Sports//Widgets//PT',
    'BEGIN:VEVENT',
    `UID:${event.id}@galaxie.sports`,
    `DTSTAMP:${icsDate(now)}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(summary)}`,
    ...(location ? [`LOCATION:${icsText(location)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

/** Bandeira em emoji a partir do código ISO de 2 letras (sem código: vazio). */
export function flagEmoji(iso2: string | null | undefined): string {
  if (!iso2 || !/^[a-z]{2}$/i.test(iso2)) return '';
  return String.fromCodePoint(...[...iso2.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

/**
 * Edição dos Jogos que o widget mostra quando não há uma escolhida: a que está em andamento; senão a
 * última encerrada; senão a próxima.
 */
export function pickCurrentGames<T extends Pick<GsGames, 'status' | 'start_date'>>(
  list: readonly T[],
): T | null {
  const byStart = [...list].sort((a, b) => a.start_date.localeCompare(b.start_date));
  return (
    byStart.find((g) => g.status === 'in_progress') ??
    byStart.filter((g) => g.status === 'completed').pop() ??
    byStart.find((g) => g.status === 'upcoming') ??
    null
  );
}

/** Faltas e tempo de um conjunto no hipismo ("4 · 72.31s"); sem decomposição, o placar bruto. */
export function eqScoreText(score: GsEqResult['score']): string {
  const parts = [
    score.penalties != null ? String(score.penalties) : null,
    score.time_seconds != null ? `${score.time_seconds.toFixed(2)}s` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : (score.raw ?? '–');
}

/** Hora do jogo no fuso do estádio, quando o fuso é conhecido e difere do de quem vê; senão null. */
export function venueTimeText(
  event: Pick<GsEvent, 'starts_at' | 'venue'>,
  locale: string,
  viewerZone: string | undefined,
): string | null {
  const zone = event.venue?.timezone;
  if (!zone) return null;
  const d = new Date(event.starts_at);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const f = (timeZone: string | undefined) =>
      new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone }).format(d);
    const there = f(zone);
    return there === f(viewerZone) ? null : there;
  } catch {
    return null;
  }
}

export function fillText(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Texto com singular e plural ("1 jogo", "2 jogos"); `{n}` recebe o número. */
export interface PluralText {
  one: string;
  other: string;
}

/**
 * Escolhe a forma pelo `Intl.PluralRules` do idioma e preenche `{n}` (já formatado, quando `format` vem).
 * Formas que o texto não tem (`few`, `many`…) caem no `other`. O zero vai sempre no plural: o CLDR do
 * português põe o 0 em `one`, mas o uso é "0 gols", não "0 gol".
 */
export function pluralText(
  text: PluralText,
  n: number,
  intl: string,
  format: (n: number) => string = String,
): string {
  const rule = n === 0 ? 'other' : new Intl.PluralRules(intl).select(n);
  return fillText(rule === 'one' ? text.one : text.other, { n: format(n) });
}

/** Duração do vídeo: 1:05:09, 4:32, 0:45. */
export function durationText(seconds: number | null | undefined): string | null {
  if (!seconds || seconds < 0) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Resultado do time num jogo encerrado: V, E ou D (null antes do fim ou sem o time). */
export function teamResult(event: GsEvent, teamId: string): 'W' | 'D' | 'L' | null {
  if (event.status !== 'finished') return null;
  const me = event.participants.find((p) => p.id === teamId);
  if (!me) return null;
  if (me.winner === true) return 'W';
  if (me.winner === false) return 'L';
  return 'D';
}

/**
 * Player incorporável só de endereço https do YouTube (o único provedor do conteúdo relacionado), para
 * o iframe nunca apontar para outra origem vinda da rede.
 */
export function safeEmbedUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    if (!/^(www\.)?youtube(-nocookie)?\.com$/.test(u.hostname)) return null;
    return u.href;
  } catch {
    return null;
  }
}

/** Imagem da rede: http(s) ou `data:image/` (as miniaturas e os escudos dos dados de exemplo). */
export function safeImage(url: string | null | undefined): string | null {
  return url?.startsWith('data:image/') ? url : safeLink(url);
}

/** Link externo só http(s) (nada de `javascript:` vindo da rede). */
export function safeLink(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}
