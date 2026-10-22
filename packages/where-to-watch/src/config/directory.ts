import type { SourceKind } from '@galaxie/db';
import { domainHost, hostOf, matchesDomain, normalizeName } from '../normalize.js';
import type {
  BlockEntry,
  BroadcasterEntry,
  CountryConfig,
  LogoEntry,
  ResolvedBroadcaster,
  RightsEntry,
  SourceDomains,
  WtwCountry,
} from './types.js';

/** Limite de domínios aceito pelas ferramentas de busca dos provedores de LLM. */
export const MAX_ALLOWED_DOMAINS = 100;

/** Política editorial: nomes e domínios bloqueados (nunca chegam à API pública). */
export class Blocklist {
  private readonly names = new Set<string>();
  private readonly domains: string[] = [];

  constructor(entries: BlockEntry[]) {
    for (const e of entries) {
      for (const n of [e.name, ...e.aliases]) if (n) this.names.add(normalizeName(n));
      this.domains.push(...e.domains);
    }
  }

  get size(): number {
    return this.names.size + this.domains.length;
  }

  isBlockedName(name: string): boolean {
    const n = normalizeName(name);
    return n.length > 0 && this.names.has(n);
  }

  isBlockedUrl(url: string): boolean {
    return this.domains.some((d) => matchesDomain(url, d));
  }
}

/**
 * Dicionário + fontes + tabela de direitos de um país, com as operações que o agente,
 * o validador e as correções editoriais usam.
 */
export class CountryDirectory {
  readonly country: WtwCountry;
  readonly language: string;
  readonly sources: SourceDomains;
  private readonly byName = new Map<string, ResolvedBroadcaster>();
  private readonly byId = new Map<string, BroadcasterEntry>();

  constructor(
    readonly config: CountryConfig,
    readonly blocklist: Blocklist,
  ) {
    this.country = config.country;
    this.language = config.language;
    this.sources = config.sources;
    for (const entry of config.broadcasters) {
      this.byId.set(entry.id, entry);
      this.index(entry.name, { entry, region: null, channel: null, matchedBy: 'name' });
      for (const a of entry.aliases) this.index(a, { entry, region: null, channel: null, matchedBy: 'alias' });
      for (const c of entry.channels) this.index(c, { entry, region: null, channel: c, matchedBy: 'channel' });
      for (const v of entry.regionalVariants)
        this.index(v.name, { entry, region: v.region, channel: v.name, matchedBy: 'regional_variant' });
    }
  }

  private index(name: string, resolved: ResolvedBroadcaster): void {
    const key = normalizeName(name);
    if (key && !this.byName.has(key)) this.byName.set(key, resolved);
  }

  get broadcasters(): BroadcasterEntry[] {
    return this.config.broadcasters;
  }

  get rights(): RightsEntry[] {
    return this.config.rights;
  }

  byIdOrNull(id: string | null | undefined): BroadcasterEntry | null {
    return id ? (this.byId.get(id) ?? null) : null;
  }

  /** Nome (ou alias, canal, afiliada) → entrada canônica; null = desconhecido (vai para revisão). */
  resolve(name: string): ResolvedBroadcaster | null {
    return this.byName.get(normalizeName(name)) ?? null;
  }

  /** Domínios da entrada e das demais entradas do mesmo grupo de mídia. */
  primaryDomains(entry: BroadcasterEntry): string[] {
    if (!entry.group) return entry.domains;
    return this.config.broadcasters.filter((b) => b.group === entry.group).flatMap((b) => b.domains);
  }

  isAggregator(url: string): boolean {
    return this.sources.aggregators.some((d) => matchesDomain(url, d));
  }

  /**
   * Tipo da fonte de uma evidência para a opção de `entry` (docs/07 §2.2): o site da própria
   * emissora (ou do grupo) é primário; o de OUTRA emissora conta como imprensa grande.
   */
  classifySource(url: string, entry: BroadcasterEntry | null): SourceKind {
    if (!hostOf(url)) return 'unknown';
    if (entry && this.primaryDomains(entry).some((d) => matchesDomain(url, d))) return 'broadcaster';
    if (this.sources.organizers.some((d) => matchesDomain(url, d))) return 'organizer';
    if (this.isAggregator(url)) return 'aggregator';
    if (this.sources.press.some((d) => matchesDomain(url, d))) return 'press';
    if (this.config.broadcasters.some((b) => b.domains.some((d) => matchesDomain(url, d)))) return 'press';
    return 'unknown';
  }

  /**
   * Allowlist de busca do agente: emissoras do país, organizadores e imprensa (agregadores fora).
   * Ordem de prioridade preservada e limitada a `MAX_ALLOWED_DOMAINS` (só hosts).
   */
  allowedDomains(): string[] {
    const hosts = [
      ...this.sources.organizers,
      ...this.config.broadcasters.flatMap((b) => b.domains),
      ...this.sources.press,
    ].map(domainHost);
    return [...new Set(hosts)].slice(0, MAX_ALLOWED_DOMAINS);
  }

  /** Linha da tabela de direitos vigente para a competição na data do jogo. */
  rightsFor(competitionSlug: string | null | undefined, date: Date): RightsEntry | null {
    if (!competitionSlug) return null;
    const day = date.toISOString().slice(0, 10);
    return (
      this.config.rights.find(
        (r) => r.competition === competitionSlug && r.validFrom <= day && day <= r.validTo,
      ) ?? null
    );
  }
}

/** Configuração completa do onde assistir (todos os países + política). */
export class WtwConfig {
  private readonly directories = new Map<string, CountryDirectory>();

  constructor(
    countries: CountryConfig[],
    readonly blocklist: Blocklist,
    /** Logos por id de emissora (config/broadcasters/_logos.yaml). */
    readonly logos: Map<string, LogoEntry> = new Map(),
  ) {
    for (const c of countries) this.directories.set(c.country, new CountryDirectory(c, blocklist));
  }

  get countries(): WtwCountry[] {
    return [...this.directories.keys()] as WtwCountry[];
  }

  has(country: string): boolean {
    return this.directories.has(country.toUpperCase());
  }

  directory(country: string): CountryDirectory {
    const d = this.directories.get(country.toUpperCase());
    if (!d) throw new Error(`País sem dicionário de emissoras: ${country}`);
    return d;
  }
}
