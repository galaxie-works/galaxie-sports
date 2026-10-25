/**
 * @galaxie/rules — motor determinístico (funções puras, sem I/O):
 * - tabelas calculadas localmente a partir de resultados (#24);
 * - contexto competitivo estruturado — stakes — para a IA apenas redigir (#28).
 *
 * Carregamento dos YAML: `@galaxie/rules/config`. Gravação em `core.standing`: `@galaxie/rules/db`.
 */
export type * from './config/types.js';
export { STANDINGS_TABLE_KINDS, TIE_BREAKER_IDS, ZONE_KINDS } from './config/types.js';
export {
  parseCompetitionRules,
  standingsTableOf,
  knockoutStageRules,
  rulesStageKey,
  deepMerge,
  RulesConfigError,
} from './config/parse.js';

export type * from './standings/types.js';
export {
  accumulate,
  applyMatch,
  basePoints,
  chronological,
  emptyRecord,
  formString,
  recordFromBaseline,
  StandingsInputError,
  totalPoints,
} from './standings/accumulate.js';
export {
  currentPhaseKey,
  standingsGroupLabel,
  standingsGroupPriority,
  type GroupActivity,
} from './standings/tables.js';
export {
  computeStandings,
  computeTable,
  isHeadToHead,
  rankRecords,
  type ComputeStandingsInput,
} from './standings/compute.js';

export {
  KNOCKOUT_FAMILIES,
  LEAGUE_FAMILIES,
  STAKE_FAMILIES,
  HISTORY_FAMILIES,
  RESULT_FAMILIES,
  TITLE_VARIANT_OF,
  makeStake,
  stakeCode,
  stakePhase,
  type Stake,
  type StakeFamily,
  type StakeParams,
  type StakePhase,
  type StakeSide,
} from './stakes/codes.js';
export {
  finishedLeagueMatchStakes,
  leagueInputOf,
  leagueResultStakes,
  pickGroupTable,
  prepareFinishedLeagueMatch,
  tablesAroundMatch,
  type FinishedLeagueMatch,
  type FinishedLeagueMatchInput,
  type LeagueResultInput,
  type PrepareFinishedInput,
  type TablesAround,
  type TablesAroundInput,
  type TableSnapshotRow,
} from './stakes/result.js';
export {
  isSalient,
  MAX_SALIENT_STAKES,
  SALIENCE_FRACTION,
  SALIENCE_MIN_GAP,
  salienceFight,
  salienceGap,
  salienceStanding,
  salienceTier,
  salienceWindow,
  salientStakes,
  type SalienceFight,
  type SalienceOptions,
  type SalienceStanding,
  type SalienceTier,
} from './stakes/salience.js';
export {
  championPhrase,
  titleChaseSides,
  titleChaseStakes,
  titleOrdinal,
  type TitleCounts,
  type TitleSide,
} from './stakes/titles.js';
export {
  knockoutStakes,
  tieOutcome,
  KnockoutInputError,
  type KnockoutMatchInput,
  type TieOutcome,
} from './stakes/knockout.js';
export {
  analyzeLeague,
  isBadZone,
  leagueMatchStakes,
  LeagueInputError,
  type Fixture,
  type LeagueMatchInput,
  type LeagueOutlookInput,
  type LeagueTeamInput,
  type TeamOutlook,
  type ZoneStatus,
} from './stakes/league.js';
export {
  decisiveFlagsFromStakes,
  type DecisiveStandings,
  type StakeDecisiveFlag,
} from './stakes/decisive.js';
export {
  isStakeLocale,
  localizeStake,
  stakeText,
  zoneLabel,
  STAKE_LABELS,
  STAKE_LOCALES,
  ZONE_LABELS,
  type LabelTemplate,
  type LocalizedStake,
  type StakeLocale,
} from './stakes/labels.js';
export {
  fanTagOf,
  fanTags,
  fanTagZoneGroup,
  fanTagStanding,
  isRelevantForFans,
  FAN_TAG_LOCALES,
  FAN_TAG_RELEGATION_MAX_GAP,
  FAN_TAG_TITLE_MIN_GAP,
  FAN_TAG_ZONE_MIN_GAP,
  FAN_TAG_TIERS,
  MAX_FAN_TAGS,
  type FanTag,
  type FanTagLocale,
  type FanTagStanding,
  type FanTagTier,
  type FanTagZoneGroup,
} from './stakes/fan-tags.js';
