import { TEAM_SPORTS, type WidgetKind, type WidgetLocale } from './core/model.js';
import { PREVIEW_IDS } from './fixtures.js';
import type { AiContextProps } from './widgets/ai-context.js';
import type { HeadToHeadProps } from './widgets/head-to-head.js';
import type { LiveListProps } from './widgets/live-list.js';
import type { MatchCardProps } from './widgets/match-card.js';
import type { MatchStakesProps } from './widgets/match-stakes.js';
import type { RelatedVideosProps } from './widgets/related-videos.js';
import type { StandingsTableProps } from './widgets/standings-table.js';
import type { TeamScheduleProps } from './widgets/team-schedule.js';
import type { AthleteProfileProps } from './widgets/athlete-profile.js';
import type { FightCardProps } from './widgets/fight-card.js';
import type { RaceResultProps } from './widgets/race-result.js';
import type { RaceWeekendProps } from './widgets/race-weekend.js';
import type { SeasonCalendarProps } from './widgets/season-calendar.js';
import type { WhereToWatchProps } from './widgets/where-to-watch.js';

export interface WidgetPropsByKind {
  match_card: MatchCardProps;
  live_list: LiveListProps;
  standings: StandingsTableProps;
  where_to_watch: WhereToWatchProps;
  ai_context: AiContextProps;
  match_stakes: MatchStakesProps;
  related_videos: RelatedVideosProps;
  head_to_head: HeadToHeadProps;
  team_schedule: TeamScheduleProps;
  race_result: RaceResultProps;
  race_weekend: RaceWeekendProps;
  season_calendar: SeasonCalendarProps;
  athlete_profile: AthleteProfileProps;
  fight_card: FightCardProps;
}

export interface WidgetCatalogEntry<K extends WidgetKind = WidgetKind> {
  kind: K;
  /** Componente React do pacote. */
  component:
    | 'MatchCard'
    | 'LiveList'
    | 'StandingsTable'
    | 'WhereToWatch'
    | 'AiContext'
    | 'MatchStakes'
    | 'RelatedVideos'
    | 'HeadToHead'
    | 'TeamSchedule'
    | 'RaceResult'
    | 'RaceWeekend'
    | 'SeasonCalendar'
    | 'AthleteProfile'
    | 'FightCard';
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
