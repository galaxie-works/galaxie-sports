import type { SourceKind } from '@galaxie/db';
import { collapseHosts, hostOf, matchesDomain, normalizeName } from '../normalize.js';
import type {
  BlockEntry,
  BroadcasterEntry,
  BroadcasterLookup,
  CountryConfig,
  LogoEntry,
  ResolvedBroadcaster,
  RightsEntry,
  SourceDomains,
  WtwCountry,
} from './types.js';
import type { OfficialLogoManifest } from '../official-logos.js';

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
  private readonly byDatedName = new Map<
    string,
    { resolved: ResolvedBroadcaster; validFrom: string | null; validTo: string | null }[]
  >();
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
      for (const a of entry.datedAliases) {
        const key = normalizeName(a.name);
        if (!key) continue;
        const list = this.byDatedName.get(key) ?? [];
        list.push({
          resolved: { entry, region: null, channel: a.channel, matchedBy: 'dated_alias' },
          validFrom: a.validFrom,
          validTo: a.validTo,
        });
        this.byDatedName.set(key, list);
      }
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

  /**
   * Nome (ou alias, canal, afiliada) → entrada canônica que vale na data (padrão: hoje); null =
   * desconhecido (vai para revisão) ou fora do período (canal extinto, apelido de antes da renomeação).
   */
  resolve(name: string, at: Date | string = new Date()): ResolvedBroadcaster | null {
    const found = this.lookup(name, at);
    return found?.status === 'active' ? found.resolved : null;
  }

  /** Como `resolve`, mas diz quando o nome é de uma emissora que existe e está fora do período no dia. */
  lookup(name: string, at: Date | string = new Date()): BroadcasterLookup | null {
    const key = normalizeName(name);
    const d = typeof at === 'string' ? at.slice(0, 10) : at.toISOString().slice(0, 10);
    const within = (from: string | null, to: string | null) => (!from || from <= d) && (!to || d <= to);
    const dated = (this.byDatedName.get(key) ?? []).find((a) => within(a.validFrom, a.validTo));
    const resolved = this.byName.get(key) ?? dated?.resolved ?? null;
    if (!resolved) return null;
    const e = resolved.entry;
    if (!within(e.validFrom, e.validTo))
      return { status: 'inactive', entry: e, validFrom: e.validFrom, validTo: e.validTo };
    return { status: 'active', resolved };
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
    return collapseHosts([
      ...this.sources.organizers,
      ...this.config.broadcasters.flatMap((b) => b.domains),
      ...this.sources.press,
    ]).slice(0, MAX_ALLOWED_DOMAINS);
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
    /** Acervo oficial de logos (config/broadcasters/_official_logos.yaml); precede `logos`. */
    readonly officialLogos: OfficialLogoManifest | null = null,
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
