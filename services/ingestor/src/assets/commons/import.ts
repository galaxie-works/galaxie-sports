/**
 * Importação do acervo de fotos da F1 a partir do manifesto (config/assets/commons/f1.yaml):
 * 1. confere de novo a licença na API da Commons (a página pode ter mudado desde o mapeamento);
 * 2. baixa a miniatura que a própria Commons redimensiona (nunca recortamos nem editamos: CC BY-SA);
 * 3. grava no nosso storage com a nossa nomenclatura (`commons/f1/{drivers|cars}/<id do participante>.<hash>`);
 * 4. registra `core.asset` (origin `commons`), o crédito (`core.asset_credit`) e o vínculo com o piloto ou o
 *    construtor (`core.participant_photo`). O logo do participante não muda.
 * Idempotente: o mesmo manifesto não regrava nada; foto que saiu do manifesto (ou foi rejeitada) sai do
 * participante (o asset fica).
 */
import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { asset, assetCredit, participantPhoto, providerMap, type Database } from '@galaxie/db';
import { f1dbDriverId } from '@galaxie/providers';
import { imageInfo } from '../image-info.js';
import type { ObjectStore } from '../object-store.js';
import type { WikimediaClient } from './client.js';
import { readLicense } from './license.js';
import { COMMONS_ACERVO_ID, type CommonsManifest, type ManifestEntry } from './manifest.js';

/** Largura da miniatura pedida à Commons (o original nunca é servido; a Commons não amplia). */
export const COMMONS_THUMB_WIDTH = 1600;
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' };

export const commonsSourceUrl = (title: string) => `commons://${title}`;

export function commonsStorageKey(
  kind: 'driver' | 'car',
  participantId: string,
  sha256: string,
  contentType: string,
) {
  const ext = EXT[contentType];
  return ext
    ? `commons/f1/${kind === 'driver' ? 'drivers' : 'cars'}/${participantId}.${sha256.slice(0, 12)}.${ext}`
    : null;
}

export interface ImportReport {
  entries: number;
  photos: number;
  stored: number;
  unchanged: number;
  linked: number;
  unlinked: number;
  skipped: { key: string; file?: string; reason: string }[];
}

/** Participante do core do alvo (pelo vínculo do F1DB no provider_map). */
async function participantOf(db: Database, entry: ManifestEntry): Promise<string | null> {
  const providerId = entry.kind === 'driver' ? f1dbDriverId(entry.f1db_id) : entry.f1db_id;
  const [row] = await db
    .select({ id: providerMap.entityId })
    .from(providerMap)
    .where(
      and(
        eq(providerMap.provider, 'f1db'),
        eq(providerMap.sport, 'formula-1'),
        eq(providerMap.entityType, 'participant'),
        eq(providerMap.providerId, providerId),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

export async function importCommons(
  db: Database,
  store: ObjectStore,
  client: WikimediaClient,
  manifest: CommonsManifest,
  opts: { plan?: boolean; only?: Set<string>; log?: (m: string) => void } = {},
): Promise<ImportReport> {
  const report: ImportReport = {
    entries: 0,
    photos: 0,
    stored: 0,
    unchanged: 0,
    linked: 0,
    unlinked: 0,
    skipped: [],
  };
  for (const entry of manifest.entries) {
    if (opts.only && !opts.only.has(entry.target)) continue;
    const photos = entry.photos.filter((p) => p.match !== 'rejected');
    report.entries += 1;
    const participantId = await participantOf(db, entry);
    if (!participantId) {
      report.skipped.push({
        key: entry.target,
        reason: 'participante do F1DB não está no core (rode f1db:import)',
      });
      continue;
    }
    /** Pares (asset, papel) que ficam: o mesmo asset em outro papel é vínculo antigo. */
    const keep: { assetId: string; role: string }[] = [];
    if (photos.length) {
      // licença conferida de novo, na hora da importação
      const infos = await client.imageInfo(
        photos.map((p) => p.file),
        COMMONS_THUMB_WIDTH,
      );
      const byTitle = new Map(infos.map((i) => [i.title, i]));
      for (const photo of photos) {
        report.photos += 1;
        const info = byTitle.get(photo.file);
        const license = info ? readLicense(info.extmetadata) : null;
        if (!info || !license?.ok) {
          report.skipped.push({
            key: entry.target,
            file: photo.file,
            reason: info
              ? `licença: ${license && !license.ok ? license.reason : '?'}`
              : 'arquivo sumiu da Commons',
          });
          continue;
        }
        const sourceUrl = commonsSourceUrl(photo.file);
        const [existing] = await db
          .select({ id: asset.id, storageKey: asset.storageKey })
          .from(asset)
          .where(eq(asset.sourceUrl, sourceUrl))
          .limit(1);
        let assetId = existing?.storageKey ? existing.id : null;
        if (opts.plan) {
          if (assetId) report.unchanged += 1;
          else report.stored += 1;
          continue;
        }
        if (!assetId) {
          const { body, contentType } = await client.download(info.thumbUrl);
          const meta = imageInfo(body, contentType ?? 'image/jpeg');
          const sha = createHash('sha256').update(body).digest('hex');
          const key = commonsStorageKey(entry.kind, participantId, sha, meta.contentType);
          if (!key) {
            report.skipped.push({ key: entry.target, file: photo.file, reason: `tipo ${meta.contentType}` });
            continue;
          }
          await store.put(key, body, meta.contentType, sha);
          const [row] = await db
            .insert(asset)
            .values({
              kind: entry.kind === 'driver' ? 'driver' : 'car',
              sourceUrl,
              storageKey: key,
              sha256: sha,
              width: meta.width,
              height: meta.height,
              bytes: body.byteLength,
              fetchedAt: new Date(),
              origin: 'commons',
              acervo: COMMONS_ACERVO_ID,
            })
            .onConflictDoUpdate({
              target: asset.sourceUrl,
              set: {
                storageKey: key,
                sha256: sha,
                width: meta.width,
                height: meta.height,
                bytes: body.byteLength,
                fetchedAt: new Date(),
                origin: 'commons',
                acervo: COMMONS_ACERVO_ID,
              },
            })
            .returning({ id: asset.id });
          assetId = row!.id;
          report.stored += 1;
          opts.log?.(`${entry.target}: ${photo.file}`);
        } else report.unchanged += 1;

        const credit = license.value;
        await db
          .insert(assetCredit)
          .values({
            assetId,
            source: 'wikimedia-commons',
            title: photo.file,
            pageUrl: info.pageUrl,
            author: credit.author,
            authorUrl: credit.authorUrl,
            license: credit.license,
            licenseUrl: credit.licenseUrl,
            credit: credit.credit,
            attributionRequired: credit.attributionRequired,
            shareAlike: credit.shareAlike,
            dateTaken: credit.dateTaken,
            originalWidth: info.width,
            originalHeight: info.height,
          })
          .onConflictDoUpdate({
            target: assetCredit.assetId,
            set: {
              author: credit.author,
              authorUrl: credit.authorUrl,
              license: credit.license,
              licenseUrl: credit.licenseUrl,
              credit: credit.credit,
              attributionRequired: credit.attributionRequired,
              shareAlike: credit.shareAlike,
              dateTaken: credit.dateTaken,
              retrievedAt: new Date(),
            },
          });
        await db
          .insert(participantPhoto)
          .values({
            participantId,
            assetId,
            role: photo.role,
            seasonYear: photo.season,
            rank: photo.rank,
            selectedBy: photo.match === 'manual' ? 'manual' : photo.selected_by,
          })
          .onConflictDoUpdate({
            target: [participantPhoto.participantId, participantPhoto.assetId, participantPhoto.role],
            set: {
              seasonYear: photo.season,
              rank: photo.rank,
              selectedBy: photo.match === 'manual' ? 'manual' : photo.selected_by,
            },
          });
        keep.push({ assetId, role: photo.role });
        report.linked += 1;
      }
    }
    if (opts.plan) continue;
    // fotos do acervo que saíram do manifesto deixam o participante (carro: só as da temporada da entrada)
    const stale = await db
      .delete(participantPhoto)
      .where(
        and(
          eq(participantPhoto.participantId, participantId),
          entry.kind === 'car'
            ? and(eq(participantPhoto.role, 'car'), eq(participantPhoto.seasonYear, entry.season!))
            : inArray(participantPhoto.role, ['portrait', 'action']),
          keep.length
            ? sql`(${participantPhoto.assetId}, ${participantPhoto.role}) not in (${sql.join(
                keep.map((k) => sql`(${k.assetId}::uuid, ${k.role})`),
                sql`, `,
              )})`
            : sql`true`,
          inArray(
            participantPhoto.assetId,
            db.select({ id: asset.id }).from(asset).where(eq(asset.origin, 'commons')),
          ),
        ),
      )
      .returning({ id: participantPhoto.assetId });
    report.unlinked += stale.length;
  }
  return report;
}
