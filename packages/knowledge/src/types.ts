/** Tipos dos arquivos YAML da base semântica (schema v1 — data/knowledge/SCHEMA.md). */

export const REVIEW_STATUSES = ['draft', 'reviewed', 'approved'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Os 8 mercados com biblioteca de copy própria (docs/06 §4.3). */
export const COPY_LOCALES = ['pt-BR', 'es-AR', 'es-MX', 'es-CO', 'es-CL', 'es-PE', 'es-UY', 'es-EC'] as const;
export type CopyLocale = (typeof COPY_LOCALES)[number];

export type I18nMap = Partial<Record<string, string>>;

export interface TeamRivalEntry {
  team: string;
  derby?: string | null;
  intensity?: number;
}

export interface TeamEntry {
  slug: string;
  names: { official: string; short: string; abbreviation?: string };
  labels?: I18nMap;
  api_sports: { team_id: number | null; match: { name: string; country: string } };
  founded?: string | null;
  /** Obrigatório em national-teams.yaml; nos arquivos por país vem do topo do arquivo. */
  country?: string;
  city?: string;
  region?: string;
  colors?: string[];
  nicknames: string[];
  fans?: { demonym?: string | null; group_nicknames?: string[] };
  mascot?: string | null;
  rallying_cries?: string[];
  stadium?: { name: string; nicknames?: string[]; city?: string };
  rivals?: TeamRivalEntry[];
  identity?: string[];
  copy_hints?: Record<string, { cheer?: string[]; nicknames?: string[] }>;
  world_cup_titles?: number;
  sources: string[];
  review_status: ReviewStatus;
}

export interface DerbyEntry {
  slug: string;
  name: string;
  aliases?: string[];
  labels?: I18nMap;
  teams: [string, string];
  scope: 'city' | 'state' | 'national' | 'continental' | 'international';
  intensity: number;
  first_match?: string | null;
  origin?: string | null;
  trivia?: string[];
  sources: string[];
  review_status: ReviewStatus;
}

export interface CompetitionEntry {
  slug: string;
  api_sports_league_id: number | null;
  labels: I18nMap;
  nicknames?: Record<string, string[]>;
  trophy_nickname?: string | null;
  sources: string[];
  review_status?: ReviewStatus;
}

export const COPY_INTENTS = ['inform', 'anticipate', 'cheer', 'rivalry', 'urgency', 'decisive'] as const;
export type CopyIntent = (typeof COPY_INTENTS)[number];

export const AFFINITY_TYPES = ['heart', 'support', 'sympathy', 'rival', 'interest'] as const;
export type AffinityType = (typeof AFFINITY_TYPES)[number];

export const AFFINITY_SOURCES = ['explicit', 'inferred'] as const;
export type AffinitySource = (typeof AFFINITY_SOURCES)[number];

export const MOMENTUMS = ['D-3+', 'D-2', 'D-1', 'today', 'T-60', 'T-30', 'T-10', 'starting', 'live'] as const;
export type Momentum = (typeof MOMENTUMS)[number];

export const COMPETITION_CONTEXTS = [
  'regular',
  'derby',
  'playoff',
  'knockout',
  'semifinal',
  'final',
  'title',
  'lead',
  'relegation',
] as const;
export type CompetitionContext = (typeof COMPETITION_CONTEXTS)[number];

export type ToneIntensity = 1 | 2 | 3 | 4;
export type CopyConfidence = 'HIGH' | 'MEDIUM' | 'EXPERIMENTAL';

/** Placeholders aceitos nos templates de copy. */
export const COPY_PLACEHOLDERS = ['team', 'nickname', 'rival', 'minutes'] as const;
export type CopyPlaceholder = (typeof COPY_PLACEHOLDERS)[number];

export interface CopyTemplateEntry {
  key: string;
  intent: CopyIntent;
  tone: ToneIntensity;
  template: string;
  affinity_type?: AffinityType | null;
  affinity_source?: AffinitySource | null;
  momentum?: Momentum | null;
  competition_context?: CompetitionContext | null;
  confidence: CopyConfidence;
  review_status: ReviewStatus;
}

export interface TeamsFile {
  schema_version: 1;
  country: string;
  teams: TeamEntry[];
}
/** `<esporte>/participants/*.yaml`: pilotos, equipes da F1, lutadores... (cada item com `country`). */
export interface ParticipantsFile {
  schema_version: 1;
  kind: 'driver' | 'constructor' | 'fighter' | 'athlete';
  participants: TeamEntry[];
}
export interface NationalTeamsFile {
  schema_version: 1;
  teams: TeamEntry[];
}
export interface DerbiesFile {
  schema_version: 1;
  region: string;
  derbies: DerbyEntry[];
}
export interface CompetitionsFile {
  schema_version: 1;
  competitions: CompetitionEntry[];
}
export interface CopyFile {
  schema_version: 1;
  locale: string;
  sport: 'football';
  templates: CopyTemplateEntry[];
}
