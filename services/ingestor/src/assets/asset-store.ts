import { and, asc, desc, eq, inArray, isNotNull, isNull, notInArray, or, sql, type SQL } from 'drizzle-orm';
import {
  isProviderMediaUrl,
  mediaKindFromUrl,
  normalizeMediaUrl,
  type MediaAssetKind,
  type MediaDenylist,
} from '@galaxie/apisports-client';
import {
  apiResponse,
  asset,
  competition,
  jobRun,
  participant,
  person,
  publishChange,
  type AssetPalette,
  type Database,
} from '@galaxie/db';
import { PLACEHOLDER_LOGO_SHA256 } from './palette.js';
import { pendingPersonPhotoIds, PERSON_PHOTO_KINDS, PLACEHOLDER_PHOTO_SHA256 } from './person-photos.js';
import { LOGO_KIND_VALUES, LOGO_KINDS, MISSING_ASSET } from './placeholder-logos.js';

/**
 * Estado de um asset em core.asset:
 * - pendente:   storage_key nulo e fetched_at nulo;
 * - espelhado:  storage_key preenchido (sha256, bytes, dimensões e fetched_at junto);
 * - ausente:    storage_key nulo e fetched_at preenchido — 404 na CDN, bloqueado ou imagem genérica (foto de
 *               pessoa ou logo de time/competição);
 *               não é tentado de novo (a não ser com `includeMissing`).
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
  /** Só fotos de pessoas, das escaladas desde `since` para o resto (ver person-photos.ts). */
  personPhotos?: { since: Date } | undefined;
  /** Só URLs cujo caminho começa assim (ex.: `/volley/` = mídia da API de vôlei). */
  pathPrefix?: string | undefined;
}

/** `/volley` ou `volley/` → `/volley/`. */
export function mediaPathPrefix(prefix: string): string {
  return `/${prefix.replace(/^\/+|\/+$/g, '')}/`;
}

export interface MissingOptions {
  /** Desliga a foto das pessoas que usam o asset: a pessoa passa a não ter foto. */
  detachPeople?: boolean;
  /** Desliga o logo dos times (core.participant) e competições que usam o asset: passam a não ter logo. */
  detachLogos?: boolean;
}

export interface LogoCleanupOptions {
  /** Hashes dos logos genéricos. Padrão PLACEHOLDER_LOGO_SHA256. */
  placeholders?: ReadonlySet<string> | undefined;
  /** Só conta, sem mudar nada. */
  dryRun?: boolean | undefined;
  /**
   * URLs normalizadas da lista de bloqueio. Só no `dryRun`: a execução real tira os já espelhados do storage
   * (`unlink`) antes da limpeza, então a prévia já os conta como ausentes.
   */
  denylisted?: readonly string[] | undefined;
}

/** Resultado de `cleanupLogos`. */
export interface LogoCleanup {
  /** Logos genéricos que estavam no storage e viraram ausentes. */
  placeholders: number;
  /** Times e competições desligados de um logo ausente (genérico, 404 ou bloqueado). */
  participants: number;
  competitions: number;
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
  markMissing(id: string, at: Date, options?: MissingOptions): Promise<void>;
  /** Desvincula do storage assets já espelhados que entraram na lista de bloqueio. Retorna quantos. */
  unlink(urls: string[], at: Date): Promise<number>;
  /**
   * Limpeza idempotente dos logos: os já espelhados com hash de imagem genérica viram ausentes, e times e
   * competições ligados a qualquer logo ausente perdem o vínculo. `dryRun` só conta.
   */
  cleanupLogos(at: Date, options?: LogoCleanupOptions): Promise<LogoCleanup>;
  /**
   * Fotos de pessoa já gravadas cujo hash entrou na lista de genéricas: viram ausentes e as pessoas ficam sem
   * foto (como na hora do download). Retorna quantas.
   */
  cleanupPhotos(at: Date, options?: LogoCleanupOptions): Promise<number>;
  /** Registra URLs novas (idempotente). Retorna quantas eram novas. */
  register(urls: string[]): Promise<number>;
  counts(): Promise<AssetCounts>;
  /**
   * team_logo espelhados em PNG com palette nula (fora os placeholders do fornecedor), na ordem de criação;
   * `after` (id de um candidato) pagina a partir do seguinte, para passar dos que não decodificam.
   */
  paletteCandidates(limit?: number, after?: string): Promise<PaletteCandidate[]>;
  savePalette(id: string, palette: AssetPalette): Promise<void>;
  /** Várias paletas numa transação só (uma página do backfill): os times afetados são purgados juntos. */
  savePalettes(items: readonly { id: string; palette: AssetPalette }[]): Promise<void>;
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
  /** Assets cujas pessoas perderam a foto (`detachPeople`). */
  readonly detached = new Set<string>();
  /** Assets cujos times e competições perderam o logo (`detachLogos`). */
  readonly detachedLogos = new Set<string>();
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
      (r) =>
        isProviderMediaUrl(r.sourceUrl) &&
        !r.storageKey &&
        (query.includeMissing || !r.fetchedAt) &&
        (!query.personPhotos || PERSON_PHOTO_KINDS.has(r.kind)) &&
        (!query.pathPrefix || new URL(r.sourceUrl).pathname.startsWith(mediaPathPrefix(query.pathPrefix))),
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

  async markMissing(id: string, at: Date, options: MissingOptions = {}): Promise<void> {
    if (options.detachPeople) this.detached.add(id);
    if (options.detachLogos) this.detachedLogos.add(id);
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

  async cleanupPhotos(at: Date, options: LogoCleanupOptions = {}): Promise<number> {
    const placeholders = options.placeholders ?? PLACEHOLDER_PHOTO_SHA256;
    const generic = this.rows.filter(
      (r) => PERSON_PHOTO_KINDS.has(r.kind) && r.storageKey && placeholders.has(r.sha256 ?? ''),
    );
    if (!options.dryRun) for (const r of generic) await this.markMissing(r.id, at, { detachPeople: true });
    return generic.length;
  }

  async cleanupLogos(at: Date, options: LogoCleanupOptions = {}): Promise<LogoCleanup> {
    const placeholders = options.placeholders ?? PLACEHOLDER_LOGO_SHA256;
    const generic = this.rows.filter(
      (r) => LOGO_KINDS.has(r.kind) && r.storageKey && placeholders.has(r.sha256 ?? ''),
    );
    if (!options.dryRun) for (const r of generic) await this.markMissing(r.id, at);
    const denylisted = new Set(options.dryRun ? options.denylisted : []);
    // sem tabelas de times e competições na memória: conta os logos ausentes que seriam desligados
    const missing = this.rows.filter(
      (r) =>
        LOGO_KINDS.has(r.kind) &&
        ((!r.storageKey && r.fetchedAt) ||
          generic.includes(r) ||
          (r.storageKey && denylisted.has(normalizeMediaUrl(r.sourceUrl) ?? ''))),
    );
    if (!options.dryRun) for (const r of missing) this.detachedLogos.add(r.id);
    return { placeholders: generic.length, participants: missing.length, competitions: 0 };
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

  async paletteCandidates(limit?: number, after?: string): Promise<PaletteCandidate[]> {
    const start = after ? this.rows.findIndex((r) => r.id === after) + 1 : 0;
    const rows = this.rows
      .slice(start)
      .filter(
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

  async savePalettes(items: readonly { id: string; palette: AssetPalette }[]): Promise<void> {
    for (const { id, palette } of items) await this.savePalette(id, palette);
  }
}

// ─── Postgres ────────────────────────────────────────────────────────────────────────────────────

/** Mesma expressão de normalizeMediaUrl, para casar URLs gravadas com variações de host/protocolo. */
const MEDIA_URL_SQL = `^https?://media(-[0-9]+)?\\.api-sports\\.io/`;

/** Regex das URLs da CDN de mídia, opcionalmente só as sob um caminho (`--caminho volley`). */
function mediaUrlPattern(pathPrefix: string | undefined): string {
  if (!pathPrefix) return MEDIA_URL_SQL;
  const path = mediaPathPrefix(pathPrefix).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return MEDIA_URL_SQL.replace(/\/$/, '') + path;
}

/** Colunas zeradas quando o asset sai do storage (404, bloqueado). */
const UNLINKED = {
  storageKey: null,
  sha256: null,
  bytes: null,
  width: null,
  height: null,
  palette: null,
} as const;

/** O banco ou uma transação aberta. */
type Executor = Pick<Database, 'selectDistinct' | 'execute'>;

/** Times (core.participant) que usam algum destes assets como logo, do fornecedor ou do acervo. */
export async function teamsUsing(db: Executor, assetIds: string[]): Promise<string[]> {
  if (!assetIds.length) return [];
  const rows = await db
    .selectDistinct({ id: participant.id })
    .from(participant)
    .where(or(inArray(participant.logoAssetId, assetIds), inArray(participant.customLogoAssetId, assetIds)));
  return rows.map((r) => r.id);
}

/**
 * Publica no change feed que o logo ou as cores (`colors`, da paleta do escudo) destes times mudaram: o
 * consumidor da API purga `participant:<id>`. Não há trigger em core.asset, então quem grava ou limpa a paleta
 * (ou desliga o logo) chama isto na mesma transação; o NOTIFY só sai no commit, e o consumidor purga junto as
 * mudanças que chegam juntas — escrever em lote numa transação evita purgar a coleção `participant` a cada time.
 */
export async function publishTeamLogoChanges(db: Executor, participantIds: Iterable<string>): Promise<void> {
  for (const id of new Set(participantIds)) {
    await publishChange(db, {
      topic: 'catalog',
      entityType: 'participant',
      entityId: id,
      payload: { reason: 'logo' },
    });
  }
}

export class PgAssetStore implements AssetStore {
  constructor(private readonly db: Database) {}

  async pending(query: PendingQuery = {}): Promise<MirrorAsset[]> {
    if (query.personPhotos) return this.pendingPersonPhotos(query, query.personPhotos.since);
    const conditions = [
      isNull(asset.storageKey),
      sql`${asset.sourceUrl} ~* ${mediaUrlPattern(query.pathPrefix)}`,
    ];
    if (!query.includeMissing) conditions.push(isNull(asset.fetchedAt));
    const q = this.db
      // só URLs da CDN de mídia (filtro acima): o tipo é sempre um MediaAssetKind
      .select({ id: asset.id, sourceUrl: asset.sourceUrl, kind: sql<MediaAssetKind>`${asset.kind}` })
      .from(asset)
      .where(and(...conditions))
      .orderBy(asc(asset.createdAt), asc(asset.id));
    return query.limit ? q.limit(query.limit) : q;
  }

  async markStored(id: string, info: StoredInfo): Promise<void> {
    if (info.palette === undefined) {
      await this.db.update(asset).set(info).where(eq(asset.id, id));
      return;
    }
    await this.db.transaction(async (tx) => {
      const [old] = await tx
        .select({
          changed: sql<boolean>`${asset.palette} is distinct from ${JSON.stringify(info.palette)}::jsonb`,
        })
        .from(asset)
        .where(eq(asset.id, id));
      await tx.update(asset).set(info).where(eq(asset.id, id));
      if (old?.changed) await publishTeamLogoChanges(tx, await teamsUsing(tx, [id]));
    });
  }

  private async pendingPersonPhotos(query: PendingQuery, since: Date): Promise<MirrorAsset[]> {
    const urlPattern = mediaUrlPattern(query.pathPrefix);
    const ids = await pendingPersonPhotoIds(this.db, {
      since,
      includeMissing: query.includeMissing,
      limit: query.limit,
      urlPattern,
    });
    const rows: MirrorAsset[] = [];
    for (let i = 0; i < ids.length; i += 1000) {
      const chunk = ids.slice(i, i + 1000);
      rows.push(
        ...(await this.db
          .select({ id: asset.id, sourceUrl: asset.sourceUrl, kind: sql<MediaAssetKind>`${asset.kind}` })
          .from(asset)
          .where(and(inArray(asset.id, chunk), sql`${asset.sourceUrl} ~* ${urlPattern}`))),
      );
    }
    const order = new Map(ids.map((id, i) => [id, i]));
    return rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  }

  async markMissing(id: string, at: Date, options: MissingOptions = {}): Promise<void> {
    await this.db.transaction(async (tx) => {
      // os times perdem o logo ou as cores (a paleta é zerada): antes de desligar, para ainda achá-los
      const [old] = options.detachLogos
        ? [undefined]
        : await tx.select({ palette: asset.palette }).from(asset).where(eq(asset.id, id));
      if (options.detachLogos || old?.palette) await publishTeamLogoChanges(tx, await teamsUsing(tx, [id]));
      await tx
        .update(asset)
        .set({ ...UNLINKED, fetchedAt: at })
        .where(eq(asset.id, id));
      if (options.detachPeople) {
        await tx
          .update(person)
          .set({ photoAssetId: null, updatedAt: sql`now()` })
          .where(eq(person.photoAssetId, id));
      }
      if (options.detachLogos) {
        await tx
          .update(participant)
          .set({ logoAssetId: null, updatedAt: sql`now()` })
          .where(eq(participant.logoAssetId, id));
        await tx
          .update(competition)
          .set({ logoAssetId: null, updatedAt: sql`now()` })
          .where(eq(competition.logoAssetId, id));
      }
    });
  }

  async cleanupPhotos(at: Date, options: LogoCleanupOptions = {}): Promise<number> {
    const placeholders = [...(options.placeholders ?? PLACEHOLDER_PHOTO_SHA256)];
    const generic = and(
      inArray(asset.kind, ['player', 'coach']),
      isNotNull(asset.storageKey),
      inArray(asset.sha256, placeholders),
    );
    if (options.dryRun) {
      const [row] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(asset)
        .where(generic);
      return row?.n ?? 0;
    }
    return this.db.transaction(async (tx) => {
      const ids = await tx
        .update(asset)
        .set({ ...UNLINKED, fetchedAt: at })
        .where(generic)
        .returning({ id: asset.id });
      if (ids.length) {
        await tx
          .update(person)
          .set({ photoAssetId: null, updatedAt: sql`now()` })
          .where(
            inArray(
              person.photoAssetId,
              ids.map((r) => r.id),
            ),
          );
      }
      return ids.length;
    });
  }

  async cleanupLogos(at: Date, options: LogoCleanupOptions = {}): Promise<LogoCleanup> {
    const placeholders = [...(options.placeholders ?? PLACEHOLDER_LOGO_SHA256)];
    const logoKinds = inArray(asset.kind, [...LOGO_KIND_VALUES]);
    const generic = and(logoKinds, isNotNull(asset.storageKey), inArray(asset.sha256, placeholders));
    // no dry run os genéricos e os bloqueados (o unlink foi pulado) ainda estão no storage: contam como
    // ausentes para a prévia dos desligados
    const denied = options.dryRun
      ? await this.idsByMediaUrl(options.denylisted ?? [], and(logoKinds, isNotNull(asset.storageKey)))
      : [];
    const missingLogo = (dryRun: boolean) =>
      this.db
        .select({ id: asset.id })
        .from(asset)
        .where(
          and(
            logoKinds,
            dryRun
              ? or(MISSING_ASSET, generic, denied.length ? inArray(asset.id, denied) : undefined)
              : MISSING_ASSET,
          ),
        );
    if (options.dryRun) {
      const [row] = await this.db.execute<{
        placeholders: number;
        participants: number;
        competitions: number;
      }>(sql`
        select
          (select count(*)::int from ${asset} where ${generic}) as placeholders,
          (select count(*)::int from ${participant} where ${participant.logoAssetId} in (${missingLogo(true)})) as participants,
          (select count(*)::int from ${competition} where ${competition.logoAssetId} in (${missingLogo(true)})) as competitions
      `);
      return row ?? { placeholders: 0, participants: 0, competitions: 0 };
    }
    return this.db.transaction(async (tx) => {
      const stored = await tx
        .update(asset)
        .set({ ...UNLINKED, fetchedAt: at })
        .where(generic)
        .returning({ id: asset.id });
      const parts = await tx
        .update(participant)
        .set({ logoAssetId: null, updatedAt: sql`now()` })
        .where(inArray(participant.logoAssetId, missingLogo(false)))
        .returning({ id: participant.id });
      const comps = await tx
        .update(competition)
        .set({ logoAssetId: null, updatedAt: sql`now()` })
        .where(inArray(competition.logoAssetId, missingLogo(false)))
        .returning({ id: competition.id });
      await publishTeamLogoChanges(
        tx,
        parts.map((p) => p.id),
      );
      return { placeholders: stored.length, participants: parts.length, competitions: comps.length };
    });
  }

  /** Ids dos assets (filtrados por `where`) cuja URL normalizada está em `urls`. */
  private async idsByMediaUrl(urls: readonly string[], where: SQL | undefined): Promise<string[]> {
    if (!urls.length) return [];
    const candidates = await this.db
      .select({ id: asset.id, sourceUrl: asset.sourceUrl })
      .from(asset)
      .where(where);
    const set = new Set(urls);
    return candidates.filter((c) => set.has(normalizeMediaUrl(c.sourceUrl) ?? '')).map((c) => c.id);
  }

  async unlink(urls: string[], at: Date): Promise<number> {
    const ids = await this.idsByMediaUrl(urls, isNotNull(asset.storageKey));
    if (!ids.length) return 0;
    await this.db.transaction(async (tx) => {
      await tx
        .update(asset)
        .set({ ...UNLINKED, fetchedAt: at })
        .where(inArray(asset.id, ids));
      await publishTeamLogoChanges(tx, await teamsUsing(tx, ids));
    });
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

  async paletteCandidates(limit?: number, after?: string): Promise<PaletteCandidate[]> {
    const q = this.db
      .select({ id: asset.id, storageKey: sql<string>`${asset.storageKey}` })
      .from(asset)
      .where(
        and(
          eq(asset.kind, 'team_logo'),
          isNull(asset.palette),
          sql`lower(${asset.storageKey}) like '%.png'`,
          or(isNull(asset.sha256), notInArray(asset.sha256, [...PLACEHOLDER_LOGO_SHA256])),
          after
            ? sql`(${asset.createdAt}, ${asset.id}) > (select created_at, id from core.asset where id = ${after})`
            : undefined,
        ),
      )
      .orderBy(asc(asset.createdAt), asc(asset.id));
    return limit ? q.limit(limit) : q;
  }

  async savePalette(id: string, palette: AssetPalette): Promise<void> {
    await this.savePalettes([{ id, palette }]);
  }

  async savePalettes(items: readonly { id: string; palette: AssetPalette }[]): Promise<void> {
    if (!items.length) return;
    await this.db.transaction(async (tx) => {
      const changed: string[] = [];
      for (const { id, palette } of items) {
        // paleta igual à gravada: nada a purgar
        const rows = await tx
          .update(asset)
          .set({ palette })
          .where(
            and(eq(asset.id, id), sql`${asset.palette} is distinct from ${JSON.stringify(palette)}::jsonb`),
          )
          .returning({ id: asset.id });
        changed.push(...rows.map((r) => r.id));
      }
      await publishTeamLogoChanges(tx, await teamsUsing(tx, changed));
    });
  }

  /**
   * Varre os corpos em raw.api_response e devolve, normalizadas e sem repetição, todas as URLs de mídia —
   * cobre os 12 esportes e qualquer tipo de imagem (times, jogadores, estádios...) sem adivinhar IDs.
   */
  async discoverFromRaw(since?: Date, afterId?: number): Promise<string[]> {
    const pattern = `https?://media(-[0-9]+)?\\.api-sports\\.io(/[A-Za-z0-9_.-]+)+`;
    const rows = await this.db.execute<{ url: string }>(sql`
      select distinct m[1] as url
      from ${apiResponse} r,
        lateral regexp_matches(r.body::text, ${`(${pattern})`}, 'g') as m
      where ${rawWindow(since, afterId)}
    `);
    const urls = new Set<string>();
    for (const r of rows) {
      const normalized = normalizeMediaUrl(r.url);
      if (normalized) urls.add(normalized);
    }
    return [...urls].sort();
  }
}

const RAW_DISCOVERY_OVERLAP_MS = 3_600_000;

/**
 * Janela da descoberta incremental: o raw com id acima da marca d'água da descoberta anterior (pega o que
 * raw:import e snapshot:import gravam com `fetched_at` retroativo) ou gravado desde `since` (pega as
 * transações que já tinham o id antes da marca e só commitaram depois). Sem nada: a tabela inteira.
 */
function rawWindow(since: Date | undefined, afterId: number | undefined): SQL {
  const conditions: SQL[] = [];
  if (afterId !== undefined) conditions.push(sql`r.id > ${afterId}`);
  if (since) conditions.push(sql`r.fetched_at >= ${since.toISOString()}::timestamptz`);
  return conditions.length ? sql`(${sql.join(conditions, sql` or `)})` : sql`true`;
}

export interface RawDiscoveryReport {
  /** Início da descoberta anterior, menos 1 h de margem; null = varreu a tabela inteira. */
  since: Date | null;
  /** Maior id de raw.api_response visto pela descoberta anterior (a marca d'água); null = tabela inteira. */
  afterId: number | null;
  /** Maior id de raw.api_response no início desta descoberta: a marca d'água da próxima. */
  maxRawId: number;
  urls: number;
  added: number;
}

/**
 * `--descobrir-raw`: registra em core.asset as URLs de mídia do raw (fora as bloqueadas). Incremental: só as
 * respostas acima da marca d'água (`raw.api_response.id`) da última descoberta concluída (`ops.job_run`
 * `assets:discover-raw`, em `stats.maxRawId`) ou gravadas desde o início dela, para o job diário não varrer a
 * tabela inteira; a primeira execução (ou `full`) varre tudo.
 */
export async function runRawDiscovery(
  db: Database,
  store: PgAssetStore,
  options: { denylist: MediaDenylist; full?: boolean | undefined },
): Promise<RawDiscoveryReport> {
  const [last] = options.full
    ? []
    : await db
        .select({ startedAt: jobRun.startedAt, maxRawId: sql<string | null>`${jobRun.stats}->>'maxRawId'` })
        .from(jobRun)
        .where(and(eq(jobRun.job, 'assets:discover-raw'), eq(jobRun.status, 'ok')))
        .orderBy(desc(jobRun.startedAt))
        .limit(1);
  // sem marca d'água (execução anterior a ela), varre tudo de novo
  const afterId = last?.maxRawId != null ? Number(last.maxRawId) : null;
  // margem para o raw gravado em transações que começaram antes da descoberta anterior e commitaram depois
  const since =
    last && afterId !== null ? new Date(last.startedAt.getTime() - RAW_DISCOVERY_OVERLAP_MS) : null;
  const [run] = await db.insert(jobRun).values({ job: 'assets:discover-raw', status: 'running' }).returning();
  try {
    const [top] = await db.select({ max: sql<string | null>`max(${apiResponse.id})` }).from(apiResponse);
    const maxRawId = Number(top?.max ?? 0);
    const urls = await store.discoverFromRaw(since ?? undefined, afterId ?? undefined);
    const added = await store.register(urls.filter((u) => !options.denylist.has(u)));
    const report = { since, afterId, maxRawId, urls: urls.length, added };
    await db
      .update(jobRun)
      .set({ status: 'ok', finishedAt: new Date(), stats: report })
      .where(eq(jobRun.id, run!.id));
    return report;
  } catch (err) {
    await db
      .update(jobRun)
      .set({ status: 'error', finishedAt: new Date(), error: String(err) })
      .where(eq(jobRun.id, run!.id));
    throw err;
  }
}
