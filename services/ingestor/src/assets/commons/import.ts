/**
 * Importação do acervo de fotos da F1 a partir do manifesto (config/assets/commons/f1.yaml):
 * 1. confere de novo a licença na API da Commons (a página pode ter mudado desde o mapeamento);
 * 2. baixa a miniatura que a própria Commons redimensiona (nunca recortamos nem editamos: CC BY-SA);
 * 3. grava no nosso storage com a nossa nomenclatura (`commons/f1/{drivers|cars}/<id do participante>.<hash>`);
 * 4. registra `core.asset` (origin `commons`), o crédito (`core.asset_credit`) e o vínculo com o piloto ou o
 *    construtor (`core.participant_photo`). O logo do participante não muda.
 * 5. carro de destaque do piloto (`highlight_car` no manifesto, com os candidatos em `fallbacks`): a primeira
 *    foto do primeiro carro candidato que pode ir ao fundo (`highlightPhoto`: sem CC BY-SA pela licença conferida
 *    de novo, e a que cita o piloto antes da do companheiro) também vira vínculo do piloto, com o papel
 *    `highlight_car` e a temporada (heading da página do piloto).
 * Idempotente: o mesmo manifesto não regrava nada; foto que saiu do manifesto (ou foi rejeitada) sai do
 * participante (o asset fica). Entrada sem nenhuma foto (descoberta que não achou nada) ou cujos arquivos a
 * Commons não devolveu não apaga a galeria já vinculada.
 */
import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { asset, assetCredit, participantPhoto, providerMap, type Database } from '@galaxie/db';
import { f1dbDriverId } from '@galaxie/providers';
import { imageInfo } from '../image-info.js';
import type { ObjectStore } from '../object-store.js';
import type { WikimediaClient } from './client.js';
import { readLicense } from './license.js';
import { citesDriver, plainWords } from './cites.js';
import { surname } from './scope.js';
import {
  COMMONS_ACERVO_ID,
  type CommonsManifest,
  type ManifestEntry,
  type ManifestPhoto,
} from './manifest.js';

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
  /** Pilotos com o carro de destaque vinculado (na prévia: que seriam vinculados). */
  highlights: number;
  /** Pilotos sem nenhum carro candidato com foto que possa ir ao fundo do heading. */
  withoutHighlight: string[];
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
    highlights: 0,
    withoutHighlight: [],
    skipped: [],
  };
  /** Licença conferida nesta importação: arquivo → CC BY-SA (null = recusada ou sumiu da Commons). */
  const revalidated = new Map<string, boolean | null>();
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
    /**
     * A Commons não devolveu nenhuma página (nem o arquivo nem "apagado"): falha da fonte, a galeria fica. Arquivo
     * apagado na Commons (`missing`) sai normalmente.
     */
    let sourceEmpty = false;
    if (photos.length) {
      // licença conferida de novo, na hora da importação
      const { files: infos, missing } = await client.imageInfoReport(
        photos.map((p) => p.file),
        COMMONS_THUMB_WIDTH,
      );
      sourceEmpty = !infos.length && !missing.length;
      const gone = new Set(missing);
      const byTitle = new Map(infos.map((i) => [i.title, i]));
      for (const photo of photos) {
        report.photos += 1;
        const info = byTitle.get(photo.file);
        const license = info ? readLicense(info.extmetadata) : null;
        // o carro de destaque usa a licença conferida agora, não a do manifesto
        revalidated.set(photo.file, license?.ok ? license.value.shareAlike : null);
        if (!info || !license?.ok) {
          report.skipped.push({
            key: entry.target,
            file: photo.file,
            reason: info
              ? `licença: ${license && !license.ok ? license.reason : '?'}`
              : gone.has(photo.file)
                ? 'arquivo apagado na Commons'
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
    // fotos do acervo do participante (carro: só as da temporada da entrada)
    const ours = and(
      eq(participantPhoto.participantId, participantId),
      entry.kind === 'car'
        ? and(eq(participantPhoto.role, 'car'), eq(participantPhoto.seasonYear, entry.season!))
        : inArray(participantPhoto.role, ['portrait', 'action']),
      inArray(
        participantPhoto.assetId,
        db.select({ id: asset.id }).from(asset).where(eq(asset.origin, 'commons')),
      ),
    );
    // entrada sem nenhuma foto e sem identidade (nem item do Wikidata nem categoria: a descoberta não achou o
    // piloto, como a do Stefan Johansson em 23/10) ou sem resposta da Commons: não é curadoria, e apagar levaria a
    // galeria inteira. A rejeição explícita (`match: rejected`) e o arquivo apagado na Commons tiram foto
    const unidentified = !entry.photos.length && !entry.wikidata && !entry.category;
    if (unidentified || sourceEmpty) {
      const [linked] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(participantPhoto)
        .where(ours);
      if (linked?.n)
        report.skipped.push({
          key: entry.target,
          reason: `${sourceEmpty ? 'a Commons não devolveu nenhum dos arquivos' : 'entrada sem fotos no manifesto'}: as ${linked.n} foto(s) já vinculada(s) ficam`,
        });
      continue;
    }
    // as que saíram do manifesto deixam o participante
    const stale = await db
      .delete(participantPhoto)
      .where(
        and(
          ours,
          keep.length
            ? sql`(${participantPhoto.assetId}, ${participantPhoto.role}) not in (${sql.join(
                keep.map((k) => sql`(${k.assetId}::uuid, ${k.role})`),
                sql`, `,
              )})`
            : sql`true`,
        ),
      )
      .returning({ id: participantPhoto.assetId });
    report.unlinked += stale.length;
  }
  await linkHighlights(db, manifest, report, revalidated, opts);
  return report;
}

/** Nota mínima do Gemini (`hero`) para a foto do carro ir ao fundo do heading. */
export const HERO_MIN = 0.5;

/** Piloto do carro de destaque, para casar com a foto: id do F1DB, nome e sobrenome. */
export interface HighlightDriver {
  f1dbId: string;
  name: string;
  surname: string;
}

export interface HighlightOptions {
  /** Só foto com a nota do Gemini para o fundo (ou da curadoria). */
  scored?: boolean;
  /** O piloto do heading: a foto que o cita vem antes. */
  driver?: HighlightDriver;
  /** Os outros pilotos com o mesmo carro de destaque: a foto que cita só um deles é a do carro do companheiro. */
  teammates?: HighlightDriver[];
  /** A foto pode ir ao fundo (licença conferida, sem CC BY-SA)? Padrão: o `share_alike` do manifesto. */
  free?: (p: ManifestPhoto) => boolean;
}

/** Nomes do carro (construtor, chassi da categoria): o sobrenome igual a um deles só cita com o nome inteiro. */
const carNamesOf = (car: ManifestEntry | undefined): string[] =>
  car ? [car.name, car.category, car.f1db_id?.replace(/-/g, ' ')].filter((n): n is string => !!n) : [];

/**
 * A foto cita o piloto: o que a varredura registrou (`drivers`) ou o sobrenome no título do arquivo, como palavra
 * inteira. Sobrenome que é também o nome do carro (Jack Brabham no "1971 Brabham BT33") só com o nome inteiro.
 */
export function photoCites(p: ManifestPhoto, d: HighlightDriver, carNames: readonly string[] = []): boolean {
  if (p.drivers?.includes(d.f1dbId)) return true;
  return citesDriver(p.file.replace(/^File:/, ''), d, carNames);
}

/** Sobrenome do piloto pelo nome do manifesto ("Carlos Sainz Jr." → "Sainz"). */
export const driverSurname = (name: string) => surname(name).split(/\s+/).at(-1) ?? name;

/**
 * Foto do carro de destaque: a primeira não rejeitada e sem CC BY-SA. O heading recorta a foto no navegador
 * (cover), o que é uma adaptação; BY-SA pediria a mesma licença na obra derivada. Só BY-SA no carro: o piloto
 * fica sem destaque (o heading usa a cor da equipe), e as fotos seguem na galeria, inteiras e com crédito.
 * Com a nota do Gemini para o fundo (`hero`): a curadoria manual primeiro, depois a de maior nota a partir de
 * `HERO_MIN` (close de gente, detalhe ou pessoa moderna em primeiro plano ficam de fora). `scored`: só foto com
 * nota (ou da curadoria) — carro ainda sem a nota do Gemini não vai ao fundo (o heading usa a cor da equipe).
 * Com o piloto (`driver`): a foto que cita só um companheiro do mesmo carro fica de fora (é o carro dele), e a que
 * cita o piloto passa à frente das que não citam ninguém.
 */
export function highlightPhoto(
  car: ManifestEntry | undefined,
  opts: HighlightOptions = {},
): ManifestPhoto | undefined {
  const free = opts.free ?? ((p: ManifestPhoto) => !p.share_alike);
  const { driver } = opts;
  // o mesmo sobrenome (os Hill, os Verstappen) não separa as fotos
  const mates = (opts.teammates ?? []).filter(
    (t) => !driver || plainWords(t.surname) !== plainWords(driver.surname),
  );
  const carNames = carNamesOf(car);
  const own = (p: ManifestPhoto) => !!driver && photoCites(p, driver, carNames);
  const ok = (car?.photos ?? []).filter(
    (p) => p.match !== 'rejected' && free(p) && (own(p) || !mates.some((t) => photoCites(p, t, carNames))),
  );
  if (!opts.scored && !ok.some((p) => p.hero != null)) return ok.find(own) ?? ok[0];
  return ok
    .filter((p) => p.match === 'manual' || (p.hero ?? 0) >= HERO_MIN)
    .sort(
      (a, b) =>
        Number(b.match === 'manual') - Number(a.match === 'manual') ||
        Number(own(b)) - Number(own(a)) ||
        (b.hero ?? 0) - (a.hero ?? 0),
    )[0];
}

/** Carros candidatos a destaque do piloto (`highlight_car` e os `fallbacks`). */
const highlightTargets = (e: ManifestEntry) =>
  e.highlight_car ? [e.highlight_car.target, ...(e.highlight_car.fallbacks ?? []).map((f) => f.target)] : [];

/**
 * Carro de destaque do piloto, com a foto e a temporada: a curadoria (`manual`, com a foto escolhida em `file`,
 * de qualquer alvo) ou o primeiro candidato da regra (`highlight_car` e os `fallbacks`) cujo carro tem foto com
 * a nota do Gemini para o fundo (`highlightPhoto` com `scored`). O carro escolhido na curadoria vale sem a nota.
 * O carro que é destaque de mais de um piloto (companheiros de equipe) dá a cada um a foto que o cita.
 */
export function pickHighlight(
  entry: ManifestEntry,
  byTarget: Map<string, ManifestEntry>,
  opts: Pick<HighlightOptions, 'free'> = {},
): { target: string; season: number; photo: ManifestPhoto } | undefined {
  const h = entry.highlight_car;
  if (!h) return undefined;
  const free = opts.free ?? ((p: ManifestPhoto) => !p.share_alike);
  if (h.file) {
    const own = [byTarget.get(h.target), entry, ...byTarget.values()];
    const photo = own
      .flatMap((e) => e?.photos ?? [])
      .find((p) => p.file === h.file && p.match !== 'rejected' && free(p));
    return photo ? { target: h.target, season: h.season, photo } : undefined;
  }
  const driver = { f1dbId: entry.f1db_id, name: entry.name, surname: driverSurname(entry.name) };
  const teammates = (target: string) =>
    [...byTarget.values()]
      .filter((e) => e.kind === 'driver' && e.target !== entry.target && highlightTargets(e).includes(target))
      .map((e) => ({ f1dbId: e.f1db_id, name: e.name, surname: driverSurname(e.name) }));
  const forCar = (target: string, scored: boolean) =>
    highlightPhoto(byTarget.get(target), { scored, driver, teammates: teammates(target), free });
  if (h.match === 'manual') {
    const photo = forCar(h.target, false);
    return photo ? { target: h.target, season: h.season, photo } : undefined;
  }
  for (const c of [h, ...(h.fallbacks ?? [])]) {
    const photo = forCar(c.target, true);
    if (photo) return { target: c.target, season: c.season, photo };
  }
  return undefined;
}

/**
 * Carro de destaque de cada piloto (`pickHighlight`), com a foto já no storage. A licença que vale é a conferida
 * nesta importação (`revalidated`); a foto que esta importação não conferiu usa o crédito gravado na anterior e,
 * sem ele, o manifesto.
 */
async function linkHighlights(
  db: Database,
  manifest: CommonsManifest,
  report: ImportReport,
  revalidated: ReadonlyMap<string, boolean | null>,
  opts: { plan?: boolean; only?: Set<string> },
): Promise<void> {
  const byTarget = new Map(manifest.entries.map((e) => [e.target, e]));
  const credits = new Map(
    (
      await db
        .select({ title: assetCredit.title, shareAlike: assetCredit.shareAlike })
        .from(assetCredit)
        .where(eq(assetCredit.source, 'wikimedia-commons'))
    ).map((c) => [c.title, c.shareAlike]),
  );
  const free = (p: ManifestPhoto) =>
    revalidated.has(p.file) ? revalidated.get(p.file) === false : !(credits.get(p.file) ?? p.share_alike);
  for (const entry of manifest.entries) {
    if (entry.kind !== 'driver') continue;
    const h = entry.highlight_car ?? null;
    const cars = highlightTargets(entry);
    if (opts.only && !opts.only.has(entry.target) && !cars.some((c) => opts.only!.has(c))) continue;
    const picked = pickHighlight(entry, byTarget, { free });
    const photo = picked?.photo;
    if (!picked) report.withoutHighlight.push(entry.target);
    if (opts.plan) {
      if (photo) report.highlights += 1;
      continue;
    }
    const participantId = await participantOf(db, entry);
    if (!participantId) continue;
    const [row] = photo
      ? await db
          .select({ id: asset.id })
          .from(asset)
          .where(and(eq(asset.sourceUrl, commonsSourceUrl(photo.file)), sql`${asset.storageKey} is not null`))
          .limit(1)
      : [];
    const assetId = row?.id ?? null;
    if (assetId && h && picked) {
      const selectedBy = h.match === 'manual' ? 'manual' : picked.photo.selected_by;
      const seasonYear = picked.season;
      await db
        .insert(participantPhoto)
        .values({ participantId, assetId, role: 'highlight_car', seasonYear, rank: 0, selectedBy })
        .onConflictDoUpdate({
          target: [participantPhoto.participantId, participantPhoto.assetId, participantPhoto.role],
          set: { seasonYear, rank: 0, selectedBy },
        });
      report.highlights += 1;
    }
    // destaque antigo (outro carro, ou o carro ficou sem foto) sai
    const stale = await db
      .delete(participantPhoto)
      .where(
        and(
          eq(participantPhoto.participantId, participantId),
          eq(participantPhoto.role, 'highlight_car'),
          assetId ? sql`${participantPhoto.assetId} <> ${assetId}::uuid` : sql`true`,
        ),
      )
      .returning({ id: participantPhoto.assetId });
    report.unlinked += stale.length;
  }
}
