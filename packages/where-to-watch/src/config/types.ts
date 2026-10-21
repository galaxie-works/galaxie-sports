import type { AccessModel, BroadcastMedium } from '@galaxie/db';

/** Mercados do onde assistir (docs/research/onde-assistir.md). */
export const WTW_COUNTRIES = ['BR', 'AR', 'MX', 'CO', 'CL', 'PE', 'UY', 'EC'] as const;
export type WtwCountry = (typeof WTW_COUNTRIES)[number];

export interface RegionalVariant {
  name: string;
  /** UF/praça (BR) ou região. */
  region: string;
}

/** Entrada do dicionário `config/broadcasters/<iso2>.yaml`. */
export interface BroadcasterEntry {
  id: string;
  name: string;
  aliases: string[];
  /** Canais da emissora: casam como alias e viram o `channel` da opção. */
  channels: string[];
  medium: BroadcastMedium;
  accessModel: AccessModel;
  /** Grupo de mídia: entradas do mesmo grupo compartilham domínios como fonte primária. */
  group: string | null;
  domains: string[];
  regionalVariants: RegionalVariant[];
}

export interface SourceDomains {
  organizers: string[];
  press: string[];
  /** Agregadores sem licença de reuso: nunca raspados, valem só como pista. */
  aggregators: string[];
}

/** Linha da tabela de direitos `config/broadcast-rights/<iso2>.yaml`. */
export interface RightsEntry {
  competition: string;
  season: number;
  /** YYYY-MM-DD (inclusive). */
  validFrom: string;
  validTo: string;
  perRoundSelection: boolean;
  holders: string[];
  uncertainHolders: string[];
  notes: string | null;
  sources: string[];
}

export interface BlockEntry {
  name: string | null;
  aliases: string[];
  domains: string[];
}

export interface CountryConfig {
  country: WtwCountry;
  language: string;
  broadcasters: BroadcasterEntry[];
  sources: SourceDomains;
  rights: RightsEntry[];
}

export interface ResolvedBroadcaster {
  entry: BroadcasterEntry;
  /** Região fixada por variante regional (ex.: afiliada). */
  region: string | null;
  /** Canal fixado quando o nome casou com um canal da entrada. */
  channel: string | null;
  matchedBy: 'name' | 'alias' | 'channel' | 'regional_variant';
}
