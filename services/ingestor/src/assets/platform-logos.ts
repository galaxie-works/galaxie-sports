/**
 * Logos das plataformas da grade de canais e ofertas (enrich.platform: operadoras de TV paga, TV pela
 * internet, combos de telecom e streamings), no padrão da biblioteca de emissoras:
 *
 * 1. a entrada da biblioteca de emissoras com o mesmo site oficial (acervo oficial ou Commons já
 *    curados) — o logo dela vale para a plataforma;
 * 2. senão, o logo do item do Wikidata (P154, arquivo da Wikimedia Commons) cujo site oficial (P856) é
 *    o da plataforma — mesmo host, ou o mesmo domínio com o nome igual ao rótulo ou a um apelido;
 *    só licenças livres para uso comercial (domínio público, CC0, CC BY, CC BY-SA), lidas da Commons.
 *
 * O arquivo vai para o nosso storage (`platforms/<sha256[0..16]>.png`, a miniatura PNG da Commons: o
 * SVG original nunca é servido), com core.asset (`origin = commons`, `commons://File:…`) e o crédito
 * em core.asset_credit, e liga em `enrich.platform.logo_asset_id`. Sem fonte verificável, a
 * plataforma fica sem logo — nada de logo inventado. Os nomes das plataformas só existem no banco.
 */
import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm';
import { asset, assetCredit, broadcaster, platform, type Database } from '@galaxie/db';
import { WIKIDATA_API, type WikimediaClient } from './commons/client.js';
import { commonsSourceUrl } from './commons/import.js';
import { readLicense } from './commons/license.js';
import { imageInfo } from './image-info.js';
import type { ObjectStore } from './object-store.js';

/** Prefixo das chaves dos logos de plataformas no bucket. */
export const PLATFORM_LOGO_PREFIX = 'platforms';
/** Largura da miniatura PNG pedida à Commons (o card mostra o logo a ~56 px; sobra para telas densas). */
export const PLATFORM_LOGO_WIDTH = 480;

// ─── site oficial ────────────────────────────────────────────────────────────────────────────────

/** Host do site sem `www.` (null se não for URL http). */
export function siteHost(url: string | null | undefined): string | null {
  if (!url) return null;
  // sem esquema = domínio solto (`operadora.example`); com outro esquema que não http, fora
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(url)?.[1]?.toLowerCase();
  if (scheme && scheme !== 'http' && scheme !== 'https') return null;
  try {
    const u = new URL(scheme ? url : `https://${url}`);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.hostname.toLowerCase().replace(/^www\d?\./, '') || null;
  } catch {
    return null;
  }
}

/** Segundo nível usado sob os ccTLDs da região (globo.com.br, gob.ar, co.uk…). */
const SECOND_LEVEL = new Set(['com', 'net', 'org', 'gov', 'gob', 'edu', 'co', 'tv', 'mil', 'nom']);

/** Domínio registrável (aproximado, sem a lista pública de sufixos): `globo.com`, `operadora.com.br`. */
export function registrableDomain(host: string): string {
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const tld = parts.at(-1)!;
  const sld = parts.at(-2)!;
  const keep = tld.length === 2 && SECOND_LEVEL.has(sld) ? 3 : 2;
  return parts.slice(-keep).join('.');
}

/** Nome para comparar: sem acento, caixa, pontuação e o "+" final (`Serviço+` = `servico plus`). */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ─── Wikidata ────────────────────────────────────────────────────────────────────────────────────

interface Snak {
  rank?: 'preferred' | 'normal' | 'deprecated';
  mainsnak?: { datavalue?: { value?: unknown } };
  qualifiers?: Record<string, unknown[]>;
}

/** Item do Wikidata no recorte que a escolha usa. */
export interface WikidataOrg {
  id: string;
  names: string[];
  websites: string[];
  /** Arquivos da Commons (P154), o preferido e o vigente primeiro. */
  logos: string[];
}

const strings = (claims: unknown[] | undefined): string[] =>
  (claims ?? []).flatMap((c) => {
    const v = (c as Snak).mainsnak?.datavalue?.value;
    return typeof v === 'string' && (c as Snak).rank !== 'deprecated' ? [v] : [];
  });

/** P154 na ordem: rank preferido, depois sem data de fim (P582), na ordem do item. */
export function logoFiles(claims: unknown[] | undefined): string[] {
  const live = (claims ?? []).filter((c) => (c as Snak).rank !== 'deprecated') as Snak[];
  const score = (c: Snak) => (c.rank === 'preferred' ? 0 : 2) + (c.qualifiers?.P582?.length ? 1 : 0);
  return live
    .map((c, i) => ({ c, i }))
    .sort((a, b) => score(a.c) - score(b.c) || a.i - b.i)
    .flatMap(({ c }) => {
      const v = c.mainsnak?.datavalue?.value;
      return typeof v === 'string' ? [v] : [];
    });
}

/** Itens pelo nome (rótulos e apelidos em en/pt/es), com site oficial e logo. */
export async function findWikidataOrgs(client: WikimediaClient, name: string): Promise<WikidataOrg[]> {
  const ids = new Set<string>();
  for (const language of ['en', 'pt', 'es']) {
    const body = await client.get(WIKIDATA_API, {
      action: 'wbsearchentities',
      search: name,
      language,
      uselang: language,
      type: 'item',
      limit: 7,
    });
    for (const s of (body.search as { id: string }[] | undefined) ?? []) ids.add(s.id);
  }
  if (!ids.size) return [];
  const body = await client.get(WIKIDATA_API, {
    action: 'wbgetentities',
    ids: [...ids].join('|'),
    props: 'claims|labels|aliases',
    languages: 'en|pt|es',
  });
  type Entity = {
    labels?: Record<string, { value: string }>;
    aliases?: Record<string, { value: string }[]>;
    claims?: Record<string, unknown[]>;
  };
  return Object.entries((body.entities ?? {}) as Record<string, Entity>).map(([id, e]) => ({
    id,
    names: [
      ...Object.values(e.labels ?? {}).map((l) => l.value),
      ...Object.values(e.aliases ?? {}).flatMap((a) => a.map((x) => x.value)),
    ],
    websites: strings(e.claims?.P856),
    logos: logoFiles(e.claims?.P154),
  }));
}

export type OrgMatch = { org: WikidataOrg; by: 'site' | 'domain_and_name' };

/**
 * O item que é a plataforma: o site oficial dele tem o mesmo host do site da plataforma; senão, o
 * mesmo domínio registrável e o nome igual a um rótulo ou apelido (`tv.serviço.com` × `serviço.com`).
 * Domínio igual sem o nome não basta: `premium.emissora.com` não é a `emissora.com`.
 */
export function matchOrg(
  target: { name: string; website: string | null },
  orgs: WikidataOrg[],
): OrgMatch | null {
  const host = siteHost(target.website);
  if (!host) return null;
  const withLogo = orgs.filter((o) => o.logos.length);
  const bySite = withLogo.find((o) => o.websites.some((w) => siteHost(w) === host));
  if (bySite) return { org: bySite, by: 'site' };
  const domain = registrableDomain(host);
  const name = normalizeName(target.name);
  const byName = withLogo.find(
    (o) =>
      o.websites.some((w) => {
        const h = siteHost(w);
        return h !== null && registrableDomain(h) === domain;
      }) && o.names.some((n) => normalizeName(n) === name),
  );
  return byName ? { org: byName, by: 'domain_and_name' } : null;
}

// ─── execução ────────────────────────────────────────────────────────────────────────────────────

export interface PlatformLogoTarget {
  id: string;
  slug: string;
  name: string;
  country: string;
  website: string | null;
}

export type PlatformLogoOutcome =
  | { slug: string; status: 'library'; broadcasterId: string }
  | { slug: string; status: 'commons'; file: string; license: string; wikidata: string; by: OrgMatch['by'] }
  | { slug: string; status: 'skipped'; reason: string };

export interface PlatformLogoReport {
  pending: number;
  outcomes: PlatformLogoOutcome[];
}

/** Plataformas sem logo (ou todas, com `force`), fora as rejeitadas no painel. */
export async function platformsWithoutLogo(
  db: Database,
  opts: { countries?: string[]; slug?: string; force?: boolean } = {},
): Promise<PlatformLogoTarget[]> {
  return db
    .select({
      id: platform.id,
      slug: platform.slug,
      name: platform.name,
      country: platform.country,
      website: platform.website,
    })
    .from(platform)
    .where(
      and(
        ne(platform.reviewStatus, 'rejected'),
        opts.force ? undefined : isNull(platform.logoAssetId),
        opts.countries?.length ? inArray(platform.country, opts.countries) : undefined,
        opts.slug ? eq(platform.slug, opts.slug) : undefined,
      ),
    )
    .orderBy(asc(platform.country), asc(platform.slug));
}

/** Logo da biblioteca de emissoras cujo site oficial tem o mesmo host do da plataforma. */
async function libraryLogo(
  db: Database,
  target: PlatformLogoTarget,
): Promise<{ broadcasterId: string; assetId: string } | null> {
  const host = siteHost(target.website);
  if (!host) return null;
  const rows = await db
    .select({ id: broadcaster.id, website: broadcaster.website, assetId: broadcaster.logoAssetId })
    .from(broadcaster)
    .innerJoin(asset, eq(asset.id, broadcaster.logoAssetId))
    .where(and(isNotNull(broadcaster.website), isNotNull(asset.storageKey)));
  const hit = rows.find((r) => siteHost(r.website) === host);
  return hit?.assetId ? { broadcasterId: hit.id, assetId: hit.assetId } : null;
}

/** Busca, grava e liga o logo de cada plataforma sem logo. Com `dryRun`, só diz o que faria. */
export async function runPlatformLogos(options: {
  db: Database;
  client: WikimediaClient;
  objects: ObjectStore;
  targets: PlatformLogoTarget[];
  dryRun?: boolean;
  log?: (msg: string) => void;
}): Promise<PlatformLogoReport> {
  const { db, client, objects } = options;
  const report: PlatformLogoReport = { pending: options.targets.length, outcomes: [] };
  const done = (o: PlatformLogoOutcome) => {
    report.outcomes.push(o);
    options.log?.(
      o.status === 'skipped'
        ? `${o.slug}: sem logo — ${o.reason}`
        : o.status === 'library'
          ? `${o.slug}: logo da biblioteca (${o.broadcasterId})`
          : `${o.slug}: ${o.file} (${o.license}, ${o.wikidata})`,
    );
  };

  for (const t of options.targets) {
    if (!siteHost(t.website)) {
      done({ slug: t.slug, status: 'skipped', reason: 'sem site oficial para conferir' });
      continue;
    }
    const lib = await libraryLogo(db, t);
    if (lib) {
      if (!options.dryRun)
        await db.update(platform).set({ logoAssetId: lib.assetId }).where(eq(platform.id, t.id));
      done({ slug: t.slug, status: 'library', broadcasterId: lib.broadcasterId });
      continue;
    }

    const match = matchOrg(t, await findWikidataOrgs(client, t.name));
    if (!match) {
      done({ slug: t.slug, status: 'skipped', reason: 'nenhum item do Wikidata com o mesmo site e logo' });
      continue;
    }
    const title = `File:${match.org.logos[0]!}`;
    const [info] = await client.imageInfo([title], PLATFORM_LOGO_WIDTH);
    if (!info) {
      done({ slug: t.slug, status: 'skipped', reason: `${title} não encontrado na Commons` });
      continue;
    }
    const license = readLicense(info.extmetadata);
    if (!license.ok) {
      done({ slug: t.slug, status: 'skipped', reason: `${title}: ${license.reason}` });
      continue;
    }
    if (options.dryRun) {
      done({
        slug: t.slug,
        status: 'commons',
        file: info.title,
        license: license.value.license,
        wikidata: match.org.id,
        by: match.by,
      });
      continue;
    }

    const { body, contentType } = await client.download(info.thumbUrl);
    const meta = imageInfo(body, contentType ?? 'image/png');
    if (meta.contentType !== 'image/png' && meta.contentType !== 'image/jpeg') {
      done({ slug: t.slug, status: 'skipped', reason: `${title}: miniatura em ${meta.contentType}` });
      continue;
    }
    const sha = createHash('sha256').update(body).digest('hex');
    const key = `${PLATFORM_LOGO_PREFIX}/${sha.slice(0, 16)}.${meta.contentType === 'image/png' ? 'png' : 'jpg'}`;
    await objects.put(key, body, meta.contentType, sha);
    const stored = {
      storageKey: key,
      sha256: sha,
      width: meta.width,
      height: meta.height,
      bytes: body.byteLength,
      fetchedAt: new Date(),
      origin: 'commons' as const,
    };
    const [row] = await db
      .insert(asset)
      .values({ kind: 'broadcaster_logo', sourceUrl: commonsSourceUrl(info.title), ...stored })
      .onConflictDoUpdate({ target: asset.sourceUrl, set: stored })
      .returning({ id: asset.id });
    const c = license.value;
    const credit = {
      source: 'wikimedia-commons',
      title: info.title,
      pageUrl: info.pageUrl,
      author: c.author,
      authorUrl: c.authorUrl,
      license: c.license,
      licenseUrl: c.licenseUrl,
      credit: c.credit,
      attribution: c.attribution,
      attributionRequired: c.attributionRequired,
      shareAlike: c.shareAlike,
      dateTaken: c.dateTaken,
      originalWidth: info.width,
      originalHeight: info.height,
      retrievedAt: new Date(),
    };
    await db
      .insert(assetCredit)
      .values({ assetId: row!.id, ...credit })
      .onConflictDoUpdate({ target: assetCredit.assetId, set: credit });
    await db.update(platform).set({ logoAssetId: row!.id }).where(eq(platform.id, t.id));
    done({
      slug: t.slug,
      status: 'commons',
      file: info.title,
      license: c.license,
      wikidata: match.org.id,
      by: match.by,
    });
  }
  return report;
}
