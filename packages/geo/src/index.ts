export { AUDIENCE_FULL_UNTIL, audienceFor, MarketAudience, type AudienceEntry } from './audience.js';
export {
  COMPETITION_SCOPES,
  GLOBAL_CONFEDERATION,
  INTERNATIONAL_SCOPES,
  MAX_AUDIENCE,
  type CompetitionScope,
  type I18nName,
  type InternationalScope,
} from './schema.js';
export {
  defaultGeoDir,
  GeoConfig,
  GeoConfigError,
  loadGeoConfig,
  parseGeoConfig,
  type GeoConfederation,
  type GeoCountry,
  type ScopeEntry,
} from './config.js';
export {
  compareCompetitions,
  groupCompetitions,
  type GroupableCompetition,
  type ScopeGroup,
  type SportGroups,
} from './grouping.js';
