import type { WidgetKind, WidgetLocale } from './core/model.js';
import { PREVIEW_IDS } from './fixtures.js';
import type { LiveListProps } from './widgets/live-list.js';
import type { MatchCardProps } from './widgets/match-card.js';
import type { StandingsTableProps } from './widgets/standings-table.js';
import type { WhereToWatchProps } from './widgets/where-to-watch.js';

export interface WidgetPropsByKind {
  match_card: MatchCardProps;
  live_list: LiveListProps;
  standings: StandingsTableProps;
  where_to_watch: WhereToWatchProps;
}

export interface WidgetCatalogEntry<K extends WidgetKind = WidgetKind> {
  kind: K;
  /** Componente React do pacote. */
  component: 'MatchCard' | 'LiveList' | 'StandingsTable' | 'WhereToWatch';
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
}

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
    optionalProps: [],
    exampleProps: { eventId: PREVIEW_IDS.liveEvent },
    polling: true,
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
    optionalProps: ['competitionId', 'sport', 'date', 'limit'],
    exampleProps: { sport: 'football' },
    polling: true,
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
    optionalProps: ['season', 'limit'],
    exampleProps: { competitionId: PREVIEW_IDS.competition, season: 'current' },
    polling: false,
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
    optionalProps: ['region'],
    exampleProps: { eventId: PREVIEW_IDS.liveEvent, market: 'BR' },
    polling: false,
  },
};
