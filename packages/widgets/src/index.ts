// @galaxie/widgets — widgets React da Galaxie Sports e o gerador do item de registry shadcn do Builder.

// modelo (sem React; seguro em Server Components)
export {
  BROADCAST_MEDIA,
  DEFAULT_THEMES,
  PUBLISHABLE_KEY_HEADER,
  THEME_PRESET_IDS,
  THEME_PRESET_LABELS,
  WIDGET_CSS,
  WIDGET_KINDS,
  WIDGET_LOCALES,
  readableOn,
  textsFor,
  themeToCssVars,
  type GsCssVars,
  type GsEvent,
  type GsEventContext,
  type GsHeadToHead,
  type GsRelated,
  type GsStandings,
  type GsWhereToWatch,
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
