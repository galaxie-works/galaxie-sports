// @galaxie/widgets — widgets React da Galaxie Sports e o gerador do item de registry shadcn do Builder.

// modelo (sem React; seguro em Server Components)
export {
  BROADCAST_MEDIA,
  DEFAULT_THEMES,
  DEFAULT_ZONE_COLORS,
  LIVE_LIST_FIELDS,
  LIVE_LIST_FIELD_DEFAULTS,
  LIVE_LIST_DAYS,
  LIVE_LIST_LIMIT,
  LIVE_LIST_MODES,
  LIVE_LIST_ORDERS,
  LIVE_LIST_TEAM_NAMES,
  isEventLinkTemplate,
  PUBLISHABLE_KEY_HEADER,
  STANDINGS_ZONE_TONES,
  THEME_PRESET_IDS,
  THEME_PRESET_LABELS,
  WIDGET_CSS,
  WIDGET_KINDS,
  WIDGET_LOCALES,
  parseLiveListOptions,
  parseStandingsOptions,
  readableOn,
  standingsZoneColor,
  standingsZoneLabel,
  standingsZoneTone,
  textsFor,
  themeToCssVars,
  type GsCssVars,
  type GsEvent,
  type GsEventContext,
  type GsHeadToHead,
  type GsEventSidelined,
  type GsSidelinedPlayer,
  type GsTeamSidelined,
  type GsRelated,
  type GsStandings,
  type GsCompetitionLeaders,
  type GsLeaderCategory,
  type GsLeaderRow,
  LEADER_CATEGORIES,
  type GsBracket,
  BRACKET_PHASES,
  type GsWhereToWatch,
  type LiveListDay,
  type LiveListField,
  type LiveListMode,
  type LiveListOrder,
  type LiveListTeamName,
  type LiveListOptions,
  type StandingsOptions,
  type StandingsZoneColors,
  type StandingsZoneTone,
  type ThemePresetId,
  type WidgetConfig,
  type WidgetDefaults,
  type WidgetDensity,
  type WidgetKind,
  type WidgetLocale,
  type WidgetMode,
  type WidgetTexts,
  type WidgetTheme,
  TEAM_SPORTS,
  sportProfile,
  type SportProfile,
  type SportScoreUnit,
} from './core/model.js';

// componentes (client components)
export {
  GalaxieWidgetError,
  GalaxieWidgetProvider,
  useGalaxieWidget,
  type GalaxieWidgetProviderProps,
} from './core/react.js';
export { MatchCard, type MatchCardProps } from './widgets/match-card.js';
export { LiveList, type LiveListProps } from './widgets/live-list.js';
export {
  SCORE_TICKER_LIMIT,
  ScoreTicker,
  type ScoreTickerMode,
  type ScoreTickerProps,
  type ScoreTickerSpeed,
} from './widgets/score-ticker.js';
export { StandingsTable, type StandingsTableProps } from './widgets/standings-table.js';
export { WhereToWatch, type WhereToWatchProps } from './widgets/where-to-watch.js';
export { AiContext, type AiContextProps } from './widgets/ai-context.js';
export { MatchStakes, type MatchStakesProps } from './widgets/match-stakes.js';
export { RelatedVideos, type RelatedVideosProps } from './widgets/related-videos.js';
export { HeadToHead, type HeadToHeadProps } from './widgets/head-to-head.js';
export { TeamSchedule, type TeamScheduleProps } from './widgets/team-schedule.js';
export { TeamCard, type TeamCardProps } from './widgets/team-card.js';
export { RaceResult, type RaceResultProps } from './widgets/race-result.js';
export { RaceWeekend, type RaceWeekendProps } from './widgets/race-weekend.js';
export { SeasonCalendar, type SeasonCalendarProps } from './widgets/season-calendar.js';
export { AthleteProfile, type AthleteProfileProps } from './widgets/athlete-profile.js';
export { FightCard, type FightCardProps } from './widgets/fight-card.js';
export { MatchTimeline, type MatchTimelineProps } from './widgets/match-timeline.js';
export { EquestrianResults, type EquestrianResultsProps } from './widgets/equestrian-results.js';
export { EquestrianRanking, type EquestrianRankingProps } from './widgets/equestrian-ranking.js';
export { EquestrianCalendar, type EquestrianCalendarProps } from './widgets/equestrian-calendar.js';
export { RiderProfile, type RiderProfileProps } from './widgets/rider-profile.js';
export { HorseProfile, type HorseProfileProps } from './widgets/horse-profile.js';
export { MedalTable, type MedalTableProps } from './widgets/medal-table.js';
export {
  MATCH_STATS_DEFAULT_ORDER,
  MatchStats,
  matchStatRows,
  type MatchStatRow,
  type MatchStatsProps,
} from './widgets/match-stats.js';
export { CountryToday, type CountryTodayProps } from './widgets/country-today.js';
export { GamesSchedule, type GamesScheduleProps } from './widgets/games-schedule.js';
export { CountryAthletes, type CountryAthletesProps } from './widgets/country-athletes.js';
export { MedalHistory, type MedalHistoryProps } from './widgets/medal-history.js';
export { Sidelined, type SidelinedProps } from './widgets/sidelined.js';
export { ChampionsGallery, type ChampionsGalleryProps } from './widgets/champions-gallery.js';
export { CompetitionLeaders, type CompetitionLeadersProps } from './widgets/competition-leaders.js';
export { Countdown, type CountdownProps } from './widgets/countdown.js';
export { TeamSquad, type TeamSquadProps } from './widgets/team-squad.js';
export { PlayerProfile, type PlayerProfileProps } from './widgets/player-profile.js';
export { Lineups, type LineupsProps, type GsEventLineups } from './widgets/lineups.js';
export { MatchPrediction, type MatchPredictionProps } from './widgets/match-prediction.js';
export { MatchOdds, type MatchOddsProps } from './widgets/match-odds.js';
export { TeamStats, type TeamStatsProps } from './widgets/team-stats.js';
export {
  TransferMarket,
  type TransferMarketDirection,
  type TransferMarketProps,
} from './widgets/transfer-market.js';
export { Bracket, type BracketPhase, type BracketProps } from './widgets/bracket.js';
export { ChannelGuide, type ChannelGuideProps } from './widgets/channel-guide.js';

// opções de conteúdo de cada widget (Builder, embed e registry)
export {
  CHANNEL_GUIDE_MAX_CHANNELS,
  GAMES_NOCS,
  VIDEO_TYPES,
  WIDGET_OPTIONS,
  widgetOptionsFor,
  optionProps,
  parseChannelNames,
  parseWidgetOptions,
  publicWidgetOptions,
  type LookupSource,
  type WidgetOptionSpec,
  type WidgetOptions,
} from './options.js';

// catálogo, preview e registry
export {
  WIDGET_CATALOG,
  widgetKindIsAllSports,
  widgetKindIsMultiSport,
  widgetKindSupportsSport,
  type WidgetCatalogEntry,
  type WidgetPropsByKind,
} from './catalog.js';
export { PREVIEW_CHANNELS } from './fixtures-channel-guide.js';
export { PREVIEW_IDS, createPreviewFetch, createPreviewFixtures, type PreviewFixtures } from './fixtures.js';
export {
  PUBLISHABLE_KEY_ENV,
  REGISTRY_ITEM_SCHEMA_URL,
  buildRegistryItem,
  toRegistryName,
  type BuildRegistryItemInput,
  type RegistryItem,
  type RegistryItemFile,
} from './registry/build-registry-item.js';
