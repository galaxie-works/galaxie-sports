/** Tipos dos arquivos YAML da base semântica (schema v1 — data/knowledge/SCHEMA.md). */

export const REVIEW_STATUSES = ['draft', 'reviewed', 'approved'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Os 8 mercados com biblioteca de copy própria (docs/06 §4.3). */
export const COPY_LOCALES = ['pt-BR', 'es-AR', 'es-MX', 'es-CO', 'es-CL', 'es-PE', 'es-UY', 'es-EC'] as const;
export type CopyLocale = (typeof COPY_LOCALES)[number];

/**
 * Locales dos textos livres (identity, mascote, torcida, origin, trivia): o idioma-base de cada arquivo
 * (`text_locale`, padrão pt-BR) e as traduções de `i18n/<locale>.yaml`. `es` = espanhol neutro da
 * América Latina; `es-XX` só quando o texto tem voz regional (docs/06 §3.3).
 */
export const TEXT_LOCALES = [
  'pt-BR',
  'es',
  'es-AR',
  'es-MX',
  'es-CO',
  'es-CL',
  'es-PE',
  'es-UY',
  'es-EC',
  'es-PY',
  'es-BO',
  'es-VE',
] as const;
export type TextLocale = (typeof TEXT_LOCALES)[number];
export const DEFAULT_TEXT_LOCALE: TextLocale = 'pt-BR';

export type I18nMap = Partial<Record<string, string>>;

export interface TeamRivalEntry {
  team: string;
  derby?: string | null;
  intensity?: number;
}

/** Estádio do time; o nome atual vence o do fornecedor em toda a API (reconciliação do seed). */
export interface StadiumEntry {
  name: string;
  nicknames?: string[];
  /** Nomes anteriores (naming rights); `until` = último dia (ISO) em que o nome valeu. */
  former_names?: { name: string; until: string }[];
  city?: string;
  /** ID do estádio na api-sports, só se verificado; sem ele o seed casa por nome + cidade. */
  api_sports_venue_id?: number | null;
}

export interface TeamEntry {
  slug: string;
  names: { official: string; short: string; abbreviation?: string };
  labels?: I18nMap;
  api_sports: { team_id: number | null; match: { name: string; country: string } };
  /** Fórmula 1: piloto ou construtor no F1DB; liga o perfil ao participante (seed, `linkParticipants`). */
  f1db?: { id: string };
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
  stadium?: StadiumEntry;
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
  /** Idioma de origin/trivia quando difere do `text_locale` do arquivo. */
  text_locale?: TextLocale;
  origin?: string | null;
  trivia?: string[];
  /** Retrospecto histórico geral, curado de fontes públicas (o da base é calculado na API). */
  all_time?: DerbyAllTimeEntry;
  sources: string[];
  review_status: ReviewStatus;
}

export interface DerbyAllTimeEntry {
  matches: number;
  draws: number;
  teams: { team: string; wins: number; goals?: number | null }[];
  /** all = todos os jogos (inclui amistosos); official = só oficiais. */
  basis: 'all' | 'official';
  as_of: string;
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
  /** Idioma dos textos livres do arquivo (padrão pt-BR). */
  text_locale?: TextLocale;
  teams: TeamEntry[];
}
/** `<esporte>/participants/*.yaml`: pilotos, equipes da F1, lutadores... (cada item com `country`). */
/** Uma pintura de construtor da F1: intervalo de temporadas (`to` null = até hoje) e [primária, secundária]. */
export interface LiveryEra {
  from: number;
  to: number | null;
  colors: string[];
  livery: string;
  sources: string[];
}

/** Construtor da F1 com as pinturas por época (`formula-1/liveries.yaml`); o slug é o id do F1DB. */
export interface LiveryEntry {
  slug: string;
  name: string;
  eras: LiveryEra[];
  review_status: ReviewStatus;
}

export interface LiveriesFile {
  schema_version: 1;
  constructors: LiveryEntry[];
}

export interface ParticipantsFile {
  schema_version: 1;
  kind: 'driver' | 'constructor' | 'fighter' | 'athlete';
  text_locale?: TextLocale;
  participants: TeamEntry[];
}
export interface NationalTeamsFile {
  schema_version: 1;
  text_locale?: TextLocale;
  teams: TeamEntry[];
}
/** Par relevante que não é clássico, com o retrospecto histórico geral curado. */
export interface HeadToHeadEntry {
  slug: string;
  teams: [string, string];
  all_time: DerbyAllTimeEntry;
}

export interface HeadToHeadFile {
  schema_version: 1;
  region: string;
  pairs: HeadToHeadEntry[];
}

export interface DerbiesFile {
  schema_version: 1;
  region: string;
  text_locale?: TextLocale;
  derbies: DerbyEntry[];
}
export interface CompetitionsFile {
  schema_version: 1;
  competitions: CompetitionEntry[];
}
/** Categorias do glossário por mercado (docs/06 §5). */
export const GLOSSARY_CATEGORIES = ['support', 'rivalry', 'fans', 'match', 'competition'] as const;
export type GlossaryCategory = (typeof GLOSSARY_CATEGORIES)[number];

/**
 * Termo esportivo de um mercado (data/knowledge/glossary/<locale>.yaml). Só entram termos positivos;
 * os de rivalidade exigem `requires: declared_rival` (copy_permission, docs/06 §4.2).
 */
export interface GlossaryTermEntry {
  key: string;
  term: string;
  /** Significado no idioma do mercado. */
  meaning: string;
  /** Frase curta de exemplo. */
  example?: string | null;
  category: GlossaryCategory;
  /** Intenções de copy em que o termo cabe. */
  copy_intents?: CopyIntent[];
  /** Restrição de uso: só com rival declarado / só com afinidade declarada. */
  requires?: 'declared_rival' | 'declared_affinity' | null;
  /** Observação editorial curta (ex.: variante regional, cuidado de tom). */
  note?: string | null;
  sources: string[];
  review_status: ReviewStatus;
}

export interface GlossaryFile {
  schema_version: 1;
  locale: string;
  sport: 'football' | 'multi';
  terms: GlossaryTermEntry[];
}

export interface CopyFile {
  schema_version: 1;
  locale: string;
  sport: 'football';
  templates: CopyTemplateEntry[];
}

/** Textos de um time/participante traduzidos para um locale (`i18n/<locale>.yaml`). */
export interface TeamTextsEntry {
  slug: string;
  identity?: string[];
  mascot?: string;
  colors?: string[];
  fans?: { demonym?: string; group_nicknames?: string[] };
  /** Observação editorial (ex.: por que o texto tem versão regional). */
  note?: string;
  review_status: ReviewStatus;
}

/** Textos de um clássico traduzidos para um locale. */
export interface DerbyTextsEntry {
  slug: string;
  origin?: string;
  trivia?: string[];
  note?: string;
  review_status: ReviewStatus;
}

/**
 * `i18n/<locale>.yaml`: tradução dos textos livres da base para um mercado. Cada campo cai, um a um, na
 * cadeia `es-XX → es → idioma-base` (docs/06 §3.3).
 */
export interface I18nFile {
  schema_version: 1;
  locale: TextLocale;
  teams?: TeamTextsEntry[];
  derbies?: DerbyTextsEntry[];
}

/** Textos localizáveis guardados no banco: `{ "<locale>": { identity, mascot, ..., review_status } }`. */
export type TeamTexts = Omit<TeamTextsEntry, 'slug' | 'note'>;
export type DerbyTexts = Omit<DerbyTextsEntry, 'slug' | 'note'>;

/**
 * Perfil editorial de piloto da F1 (`formula-1/editorial/<locale>.yaml`, um arquivo por idioma): bio, estilo,
 * pontos fortes, momentos marcantes e rivalidades, **cada item com a fonte**. Gerado pelo agente `f1:bio --perfil`
 * (pesquisa com grounding) como `draft` e aprovado no painel de revisão; os números são conferidos contra o F1DB
 * antes de entrar. O nível (`tier`) diz o que o perfil traz: `legend` = completo; `regular` = só a bio curta.
 */
export interface EditorialSourced {
  text: string;
  /** Fonte do item; ausente só quando o modelo não deu nenhuma (vira achado grave). */
  source?: string;
}

/** Gravidade de um achado do validador: grave pede conferência do fato; alerta, do texto. */
export const FINDING_SEVERITIES = ['alert', 'severe'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

/**
 * Achado do validador sobre o texto gerado. O validador nunca barra: o item entra como rascunho com os achados, e o
 * painel de revisão destaca o trecho (`start`–`end` no texto do campo) com o motivo.
 */
export interface EditorialFinding {
  /** Campo: `bio`, `style`, `strengths[0]`, `moments[2]`, `rivalries[1]`, `bio.sources[0]`, `moments[2].source`... */
  field: string;
  /** Início e fim (exclusivo) do trecho no texto do campo; o item inteiro quando o achado é sobre ele todo. */
  start: number;
  end: number;
  /** Regra: unknown_number, race_not_driven, rival_not_in_race, prompt_injection, source_not_grounded... */
  rule: string;
  reason: string;
  severity: FindingSeverity;
}

export interface DriverEditorialEntry {
  /** O mesmo slug do perfil do piloto (`f1-<id do F1DB>`). */
  slug: string;
  /** Nome do piloto (o do F1DB). */
  name: string;
  f1db: { id: string };
  tier: 'legend' | 'regular';
  bio: { text: string; sources: string[] };
  /** Só lenda. */
  style?: { kind: string; text: string; sources: string[] };
  strengths?: (EditorialSourced & { key: string })[];
  moments?: (EditorialSourced & {
    /** Ano e rodada da corrida da lista do piloto; ausentes quando o modelo citou uma corrida fora dela. */
    year?: number;
    /** Nome do GP como é conhecido no idioma do arquivo. */
    race: string;
    /** Rodada da corrida na temporada (a ordem pela data): liga o momento ao evento da base. */
    round?: number;
    /** Corrida com chuva (a F1DB não marca; vem da fonte do momento). */
    wet?: boolean;
  })[];
  /** Rival: `f1db_id` null quando o nome não casa com quem largou nas mesmas corridas (achado grave). */
  rivalries?: (EditorialSourced & { driver: { f1db_id: string | null; name: string } })[];
  /** Achados do validador, para o painel de revisão. */
  findings?: EditorialFinding[];
  review_status: ReviewStatus;
}

export interface EditorialFile {
  schema_version: 1;
  locale: TextLocale;
  drivers: DriverEditorialEntry[];
}
