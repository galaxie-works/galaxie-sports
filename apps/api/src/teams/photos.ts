/**
 * Fotos de um participante vindas do acervo de licenças livres (Wikimedia Commons, `assets:commons`), sempre com
 * o crédito exigido pela licença (autor, licença com link e página de origem). Só fotos espelhadas no nosso
 * storage entram: a URL de origem nunca é servida.
 */
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Photo } from '@galaxie/contracts';
import { asset, assetCredit, participantPhoto, type Database } from '@galaxie/db';
import { assetUrl } from '../util.js';

type Role = Photo['role'];

/** "Foto: Gabriele / Wikimedia Commons · CC BY 2.0" (autor ausente: só a fonte e a licença). */
export function creditText(author: string | null, license: string): string {
  return `Foto: ${author ? `${author} / ` : ''}Wikimedia Commons · ${license}`;
}

export async function loadPhotos(
  db: Database,
  participantIds: string[],
  assetsBaseUrl: string | undefined,
  filter: { role?: Role | undefined; season?: number | undefined } = {},
): Promise<Map<string, Photo[]>> {
  const out = new Map<string, Photo[]>();
  if (!participantIds.length) return out;
  const rows = await db
    .select({
      participantId: participantPhoto.participantId,
      role: participantPhoto.role,
      season: participantPhoto.seasonYear,
      rank: participantPhoto.rank,
      key: asset.storageKey,
      width: asset.width,
      height: asset.height,
      c: assetCredit,
    })
    .from(participantPhoto)
    .innerJoin(asset, eq(asset.id, participantPhoto.assetId))
    .innerJoin(assetCredit, eq(assetCredit.assetId, participantPhoto.assetId))
    .where(
      and(
        inArray(participantPhoto.participantId, participantIds),
        isNotNull(asset.storageKey),
        filter.role ? eq(participantPhoto.role, filter.role) : undefined,
        filter.season !== undefined ? eq(participantPhoto.seasonYear, filter.season) : undefined,
      ),
    )
    .orderBy(
      sql`case ${participantPhoto.role} when 'portrait' then 0 when 'highlight_car' then 1 when 'action' then 2 else 3 end`,
      sql`${participantPhoto.seasonYear} desc nulls last`,
      asc(participantPhoto.rank),
    );
  for (const r of rows) {
    const url = assetUrl(assetsBaseUrl, r.key, null);
    if (!url) continue;
    const photo: Photo = {
      url,
      width: r.width,
      height: r.height,
      role: r.role as Role,
      season: r.season,
      credit: {
        source: 'Wikimedia Commons',
        title: r.c.title,
        page_url: r.c.pageUrl,
        author: r.c.author,
        author_url: r.c.authorUrl,
        license: r.c.license,
        license_url: r.c.licenseUrl,
        credit: r.c.credit,
        share_alike: r.c.shareAlike,
        text: creditText(r.c.author, r.c.license),
      },
    };
    out.set(r.participantId, [...(out.get(r.participantId) ?? []), photo]);
  }
  return out;
}
