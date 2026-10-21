import type { Database, I18nText } from '@galaxie/db';
import type { CatalogCompetition } from './catalog-config.js';
import {
  upsertCatalog,
  type CatalogRows,
  type CompetitionRow,
  type CountryRow,
  type UpsertStats,
} from './persist.js';

export type { CatalogRows, CompetitionRow, CountryRow, UpsertStats } from './persist.js';

// ─── formato da api-sports (v3) ──────────────────────────────────────────────────────────────────

export interface ApiCountry {
  name: string;
  code: string | null;
  flag: string | null;
}

export interface ApiSeason {
  year: number;
  start: string | null;
  end: string | null;
  current: boolean;
  coverage: unknown;
}

export interface ApiLeague {
  league: { id: number; name: string; type: string; logo: string | null };
  country: ApiCountry;
  seasons: ApiSeason[];
}

// ─── normalização (funções puras) ────────────────────────────────────────────────────────────────

export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Código do país no nosso modelo: ISO2 (ou extensão da api-sports como GB-ENG); "WORLD" para internacionais. */
export function countryCode(c: Pick<ApiCountry, 'name' | 'code'>): string {
  if (c.code) return c.code.toUpperCase();
  return c.name === 'World' ? 'WORLD' : slugify(c.name).toUpperCase();
}

/** Rótulo da temporada: "2026" quando cabe num ano, "2025/26" quando atravessa o ano. */
export function seasonLabel(s: Pick<ApiSeason, 'year' | 'start' | 'end'>): string {
  const startYear = s.start ? Number(s.start.slice(0, 4)) : s.year;
  const endYear = s.end ? Number(s.end.slice(0, 4)) : s.year;
  return endYear > startYear ? `${s.year}/${String(s.year + 1).slice(2)}` : String(s.year);
}

/** Converte /countries + /leagues no formato das nossas tabelas, aplicando tier, slug e labels do catálogo. */
export function buildCatalogRows(
  leagues: ApiLeague[],
  countries: ApiCountry[],
  catalog: CatalogCompetition[],
): CatalogRows {
  const byId = new Map(catalog.filter((c) => c.api_sports_id != null).map((c) => [c.api_sports_id!, c]));

  const countryMap = new Map<string, CountryRow>();
  for (const c of [...countries, ...leagues.map((l) => l.country)]) {
    const code = countryCode(c);
    const prev = countryMap.get(code);
    countryMap.set(code, { code, name: { en: c.name }, flagUrl: prev?.flagUrl ?? c.flag ?? null });
  }

  const competitions = leagues.map((l): CompetitionRow => {
    const cfg = byId.get(l.league.id);
    const code = countryCode(l.country);
    return {
      providerId: String(l.league.id),
      slug: cfg?.slug ?? `${slugify(l.country.name)}-${slugify(l.league.name)}-${l.league.id}`,
      name: l.league.name,
      labels: (cfg?.labels as I18nText | undefined) ?? null,
      countryCode: code,
      type: l.league.type.toLowerCase() === 'cup' ? 'cup' : 'league',
      tier: cfg?.tier ?? 3,
      livePriority: cfg?.live_priority ?? 'none',
      logoUrl: l.league.logo,
      seasons: mergeSameYear(l.seasons).map((s) => ({
        year: s.year,
        label: seasonLabel(s),
        startDate: s.start,
        endDate: s.end,
        current: s.current,
        coverage: s.coverage,
      })),
    };
  });

  return { countries: [...countryMap.values()], competitions };
}

/**
 * Ligas que mudaram de calendário podem listar duas edições com o mesmo `year`
 * (ex.: Girabola 2018 de fev–set e de out–mai). Como o fornecedor as consulta pelo mesmo
 * `season=2018`, viram uma temporada só: período da primeira à última data, cobertura da mais recente.
 */
export function mergeSameYear(seasons: ApiSeason[]): ApiSeason[] {
  const byYear = new Map<number, ApiSeason>();
  for (const s of seasons) {
    const prev = byYear.get(s.year);
    if (!prev) {
      byYear.set(s.year, s);
      continue;
    }
    const latest = (s.end ?? '') >= (prev.end ?? '') ? s : prev;
    const starts = [prev.start, s.start].filter((d): d is string => !!d).sort();
    const ends = [prev.end, s.end].filter((d): d is string => !!d).sort();
    byYear.set(s.year, {
      year: s.year,
      start: starts[0] ?? null,
      end: ends.at(-1) ?? null,
      current: prev.current || s.current,
      coverage: latest.coverage,
    });
  }
  return [...byYear.values()];
}

// ─── conferência do catálogo ─────────────────────────────────────────────────────────────────────

export interface CatalogCheck {
  slug: string;
  apiSportsId: number | null;
  status: 'ok' | 'missing' | 'mismatch' | 'unverified';
  details?: string;
  currentSeason?: number | undefined;
}

/** Compara config/competitions/football.yaml com o /leagues real: ID existe? nome, país e tipo batem? */
export function checkCatalog(catalog: CatalogCompetition[], leagues: ApiLeague[]): CatalogCheck[] {
  const byId = new Map(leagues.map((l) => [l.league.id, l]));
  return catalog.map((c): CatalogCheck => {
    if (c.api_sports_id == null) return { slug: c.slug, apiSportsId: null, status: 'unverified' };
    const l = byId.get(c.api_sports_id);
    if (!l)
      return {
        slug: c.slug,
        apiSportsId: c.api_sports_id,
        status: 'missing',
        details: 'ID ausente em /leagues',
      };
    const diffs: string[] = [];
    if (l.league.name !== c.name) diffs.push(`nome "${l.league.name}" ≠ "${c.name}"`);
    if (l.country.name !== c.country) diffs.push(`país "${l.country.name}" ≠ "${c.country}"`);
    if (l.league.type.toLowerCase() !== c.type) diffs.push(`tipo "${l.league.type}" ≠ "${c.type}"`);
    const currentSeason = l.seasons.find((s) => s.current)?.year;
    return diffs.length
      ? {
          slug: c.slug,
          apiSportsId: c.api_sports_id,
          status: 'mismatch',
          details: diffs.join('; '),
          currentSeason,
        }
      : { slug: c.slug, apiSportsId: c.api_sports_id, status: 'ok', currentSeason };
  });
}
// ─── persistência ────────────────────────────────────────────────────────────────────────────────

/** Grava o catálogo de forma idempotente: pode rodar todo dia (o /leagues é revalidado 1×/dia). */
export async function upsertFootballCatalog(db: Database, rows: CatalogRows): Promise<UpsertStats> {
  return upsertCatalog(db, 'football', rows);
}
