/**
 * Biblioteca de emissoras e plataformas (enrich.broadcaster): uma entrada por id canônico, montada
 * a partir dos dicionários por país (config/broadcasters/<iso2>.yaml) e dos logos com origem e
 * licença (config/broadcasters/_logos.yaml). O arquivo do logo é espelhado no nosso storage pelo
 * Asset Mirror do ingestor (core.asset, kind `broadcaster_logo`).
 */
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { asset, broadcaster, type BroadcasterKind, type BroadcasterMarket, type Database } from '@galaxie/db';
import type { WtwConfig } from './config/directory.js';
import { broadcasterKindOf, type LogoEntry } from './config/types.js';
import { domainHost } from './normalize.js';

export interface LibraryEntry {
  id: string;
  name: string;
  aliases: string[];
  kind: BroadcasterKind;
  countries: string[];
  channels: string[];
  website: string | null;
  markets: Record<string, BroadcasterMarket>;
  logo: LogoEntry | null;
}

/** Junta as entradas dos países (o nome do primeiro país em que aparece é o canônico). */
export function libraryFromConfig(config: WtwConfig): LibraryEntry[] {
  const out = new Map<string, LibraryEntry>();
  for (const country of config.countries) {
    for (const b of config.directory(country).broadcasters) {
      const e =
        out.get(b.id) ??
        ({
          id: b.id,
          name: b.name,
          aliases: [],
          kind: broadcasterKindOf(b.medium),
          countries: [],
          channels: [],
          website: null,
          markets: {},
          logo: config.logos.get(b.id) ?? null,
        } satisfies LibraryEntry);
      e.countries.push(country);
      for (const a of [b.name, ...b.aliases]) if (a !== e.name && !e.aliases.includes(a)) e.aliases.push(a);
      for (const c of b.channels) if (!e.channels.includes(c)) e.channels.push(c);
      // site oficial: primeiro domínio sem caminho (canais do YouTube ficam de fora)
      const site = b.domains.find((d) => !d.includes('/'));
      if (!e.website && site) e.website = `https://${domainHost(site)}`;
      e.markets[country] = {
        name: b.name,
        medium: b.medium,
        accessModel: b.accessModel,
        channels: b.channels,
        domains: b.domains,
      };
      out.set(b.id, e);
    }
  }
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export interface SyncLibraryResult {
  upserted: number;
  logosRegistered: number;
  withoutLogo: string[];
}

/**
 * Sincroniza a biblioteca com a configuração (idempotente). O logo vira um asset `broadcaster_logo`
 * pendente de espelhamento (o ingestor baixa e grava no storage) e é vinculado à emissora.
 */
export async function syncBroadcasterLibrary(
  db: Database,
  config: WtwConfig,
  now: Date = new Date(),
): Promise<SyncLibraryResult> {
  const entries = libraryFromConfig(config);
  const logoUrls = entries.flatMap((e) => (e.logo ? [e.logo.url] : []));
  let logosRegistered = 0;
  const assetIds = new Map<string, string>();
  if (logoUrls.length) {
    const inserted = await db
      .insert(asset)
      .values(logoUrls.map((url) => ({ kind: 'broadcaster_logo' as const, sourceUrl: url })))
      .onConflictDoNothing()
      .returning({ id: asset.id });
    logosRegistered = inserted.length;
    const rows = await db
      .select({ id: asset.id, sourceUrl: asset.sourceUrl })
      .from(asset)
      .where(inArray(asset.sourceUrl, logoUrls));
    for (const r of rows) assetIds.set(r.sourceUrl, r.id);
  }
  for (const e of entries) {
    const values = {
      name: e.name,
      aliases: e.aliases,
      kind: e.kind,
      countries: e.countries,
      channels: e.channels,
      website: e.website,
      markets: e.markets,
      logoAssetId: e.logo ? (assetIds.get(e.logo.url) ?? null) : null,
      logoSourceUrl: e.logo?.url ?? null,
      logoSourcePage: e.logo?.sourcePage ?? null,
      logoLicense: e.logo?.license ?? null,
      updatedAt: now,
    };
    await db
      .insert(broadcaster)
      .values({ id: e.id, ...values, createdAt: now })
      .onConflictDoUpdate({ target: broadcaster.id, set: values });
  }
  return {
    upserted: entries.length,
    logosRegistered,
    withoutLogo: entries.filter((e) => !e.logo).map((e) => e.id),
  };
}

export type BroadcasterRow = typeof broadcaster.$inferSelect & {
  logoStorageKey: string | null;
};

/** Biblioteca (com o asset do logo), opcionalmente filtrada por país ou ids. */
export async function listBroadcasters(
  db: Database,
  filter: { country?: string; ids?: string[] } = {},
): Promise<BroadcasterRow[]> {
  const conds = [];
  if (filter.country) conds.push(sql`${filter.country.toUpperCase()} = any(${broadcaster.countries})`);
  if (filter.ids) {
    if (!filter.ids.length) return [];
    conds.push(inArray(broadcaster.id, filter.ids));
  }
  const rows = await db
    .select({ b: broadcaster, logoStorageKey: asset.storageKey })
    .from(broadcaster)
    .leftJoin(asset, eq(asset.id, broadcaster.logoAssetId))
    .where(conds.length ? sql.join(conds, sql` and `) : undefined)
    .orderBy(asc(broadcaster.name));
  return rows.map((r) => ({ ...r.b, logoStorageKey: r.logoStorageKey }));
}
