import { and, asc, eq, inArray, isNotNull, isNull, notInArray, or, sql } from 'drizzle-orm';
import {
  isProviderMediaUrl,
  mediaKindFromUrl,
  normalizeMediaUrl,
  type MediaAssetKind,
} from '@galaxie/apisports-client';
import { apiResponse, asset, type AssetPalette, type Database } from '@galaxie/db';
import { PLACEHOLDER_LOGO_SHA256 } from './palette.js';

/**
 * Estado de um asset em core.asset:
 * - pendente:   storage_key nulo e fetched_at nulo;
 * - espelhado:  storage_key preenchido (sha256, bytes, dimensões e fetched_at junto);
 * - ausente:    storage_key nulo e fetched_at preenchido — 404 na CDN ou bloqueado; não é tentado de novo
 *               (a não ser com `includeMissing`).
 */
export interface MirrorAsset {
  id: string;
  sourceUrl: string;
  kind: MediaAssetKind;
}

export interface StoredInfo {
  storageKey: string;
  sha256: string;
  bytes: number;
  width: number | null;
  height: number | null;
  fetchedAt: Date;
  /** Cores do escudo (só team_logo em PNG); ausente = não mexe na coluna. */
  palette?: AssetPalette | null;
}

/** team_logo já espelhado em PNG e ainda sem paleta (backfill `assets:palette`). */
export interface PaletteCandidate {
  id: string;
  storageKey: string;
}

export interface PendingQuery {
  limit?: number | undefined;
  /** Inclui os marcados como ausentes (404/bloqueados) para nova tentativa. */
  includeMissing?: boolean | undefined;
}

export interface AssetCounts {
  total: number;
  stored: number;
  missing: number;
  pending: number;
}

export interface AssetStore {
  pending(query?: PendingQuery): Promise<MirrorAsset[]>;
  markStored(id: string, info: StoredInfo): Promise<void>;
  markMissing(id: string, at: Date): Promise<void>;
  /** Desvincula do storage assets já espelhados que entraram na lista de bloqueio. Retorna quantos. */
  unlink(urls: string[], at: Date): Promise<number>;
  /** Registra URLs novas (idempotente). Retorna quantas eram novas. */
  register(urls: string[]): Promise<number>;
  counts(): Promise<AssetCounts>;
  /** team_logo espelhados em PNG com palette nula (fora os placeholders do fornecedor), na ordem de criação. */
  paletteCandidates(limit?: number): Promise<PaletteCandidate[]>;
  savePalette(id: string, palette: AssetPalette): Promise<void>;
}

// ─── memória (testes) ────────────────────────────────────────────────────────────────────────────

export interface MemoryAssetRow extends MirrorAsset {
  storageKey: string | null;
  sha256: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  fetchedAt: Date | null;
  palette: AssetPalette | null;
}

export class InMemoryAssetStore implements AssetStore {
  readonly rows: MemoryAssetRow[] = [];
  private seq = 0;

  constructor(urls: string[] = []) {
    for (const url of urls) this.add(url);
  }

  private add(url: string): MemoryAssetRow {
    const row: MemoryAssetRow = {
      id: String(++this.seq),
      sourceUrl: url,
      kind: mediaKindFromUrl(url),
      storageKey: null,
      sha256: null,
      bytes: null,
      width: null,
      height: null,
      fetchedAt: null,
      palette: null,
    };
    this.rows.push(row);
    return row;
  }

  byUrl(url: string): MemoryAssetRow | undefined {
    return this.rows.find((r) => r.sourceUrl === url);
  }

  async pending(query: PendingQuery = {}): Promise<MirrorAsset[]> {
    const rows = this.rows.filter(
      (r) => isProviderMediaUrl(r.sourceUrl) && !r.storageKey && (query.includeMissing || !r.fetchedAt),
    );
    return rows
      .slice(0, query.limit ?? rows.length)
      .map(({ id, sourceUrl, kind }) => ({ id, sourceUrl, kind }));
  }

  async markStored(id: string, info: StoredInfo): Promise<void> {
    Object.assign(
      this.rows.find((r) => r.id === id)!,
      info,
    );
  }

  async markMissing(id: string, at: Date): Promise<void> {
    Object.assign(
      this.rows.find((r) => r.id === id)!,
      {
        storageKey: null,
        sha256: null,
        bytes: null,
        width: null,
        height: null,
        fetchedAt: at,
        palette: null,
      },
    );
  }

  async unlink(urls: string[], at: Date): Promise<number> {
    const set = new Set(urls);
    let n = 0;
    for (const r of this.rows) {
      const normalized = normalizeMediaUrl(r.sourceUrl);
      if (r.storageKey && normalized && set.has(normalized)) {
        await this.markMissing(r.id, at);
        n += 1;
      }
    }
    return n;
  }

  async register(urls: string[]): Promise<number> {
    let n = 0;
    for (const url of urls) {
      if (!this.byUrl(url)) {
        this.add(url);
        n += 1;
      }
    }
    return n;
  }

  async counts(): Promise<AssetCounts> {
    const stored = this.rows.filter((r) => r.storageKey).length;
    const missing = this.rows.filter((r) => !r.storageKey && r.fetchedAt).length;
    return { total: this.rows.length, stored, missing, pending: this.rows.length - stored - missing };
  }

  async paletteCandidates(limit?: number): Promise<PaletteCandidate[]> {
    const rows = this.rows.filter(
      (r) =>
        r.kind === 'team_logo' &&
        r.storageKey?.toLowerCase().endsWith('.png') &&
        !r.palette &&
        !PLACEHOLDER_LOGO_SHA256.has(r.sha256 ?? ''),
    );
    return rows.slice(0, limit ?? rows.length).map((r) => ({ id: r.id, storageKey: r.storageKey! }));
  }

  async savePalette(id: string, palette: AssetPalette): Promise<void> {
    this.rows.find((r) => r.id === id)!.palette = palette;
  }
}

// ─── Postgres ────────────────────────────────────────────────────────────────────────────────────

/** Mesma expressão de normalizeMediaUrl, para casar URLs gravadas com variações de host/protocolo. */
const MEDIA_URL_SQL = `^https?://media(-[0-9]+)?\\.api-sports\\.io/`;

/** Colunas zeradas quando o asset sai do storage (404, bloqueado). */
const UNLINKED = {
  storageKey: null,
  sha256: null,
  bytes: null,
  width: null,
  height: null,
  palette: null,
} as const;

export class PgAssetStore implements AssetStore {
  constructor(private readonly db: Database) {}

  async pending(query: PendingQuery = {}): Promise<MirrorAsset[]> {
    const conditions = [isNull(asset.storageKey), sql`${asset.sourceUrl} ~* ${MEDIA_URL_SQL}`];
    if (!query.includeMissing) conditions.push(isNull(asset.fetchedAt));
    const q = this.db
      .select({ id: asset.id, sourceUrl: asset.sourceUrl, kind: asset.kind })
      .from(asset)
      .where(and(...conditions))
      .orderBy(asc(asset.createdAt), asc(asset.id));
    return query.limit ? q.limit(query.limit) : q;
  }

  async markStored(id: string, info: StoredInfo): Promise<void> {
    await this.db.update(asset).set(info).where(eq(asset.id, id));
  }

  async markMissing(id: string, at: Date): Promise<void> {
    await this.db
      .update(asset)
      .set({ ...UNLINKED, fetchedAt: at })
      .where(eq(asset.id, id));
  }

  async unlink(urls: string[], at: Date): Promise<number> {
    if (!urls.length) return 0;
    const candidates = await this.db
      .select({ id: asset.id, sourceUrl: asset.sourceUrl })
      .from(asset)
      .where(isNotNull(asset.storageKey));
    const set = new Set(urls);
    const ids = candidates.filter((c) => set.has(normalizeMediaUrl(c.sourceUrl) ?? '')).map((c) => c.id);
    if (!ids.length) return 0;
    await this.db
      .update(asset)
      .set({ ...UNLINKED, fetchedAt: at })
      .where(inArray(asset.id, ids));
    return ids.length;
  }

  async register(urls: string[]): Promise<number> {
    let inserted = 0;
    for (let i = 0; i < urls.length; i += 500) {
      const chunk = urls.slice(i, i + 500).map((url) => ({ kind: mediaKindFromUrl(url), sourceUrl: url }));
      const rows = await this.db
        .insert(asset)
        .values(chunk)
        .onConflictDoNothing()
        .returning({ id: asset.id });
      inserted += rows.length;
    }
    return inserted;
  }

  async counts(): Promise<AssetCounts> {
    const [row] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        stored: sql<number>`count(*) filter (where ${asset.storageKey} is not null)::int`,
        missing: sql<number>`count(*) filter (where ${asset.storageKey} is null and ${asset.fetchedAt} is not null)::int`,
      })
      .from(asset);
    const { total, stored, missing } = row ?? { total: 0, stored: 0, missing: 0 };
    return { total, stored, missing, pending: total - stored - missing };
  }

  async paletteCandidates(limit?: number): Promise<PaletteCandidate[]> {
    const q = this.db
      .select({ id: asset.id, storageKey: sql<string>`${asset.storageKey}` })
      .from(asset)
      .where(
        and(
          eq(asset.kind, 'team_logo'),
          isNull(asset.palette),
          sql`lower(${asset.storageKey}) like '%.png'`,
          or(isNull(asset.sha256), notInArray(asset.sha256, [...PLACEHOLDER_LOGO_SHA256])),
        ),
      )
      .orderBy(asc(asset.createdAt), asc(asset.id));
    return limit ? q.limit(limit) : q;
  }

  async savePalette(id: string, palette: AssetPalette): Promise<void> {
    await this.db.update(asset).set({ palette }).where(eq(asset.id, id));
  }

  /**
   * Varre os corpos em raw.api_response e devolve, normalizadas e sem repetição, todas as URLs de mídia —
   * cobre os 12 esportes e qualquer tipo de imagem (times, jogadores, estádios...) sem adivinhar IDs.
   */
  async discoverFromRaw(since?: Date): Promise<string[]> {
    const pattern = `https?://media(-[0-9]+)?\\.api-sports\\.io(/[A-Za-z0-9_.-]+)+`;
    const rows = await this.db.execute<{ url: string }>(sql`
      select distinct m[1] as url
      from ${apiResponse} r,
        lateral regexp_matches(r.body::text, ${`(${pattern})`}, 'g') as m
      where ${since ? sql`r.fetched_at >= ${since}` : sql`true`}
    `);
    const urls = new Set<string>();
    for (const r of rows) {
      const normalized = normalizeMediaUrl(r.url);
      if (normalized) urls.add(normalized);
    }
    return [...urls].sort();
  }
}
