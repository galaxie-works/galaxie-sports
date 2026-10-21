import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  asset,
  competition,
  country,
  participant,
  providerMap,
  season,
  sport,
  venue,
  type Database,
  type I18nText,
} from '@galaxie/db';

// ─── formato intermediário (comum aos 12 esportes) ───────────────────────────────────────────────

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
    /** Valor do parâmetro `season` no fornecedor quando difere do ano (ex.: basquete "2024-2025"). */
    providerKey?: string;
  }[];
}

export interface CountryRow {
  code: string;
  name: I18nText;
  flagUrl: string | null;
}

/** Times/equipes/construtores que fazem parte do catálogo de referência (F1 /teams, NBA /teams). */
export interface ParticipantRow {
  providerId: string;
  kind: 'club' | 'constructor';
  name: string;
  shortName: string | null;
  code: string | null;
  countryCode: string | null;
  logoUrl: string | null;
}

/** Locais do catálogo de referência (F1 /circuits). `countryName` é resolvido para código ao gravar. */
export interface VenueRow {
  providerId: string;
  name: string;
  city: string | null;
  countryName: string | null;
  capacity: number | null;
  imageUrl: string | null;
}

export interface CatalogRows {
  countries: CountryRow[];
  competitions: CompetitionRow[];
  participants?: ParticipantRow[];
  venues?: VenueRow[];
}

export interface UpsertStats {
  countries: number;
  competitions: { inserted: number; updated: number };
  seasons: number;
  assets: number;
  participants?: { inserted: number; updated: number };
  venues?: { inserted: number; updated: number };
}

// ─── persistência ────────────────────────────────────────────────────────────────────────────────

export const SPORTS: { slug: string; name: I18nText }[] = [
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

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

async function mappedIds(tx: Tx, sportSlug: string, entityType: string): Promise<Map<string, string>> {
  const rows = await tx
    .select({ providerId: providerMap.providerId, entityId: providerMap.entityId })
    .from(providerMap)
    .where(
      and(
        eq(providerMap.provider, 'api-sports'),
        eq(providerMap.sport, sportSlug),
        eq(providerMap.entityType, entityType),
      ),
    );
  return new Map(rows.map((m) => [m.providerId, m.entityId]));
}

/**
 * Upsert genérico por entidade mapeada: atualiza se o ID do fornecedor (no escopo do esporte) já existe
 * em core.provider_map; senão insere e mapeia. Mantém o nosso ID estável entre execuções.
 */
async function upsertMapped<V>(
  tx: Tx,
  sportSlug: string,
  entityType: string,
  rows: { providerId: string; values: V }[],
  insert: (values: V) => Promise<string>,
  update: (id: string, values: V) => Promise<void>,
): Promise<{ inserted: number; updated: number; ids: Map<string, string> }> {
  const existing = await mappedIds(tx, sportSlug, entityType);
  let inserted = 0;
  let updated = 0;
  for (const r of rows) {
    let id = existing.get(r.providerId);
    if (id) {
      await update(id, r.values);
      updated += 1;
    } else {
      id = await insert(r.values);
      await tx.insert(providerMap).values({
        entityType,
        entityId: id,
        provider: 'api-sports',
        sport: sportSlug,
        providerId: r.providerId,
      });
      existing.set(r.providerId, id);
      inserted += 1;
    }
  }
  return { inserted, updated, ids: existing };
}

/**
 * Grava o catálogo de um esporte de forma idempotente (pode rodar todo dia): esportes, países, assets
 * (bandeiras, logos, imagens — baixados depois pelo Asset Mirror), competições, temporadas e, quando a API
 * tem, participantes e locais de referência. IDs do fornecedor ficam em core.provider_map no escopo do esporte.
 */
export async function upsertCatalog(
  db: Database,
  sportSlug: string,
  rows: CatalogRows,
): Promise<UpsertStats> {
  return db.transaction(async (tx) => {
    await tx.insert(sport).values(SPORTS).onConflictDoNothing();

    const assetRows = [
      ...rows.countries
        .filter((c) => c.flagUrl)
        .map((c) => ({ kind: 'flag' as const, sourceUrl: c.flagUrl! })),
      ...rows.competitions
        .filter((c) => c.logoUrl)
        .map((c) => ({ kind: 'league_logo' as const, sourceUrl: c.logoUrl! })),
      ...(rows.participants ?? [])
        .filter((p) => p.logoUrl)
        .map((p) => ({ kind: 'team_logo' as const, sourceUrl: p.logoUrl! })),
      ...(rows.venues ?? [])
        .filter((v) => v.imageUrl)
        .map((v) => ({ kind: 'circuit' as const, sourceUrl: v.imageUrl! })),
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
    const assetId = (url: string | null) => (url ? (assetIds.get(url) ?? null) : null);

    for (const chunk of chunks(rows.countries, 500)) {
      await tx
        .insert(country)
        .values(chunk.map((c) => ({ code: c.code, name: c.name, flagAssetId: assetId(c.flagUrl) })))
        .onConflictDoUpdate({
          target: country.code,
          // preserva traduções já cadastradas (pt-BR, es...) e atualiza o nome em inglês
          set: {
            name: sql`${country.name} || excluded.name`,
            flagAssetId: sql`coalesce(excluded.flag_asset_id, ${country.flagAssetId})`,
          },
        });
    }

    const comps = await upsertMapped(
      tx,
      sportSlug,
      'competition',
      rows.competitions.map((c) => ({
        providerId: c.providerId,
        values: {
          sport: sportSlug,
          slug: c.slug,
          name: c.name,
          labels: c.labels,
          countryCode: c.countryCode,
          type: c.type,
          tier: c.tier,
          livePriority: c.livePriority,
          logoAssetId: assetId(c.logoUrl),
        },
      })),
      async (values) => {
        const [row] = await tx.insert(competition).values(values).returning({ id: competition.id });
        return row!.id;
      },
      async (id, values) => {
        await tx.update(competition).set(values).where(eq(competition.id, id));
      },
    );

    const seasonRows: (typeof season.$inferInsert)[] = [];
    for (const c of rows.competitions) {
      const competitionId = comps.ids.get(c.providerId)!;
      for (const s of c.seasons) {
        seasonRows.push({
          competitionId,
          year: s.year,
          label: s.label,
          startDate: s.startDate,
          endDate: s.endDate,
          current: s.current,
          coverage: s.coverage,
        });
      }
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

    const stats: UpsertStats = {
      countries: rows.countries.length,
      competitions: { inserted: comps.inserted, updated: comps.updated },
      seasons: seasonRows.length,
      assets: assetIds.size,
    };

    if (rows.participants?.length) {
      const res = await upsertMapped(
        tx,
        sportSlug,
        'participant',
        rows.participants.map((p) => ({
          providerId: p.providerId,
          values: {
            sport: sportSlug,
            kind: p.kind,
            name: p.name,
            shortName: p.shortName,
            code: p.code,
            countryCode: p.countryCode,
            logoAssetId: assetId(p.logoUrl),
          },
        })),
        async (values) => {
          const [row] = await tx.insert(participant).values(values).returning({ id: participant.id });
          return row!.id;
        },
        async (id, values) => {
          await tx.update(participant).set(values).where(eq(participant.id, id));
        },
      );
      stats.participants = { inserted: res.inserted, updated: res.updated };
    }

    if (rows.venues?.length) {
      // país do local vem por nome ("Italy", "USA"): resolve pelo nome em inglês já cadastrado
      const known = await tx
        .select({ code: country.code, en: sql<string | null>`${country.name}->>'en'` })
        .from(country);
      const byName = new Map(known.filter((k) => k.en).map((k) => [k.en!.toLowerCase(), k.code]));
      const res = await upsertMapped(
        tx,
        sportSlug,
        'venue',
        rows.venues.map((v) => ({
          providerId: v.providerId,
          values: {
            name: v.name,
            city: v.city,
            countryCode: v.countryName ? (byName.get(v.countryName.toLowerCase()) ?? null) : null,
            capacity: v.capacity,
            imageAssetId: assetId(v.imageUrl),
          },
        })),
        async (values) => {
          const [row] = await tx.insert(venue).values(values).returning({ id: venue.id });
          return row!.id;
        },
        async (id, values) => {
          await tx.update(venue).set(values).where(eq(venue.id, id));
        },
      );
      stats.venues = { inserted: res.inserted, updated: res.updated };
    }

    return stats;
  });
}
