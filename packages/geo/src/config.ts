import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import type * as z from 'zod';
import { MarketAudience } from './audience.js';
import {
  AudienceFile,
  GeoFile,
  GLOBAL_CONFEDERATION,
  ScopeFile,
  type I18nName,
  type InternationalScope,
  type ScopeEntryInput,
} from './schema.js';

export class GeoConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeoConfigError';
  }
}

/** País membro de uma confederação (config/geo/confederations.yaml). */
export interface GeoCountry {
  code: string;
  ioc: string | null;
  name: I18nName;
  confederation: string;
}

export interface GeoConfederation {
  code: string;
  name: I18nName;
  members: string[];
}

/** Competição internacional do arquivo de escopo, com a posição de exibição dentro do esporte. */
export interface ScopeEntry {
  sport: string;
  slug: string;
  apiSportsId: string | null;
  scope: InternationalScope;
  confederations: string[];
  countries: string[];
  order: number;
}

/** Pasta `config/geo` do monorepo (mesma profundidade em src/ e dist/); `GEO_CONFIG_DIR` sobrescreve. */
export function defaultGeoDir(): string {
  return process.env.GEO_CONFIG_DIR ?? fileURLToPath(new URL('../../../config/geo/', import.meta.url));
}

function check<T extends z.ZodType>(schema: T, raw: unknown, file: string): z.output<T> {
  const r = schema.safeParse(raw);
  if (!r.success) {
    const issues = r.error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`).join('; ');
    throw new GeoConfigError(`config/geo/${file} inválido — ${issues}`);
  }
  return r.data;
}

/**
 * Configuração geográfica validada: confederações e membros, regiões, navegação e escopo das competições
 * internacionais. Imutável; consultas em memória (O(1) por país).
 */
export class GeoConfig {
  readonly confederations: GeoConfederation[];
  readonly navigationCountries: string[];
  /** Mercados ativos da relevância por país, na ordem do arquivo. */
  readonly markets: string[];
  readonly navigationSports: { slug: string; name: I18nName }[];
  readonly regions: Record<string, string>;
  /** Audiência das competições por mercado (config/geo/market-audience.yaml). */
  readonly audience: MarketAudience;
  private readonly countries = new Map<string, GeoCountry>();
  private readonly scopes = new Map<string, ScopeEntry[]>();
  private readonly excluded = new Map<string, Set<string>>();
  private readonly featured = new Map<string, Map<string, number>>();
  private readonly regional = new Map<string, Map<string, number>>();

  constructor(geo: GeoFile, scope: ScopeFile, audience?: AudienceFile) {
    this.confederations = geo.confederations.map((c) => ({
      code: c.code,
      name: c.name,
      members: c.members.map((m) => m.code),
    }));
    const confCodes = new Set(this.confederations.map((c) => c.code));
    if (confCodes.has(GLOBAL_CONFEDERATION))
      throw new GeoConfigError(`"${GLOBAL_CONFEDERATION}" é reservado às competições globais.`);
    if (confCodes.size !== this.confederations.length)
      throw new GeoConfigError('confederação duplicada em confederations.yaml.');

    for (const c of geo.confederations) {
      for (const m of c.members) {
        const prev = this.countries.get(m.code);
        if (prev) throw new GeoConfigError(`país ${m.code} aparece em ${prev.confederation} e em ${c.code}.`);
        this.countries.set(m.code, { code: m.code, ioc: m.ioc ?? null, name: m.name, confederation: c.code });
      }
    }

    for (const [region, conf] of Object.entries(geo.regions)) {
      if (!confCodes.has(conf))
        throw new GeoConfigError(`região ${region}: confederação ${conf} inexistente.`);
    }
    this.regions = geo.regions;

    for (const code of geo.navigation.countries) {
      const c = this.countries.get(code);
      if (!c) throw new GeoConfigError(`navegação: país ${code} não é membro de nenhuma confederação.`);
      if (!c.name['pt-BR'] || !c.name.es)
        throw new GeoConfigError(`navegação: país ${code} precisa de nome em pt-BR e es.`);
    }
    if (new Set(geo.navigation.countries).size !== geo.navigation.countries.length)
      throw new GeoConfigError('navegação: país repetido.');
    this.navigationCountries = geo.navigation.countries;
    for (const code of geo.markets)
      if (!this.countries.has(code)) throw new GeoConfigError(`markets: país ${code} desconhecido.`);
    if (new Set(geo.markets).size !== geo.markets.length) throw new GeoConfigError('markets: país repetido.');
    this.markets = geo.markets;
    if (new Set(geo.navigation.sports.map((s) => s.slug)).size !== geo.navigation.sports.length)
      throw new GeoConfigError('navegação: esporte repetido.');
    this.navigationSports = geo.navigation.sports;

    const validConf = new Set([...confCodes, GLOBAL_CONFEDERATION]);
    for (const [sport, def] of Object.entries(scope.sports)) {
      const seen = new Set<string>();
      const entries = def.competitions.map((e: ScopeEntryInput, order): ScopeEntry => {
        const where = `competition-scope.yaml ${sport}/${e.slug}`;
        if (seen.has(e.slug)) throw new GeoConfigError(`${where}: competição repetida.`);
        seen.add(e.slug);
        for (const conf of e.confederations)
          if (!validConf.has(conf)) throw new GeoConfigError(`${where}: confederação ${conf} inexistente.`);
        for (const code of e.countries)
          if (!this.countries.has(code)) throw new GeoConfigError(`${where}: país ${code} desconhecido.`);
        return {
          sport,
          slug: e.slug,
          apiSportsId: e.api_sports_id === undefined ? null : String(e.api_sports_id),
          scope: e.scope,
          confederations: e.confederations,
          countries: e.countries,
          order,
        };
      });
      for (const slug of def.excluded)
        if (seen.has(slug)) throw new GeoConfigError(`${sport}/${slug}: mapeada e excluída ao mesmo tempo.`);
      this.scopes.set(sport, entries);
      this.excluded.set(sport, new Set(def.excluded));
      if (new Set(def.featured).size !== def.featured.length)
        throw new GeoConfigError(`${sport}: competição repetida em featured.`);
      this.featured.set(sport, new Map(def.featured.map((slug, i) => [slug, i])));
      if (new Set(def.regional).size !== def.regional.length)
        throw new GeoConfigError(`${sport}: competição repetida em regional.`);
      for (const slug of def.regional) {
        if (seen.has(slug))
          throw new GeoConfigError(`${sport}/${slug}: internacional e regional ao mesmo tempo.`);
        if (this.featured.get(sport)!.has(slug))
          throw new GeoConfigError(`${sport}/${slug}: em featured (nacional) e em regional ao mesmo tempo.`);
      }
      this.regional.set(sport, new Map(def.regional.map((slug, i) => [slug, i])));
    }

    for (const market of Object.keys(audience?.markets ?? {}))
      if (!this.countries.has(market) && !this.allCountries().some((c) => c.code.startsWith(`${market}-`)))
        throw new GeoConfigError(`market-audience.yaml: mercado ${market} desconhecido.`);
    this.audience = new MarketAudience(audience);
  }

  /** Posição de uma competição doméstica na lista `featured` do esporte; null fora dela. */
  featuredOrder(sport: string, slug: string): number | null {
    return this.featured.get(sport)?.get(slug) ?? null;
  }

  /** Slugs em destaque do esporte (validação). */
  featuredSlugs(sport: string): string[] {
    return [...(this.featured.get(sport)?.keys() ?? [])];
  }

  /** Doméstica estadual ou regional (lista `regional` do esporte)? As outras domésticas são nacionais. */
  isRegional(sport: string, slug: string): boolean {
    return this.regional.get(sport)?.has(slug) ?? false;
  }

  /**
   * Nível de uma competição: `regional` (lista `regional`), `national` (as demais com país) ou null nas
   * internacionais (sem país ou `WORLD`).
   */
  competitionLevel(sport: string, slug: string, countryCode: string | null): 'national' | 'regional' | null {
    if (!countryCode || countryCode.toUpperCase() === 'WORLD') return null;
    return this.isRegional(sport, slug) ? 'regional' : 'national';
  }

  /** Posição editorial de uma doméstica no país: na lista `regional` ou na `featured`; null fora delas. */
  domesticOrder(sport: string, slug: string): number | null {
    return this.isRegional(sport, slug) ? this.regionalOrder(sport, slug) : this.featuredOrder(sport, slug);
  }

  /** Posição de uma competição regional na lista `regional` do esporte; null fora dela. */
  regionalOrder(sport: string, slug: string): number | null {
    return this.regional.get(sport)?.get(slug) ?? null;
  }

  /** Slugs regionais do esporte (validação). */
  regionalSlugs(sport: string): string[] {
    return [...(this.regional.get(sport)?.keys() ?? [])];
  }

  /** País membro (código em qualquer caixa); undefined fora das confederações. */
  country(code: string): GeoCountry | undefined {
    return this.countries.get(code.toUpperCase());
  }

  confederation(code: string): GeoConfederation | undefined {
    return this.confederations.find((c) => c.code === code);
  }

  /** Todos os países membros, na ordem das confederações. */
  allCountries(): GeoCountry[] {
    return [...this.countries.values()];
  }

  /** Competições internacionais declaradas para o esporte, na ordem do arquivo. */
  scopeEntries(sport: string): ScopeEntry[] {
    return this.scopes.get(sport) ?? [];
  }

  /** Esportes com escopo declarado. */
  scopedSports(): string[] {
    return [...this.scopes.keys()];
  }

  isExcluded(sport: string, slug: string): boolean {
    return this.excluded.get(sport)?.has(slug) ?? false;
  }

  /** O país participa da competição? (global, membro de uma das confederações ou listado em `countries`). */
  participates(entry: Pick<ScopeEntry, 'confederations' | 'countries'>, countryCode: string): boolean {
    const code = countryCode.toUpperCase();
    if (entry.countries.includes(code)) return true;
    if (entry.confederations.includes(GLOBAL_CONFEDERATION)) return true;
    const conf = this.countries.get(code)?.confederation;
    return conf !== undefined && entry.confederations.includes(conf);
  }

  /** Competições internacionais de que o país participa (todos os esportes ou um só). */
  internationalFor(countryCode: string, sport?: string): ScopeEntry[] {
    const sports = sport ? [sport] : this.scopedSports();
    return sports.flatMap((s) => this.scopeEntries(s).filter((e) => this.participates(e, countryCode)));
  }
}

/** Valida os arquivos já interpretados do YAML (sem o de audiência, nenhuma competição soma pontos). */
export function parseGeoConfig(geoRaw: unknown, scopeRaw: unknown, audienceRaw?: unknown): GeoConfig {
  return new GeoConfig(
    check(GeoFile, geoRaw, 'confederations.yaml'),
    check(ScopeFile, scopeRaw, 'competition-scope.yaml'),
    audienceRaw === undefined ? undefined : check(AudienceFile, audienceRaw, 'market-audience.yaml'),
  );
}

/** Lê e valida config/geo (padrão: a pasta do monorepo ou `GEO_CONFIG_DIR`). */
export function loadGeoConfig(dir = defaultGeoDir()): GeoConfig {
  const read = (file: string) => parse(readFileSync(join(dir, file), 'utf8')) as unknown;
  const audience = existsSync(join(dir, 'market-audience.yaml')) ? read('market-audience.yaml') : undefined;
  return parseGeoConfig(read('confederations.yaml'), read('competition-scope.yaml'), audience);
}
