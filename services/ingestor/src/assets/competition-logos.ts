/**
 * Logo de competição sem logo do fornecedor, vindo da Wikimedia Commons (a F1: a api-sports não tem a
 * entidade "campeonato", e a competição é sintética). Lista curada em
 * `config/assets/commons/competition-logos.yaml`: competição → arquivo da Commons.
 *
 * Regras:
 * - o logo do fornecedor vem primeiro: competição com logo de outra origem não é tocada;
 * - a licença é conferida na hora, no `extmetadata` da Commons (só domínio público, CC0, CC BY e
 *   CC BY-SA, a mesma regra das fotos);
 * - o arquivo vai para o nosso storage (`competitions/<sha256[0..16]>.png`, a miniatura PNG da Commons:
 *   o SVG original nunca é servido), com core.asset (`origin = commons`, `commons://File:…`) e o crédito em
 *   core.asset_credit, que a API publica junto do logo (`logo_credit`).
 *
 * Não é o acervo customizado (flag ASSETS_CUSTOM_LOGOS): este logo vale com a flag desligada, porque a
 * licença do arquivo permite o uso.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { parse } from 'yaml';
import { asset, assetCredit, competition, type Database } from '@galaxie/db';
import type { WikimediaClient } from './commons/client.js';
import { commonsSourceUrl } from './commons/import.js';
import { readLicense } from './commons/license.js';
import { imageInfo } from './image-info.js';
import type { ObjectStore } from './object-store.js';

/** Prefixo das chaves dos logos de competição da Commons no bucket. */
export const COMPETITION_LOGO_PREFIX = 'competitions';
/** Largura da miniatura PNG pedida à Commons (o hub mostra o logo a ~96 px; sobra para telas densas). */
export const COMPETITION_LOGO_WIDTH = 512;

export interface CompetitionLogoEntry {
  /** Slug da competição no core. */
  competition: string;
  /** Arquivo na Commons ("File:F1.svg"). */
  file: string;
  note?: string;
}

/** Lê e valida a lista curada (competição + arquivo `File:` em cada item, sem repetir competição). */
export function parseCompetitionLogos(text: string): CompetitionLogoEntry[] {
  const doc = parse(text) as { logos?: unknown } | null;
  const items = Array.isArray(doc?.logos) ? doc.logos : [];
  const seen = new Set<string>();
  return items.map((raw, i) => {
    const item = raw as Partial<CompetitionLogoEntry>;
    if (typeof item.competition !== 'string' || !item.competition)
      throw new Error(`logos[${i}]: falta "competition"`);
    if (typeof item.file !== 'string' || !item.file.startsWith('File:'))
      throw new Error(`logos[${i}]: "file" tem de ser o título do arquivo na Commons (File:…)`);
    if (seen.has(item.competition)) throw new Error(`logos[${i}]: ${item.competition} repetida`);
    seen.add(item.competition);
    return { competition: item.competition, file: item.file, ...(item.note ? { note: item.note } : {}) };
  });
}

export const loadCompetitionLogos = (path: string) => parseCompetitionLogos(readFileSync(path, 'utf8'));

/** O que fazer com a competição, pelo logo que ela já tem. */
export function logoDecision(
  current: { logoAssetId: string | null; origin: string | null },
  refresh = false,
): 'link' | 'provider' | 'linked' {
  if (!current.logoAssetId) return 'link';
  if (current.origin !== 'commons') return 'provider';
  return refresh ? 'link' : 'linked';
}

export type CompetitionLogoOutcome =
  | { competition: string; status: 'linked'; file: string; license: string }
  | { competition: string; status: 'skipped'; reason: string };

/** Busca, confere, grava e liga o logo de cada item da lista. Com `dryRun`, só diz o que faria. */
export async function runCompetitionLogos(options: {
  db: Database;
  client: WikimediaClient;
  objects: ObjectStore;
  entries: CompetitionLogoEntry[];
  dryRun?: boolean;
  /** Baixa de novo e religa mesmo com o logo da Commons já ligado. */
  refresh?: boolean;
  log?: (msg: string) => void;
}): Promise<CompetitionLogoOutcome[]> {
  const { db, client, objects } = options;
  const outcomes: CompetitionLogoOutcome[] = [];
  const done = (o: CompetitionLogoOutcome) => {
    outcomes.push(o);
    options.log?.(
      o.status === 'skipped'
        ? `${o.competition}: sem mudança — ${o.reason}`
        : `${o.competition}: ${o.file} (${o.license})`,
    );
  };

  const slugs = options.entries.map((e) => e.competition);
  const rows = slugs.length
    ? await db
        .select({
          id: competition.id,
          slug: competition.slug,
          logoAssetId: competition.logoAssetId,
          origin: asset.origin,
        })
        .from(competition)
        .leftJoin(asset, eq(asset.id, competition.logoAssetId))
        .where(inArray(competition.slug, slugs))
    : [];

  for (const entry of options.entries) {
    const row = rows.find((r) => r.slug === entry.competition);
    if (!row) {
      done({ competition: entry.competition, status: 'skipped', reason: 'competição não está no catálogo' });
      continue;
    }
    const decision = logoDecision(row, options.refresh);
    if (decision !== 'link') {
      done({
        competition: entry.competition,
        status: 'skipped',
        reason: decision === 'provider' ? 'já tem o logo do fornecedor' : 'logo da Commons já ligado',
      });
      continue;
    }
    const [info] = await client.imageInfo([entry.file], COMPETITION_LOGO_WIDTH);
    if (!info) {
      done({ competition: entry.competition, status: 'skipped', reason: `${entry.file} não encontrado` });
      continue;
    }
    const license = readLicense(info.extmetadata);
    if (!license.ok) {
      done({ competition: entry.competition, status: 'skipped', reason: `${info.title}: ${license.reason}` });
      continue;
    }
    if (options.dryRun) {
      done({
        competition: entry.competition,
        status: 'linked',
        file: info.title,
        license: license.value.license,
      });
      continue;
    }

    const { body, contentType } = await client.download(info.thumbUrl);
    const meta = imageInfo(body, contentType ?? 'image/png');
    if (meta.contentType !== 'image/png') {
      done({ competition: entry.competition, status: 'skipped', reason: `miniatura em ${meta.contentType}` });
      continue;
    }
    const sha = createHash('sha256').update(body).digest('hex');
    const key = `${COMPETITION_LOGO_PREFIX}/${sha.slice(0, 16)}.png`;
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
    const [saved] = await db
      .insert(asset)
      .values({ kind: 'league_logo', sourceUrl: commonsSourceUrl(info.title), ...stored })
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
      attributionRequired: c.attributionRequired,
      shareAlike: c.shareAlike,
      dateTaken: c.dateTaken,
      originalWidth: info.width,
      originalHeight: info.height,
      retrievedAt: new Date(),
    };
    await db
      .insert(assetCredit)
      .values({ assetId: saved!.id, ...credit })
      .onConflictDoUpdate({ target: assetCredit.assetId, set: credit });
    // de novo a regra do fornecedor primeiro, na própria escrita: só sem logo ou com o da Commons
    await db
      .update(competition)
      .set({ logoAssetId: saved!.id })
      .where(
        and(
          eq(competition.id, row.id),
          or(isNull(competition.logoAssetId), eq(competition.logoAssetId, row.logoAssetId ?? saved!.id)),
        ),
      );
    done({ competition: entry.competition, status: 'linked', file: info.title, license: c.license });
  }
  return outcomes;
}
