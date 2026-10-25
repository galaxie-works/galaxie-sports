import type { AccessModel, BroadcastMedium, BroadcasterKind, RightsDistribution } from '@galaxie/db';

/** Mercados do onde assistir (docs/research/onde-assistir.md). */
export const WTW_COUNTRIES = ['BR', 'AR', 'MX', 'CO', 'CL', 'PE', 'UY', 'EC'] as const;
export type WtwCountry = (typeof WTW_COUNTRIES)[number];

/**
 * Apelido com validade: um nome que só vale como esta emissora num período (renomeação de canal, como
 * "Canal Antigo 2" que virou "Canal Novo 6" em certa data). Fora do período o nome não casa: não conta
 * duas vezes o mesmo canal nem confunde o canal antigo com o novo.
 */
export interface DatedAlias {
  name: string;
  /** Canal da entrada que o nome passou a designar (ex.: o número novo). */
  channel: string | null;
  /** YYYY-MM-DD (inclusive); null = sem limite. */
  validFrom: string | null;
  validTo: string | null;
}

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
  /** Apelidos que só valem num período (renomeações). */
  datedAliases: DatedAlias[];
  /**
   * Período em que a emissora existe (está nas grades), YYYY-MM-DD inclusive; null = sem limite. Fora
   * dele o nome não casa na resolução do dia (canal extinto não entra).
   */
  validFrom: string | null;
  validTo: string | null;
  medium: BroadcastMedium;
  accessModel: AccessModel;
  /** Grupo de mídia: entradas do mesmo grupo compartilham domínios como fonte primária. */
  group: string | null;
  domains: string[];
  regionalVariants: RegionalVariant[];
}

/** Tipo na biblioteca de emissoras a partir do meio (TV paga = cabo/satélite/IPTV, sem nomear operadora). */
export function broadcasterKindOf(medium: BroadcastMedium): BroadcasterKind {
  if (medium === 'free_tv') return 'free_tv';
  if (medium === 'pay_tv') return 'pay_tv';
  if (medium === 'radio') return 'radio';
  return 'streaming';
}

/** Logo de uma emissora (`config/broadcasters/_logos.yaml`): só com origem e licença conhecidas. */
export interface LogoEntry {
  id: string;
  /** Arquivo de origem (site oficial ou Wikimedia Commons). */
  url: string;
  /** Página do arquivo (descrição, licença). */
  sourcePage: string;
  /** Licença ou observação de uso. */
  license: string;
}

export interface SourceDomains {
  organizers: string[];
  press: string[];
  /** Agregadores sem licença de reuso: nunca raspados, valem só como pista. */
  aggregators: string[];
}

/**
 * Regra determinística de uma linha de direitos: os `holders` transmitem os jogos que casam com
 * todos os filtros informados (time mandante, qualquer um dos times, rodada pelo rótulo do fornecedor).
 */
export interface RightsRule {
  holders: string[];
  homeTeams: string[];
  teams: string[];
  rounds: string[];
}

/** Linha da tabela de direitos `config/broadcast-rights/<iso2>.yaml` (curada) ou pesquisada. */
export interface RightsEntry {
  competition: string;
  season: number;
  /** YYYY-MM-DD (inclusive). */
  validFrom: string;
  validTo: string;
  perRoundSelection: boolean;
  holders: string[];
  uncertainHolders: string[];
  /**
   * exclusive = um detentor (ou plataformas do mesmo grupo) com todos os jogos · all_matches = todos
   * os detentores com todos os jogos · split = dividem os jogos por rodada · selected = transmitem
   * jogos escolhidos (nem todos passam) · to_confirm = distribuição não conhecida ("a confirmar").
   */
  distribution: RightsDistribution;
  /** Detentores com todos os jogos (além dos implicados por exclusive/all_matches). */
  allMatches: string[];
  rules: RightsRule[];
  notes: string | null;
  sources: string[];
  /** curated = config/broadcast-rights (sempre vence) · research = enrich.broadcast_rights. */
  origin: 'curated' | 'research';
  /** Confiança da pesquisa validada (null na curada). */
  confidence: number | null;
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
  matchedBy: 'name' | 'alias' | 'channel' | 'regional_variant' | 'dated_alias';
}

/**
 * Resultado da busca de um nome numa data: `active` = casa e vale no dia; `inactive` = o nome é de uma
 * emissora fora do período (canal extinto ou ainda não lançado).
 */
export type BroadcasterLookup =
  | { status: 'active'; resolved: ResolvedBroadcaster }
  | { status: 'inactive'; entry: BroadcasterEntry; validFrom: string | null; validTo: string | null };
