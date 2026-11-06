// @galaxie/widgets — widgets React da Galaxie Sports e o gerador do item de registry shadcn do Builder.

// modelo (sem React; seguro em Server Components)
export {
  BROADCAST_MEDIA,
  DEFAULT_THEMES,
  DEFAULT_ZONE_COLORS,
  LIVE_LIST_FIELDS,
  LIVE_LIST_FIELD_DEFAULTS,
  LIVE_LIST_LIMIT,
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
  type GsRelated,
  type GsStandings,
  type GsWhereToWatch,
  type LiveListField,
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
export { StandingsTable, type StandingsTableProps } from './widgets/standings-table.js';
export { WhereToWatch, type WhereToWatchProps } from './widgets/where-to-watch.js';
export { AiContext, type AiContextProps } from './widgets/ai-context.js';
export { MatchStakes, type MatchStakesProps } from './widgets/match-stakes.js';
export { RelatedVideos, type RelatedVideosProps } from './widgets/related-videos.js';
export { HeadToHead, type HeadToHeadProps } from './widgets/head-to-head.js';
export { TeamSchedule, type TeamScheduleProps } from './widgets/team-schedule.js';

// opções de conteúdo de cada widget (Builder, embed e registry)
export {
  VIDEO_TYPES,
  WIDGET_OPTIONS,
  optionProps,
  parseWidgetOptions,
  type WidgetOptionSpec,
  type WidgetOptions,
} from './options.js';

// catálogo, preview e registry
export { WIDGET_CATALOG, type WidgetCatalogEntry, type WidgetPropsByKind } from './catalog.js';
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
