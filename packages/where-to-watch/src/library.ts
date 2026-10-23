/**
 * Biblioteca de emissoras e plataformas (enrich.broadcaster): uma entrada por id canônico, montada
 * a partir dos dicionários por país (config/broadcasters/<iso2>.yaml) e dos logos. O logo vem do
 * acervo oficial (config/broadcasters/_official_logos.yaml — versões clara e escura, e logos dos
 * canais) quando o importador já subiu o arquivo; senão, do logo com origem e licença
 * (config/broadcasters/_logos.yaml), espelhado no nosso storage pelo Asset Mirror do ingestor
 * (core.asset, kind `broadcaster_logo`).
 */
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  asset,
  broadcaster,
  type BroadcasterChannelLogo,
  type BroadcasterKind,
  type BroadcasterMarket,
  type Database,
} from '@galaxie/db';
import type { WtwConfig } from './config/directory.js';
import { broadcasterKindOf, type LogoEntry } from './config/types.js';
import { domainHost } from './normalize.js';
import {
  channelKey,
  OFFICIAL_LOGO_LICENSE,
  officialLogosByBroadcaster,
  officialLogoSourceUrl,
} from './official-logos.js';

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
  /** Emissoras com o logo do acervo oficial. */
  officialLogos: number;
  /** Logos de canal (acervo oficial) ligados. */
  channelLogos: number;
  withoutLogo: string[];
}

/** Assets do acervo oficial já no storage, por origem (`acervo-oficial://<nó>`). */
async function storedOfficialAssets(db: Database, urls: string[]): Promise<Map<string, string>> {
  if (!urls.length) return new Map();
  const rows = await db
    .select({ id: asset.id, sourceUrl: asset.sourceUrl })
    .from(asset)
    .where(and(inArray(asset.sourceUrl, urls), isNotNull(asset.storageKey)));
  return new Map(rows.map((r) => [r.sourceUrl, r.id]));
}

/**
 * Sincroniza a biblioteca com a configuração (idempotente). O logo do acervo oficial vale quando o
 * importador (`assets:official-logos`) já gravou o arquivo; senão, o logo de `_logos.yaml` vira um
 * asset `broadcaster_logo` pendente de espelhamento (o ingestor baixa e grava no storage).
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
  const official = officialLogosByBroadcaster(config.officialLogos);
  const officialNodes = [...official.values()].flatMap((g) =>
    [g.primary, ...g.channels].flatMap((l) => (l ? [l.light, ...(l.dark ? [l.dark] : [])] : [])),
  );
  const stored = await storedOfficialAssets(db, officialNodes.map(officialLogoSourceUrl));
  const storedId = (node: string | null | undefined) =>
    node ? (stored.get(officialLogoSourceUrl(node)) ?? null) : null;
  let officialLogos = 0;
  let channelLogos = 0;
  const withoutLogo: string[] = [];
  for (const e of entries) {
    const g = official.get(e.id);
    const primary = g?.primary && storedId(g.primary.light) ? g.primary : null;
    const channels: Record<string, BroadcasterChannelLogo> = {};
    for (const c of g?.channels ?? []) {
      const id = storedId(c.light);
      if (!id || !c.channel) continue;
      channels[channelKey(c.channel)] = { name: c.channel, assetId: id, darkAssetId: storedId(c.dark) };
      channelLogos++;
    }
    if (primary) officialLogos++;
    else if (!e.logo) withoutLogo.push(e.id);
    const logo = primary
      ? {
          logoAssetId: storedId(primary.light),
          logoDarkAssetId: storedId(primary.dark),
          logoSourceUrl: officialLogoSourceUrl(primary.light),
          logoSourcePage: null,
          logoLicense: OFFICIAL_LOGO_LICENSE,
        }
      : {
          logoAssetId: e.logo ? (assetIds.get(e.logo.url) ?? null) : null,
          logoDarkAssetId: null,
          logoSourceUrl: e.logo?.url ?? null,
          logoSourcePage: e.logo?.sourcePage ?? null,
          logoLicense: e.logo?.license ?? null,
        };
    const values = {
      name: e.name,
      aliases: e.aliases,
      kind: e.kind,
      countries: e.countries,
      channels: e.channels,
      website: e.website,
      markets: e.markets,
      ...logo,
      channelLogos: channels,
      updatedAt: now,
    };
    await db
      .insert(broadcaster)
      .values({ id: e.id, ...values, createdAt: now })
      .onConflictDoUpdate({ target: broadcaster.id, set: values });
  }
  return { upserted: entries.length, logosRegistered, officialLogos, channelLogos, withoutLogo };
}

/** Logo de um canal já resolvido para as chaves do storage. */
export interface ChannelLogoKeys {
  name: string;
  storageKey: string | null;
  darkStorageKey: string | null;
}

export type BroadcasterRow = typeof broadcaster.$inferSelect & {
  logoStorageKey: string | null;
  logoDarkStorageKey: string | null;
  /** Logos dos canais pela chave normalizada do nome (`channelKey`). */
  channelLogoKeys: Record<string, ChannelLogoKeys>;
};

const darkAsset = alias(asset, 'logo_dark_asset');

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
    .select({ b: broadcaster, logoStorageKey: asset.storageKey, logoDarkStorageKey: darkAsset.storageKey })
    .from(broadcaster)
    .leftJoin(asset, eq(asset.id, broadcaster.logoAssetId))
    .leftJoin(darkAsset, eq(darkAsset.id, broadcaster.logoDarkAssetId))
    .where(conds.length ? sql.join(conds, sql` and `) : undefined)
    .orderBy(asc(broadcaster.name));
  const channelAssetIds = [
    ...new Set(
      rows.flatMap((r) => Object.values(r.b.channelLogos).flatMap((c) => [c.assetId, c.darkAssetId])),
    ),
  ].filter((id): id is string => !!id);
  const keys = new Map<string, string | null>();
  if (channelAssetIds.length) {
    const found = await db
      .select({ id: asset.id, storageKey: asset.storageKey })
      .from(asset)
      .where(inArray(asset.id, channelAssetIds));
    for (const a of found) keys.set(a.id, a.storageKey);
  }
  const keyOf = (id: string | null) => (id ? (keys.get(id) ?? null) : null);
  return rows.map((r) => ({
    ...r.b,
    logoStorageKey: r.logoStorageKey,
    logoDarkStorageKey: r.logoDarkStorageKey,
    channelLogoKeys: Object.fromEntries(
      Object.entries(r.b.channelLogos).map(([k, c]) => [
        k,
        { name: c.name, storageKey: keyOf(c.assetId), darkStorageKey: keyOf(c.darkAssetId) },
      ]),
    ),
  }));
}
