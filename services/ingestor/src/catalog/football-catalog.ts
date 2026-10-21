import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  asset,
  competition,
  country,
  providerMap,
  season,
  sport,
  type Database,
  type I18nText,
} from '@galaxie/db';
import type { CatalogCompetition } from './catalog-config.js';

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

export interface CompetitionRow {
  providerId: string;
  slug: string;
  name: string;
  labels: I18nText | null;
  countryCode: string;
  type: 'league' | 'cup';
  tier: number;
  livePriority: string;
  logoUrl: string | null;
  seasons: {
    year: number;
    label: string;
    startDate: string | null;
    endDate: string | null;
    current: boolean;
    coverage: unknown;
  }[];
}

export interface CountryRow {
  code: string;
  name: I18nText;
  flagUrl: string | null;
}

export interface CatalogRows {
  countries: CountryRow[];
  competitions: CompetitionRow[];
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

const SPORTS: { slug: string; name: I18nText }[] = [
  { slug: 'football', name: { 'pt-BR': 'Futebol', es: 'Fútbol', en: 'Football' } },
  { slug: 'afl', name: { 'pt-BR': 'Futebol australiano', es: 'Fútbol australiano', en: 'AFL' } },
  { slug: 'baseball', name: { 'pt-BR': 'Beisebol', es: 'Béisbol', en: 'Baseball' } },
  { slug: 'basketball', name: { 'pt-BR': 'Basquete', es: 'Básquetbol', en: 'Basketball' } },
  { slug: 'formula-1', name: { 'pt-BR': 'Fórmula 1', es: 'Fórmula 1', en: 'Formula 1' } },
  { slug: 'handball', name: { 'pt-BR': 'Handebol', es: 'Balonmano', en: 'Handball' } },
  { slug: 'hockey', name: { 'pt-BR': 'Hóquei', es: 'Hockey', en: 'Hockey' } },
  { slug: 'mma', name: { 'pt-BR': 'MMA', es: 'MMA', en: 'MMA' } },
  { slug: 'nba', name: { 'pt-BR': 'NBA', es: 'NBA', en: 'NBA' } },
  {
    slug: 'american-football',
    name: { 'pt-BR': 'Futebol americano', es: 'Fútbol americano', en: 'American football' },
  },
  { slug: 'rugby', name: { 'pt-BR': 'Rúgbi', es: 'Rugby', en: 'Rugby' } },
  { slug: 'volleyball', name: { 'pt-BR': 'Vôlei', es: 'Vóleibol', en: 'Volleyball' } },
];

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface UpsertStats {
  countries: number;
  competitions: { inserted: number; updated: number };
  seasons: number;
  assets: number;
}

/** Grava o catálogo de forma idempotente: pode rodar todo dia (o /leagues é revalidado 1×/dia). */
export async function upsertFootballCatalog(db: Database, rows: CatalogRows): Promise<UpsertStats> {
  return db.transaction(async (tx) => {
    await tx.insert(sport).values(SPORTS).onConflictDoNothing();

    // assets (bandeiras e logos) — baixados depois pelo Asset Mirror
    const assetRows = [
      ...rows.countries
        .filter((c) => c.flagUrl)
        .map((c) => ({ kind: 'flag' as const, sourceUrl: c.flagUrl! })),
      ...rows.competitions
        .filter((c) => c.logoUrl)
        .map((c) => ({ kind: 'league_logo' as const, sourceUrl: c.logoUrl! })),
    ];
    for (const chunk of chunks(assetRows, 500)) await tx.insert(asset).values(chunk).onConflictDoNothing();
    const assetIds = new Map<string, string>();
    for (const chunk of chunks([...new Set(assetRows.map((a) => a.sourceUrl))], 500)) {
      const found = await tx
        .select({ id: asset.id, url: asset.sourceUrl })
        .from(asset)
        .where(inArray(asset.sourceUrl, chunk));
      for (const f of found) assetIds.set(f.url, f.id);
    }

    for (const chunk of chunks(rows.countries, 500)) {
      await tx
        .insert(country)
        .values(
          chunk.map((c) => ({
            code: c.code,
            name: c.name,
            flagAssetId: c.flagUrl ? (assetIds.get(c.flagUrl) ?? null) : null,
          })),
        )
        .onConflictDoUpdate({
          target: country.code,
          // preserva traduções já cadastradas (pt-BR, es...) e atualiza o nome em inglês
          set: {
            name: sql`${country.name} || excluded.name`,
            flagAssetId: sql`coalesce(excluded.flag_asset_id, ${country.flagAssetId})`,
          },
        });
    }

    const mapped = await tx
      .select({ providerId: providerMap.providerId, entityId: providerMap.entityId })
      .from(providerMap)
      .where(
        and(
          eq(providerMap.provider, 'api-sports'),
          eq(providerMap.sport, 'football'),
          eq(providerMap.entityType, 'competition'),
        ),
      );
    const existing = new Map(mapped.map((m) => [m.providerId, m.entityId]));

    let inserted = 0;
    let updated = 0;
    const seasonRows: (typeof season.$inferInsert)[] = [];
    for (const c of rows.competitions) {
      const values = {
        sport: 'football',
        slug: c.slug,
        name: c.name,
        labels: c.labels,
        countryCode: c.countryCode,
        type: c.type,
        tier: c.tier,
        livePriority: c.livePriority,
        logoAssetId: c.logoUrl ? (assetIds.get(c.logoUrl) ?? null) : null,
      };
      let id = existing.get(c.providerId);
      if (id) {
        await tx.update(competition).set(values).where(eq(competition.id, id));
        updated += 1;
      } else {
        const [row] = await tx.insert(competition).values(values).returning({ id: competition.id });
        id = row!.id;
        await tx.insert(providerMap).values({
          entityType: 'competition',
          entityId: id,
          provider: 'api-sports',
          sport: 'football',
          providerId: c.providerId,
        });
        inserted += 1;
      }
      for (const s of c.seasons) seasonRows.push({ competitionId: id, ...s });
    }

    for (const chunk of chunks(seasonRows, 1000)) {
      await tx
        .insert(season)
        .values(chunk)
        .onConflictDoUpdate({
          target: [season.competitionId, season.year],
          set: {
            label: sql`excluded.label`,
            startDate: sql`excluded.start_date`,
            endDate: sql`excluded.end_date`,
            current: sql`excluded.current`,
            coverage: sql`excluded.coverage`,
            updatedAt: sql`now()`,
          },
        });
    }

    return {
      countries: rows.countries.length,
      competitions: { inserted, updated },
      seasons: seasonRows.length,
      assets: assetIds.size,
    };
  });
}
