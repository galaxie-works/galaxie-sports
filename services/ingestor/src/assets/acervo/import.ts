/**
 * Importação de um acervo customizado de logos: espelha no storage os logos com vínculo no manifesto
 * (com a nossa nomenclatura, `acervoStorageKey`), grava core.asset com `origin = acervo` (paleta incluída) e liga o asset em
 * `custom_logo_asset_id` do time ou da competição — o logo do fornecedor (`logo_asset_id`) nunca é
 * tocado. Idempotente: o mesmo manifesto roda de novo sem regravar nada; logo que perdeu o vínculo no
 * manifesto sai do time (o asset fica, sem apagar nada). A API só mostra esses logos com a flag
 * ASSETS_CUSTOM_LOGOS ligada.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { normalizeName } from '@galaxie/knowledge';
import {
  asset,
  competition,
  country,
  event,
  eventParticipant,
  participant,
  providerMap,
  teamProfile,
  type Database,
} from '@galaxie/db';
import { imageInfo } from '../image-info.js';
import type { ObjectStore } from '../object-store.js';
import { paletteFromPng, type AssetPalette } from '../palette.js';
import type { AcervoLogo, AcervoManifest } from './manifest.js';
import type { MatchTarget } from './match.js';
import type { CountryRow } from './plan.js';
import { paletteFromSvg } from './svg-palette.js';
import { unsafeSvgReason } from './svg-safety.js';

/** Rastro interno no asset (nunca publicado): o acervo e o arquivo do pacote, único por arquivo. */
export const acervoSourceUrl = (id: string, file: string) => `acervo://${id}/${file}`;

const EXTENSIONS: Record<string, string> = { 'image/svg+xml': 'svg', 'image/png': 'png' };

/**
 * Chave publicada no storage (e na URL que a API devolve): só a nossa nomenclatura — tipo, id do nosso
 * time ou competição e o começo do sha256, que troca a URL quando o logo muda (o CDN guarda por uma
 * semana). Nunca leva o nome do acervo nem o do arquivo do pacote. null para tipo não aceito.
 */
export function acervoStorageKey(
  kind: AcervoLogo['kind'],
  targetId: string,
  sha256: string,
  contentType: string,
): string | null {
  const ext = EXTENSIONS[contentType];
  if (!ext) return null;
  return `acervo/football/${kind === 'team' ? 'teams' : 'leagues'}/${targetId}.${sha256.slice(0, 12)}.${ext}`;
}

/**
 * Times (clubes e seleções) e competições do futebol, com nomes e apelidos da base semântica, as
 * competições em que cada time tem jogos e, nas seleções, os nomes do país em todos os idiomas
 * ("País de Gales" acha a seleção "Wales").
 */
export async function loadTargets(db: Database): Promise<MatchTarget[]> {
  const teams = await db
    .select({
      id: participant.id,
      kind: participant.kind,
      name: participant.name,
      shortName: participant.shortName,
      country: participant.countryCode,
      profileNames: teamProfile.names,
      labels: teamProfile.labels,
      nicknames: teamProfile.nicknames,
    })
    .from(participant)
    .leftJoin(teamProfile, eq(teamProfile.participantId, participant.id))
    .where(and(eq(participant.sport, 'football'), inArray(participant.kind, ['club', 'national_team'])));
  const comps = await db
    .select({
      id: competition.id,
      name: competition.name,
      country: competition.countryCode,
      labels: competition.labels,
    })
    .from(competition)
    .where(eq(competition.sport, 'football'));
  const played = await db
    .selectDistinct({ participantId: eventParticipant.participantId, competitionId: event.competitionId })
    .from(eventParticipant)
    .innerJoin(event, eq(event.id, eventParticipant.eventId))
    .where(and(eq(event.sport, 'football'), isNotNull(event.competitionId)));
  const competitionsOf = new Map<string, Set<string>>();
  for (const r of played) {
    const set = competitionsOf.get(r.participantId) ?? new Set<string>();
    set.add(r.competitionId!);
    competitionsOf.set(r.participantId, set);
  }
  const countryNames = new Map((await loadCountries(db)).map((c) => [c.code, c.names]));

  const out: MatchTarget[] = [];
  const byId = new Map<string, MatchTarget>();
  for (const t of teams) {
    let target = byId.get(t.id);
    if (!target) {
      target = {
        id: t.id,
        kind: 'team',
        country: t.country,
        name: t.name,
        names: [{ value: t.name, weight: 1 }],
        competitions: competitionsOf.get(t.id) ?? new Set(),
      };
      if (t.kind === 'national_team') {
        target.national = true;
        const names = countryNames.get(t.country ?? '') ?? [];
        target.mainNational = names.some((v) => normalizeName(v) === normalizeName(t.name));
        for (const v of names) target.names.push({ value: v, weight: 0.98 });
      }
      if (t.shortName) target.names.push({ value: t.shortName, weight: 1 });
      byId.set(t.id, target);
      out.push(target);
    }
    const names = t.profileNames as { official?: string; short?: string } | null;
    if (names?.official) target.names.push({ value: names.official, weight: 0.98 });
    if (names?.short) target.names.push({ value: names.short, weight: 0.98 });
    for (const v of Object.values(t.labels ?? {})) if (v) target.names.push({ value: v, weight: 0.95 });
    for (const v of t.nicknames ?? []) target.names.push({ value: v, weight: 0.8 });
  }
  for (const c of comps) {
    const target: MatchTarget = {
      id: c.id,
      kind: 'competition',
      country: c.country,
      name: c.name,
      names: [{ value: c.name, weight: 1 }],
    };
    for (const v of Object.values(c.labels ?? {})) if (v) target.names.push({ value: v, weight: 0.97 });
    out.push(target);
  }
  return out;
}

/** Liga da api-sports → id da competição no nosso cadastro (futebol). */
export async function loadLeagueCompetitions(db: Database): Promise<Map<number, string>> {
  const rows = await db
    .select({ providerId: providerMap.providerId, entityId: providerMap.entityId })
    .from(providerMap)
    .where(
      and(
        eq(providerMap.provider, 'api-sports'),
        eq(providerMap.sport, 'football'),
        eq(providerMap.entityType, 'competition'),
      ),
    );
  return new Map(rows.map((r) => [Number(r.providerId), r.entityId]));
}

export async function loadCountries(db: Database): Promise<CountryRow[]> {
  const rows = await db.select({ code: country.code, name: country.name }).from(country);
  return rows.map((r) => ({
    code: r.code,
    names: Object.values(r.name ?? {}).filter((v): v is string => !!v),
  }));
}

export interface ImportOptions {
  db: Database;
  objects: ObjectStore;
  manifest: AcervoManifest;
  /** Pasta do pacote (onde estão os arquivos do manifesto). Sem ela, só desliga o que saiu do manifesto. */
  dir: string;
  now?: Date;
  /** Só conta, sem gravar nada. */
  dryRun?: boolean;
  /** Logos por lote (cada lote lê os arquivos, grava o storage e o banco). Padrão 50. */
  batchSize?: number;
  onProgress?: (event: ImportEvent) => void;
}

export type ImportEvent =
  | { type: 'linked'; key: string; targetId: string; uploaded: boolean }
  | { type: 'skipped'; key: string; reason: string };

export interface ImportReport {
  /** Logos com vínculo no manifesto (auto + manual). */
  linked: number;
  /** Objetos gravados no storage nesta execução (os demais já estavam lá com o mesmo hash). */
  uploaded: number;
  /** Vínculos de times/competições que mudaram nesta execução. */
  changed: number;
  /** Times/competições que perderam o logo do acervo (saíram do manifesto ou mudaram de logo). */
  detached: number;
  /** Logos com vínculo cujo alvo não existe mais no banco, ou com arquivo divergente do manifesto. */
  skipped: number;
}

const sha256 = (buf: Uint8Array) => createHash('sha256').update(buf).digest('hex');

function paletteOf(
  file: Uint8Array,
  contentType: string,
  paletteFile: Uint8Array | undefined,
): AssetPalette | null {
  if (paletteFile) return paletteFromPng(paletteFile);
  return contentType === 'image/svg+xml' ? paletteFromSvg(file) : paletteFromPng(file);
}

export async function importAcervo(options: ImportOptions): Promise<ImportReport> {
  const { db, objects, manifest } = options;
  const id = manifest.acervo.id;
  const now = options.now ?? new Date();
  const emit = options.onProgress ?? (() => {});
  const batchSize = options.batchSize ?? 50;
  const report: ImportReport = { linked: 0, uploaded: 0, changed: 0, detached: 0, skipped: 0 };
  const wanted = manifest.logos.filter(
    (l): l is AcervoLogo & { target_id: string } =>
      !!l.target_id && (l.match === 'auto' || l.match === 'manual'),
  );

  // alvos que existem (o manifesto pode ter sido gerado em outro banco)
  const existing = new Set<string>();
  for (const kind of ['team', 'competition'] as const) {
    const table = kind === 'team' ? participant : competition;
    const ids = wanted.filter((l) => l.kind === kind).map((l) => l.target_id);
    for (let i = 0; i < ids.length; i += 1000) {
      const rows = await db
        .select({ id: table.id })
        .from(table)
        .where(inArray(table.id, ids.slice(i, i + 1000)));
      for (const r of rows) existing.add(`${kind}:${r.id}`);
    }
  }

  const assetIdFor = new Map<string, string>(); // `${kind}:${target}` → asset.id
  // logo com arquivo divergente: não grava, mas também não desliga o vínculo que já existe
  const keep = new Set<string>();
  for (let i = 0; i < wanted.length; i += batchSize) {
    for (const logo of wanted.slice(i, i + batchSize)) {
      if (!existing.has(`${logo.kind}:${logo.target_id}`)) {
        report.skipped += 1;
        emit({ type: 'skipped', key: logo.key, reason: `alvo ${logo.target_id} não existe neste banco` });
        continue;
      }
      report.linked += 1;
      const sourceUrl = acervoSourceUrl(id, logo.file);
      if (options.dryRun) {
        emit({ type: 'linked', key: logo.key, targetId: logo.target_id, uploaded: false });
        continue;
      }
      const body = new Uint8Array(readFileSync(join(options.dir, logo.file)));
      const hash = sha256(body);
      if (hash !== logo.sha256) {
        report.linked -= 1;
        report.skipped += 1;
        keep.add(`${logo.kind}:${logo.target_id}`);
        emit({ type: 'skipped', key: logo.key, reason: 'arquivo diferente do manifesto (rode --mapear)' });
        continue;
      }
      const info = imageInfo(body);
      const unsafe = info.contentType === 'image/svg+xml' ? unsafeSvgReason(body) : null;
      if (unsafe) {
        report.linked -= 1;
        report.skipped += 1;
        keep.add(`${logo.kind}:${logo.target_id}`);
        emit({ type: 'skipped', key: logo.key, reason: `SVG recusado: ${unsafe}` });
        continue;
      }
      const storageKey = acervoStorageKey(logo.kind, logo.target_id, hash, info.contentType);
      if (!storageKey) {
        report.linked -= 1;
        report.skipped += 1;
        keep.add(`${logo.kind}:${logo.target_id}`);
        emit({
          type: 'skipped',
          key: logo.key,
          reason: `tipo não aceito (${info.contentType}): só SVG e PNG`,
        });
        continue;
      }
      const head = await objects.head(storageKey);
      const uploaded = head?.sha256 !== hash;
      if (uploaded) {
        await objects.put(storageKey, body, info.contentType, hash);
        report.uploaded += 1;
      }
      const paletteBody = logo.palette_file
        ? new Uint8Array(readFileSync(join(options.dir, logo.palette_file)))
        : undefined;
      const values = {
        kind: logo.kind === 'team' ? ('team_logo' as const) : ('league_logo' as const),
        sourceUrl,
        storageKey,
        sha256: hash,
        width: info.width,
        height: info.height,
        bytes: body.length,
        fetchedAt: now,
        palette: paletteOf(body, info.contentType, paletteBody),
        origin: 'acervo' as const,
        acervo: id,
      };
      const { sourceUrl: _url, ...updatable } = values;
      const [row] = await db
        .insert(asset)
        .values(values)
        .onConflictDoUpdate({
          target: asset.sourceUrl,
          set: updatable,
          // só regrava quando algo mudou: rodar de novo não toca o banco
          setWhere: sql`${asset.sha256} is distinct from ${hash} or ${asset.storageKey} is distinct from ${storageKey} or ${asset.palette} is null`,
        })
        .returning({ id: asset.id });
      const assetId =
        row?.id ??
        (await db.select({ id: asset.id }).from(asset).where(eq(asset.sourceUrl, sourceUrl)))[0]!.id;
      assetIdFor.set(`${logo.kind}:${logo.target_id}`, assetId);
      emit({ type: 'linked', key: logo.key, targetId: logo.target_id, uploaded });
    }
  }
  if (options.dryRun) {
    report.detached = (await linkedToAcervo(db, id)).filter((r) => !wanted.some((l) => matches(l, r))).length;
    return report;
  }

  await db.transaction(async (tx) => {
    for (const [ref, assetId] of assetIdFor) {
      const [kind, targetId] = ref.split(':') as ['team' | 'competition', string];
      const table = kind === 'team' ? participant : competition;
      const updated = await tx
        .update(table)
        .set({ customLogoAssetId: assetId, updatedAt: sql`now()` })
        .where(and(eq(table.id, targetId), sql`${table.customLogoAssetId} is distinct from ${assetId}`))
        .returning({ id: table.id });
      report.changed += updated.length;
    }
    // quem aponta para um asset deste acervo e não está mais no manifesto perde o vínculo
    for (const r of await linkedToAcervo(tx, id)) {
      const ref = `${r.kind}:${r.targetId}`;
      if (assetIdFor.get(ref) === r.assetId || keep.has(ref)) continue;
      const table = r.kind === 'team' ? participant : competition;
      await tx
        .update(table)
        .set({ customLogoAssetId: null, updatedAt: sql`now()` })
        .where(and(eq(table.id, r.targetId), eq(table.customLogoAssetId, r.assetId)));
      report.detached += 1;
    }
  });
  return report;
}

interface LinkedRow {
  kind: 'team' | 'competition';
  targetId: string;
  assetId: string;
  sourceUrl: string;
}

const matches = (l: AcervoLogo, r: LinkedRow) =>
  l.kind === r.kind && l.target_id === r.targetId && r.sourceUrl.endsWith(`/${l.file}`);

/** Times e competições ligados hoje a algum asset do acervo. */
async function linkedToAcervo(db: Pick<Database, 'select'>, id: string): Promise<LinkedRow[]> {
  const teams = await db
    .select({ targetId: participant.id, assetId: asset.id, sourceUrl: asset.sourceUrl })
    .from(participant)
    .innerJoin(asset, eq(asset.id, participant.customLogoAssetId))
    .where(and(isNotNull(participant.customLogoAssetId), eq(asset.acervo, id)));
  const comps = await db
    .select({ targetId: competition.id, assetId: asset.id, sourceUrl: asset.sourceUrl })
    .from(competition)
    .innerJoin(asset, eq(asset.id, competition.customLogoAssetId))
    .where(and(isNotNull(competition.customLogoAssetId), eq(asset.acervo, id)));
  return [
    ...teams.map((r) => ({ ...r, kind: 'team' as const })),
    ...comps.map((r) => ({ ...r, kind: 'competition' as const })),
  ];
}

/**
 * Desliga todos os vínculos de um acervo (times e competições voltam ao logo do fornecedor mesmo com a
 * flag ligada). Os assets e os objetos no storage ficam: reimportar religa sem baixar nada.
 */
export async function detachAcervo(db: Database, id: string, dryRun = false): Promise<number> {
  const rows = await linkedToAcervo(db, id);
  if (dryRun || !rows.length) return rows.length;
  await db.transaction(async (tx) => {
    for (const r of rows) {
      const table = r.kind === 'team' ? participant : competition;
      await tx
        .update(table)
        .set({ customLogoAssetId: null, updatedAt: sql`now()` })
        .where(eq(table.id, r.targetId));
    }
  });
  return rows.length;
}
