import { TEAM_SPORTS, type WidgetKind, type WidgetLocale } from './core/model.js';
import { PREVIEW_IDS } from './fixtures.js';
import type { AiContextProps } from './widgets/ai-context.js';
import type { HeadToHeadProps } from './widgets/head-to-head.js';
import type { LiveListProps } from './widgets/live-list.js';
import type { ScoreTickerProps } from './widgets/score-ticker.js';
import type { MatchCardProps } from './widgets/match-card.js';
import type { MatchTimelineProps } from './widgets/match-timeline.js';
import type { MatchStakesProps } from './widgets/match-stakes.js';
import type { RelatedVideosProps } from './widgets/related-videos.js';
import type { StandingsTableProps } from './widgets/standings-table.js';
import type { TeamScheduleProps } from './widgets/team-schedule.js';
import type { TeamCardProps } from './widgets/team-card.js';
import type { AthleteProfileProps } from './widgets/athlete-profile.js';
import type { FightCardProps } from './widgets/fight-card.js';
import type { RaceResultProps } from './widgets/race-result.js';
import type { RaceWeekendProps } from './widgets/race-weekend.js';
import type { SeasonCalendarProps } from './widgets/season-calendar.js';
import type { WhereToWatchProps } from './widgets/where-to-watch.js';
import type { EquestrianResultsProps } from './widgets/equestrian-results.js';
import type { EquestrianRankingProps } from './widgets/equestrian-ranking.js';
import type { EquestrianCalendarProps } from './widgets/equestrian-calendar.js';
import type { RiderProfileProps } from './widgets/rider-profile.js';
import type { HorseProfileProps } from './widgets/horse-profile.js';
import type { MedalTableProps } from './widgets/medal-table.js';
import type { CountryTodayProps } from './widgets/country-today.js';
import type { GamesScheduleProps } from './widgets/games-schedule.js';
import type { CountryAthletesProps } from './widgets/country-athletes.js';
import type { MedalHistoryProps } from './widgets/medal-history.js';
import type { SidelinedProps } from './widgets/sidelined.js';
import type { ChampionsGalleryProps } from './widgets/champions-gallery.js';
import type { CountdownProps } from './widgets/countdown.js';
import type { TeamSquadProps } from './widgets/team-squad.js';
import type { PlayerProfileProps } from './widgets/player-profile.js';
import type { LineupsProps } from './widgets/lineups.js';

import type { CompetitionLeadersProps } from './widgets/competition-leaders.js';
import type { TransferMarketProps } from './widgets/transfer-market.js';

export interface WidgetPropsByKind {
  match_card: MatchCardProps;
  match_timeline: MatchTimelineProps;
  live_list: LiveListProps;
  score_ticker: ScoreTickerProps;
  standings: StandingsTableProps;
  where_to_watch: WhereToWatchProps;
  ai_context: AiContextProps;
  match_stakes: MatchStakesProps;
  related_videos: RelatedVideosProps;
  head_to_head: HeadToHeadProps;
  team_schedule: TeamScheduleProps;
  team_card: TeamCardProps;
  race_result: RaceResultProps;
  race_weekend: RaceWeekendProps;
  season_calendar: SeasonCalendarProps;
  athlete_profile: AthleteProfileProps;
  fight_card: FightCardProps;
  equestrian_results: EquestrianResultsProps;
  equestrian_ranking: EquestrianRankingProps;
  equestrian_calendar: EquestrianCalendarProps;
  rider_profile: RiderProfileProps;
  horse_profile: HorseProfileProps;
  medal_table: MedalTableProps;
  country_today: CountryTodayProps;
  games_schedule: GamesScheduleProps;
  country_athletes: CountryAthletesProps;
  medal_history: MedalHistoryProps;
  sidelined: SidelinedProps;
  champions_gallery: ChampionsGalleryProps;
  countdown: CountdownProps;
  team_squad: TeamSquadProps;
  player_profile: PlayerProfileProps;
  lineups: LineupsProps;
  competition_leaders: CompetitionLeadersProps;
  transfer_market: TransferMarketProps;
}

export interface WidgetCatalogEntry<K extends WidgetKind = WidgetKind> {
  kind: K;
  /** Componente React do pacote. */
  component:
    | 'MatchCard'
    | 'MatchTimeline'
    | 'LiveList'
    | 'ScoreTicker'
    | 'StandingsTable'
    | 'WhereToWatch'
    | 'AiContext'
    | 'MatchStakes'
    | 'RelatedVideos'
    | 'HeadToHead'
    | 'TeamSchedule'
    | 'TeamCard'
    | 'RaceResult'
    | 'RaceWeekend'
    | 'SeasonCalendar'
    | 'AthleteProfile'
    | 'FightCard'
    | 'EquestrianResults'
    | 'EquestrianRanking'
    | 'EquestrianCalendar'
    | 'RiderProfile'
    | 'HorseProfile'
    | 'MedalTable'
    | 'CountryToday'
    | 'GamesSchedule'
    | 'CountryAthletes'
    | 'MedalHistory'
    | 'Sidelined'
    | 'ChampionsGallery'
    | 'Countdown'
    | 'TeamSquad'
    | 'PlayerProfile'
    | 'Lineups'
    | 'CompetitionLeaders'
    | 'TransferMarket';
  /** Componente que o arquivo instalado pelo registry exporta (com provider e tema embutidos). */
  registryComponent: string;
  name: Record<WidgetLocale, string>;
  description: Record<WidgetLocale, string>;
  requiredProps: readonly (keyof WidgetPropsByKind[K] & string)[];
  optionalProps: readonly (keyof WidgetPropsByKind[K] & string)[];
  /** Props do preview no Builder. Os ids batem com `createPreviewFetch` (dados de exemplo). */
  exampleProps: WidgetPropsByKind[K];
  /** Atualiza sozinho enquanto há jogo ao vivo. */
  polling: boolean;
  /**
   * Esportes da API em que o tipo vale (`football`, `basketball`, `formula-1`...). Lista vazia = todos.
   * O catálogo do Builder mostra o tipo só na aba dos esportes dele (épico #731): cada esporte entra
   * aqui quando o widget estiver adaptado a ele (placar, termos e colunas). Placar, tabela, confronto,
   * agenda e onde assistir valem para os esportes coletivos (`TEAM_SPORTS`, com o perfil de cada um).
   */
  sports: readonly string[];
}

/** Corridas e lutas: os tipos novos do épico #731 (F1 #737, MMA #738). */
const F1_ONLY = ['formula-1'] as const;
const MMA_ONLY = ['mma'] as const;
/** Hipismo e Olimpíadas/Pan: fora do espelho da api-sports, com rotas próprias (#732 e seguintes). */
const EQUESTRIAN_ONLY = ['equestrian'] as const;
const MULTISPORT_ONLY = ['multisport'] as const;
/** Placar, onde assistir: os coletivos, a sessão da F1 (onde assistir) e a luta de MMA. */
const EVENT_SPORTS = [...TEAM_SPORTS, 'formula-1', 'mma'] as const;

/** Tipos ainda só do futebol (IA, "o que está em jogo" e vídeos dependem de dados que só o futebol tem). */
const FOOTBALL_ONLY = ['football'] as const;

export const WIDGET_CATALOG: { [K in WidgetKind]: WidgetCatalogEntry<K> } = {
  match_card: {
    kind: 'match_card',
    component: 'MatchCard',
    registryComponent: 'GalaxieMatchCard',
    name: { 'pt-BR': 'Placar do jogo', es: 'Marcador del partido', en: 'Match card' },
    description: {
      'pt-BR': 'Escudos, placar, minuto ao vivo, competição e horário local de um jogo.',
      es: 'Escudos, marcador, minuto en vivo, competición y horario local de un partido.',
      en: 'Crests, score, live minute, competition and local kick-off time for one match.',
    },
    requiredProps: ['eventId'],
    optionalProps: [
      'showCompetition',
      'showCompetitionLogo',
      'showCountry',
      'showRound',
      'showVenue',
      'showCity',
      'showReferee',
      'showHalftime',
      'showAggregate',
      'showPeriods',
      'venueTime',
      'showGoals',
      'showRedCards',
      'showStats',
      'showFormation',
      'showCalendar',
    ],
    exampleProps: { eventId: PREVIEW_IDS.liveEvent },
    polling: true,
    sports: [...TEAM_SPORTS, 'mma'],
  },
  match_timeline: {
    kind: 'match_timeline',
    component: 'MatchTimeline',
    registryComponent: 'GalaxieMatchTimeline',
    name: { 'pt-BR': 'Lance a lance', es: 'Minuto a minuto', en: 'Play by play' },
    description: {
      'pt-BR':
        'Gols, cartões, substituições, VAR e demais lances do jogo, minuto a minuto, atualizando sozinho durante a partida.',
      es: 'Goles, tarjetas, cambios, VAR y demás jugadas del partido, minuto a minuto, actualizándose solo durante el juego.',
      en: 'Goals, cards, substitutions, VAR and every other incident, minute by minute, updating itself during the match.',
    },
    requiredProps: ['eventId'],
    optionalProps: ['order', 'types', 'limit', 'showMarkers', 'showAssists', 'showMatch'],
    exampleProps: { eventId: PREVIEW_IDS.liveEvent },
    polling: true,
    sports: TEAM_SPORTS,
  },
  live_list: {
    kind: 'live_list',
    component: 'LiveList',
    registryComponent: 'GalaxieLiveList',
    name: { 'pt-BR': 'Jogos do dia', es: 'Partidos del día', en: "Today's games" },
    description: {
      'pt-BR': 'Jogos do dia ou só os ao vivo, por competição, atualizando enquanto a bola rola.',
      es: 'Partidos del día o solo los en vivo, por competición, actualizándose mientras se juega.',
      en: "The day's games or only live ones, grouped by competition, refreshing while play is on.",
    },
    requiredProps: [],
    optionalProps: [
      'competitionId',
      'sport',
      'date',
      'limit',
      'teamId',
      'mode',
      'day',
      'order',
      'minRelevance',
      'country',
      'teamName',
      'eventLink',
      'eventLinkNewTab',
      'groupByCompetition',
      'autoRefresh',
      'showCompetitionLogo',
      'showRound',
      'showVenue',
      'showCity',
      'showDerby',
      'showStakes',
      'showReferee',
      'showPenalties',
    ],
    exampleProps: { sport: 'football' },
    polling: true,
    sports: [],
  },
  score_ticker: {
    kind: 'score_ticker',
    component: 'ScoreTicker',
    registryComponent: 'GalaxieScoreTicker',
    name: { 'pt-BR': 'Faixa de placares', es: 'Cintillo de marcadores', en: 'Score ticker' },
    description: {
      'pt-BR': 'Placares ao vivo correndo numa faixa na parte de baixo da tela, para emissoras e apps de TV.',
      es: 'Marcadores en vivo corriendo en un cintillo en la parte inferior de la pantalla, para canales y apps de TV.',
      en: 'Live scores scrolling in a strip along the bottom of the screen, for broadcasters and TV apps.',
    },
    requiredProps: [],
    optionalProps: [
      'competitionId',
      'sport',
      'mode',
      'speed',
      'transparent',
      'showLabel',
      'showCompetition',
      'showCrests',
      'teamName',
      'limit',
    ],
    exampleProps: { sport: 'football' },
    polling: true,
    sports: [],
  },
  standings: {
    kind: 'standings',
    component: 'StandingsTable',
    registryComponent: 'GalaxieStandingsTable',
    name: { 'pt-BR': 'Tabela de classificação', es: 'Tabla de posiciones', en: 'Standings table' },
    description: {
      'pt-BR': 'Classificação da competição, por grupo, com a zona de classificação destacada.',
      es: 'Tabla de la competición, por grupo, con la zona de clasificación destacada.',
      en: 'Competition standings by group, with the qualification zone highlighted.',
    },
    requiredProps: ['competitionId'],
    optionalProps: [
      'season',
      'limit',
      'showLegend',
      'zoneColors',
      'table',
      'showGoalsFor',
      'showGoalsAgainst',
      'showGoalDiff',
      'showForm',
      'showPercentage',
      'highlightTeamId',
      'showDecisive',
      'raceTable',
    ],
    exampleProps: { competitionId: PREVIEW_IDS.competition, season: 'current' },
    polling: false,
    sports: [...TEAM_SPORTS, 'formula-1'],
  },
  where_to_watch: {
    kind: 'where_to_watch',
    component: 'WhereToWatch',
    registryComponent: 'GalaxieWhereToWatch',
    name: { 'pt-BR': 'Onde assistir', es: 'Dónde ver', en: 'Where to watch' },
    description: {
      'pt-BR':
        'Onde assistir o jogo no país: TV aberta, canais pagos e "disponível também em", com o plano de cada operadora ou streaming, os canais e os streamings inclusos.',
      es: 'Dónde ver el partido en el país: TV abierta, canales pagos y "disponible también en", con el plan de cada operadora o streaming, los canales y los streamings incluidos.',
      en: 'Where to watch the match in a country: free-to-air TV, pay TV channels and "also available on", with each operator or streaming plan, its channels and included streaming.',
    },
    requiredProps: ['eventId', 'market'],
    optionalProps: ['region', 'showAddonPrices', 'showWatchLinks', 'showCalendar'],
    exampleProps: { eventId: PREVIEW_IDS.liveEvent, market: 'BR' },
    polling: false,
    sports: EVENT_SPORTS,
  },
  ai_context: {
    kind: 'ai_context',
    component: 'AiContext',
    registryComponent: 'GalaxieAiContext',
    name: { 'pt-BR': 'Contexto de IA', es: 'Contexto con IA', en: 'AI match context' },
    description: {
      'pt-BR':
        'O cenário antes do jogo e o resumo depois do apito, escritos com IA a partir dos dados da partida.',
      es: 'El panorama antes del partido y el resumen después del pitazo, escritos con IA a partir de los datos.',
      en: 'The pre-match outlook and the post-match recap, written with AI from the match data.',
    },
    requiredProps: ['eventId'],
    optionalProps: ['show', 'showHeader', 'showGeneratedAt'],
    exampleProps: { eventId: PREVIEW_IDS.scheduledEvent },
    polling: false,
    sports: FOOTBALL_ONLY,
  },
  match_stakes: {
    kind: 'match_stakes',
    component: 'MatchStakes',
    registryComponent: 'GalaxieMatchStakes',
    name: { 'pt-BR': 'O que está em jogo', es: 'Qué está en juego', en: "What's at stake" },
    description: {
      'pt-BR':
        'A voz do torcedor: o que cada time precisa no jogo, as tags da torcida ("Na briga pelo título") e o grito da arquibancada.',
      es: 'La voz del hincha: qué necesita cada equipo, las etiquetas de la hinchada ("En la pelea por el título") y el grito de la tribuna.',
      en: 'The fan voice: what each team needs, fan tags ("In the title race") and the chant from the stands.',
    },
    requiredProps: ['eventId'],
    optionalProps: [
      'stakes',
      'showFanTags',
      'showCheer',
      'showDerbyIntensity',
      'showResultStakes',
      'showCompetitionContext',
    ],
    exampleProps: { eventId: PREVIEW_IDS.scheduledEvent },
    polling: true,
    sports: FOOTBALL_ONLY,
  },
  related_videos: {
    kind: 'related_videos',
    component: 'RelatedVideos',
    registryComponent: 'GalaxieRelatedVideos',
    name: { 'pt-BR': 'Vídeos do jogo', es: 'Videos del partido', en: 'Match videos' },
    description: {
      'pt-BR':
        'Melhores momentos, gols, entrevistas e reações de canais oficiais e da imprensa, tocando no player oficial.',
      es: 'Mejores momentos, goles, entrevistas y reacciones de canales oficiales y de la prensa, en el reproductor oficial.',
      en: 'Highlights, goals, interviews and reactions from official channels and the press, in the official player.',
    },
    requiredProps: ['eventId'],
    optionalProps: ['limit', 'format', 'types', 'showDuration', 'showChannel', 'showDate'],
    exampleProps: { eventId: PREVIEW_IDS.finishedEvent },
    polling: false,
    sports: FOOTBALL_ONLY,
  },
  head_to_head: {
    kind: 'head_to_head',
    component: 'HeadToHead',
    registryComponent: 'GalaxieHeadToHead',
    name: { 'pt-BR': 'Confronto direto', es: 'Historial', en: 'Head to head' },
    description: {
      'pt-BR': 'O retrospecto entre os dois times do jogo (vitórias, empates) e os últimos confrontos.',
      es: 'El historial entre los dos equipos del partido (victorias, empates) y los últimos enfrentamientos.',
      en: 'The record between both teams (wins, draws) and their most recent meetings.',
    },
    requiredProps: ['eventId'],
    optionalProps: ['limit', 'showBar', 'showMeetingCompetition', 'showDerbyName'],
    exampleProps: { eventId: PREVIEW_IDS.scheduledEvent },
    polling: false,
    sports: TEAM_SPORTS,
  },
  team_schedule: {
    kind: 'team_schedule',
    component: 'TeamSchedule',
    registryComponent: 'GalaxieTeamSchedule',
    name: { 'pt-BR': 'Agenda do time', es: 'Agenda del equipo', en: 'Team schedule' },
    description: {
      'pt-BR': 'Os próximos jogos de um clube, com horário local, e os últimos resultados com V/E/D.',
      es: 'Los próximos partidos de un club, con horario local, y los últimos resultados con G/E/P.',
      en: "A club's upcoming matches in local time and its latest results with W/D/L.",
    },
    requiredProps: ['teamId'],
    optionalProps: [
      'next',
      'recent',
      'competitionId',
      'showCompetitionLogo',
      'showRound',
      'showVenue',
      'showCity',
      'showStanding',
      'showCalendar',
    ],
    exampleProps: { teamId: PREVIEW_IDS.team },
    polling: true,
    sports: TEAM_SPORTS,
  },
  team_card: {
    kind: 'team_card',
    component: 'TeamCard',
    registryComponent: 'GalaxieTeamCard',
    name: { 'pt-BR': 'Cartão do time', es: 'Ficha del equipo', en: 'Team card' },
    description: {
      'pt-BR': 'Escudo, forma recente (V/E/D), o próximo jogo e os campeonatos que o time disputa.',
      es: 'Escudo, forma reciente (G/E/P), el próximo partido y las competiciones que disputa el equipo.',
      en: 'Crest, recent form (W/D/L), the next match and the competitions the team is playing in.',
    },
    requiredProps: ['teamId'],
    optionalProps: ['showForm', 'formCount', 'showNext', 'showCompetitions', 'competitionsLimit'],
    exampleProps: { teamId: PREVIEW_IDS.team },
    polling: true,
    sports: TEAM_SPORTS,
  },
  race_result: {
    kind: 'race_result',
    component: 'RaceResult',
    registryComponent: 'GalaxieRaceResult',
    name: { 'pt-BR': 'Resultado da corrida', es: 'Resultado de la carrera', en: 'Race result' },
    description: {
      'pt-BR': 'Chegada de uma sessão da F1: posição, piloto, equipe, tempo, largada e volta mais rápida.',
      es: 'Clasificación de una sesión de F1: posición, piloto, equipo, tiempo, salida y vuelta rápida.',
      en: 'Classification of an F1 session: position, driver, team, time, grid and fastest lap.',
    },
    requiredProps: ['eventId'],
    optionalProps: ['limit', 'showTeam', 'showGrid', 'showPits', 'showFastestLap'],
    exampleProps: { eventId: PREVIEW_IDS.raceEvent },
    polling: true,
    sports: F1_ONLY,
  },
  race_weekend: {
    kind: 'race_weekend',
    component: 'RaceWeekend',
    registryComponent: 'GalaxieRaceWeekend',
    name: { 'pt-BR': 'Fim de semana do GP', es: 'Fin de semana del GP', en: 'Grand Prix weekend' },
    description: {
      'pt-BR':
        'Treinos, classificação, sprint e corrida do GP, no horário do leitor, com o vencedor de cada.',
      es: 'Prácticas, clasificación, sprint y carrera del GP, en el horario del lector, con el ganador de cada una.',
      en: "Practice, qualifying, sprint and race sessions in the reader's time, with each session winner.",
    },
    requiredProps: ['eventId'],
    optionalProps: ['showWinners', 'showVenue', 'showCalendar'],
    exampleProps: { eventId: PREVIEW_IDS.raceEvent },
    polling: true,
    sports: F1_ONLY,
  },
  season_calendar: {
    kind: 'season_calendar',
    component: 'SeasonCalendar',
    registryComponent: 'GalaxieSeasonCalendar',
    name: { 'pt-BR': 'Calendário', es: 'Calendario', en: 'Calendar' },
    description: {
      'pt-BR':
        'Os GPs da temporada da F1 com os vencedores, ou os próximos eventos de MMA com a luta principal.',
      es: 'Los GP de la temporada de F1 con los ganadores, o los próximos eventos de MMA con la pelea estelar.',
      en: 'The F1 season with each Grand Prix winner, or upcoming MMA events with their main event.',
    },
    requiredProps: ['competitionId'],
    optionalProps: ['range', 'limit', 'showWinners', 'showVenue'],
    exampleProps: { competitionId: PREVIEW_IDS.raceCompetition },
    polling: true,
    sports: [...F1_ONLY, ...MMA_ONLY],
  },
  athlete_profile: {
    kind: 'athlete_profile',
    component: 'AthleteProfile',
    registryComponent: 'GalaxieAthleteProfile',
    name: { 'pt-BR': 'Perfil do atleta', es: 'Perfil del atleta', en: 'Athlete profile' },
    description: {
      'pt-BR':
        'Piloto da F1 com a temporada e a carreira, ou lutador de MMA com o cartel e as últimas lutas.',
      es: 'Piloto de F1 con la temporada y la carrera, o peleador de MMA con su récord y sus últimas peleas.',
      en: 'An F1 driver with season and career numbers, or an MMA fighter with record and recent fights.',
    },
    requiredProps: ['teamId'],
    optionalProps: ['showCareer', 'showCurrent', 'recent'],
    exampleProps: { teamId: PREVIEW_IDS.driver },
    polling: false,
    sports: [...F1_ONLY, ...MMA_ONLY],
  },
  fight_card: {
    kind: 'fight_card',
    component: 'FightCard',
    registryComponent: 'GalaxieFightCard',
    name: { 'pt-BR': 'Card do evento', es: 'Cartelera', en: 'Fight card' },
    description: {
      'pt-BR': 'As lutas de um evento de MMA, do card principal às preliminares, com o desfecho de cada uma.',
      es: 'Las peleas de un evento de MMA, de la cartelera principal a las preliminares, con cada resultado.',
      en: 'Every bout of an MMA event, from the main card to the prelims, with each result.',
    },
    requiredProps: ['eventId'],
    optionalProps: ['showPrelims', 'showWeightClass', 'showResults'],
    exampleProps: { eventId: PREVIEW_IDS.fightEvent },
    polling: true,
    sports: MMA_ONLY,
  },
  equestrian_results: {
    kind: 'equestrian_results',
    component: 'EquestrianResults',
    registryComponent: 'GalaxieEquestrianResults',
    name: { 'pt-BR': 'Resultado da prova', es: 'Resultado de la prueba', en: 'Competition result' },
    description: {
      'pt-BR':
        'Classificação de uma prova de salto: cavaleiro, cavalo, faltas e tempo, como a federação publicou.',
      es: 'Clasificación de una prueba de salto: jinete, caballo, faltas y tiempo, como lo publicó la federación.',
      en: 'Show jumping standings: rider, horse, faults and time, as published by the federation.',
    },
    requiredProps: [],
    optionalProps: ['competitionId', 'limit', 'showHorse', 'showScore', 'showPrize'],
    exampleProps: { competitionId: PREVIEW_IDS.eqCompetition },
    polling: false,
    sports: EQUESTRIAN_ONLY,
  },
  equestrian_ranking: {
    kind: 'equestrian_ranking',
    component: 'EquestrianRanking',
    registryComponent: 'GalaxieEquestrianRanking',
    name: { 'pt-BR': 'Ranking do hipismo', es: 'Ranking de hípica', en: 'Equestrian ranking' },
    description: {
      'pt-BR': 'Os cavaleiros nos rankings observados, com a bandeira, o cavalo e os pontos.',
      es: 'Los jinetes en los rankings observados, con la bandera, el caballo y los puntos.',
      en: 'Riders in the observed rankings, with flag, horse and points.',
    },
    requiredProps: [],
    optionalProps: ['limit', 'showHorse', 'showPoints'],
    exampleProps: {},
    polling: false,
    sports: EQUESTRIAN_ONLY,
  },
  equestrian_calendar: {
    kind: 'equestrian_calendar',
    component: 'EquestrianCalendar',
    registryComponent: 'GalaxieEquestrianCalendar',
    name: { 'pt-BR': 'Calendário de provas', es: 'Calendario de pruebas', en: 'Competition calendar' },
    description: {
      'pt-BR': 'As próximas provas de salto com o nível (CSI5*, CSIO) e o local, ou as últimas disputadas.',
      es: 'Las próximas pruebas de salto con el nivel (CSI5*, CSIO) y el lugar, o las últimas disputadas.',
      en: 'Upcoming show jumping competitions with level (CSI5*, CSIO) and venue, or the latest ones.',
    },
    requiredProps: [],
    optionalProps: ['range', 'limit', 'grandPrixOnly', 'showVenue'],
    exampleProps: {},
    polling: false,
    sports: EQUESTRIAN_ONLY,
  },
  rider_profile: {
    kind: 'rider_profile',
    component: 'RiderProfile',
    registryComponent: 'GalaxieRiderProfile',
    name: { 'pt-BR': 'Perfil do cavaleiro', es: 'Perfil del jinete', en: 'Rider profile' },
    description: {
      'pt-BR':
        'Cavaleiro com o país, provas, vitórias e pódios, os cavalos, o ranking e os últimos resultados.',
      es: 'Jinete con el país, pruebas, victorias y podios, los caballos, el ranking y los últimos resultados.',
      en: 'A rider with country, starts, wins and podiums, horses, ranking and latest results.',
    },
    requiredProps: [],
    optionalProps: ['athleteId', 'horses', 'recent', 'showRankings'],
    exampleProps: { athleteId: PREVIEW_IDS.eqAthlete },
    polling: false,
    sports: EQUESTRIAN_ONLY,
  },
  horse_profile: {
    kind: 'horse_profile',
    component: 'HorseProfile',
    registryComponent: 'GalaxieHorseProfile',
    name: { 'pt-BR': 'Perfil do cavalo', es: 'Perfil del caballo', en: 'Horse profile' },
    description: {
      'pt-BR': 'Cavalo com raça, idade e pelagem, o pedigree, quem o monta e os últimos resultados.',
      es: 'Caballo con raza, edad y pelaje, el pedigrí, quién lo monta y los últimos resultados.',
      en: 'A horse with breed, age and coat, pedigree, riders and latest results.',
    },
    requiredProps: [],
    optionalProps: ['horseId', 'showPedigree', 'showRiders', 'recent'],
    exampleProps: { horseId: PREVIEW_IDS.eqHorse },
    polling: false,
    sports: EQUESTRIAN_ONLY,
  },
  medal_table: {
    kind: 'medal_table',
    component: 'MedalTable',
    registryComponent: 'GalaxieMedalTable',
    name: { 'pt-BR': 'Quadro de medalhas', es: 'Medallero', en: 'Medal table' },
    description: {
      'pt-BR':
        'O quadro de medalhas da Olimpíada ou do Pan, por ouros ou pelo total, com o país em destaque.',
      es: 'El medallero de los Juegos Olímpicos o Panamericanos, por oros o total, con el país destacado.',
      en: 'The Olympic or Pan American medal table, by golds or total, with a highlighted country.',
    },
    requiredProps: [],
    optionalProps: ['games', 'sort', 'region', 'limit', 'highlight'],
    exampleProps: { games: PREVIEW_IDS.games },
    polling: true,
    sports: MULTISPORT_ONLY,
  },
  country_today: {
    kind: 'country_today',
    component: 'CountryToday',
    registryComponent: 'GalaxieCountryToday',
    name: { 'pt-BR': 'País hoje nos Jogos', es: 'País hoy en los Juegos', en: 'Country today at the Games' },
    description: {
      'pt-BR':
        '"Brasil hoje": as provas do país no dia, no horário do leitor, as que valem medalha e as medalhas do dia.',
      es: '"Brasil hoy": las pruebas del país en el día, en el horario del lector, las que dan medalla y las medallas del día.',
      en: '"Brazil today": the country’s events of the day in local time, medal events and the medals won.',
    },
    requiredProps: [],
    optionalProps: ['games', 'noc', 'showMedals', 'medalOnly'],
    exampleProps: { games: PREVIEW_IDS.games, noc: 'BRA' },
    polling: true,
    sports: MULTISPORT_ONLY,
  },
  games_schedule: {
    kind: 'games_schedule',
    component: 'GamesSchedule',
    registryComponent: 'GalaxieGamesSchedule',
    name: { 'pt-BR': 'Programação dos Jogos', es: 'Programación de los Juegos', en: 'Games schedule' },
    description: {
      'pt-BR':
        'As provas do dia em todas as modalidades, com fase, local, a ao vivo em destaque e as que valem medalha.',
      es: 'Las pruebas del día en todos los deportes, con fase, lugar, la en vivo destacada y las que dan medalla.',
      en: 'The day’s events across all sports, with phase, venue, live events and medal events.',
    },
    requiredProps: [],
    optionalProps: ['games', 'medalOnly', 'limit', 'showVenue'],
    exampleProps: { games: PREVIEW_IDS.games },
    polling: true,
    sports: MULTISPORT_ONLY,
  },
  country_athletes: {
    kind: 'country_athletes',
    component: 'CountryAthletes',
    registryComponent: 'GalaxieCountryAthletes',
    name: { 'pt-BR': 'Atletas do país', es: 'Atletas del país', en: 'Country athletes' },
    description: {
      'pt-BR':
        'Os atletas do país na edição, os medalhistas primeiro, com as medalhas e as provas de cada um.',
      es: 'Los atletas del país en la edición, los medallistas primero, con las medallas y las pruebas de cada uno.',
      en: 'The country’s athletes at the Games, medallists first, with each one’s medals and events.',
    },
    requiredProps: [],
    optionalProps: ['games', 'noc', 'medalistsOnly', 'limit'],
    exampleProps: { games: PREVIEW_IDS.games, noc: 'BRA' },
    polling: false,
    sports: MULTISPORT_ONLY,
  },
  medal_history: {
    kind: 'medal_history',
    component: 'MedalHistory',
    registryComponent: 'GalaxieMedalHistory',
    name: { 'pt-BR': 'Histórico de medalhas', es: 'Historial de medallas', en: 'Medal history' },
    description: {
      'pt-BR': 'As medalhas do país em cada Olimpíada e Pan, da mais recente para trás, com a soma de todas.',
      es: 'Las medallas del país en cada Juego Olímpico y Panamericano, del más reciente hacia atrás, con la suma.',
      en: 'The country’s medals at each Olympic and Pan American Games, most recent first, with the total.',
    },
    requiredProps: [],
    optionalProps: ['noc', 'type', 'season', 'limit'],
    exampleProps: { noc: 'BRA' },
    polling: false,
    sports: MULTISPORT_ONLY,
  },
  sidelined: {
    kind: 'sidelined',
    component: 'Sidelined',
    registryComponent: 'GalaxieSidelined',
    name: { 'pt-BR': 'Desfalques', es: 'Bajas', en: 'Absences' },
    description: {
      'pt-BR':
        'Lesionados, suspensos e dúvidas de cada time antes do jogo, com o motivo e a previsão de volta.',
      es: 'Lesionados, sancionados y dudas de cada equipo antes del partido, con el motivo y la vuelta prevista.',
      en: 'Injured, suspended and doubtful players for each team before the match, with the reason and return date.',
    },
    requiredProps: [],
    optionalProps: ['eventId', 'teamId', 'showReason', 'showReturn', 'showPhoto', 'showDoubtful', 'limit'],
    exampleProps: { eventId: PREVIEW_IDS.scheduledEvent },
    polling: false,
    sports: FOOTBALL_ONLY,
  },
  champions_gallery: {
    kind: 'champions_gallery',
    component: 'ChampionsGallery',
    registryComponent: 'GalaxieChampionsGallery',
    name: { 'pt-BR': 'Galeria de campeões', es: 'Galería de campeones', en: 'Roll of honour' },
    description: {
      'pt-BR':
        'Quem ganhou cada edição do campeonato, ano a ano, com o escudo, o vice e o ranking de quem tem mais títulos.',
      es: 'Quién ganó cada edición del torneo, año a año, con el escudo, el subcampeón y el ranking de más títulos.',
      en: 'Who won each edition of the competition, year by year, with the crest, the runner-up and the most titles.',
    },
    requiredProps: ['competitionId'],
    optionalProps: ['limit', 'showRanking', 'rankingLimit', 'showRunnerUp'],
    exampleProps: { competitionId: PREVIEW_IDS.competition },
    polling: false,
    // só o futebol tem lista de campeões importada (Wikidata); abrir aos outros esportes quando houver fonte
    sports: FOOTBALL_ONLY,
  },
  countdown: {
    kind: 'countdown',
    component: 'Countdown',
    registryComponent: 'GalaxieCountdown',
    name: { 'pt-BR': 'Contagem regressiva', es: 'Cuenta regresiva', en: 'Countdown' },
    description: {
      'pt-BR':
        'Tempo até o jogo começar, com escudos, campeonato e onde assistir. Na hora do jogo, vira o placar ao vivo.',
      es: 'Tiempo hasta que empiece el partido, con escudos, competición y dónde verlo. Al empezar, pasa a ser el marcador en vivo.',
      en: 'Time left until kick-off, with crests, competition and where to watch. Once the match starts, it turns into the live score.',
    },
    requiredProps: ['eventId'],
    optionalProps: ['showWatch', 'showSeconds', 'onStart'],
    exampleProps: { eventId: PREVIEW_IDS.scheduledEvent },
    polling: true,
    // um lado contra o outro: os coletivos e a luta (na F1 não há mandante e visitante)
    sports: [...TEAM_SPORTS, 'mma'],
  },
  team_squad: {
    kind: 'team_squad',
    component: 'TeamSquad',
    registryComponent: 'GalaxieTeamSquad',
    name: { 'pt-BR': 'Elenco do time', es: 'Plantel del equipo', en: 'Team squad' },
    description: {
      'pt-BR': 'Os jogadores do clube por posição, com foto, número, idade e nacionalidade, e os técnicos.',
      es: 'Los jugadores del club por posición, con foto, número, edad y nacionalidad, y los entrenadores.',
      en: "A club's players by position, with photo, shirt number, age and nationality, plus the coaches.",
    },
    requiredProps: ['teamId'],
    optionalProps: [
      'season',
      'showPhotos',
      'groupByPosition',
      'showNumber',
      'showAge',
      'showNationality',
      'showCoaches',
    ],
    exampleProps: { teamId: PREVIEW_IDS.team },
    polling: false,
    sports: FOOTBALL_ONLY,
  },
  player_profile: {
    kind: 'player_profile',
    component: 'PlayerProfile',
    registryComponent: 'GalaxiePlayerProfile',
    name: { 'pt-BR': 'Ficha do jogador', es: 'Ficha del jugador', en: 'Player profile' },
    description: {
      'pt-BR':
        'Jogador com o clube atual, os números da temporada, os clubes, as temporadas, os títulos e as transferências.',
      es: 'Jugador con el club actual, los números de la temporada, los clubes, las temporadas, los títulos y los traspasos.',
      en: 'A player with current club, season numbers, clubs, seasons, trophies and transfers.',
    },
    requiredProps: ['personId'],
    optionalProps: [
      'season',
      'showStats',
      'showClubs',
      'showSeasons',
      'showTrophies',
      'showTransfers',
      'limit',
    ],
    exampleProps: { personId: PREVIEW_IDS.person },
    polling: false,
    sports: FOOTBALL_ONLY,
  },
  lineups: {
    kind: 'lineups',
    component: 'Lineups',
    registryComponent: 'GalaxieLineups',
    name: { 'pt-BR': 'Escalações', es: 'Alineaciones', en: 'Lineups' },
    description: {
      'pt-BR':
        'Os dois times no desenho do campo, com titulares, reservas e técnico, assim que forem divulgados.',
      es: 'Los dos equipos dibujados en la cancha, con titulares, suplentes y entrenador, apenas se confirman.',
      en: 'Both teams drawn on the pitch, with starters, substitutes and head coach, as soon as they are announced.',
    },
    requiredProps: ['eventId'],
    optionalProps: ['view', 'team', 'showSubstitutes', 'showCoach'],
    exampleProps: { eventId: PREVIEW_IDS.liveEvent },
    polling: true,
    sports: FOOTBALL_ONLY,
  },
  competition_leaders: {
    kind: 'competition_leaders',
    component: 'CompetitionLeaders',
    registryComponent: 'GalaxieCompetitionLeaders',
    name: {
      'pt-BR': 'Artilharia e líderes',
      es: 'Goleadores y líderes',
      en: 'Top scorers and leaders',
    },
    description: {
      'pt-BR': 'Artilheiros, líderes de assistências ou de cartões do campeonato, com o escudo do time.',
      es: 'Goleadores, líderes de asistencias o de tarjetas de la competición, con el escudo del equipo.',
      en: 'Top scorers, assist leaders or most-booked players in the competition, with the team crest.',
    },
    requiredProps: ['competitionId'],
    optionalProps: [
      'season',
      'category',
      'limit',
      'showPhoto',
      'showTeam',
      'showAppearances',
      'highlightTeamId',
    ],
    exampleProps: { competitionId: PREVIEW_IDS.competition, season: 'current' },
    polling: false,
    sports: FOOTBALL_ONLY,
  },
  transfer_market: {
    kind: 'transfer_market',
    component: 'TransferMarket',
    registryComponent: 'GalaxieTransferMarket',
    name: { 'pt-BR': 'Vai e vem do mercado', es: 'Altas y bajas del mercado', en: 'Transfer market' },
    description: {
      'pt-BR':
        'Contratações e saídas recentes de um time ou de um campeonato, com data, clube de origem ou destino e tipo.',
      es: 'Fichajes y salidas recientes de un equipo o de una competición, con fecha, club de origen o destino y tipo.',
      en: 'Recent signings and departures for a team or a competition, with date, origin or destination club and type.',
    },
    requiredProps: [],
    optionalProps: [
      'teamId',
      'competitionId',
      'direction',
      'days',
      'limit',
      'groupByDirection',
      'showType',
      'showPhoto',
      'showDate',
    ],
    exampleProps: { teamId: PREVIEW_IDS.team },
    polling: false,
    sports: FOOTBALL_ONLY,
  },
};

/** O tipo vale para o esporte (lista vazia no catálogo = todos os esportes). */
export function widgetKindSupportsSport(kind: WidgetKind, sport: string): boolean {
  const sports = WIDGET_CATALOG[kind].sports;
  return sports.length === 0 || sports.includes(sport);
}

/**
 * O tipo vale para mais de um esporte: o Builder pergunta o esporte (filtra a busca e a prévia) e o grava
 * no widget. Nos de um esporte só, ele é implícito.
 */
export const widgetKindIsMultiSport = (kind: WidgetKind): boolean => WIDGET_CATALOG[kind].sports.length !== 1;

/** O tipo vale para todos os esportes (o widget pode mostrar todos de uma vez: "Todos os esportes"). */
export const widgetKindIsAllSports = (kind: WidgetKind): boolean => WIDGET_CATALOG[kind].sports.length === 0;
