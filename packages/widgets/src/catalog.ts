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
    | 'TeamSchedule';
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
    ],
    exampleProps: { competitionId: PREVIEW_IDS.competition, season: 'current' },
    polling: false,
    sports: TEAM_SPORTS,
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
    sports: TEAM_SPORTS,
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
