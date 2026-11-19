/**
 * Logo de time sem logo do fornecedor, vindo da Wikimedia Commons. Começou pelos construtores da F1: a api-sports
 * só tem logo das equipes recentes, e os construtores históricos (do f1db) chegam sem imagem. Lista curada em
 * `config/assets/commons/team-logos.yaml`: time (pelo id de um fornecedor) → arquivo da Commons.
 *
 * Mesmas regras do logo de competição (`competition-logos.ts`):
 * - o logo do fornecedor vem primeiro: time com logo de outra origem não é tocado;
 * - a licença é conferida na hora, no `extmetadata` da Commons (domínio público, CC0, CC BY e CC BY-SA);
 * - o arquivo vai para o nosso storage com a nossa nomenclatura (`commons/teams/<id do time>.<sha256[0..12]>.png`,
 *   a miniatura PNG da Commons; o SVG original nunca é servido), com core.asset (`origin = commons`) e o crédito
 *   em core.asset_credit;
 * - a paleta (cores do time) sai do PNG, como no acervo;
 * - a troca sai no change feed (`publishTeamLogoChanges`), e a API purga o time.
 *
 * Não é o acervo customizado (flag ASSETS_CUSTOM_LOGOS): o logo vale com a flag desligada, porque a licença do
 * arquivo permite o uso. Marca registrada: a licença cobre o direito autoral do arquivo, não a marca; uso
 * editorial (identificar a equipe), sem sugerir endosso.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { parse } from 'yaml';
import { asset, assetCredit, participant, providerMap, type Database } from '@galaxie/db';
import { imageInfo, paletteFromPng } from '@galaxie/crests';
import { publishTeamLogoChanges } from './asset-store.js';
import type { WikimediaClient } from './commons/client.js';
import { commonsSourceUrl } from './commons/import.js';
import { readLicense } from './commons/license.js';
import { logoDecision } from './competition-logos.js';
import type { ObjectStore } from './object-store.js';

/** Prefixo das chaves dos logos de time da Commons no bucket. */
export const TEAM_LOGO_PREFIX = 'commons/teams';
/** Largura da miniatura PNG pedida à Commons (o mesmo 512 px do maior tamanho do acervo). */
export const TEAM_LOGO_WIDTH = 512;

export interface TeamLogoEntry {
  sport: string;
  /** Fornecedor do id (`f1db`, `api-sports`), em core.provider_map. */
  provider: string;
  /** Id do time nesse fornecedor. */
  team: string;
  /** Arquivo na Commons ("File:…"). */
  file: string;
  /** Item do Wikidata de onde veio o arquivo (P154), para rastro. */
  wikidata?: string;
  note?: string;
}

const key = (e: Pick<TeamLogoEntry, 'sport' | 'provider' | 'team'>) => `${e.sport}/${e.provider}/${e.team}`;

/** Lê e valida a lista curada (sem repetir time). */
export function parseTeamLogos(text: string): TeamLogoEntry[] {
  const doc = parse(text) as { logos?: unknown } | null;
  const items = Array.isArray(doc?.logos) ? doc.logos : [];
  const seen = new Set<string>();
  return items.map((raw, i) => {
    const item = raw as Partial<TeamLogoEntry>;
    for (const field of ['sport', 'provider', 'team'] as const)
      if (typeof item[field] !== 'string' || !item[field]) throw new Error(`logos[${i}]: falta "${field}"`);
    if (typeof item.file !== 'string' || !item.file.startsWith('File:'))
      throw new Error(`logos[${i}]: "file" tem de ser o título do arquivo na Commons (File:…)`);
    if (item.wikidata !== undefined && !/^Q\d+$/.test(String(item.wikidata)))
      throw new Error(`logos[${i}]: "wikidata" tem de ser um QID`);
    const entry: TeamLogoEntry = {
      sport: item.sport!,
      provider: item.provider!,
      team: String(item.team),
      file: item.file,
      ...(item.wikidata ? { wikidata: String(item.wikidata) } : {}),
      ...(item.note ? { note: item.note } : {}),
    };
    if (seen.has(key(entry))) throw new Error(`logos[${i}]: ${key(entry)} repetido`);
    seen.add(key(entry));
    return entry;
  });
}

export const loadTeamLogos = (path: string) => parseTeamLogos(readFileSync(path, 'utf8'));

/** Título como a Commons devolve: `_` vira espaço e a primeira letra do nome fica maiúscula. */
export function commonsTitle(file: string): string {
  const name = file
    .replace(/^File:/, '')
    .replace(/_/g, ' ')
    .trim();
  return `File:${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/** Chave no storage: a nossa nomenclatura (id do time e hash), sem o nome do arquivo da Commons. */
export const teamLogoStorageKey = (participantId: string, sha256: string) =>
  `${TEAM_LOGO_PREFIX}/${participantId}.${sha256.slice(0, 12)}.png`;

export type TeamLogoOutcome =
  | { team: string; status: 'linked'; file: string; license: string }
  | { team: string; status: 'skipped'; reason: string };

/** Busca, confere, grava e liga o logo de cada item da lista. Com `dryRun`, só diz o que faria. */
export async function runTeamLogos(options: {
  db: Database;
  client: WikimediaClient;
  objects: ObjectStore;
  entries: TeamLogoEntry[];
  dryRun?: boolean;
  /** Baixa de novo e religa mesmo com o logo da Commons já ligado. */
  refresh?: boolean;
  log?: (msg: string) => void;
}): Promise<TeamLogoOutcome[]> {
  const { db, client, objects } = options;
  const outcomes: TeamLogoOutcome[] = [];
  const done = (o: TeamLogoOutcome) => {
    outcomes.push(o);
    options.log?.(
      o.status === 'skipped' ? `${o.team}: sem mudança — ${o.reason}` : `${o.team}: ${o.file} (${o.license})`,
    );
  };

  const ids = [...new Set(options.entries.map((e) => e.team))];
  const rows = ids.length
    ? await db
        .select({
          id: participant.id,
          sport: providerMap.sport,
          provider: providerMap.provider,
          providerId: providerMap.providerId,
          logoAssetId: participant.logoAssetId,
          origin: asset.origin,
        })
        .from(providerMap)
        .innerJoin(participant, eq(participant.id, providerMap.entityId))
        .leftJoin(asset, eq(asset.id, participant.logoAssetId))
        .where(and(eq(providerMap.entityType, 'participant'), inArray(providerMap.providerId, ids)))
    : [];

  // metadados de todos os arquivos de uma vez (o cliente pede em lotes de 50 títulos)
  const files = [...new Set(options.entries.map((e) => commonsTitle(e.file)))];
  const infos = new Map((await client.imageInfo(files, TEAM_LOGO_WIDTH)).map((f) => [f.title, f]));

  for (const entry of options.entries) {
    const label = key(entry);
    const row = rows.find(
      (r) => r.sport === entry.sport && r.provider === entry.provider && r.providerId === entry.team,
    );
    if (!row) {
      done({ team: label, status: 'skipped', reason: 'time não está no catálogo' });
      continue;
    }
    const decision = logoDecision(row, options.refresh);
    if (decision !== 'link') {
      done({
        team: label,
        status: 'skipped',
        reason: decision === 'provider' ? 'já tem o logo do fornecedor' : 'logo da Commons já ligado',
      });
      continue;
    }
    const info = infos.get(commonsTitle(entry.file));
    if (!info) {
      done({ team: label, status: 'skipped', reason: `${entry.file} não encontrado` });
      continue;
    }
    const license = readLicense(info.extmetadata);
    if (!license.ok) {
      done({ team: label, status: 'skipped', reason: `${info.title}: ${license.reason}` });
      continue;
    }
    if (options.dryRun) {
      done({ team: label, status: 'linked', file: info.title, license: license.value.license });
      continue;
    }

    const { body, contentType } = await client.download(info.thumbUrl);
    const meta = imageInfo(body, contentType ?? 'image/png');
    if (meta.contentType !== 'image/png') {
      done({ team: label, status: 'skipped', reason: `miniatura em ${meta.contentType}` });
      continue;
    }
    const sha = createHash('sha256').update(body).digest('hex');
    const storageKey = teamLogoStorageKey(row.id, sha);
    await objects.put(storageKey, body, meta.contentType, sha);
    const stored = {
      storageKey,
      sha256: sha,
      width: meta.width,
      height: meta.height,
      bytes: body.byteLength,
      fetchedAt: new Date(),
      origin: 'commons' as const,
      palette: paletteFromPng(body),
    };
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
      attributionCheckedAt: new Date(),
      attributionRequired: c.attributionRequired,
      shareAlike: c.shareAlike,
      dateTaken: c.dateTaken,
      originalWidth: info.width,
      originalHeight: info.height,
      retrievedAt: new Date(),
    };
    await db.transaction(async (tx) => {
      const [saved] = await tx
        .insert(asset)
        .values({ kind: 'team_logo', sourceUrl: commonsSourceUrl(info.title), ...stored })
        .onConflictDoUpdate({ target: asset.sourceUrl, set: stored })
        .returning({ id: asset.id });
      await tx
        .insert(assetCredit)
        .values({ assetId: saved!.id, ...credit })
        .onConflictDoUpdate({ target: assetCredit.assetId, set: credit });
      // de novo a regra do fornecedor primeiro, na própria escrita: só sem logo ou com o da Commons
      const linked = await tx
        .update(participant)
        .set({ logoAssetId: saved!.id })
        .where(
          and(
            eq(participant.id, row.id),
            or(isNull(participant.logoAssetId), eq(participant.logoAssetId, row.logoAssetId ?? saved!.id)),
          ),
        )
        .returning({ id: participant.id });
      await publishTeamLogoChanges(
        tx,
        linked.map((l) => l.id),
      );
    });
    done({ team: label, status: 'linked', file: info.title, license: c.license });
  }
  return outcomes;
}
